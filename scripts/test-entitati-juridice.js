// scripts/test-entitati-juridice.js
// Teste pentru entitățile juridice ale platformei (pasul 10a, 2.2, 16 oct.
// 2026): „Completează din ANAF” (datele exact cum le dă ANAF, IBAN-ul
// neatins, cu audit), „Leagă de contul de furnizor”, entitatea fictivă
// inactivă și datele publice fără IBAN. Supabase și ANAF simulate — fără rețea.
//
// Rulare: node scripts/test-entitati-juridice.js

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

const entitatiAdmin = require(path.join(RADACINA, 'api/admin/entitati-juridice.js'));
const entitatiPublic = require(path.join(RADACINA, 'api/public/entitati-juridice.js'));

let trecute = 0;
let picate = 0;
async function test(nume, fn) {
  try { await fn(); trecute++; console.log(`  ✓ ${nume}`); } catch (e) { picate++; console.log(`  ✗ ${nume}\n      ${e.message}`); }
}
function egal(a, b, mesaj) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${mesaj || ''} — așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(v, mesaj) { if (!v) throw new Error(mesaj || 'condiție falsă'); }

// Răspunsul ANAF e simulat: aceeași structură ca PlatitorTvaRest v9; datele
// firmei NU sunt cele reale (testul verifică doar că se copiază exact).
const ANAF_SIMULAT = {
  found: [{
    date_generale: { cui: 46577229, denumire: 'FIRMA DIN RASPUNS SIMULAT SRL', adresa: 'ADRESA DIN RASPUNS SIMULAT', nrRegCom: 'J00/0000/2000' },
    inregistrare_scop_Tva: { scpTVA: true },
  }],
};
let anafCerut = null;
let anafRaspuns = ANAF_SIMULAT;
let anafEsueaza = false;
global.fetch = async (url, opt) => {
  anafCerut = { url, corp: JSON.parse(opt.body) };
  if (anafEsueaza) throw new Error('timeout');
  return { ok: true, json: async () => anafRaspuns };
};

const SUPER = 'u-super';
const ADMIN = 'u-admin';
const HBP = 'p-hbp';
const ALT = 'p-alt';
const ENT_RO = 'ent-ro';
const ENT_MD = 'ent-md';
const COLOANE_PARTNERS = ['id', 'partner_type', 'nume_firma', 'cui', 'status_verificare', 'entitate_platforma_id'];

function reseteaza({ migrareAplicata = true } = {}) {
  DB.tabele = {
    profiles: [
      { id: SUPER, roles: ['superadmin'], email: 's@example.com' },
      { id: ADMIN, roles: ['admin'], email: 'a@example.com' },
      { id: HBP, roles: ['partener_materiale'], email: 'contact@homebestpal.ro' },
      { id: ALT, roles: ['client'], email: 'alt@example.com' },
    ],
    partners: [
      { id: HBP, partner_type: 'furnizor_materiale', nume_firma: 'Home Best Pal', cui: 'RO46577229', status_verificare: 'approved', ...(migrareAplicata ? { entitate_platforma_id: null } : {}) },
      { id: ALT, partner_type: 'servicii_tehnice', nume_firma: 'Instalator SRL', cui: 'RO2', status_verificare: 'approved', ...(migrareAplicata ? { entitate_platforma_id: null } : {}) },
    ],
    entitati_juridice_platforma: [
      { id: ENT_RO, tara_cod: 'RO', denumire: 'Home Best Pal SRL', cui: null, nr_reg_com: null, adresa: null, iban: 'RO49AAAA1B31007593840000', activa: true },
      { id: ENT_MD, tara_cod: 'MD', denumire: 'Home Best Pal Moldova SRL (FICTIV — testare, de înlocuit la înființarea oficială)', cui: null, iban: null, activa: false },
    ],
    audit_log: [],
  };
  DB.coloane = { partners: migrareAplicata ? COLOANE_PARTNERS : COLOANE_PARTNERS.filter((c) => c !== 'entitate_platforma_id') };
  DB.utilizatori = { 'tok-super': { id: SUPER }, 'tok-admin': { id: ADMIN } };
  anafCerut = null; anafRaspuns = ANAF_SIMULAT; anafEsueaza = false;
}

async function apel(token, body, metoda = 'POST') {
  const res = raspuns();
  await entitatiAdmin(cerere({ metoda, token, body }), res);
  return res;
}
const tacut = (fn) => async () => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

(async () => {
  console.log('1. „Completează din ANAF”');
  await test('scrie denumirea, CUI-ul, nr. reg. com. și adresa exact din ANAF; IBAN-ul și „activa” rămân', async () => {
    reseteaza();
    const res = await apel('tok-super', { actiune: 'din_anaf', tara_cod: 'RO', cui: 'RO46577229' });
    egal(res.statusCode, 200);
    egal(anafCerut.corp[0].cui, 46577229, 'CUI-ul trimis la ANAF');
    const ro = DB.tabele.entitati_juridice_platforma.find((e) => e.tara_cod === 'RO');
    egal([ro.denumire, ro.cui, ro.nr_reg_com, ro.adresa], ['FIRMA DIN RASPUNS SIMULAT SRL', '46577229', 'J00/0000/2000', 'ADRESA DIN RASPUNS SIMULAT']);
    egal([ro.iban, ro.activa], ['RO49AAAA1B31007593840000', true]);
  });
  await test('se scrie în audit: sursa ANAF, înainte și după', async () => {
    reseteaza();
    await apel('tok-super', { actiune: 'din_anaf', tara_cod: 'RO', cui: 'RO46577229' });
    const a = DB.tabele.audit_log.find((r) => r.actiune === 'entitate_juridica_din_anaf');
    adevarat(a, 'rândul de audit lipsește');
    egal(a.detalii.inainte.denumire, 'Home Best Pal SRL');
    egal(a.detalii.dupa.denumire, 'FIRMA DIN RASPUNS SIMULAT SRL');
  });
  await test('CUI negăsit la ANAF → 404, nimic modificat', async () => {
    reseteaza();
    anafRaspuns = { found: [] };
    const res = await apel('tok-super', { actiune: 'din_anaf', tara_cod: 'RO', cui: '1' });
    egal(res.statusCode, 404);
    egal(DB.tabele.entitati_juridice_platforma.find((e) => e.tara_cod === 'RO').denumire, 'Home Best Pal SRL');
  });
  await test('ANAF indisponibil → 502, mesaj clar, nimic modificat', tacut(async () => {
    reseteaza();
    anafEsueaza = true;
    const res = await apel('tok-super', { actiune: 'din_anaf', tara_cod: 'RO', cui: 'RO46577229' });
    egal(res.statusCode, 502);
    adevarat(/nimic nu s-a modificat/.test(res.corp.error), res.corp.error);
  }));
  await test('doar pentru RO', async () => {
    reseteaza();
    egal((await apel('tok-super', { actiune: 'din_anaf', tara_cod: 'MD', cui: '1' })).statusCode, 400);
  });
  await test('un admin simplu nu poate completa din ANAF (doar superadminul)', async () => {
    reseteaza();
    egal((await apel('tok-admin', { actiune: 'din_anaf', tara_cod: 'RO', cui: 'RO46577229' })).statusCode, 403);
  });

  console.log('2. „Leagă de contul de furnizor”');
  await test('superadminul leagă contul HBP de entitatea RO; GET îl arată ca furnizor propriu', async () => {
    reseteaza();
    const res = await apel('tok-super', { actiune: 'leaga_furnizor', tara_cod: 'RO', partener_id: HBP });
    egal(res.statusCode, 200);
    egal(DB.tabele.partners.find((p) => p.id === HBP).entitate_platforma_id, ENT_RO);
    const get = await apel('tok-super', null, 'GET');
    egal(get.corp.entitati.find((e) => e.tara_cod === 'RO').furnizor_propriu.email, 'contact@homebestpal.ro');
    adevarat(get.corp.furnizori_disponibili.some((p) => p.id === HBP), 'HBP lipsește din lista de conturi');
    adevarat(!get.corp.furnizori_disponibili.some((p) => p.id === ALT), 'un partener de servicii nu poate fi furnizor propriu');
  });
  await test('un partener care nu e furnizor de materiale / închirieri → 409', async () => {
    reseteaza();
    egal((await apel('tok-super', { actiune: 'leaga_furnizor', tara_cod: 'RO', partener_id: ALT })).statusCode, 409);
  });
  await test('o entitate inactivă (MD fictivă) nu se leagă → 409', async () => {
    reseteaza();
    egal((await apel('tok-super', { actiune: 'leaga_furnizor', tara_cod: 'MD', partener_id: HBP })).statusCode, 409);
  });
  await test('dezlegarea (partener_id null) scoate legătura', async () => {
    reseteaza();
    await apel('tok-super', { actiune: 'leaga_furnizor', tara_cod: 'RO', partener_id: HBP });
    await apel('tok-super', { actiune: 'leaga_furnizor', tara_cod: 'RO', partener_id: null });
    egal(DB.tabele.partners.find((p) => p.id === HBP).entitate_platforma_id, null);
  });
  await test('migrare neaplicată → 409 MIGRARE_NEAPLICATA; GET spune că legătura nu se poate salva', async () => {
    reseteaza({ migrareAplicata: false });
    const res = await apel('tok-super', { actiune: 'leaga_furnizor', tara_cod: 'RO', partener_id: HBP });
    egal([res.statusCode, res.corp.code], [409, 'MIGRARE_NEAPLICATA']);
    egal((await apel('tok-super', null, 'GET')).corp.migrare_furnizor_propriu, false);
  });

  console.log('3. Datele publice');
  await test('/api/public/entitati-juridice: doar entitățile active, fără IBAN', async () => {
    reseteaza();
    const res = raspuns();
    await entitatiPublic(cerere({ metoda: 'GET' }), res);
    egal(res.corp.entitati.map((e) => e.tara_cod), ['RO']);
    adevarat(!('iban' in res.corp.entitati[0]), 'IBAN-ul e expus');
    adevarat(!JSON.stringify(res.corp).includes('FICTIV'), 'entitatea fictivă apare public');
  });

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
})();
