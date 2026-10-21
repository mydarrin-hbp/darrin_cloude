/* ════════════════════════════════════════════════════════════════
   MY DARRIN — investitori-ruta.js (MYD_INVESTITOR), pasul 11-L (17 oct. 2026)

   Ruta de investitor, legată de cont, pe mydarrin-investitori.html:
     - fără sesiune: „Devino investitor” cere autentificarea sau crearea
       contului (account-system.js), apoi utilizatorul revine automat aici
       (?ruta=investitor);
     - cu sesiune: fereastra în 5 pași, cu datele contului precompletate:
         1. date personale și cont bancar (IBAN verificat MOD-97);
         2. verificarea identității: tipul documentului, fața și verso-ul
            (sau pagina cu fotografia, la pașaport), încărcate cu adevărat,
            privat (api/investitori/kyc-document.js), cu previzualizare,
            ștergere și înlocuire;
         3. chestionarul de profil de risc (MiFID II), declarațiile PEP și sancțiuni;
         4. rezidența fiscală;
         5. confirmarea: rolul `investor` îl adaugă serverul și dosarul intră
            în verificare (api/investitori/kyc.js).
     - progresul se salvează pe server la fiecare „Continuă”: cine revine
       continuă de unde a rămas (nu sessionStorage);
     - fereastra se închide cu X, Esc, clic pe fundal (cu confirmare dacă sunt
       date nesalvate), „Înapoi” și „Continuă mai târziu”; la închidere,
       derularea paginii revine și focusul se întoarce pe butonul care a
       deschis-o. La 390 px, fereastra se derulează în interior, iar butoanele
       rămân vizibile.
     - cu rolul de investitor deja pe cont: „Intră în rundă” deschide
       subscrierea (fereastra existentă, legată acum de cont:
       api/investitori/subscrie.js).

   Textele sunt în română, cu traducerile EN în i18n/en/mydarrin-investitori.json.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_INVESTITOR) return;

  var CHEIE_REVENIRE = 'myd_revenire_dupa_login';
  var ADRESA_RUTEI = '/mydarrin-investitori.html?ruta=investitor';
  var BUCKET = 'investitori-kyc';
  var MARIME_MAXIMA = 5 * 1024 * 1024;
  var TIPURI = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'application/pdf': 1 };
  var PASI = ['Date personale', 'Identitate', 'Profil de risc', 'Rezidență fiscală', 'Confirmare'];
  var MIFID = [
    { cheie: 'experienta', q: 'Experiența în investiții', opt: ['0-1 ani', '2-5 ani', '5+ ani'] },
    { cheie: 'toleranta', q: 'Toleranța la pierderi', opt: ['0-10%', '10-30%', '30-100%'] },
    { cheie: 'scop', q: 'Scopul investiției', opt: ['Siguranța capitalului', 'Creștere moderată', 'Randament maxim'] },
  ];
  // Țările din listă (cod ISO); numele vin din Intl.DisplayNames, în limba paginii.
  var TARI = ['RO', 'MD', 'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'SK', 'SI', 'ES', 'SE',
    'GB', 'CH', 'NO', 'IS', 'LI', 'UA', 'RS', 'TR', 'IL', 'AE', 'US', 'CA', 'AU'];

  // ── Utilitare ────────────────────────────────────────────────────────
  function tr(ro, p) {
    if (typeof window.t === 'function') return window.t(null, ro, p);
    return String(ro).replace(/\{(\w+)\}/g, function (m, k) { return p && p[k] != null ? p[k] : m; });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lang() { return (window.MYD_I18N && window.MYD_I18N.lang) || 'en'; }
  function enLang() { return lang() !== 'ro'; }
  function mesajServer(j, implicit) { return (enLang() && j && j.error_en) || (j && j.error) || tr(implicit); }
  function el(id) { return document.getElementById(id); }
  function numeTara(cod) {
    try { return new Intl.DisplayNames([lang() === 'ro' ? 'ro' : 'en'], { type: 'region' }).of(cod) || cod; } catch (e) { return cod; }
  }
  function ibanValid(v) {
    var s = String(v || '').replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    var n = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, function (c) { return String(c.charCodeAt(0) - 55); });
    var r = 0;
    for (var i = 0; i < n.length; i += 7) r = Number(String(r) + n.slice(i, i + 7)) % 97;
    return r === 1;
  }

  function asteaptaClient() {
    return new Promise(function (ok) {
      var n = 0;
      (function v() { if (window.supabaseClient || n++ > 50) return ok(!!window.supabaseClient); setTimeout(v, 100); })();
    });
  }
  function sesiune() {
    return asteaptaClient().then(function (are) {
      if (!are) return null;
      return window.supabaseClient.auth.getSession().then(function (r) { return (r && r.data && r.data.session) || null; });
    });
  }
  function api(url, optiuni) {
    return sesiune().then(function (s) {
      if (!s) { var e = new Error(tr('Sesiunea a expirat. Autentifică-te din nou.')); e.status = 401; throw e; }
      var o = optiuni || {};
      var h = { Authorization: 'Bearer ' + s.access_token };
      if (o.corp !== undefined) h['Content-Type'] = 'application/json';
      return fetch(url, { method: o.metoda || 'GET', headers: h, body: o.corp !== undefined ? JSON.stringify(o.corp) : undefined, cache: 'no-store' })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok) { var e = new Error(mesajServer(j, 'Nu am putut salva. Încearcă din nou.')); e.status = r.status; e.corp = j; throw e; }
            return j;
          });
        });
    });
  }

  // ── Stil ─────────────────────────────────────────────────────────────
  function stil() {
    if (el('mi-stil')) return;
    var s = document.createElement('style');
    s.id = 'mi-stil';
    s.textContent =
      '.mi-fond{position:fixed;inset:0;z-index:9700;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}' +
      '.mi-fer{background:#fff;color:#1A2332;border-radius:20px;width:100%;max-width:620px;max-height:calc(100vh - 32px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.3);font-family:inherit}' +
      '.mi-cap{background:linear-gradient(135deg,#003366,#1A5FAD);color:#fff;padding:16px 18px;display:flex;gap:12px;align-items:flex-start;flex:0 0 auto}' +
      '.mi-cap h2{margin:0;font-size:17px;font-weight:800}.mi-cap p{margin:3px 0 0;font-size:12px;color:rgba(255,255,255,.75)}' +
      '.mi-x{margin-left:auto;flex:0 0 auto;width:44px;height:44px;border-radius:10px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:#fff;font-size:22px;cursor:pointer;line-height:1}' +
      '.mi-progres{display:flex;gap:4px;padding:12px 18px 0;flex:0 0 auto}.mi-progres span{flex:1;height:6px;border-radius:99px;background:#E2E8F0}.mi-progres span.facut{background:#0E9E99}.mi-progres span.curent{background:#FF8C00}' +
      '.mi-corp{padding:16px 18px;overflow-y:auto;flex:1 1 auto;min-height:0}' +
      '.mi-jos{padding:12px 18px 16px;border-top:1px solid #EEF2F7;display:flex;flex-wrap:wrap;gap:8px;align-items:center;flex:0 0 auto;background:#fff}' +
      '.mi-jos button{min-height:44px;border-radius:12px;padding:10px 16px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit}' +
      '.mi-p{background:#FF8C00;color:#fff;border:0;margin-left:auto}.mi-p:disabled{opacity:.6;cursor:not-allowed}' +
      '.mi-s{background:#fff;color:#003366;border:1.5px solid #D5DFE8}' +
      '.mi-msg{flex:1 1 100%}' +
      '.mi-camp{margin-bottom:12px}.mi-camp label,.mi-eticheta{display:block;font-size:11.5px;font-weight:700;color:#5A6B7D;margin-bottom:5px}' +
      '.mi-camp input,.mi-camp select{width:100%;box-sizing:border-box;border:1.5px solid #D5DFE8;border-radius:10px;padding:10px 12px;font-size:14px;font-family:inherit;min-height:44px;background:#fff}' +
      '.mi-camp input[readonly]{background:#F4F7F9;color:#5A6B7D}' +
      '.mi-doua{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:480px){.mi-doua{grid-template-columns:1fr}}' +
      '.mi-nota{font-size:12px;color:#5A6B7D;line-height:1.55;background:#F4F7F9;border-radius:10px;padding:10px 12px;margin:0 0 12px}' +
      '.mi-optiuni{display:flex;flex-wrap:wrap;gap:6px}.mi-optiuni label{display:inline-flex;align-items:center;gap:6px;border:1.5px solid #D5DFE8;border-radius:10px;padding:8px 12px;font-size:13px;cursor:pointer;min-height:44px;box-sizing:border-box}' +
      '.mi-optiuni input{accent-color:#003366;width:16px;height:16px}' +
      '.mi-bifa{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.5;margin:10px 0;cursor:pointer}.mi-bifa input{width:18px;height:18px;margin-top:2px;accent-color:#FF8C00;flex:0 0 auto}' +
      '.mi-slot{border:2px dashed #D5DFE8;border-radius:12px;padding:12px;margin-bottom:12px;background:#F8FAFC}' +
      '.mi-slot-cap{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}.mi-slot-cap strong{font-size:13px}' +
      '.mi-slot-btn{display:flex;gap:6px;flex-wrap:wrap}.mi-slot-btn button,.mi-slot-btn label{min-height:40px;border-radius:9px;padding:8px 12px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;border:1.5px solid #D5DFE8;background:#fff;color:#003366;display:inline-flex;align-items:center}' +
      '.mi-previz{display:flex;align-items:center;gap:10px;min-height:44px;font-size:12.5px;color:#5A6B7D;overflow-wrap:anywhere}.mi-previz img{max-width:120px;max-height:90px;border-radius:8px;border:1px solid #E2E8F0;object-fit:cover}' +
      '.mi-pdf{display:inline-flex;align-items:center;justify-content:center;width:56px;height:70px;border-radius:8px;background:#FDECEA;color:#C0392B;font-weight:800;font-size:12px;flex:0 0 auto}' +
      '.mi-err{color:#C0392B;font-size:12.5px;margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.mi-err button{min-height:36px;border-radius:8px;border:1.5px solid #C0392B;background:#fff;color:#C0392B;font-weight:700;padding:6px 10px;cursor:pointer;font-family:inherit}' +
      '.mi-rez{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #EEF2F7;font-size:13px}.mi-rez span:last-child{font-weight:700;text-align:right}' +
      '.mi-ok{color:#1A7A3A}.mi-lipsa{color:#C0392B}' +
      '.mi-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}';
    (document.head || document.documentElement).appendChild(s);
  }

  // ── Starea ferestrei ────────────────────────────────────────────────
  var st = null; // { pas, kyc, cont, lipsa, murdar, deschizator, fisiere: {fata, verso}, tip }

  function inchide(fortat) {
    if (!st) return true;
    if (!fortat && st.murdar && !window.confirm(tr('Ai date nesalvate. Închizi fereastra fără să le salvezi?'))) return false;
    var f = el('mi-fond');
    if (f) f.remove();
    document.body.style.overflow = st.overflowVechi || '';
    document.removeEventListener('keydown', laTasta, true);
    var d = st.deschizator;
    Object.keys(st.fisiere || {}).forEach(function (k) { var x = st.fisiere[k]; if (x && x.urlLocal) URL.revokeObjectURL(x.urlLocal); });
    st = null;
    if (d && typeof d.focus === 'function' && document.contains(d)) d.focus();
    return true;
  }
  function laTasta(e) {
    if (e.key === 'Escape' && st) { e.preventDefault(); e.stopPropagation(); inchide(false); }
    if (e.key === 'Tab' && st) {
      // focusul rămâne în fereastră
      var f = el('mi-fer');
      if (!f) return;
      var focusabile = Array.prototype.filter.call(f.querySelectorAll('button,a[href],input,select,textarea,label[tabindex]'), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!focusabile.length) return;
      var prim = focusabile[0], ultim = focusabile[focusabile.length - 1];
      if (e.shiftKey && document.activeElement === prim) { e.preventDefault(); ultim.focus(); }
      else if (!e.shiftKey && document.activeElement === ultim) { e.preventDefault(); prim.focus(); }
    }
  }

  function construiesteFereastra() {
    stil();
    var f = document.createElement('div');
    f.className = 'mi-fond';
    f.id = 'mi-fond';
    f.innerHTML =
      '<div class="mi-fer" id="mi-fer" role="dialog" aria-modal="true" aria-labelledby="mi-titlu">' +
        '<div class="mi-cap"><div><h2 id="mi-titlu">' + esc(tr('Devino investitor')) + '</h2><p id="mi-subtitlu"></p></div>' +
        '<button type="button" class="mi-x" id="mi-x" aria-label="' + esc(tr('Închide')) + '">×</button></div>' +
        '<div class="mi-progres" id="mi-progres" aria-hidden="true">' + PASI.map(function () { return '<span></span>'; }).join('') + '</div>' +
        '<div class="mi-corp" id="mi-corp"></div>' +
        '<div class="mi-jos"><button type="button" class="mi-s" id="mi-inapoi">' + esc(tr('Înapoi')) + '</button>' +
        '<button type="button" class="mi-s" id="mi-mai-tarziu">' + esc(tr('Continuă mai târziu')) + '</button>' +
        '<button type="button" class="mi-p" id="mi-continua">' + esc(tr('Continuă')) + '</button>' +
        '<div class="mi-msg" id="mi-msg"></div></div>' +
      '</div>';
    document.body.appendChild(f);
    f.addEventListener('mousedown', function (e) { if (e.target === f) inchide(false); });
    el('mi-x').onclick = function () { inchide(false); };
    el('mi-inapoi').onclick = function () {
      if (st.pas === 1) { inchide(false); return; }
      if (st.murdar && !window.confirm(tr('Ai date nesalvate pe acest pas. Te întorci fără să le salvezi?'))) return;
      st.murdar = false;
      arataPas(st.pas - 1);
    };
    el('mi-mai-tarziu').onclick = maiTarziu;
    el('mi-continua').onclick = continua;
    el('mi-corp').addEventListener('input', function () { st.murdar = true; });
    el('mi-corp').addEventListener('change', function () { st.murdar = true; });
    document.addEventListener('keydown', laTasta, true);
  }

  function arataPas(n) {
    st.pas = n;
    el('mi-subtitlu').textContent = tr('Pasul {n} din {total} · {nume}', { n: n, total: PASI.length, nume: tr(PASI[n - 1]) });
    Array.prototype.forEach.call(el('mi-progres').children, function (s, i) { s.className = i + 1 < n ? 'facut' : i + 1 === n ? 'curent' : ''; });
    el('mi-inapoi').textContent = n > 1 ? tr('Înapoi') : tr('Închide');
    el('mi-continua').textContent = n === PASI.length ? tr('Trimite pentru verificare') : tr('Continuă');
    el('mi-msg').innerHTML = '';
    var corp = el('mi-corp');
    corp.innerHTML = [null, pas1, pas2, pas3, pas4, pas5][n]();
    corp.scrollTop = 0;
    if (n === 2) legaturiPas2();
    var prim = corp.querySelector('input:not([readonly]),select,button');
    if (prim) prim.focus(); else el('mi-x').focus();
  }

  // ── Pașii ───────────────────────────────────────────────────────────
  function camp(id, eticheta, valoare, atribute) {
    return '<div class="mi-camp"><label for="' + id + '">' + esc(tr(eticheta)) + '</label><input id="' + id + '" value="' + esc(valoare || '') + '" ' + (atribute || '') + '></div>';
  }
  function selectTara(id, eticheta, valoare) {
    var lista = TARI.map(function (c) { return { c: c, n: numeTara(c) }; }).sort(function (a, b) { return a.n.localeCompare(b.n); });
    return '<div class="mi-camp"><label for="' + id + '">' + esc(tr(eticheta)) + '</label><select id="' + id + '"><option value="">' + esc(tr('Alege țara')) + '</option>' +
      lista.map(function (x) { return '<option value="' + x.c + '"' + (x.c === valoare ? ' selected' : '') + ' translate="no">' + esc(x.n) + '</option>'; }).join('') + '</select></div>';
  }

  function pas1() {
    var d = (st.kyc && st.kyc.date_personale) || {};
    var c = st.cont || {};
    return '<p class="mi-nota">' + esc(tr('Datele contului tău sunt precompletate. Contul bancar e cel în care primești distribuțiile și sumele din exit.')) + '</p>' +
      '<div class="mi-doua">' + camp('mi-prenume', 'Prenume', d.prenume || c.prenume, 'autocomplete="given-name"') + camp('mi-nume', 'Nume', d.nume || c.nume, 'autocomplete="family-name"') + '</div>' +
      '<div class="mi-doua">' + camp('mi-email', 'Email', c.email, 'readonly') + camp('mi-telefon', 'Telefon', d.telefon || c.telefon, 'type="tel" autocomplete="tel"') + '</div>' +
      selectTara('mi-tara', 'Țara', d.tara || c.tara) +
      camp('mi-iban', 'IBAN', '', 'autocomplete="off" spellcheck="false" placeholder="' + esc(st.kyc && st.kyc.iban_mascat ? tr('Lasă gol ca să păstrezi contul salvat') : 'RO49 AAAA 1B31 0075 9384 0000') + '"') +
      (st.kyc && st.kyc.iban_mascat ? '<p class="mi-nota">' + esc(tr('Cont bancar salvat:')) + ' <span translate="no">' + esc(st.kyc.iban_mascat) + '</span></p>' : '') +
      '<p class="mi-nota">' + esc(tr('IBAN-ul se verifică și se păstrează criptat; după salvare vezi doar ultimele 4 cifre.')) + '</p>';
  }

  function pas2() {
    var tip = st.tip || (st.kyc && st.kyc.tip_document) || '';
    var tipuri = [['ci', 'Carte de identitate'], ['pasaport', 'Pașaport'], ['permis_sedere', 'Permis de ședere']];
    return '<p class="mi-nota">' + esc(tr('Documentele se păstrează privat și le verifică manual echipa My Darrin. Verificarea identității e obligatorie pentru orice investitor.')) + '</p>' +
      '<span class="mi-eticheta" id="mi-tip-et">' + esc(tr('Tipul documentului')) + '</span>' +
      '<div class="mi-optiuni" role="radiogroup" aria-labelledby="mi-tip-et" style="margin-bottom:14px">' + tipuri.map(function (x) {
        return '<label><input type="radio" name="mi-tip" value="' + x[0] + '"' + (x[0] === tip ? ' checked' : '') + '> ' + esc(tr(x[1])) + '</label>';
      }).join('') + '</div>' +
      '<div id="mi-sloturi"></div>' +
      '<p class="mi-nota">' + esc(tr('Fișiere acceptate: JPEG, PNG, WEBP sau PDF, cel mult 5 MB fiecare.')) + '</p>';
  }

  function slot(latura) {
    var pasaport = st.tip === 'pasaport';
    var titlu = latura === 'fata' ? (pasaport ? 'Pagina cu fotografia' : 'Fața documentului') : 'Verso-ul documentului';
    var x = st.fisiere[latura];
    var previz;
    if (x && x.incarca) previz = '<span>' + esc(tr('Se încarcă…')) + '</span>';
    else if (x && x.urlLocal && x.mime !== 'application/pdf') previz = '<img src="' + esc(x.urlLocal) + '" alt="' + esc(tr(titlu)) + '"><span translate="no">' + esc(x.nume || '') + '</span>';
    else if (x && (x.mime === 'application/pdf' || x.salvat)) previz = (x.mime === 'application/pdf' ? '<span class="mi-pdf">PDF</span>' : '') + '<span>' + (x.nume ? '<span translate="no">' + esc(x.nume) + '</span>' : esc(tr('Fișier încărcat'))) + '</span>' +
      (x.cale ? ' <button type="button" class="mi-s" data-vezi="' + latura + '" style="min-height:36px;border-radius:8px;padding:6px 10px;font-weight:700;cursor:pointer;font-family:inherit">' + esc(tr('Vezi')) + '</button>' : '');
    else previz = '<span>' + esc(tr('Niciun fișier încărcat.')) + '</span>';
    var areFisier = x && (x.cale || x.urlLocal) && !x.incarca;
    return '<div class="mi-slot" data-latura="' + latura + '"><div class="mi-slot-cap"><strong>' + esc(tr(titlu)) + '</strong><div class="mi-slot-btn">' +
      '<label tabindex="0" for="mi-fisier-' + latura + '">' + esc(tr(areFisier ? 'Înlocuiește' : 'Alege fișierul')) + '</label>' +
      (areFisier ? '<button type="button" data-sterge="' + latura + '">' + esc(tr('Șterge')) + '</button>' : '') +
      '</div></div><input type="file" id="mi-fisier-' + latura + '" class="mi-sr" accept="image/jpeg,image/png,image/webp,application/pdf">' +
      '<div class="mi-previz">' + previz + '</div>' +
      (x && x.eroare ? '<div class="mi-err" role="alert"><span>' + esc(x.eroare) + '</span>' + (x.fisierPentruReincercare ? '<button type="button" data-reincearca="' + latura + '">' + esc(tr('Reîncearcă')) + '</button>' : '') + '</div>' : '') +
      '</div>';
  }

  function deseneazaSloturi() {
    var c = el('mi-sloturi');
    if (!c) return;
    if (!st.tip) { c.innerHTML = '<p class="mi-nota">' + esc(tr('Alege mai întâi tipul documentului.')) + '</p>'; return; }
    c.innerHTML = slot('fata') + (st.tip === 'pasaport' ? '' : slot('verso'));
    ['fata', 'verso'].forEach(function (l) {
      var inp = el('mi-fisier-' + l);
      if (inp) inp.onchange = function () { if (inp.files && inp.files[0]) incarca(l, inp.files[0]); };
    });
    Array.prototype.forEach.call(c.querySelectorAll('label[tabindex]'), function (lb) {
      lb.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lb.click(); } });
    });
    Array.prototype.forEach.call(c.querySelectorAll('[data-sterge]'), function (b) { b.onclick = function () { sterge(b.getAttribute('data-sterge')); }; });
    Array.prototype.forEach.call(c.querySelectorAll('[data-reincearca]'), function (b) {
      b.onclick = function () { var l = b.getAttribute('data-reincearca'); incarca(l, st.fisiere[l].fisierPentruReincercare); };
    });
    Array.prototype.forEach.call(c.querySelectorAll('[data-vezi]'), function (b) { b.onclick = function () { vezi(b.getAttribute('data-vezi')); }; });
  }

  function legaturiPas2() {
    if (!st.tip && st.kyc && st.kyc.tip_document) st.tip = st.kyc.tip_document;
    Array.prototype.forEach.call(document.querySelectorAll('input[name="mi-tip"]'), function (r) {
      r.onchange = function () { st.tip = r.value; st.murdar = true; deseneazaSloturi(); };
    });
    deseneazaSloturi();
  }

  function eroareSlot(latura, text, fisier) {
    st.fisiere[latura] = Object.assign({}, st.fisiere[latura] || {}, { incarca: false, eroare: text, fisierPentruReincercare: fisier || null });
    deseneazaSloturi();
  }

  function incarca(latura, fisier) {
    if (!fisier) return;
    if (!TIPURI[fisier.type]) return eroareSlot(latura, tr('Tip de fișier neacceptat. Folosește JPEG, PNG, WEBP sau PDF.'));
    if (fisier.size > MARIME_MAXIMA) return eroareSlot(latura, tr('Fișierul e prea mare: cel mult 5 MB.'));
    if (!fisier.size) return eroareSlot(latura, tr('Fișierul e gol.'));
    var vechi = st.fisiere[latura];
    st.fisiere[latura] = { incarca: true };
    deseneazaSloturi();
    api('/api/investitori/kyc-document', { metoda: 'POST', corp: { latura: latura, mime: fisier.type, marime: fisier.size } })
      .then(function (j) {
        return window.supabaseClient.storage.from(BUCKET).uploadToSignedUrl(j.path, j.token, fisier, { contentType: fisier.type })
          .then(function (r) {
            if (r && r.error) throw new Error(tr('Încărcarea a eșuat.'));
            // fișierul vechi (înlocuit) se șterge de pe server
            if (vechi && vechi.cale && vechi.cale !== j.path) api('/api/investitori/kyc-document?path=' + encodeURIComponent(vechi.cale), { metoda: 'DELETE' }).catch(function () {});
            if (vechi && vechi.urlLocal) URL.revokeObjectURL(vechi.urlLocal);
            st.fisiere[latura] = { cale: j.path, nume: fisier.name, mime: fisier.type, urlLocal: fisier.type !== 'application/pdf' ? URL.createObjectURL(fisier) : null };
            st.murdar = true;
            deseneazaSloturi();
          });
      })
      .catch(function (e) {
        st.fisiere[latura] = vechi || null;
        eroareSlot(latura, (e && e.message) || tr('Încărcarea a eșuat.'), fisier);
      });
  }

  function sterge(latura) {
    var x = st.fisiere[latura];
    if (!x) return;
    var gata = function () {
      if (x.urlLocal) URL.revokeObjectURL(x.urlLocal);
      st.fisiere[latura] = null;
      st.murdar = true;
      deseneazaSloturi();
    };
    if (!x.cale) return gata();
    api('/api/investitori/kyc-document?path=' + encodeURIComponent(x.cale), { metoda: 'DELETE' })
      .then(function () {
        if (st.kyc) { if (latura === 'fata') st.kyc.document_fata = false; else st.kyc.document_verso = false; }
        gata();
      })
      .catch(function (e) { eroareSlot(latura, (e && e.message) || tr('Fișierul nu a putut fi șters.')); });
  }

  function vezi(latura) {
    var x = st.fisiere[latura];
    if (!x || !x.cale) return;
    api('/api/investitori/kyc-document?path=' + encodeURIComponent(x.cale))
      .then(function (j) { window.open(j.url, '_blank', 'noopener'); })
      .catch(function (e) { eroareSlot(latura, (e && e.message) || tr('Fișierul nu a putut fi deschis.')); });
  }

  function pas3() {
    var m = (st.kyc && st.kyc.mifid_raspunsuri) || {};
    var pep = st.kyc && st.kyc.pep_declaratie;
    return '<p class="mi-nota">' + esc(tr('Chestionarul de profil de risc (MiFID II) ne arată cât de potrivită e o investiție într-o companie la început de drum pentru tine.')) + '</p>' +
      MIFID.map(function (item, i) {
        return '<span class="mi-eticheta" id="mi-q' + i + '">' + esc(tr(item.q)) + '</span><div class="mi-optiuni" role="radiogroup" aria-labelledby="mi-q' + i + '" style="margin-bottom:12px">' +
          item.opt.map(function (o, j) { return '<label><input type="radio" name="mi-' + item.cheie + '" value="' + j + '"' + (m[item.cheie] === j ? ' checked' : '') + '> ' + esc(tr(o)) + '</label>'; }).join('') + '</div>';
      }).join('') +
      '<span class="mi-eticheta" id="mi-pep-et">' + esc(tr('Persoană expusă politic (PEP)')) + '</span>' +
      '<div class="mi-optiuni" role="radiogroup" aria-labelledby="mi-pep-et">' +
        '<label><input type="radio" name="mi-pep" value="nu"' + (pep && pep.este_pep === false ? ' checked' : '') + '> ' + esc(tr('Nu sunt o persoană expusă politic')) + '</label>' +
        '<label><input type="radio" name="mi-pep" value="da"' + (pep && pep.este_pep === true ? ' checked' : '') + '> ' + esc(tr('Sunt o persoană expusă politic')) + '</label></div>' +
      camp('mi-pep-functie', 'Funcția publică (dacă ești PEP)', pep && pep.functie, '') +
      '<label class="mi-bifa"><input type="checkbox" id="mi-sanctiuni"' + (st.kyc && st.kyc.sanctiuni_declarat ? ' checked' : '') + '><span>' +
        esc(tr('Declar că nu fac obiectul sancțiunilor internaționale (UE, ONU, OFAC) și că nu acționez în numele unei alte persoane nedeclarate.')) + '</span></label>';
  }

  function pas4() {
    return '<p class="mi-nota">' + esc(tr('Rezidența fiscală e țara în care plătești impozitele. O salvăm în profilul tău de investitor.')) + '</p>' +
      selectTara('mi-rezidenta', 'Țara rezidenței fiscale', st.kyc && st.kyc.rezidenta_fiscala_tara);
  }

  var NUME_LIPSA = {
    date_personale: 'Date personale', cont_bancar: 'Cont bancar', tip_document: 'Tipul documentului',
    document_fata: 'Fața documentului', document_verso: 'Verso-ul documentului', mifid: 'Profil de risc',
    pep: 'Declarația PEP', sanctiuni: 'Declarația privind sancțiunile', rezidenta_fiscala: 'Rezidență fiscală',
  };
  function pas5() {
    var lipsa = st.lipsa || [];
    var randuri = Object.keys(NUME_LIPSA).map(function (k) {
      if (k === 'document_verso' && st.kyc && st.kyc.tip_document === 'pasaport') return '';
      var ok = lipsa.indexOf(k) === -1;
      return '<div class="mi-rez"><span>' + esc(tr(NUME_LIPSA[k])) + '</span><span class="' + (ok ? 'mi-ok' : 'mi-lipsa') + '">' + esc(tr(ok ? 'Complet' : 'Lipsește')) + '</span></div>';
    }).join('');
    return '<p class="mi-nota">' + esc(tr('Verifică pașii. După trimitere, rolul de investitor se adaugă pe contul tău, iar verificarea identității intră la echipa My Darrin. Te anunțăm prin email.')) + '</p>' +
      randuri +
      '<label class="mi-bifa"><input type="checkbox" id="mi-confirma"><span>' + esc(tr('Confirm că datele sunt corecte și complete.')) + '</span></label>';
  }

  // ── Salvarea pașilor ───────────────────────────────────────────────
  function bifat(nume) { var x = document.querySelector('input[name="' + nume + '"]:checked'); return x ? x.value : null; }

  function datePas(n) {
    if (n === 1) {
      var iban = el('mi-iban').value.replace(/\s+/g, '').toUpperCase();
      if (iban && !ibanValid(iban)) throw new Error(tr('IBAN invalid: verifică cifrele.'));
      return { prenume: el('mi-prenume').value, nume: el('mi-nume').value, telefon: el('mi-telefon').value, tara: el('mi-tara').value, iban: iban };
    }
    if (n === 2) {
      return { tip_document: st.tip, document_fata_path: st.fisiere.fata && st.fisiere.fata.cale, document_verso_path: st.fisiere.verso && st.fisiere.verso.cale };
    }
    if (n === 3) {
      var mifid = {};
      MIFID.forEach(function (item) { var v = bifat('mi-' + item.cheie); mifid[item.cheie] = v == null ? null : Number(v); });
      var pep = bifat('mi-pep');
      return { mifid: mifid, este_pep: pep == null ? null : pep === 'da', pep_functie: el('mi-pep-functie').value, sanctiuni_declarat: el('mi-sanctiuni').checked };
    }
    if (n === 4) return { rezidenta_fiscala_tara: el('mi-rezidenta').value };
    return { confirma: el('mi-confirma').checked };
  }

  function salveazaPas() {
    var n = st.pas;
    var date;
    try { date = datePas(n); } catch (e) { return Promise.reject(e); }
    return api('/api/investitori/kyc', { metoda: 'POST', corp: { pas: n, date: date } }).then(function (j) {
      st.kyc = j.kyc; st.lipsa = j.lipsa || []; st.murdar = false;
      return j;
    });
  }

  function continua() {
    var n = st.pas;
    var buton = el('mi-continua');
    window.MDFeedback.salveaza(buton, el('mi-msg'), function () {
      return salveazaPas().then(function (j) {
        if (n === PASI.length) {
          setTimeout(function () { inchide(true); window.location.href = '/mydarrin-investitori.html?bun_venit=1#inv-private-dashboard'; }, 900);
          return tr('Dosarul a fost trimis. Rolul de investitor e pe contul tău.');
        }
        setTimeout(function () { if (st) arataPas(n + 1); }, 450);
        return tr('Salvat.');
      });
    }, { textSalveaza: n === PASI.length ? 'Se trimite…' : 'Se salvează…' });
  }

  function maiTarziu() {
    if (!st.murdar) { inchide(true); toast(tr('Progresul tău e salvat. Poți continua oricând de aici sau din „Rolurile mele”.')); return; }
    window.MDFeedback.salveaza(el('mi-mai-tarziu'), el('mi-msg'), function () {
      return salveazaPas().then(function () {
        setTimeout(function () { inchide(true); toast(tr('Progresul tău e salvat. Poți continua oricând de aici sau din „Rolurile mele”.')); }, 600);
        return tr('Salvat.');
      });
    });
  }

  function toast(text) {
    var t = document.createElement('div');
    t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9650;background:#1A2332;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:600;max-width:calc(100vw - 32px);box-sizing:border-box;text-align:center';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  // ── Deschiderea ────────────────────────────────────────────────────
  function deschideRuta(deschizator, pasCerut) {
    return api('/api/investitori/kyc').then(function (j) {
      var kyc = j.kyc;
      if (kyc && kyc.status && kyc.status !== 'ciorna' && kyc.status !== 'respins') {
        toast(tr('Dosarul tău e trimis și e în verificare sau aprobat. Pentru modificări, scrie-ne din pagina Contact.'));
        return;
      }
      if (st) inchide(true);
      st = {
        pas: 1, kyc: kyc, cont: j.cont || {}, lipsa: j.lipsa || [], murdar: false,
        deschizator: deschizator || document.activeElement, overflowVechi: document.body.style.overflow,
        fisiere: {
          fata: kyc && kyc.document_fata_path ? { salvat: true, cale: kyc.document_fata_path, mime: /\.pdf$/.test(kyc.document_fata_path) ? 'application/pdf' : null } : null,
          verso: kyc && kyc.document_verso_path ? { salvat: true, cale: kyc.document_verso_path, mime: /\.pdf$/.test(kyc.document_verso_path) ? 'application/pdf' : null } : null,
        },
        tip: kyc && kyc.tip_document,
      };
      construiesteFereastra();
      document.body.style.overflow = 'hidden';
      var pas = pasCerut || (kyc && kyc.pas_curent) || 1;
      arataPas(Math.min(Math.max(pas, 1), PASI.length));
    }).catch(function (e) {
      if (e && e.status === 401) { laLogin(); return; }
      toast((e && e.message) || tr('Nu am putut deschide ruta de investitor.'));
    });
  }

  function laLogin() {
    try { sessionStorage.setItem(CHEIE_REVENIRE, ADRESA_RUTEI); } catch (e) {}
    window.location.href = '/index.html?reason=cont';
  }

  // „Devino investitor” / „Intră în rundă”: login, ruta sau subscrierea, după starea contului.
  function start(deschizator) {
    var d = deschizator || document.activeElement;
    return sesiune().then(function (s) {
      if (!s) { laLogin(); return; }
      return fetch('/api/cont/profil', { headers: { Authorization: 'Bearer ' + s.access_token }, cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (p) {
          if (p && Array.isArray(p.roles) && p.roles.indexOf('investor') !== -1) {
            if (typeof window.openRunda === 'function') window.openRunda(d);
            return;
          }
          return deschideRuta(d);
        });
    });
  }

  // Datele contului de investitor: ruta, la pasul 1 (doar cât dosarul se mai poate modifica).
  function deschideDateCont(deschizator) { return deschideRuta(deschizator, 1); }

  window.MYD_INVESTITOR = { start: start, deschideRuta: deschideRuta, deschideDateCont: deschideDateCont, inchide: inchide, ibanValid: ibanValid };

  // Revenirea după autentificare (?ruta=investitor): ruta pornește singură.
  function laIncarcare() {
    if (!/[?&]ruta=investitor(&|$)/.test(location.search)) return;
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    setTimeout(function () { start(null); }, 300);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', laIncarcare);
  else laIncarcare();
})();
