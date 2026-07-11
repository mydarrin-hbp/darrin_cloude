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

var COUNTRIES = {
  RO: { flag:'🇷🇴', name:'România',  currency:'Lei', code:'RON', lang:'ro', active:true  },
  MD: { flag:'🇲🇩', name:'Moldova',  currency:'Lei', code:'MDL', lang:'ro', active:true  },
  DE: { flag:'🇩🇪', name:'Germania', currency:'EUR', code:'EUR', lang:'de', active:true  },
  FR: { flag:'🇫🇷', name:'Franța',   currency:'EUR', code:'EUR', lang:'fr', active:true  },
  BG: { flag:'🇧🇬', name:'Bulgaria', currency:'BGN', code:'BGN', lang:'bg', active:true  },
  ES: { flag:'🇪🇸', name:'Spania',   currency:'EUR', code:'EUR', lang:'es', active:false },
  GB: { flag:'🇬🇧', name:'UK',       currency:'GBP', code:'GBP', lang:'en', active:false },
  US: { flag:'🇺🇸', name:'SUA',      currency:'USD', code:'USD', lang:'en', active:false },
  IT: { flag:'🇮🇹', name:'Italia',   currency:'EUR', code:'EUR', lang:'it', active:false },
  HU: { flag:'🇭🇺', name:'Ungaria',  currency:'HUF', code:'HUF', lang:'hu', active:false },
  PL: { flag:'🇵🇱', name:'Polonia',  currency:'PLN', code:'PLN', lang:'pl', active:false },
};

var DEFAULT_CC = 'RO';

// ── State ──────────────────────────────────────────────────────────
var MYD_GEO = window.MYD_GEO = {
  data: null,      // { cc, flag, name, currency, currCode, lang, city, region, address, lat, lng, accuracy, source }
  ready: false,
  _listeners: [],
  on: function(fn) { this._listeners.push(fn); if (this.ready && this.data) fn(this.data); },
  _fire: function(d) { this.data = d; this.ready = true; this._listeners.forEach(function(f){ f(d); }); },
  refresh: function() { _cache.clear(); _start(); },
  setManual: function(cc) { _applyCountry(cc, 'manual'); }
};

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
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _start);
} else {
  _start();
}

})();
