// scripts/test-permisiuni-investitori.js
// Pasul 11-N2 (22 oct. 2026): dreptul de scriere pe secțiunea Investitori
// (lib/permisiuni-investitori.js), cu handler-ele reale peste Supabase-ul
// simulat (scripts/supabase-simulat.js). Nimic nu ajunge la producție.
//   A. matricea arePermisiuneInvestitori(user, { scriere }):
//      superadmin → citire + scriere; admin cu poate_scrie = true → citire +
//      scriere; admin cu poate_scrie = false → doar citire; admin fără rând,
//      client → nimic; eroare la citirea permisiunii → nimic (fail-closed);
//   B. citirea (dashboard, lista rundelor, cererile KYC, calculul): 200 pentru
//      cei cu drept, cu poate_scrie corect; 403 FARA_DREPT pentru ceilalți;
//   C. scrierea pe cele 3 endpoint-uri (runde-finantare: salvare / deschidere
//      / închidere; investitori-kyc: aprobare / respingere;
//      investitori-aprobare: aprobare / respingere): 403 FARA_DREPT_SCRIERE
//      (RO + EN) pentru adminul doar cu citire, nimic scris, nimic auditat;
//      merge pentru superadmin și pentru adminul cu poate_scrie = true;
//   D. subscrierea merge cu data_start în viitor și în trecut (nicio blocare
//      a perioadei; data_start = deschiderea oficială).
// Cifrele și datele rundei sunt DE TEST, nu ale rundei Seed reale.
// Rulare: node scripts/test-permisiuni-investitori.js

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

function stub(fisier, exp) {
  const p = require.resolve(path.join(RADACINA, fisier));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };
}
stub('lib/rate-limit.js', { checkRateLimit: async () => true });
stub('lib/contact-platforma.js', { incarcaContactPlatformaSigur: async () => null, incarcaContactPlatforma: async () => null, contactPlatformaDinCache: () => null });

const { arePermisiuneInvestitori, nivelInvestitori } = require(path.join(RADACINA, 'lib/permisiuni-investitori.js'));
const apiRunde = require(path.join(RADACINA, 'api/admin/runde-finantare.js'));
const apiKyc = require(path.join(RADACINA, 'api/admin/investitori-kyc.js'));
const apiAprobare = require(path.join(RADACINA, 'api/admin/investitori-aprobare.js'));
const apiDashboard = require(path.join(RADACINA, 'api/admin/investitori-dashboard.js'));
const apiSub = require(path.join(RADACINA, 'api/investitori/subscrie.js'));

const SUPER = 'u-super', SCRIE = 'u-admin-scrie', CITESTE = 'u-admin-citeste', FARA = 'u-admin-fara', CLIENT = 'u-client', INV = 'u-investitor';
const TOKEN = { [SUPER]: 'tok-super', [SCRIE]: 'tok-scrie', [CITESTE]: 'tok-citeste', [FARA]: 'tok-fara', [CLIENT]: 'tok-client', [INV]: 'tok-inv' };

// Rundă DE TEST: pre-money 900.000, țintă 100.000, 900 de acțiuni → 1.000 / acțiune.
const RUNDA = (x = {}) => Object.assign({
  id: 'r-test', cod: 'test', denumire_ro: 'Rundă de test', denumire_en: 'Test round', stare: 'deschisa', moneda: 'EUR',
  evaluare_pre_money: 900000, suma_tinta: 100000, actiuni_existente: 900, investitie_minima: 1000, tickete: null,
  instrumente: ['actiuni', 'safe'], afiseaza_progres: false, vizibila_public: false, data_start: null, data_sfarsit: null,
}, x);

function reset() {
  DB.tabele = {
    profiles: [
      { id: SUPER, email: 'super@test', roles: ['superadmin'] },
      { id: SCRIE, email: 'scrie@test', roles: ['admin'] },
      { id: CITESTE, email: 'citeste@test', roles: ['admin'] },
      { id: FARA, email: 'fara@test', roles: ['admin'] },
      { id: CLIENT, email: 'client@test', roles: ['client'] },
      { id: INV, email: 'inv@test', roles: ['client', 'investor'], tara: 'RO', limba: 'ro' },
    ],
    admin_permissions: [
      { admin_id: SCRIE, sectiune: 'investitori', poate_scrie: true },
      { admin_id: CITESTE, sectiune: 'investitori', poate_scrie: false },
      { admin_id: FARA, sectiune: 'catalog_servicii', poate_scrie: true },
    ],
    runde_finantare: [RUNDA(), RUNDA({ id: 'r-plan', cod: 'plan', denumire_ro: 'Rundă planificată', denumire_en: 'Planned round', stare: 'planificata' })],
    investitori_kyc: [{ user_id: INV, status: 'in_verificare', date_personale: { prenume: 'Ion', nume: 'Test' }, submitted_at: '2026-10-20T10:00:00Z' }],
    investitori_portofoliu: [{ id: 's-1', user_id: INV, email: 'inv@test', runda_id: 'r-test', actiuni: 5, valoare_investita: 5000, status: 'in_asteptare', created_at: '2026-10-21T10:00:00Z' }],
    audit_log: [],
  };
  DB.coloane = {};
  DB.storage = {};
  DB.utilizatori = {};
  Object.keys(TOKEN).forEach((id) => { DB.utilizatori[TOKEN[id]] = { id, email: id + '@test' }; });
}

let ok = 0, esec = 0;
async function test(nume, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + nume); }
  catch (e) { esec++; console.log('  ✗ ' + nume + ' — ' + e.message); }
}
function egal(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(c, m) { if (!c) throw new Error(m || 'condiție falsă'); }

async function cheama(api, id, { metoda = 'GET', body = null, query = {} } = {}) {
  const res = raspuns();
  await api(cerere({ metoda, token: TOKEN[id], body, query }), res);
  return res;
}
function refuzScriere(r, et) {
  egal(r.statusCode, 403, et);
  egal(r.corp.cod, 'FARA_DREPT_SCRIERE', et);
  adevarat(/doar de citire/.test(r.corp.mesaj.ro) && /read-only/.test(r.corp.mesaj.en), `${et}: mesaj RO + EN (${JSON.stringify(r.corp.mesaj)})`);
}
// Fotografia datelor care nu au voie să se schimbe la un refuz.
const instantaneu = () => JSON.stringify([DB.tabele.runde_finantare, DB.tabele.investitori_kyc, DB.tabele.investitori_portofoliu, DB.tabele.audit_log]);

// Toate scrierile, fiecare pe date proaspete.
const SCRIERI = [
  ['runde-finantare: salvare (creare)', apiRunde, { actiune: 'salveaza', runda: { cod: 'nou', denumire_ro: 'Nouă', denumire_en: 'New', moneda: 'EUR', evaluare_pre_money: 900, suma_tinta: 100, actiuni_existente: 90, instrumente: ['actiuni'] } }],
  ['runde-finantare: salvare (editare)', apiRunde, { actiune: 'salveaza', runda: { id: 'r-plan', cod: 'plan', denumire_ro: 'Rundă planificată 2', denumire_en: 'Planned round 2', moneda: 'EUR', evaluare_pre_money: 900, suma_tinta: 100, actiuni_existente: 90, instrumente: ['actiuni'] } }],
  ['runde-finantare: închidere', apiRunde, { actiune: 'inchide', id: 'r-test' }],
  ['runde-finantare: deschidere', apiRunde, { actiune: 'deschide', id: 'r-plan' }, () => { DB.tabele.runde_finantare[0].stare = 'inchisa'; }],
  ['investitori-kyc: aprobare', apiKyc, { user_id: INV, actiune: 'aproba' }],
  ['investitori-kyc: respingere', apiKyc, { user_id: INV, actiune: 'respinge', motiv_ro: 'Poză neclară', motiv_en: 'Blurry photo' }],
  ['investitori-aprobare: aprobare', apiAprobare, { id: 's-1', actiune: 'aproba' }, () => { DB.tabele.investitori_kyc[0].status = 'aprobat'; }],
  ['investitori-aprobare: respingere', apiAprobare, { id: 's-1', actiune: 'respinge' }],
];

(async () => {
  console.log('A. Matricea de permisiuni');
  await test('superadmin → citire + scriere', async () => {
    reset();
    egal(await nivelInvestitori({ id: SUPER }), 'scriere');
    egal([await arePermisiuneInvestitori({ id: SUPER }), await arePermisiuneInvestitori({ id: SUPER }, { scriere: true })], [true, true]);
  });
  await test('admin cu poate_scrie = true → citire + scriere', async () => {
    reset();
    egal([await arePermisiuneInvestitori({ id: SCRIE }), await arePermisiuneInvestitori({ id: SCRIE }, { scriere: true })], [true, true]);
  });
  await test('admin cu poate_scrie = false → citire da, scriere nu', async () => {
    reset();
    egal([await arePermisiuneInvestitori({ id: CITESTE }), await arePermisiuneInvestitori({ id: CITESTE }, { scriere: true })], [true, false]);
    DB.tabele.admin_permissions[1].poate_scrie = null;
    egal(await nivelInvestitori({ id: CITESTE }), 'citire', 'poate_scrie null');
  });
  await test('admin fără rând pe investitori / client / fără utilizator → nimic', async () => {
    reset();
    for (const u of [{ id: FARA }, { id: CLIENT }, { id: 'necunoscut' }, null, {}]) {
      egal([await arePermisiuneInvestitori(u), await arePermisiuneInvestitori(u, { scriere: true })], [false, false], JSON.stringify(u));
    }
  });
  await test('eroare la citirea permisiunii → nimic (fail-closed)', async () => {
    reset();
    delete DB.tabele.admin_permissions; // tabela lipsă → eroare 42P01
    egal([await arePermisiuneInvestitori({ id: SCRIE }), await arePermisiuneInvestitori({ id: SCRIE }, { scriere: true })], [false, false]);
    reset();
    DB.coloane.admin_permissions = ['admin_id', 'sectiune']; // coloana poate_scrie lipsă → eroare 42703
    egal(await nivelInvestitori({ id: SCRIE }), null);
  });

  console.log('B. Citirea');
  for (const [id, poate] of [[SUPER, true], [SCRIE, true], [CITESTE, false]]) {
    await test(`${id}: dashboard, runde, KYC, calcul → 200, poate_scrie = ${poate}`, async () => {
      reset();
      const d = await cheama(apiDashboard, id); egal(d.statusCode, 200, 'dashboard'); egal(d.corp.poate_scrie, poate, 'dashboard');
      const r = await cheama(apiRunde, id); egal(r.statusCode, 200, 'runde'); egal(r.corp.poate_scrie, poate, 'runde'); egal(r.corp.runde.length, 2);
      const k = await cheama(apiKyc, id); egal(k.statusCode, 200, 'kyc'); egal(k.corp.poate_scrie, poate, 'kyc'); egal(k.corp.cereri.length, 1);
      const c = await cheama(apiRunde, id, { metoda: 'POST', body: { actiune: 'calcul', runda: { evaluare_pre_money: 900, suma_tinta: 100, actiuni_existente: 90 } } });
      egal(c.statusCode, 200, 'calcul'); adevarat(c.corp.calcul && c.corp.calcul.pret_actiune > 0, 'calcul');
    });
  }
  for (const id of [FARA, CLIENT]) {
    await test(`${id}: citirea → 403`, async () => {
      reset();
      for (const [n, api] of [['dashboard', apiDashboard], ['runde', apiRunde], ['kyc', apiKyc]]) {
        const r = await cheama(api, id);
        egal(r.statusCode, 403, n);
        adevarat(r.corp.ok === false && r.corp.mesaj && r.corp.mesaj.ro && r.corp.mesaj.en, `${n}: forma comună RO + EN`);
      }
    });
  }
  await test('eroare la citirea permisiunii → 403 pe toate endpoint-urile', async () => {
    reset();
    delete DB.tabele.admin_permissions;
    for (const [n, api, body] of [['dashboard', apiDashboard], ['runde', apiRunde], ['kyc', apiKyc], ['aprobare', apiAprobare, { id: 's-1', actiune: 'respinge' }]]) {
      const r = await cheama(api, SCRIE, body ? { metoda: 'POST', body } : {});
      egal(r.statusCode, 403, n); egal(r.corp.cod, 'FARA_DREPT', n);
    }
  });

  console.log('C. Scrierea');
  for (const [nume, api, body, pregatire] of SCRIERI) {
    await test(`admin doar cu citire: ${nume} → 403 FARA_DREPT_SCRIERE, nimic scris`, async () => {
      reset(); if (pregatire) pregatire();
      const inainte = instantaneu();
      refuzScriere(await cheama(api, CITESTE, { metoda: 'POST', body }), nume);
      egal(instantaneu() === inainte, true, 'datele nu se schimbă');
    });
    for (const id of [FARA, CLIENT]) {
      await test(`${id}: ${nume} → 403, nimic scris`, async () => {
        reset(); if (pregatire) pregatire();
        const inainte = instantaneu();
        egal((await cheama(api, id, { metoda: 'POST', body })).statusCode, 403);
        egal(instantaneu() === inainte, true, 'datele nu se schimbă');
      });
    }
    for (const id of [SUPER, SCRIE]) {
      await test(`${id}: ${nume} → 200, auditat`, async () => {
        reset(); if (pregatire) pregatire();
        const r = await cheama(api, id, { metoda: 'POST', body });
        egal(r.statusCode, 200, JSON.stringify(r.corp));
        adevarat(DB.tabele.audit_log.length >= 1, 'audit');
      });
    }
  }
  await test('rezultatul scrierii e cel cerut (închidere, aprobare KYC, aprobare subscriere)', async () => {
    reset();
    await cheama(apiRunde, SCRIE, { metoda: 'POST', body: { actiune: 'inchide', id: 'r-test' } });
    egal(DB.tabele.runde_finantare[0].stare, 'inchisa');
    await cheama(apiKyc, SCRIE, { metoda: 'POST', body: { user_id: INV, actiune: 'aproba' } });
    egal(DB.tabele.investitori_kyc[0].status, 'aprobat');
    await cheama(apiAprobare, SCRIE, { metoda: 'POST', body: { id: 's-1', actiune: 'aproba' } });
    egal(DB.tabele.investitori_portofoliu[0].status, 'aprobat');
  });

  console.log('D. Subscrierea și perioada (nicio blocare)');
  for (const [n, start, sfarsit] of [['data_start în viitor', '2099-11-01', '2100-06-30'], ['data_start în trecut', '2020-11-01', '2021-06-30'], ['fără perioadă', null, null]]) {
    await test(`${n} → subscrierea e primită (200, în așteptare)`, async () => {
      reset();
      Object.assign(DB.tabele.runde_finantare[0], { data_start: start, data_sfarsit: sfarsit });
      const r = await cheama(apiSub, INV, { metoda: 'POST', body: { suma: 5000, instrument: 'safe' } });
      egal(r.statusCode, 200, JSON.stringify(r.corp));
      egal(r.corp.portofoliu.status, 'in_asteptare');
    });
  }

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
