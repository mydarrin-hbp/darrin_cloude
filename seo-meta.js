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
//
// Se include PRIMUL în <head>, fără defer, ca suprascrierea să apară cât
// mai devreme posibil (înainte de restul scripturilor de pe pagină).

(function () {
  'use strict';

  var cale = window.location.pathname.replace(/\.html$/, '') || '/';
  // Normalizare: '/index' -> '/', altfel path-ul brut (deja fără .html)
  if (cale === '/index') cale = '/';

  fetch('/api/public/seo-config?path=' + encodeURIComponent(cale))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var cfg = d && d.config;
      if (!cfg) return;

      if (cfg.meta_title) {
        document.title = cfg.meta_title;
      }
      if (cfg.meta_description) {
        var descEl = document.querySelector('meta[name="description"]');
        if (!descEl) {
          descEl = document.createElement('meta');
          descEl.setAttribute('name', 'description');
          document.head.appendChild(descEl);
        }
        descEl.setAttribute('content', cfg.meta_description);
      }
      if (cfg.canonical_url) {
        var canEl = document.querySelector('link[rel="canonical"]');
        if (!canEl) {
          canEl = document.createElement('link');
          canEl.setAttribute('rel', 'canonical');
          document.head.appendChild(canEl);
        }
        canEl.setAttribute('href', cfg.canonical_url);
      }
    })
    .catch(function () {
      // Eșec de rețea/API — rămân title/description statice din fișier,
      // exact comportamentul dinainte ca acest script să existe.
    });
})();
