/* ════════════════════════════════════════════════════════════════
   MY DARRIN — cont-fereastra.js (MDCont), pasul 11-R2 (1 nov. 2026)

   O singură fereastră de cont pentru toate paginile publice, pentru client
   și partener (decizia LM, 1 nov. 2026). Înlocuiește cele 14 copii ale
   #auth-modal (4 variante) și funcțiile lor locale.

   Ecranele:
     „Intră în cont”: email, parolă (cu ochiul), „Ai uitat parola?”.
     „Creare cont”:
       1. rolul — Client · Furnizor de servicii · Furnizor de materiale ·
          Furnizor de închirieri · Curier de cartier · Asigurător; deschisă
          din „Devino partener” (sau cu ?type= pe pagina partenerului),
          rolul vine deja ales și doar se confirmă;
       2. datele — prenume, nume, email, parolă, telefon (format
          internațional), bifa GDPR, toate obligatorii;
       3. codul de 6 cifre din email, cu „Retrimite codul”.
   Telefonul se salvează neverificat (profiles.phone, phone_verificat =
   false, prin handle_new_user()); codul pe telefon vine în pasul 11-R6.
   Rolul ales merge în profiles.rol_solicitat: e doar o alegere, accesul îl
   decide serverul din profiles.roles.

   Butoanele Google / Facebook / Apple apar doar pentru furnizorii din
   OAUTH_PROVIDERS_ACTIVI (account-system.js); lista e goală până la 11-R4.

   După cod și după login, destinația o decide serverul
   (api/public/destinatie-post-login.js). Pasul 11-R3 (2 nov. 2026):
   partenerul ajunge în dashboard-ul lui (lista „Activează contul”), clientul
   fără comenzi în catalog; din coș sau din checkout utilizatorul revine acolo
   (myd_revenire_dupa_login), ca să nu piardă coșul. „Contul a fost creat”
   apare pe pagina de destinație.

   Ecranul rolului (varianta A, aprobată de LM pe 2 nov. 2026): două carduri
   alăturate, Client și Partener; sub ele, doar cu „Partener” ales, grila de
   2 coloane cu cele 5 tipuri. Iconițe Lucide de 16 px, cercuri de 16 px,
   butoane de cel puțin 44 px.

   Folosește account-system.js (Supabase Auth) și ui-feedback.js
   (MDFeedback); le încarcă singur dacă pagina nu le are. Textele trec prin
   window.t (RO + EN, i18n/en.json).

   Interfață:
     toggleAuthModal(), switchAuthTab('login' | 'register' | 'verify-cod')
     MDCont.deschide({ tab, rol, mesaj }), MDCont.inchide(), MDCont.deschisa()
     MDCont.deschidePentruRol(rol)  — doar fără sesiune (pagina partenerului)
     MDCont.deschide({ tab: 'register', partener: true })  — „Partener” ales, grila deschisă
     MDCont.deschide({ tab: 'register', tip })  — pasul 11-R3g: tipul de partener bifat
       (servicii, materiale, inchirieri, curier, asigurator / asigurari); se poate schimba
     MDCont.alegeTipPartener({ rol })  — pasul 11-R3b: contul conectat, fără rol de
       partener, alege tipul; alegerea se salvează (/api/cont/rol-solicitat) și
       duce în dashboard-ul tipului, în modul activare
     MDCont.rolDinTip('servicii' | … | 'asigurator')
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MDCont) return;

  var SCRIPT = document.currentScript;
  // Coșul și checkout-ul: după login sau cod, utilizatorul revine aici.
  var REVINO_AICI = (!!SCRIPT && SCRIPT.getAttribute('data-dupa-login') === 'ramai') ||
    /\/mydarrin-(checkout|cos)(\.html)?$/.test(location.pathname);
  var CHEIE_REVENIRE = 'myd_revenire_dupa_login';
  var CHEIE_EMAIL = 'myd_pending_confirm_email';
  var CHEIE_REDIRECT = 'myd_post_auth_redirect';
  var CHEIE_MESAJ_PAGINA = 'myd_mesaj_pagina';

  // Iconițele, din setul Lucide (același ca pe site), desenate inline: fereastra
  // nu depinde de încărcarea scriptului Lucide pe pagină.
  var ICONE = {
    client: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    partener: '<rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    servicii: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    materiale: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    inchirieri: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    curier: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    asigurari: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  };
  function icona(nume) {
    return '<svg class="mdc-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONE[nume] || '') + '</svg>';
  }

  // Primul ecran: Client sau Partener; pentru Partener, unul dintre cele 5 tipuri.
  var CLIENT = { rol: 'client', ico: 'client', titlu: 'Client', text: 'Comand servicii', nume: 'Client' };
  var PARTENER = { ico: 'partener', titlu: 'Partener', text: 'Lucrez prin My Darrin' };
  var TIPURI = [
    { rol: 'partener_servicii', ico: 'servicii', titlu: 'Servicii', nume: 'Furnizor de servicii' },
    { rol: 'partener_materiale', ico: 'materiale', titlu: 'Materiale', nume: 'Furnizor de materiale' },
    { rol: 'partener_inchirieri', ico: 'inchirieri', titlu: 'Închirieri', nume: 'Furnizor de închirieri' },
    { rol: 'partener_curier', ico: 'curier', titlu: 'Curier de cartier', nume: 'Curier de cartier' },
    { rol: 'partener_asigurari', ico: 'asigurari', titlu: 'Asigurător', nume: 'Asigurător' },
  ];
  var ROLURI = [CLIENT].concat(TIPURI);
  // ?type= din „Devino partener” → rolul; „asigurator” = „asigurari”.
  var TIP_ROL = {
    servicii: 'partener_servicii', materiale: 'partener_materiale', inchirieri: 'partener_inchirieri',
    curier: 'partener_curier', asigurari: 'partener_asigurari', asigurator: 'partener_asigurari',
  };
  var NUME_FURNIZOR = { google: 'Google', facebook: 'Facebook', apple: 'Apple' };

  function tr(ro, param) {
    if (typeof window.t === 'function') return window.t(null, ro, param);
    return param ? String(ro).replace(/\{(\w+)\}/g, function (m, k) { return param[k] != null ? param[k] : m; }) : ro;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} return null; }
  function $(id) { return document.getElementById(id); }
  function rolDinTip(tip) { return TIP_ROL[String(tip || '').toLowerCase()] || null; }
  function rolValid(rol) { return ROLURI.some(function (r) { return r.rol === rol; }); }
  function definitieRol(rol) { for (var i = 0; i < ROLURI.length; i++) if (ROLURI[i].rol === rol) return ROLURI[i]; return null; }
  // Pasul 11-R3g: hub-ul „Devino partener” (vechea adresă mydarrin-devino-partener
  // e redirecționată 301 spre el, cu ?type= păstrat) și paginile de tip.
  function pePaginaPartener() { return /\/(mydarrin-devino-partener|cum-devii-partenerul-nostru|cum-devii-furnizor-servicii|cum-devii-furnizor-materiale|cum-devii-operator-inchirieri|cum-devii-curier-de-cartier|ghidul-asiguratorului)(\.html)?$/.test(location.pathname); }

  // ── Dependențele: ui-feedback.js, account-system.js, lib/supabaseClient.js ──
  function areScript(nume) { return !!document.querySelector('script[src$="' + nume + '"]'); }
  function adaugaScript(src, modul) {
    var s = document.createElement('script');
    s.src = src;
    if (modul) s.type = 'module';
    (document.head || document.documentElement).appendChild(s);
  }
  function asteapta(conditie, ms) {
    return new Promise(function (ok) {
      var pana = Date.now() + ms;
      (function verifica() {
        if (conditie()) return ok(true);
        if (Date.now() > pana) return ok(false);
        setTimeout(verifica, 80);
      })();
    });
  }
  function areFeedback() { return !!window.MDFeedback; }
  function areAuth() { return !!(window.MyDarrinAuth && typeof window.MyDarrinAuth.performRegister === 'function' && window.supabaseClient); }

  function asiguraFeedback() {
    if (!areFeedback() && !areScript('ui-feedback.js')) adaugaScript('/ui-feedback.js');
    return asteapta(areFeedback, 8000);
  }
  var promAuth = null;
  function asiguraAuth() {
    if (areAuth()) return Promise.resolve(true);
    if (promAuth) return promAuth;
    if (!(window.MyDarrinAuth && window.MyDarrinAuth.performRegister) && !areScript('account-system.js')) adaugaScript('/account-system.js');
    if (!window.supabaseClient && !areScript('supabaseClient.js')) adaugaScript('/lib/supabaseClient.js', true);
    promAuth = asteapta(areAuth, 10000).then(function (ok) {
      promAuth = null;
      if (!ok) {
        var e = new Error(tr('Contul nu poate fi accesat acum: conexiunea cu serverul nu s-a putut face. Încearcă din nou peste câteva momente.'));
        e.reincercabil = true;
        throw e;
      }
      actualizeazaSociale();
      return true;
    });
    return promAuth;
  }

  // ── Mesajele de la Supabase Auth, explicate în română / engleză ──
  function mesajAuth(e) {
    var cod = String((e && (e.code || e.error_code)) || '').toLowerCase();
    var m = String((e && e.message) || '').toLowerCase();
    if (cod === 'invalid_credentials' || /invalid login credentials/.test(m)) return tr('Emailul sau parola nu sunt corecte. Verifică-le și încearcă din nou.');
    if (cod === 'email_not_confirmed' || /email not confirmed/.test(m)) return tr('Emailul nu e confirmat încă. Introdu codul de 6 cifre primit pe email.');
    if (cod === 'otp_expired' || /token has expired|expired|invalid.*(token|otp)|otp.*invalid/.test(m)) return tr('Codul e greșit sau a expirat. Verifică cele 6 cifre sau cere un cod nou cu „Retrimite codul”.');
    if (cod === 'weak_password' || /password should be|password.*(short|weak)/.test(m)) return tr('Parola e prea slabă: folosește cel puțin 8 caractere, cu litere și cifre.');
    if (/rate limit|over_email_send_rate_limit|for security purposes|too many/.test(cod + ' ' + m)) return tr('Ai cerut prea multe coduri într-un timp scurt. Așteaptă un minut și încearcă din nou.');
    if (cod === 'email_address_invalid' || /invalid format|email address.*invalid/.test(m)) return tr('Adresa de email nu e validă.');
    if (cod === 'signup_disabled' || /signups not allowed/.test(m)) return tr('Crearea conturilor noi e oprită temporar. Încearcă mai târziu.');
    if (/failed to fetch|network|load failed/.test(m)) return tr('Nu există conexiune cu serverul. Verifică internetul și încearcă din nou.');
    return tr('Nu am putut finaliza. Încearcă din nou.') + (e && e.message ? ' (' + e.message + ')' : '');
  }
  function eroareCampuri(campuri, text) {
    var e = new Error(text || tr('Verifică câmpurile marcate.'));
    e.campuri = campuri;
    return e;
  }

  // ── Validări (aceleași reguli ca handle_new_user()) ──
  var RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function telefonNormalizat(v) {
    var t = String(v || '').replace(/[\s\-.()]/g, '');
    if (/^00/.test(t)) t = '+' + t.slice(2);
    return t;
  }
  function telefonValid(t) { return /^\+[1-9][0-9]{7,14}$/.test(t); }

  // ── Stilul: aspectul ferestrei de azi (Tailwind), fără să depindă de Tailwind ──
  var FONT_TITLU = "'Helvetica World','Helvetica Neue',Arial,sans-serif";
  function stil() {
    if ($('mdc-stil')) return;
    var st = document.createElement('style');
    st.id = 'mdc-stil';
    st.textContent =
      '#auth-modal{position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}' +
      '#auth-modal.hidden{display:none!important}' +
      // Unele pagini limitează pe telefon orice [id$="-modal"] la 95vw / 95vh:
      // fereastra ocupă tot ecranul, iar cutia păstrează marginile de 16 px.
      'html body #auth-modal[data-mdc]{max-width:none!important;max-height:none!important;width:auto!important;height:auto!important}' +
      '#auth-modal *{box-sizing:border-box}' +
      '.mdc-fundal{position:absolute;inset:0;background:rgba(0,0,0,.45);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}' +
      '.mdc-cutie{position:relative;z-index:1;background:#fff;border-radius:24px;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);width:100%;max-width:448px;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;font-family:inherit;color:#2D2D2D;text-align:left}' +
      '.mdc-x{position:absolute;top:20px;right:20px;z-index:2;padding:6px;border-radius:8px;border:0;background:none;color:#9CA3AF;cursor:pointer;line-height:0}' +
      '.mdc-x:hover{background:#F3F4F6}' +
      '.mdc-taburi{display:flex;border-bottom:1px solid #F3F4F6;padding:28px 56px 0 28px}' +
      '.mdc-tab{flex:1;padding:0 4px 12px;font-size:14px;font-weight:700;color:#9CA3AF;border:0;border-bottom:2px solid transparent;background:none;cursor:pointer;font-family:inherit;transition:color .15s,border-color .15s}' +
      '.mdc-tab.activ{color:#003366;border-bottom-color:#003366}' +
      '.mdc-mesaj-persistent{margin:16px 28px 0;padding:12px 14px;background:#E0F5F4;border:1px solid #0E9E99;border-radius:12px;font-size:12.5px;color:#065455;line-height:1.5}' +
      '.mdc-panou{padding:28px}' +
      '.mdc-panou[hidden]{display:none}' +
      '.mdc-h{font-family:' + FONT_TITLU + ';font-weight:700;font-size:20px;color:#2D2D2D;margin:0 0 4px;line-height:1.3}' +
      '.mdc-sub{color:#9CA3AF;font-size:14px;margin:0 0 20px;line-height:1.45}' +
      '.mdc-sub b{color:#2D2D2D;font-weight:600;overflow-wrap:anywhere}' +
      '.mdc-sociale{display:flex;gap:8px;margin-bottom:16px}' +
      '.mdc-social{flex:1;display:flex;align-items:center;justify-content:center;border:1px solid #E5E7EB;border-radius:12px;padding:10px 0;background:#fff;cursor:pointer}' +
      '.mdc-social:hover{background:#F9FAFB}' +
      '.mdc-sep{display:flex;align-items:center;gap:12px;margin-bottom:16px}' +
      '.mdc-sep i{flex:1;height:1px;background:#F3F4F6}' +
      '.mdc-sep span{font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.025em}' +
      '.mdc-campuri>*+*{margin-top:12px}' +
      '.mdc-campuri{margin-bottom:16px}' +
      '.mdc-rand{display:flex;gap:12px}.mdc-rand>*{flex:1;min-width:0}' +
      '.mdc-in{display:block;width:100%;border:1px solid #E5E7EB;border-radius:12px;padding:12px 16px;font-size:14px;font-family:inherit;color:#2D2D2D;background:#fff;transition:border-color .15s;-webkit-appearance:none;appearance:none}' +
      '.mdc-in:focus{outline:none;border-color:#003366}' +
      '.mdc-in::placeholder{color:#9CA3AF}' +
      '.mdc-parola{position:relative}.mdc-parola .mdc-in{padding-right:44px}' +
      '.mdc-ochi{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:none;color:#9CA3AF;cursor:pointer;padding:6px;line-height:0;border-radius:8px}' +
      '.mdc-ochi:hover{color:#4B5563}' +
      '.mdc-ajutor{font-size:11.5px;color:#9CA3AF;margin-top:4px;line-height:1.4}' +
      '.mdc-link{border:0;background:none;padding:0;font-size:12px;color:#003366;cursor:pointer;font-family:inherit;text-align:left}' +
      '.mdc-link:hover{text-decoration:underline}' +
      '.mdc-link-portocaliu{color:#FF8C00;font-weight:600}.mdc-link-albastru{font-weight:600}' +
      '.mdc-btn{display:block;width:100%;border:0;border-radius:12px;padding:14px;font-weight:700;font-size:14px;color:#fff;cursor:pointer;font-family:inherit;transition:background .15s}' +
      '.mdc-btn[disabled]{cursor:default;opacity:.92}' +
      '.mdc-btn-albastru{background:#003366}.mdc-btn-albastru:hover{background:#002855}' +
      '.mdc-btn-portocaliu{background:#FF8C00}.mdc-btn-portocaliu:hover{background:#CC7000}' +
      '.mdc-jos{font-size:12px;color:#9CA3AF;text-align:center;margin:16px 0 0}' +
      '.mdc-gdpr{display:flex;align-items:flex-start;gap:10px;margin-bottom:20px;cursor:pointer}' +
      '.mdc-gdpr input{margin-top:2px;width:16px;height:16px;flex:0 0 auto;accent-color:#FF8C00}' +
      '.mdc-gdpr span{font-size:12px;color:#9CA3AF;line-height:1.6}' +
      '.mdc-gdpr a{color:#003366;text-decoration:none}.mdc-gdpr a:hover{text-decoration:underline}' +
      '.mdc-cat{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin:0 0 16px;padding:0;border:0;min-width:0}' +
      '.mdc-card{position:relative;display:flex;align-items:flex-start;gap:10px;border:1.5px solid #E5E7EB;border-radius:12px;padding:12px;cursor:pointer;min-height:64px;background:#fff;transition:border-color .15s,background .15s}' +
      '.mdc-card:hover,.mdc-tip:hover{border-color:#B9C7D6}' +
      '.mdc-card.ales,.mdc-tip.ales{border-color:#FF8C00;background:#FFF7EB}' +
      '.mdc-card:focus-within{box-shadow:0 0 0 2px rgba(255,140,0,.35)}' +
      '.mdc-card input{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none;min-width:0!important;min-height:0!important}' +
      // Unele pagini dau tuturor radio-urilor 44 × 44 px (ținte de atingere): aici
      // ținta e tot butonul (≥ 44 px), iar cercul rămâne de 16 px.
      '#auth-modal .mdc-tip input{width:16px!important;height:16px!important;min-width:0!important;min-height:0!important;padding:0!important;border:1.5px solid #9CA3AF!important;box-shadow:none!important;outline-color:#FF8C00}' +
      '#auth-modal .mdc-tip input:checked{border-color:#FF8C00!important}' +
      '.mdc-ico{flex:0 0 auto;width:16px;height:16px;color:#5A6B7D}' +
      '.mdc-card .mdc-ico{margin-top:2px}' +
      '.mdc-card.ales .mdc-ico,.mdc-tip.ales .mdc-ico{color:#FF8C00}' +
      '.mdc-card-txt{min-width:0}' +
      '.mdc-card-txt b{display:block;font-size:14px;font-weight:700;color:#2D2D2D;line-height:1.3}' +
      '.mdc-card-txt small{display:block;font-size:12px;color:#5A6B7D;line-height:1.35;margin-top:2px}' +
      '.mdc-tipuri{margin:0 0 16px;padding:0;border:0;min-width:0}' +
      '.mdc-tipuri[hidden]{display:none}' +
      '.mdc-eticheta{display:block;float:left;width:100%;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5A6B7D;margin:0 0 8px;padding:0}' +
      '.mdc-grila{clear:both;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}' +
      '.mdc-tip{min-width:0;display:flex;align-items:center;gap:8px;border:1.5px solid #E5E7EB;border-radius:10px;padding:8px 10px;min-height:44px;cursor:pointer;background:#fff;transition:border-color .15s,background .15s}' +
      '.mdc-tip span{flex:1;min-width:0;font-size:13px;font-weight:600;color:#2D2D2D;line-height:1.25}' +
      '.mdc-tip input{-webkit-appearance:none;appearance:none;flex:0 0 16px;width:16px;height:16px;margin:0;border:1.5px solid #9CA3AF;border-radius:50%;background:#fff;display:grid;place-content:center;cursor:pointer}' +
      '.mdc-tip input::before{content:"";width:8px;height:8px;border-radius:50%;background:#FF8C00;transform:scale(0);transition:transform .12s}' +
      '.mdc-tip input:checked{border-color:#FF8C00}.mdc-tip input:checked::before{transform:scale(1)}' +
      '.mdc-tip input:focus-visible{outline:2px solid #FF8C00;outline-offset:2px}' +
      '.mdc-rol-ales{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:0 0 16px;padding:8px 12px;border-radius:12px;background:#EBF4FB;font-size:12.5px;color:#003366;font-weight:600}' +
      '.mdc-rol-ales span{display:inline-flex;align-items:center;gap:6px}.mdc-rol-ales .mdc-ico{color:#003366}' +
      '.mdc-cod{text-align:center;font-size:20px;font-weight:700;letter-spacing:.4em;margin-bottom:8px}' +
      '.mdc-indiciu{margin:0 0 14px;font-size:12.5px;line-height:1.45;color:#5A6B7D;text-align:center}' +
      '.mdc-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}' +
      '.mdc-zona:empty{display:none}' +
      '@media (max-width:420px){.mdc-taburi{padding:24px 52px 0 20px}.mdc-panou{padding:22px 20px}.mdc-mesaj-persistent{margin:14px 20px 0}.mdc-rand{flex-direction:column;gap:12px}}';
    (document.head || document.documentElement).appendChild(st);
  }

  var OCHI_DESCHIS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  var OCHI_INCHIS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  var ICONE_SOCIALE = {
    google: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.48c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.56-5.17 3.56-8.8z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.88-3c-1.08.73-2.46 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.27v3.09C3.25 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28V6.63H1.27A11.99 11.99 0 0 0 0 12c0 1.93.46 3.76 1.27 5.37l4-3.09z"/><path fill="#EA4335" d="M12 4.75c1.76 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.7 1.27 6.63l4 3.09C6.22 6.86 8.87 4.75 12 4.75z"/></svg>',
    facebook: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    apple: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#000" aria-hidden="true"><path d="M17.05 12.536c-.028-2.86 2.335-4.234 2.44-4.3-1.33-1.945-3.4-2.213-4.14-2.244-1.764-.18-3.443 1.04-4.337 1.04-.894 0-2.276-1.014-3.74-.987-1.924.028-3.7 1.12-4.69 2.845-2.002 3.47-.512 8.605 1.437 11.42.953 1.377 2.086 2.923 3.573 2.868 1.436-.056 1.978-.928 3.716-.928 1.737 0 2.226.928 3.74.9 1.545-.028 2.522-1.406 3.466-2.79 1.093-1.6 1.542-3.15 1.566-3.23-.034-.014-3-1.152-3.03-4.594zM14.4 4.06c.79-.958 1.323-2.286 1.177-3.61-1.14.046-2.518.76-3.335 1.717-.733.848-1.375 2.2-1.202 3.494 1.264.098 2.564-.643 3.36-1.6z"/></svg>',
  };

  // Doar furnizorii activi în Supabase (account-system.js → OAUTH_PROVIDERS_ACTIVI).
  function furnizoriActivi() {
    var l = window.MyDarrinAuth && window.MyDarrinAuth.OAUTH_PROVIDERS_ACTIVI;
    return Array.isArray(l) ? l.filter(function (p) { return !!ICONE_SOCIALE[p]; }) : [];
  }
  function socialeHtml() {
    var lista = furnizoriActivi();
    if (!lista.length) return '';
    return '<div class="mdc-sociale">' + lista.map(function (p) {
      var t = tr('Continuă cu {furnizor}', { furnizor: NUME_FURNIZOR[p] });
      return '<button type="button" class="mdc-social" data-mdc-oauth="' + p + '" title="' + esc(t) + '" aria-label="' + esc(t) + '">' + ICONE_SOCIALE[p] + '</button>';
    }).join('') + '</div><div class="mdc-sep"><i></i><span>' + esc(tr('sau cu email')) + '</span><i></i></div>';
  }
  function actualizeazaSociale() {
    Array.prototype.forEach.call(document.querySelectorAll('#auth-modal [data-mdc-sociale]'), function (z) { z.innerHTML = socialeHtml(); });
  }

  function camp(id, tip, ph, extra) {
    return '<input type="' + tip + '" id="' + id + '" class="mdc-in" placeholder="' + esc(ph) + '" aria-label="' + esc(ph) + '" data-eticheta="' + esc(ph) + '"' + (extra || '') + '>';
  }
  function campParola(id, ph, autocomplete, obligatoriu) {
    return '<div class="mdc-parola">' + camp(id, 'password', ph, ' autocomplete="' + autocomplete + '"' + (obligatoriu ? ' required' : '')) +
      '<button type="button" class="mdc-ochi" data-mdc-ochi="' + id + '" aria-label="' + esc(tr('Arată parola')) + '">' + OCHI_DESCHIS + '</button></div>';
  }

  // ── Fereastra ──
  function construieste() {
    if ($('auth-modal') && $('auth-modal').getAttribute('data-mdc') === '1') return $('auth-modal');
    stil();
    var vechi = $('auth-modal');
    if (vechi) vechi.remove();
    var m = document.createElement('div');
    m.id = 'auth-modal';
    m.className = 'hidden';
    m.setAttribute('data-mdc', '1');
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-labelledby', 'mdc-titlu-login');
    m.innerHTML =
      '<div class="mdc-fundal" data-mdc-inchide></div>' +
      '<div class="mdc-cutie">' +
        '<button type="button" class="mdc-x" data-mdc-inchide aria-label="' + esc(tr('Închide')) + '">' +
          '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
        '<div class="mdc-taburi" id="mdc-taburi" role="tablist">' +
          '<button type="button" class="mdc-tab activ" id="tab-login-btn" role="tab" aria-selected="true" aria-controls="auth-login" data-mdc-tab="login">' + esc(tr('Intră în cont')) + '</button>' +
          '<button type="button" class="mdc-tab" id="tab-register-btn" role="tab" aria-selected="false" aria-controls="auth-register" data-mdc-tab="register">' + esc(tr('Creare cont')) + '</button>' +
        '</div>' +
        '<div id="auth-modal-persistent-msg" class="mdc-mesaj-persistent" style="display:none" role="status"></div>' +

        // Intră în cont
        '<form id="auth-login" class="mdc-panou" role="tabpanel" novalidate>' +
          '<h3 class="mdc-h" id="mdc-titlu-login">' + esc(tr('Bine ai revenit!')) + '</h3>' +
          '<p class="mdc-sub">' + esc(tr('Intră în contul tău My Darrin.')) + '</p>' +
          '<div data-mdc-sociale></div>' +
          '<div class="mdc-campuri">' +
            camp('login-email', 'email', tr('Adresa de email'), ' autocomplete="email" inputmode="email"') +
            campParola('login-pass', tr('Parola'), 'current-password', false) +
          '</div>' +
          '<button type="button" class="mdc-link" id="mdc-uitat" style="margin-bottom:8px;display:block">' + esc(tr('Ai uitat parola?')) + '</button>' +
          '<div id="login-recover-msg" class="mdc-zona" style="margin-bottom:12px"></div>' +
          '<button type="submit" class="mdc-btn mdc-btn-albastru" id="mdc-login-btn">' + esc(tr('Intră în cont')) + '</button>' +
          '<div id="mdc-login-msg" class="mdc-zona"></div>' +
          '<p class="mdc-jos">' + esc(tr('Nu ai cont?')) + ' <button type="button" class="mdc-link mdc-link-portocaliu" data-mdc-tab="register">' + esc(tr('Creează unul gratuit')) + '</button></p>' +
        '</form>' +

        // Creare cont — 1. rolul
        '<form id="auth-register" class="mdc-panou" role="tabpanel" hidden novalidate>' +
          '<div id="mdc-pas-rol">' +
            '<h3 class="mdc-h" id="mdc-titlu-rol">' + esc(tr('Creează cont gratuit')) + '</h3>' +
            '<p class="mdc-sub" id="mdc-sub-rol">' + esc(tr('Cum vrei să folosești My Darrin?')) + '</p>' +
            '<fieldset class="mdc-cat" id="mdc-categorii"><legend class="mdc-sr">' + esc(tr('Alege tipul contului')) + '</legend>' +
              [['client', CLIENT], ['partener', PARTENER]].map(function (c) {
                return '<label class="mdc-card" data-mdc-cat="' + c[0] + '"><input type="radio" name="mdc-cat" value="' + c[0] + '">' +
                  icona(c[1].ico) + '<span class="mdc-card-txt"><b>' + esc(tr(c[1].titlu)) + '</b><small>' + esc(tr(c[1].text)) + '</small></span></label>';
              }).join('') +
            '</fieldset>' +
            '<fieldset class="mdc-tipuri" id="mdc-tipuri" hidden><legend class="mdc-eticheta">' + esc(tr('Tipul de partener')) + '</legend><div class="mdc-grila" id="mdc-roluri">' +
              TIPURI.map(function (r) {
                return '<label class="mdc-tip" data-mdc-rol="' + r.rol + '">' + icona(r.ico) + '<span>' + esc(tr(r.titlu)) + '</span>' +
                  '<input type="radio" name="mdc-rol" value="' + r.rol + '"></label>';
              }).join('') +
            '</div></fieldset>' +
            '<button type="button" class="mdc-btn mdc-btn-portocaliu" id="mdc-rol-continua">' + esc(tr('Continuă')) + '</button>' +
            '<div id="mdc-rol-msg" class="mdc-zona"></div>' +
          '</div>' +

          // Creare cont — 2. datele
          '<div id="mdc-pas-date" hidden>' +
            '<h3 class="mdc-h">' + esc(tr('Creează cont gratuit')) + '</h3>' +
            '<div class="mdc-rol-ales"><span id="mdc-rol-ales-text"></span><button type="button" class="mdc-link" id="mdc-schimba-rol">' + esc(tr('Schimbă')) + '</button></div>' +
            '<div data-mdc-sociale></div>' +
            '<div class="mdc-campuri">' +
              '<div class="mdc-rand">' +
                camp('reg-prenume', 'text', tr('Prenume'), ' autocomplete="given-name" maxlength="60" required') +
                camp('reg-nume', 'text', tr('Nume'), ' autocomplete="family-name" maxlength="60" required') +
              '</div>' +
              camp('reg-email', 'email', tr('Adresa de email'), ' autocomplete="email" inputmode="email" maxlength="254" required') +
              '<div>' + camp('reg-tel', 'tel', tr('Telefon'), ' autocomplete="tel" inputmode="tel" maxlength="24" required aria-describedby="mdc-tel-ajutor"') +
                '<div class="mdc-ajutor" id="mdc-tel-ajutor">' + esc(tr('Cu prefixul țării, de exemplu +40 712 345 678.')) + '</div></div>' +
              '<div>' + campParola('reg-pass', tr('Parola'), 'new-password', true) +
                '<div class="mdc-ajutor">' + esc(tr('Cel puțin 8 caractere.')) + '</div></div>' +
            '</div>' +
            '<label class="mdc-gdpr"><input type="checkbox" id="reg-gdpr" required data-eticheta="' + esc(tr('Acordul pentru Termeni și GDPR')) + '">' +
              '<span>' + tr('Accept {termeni} și {politica} (prelucrare date GDPR) platformei My Darrin.', {
                termeni: '<a href="mydarrin-termeni.html" target="_blank" rel="noopener">' + esc(tr('Termenii și Condițiile')) + '</a>',
                politica: '<a href="mydarrin-politica-confidentialitate.html" target="_blank" rel="noopener">' + esc(tr('Politica de Confidențialitate')) + '</a>',
              }) + '</span></label>' +
            '<button type="submit" class="mdc-btn mdc-btn-portocaliu" id="mdc-register-btn">' + esc(tr('Creează cont gratuit')) + '</button>' +
            '<div id="mdc-register-msg" class="mdc-zona"></div>' +
            '<div id="reg-recover-link-container"></div>' +
          '</div>' +
          '<p class="mdc-jos">' + esc(tr('Ai deja cont?')) + ' <button type="button" class="mdc-link mdc-link-albastru" data-mdc-tab="login">' + esc(tr('Intră în cont')) + '</button></p>' +
        '</form>' +

        // Contul conectat (client): alegerea tipului de partener (pasul 11-R3b)
        '<form id="mdc-tip-cont" class="mdc-panou" hidden novalidate>' +
          '<h3 class="mdc-h" id="mdc-titlu-tip-cont">' + esc(tr('Devino partener pe contul tău')) + '</h3>' +
          '<p class="mdc-sub">' + esc(tr('Alege tipul de partener. Datele firmei le completezi apoi în dashboard.')) + '</p>' +
          '<fieldset class="mdc-tipuri" id="mdc-tipuri-cont"><legend class="mdc-eticheta">' + esc(tr('Tipul de partener')) + '</legend><div class="mdc-grila" id="mdc-roluri-cont">' +
            TIPURI.map(function (r) {
              return '<label class="mdc-tip" data-mdc-rol-cont="' + r.rol + '">' + icona(r.ico) + '<span>' + esc(tr(r.titlu)) + '</span>' +
                '<input type="radio" name="mdc-rol-cont" value="' + r.rol + '"></label>';
            }).join('') +
          '</div></fieldset>' +
          '<button type="submit" class="mdc-btn mdc-btn-portocaliu" id="mdc-tip-cont-btn">' + esc(tr('Continuă')) + '</button>' +
          '<div id="mdc-tip-cont-msg" class="mdc-zona"></div>' +
        '</form>' +

        // Creare cont — 3. codul din email
        '<form id="auth-verify-cod" class="mdc-panou" hidden novalidate>' +
          '<h3 class="mdc-h">' + esc(tr('Confirmă adresa de email')) + '</h3>' +
          '<p class="mdc-sub">' + tr('Am trimis un cod de 6 cifre la {email}. Introdu-l mai jos.', { email: '<b id="verify-cod-email"></b>' }) + '</p>' +
          '<input type="text" id="verify-cod-input" class="mdc-in mdc-cod" placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" aria-label="' + esc(tr('Codul de 6 cifre')) + '" data-eticheta="' + esc(tr('Codul de 6 cifre')) + '">' +
          '<p class="mdc-indiciu" id="mdc-cod-indiciu">' + esc(tr('Nu găsești emailul? Verifică și folderul Spam sau Promoții.')) + '</p>' +
          '<button type="submit" class="mdc-btn mdc-btn-albastru" id="mdc-cod-btn">' + esc(tr('Confirmă codul')) + '</button>' +
          '<div id="verify-cod-msg" class="mdc-zona"></div>' +
          '<p class="mdc-jos">' + esc(tr('Nu ai primit codul?')) + ' <button type="button" class="mdc-link mdc-link-albastru" id="mdc-retrimite">' + esc(tr('Retrimite codul')) + '</button></p>' +
          '<div id="mdc-retrimite-msg" class="mdc-zona"></div>' +
          '<p class="mdc-jos" style="margin-top:8px"><button type="button" class="mdc-link" id="mdc-alt-email">' + esc(tr('Ai greșit adresa? Înapoi la date')) + '</button></p>' +
        '</form>' +
      '</div>';
    document.body.appendChild(m);
    leaga(m);
    actualizeazaSociale();
    return m;
  }

  // ── Starea ──
  var stare = { tab: 'login', pasInscriere: 'rol', categorie: null, rol: null, inapoi: null };

  function arataPanou(tab) {
    var m = construieste();
    stare.tab = tab;
    $('auth-login').hidden = tab !== 'login';
    $('auth-register').hidden = tab !== 'register';
    $('auth-verify-cod').hidden = tab !== 'verify-cod';
    $('mdc-tip-cont').hidden = tab !== 'tip-cont';
    $('mdc-taburi').style.display = tab === 'verify-cod' || tab === 'tip-cont' ? 'none' : '';
    [['tab-login-btn', 'login'], ['tab-register-btn', 'register']].forEach(function (x) {
      var b = $(x[0]);
      b.classList.toggle('activ', tab === x[1]);
      b.setAttribute('aria-selected', tab === x[1] ? 'true' : 'false');
    });
    m.setAttribute('aria-labelledby', tab === 'login' ? 'mdc-titlu-login' : tab === 'register' ? 'mdc-titlu-rol' : tab === 'tip-cont' ? 'mdc-titlu-tip-cont' : 'auth-verify-cod');
    if (tab === 'register') arataPasInscriere(stare.pasInscriere);
  }

  function esteTip(rol) { return TIPURI.some(function (t) { return t.rol === rol; }); }

  // categorie: 'client' | 'partener' | null; rol: 'client', un tip de partener sau null.
  function randeazaRol() {
    construieste();
    Array.prototype.forEach.call(document.querySelectorAll('#mdc-categorii .mdc-card'), function (l) {
      var al = l.getAttribute('data-mdc-cat') === stare.categorie;
      l.classList.toggle('ales', al);
      l.querySelector('input').checked = al;
    });
    Array.prototype.forEach.call(document.querySelectorAll('#mdc-roluri .mdc-tip'), function (l) {
      var al = l.getAttribute('data-mdc-rol') === stare.rol;
      l.classList.toggle('ales', al);
      l.querySelector('input').checked = al;
    });
    $('mdc-tipuri').hidden = stare.categorie !== 'partener';
    var d = definitieRol(stare.rol);
    var t = $('mdc-rol-ales-text');
    if (t) t.innerHTML = d ? icona(d.ico) + esc(tr('Cont de {rol}', { rol: tr(d.nume) })) : '';
    var sub = $('mdc-sub-rol');
    if (sub) sub.textContent = esteTip(stare.rol) ? tr('Confirmă tipul contului și continuă.') : tr('Cum vrei să folosești My Darrin?');
  }
  function alegeCategorie(cat) {
    stare.categorie = cat === 'client' || cat === 'partener' ? cat : null;
    if (stare.categorie === 'client') stare.rol = 'client';
    else if (!esteTip(stare.rol)) stare.rol = null;
    randeazaRol();
  }
  function alegeRol(rol) {
    if (rol === 'client') { alegeCategorie('client'); return; }
    if (esteTip(rol)) { stare.categorie = 'partener'; stare.rol = rol; }
    else { stare.categorie = null; stare.rol = null; }
    randeazaRol();
  }

  function arataPasInscriere(pas) {
    construieste();
    stare.pasInscriere = pas;
    $('mdc-pas-rol').hidden = pas !== 'rol';
    $('mdc-pas-date').hidden = pas !== 'date';
  }

  function focusPrimul() {
    setTimeout(function () {
      var panou = stare.tab === 'login' ? $('auth-login') : stare.tab === 'register' ? (stare.pasInscriere === 'rol' ? $('mdc-pas-rol') : $('mdc-pas-date')) : stare.tab === 'tip-cont' ? $('mdc-tip-cont') : $('auth-verify-cod');
      var peRol = (stare.tab === 'register' && stare.pasInscriere === 'rol') || stare.tab === 'tip-cont';
      // Nu mută cursorul dintr-un câmp în care utilizatorul a început deja să scrie.
      var activ = document.activeElement;
      if (panou && activ && panou.contains(activ) && /^(INPUT|TEXTAREA|SELECT)$/.test(activ.tagName)) return;
      var el = panou && ((peRol && panou.querySelector('input[type=radio]:checked')) || panou.querySelector('input'));
      if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
    }, 30);
  }

  function deschisa() { var m = $('auth-modal'); return !!m && m.getAttribute('data-mdc') === '1' && !m.classList.contains('hidden'); }

  var focusInainte = null;
  function deschide(optiuni) {
    var o = optiuni || {};
    var m = construieste();
    asiguraFeedback();
    asiguraAuth().catch(function () {});
    if (!deschisa()) focusInainte = document.activeElement;
    var tab = o.tab || (stare.tab === 'verify-cod' && ss(CHEIE_EMAIL) ? 'verify-cod' : stare.tab) || 'login';
    if (tab === 'inregistrare') tab = 'register';
    var rol = o.rol || rolDinTip(o.tip) || null;
    if (!rol && tab === 'register' && pePaginaPartener()) rol = rolDinTip(new URLSearchParams(location.search).get('type'));
    if (rol) {
      alegeRol(rol);
      tab = 'register';
      stare.pasInscriere = 'rol';
    } else if (o.partener) {
      tab = 'register';
      stare.pasInscriere = 'rol';
      alegeCategorie('partener');
    } else if (tab === 'register' && !stare.categorie) {
      alegeRol(null);
    }
    var pm = $('auth-modal-persistent-msg');
    if (o.mesaj) { pm.textContent = o.mesaj; pm.style.display = 'block'; }
    else if (o.mesaj === null) { pm.textContent = ''; pm.style.display = 'none'; }
    m.classList.remove('hidden');
    // Pagina din spate nu se derulează (nici html, nici body).
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    arataPanou(tab);
    focusPrimul();
    return m;
  }

  function inchide() {
    var m = $('auth-modal');
    if (!m) return;
    m.classList.add('hidden');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    if (focusInainte && document.contains(focusInainte) && focusInainte.focus) { try { focusInainte.focus({ preventScroll: true }); } catch (e) {} }
    focusInainte = null;
  }

  function toggleAuthModal() {
    if (deschisa()) inchide();
    else deschide({});
  }

  function switchAuthTab(tab) {
    if (tab === 'verify-cod') { var e = ss(CHEIE_EMAIL); if (e && $('verify-cod-email')) $('verify-cod-email').textContent = e; }
    if (!deschisa()) deschide({ tab: tab });
    else { arataPanou(tab); focusPrimul(); }
  }

  // Pagina partenerului: fără sesiune, fereastra se deschide cu rolul ales.
  function deschidePentruRol(rol) {
    if (!rolValid(rol)) return Promise.resolve(false);
    // Fără clientul Supabase nu poate exista o sesiune: fereastra se deschide.
    return asteapta(function () { return !!window.supabaseClient; }, 4000).then(function (gata) {
      if (!gata) return null;
      return window.supabaseClient.auth.getSession().then(function (r) { return (r && r.data && r.data.session) || null; }).catch(function () { return null; });
    }).then(function (sesiune) {
      if (sesiune) return false;
      deschide({ tab: 'register', rol: rol });
      return true;
    });
  }

  // ── După autentificare: destinația de pe server ──
  function reincarcaAntet() {
    try { if (window.MYD_CONT && typeof window.MYD_CONT.reincarca === 'function') window.MYD_CONT.reincarca(); } catch (e) {}
  }
  function toast(tip, text) {
    if (window.MDFeedback) window.MDFeedback.toast(tip, text);
  }

  function dupaAutentificare(tip) {
    var textOk = tip === 'cont_creat' ? tr('Contul a fost creat.') : tr('Te-ai autentificat.');
    // Coșul sau checkout-ul: revenirea aici, ca să nu se piardă coșul.
    if (REVINO_AICI) ss(CHEIE_REVENIRE, location.pathname + location.search);
    // „Contul a fost creat” apare pe pagina de destinație (laIncarcare).
    if (tip === 'cont_creat') ss(CHEIE_MESAJ_PAGINA, 'Contul a fost creat.');
    // Revenirea cerută de vechile linkuri (?reason=auth_required / profil_partener).
    var redirect = ss(CHEIE_REDIRECT);
    if (redirect) {
      ss(CHEIE_REDIRECT, null);
      var pagina = /^mydarrin-/.test(redirect) ? redirect : 'mydarrin-' + redirect;
      if (/^[a-z0-9-]+$/i.test(pagina)) { window.location.href = pagina + '.html'; return; }
    }
    window.MyDarrinAuth.mergiDupaLogin(function laEroare(e) {
      ss(CHEIE_MESAJ_PAGINA, null);
      inchide();
      if (window.MDFeedback) window.MDFeedback.toast('eroare', e.message);
      reincarcaAntet();
    }, function laFaraDestinatie() {
      // Fără destinație de la server: rămâne pe pagină.
      ss(CHEIE_MESAJ_PAGINA, null);
      inchide();
      toast('succes', textOk);
      reincarcaAntet();
    });
  }

  // ── Contul conectat: alegerea tipului de partener (pasul 11-R3b) ──
  function marcheazaTipCont(rol) {
    Array.prototype.forEach.call(document.querySelectorAll('#mdc-roluri-cont .mdc-tip'), function (l) {
      var al = l.getAttribute('data-mdc-rol-cont') === rol;
      l.classList.toggle('ales', al);
      l.querySelector('input').checked = al;
    });
  }
  function alegeTipPartener(optiuni) {
    var o = optiuni || {};
    var m = construieste();
    asiguraFeedback();
    asiguraAuth().catch(function () {});
    if (!deschisa()) focusInainte = document.activeElement;
    marcheazaTipCont(esteTip(o.rol) ? o.rol : null);
    $('mdc-tip-cont-msg').innerHTML = '';
    m.classList.remove('hidden');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    arataPanou('tip-cont');
    focusPrimul();
    return m;
  }
  function trimiteTipCont(btn) {
    var ales = document.querySelector('#mdc-roluri-cont input:checked');
    if (!ales) {
      window.MDFeedback.mesaj($('mdc-tip-cont-msg'), 'eroare', tr('Alege tipul de partener, apoi apasă „Continuă”.'));
      var primul = document.querySelector('#mdc-roluri-cont input');
      if (primul) primul.focus();
      return;
    }
    window.MDFeedback.salveaza(btn, $('mdc-tip-cont-msg'), function () {
      return asiguraAuth().then(function () { return window.supabaseClient.auth.getSession(); }).then(function (r) {
        var s = r && r.data && r.data.session;
        if (!s) throw new Error(tr('Sesiunea a expirat. Autentifică-te din nou.'));
        return window.MDFeedback.cerere('/api/cont/rol-solicitat', { method: 'POST', headers: { Authorization: 'Bearer ' + s.access_token }, body: { rol: ales.value } });
      }).then(function (j) {
        setTimeout(function () { window.location.href = j.destinatie; }, 600);
        return tr('Te ducem în dashboard-ul tău, la lista „Activează contul”.');
      });
    }, { textSalveaza: tr('Se salvează…'), textOk: tr('✓ Gata') });
  }

  // ── Acțiunile ──
  function login(btn) {
    var form = $('auth-login');
    var email = $('login-email'), parola = $('login-pass');
    return window.MDFeedback.salveaza(btn, $('mdc-login-msg'), function () {
      var lipsa = [];
      if (!RE_EMAIL.test(email.value.trim())) lipsa.push({ camp: email, mesaj: tr('Scrie adresa de email a contului.') });
      if (!parola.value) lipsa.push({ camp: parola, mesaj: tr('Scrie parola.') });
      if (lipsa.length) throw eroareCampuri(lipsa);
      return asiguraAuth().then(function () {
        return window.MyDarrinAuth.performLogin(email.value.trim(), parola.value).then(function () { return null; }, function (e) {
          var cod = String((e && e.code) || '').toLowerCase();
          // Contul există, dar codul din email n-a fost introdus: ecranul de cod, cu un cod nou.
          if (cod === 'email_not_confirmed' || /email not confirmed/i.test((e && e.message) || '')) return treciLaCodNou(email.value.trim());
          throw new Error(mesajAuth(e));
        });
      }).then(function (r) {
        if (r) return r;
        setTimeout(function () { dupaAutentificare('login'); }, 500);
        return tr('Te-ai autentificat.');
      });
    }, { form: form, textSalveaza: tr('Se verifică…'), textOk: tr('✓ Gata') });
  }

  function uitatParola(btn) {
    var email = $('login-email');
    var zona = $('login-recover-msg');
    return window.MDFeedback.salveaza(btn, zona, function () {
      if (!RE_EMAIL.test(email.value.trim())) {
        throw eroareCampuri([{ camp: email, mesaj: tr('Scrie adresa de email a contului, apoi apasă din nou „Ai uitat parola?”.') }]);
      }
      return asiguraAuth().then(function () {
        return window.MyDarrinAuth.resetPasswordForEmail(email.value.trim()).catch(function (e) { throw new Error(mesajAuth(e)); });
      }).then(function () {
        return tr('Ți-am trimis un email de recuperare la {email}. Verifică și folderul Spam.', { email: email.value.trim() });
      });
    }, { form: $('auth-login'), textSalveaza: tr('Se trimite…'), textOk: tr('✓ Trimis') });
  }

  function continuaRol() {
    if (!stare.categorie || !stare.rol) {
      var faraTip = stare.categorie === 'partener';
      window.MDFeedback.mesaj($('mdc-rol-msg'), 'eroare', faraTip ? tr('Alege tipul de partener, apoi apasă „Continuă”.') : tr('Alege tipul contului, apoi apasă „Continuă”.'));
      var primul = document.querySelector(faraTip ? '#mdc-roluri input' : '#mdc-categorii input');
      if (primul) primul.focus();
      return;
    }
    $('mdc-rol-msg').innerHTML = '';
    arataPasInscriere('date');
    focusPrimul();
  }

  function inregistrare(btn) {
    var form = $('auth-register');
    var c = {
      prenume: $('reg-prenume'), nume: $('reg-nume'), email: $('reg-email'),
      tel: $('reg-tel'), parola: $('reg-pass'), gdpr: $('reg-gdpr'),
    };
    $('reg-recover-link-container').innerHTML = '';
    return window.MDFeedback.salveaza(btn, $('mdc-register-msg'), function () {
      var gresite = [];
      var email = c.email.value.trim();
      var telefon = telefonNormalizat(c.tel.value);
      if (!RE_EMAIL.test(email)) gresite.push({ camp: c.email, mesaj: tr('Adresa de email nu e validă. Exemplu: nume@exemplu.ro') });
      if (!telefonValid(telefon)) gresite.push({ camp: c.tel, mesaj: tr('Scrie telefonul în format internațional, cu prefixul țării (de exemplu +40 712 345 678).') });
      if (c.parola.value.length < 8) gresite.push({ camp: c.parola, mesaj: tr('Parola trebuie să aibă cel puțin 8 caractere.') });
      if (gresite.length) throw eroareCampuri(gresite);
      if (!rolValid(stare.rol)) throw new Error(tr('Alege tipul contului.'));
      var prenume = c.prenume.value.trim(), nume = c.nume.value.trim();
      return asiguraAuth().then(function () {
        return window.MyDarrinAuth.performRegister(email, c.parola.value, nume, c.gdpr.checked, {
          prenume: prenume, telefon: telefon, rolSolicitat: stare.rol,
        }).catch(function (e) {
          if (window.MyDarrinAuth.emailDejaInregistrat(e) || /user_already_exists|email_exists/.test(String(e && e.code))) throw emailExistent(email);
          // Supabase refuză un cod nou pentru același email la mai puțin de un
          // minut („For security purposes…”): contul există, neconfirmat, creat
          // adineauri. Ecranul de cod, nu o eroare. (Limita generală de emailuri
          // a proiectului rămâne o eroare: contul poate să nu existe.)
          if (/for security purposes/i.test(String((e && e.message) || ''))) return { limita: true };
          throw new Error(mesajAuth(e));
        });
      }).then(function (user) {
        if (user && user.limita) return arataEcranCod(email, 'info', tr('Ai deja un cont neconfirmat cu {email}. Ți-am trimis un cod adineauri; dacă nu l-ai primit, așteaptă un minut, apoi apasă „Retrimite codul”.', { email: email }));
        // Cu confirmarea pe email activă, Supabase nu spune că emailul există
        // (protecție la enumerare): întoarce un utilizator fără identități.
        if (user && Array.isArray(user.identities) && user.identities.length === 0) throw emailExistent(email);
        return window.MyDarrinAuth.getCurrentUser().then(function (sesiune) {
          if (sesiune) {
            // Confirmarea pe email e oprită în Supabase: contul e deja activ.
            setTimeout(function () { dupaAutentificare('cont_creat'); }, 500);
            return tr('Contul a fost creat.');
          }
          // Cont nou sau cont existent, încă neconfirmat (Supabase retrimite
          // codul): în ambele cazuri, ecranul de cod.
          ss(CHEIE_EMAIL, email);
          $('verify-cod-email').textContent = email;
          $('verify-cod-input').value = '';
          setTimeout(function () { switchAuthTab('verify-cod'); }, 700);
          return tr('Ți-am trimis codul de 6 cifre pe email.');
        });
      });
    }, { form: form, textSalveaza: tr('Se creează contul…'), textOk: tr('✓ Trimis') });
  }

  // ── Contul neconfirmat (pasul 11-R3c) ──
  function esteLimitaCoduri(e) {
    var t = String((e && (e.code || e.error_code)) || '') + ' ' + String((e && e.message) || '');
    return /rate limit|over_email_send_rate_limit|for security purposes|too many/i.test(t) || (e && e.status === 429);
  }
  // Ecranul de cod, cu mesajul dat (informativ, nu eroare). Întoarce
  // { faraMesaj } pentru MDFeedback.salveaza: butonul de pe ecranul vechi
  // revine fără verde și fără roșu.
  function arataEcranCod(email, tip, text) {
    ss(CHEIE_EMAIL, email);
    $('verify-cod-email').textContent = email;
    $('verify-cod-input').value = '';
    $('mdc-retrimite-msg').innerHTML = '';
    switchAuthTab('verify-cod');
    window.MDFeedback.mesaj($('verify-cod-msg'), tip, text);
    return { faraMesaj: true };
  }
  // Login cu un cont neconfirmat: trimitem automat un cod nou (cel vechi poate fi expirat).
  function treciLaCodNou(email) {
    return window.MyDarrinAuth.retrimiteCodEmail(email).then(function () {
      return arataEcranCod(email, 'info', tr('Contul tău nu e confirmat încă. Ți-am trimis un cod nou la {email}.', { email: email }));
    }, function (e) {
      if (esteLimitaCoduri(e)) return arataEcranCod(email, 'info', tr('Contul tău nu e confirmat încă. Ți-am trimis deja un cod la {email}; pentru unul nou, așteaptă un minut, apoi apasă „Retrimite codul”.', { email: email }));
      return arataEcranCod(email, 'eroare', mesajAuth(e));
    });
  }

  function emailExistent(email) {
    window.MyDarrinAuth.injecteazaLinkRecuperareParola($('reg-recover-link-container'), email);
    return eroareCampuri([{ camp: $('reg-email'), mesaj: tr('Acest email are deja un cont. Intră în cont sau recuperează parola.') }], tr('Acest email are deja un cont. Intră în cont sau recuperează parola.'));
  }

  function confirmaCod(btn) {
    var input = $('verify-cod-input');
    return window.MDFeedback.salveaza(btn, $('verify-cod-msg'), function () {
      var email = ss(CHEIE_EMAIL) || '';
      var cod = input.value.replace(/\D/g, '');
      if (!email) throw new Error(tr('Nu mai știm adresa de email. Apasă „Ai greșit adresa? Înapoi la date” și trimite din nou.'));
      if (!/^[0-9]{6}$/.test(cod)) throw eroareCampuri([{ camp: input, mesaj: tr('Codul are 6 cifre. Îl găsești în emailul primit de la My Darrin.') }]);
      return asiguraAuth().then(function () {
        return window.MyDarrinAuth.confirmaCodEmail(email, cod).catch(function (e) { throw eroareCampuri([{ camp: input, mesaj: mesajAuth(e) }], mesajAuth(e)); });
      }).then(function () {
        ss(CHEIE_EMAIL, null);
        setTimeout(function () { dupaAutentificare('cont_creat'); }, 500);
        return tr('Email confirmat.');
      });
    }, { form: $('auth-verify-cod'), textSalveaza: tr('Se verifică…'), textOk: tr('✓ Confirmat') });
  }

  function retrimiteCod(btn) {
    return window.MDFeedback.salveaza(btn, $('mdc-retrimite-msg'), function () {
      var email = ss(CHEIE_EMAIL) || '';
      if (!email) throw new Error(tr('Nu mai știm adresa de email. Apasă „Ai greșit adresa? Înapoi la date” și trimite din nou.'));
      return asiguraAuth().then(function () {
        return window.MyDarrinAuth.retrimiteCodEmail(email).catch(function (e) { throw new Error(mesajAuth(e)); });
      }).then(function () { return tr('Am retrimis codul la {email}.', { email: email }); });
    }, { textSalveaza: tr('Se trimite…'), textOk: tr('✓ Trimis') });
  }

  function oauth(furnizor) {
    if (furnizoriActivi().indexOf(furnizor) === -1) return;
    asiguraAuth().then(function () { return window.MyDarrinAuth.performOAuthLogin(furnizor); }).catch(function (e) {
      if (window.MDFeedback) window.MDFeedback.toast('eroare', mesajAuth(e));
    });
  }

  // Fără MDFeedback (scriptul nu s-a încărcat): o acțiune nu pornește fără feedback.
  function cuFeedback(fn) {
    return function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      var btn = ev && ev.currentTarget && ev.currentTarget.tagName === 'FORM' ? ev.currentTarget.querySelector('[type=submit]') : (ev && ev.currentTarget);
      asiguraFeedback().then(function (ok) {
        if (ok) { fn(btn); return; }
        var z = $('mdc-login-msg');
        if (z) z.textContent = tr('Pagina nu s-a încărcat complet. Reîncarcă pagina și încearcă din nou.');
      });
    };
  }

  function leaga(m) {
    m.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target : null;
      if (!t) return;
      if (t.closest('[data-mdc-inchide]')) { inchide(); return; }
      var tab = t.closest('[data-mdc-tab]');
      if (tab) { switchAuthTab(tab.getAttribute('data-mdc-tab')); return; }
      var ochi = t.closest('[data-mdc-ochi]');
      if (ochi) {
        var inp = $(ochi.getAttribute('data-mdc-ochi'));
        var arata = inp.type === 'password';
        inp.type = arata ? 'text' : 'password';
        ochi.innerHTML = arata ? OCHI_INCHIS : OCHI_DESCHIS;
        ochi.setAttribute('aria-label', arata ? tr('Ascunde parola') : tr('Arată parola'));
        return;
      }
      var so = t.closest('[data-mdc-oauth]');
      if (so) { oauth(so.getAttribute('data-mdc-oauth')); return; }
    });
    m.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'mdc-cat') { alegeCategorie(e.target.value); $('mdc-rol-msg').innerHTML = ''; }
      if (e.target && e.target.name === 'mdc-rol') { alegeRol(e.target.value); $('mdc-rol-msg').innerHTML = ''; }
      if (e.target && e.target.name === 'mdc-rol-cont') { marcheazaTipCont(e.target.value); $('mdc-tip-cont-msg').innerHTML = ''; }
    });
    m.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { inchide(); return; }
      if (e.key === 'Enter' && e.target && (e.target.name === 'mdc-rol' || e.target.name === 'mdc-cat')) { e.preventDefault(); continuaRol(); }
      if (e.key === 'Tab') capcanaFocus(e, m);
    });
    $('auth-login').addEventListener('submit', cuFeedback(login));
    $('mdc-uitat').addEventListener('click', cuFeedback(uitatParola));
    $('mdc-rol-continua').addEventListener('click', cuFeedback(continuaRol));
    $('mdc-schimba-rol').addEventListener('click', function () { arataPasInscriere('rol'); focusPrimul(); });
    $('auth-register').addEventListener('submit', cuFeedback(function (btn) {
      if (stare.pasInscriere === 'rol') { continuaRol(); return; }
      inregistrare($('mdc-register-btn') || btn);
    }));
    $('auth-verify-cod').addEventListener('submit', cuFeedback(confirmaCod));
    $('mdc-tip-cont').addEventListener('submit', cuFeedback(function () { trimiteTipCont($('mdc-tip-cont-btn')); }));
    $('mdc-retrimite').addEventListener('click', cuFeedback(retrimiteCod));
    $('mdc-alt-email').addEventListener('click', function () { stare.pasInscriere = 'date'; arataPanou('register'); focusPrimul(); });
    $('verify-cod-input').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 6); });
  }

  // Tab nu iese din fereastră cât e deschisă.
  function capcanaFocus(e, m) {
    var el = Array.prototype.filter.call(m.querySelectorAll('button,input,a[href],select,textarea'), function (x) {
      return !x.disabled && x.offsetParent !== null && x.getAttribute('tabindex') !== '-1' && !(x.type === 'radio' && !x.checked && m.querySelector('input[name="' + x.name + '"]:checked'));
    });
    if (!el.length) return;
    var primul = el[0], ultimul = el[el.length - 1];
    if (e.shiftKey && document.activeElement === primul) { e.preventDefault(); ultimul.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimul) { e.preventDefault(); primul.focus(); }
  }

  // ── La încărcare: ?reason= (linkurile vechi și paza dashboard-urilor) și mesajul de pagină ──
  function laIncarcare() {
    asiguraFeedback();
    var q = new URLSearchParams(location.search);
    var motiv = q.get('reason');
    if (motiv === 'cont') deschide({ tab: 'login' });
    else if (motiv === 'profil_partener') {
      ss(CHEIE_REDIRECT, 'devino-partener-wizard');
      deschide({ tab: 'login', mesaj: tr('Autentifică-te ca să-ți completezi profilul de partener.') });
    } else if (motiv === 'auth_required') {
      var r = q.get('redirect');
      if (r) ss(CHEIE_REDIRECT, r);
      deschide({ tab: 'register', mesaj: tr('Creează-ți contul și confirmă emailul pentru a continua înregistrarea de partener.') });
    }
    // Mesaj lăsat de o redirecționare (ex. dashboard-ul clientului fără comenzi).
    var mesaj = ss(CHEIE_MESAJ_PAGINA);
    if (mesaj) {
      ss(CHEIE_MESAJ_PAGINA, null);
      asiguraFeedback().then(function (ok) { if (ok) window.MDFeedback.toast('info', tr(mesaj)); });
    }
  }

  window.toggleAuthModal = toggleAuthModal;
  window.switchAuthTab = switchAuthTab;
  window.MDCont = {
    deschide: deschide, inchide: inchide, deschisa: deschisa, toggle: toggleAuthModal,
    switchTab: switchAuthTab, deschidePentruRol: deschidePentruRol, rolDinTip: rolDinTip, alegeTipPartener: alegeTipPartener,
    ROLURI: ROLURI, TIPURI: TIPURI, CHEIE_MESAJ_PAGINA: CHEIE_MESAJ_PAGINA,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', laIncarcare);
  else laIncarcare();
})();
