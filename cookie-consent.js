// cookie-consent.js
// Banner real de consimțământ cookie-uri (GDPR) — exact cele 2 categorii
// deja descrise în mydarrin-politica-confidentialitate.html, Art. 7:
// „Cookie-uri esențiale" (fără consimțământ — sesiune autentificare,
// preferințe limbă/monedă) și „Cookie-uri analitice" (cu consimțământ).
// Politica promitea deja acest banner ("afișat la prima vizită") — nu
// exista, până acum. Zero dependențe externe.
//
// API public, pentru orice cod viitor de analytics (G23):
//   window.MYD_CONSENT.analyticsAllowed()  → bool
//   window.MYD_CONSENT.onChange(callback)  → apelat la fiecare schimbare
//   window.MYD_CONSENT.openPreferences()   → redeschide panoul

(function () {
  'use strict';

  var STORAGE_KEY = 'myd_cookie_consent_v1';
  var listeners = [];

  function citesteConsimtamant() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      return (d && typeof d.analitice === 'boolean') ? d : null;
    } catch (e) { return null; }
  }

  function salveazaConsimtamant(analitice) {
    var d = { analitice: !!analitice, data: new Date().toISOString(), versiune: 1 };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch (e) {}
    listeners.forEach(function (fn) { try { fn(d); } catch (e) {} });
    return d;
  }

  function analyticsAllowed() {
    var d = citesteConsimtamant();
    return !!(d && d.analitice);
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
      '#myd-consent-bar a{color:#fff;text-decoration:underline}' +
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
      'border-radius:16px 16px 0 0}' +
      '#myd-consent-panel h3{margin:0 0 12px;font-size:15px;font-weight:800}' +
      '.myd-consent-row{display:flex;align-items:flex-start;justify-content:space-between;' +
      'gap:12px;padding:12px 0;border-bottom:1px solid #EEF1F5}' +
      '.myd-consent-row:last-of-type{border-bottom:none}' +
      '.myd-consent-row strong{font-size:13px}' +
      '.myd-consent-row span{display:block;font-size:12px;color:#6B7A8D;margin-top:2px}' +
      '.myd-consent-toggle{position:relative;width:42px;height:24px;flex-shrink:0;' +
      'border-radius:12px;background:#D5DFE8;cursor:pointer;border:none;padding:0}' +
      '.myd-consent-toggle.on{background:#FF8C00}' +
      '.myd-consent-toggle::after{content:"";position:absolute;top:3px;left:3px;' +
      'width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}' +
      '.myd-consent-toggle.on::after{left:21px}' +
      '.myd-consent-toggle.locked{opacity:.6;cursor:default}' +
      '#myd-consent-panel-actions{display:flex;gap:8px;margin-top:16px}' +
      '@media (max-width:640px){#myd-consent-bar{flex-direction:column;' +
      'align-items:stretch;text-align:left}#myd-consent-actions{justify-content:stretch}' +
      '.myd-consent-btn{flex:1}}';
    document.head.appendChild(s);
  }

  function inchideBanner() {
    if (elBanner) { elBanner.remove(); elBanner = null; }
  }
  function inchidePanou() {
    if (elPanou) { elPanou.remove(); elPanou = null; }
  }

  function afiseazaBanner() {
    if (elBanner || citesteConsimtamant()) return;
    stiluri();
    elBanner = document.createElement('div');
    elBanner.id = 'myd-consent-bar';
    elBanner.setAttribute('role', 'region');
    elBanner.setAttribute('aria-label', 'Consimțământ cookie-uri');
    elBanner.innerHTML =
      '<p>Folosim cookie-uri esențiale (autentificare, limbă, monedă) pentru ca platforma să funcționeze. ' +
      'Cu acordul tău, folosim și cookie-uri analitice, ca să înțelegem cum e folosită platforma și să o îmbunătățim. ' +
      'Detalii în <a href="mydarrin-politica-confidentialitate.html#art7">Politica de confidențialitate</a>.</p>' +
      '<div id="myd-consent-actions">' +
      '<button type="button" class="myd-consent-btn myd-consent-btn-secondary" data-myd-act="doar-esentiale">Doar esențiale</button>' +
      '<button type="button" class="myd-consent-btn myd-consent-btn-secondary" data-myd-act="personalizeaza">Personalizează</button>' +
      '<button type="button" class="myd-consent-btn myd-consent-btn-primary" data-myd-act="accepta-toate">Acceptă toate</button>' +
      '</div>';
    document.body.appendChild(elBanner);
    elBanner.addEventListener('click', function (e) {
      var act = e.target && e.target.getAttribute && e.target.getAttribute('data-myd-act');
      if (act === 'accepta-toate') { salveazaConsimtamant(true); inchideBanner(); }
      else if (act === 'doar-esentiale') { salveazaConsimtamant(false); inchideBanner(); }
      else if (act === 'personalizeaza') { inchideBanner(); afiseazaPanou(); }
    });
  }

  function afiseazaPanou() {
    stiluri();
    inchidePanou();
    var actual = citesteConsimtamant();
    var analiticeOn = actual ? actual.analitice : false;
    elPanou = document.createElement('div');
    elPanou.id = 'myd-consent-panel';
    elPanou.setAttribute('role', 'dialog');
    elPanou.setAttribute('aria-label', 'Preferințe cookie-uri');
    elPanou.innerHTML =
      '<h3>Preferințe cookie-uri</h3>' +
      '<div class="myd-consent-row">' +
      '<div><strong>Cookie-uri esențiale</strong><span>Autentificare, limbă, monedă — necesare pentru funcționarea platformei.</span></div>' +
      '<button type="button" class="myd-consent-toggle on locked" disabled aria-label="Mereu active"></button>' +
      '</div>' +
      '<div class="myd-consent-row">' +
      '<div><strong>Cookie-uri analitice</strong><span>Statistici anonimizate de navigare, pentru îmbunătățirea platformei.</span></div>' +
      '<button type="button" id="myd-consent-toggle-analitice" class="myd-consent-toggle' + (analiticeOn ? ' on' : '') + '" aria-pressed="' + analiticeOn + '"></button>' +
      '</div>' +
      '<div id="myd-consent-panel-actions">' +
      '<button type="button" class="myd-consent-btn myd-consent-btn-secondary" data-myd-act="renunta">Renunță</button>' +
      '<button type="button" class="myd-consent-btn myd-consent-btn-primary" data-myd-act="salveaza">Salvează preferințele</button>' +
      '</div>';
    document.body.appendChild(elPanou);

    var toggle = elPanou.querySelector('#myd-consent-toggle-analitice');
    var stareLocala = analiticeOn;
    toggle.addEventListener('click', function () {
      stareLocala = !stareLocala;
      toggle.classList.toggle('on', stareLocala);
      toggle.setAttribute('aria-pressed', String(stareLocala));
    });
    elPanou.addEventListener('click', function (e) {
      var act = e.target && e.target.getAttribute && e.target.getAttribute('data-myd-act');
      if (act === 'salveaza') { salveazaConsimtamant(stareLocala); inchidePanou(); }
      else if (act === 'renunta') { inchidePanou(); if (!citesteConsimtamant()) afiseazaBanner(); }
    });
  }

  window.MYD_CONSENT = {
    analyticsAllowed: analyticsAllowed,
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    openPreferences: function () { inchideBanner(); afiseazaPanou(); },
  };

  function start() { afiseazaBanner(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
