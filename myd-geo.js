/**
 * myd-geo.js — MyDarrin Geo Engine v2
 * 
 * Comportament ca aplicațiile meteo:
 *   1. La prima vizită: cere permisiune GPS → adresă exactă ±15m
 *   2. Cache localStorage 30 min → instant la reîncărcare
 *   3. IP fallback dacă GPS refuzat → țară + monedă
 * 
 * Expune pe window:
 *   MYD_GEO.data      — obiect cu toate datele
 *   MYD_GEO.refresh() — forțează re-detectare
 *   MYD_GEO.setManual(code) — selectare manuală țară
 */

(function() {
'use strict';

// ── Config ────────────────────────────────────────────────────────
var CACHE_KEY  = 'myd_geo_v3';
var CACHE_TTL  = 30 * 60 * 1000;  // 30 minute

// FIX (audit Secțiunea 35/36, G35, unificare 31 Iulie 2026): COUNTRIES era
// dublat aproape identic în 3 surse (acest fișier, lib/i18n.js TARA_LA_LIMBA,
// plus lipsea complet AT/CH/BE/IE aici deși existau în lib/i18n.js — un
// vizitator elvețian, de exemplu, era tratat silențios ca România, inclusiv
// la monedă). Sursă unică acum: tari-config.json, la rădăcina site-ului,
// citit atât aici (fetch) cât și în lib/i18n.js (fs.readFileSync) — vezi
// _incarcaConfigTari() mai jos. COUNTRIES rămâne o variabilă locală,
// POPULATĂ din acel fișier înainte ca _start() să ruleze (nu mai e un
// literal static) — restul acestui fișier (_applyUI/_buildData/etc.) nu s-a
// schimbat, citește tot info.flag/info.name/info.currency/info.code/info.lang.
//
// Fallback minimal (DOAR RO) dacă fetch-ul eșuează (rețea/fișier lipsă) —
// mai bine decât să blocheze complet detectarea geo.
var COUNTRIES = {
  RO: { flag:'🇷🇴', name:'România', currency:'Lei', code:'RON', lang:'ro', active:true },
};

function _incarcaConfigTari(callback) {
  fetch('/tari-config.json', { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(cfg) {
      var tari = cfg && cfg.tari;
      if (tari && Object.keys(tari).length) {
        var noi = {};
        Object.keys(tari).forEach(function(cc) {
          var t = tari[cc];
          noi[cc] = { flag: t.flag, name: t.nume, currency: t.moneda_simbol, code: t.moneda_cod, lang: t.limba, active: !!t.activ_public };
        });
        COUNTRIES = noi;
      }
      callback();
    })
    .catch(function() { callback(); }); // fallback (doar RO) rămâne activ
}

var DEFAULT_CC = 'RO';

// ── State ──────────────────────────────────────────────────────────
var MYD_GEO = window.MYD_GEO = {
  data: null,      // MYD_GEO.locatie: { cc, flag, name, currency, currCode, lang, city, region, address, lat, lng, accuracy, source }
  prestare: null,  // MYD_GEO.prestare: { cc, city, region, address, lat, lng } — adresa de EXECUȚIE a serviciului, distinctă de locația curentă
  checkoutActiv: null,  // bool — dacă țara curentă (MYD_GEO.data.cc) poate finaliza o comandă, din tax_configurations (sursă reală)
  tariActive: null,     // array coduri țară cu checkout_activ=true, din /api/public/tari-active
  ready: false,
  _listeners: [],
  on: function(fn) { this._listeners.push(fn); if (this.ready && this.data) fn(this.data); },
  _fire: function(d) { this.data = d; this.ready = true; this._listeners.forEach(function(f){ f(d); }); _refreshCheckoutActiv(); },
  refresh: function() { _cache.clear(); _start(); },
  setManual: function(cc) { _applyCountry(cc, 'manual'); },
  // Geocodare adresă de execuție (forward-geocoding) — distinctă de detectarea locației curente.
  // Promovat din mydarrin-produs.html (G27) ca implementare comună.
  geocodeazaAdresa: function(text, callback) { _geocodeazaPrestare(text, callback); },
};

// ── Checkout activ — sursă reală tax_configurations, via /api/public/tari-active ──
function _refreshCheckoutActiv() {
  fetch('/api/public/tari-active')
    .then(function(r){ return r.json(); })
    .then(function(d){
      var lista = (d && Array.isArray(d.active)) ? d.active : ['RO'];
      MYD_GEO.tariActive = lista;
      var cc = (MYD_GEO.data && MYD_GEO.data.cc) || DEFAULT_CC;
      MYD_GEO.checkoutActiv = lista.indexOf(cc) !== -1;
      try { window.dispatchEvent(new CustomEvent('myd:geo:checkout', { detail: { checkoutActiv: MYD_GEO.checkoutActiv, tariActive: lista } })); } catch(e) {}
    })
    .catch(function(){
      // Fail-safe: dacă endpoint-ul nu răspunde, presupunem doar RO activ (statusul curent real)
      MYD_GEO.tariActive = ['RO'];
      var cc = (MYD_GEO.data && MYD_GEO.data.cc) || DEFAULT_CC;
      MYD_GEO.checkoutActiv = cc === 'RO';
    });
}

// ── Nivel „prestare": forward-geocoding Nominatim pentru adresa de execuție ──
function _geocodeazaPrestare(text, callback) {
  if (!text || text.length <= 8) { MYD_GEO.prestare = null; if (callback) callback(null); return; }
  var url = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=' + encodeURIComponent(text);
  fetch(url, { headers: { 'User-Agent': 'MyDarrin/2.0 (homebestpal.com)' } })
    .then(function(r){ return r.json(); })
    .then(function(rez){
      var hit = rez && rez[0];
      if (!hit || !hit.address) { if (callback) callback(null); return; }
      var a = hit.address;
      var cc = (a.country_code || 'ro').toUpperCase();
      cc = COUNTRIES[cc] ? cc : DEFAULT_CC;
      var city = a.city || a.town || a.village || a.municipality || a.suburb || '';
      var region = a.county || a.state || '';
      var street = [a.road, a.house_number].filter(Boolean).join(' ');
      var address = [street, city, region].filter(Boolean).join(', ');
      var d = { cc: cc, city: city, region: region, address: address, lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) };
      MYD_GEO.prestare = d;
      try { window.dispatchEvent(new CustomEvent('myd:geo:prestare', { detail: d })); } catch(e) {}
      if (callback) callback(d);
    })
    .catch(function(){ if (callback) callback(null); });
}

// ── Cache ──────────────────────────────────────────────────────────
var _cache = {
  get: function() {
    try {
      var d = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (d && d.ts && Date.now() - d.ts < CACHE_TTL) return d;
    } catch(e) {}
    return null;
  },
  set: function(d) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(Object.assign({}, d, {ts: Date.now()}))); } catch(e) {}
  },
  clear: function() {
    try { localStorage.removeItem(CACHE_KEY); } catch(e) {}
  }
};

// ── Aplicăm datele în UI ──────────────────────────────────────────
function _applyUI(d) {
  var cc   = d.cc || DEFAULT_CC;
  var info = COUNTRIES[cc] || COUNTRIES[DEFAULT_CC];

  // 1. Flag + țară + monedă în topbar
  _set('loc-flag',     info.flag);
  _set('loc-display',  d.city ? d.city + (d.region ? ', ' + d.region : '') : info.name);
  _set('loc-currency', '· ' + info.currency);

  // 2. Banda geo sub header (pe paginile fără topbar complet)
  _set('geo-city',     d.city || info.name);
  _set('geo-region',   d.region || '');
  _set('geo-country',  info.name);
  _set('geo-flag',     info.flag);
  _set('geo-currency', info.currency);
  _set('geo-address',  d.address || d.city || info.name);

  // 3. Badge precizie
  var src = { gps:'📍 GPS · ±' + (d.accuracy||15) + 'm', ip:'🌐 IP · ~50km', manual:'✏️ Manual', cache:'📍 Salvat' };
  _set('geo-source-badge', src[d.source] || '');

  // 4. Prețuri — actualizăm spanurile cu clasa dyn-currency
  document.querySelectorAll('.dyn-currency').forEach(function(el) { el.textContent = info.currency; });

  // 5. Dispatch event pentru alte module
  try { window.dispatchEvent(new CustomEvent('myd:geo', { detail: d })); } catch(e) {}

  // 6. <html lang="">
  if (d.lang || info.lang) document.documentElement.lang = d.lang || info.lang;
}

function _set(id, val) {
  var el = document.getElementById(id);
  if (el && val !== undefined) el.textContent = val;
}

// ── Construiește obiectul de date complet ──────────────────────────
function _buildData(partial, source) {
  var cc   = partial.cc || DEFAULT_CC;
  var info = COUNTRIES[cc] || COUNTRIES[DEFAULT_CC];
  return {
    cc:       cc,
    flag:     info.flag,
    name:     info.name,
    currency: info.currency,
    currCode: info.code,
    lang:     info.lang,
    city:     partial.city    || '',
    region:   partial.region  || '',
    address:  partial.address || '',
    lat:      partial.lat     || null,
    lng:      partial.lng     || null,
    accuracy: partial.accuracy|| null,
    source:   source,
  };
}

// ── Nivel 1: GPS browser (±0–15m) ─────────────────────────────────
function _tryGPS(onSuccess, onFail) {
  if (!navigator.geolocation) { onFail('no-api'); return; }

  // Afișăm stare "detectare" în UI
  _set('loc-display', 'Detectare...');
  _set('geo-city', '⏳ Detectare locație...');

  navigator.geolocation.getCurrentPosition(
    function(pos) {
      var lat = pos.coords.latitude;
      var lng = pos.coords.longitude;
      var acc = Math.round(pos.coords.accuracy);

      // Reverse geocoding Nominatim (OSM, gratuit, GDPR compliant)
      fetch(
        'https://nominatim.openstreetmap.org/reverse?lat=' + lat +
        '&lon=' + lng + '&format=json&accept-language=ro&addressdetails=1',
        { headers: { 'User-Agent': 'MyDarrin/2.0 (homebestpal.com)' } }
      )
      .then(function(r) { return r.json(); })
      .then(function(geo) {
        var a  = geo.address || {};
        var cc = (a.country_code || 'ro').toUpperCase();
        cc = COUNTRIES[cc] ? cc : DEFAULT_CC;

        var city    = a.city || a.town || a.village || a.municipality || a.suburb || '';
        var region  = a.county || a.state || '';
        var street  = [a.road, a.house_number].filter(Boolean).join(' ');
        var address = [street, city, region].filter(Boolean).join(', ');

        onSuccess(_buildData({ cc:cc, city:city, region:region, address:address, lat:lat, lng:lng, accuracy:acc }, 'gps'));
      })
      .catch(function() {
        // GPS ok dar reverse geocoding eșuat — folosim coords + țara din IP
        onSuccess(_buildData({ lat:lat, lng:lng, accuracy:acc, city: lat.toFixed(3)+'°N ' + lng.toFixed(3)+'°E' }, 'gps'));
      });
    },
    function(err) {
      // Coduri eroare: 1=refuzat, 2=indisponibil, 3=timeout
      onFail(err.code === 1 ? 'denied' : 'unavailable');
    },
    {
      enableHighAccuracy: true,
      timeout:            10000,  // 10s
      maximumAge:         60000,  // acceptă coords max 1 min vechi
    }
  );
}

// ── Nivel 2: IP detection (țară + monedă) ──────────────────────────
function _tryIP(onSuccess, onFail) {
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var t    = setTimeout(function() { if (ctrl) ctrl.abort(); onFail('timeout'); }, 5000);
  var opts = ctrl ? { signal: ctrl.signal } : {};

  fetch('https://ipapi.co/json/', opts)
  .then(function(r) { return r.json(); })
  .then(function(d) {
    clearTimeout(t);
    var cc = (d.country_code || 'RO').toUpperCase();
    cc = COUNTRIES[cc] ? cc : DEFAULT_CC;
    onSuccess(_buildData({
      cc:     cc,
      city:   d.city   || '',
      region: d.region || '',
      lat:    d.latitude,
      lng:    d.longitude,
    }, 'ip'));
  })
  .catch(function() {
    clearTimeout(t);
    onFail('error');
  });
}

// ── Aplicăm o țară după cod ────────────────────────────────────────
function _applyCountry(cc, source) {
  cc = cc.toUpperCase();
  var info = COUNTRIES[cc] || COUNTRIES[DEFAULT_CC];
  var d = _buildData({ cc: (COUNTRIES[cc] ? cc : DEFAULT_CC) }, source);
  _cache.set(d);
  _applyUI(d);
  MYD_GEO._fire(d);
}

// ── Fișier protocol: pe file:// Nominatim nu merge via CORS ────────
var _isFile = window.location.protocol === 'file:';

// ── START — logica principală ─────────────────────────────────────
function _start() {
  // Cache valid?
  var cached = _cache.get();
  if (cached) {
    _applyUI(cached);
    MYD_GEO._fire(cached);

    // Dacă cache-ul e din IP și avem permisiune GPS, îmbunătățim în fundal
    if (cached.source === 'ip' && navigator.geolocation && !_isFile) {
      setTimeout(function() {
        navigator.permissions && navigator.permissions.query({ name:'geolocation' }).then(function(p) {
          if (p.state === 'granted') {
            _tryGPS(function(d) {
              if (d.city) { _cache.set(d); _applyUI(d); MYD_GEO._fire(d); }
            }, function() {});
          }
        }).catch(function() {});
      }, 2000);
    }
    return;
  }

  // Prima vizită sau cache expirat
  if (_isFile) {
    // Pe file:// nu putem face fetch CORS — cerem GPS direct
    _tryGPS(
      function(d) { _cache.set(d); _applyUI(d); MYD_GEO._fire(d); },
      function()  { _applyCountry(DEFAULT_CC, 'ip'); }
    );
    return;
  }

  // Strategie: IP imediat (pentru monedă) + GPS dacă permisiunea e gata
  var ipDone  = false;
  var gpsDone = false;
  var ipData  = null;

  // Pornim IP
  _tryIP(function(d) {
    ipData = d;
    ipDone = true;
    if (!gpsDone) {
      // Afișăm IP imediat ca placeholder
      _applyUI(d);
      MYD_GEO._fire(d);
    }
  }, function() {
    ipDone = true;
    if (!gpsDone) _applyCountry(DEFAULT_CC, 'ip');
  });

  // Pornim GPS simultan — dacă e mai rapid sau mai precis, suprascrie IP
  if (navigator.geolocation) {
    navigator.permissions && navigator.permissions.query({ name:'geolocation' }).then(function(p) {
      if (p.state === 'granted' || p.state === 'prompt') {
        _tryGPS(function(d) {
          gpsDone = true;
          _cache.set(d);
          _applyUI(d);
          MYD_GEO._fire(d);
        }, function() {
          gpsDone = true;
          // GPS eșuat — IP era deja aplicat sau aplicăm default
          if (!ipDone && !ipData) _applyCountry(DEFAULT_CC, 'ip');
        });
      } else {
        // GPS blocat de user — rămânem cu IP
        gpsDone = true;
      }
    }).catch(function() {
      // permissions API indisponibilă (vechi browser) — cerem GPS direct
      _tryGPS(function(d) {
        gpsDone = true;
        _cache.set(d);
        _applyUI(d);
        MYD_GEO._fire(d);
      }, function() { gpsDone = true; });
    });
  }
}

// ── Init la DOMContentLoaded ──────────────────────────────────────
// _start() rulează abia după ce COUNTRIES e populat din tari-config.json
// (sau rămâne pe fallback-ul minimal RO, dacă fetch-ul eșuează) — altfel
// primele detectări ar folosi mereu fallback-ul, indiferent de fișier.
function _initGeo() { _incarcaConfigTari(_start); }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initGeo);
} else {
  _initGeo();
}

})();
