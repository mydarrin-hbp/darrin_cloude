/* ════════════════════════════════════════════════════════════════
   MY DARRIN — i18n Loader (pilot, 25 Iulie 2026)
   Traduce elementele marcate cu data-i18n / data-i18n-html /
   data-i18n-attr, pe baza limbii alese manual (persistă în
   localStorage) sau detectate automat din geolocalizare (myd-geo.js
   sau echivalentul inline din index.html — ambele emit evenimentul
   window 'myd:geo' cu detail.lang, folosit aici ca sursă unică).

   Limba sursă (fără fișier de traducere) e RO — HTML-ul e deja scris
   în română, deci setLanguage('ro') doar restaurează starea inițială.

   SCOP PILOT: doar homepage (index.html), 4 limbi (en/de/fr/tr).
   Extindere ulterioară: mai multe limbi/pagini, fără schimbări la
   acest fișier — doar adaugi chei noi în JSON-uri și data-i18n în HTML.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LANG_KEY = 'myd_lang_v1';
  var SUPPORTED = ['en', 'de', 'fr', 'tr', 'bg', 'el']; // 1 septembrie 2026: bg/el adăugate explicit, cerere fondator (geolocalizare BG/GR). Lista completă (UE+UA+RS+ZH) se adaugă pe măsură ce se traduc paginile

  function getSavedLang() {
    try { return localStorage.getItem(LANG_KEY); } catch (e) { return null; }
  }
  function saveLang(lang) {
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
  }

  function applyTranslations(dict) {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (dict[key] != null) el.textContent = dict[key];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (dict[key] != null) el.innerHTML = dict[key];
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      // format: "attribut:cheie", ex. "placeholder:home.hero.search_placeholder"
      var spec = (el.getAttribute('data-i18n-attr') || '').split(':');
      var attr = spec[0], key = spec[1];
      if (attr && key && dict[key] != null) el.setAttribute(attr, dict[key]);
    });
  }

  function setLanguage(lang, opts) {
    opts = opts || {};
    lang = (lang || 'ro').toLowerCase();

    if (lang === 'ro') {
      document.documentElement.lang = 'ro';
      if (opts.persist) saveLang('ro');
      _updateSwitcherUI('ro');
      try { window.dispatchEvent(new CustomEvent('myd:lang', { detail: { lang: 'ro' } })); } catch (e) {}
      return;
    }

    // FIX (audit Secțiunea 36, 29 Iulie 2026): o limbă cerută/detectată care
    // nu e (încă) tradusă cădea aici pe română — greșit pentru un vizitator
    // internațional dintr-o țară nededicată încă (ex. maghiară/poloneză/
    // greacă — mapate real în myd-geo.js, dar fără fișier JSON de tradus).
    // Engleza e presupunerea sigură pentru cine nu vorbește română, nu piața
    // de bază RO — cerință explicită de business, nu doar o preferință.
    if (SUPPORTED.indexOf(lang) === -1) lang = 'en';

    fetch('/i18n/' + lang + '.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('status ' + r.status); return r.json(); })
      .then(function (dict) {
        applyTranslations(dict);
        document.documentElement.lang = lang;
        if (opts.persist) saveLang(lang);
        _updateSwitcherUI(lang);
        try { window.dispatchEvent(new CustomEvent('myd:lang', { detail: { lang: lang } })); } catch (e) {}
      })
      .catch(function (err) {
        console.warn('[i18n] nu am putut încărca traducerea pentru "' + lang + '":', err);
      });
  }

  function _updateSwitcherUI(lang) {
    var sel = document.getElementById('lang-switcher');
    if (sel && sel.value !== lang) sel.value = lang;
  }

  window.MYD_I18N = { setLanguage: setLanguage, SUPPORTED: SUPPORTED };

  function init() {
    var saved = getSavedLang();
    if (saved) { setLanguage(saved); return; }
    // Fără preferință manuală salvată — folosim limba din geolocalizare,
    // dar NU o persistăm (dacă userul se mută, limba se re-detectează;
    // doar alegerea manuală explicită se ține minte).
    window.addEventListener('myd:geo', function (e) {
      var lang = e && e.detail && e.detail.lang;
      if (lang) setLanguage(lang);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
