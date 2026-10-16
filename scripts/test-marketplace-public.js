// scripts/test-marketplace-public.js
// Teste pentru marketplace-ul public (pasul 10a, 2.4 și 2.5, 16 oct. 2026):
//   A. API-ul public (api/public/marketplace-produse.js) peste un Supabase
//      simulat: doar produse live și active, nodurile fără produse ascunse,
//      „Home Best Pal” pentru furnizorul propriu, prețul cu formula
//      platformei, fără costul furnizorului și fără discount, paginare;
//   B. comanda de produse (api/comenzi/creeaza.js) cu prețul calculat pe
//      server și escrow-ul ei (furnizorul propriu: fără discount);
//   C. pagina mydarrin-marketplace-materiale.html în Playwright, cu API-ul
//      real servit local peste același Supabase simulat: fără produse live →
//      „Produsele apar în curând.”; cu un produs live simulat → afișat corect
//      în RO și EN, la 1366 și 390 px, fără depășiri și 0 erori JS.
// Nimic nu ajunge la Supabase sau la producție.
//
// Cerințe pentru C (nu e dependență a proiectului):
//   npm i --no-save playwright && npx playwright install chromium
// Fără Playwright, partea C se sare (spus explicit în rezultat).
// Rulare: node scripts/test-marketplace-public.js [--capturi <dosar>]

const http = require('http');
const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

// Module cu dependențe externe (Vercel KV, qrcode, pdfkit) — înlocuite în test.
function stub(fisier, exp) {
  const p = require.resolve(path.join(RADACINA, fisier));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };
}
const notificari = [];
stub('lib/rate-limit.js', { checkRateLimit: async () => true });
stub('lib/genereaza-proforma-pdf.js', { genereazaProformaPDF: async () => Buffer.from('') });
stub('lib/aloca-partener.js', { incearcaAlocarePartener: async () => ({ alocat: false, motiv: 'test' }) });
stub('lib/notificari-comanda.js', { notificaAdminFaraPartener: async (c, motiv) => { notificari.push(motiv); return true; }, notificaPartenerAlocat: async () => true, MOTIVE: {} });

const apiMarketplace = require(path.join(RADACINA, 'api/public/marketplace-produse.js'));
const apiCreeaza = require(path.join(RADACINA, 'api/comenzi/creeaza.js'));
const { elibereazaEscrow } = require(path.join(RADACINA, 'lib/elibereaza-escrow.js'));
const { calculeazaPret, incarcaConfigPret, aplicaFormulaPret } = require(path.join(RADACINA, 'lib/calculeaza-pret.js'));
// Prețurile așteptate vin din aceeași formulă ca la servicii (lib/calculeaza-pret.js).
const pretComanda = async (costMateriale) => (await calculeazaPret({ cost_materiale: costMateriale, tara: 'RO' })).pret_final;
const pretUnitar = async (input) => aplicaFormulaPret(input, await incarcaConfigPret('RO'), undefined, { cuPragMinim: false }).pret_final;

const arg = process.argv.slice(2);
const CAPTURI = arg.includes('--capturi') ? arg[arg.indexOf('--capturi') + 1] : null;
if (CAPTURI) fs.mkdirSync(CAPTURI, { recursive: true });

let trecute = 0;
let picate = 0;
async function test(nume, fn) {
  try { await fn(); trecute++; console.log(`  ✓ ${nume}`); } catch (e) { picate++; console.log(`  ✗ ${nume}\n      ${e.message}`); }
}
function egal(a, b, mesaj) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${mesaj || ''} — așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(v, mesaj) { if (!v) throw new Error(mesaj || 'condiție falsă'); }

// ── Date simulate (structura reală din 16 oct. 2026; produsele sunt de test) ──
const HBP = 'p-hbp';
const EXTERN = 'p-extern';
const IMG = 'https://aacojyvujhywanaulvuu.supabase.co/storage/v1/object/public/marketplace-media/test/robinet.jpg';
const ID = { m1: '11111111-1111-4111-8111-111111111111', m2: '22222222-2222-4222-8222-222222222222', m3: '33333333-3333-4333-8333-333333333333', m4: '44444444-4444-4444-8444-444444444444', m5: '55555555-5555-4555-8555-555555555555', e1: '66666666-6666-4666-8666-666666666666' };
const DESC = 'Robinet cu sferă din alamă nichelată, filet interior 1/2 țoli, pentru instalații de apă rece și caldă; produs de test pentru pagina publică.';
const DESC_EN = 'Nickel-plated brass ball valve, 1/2 inch female thread, for hot and cold water systems; a test product for the public page.';
const prod = (id, o = {}) => ({
  id, furnizor_id: HBP, cod_produs_furnizor: id.slice(0, 4), denumire: 'Robinet cu sferă 1/2 țoli', descriere: DESC, descriere_pret: 'Preț per bucată',
  categorie_id: 'n-robinete', nace_cod: '47.52', cod_uniclass: 'Pr_65_54_95_16', pret_fara_tva: 25, moneda: 'RON', cota_tva: 21, pret_cu_tva: 30.25,
  unitate_masura: 'buc', stoc_disponibil: 12, lead_time_zile: 2, imagini: [{ url: IMG, ordine: 0 }], status: 'live', activ: true,
  traduceri: { en: { denumire: 'Ball valve 1/2 inch', descriere: DESC_EN, descriere_pret: 'Price per piece' } }, ...o,
});

function reseteaza({ produse = 'toate' } = {}) {
  const materiale = {
    toate: [
      prod(ID.m1),
      prod(ID.m2, { furnizor_id: EXTERN, denumire: 'Țeavă PPR 20 mm', categorie_id: 'n-fierarie', pret_fara_tva: 4, unitate_masura: 'm', traduceri: {} }),
      prod(ID.m3, { status: 'in_asteptare', denumire: 'Produs în așteptare' }),
      prod(ID.m4, { activ: false, denumire: 'Produs inactiv' }),
      prod(ID.m5, { categorie_id: 'n-sanitar', denumire: 'Produs pe nod de servicii' }),
    ],
    unul: [prod(ID.m1)],
    niciunul: [prod(ID.m3, { status: 'in_asteptare' })],
  }[produse];
  DB.tabele = {
    partners: [
      { id: HBP, nume_firma: 'Home Best Pal SRL', partner_type: 'furnizor_materiale', entitate_platforma_id: 'ent-ro', status_verificare: 'approved', contract_semnat: true },
      { id: EXTERN, nume_firma: 'Instal Extern SRL', partner_type: 'furnizor_materiale', entitate_platforma_id: null, status_verificare: 'approved', contract_semnat: true },
    ],
    categorii: [
      { id: 'n-robinete', slug: 'robinete-colectoare', title: 'Robinete și colectoare', title_en: null, capitol_cod: null, category_type: 'materiale', display_order: 1, activ: true },
      { id: 'n-fierarie', slug: 'fierarie', title: 'Fierărie', title_en: 'Hardware', capitol_cod: 'G', category_type: 'materiale', display_order: 2, activ: true },
      { id: 'n-gresie', slug: 'gresie-faianta', title: 'Gresie și faianță', title_en: null, capitol_cod: null, category_type: 'materiale', display_order: 3, activ: true },
      { id: 'n-sanitar', slug: 'instalatii-sanitare', title: 'Instalații sanitare', title_en: 'Plumbing', capitol_cod: 'F', category_type: 'servicii', display_order: 4, activ: true },
      { id: 'n-o77', slug: 'utilaje-constructii', title: 'Utilaje pentru construcții', title_en: 'Construction machinery', capitol_cod: 'O77', category_type: 'inchirieri', display_order: 5, activ: true },
    ],
    marketplace_materiale: materiale,
    marketplace_echipamente: produse === 'toate'
      ? [{ id: ID.e1, furnizor_id: HBP, denumire: 'Rotopercutor SDS-Max', descriere: DESC, descriere_pret: 'Preț per zi', categorie_id: 'n-o77', operator_inclus: 'fara_operator', tarif_zi: 60, moneda: 'RON', buc_disponibile: 2, imagini: [{ url: IMG }], status: 'live', activ: true, traduceri: {} }]
      : [],
    tax_configurations: [{ tara_cod: 'RO', moneda: 'RON', cota_tva: 21, prag_minim_comanda: 100, checkout_activ: true }],
    backoffice_config: [
      { sectiune: 'pricing', cheie: 'cost_marketing_pct', valoare: '3', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'cost_mentenanta_pct', valoare: '2', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'comision_platforma_default_pct', valoare: '12', tara_cod: 'ALL' },
      { sectiune: 'asigurari', cheie: 'cost_asigurare_pct', valoare: '1', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'comision_bricolaj_contractat_pct', valoare: '15', tara_cod: 'ALL' },
    ],
    tarife_transport: [],
    parteneri_discounturi: [{ partener_id: HBP, tip_partener: 'materiale', categorie: 'x', discount_pct: 10, activ: true, aprobat_de: 'u', valabil_de: '2026-01-01', valabil_pana: null }],
    facturi_parteneri: [],
    comenzi: [],
    invoices: [],
    profiles: [{ id: 'u-client', roles: ['client'], email: null }],
    comanda_subcontractori: [],
    comisioane: [],
    audit_log: [],
    // Pasul 10c: furnizorul extern poate vinde doar cu cont bancar activ (lib/eligibilitate-partener.js).
    partner_conturi_bancare: [{ id: 'cb-extern', partner_id: EXTERN, activ: true }],
    catalog_servicii: [],
  };
  DB.implicite = {};
  DB.utilizatori = { 'tok-client': { id: 'u-client' } };
}

async function get(query) {
  const res = raspuns();
  await apiMarketplace(cerere({ query }), res);
  return res;
}
async function post(body) {
  const res = raspuns();
  await apiMarketplace(cerere({ metoda: 'POST', body }), res);
  return res;
}

// Server local pentru partea C: fișierele site-ului + API-ul public real.
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function server() {
  return new Promise((ok) => {
    const s = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/public/marketplace-produse') {
        let corp = '';
        req.on('data', (c) => { corp += c; });
        await new Promise((r) => req.on('end', r));
        const r = raspuns();
        await apiMarketplace({ method: req.method, query: Object.fromEntries(url.searchParams), body: corp ? JSON.parse(corp) : null, headers: {} }, r);
        res.writeHead(r.statusCode, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(r.corp));
      }
      // Traducerile catalogului (i18n-loader.js, în EN): fără conținut de catalog în acest test.
      if (url.pathname === '/api/public/traduceri-catalog') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"_texte":{}}'); }
      if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}'); }
      let f = path.join(RADACINA, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, () => ok(s));
  });
}

(async () => {
  console.log('A. API-ul public');
  reseteaza();
  const lista = await get({ tip: 'materiale', lang: 'en' });
  await test('doar produsele live și active, pe noduri din G (fără cel în așteptare, inactiv sau pe nod de servicii)', async () => {
    egal(lista.statusCode, 200);
    egal(lista.corp.produse.map((p) => p.id).sort(), [`mp:materiale:${ID.m1}`, `mp:materiale:${ID.m2}`].sort());
  });
  await test('nodurile fără produse live nu apar; numărul pe nod e corect', async () => {
    egal(lista.corp.noduri.map((n) => [n.slug, n.numar]), [['robinete-colectoare', 1], ['fierarie', 1]]);
  });
  await test('furnizorul propriu apare „Home Best Pal”, cel extern cu numele firmei', async () => {
    const f = Object.fromEntries(lista.corp.produse.map((p) => [p.id, p.furnizor]));
    egal([f[`mp:materiale:${ID.m1}`], f[`mp:materiale:${ID.m2}`]], ['Home Best Pal', 'Instal Extern SRL']);
  });
  await test('prețul cu TVA = formula platformei pe costul furnizorului (25 lei → 35,72 lei / buc)', async () => {
    egal(lista.corp.produse.find((p) => p.id === `mp:materiale:${ID.m1}`).pret_cu_tva, 35.72);
  });
  await test('răspunsul public nu conține costul furnizorului, discountul sau datele interne', async () => {
    const json = JSON.stringify(lista.corp);
    for (const interzis of ['pret_fara_tva', 'discount', 'furnizor_id', 'cod_produs_furnizor', 'entitate_platforma_id', '"25"', ':25,']) {
      adevarat(!json.includes(interzis), `apare „${interzis}”`);
    }
  });
  await test('EN: textul din traduceri.en; fără traducere → textul RO, marcat limba_text = ro', async () => {
    const p1 = lista.corp.produse.find((p) => p.id === `mp:materiale:${ID.m1}`);
    const p2 = lista.corp.produse.find((p) => p.id === `mp:materiale:${ID.m2}`);
    egal([p1.denumire, p1.limba_text], ['Ball valve 1/2 inch', 'en']);
    egal([p2.denumire, p2.limba_text], ['Țeavă PPR 20 mm', 'ro']);
    const ro = await get({ tip: 'materiale', lang: 'ro' });
    egal(ro.corp.produse.find((p) => p.id === `mp:materiale:${ID.m1}`).denumire, 'Robinet cu sferă 1/2 țoli');
  });
  await test('filtrare pe nod, căutare și paginare', async () => {
    egal((await get({ tip: 'materiale', nod: 'fierarie' })).corp.produse.map((p) => p.id), [`mp:materiale:${ID.m2}`]);
    egal((await get({ tip: 'materiale', q: 'PPR', lang: 'ro' })).corp.produse.map((p) => p.id), [`mp:materiale:${ID.m2}`]);
    const p1 = await get({ tip: 'materiale', pe_pagina: '1', pagina: '1' });
    const p2 = await get({ tip: 'materiale', pe_pagina: '1', pagina: '2' });
    egal([p1.corp.total, p1.corp.produse.length, p2.corp.produse.length], [2, 1, 1]);
    adevarat(p1.corp.produse[0].id !== p2.corp.produse[0].id, 'aceeași pagină de două ori');
  });
  await test('închirieri: nodul din O77, unitatea „zi”, prețul pe zi cu formula (60 lei/zi → 85,70 lei/zi)', async () => {
    const e = await get({ tip: 'echipamente', lang: 'ro' });
    egal(e.corp.noduri.map((n) => n.slug), ['utilaje-constructii']);
    egal([e.corp.produse[0].unitate, e.corp.produse[0].pret_cu_tva, e.corp.produse[0].furnizor], ['zi', await pretUnitar({ cost_chirie_scule: 60 }), 'Home Best Pal']);
    egal(e.corp.produse[0].pret_cu_tva, 85.7);
  });
  await test('un produs după id (configurator); unul care nu e live → 404', async () => {
    egal((await get({ id: `mp:materiale:${ID.m1}`, lang: 'en' })).corp.produs.denumire, 'Ball valve 1/2 inch');
    egal((await get({ id: `mp:materiale:${ID.m3}` })).statusCode, 404);
    egal((await get({ id: 'mp:materiale:nu-e-uuid' })).statusCode, 400);
  });
  await test('POST preț: comanda întreagă, cu pragul minim de comandă (2 × 25 lei → 100 lei; 10 × 25 lei → 357,10 lei)', async () => {
    egal((await post({ produse: [{ id: `mp:materiale:${ID.m1}`, qty: 2 }] })).corp.pret_final, 100);
    egal((await post({ produse: [{ id: `mp:materiale:${ID.m1}`, qty: 10 }] })).corp.pret_final, await pretComanda(250));
    egal(await pretComanda(250), 357.1);
    egal((await post({ produse: [{ id: `mp:materiale:${ID.m3}`, qty: 1 }] })).corp.disponibil, false);
  });
  await test('fără produse live → nicio categorie, niciun produs', async () => {
    reseteaza({ produse: 'niciunul' });
    const r = await get({ tip: 'materiale' });
    egal([r.corp.noduri.length, r.corp.produse.length, r.corp.total], [0, 0, 0]);
  });

  console.log('B. Comanda de produse și escrow-ul ei');
  reseteaza();
  const resC = raspuns();
  await apiCreeaza(cerere({ metoda: 'POST', token: 'tok-client', body: { adresa: 'Str. Exemplu 1, București', tara_cod: 'RO', produse_marketplace: [{ id: `mp:materiale:${ID.m1}`, qty: 10 }], valoare_totala: 1, cost_materiale: 1 } }), resC);
  const comanda = DB.tabele.comenzi[0];
  await test('comanda se creează cu prețul calculat pe server (ignoră valoare_totala / cost_* din client)', async () => {
    egal(resC.statusCode, 200, JSON.stringify(resC.corp));
    egal([comanda.suma_totala_platita, comanda.suma_materiale, comanda.suma_manopera], [await pretComanda(250), 250, 0]);
  });
  await test('comanda reține furnizorul fiecărui produs (addon_materiale_selectate)', async () => {
    egal(comanda.addon_materiale_selectate.map((i) => [i.furnizor_id, i.categorie, i.subtotal]), [[HBP, 'materiale', 250]]);
  });
  await test('adminul e anunțat că e o comandă de produse (nu „fără serviciu”)', async () => {
    egal(notificari, ['comanda_produse_marketplace']);
  });
  await test('escrow: rândul de materiale pe Home Best Pal, fără discount (furnizor propriu), deși are discount în profil', async () => {
    comanda.status = 'finalizata';
    const r = await elibereazaEscrow(comanda.id);
    egal(r.ok, true, JSON.stringify(r));
    const materiale = DB.tabele.comanda_subcontractori.filter((x) => x.rol_tip === 'materiale');
    egal(materiale.map((x) => [x.actor_id, x.suma_neta_alocata, x.discount_pct_aplicat, x.discount_sursa]), [[HBP, 250, 0, 'furnizor_propriu']]);
    // Asigurarea de 1% fără asigurător partener rămâne rezervă de daune (regula de azi).
    egal(DB.tabele.comanda_subcontractori.filter((x) => x.rol_tip !== 'materiale').map((x) => [x.rol_tip, x.suma_neta_alocata]), [['rezerva_daune', 2.5]]);
    egal(DB.tabele.comisioane[0].comision_retinut_bricolaj, 0);
  });
  await test('produs care nu e live în comandă → 400, nicio comandă', async () => {
    reseteaza();
    const r = raspuns();
    await apiCreeaza(cerere({ metoda: 'POST', token: 'tok-client', body: { adresa: 'Str. Exemplu 1', tara_cod: 'RO', produse_marketplace: [{ id: `mp:materiale:${ID.m3}`, qty: 1 }] } }), r);
    egal([r.statusCode, DB.tabele.comenzi.length], [400, 0]);
  });

  console.log('C. Pagina publică (Playwright)');
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }
  if (!chromium) {
    console.log('  – sărit: Playwright nu e instalat (npm i --no-save playwright)');
  } else {
    const srv = await server();
    const BASE = `http://localhost:${srv.address().port}`;
    const browser = await chromium.launch();
    try {
      for (const limba of ['ro', 'en']) {
        for (const latime of [1366, 390]) {
          const ctx = await browser.newContext({ viewport: { width: latime, height: 900 } });
          if (limba === 'ro') await ctx.addInitScript(() => { try { localStorage.setItem('myd_lang_v1', 'ro'); } catch (e) {} });
          await ctx.route(/marketplace-media/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
          const page = await ctx.newPage();
          const erori = [];
          page.on('pageerror', (e) => erori.push(e.message));
          page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erori.push(m.text()); });
          // Resursele lipsă se raportează cu adresa (mesajul din consolă nu o are).
          page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) erori.push(`${r.status()} ${r.url()}`); });
          const eticheta = `${limba.toUpperCase()} ${latime}px`;

          reseteaza({ produse: 'niciunul' });
          await page.goto(`${BASE}/mydarrin-marketplace-materiale.html`, { waitUntil: 'networkidle' });
          await page.waitForSelector('.empty-state');
          await test(`${eticheta}: fără produse live → „${limba === 'ro' ? 'Produsele apar în curând.' : 'Products are coming soon.'}”, fără categorii`, async () => {
            egal((await page.textContent('.empty-state')).trim(), limba === 'ro' ? 'Produsele apar în curând.' : 'Products are coming soon.');
            egal(await page.locator('.nod').count(), 0);
          });
          if (CAPTURI) await page.screenshot({ path: path.join(CAPTURI, `gol-${limba}-${latime}.png`), fullPage: true });

          reseteaza({ produse: 'unul' });
          await page.reload({ waitUntil: 'networkidle' });
          await page.waitForSelector('.card');
          await test(`${eticheta}: produsul live simulat apare cu denumire, preț cu TVA, unitate, stoc, furnizor și imagine`, async () => {
            const text = await page.textContent('.card');
            const asteptat = limba === 'ro'
              ? ['Robinet cu sferă 1/2 țoli', '35,72 Lei', '/ buc', 'TVA inclus', 'În stoc: 12 buc', 'Livrare în 2 zile', 'Furnizor: Home Best Pal']
              : ['Ball valve 1/2 inch', '35.72 Lei', '/ pcs', 'VAT included', 'In stock: 12 pcs', 'Delivery in 2 days', 'Supplier: Home Best Pal'];
            for (const a of asteptat) adevarat(text.includes(a), `lipsește „${a}” din: ${text.replace(/\s+/g, ' ')}`);
            adevarat(await page.locator('.card img.card-img').count() === 1, 'imaginea lipsește');
            egal(await page.locator('.nod').count(), 2, 'categoriile: Toate + nodul cu produs');
          });
          await test(`${eticheta}: fără depășire pe orizontală`, async () => {
            const lat = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
            adevarat(lat.s <= lat.w, `scrollWidth ${lat.s} > ${lat.w}`);
          });
          if (limba === 'en') {
            await test(`${eticheta}: niciun text românesc vizibil (produsul are traducere EN)`, async () => {
              const ro = await page.evaluate(() => {
                const re = /[ăâîșşțţĂÂÎȘŞȚŢ]|\b(și|pentru|preț|în|cu|fără|comandă|furnizor)\b/i;
                const out = [];
                const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                while (w.nextNode()) {
                  const n = w.currentNode;
                  const el = n.parentElement;
                  if (!el || el.closest('script,style,[lang="ro"]') || !el.offsetParent) continue;
                  if (re.test(n.textContent)) out.push(n.textContent.trim());
                }
                ['placeholder', 'aria-label', 'title', 'alt'].forEach((a) => document.querySelectorAll(`[${a}]`).forEach((e) => { if (re.test(e.getAttribute(a))) out.push(`${a}: ${e.getAttribute(a)}`); }));
                if (re.test(document.title)) out.push(`title: ${document.title}`);
                return out;
              });
              egal(ro, []);
            });
          }
          if (CAPTURI) await page.screenshot({ path: path.join(CAPTURI, `produs-${limba}-${latime}.png`), fullPage: true });

          // „Comandă” (direct): prețul real de la server → coșul → checkout.
          await page.route('**/mydarrin-checkout.html', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>checkout</title>' }));
          await page.fill('#qty-0', '10');
          await page.click('.card .btn-select');
          await page.waitForURL('**/mydarrin-checkout.html');
          await test(`${eticheta}: „Comandă” pune în coș produsul cu prețul real (10 × → 357,10 lei) și deschide checkout-ul`, async () => {
            const cfg = await page.evaluate(() => JSON.parse(sessionStorage.getItem('myd_checkout_config')));
            egal([cfg.tip_comanda, cfg.total, cfg.materiale.map((m) => [m.id, m.qty])], ['marketplace', await pretComanda(250), [[`mp:materiale:${ID.m1}`, 10]]]);
          });

          // Din configuratorul unui serviciu: produsul revine în mydarrin-produs.html.
          await page.route('**/mydarrin-produs.html*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>produs</title>' }));
          await page.goto(`${BASE}/mydarrin-marketplace-materiale.html?slug=montaj-parchet-laminat&type=servicii`, { waitUntil: 'networkidle' });
          await page.waitForSelector('.card');
          await page.click('.card .btn-select');
          await page.waitForURL('**/mydarrin-produs.html*');
          await test(`${eticheta}: din configurator, „${limba === 'ro' ? 'Adaugă la serviciu' : 'Add to the service'}” revine cu addAddon=mp:materiale:<id>`, async () => {
            const u = new URL(page.url());
            egal([u.searchParams.get('slug'), u.searchParams.get('addAddon')], ['montaj-parchet-laminat', `mp:materiale:${ID.m1}`]);
          });
          await test(`${eticheta}: 0 erori JS`, async () => { egal(erori, []); });
          await ctx.close();
        }
      }
    } finally {
      await browser.close();
      srv.close();
    }
  }

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
})();
