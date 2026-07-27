// analytics-loader.js
// Încarcă Google Analytics 4 (gtag.js) — DOAR dacă utilizatorul a acceptat
// cookie-uri analitice prin bannerul real de consimțământ (window.MYD_CONSENT,
// din cookie-consent.js — G21). G23 e condiționat explicit de G21: fără el,
// acest fișier nu face nimic, nici măcar o cerere de rețea.
//
// Reacționează live la schimbări de consimțământ (MYD_CONSENT.onChange) —
// dacă utilizatorul acceptă analytics DUPĂ încărcarea paginii (din banner),
// GA4 pornește imediat, fără reload. Dacă retrage consimțământul în aceeași
// sesiune, folosește semnalul oficial Google de dezactivare
// (window['ga-disable-<ID>']) — GA4 nu are un "unload", dar acest flag oprește
// trimiterea oricăror hit-uri ulterioare din scriptul deja încărcat.
//
// ID-ul de măsurare vine din window.__ENV__.GA4_MEASUREMENT_ID (același
// tipar ca SUPABASE_URL/SUPABASE_ANON_KEY în lib/supabaseClient.js).

(function () {
  'use strict';

  var GA4_ID = (window.__ENV__ && window.__ENV__.GA4_MEASUREMENT_ID) || null;
  var scriptIncarcat = false;

  function incarcaGA4() {
    if (scriptIncarcat || !GA4_ID) return;
    scriptIncarcat = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA4_ID);

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA4_ID);
    document.head.appendChild(s);
  }

  function aplicaStareaConsimtamant() {
    if (!GA4_ID) return;
    var permis = !!(window.MYD_CONSENT && window.MYD_CONSENT.analyticsAllowed());
    window['ga-disable-' + GA4_ID] = !permis;
    if (permis) incarcaGA4();
  }

  function start() {
    // Fără cookie-consent.js (G21) inclus pe pagină, nu putem verifica real
    // consimțământul — nu încărcăm nimic, nu presupunem nimic.
    if (!window.MYD_CONSENT) return;
    aplicaStareaConsimtamant();
    window.MYD_CONSENT.onChange(aplicaStareaConsimtamant);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
