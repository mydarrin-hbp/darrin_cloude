// scripts/test-b2g-pret-server.js
// Teste pentru pasul 11-C3 (4 nov. 2026): comenzile B2G (instituții publice)
// pe calculul de preț de pe server, în același loc ca B2C (lib/comanda-pret.js).
// Peste un Supabase simulat — nimic nu ajunge la producție.
//   A. api/comenzi/creeaza-b2g.js: valoare_totala / suma_asigurare / cost_*
//      din cerere se ignoră — prețul salvat și suma din proformă sunt cele
//      calculate pe server; prețul B2G = prețul B2C (același serviciu, nivel,
//      cantitate, adresă; și pentru materiale); fără preț real → 409 FARA_PRET;
//      în afara zonei → 409 SERVICIU_INDISPONIBIL; țară inactivă → 403
//      ZONA_INDISPONIBILA; lipsa denumirii / a CUI-ului instituției, metoda de
//      plată greșită → 400 pe câmpul corect (forma comună, RO + EN); comanda
//      B2G nu pornește alocarea la creare (B2C da), status_plata în așteptare;
//   B. checkout-ul B2G în Chromium, de la cap la coadă (390 și 1366 px, RO și
//      EN): cererea fără prețuri, comanda creată cu prețul de pe server, egal cu
//      totalul afișat; fără derulare orizontală și fără erori JS.
// Rulare: node scripts/test-b2g-pret-server.js   (FARA_BROWSER=1: doar A)

const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

function stub(fisier, exp) {
  const p = require.resolve(path.join(RADACINA, fisier));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };
}
const ALOCARI = [];
stub('lib/rate-limit.js', { checkRateLimit: async () => true });
stub('lib/aloca-partener.js', { incearcaAlocarePartener: async (id) => { ALOCARI.push(id); return { alocat: false, motiv: 'test' }; } });
stub('lib/notificari-comanda.js', { notificaAdminFaraPartener: async () => true, notificaPartenerAlocat: async () => true, MOTIVE: {} });
stub('lib/contact-platforma.js', { incarcaContactPlatformaSigur: async () => null, incarcaContactPlatforma: async () => null, contactPlatformaDinCache: () => null });
// Poarta procesatorului de carduri: niciun furnizor activ (ca azi) → 503.
stub('lib/integrare-gate.js', { verificaIntegrare: async (res) => { res.status(503).json({ ok: false, error: 'Plata cu cardul nu este încă activă.', error_en: 'Card payment is not active yet.' }); return null; } });

const SERV = 'c0000000-0000-4000-8000-0000000000c1';
const SERV_FARA = 'c0000000-0000-4000-8000-0000000000c2';
const MAT = 'd0000000-0000-4000-8000-0000000000d1';
const NIV = 'e0000000-0000-4000-8000-0000000000e1';
const NIV_FARA = 'e0000000-0000-4000-8000-0000000000e2';
const U = 'a0000000-0000-4000-8000-00000000000a';
// Rețeta: doar pentru NIV (restul nivelurilor nu au articole legate).
const modulReteta = require(path.join(RADACINA, 'lib/calculeaza-cost-recipe.js'));
modulReteta.calculeazaCostNivel = async ({ nivelId, cantitate = 1 }) => (nivelId === NIV
  ? { nivel_activ: true, resurse_fara_pret: [], cost_baza_servicii: 250 * cantitate, cost_materiale: 30 * cantitate, cost_utilaj: 0, manopera_per_esco: {} }
  : { cost_baza_servicii: 0, cost_materiale: 0, cost_utilaj: 0, articole: [], resurse_fara_pret: [{ motiv: 'niciun_articol_legat_de_nivel' }] });

const REGIUNE = require(path.join(RADACINA, 'lib/regiune.js'));
const apiB2g = require(path.join(RADACINA, 'api/comenzi/creeaza-b2g.js'));
const apiB2c = require(path.join(RADACINA, 'api/comenzi/creeaza.js'));
const apiPret = require(path.join(RADACINA, 'api/public/calculeaza-pret-nivel.js'));

function reset() {
  DB.tabele = {
    profiles: [{ id: U, email: 'institutie@example.com', roles: ['client'] }],
    tax_configurations: [
      { tara_cod: 'RO', moneda: 'RON', cota_tva: 21, prag_minim_comanda: 100, checkout_activ: true },
      { tara_cod: 'MD', moneda: 'MDL', cota_tva: 20, prag_minim_comanda: 0, checkout_activ: false },
    ],
    backoffice_config: [
      { sectiune: 'pricing', cheie: 'cost_marketing_pct', valoare: '3', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'cost_mentenanta_pct', valoare: '2', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'comision_platforma_default_pct', valoare: '12', tara_cod: 'ALL' },
      { sectiune: 'asigurari', cheie: 'cost_asigurare_pct', valoare: '1', tara_cod: 'ALL' },
    ],
    tarife_transport: [], comenzi: [], invoices: [], adrese_cont: [], profiluri_facturare: [], partners: [],
    geo_regiuni: [['B', 'București'], ['CJ', 'Cluj'], ['IS', 'Iași']].map(([cod, denumire], i) => ({ id: 'g' + i, tara_cod: 'RO', cod, denumire, ordine: i + 1 })),
    catalog_servicii: [
      { id: SERV, id_serviciu: 'montaj-tablou-electric', titlu: 'Montaj tablou electric', categorie: 'servicii', status_public: true, cod_esco: null },
      { id: SERV_FARA, id_serviciu: 'serviciu-fara-pret', titlu: 'Serviciu fără preț', categorie: 'servicii', status_public: true },
      { id: MAT, id_serviciu: 'mat-parchet', titlu: 'Parchet', categorie: 'materiale', status_public: true, unitate_masura: 'm²', catalog_niveluri: [{ id: 'nm', nivel: 'Gold', catalog_preturi: [{ pret: 70, tara_cod: 'RO' }] }] },
    ],
    catalog_niveluri: [{ id: NIV, serviciu_id: SERV, nivel: 'Gold' }, { id: NIV_FARA, serviciu_id: SERV_FARA, nivel: 'Bronze' }],
    catalog_preturi: [],
    devize_articole: [{ articol_id: 'a1', catalog_nivel_id: NIV }],
    partener_servicii_active: [{ partener_id: 'p1', catalog_serviciu_id: SERV, activ: true }, { partener_id: 'p1', catalog_serviciu_id: SERV_FARA, activ: true }],
    parteneri_disponibilitate: [{ partener_id: 'p1', status_live: 'disponibil', tara_cod: 'RO', judete: ['CJ'] }],
    marketplace_materiale: [], marketplace_echipamente: [],
  };
  REGIUNE._golesteCache();
  DB.coloane = {};
  DB.implicite = { comenzi: { moneda: 'RON' } };
  DB.rpc = {};
  DB.utilizatori = { 'tok-u': { id: U, email: 'institutie@example.com' } };
  ALOCARI.length = 0;
}

let ok = 0, esec = 0;
async function test(nume, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + nume); }
  catch (e) { esec++; console.log('  ✗ ' + nume + ' — ' + e.message); }
}
function egal(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(c, m) { if (!c) throw new Error(m || 'condiție falsă'); }
async function cheama(api, body, token = 'tok-u') {
  const res = raspuns();
  await api(cerere({ metoda: 'POST', token, body }), res);
  return res;
}
function formaComuna(corp, numeCamp) {
  adevarat(corp && corp.ok === false && corp.mesaj && corp.mesaj.ro && corp.mesaj.en, 'forma comună, RO + EN: ' + JSON.stringify(corp));
  if (numeCamp) egal([corp.camp, corp.campuri[0] && corp.campuri[0].camp], [numeCamp, numeCamp], 'câmpul');
}
const COMUN = { adresa: 'Str. Memorandumului 10, Cluj-Napoca, Cluj', tara_cod: 'RO', regiune: 'Cluj', localitate: 'Cluj-Napoca', nivel_id: NIV, cantitate: 3 };
const B2G = (x = {}) => Object.assign({}, COMUN, { denumire_institutie_b2g: 'Primăria Test', cui_client_b2g: 'RO12345678', metoda_plata: 'ordin_plata' }, x);
const B2C = (x = {}) => Object.assign({}, COMUN, { date_facturare: { tip: 'pf', prenume: 'Ana', nume: 'Albu' }, metoda_plata: 'ordin_plata' }, x);

async function testeServer() {
  console.log('A. api/comenzi/creeaza-b2g.js — prețul de pe server');
  await test('valoare_totala / suma_asigurare / cost_* trimise se ignoră: prețul salvat și suma din proformă sunt ale serverului', async () => {
    reset();
    const asteptat = (await cheama(apiPret, { nivel_id: NIV, cantitate: 3, tara_cod: 'RO', regiune: 'Cluj' })).corp.pret_final;
    const r = await cheama(apiB2g, B2G({ valoare_totala: 1, suma_asigurare: 0.5, cost_baza_servicii: 1, cost_materiale: 0, cost_chirie_scule: 0, cost_asigurare: 0, cost_curier: 0 }));
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    const c = DB.tabele.comenzi[0];
    egal([c.suma_totala_platita, c.suma_manopera, c.nivel_id, c.catalog_serviciu_id], [asteptat, 750, NIV, SERV]);
    egal(DB.tabele.invoices[0].suma_totala, asteptat, 'proforma');
    adevarat(asteptat > 750, 'cu taxele platformei și TVA');
  });
  await test('prețul B2G = prețul B2C (același serviciu, nivel, cantitate, adresă)', async () => {
    reset();
    const b2c = await cheama(apiB2c, B2C());
    const b2g = await cheama(apiB2g, B2G());
    egal([b2c.statusCode, b2g.statusCode], [200, 200], JSON.stringify([b2c.corp, b2g.corp]));
    const [x, y] = DB.tabele.comenzi;
    for (const k of ['suma_totala_platita', 'suma_manopera', 'suma_materiale', 'suma_asigurare', 'suma_comision_platforma', 'tva_suma']) egal(y[k], x[k], k);
    egal([x.tip_client, y.tip_client], ['b2c', 'b2g']);
  });
  await test('materiale (produse_marketplace): prețul B2G = prețul B2C, calculat pe server', async () => {
    reset();
    const corp = { nivel_id: undefined, cantitate: undefined, produse_marketplace: [{ id: MAT, qty: 10, nivel: 'Gold' }], valoare_totala: 1 };
    const b2c = await cheama(apiB2c, B2C(corp));
    const b2g = await cheama(apiB2g, B2G(corp));
    egal([b2c.statusCode, b2g.statusCode], [200, 200], JSON.stringify([b2c.corp, b2g.corp]));
    egal(DB.tabele.comenzi[1].suma_totala_platita, DB.tabele.comenzi[0].suma_totala_platita);
    egal(DB.tabele.comenzi[1].suma_materiale, 700);
  });
  await test('fără nivel cu preț real → 409 FARA_PRET (și fără nivel deloc, doar valoare_totala); nicio comandă', async () => {
    reset();
    for (const x of [{ nivel_id: NIV_FARA }, { nivel_id: undefined, valoare_totala: 500 }, { nivel_id: undefined, cost_baza_servicii: 400 }]) {
      const r = await cheama(apiB2g, B2G(x));
      egal([r.statusCode, r.corp.cod], [409, 'FARA_PRET'], JSON.stringify(x));
      formaComuna(r.corp, 'nivel_id');
      egal(r.corp.mesaj, { ro: 'Acest serviciu nu are încă un preț fix. Cere un deviz.', en: 'This service does not have a fixed price yet. Ask for a quote.' });
    }
    egal([DB.tabele.comenzi.length, DB.tabele.invoices.length], [0, 0]);
  });
  await test('adresă în afara zonei → 409 SERVICIU_INDISPONIBIL pe adresa; țară inactivă → 403 ZONA_INDISPONIBILA', async () => {
    reset();
    const r = await cheama(apiB2g, B2G({ regiune: 'Iași', localitate: 'Iași', adresa: 'Str. Lăpușneanu 10, Iași' }));
    egal([r.statusCode, r.corp.cod], [409, 'SERVICIU_INDISPONIBIL']);
    formaComuna(r.corp, 'adresa');
    const z = await cheama(apiB2g, B2G({ tara_cod: 'MD', regiune: null }));
    egal([z.statusCode, z.corp.cod], [403, 'ZONA_INDISPONIBILA']);
    formaComuna(z.corp, 'tara_cod');
    egal(DB.tabele.comenzi.length, 0);
  });
  await test('lipsa denumirii / CUI greșit / metodă de plată greșită / adresă lipsă → 400 pe câmpul corect, RO + EN', async () => {
    reset();
    for (const [x, numeCamp] of [[{ denumire_institutie_b2g: '  ' }, 'denumire_institutie_b2g'], [{ denumire_institutie_b2g: undefined }, 'denumire_institutie_b2g'],
      [{ cui_client_b2g: '' }, 'cui_client_b2g'], [{ cui_client_b2g: 'ABC' }, 'cui_client_b2g'], [{ metoda_plata: 'cash' }, 'metoda_plata'], [{ adresa: ' ' }, 'adresa']]) {
      const r = await cheama(apiB2g, B2G(x));
      egal(r.statusCode, 400, JSON.stringify(x));
      formaComuna(r.corp, numeCamp);
    }
    egal(DB.tabele.comenzi.length, 0);
  });
  await test('card fără procesator activ → 503 (poarta integrării), nicio comandă', async () => {
    reset();
    egal((await cheama(apiB2g, B2G({ metoda_plata: 'card' }))).statusCode, 503);
    egal(DB.tabele.comenzi.length, 0);
  });
  await test('comanda B2G nu pornește alocarea la creare (B2C da); status_plata în așteptare; mesaj RO + EN', async () => {
    reset();
    const r = await cheama(apiB2g, B2G());
    egal(r.statusCode, 200);
    egal(ALOCARI.length, 0, 'alocări B2G');
    const c = DB.tabele.comenzi[0];
    egal([c.tip_client, c.status_plata, c.status, c.denumire_institutie_b2g, c.cui_client_b2g, c.regiune], ['b2g', 'in_asteptare', 'in_cautare_partener', 'Primăria Test', 'RO12345678', 'CJ']);
    adevarat(r.corp.mesaj && r.corp.mesaj_en && /transfer/.test(r.corp.mesaj_en), 'mesaj RO + EN');
    await cheama(apiB2c, B2C());
    egal(ALOCARI.length, 1, 'B2C pornește alocarea');
  });
  await test('fără autentificare → 401', async () => {
    reset();
    egal((await cheama(apiB2g, B2G(), null)).statusCode, 401);
  });
}

// ── B. Checkout-ul B2G în Chromium ──────────────────────────────────────
async function testeBrowser() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { esec++; console.log('  ✗ Playwright lipsește'); return; }
  const { porneste } = require('./server-test');
  const API = {
    '/api/comenzi/creeaza-b2g': apiB2g,
    '/api/comenzi/creeaza': apiB2c,
    '/api/public/calculeaza-pret-nivel': apiPret,
    '/api/public/metode-plata-disponibile': async (req, res) => res.status(200).json({ ok: true, metode_acceptate: ['ordin_plata'] }),
    '/api/public/tari-active': async (req, res) => res.status(200).json({ ok: true, active: ['RO'], tari: [{ tara_cod: 'RO', tara_nume: 'România' }], tva: { RO: 21 } }),
  };
  function sesiune(user) {
    const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
    const ses = { access_token: 'tok-u', user };
    const client = {
      auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: ses }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) },
      from: () => lant({ data: [], error: null, count: 0 }), rpc: () => lant({ data: null, error: null }), storage: { from: () => lant({ data: null, error: null }) }, channel: () => lant({}), removeChannel: () => {},
    };
    const auth = new Proxy({ getCurrentUser: async () => user, getUserRoles: async () => user.roles, hasRole: async () => true, performLogout: () => {} }, { get: (t, k) => (k in t ? t[k] : async () => null) });
    const fix = (n, v) => Object.defineProperty(window, n, { configurable: true, get: () => v, set: () => {} });
    fix('supabaseClient', client); fix('MyDarrinAuth', auth);
  }
  const CFG = { titlu: 'Montaj tablou electric', total: 1, nivel_id: NIV, cantitate: 3, tara_cod: 'RO', regiune: 'CJ', localitate: 'Cluj-Napoca', addr: 'Str. Memorandumului 10', materiale: [], inchirieri: [] };
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const lang of ['ro', 'en']) {
      for (const latime of [390, 1366]) {
        console.log(`B. Checkout B2G (${lang.toUpperCase()} ${latime}px)`);
        reset();
        const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 720 ? 844 : 900 }, hasTouch: latime < 720 });
        await ctx.addInitScript(([l, cfg]) => {
          try {
            localStorage.setItem('myd_lang_v1', l);
            localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), marketing: false, versiune: 2 }));
            if (!sessionStorage.getItem('_init')) { sessionStorage.setItem('myd_checkout_config', JSON.stringify(cfg)); sessionStorage.setItem('_init', '1'); }
          } catch (e) {}
        }, [lang, CFG]);
        await ctx.addInitScript(sesiune, { id: U, email: 'institutie@example.com', roles: ['client'], user_metadata: { prenume: 'Ana', nume: 'Albu' } });
        await ctx.route(/\.supabase\.co\//, (r) => r.abort());
        const cereri = [];
        await ctx.route(/\/api\//, async (r) => {
          const req = r.request();
          const u = new URL(req.url());
          let corp = null; try { corp = JSON.parse(req.postData() || 'null'); } catch (e) { corp = null; }
          cereri.push({ cale: u.pathname, corp });
          const api = API[u.pathname];
          if (!api) return r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"API unavailable on the test server"}' });
          const res = raspuns();
          await api(cerere({ metoda: req.method(), token: (req.headers().authorization || '').replace('Bearer ', '') || null, body: corp, query: Object.fromEntries(u.searchParams) }), res);
          return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp || {}) });
        });
        const pg = await ctx.newPage();
        pg.setDefaultTimeout(8000);
        const erori = [];
        pg.on('pageerror', (e) => erori.push(e.message.slice(0, 200)));
        await pg.goto(baza + '/mydarrin-checkout.html', { waitUntil: 'networkidle' });
        await test(`${lang} ${latime}: checkout B2G de la cap la coadă — cererea fără prețuri, comanda cu prețul de pe server, egal cu totalul afișat`, async () => {
          await pg.waitForFunction(() => typeof PRET_SERVER !== 'undefined' && PRET_SERVER.stare === 'ok');
          const afisat = await pg.evaluate(() => PRET_SERVER.pret);
          egal(await pg.$eval('#b2g-toggle', (c) => c.disabled), false, 'B2G disponibil');
          await pg.evaluate(() => goToStep('details'));
          await pg.fill('#co-prenume', 'Ana'); await pg.fill('#co-nume', 'Albu');
          await pg.fill('#co-telefon', '+40 721 000 000'); await pg.fill('#co-email', 'institutie@example.com');
          await pg.fill('#co-adresa', 'Str. Memorandumului 10'); await pg.fill('#co-oras', 'Cluj-Napoca');
          await pg.selectOption('#co-judet', 'Cluj');
          await pg.evaluate(() => goToStep('payment'));
          await pg.check('#b2g-toggle');
          await pg.waitForSelector('input[name="b2g-metoda"][value="ordin_plata"]', { state: 'attached' });
          await pg.fill('#b2g-denumire', 'Primăria Test'); await pg.fill('#b2g-cui', 'RO12345678');
          egal(await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'derulare orizontală');
          await pg.click('#btn-finalizeaza');
          await pg.waitForSelector('#order-confirm-overlay', { timeout: 6000 });
          const trimis = cereri.filter((c) => c.cale === '/api/comenzi/creeaza-b2g').pop().corp;
          adevarat(!['valoare_totala', 'suma_asigurare', 'cost_baza_servicii', 'cost_asigurare', 'cost_materiale', 'cost_chirie_scule'].some((k) => k in trimis), 'prețuri în cerere: ' + JSON.stringify(trimis));
          egal([trimis.nivel_id, trimis.metoda_plata, trimis.denumire_institutie_b2g], [NIV, 'ordin_plata', 'Primăria Test']);
          const c = DB.tabele.comenzi[0];
          egal([c.tip_client, c.suma_totala_platita, DB.tabele.invoices[0].suma_totala], ['b2g', afisat, afisat], 'comanda = totalul afișat = proforma');
          egal(ALOCARI.length, 0, 'fără alocare la creare');
          const t = await pg.textContent('#order-confirm-overlay');
          if (lang === 'en') adevarat(/transfer/.test(t), 'mesajul în EN: ' + t.slice(0, 200));
          egal(erori, [], 'erori JS');
        });
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

(async () => {
  await testeServer();
  if (!process.env.FARA_BROWSER) await testeBrowser();
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})();
