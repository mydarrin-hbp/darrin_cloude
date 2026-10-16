/* ════════════════════════════════════════════════════════════════
   MY DARRIN — cont-dashboard.js (MYD_PAZA), pasul 10b (16 oct. 2026)

   Paza comună a dashboard-urilor (client, partener, furnizor, investitori)
   și starea contului:
     - fără sesiune → fereastra de login, cu revenire la pagina cerută;
     - rol greșit → redirect la dashboard-ul corect, cu un mesaj scurt
       („Te-am dus în contul tău de furnizor.”), nu pagină goală;
     - antetul de identitate: inițiale, numele firmei (sau numele din
       profil), emailul, insigna rolului și „Ieși”;
     - banda de stare a contului de partener (verificare, cont bancar,
       contract, respingere), cu butonul spre pasul lipsă;
     - lângă produsele furnizorului, de ce nu apar încă public (pasul 10c,
       MYD_PAZA.bandaProduse).

   Datele vin din /api/cont/profil (profiles.roles). Harta rol → dashboard
   e cea unică, din lib/destinatie-rol.js (window.MYD_DESTINATIE_ROL).
   Paza de aici e doar pentru experiența utilizatorului: accesul real îl
   verifică fiecare endpoint, pe server.

   Utilizare (în scriptul de pază al paginii, după account-system.js):
     const paza = await MYD_PAZA.verifica({ container: 'myd-cont-antet', tema: 'intunecata',
       actiuni: { cont_bancar: () => showPanel('cont-bancar') } });
     if (!paza) return;           // false = redirect în curs (login sau alt dashboard)
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

  function asteaptaAuth() {
    return new Promise(function (ok) {
      var n = 0;
      (function verifica() {
        if (window.MyDarrinAuth && window.supabaseClient) return ok(true);
        if (++n > 60) return ok(false);
        setTimeout(verifica, 100);
      })();
    });
  }

  function sesiune() {
    return window.supabaseClient.auth.getSession().then(function (r) { return (r && r.data && r.data.session) || null; });
  }

  function antetAuth() {
    return sesiune().then(function (s) { return s ? { Authorization: 'Bearer ' + s.access_token } : {}; });
  }

  function cereProfil() {
    return antetAuth().then(function (h) {
      if (!h.Authorization) return { status: 401 };
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
      '.myd-banda{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 14px;border-radius:12px;margin:0 0 12px;font-size:13px;line-height:1.45;border:1.5px solid;box-sizing:border-box;max-width:100%}' +
      '.myd-banda span{flex:1 1 220px;min-width:0}' +
      '.myd-banda button{border:0;border-radius:10px;padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;color:#fff;min-height:38px}' +
      '.myd-banda-info{border-color:#2B6CB0;background:#EBF4FB;color:#1A3A5C}.myd-banda-info button{background:#003366}' +
      '.myd-banda-atentie{border-color:#C77700;background:#FFF6E5;color:#6B4200}.myd-banda-atentie button{background:#CC7000}' +
      '.myd-banda-eroare{border-color:#C0392B;background:#FDECEA;color:#7A1F16}.myd-banda-eroare button{background:#C0392B}' +
      '.myd-banda-ok{border-color:#1A7A3A;background:#EDF7F0;color:#14532D}' +
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
      '<button type="button" class="myd-id-iesi" id="myd-id-iesi">' + esc(tr('Ieși')) + '</button>';
    container.appendChild(div);
    div.querySelector('#myd-id-iesi').onclick = function () { window.MyDarrinAuth.performLogout(); };
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
    if (!pt.cont_bancar) {
      banda(container, 'atentie', tr('Adaugă contul bancar pentru plăți.'), tr('Adaugă contul bancar'), actiuni.cont_bancar, 'myd-banda-cont-bancar');
    }
    if (st === 'approved' && !pt.contract_semnat) {
      banda(container, 'atentie', tr('Semnează contractul ca să primești comenzi.'), tr('Semnează contractul'), actiuni.contract, 'myd-banda-contract');
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
            if (!r.ok) throw new Error(tr(j.error || 'Nu s-a salvat.'));
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
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; }); })
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
            if (!r.ok) throw new Error(tr(j.error || 'Nu s-a salvat.'));
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
    return cereProfil().then(function (r) {
      if (!r.profil || !c) return;
      window.__MYD_PROFIL = r.profil;
      Array.prototype.forEach.call(c.querySelectorAll('.myd-banda'), function (b) { b.remove(); });
      benziPartener(c, r.profil, actiuniFinale(ultimaOptiune));
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
    return asteaptaAuth().then(function (gata) {
      if (!gata) { if (opt.public) return { status: 0 }; laLogin(); return null; }
      return cereProfil();
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
        if (p.partener && (!rol || rol.indexOf('partener_') === 0)) benziPartener(c, p, actiuniFinale(opt));
      }
      return { profil: p, rol: rol };
    }).catch(function (e) {
      console.error('[cont-dashboard] paza:', e);
      return { profil: null };
    });
  }

  window.MYD_PAZA = { verifica: verifica, laLogin: laLogin, reincarcaBenzi: reincarcaBenzi, bandaProduse: bandaProduse, fereastraContBancar: fereastraContBancar, fereastraContract: fereastraContract };
})();
