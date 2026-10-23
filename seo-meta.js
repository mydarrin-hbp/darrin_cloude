// seo-meta.js
// G22 — suprascriere opțională de title/meta description/canonical, citită
// live din seo_config (panoul „SEO" din mydarrin-superadmin.html), pentru
// pagini HTML statice fără randare pe server.
//
// Mecanism onest, nu o soluție perfectă: title/description STATICE, deja
// scrise în fiecare fișier, rămân fallback-ul real — orice crawler care nu
// execută JS (sau execută JS dar ratează fereastra de timp) vede în
// continuare textul static original, corect. Acest script doar suprascrie
// document.title/meta description DUPĂ ce răspunde API-ul, pentru
// crawlerele care randează JS (Googlebot modern) și pentru vizitatorii
// umani — util ca adminul să poată ajusta copy-ul de SEO fără un deploy
// de cod. Nu garantează că fiecare crawler vede varianta suprascrisă.
// Roboții de previzualizare (Facebook, LinkedIn, WhatsApp…) nu rulează JS:
// pentru ei, middleware.js scrie etichetele og: direct în HTML (pasul 11-S).
//
// Pasul 11-S (23 oct. 2026): suprascrierea e pe limbă. Limba curentă vine
// din <html lang> (setat de i18n-loader.js): 'ro' → RO, orice altă limbă →
// EN. Se reaplică la evenimentul `myd:lang` (schimbarea limbii din antet).

(function () {
  'use strict';

  var cale = window.location.pathname.replace(/\.html$/, '') || '/';
  // Normalizare: '/index' -> '/', altfel path-ul brut (deja fără .html)
  if (cale === '/index') cale = '/';

  function limbaCurenta(l) {
    var x = String(l || document.documentElement.lang || '').toLowerCase().slice(0, 2);
    if (!x) { try { x = String(localStorage.getItem('myd_lang_v1') || 'en').slice(0, 2); } catch (e) { x = 'en'; } }
    return x === 'ro' ? 'ro' : 'en';
  }

  // Valorile puse de acest script, ca la o limbă fără suprascriere să revină
  // textul static al paginii (sau traducerea lui).
  var puse = {};
  function seteaza(cheie, el, attr, valoare) {
    var actual = el ? el.getAttribute(attr) : document.title;
    if (valoare) {
      if (!puse[cheie]) puse[cheie] = { orig: actual };
      if (el) el.setAttribute(attr, valoare); else document.title = valoare;
      puse[cheie].pus = valoare;
    } else if (puse[cheie] && actual === puse[cheie].pus) {
      if (el) { if (puse[cheie].orig == null) el.removeAttribute(attr); else el.setAttribute(attr, puse[cheie].orig); }
      else document.title = puse[cheie].orig;
      delete puse[cheie];
    }
  }
  function element(selector, tag, attrs) {
    var el = document.querySelector(selector);
    if (!el) {
      el = document.createElement(tag);
      for (var k in attrs) el.setAttribute(k, attrs[k]);
      document.head.appendChild(el);
    }
    return el;
  }

  var cerereCurenta = 0;
  function aplica(l) {
    var limba = limbaCurenta(l);
    var nr = ++cerereCurenta;
    fetch('/api/public/seo-config?path=' + encodeURIComponent(cale) + '&lang=' + limba)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (nr !== cerereCurenta) return;
        var cfg = (d && d.config) || {};
        seteaza('title', null, null, cfg.meta_title);
        var desc = document.querySelector('meta[name="description"]');
        if (cfg.meta_description || desc) seteaza('description', desc || element('meta[name="description"]', 'meta', { name: 'description' }), 'content', cfg.meta_description);
        var can = document.querySelector('link[rel="canonical"]');
        if (cfg.canonical_url || can) seteaza('canonical', can || element('link[rel="canonical"]', 'link', { rel: 'canonical' }), 'href', cfg.canonical_url);
      })
      .catch(function () {
        // Eșec de rețea/API — rămân title/description statice din fișier,
        // exact comportamentul dinainte ca acest script să existe.
      });
  }

  aplica();
  window.addEventListener('myd:lang', function (e) { aplica(e && e.detail && e.detail.lang); });
})();
