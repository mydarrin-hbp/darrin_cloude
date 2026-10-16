// scripts/test-pret-config.js
// Teste pentru pasul 10b, 2.6: prețul public (inclusiv vânzările proprii HBP)
// folosește formula publică, cu procentele DOAR din back-office
// (backoffice_config: comision_platforma_default_pct, cost_marketing_pct,
// cost_mentenanta_pct, cost_asigurare_pct; TVA din tax_configurations), pe
// țara comenzii. Supabase simulat în memorie.
//
// Verifică:
//   1. niciun procent scris în cod în lib/calculeaza-pret.js,
//      lib/rezolva-addon-materiale.js, api/public/marketplace-produse.js;
//   2. „Înlocuire becuri”, Bronz: cost de bază 158,66 → 226,65 lei (prețul live);
//   3. procentul schimbat în configurația simulată → prețul API se schimbă
//      imediat (lista din marketplace și prețul coșului), rândul țării are
//      prioritate față de ALL;
//   4. o valoare lipsă → eroare CONFIG_PRET_LIPSA, nu un preț inventat;
//   5. exemplul din superadmin (api/admin/exemplu-pret.js): 25 lei fără TVA →
//      prețul pentru client, recalculat cu procentele trimise.
//
// Rulare: node scripts/test-pret-config.js

const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
const { DB, cerere, raspuns, RADACINA } = sim;
sim.instaleaza();
const kvPath = require.resolve('@vercel/kv', { paths: [RADACINA] });
require.cache[kvPath] = { id: kvPath, filename: kvPath, loaded: true, exports: { kv: { incr: async () => 1, expire: async () => 1 } } };

const { calculeazaPret, EroareConfigPret } = require(path.join(RADACINA, 'lib/calculeaza-pret.js'));
const apiMarketplace = require(path.join(RADACINA, 'api/public/marketplace-produse.js'));
const apiExemplu = require(path.join(RADACINA, 'api/admin/exemplu-pret.js'));

let trecute = 0;
let picate = 0;
async function test(nume, fn) {
  try { await fn(); trecute++; console.log(`  ✓ ${nume}`); } catch (e) { picate++; console.log(`  ✗ ${nume}\n      ${e.message}`); }
}
function egal(a, b, mesaj) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${mesaj || ''} — așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(v, mesaj) { if (!v) throw new Error(mesaj || 'condiție falsă'); }

const HBP = 'p-hbp';
const PRODUS = '11111111-1111-4111-8111-111111111111';

function reset() {
  DB.coloane = {};
  DB.implicite = {};
  DB.utilizatori = { 'tok-sa': { id: 'sa', email: 'sa@x' } };
  DB.tabele = {
    profiles: [{ id: 'sa', roles: ['superadmin'] }],
    partners: [{ id: HBP, nume_firma: 'Home Best Pal SRL', partner_type: 'furnizor_materiale', entitate_platforma_id: 'ent-ro', status_verificare: 'approved' }],
    categorii: [{ id: 'n-robinete', slug: 'robinete-colectoare', title: 'Robinete și colectoare', title_en: null, capitol_cod: 'G', category_type: 'materiale', display_order: 1, activ: true }],
    marketplace_materiale: [{
      id: PRODUS, furnizor_id: HBP, denumire: 'Robinet cu sferă 1/2 țoli', descriere: 'Robinet de test.', categorie_id: 'n-robinete',
      pret_fara_tva: 25, moneda: 'RON', unitate_masura: 'buc', stoc_disponibil: 12, status: 'live', activ: true, imagini: [], traduceri: {},
    }],
    marketplace_echipamente: [],
    tax_configurations: [{ tara_cod: 'RO', moneda: 'RON', cota_tva: 21, prag_minim_comanda: 150 }],
    backoffice_config: [
      { sectiune: 'pricing', cheie: 'comision_platforma_default_pct', valoare: '12', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'cost_marketing_pct', valoare: '3', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'cost_mentenanta_pct', valoare: '2', tara_cod: 'ALL' },
      { sectiune: 'asigurari', cheie: 'cost_asigurare_pct', valoare: '1', tara_cod: 'ALL' },
    ],
    tarife_transport: [],
  };
}
function seteaza(cheie, valoare, tara = 'ALL') {
  const r = DB.tabele.backoffice_config.find((x) => x.cheie === cheie && x.tara_cod === tara);
  if (r) r.valoare = String(valoare);
  else DB.tabele.backoffice_config.push({ sectiune: cheie === 'cost_asigurare_pct' ? 'asigurari' : 'pricing', cheie, valoare: String(valoare), tara_cod: tara });
}
async function pretLista() {
  const res = raspuns();
  await apiMarketplace(cerere({ query: { tip: 'materiale', tara_cod: 'RO' } }), res);
  if (res.statusCode !== 200) throw new Error(`lista: ${res.statusCode} ${JSON.stringify(res.corp)}`);
  return { pret: res.corp.produse[0].pret_cu_tva, cache: res.headere['Cache-Control'] };
}
async function pretCos(qty = 1) {
  const res = raspuns();
  await apiMarketplace(cerere({ metoda: 'POST', body: { tara_cod: 'RO', produse: [{ id: `mp:materiale:${PRODUS}`, qty }] } }), res);
  return res;
}
// Formula publică, scrisă aici independent de cod, pentru verificare.
function formula(cost, { com, mkt, men, asg, tva }) {
  const r2 = (x) => Math.round(x * 100) / 100;
  const asigurare = r2(cost * asg / 100);
  const subtotal = cost + asigurare;
  const total = subtotal + r2(subtotal * mkt / 100) + r2(subtotal * men / 100) + r2(cost * com / 100);
  return r2(total + r2(total * tva / 100));
}

(async () => {
  console.log('1. Fără procente scrise în cod');
  await test('lib/calculeaza-pret.js, lib/rezolva-addon-materiale.js, api/public/marketplace-produse.js', () => {
    const gasite = [];
    for (const f of ['lib/calculeaza-pret.js', 'lib/rezolva-addon-materiale.js', 'api/public/marketplace-produse.js']) {
      const cod = fs.readFileSync(path.join(RADACINA, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      if (/PRICING_FALLBACK|TVA_FALLBACK|ASIGURARE_PCT_FALLBACK/.test(cod)) gasite.push(`${f}: valori de rezervă`);
      const m = cod.match(/\b0\.(21|20|19|12|03|02|01)\b|_pct\s*:\s*\d|\b1\.(21|19)\b|\b(12|21|19|3|2|1)\s*\/\s*100\b/g);
      if (m) gasite.push(`${f}: ${m.join(', ')}`);
    }
    egal(gasite, []);
  });

  console.log('\n2. Prețul de referință');
  await test('„Înlocuire becuri”, Bronz: cost de bază 158,66 → 226,65 lei (ca live, 16 oct. 2026)', async () => {
    reset();
    const c = await calculeazaPret({ cost_baza_servicii: 158.66, tara: 'RO' });
    egal(c.pret_final, 226.65);
    egal(c.cost_asigurare, 1.59);
    egal(c.tva_suma, 39.34);
    egal(Math.round((c.comision_platforma + c.cost_marketing + c.cost_mentenanta) * 100) / 100, 27.06, 'taxele platformei');
  });

  console.log('\n3. Procentul schimbat în back-office → prețul se schimbă imediat');
  await test('lista din marketplace: comision 12% → 15% schimbă prețul produsului HBP', async () => {
    reset();
    const inainte = await pretLista();
    egal(inainte.pret, formula(25, { com: 12, mkt: 3, men: 2, asg: 1, tva: 21 }), 'înainte');
    seteaza('comision_platforma_default_pct', 15);
    const dupa = await pretLista();
    egal(dupa.pret, formula(25, { com: 15, mkt: 3, men: 2, asg: 1, tva: 21 }), 'după');
    adevarat(dupa.pret > inainte.pret, `${inainte.pret} → ${dupa.pret}`);
  });
  await test('prețul coșului (POST): marketing 3% → 5% schimbă prețul', async () => {
    reset();
    const a = await pretCos(2);
    seteaza('cost_marketing_pct', 5);
    const b = await pretCos(2);
    egal(a.corp.pret_final, Math.max(formula(50, { com: 12, mkt: 3, men: 2, asg: 1, tva: 21 }), 150), 'înainte (cu pragul minim de 150)');
    egal(b.corp.pret_final, Math.max(formula(50, { com: 12, mkt: 5, men: 2, asg: 1, tva: 21 }), 150), 'după');
    const mare = await pretCos(20);
    egal(mare.corp.pret_final, formula(500, { com: 12, mkt: 5, men: 2, asg: 1, tva: 21 }), '20 buc, peste prag');
  });
  await test('rândul țării (RO) are prioritate față de ALL; TVA din tax_configurations', async () => {
    reset();
    seteaza('cost_asigurare_pct', 2, 'RO');
    DB.tabele.tax_configurations[0].cota_tva = 19;
    egal((await pretLista()).pret, formula(25, { com: 12, mkt: 3, men: 2, asg: 2, tva: 19 }));
  });
  await test('cache-ul răspunsului e sub 5 minute', async () => {
    reset();
    const { cache } = await pretLista();
    const s = Number((/max-age=(\d+)/.exec(cache || '') || [])[1]);
    adevarat(Number.isFinite(s) && s <= 300, cache);
  });

  console.log('\n4. Valoare lipsă → eroare clară, nu preț inventat');
  for (const [cheie, tabel] of [['comision_platforma_default_pct', 'backoffice_config'], ['cost_asigurare_pct', 'backoffice_config'], ['cota_tva', 'tax_configurations']]) {
    await test(`fără ${cheie} → CONFIG_PRET_LIPSA`, async () => {
      reset();
      if (tabel === 'tax_configurations') DB.tabele.tax_configurations = [];
      else DB.tabele.backoffice_config = DB.tabele.backoffice_config.filter((r) => r.cheie !== cheie);
      let e = null;
      try { await calculeazaPret({ cost_materiale: 25, tara: 'RO' }); } catch (x) { e = x; }
      adevarat(e instanceof EroareConfigPret && e.code === 'CONFIG_PRET_LIPSA', e ? e.message : 'niciun throw');
    });
  }
  await test('marketplace fără configurație → fără preț (eroare), nu un preț din cod', async () => {
    reset();
    DB.tabele.backoffice_config = [];
    const res = raspuns();
    await apiMarketplace(cerere({ query: { tip: 'materiale', tara_cod: 'RO' } }), res);
    adevarat(res.statusCode >= 500 && !(res.corp && res.corp.produse), JSON.stringify(res.corp));
  });

  console.log('\n5. Exemplul din superadmin');
  async function exemplu(body, token = 'tok-sa') {
    const res = raspuns();
    await apiExemplu(cerere({ metoda: 'POST', token, body }), res);
    return res;
  }
  await test('25 lei fără TVA, 12 / 3 / 2 / 1, TVA RO 21% → prețul formulei', async () => {
    reset();
    const r = await exemplu({ tara: 'RO', cost_baza: 25, comision_platforma_default_pct: 12, cost_marketing_pct: 3, cost_mentenanta_pct: 2, cost_asigurare_pct: 1 });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    egal(r.corp.calc.pret_final, formula(25, { com: 12, mkt: 3, men: 2, asg: 1, tva: 21 }));
    egal(r.corp.calc.tva_pct, 21);
    egal(r.corp.moneda, 'RON');
  });
  await test('procent modificat în panou (nesalvat) → exemplul se recalculează', async () => {
    reset();
    const r = await exemplu({ tara: 'RO', cost_baza: 25, comision_platforma_default_pct: 20, cost_marketing_pct: 3, cost_mentenanta_pct: 2, cost_asigurare_pct: 1 });
    egal(r.corp.calc.pret_final, formula(25, { com: 20, mkt: 3, men: 2, asg: 1, tva: 21 }));
  });
  await test('procent gol sau peste 100 → 400; fără drept de admin → 403', async () => {
    reset();
    egal((await exemplu({ tara: 'RO', cost_baza: 25, comision_platforma_default_pct: '', cost_marketing_pct: 3, cost_mentenanta_pct: 2, cost_asigurare_pct: 1 })).statusCode, 400);
    egal((await exemplu({ tara: 'RO', cost_baza: 25, comision_platforma_default_pct: 120, cost_marketing_pct: 3, cost_mentenanta_pct: 2, cost_asigurare_pct: 1 })).statusCode, 400);
    DB.tabele.profiles.push({ id: 'c', roles: ['client'] });
    DB.utilizatori['tok-c'] = { id: 'c' };
    egal((await exemplu({ tara: 'RO', cost_baza: 25 }, 'tok-c')).statusCode, 403);
  });

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
})();
