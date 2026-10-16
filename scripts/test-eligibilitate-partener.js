// scripts/test-eligibilitate-partener.js
// Teste pentru pasul 10c (16 oct. 2026): regula unică „furnizor activ”
// (lib/eligibilitate-partener.js) și furnizorul propriu al platformei.
//   A. Regula, test unitar: în verificare, aprobat fără contract, aprobat fără
//      cont bancar, aprobat complet, respins, furnizor propriu aprobat, furnizor
//      propriu în verificare, cont suspendat; pregătirea catalogului.
//   B. Aprobarea produselor (api/admin/marketplace-aprobari.js): furnizor
//      neeligibil → refuz cu motiv RO + EN; eligibil → live; starea furnizorului în listă.
//   C. Marketplace-ul public și checkout-ul: produsul live al unui furnizor
//      respins nu apare și nu se poate comanda; al furnizorului propriu aprobat da.
//   D. Alocarea: linia de materiale merge la furnizorul propriu aprobat, fără
//      contract; un furnizor extern fără contract nu o primește.
//   E. Comenzi și contract: furnizorul propriu trece de hard-stop fără contract
//      și nu primește cod de contract; /api/cont/profil întoarce furnizor_propriu.
//   F. Playwright, RO și EN, 1366 și 390 px: dashboard-ul furnizorului propriu
//      fără benzile de contract / cont bancar, cu insigna; un furnizor extern în
//      verificare, cu mesajul lângă produse; 0 erori JS, fără depășiri.
// Nimic nu ajunge la Supabase sau la producție.
//
// Cerințe pentru F (nu e dependență a proiectului):
//   npm i --no-save playwright && npx playwright install chromium
// Rulare: node scripts/test-eligibilitate-partener.js [--capturi <dosar>]

const http = require('http');
const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

function stub(fisier, exp) {
  const p = require.resolve(path.join(RADACINA, fisier));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };
}
stub('lib/rate-limit.js', { checkRateLimit: async () => true });

const E = require(path.join(RADACINA, 'lib/eligibilitate-partener.js'));
const apiAprobari = require(path.join(RADACINA, 'api/admin/marketplace-aprobari.js'));
const apiMarketplace = require(path.join(RADACINA, 'api/public/marketplace-produse.js'));
const apiAccept = require(path.join(RADACINA, 'api/partener/accept-comanda.js'));
const apiContractOtp = require(path.join(RADACINA, 'api/partener/contract-trimite-otp.js'));
const apiProfil = require(path.join(RADACINA, 'api/cont/profil.js'));
const { gasesteActorPentruRol } = require(path.join(RADACINA, 'lib/aloca-subcontractori.js'));
const { rezolvaAddonMateriale } = require(path.join(RADACINA, 'lib/rezolva-addon-materiale.js'));

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

// ── Date simulate (structura reală, 16 oct. 2026; produsele sunt de test) ──
const HBP = 'p-hbp';          // furnizorul propriu, aprobat, fără contract și fără cont bancar
const EXTERN = 'p-extern';    // aprobat complet
const FARA_CONTRACT = 'p-fc'; // aprobat, cu cont bancar, fără contract
const RESPINS = 'p-respins';  // respins, dar cu contract și cont (ex. vechi)
const VERIFICARE = 'p-verif'; // în verificare
const ID = { hbp: '11111111-1111-4111-8111-111111111111', ext: '22222222-2222-4222-8222-222222222222', resp: '33333333-3333-4333-8333-333333333333', verif: '44444444-4444-4444-8444-444444444444', fc: '55555555-5555-4555-8555-555555555555' };
const produs = (id, furnizor, status = 'live', o = {}) => ({
  id, furnizor_id: furnizor, denumire: `Produs ${furnizor}`, descriere: 'Produs de test pentru regula furnizorului activ.', descriere_pret: 'Preț per bucată',
  categorie_id: 'n-fierarie', pret_fara_tva: 10, moneda: 'RON', unitate_masura: 'buc', stoc_disponibil: 5, lead_time_zile: 1, imagini: [], status, activ: true, traduceri: {}, creat_la: '2026-10-16T08:00:00Z', ...o,
});

function reseteaza() {
  DB.tabele = {
    partners: [
      { id: HBP, nume_firma: 'Home Best Pal SRL', partner_type: 'furnizor_materiale', status_verificare: 'approved', contract_semnat: false, entitate_platforma_id: 'ent-ro' },
      { id: EXTERN, nume_firma: 'Instal Extern SRL', partner_type: 'furnizor_materiale', status_verificare: 'approved', contract_semnat: true, entitate_platforma_id: null },
      { id: FARA_CONTRACT, nume_firma: 'Fără Contract SRL', partner_type: 'furnizor_materiale', status_verificare: 'approved', contract_semnat: false, entitate_platforma_id: null },
      { id: RESPINS, nume_firma: 'Respins SRL', partner_type: 'furnizor_materiale', status_verificare: 'rejected', contract_semnat: true, entitate_platforma_id: null },
      { id: VERIFICARE, nume_firma: 'Verificare SRL', partner_type: 'inchirieri_utilaje', status_verificare: 'pending_review', contract_semnat: false, entitate_platforma_id: null },
    ],
    partner_conturi_bancare: [
      { id: 'cb1', partner_id: EXTERN, activ: true },
      { id: 'cb2', partner_id: FARA_CONTRACT, activ: true },
      { id: 'cb3', partner_id: RESPINS, activ: true },
    ],
    profiles: [
      { id: HBP, roles: ['client', 'partener_materiale'], status: 'active' },
      { id: EXTERN, roles: ['partener_materiale'], status: 'active' },
      { id: FARA_CONTRACT, roles: ['partener_materiale'], status: 'active' },
      { id: RESPINS, roles: ['partener_materiale'], status: 'active' },
      { id: VERIFICARE, roles: ['partener_inchirieri'], status: 'pending_otp' },
      { id: 'u-admin', roles: ['admin'], status: 'active' },
    ],
    marketplace_materiale: [
      produs(ID.hbp, HBP), produs(ID.ext, EXTERN), produs(ID.resp, RESPINS), produs(ID.fc, FARA_CONTRACT),
      produs(ID.verif, VERIFICARE, 'in_asteptare'),
    ],
    marketplace_echipamente: [],
    documente_partener: [],
    audit_log: [],
    categorii: [{ id: 'n-fierarie', slug: 'fierarie', title: 'Fierărie', title_en: 'Hardware', capitol_cod: 'G', category_type: 'materiale', display_order: 1, activ: true }],
    tax_configurations: [{ tara_cod: 'RO', moneda: 'RON', cota_tva: 21, prag_minim_comanda: 100, checkout_activ: true }],
    backoffice_config: [
      { sectiune: 'pricing', cheie: 'cost_marketing_pct', valoare: '3', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'cost_mentenanta_pct', valoare: '2', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'comision_platforma_default_pct', valoare: '12', tara_cod: 'ALL' },
      { sectiune: 'asigurari', cheie: 'cost_asigurare_pct', valoare: '1', tara_cod: 'ALL' },
    ],
    tarife_transport: [],
    catalog_servicii: [{ id: 'cat-mat', categorie: 'materiale' }],
    partener_servicii_active: [HBP, EXTERN, FARA_CONTRACT, RESPINS].map((id) => ({ partener_id: id, catalog_serviciu_id: 'cat-mat', activ: true })),
    parteneri_disponibilitate: [HBP, EXTERN, FARA_CONTRACT, RESPINS].map((id) => ({ partener_id: id, status_live: 'disponibil', tara_cod: 'RO', judete: ['B'] })),
    alocari_fifo: [],
    comenzi: [],
    partner_contract_otp: [],
    admin_permissions: [],
    accese_temporare: [],
  };
  DB.coloane = {};
  DB.implicite = {};
  DB.utilizatori = { 'tok-admin': { id: 'u-admin' }, 'tok-hbp': { id: HBP, email: 'contact@homebestpal.ro' }, 'tok-fc': { id: FARA_CONTRACT, email: 'fc@test' } };
}

async function apel(handler, opt) {
  const res = raspuns();
  await handler(cerere(opt), res);
  return res;
}

async function parteaA() {
  console.log('A. Regula unică (lib/eligibilitate-partener.js)');
  const baza = { status_verificare: 'approved', contract_semnat: true, cont_bancar: true, entitate_platforma_id: null, profil_status: 'active' };
  const cazuri = [
    ['în verificare', { ...baza, status_verificare: 'pending_review', contract_semnat: false, cont_bancar: false }, false, 'in_verificare'],
    ['aprobat fără contract', { ...baza, contract_semnat: false }, false, 'fara_contract'],
    ['aprobat fără cont bancar', { ...baza, cont_bancar: false }, false, 'fara_cont_bancar'],
    ['aprobat complet', baza, true, null],
    ['respins', { ...baza, status_verificare: 'rejected' }, false, 'respins'],
    ['furnizor propriu aprobat (fără contract, fără cont bancar)', { ...baza, contract_semnat: false, cont_bancar: false, entitate_platforma_id: 'ent-ro' }, true, null],
    ['furnizor propriu în verificare', { ...baza, status_verificare: 'pending_review', contract_semnat: false, cont_bancar: false, entitate_platforma_id: 'ent-ro' }, false, 'in_verificare'],
    ['cont suspendat, altfel complet', { ...baza, profil_status: 'suspended' }, false, 'suspendat'],
  ];
  for (const [nume, p, vinde, motiv] of cazuri) {
    await test(`${nume} → poateVinde ${vinde}, poatePrimiComenzi ${vinde}, motiv ${motiv}`, () => {
      egal(E.poateVinde(p), vinde);
      egal(E.poatePrimiComenzi(p), vinde);
      egal(E.motivNuPoateVinde(p), motiv);
    });
  }
  await test('fără partener → nu poate vinde (inexistent)', () => { egal(E.poateVinde(null), false); egal(E.motivNuPoateVinde(null), 'inexistent'); });
  await test('poatePregatiCatalog: furnizor în orice stare, în afară de suspendat; nu și partenerul de servicii', () => {
    egal(E.poatePregatiCatalog({ partner_type: 'furnizor_materiale', status_verificare: 'pending_review' }), true);
    egal(E.poatePregatiCatalog({ partner_type: 'inchirieri_utilaje', status_verificare: 'rejected' }), true);
    egal(E.poatePregatiCatalog({ roles: ['partener_materiale'] }), true);
    egal(E.poatePregatiCatalog({ partner_type: 'furnizor_materiale', profil_status: 'suspended' }), false);
    egal(E.poatePregatiCatalog({ partner_type: 'servicii_tehnice', roles: ['partener_servicii'] }), false);
  });
  await test('incarcaEligibilitate citește contul bancar și furnizorul propriu din baza de date', async () => {
    reseteaza();
    const h = await E.incarcaEligibilitate([HBP, EXTERN, FARA_CONTRACT, RESPINS, VERIFICARE, 'lipsa']);
    egal([HBP, EXTERN, FARA_CONTRACT, RESPINS, VERIFICARE].map((id) => [id, h.get(id).poate_vinde, h.get(id).motiv]),
      [[HBP, true, null], [EXTERN, true, null], [FARA_CONTRACT, false, 'fara_contract'], [RESPINS, false, 'respins'], [VERIFICARE, false, 'in_verificare']]);
    egal(h.get(HBP).furnizor_propriu, true);
    egal(h.has('lipsa'), false);
  });
  await test('migrarea furnizor_propriu neaplicată (coloana lipsește) → nimeni nu e furnizor propriu, fără erori', async () => {
    reseteaza();
    DB.coloane.partners = ['id', 'nume_firma', 'partner_type', 'status_verificare', 'contract_semnat'];
    const h = await E.incarcaEligibilitate([HBP, EXTERN]);
    egal([h.get(HBP).poate_vinde, h.get(HBP).motiv, h.get(EXTERN).poate_vinde], [false, 'fara_cont_bancar', true]);
  });
}

async function parteaB() {
  console.log('B. Aprobarea produselor (api/admin/marketplace-aprobari.js)');
  reseteaza();
  const post = (id) => apel(apiAprobari, { metoda: 'POST', token: 'tok-admin', body: { tip: 'produs', produs_tip: 'materiale', id, decizie: 'aprobat' } });
  for (const [nume, id, cuvant, cuvantEn] of [
    ['furnizor în verificare', ID.verif, 'nu este încă aprobat', 'not approved yet'],
    ['furnizor fără contract', ID.fc, 'contractul semnat', 'signed contract'],
    ['furnizor respins', ID.resp, 'respins', 'rejected'],
  ]) {
    await test(`${nume} → aprobarea e refuzată (409), cu motivul în RO și EN; produsul rămâne neschimbat`, async () => {
      const inainte = DB.tabele.marketplace_materiale.find((p) => p.id === id).status;
      const r = await post(id);
      egal(r.statusCode, 409, JSON.stringify(r.corp));
      egal(r.corp.code, 'FURNIZOR_NU_POATE_VINDE');
      adevarat(r.corp.error.includes(cuvant), r.corp.error);
      adevarat(r.corp.error_en.includes(cuvantEn), r.corp.error_en);
      egal(DB.tabele.marketplace_materiale.find((p) => p.id === id).status, inainte);
    });
  }
  await test('furnizor eligibil (furnizorul propriu, fără contract) → live', async () => {
    DB.tabele.marketplace_materiale.find((p) => p.id === ID.hbp).status = 'in_asteptare';
    const r = await post(ID.hbp);
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    egal(r.corp.produs.status, 'live');
  });
  await test('furnizor extern aprobat complet → live', async () => {
    DB.tabele.marketplace_materiale.find((p) => p.id === ID.ext).status = 'in_asteptare';
    const r = await post(ID.ext);
    egal([r.statusCode, r.corp.produs && r.corp.produs.status], [200, 'live']);
  });
  await test('respingerea unui produs merge oricând (și pentru furnizorul neeligibil)', async () => {
    const r = await apel(apiAprobari, { metoda: 'POST', token: 'tok-admin', body: { tip: 'produs', produs_tip: 'materiale', id: ID.verif, decizie: 'respins', motiv: 'test' } });
    egal([r.statusCode, r.corp.produs.status], [200, 'respins']);
  });
  await test('lista: fiecare produs în așteptare vine cu starea furnizorului', async () => {
    reseteaza();
    const r = await apel(apiAprobari, { token: 'tok-admin' });
    const st = r.corp.produse_pending.materiale.find((p) => p.id === ID.verif).furnizor_stare;
    egal([st.nume_firma, st.poate_vinde, st.motiv, st.mesaj_en], ['Verificare SRL', false, 'in_verificare', 'The supplier is not approved yet.']);
  });
}

async function parteaC() {
  console.log('C. Marketplace public și checkout');
  reseteaza();
  await test('lista publică: apar produsele furnizorului propriu și ale celui aprobat complet; nu ale celui respins sau fără contract', async () => {
    const r = await apel(apiMarketplace, { query: { tip: 'materiale', lang: 'ro' } });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    egal(r.corp.produse.map((p) => p.id).sort(), [`mp:materiale:${ID.hbp}`, `mp:materiale:${ID.ext}`].sort());
    egal(r.corp.total, 2);
    egal(r.corp.noduri, [{ slug: 'fierarie', title: 'Fierărie', title_en: 'Hardware', numar: 2 }]);
    egal(r.corp.produse.find((p) => p.id === `mp:materiale:${ID.hbp}`).furnizor, 'Home Best Pal');
  });
  await test('produsul live al furnizorului respins: 404 la deschidere, iar produsul nu e șters', async () => {
    const r = await apel(apiMarketplace, { query: { id: `mp:materiale:${ID.resp}` } });
    egal(r.statusCode, 404);
    egal(DB.tabele.marketplace_materiale.find((p) => p.id === ID.resp).status, 'live');
  });
  await test('produsul furnizorului propriu aprobat se deschide', async () => {
    const r = await apel(apiMarketplace, { query: { id: `mp:materiale:${ID.hbp}` } });
    egal(r.statusCode, 200);
  });
  await test('un furnizor care pierde dreptul (contract reziliat) dispare din marketplace', async () => {
    DB.tabele.partners.find((p) => p.id === EXTERN).contract_semnat = false;
    const r = await apel(apiMarketplace, { query: { tip: 'materiale' } });
    egal(r.corp.produse.map((p) => p.id), [`mp:materiale:${ID.hbp}`]);
    reseteaza();
  });
  await test('checkout: produsul furnizorului respins → ADDON_FARA_PRET; al furnizorului propriu → acceptat', async () => {
    let cod = null;
    try { await rezolvaAddonMateriale([{ id: `mp:materiale:${ID.resp}`, qty: 1 }], null, 'RO'); } catch (e) { cod = e.code; }
    egal(cod, 'ADDON_FARA_PRET');
    const ok = await rezolvaAddonMateriale([{ id: `mp:materiale:${ID.hbp}`, qty: 2 }], null, 'RO');
    egal([ok.cost_materiale, ok.itemi[0].furnizor_id], [20, HBP]);
  });
  await test('prețul public (POST) pentru produsul furnizorului respins → disponibil: false', async () => {
    const r = await apel(apiMarketplace, { metoda: 'POST', body: { produse: [{ id: `mp:materiale:${ID.resp}`, qty: 1 }], tara_cod: 'RO' } });
    egal([r.statusCode, r.corp.disponibil], [200, false]);
  });
}

async function parteaD() {
  console.log('D. Alocarea liniei de materiale (lib/aloca-subcontractori.js)');
  const comanda = { id: 'c1', tara_cod: 'RO', regiune: 'B' };
  await test('linia de materiale merge la furnizorul propriu aprobat, fără contract și fără cont bancar', async () => {
    reseteaza();
    DB.tabele.partners = DB.tabele.partners.filter((p) => p.id !== EXTERN);
    egal(await gasesteActorPentruRol(comanda, 'materiale'), HBP);
  });
  await test('fără furnizor propriu: furnizorul fără contract și cel respins nu primesc linia', async () => {
    reseteaza();
    DB.tabele.partners = DB.tabele.partners.filter((p) => p.id !== HBP && p.id !== EXTERN);
    egal(await gasesteActorPentruRol(comanda, 'materiale'), null);
  });
  await test('furnizorul propriu în verificare nu primește linia', async () => {
    reseteaza();
    DB.tabele.partners = DB.tabele.partners.filter((p) => p.id !== EXTERN);
    DB.tabele.partners.find((p) => p.id === HBP).status_verificare = 'pending_review';
    egal(await gasesteActorPentruRol(comanda, 'materiale'), null);
  });
}

async function parteaE() {
  console.log('E. Comenzi, contract și profil');
  reseteaza();
  await test('accept-comanda: furnizorul propriu trece de hard-stop fără contract (409 doar pentru că nu are alocarea)', async () => {
    const r = await apel(apiAccept, { metoda: 'POST', token: 'tok-hbp', body: { comanda_id: 'c-x' } });
    egal(r.statusCode, 409, JSON.stringify(r.corp));
  });
  await test('accept-comanda: furnizor extern fără contract → 403 CONTRACT_NESEMNAT', async () => {
    const r = await apel(apiAccept, { metoda: 'POST', token: 'tok-fc', body: { comanda_id: 'c-x' } });
    egal([r.statusCode, r.corp.code], [403, 'CONTRACT_NESEMNAT']);
  });
  await test('contract-trimite-otp: furnizorul propriu nu primește cod (400 FURNIZOR_PROPRIU), nimic scris', async () => {
    const r = await apel(apiContractOtp, { metoda: 'POST', token: 'tok-hbp' });
    egal([r.statusCode, r.corp.code], [400, 'FURNIZOR_PROPRIU']);
    egal(DB.tabele.partner_contract_otp.length, 0);
  });
  await test('/api/cont/profil: furnizor_propriu true pentru HBP, false pentru un furnizor extern; poate_vinde și motivul', async () => {
    const a = await apel(apiProfil, { token: 'tok-hbp' });
    egal([a.statusCode, a.corp.furnizor_propriu, a.corp.partener.poate_vinde, a.corp.partener.motiv_nu_poate_vinde], [200, true, true, null]);
    adevarat(!('entitate_platforma_id' in a.corp.partener) && !JSON.stringify(a.corp).includes('ent-ro'), 'datele entității nu trebuie să apară');
    const b = await apel(apiProfil, { token: 'tok-fc' });
    egal([b.corp.furnizor_propriu, b.corp.partener.poate_vinde, b.corp.partener.motiv_nu_poate_vinde], [false, false, 'fara_contract']);
  });
}

// ── F. Playwright ─────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function server() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = path.join(RADACINA, p === '/' ? 'index.html' : p);
      if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, () => ok(s));
  });
}

// Profilurile simulate, în forma reală a /api/cont/profil după 10c.
const PROFILURI = {
  propriu: {
    ok: true, email: 'contact@homebestpal.ro', nume: null, roles: ['client', 'partener_materiale'], furnizor_propriu: true,
    roluri_dashboard: ['partener_materiale'], destinatie: '/mydarrin-dashboard-furnizor.html?type=materiale', tip_destinatie: 'rol',
    partener: { nume_firma: 'Home Best Pal', partner_type: 'furnizor_materiale', rol: 'partener_materiale', status_verificare: 'approved', contract_semnat: false, cont_bancar: false, motiv_respingere: null, poate_vinde: true, motiv_nu_poate_vinde: null },
  },
  extern_verificare: {
    ok: true, email: 'vanzari@instal-extern.ro', nume: null, roles: ['partener_materiale'], furnizor_propriu: false,
    roluri_dashboard: ['partener_materiale'], destinatie: '/mydarrin-dashboard-furnizor.html?type=materiale', tip_destinatie: 'rol',
    partener: { nume_firma: 'Instal Extern', partner_type: 'furnizor_materiale', rol: 'partener_materiale', status_verificare: 'pending_review', contract_semnat: false, cont_bancar: false, motiv_respingere: null, poate_vinde: false, motiv_nu_poate_vinde: 'in_verificare' },
  },
};
const PRODUS_SIMULAT = { id: ID.verif, denumire: 'Robinet de test', cod_produs_furnizor: 'R-1', pret_fara_tva: 25, moneda: 'RON', unitate_masura: 'buc', stoc_disponibil: 3, status: 'in_asteptare', activ: true };
const RASPUNSURI = {
  '/api/partener/profil-status': { ok: true, complet: true, lipsa: [], pas: null },
  '/api/partener/discounturi': { ok: true, discounturi: [] },
  '/api/partener/facturi': { ok: true, facturabile: [], facturi: [] },
  '/api/partener/conturi-bancare': { ok: true, conturi: [] },
  '/api/marketplace/produse': { ok: true, produse: [PRODUS_SIMULAT], tip: 'materiale' },
};

function sesiuneSimulata(cfg) {
  const lant = (rezultat) => {
    const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rezultat) : () => p), apply: () => p });
    return p;
  };
  const user = cfg.user;
  const sesiune = { access_token: 'token-simulat', user };
  const client = {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getSession: async () => ({ data: { session: sesiune }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: () => lant({ data: [], error: null, count: 0 }),
    rpc: () => lant({ data: null, error: null }),
    storage: { from: () => lant({ data: null, error: null }) },
    channel: () => lant({}),
    removeChannel: () => {},
  };
  const auth = new Proxy({
    getCurrentUser: async () => user,
    getUserRoles: async () => cfg.roles || [],
    hasRole: async (r) => (cfg.roles || []).includes(r),
    performLogout: () => {},
  }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (nume, val) => Object.defineProperty(window, nume, { configurable: true, get: () => val, set: () => {} });
  fix('supabaseClient', client);
  fix('MyDarrinAuth', auth);
  try {
    if (!sessionStorage.getItem('__init')) {
      localStorage.clear();
      if (cfg.limba === 'ro') localStorage.setItem('myd_lang_v1', 'ro');
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: '2026-10-16T08:00:00Z', versiune: 1 }));
      sessionStorage.setItem('__init', '1');
    }
  } catch (e) {}
}

async function parteaF() {
  console.log('F. Dashboard-ul furnizorului (Playwright)');
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) {
    console.log('  – Playwright lipsește (npm i --no-save playwright): partea F sărită.');
    return;
  }
  const srv = await server();
  const BASE = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch();
  const RO_EN = /[ăâîșțşţĂÂÎȘȚŞŢ]|(?<!\p{L})(?:pentru|contul|tău|în|și|verificare|contractul|bancar|apar|încă)(?!\p{L})/iu;
  try {
    for (const limba of ['ro', 'en']) {
      for (const latime of [1366, 390]) {
        const et = `${limba.toUpperCase()} ${latime}px`;
        for (const cont of ['propriu', 'extern_verificare']) {
          const p0 = PROFILURI[cont];
          const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 800 ? 844 : 900 }, locale: 'en-GB', isMobile: latime < 800, hasTouch: latime < 800 });
          await ctx.addInitScript(sesiuneSimulata, { user: { id: 'u-' + cont, email: p0.email, user_metadata: {} }, roles: p0.roles, limba });
          await ctx.route(/supabase\.co|nominatim|googletagmanager|google-analytics/, (r) => r.abort());
          await ctx.route(/\/api\//, (r) => {
            const cale = new URL(r.request().url()).pathname.replace(/\.js$/, '');
            const corp = cale === '/api/cont/profil' ? p0 : (RASPUNSURI[cale] || { ok: true });
            return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corp) });
          });
          const page = await ctx.newPage();
          const erori = [];
          page.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
          await page.goto(BASE + '/mydarrin-dashboard-furnizor.html?type=materiale', { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('#myd-id', { timeout: 10000 }).catch(() => {});
          await page.evaluate(() => window.showPanel && window.showPanel('produse'));
          await page.waitForSelector('#produse-live-tbody tr td', { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(700);
          const d = await page.evaluate(() => ({
            insigna: (document.getElementById('myd-id-furnizor-propriu') || {}).textContent || '',
            contract: !!document.getElementById('myd-banda-contract'),
            banca: !!document.getElementById('myd-banda-cont-bancar'),
            verificare: (document.getElementById('myd-banda-verificare') || {}).innerText || '',
            produse: (document.getElementById('myd-banda-produse') || {}).innerText || '',
            zonaProduse: !!document.querySelector('#produse-vizibilitate #myd-banda-produse'),
            randProdus: (document.getElementById('produse-live-tbody') || {}).innerText || '',
            antet: (document.getElementById('myd-cont-antet') || {}).innerText || '',
            // Banda de lângă produse rămâne în ecran (zona principală a paginii e mai lată decât ecranul pe mobil).
            bandaInEcran: (() => { const b = document.getElementById('myd-banda-produse'); return !b || b.getBoundingClientRect().right <= window.innerWidth + 1; })(),
          }));
          if (cont === 'propriu') {
            test(`${et}: furnizorul propriu — insigna „${limba === 'ro' ? 'Furnizor propriu al platformei' : 'Platform’s own supplier'}”`,
              d.insigna === (limba === 'ro' ? 'Furnizor propriu al platformei' : 'Platform’s own supplier'), JSON.stringify(d));
            test(`${et}: furnizorul propriu — fără benzile de contract și cont bancar, fără mesaj lângă produse`, !d.contract && !d.banca && !d.produse && !d.verificare, JSON.stringify(d));
          } else {
            test(`${et}: furnizor extern în verificare — fără insigna de furnizor propriu, cu banda de verificare`, !d.insigna && !!d.verificare, JSON.stringify(d));
            const asteptat = limba === 'ro'
              ? 'Produsele tale nu apar încă public: contul e în verificare. Le poți pregăti între timp.'
              : 'Your products are not public yet: your account is under review. You can prepare them in the meantime.';
            test(`${et}: furnizor extern în verificare — mesajul tradus lângă produse`, d.zonaProduse && d.produse.includes(asteptat) && d.randProdus.includes('Robinet de test'), JSON.stringify(d));
            test(`${et}: mesajul de lângă produse rămâne în întregime în ecran`, d.bandaInEcran, JSON.stringify(d));
          }
          if (limba === 'en') {
            const ro = [d.antet, d.produse].filter((t) => RO_EN.test(t.replace(/\S+@\S+/g, ' ').replace(/Home Best Pal|Instal Extern/g, ' ')));
            test(`${et} (${cont}): fără text românesc în antet, benzi și mesajul de produse`, !ro.length, JSON.stringify(ro));
          }
          const dep = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          test(`${et} (${cont}): fără depășire pe orizontală`, dep <= 1, String(dep));
          test(`${et} (${cont}): 0 erori JS`, erori.length === 0, erori.join(' | '));
          if (CAPTURI) await page.screenshot({ path: path.join(CAPTURI, `furnizor-${cont}-${limba}-${latime}.png`), fullPage: false });
          await ctx.close();
        }
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
  function test(nume, ok, detalii) {
    if (ok) { trecute++; console.log(`  ✓ ${nume}`); } else { picate++; console.log(`  ✗ ${nume}${detalii ? `\n      ${detalii}` : ''}`); }
  }
}

(async () => {
  await parteaA();
  await parteaB();
  await parteaC();
  await parteaD();
  await parteaE();
  await parteaF();
  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
