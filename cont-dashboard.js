/* ════════════════════════════════════════════════════════════════
   MY DARRIN — cont-dashboard.js (MYD_PAZA), pasul 10b (16 oct. 2026)

   Paza comună a dashboard-urilor (client, partener, furnizor, investitori)
   și starea contului:
     - fără sesiune → fereastra de login, cu revenire la pagina cerută;
     - clientul fără nicio comandă (pasul 11-R2) → pagina principală, cu un
       mesaj scurt: dashboard-ul clientului apare după prima comandă;
     - modul activare (pasul 11-R3, decizia LM din 2 nov. 2026): cine a ales un
       rol de partener (profiles.rol_solicitat) intră în dashboard-ul acelui rol
       înainte să-l aibă; pagina arată doar fluxul „Activează contul”, pe pași
       (activare-pasi.js, corecția 11-R3), iar celelalte panouri sunt blocate
       („Disponibil după activarea contului”). Partenerul cu rol, dar cu
       activarea neterminată, vede fluxul peste dashboard; după ce îl închide,
       o bandă scurtă („Continuă activarea”) îl redeschide.
       Accesul la date rămâne pe server: endpoint-urile cer rolul;
     - rol greșit → redirect la dashboard-ul corect, cu un mesaj scurt
       („Te-am dus în contul tău de furnizor.”), nu pagină goală;
     - antetul de identitate: inițiale, numele firmei (sau numele din
       profil), emailul, insigna rolului, „Rolurile mele” și, dacă contul are
       mai multe roluri, comutatorul de rol (pasul 11-L), apoi „Ieși”;
     - banda de stare a contului de partener (verificare, cont bancar,
       contract, respingere), cu butonul spre pasul lipsă;
     - lângă produsele furnizorului, de ce nu apar încă public (pasul 10c,
       MYD_PAZA.bandaProduse);
     - furnizorul propriu al platformei (pasul 10c): insigna „Furnizor propriu
       al platformei”, fără benzile de contract și cont bancar (nu semnează
       contract cu sine; banii intră în contul entității platformei).

   Datele vin din /api/cont/profil (profiles.roles). Harta rol → dashboard
   e cea unică, din lib/destinatie-rol.js (window.MYD_DESTINATIE_ROL).
   Paza de aici e doar pentru experiența utilizatorului: accesul real îl
   verifică fiecare endpoint, pe server.

   Utilizare (în scriptul de pază al paginii, după account-system.js):
     const paza = await MYD_PAZA.verifica({ container: 'myd-cont-antet', tema: 'intunecata',
       actiuni: { cont_bancar: () => showPanel('cont-bancar'), panou: (id) => showPanel(id) },
       blocheaza: { continut: 'dp-content', nav: 'dp-nav' } });
     if (!paza) return;           // false = redirect în curs (login sau alt dashboard)
     if (paza.activare) return;   // modul activare: doar lista, fără panouri
     // paza.profil: profilul contului (null dacă nu s-a putut citi; pagina continuă)
   Pagina publică (investitori): { public: true } — fără redirect.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_PAZA) return;

  var CHEIE_REVENIRE = 'myd_revenire_dupa_login';
  var CHEIE_MESAJ = 'myd_mesaj_redirect';
  var CHEIE_ROL_ACTIV = 'myd_rol_activ_v1';

  function tr(ro, param) {
    if (typeof window.t === 'function') return window.t(null, ro, param);
    return param ? ro.replace(/\{(\w+)\}/g, function (m, k) { return param[k] != null ? param[k] : m; }) : ro;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } return null; }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; }

  // Pasul 11-I3: clientul Supabase anunță că e gata (lib/supabaseClient.js:
  // evenimentul myd:supabase-gata), fără interogare la fiecare 100 ms.
  function clientGata(ms) {
    if (window.supabaseClient) return Promise.resolve(true);
    return new Promise(function (ok) {
      var gata = false, ceas;
      function fin() {
        if (gata) return;
        gata = true; clearTimeout(ceas); window.removeEventListener('myd:supabase-gata', fin);
        ok(!!window.supabaseClient);
      }
      ceas = setTimeout(fin, ms);
      window.addEventListener('myd:supabase-gata', fin);
    });
  }
  // account-system.js (MyDarrinAuth) e un script sincron, încărcat înaintea acestuia.
  function asteaptaAuth() {
    return clientGata(6000).then(function (gata) { return gata && !!window.MyDarrinAuth; });
  }

  function sesiune() {
    return window.supabaseClient.auth.getSession().then(function (r) { return (r && r.data && r.data.session) || null; });
  }

  function antetAuth() {
    return sesiune().then(function (s) { return s ? { Authorization: 'Bearer ' + s.access_token } : {}; });
  }

  // Pasul 11-I3: prin cache-ul comun al paginii (window.MYD_PROFIL, din
  // lib/supabaseClient.js) — o singură cerere, oricâte scripturi o cer.
  // reincarca = true după o salvare (benzile se reîmprospătează).
  function cereProfil(reincarca) {
    return antetAuth().then(function (h) {
      if (!h.Authorization) return { status: 401 };
      if (window.MYD_PROFIL) {
        return window.MYD_PROFIL.cere(h.Authorization.slice(7), !!reincarca).then(function (r) {
          var j = r.corp || {};
          return { status: r.status, profil: r.ok ? j : null, eroare: r.ok ? null : j };
        });
      }
      return fetch('/api/cont/profil', { headers: h, cache: 'no-store' }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) { return { status: res.status, profil: res.ok ? j : null, eroare: res.ok ? null : j }; });
      });
    });
  }

  // Fără sesiune: fereastra de login (index.html?reason=cont), cu revenire aici
  // după login (account-system.js → mergiDupaLogin citește CHEIE_REVENIRE).
  function laLogin() {
    ss(CHEIE_REVENIRE, location.pathname + location.search);
    location.replace('/index.html?reason=cont');
  }

  var MESAJ_ROL = {
    client: 'Te-am dus în contul tău de client.',
    partener_materiale: 'Te-am dus în contul tău de furnizor.',
    partener_inchirieri: 'Te-am dus în contul tău de furnizor.',
    partener_servicii: 'Te-am dus în contul tău de partener.',
    partener_curier: 'Te-am dus în contul tău de curier.',
    partener_asigurari: 'Te-am dus în contul tău de asigurător.',
    investor: 'Te-am dus în contul tău de investitor.',
  };

  function dr() { return window.MYD_DESTINATIE_ROL; }

  // Rolurile care pot deschide pagina curentă (pagina + ?type=).
  function roluriPagina() {
    var type = new URLSearchParams(location.search).get('type');
    return dr().roluriPentruPagina(location.pathname, type);
  }

  function tintaCorecta(p) {
    var cu = p.roluri_dashboard || [];
    if (cu.length === 1) return { url: dr().dashboardPentruRol(cu[0]), mesaj: MESAJ_ROL[cu[0]] };
    if (cu.length > 1) return { url: dr().PAGINA_ALEGERE, mesaj: 'Alege contul în care vrei să intri.' };
    if (p.destinatie) return { url: p.destinatie, mesaj: null };
    return { url: '/', mesaj: 'Contul tău nu are încă acces la acest dashboard.' };
  }

  // ── Stiluri ─────────────────────────────────────────────────────────
  function stil() {
    if (document.getElementById('myd-paza-stil')) return;
    var st = document.createElement('style');
    st.id = 'myd-paza-stil';
    st.textContent =
      // Pe mobil, zona principală a dashboard-urilor întunecate e mai lată decât
      // ecranul (antetul paginii nu se împachetează); identitatea rămâne în ecran.
      '#myd-cont-antet{max-width:100vw;box-sizing:border-box}' +
      '.myd-id{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 14px;border-radius:14px;margin:0 0 14px;border:1px solid #E2E8F0;background:#fff;color:#1A2332;box-sizing:border-box;max-width:100%}' +
      '.myd-id.intunecata{background:#192433;border-color:#2D3F55;color:#E2E8F0}' +
      '.myd-id-av{position:relative;flex:0 0 auto;width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#003366,#1A5FAD);color:#fff;font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center}' +
      '.myd-id-av i{position:absolute;right:0;bottom:0;width:11px;height:11px;border-radius:50%;background:#1A9E5A;border:2px solid #fff}' +
      '.myd-id.intunecata .myd-id-av i{border-color:#192433}' +
      '.myd-id-txt{min-width:0;flex:1 1 180px}' +
      '.myd-id-nume{font-weight:800;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.myd-id-email{font-size:12px;color:#5A6B7D;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.myd-id.intunecata .myd-id-email{color:#8BA3C0}' +
      '.myd-id-insigna{font-size:11px;font-weight:700;padding:4px 10px;border-radius:99px;color:#fff;white-space:nowrap}' +
      '.myd-id-iesi{border:1px solid #E2DFD6;background:transparent;color:#C0392B;border-radius:10px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;min-height:38px}' +
      '.myd-id.intunecata .myd-id-iesi{border-color:rgba(192,57,43,.4);color:#F87171}' +
      '.myd-id-roluri{display:inline-flex;align-items:center;border:1px solid #D5DFE8;background:#fff;color:#003366;border-radius:10px;padding:8px 12px;font-size:12px;font-weight:700;text-decoration:none;min-height:38px;box-sizing:border-box;white-space:nowrap}' +
      '.myd-id.intunecata .myd-id-roluri{background:transparent;border-color:#2D3F55;color:#7AB3E0}' +
      '.myd-id-comuta{border:1px solid #D5DFE8;background:#fff;color:#1A2332;border-radius:10px;padding:8px 10px;font-size:12px;font-weight:600;font-family:inherit;min-height:38px;max-width:100%}' +
      '.myd-id.intunecata .myd-id-comuta{background:#0F1923;border-color:#2D3F55;color:#E2E8F0}' +
      '.myd-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}' +
      '.myd-banda{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 14px;border-radius:12px;margin:0 0 12px;font-size:13px;line-height:1.45;border:1.5px solid;box-sizing:border-box;max-width:100%}' +
      '.myd-banda span{flex:1 1 220px;min-width:0}' +
      '.myd-banda button{border:0;border-radius:10px;padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;color:#fff;min-height:38px}' +
      '.myd-banda-info{border-color:#2B6CB0;background:#EBF4FB;color:#1A3A5C}.myd-banda-info button{background:#003366}' +
      '.myd-banda-atentie{border-color:#C77700;background:#FFF6E5;color:#6B4200}.myd-banda-atentie button{background:#CC7000}' +
      '.myd-banda-eroare{border-color:#C0392B;background:#FDECEA;color:#7A1F16}.myd-banda-eroare button{background:#C0392B}' +
      '.myd-banda-ok{border-color:#1A7A3A;background:#EDF7F0;color:#14532D}' +
      '.myd-blocat{border:1.5px dashed #D5DFE8;border-radius:14px;padding:22px 16px;margin:0 18px 18px;text-align:center;font-size:13px;color:#5A6B7D;max-width:820px;box-sizing:border-box}' +
      '@media (max-width:480px){.myd-blocat{margin:0 12px 12px}}' +
      '.myd-fer{position:fixed;inset:0;z-index:9600;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.55)}' +
      '.myd-fer-cutie{background:#fff;color:#1A2332;border-radius:16px;width:100%;max-width:560px;max-height:90vh;overflow:auto;padding:22px;box-sizing:border-box}' +
      '.myd-fer-cutie h3{margin:0 0 12px;font-size:17px;font-weight:800}' +
      '.myd-fer-cutie label{display:block;font-size:11.5px;color:#5A6B7D;margin:10px 0 4px}' +
      '.myd-fer-cutie input,.myd-fer-cutie select{width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #D5DFE8;border-radius:10px;font-size:14px;font-family:inherit}' +
      '.myd-fer-rand{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}' +
      '.myd-fer-rand button{border:0;border-radius:10px;padding:10px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;min-height:42px}' +
      '.myd-btn-p{background:#003366;color:#fff}.myd-btn-s{background:#F4F7F9;color:#1A2332}' +
      '.myd-fer-contract{border:1px solid #E2E8F0;border-radius:10px;padding:12px;max-height:40vh;overflow:auto;font-size:12.5px;line-height:1.55;margin-top:6px}';
    (document.head || document.documentElement).appendChild(st);
  }

  function initiale(nume) {
    var cuv = String(nume || '').replace(/\b(SRL|S\.R\.L\.|SA|PFA|II|LTD)\b\.?/gi, '').trim().split(/[\s.\-_]+/).filter(Boolean);
    var s = cuv.length > 1 ? cuv[0].charAt(0) + cuv[1].charAt(0) : (cuv[0] || '?').slice(0, 2);
    return s.toUpperCase();
  }
  function numeCont(p) { return (p.partener && p.partener.nume_firma) || p.nume || String(p.email || '').split('@')[0]; }

  // ── Antetul de identitate ──────────────────────────────────────────
  // ── Pasul 11-I3: selectorul de limbă pe paginile de cont ─────────────
  // Același selector ca în antetul public (index.html: .lang-dd / .lang-chip /
  // .lang-panel / .lang-opt, aceleași stiluri), cu limbile platformei (RO + EN).
  // Alegerea o face i18n-loader.js (MYD_I18N.setLanguage): myd_lang_v1 și,
  // pentru contul autentificat, profiles.limba (lib/profil-cont.js); pagina se
  // reîncarcă imediat în limba aleasă.
  var LIMBI_CONT = [['ro', '🇷🇴', 'Română'], ['en', '🇬🇧', 'English']];
  function limbaPagina() { return (window.MYD_I18N && window.MYD_I18N.lang) === 'ro' ? 'ro' : 'en'; }
  function stilLimba() {
    if (document.getElementById('myd-limba-stil')) return;
    var st = document.createElement('style');
    st.id = 'myd-limba-stil';
    st.textContent =
      '.myd-limba{position:relative}' +
      '.myd-limba .lang-chip{display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;transition:opacity .15s;background:transparent;border:0;padding:8px 6px;min-height:44px;color:inherit;font-family:inherit;font-weight:500;white-space:nowrap}' +
      '.myd-limba .myd-limba-cod{display:none}' +
      // Pasul 12-P1b: pe telefon, pe toate paginile, codul limbii („RO”) în loc de nume („Română”).
      '@media (max-width:480px){.myd-limba .myd-limba-nume{display:none}.myd-limba .myd-limba-cod{display:inline}#myd-activare-pagina .myd-limba .lang-chip{padding:8px 4px}}' +
      '.myd-limba .lang-chip:hover{opacity:.8}' +
      '.myd-limba .lang-chip:focus-visible{outline:3px solid #0E9E99;outline-offset:2px;border-radius:8px}' +
      '.myd-limba .lang-chip svg{width:12px;height:12px;opacity:.6}' +
      '.myd-limba .lang-panel{display:none;position:absolute;top:calc(100% + 8px);right:0;background:#fff;border-radius:12px;border:1px solid #D5DFE8;box-shadow:0 8px 30px rgba(26,38,64,.12);min-width:140px;overflow:hidden;z-index:100}' +
      '.myd-limba.open .lang-panel{display:block}' +
      // În antetul contului selectorul poate ajunge la marginea stângă (telefon): lista se deschide spre dreapta.
      '.myd-id .myd-limba .lang-panel{left:0;right:auto}' +
      '.myd-limba .lang-opt{display:flex;align-items:center;gap:8px;padding:9px 14px;font-size:13px;font-weight:500;color:#2D2D2D;cursor:pointer;transition:background .15s;min-height:44px;box-sizing:border-box}' +
      '.myd-limba .lang-opt:hover,.myd-limba .lang-opt:focus-visible{background:#EBF4FB;outline:none}' +
      '.myd-limba .lang-opt.active{color:#003366;font-weight:700}';
    (document.head || document.documentElement).appendChild(st);
  }
  function selectorLimbaHtml() {
    stilLimba();
    var l = limbaPagina();
    var c = LIMBI_CONT.filter(function (x) { return x[0] === l; })[0];
    return '<div class="lang-dd myd-limba" data-myd-limba>' +
      '<button type="button" class="lang-chip" aria-haspopup="true" aria-expanded="false" aria-label="' + esc(tr('Limba')) + ': ' + esc(c[2]) + '">' +
        // Pasul 12-P1b: fără steagul emoji — pe Windows se desenează ca literele „RO”,
        // deci pe telefon apărea „RO RO”. Telefon: codul („RO ▾”); desktop: numele („Română ▾”).
        '<span class="myd-limba-nume" translate="no">' + esc(c[2]) + '</span><span class="myd-limba-cod" translate="no" aria-hidden="true">' + c[0].toUpperCase() + '</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
      '</button>' +
      '<div class="lang-panel" role="menu">' + LIMBI_CONT.map(function (x) {
        return '<div class="lang-opt' + (x[0] === l ? ' active' : '') + '" role="menuitemradio" aria-checked="' + (x[0] === l) + '" tabindex="0" data-limba="' + x[0] + '" lang="' + x[0] + '" translate="no">' + x[2] + '</div>';
      }).join('') + '</div></div>';
  }
  function alegeLimba(cod) {
    if (!cod || cod === limbaPagina()) return false;
    if (window.MYD_I18N && typeof window.MYD_I18N.setLanguage === 'function') window.MYD_I18N.setLanguage(cod, { persist: true });
    return true;
  }
  var inchidereLimbaLegata = false;
  function leagaSelectorLimba(rad) {
    Array.prototype.forEach.call((rad || document).querySelectorAll('[data-myd-limba]'), function (dd) {
      if (dd.__mydLimba) return;
      dd.__mydLimba = true;
      var btn = dd.querySelector('.lang-chip');
      var deschide = function (da) { dd.classList.toggle('open', da); btn.setAttribute('aria-expanded', String(da)); };
      btn.addEventListener('click', function (e) { e.stopPropagation(); deschide(!dd.classList.contains('open')); });
      Array.prototype.forEach.call(dd.querySelectorAll('.lang-opt'), function (o) {
        var alege = function (e) { e.stopPropagation(); deschide(false); if (!alegeLimba(o.getAttribute('data-limba'))) btn.focus(); };
        o.addEventListener('click', alege);
        o.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alege(e); } });
      });
      dd.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dd.classList.contains('open')) { deschide(false); btn.focus(); } });
    });
    if (inchidereLimbaLegata) return;
    inchidereLimbaLegata = true;
    document.addEventListener('click', function (e) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-myd-limba].open'), function (dd) {
        if (!dd.contains(e.target)) { dd.classList.remove('open'); var b = dd.querySelector('.lang-chip'); if (b) b.setAttribute('aria-expanded', 'false'); }
      });
    });
  }

  function antet(container, p, rol, tema) {
    var d = dr().definitie(rol) || dr().definitie('client');
    var nume = numeCont(p);
    var div = document.createElement('div');
    div.className = 'myd-id' + (tema === 'intunecata' ? ' intunecata' : '');
    div.id = 'myd-id';
    div.innerHTML =
      '<span class="myd-id-av" aria-hidden="true">' + esc(initiale(nume)) + '<i></i></span>' +
      '<div class="myd-id-txt"><div class="myd-id-nume" id="myd-id-nume">' + esc(nume) + '</div>' +
      '<div class="myd-id-email" id="myd-id-email" title="' + esc(p.email || '') + '">' + esc(tr('Conectat ca {email}', { email: p.email || '' })) + '</div></div>' +
      '<span class="myd-id-insigna" id="myd-id-insigna" style="background:' + esc(d.culoare) + '">' + esc(tr(d.insigna)) + '</span>' +
      (p.furnizor_propriu ? '<span class="myd-id-insigna" id="myd-id-furnizor-propriu" style="background:#0E7C66">' + esc(tr('Furnizor propriu al platformei')) + '</span>' : '') +
      comutatorRol(p, rol) +
      selectorLimbaHtml() +
      '<a class="myd-id-roluri" id="myd-id-roluri" href="' + esc(dr().PAGINA_ROLURI) + '">' + esc(tr('Rolurile mele')) + '</a>' +
      '<button type="button" class="myd-id-iesi" id="myd-id-iesi">' + esc(tr('Ieși')) + '</button>';
    container.appendChild(div);
    leagaSelectorLimba(div);
    div.querySelector('#myd-id-iesi').onclick = function () { window.MyDarrinAuth.performLogout(); };
    var sel = div.querySelector('#myd-id-comuta');
    if (sel) sel.onchange = function () {
      var r = sel.value;
      if (!r || r === rol) return;
      ls(CHEIE_ROL_ACTIV, r);
      location.href = dr().dashboardPentruRol(r);
    };
  }

  // Comutatorul de rol (pasul 11-L): doar dacă contul are mai multe roluri cu
  // dashboard. Un clic duce în dashboard-ul rolului ales (harta unică).
  function comutatorRol(p, rol) {
    var cu = p.roluri_dashboard || [];
    if (cu.length < 2) return '';
    return '<label class="myd-sr" for="myd-id-comuta">' + esc(tr('Schimbă rolul')) + '</label>' +
      '<select class="myd-id-comuta" id="myd-id-comuta">' + cu.map(function (r) {
        var d = dr().definitie(r);
        return '<option value="' + esc(r) + '"' + (r === rol ? ' selected' : '') + '>' + esc(tr(d ? d.titlu : r)) + '</option>';
      }).join('') + '</select>';
  }

  function banda(container, tip, text, buton, laClick, id) {
    var b = document.createElement('div');
    b.className = 'myd-banda myd-banda-' + tip;
    b.setAttribute('role', tip === 'eroare' ? 'alert' : 'status');
    if (id) b.id = id;
    b.innerHTML = '<span>' + esc(text) + '</span>' + (buton ? '<button type="button">' + esc(buton) + '</button>' : '');
    if (buton) b.querySelector('button').onclick = laClick;
    container.appendChild(b);
    return b;
  }

  // ── Banda de stare a contului de partener ──────────────────────────
  // Contractul cere întâi un cont bancar activ (api/partener/contract-trimite-otp.js).
  function benziPartener(container, p, actiuni) {
    var pt = p.partener;
    if (!pt) return;
    var st = pt.status_verificare;
    if (st === 'rejected') {
      var t = tr('Cererea ta de partener a fost respinsă.');
      if (pt.motiv_respingere) t += ' ' + tr('Motiv: {motiv}', { motiv: pt.motiv_respingere });
      banda(container, 'eroare', t, tr('Contactează-ne'), function () { location.href = '/mydarrin-contact.html'; }, 'myd-banda-respins');
      return;
    }
    if (st === 'pending_review' || !st) {
      banda(container, 'info', tr('Contul tău e în verificare. Te anunțăm prin email.'), null, null, 'myd-banda-verificare');
    }
    // Furnizorul propriu: fără contract și fără cont bancar de partener.
    if (p.furnizor_propriu) return;
    if (!pt.cont_bancar) {
      banda(container, 'atentie', tr('Adaugă contul bancar pentru plăți.'), tr('Adaugă contul bancar'), actiuni.cont_bancar, 'myd-banda-cont-bancar');
    }
    if (st === 'approved' && !pt.contract_semnat) {
      banda(container, 'atentie', tr('Semnează contractul ca să primești comenzi.'), tr('Semnează contractul'), actiuni.contract, 'myd-banda-contract');
    }
  }

  // ── Activarea contului (pasul 11-R3) ───────────────────────────────
  // Corecția 11-R3: lista de 6 carduri e înlocuită de fluxul pe pași
  // (activare-pasi.js). În dashboard rămâne doar o bandă care îl redeschide.
  function deschideFlux(p, opt, pas) {
    if (window.MYD_ACTIVARE) return window.MYD_ACTIVARE.deschide(p, opt, pas ? { pas: pas } : null);
    return null;
  }
  // Pasul 12-P1: contul încă neactiv → panoul „cont nou” (panou-cont-nou.js,
  // machetele B1.3–B1.5), nu pasul „Firma”. Fără panou (script lipsă): ca înainte.
  function deschidePanouNou(p, opt) {
    if (window.MYD_PANOU_NOU && window.MYD_PANOU_NOU.deschide(p, opt)) return true;
    return false;
  }
  function listaActivare(container, p, opt) {
    var act = p && p.activare;
    if (!container || !act) return null;
    stil();
    var vechi = document.getElementById('myd-activare');
    if (vechi) vechi.remove();
    var gata = act.pasi.filter(function (x) { return x.stare === 'completat' || x.stare === 'in_verificare'; }).length;
    var text = act.complet
      ? (act.verificare === 'approved' ? tr('Activarea contului: mai rămâne contractul.') : tr('Activarea contului e trimisă. Firma e în verificare (cel mult 48 de ore).'))
      : tr('Activarea contului: {n} din {total} pași făcuți.', { n: gata, total: act.pasi.length });
    var b = banda(container, 'info', text, act.complet && act.verificare !== 'approved' ? null : tr('Continuă activarea'), function () { deschideFlux(p, opt); }, 'myd-activare');
    return b;
  }

  // Modul activare: panourile paginii nu apar; în locul lor, explicația.
  function blocheazaPanouri(b) {
    if (!b) return;
    var continut = document.getElementById(b.continut);
    var nav = document.getElementById(b.nav);
    if (nav) nav.style.display = 'none';
    (b.ascunde || []).forEach(function (id) { var e = document.getElementById(id); if (e) e.style.display = 'none'; });
    if (continut) {
      continut.style.display = 'none';
      if (!document.getElementById('myd-blocat')) {
        var n = document.createElement('div');
        n.id = 'myd-blocat';
        n.className = 'myd-blocat';
        n.setAttribute('role', 'note');
        n.textContent = tr('Comenzile, facturile, sarcinile și celelalte secțiuni: disponibil după activarea contului.');
        continut.parentNode.insertBefore(n, continut);
      }
    }
  }

  // ── Vizibilitatea produselor (pasul 10c) ───────────────────────────
  // Lângă produsele furnizorului: de ce nu apar încă public. Motivul vine din
  // regula unică de pe server (lib/eligibilitate-partener.js, prin /api/cont/profil).
  var MESAJ_PRODUSE = {
    in_verificare: 'Produsele tale nu apar încă public: contul e în verificare. Le poți pregăti între timp.',
    respins: 'Produsele tale nu apar public: cererea de partener a fost respinsă.',
    fara_cont_bancar: 'Produsele tale nu apar încă public: adaugă contul bancar.',
    fara_contract: 'Produsele tale nu apar încă public: semnează contractul.',
    suspendat: 'Produsele tale nu apar public: contul este suspendat.',
  };

  function bandaProduse(container, p) {
    var c = typeof container === 'string' ? document.getElementById(container) : container;
    var profil = p || window.__MYD_PROFIL;
    if (!c) return null;
    c.innerHTML = '';
    var pt = profil && profil.partener;
    if (!pt || pt.poate_vinde || !MESAJ_PRODUSE[pt.motiv_nu_poate_vinde]) return null;
    stil();
    var act = actiuniFinale(ultimaOptiune);
    var buton = null;
    var laClick = null;
    if (pt.motiv_nu_poate_vinde === 'fara_cont_bancar') { buton = tr('Adaugă contul bancar'); laClick = act.cont_bancar; }
    if (pt.motiv_nu_poate_vinde === 'fara_contract') { buton = tr('Semnează contractul'); laClick = act.contract; }
    var tip = pt.motiv_nu_poate_vinde === 'respins' || pt.motiv_nu_poate_vinde === 'suspendat' ? 'eroare' : 'atentie';
    return banda(c, tip, tr(MESAJ_PRODUSE[pt.motiv_nu_poate_vinde]), buton, laClick, 'myd-banda-produse');
  }

  // ── Ferestrele comune: cont bancar și contract (pentru paginile fără
  // secțiune proprie, ex. dashboard-ul furnizorului) ─────────────────
  function fereastra(html) {
    var f = document.createElement('div');
    f.className = 'myd-fer';
    f.setAttribute('role', 'dialog');
    f.setAttribute('aria-modal', 'true');
    f.innerHTML = '<div class="myd-fer-cutie">' + html + '</div>';
    f.addEventListener('click', function (e) { if (e.target === f) f.remove(); });
    document.body.appendChild(f);
    return f;
  }

  function fereastraContBancar(dupa) {
    var f = fereastra(
      '<h3>' + esc(tr('Adaugă contul bancar')) + '</h3>' +
      '<p style="font-size:12.5px;color:#5A6B7D;margin:0">' + esc(tr('IBAN-ul se păstrează criptat și nu se mai afișează integral.')) + '</p>' +
      '<label for="myd-cb-titular">' + esc(tr('Titular cont')) + '</label><input id="myd-cb-titular" autocomplete="organization">' +
      '<label for="myd-cb-iban">IBAN</label><input id="myd-cb-iban" style="font-family:monospace" autocomplete="off">' +
      '<label for="myd-cb-banca">' + esc(tr('Bancă')) + '</label><input id="myd-cb-banca">' +
      '<label for="myd-cb-moneda">' + esc(tr('Monedă')) + '</label><select id="myd-cb-moneda"><option>RON</option><option>EUR</option><option>MDL</option><option>BGN</option></select>' +
      '<div class="myd-fer-rand"><button type="button" class="myd-btn-p" id="myd-cb-salveaza">' + esc(tr('Salvează contul')) + '</button>' +
      '<button type="button" class="myd-btn-s" id="myd-cb-inchide">' + esc(tr('Închide')) + '</button></div><div id="myd-cb-msg"></div>');
    var titular = f.querySelector('#myd-cb-titular');
    if (window.__MYD_PROFIL && window.__MYD_PROFIL.partener) titular.value = window.__MYD_PROFIL.partener.nume_firma || '';
    f.querySelector('#myd-cb-inchide').onclick = function () { f.remove(); };
    f.querySelector('#myd-cb-salveaza').onclick = function () {
      var btn = this;
      var corp = {
        nume_titular: titular.value.trim(), iban: f.querySelector('#myd-cb-iban').value.replace(/\s+/g, '').toUpperCase(),
        banca: f.querySelector('#myd-cb-banca').value.trim(), moneda: f.querySelector('#myd-cb-moneda').value,
      };
      window.MDFeedback.salveaza(btn, f.querySelector('#myd-cb-msg'), function () {
        if (!corp.nume_titular || !corp.iban || !corp.banca) throw new Error(tr('Completează titularul, IBAN-ul și banca.'));
        return antetAuth().then(function (h) {
          h['Content-Type'] = 'application/json';
          return fetch('/api/partener/conturi-bancare', { method: 'POST', headers: h, body: JSON.stringify(corp) });
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok) throw new Error(MYD_I18N.eroare(j, 'Nu s-a salvat.'));
            if (typeof dupa === 'function') setTimeout(dupa, 1200);
            return tr('Contul bancar a fost salvat.');
          });
        });
      });
    };
    titular.focus();
  }

  function fereastraContract(dupa) {
    var f = fereastra(
      '<h3>' + esc(tr('Contractul de parteneriat')) + '</h3>' +
      '<div class="myd-fer-contract" id="myd-ct-text">' + esc(tr('Se încarcă…')) + '</div>' +
      '<p style="font-size:12.5px;color:#5A6B7D;margin:12px 0 0">' + esc(tr('Semnezi cu un cod de 6 cifre trimis pe emailul contului.')) + '</p>' +
      '<div class="myd-fer-rand"><button type="button" class="myd-btn-s" id="myd-ct-trimite">' + esc(tr('Trimite codul pe email')) + '</button></div>' +
      '<label for="myd-ct-cod">' + esc(tr('Codul din email')) + '</label><input id="myd-ct-cod" inputmode="numeric" maxlength="6" autocomplete="one-time-code" style="max-width:160px;font-family:monospace">' +
      '<div class="myd-fer-rand"><button type="button" class="myd-btn-p" id="myd-ct-semneaza">' + esc(tr('Confirmă și semnează')) + '</button>' +
      '<button type="button" class="myd-btn-s" id="myd-ct-inchide">' + esc(tr('Închide')) + '</button></div><div id="myd-ct-msg"></div>');
    var msg = f.querySelector('#myd-ct-msg');
    f.querySelector('#myd-ct-inchide').onclick = function () { f.remove(); };
    antetAuth().then(function (h) { return fetch('/api/partener/contract', { headers: h }); })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(MYD_I18N.eroare(j, 'HTTP ' + r.status)); return j; }); })
      .then(function (j) {
        var box = f.querySelector('#myd-ct-text');
        // HTML-ul contractului e generat de server (lib/contract-partener.js), din datele contului.
        box.innerHTML = '<strong>' + esc(j.numar || '') + '</strong> · ' + esc(j.titlu || '') + '<div style="margin-top:8px">' + (j.html || '') + '</div>';
        box.setAttribute('lang', 'ro');
      })
      .catch(function (e) { f.querySelector('#myd-ct-text').textContent = tr('Nu am putut încărca contractul.') + ' ' + tr(e.message); });
    function trimite(url, corp, btn, ok) {
      return window.MDFeedback.salveaza(btn, msg, function () {
        return antetAuth().then(function (h) {
          h['Content-Type'] = 'application/json';
          return fetch(url, { method: 'POST', headers: h, body: JSON.stringify(corp || {}) });
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok) throw new Error(MYD_I18N.eroare(j, 'Nu s-a salvat.'));
            return ok(j);
          });
        });
      }, { textSalveaza: tr('Se trimite…'), textOk: tr('✓ Gata') });
    }
    f.querySelector('#myd-ct-trimite').onclick = function () {
      trimite('/api/partener/contract-trimite-otp', {}, this, function (j) {
        return j.deja_semnat ? tr('Contractul e deja semnat.') : tr('Ți-am trimis codul pe email.');
      });
    };
    f.querySelector('#myd-ct-semneaza').onclick = function () {
      var cod = f.querySelector('#myd-ct-cod').value.trim();
      trimite('/api/partener/contract-confirma-otp', { cod: cod }, this, function () {
        if (typeof dupa === 'function') setTimeout(dupa, 1200);
        return tr('Contractul a fost semnat.');
      });
    };
  }

  function reincarcaBenzi() {
    var c = document.getElementById(ultimaOptiune.container || 'myd-cont-antet');
    return cereProfil(true).then(function (r) {
      if (!r.profil || !c) return;
      window.__MYD_PROFIL = r.profil;
      Array.prototype.forEach.call(c.querySelectorAll('.myd-banda'), function (b) { b.remove(); });
      // Pasul 11-R3: lista „Activează contul” se reface cu starea nouă.
      if (r.profil.activare && !r.profil.activare.activ) listaActivare(c, r.profil, ultimaOptiune);
      else benziPartener(c, r.profil, actiuniFinale(ultimaOptiune));
    });
  }

  function actiuniFinale(opt) {
    var a = opt.actiuni || {};
    return {
      cont_bancar: a.cont_bancar || function () { fereastraContBancar(reincarcaBenzi); },
      contract: a.contract || function () { fereastraContract(reincarcaBenzi); },
    };
  }

  var ultimaOptiune = {};

  /**
   * Verifică accesul la pagina curentă și afișează identitatea + starea contului.
   * @returns {Promise<false|{profil: object|null}>} false = redirect în curs; altfel pagina continuă
   */
  function verifica(optiuni) {
    var opt = optiuni || {};
    ultimaOptiune = opt;
    // Pasul 11-I3: profilul cerut la încărcare cu tokenul din cookie
    // (lib/profil-cont.js) — fără să așteptăm clientul Supabase. Dacă nu există
    // sau serverul nu-l acceptă (ex. 401), drumul obișnuit: clientul, apoi profilul.
    var devreme = window.MYD_PROFIL && typeof window.MYD_PROFIL.devreme === 'function' ? window.MYD_PROFIL.devreme() : null;
    var dinCookie = devreme ? devreme.then(function (r) {
      if (!r || !r.ok) return null;
      return { status: r.status, profil: r.corp || {}, eroare: null };
    }).catch(function () { return null; }) : Promise.resolve(null);
    return dinCookie.then(function (rd) {
      if (rd) return rd;
      return asteaptaAuth().then(function (gata) {
        if (!gata) { if (opt.public) return { status: 0 }; laLogin(); return null; }
        return cereProfil();
      });
    }).then(function (r) {
      if (!r) return false;
      if (r.status === 0) return { profil: null };
      if (r.status === 401) { if (opt.public) return { profil: null }; laLogin(); return false; }
      if (!r.profil) {
        // Profilul nu s-a putut citi: pagina rămâne (API-urile își fac singure verificarea).
        console.warn('[cont-dashboard] profilul nu s-a putut citi:', r.eroare && r.eroare.error);
        return { profil: null };
      }
      var p = r.profil;
      window.__MYD_PROFIL = p;
      var permise = roluriPagina();
      var areRol = permise.filter(function (x) { return p.roles.indexOf(x) !== -1; });
      var admin = p.roles.indexOf('admin') !== -1 || p.roles.indexOf('superadmin') !== -1;

      // Pasul 11-R2: dashboard-ul clientului apare după prima comandă. Fără
      // comenzi → dashboard-ul altui rol, dacă are, altfel pagina principală
      // cu un mesaj scurt (cont-fereastra.js îl afișează).
      if (areRol.length === 1 && areRol[0] === 'client' && permise.length === 1 && p.are_comenzi === false && !admin && !opt.public) {
        var alt = (p.roluri_dashboard || []).length ? tintaCorecta(p) : null;
        if (alt && alt.url) { if (alt.mesaj) ss(CHEIE_MESAJ, alt.mesaj); location.replace(alt.url); return false; }
        ss('myd_mesaj_pagina', 'Dashboard-ul clientului apare după prima ta comandă.');
        location.replace('/');
        return false;
      }

      // Pasul 11-R3: rolul de partener ales, încă neacordat → modul activare.
      var act = p.activare;
      if (!areRol.length && !admin && !opt.public && act && act.mod_activare && permise.indexOf(act.rol) !== -1) {
        var ca = document.getElementById(opt.container || 'myd-cont-antet');
        document.documentElement.classList.add('myd-mod-activare');
        if (ca) {
          stil();
          ca.innerHTML = '';
          antet(ca, p, act.rol, opt.tema);
          listaActivare(ca, p, opt);
        }
        blocheazaPanouri(opt.blocheaza);
        if (!deschidePanouNou(p, opt)) deschideFlux(p, opt);
        return { profil: p, rol: act.rol, activare: true };
      }

      // Pasul 11-I2: rolul ales la înscriere (opt.rolNou, ex. 'investor'), încă
      // neacordat → antetul cu insigna rolului; pagina arată starea „cont nou”.
      if (!areRol.length && !admin && opt.rolNou && p.rol_solicitat === opt.rolNou && permise.indexOf(opt.rolNou) !== -1) {
        var cn = document.getElementById(opt.container || 'myd-cont-antet');
        if (cn) {
          stil();
          cn.innerHTML = '';
          var mesajNou = ss(CHEIE_MESAJ);
          if (mesajNou) { ss(CHEIE_MESAJ, null); banda(cn, 'ok', tr(mesajNou), null, null, 'myd-banda-redirect'); }
          antet(cn, p, opt.rolNou, opt.tema);
        }
        return { profil: p, rol: opt.rolNou, contNou: true };
      }

      if (!areRol.length) {
        if (opt.public) return { profil: p };
        if (!admin) {
          var t = tintaCorecta(p);
          if (t.mesaj) ss(CHEIE_MESAJ, t.mesaj);
          location.replace(t.url);
          return false;
        }
      }

      var rol = areRol[0] || null;
      if (areRol.length > 1 && areRol.indexOf(ls(CHEIE_ROL_ACTIV)) !== -1) rol = ls(CHEIE_ROL_ACTIV);
      if (rol) ls(CHEIE_ROL_ACTIV, rol);

      var c = document.getElementById(opt.container || 'myd-cont-antet');
      if (c) {
        stil();
        c.innerHTML = '';
        var mesaj = ss(CHEIE_MESAJ);
        if (mesaj) { ss(CHEIE_MESAJ, null); banda(c, 'ok', tr(mesaj), null, null, 'myd-banda-redirect'); }
        antet(c, p, rol || (p.roluri_dashboard || [])[0] || 'client', opt.tema);
        var partenerPagina = p.partener && (!rol || rol.indexOf('partener_') === 0);
        // Partenerul încă neactiv: lista „Activează contul” în locul benzilor
        // de cont bancar și contract (respingerea rămâne bandă).
        if (partenerPagina && !opt.public && p.activare && !p.activare.activ) {
          if (p.partener.status_verificare === 'rejected') benziPartener(c, p, actiuniFinale(opt));
          listaActivare(c, p, opt);
          var inchisa = false;
          try { inchisa = sessionStorage.getItem('myd_activare_inchisa') === '1'; } catch (e) {}
          // Pasul 12-P1: panoul „cont nou” în locul pasului „Firma” deschis automat.
          if (!deschidePanouNou(p, opt) && !p.activare.complet && !inchisa) deschideFlux(p, opt);
        } else if (partenerPagina) benziPartener(c, p, actiuniFinale(opt));
      }
      return { profil: p, rol: rol };
    }).catch(function (e) {
      console.error('[cont-dashboard] paza:', e);
      return { profil: null };
    });
  }

  window.MYD_PAZA = { verifica: verifica, laLogin: laLogin, reincarcaBenzi: reincarcaBenzi, bandaProduse: bandaProduse, fereastraContBancar: fereastraContBancar, fereastraContract: fereastraContract, listaActivare: listaActivare, deschideActivare: deschideFlux,
    // Pasul 11-I3: selectorul de limbă, refolosit de antetul activării (activare-pasi.js).
    selectorLimbaHtml: selectorLimbaHtml, leagaSelectorLimba: leagaSelectorLimba };
})();
