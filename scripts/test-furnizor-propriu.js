// scripts/test-furnizor-propriu.js
// Teste unitare pentru furnizorul propriu al platformei (pasul 10a, 16 oct.
// 2026): fără factură de partener și fără discount pentru furnizorul propriu,
// furnizorul extern ca azi; produsele din marketplace intră în prețul
// comenzii și se înregistrează pe furnizorul lor. Supabase simulat în memorie
// (scripts/supabase-simulat.js) — fără rețea, fără dependențe.
//
// Rulare: node scripts/test-furnizor-propriu.js

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

const { aplicaDiscounturiParteneri, planificaSplitItemizat, randuriMarketplace } = require(path.join(RADACINA, 'lib/elibereaza-escrow.js'));
const { rezolvaAddonMateriale, parseazaIdMarketplace } = require(path.join(RADACINA, 'lib/rezolva-addon-materiale.js'));
const { furnizoriProprii } = require(path.join(RADACINA, 'lib/furnizor-propriu.js'));
const facturiPartener = require(path.join(RADACINA, 'api/partener/facturi.js'));
const discounturiPartener = require(path.join(RADACINA, 'api/partener/discounturi.js'));
const discounturiAdmin = require(path.join(RADACINA, 'api/admin/discounturi-parteneri.js'));

let trecute = 0;
let picate = 0;
async function test(nume, fn) {
  try { await fn(); trecute++; console.log(`  ✓ ${nume}`); } catch (e) { picate++; console.log(`  ✗ ${nume}\n      ${e.message}`); }
}
function egal(a, b, mesaj) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${mesaj || ''} — așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(v, mesaj) { if (!v) throw new Error(mesaj || 'condiție falsă'); }

// ── Date (după datele reale din 16 oct. 2026; id-urile sunt simulate) ─────
const HBP = 'p-hbp';
const EXTERN = 'p-extern';
const ENT_RO = 'ent-ro';
const PRODUS_HBP = '11111111-1111-4111-8111-111111111111';
const PRODUS_EXTERN = '22222222-2222-4222-8222-222222222222';
const PRODUS_RESPINS = '33333333-3333-4333-8333-333333333333';
const UTILAJ_HBP = '44444444-4444-4444-8444-444444444444';
const PRODUS_EUR = '55555555-5555-4555-8555-555555555555';

const COLOANE_PARTNERS = ['id', 'partner_type', 'nume_firma', 'cui', 'status_verificare', 'contract_semnat', 'entitate_platforma_id'];

function reseteaza({ migrareAplicata = true } = {}) {
  DB.tabele = {
    partners: [
      { id: HBP, partner_type: 'furnizor_materiale', nume_firma: 'Home Best Pal SRL', cui: 'RO46577229', status_verificare: 'approved', contract_semnat: true, entitate_platforma_id: migrareAplicata ? ENT_RO : undefined },
      { id: EXTERN, partner_type: 'furnizor_materiale', nume_firma: 'Furnizor Extern SRL', cui: 'RO1', status_verificare: 'approved', contract_semnat: true, entitate_platforma_id: null },
    ],
    profiles: [
      { id: HBP, roles: ['partener_materiale'] },
      { id: EXTERN, roles: ['partener_materiale'] },
      { id: 'u-admin', roles: ['admin'] },
    ],
    entitati_juridice_platforma: [{ id: ENT_RO, tara_cod: 'RO', denumire: 'HOME BEST PAL SRL', cui: '46577229', activa: true }],
    backoffice_config: [
      { sectiune: 'pricing', cheie: 'comision_bricolaj_contractat_pct', valoare: '15', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'comision_inchiriere_contractat_pct', valoare: '15', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'discount_partener_min_pct', valoare: '5', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'discount_partener_max_pct', valoare: '15', tara_cod: 'ALL' },
    ],
    parteneri_discounturi: [
      { partener_id: EXTERN, tip_partener: 'materiale', categorie: 'bricolaj', discount_pct: 10, activ: true, aprobat_de: 'u-admin', valabil_de: '2026-01-01', valabil_pana: null },
    ],
    facturi_parteneri: [],
    comanda_subcontractori: [
      { id: 'cs-hbp', comanda_id: 'c1', actor_id: HBP, rol_tip: 'materiale', suma_neta_alocata: 100, status: 'alocat' },
      { id: 'cs-ext', comanda_id: 'c1', actor_id: EXTERN, rol_tip: 'materiale', suma_neta_alocata: 90, status: 'alocat' },
    ],
    comenzi: [{ id: 'c1', nr_comanda: 'DA-2026-00001', moneda: 'RON', tara_cod: 'RO' }],
    tax_configurations: [{ tara_cod: 'RO', moneda: 'RON', cota_tva: 21 }],
    marketplace_materiale: [
      { id: PRODUS_HBP, furnizor_id: HBP, denumire: 'Robinet coltar 1/2', descriere: 'x', unitate_masura: 'buc', pret_fara_tva: 25, moneda: 'RON', status: 'live', activ: true },
      { id: PRODUS_EXTERN, furnizor_id: EXTERN, denumire: 'Teava PPR 20', descriere: 'x', unitate_masura: 'm', pret_fara_tva: 4, moneda: 'RON', status: 'live', activ: true },
      { id: PRODUS_RESPINS, furnizor_id: HBP, denumire: 'Produs respins', descriere: 'x', unitate_masura: 'buc', pret_fara_tva: 10, moneda: 'RON', status: 'respins', activ: true },
      { id: PRODUS_EUR, furnizor_id: EXTERN, denumire: 'Produs in EUR', descriere: 'x', unitate_masura: 'buc', pret_fara_tva: 10, moneda: 'EUR', status: 'live', activ: true },
    ],
    marketplace_echipamente: [
      { id: UTILAJ_HBP, furnizor_id: HBP, denumire: 'Rotopercutor', descriere: 'x', operator_inclus: 'fara_operator', tarif_zi: 60, moneda: 'RON', status: 'live', activ: true },
    ],
    audit_log: [],
  };
  DB.coloane = { partners: migrareAplicata ? COLOANE_PARTNERS : COLOANE_PARTNERS.filter((c) => c !== 'entitate_platforma_id') };
  DB.utilizatori = { 'tok-hbp': { id: HBP }, 'tok-ext': { id: EXTERN }, 'tok-admin': { id: 'u-admin' } };
}

const COMANDA = { id: 'c1', tara_cod: 'RO', creat_la: '2026-10-16T10:00:00Z' };
const tacut = (fn) => async (...a) => { const w = console.warn; const e = console.error; console.warn = () => {}; console.error = () => {}; try { return await fn(...a); } finally { console.warn = w; console.error = e; } };

(async () => {
  console.log('1. Escrow: furnizorul propriu fără discount, furnizorul extern ca azi');
  await test('furnizor propriu → 0%, sursa furnizor_propriu, suma întreagă, nimic reținut', async () => {
    reseteaza();
    const randuri = [{ rol_tip: 'materiale', actor_id: HBP, suma_neta_alocata: 100, _brut: true, _categorie: 'materiale' }];
    const retinut = await aplicaDiscounturiParteneri(COMANDA, randuri);
    egal([randuri[0].suma_neta_alocata, randuri[0].discount_pct_aplicat, randuri[0].discount_sursa], [100, 0, 'furnizor_propriu']);
    egal(retinut.materiale, 0);
  });
  await test('furnizor extern cu discount aprobat 10% → primește 90, HBP reține 10', async () => {
    reseteaza();
    const randuri = [{ rol_tip: 'materiale', actor_id: EXTERN, suma_neta_alocata: 100, _brut: true, _categorie: 'materiale' }];
    const retinut = await aplicaDiscounturiParteneri(COMANDA, randuri);
    egal([randuri[0].suma_neta_alocata, randuri[0].discount_pct_aplicat, randuri[0].discount_sursa], [90, 10, 'profil_partener']);
    egal(retinut.materiale, 10);
  });
  await test('furnizor extern fără discount → procentul din panou (15%)', async () => {
    reseteaza();
    DB.tabele.parteneri_discounturi = [];
    const randuri = [{ rol_tip: 'materiale', actor_id: EXTERN, suma_neta_alocata: 100, _brut: true, _categorie: 'materiale' }];
    await aplicaDiscounturiParteneri(COMANDA, randuri);
    egal([randuri[0].suma_neta_alocata, randuri[0].discount_sursa], [85, 'implicit_panou']);
  });
  await test('migrare neaplicată (fără entitate_platforma_id) → nimeni nu e furnizor propriu, ca azi', tacut(async () => {
    reseteaza({ migrareAplicata: false });
    egal((await furnizoriProprii([HBP])).size, 0);
    DB.tabele.parteneri_discounturi = [];
    const randuri = [{ rol_tip: 'materiale', actor_id: HBP, suma_neta_alocata: 100, _brut: true, _categorie: 'materiale' }];
    await aplicaDiscounturiParteneri(COMANDA, randuri);
    egal(randuri[0].discount_sursa, 'implicit_panou');
  }));

  console.log('2. Produsele din marketplace: în prețul comenzii, pe furnizorul lor');
  await test('id-ul mp:materiale:<uuid> se recunoaște; un catalog_servicii.id nu', async () => {
    egal(parseazaIdMarketplace(`mp:materiale:${PRODUS_HBP}`), { tip: 'materiale', id: PRODUS_HBP });
    egal(parseazaIdMarketplace(PRODUS_HBP), null);
    egal(parseazaIdMarketplace('mp:materiale:nu-e-uuid'), null);
  });
  await test('material HBP × 3 + rotopercutor HBP × 2 zile → costuri fără TVA, cu furnizor_id', async () => {
    reseteaza();
    const r = await rezolvaAddonMateriale([{ id: `mp:materiale:${PRODUS_HBP}`, qty: 3 }, { id: `mp:echipamente:${UTILAJ_HBP}`, qty: 2 }], 'Bronze', 'RO');
    egal([r.cost_materiale, r.cost_utilaj], [75, 120]);
    egal(r.itemi.map((i) => [i.furnizor_id, i.categorie, i.subtotal]), [[HBP, 'materiale', 75], [HBP, 'inchirieri', 120]]);
  });
  await test('produs care nu e live → ADDON_FARA_PRET (nicio sumă parțială)', async () => {
    reseteaza();
    let cod = null;
    try { await rezolvaAddonMateriale([{ id: `mp:materiale:${PRODUS_RESPINS}`, qty: 1 }], 'Bronze', 'RO'); } catch (e) { cod = e.code; }
    egal(cod, 'ADDON_FARA_PRET');
  });
  await test('produs în altă monedă decât a țării → ADDON_FARA_PRET', async () => {
    reseteaza();
    let cod = null;
    try { await rezolvaAddonMateriale([{ id: `mp:materiale:${PRODUS_EUR}`, qty: 1 }], 'Bronze', 'RO'); } catch (e) { cod = e.code; }
    egal(cod, 'ADDON_FARA_PRET');
  });
  await test('escrow: rândurile marketplace pe furnizor, restul materialelor rămâne de alocat', async () => {
    const comanda = {
      suma_materiale: 120, suma_chirie_scule: 120,
      addon_materiale_selectate: [
        { furnizor_id: HBP, categorie: 'materiale', subtotal: 75 },
        { furnizor_id: EXTERN, categorie: 'materiale', subtotal: 8 },
        { furnizor_id: HBP, categorie: 'inchirieri', subtotal: 120 },
        { catalog_serviciu_id: 'vechi', categorie: 'materiale', subtotal: 5 },
      ],
    };
    const { randuri, rest } = randuriMarketplace(comanda, { materiale: 120, inchirieri: 120 });
    egal(randuri.map((r) => [r.rol_tip, r.actor_id, r.suma_neta_alocata]), [['materiale', HBP, 75], ['materiale', EXTERN, 8], ['rental_echipament', HBP, 120]]);
    egal(rest, { materiale: 37, inchirieri: 0 });
    const plan = await planificaSplitItemizat({ ...comanda, suma_manopera: 0 });
    egal(plan.randuri.map((r) => [r.rol_tip, r.actor_id, r.suma_neta_alocata]), [['materiale', HBP, 75], ['materiale', EXTERN, 8], ['rental_echipament', HBP, 120], ['materiale', null, 37]]);
  });
  await test('un furnizor nu primește mai mult decât suma categoriei de pe comandă', async () => {
    const { randuri, rest } = randuriMarketplace({ addon_materiale_selectate: [{ furnizor_id: HBP, categorie: 'materiale', subtotal: 500 }] }, { materiale: 100, inchirieri: 0 });
    egal(randuri.map((r) => r.suma_neta_alocata), [100]);
    egal(rest.materiale, 0);
  });

  console.log('3. Facturile partenerului');
  await test('furnizor propriu: GET → nicio alocare facturabilă, furnizor_propriu = true', async () => {
    reseteaza();
    const res = raspuns();
    await facturiPartener(cerere({ token: 'tok-hbp' }), res);
    egal([res.statusCode, res.corp.facturabile.length, res.corp.furnizor_propriu], [200, 0, true]);
  });
  await test('furnizor propriu: POST factură → 409, mesaj clar', async () => {
    reseteaza();
    const res = raspuns();
    await facturiPartener(cerere({ metoda: 'POST', token: 'tok-hbp', body: { comanda_subcontractor_id: 'cs-hbp', numar_factura_partener: 'HBP-1', fisier_base64: 'JVBERi0=', mime_type: 'application/pdf' } }), res);
    egal([res.statusCode, res.corp.code], [409, 'FURNIZOR_PROPRIU']);
    egal(DB.tabele.facturi_parteneri.length, 0);
  });
  await test('furnizor extern: GET → alocarea lui e facturabilă, către entitatea activă RO', async () => {
    reseteaza();
    const res = raspuns();
    await facturiPartener(cerere({ token: 'tok-ext' }), res);
    egal([res.statusCode, res.corp.facturabile.length, res.corp.furnizor_propriu], [200, 1, false]);
    egal(res.corp.facturabile[0].entitate_beneficiara?.id, ENT_RO);
  });
  await test('furnizor extern: POST factură → înregistrată, alocarea trece în facturat', async () => {
    reseteaza();
    const res = raspuns();
    await facturiPartener(cerere({ metoda: 'POST', token: 'tok-ext', body: { comanda_subcontractor_id: 'cs-ext', numar_factura_partener: 'FE-1', fisier_base64: 'JVBERi0=', mime_type: 'application/pdf' } }), res);
    egal(res.statusCode, 200);
    egal(DB.tabele.facturi_parteneri.length, 1);
    egal(DB.tabele.comanda_subcontractori.find((c) => c.id === 'cs-ext').status, 'facturat');
  });

  console.log('4. Discounturile');
  await test('furnizorul propriu nu își poate seta discount (partener)', async () => {
    reseteaza();
    const res = raspuns();
    await discounturiPartener(cerere({ metoda: 'POST', token: 'tok-hbp', body: { tip_partener: 'materiale', categorie: 'bricolaj', discount_pct: 10 } }), res);
    egal(res.statusCode, 400);
    adevarat(/furnizorul propriu/i.test(res.corp.error), res.corp.error);
  });
  await test('adminul nu poate seta discount pentru furnizorul propriu', async () => {
    reseteaza();
    const res = raspuns();
    await discounturiAdmin(cerere({ metoda: 'POST', token: 'tok-admin', body: { partener_id: HBP, tip_partener: 'materiale', categorie: 'bricolaj', discount_pct: 10 } }), res);
    egal(res.statusCode, 400);
    egal(DB.tabele.parteneri_discounturi.length, 1);
  });

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
})();
