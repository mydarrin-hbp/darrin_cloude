/* ════════════════════════════════════════════════════════════════
   MY DARRIN — regulile platformei pe paginile publice (pasul 11-A, 17 oct. 2026)

   Sursa: /api/public/reguli-platforma (țările active, pragul minim de
   comandă, metodele de plată, confirmarea tacită, termenul de plată către
   partener, entitățile juridice). Niciun termen, nicio țară și nicio metodă
   de plată nu se mai scrie de mână în pagini.

   Marcaj:
     <span data-regula="confirmare-tacita"></span>      → „24 de ore” / „24 hours”
     <span data-regula="termen-plata-partener"></span>  → „6 zile” / „6 days”
     <span data-regula="metode-plata"></span>           → metodele active acum
     <span data-regula="tari"></span>                   → numele țărilor active
     <span data-regula="tari-coduri"></span>            → „AT · BG · …”
     <span data-regula="prag-minim" [data-tara="RO"]></span>
                                                        → pragul minim, în moneda țării
     <span data-regula="entitati"></span>               → entitățile juridice active
     <div data-regula="tari-steaguri"></div>            → steagurile din footer
     <p data-myd-copyright></p>                          → copyright-ul comun (decizie LM B6)
   Un element cu `data-regula-bloc` (de obicei cu `hidden`) se afișează doar
   după ce toate elementele data-regula din el au primit o valoare.

   Fără valori de rezervă: dacă API-ul nu răspunde sau o valoare lipsește,
   elementul rămâne gol (iar blocul lui, ascuns).

   Textele (RO + EN) sunt chei în i18n/ro.json și i18n/en.json (reguli.*,
   footer.*), citite prin window.t. Se redesenează la evenimentul myd:lang,
   după ce dicționarul limbii s-a încărcat.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_REGULI) return;

  var URL_REGULI = '/api/public/reguli-platforma';
  var reguli = null;

  function lang() {
    return (window.MYD_I18N && window.MYD_I18N.lang) || document.documentElement.lang || 'en';
  }
  function tr(cheie, ro, param) {
    if (typeof window.t === 'function') return window.t(cheie, ro, param);
    return String(ro).replace(/\{(\w+)\}/g, function (m, k) { return param && param[k] != null ? param[k] : m; });
  }

  // „24 de ore” / „6 zile” / „1 oră” în română; „24 hours” / „6 days” în engleză.
  function cuDe(n) { var r = n % 100; return n !== 0 && (r === 0 || r >= 20); }
  function durata(n, unitate) {
    if (n == null || !isFinite(n)) return '';
    var unu = n === 1;
    if (unitate === 'ore') {
      if (unu) return tr('reguli.ora_1', '{n} oră', { n: n });
      return cuDe(n) ? tr('reguli.ore_de', '{n} de ore', { n: n }) : tr('reguli.ore', '{n} ore', { n: n });
    }
    if (unu) return tr('reguli.zi_1', '{n} zi', { n: n });
    return cuDe(n) ? tr('reguli.zile_de', '{n} de zile', { n: n }) : tr('reguli.zile', '{n} zile', { n: n });
  }

  function numeTara(t) {
    try {
      var dn = new Intl.DisplayNames([lang() === 'ro' ? 'ro' : 'en'], { type: 'region' });
      return dn.of(t.tara_cod) || t.tara_cod;
    } catch (e) { return t.tara_cod; }
  }

  function metodaText(m) {
    if (m === 'card') return tr('reguli.metoda_card', 'card, prin procesatorul de plăți');
    if (m === 'ordin_plata' || m === 'transfer' || m === 'transfer_bancar') return tr('reguli.metoda_transfer', 'transfer bancar');
    return '';
  }
  function listaMetode(metode) {
    if (!metode || !metode.length) return '';
    var vazut = {};
    return metode.map(metodaText).filter(function (x) { if (!x || vazut[x]) return false; vazut[x] = 1; return true; }).join(', ');
  }

  function suma(v, moneda) {
    try { return Number(v).toLocaleString(lang() === 'ro' ? 'ro-RO' : 'en-GB', { maximumFractionDigits: 2 }) + ' ' + moneda; }
    catch (e) { return v + ' ' + moneda; }
  }

  function valoare(el) {
    if (!reguli) return '';
    var tip = el.getAttribute('data-regula');
    var tari = reguli.tari || [];
    switch (tip) {
      case 'confirmare-tacita': return durata(reguli.confirmare_tacita_ore, 'ore');
      case 'termen-plata-partener': return durata(reguli.termen_plata_partener_zile, 'zile');
      case 'metode-plata': return listaMetode(reguli.metode_plata);
      case 'tari': return tari.map(numeTara).join(', ');
      case 'tari-coduri': return tari.map(function (t) { return t.tara_cod; }).join(' · ');
      case 'entitati': return (reguli.entitati || []).map(function (e) { return e.denumire; }).join(' · ');
      case 'prag-minim': {
        var cod = (el.getAttribute('data-tara') || '').toUpperCase();
        var cuPrag = tari.filter(function (t) { return t.prag_minim_comanda != null && t.moneda && (!cod || t.tara_cod === cod); });
        if (cod) return cuPrag.length ? suma(cuPrag[0].prag_minim_comanda, cuPrag[0].moneda) : '';
        return cuPrag.map(function (t) { return suma(t.prag_minim_comanda, t.moneda) + ' (' + numeTara(t) + ')'; }).join('; ');
      }
      default: return '';
    }
  }

  // ── Steagurile țărilor active (footer) ────────────────────────────────
  // Doar câteva steaguri desenate; o țară fără desen apare doar cu codul.
  var STEAG = {
    RO: '<svg width="24" height="17" viewBox="0 0 3 2"><rect width="1" height="2" fill="#002B7F"/><rect x="1" width="1" height="2" fill="#FCD116"/><rect x="2" width="1" height="2" fill="#CE1126"/></svg>',
    MD: '<svg width="24" height="17" viewBox="0 0 3 2"><rect width="1" height="2" fill="#003DA5"/><rect x="1" width="1" height="2" fill="#FFD200"/><rect x="2" width="1" height="2" fill="#CC0001"/></svg>',
    DE: '<svg width="24" height="17" viewBox="0 0 5 3"><rect width="5" height="1" fill="#000"/><rect y="1" width="5" height="1" fill="#DD0000"/><rect y="2" width="5" height="1" fill="#FFCE00"/></svg>',
    FR: '<svg width="24" height="17" viewBox="0 0 3 2"><rect width="1" height="2" fill="#002395"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#ED2939"/></svg>',
    BG: '<svg width="24" height="17" viewBox="0 0 5 3"><rect width="5" height="1" fill="#fff"/><rect y="1" width="5" height="1" fill="#00966E"/><rect y="2" width="5" height="1" fill="#D62612"/></svg>',
    AT: '<svg width="24" height="17" viewBox="0 0 3 3"><rect width="3" height="1" fill="#ED2939"/><rect y="1" width="3" height="1" fill="#fff"/><rect y="2" width="3" height="1" fill="#ED2939"/></svg>',
    GR: '<svg width="24" height="17" viewBox="0 0 27 18"><rect width="27" height="18" fill="#0D5EAF"/><path d="M0 3h27M0 9h27M0 15h27" stroke="#fff" stroke-width="2"/><rect width="10" height="10" fill="#0D5EAF"/><path d="M5 0v10M0 5h10" stroke="#fff" stroke-width="2"/></svg>',
    GB: '<svg width="24" height="17" viewBox="0 0 60 30"><rect width="60" height="30" fill="#012169"/><path d="M0 0l60 30M60 0L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30M60 0L0 30" stroke="#C8102E" stroke-width="2"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></svg>',
  };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function deseneazaSteaguri(el) {
    var tari = (reguli && reguli.tari) || [];
    if (!tari.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<span style="font-size:10px;font-weight:600;color:#6B7A8D;margin-right:4px;text-transform:uppercase;letter-spacing:.06em">' + esc(tr('footer.activ_in', 'Activ în')) + '</span>' +
      tari.map(function (t) {
        var svg = STEAG[t.tara_cod] ? STEAG[t.tara_cod].replace('<svg ', '<svg style="border-radius:2px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.2)" ') : '';
        return '<span title="' + esc(numeTara(t)) + '" style="display:inline-flex;flex-direction:column;align-items:center;gap:2px;cursor:default">' + svg +
          '<span style="font-size:8px;color:#8C9BAD;font-weight:600">' + esc(t.tara_cod) + '</span></span>';
      }).join('');
  }

  function aplica(rad) {
    rad = rad || document;
    Array.prototype.forEach.call(rad.querySelectorAll('[data-myd-copyright]'), function (el) {
      el.textContent = tr('footer.copyright', '© 2026 Home Best Pal SRL (România) · Home Best Pal LTD (Marea Britanie)');
    });
    Array.prototype.forEach.call(rad.querySelectorAll('[data-regula]'), function (el) {
      if (el.getAttribute('data-regula') === 'tari-steaguri') { deseneazaSteaguri(el); return; }
      var v = valoare(el);
      if (el.textContent !== v) el.textContent = v;
    });
    Array.prototype.forEach.call(rad.querySelectorAll('[data-regula-bloc]'), function (bloc) {
      var interne = bloc.querySelectorAll('[data-regula]');
      var complet = interne.length > 0 && Array.prototype.every.call(interne, function (x) { return x.textContent.trim() !== ''; });
      if (complet) bloc.removeAttribute('hidden'); else bloc.setAttribute('hidden', '');
    });
  }

  var promisiune = null;
  function incarca() {
    if (!promisiune) {
      promisiune = fetch(URL_REGULI, { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { reguli = j && j.ok ? j : null; return reguli; })
        .catch(function () { reguli = null; return null; });
    }
    return promisiune;
  }

  window.MYD_REGULI = { incarca: incarca, aplica: aplica, reguli: function () { return reguli; } };

  function porneste() {
    aplica(); // copyright-ul imediat; valorile rămân goale până sosesc datele
    incarca().then(function () { aplica(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', porneste);
  else porneste();
  // Dicționarul limbii sosește asincron: textele compuse se refac după el.
  window.addEventListener('myd:lang', function () { aplica(); });
})();
