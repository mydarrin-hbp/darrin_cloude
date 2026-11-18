/* ════════════════════════════════════════════════════════════════
   MY DARRIN — panou-cont-nou.js (MYD_PANOU_NOU), pasul 12-P1 (17 nov. 2026)

   Panoul partenerului în starea „cont nou” (machetele B1.3 / B1.4 pe telefon,
   B1.5 pe desktop), peste dashboard-ul partenerului / furnizorului, cât timp
   contul nu e activ:
     - „Bun venit, {prenume}” + „{profesia} · {orașul}” (ciorna activării,
       datele pre-înscrierii: /parteneri/inscriere);
     - „Starea contului”: Cont creat → Profil incomplet → În verificare → Activ,
       plus „Necesită completări” (firma sau un document respinse, cu motivul);
       starea vine de pe server (activare.stare_cont, lib/activare-partener.js
       → stareContPartener), într-un singur loc;
     - „Ce mai ai de făcut”, {n} din 6 pași: fiecare rând deschide pasul existent
       din activare-pasi.js (MYD_ACTIVARE, modul „un singur pas”), în orice
       ordine; după salvare, panoul se reîncarcă cu starea nouă;
     - un singur buton portocaliu: „Continuă cu {primul pas necompletat}”;
     - cardul turcoaz: comenzile din zonă (textul diferă pe tipul de partener);
     - telefon: bara de jos Activitate · Comenzi · Încasări · Profil; desktop:
       meniul lateral. Secțiunile fără date încă arată stări goale, fără cifre.
   Cifre de comenzi: niciuna, până nu sunt reale.

   Folosit de cont-dashboard.js (MYD_PAZA.verifica): MYD_PANOU_NOU.deschide(profil, optiuni).
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_PANOU_NOU) return;

  var LOGO = '/assets/img/logo-my-darrin.webp';
  var CHEIE_INCHIS = 'myd_panou_nou_inchis';

  // Rândurile listei (în ordinea machetei), cu titlul și explicația, pe tipul de partener.
  var RANDURI = {
    cont_creat: { titlu: 'Cont creat' },
    firma: { titlu: 'Firma (CUI)', sub: 'Datele vin automat din ANAF · ~2 min', subDesktop: 'datele vin din ANAF', urm: 'Continuă cu firma' },
    cont_bancar: { titlu: 'Cont bancar (IBAN)', sub: 'Aici primești banii pentru lucrări', urm: 'Continuă cu contul bancar' },
    profesii_dotari: {
      titlu: { implicit: 'Profesii și dotări', curier: 'Zone de livrare și vehicul', materiale: 'Activitate și catalog', inchirieri: 'Activitate și echipamente', asigurari: 'Activitate și polițe' },
      sub: { implicit: 'Ce lucrări faci și cu ce scule', curier: 'Unde livrezi și cu ce vehicul', materiale: 'Codul activității și produsele tale', inchirieri: 'Codul activității și echipamentele tale', asigurari: 'Codul activității și polițele tale' },
      urm: { implicit: 'Continuă cu profesiile și dotările', curier: 'Continuă cu zonele de livrare', materiale: 'Continuă cu activitatea și catalogul', inchirieri: 'Continuă cu activitatea și echipamentele', asigurari: 'Continuă cu activitatea și polițele' },
    },
    documente: { titlu: 'Documente', sub: 'Le încarci cu telefonul, ca poze', urm: 'Continuă cu documentele' },
    contract: { titlu: 'Contract', sub: 'Îl semnezi cu un cod, după verificare', subDesktop: 'semnat cu cod, după verificare', urm: 'Continuă cu contractul' },
  };
  var STARI = ['cont_creat', 'profil_incomplet', 'in_verificare', 'activ'];
  var NUME_STARE = { cont_creat: 'Cont creat', profil_incomplet: 'Profil incomplet', in_verificare: 'În verificare', activ: 'Activ', necesita_completari: 'Necesită completări' };
  var CATEGORIE = { servicii: 'servicii', materiale: 'materiale', inchirieri: 'închirieri', curier: 'curierat', asigurari: 'asigurări' };
  var SECTIUNI = ['activitate', 'comenzi', 'calendar', 'incasari', 'profil', 'ajutor'];

  var st = { profil: null, opt: null, ciorna: null, profesii: null, sectiune: 'activitate' };

  function $(id) { return document.getElementById(id); }
  // Etichetele cu cheie proprie (i18n/en.json, i18n/ro.json): aceeași formulare ca în machetă,
  // fără să schimbe traducerea textului românesc de pe alte pagini („În verificare”).
  var CHEI = { 'În verificare': 'panou_nou.in_verificare' };
  function tr(ro, p) {
    if (typeof window.t === 'function') return window.t(CHEI[ro] || null, ro, p);
    return p ? String(ro).replace(/\{(\w+)\}/g, function (m, k) { return p[k] != null ? p[k] : m; }) : ro;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function en() { return !!(window.MYD_I18N && window.MYD_I18N.lang && window.MYD_I18N.lang !== 'ro'); }
  function pePaTip(v, tip) { return v && typeof v === 'object' ? (v[tip] || v.implicit) : v; }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} return null; }

  function token() {
    return window.supabaseClient.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      return s ? s.access_token : null;
    });
  }
  function cerere(url, o) {
    return token().then(function (t) {
      var opt = Object.assign({ cache: 'no-store' }, o || {});
      opt.headers = Object.assign({ Authorization: 'Bearer ' + t }, opt.headers || {});
      return window.MDFeedback.cerere(url, opt);
    });
  }

  // ── Stil (culorile machetei B1) ──────────────────────────────────────
  function stil() {
    if ($('mpn-stil')) return;
    var s = document.createElement('style');
    s.id = 'mpn-stil';
    s.textContent =
      // Pasul 12-P1b: overflow-x:clip (nu doar hidden) — conținutul nu poate fi derulat orizontal
      // nici din cod (focus, scrollIntoView), deci meniul și logo-ul nu mai ajung lipite de margine.
      '#myd-panou-nou{position:fixed;inset:0;z-index:9300;background:#F6F8FB;color:#1A2332;font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;overflow-y:auto;overflow-x:hidden;overflow-x:clip;-webkit-text-size-adjust:100%;display:flex;flex-direction:column;width:100%;max-width:100vw;margin:0;padding:0}' +
      '#myd-panou-nou *{box-sizing:border-box}#myd-panou-nou [hidden]{display:none!important}' +
      '#myd-panou-nou a{color:#003366}' +
      '.mpn-antet{display:flex;align-items:center;gap:8px;padding:12px 16px;background:#fff;border-bottom:1px solid #E6ECF2;position:sticky;top:0;z-index:2}' +
      '.mpn-antet img{border-radius:9px;display:block;flex:0 0 auto;width:34px;height:34px;min-width:34px;max-width:none;object-fit:contain}' +
      '.mpn-marca{font-size:16px;font-weight:700;color:#003366;flex-grow:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.mpn-marca .mpn-lung{display:none}' +
      '.mpn-site{min-height:44px;padding:0 10px;border:1px solid #D5DEE8;border-radius:10px;display:inline-flex;align-items:center;font-size:13px;font-weight:700;text-decoration:none;white-space:nowrap;background:#fff}' +
      '.mpn-av{display:none;width:40px;height:40px;border-radius:99px;background:#003366;color:#fff;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex:0 0 auto}' +
      '#myd-panou-nou .myd-limba .myd-limba-nume{display:none}#myd-panou-nou .myd-limba .myd-limba-cod{display:inline}' +
      '.mpn-corp{display:flex;flex-grow:1;min-height:0}' +
      '.mpn-meniu{display:none}' +
      '.mpn-main{flex-grow:1;min-width:0;padding:16px 16px 88px;display:flex;flex-direction:column;gap:12px}' +
      '.mpn-salut h1{margin:0;font-size:22px;font-weight:800;overflow-wrap:anywhere}.mpn-salut p{margin:4px 0 0;font-size:14px;color:#4A5A6B}' +
      '.mpn-salut .mpn-insigna{display:none}' +
      '.mpn-grila{display:flex;flex-direction:column;gap:12px}.mpn-dreapta{display:contents}' +
      // Telefon (B1.3): starea, lista, cardul turcoaz.
      '.mpn-grila .mpn-stare{order:1}.mpn-grila .mpn-stanga{order:2}.mpn-grila .mpn-info{order:3}' +
      '.mpn-card{background:#fff;border:1px solid #E6ECF2;border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:12px}' +
      '.mpn-card h2{margin:0;font-size:15px;font-weight:700}' +
      '.mpn-cap{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
      '.mpn-insigna{font-size:12px;font-weight:700;border-radius:99px;padding:5px 10px;white-space:nowrap}' +
      '.mpn-i-profil_incomplet{color:#8A4A00;background:#FFF3E0}.mpn-i-in_verificare{color:#003366;background:#EAF1F8}.mpn-i-activ{color:#0B6E6A;background:#EAF6F5}.mpn-i-necesita_completari{color:#8A1F11;background:#FDECEA}.mpn-i-cont_creat{color:#0B6E6A;background:#EAF6F5}' +
      '.mpn-etape{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:11.5px;font-weight:700;color:#4A5A6B;margin:0;padding:0;list-style:none}' +
      '.mpn-etape li{display:flex;align-items:center;gap:6px}.mpn-etape li+li:before{content:"›";color:#4A5A6B}' +
      '.mpn-etape .gata{color:#0B6E6A}.mpn-etape .acum{color:#8A4A00}.mpn-etape .acum.rosu{color:#8A1F11}' +
      '.mpn-etape-v{display:none}' +
      '.mpn-bara{height:8px;border-radius:99px;background:#EEF2F6;overflow:hidden}.mpn-bara i{display:block;height:8px;background:#0E9E99}' +
      '.mpn-mic{font-size:13px;color:#4A5A6B;margin:0;line-height:1.45}' +
      '.mpn-motiv{font-size:13px;line-height:1.45;color:#8A1F11;background:#FDECEA;border-radius:12px;padding:10px 12px;margin:0}' +
      '.mpn-lista{display:flex;flex-direction:column;gap:4px}.mpn-lista .mpn-mic{margin-bottom:6px}' +
      '.mpn-rand{display:flex;align-items:center;gap:10px;padding:8px 0;border:0;border-bottom:1px solid #EEF2F6;background:none;width:100%;text-align:left;font-family:inherit;color:#1A2332;cursor:pointer;min-height:52px}' +
      '.mpn-rand:last-of-type{border-bottom:0}.mpn-rand[disabled]{cursor:default}' +
      '.mpn-rand:focus-visible{outline:3px solid #0E9E99;outline-offset:2px;border-radius:8px}' +
      '.mpn-cerc{width:26px;height:26px;border-radius:99px;border:2px solid #C6D2DE;flex:0 0 auto;display:flex;align-items:center;justify-content:center}' +
      '.mpn-cerc.facut{background:#0E9E99;border-color:#0E9E99}.mpn-cerc.urm{border-color:#FF8C00}.mpn-cerc.verif{border-color:#0E9E99}.mpn-cerc.respins{border-color:#C0392B}' +
      '.mpn-txt{flex-grow:1;display:flex;flex-direction:column;min-width:0}.mpn-txt b{font-size:14px;font-weight:700}.mpn-txt small{font-size:12px;color:#4A5A6B}' +
      '.mpn-rand.facut .mpn-txt b{font-weight:400;color:#4A5A6B}' +
      '.mpn-actiune{font-size:13px;font-weight:700;color:#003366;white-space:nowrap}.mpn-sageata{color:#4A5A6B}' +
      '.mpn-pill{display:none}' +
      // Doar pe desktop (B1.5): capul listei cu „{n} din 6 pași” și explicația scurtă din rând.
      '.mpn-cap-lista{display:none;align-items:center;justify-content:space-between}' +
      '.mpn-txt .mpn-sub-d{display:none;font-weight:400;color:#4A5A6B}' +
      '.mpn-buton{margin-top:8px;min-height:50px;border:none;border-radius:14px;background:#FF8C00;color:#1A1A1A;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;width:100%}' +
      '.mpn-buton:focus-visible{outline:3px solid #003366;outline-offset:2px}' +
      '.mpn-complet{background:none;border:0;padding:0;min-height:44px;font-size:13px;font-weight:700;color:#003366;text-decoration:underline;cursor:pointer;font-family:inherit;align-self:flex-start}' +
      '.mpn-info{background:#EAF6F5;border-radius:18px;padding:16px;display:flex;gap:12px;align-items:flex-start}' +
      '.mpn-info b{display:block;font-size:14px;font-weight:700;color:#0B5E5A;margin-bottom:4px}.mpn-info span{font-size:13px;line-height:1.45;color:#1A2332}' +
      '.mpn-gol{background:#fff;border:1px solid #E6ECF2;border-radius:18px;padding:20px 16px}.mpn-gol h2{margin:0 0 6px;font-size:17px}.mpn-gol p{margin:0;font-size:14px;line-height:1.5;color:#4A5A6B}' +
      '.mpn-gol dl{margin:12px 0 0;display:grid;grid-template-columns:auto 1fr;gap:8px 14px;font-size:14px}.mpn-gol dt{color:#4A5A6B}.mpn-gol dd{margin:0;font-weight:700;overflow-wrap:anywhere}' +
      '.mpn-gol .mpn-legaturi{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}' +
      '.mpn-secundar{min-height:44px;padding:0 14px;border:1px solid #D5DEE8;border-radius:12px;background:#fff;color:#003366;font-size:14px;font-weight:700;display:inline-flex;align-items:center;text-decoration:none;cursor:pointer;font-family:inherit}' +
      '.mpn-jos{position:fixed;left:0;right:0;bottom:0;display:flex;background:#fff;border-top:1px solid #E6ECF2;height:64px;z-index:3}' +
      '.mpn-jos button{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:11.5px;color:#4A5A6B;background:none;border:0;font-family:inherit;cursor:pointer;min-height:44px}' +
      '.mpn-jos button[aria-current="page"]{font-weight:700;color:#003366}' +
      '.mpn-jos svg{width:22px;height:22px}' +
      '@media (min-width:1024px){' +
        '.mpn-antet{padding:14px 32px;gap:12px}.mpn-antet img{width:38px;height:38px;min-width:38px;border-radius:10px}' +
        '.mpn-marca{font-size:18px}.mpn-marca .mpn-lung{display:inline}' +
        '#myd-panou-nou .myd-limba .myd-limba-nume{display:inline}#myd-panou-nou .myd-limba .myd-limba-cod{display:none}' +
        '.mpn-site{font-size:14px;padding:0 14px}.mpn-av{display:flex}' +
        '.mpn-meniu{display:flex;flex-direction:column;gap:4px;width:232px;min-width:232px;flex:0 0 232px;background:#fff;border-right:1px solid #E6ECF2;padding:20px 16px;margin:0}' +
        '.mpn-meniu button{min-height:44px;min-width:0;width:100%;margin:0;border-radius:10px;color:#4A5A6B;font-size:14px;display:flex;align-items:center;justify-content:flex-start;padding:0 12px;background:none;border:0;text-align:left;text-indent:0;white-space:nowrap;overflow:visible;font-family:inherit;cursor:pointer}' +
        '.mpn-meniu button[aria-current="page"]{background:#EAF1F8;color:#003366;font-weight:700}' +
        '.mpn-main{padding:28px 32px 40px;gap:18px}' +
        '.mpn-salut{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.mpn-salut h1{font-size:28px}.mpn-salut p{font-size:15px}.mpn-salut .mpn-insigna{display:inline-block;font-size:13px;padding:7px 14px}' +
        '.mpn-grila{display:grid;grid-template-columns:1.4fr 1fr;gap:18px;align-items:start}.mpn-dreapta{display:flex;flex-direction:column;gap:18px}' +
        '.mpn-grila .mpn-stanga,.mpn-grila .mpn-stare,.mpn-grila .mpn-info{order:0}' +
        '.mpn-card{padding:20px}.mpn-card h2{font-size:17px}' +
        '.mpn-stare .mpn-cap .mpn-insigna,.mpn-stare .mpn-etape,.mpn-stare .mpn-bara,.mpn-stare .mpn-progres{display:none}' +
        '.mpn-etape-v{display:flex;flex-direction:column;gap:10px;font-size:14px;margin:0;padding:0;list-style:none}' +
        '.mpn-etape-v li{display:flex;gap:10px;align-items:center;color:#4A5A6B}.mpn-etape-v i{width:10px;height:10px;border-radius:99px;border:2px solid #C6D2DE;flex:0 0 auto}' +
        '.mpn-etape-v .gata{color:#0B6E6A;font-weight:700}.mpn-etape-v .gata i{background:#0E9E99;border-color:#0E9E99}' +
        '.mpn-etape-v .acum{color:#8A4A00;font-weight:700}.mpn-etape-v .acum i{background:#FF8C00;border-color:#FF8C00}' +
        '.mpn-etape-v .acum.rosu{color:#8A1F11}.mpn-etape-v .acum.rosu i{background:#C0392B;border-color:#C0392B}' +
        '.mpn-lista .mpn-cap-lista{display:flex}.mpn-rand{padding:10px 0;gap:12px}.mpn-txt b{font-size:15px}.mpn-txt small{display:none}.mpn-txt .mpn-sub-d{display:inline}' +
        '.mpn-actiune{display:none}.mpn-pill{display:inline-flex;min-height:36px;padding:0 14px;border-radius:10px;background:#FF8C00;color:#1A1A1A;align-items:center;font-size:13px;font-weight:800;white-space:nowrap}' +
        '.mpn-lista>.mpn-buton{display:none}' +
        '.mpn-info{flex-direction:column;gap:6px;padding:20px}.mpn-info svg{display:none}.mpn-info b{font-size:16px}.mpn-info span{font-size:14px;line-height:1.5}' +
        '.mpn-jos{display:none}' +
      '}' +
      '.mpn-cap-lista span{font-size:13px;color:#4A5A6B}';
    (document.head || document.documentElement).appendChild(s);
  }

  // ── Date ─────────────────────────────────────────────────────────────
  function pre() { return (st.ciorna && st.ciorna.date && st.ciorna.date.preinscriere) || {}; }
  function tip() { return (st.profil && st.profil.activare && st.profil.activare.tip) || 'servicii'; }
  function numeProfesie() {
    var p = pre();
    if (!p.profesie_cod && !p.profesie_slug) return null;
    var din = (st.profesii || []).filter(function (x) { return x.cod === p.profesie_cod || x.slug === p.profesie_slug; })[0];
    return din ? din.denumire : (en() ? null : p.profesie_ro);
  }
  function eticheta() {
    var d = window.MYD_DESTINATIE_ROL && window.MYD_DESTINATIE_ROL.definitie(st.profil.activare.rol);
    return tip() === 'servicii' ? (numeProfesie() || tr(d ? d.titlu : 'Partener')) : tr(d ? d.titlu : 'Partener');
  }
  function oras() { return String(pre().oras || '').trim(); }
  function prenume() {
    var p = st.profil || {};
    return p.prenume || String(p.nume || '').split(' ')[0] || String(p.email || '').split('@')[0];
  }
  function initiale() {
    var p = st.profil || {};
    var a = String(p.prenume || '').charAt(0) + String(p.nume_familie || '').charAt(0);
    return (a || String(p.email || '?').charAt(0)).toUpperCase();
  }

  // ── Desen ───────────────────────────────────────────────────────────
  var ICON = {
    bifa: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
    clopot: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0B6E6A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    activitate: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
    comenzi: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
    incasari: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/></svg>',
    profil: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  };

  function antetHtml() {
    var selector = window.MYD_PAZA && window.MYD_PAZA.selectorLimbaHtml ? window.MYD_PAZA.selectorLimbaHtml() : '';
    return '<header class="mpn-antet">' +
      '<img src="' + LOGO + '" alt="My Darrin" width="34" height="34">' +
      '<span class="mpn-marca">My Darrin<span class="mpn-lung"> · ' + esc(tr('Panou partener')) + '</span></span>' +
      '<span id="mpn-limba">' + selector + '</span>' +
      '<a class="mpn-site" id="mpn-site" href="/">' + esc(tr('Înapoi la site')) + '</a>' +
      '<span class="mpn-av" aria-hidden="true">' + esc(initiale()) + '</span>' +
    '</header>';
  }

  function meniuHtml() {
    var n = [['activitate', 'Activitate'], ['comenzi', 'Comenzi'], ['calendar', 'Calendar'], ['incasari', 'Încasări'], ['profil', 'Profil și firmă'], ['ajutor', 'Ajutor']];
    return '<nav class="mpn-meniu" aria-label="' + esc(tr('Navigare')) + '">' + n.map(function (x) {
      return '<button type="button" data-mpn-sec="' + x[0] + '"' + (st.sectiune === x[0] ? ' aria-current="page"' : '') + '>' + esc(tr(x[1])) + '</button>';
    }).join('') + '</nav>';
  }
  function josHtml() {
    var n = [['activitate', 'Activitate'], ['comenzi', 'Comenzi'], ['incasari', 'Încasări'], ['profil', 'Profil']];
    return '<nav class="mpn-jos" aria-label="' + esc(tr('Navigare')) + '">' + n.map(function (x) {
      return '<button type="button" data-mpn-sec="' + x[0] + '"' + (st.sectiune === x[0] ? ' aria-current="page"' : '') + '>' + ICON[x[0]] + esc(tr(x[1])) + '</button>';
    }).join('') + '</nav>';
  }

  function stareCardHtml(sc) {
    var curent = sc.stare;
    var rosu = curent === 'necesita_completari';
    var idx = rosu ? 1 : STARI.indexOf(curent);
    var etape = STARI.map(function (k, i) {
      var nume = (rosu && i === 1) ? NUME_STARE.necesita_completari : NUME_STARE[k];
      var cls = i < idx || (curent === 'activ' && i === idx) ? 'gata' : i === idx ? 'acum' + (rosu ? ' rosu' : '') : '';
      return { nume: nume, cls: cls, k: k };
    });
    var n = sc.pasi_facuti;
    var progres = n === 1 ? tr('1 din 6 pași făcut.') : tr('{n} din 6 pași făcuți.', { n: n });
    var dupa = {
      profil_incomplet: 'Primești comenzi după verificare și contract.',
      in_verificare: 'Verificăm firma și documentele; te anunțăm pe email.',
      necesita_completari: 'Corectează ce s-a respins și trimite din nou.',
      activ: 'Contul e activ: primești comenzi.',
      cont_creat: 'Primești comenzi după verificare și contract.',
    }[curent];
    return '<section class="mpn-card mpn-stare" aria-labelledby="mpn-t-stare" data-mpn-stare="' + curent + '">' +
      '<div class="mpn-cap"><h2 id="mpn-t-stare">' + esc(tr('Starea contului')) + '</h2><span class="mpn-insigna mpn-i-' + curent + '">' + esc(tr(NUME_STARE[curent])) + '</span></div>' +
      '<ol class="mpn-etape">' + etape.map(function (e) { return '<li class="' + e.cls + '">' + esc(tr(e.nume)) + '</li>'; }).join('') + '</ol>' +
      '<div class="mpn-bara" role="progressbar" aria-valuemin="0" aria-valuemax="6" aria-valuenow="' + n + '" aria-label="' + esc(tr('Pașii făcuți')) + '"><i style="width:' + Math.round(n / 6 * 100) + '%"></i></div>' +
      '<p class="mpn-mic mpn-progres">' + esc(progres + ' ' + tr(dupa)) + '</p>' +
      '<ol class="mpn-etape-v">' + etape.map(function (e) {
        var t = tr(e.nume) + (e.cls.indexOf('acum') === 0 ? ' · ' + tr('acum') : '') + (e.k === 'activ' ? ': ' + tr('primești comenzi') : '');
        return '<li class="' + e.cls + '"><i aria-hidden="true"></i>' + esc(t) + '</li>';
      }).join('') + '</ol>' +
      (rosu ? '<p class="mpn-motiv" id="mpn-motiv">' + esc(sc.motiv ? tr('Motivul: {motiv}', { motiv: sc.motiv }) : tr('Verificarea a cerut completări. Deschide pasul marcat și trimite din nou.')) + '</p>' : '') +
    '</section>';
  }

  function randHtml(r, sc) {
    var d = RANDURI[r.cheie];
    var t = tip();
    var titlu = tr(pePaTip(d.titlu, t));
    if (r.cheie === 'cont_creat') {
      return '<div class="mpn-rand facut" data-mpn-rand="cont_creat"><span class="mpn-cerc facut">' + ICON.bifa + '</span><span class="mpn-txt"><b>' + esc(titlu) + '</b></span></div>';
    }
    var urm = sc.urmatorul === r.cheie;
    var sub = tr(pePaTip(d.sub, t));
    var subD = d.subDesktop ? ' <span class="mpn-sub-d">· ' + esc(tr(d.subDesktop)) + '</span>' : '';
    var cerc = 'mpn-cerc', actiune = '<span class="mpn-sageata" aria-hidden="true">›</span>', dezactivat = false;
    if (r.stare === 'facut') { cerc += ' facut'; sub = tr('Făcut'); actiune = ''; }
    else if (r.stare === 'in_verificare') { cerc += ' verif'; sub = tr('Trimis; în verificare'); }
    else if (r.stare === 'respins') { cerc += ' respins'; sub = tr('Necesită completări'); }
    // „blocat” (așteaptă firma): explicația machetei rămâne; motivul apare la deschiderea pasului.
    else if (r.stare === 'dupa_verificare' && r.cheie === 'contract') { /* textul machetei */ }
    if (urm) { cerc += ' urm'; actiune = '<span class="mpn-actiune">' + esc(tr('Completează')) + '</span><span class="mpn-pill">' + esc(tr('Completează')) + '</span>'; }
    if (r.stare === 'facut') dezactivat = true;
    return '<button type="button" class="mpn-rand' + (r.stare === 'facut' ? ' facut' : '') + '" data-mpn-rand="' + r.cheie + '" data-mpn-pas="' + r.pas + '" data-mpn-stare-rand="' + r.stare + '"' + (dezactivat ? ' disabled' : '') + '>' +
      '<span class="' + cerc + '">' + (r.stare === 'facut' ? ICON.bifa : '') + '</span>' +
      '<span class="mpn-txt"><b>' + esc(titlu) + subD + '</b><small>' + esc(sub) + '</small></span>' + actiune +
    '</button>';
  }

  function infoHtml() {
    var t = tip();
    // Decizia LM (17 nov. 2026): „Comenzi în zona ta · {profesie} · {oraș}”, pentru orice tip
    // (profesia la servicii, tipul de partener la celelalte); orașul lipsă nu apare.
    var titlu = [tr('Comenzi în zona ta'), eticheta(), oras()].filter(Boolean).join(' · ');
    var text;
    if (t === 'servicii') {
      text = tr('Te anunțăm pe email și în aplicație când apare o comandă în zona ta. Vezi suma ta înainte să accepți; 0% comision din manoperă.');
    } else if (t === 'curier') {
      text = tr('Te anunțăm pe email și în aplicație când apare o livrare în zona ta. Vezi suma ta înainte să accepți; 0% comision din manoperă.');
    } else if (t === 'asigurari') {
      text = tr('Te anunțăm pe email și în aplicație când un client din zona ta cere o poliță din oferta ta. Prețul public îl afișează platforma; tu acorzi un discount între 5% și 15%, pe categorie.');
    } else {
      text = tr('Te anunțăm pe email și în aplicație când un client din zona ta comandă din oferta ta. Prețul public îl afișează platforma; tu acorzi un discount între 5% și 15%, pe categorie.');
    }
    return '<section class="mpn-info" data-mpn-info="' + t + '">' + ICON.clopot + '<div><b>' + esc(titlu) + '</b><span>' + esc(text) + '</span></div></section>';
  }

  function activitateHtml() {
    var sc = st.profil.activare.stare_cont;
    var sub = [eticheta(), oras()].filter(Boolean).join(' · ');
    var subDesktop = sub + ' · ' + tr('cont de partener {categorie}', { categorie: tr(CATEGORIE[tip()] || tip()) });
    var urm = sc.urmatorul && RANDURI[sc.urmatorul];
    var lista = '<section class="mpn-card mpn-lista" aria-labelledby="mpn-t-lista">' +
      '<div class="mpn-cap-lista"><h2>' + esc(tr('Ce mai ai de făcut')) + '</h2><span>' + esc(tr('{n} din 6 pași', { n: sc.pasi_facuti })) + '</span></div>' +
      '<h2 id="mpn-t-lista" class="mpn-t-lista-tel">' + esc(tr('Ce mai ai de făcut')) + '</h2>' +
      '<p class="mpn-mic">' + esc(tr('Începi cu firma; restul îl faci în ce ordine vrei.')) + '</p>' +
      sc.randuri.map(function (r) { return randHtml(r, sc); }).join('') +
      (urm ? '<button type="button" class="mpn-buton" id="mpn-continua" data-mpn-pas="' + (sc.randuri.filter(function (r) { return r.cheie === sc.urmatorul; })[0] || {}).pas + '">' + esc(tr(pePaTip(urm.urm, tip()))) + '</button>' : '') +
    '</section>';
    var rolAcordat = Array.isArray(st.profil.roles) && st.profil.roles.indexOf(st.profil.activare.rol) !== -1;
    return '<div class="mpn-salut"><div><h1>' + esc(tr('Bun venit, {prenume}', { prenume: prenume() })) + '</h1>' +
        '<p><span class="mpn-sub-tel">' + esc(sub) + '</span></p></div>' +
        '<span class="mpn-insigna mpn-i-' + sc.stare + '">' + esc(tr(NUME_STARE[sc.stare])) + '</span></div>' +
      '<div class="mpn-grila">' +
        // Telefon: starea, apoi lista; desktop: lista în stânga, starea și cardul turcoaz în dreapta.
        '<div class="mpn-stanga">' + lista + '</div>' +
        '<div class="mpn-dreapta">' + stareCardHtml(sc) + infoHtml() + '</div>' +
      '</div>' +
      (rolAcordat ? '<button type="button" class="mpn-complet" id="mpn-complet">' + esc(tr('Deschide panoul complet')) + '</button>' : '') +
      '<span hidden data-mpn-desktop-sub="' + esc(subDesktop) + '"></span>';
  }

  function golHtml(sec) {
    var p = st.profil || {};
    if (sec === 'profil') {
      return '<section class="mpn-gol" data-mpn-gol="profil"><h2>' + esc(tr('Profil și firmă')) + '</h2>' +
        '<dl><dt>' + esc(tr('Numele')) + '</dt><dd translate="no">' + esc([p.prenume, p.nume_familie].filter(Boolean).join(' ') || p.nume || '—') + '</dd>' +
        '<dt>' + esc(tr('Email')) + '</dt><dd translate="no">' + esc(p.email || '—') + '</dd>' +
        '<dt>' + esc(tr('Telefon')) + '</dt><dd translate="no">' + esc(p.telefon || '—') + '</dd>' +
        '<dt>' + esc(tr('Activitatea')) + '</dt><dd>' + esc([eticheta(), oras()].filter(Boolean).join(' · ') || '—') + '</dd></dl>' +
        '<p style="margin-top:12px">' + esc(tr('Datele firmei apar aici după pasul „Firma (CUI)”.')) + '</p>' +
        '<div class="mpn-legaturi"><a class="mpn-secundar" href="' + esc((window.MYD_DESTINATIE_ROL && window.MYD_DESTINATIE_ROL.PAGINA_ROLURI) || '/mydarrin-rolurile-mele.html') + '">' + esc(tr('Rolurile mele')) + '</a>' +
        '<button type="button" class="mpn-secundar" id="mpn-iesi">' + esc(tr('Ieși din cont')) + '</button></div></section>';
    }
    var t = {
      comenzi: ['Comenzi', 'Nicio comandă încă. Comenzile din zona ta apar aici după ce contul devine activ.'],
      calendar: ['Calendar', 'Programările apar aici după prima comandă acceptată.'],
      incasari: ['Încasări', 'Nicio încasare încă. Banii pentru lucrări ajung în contul bancar adăugat la „Cont bancar (IBAN)”.'],
      ajutor: ['Ajutor', 'Ai o întrebare despre cont sau despre activare? Scrie-ne și îți răspundem pe email.'],
    }[sec];
    return '<section class="mpn-gol" data-mpn-gol="' + sec + '"><h2>' + esc(tr(t[0])) + '</h2><p>' + esc(tr(t[1])) + '</p>' +
      (sec === 'ajutor' ? '<div class="mpn-legaturi"><a class="mpn-secundar" href="/mydarrin-contact.html">' + esc(tr('Contact')) + '</a><a class="mpn-secundar" href="/intrebari-frecvente-parteneri.html">' + esc(tr('Întrebări frecvente')) + '</a></div>' : '') +
      '</section>';
  }

  function randeaza() {
    var rad = $('myd-panou-nou');
    if (!rad) return;
    rad.scrollLeft = 0;
    rad.innerHTML = antetHtml() +
      '<div class="mpn-corp">' + meniuHtml() +
        '<main class="mpn-main" id="mpn-main">' + (st.sectiune === 'activitate' ? activitateHtml() : golHtml(st.sectiune)) + '</main>' +
      '</div>' + josHtml();
    // Pe desktop, subtitlul are și tipul contului (macheta B1.5).
    var subD = rad.querySelector('[data-mpn-desktop-sub]');
    var subT = rad.querySelector('.mpn-sub-tel');
    if (subD && subT && window.matchMedia && window.matchMedia('(min-width:1024px)').matches) subT.textContent = subD.getAttribute('data-mpn-desktop-sub');
    var tTel = rad.querySelector('.mpn-t-lista-tel');
    if (tTel && window.matchMedia && window.matchMedia('(min-width:1024px)').matches) tTel.hidden = true;
    if (window.MYD_PAZA && window.MYD_PAZA.leagaSelectorLimba) window.MYD_PAZA.leagaSelectorLimba($('mpn-limba'));
    leaga(rad);
    // În I18N EN, textele generate se traduc la inserare (observatorul din i18n-loader.js).
  }

  function leaga(rad) {
    Array.prototype.forEach.call(rad.querySelectorAll('[data-mpn-sec]'), function (b) {
      b.addEventListener('click', function () {
        st.sectiune = b.getAttribute('data-mpn-sec');
        randeaza();
        rad.scrollTop = 0;
        var m = $('mpn-main');
        if (m) { m.setAttribute('tabindex', '-1'); try { m.focus({ preventScroll: true }); } catch (e) {} }
      });
    });
    Array.prototype.forEach.call(rad.querySelectorAll('.mpn-rand[data-mpn-pas]:not([disabled]), #mpn-continua'), function (b) {
      b.addEventListener('click', function () { deschidePas(Number(b.getAttribute('data-mpn-pas'))); });
    });
    var c = $('mpn-complet');
    if (c) c.addEventListener('click', function () { ss(CHEIE_INCHIS, '1'); inchide(); });
    var iesi = $('mpn-iesi');
    if (iesi) iesi.addEventListener('click', function () { if (window.MyDarrinAuth) window.MyDarrinAuth.performLogout(); });
  }

  // ── Pașii (activare-pasi.js, modul „un singur pas”) ──────────────────
  function deschidePas(n) {
    if (!window.MYD_ACTIVARE || !n) return;
    window.MYD_ACTIVARE.deschide(st.profil, st.opt, { pas: n, unPas: true, laInchidere: reincarca });
  }
  // După un pas salvat (sau „Înapoi la panou”): profilul și ciorna din nou.
  function reincarca() {
    return token().then(function (t) {
      if (!t || !window.MYD_PROFIL) return null;
      return window.MYD_PROFIL.cere(t, true).then(function (r) { return r && r.ok ? r.corp : null; });
    }).then(function (p) {
      if (p) st.profil = p;
      // Contul a devenit activ: dashboard-ul obișnuit.
      if (st.profil.activare && st.profil.activare.activ) { inchide(); location.reload(); return null; }
      return citesteCiorna();
    }).then(function () { randeaza(); }).catch(function () { randeaza(); });
  }

  function citesteCiorna() {
    return cerere('/api/partener/activare-ciorna').then(function (j) { st.ciorna = (j && j.ciorna) || null; }).catch(function () { st.ciorna = st.ciorna || null; });
  }
  function citesteProfesii() {
    return fetch('/api/public/profesii?lang=' + (en() ? 'en' : 'ro')).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { st.profesii = (j && j.profesii) || []; }).catch(function () { st.profesii = []; });
  }

  function inchide() {
    var rad = $('myd-panou-nou');
    if (rad) rad.remove();
    document.documentElement.style.overflow = '';
  }

  /**
   * Deschide panoul „cont nou” peste dashboard.
   * @param {object} profil  /api/cont/profil (cu activare.stare_cont)
   * @param {object} optiuni opțiunile MYD_PAZA.verifica (trecute mai departe pașilor)
   * @returns {boolean} true dacă s-a deschis
   */
  function deschide(profil, optiuni) {
    if (!profil || !profil.activare || !profil.activare.stare_cont || profil.activare.activ) return false;
    var rolAcordat = Array.isArray(profil.roles) && profil.roles.indexOf(profil.activare.rol) !== -1;
    // Partenerul cu rol care a ales „Deschide panoul complet” îl vede pe acesta în sesiunea curentă.
    if (rolAcordat && ss(CHEIE_INCHIS) === '1') return false;
    stil();
    st.profil = profil; st.opt = optiuni || {};
    var rad = $('myd-panou-nou');
    if (!rad) {
      rad = document.createElement('div');
      rad.id = 'myd-panou-nou';
      rad.setAttribute('role', 'region');
      rad.setAttribute('aria-label', tr('Panou partener'));
      document.body.appendChild(rad);
    }
    document.documentElement.style.overflow = 'hidden';
    // Datele pre-înscrierii rămase în sesiune (codul confirmat pe altă pagină): în ciornă acum.
    var salvare = window.MDCont && window.MDCont.salveazaPreinscriere ? window.MDCont.salveazaPreinscriere() : Promise.resolve(false);
    Promise.resolve(salvare).catch(function () {}).then(function () {
      return Promise.all([citesteCiorna(), citesteProfesii()]);
    }).then(randeaza, randeaza);
    return true;
  }

  window.MYD_PANOU_NOU = { deschide: deschide, inchide: inchide, reincarca: reincarca };
})();
