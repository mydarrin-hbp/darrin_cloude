// scripts/test-permisiuni-runda-pagina.js
// Pasul 11-N2 (22 oct. 2026), în browser (Playwright), la 390 și 1366 px:
//   A. pagina Investitori (RO, EN și `de` → EN), API simulat prin page.route:
//      rundă deschisă cu data_start în viitor → sub perioadă apare „Deschidere
//      oficială: … · subscrierile sunt deja posibile” / „Official opening: … ·
//      subscriptions are already open”, în card și în fereastra de subscriere
//      (deasupra sumei); cu data_start în trecut → doar perioada, fără mesaj;
//      subscrierea se trimite în ambele cazuri;
//   B. panoul „Investitori Admin” pentru un admin doar cu citire
//      (admin_permissions.poate_scrie = false), cu handler-ele reale peste
//      Supabase-ul simulat: nota „Acces doar de citire” / „Read-only access”,
//      fără butoane de scriere (rundă nouă, editează, deschide, închide,
//      aprobă, respinge); pagina e internă, în română;
//   0 erori JS, nimic în afara ecranului.
// Datele rundei sunt DE TEST (2099 / 2020), nu ale rundei Seed reale.
// Rulare: node scripts/test-permisiuni-runda-pagina.js

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
      if (r.width && (r.left < -1 || r.right > W + 1) && getComputedStyle(el).visibility !== 'hidden') rau.push((el.id || el.tagName) + ' ' + Math.round(r.right));
    });
    return rau.slice(0, 3).join(', ');
  }, selector);
}

// ═══ A. Pagina publică ════════════════════════════════════════════
const UTILIZATOR = { id: '40000000-0000-4000-8000-0000000000d2', email: 'ana.test@example.com', email_confirmed_at: '2026-10-01T08:00:00Z', user_metadata: { prenume: 'Ana', nume: 'Test' } };

function sesiuneSimulata(user) {
  const sesiune = { access_token: 'token-simulat', user };
  const lant = (rezultat) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rezultat) : () => p), apply: () => p }); return p; };
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: sesiune }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) },
    from: () => lant({ data: null, error: null }), rpc: () => lant({ data: { error: 'simulat' }, error: null }), storage: { from: () => lant({ data: null, error: null }) }, channel: () => lant({}), removeChannel: () => {},
  };
  const auth = new Proxy({ getCurrentUser: async () => user, getUserRoles: async () => [], performLogout: () => {} }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (nume, val) => Object.defineProperty(window, nume, { configurable: true, get: () => val, set: () => {} });
  fix('supabaseClient', client); fix('MyDarrinAuth', auth);
}

const PROFIL = { ok: true, email: UTILIZATOR.email, nume: 'Ana Test', prenume: 'Ana', nume_familie: 'Test', tara: 'RO', roles: ['client', 'investor'], roluri_dashboard: ['client'], investitor: { status: 'in_verificare' } };
const KYC = { ok: true, kyc: { status: 'in_verificare' }, lipsa: [], cont: {} };

const runda = (start, sfarsit) => ({
  cod: 'test', denumire_ro: 'Runda de test', denumire_en: 'Test round', stare: 'deschisa', data_start: start, data_sfarsit: sfarsit,
  moneda: 'EUR', suma_tinta: 100000, investitie_minima: 1000, pret_actiune: 10, equity_oferit_pct: 10, post_money: 1000000,
  tickete: [5000, 10000], instrumente: ['safe'],
});

async function contextPublic(browser, baza, { lang, latime, r, subscrieri }) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: 860 } });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('myd_lang_v1', l);
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
    } catch (e) {}
  }, lang);
  await ctx.addInitScript(sesiuneSimulata, UTILIZATOR);
  await ctx.route(/\.supabase\.co\//, (x) => x.abort());
  const raspunde = (x, cod, corp) => x.fulfill({ status: cod, contentType: 'application/json', body: JSON.stringify(corp) });
  await ctx.route(/\/api\/public\/runda-curenta/, (x) => raspunde(x, 200, { ok: true, runda: r }));
  await ctx.route(/\/api\/cont\/profil/, (x) => raspunde(x, 200, PROFIL));
  await ctx.route(/\/api\/investitori\/kyc(\?|$)/, (x) => raspunde(x, 200, KYC));
  await ctx.route(/\/api\/investitori\/portofoliu/, (x) => raspunde(x, 200, { ok: true, actiuni: 0, valoare_investita: 0, in_asteptare: 0, pct_companie: 0, subscrieri: [],
    runda: Object.assign({ id: 'r1' }, r), exit: { buyback_disponibil: false } }));
  await ctx.route(/\/api\/investitori\/indicatori/, (x) => raspunde(x, 403, { cod: 'KYC_NEAPROBAT', error: 'x', error_en: 'x' }));
  await ctx.route(/\/api\/investitori\/subscrie/, (x) => {
    const c = JSON.parse(x.request().postData() || '{}');
    subscrieri.push(c);
    return raspunde(x, 200, { ok: true, portofoliu: { id: 's1', status: 'in_asteptare' }, actiuni: Math.floor(c.suma / 10), moneda: 'EUR', procent_estimat: 1, kyc_status: 'in_verificare' });
  });
  const p = await ctx.newPage();
  const erori = []; p.on('pageerror', (e) => erori.push(e.message));
  await p.goto(baza + '/mydarrin-investitori', { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForSelector('[data-runda]:not([hidden])', { timeout: 6000 }).catch(() => {});
  return { ctx, p, erori };
}

// Textul unui element, fără așteptare (null dacă lipsește).
const textImediat = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);

async function deschideSubscrierea(p) {
  await p.waitForFunction(() => !!window.MYD_INVESTITOR, null, { timeout: 8000 }).catch(() => {});
  await p.focus('#runda button');
  await p.keyboard.press('Enter');
  await p.waitForSelector('#step-2', { state: 'visible', timeout: 6000 }).catch(() => {});
  await p.waitForSelector('#step-2 .ticket-opt', { timeout: 6000 }).catch(() => {});
}

const ASTEPTAT = {
  ro: 'Deschidere oficială: 1 noiembrie 2099 · subscrierile sunt deja posibile',
  en: 'Official opening: 1 November 2099 · subscriptions are already open',
  de: 'Official opening: 1 November 2099 · subscriptions are already open',
};

async function testPublic(browser, baza) {
  for (const lang of (process.env.LIMBI || 'ro,en,de').split(',').filter((l) => ASTEPTAT[l])) {
    for (const latime of [390, 1366]) {
      for (const viitor of [true, false]) {
        const et = `A ${lang} ${latime}px, data_start ${viitor ? 'în viitor' : 'în trecut'}`;
        const subscrieri = [];
        const r = viitor ? runda('2099-11-01', '2100-06-30') : runda('2020-11-01', '2021-06-30');
        const { ctx, p, erori } = await contextPublic(browser, baza, { lang, latime, r, subscrieri });

        // Cardul rundei
        const card = (await p.innerText('[data-runda]').catch(() => '')).replace(/\s+/g, ' ');
        verifica(/2099|2020/.test(card), `${et}: perioada apare în card („${card.slice(0, 160)}”)`);
        const mesajCard = await textImediat(p, '#runda-deschidere-oficiala');
        if (viitor) {
          verifica(mesajCard && mesajCard.trim() === ASTEPTAT[lang], `${et}: mesajul în card („${mesajCard}”)`);
          const ordine = await p.evaluate(() => {
            const m = document.getElementById('runda-deschidere-oficiala');
            const toate = Array.from(document.querySelectorAll('[data-runda] *'));
            const per = toate.find((e) => e.children.length === 0 && /^(Perioada|Period)$/.test(e.textContent.trim()));
            return !!(m && per && (per.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING));
          });
          verifica(ordine, `${et}: mesajul e sub perioadă`);
        } else {
          verifica(mesajCard == null && !/Deschidere oficială|Official opening/.test(card), `${et}: fără mesaj după data_start`);
        }
        { const d = await inAfaraEcranului(p, '[data-runda], [data-runda] *'); verifica(!d, `${et}: cardul în ecran (${d})`); }

        // Fereastra de subscriere
        await deschideSubscrierea(p);
        const mesajFereastra = await textImediat(p, '#subscriere-deschidere-oficiala');
        if (viitor) {
          verifica(mesajFereastra && mesajFereastra.trim() === ASTEPTAT[lang], `${et}: mesajul în fereastra de subscriere („${mesajFereastra}”)`);
          const deasupra = await p.evaluate(() => {
            const m = document.getElementById('subscriere-deschidere-oficiala');
            const s = document.getElementById('ticket-lista');
            return !!(m && s && m.getBoundingClientRect().bottom <= s.getBoundingClientRect().top + 1);
          });
          verifica(deasupra, `${et}: mesajul e deasupra sumei`);
          const vizibil = await p.isVisible('#subscriere-deschidere-oficiala');
          verifica(vizibil, `${et}: mesajul din fereastră e vizibil`);
        } else {
          verifica(mesajFereastra == null, `${et}: fără mesaj în fereastră`);
        }
        { const d = await inAfaraEcranului(p, '#modal-runda, #modal-runda *'); verifica(!d, `${et}: fereastra în ecran (${d})`); }

        // Subscrierea merge (nicio blocare înainte sau după perioadă)
        await p.click('#step-2 .ticket-opt >> nth=0');
        await p.click('#step-2 button[onclick="goStep(3)"]');
        await p.check('#nda-check');
        await p.click('#submit-invest-btn');
        await p.waitForSelector('#step-4', { state: 'visible', timeout: 6000 }).catch(() => {});
        verifica(subscrieri.length === 1 && subscrieri[0].suma === 5000, `${et}: subscrierea e trimisă (${JSON.stringify(subscrieri)})`);
        verifica(await p.isVisible('#step-4'), `${et}: confirmarea după răspunsul serverului`);
        verifica(!erori.length, `${et}: 0 erori JS (${erori.join(' | ')})`);
        await ctx.close();
      }
      console.log(`A ${lang} ${latime}px: gata`);
    }
  }
}

// ═══ B. Panoul „Investitori Admin”, doar citire ═══════════════════
const API = {
  '/api/admin/runde-finantare': require(path.join(RADACINA, 'api/admin/runde-finantare.js')),
  '/api/admin/investitori-dashboard': require(path.join(RADACINA, 'api/admin/investitori-dashboard.js')),
  '/api/admin/investitori-kyc': require(path.join(RADACINA, 'api/admin/investitori-kyc.js')),
  '/api/admin/investitori-aprobare': require(path.join(RADACINA, 'api/admin/investitori-aprobare.js')),
};

function resetAdmin(poateScrie) {
  DB.tabele = {
    profiles: [{ id: 'adm', email: 'adm@example.com', roles: ['admin'] }, { id: 'inv', email: 'inv@example.com', roles: ['client', 'investor'] }],
    admin_permissions: [{ admin_id: 'adm', sectiune: 'investitori', poate_scrie: poateScrie }],
    runde_finantare: [
      { id: 'r-d', cod: 'deschisa', denumire_ro: 'Rundă de test deschisă', denumire_en: 'Open test round', stare: 'deschisa', moneda: 'EUR', evaluare_pre_money: 900, suma_tinta: 100, actiuni_existente: 90, investitie_minima: 10, tickete: null, instrumente: ['actiuni'], vizibila_public: false, afiseaza_progres: false },
      { id: 'r-p', cod: 'plan', denumire_ro: 'Rundă de test planificată', denumire_en: 'Planned test round', stare: 'planificata', moneda: 'EUR', evaluare_pre_money: 900, suma_tinta: 100, actiuni_existente: 90, investitie_minima: 10, tickete: null, instrumente: ['actiuni'], vizibila_public: false, afiseaza_progres: false },
    ],
    investitori_kyc: [{ user_id: 'inv', status: 'in_verificare', date_personale: { prenume: 'Ion', nume: 'Test' }, tip_document: 'ci', submitted_at: '2026-10-20T10:00:00Z' }],
    investitori_portofoliu: [{ id: 's-1', user_id: 'inv', email: 'inv@example.com', runda_id: 'r-d', actiuni: 1, valoare_investita: 10, status: 'in_asteptare', created_at: '2026-10-21T10:00:00Z' }],
    audit_log: [],
  };
  DB.coloane = {};
  DB.utilizatori = { 'tok-adm': { id: 'adm', email: 'adm@example.com' } };
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

async function panouAdmin(browser, baza, latime, cereriScriere) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: 900 } });
  await ctx.addInitScript(sesiuneAdmin, { id: 'adm', email: 'adm@example.com', roles: ['admin'] });
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  await ctx.route(/\/api\//, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const api = API[url.pathname];
    if (!api) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    let corp = null; try { corp = JSON.parse(req.postData() || 'null'); } catch (e) { corp = null; }
    if (req.method() === 'POST' && !(corp && corp.actiune === 'calcul')) cereriScriere.push(url.pathname);
    const res = raspuns();
    await api(cerere({ metoda: req.method(), token: (req.headers().authorization || '').replace('Bearer ', ''), body: corp, query: Object.fromEntries(url.searchParams) }), res);
    return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp || {}) });
  });
  const pg = await ctx.newPage();
  pg.erori = [];
  pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 160)));
  await pg.goto(baza + '/mydarrin-superadmin.html', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(600);
  await pg.evaluate(() => window.showPanel('investitori'));
  await pg.waitForFunction(() => /Rundă de test/.test((document.getElementById('inv-runde-tbody') || {}).textContent || '')
    && /Ion Test/.test((document.getElementById('inv-kyc-tbody') || {}).textContent || '')
    && /inv@example\.com/.test((document.getElementById('inv-subscrieri-tbody') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  return { ctx, pg };
}

const BUTOANE_SCRIERE = ['+ Rundă nouă', 'Editează', 'Deschide', 'Închide', 'Aprobă', 'Respinge'];
async function butoaneVizibile(pg) {
  return pg.evaluate((etichete) => {
    const panou = document.getElementById('panel-investitori') || document.body;
    return Array.from(panou.querySelectorAll('button')).filter((b) => b.offsetParent !== null)
      .map((b) => b.textContent.replace(/[✓✗+]/g, '').trim())
      .filter((t) => etichete.some((e) => t === e.replace('+ ', '')));
  }, BUTOANE_SCRIERE);
}

async function testAdmin(browser, baza) {
  for (const latime of [390, 1366]) {
    const et = `B ro ${latime}px`;
    // doar citire
    {
      resetAdmin(false);
      const cereri = [];
      const { ctx, pg } = await panouAdmin(browser, baza, latime, cereri);
      verifica(await pg.isVisible('#inv-doar-citire'), `${et} doar citire: nota e vizibilă`);
      const nota = await pg.innerText('#inv-doar-citire').catch(() => '');
      verifica(/Acces doar de citire/.test(nota) && /Read-only access/.test(nota), `${et} doar citire: „Acces doar de citire” / „Read-only access” („${nota}”)`);
      const randuri = await pg.innerText('#inv-runde-tbody');
      verifica(/Rundă de test deschisă/.test(randuri) && /Rundă de test planificată/.test(randuri), `${et} doar citire: rundele se văd`);
      verifica(/Ion Test/.test(await pg.innerText('#inv-kyc-tbody')), `${et} doar citire: cererile KYC se văd`);
      verifica(/inv@example\.com/.test(await pg.innerText('#inv-subscrieri-tbody')), `${et} doar citire: subscrierile se văd`);
      const b = await butoaneVizibile(pg);
      verifica(!b.length, `${et} doar citire: fără butoane de scriere (${b.join(', ')})`);
      verifica(!cereri.length, `${et} doar citire: nicio cerere de scriere trimisă (${cereri.join(', ')})`);
      const d = await inAfaraEcranului(pg, '#inv-doar-citire'); verifica(!d, `${et} doar citire: nota în ecran (${d})`);
      verifica(!pg.erori.length, `${et} doar citire: 0 erori JS (${pg.erori.join(' | ')})`);
      await ctx.close();
    }
    // control: cu poate_scrie = true, butoanele apar și nota nu
    {
      resetAdmin(true);
      const { ctx, pg } = await panouAdmin(browser, baza, latime, []);
      verifica(!(await pg.isVisible('#inv-doar-citire')), `${et} scriere: fără notă`);
      const b = await butoaneVizibile(pg);
      for (const e of ['Rundă nouă', 'Editează', 'Deschide', 'Închide', 'Aprobă', 'Respinge']) verifica(b.includes(e), `${et} scriere: butonul „${e}” apare (${b.join(', ')})`);
      verifica(!pg.erori.length, `${et} scriere: 0 erori JS (${pg.erori.join(' | ')})`);
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
    await testPublic(browser, baza);
    await testAdmin(browser, baza);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
