// scripts/test-runda-finantare.js
// Teste pentru lib/runda-finantare.js (pasul 11-J, 21 oct. 2026), peste un
// Supabase simulat. Valorile sunt de test, nu cifrele reale ale rundei.
//   - calculele: post-money, prețul pe acțiune, procentul oferit, acțiunile
//     pentru o sumă, procentul investitorului;
//   - suma sub minim / peste ce a rămas din țintă / sub o acțiune → refuzată;
//   - fără rundă deschisă → RUNDA_INCHISA (mesaj RO + EN);
//   - două runde deschise → eroare (nu se alege una la întâmplare);
//   - tabela lipsă (migrarea neaplicată) → ca fără rundă, nu eroare;
//   - api/public/runda-curenta.js: doar runda deschisă și vizibilă public,
//     fără date despre investitori, progresul doar cu afiseaza_progres,
//     cache de cel mult 5 minute.
// Rulare: node scripts/test-runda-finantare.js

const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB } = sim;
const R = require('../lib/runda-finantare');
const apiRundaCurenta = require('../api/public/runda-curenta');

function cheama(api) {
  return new Promise((rezolva) => {
    const res = { statusCode: 200, antete: {}, setHeader(k, v) { this.antete[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
      json(o) { rezolva({ statusCode: this.statusCode, antete: this.antete, corp: o }); return this; }, end() { rezolva({ statusCode: this.statusCode, antete: this.antete }); } };
    Promise.resolve(api({ method: 'GET', headers: {}, query: {} }, res)).catch((e) => rezolva({ statusCode: 500, corp: { error: e.message } }));
  });
}
const PUBLICA = { ...{ id: 'r1', cod: 'test', stare: 'deschisa', moneda: 'EUR', evaluare_pre_money: 900, suma_tinta: 100, actiuni_existente: 90, investitie_minima: 20 },
  denumire_ro: 'Test RO', denumire_en: 'Test EN', tickete: [20, 50], instrumente: ['actiuni'], vizibila_public: true, afiseaza_progres: false,
  discount_buyback_pct: 10, lock_up_luni: 12, creat_de: 'admin-1' };
const SUBSCRIERI = [
  { runda_id: 'r1', user_id: 'u1', email: 'investitor@test', valoare_investita: 30, actiuni: 3, status: 'aprobat' },
  { runda_id: 'r1', user_id: 'u2', email: 'altul@test', valoare_investita: 50, actiuni: 5, status: 'in_asteptare' },
];

// pre-money 900, țintă 100, 90 de acțiuni existente → preț 10, post 1000, 10%, 10 acțiuni noi
const TEST = { id: 'r1', cod: 'test', stare: 'deschisa', moneda: 'EUR', evaluare_pre_money: 900, suma_tinta: 100, actiuni_existente: 90, investitie_minima: 20 };

let ok = 0, esec = 0;
async function test(nume, fn) { try { await fn(); ok++; console.log('  ✓ ' + nume); } catch (e) { esec++; console.log('  ✗ ' + nume + ' — ' + e.message); } }
function egal(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(c, m) { if (!c) throw new Error(m || 'condiție falsă'); }
function arunca(fn, cod) { try { fn(); } catch (e) { if (e.cod !== cod) throw new Error(`cod ${e.cod}, așteptat ${cod}`); return e; } throw new Error('nu a aruncat ' + cod); }

(async () => {
  await test('calculele rundei: post-money, preț, procent, acțiuni noi', async () => {
    egal(R.calculeaza(TEST), { post_money: 1000, pret_actiune: 10, equity_oferit_pct: 10, actiuni_noi: 10 });
  });
  await test('date lipsă sau 0 → fără calcul (nicio valoare de rezervă)', async () => {
    egal(R.calculeaza({ ...TEST, actiuni_existente: 0 }), null);
    egal(R.calculeaza({ ...TEST, suma_tinta: null }), null);
  });
  await test('acțiunile pentru o sumă: floor(sumă / preț)', async () => {
    egal(R.actiuniPentruSuma(TEST, 25), 2);
    egal(R.actiuniPentruSuma(TEST, 30), 3);
  });
  await test('procentul investitorului: acțiuni / (existente + noi emise)', async () => {
    egal(R.procentInvestitor(TEST, 5, 10), 5);
    egal(R.procentInvestitor(TEST, 9, 0), 10);
    egal(R.procentInvestitor(TEST, 0, 10), 0);
  });
  await test('suma validă → acțiunile', async () => {
    egal(R.valideazaSuma(TEST, 30, 0), { actiuni: 3 });
  });
  await test('sub investiția minimă → SUMA_SUB_MINIM, cu mesaj RO + EN', async () => {
    const e = arunca(() => R.valideazaSuma(TEST, 10, 0), 'SUMA_SUB_MINIM');
    if (!/20 EUR/.test(e.message) || !/20 EUR/.test(e.mesaj_en)) throw new Error(e.message + ' / ' + e.mesaj_en);
  });
  await test('peste ce a rămas din țintă → SUMA_PESTE_RAMAS', async () => {
    const e = arunca(() => R.valideazaSuma(TEST, 50, 60), 'SUMA_PESTE_RAMAS');
    if (!/40 EUR/.test(e.message)) throw new Error(e.message);
  });
  await test('fără minim configurat, dar sub prețul unei acțiuni → SUB_O_ACTIUNE', async () => {
    arunca(() => R.valideazaSuma({ ...TEST, investitie_minima: null }, 5, 0), 'SUB_O_ACTIUNE');
  });
  await test('sumă invalidă → SUMA_INVALIDA', async () => {
    arunca(() => R.valideazaSuma(TEST, 0, 0), 'SUMA_INVALIDA');
    arunca(() => R.valideazaSuma(TEST, 'abc', 0), 'SUMA_INVALIDA');
  });
  await test('fără rundă deschisă → RUNDA_INCHISA (RO + EN)', async () => {
    DB.tabele = { runde_finantare: [{ ...TEST, stare: 'planificata' }] };
    egal(await R.rundaDeschisa(), null);
    let e = null;
    try { await R.rundaDeschisaSauEroare(); } catch (x) { e = x; }
    egal(e && e.cod, 'RUNDA_INCHISA');
    if (!/open funding round/.test(e.mesaj_en)) throw new Error(e.mesaj_en);
  });
  await test('o rundă deschisă → o întoarce', async () => {
    DB.tabele = { runde_finantare: [{ ...TEST, stare: 'inchisa', id: 'vechi' }, TEST] };
    egal((await R.rundaDeschisa()).id, 'r1');
  });
  await test('două runde deschise → eroare, nu una la întâmplare', async () => {
    DB.tabele = { runde_finantare: [TEST, { ...TEST, id: 'r2' }] };
    let e = null;
    try { await R.rundaDeschisa(); } catch (x) { e = x; }
    if (!e || !/Mai multe runde deschise/.test(e.message)) throw new Error('fără eroare');
  });
  await test('tabela lipsă (migrarea neaplicată) → fără rundă, nu eroare', async () => {
    DB.tabele = {};
    egal(await R.rundaDeschisa(), null);
  });
  await test('totalurile rundei: doar subscrierile aprobate', async () => {
    DB.tabele = { investitori_portofoliu: [
      { runda_id: 'r1', valoare_investita: 30, actiuni: 3, status: 'aprobat' },
      { runda_id: 'r1', valoare_investita: 50, actiuni: 5, status: 'in_asteptare' },
      { runda_id: 'r2', valoare_investita: 99, actiuni: 9, status: 'aprobat' },
    ] };
    egal(await R.totaluriRunda('r1'), { suma: 30, actiuni: 3 });
    egal(await R.totaluriRunda('r1', ['aprobat', 'in_asteptare']), { suma: 80, actiuni: 8 });
  });

  console.log('api/public/runda-curenta');
  await test('fără rundă deschisă sau rundă nevizibilă public → runda null', async () => {
    DB.tabele = { runde_finantare: [{ ...PUBLICA, stare: 'planificata' }], investitori_portofoliu: [] };
    apiRundaCurenta._golesteCache();
    egal((await cheama(apiRundaCurenta)).corp, { ok: true, runda: null });
    DB.tabele.runde_finantare = [{ ...PUBLICA, vizibila_public: false }];
    apiRundaCurenta._golesteCache();
    egal((await cheama(apiRundaCurenta)).corp, { ok: true, runda: null });
  });
  await test('runda publică: valorile calculate, fără date despre investitori, fără progres', async () => {
    DB.tabele = { runde_finantare: [PUBLICA], investitori_portofoliu: SUBSCRIERI };
    apiRundaCurenta._golesteCache();
    const r = await cheama(apiRundaCurenta);
    egal(r.statusCode, 200);
    const x = r.corp.runda;
    egal([x.pret_actiune, x.equity_oferit_pct, x.post_money, x.suma_tinta, x.investitie_minima], [10, 10, 1000, 100, 20]);
    egal([x.denumire_ro, x.denumire_en, x.tickete, x.instrumente], ['Test RO', 'Test EN', [20, 50], ['actiuni']]);
    adevarat(!('progres' in x), 'fără progres când afiseaza_progres e false');
    const text = JSON.stringify(r.corp);
    for (const interzis of ['investitor@test', 'altul@test', 'u1', 'u2', 'admin-1', 'creat_de', 'discount_buyback_pct', 'lock_up_luni', '"id"']) {
      adevarat(!text.includes(interzis), 'nu apare ' + interzis);
    }
    adevarat(/max-age=(\d+)/.test(r.antete['cache-control']) && Number(RegExp.$1) <= 300, 'cache ≤ 5 minute: ' + r.antete['cache-control']);
  });
  await test('afiseaza_progres → doar suma subscrierilor aprobate și procentul', async () => {
    DB.tabele = { runde_finantare: [{ ...PUBLICA, afiseaza_progres: true }], investitori_portofoliu: SUBSCRIERI };
    apiRundaCurenta._golesteCache();
    egal((await cheama(apiRundaCurenta)).corp.runda.progres, { stranse: 30, pct: 30 });
  });
  await test('cache: a doua cerere, în 5 minute, nu mai citește baza', async () => {
    DB.tabele = { runde_finantare: [PUBLICA], investitori_portofoliu: [] };
    apiRundaCurenta._golesteCache();
    await cheama(apiRundaCurenta);
    DB.tabele.runde_finantare = [];
    egal((await cheama(apiRundaCurenta)).corp.runda.cod, 'test');
  });
  await test('tabela lipsă (migrarea neaplicată) → runda null, 200', async () => {
    DB.tabele = { investitori_portofoliu: [] };
    apiRundaCurenta._golesteCache();
    const r = await cheama(apiRundaCurenta);
    egal([r.statusCode, r.corp], [200, { ok: true, runda: null }]);
  });

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})();
