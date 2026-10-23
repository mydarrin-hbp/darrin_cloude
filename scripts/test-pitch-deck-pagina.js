// scripts/test-pitch-deck-pagina.js
// Pasul 11-K (22 oct. 2026), în browser (Playwright):
//   A. back-office („Investitori Admin” → „Pitch deck”), la 390 și 1366 px,
//      cu handler-ele reale peste Supabase-ul simulat: importul celor două
//      JSON-uri reale → câte o ciornă pe limbă, cu notele de verificare;
//      adminul doar cu citire nu vede butoanele de scriere;
//   (secțiunile următoare se adaugă la punctele 2.4–2.7)
//   0 erori JS, nimic în afara ecranului.
// Rulare: node scripts/test-pitch-deck-pagina.js

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

function stub(fisier, exp) {
  const p = require.resolve(path.join(RADACINA, fisier));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };
}
stub('lib/rate-limit.js', { checkRateLimit: async () => true });

const FISIER_RO = path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1-ro.json');
const FISIER_EN = path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1-en.json');
const RO = require(FISIER_RO);
const EN = require(FISIER_EN);
const notePe = (j) => j.slide_uri.reduce((n, s) => n + (s.de_verificat || []).length, 0);

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

// Elemente care ies din ecran pe orizontală (sau pagina care se derulează lateral).
async function inAfaraEcranului(p, selector) {
  return p.evaluate((sel) => {
    const W = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > W + 1) return 'pagina: ' + document.documentElement.scrollWidth;
    const rau = [];
    document.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).visibility === 'hidden') return;
      // Elementele din containere derulabile (tabele) nu se numără.
      for (let e = el.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if (o === 'auto' || o === 'scroll') return; }
      if (r.left < -1 || r.right > W + 1) rau.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.left) + '…' + Math.round(r.right));
    });
    return rau.slice(0, 3).join(', ');
  }, selector);
}

// ═══ A. Back-office ════════════════════════════════════════════════
const API = {
  '/api/admin/runde-finantare': require(path.join(RADACINA, 'api/admin/runde-finantare.js')),
  '/api/admin/investitori-dashboard': require(path.join(RADACINA, 'api/admin/investitori-dashboard.js')),
  '/api/admin/investitori-kyc': require(path.join(RADACINA, 'api/admin/investitori-kyc.js')),
  '/api/admin/investitori-aprobare': require(path.join(RADACINA, 'api/admin/investitori-aprobare.js')),
  '/api/admin/pitch-deck': require(path.join(RADACINA, 'api/admin/pitch-deck.js')),
};

function resetAdmin() {
  DB.tabele = {
    profiles: [
      { id: 'sup', email: 'super@example.com', roles: ['superadmin'] },
      { id: 'cit', email: 'citire@example.com', roles: ['admin'] },
    ],
    admin_permissions: [{ admin_id: 'cit', sectiune: 'investitori', poate_scrie: false }],
    runde_finantare: [], investitori_kyc: [], investitori_portofoliu: [], audit_log: [], pitch_deck_versiuni: [],
    backoffice_config: [
      { cheie: 'investitori_email', valoare: 'investor@example.com', sectiune: 'contact', tara_cod: 'ALL' },
      { cheie: 'pitch_deck_vizibilitate', valoare: 'investitori_aprobati', sectiune: 'investitori', tara_cod: 'ALL' },
    ],
  };
  DB.coloane = {};
  DB.implicite = { pitch_deck_versiuni: { aprobat: false, note_verificare: [], creat_la: '2026-10-22T10:00:00Z' } };
  DB.utilizatori = { 'tok-sup': { id: 'sup', email: 'super@example.com' }, 'tok-cit': { id: 'cit', email: 'citire@example.com' } };
}

function sesiuneAdmin(user) {
  const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
  const ses = { access_token: 'tok-' + user.id, user };
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: ses }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) },
    from: () => lant({ data: [], error: null, count: 0 }), rpc: () => lant({ data: null, error: null }), storage: { from: () => lant({ data: null, error: null }) }, channel: () => lant({}), removeChannel: () => {},
  };
  const auth = new Proxy({ getCurrentUser: async () => user, getUserRoles: async () => user.roles, hasRole: async () => true, enforceSuperadminBarrier: async () => true, performLogout: () => {} }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (n, v) => Object.defineProperty(window, n, { configurable: true, get: () => v, set: () => {} });
  fix('supabaseClient', client); fix('MyDarrinAuth', auth);
}

async function panouAdmin(browser, baza, latime, user) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: 900 } });
  await ctx.addInitScript(sesiuneAdmin, user);
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  await ctx.route(/\/api\//, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const api = API[url.pathname];
    if (!api) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    let corp = null; try { corp = JSON.parse(req.postData() || 'null'); } catch (e) { corp = null; }
    const res = raspuns();
    await api(cerere({ metoda: req.method(), token: (req.headers().authorization || '').replace('Bearer ', ''), body: corp, query: Object.fromEntries(url.searchParams) }), res);
    return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp || {}) });
  });
  const pg = await ctx.newPage();
  pg.erori = [];
  pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 200)));
  await pg.goto(baza + '/mydarrin-superadmin.html', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(500);
  await pg.evaluate(() => window.showPanel('investitori'));
  await pg.waitForFunction(() => !/Se încarcă/.test((document.getElementById('pd-tbody') || {}).textContent || 'Se încarcă'), null, { timeout: 8000 }).catch(() => {});
  return { ctx, pg };
}

async function testAdmin(browser, baza) {
  for (const latime of [390, 1366]) {
    const et = `A ${latime}px`;
    resetAdmin();
    {
      const { ctx, pg } = await panouAdmin(browser, baza, latime, { id: 'sup', email: 'super@example.com', roles: ['superadmin'] });
      verifica(await pg.isVisible('#pd-importa'), `${et}: butonul „Importă din fișier” e vizibil`);
      verifica(/Nicio versiune RO/.test(await pg.innerText('#pd-tbody')), `${et}: lista goală spune ce e de făcut`);
      await pg.setInputFiles('#pd-fisier', [FISIER_RO, FISIER_EN]);
      await pg.waitForFunction(() => /Ciornă creată/.test(document.getElementById('pd-import-msg').textContent), null, { timeout: 8000 }).catch(() => {});
      const msg = await pg.innerText('#pd-import-msg');
      verifica(msg.includes(`RO (${notePe(RO)} note de verificat)`) && msg.includes(`EN (${notePe(EN)} note de verificat)`), `${et}: mesajul importului („${msg}”)`);
      verifica(DB.tabele.pitch_deck_versiuni.length === 2 && DB.tabele.pitch_deck_versiuni.every((v) => v.aprobat === false), `${et}: două ciorne, niciuna aprobată`);
      await pg.waitForFunction(() => /Ciornă/.test(document.getElementById('pd-tbody').textContent), null, { timeout: 5000 }).catch(() => {});
      const ro = await pg.innerText('#pd-tbody');
      verifica(/Pitch deck v1 · RO/.test(ro) && new RegExp(`${notePe(RO)} nerezolvate`).test(ro) && /20 slide-uri/.test(ro), `${et}: rândul RO („${ro.replace(/\s+/g, ' ').slice(0, 200)}”)`);
      await pg.click('.pd-tab[data-limba="en"]');
      const en = await pg.innerText('#pd-tbody');
      verifica(/Pitch deck v1 · EN/.test(en) && !/· RO/.test(en), `${et}: fila EN arată doar versiunea EN`);
      verifica(await pg.isVisible('#pd-viz-select'), `${et}: superadminul vede selectorul de vizibilitate`);
      const d = await inAfaraEcranului(pg, '#pd-card, #pd-card *'); verifica(!d, `${et}: cardul în ecran (${d})`);
      verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
      await ctx.close();
    }
    {
      const { ctx, pg } = await panouAdmin(browser, baza, latime, { id: 'cit', email: 'citire@example.com', roles: ['admin'] });
      verifica(!(await pg.isVisible('#pd-importa')), `${et} doar citire: fără „Importă din fișier”`);
      verifica(!(await pg.isVisible('#pd-viz-select')) && /o schimbă superadminul/.test(await pg.innerText('#pd-viz')), `${et} doar citire: vizibilitatea doar afișată`);
      verifica(/Pitch deck v1 · RO/.test(await pg.innerText('#pd-tbody')), `${et} doar citire: versiunile se văd`);
      verifica(!pg.erori.length, `${et} doar citire: 0 erori JS (${pg.erori.join(' | ')})`);
      await ctx.close();
    }
    console.log(`${et}: gata`);
  }
}

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    await testAdmin(browser, baza);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
