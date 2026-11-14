// cookie-consent.js
// Bannerul de consimțământ pentru cookie-uri (GDPR). Zero dependențe externe.
//
// Categoriile (pasul 11-A3, macheta aprobată de LM pe 13 nov. 2026):
//   esențiale  — mereu active (cont, coș, securitate, limbă);
//   analitice  — Google Analytics 4 (analytics-loader.js), doar cu acord;
//   marketing  — pixelii Meta / TikTok / LinkedIn (masurare.js), doar cu acord;
//                oprit implicit; pornește doar la „Acceptă toate” sau din panou.
//
// Acordul se păstrează în localStorage „myd_cookie_consent_v1”:
//   { analitice: bool, marketing: bool, data: ISO, versiune: 2 }
// Cine are versiune: 1 (fără „marketing”) vede bannerul din nou, până alege o
// dată; până atunci, analiticele rămân cum le-a ales, iar marketingul e oprit.
//
// Textele sunt în română și engleză (limba paginii, ca ui-feedback.js);
// bannerul are data-i18n-skip, ca i18n-loader.js să nu-l retraducă pe bucăți.
//
// Linkul „Setări cookie-uri” din subsol: orice element [data-myd-cookie-setari]
// redeschide panoul. Paginile fără subsol primesc un rând discret la final.
//
// API public:
//   window.MYD_CONSENT.analyticsAllowed()  → bool
//   window.MYD_CONSENT.marketingAllowed()  → bool
//   window.MYD_CONSENT.onChange(callback)  → apelat la fiecare alegere salvată
//   window.MYD_CONSENT.openPreferences()   → redeschide panoul

(function () {
  'use strict';

  var STORAGE_KEY = 'myd_cookie_consent_v1';
  var VERSIUNE = 2;
  // Eticheta „NOU” pe categoria Marketing: 60 de zile de la publicare (13 nov. 2026).
  var NOU_PANA_LA = Date.UTC(2027, 0, 12);
  var POLITICA = '/mydarrin-politica-confidentialitate.html#art7';
  var listeners = [];

  var TEXTE = {
    ro: {
      eticheta: 'Consimțământ cookie-uri',
      bara: 'Folosim cookie-uri esențiale ca platforma să funcționeze. Cu acordul tău, folosim și cookie-uri <strong>analitice</strong> (cum e folosită platforma) și de <strong>marketing</strong> (cât de utile sunt reclamele noastre pe Facebook, Instagram, TikTok și LinkedIn).',
      baraScurt: 'Folosim cookie-uri esențiale ca platforma să funcționeze. Cu acordul tău, folosim și cookie-uri <strong>analitice</strong> și de <strong>marketing</strong>.',
      politica: 'Politica de confidențialitate',
      doarEsentiale: 'Doar esențiale',
      personalizeaza: 'Personalizează',
      acceptaToate: 'Acceptă toate',
      titlu: 'Setări cookie-uri',
      intro: 'Alegi ce cookie-uri permiți. Poți schimba oricând din subsolul paginii.',
      esentiale: 'Esențiale',
      esentialeText: 'Necesare pentru cont, coș și securitate. Mereu active.',
      mereuActive: 'Mereu active',
      analitice: 'Analitice',
      analiticeText: 'Statistici anonime de navigare (Google Analytics), ca să îmbunătățim platforma.',
      marketing: 'Marketing',
      marketingText: 'Ne arată ce reclame (Facebook, Instagram, TikTok, LinkedIn) te-au adus aici și ne ajută să le arătăm celor interesați. Nu trimitem numele, emailul sau telefonul tău.',
      nou: 'NOU',
      salveaza: 'Salvează alegerea',
      linkSubsol: 'Setări cookie-uri',
    },
    en: {
      eticheta: 'Cookie consent',
      bara: 'We use essential cookies to make the platform work. With your consent, we also use <strong>analytics</strong> cookies (how the platform is used) and <strong>marketing</strong> cookies (how useful our ads on Facebook, Instagram, TikTok and LinkedIn are).',
      baraScurt: 'We use essential cookies to make the platform work. With your consent, we also use <strong>analytics</strong> and <strong>marketing</strong> cookies.',
      politica: 'Privacy policy',
      doarEsentiale: 'Essential only',
      personalizeaza: 'Customise',
      acceptaToate: 'Accept all',
      titlu: 'Cookie settings',
      intro: 'Choose which cookies you allow. You can change this any time from the page footer.',
      esentiale: 'Essential',
      esentialeText: 'Needed for your account, cart and security. Always on.',
      mereuActive: 'Always on',
      analitice: 'Analytics',
      analiticeText: 'Anonymous browsing statistics (Google Analytics), to improve the platform.',
      marketing: 'Marketing',
      marketingText: 'Shows which ads (Facebook, Instagram, TikTok, LinkedIn) brought you here and helps us show them to interested people. We never send your name, email or phone.',
      nou: 'NEW',
      salveaza: 'Save my choice',
      linkSubsol: 'Cookie settings',
    },
  };

  // Limba paginii: RO doar unde pagina e în română; altfel engleza (implicită).
  function limba() {
    var l = (window.MYD_I18N && window.MYD_I18N.lang) || document.documentElement.lang || '';
    if (!l) { try { l = localStorage.getItem('myd_lang_v1') || ''; } catch (e) {} }
    return String(l || 'en').slice(0, 2).toLowerCase() === 'ro' ? 'ro' : 'en';
  }
  function T() { return TEXTE[limba()]; }

  // ── acordul ─────────────────────────────────────────────────────────
  function citesteConsimtamant() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      return (d && typeof d.analitice === 'boolean') ? d : null;
    } catch (e) { return null; }
  }
  function esteActual(d) { return !!(d && Number(d.versiune) >= VERSIUNE); }

  function salveazaConsimtamant(analitice, marketing) {
    var d = { analitice: !!analitice, marketing: !!marketing, data: new Date().toISOString(), versiune: VERSIUNE };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch (e) {}
    listeners.forEach(function (fn) { try { fn(d); } catch (e) {} });
    return d;
  }

  function analyticsAllowed() {
    var d = citesteConsimtamant();
    return !!(d && d.analitice);
  }
  // Doar acordul nou (versiunea 2) poate porni marketingul.
  function marketingAllowed() {
    var d = citesteConsimtamant();
    return !!(esteActual(d) && d.marketing === true);
  }

  // ── UI ──────────────────────────────────────────────────────────────
  var elBanner = null;
  var elPanou = null;

  function stiluri() {
    if (document.getElementById('myd-consent-style')) return;
    var s = document.createElement('style');
    s.id = 'myd-consent-style';
    s.textContent =
      '#myd-consent-bar{position:fixed;left:0;right:0;bottom:0;z-index:9998;' +
      'background:#1A2332;color:#fff;padding:16px 20px;font-family:inherit;' +
      'box-shadow:0 -4px 24px rgba(0,0,0,.25);display:flex;gap:16px;' +
      'align-items:center;flex-wrap:wrap}' +
      '#myd-consent-bar p{margin:0;font-size:13px;line-height:1.6;flex:1 1 320px;' +
      'color:rgba(255,255,255,.85)}' +
      '#myd-consent-bar strong{color:#fff}' +
      '#myd-consent-bar a{color:#fff;text-decoration:underline}' +
      '.myd-consent-scurt{display:none}' +
      '#myd-consent-actions{display:flex;gap:8px;flex-wrap:wrap}' +
      '.myd-consent-btn{border:none;border-radius:10px;padding:10px 16px;' +
      'font-size:12.5px;font-weight:700;font-family:inherit;cursor:pointer;' +
      'white-space:nowrap}' +
      '.myd-consent-btn-primary{background:#FF8C00;color:#fff}' +
      '.myd-consent-btn-secondary{background:transparent;color:#fff;' +
      'border:1.5px solid rgba(255,255,255,.35)}' +
      '#myd-consent-panel{position:fixed;left:0;right:0;bottom:0;z-index:9999;' +
      'background:#fff;color:#1A2332;padding:22px 20px;font-family:inherit;' +
      'box-shadow:0 -4px 24px rgba(0,0,0,.25);max-width:520px;margin:0 auto;' +
      'border-radius:16px 16px 0 0;max-height:90vh;overflow-y:auto;box-sizing:border-box}' +
      '#myd-consent-panel h3{margin:0 0 6px;font-size:15px;font-weight:800}' +
      '#myd-consent-panel .myd-consent-intro{margin:0 0 6px;font-size:12.5px;line-height:1.5;color:#6B7A8D}' +
      '.myd-consent-row{display:flex;align-items:flex-start;justify-content:space-between;' +
      'gap:12px;padding:12px 0;border-bottom:1px solid #EEF1F5}' +
      '.myd-consent-row:last-of-type{border-bottom:none}' +
      '.myd-consent-row strong{font-size:13px}' +
      '.myd-consent-row span{display:block;font-size:12px;color:#6B7A8D;margin-top:2px}' +
      '.myd-consent-row span.myd-consent-nou{display:inline-block;margin:0 0 0 6px;padding:1px 7px;' +
      'border-radius:8px;background:#FFF1E0;color:#B35F00;font-size:10px;font-weight:800;' +
      'letter-spacing:.04em;vertical-align:1px}' +
      '.myd-consent-toggle{position:relative;width:42px;height:24px;flex-shrink:0;' +
      'border-radius:12px;background:#D5DFE8;cursor:pointer;border:none;padding:0}' +
      '.myd-consent-toggle.on{background:#FF8C00}' +
      '.myd-consent-toggle::after{content:"";position:absolute;top:3px;left:3px;' +
      'width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}' +
      '.myd-consent-toggle.on::after{left:21px}' +
      '.myd-consent-toggle.locked{opacity:.6;cursor:default}' +
      '#myd-consent-panel-actions{display:flex;gap:8px;margin-top:16px}' +
      '#myd-consent-panel .myd-consent-btn-secondary{color:#1A2332;border-color:#D5DFE8}' +
      '.myd-cookie-setari-rand{text-align:center;padding:14px 16px 18px;font-size:12px}' +
      '.myd-cookie-setari-rand a{color:#6B7A8D;text-decoration:underline}' +
      // Pe telefon: text scurt, butoanele pe verticală (Acceptă toate sus),
      // de 44px, mereu vizibile; doar textul se derulează, dacă e nevoie.
      '@media (max-width:640px){#myd-consent-bar{flex-direction:column;' +
      'align-items:stretch;text-align:left;gap:10px;padding:12px 16px;max-height:50vh}' +
      '#myd-consent-bar p{flex:0 1 auto;min-height:0;overflow-y:auto;font-size:12px;line-height:1.5}' +
      '.myd-consent-lung{display:none}.myd-consent-scurt{display:inline}' +
      '#myd-consent-actions{flex-direction:column-reverse;flex-wrap:nowrap;flex-shrink:0}' +
      '.myd-consent-btn{min-height:44px;padding:8px 6px;white-space:normal}' +
      '#myd-consent-panel-actions .myd-consent-btn{flex:1}}';
    document.head.appendChild(s);
  }

  function actiune(e) {
    var el = e.target && e.target.closest && e.target.closest('[data-myd-act]');
    return el ? el.getAttribute('data-myd-act') : null;
  }

  function inchideBanner() {
    if (elBanner) { elBanner.remove(); elBanner = null; }
  }
  function inchidePanou() {
    if (elPanou) { elPanou.remove(); elPanou = null; }
    document.removeEventListener('keydown', laEscape);
  }
  function laEscape(e) {
    if (e.key !== 'Escape' || !elPanou) return;
    inchidePanou();
    if (!esteActual(citesteConsimtamant())) afiseazaBanner();
  }

  function afiseazaBanner() {
    if (elBanner || esteActual(citesteConsimtamant())) return;
    stiluri();
    var t = T();
    var link = ' <a href="' + POLITICA + '">' + t.politica + '</a>';
    elBanner = document.createElement('div');
    elBanner.id = 'myd-consent-bar';
    elBanner.setAttribute('role', 'region');
    elBanner.setAttribute('aria-label', t.eticheta);
    elBanner.setAttribute('data-i18n-skip', '');
    elBanner.setAttribute('lang', limba());
    elBanner.innerHTML =
      '<p><span class="myd-consent-lung">' + t.bara + '</span>' +
      '<span class="myd-consent-scurt">' + t.baraScurt + '</span>' + link + '</p>' +
      '<div id="myd-consent-actions">' +
      '<button type="button" class="myd-consent-btn myd-consent-btn-secondary" data-myd-act="doar-esentiale">' + t.doarEsentiale + '</button>' +
      '<button type="button" class="myd-consent-btn myd-consent-btn-secondary" data-myd-act="personalizeaza">' + t.personalizeaza + '</button>' +
      '<button type="button" class="myd-consent-btn myd-consent-btn-primary" data-myd-act="accepta-toate">' + t.acceptaToate + '</button>' +
      '</div>';
    document.body.appendChild(elBanner);
    elBanner.addEventListener('click', function (e) {
      var act = actiune(e);
      if (act === 'accepta-toate') { inchideBanner(); salveazaConsimtamant(true, true); }
      else if (act === 'doar-esentiale') { inchideBanner(); salveazaConsimtamant(false, false); }
      else if (act === 'personalizeaza') { inchideBanner(); afiseazaPanou(); }
    });
  }

  function comutator(id, on, eticheta) {
    return '<button type="button" id="' + id + '" class="myd-consent-toggle' + (on ? ' on' : '') +
      '" role="switch" aria-checked="' + on + '" aria-label="' + eticheta + '"></button>';
  }

  function afiseazaPanou() {
    stiluri();
    inchidePanou();
    var t = T();
    var actual = citesteConsimtamant();
    var stare = {
      analitice: actual ? !!actual.analitice : false,
      marketing: esteActual(actual) ? actual.marketing === true : false,
    };
    var nou = Date.now() < NOU_PANA_LA ? '<span class="myd-consent-nou">' + t.nou + '</span>' : '';
    elPanou = document.createElement('div');
    elPanou.id = 'myd-consent-panel';
    elPanou.setAttribute('role', 'dialog');
    elPanou.setAttribute('aria-labelledby', 'myd-consent-titlu');
    elPanou.setAttribute('data-i18n-skip', '');
    elPanou.setAttribute('lang', limba());
    elPanou.innerHTML =
      '<h3 id="myd-consent-titlu">' + t.titlu + '</h3>' +
      '<p class="myd-consent-intro">' + t.intro + '</p>' +
      '<div class="myd-consent-row">' +
      '<div><strong>' + t.esentiale + '</strong><span>' + t.esentialeText + '</span></div>' +
      '<button type="button" class="myd-consent-toggle on locked" role="switch" aria-checked="true" disabled aria-label="' + t.esentiale + ' — ' + t.mereuActive + '"></button>' +
      '</div>' +
      '<div class="myd-consent-row">' +
      '<div><strong>' + t.analitice + '</strong><span>' + t.analiticeText + '</span></div>' +
      comutator('myd-consent-toggle-analitice', stare.analitice, t.analitice) +
      '</div>' +
      '<div class="myd-consent-row">' +
      '<div><strong>' + t.marketing + '</strong>' + nou + '<span>' + t.marketingText + '</span></div>' +
      comutator('myd-consent-toggle-marketing', stare.marketing, t.marketing) +
      '</div>' +
      '<div id="myd-consent-panel-actions">' +
      '<button type="button" class="myd-consent-btn myd-consent-btn-secondary" data-myd-act="salveaza">' + t.salveaza + '</button>' +
      '<button type="button" class="myd-consent-btn myd-consent-btn-primary" data-myd-act="accepta-toate">' + t.acceptaToate + '</button>' +
      '</div>';
    document.body.appendChild(elPanou);

    ['analitice', 'marketing'].forEach(function (cat) {
      var el = elPanou.querySelector('#myd-consent-toggle-' + cat);
      el.addEventListener('click', function () {
        stare[cat] = !stare[cat];
        el.classList.toggle('on', stare[cat]);
        el.setAttribute('aria-checked', String(stare[cat]));
      });
    });
    elPanou.addEventListener('click', function (e) {
      var act = actiune(e);
      if (act === 'salveaza') { inchidePanou(); salveazaConsimtamant(stare.analitice, stare.marketing); }
      else if (act === 'accepta-toate') { inchidePanou(); salveazaConsimtamant(true, true); }
    });
    document.addEventListener('keydown', laEscape);
    var primul = elPanou.querySelector('#myd-consent-toggle-analitice');
    if (primul) try { primul.focus({ preventScroll: true }); } catch (e) {}
  }

  function deschidePreferinte() { inchideBanner(); afiseazaPanou(); }

  // ── linkul „Setări cookie-uri” din subsol ───────────────────────────
  function ascultaLinkuri() {
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest && e.target.closest('[data-myd-cookie-setari]');
      if (!el) return;
      e.preventDefault();
      deschidePreferinte();
    });
  }
  // Paginile fără subsol comun (panouri de cont, coș, wizard): un rând discret la final.
  function asiguraLinkSubsol() {
    if (document.querySelector('[data-myd-cookie-setari]')) return;
    stiluri();
    var rand = document.createElement('div');
    rand.className = 'myd-cookie-setari-rand';
    rand.setAttribute('data-i18n-skip', '');
    rand.innerHTML = '<a href="#" data-myd-cookie-setari>' + T().linkSubsol + '</a>';
    document.body.appendChild(rand);
  }

  window.MYD_CONSENT = {
    analyticsAllowed: analyticsAllowed,
    marketingAllowed: marketingAllowed,
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    openPreferences: deschidePreferinte,
  };

  function start() {
    ascultaLinkuri();
    asiguraLinkSubsol();
    afiseazaBanner();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
