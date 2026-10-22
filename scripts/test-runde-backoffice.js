// scripts/test-runde-backoffice.js
// Pasul 11-J (21 oct. 2026): panoul „Runde de finanțare” din back-office
// (mydarrin-superadmin.html → Investitori Admin), în browser (Playwright), la
// 390 și 1366 px. Pagina e internă: rămâne în română (regula LM, 9 oct. 2026).
// Cererile /api/admin/runde-finantare, /api/admin/investitori-dashboard și
// /api/admin/investitori-kyc ajung la handler-ele reale, peste Supabase-ul
// simulat (scripts/supabase-simulat.js) — nimic nu ajunge la producție.
// Valorile rundei sunt DE TEST, nu cifrele reale ale rundei Seed.
//   1. lista rundelor se încarcă; KPI-urile nu au cifre scrise de mână;
//   2. „+ Rundă nouă”: previzualizarea live calculează pe server post-money,
//      prețul pe acțiune, procentul oferit și acțiunile noi;
//   3. „Salvează”: mesaj verde doar după răspunsul serverului; runda e
//      salvată „planificată”, cu audit; date greșite → mesaj roșu, valorile rămân;
//   4. „Deschide” cu altă rundă deschisă → avertisment, nicio cerere trimisă;
//   5. 0 erori JS, fără depășire pe orizontală.
// Rulare: node scripts/test-runde-backoffice.js

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const p = require.resolve(path.join(RADACINA, 'lib/rate-limit.js'));
require.cache[p] = { id: p, filename: p, loaded: true, exports: { checkRateLimit: async () => true } };

const API = {
  '/api/admin/runde-finantare': require(path.join(RADACINA, 'api/admin/runde-finantare.js')),
  '/api/admin/investitori-dashboard': require(path.join(RADACINA, 'api/admin/investitori-dashboard.js')),
  '/api/admin/investitori-kyc': require(path.join(RADACINA, 'api/admin/investitori-kyc.js')),
};

const SUPER = { id: 'super', email: 'super@example.com', roles: ['superadmin'] };

function reset() {
  DB.tabele = {
    profiles: [{ id: 'super', email: 'super@example.com', roles: ['superadmin'] }],
    runde_finantare: [{ id: 'r-alta', cod: 'alta', denumire_ro: 'Rundă de test deschisă', denumire_en: 'Open test round', stare: 'deschisa', moneda: 'EUR',
      evaluare_pre_money: 900, suma_tinta: 100, actiuni_existente: 90, investitie_minima: 10, tickete: null, instrumente: ['actiuni'], vizibila_public: false, afiseaza_progres: false }],
    investitori_portofoliu: [], investitori_kyc: [], audit_log: [], admin_permissions: [],
  };
  DB.coloane = {};
  DB.utilizatori = { 'tok-super': { id: 'super', email: 'super@example.com' } };
}

function sesiuneSimulata(user) {
  const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
  const ses = { access_token: 'tok-' + user.id, user };
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: ses }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) },
    from: () => lant({ data: [], error: null, count: 0 }), rpc: () => lant({ data: null, error: null }), storage: { from: () => lant({ data: null, error: null }) }, channel: () => lant({}), removeChannel: () => {},
  };
  const auth = new Proxy({ getCurrentUser: async () => user, getUserRoles: async () => user.roles, hasRole: async () => true, enforceSuperadminBarrier: async () => user.roles.includes('superadmin'), performLogout: () => {} }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (n, v) => Object.defineProperty(window, n, { configurable: true, get: () => v, set: () => {} });
  fix('supabaseClient', client); fix('MyDarrinAuth', auth);
}

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

async function deschide(browser, baza, latime, cereriRunde) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('myd_lang_v1', 'ro'); } catch (e) {} });
  await ctx.addInitScript(sesiuneSimulata, SUPER);
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  await ctx.route(/\/api\//, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const api = API[url.pathname];
    if (!api) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    let corp = null; try { corp = JSON.parse(req.postData() || 'null'); } catch (e) { corp = null; }
    if (url.pathname === '/api/admin/runde-finantare') cereriRunde.push({ metoda: req.method(), corp });
    const token = (req.headers().authorization || '').replace('Bearer ', '');
    const res = raspuns();
    await api(cerere({ metoda: req.method(), token, body: corp, query: Object.fromEntries(url.searchParams) }), res);
    return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp || {}) });
  });
  const pg = await ctx.newPage();
  pg.erori = [];
  pg.dialoguri = [];
  pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 160)));
  pg.on('dialog', (d) => { pg.dialoguri.push(d.message()); d.dismiss(); });
  await pg.goto(baza + '/mydarrin-superadmin.html', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(600);
  await pg.evaluate(() => window.showPanel('investitori'));
  await pg.waitForSelector('#inv-runde-tbody tr', { timeout: 8000 }).catch(() => {});
  return { ctx, pg };
}

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const latime of [390, 1366]) {
      const et = `ro ${latime}px`;
      reset();
      const cereriRunde = [];
      const { ctx, pg } = await deschide(browser, baza, latime, cereriRunde);

      // 1. lista
      const lista = await pg.innerText('#inv-runde-tbody');
      verifica(/Rundă de test deschisă/.test(lista), `${et} 1: lista rundelor se încarcă („${lista.slice(0, 120)}”)`);
      const panou = await pg.innerText('#panel-investitori').catch(() => pg.innerText('body'));
      for (const t of ['500.000', '0.05 EUR', '10M emise', 'Pre-Seed 2026', 'Q4 2026']) verifica(!panou.includes(t), `${et} 1: „${t}” nu apare în panou`);

      // 2. previzualizarea live
      await pg.click('button:has-text("+ Rundă nouă")');
      await pg.waitForSelector('#rf-cod');
      await pg.fill('#rf-cod', 'test_nou');
      await pg.fill('#rf-denumire_ro', 'Rundă nouă de test');
      await pg.fill('#rf-denumire_en', 'New test round');
      await pg.fill('#rf-evaluare_pre_money', '900000');
      await pg.fill('#rf-suma_tinta', '100000');
      await pg.fill('#rf-actiuni_existente', '900');
      await pg.waitForFunction(() => /1[.,\s]?000[.,\s]?000/.test((document.getElementById('rf-calc-post') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
      const calc = await pg.evaluate(() => ['post', 'pret', 'equity', 'actiuni'].map((k) => (document.getElementById('rf-calc-' + k) || {}).textContent || ''));
      verifica(/1[.,\s]?000[.,\s]?000/.test(calc[0]), `${et} 2: post-money = pre-money + țintă (${calc[0]})`);
      verifica(/:\s*1[.,\s]?000 EUR/.test(calc[1]), `${et} 2: prețul pe acțiune = pre-money / acțiuni existente (${calc[1]})`);
      verifica(/:\s*10%/.test(calc[2]), `${et} 2: procentul oferit = țintă / post-money (${calc[2]})`);
      verifica(/:\s*100$/.test(calc[3].trim()), `${et} 2: acțiunile noi = floor(țintă / preț) (${calc[3]})`);
      verifica(cereriRunde.some((c) => c.metoda === 'POST' && c.corp && c.corp.actiune === 'calcul'), `${et} 2: calculul vine de la server (actiune: calcul)`);

      // 3. salvare: întâi date greșite (mesaj roșu, valorile rămân), apoi corecte
      await pg.fill('#rf-cod', 'Cod Greșit!');
      await pg.click('#rf-salveaza');
      await pg.waitForFunction(() => (document.getElementById('rf-msg') || {}).textContent.length > 0, null, { timeout: 5000 }).catch(() => {});
      const greseala = await pg.innerText('#rf-msg');
      verifica(/✕|Nu s-a salvat|cod/i.test(greseala), `${et} 3: date greșite → mesaj de eroare („${greseala.trim()}”)`);
      verifica(await pg.inputValue('#rf-evaluare_pre_money') === '900000', `${et} 3: valorile introduse rămân`);
      verifica(DB.tabele.runde_finantare.length === 1, `${et} 3: nimic salvat cu date greșite`);
      await pg.fill('#rf-cod', 'test_nou');
      await pg.click('#rf-salveaza');
      await pg.waitForFunction(() => /✓|Salvat|salvat/.test((document.getElementById('rf-msg') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
      const salvat = await pg.innerText('#rf-msg').catch(() => '');
      const noua = DB.tabele.runde_finantare.find((r) => r.cod === 'test_nou');
      verifica(!!noua && noua.stare === 'planificata', `${et} 3: runda e salvată „planificată” (${JSON.stringify(noua && { cod: noua.cod, stare: noua.stare })})`);
      verifica(/✓|salvat/i.test(salvat), `${et} 3: mesaj verde după răspunsul serverului („${salvat.trim()}”)`);
      verifica(DB.tabele.audit_log.some((a) => a.actiune === 'runda_creata'), `${et} 3: audit runda_creata`);

      // 4. „Deschide” cu altă rundă deschisă → avertisment, nicio cerere
      await pg.waitForSelector('#inv-runde-tbody button:has-text("Deschide")', { timeout: 5000 }).catch(() => {});
      const inainte = cereriRunde.filter((c) => c.corp && c.corp.actiune === 'deschide').length;
      await pg.click('#inv-runde-tbody button:has-text("Deschide")').catch(() => {});
      await pg.waitForTimeout(300);
      // Pasul 11-N1: avertismentul e un toast de eroare (MDFeedback), nu alert().
      const avertisment = await pg.locator('.md-toast-eroare').last().innerText().catch(() => '');
      verifica(/e deja deschisă/.test(avertisment), `${et} 4: avertisment „altă rundă e deja deschisă” („${avertisment.trim()}”)`);
      verifica(!pg.dialoguri.length, `${et} 4: fără ferestre native alert / confirm (${pg.dialoguri.join(' | ')})`);
      verifica(cereriRunde.filter((c) => c.corp && c.corp.actiune === 'deschide').length === inainte, `${et} 4: nicio cerere de deschidere trimisă`);
      verifica(DB.tabele.runde_finantare.filter((r) => r.stare === 'deschisa').length === 1, `${et} 4: tot o singură rundă deschisă`);

      // 5.
      const dep = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 ? document.documentElement.scrollWidth : 0);
      verifica(!dep, `${et} 5: fără depășire pe orizontală (${dep})`);
      verifica(!pg.erori.length, `${et} 5: 0 erori JS (${pg.erori.join(' | ')})`);
      await ctx.close();
      console.log(`${et}: gata`);
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
