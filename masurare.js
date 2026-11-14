/* ════════════════════════════════════════════════════════════════
   MY DARRIN — masurare.js (MYD_MASURARE), pasul 11-A1 (13 nov. 2026)

   Măsurarea campaniilor și a pâlniei „Devino partener”, fără date personale.

   1. Sursa campaniei (UTM): utm_source, utm_medium, utm_campaign,
      utm_content, utm_term, fbclid, ttclid, li_fat_id din adresa paginii.
      Se păstrează local (localStorage „myd_utm_v1”) 30 de zile, DOAR cu
      acordul pentru cookie-uri analitice (window.MYD_CONSENT, cookie-consent.js).
      Se păstrează prima sursă (prima vizită din campanie); după 30 de zile,
      următoarea. La retragerea acordului, sursa se șterge.
   2. Evenimentele (nume stabile, în engleză; lista din EVENIMENTE):
      se trimit la GA4 (gtag, încărcat de analytics-loader.js doar cu acord)
      și, cu acord de marketing, la pixelii rețelelor. Fiecare eveniment
      primește sursa păstrată. Fără acord: nu se trimite și nu se păstrează nimic.
      Parametrii trec printr-o listă de chei permise; orice valoare care
      seamănă cu un email, un telefon sau un CUI e eliminată.
   3. Pixelii Meta / TikTok / LinkedIn (pasul 11-A3): se încarcă doar cu acord
      de marketing (MYD_CONSENT.marketingAllowed(), categoria „Marketing” din
      cookie-consent.js) și doar pentru ID-urile setate în Vercel
      (/api/public/config-masurare). Niciun ID în cod. Fără advanced matching:
      pixelii primesc doar numele evenimentului și o categorie (ex. „courier”).
      Evenimentele de dinaintea încărcării pixelilor așteaptă într-o coadă.
      La retragerea acordului, pixelii se opresc pe loc (fbq consent revoke,
      ttq.revokeConsent, fără alte trimiteri), cookie-urile lor din domeniul
      nostru se șterg, iar la pagina următoare scripturile nu se mai încarcă.

   Evenimente trimise automat de acest fișier:
     partner_landing_view  — paginile „Devino partener” / „Cum devii…”, cu tipul;
     partner_cta_click     — clic pe orice buton [data-cta-partener], cu locul;
     service_view          — pagina de produs (serviciu, material, închiriere);
     checkout_started      — pagina de finalizare a comenzii;
     zone_unavailable_view — când apare fereastra #zone-unavailable.
   Celelalte vin din codul paginilor, prin MYD_MASURARE.eveniment(nume, parametri):
     account_created (account-system.js), partner_step_completed și
     partner_activation_completed (account-system.js, activare-pasi.js),
     add_to_cart (cos-indicator.js), order_created (checkout),
     darrin_ai_used (creeaza-deviz).

   API: window.MYD_MASURARE = { eveniment, sursa, sursaPentruCont, rol, jurnal, ... }
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_MASURARE) return;

  var CHEIE_UTM = 'myd_utm_v1';
  var DURATA_UTM = 30 * 24 * 60 * 60 * 1000;
  var PARAMETRI_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'ttclid', 'li_fat_id'];
  var ID_CLIC = { fbclid: 1, ttclid: 1, li_fat_id: 1 };

  var EVENIMENTE = {
    partner_landing_view: 1, partner_cta_click: 1, account_created: 1,
    partner_step_completed: 1, partner_activation_completed: 1, zone_unavailable_view: 1,
    service_view: 1, add_to_cart: 1, checkout_started: 1, order_created: 1, darrin_ai_used: 1,
  };
  // Doar aceste chei pot pleca într-un eveniment (plus sursa și limba).
  var CHEI_PERMISE = {
    partner_type: 1, position: 1, role: 1, step: 1, item_type: 1, item_category: 1,
    item_slug: 1, order_type: 1, page: 1,
  };

  // Tipul de partener, din valorile interne → valori stabile, în engleză.
  var TIP_EN = {
    servicii: 'services', materiale: 'materials', inchirieri: 'rentals', curier: 'courier',
    asigurari: 'insurance', asigurator: 'insurance',
  };
  var ROL_EN = {
    client: 'client', investitor: 'investor', investor: 'investor',
    partener_servicii: 'partner_services', partener_materiale: 'partner_materials',
    partener_inchirieri: 'partner_rentals', partener_curier: 'partner_courier',
    partener_asigurari: 'partner_insurance',
  };
  var PAS_EN = {
    firma: 'company_details', cont_bancar: 'bank_account', profesii: 'trades',
    dotari: 'equipment', documente: 'documents', contract: 'contract',
  };
  var ARTICOL_EN = { serviciu: 'service', servicii: 'service', material: 'material', materiale: 'material', inchiriere: 'rental', inchirieri: 'rental' };

  // Paginile „Devino partener” / „Cum devii…” → tipul (null = din ?type=).
  var PAGINI_PARTENER = {
    '/partener': 'general', '/cum-devii-partenerul-nostru': 'general',
    '/intrebari-frecvente-parteneri': 'general',
    '/cum-devii-furnizor-servicii': 'services', '/cum-devii-furnizor-materiale': 'materials',
    '/cum-devii-operator-inchirieri': 'rentals',
    '/cum-devii-curier-de-cartier': 'courier', '/curier-cartier': 'courier',
    '/ghidul-asiguratorului': 'insurance', '/asigurator': 'insurance',
    '/mydarrin-devino-partener-wizard': null,
  };

  var jurnal = [];       // ce s-a trimis (pentru teste și depanare), fără date personale
  var coadaGa = [];      // evenimente cu acord, înainte ca gtag să fie gata
  var dinUrl = null;     // sursa din adresa paginii, ținută doar în memorie până la acord
  var paginaTrimisa = false;
  var inPagina = false;          // în evenimentePagina()
  var paginaPentruPixeli = [];   // evenimentele paginii, păstrate pentru pixeli până la acordul de marketing

  // ── acord ─────────────────────────────────────────────────────────
  function acordAnaliza() {
    try { return !!(window.MYD_CONSENT && window.MYD_CONSENT.analyticsAllowed()); } catch (e) { return false; }
  }
  function acordMarketing() {
    try {
      return !!(window.MYD_CONSENT && typeof window.MYD_CONSENT.marketingAllowed === 'function' &&
        window.MYD_CONSENT.marketingAllowed());
    } catch (e) { return false; }
  }

  // ── valori curate, fără date personale ────────────────────────────
  var RE_EMAIL = /@|%40/;
  var RE_TELEFON = /\+?\d[\d\s().\-\/]{6,}\d/;
  var RE_CUI = /^\s*(ro)?\s*\d{2,10}\s*$/i;
  var RE_ID_CLIC = /^[A-Za-z0-9_\-.]{1,200}$/;

  function curat(v, cheie) {
    if (v === null || v === undefined || typeof v === 'object' || typeof v === 'function') return null;
    var s = String(v).trim();
    if (!s) return null;
    if (ID_CLIC[cheie]) return RE_ID_CLIC.test(s) ? s : null;
    if (RE_EMAIL.test(s) || RE_TELEFON.test(s) || RE_CUI.test(s)) return null;
    return s.slice(0, 100);
  }

  function citesteUrl() {
    var rez = {};
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return null; }
    PARAMETRI_UTM.forEach(function (k) {
      var v = curat(q.get(k), k);
      if (v !== null) rez[k] = v;
    });
    return Object.keys(rez).length ? rez : null;
  }

  // ── sursa păstrată (doar cu acord) ────────────────────────────────
  function citesteSalvat() {
    try {
      var raw = localStorage.getItem(CHEIE_UTM);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || typeof d.v !== 'object' || !d.expira || Date.now() > d.expira) {
        localStorage.removeItem(CHEIE_UTM);
        return null;
      }
      return d;
    } catch (e) { return null; }
  }

  function aplicaAcord() {
    if (!acordAnaliza()) {
      try { localStorage.removeItem(CHEIE_UTM); } catch (e) {}
      return;
    }
    if (dinUrl && !citesteSalvat()) {
      var acum = Date.now();
      try {
        localStorage.setItem(CHEIE_UTM, JSON.stringify({
          v: dinUrl, salvat_la: new Date(acum).toISOString(), expira: acum + DURATA_UTM,
        }));
      } catch (e) {}
    }
  }

  /** Sursa curentă (doar cu acord): valorile păstrate sau, dacă stocarea e blocată, cele din adresă. */
  function sursa() {
    if (!acordAnaliza()) return {};
    var d = citesteSalvat();
    var v = (d && d.v) || dinUrl || {};
    var rez = {};
    PARAMETRI_UTM.forEach(function (k) { var x = curat(v[k], k); if (x !== null) rez[k] = x; });
    return rez;
  }

  /** Pentru metadatele contului nou (profiles.sursa_utm): null fără acord sau fără sursă. */
  function sursaPentruCont() {
    var s = sursa();
    if (!Object.keys(s).length) return null;
    var d = citesteSalvat();
    if (d && d.salvat_la) s.salvat_la = d.salvat_la;
    return s;
  }

  function limba() {
    try { return (window.MYD_I18N && window.MYD_I18N.lang) || localStorage.getItem('myd_lang_v1') || 'en'; } catch (e) { return 'en'; }
  }

  // ── trimitere ─────────────────────────────────────────────────────
  function golesteCoadaGa() {
    if (typeof window.gtag !== 'function' || !acordAnaliza()) return;
    while (coadaGa.length) {
      var x = coadaGa.shift();
      try { window.gtag('event', x.nume, x.p); } catch (e) {}
    }
  }

  /**
   * Trimite un eveniment al pâlniei. Fără acord: nimic (nici în coadă).
   * @param {string} nume  unul din EVENIMENTE
   * @param {object} [parametri]  doar cheile din CHEI_PERMISE
   * @returns {boolean} true dacă evenimentul a plecat (sau așteaptă gtag)
   */
  function eveniment(nume, parametri) {
    var ga = acordAnaliza(), mk = acordMarketing();
    if (!EVENIMENTE[nume] || (!ga && !mk)) return false;
    var p = {};
    var src = parametri || {};
    Object.keys(src).forEach(function (k) {
      if (!CHEI_PERMISE[k]) return;
      var v = curat(src[k], k);
      if (v !== null) p[k] = v;
    });
    var s = sursa();
    Object.keys(s).forEach(function (k) { p[k] = s[k]; });
    p.language = limba() === 'ro' ? 'ro' : 'en';
    jurnal.push({ nume: nume, parametri: p });
    if (ga) {
      coadaGa.push({ nume: nume, p: p });
      golesteCoadaGa();
    }
    if (mk) trimitePixeli(nume, p);
    else if (inPagina) paginaPentruPixeli.push({ nume: nume, p: p });
    return true;
  }

  // ── pixelii rețelelor (doar cu acordul de marketing) ──────────────
  var META = {
    partner_landing_view: ['track', 'ViewContent'], service_view: ['track', 'ViewContent'],
    account_created: ['track', 'CompleteRegistration'],
    partner_activation_completed: ['track', 'SubmitApplication'],
    add_to_cart: ['track', 'AddToCart'], checkout_started: ['track', 'InitiateCheckout'],
    partner_cta_click: ['trackCustom', 'PartnerCtaClick'],
    partner_step_completed: ['trackCustom', 'PartnerStepCompleted'],
    zone_unavailable_view: ['trackCustom', 'ZoneUnavailableView'],
    order_created: ['trackCustom', 'OrderCreated'], darrin_ai_used: ['trackCustom', 'DarrinAiUsed'],
  };
  var TIKTOK = {
    partner_landing_view: 'ViewContent', service_view: 'ViewContent',
    account_created: 'CompleteRegistration', partner_activation_completed: 'SubmitForm',
    partner_cta_click: 'ClickButton', add_to_cart: 'AddToCart',
    checkout_started: 'InitiateCheckout', order_created: 'PlaceAnOrder',
  };
  // cerut: configurația a fost cerută; gata: răspunsul a sosit; retras: acordul retras pe pagină.
  var pixeli = { cerut: false, gata: false, retras: false, meta: false, tiktok: false, linkedin: false };
  var coadaPixeli = [];
  var idPixeli = {};

  function adaugaScript(src) {
    var s = document.createElement('script');
    s.async = true;
    s.src = src;
    (document.head || document.documentElement).appendChild(s);
  }

  function pornesteMeta(id) {
    if (window.fbq) return;
    var f = window.fbq = function () { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); };
    if (!window._fbq) window._fbq = f;
    f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
    adaugaScript('https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', id);
    window.fbq('track', 'PageView');
    pixeli.meta = true;
  }

  function pornesteTiktok(id) {
    if (window.ttq) return;
    var t = window.ttq = [];
    t.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
    t.setAndDefer = function (o, m) { o[m] = function () { o.push([m].concat(Array.prototype.slice.call(arguments, 0))); }; };
    for (var i = 0; i < t.methods.length; i++) t.setAndDefer(t, t.methods[i]);
    adaugaScript('https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=' + encodeURIComponent(id) + '&lib=ttq');
    t.page();
    pixeli.tiktok = true;
  }

  function pornesteLinkedin(id) {
    if (window._linkedin_partner_id) return;
    window._linkedin_partner_id = id;
    window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
    window._linkedin_data_partner_ids.push(id);
    adaugaScript('https://snap.licdn.com/li.lms-analytics/insight.min.js');
    pixeli.linkedin = true;
  }

  function pornestePixeli() {
    if (!acordMarketing()) return;
    var ids = idPixeli;
    if (/^\d{6,20}$/.test(ids.meta || '')) pornesteMeta(ids.meta);
    if (/^[A-Z0-9]{10,30}$/.test(ids.tiktok || '')) pornesteTiktok(ids.tiktok);
    if (/^\d{3,12}$/.test(ids.linkedin || '')) pornesteLinkedin(ids.linkedin);
    while (coadaPixeli.length) { var x = coadaPixeli.shift(); trimitePixeli(x.nume, x.p); }
  }

  function incarcaPixeli() {
    if (!acordMarketing()) return;
    if (pixeli.retras) { reiaPixeli(); return; }
    if (pixeli.cerut || typeof fetch !== 'function') return;
    pixeli.cerut = true;
    // Evenimentele paginii trimise înainte de acordul de marketing (doar la GA4) ajung și la pixeli.
    while (paginaPentruPixeli.length) coadaPixeli.push(paginaPentruPixeli.shift());
    fetch('/api/public/config-masurare', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        idPixeli = (d && d.pixeli) || {};
        pixeli.gata = true;
        pornestePixeli();
      })
      .catch(function () { pixeli.gata = true; coadaPixeli.length = 0; });
  }

  // Cookie-urile pixelilor din domeniul nostru (cele din domeniile rețelelor
  // nu pot fi șterse de pagină). Numele, după documentația fiecărui furnizor.
  var COOKIE_PIXELI = /^(_fbp|_fbc|_ttp|ttclid|ttcsid(_.*)?|_tt_enable_cookie|li_fat_id|li_giant|li_sugr|lms_analytics|AnalyticsSyncHistory|UserMatchHistory)$/;
  function stergeCookiePixeli() {
    var nume = [];
    try {
      document.cookie.split(';').forEach(function (c) {
        var n = c.split('=')[0].trim();
        if (n && COOKIE_PIXELI.test(n)) nume.push(n);
      });
    } catch (e) { return []; }
    var parti = location.hostname.split('.');
    var domenii = [''];
    for (var i = 0; i < parti.length - 1; i++) domenii.push('; domain=.' + parti.slice(i).join('.'));
    nume.forEach(function (n) {
      domenii.forEach(function (d) {
        try { document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + d; } catch (e) {}
      });
    });
    return nume;
  }

  // Retragerea acordului: nicio trimitere de acum încolo, pe această pagină.
  function oprestePixeli() {
    stergeCookiePixeli();
    if (!pixeli.cerut) return;
    pixeli.retras = true;
    coadaPixeli.length = 0;
    try { if (pixeli.meta && window.fbq) window.fbq('consent', 'revoke'); } catch (e) {}
    try { if (pixeli.tiktok && window.ttq && window.ttq.revokeConsent) window.ttq.revokeConsent(); } catch (e) {}
    // LinkedIn nu are o funcție de retragere: nu mai primește nimic de la noi,
    // iar la pagina următoare scriptul nu se mai încarcă.
    // Pixelii pot scrie cookie-uri și după retragere (cereri în curs): a doua ștergere.
    setTimeout(stergeCookiePixeli, 1500);
  }

  // Acordul dat din nou, pe aceeași pagină.
  function reiaPixeli() {
    pixeli.retras = false;
    try { if (pixeli.meta && window.fbq) window.fbq('consent', 'grant'); } catch (e) {}
    try { if (pixeli.tiktok && window.ttq && window.ttq.grantConsent) window.ttq.grantConsent(); } catch (e) {}
    if (pixeli.gata) pornestePixeli();
  }

  // Pixelii primesc doar numele evenimentului și o categorie: fără sursă,
  // fără email / telefon / nume (fără advanced matching).
  function trimitePixeli(nume, p) {
    if (!acordMarketing() || pixeli.retras) return;
    if (!pixeli.gata) { coadaPixeli.push({ nume: nume, p: p }); return; }
    var categorie = p.partner_type || p.item_type || p.role || p.step || undefined;
    var date = categorie ? { content_category: categorie } : {};
    try {
      if (pixeli.meta && window.fbq && META[nume]) window.fbq(META[nume][0], META[nume][1], date);
      if (pixeli.tiktok && window.ttq && TIKTOK[nume]) window.ttq.track(TIKTOK[nume], date);
      // LinkedIn: conversiile se definesc în Campaign Manager, după adresa paginii.
    } catch (e) {}
  }

  // ── evenimentele paginii ──────────────────────────────────────────
  function cale() {
    var c = location.pathname.replace(/\.html$/, '').replace(/\/+$/, '');
    return c || '/';
  }

  function tipDinQuery() {
    try {
      var t = new URLSearchParams(location.search).get('type');
      return (t && TIP_EN[t]) || 'general';
    } catch (e) { return 'general'; }
  }

  function evenimentePagina() {
    if (paginaTrimisa || !(acordAnaliza() || acordMarketing())) return;
    paginaTrimisa = true;
    inPagina = true;
    var c = cale();
    if (Object.prototype.hasOwnProperty.call(PAGINI_PARTENER, c)) {
      eveniment('partner_landing_view', { partner_type: PAGINI_PARTENER[c] || tipDinQuery(), page: c });
    }
    var produs = c === '/mydarrin-produs' || /^\/catalog\/[^/]+\/[^/]+\/[^/]+$/.test(c);
    if (produs) {
      var q = new URLSearchParams(location.search);
      var bucati = c.split('/');
      var tip = q.get('type') || (bucati.length === 5 ? bucati[2] : '');
      eveniment('service_view', {
        item_type: ARTICOL_EN[tip] || tip || 'service',
        item_category: q.get('cat') || (bucati.length === 5 ? bucati[3] : undefined),
        item_slug: q.get('slug') || (bucati.length === 5 ? bucati[4] : undefined),
      });
    }
    if (c === '/mydarrin-checkout' || c === '/cos') eveniment('checkout_started', { page: c });
    inPagina = false;
  }

  // Locul butonului din pagină: data-cta-loc, altfel din structura paginii.
  function locButon(el) {
    var loc = el.getAttribute('data-cta-loc');
    if (loc) return loc;
    if (el.hasAttribute('data-cta-scurt')) return 'menu';
    if (el.hasAttribute('data-cta-card')) return 'type_card';
    if (el.closest('header, nav')) return 'header';
    if (el.closest('footer')) return 'footer';
    var sectiune = el.closest('section[id], [data-sectiune]');
    if (sectiune) return (sectiune.getAttribute('data-sectiune') || sectiune.id).slice(0, 60);
    var toate = document.querySelectorAll('[data-cta-partener]');
    for (var i = 0; i < toate.length; i++) if (toate[i] === el) return 'cta_' + (i + 1);
    return 'page';
  }

  function ascultaClicuri() {
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest && e.target.closest('[data-cta-partener]');
      if (!el) return;
      var tip = el.getAttribute('data-cta-partener');
      var tipPagina = PAGINI_PARTENER[cale()];
      eveniment('partner_cta_click', {
        partner_type: (tip && TIP_EN[tip]) || tipPagina || tipDinQuery(),
        position: locButon(el),
        page: cale(),
      });
    }, true);
  }

  // „Nu suntem încă în zona ta”: fereastra comună #zone-unavailable (o dată pe pagină).
  function urmaresteZona() {
    var el = document.getElementById('zone-unavailable');
    if (!el || typeof MutationObserver === 'undefined') return;
    var trimis = false;
    function verifica() {
      if (trimis || el.classList.contains('hidden') || el.hidden) return;
      trimis = true;
      eveniment('zone_unavailable_view', { page: cale() });
    }
    new MutationObserver(verifica).observe(el, { attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    verifica();
  }

  function laSchimbareAcord() {
    if (!acordMarketing()) oprestePixeli();
    aplicaAcord();
    golesteCoadaGa();
    evenimentePagina();
    incarcaPixeli();
  }

  function start() {
    dinUrl = citesteUrl();
    aplicaAcord();
    ascultaClicuri();
    urmaresteZona();
    if (window.MYD_CONSENT && window.MYD_CONSENT.onChange) window.MYD_CONSENT.onChange(laSchimbareAcord);
    evenimentePagina();
    incarcaPixeli();
    // gtag e definit de analytics-loader.js la DOMContentLoaded.
    setTimeout(golesteCoadaGa, 0);
  }

  window.MYD_MASURARE = {
    eveniment: eveniment,
    sursa: sursa,
    sursaPentruCont: sursaPentruCont,
    rol: function (r) { return ROL_EN[r] || (r ? 'other' : 'client'); },
    pas: function (p) { return PAS_EN[p] || null; },
    tip: function (t) { return TIP_EN[t] || null; },
    jurnal: jurnal,
    pixeli: pixeli,
    stergeCookiePixeli: stergeCookiePixeli,
    EVENIMENTE: Object.keys(EVENIMENTE),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
