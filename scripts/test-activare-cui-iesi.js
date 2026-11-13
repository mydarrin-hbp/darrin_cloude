// scripts/test-activare-cui-iesi.js
// Pasul 11-R3e (3 nov. 2026): activarea partenerului — CUI deja folosit cu
// mesaj clar, „Înapoi la site” fără deconectare.
//
// Server (Supabase simulat, ANAF simulat), api/partener/wizard-companie.js:
//   - forma unică a CUI-ului: „RO 46577229”, „ro46577229” și „46577229” sunt
//     același CUI; firmele străine: fără spații, cu majuscule;
//   - CUI-ul altui cont (salvat și în formă veche, „RO46577229”) → 409
//     CUI_FOLOSIT pe câmpul `cui`, mesajul RO + EN cerut, fără id-ul, emailul
//     sau numele celuilalt cont;
//   - același cont, același CUI (scris altfel) → salvare reușită, un singur rând,
//     CUI-ul în forma unică;
//   - cursa (23505 pe partners_cui_key la insert) → tot CUI_FOLOSIT;
//   - eroare neașteptată a bazei de date → 500, mesaj general RO + EN, fără SQL.
// Browser (Chromium, Supabase simulat, API-urile pașilor simulate):
//   - pasul „Firma” cu CUI_FOLOSIT: mesajul apare sub câmpul CUI, fără textul tehnic;
//   - „Înapoi la site” duce la pagina principală, salvează ciorna, nu deconectează;
//     revenirea în dashboard deschide activarea la același pas;
//   - „Deconectare” cere confirmare (MDFeedback.confirma); „Rămân conectat” nu
//     deconectează; „Deconectează-mă” deconectează; pe telefon, din meniul mic;
//   - în engleză: „Back to the site”, „Sign out”;
//   - 390, 768, 1024, 1366 px: fără derulare orizontală, fără suprapuneri,
//     butoane de cel puțin 44 px, fără erori JS.
// Rulare: node scripts/test-activare-cui-iesi.js [--doar-server]

const path = require('path');
const sim = require('./supabase-simulat');
const supabaseAdmin = sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));
const tacut = async (fn) => { const e = console.error; const jurnal = []; console.error = (...a) => jurnal.push(a.map((x) => (typeof x === 'string' ? x : require('util').inspect(x))).join(' ')); try { await fn(); } finally { console.error = e; } return jurnal; };

// ANAF simulat: firma activă, pentru orice CUI.
const fetchReal = global.fetch;
global.fetch = async (url, opt) => {
  if (String(url).includes('anaf.ro')) {
    const dg = { cui: 46577229, denumire: 'FIRMA SIMULATA SRL', adresa: 'ADRESA', nrRegCom: 'J00/0000/2000' };
    return { ok: true, status: 200, json: async () => ({ found: [{ date_generale: dg, stare_inactiv: { statusInactivi: false, dataRadiere: '' } }], notFound: [] }) };
  }
  return fetchReal(url, opt);
};
supabaseAdmin.rpc = async () => ({ data: 'criptat', error: null });

const CUI = '46577229';
const CUI2 = '1234565';
const MESAJ_RO = 'Această firmă are deja un cont de partener pe My Darrin. Dacă e firma ta și nu ai acces la cont, scrie-ne din pagina Contact.';
const MESAJ_EN = 'This company already has a partner account on My Darrin. If it is your company and you cannot access that account, write to us from the Contact page.';

function reset() {
  DB.tabele = {
    profiles: [
      { id: 'u-nou', email: 'nou@example.com', role: 'client', roles: ['client'], tara: 'RO', rol_solicitat: 'partener_materiale' },
      { id: 'u-hbp', email: 'contact@homebestpal.ro', role: 'client', roles: ['client', 'partener_materiale'], tara: 'RO' },
      { id: 'u-de', email: 'de@example.com', role: 'client', roles: ['client'], tara: 'DE', rol_solicitat: 'partener_materiale' },
    ],
    // Celălalt cont are CUI-ul salvat în forma veche („RO…”).
    partners: [{ id: 'u-hbp', partner_type: 'furnizor_materiale', nume_firma: 'Home Best Pal SRL', cui: 'RO' + CUI, status_verificare: 'approved' }],
    partner_conturi_bancare: [], audit_log: [], backoffice_config: [], contact_platforma: [],
  };
  DB.coloane = {};
  DB.utilizatori = {
    'tok-nou': { id: 'u-nou', email: 'nou@example.com' },
    'tok-hbp': { id: 'u-hbp', email: 'contact@homebestpal.ro' },
    'tok-de': { id: 'u-de', email: 'de@example.com' },
  };
}
const BAZA = { nume_firma: 'Firma Mea SRL', tip_entitate_legala: 'srl', partner_type: 'materiale' };

async function testeServer() {
  const F = require(path.join(RADACINA, 'lib/forme-juridice.js'));
  const wizard = require(path.join(RADACINA, 'api/partener/wizard-companie.js'));
  const post = async (token, body) => { const res = raspuns(); const jurnal = await tacut(() => wizard(cerere({ metoda: 'POST', token, body }), res)); return { res, jurnal }; };

  // 1. Forma unică.
  for (const v of ['RO46577229', 'ro46577229', 'RO 4657 7229', ' 46577229 ', '46577229']) {
    verifica(F.normalizeazaCui(v, 'RO') === CUI, `forma unică: „${v}” → „${F.normalizeazaCui(v, 'RO')}” (așteptat ${CUI})`);
  }
  verifica(F.normalizeazaCui('de 123 456 789', 'DE') === 'DE123456789', `firmă străină: ${F.normalizeazaCui('de 123 456 789', 'DE')}`);
  const vd = F.valideazaDateFirma({ ...BAZA, cui: 'RO 46577229', tara: 'RO' });
  verifica(vd.ok && vd.date.cui === CUI, `valideazaDateFirma întoarce forma unică: ${JSON.stringify(vd.date)}`);

  // 2. CUI-ul altui cont, în orice formă → 409 CUI_FOLOSIT, fără date despre celălalt cont.
  for (const scris of [CUI, 'RO' + CUI, 'ro ' + CUI]) {
    reset();
    const { res } = await post('tok-nou', { ...BAZA, cui: scris });
    const corp = JSON.stringify(res.corp);
    verifica(res.statusCode === 409 && res.corp.cod === 'CUI_FOLOSIT', `CUI altui cont („${scris}”): ${res.statusCode} ${res.corp && res.corp.cod}`);
    verifica(res.corp.mesaj && res.corp.mesaj.ro === MESAJ_RO && res.corp.mesaj.en === MESAJ_EN, `CUI altui cont: mesajul ${JSON.stringify(res.corp.mesaj)}`);
    verifica(Array.isArray(res.corp.campuri) && res.corp.campuri.length === 1 && res.corp.campuri[0].camp === 'cui', `CUI altui cont: câmpul ${JSON.stringify(res.corp.campuri)}`);
    verifica(!/u-hbp|homebestpal|Home Best Pal|approved/i.test(corp), `CUI altui cont: răspunsul spune ceva despre celălalt cont: ${corp}`);
    verifica(DB.tabele.partners.length === 1 && !DB.tabele.profiles.find((p) => p.id === 'u-nou').roles.includes('partener_materiale'), 'CUI altui cont: s-a creat totuși partenerul sau rolul');
  }

  // 3. Același cont, același CUI (scris altfel) → salvare reușită, un singur rând, forma unică.
  reset();
  let r = await post('tok-nou', { ...BAZA, cui: 'RO' + CUI2 });
  verifica(r.res.statusCode === 200 && r.res.corp.ok, `prima salvare: ${r.res.statusCode} ${JSON.stringify(r.res.corp)}`);
  let rand = DB.tabele.partners.find((p) => p.id === 'u-nou');
  verifica(rand && rand.cui === CUI2, `CUI-ul salvat în forma unică: ${rand && rand.cui}`);
  const auditInainte = DB.tabele.audit_log.length;
  r = await post('tok-nou', { ...BAZA, cui: ' ' + CUI2, nume_firma: 'Firma Mea SRL (nou)' });
  rand = DB.tabele.partners.find((p) => p.id === 'u-nou');
  verifica(r.res.statusCode === 200 && r.res.corp.ok, `același cont, același CUI: ${r.res.statusCode} ${JSON.stringify(r.res.corp)}`);
  verifica(DB.tabele.partners.filter((p) => p.id === 'u-nou').length === 1 && rand.nume_firma === 'Firma Mea SRL (nou)' && rand.cui === CUI2, `același cont: rândul nu s-a actualizat corect ${JSON.stringify(rand)}`);
  verifica(DB.tabele.audit_log.length === auditInainte, 'același cont, același CUI: s-a cerut din nou verificarea manuală');

  // Contul care are deja CUI-ul în formă veche își salvează din nou firma → reușit.
  reset();
  r = await post('tok-hbp', { ...BAZA, cui: CUI });
  verifica(r.res.statusCode === 200 && DB.tabele.partners.find((p) => p.id === 'u-hbp').cui === CUI, `cont cu CUI în formă veche, salvare nouă: ${r.res.statusCode} ${JSON.stringify(r.res.corp)}`);

  // 4. Cursă: alt cont salvează același CUI între verificare și insert → 23505 → CUI_FOLOSIT.
  reset();
  const fromReal = supabaseAdmin.from;
  supabaseAdmin.from = (t) => {
    const q = fromReal(t);
    if (t !== 'partners') return q;
    q.insert = () => ({ then: (okf) => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "partners_cui_key"', details: 'Key (cui)=(1234565) already exists.' } }).then(okf) });
    return q;
  };
  r = await post('tok-nou', { ...BAZA, cui: CUI2 });
  verifica(r.res.statusCode === 409 && r.res.corp.cod === 'CUI_FOLOSIT' && !/duplicate|constraint|partners_cui_key/.test(JSON.stringify(r.res.corp)), `cursa 23505: ${r.res.statusCode} ${JSON.stringify(r.res.corp)}`);

  // 5. Eroare neașteptată → mesaj general, fără SQL; textul tehnic doar în jurnal.
  reset();
  supabaseAdmin.from = (t) => {
    const q = fromReal(t);
    if (t !== 'partners') return q;
    q.insert = () => ({ then: (okf) => Promise.resolve({ data: null, error: { code: 'XX000', message: 'syntax error at or near "select" in partners' } }).then(okf) });
    return q;
  };
  r = await post('tok-nou', { ...BAZA, cui: CUI2 });
  supabaseAdmin.from = fromReal;
  const corp = JSON.stringify(r.res.corp);
  verifica(r.res.statusCode === 500 && r.res.corp.ok === false && r.res.corp.mesaj && r.res.corp.mesaj.ro && r.res.corp.mesaj.en, `eroare neașteptată: ${r.res.statusCode} ${corp}`);
  verifica(!/syntax|select|partners|XX000/i.test(corp), `eroare neașteptată: textul tehnic ajunge la utilizator: ${corp}`);
  verifica(r.jurnal.some((l) => /syntax error/.test(l)), 'eroare neașteptată: textul tehnic nu ajunge în jurnalul serverului');

  // 6. Firma străină: forma unică, fără spații, cu majuscule.
  reset();
  r = await post('tok-de', { nume_firma: 'Muster GmbH', tip_entitate_legala: 'firma_straina', forma_juridica_locala: 'GmbH', partner_type: 'materiale', cui: 'de 123 456 789' });
  const de = DB.tabele.partners.find((p) => p.id === 'u-de');
  verifica(r.res.statusCode === 200 && de && de.cui === 'DE123456789', `firmă străină: ${r.res.statusCode} ${de && de.cui}`);
  console.log('server: gata');
}

// ── Browser ──
const ZGOMOT = /Failed to load resource|net::ERR_|ERR_FAILED|Failed to fetch|status of 50[0-9]|status of 40[0-9]|cdn\.tailwindcss\.com/i;
const PASI = ['firma', 'cont_bancar', 'profesii', 'dotari', 'documente', 'contract'];

function supabaseConectat() {
  const sesiune = { access_token: 'tok-test', user: { id: 'u-test', email: 'firma@example.com', email_confirmed_at: '2026-11-02T08:00:00Z', user_metadata: {} } };
  window.__deconectari = 0;
  const fals = {
    auth: {
      getUser: async () => ({ data: { user: sesiune.user }, error: null }),
      getSession: async () => ({ data: { session: sesiune } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { window.__deconectari++; try { localStorage.setItem('__deconectat', '1'); } catch (e) {} return { error: null }; },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  };
  Object.defineProperty(window, 'supabaseClient', { configurable: true, get() { return fals; }, set() {} });
}

// Starea serverului simulat se păstrează între pagini (aceeași instanță).
function serverSimulat(opt) {
  const o = opt || {};
  const s = { firma: o.firma || null, ciorna: o.ciorna || null, puturi: [], cuiFolosit: !!o.cuiFolosit };
  const rol = 'partener_materiale', tip = 'materiale';
  function profil() {
    const areFirma = !!s.firma;
    const stari = [areFirma ? 'in_verificare' : 'de_completat'].concat(PASI.slice(1).map(() => (areFirma ? 'de_completat' : 'blocat')));
    return {
      ok: true, email: 'firma@example.com', nume: 'Ana Popescu', tara: 'RO',
      roles: areFirma ? ['client', rol] : ['client'], roluri_dashboard: areFirma ? [rol] : [],
      destinatie: '/mydarrin-dashboard-furnizor.html?type=materiale', tip_destinatie: 'activare_partener', are_comenzi: false, rol_solicitat: rol,
      partener: areFirma ? { nume_firma: s.firma.nume_firma, partner_type: 'furnizor_materiale', rol, status_verificare: 'pending_review', contract_semnat: false, cont_bancar: false, poate_vinde: false } : null,
      investitor: null,
      activare: { rol, tip, mod_activare: !areFirma, verificare: areFirma ? 'pending_review' : null, activ: false, complet: false, pasi: PASI.map((cheie, i) => ({ cheie, stare: stari[i] })) },
    };
  }
  async function trateaza(route) {
    const req = route.request();
    const u = new URL(req.url());
    const m = req.method();
    const corp = () => { try { return JSON.parse(req.postData() || '{}'); } catch (e) { return {}; } };
    const json = (cod, b) => route.fulfill({ status: cod, contentType: 'application/json', body: JSON.stringify(b) });
    switch (u.pathname) {
      case '/api/cont/profil': return json(200, profil());
      case '/api/partener/activare-ciorna':
        if (m === 'GET') return json(200, { ok: true, ciorna: s.ciorna });
        if (m === 'PUT') { const b = corp(); s.puturi.push(b); s.ciorna = { ...b, actualizat_la: new Date().toISOString() }; return json(200, { ok: true, actualizat_la: s.ciorna.actualizat_la }); }
        s.ciorna = null; return json(200, { ok: true });
      case '/api/partener/wizard-companie':
        if (m === 'GET') return json(200, { ok: true, partner: s.firma, conturi: [] });
        if (s.cuiFolosit) return json(409, { ok: false, cod: 'CUI_FOLOSIT', error: MESAJ_RO, error_en: MESAJ_EN, mesaj: { ro: MESAJ_RO, en: MESAJ_EN }, campuri: [{ camp: 'cui', mesaj: { ro: MESAJ_RO, en: MESAJ_EN } }] });
        s.firma = corp(); return json(200, { ok: true });
      case '/api/public/geo-regiuni': return json(200, { ok: true, regiuni: [{ cod: 'BC', denumire: 'Bacău' }] });
      case '/api/public/cui-lookup': return json(200, { ok: true, cui: CUI, denumire: 'FIRMA SIMULATA SRL', nr_reg_com: 'J04/1234/2022', adresa: 'Str. Nordului nr. 3, Bacău' });
      case '/api/partener/conturi-bancare': return json(200, { ok: true, conturi: [] });
      case '/api/public/nace-lista': return json(200, { ok: true, clase: [] });
      case '/api/partener/wizard-nace': return json(200, { ok: true, coduri: [] });
      case '/api/public/destinatie-post-login': return json(200, { ok: true, destinatie: '/mydarrin-dashboard-furnizor.html?type=materiale' });
      default: return route.fallback();
    }
  }
  return { s, trateaza };
}

async function testeBrowser() {
  const { chromium } = require('playwright');
  const { porneste } = require('./server-test');
  const srvHttp = await porneste(0);
  const baza = 'http://localhost:' + srvHttp.address().port;
  const browser = await chromium.launch();
  const PAGINA = 'mydarrin-dashboard-furnizor.html?type=materiale';

  async function deschide(srv, latime, limba) {
    const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 800 ? 844 : 900 } });
    await ctx.addInitScript((l) => {
      try {
        localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), marketing: false, versiune: 2 }));
        if (l) localStorage.setItem('myd_lang_v1', l);
      } catch (e) {}
    }, limba || null);
    await ctx.addInitScript(supabaseConectat);
    await ctx.route(/\.supabase\.co\//, (r) => r.abort());
    await ctx.route(/ipapi\.co\//, (r) => r.abort());
    await ctx.route(/\/api\//, srv.trateaza);
    // Deconectarea pleacă spre domeniul public: o oprim aici.
    await ctx.route(/mydarrin\.homebestpal\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>public</body></html>' }));
    const p = await ctx.newPage();
    const erori = [];
    p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
    p.on('console', (m) => { if (m.type() === 'error' && !ZGOMOT.test(m.text())) erori.push('console: ' + m.text().slice(0, 160)); });
    return { ctx, p, erori };
  }
  const laActivare = async (p) => {
    await p.goto(`${baza}/${PAGINA}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await p.waitForSelector('#myd-activare-pagina #mya-continua', { timeout: 10000 }).catch(() => {});
    await asteapta(500);
  };
  const pasul = (p) => p.evaluate(() => { const t = (document.querySelector('#myd-activare-pagina .mya-nr .mya-scurt') || {}).textContent || ''; const m = t.match(/(\d)\s*\/\s*6/); return m ? Number(m[1]) : null; });

  try {
    // 1. Pasul „Firma” cu CUI_FOLOSIT: mesajul sub câmpul CUI, fără text tehnic.
    for (const limba of ['ro', null]) {
      const et = `CUI folosit ${limba || 'en'}`;
      const srv = serverSimulat({ cuiFolosit: true });
      const { ctx, p, erori } = await deschide(srv, 1366, limba);
      await laActivare(p);
      await p.evaluate(() => {
        const set = (n, v) => { const el = document.querySelector('#mya-corp [name="' + n + '"]'); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
        const forma = document.querySelector('#mya-corp [name="tip_entitate_legala"]');
        if (forma) { forma.value = 'srl'; forma.dispatchEvent(new Event('change', { bubbles: true })); }
        set('cui', 'RO46577229'); set('nume_firma', 'Firma Mea SRL'); set('nr_reg_com', 'J04/1/2020'); set('adresa_sediu_social', 'Str. X nr. 1, Bacău');
        const reg = document.querySelector('#mya-corp [name="regiune_cod"]'); if (reg && reg.options.length > 1) { reg.value = reg.options[1].value; reg.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      await p.click('#mya-continua');
      await p.waitForFunction(() => document.querySelector('#mya-cui[aria-invalid="true"]') || document.querySelector('#mya-msg .md-feedback-eroare'), null, { timeout: 8000 }).catch(() => {});
      await asteapta(300);
      const s = await p.evaluate(() => {
        const cui = document.getElementById('mya-cui');
        const id = cui && cui.getAttribute('aria-describedby');
        const sub = id ? (document.getElementById(id.split(' ')[0]) || {}).textContent || '' : '';
        return { invalid: cui && cui.getAttribute('aria-invalid') === 'true', sub, tot: document.getElementById('myd-activare-pagina').innerText, pas: (document.querySelector('.mya-nr .mya-scurt') || {}).textContent };
      });
      const asteptat = limba ? 'Această firmă are deja un cont de partener' : 'This company already has a partner account';
      verifica(s.invalid && s.sub.includes(asteptat), `${et}: mesajul nu e sub câmpul CUI (${JSON.stringify(s.sub)})`);
      verifica(!/duplicate key|constraint|partners_cui_key/i.test(s.tot), `${et}: textul tehnic apare pe pagină`);
      verifica(/^1\s*\//.test(String(s.pas).trim()), `${et}: a trecut totuși la pasul următor (${s.pas})`);
      verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }

    // 2. „Înapoi la site”: ciorna salvată, pagina principală, sesiunea păstrată; revenirea → același pas.
    for (const latime of [1366, 390]) {
      const et = `„Înapoi la site” ${latime}px`;
      const srv = serverSimulat({ firma: { nume_firma: 'FIRMA SIMULATA SRL', cui: CUI, tip_entitate_legala: 'srl' }, ciorna: { pas_curent: 3, date: {} } });
      const { ctx, p, erori } = await deschide(srv, latime, 'ro');
      await laActivare(p);
      verifica(await pasul(p) === 3, `${et}: activarea nu s-a deschis la pasul 3 (${await pasul(p)})`);
      const viz = await p.evaluate(() => { const b = document.getElementById('mya-site'); return !!b && b.getClientRects().length > 0 && b.textContent.trim(); });
      verifica(viz === 'Înapoi la site', `${et}: butonul „Înapoi la site” nu se vede (${viz})`);
      const puturiInainte = srv.s.puturi.length;
      await Promise.all([p.waitForURL((u) => new URL(u).pathname === '/' || /\/index(\.html)?$/.test(new URL(u).pathname), { timeout: 10000 }).catch(() => {}), p.click('#mya-site')]);
      const cale = new URL(p.url()).pathname;
      verifica(cale === '/' || /\/index(\.html)?$/.test(cale), `${et}: a ajuns la ${cale} (așteptat pagina principală)`);
      verifica(srv.s.puturi.length > puturiInainte && srv.s.ciorna.pas_curent === 3, `${et}: ciorna nu s-a salvat înainte de plecare (${srv.s.puturi.length - puturiInainte} salvări, pas ${srv.s.ciorna && srv.s.ciorna.pas_curent})`);
      const deconectat = await p.evaluate(() => { try { return localStorage.getItem('__deconectat'); } catch (e) { return 'eroare'; } });
      verifica(!deconectat, `${et}: utilizatorul a fost deconectat`);
      // Revenirea (de exemplu din „Finalizează-ți contul”): direct la pasul 3, fără login.
      await laActivare(p);
      verifica(await pasul(p) === 3, `${et}: la revenire, activarea e la pasul ${await pasul(p)} (așteptat 3)`);
      verifica(!(await p.evaluate(() => { const m = document.getElementById('auth-modal'); return !!m && !m.classList.contains('hidden'); })), `${et}: la revenire s-a cerut login`);
      verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }

    // 3. „Deconectare” cere confirmare: „Rămân conectat” nu deconectează, „Deconectează-mă” da.
    for (const [latime, limba] of [[1366, 'ro'], [390, 'ro'], [1366, null]]) {
      const et = `„Deconectare” ${latime}px ${limba || 'en'}`;
      const srv = serverSimulat({ firma: { nume_firma: 'FIRMA SIMULATA SRL', cui: CUI, tip_entitate_legala: 'srl' }, ciorna: { pas_curent: 2, date: {} } });
      const { ctx, p, erori } = await deschide(srv, latime, limba);
      await laActivare(p);
      const deschideDeconectare = async () => {
        if (latime <= 600) {
          verifica(await p.evaluate(() => getComputedStyle(document.querySelector('.mya-actiuni > .mya-deconectare')).display === 'none'), `${et}: pe telefon „Deconectare” stă în antet, nu în meniu`);
          await p.click('#mya-meniu-btn');
          await p.waitForSelector('#mya-deconectare-meniu', { state: 'visible', timeout: 3000 }).catch(() => {});
          await p.click('#mya-deconectare-meniu');
        } else await p.click('#mya-deconectare');
        await p.waitForSelector('.md-confirma, [role="alertdialog"], [role="dialog"]', { state: 'visible', timeout: 4000 }).catch(() => {});
        await asteapta(200);
      };
      await deschideDeconectare();
      const d = await p.evaluate(() => {
        const dlg = [...document.querySelectorAll('[role="alertdialog"], [role="dialog"]')].find((e) => e.getClientRects().length && e.id !== 'myd-activare-pagina' && e.id !== 'auth-modal');
        return dlg ? { text: dlg.innerText, butoane: [...dlg.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null;
      });
      const intrebare = limba ? 'Te deconectezi? Ce ai completat e salvat; data viitoare intri cu emailul și parola.' : 'Sign out? What you filled in is saved; next time you sign in with your email and password.';
      verifica(d && d.text.includes(intrebare), `${et}: confirmarea lipsește sau are alt text (${d && d.text.slice(0, 120)})`);
      verifica(await p.evaluate(() => window.__deconectari) === 0, `${et}: s-a deconectat înainte de confirmare`);
      const anuleaza = limba ? 'Rămân conectat' : 'Stay signed in';
      const da = limba ? 'Deconectează-mă' : 'Sign me out';
      verifica(d && d.butoane.includes(anuleaza) && d.butoane.includes(da), `${et}: butoanele confirmării ${JSON.stringify(d && d.butoane)}`);
      await p.click(`button:has-text("${anuleaza}")`);
      await asteapta(500);
      verifica(await p.evaluate(() => window.__deconectari) === 0 && await pasul(p) === 2, `${et}: „${anuleaza}” a deconectat sau a închis activarea`);
      await deschideDeconectare();
      await Promise.all([p.waitForEvent('framenavigated', { timeout: 8000 }).catch(() => {}), p.click(`button:has-text("${da}")`)]);
      await asteapta(300);
      const deconectat = await p.evaluate(() => { try { return localStorage.getItem('__deconectat'); } catch (e) { return null; } }).catch(() => null);
      verifica(deconectat === '1' || /mydarrin\.homebestpal\.com/.test(p.url()), `${et}: „${da}” nu a deconectat (${p.url()})`);
      verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }

    // 4. Antetul la 390, 768, 1024, 1366 px (RO și EN): fără derulare orizontală, fără suprapuneri, ≥ 44 px.
    for (const latime of [390, 768, 1024, 1366]) {
      for (const limba of ['ro', null]) {
        const et = `antet ${latime}px ${limba || 'en'}`;
        const srv = serverSimulat({ firma: { nume_firma: 'FIRMA SIMULATA SRL CU UN NUME FOARTE LUNG DE TEST', cui: CUI, tip_entitate_legala: 'srl' }, ciorna: { pas_curent: 2, date: {} } });
        const { ctx, p, erori } = await deschide(srv, latime, limba);
        await laActivare(p);
        const m = await p.evaluate(() => {
          const pag = document.getElementById('myd-activare-pagina');
          const viz = [...pag.querySelectorAll('.mya-antet a, .mya-antet button, .mya-logo')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
          const dr = viz.map((e) => e.getBoundingClientRect());
          let suprapuse = 0;
          for (let i = 0; i < dr.length; i++) for (let j = i + 1; j < dr.length; j++) {
            const a = dr[i], b = dr[j];
            if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) suprapuse++;
          }
          const butoane = viz.filter((e) => e.tagName !== 'IMG').map((e) => e.getBoundingClientRect().height);
          const site = document.getElementById('mya-site');
          return {
            suprapuse, minButon: Math.min(...butoane), sw: pag.scrollWidth, cw: pag.clientWidth, docw: document.documentElement.scrollWidth, vw: window.innerWidth,
            site: site && site.getClientRects().length ? site.textContent.trim() : null,
            dreapta: Math.max(...dr.map((r) => r.right)),
          };
        });
        verifica(m.site === (limba ? 'Înapoi la site' : 'Back to the site'), `${et}: „Înapoi la site” nu se vede (${m.site})`);
        verifica(!m.suprapuse, `${et}: ${m.suprapuse} suprapuneri în antet`);
        verifica(m.minButon >= 44, `${et}: buton mai mic de 44 px (${m.minButon})`);
        verifica(m.sw <= m.cw + 1 && m.docw <= m.vw + 1 && m.dreapta <= m.vw + 0.5, `${et}: derulare orizontală (${m.sw}/${m.cw}, ${m.docw}/${m.vw}, dreapta ${Math.round(m.dreapta)})`);
        verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
        await ctx.close();
      }
    }
    console.log('activare: gata');
  } finally {
    await browser.close();
    srvHttp.close();
  }
}

(async () => {
  await testeServer();
  if (!process.argv.includes('--doar-server')) await testeBrowser();
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
