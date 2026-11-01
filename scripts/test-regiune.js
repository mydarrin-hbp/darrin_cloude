// scripts/test-regiune.js
// Teste pentru pasul 11-P3b (28 oct. 2026): județul, într-un singur format
// (lib/regiune.js), peste un Supabase simulat — nimic nu ajunge la Supabase:
//   A. normalizeazaRegiune: codul, numele cu / fără diacritice, prefixele
//      („Județul ”, „Jud. ”, „ County”), București în toate formele (și
//      sectoarele), Călărași; nerecunoscut → null; țară fără regiuni și
//      geo_regiuni indisponibil → nimic refuzat; cache în memorie;
//   B. regula București-Ilfov (varianteRegiune), în ambele sensuri;
//   C. alocarea (lib/aloca-partener.js): „Cluj” / „CJ” / „Judetul Cluj” → același
//      partener; București și Ilfov găsesc partenerii cu B-ILFOV; o comandă
//      veche cu B-ILFOV găsește partenerii din B / IF; comenzile vechi cu nume;
//   D. subcontractorii (lib/aloca-subcontractori.js): aceeași zonă;
//   E. sloturile (lib/calculeaza-sloturi-disponibile.js + api/public/sloturi-disponibile.js):
//      aceleași sloturi pentru toate formele; județ necunoscut → 400 camp 'regiune';
//   E2. zona curierului (api/partener/zona-curier.js): text liber citit tolerant;
//   F. api/admin/investitori-kyc.js: o eroare în decizie → 500 cu error / error_en.
// Rândurile din geo_regiuni sunt cele reale (cod, denumire) pentru județele folosite.
// Rulare: node scripts/test-regiune.js

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, supabaseAdmin, cerere, raspuns, RADACINA } = sim;

function stub(fisier, exp) {
  const p = require.resolve(path.join(RADACINA, fisier));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };
}
stub('lib/rate-limit.js', { checkRateLimit: async () => true });
stub('lib/notificari-comanda.js', { notificaAdminFaraPartener: async () => true, notificaPartenerAlocat: async () => true, MOTIVE: {} });
stub('lib/competente-parteneri.js', { filtreazaDupaCompetente: async (ids) => ids });
// Regula „poate primi comenzi” (contract, cont bancar) nu e testată aici: toți pot.
stub('lib/eligibilitate-partener.js', { parteneriCarePotVinde: async (ids) => new Set(ids) });
supabaseAdmin.auth.admin = Object.assign(supabaseAdmin.auth.admin || {}, { getUserById: async () => ({ data: { user: null }, error: null }) });

const R = require(path.join(RADACINA, 'lib/regiune.js'));
const { incearcaAlocarePartener } = require(path.join(RADACINA, 'lib/aloca-partener.js'));
const subcontractori = require(path.join(RADACINA, 'lib/aloca-subcontractori.js'));
const { calculeazaSloturiDisponibile } = require(path.join(RADACINA, 'lib/calculeaza-sloturi-disponibile.js'));
const apiSloturi = require(path.join(RADACINA, 'api/public/sloturi-disponibile.js'));

const GEO = [
  ['RO', 'BN', 'Bistrița-Năsăud'], ['RO', 'B', 'București'], ['RO', 'CL', 'Călărași'], ['RO', 'CJ', 'Cluj'],
  ['RO', 'IF', 'Ilfov'], ['RO', 'IS', 'Iași'], ['RO', 'SB', 'Sibiu'], ['RO', 'B-ILFOV', 'Zona Metropolitană București-Ilfov'],
  ['MD', 'chisinau', 'Chișinău (municipiu)'],
].map(([tara_cod, cod, denumire], i) => ({ id: 'g' + i, tara_cod, cod, denumire, ordine: i + 1 }));

const SERV = 'serv-1';
function reset({ geo = true, parteneri = [] } = {}) {
  DB.tabele = {
    ...(geo ? { geo_regiuni: GEO.map((g) => ({ ...g })) } : {}),
    comenzi: [], profiles: [],
    catalog_servicii: [{ id: SERV, cod_esco: null }],
    partener_servicii_active: parteneri.map((p) => ({ partener_id: p.id, catalog_serviciu_id: SERV, activ: true })),
    parteneri_disponibilitate: parteneri.map((p) => ({ partener_id: p.id, status_live: 'disponibil', tara_cod: 'RO', judete: p.judete })),
    partner_angajati: [], parteneri_program_lucru: [],
    partners: parteneri.map((p) => ({ id: p.id, partner_type: 'curier_utilitara', status_verificare: 'approved' })),
  };
  DB.coloane = {};
  R._golesteCache();
}

let ok = 0, esec = 0;
async function test(nume, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + nume); }
  catch (e) { esec++; console.log('  ✗ ' + nume + ' — ' + e.message); }
}
function egal(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(c, m) { if (!c) throw new Error(m || 'condiție falsă'); }

let nrComanda = 0;
async function aloca(regiune, tara = 'RO') {
  const id = 'c' + (++nrComanda);
  DB.tabele.comenzi.push({ id, nr_comanda: 'T-' + nrComanda, client_id: null, catalog_serviciu_id: SERV, tara_cod: tara, regiune, localitate: null, status: 'in_cautare_partener' });
  return incearcaAlocarePartener(id);
}
const cod = async (tara, v) => { const r = await R.normalizeazaRegiune(tara, v); return r && r.cod; };

(async () => {
  console.log('A. normalizeazaRegiune');
  await test('Cluj: codul, numele, prefixele „Județul” / „Judetul” / „Jud.”, „Cluj County” → CJ', async () => {
    reset();
    for (const v of ['CJ', 'cj', 'Cluj', 'cluj', 'Județul Cluj', 'Judetul Cluj', 'Jud. Cluj', 'JUD. CLUJ', 'Cluj County', ' Cluj ']) egal(await cod('RO', v), 'CJ', v);
    egal(await R.normalizeazaRegiune('RO', 'Judetul Cluj'), { cod: 'CJ', denumire: 'Cluj' });
  });
  await test('diacritice: „Bistrița-Năsăud” / „Bistrita-Nasaud” / „Bistrita Nasaud” → BN; „Iasi” → IS', async () => {
    reset();
    for (const v of ['Bistrița-Năsăud', 'Bistrita-Nasaud', 'Bistrita Nasaud', 'Județul Bistrița-Năsăud']) egal(await cod('RO', v), 'BN', v);
    egal(await cod('RO', 'Iasi'), 'IS');
  });
  await test('București în toate formele (B, București, Bucuresti, Municipiul București, Bucharest, Sector 3) → B', async () => {
    reset();
    for (const v of ['B', 'București', 'Bucuresti', 'BUCUREȘTI', 'Municipiul București', 'Municipiul Bucuresti', 'Mun. București', 'Bucharest', 'Sector 3', 'Sectorul 6']) egal(await cod('RO', v), 'B', v);
  });
  await test('Călărași: „Calarasi” / „Călărași” / „CL” / „Județul Călărași” → CL', async () => {
    reset();
    for (const v of ['Calarasi', 'Călărași', 'CL', 'Județul Călărași']) egal(await cod('RO', v), 'CL', v);
  });
  await test('compusul B-ILFOV se recunoaște după cod; Ilfov rămâne IF', async () => {
    reset();
    egal(await cod('RO', 'B-ILFOV'), 'B-ILFOV');
    egal(await cod('RO', 'Ilfov County'), 'IF');
  });
  await test('nerecunoscut → null, cu areRegiuni: true (RO are regiuni)', async () => {
    reset();
    for (const v of ['Narnia', 'Cluj-Napoca', 'Sector 9', 'Nord-Vest']) egal(await R.rezolvaRegiune('RO', v), { regiune: null, areRegiuni: true }, v);
  });
  await test('alt stat: Moldova („Chișinău”, „Chisinau” → chisinau); țară fără regiuni → areRegiuni: false', async () => {
    reset();
    egal(await cod('MD', 'Chisinau'), 'chisinau');
    egal(await cod('MD', 'Municipiul Chișinău'), 'chisinau');
    egal(await R.rezolvaRegiune('IT', 'Lazio'), { regiune: null, areRegiuni: false });
  });
  await test('geo_regiuni indisponibil → nimic refuzat (areRegiuni: false), nimic ținut în cache', async () => {
    reset({ geo: false });
    egal(await R.rezolvaRegiune('RO', 'Cluj'), { regiune: null, areRegiuni: false });
    DB.tabele.geo_regiuni = GEO.map((g) => ({ ...g }));
    egal(await cod('RO', 'Cluj'), 'CJ', 'după revenirea tabelului');
  });
  await test('cache în memorie: a doua citire nu mai întreabă baza', async () => {
    reset();
    await cod('RO', 'Cluj');
    DB.tabele.geo_regiuni = [];
    egal(await cod('RO', 'Sibiu'), 'SB');
    R._golesteCache();
    egal(await cod('RO', 'Sibiu'), null, 'după golirea cache-ului');
  });

  console.log('B. Regula București-Ilfov');
  await test('B și IF → codul propriu + B-ILFOV; B-ILFOV → B, IF, B-ILFOV; restul → codul', async () => {
    egal(R.varianteRegiune('B'), ['B', 'B-ILFOV']);
    egal(R.varianteRegiune('IF'), ['IF', 'B-ILFOV']);
    egal(R.varianteRegiune('B-ILFOV'), ['B', 'IF', 'B-ILFOV']);
    egal(R.varianteRegiune('CJ'), ['CJ']);
    egal(R.varianteRegiune(null), []);
  });

  console.log('C. Alocarea (lib/aloca-partener.js)');
  await test('„Cluj” / „CJ” / „Judetul Cluj” / „Cluj County” → același partener (din CJ), nu cel din Sibiu', async () => {
    reset({ parteneri: [{ id: 'p-sb', judete: ['SB'] }, { id: 'p-cj', judete: ['CJ'] }] });
    for (const v of ['Cluj', 'CJ', 'Judetul Cluj', 'Cluj County']) egal(await aloca(v), { alocat: true, partener_id: 'p-cj' }, v);
  });
  await test('București (orice formă) și Ilfov → partenerul cu B-ILFOV', async () => {
    reset({ parteneri: [{ id: 'p-cj', judete: ['CJ'] }, { id: 'p-bi', judete: ['B-ILFOV'] }] });
    for (const v of ['B', 'București', 'Bucuresti', 'Municipiul București', 'IF', 'Ilfov']) egal((await aloca(v)).partener_id, 'p-bi', v);
  });
  await test('comandă din B → partenerul cu B; comanda veche cu B-ILFOV → partenerii cu B sau IF', async () => {
    reset({ parteneri: [{ id: 'p-b', judete: ['B'] }] });
    egal((await aloca('București')).partener_id, 'p-b');
    egal((await aloca('B-ILFOV')).partener_id, 'p-b', 'veche B-ILFOV → B');
    reset({ parteneri: [{ id: 'p-if', judete: ['IF'] }] });
    egal((await aloca('B-ILFOV')).partener_id, 'p-if', 'veche B-ILFOV → IF');
    egal((await aloca('București')).alocat, false, 'B nu găsește partenerul doar din IF');
  });
  await test('partenerul din Cluj nu primește comenzi din București; județ fără partener → nealocat', async () => {
    reset({ parteneri: [{ id: 'p-cj', judete: ['CJ'] }] });
    egal(await aloca('București'), { alocat: false, motiv: 'niciun_partener_disponibil_in_zona' });
    egal((await aloca('Călărași')).alocat, false);
  });
  await test('comenzi vechi (nume, B-ILFOV, valoare nerecunoscută) se citesc fără eroare', async () => {
    reset({ parteneri: [{ id: 'p-cj', judete: ['CJ'] }, { id: 'p-bi', judete: ['B-ILFOV'] }] });
    egal((await aloca('Cluj')).partener_id, 'p-cj', 'nume vechi');
    egal((await aloca('B-ILFOV')).partener_id, 'p-bi', 'B-ILFOV vechi');
    egal((await aloca('Valoare veche necunoscută')).alocat, false);
    reset({ geo: false, parteneri: [{ id: 'p-cj', judete: ['CJ'] }] });
    egal((await aloca('CJ')).partener_id, 'p-cj', 'geo_regiuni indisponibil: codul se compară ca atare');
  });

  console.log('D. Subcontractorii (lib/aloca-subcontractori.js)');
  await test('curierul: „Judetul Cluj” / „CJ” → partenerul din CJ; București → cel cu B-ILFOV; B-ILFOV vechi → cel din IF', async () => {
    const curier = (regiune) => subcontractori.gasesteActorPentruRol({ tara_cod: 'RO', regiune, catalog_serviciu_id: SERV }, 'curier');
    reset({ parteneri: [{ id: 'c-sb', judete: ['SB'] }, { id: 'c-cj', judete: ['CJ'] }] });
    egal([await curier('Judetul Cluj'), await curier('CJ'), await curier('Cluj County')], ['c-cj', 'c-cj', 'c-cj']);
    reset({ parteneri: [{ id: 'c-bi', judete: ['B-ILFOV'] }] });
    egal([await curier('București'), await curier('IF')], ['c-bi', 'c-bi']);
    reset({ parteneri: [{ id: 'c-if', judete: ['IF'] }] });
    egal([await curier('B-ILFOV'), await curier('Cluj')], ['c-if', null]);
  });

  console.log('E. Sloturile');
  const ZI = '2026-11-10';
  await test('„Cluj” / „CJ” / „Judetul Cluj” → aceleași sloturi și același număr de parteneri eligibili', async () => {
    reset({ parteneri: [{ id: 'p-cj', judete: ['CJ'] }, { id: 'p-sb', judete: ['SB'] }] });
    const rez = [];
    for (const v of ['Cluj', 'CJ', 'Judetul Cluj']) rez.push(await calculeazaSloturiDisponibile({ taraCod: 'RO', regiune: v, data: ZI }));
    egal(rez.map((r) => r.parteneriEligibili), [1, 1, 1]);
    egal(JSON.stringify(rez[0].sloturi), JSON.stringify(rez[2].sloturi));
    adevarat(rez[0].sloturi.some((s) => s.disponibil), 'măcar un slot disponibil');
  });
  await test('București în toate formele → partenerul cu B-ILFOV e eligibil', async () => {
    reset({ parteneri: [{ id: 'p-bi', judete: ['B-ILFOV'] }] });
    for (const v of ['B', 'București', 'Bucuresti', 'Municipiul București']) egal((await calculeazaSloturiDisponibile({ taraCod: 'RO', regiune: v, data: ZI })).parteneriEligibili, 1, v);
  });
  const sloturi = async (query) => { const res = raspuns(); await apiSloturi(cerere({ metoda: 'GET', query }), res); return res; };
  await test('API: județ necunoscut pentru RO → 400, camp regiune, RO + EN; „Jud. Cluj” → 200', async () => {
    reset({ parteneri: [{ id: 'p-cj', judete: ['CJ'] }] });
    const r = await sloturi({ tara: 'RO', regiune: 'Narnia', data: ZI });
    egal([r.statusCode, r.corp.cod, r.corp.camp], [400, 'REGIUNE_NECUNOSCUTA', 'regiune']);
    egal([r.corp.error, r.corp.error_en], ['Județul nu e recunoscut. Alege-l din listă.', 'The county is not recognised. Choose it from the list.']);
    const ok200 = await sloturi({ tara: 'RO', regiune: 'Jud. Cluj', data: ZI });
    egal([ok200.statusCode, ok200.corp.parteneriEligibili], [200, 1]);
  });

  console.log('E2. Zona curierului (api/partener/zona-curier.js), citire tolerantă');
  await test('„Iasi” (text liber, salvat așa) → regiune { cod: IS, denumire: Iași }; datele salvate nu se schimbă', async () => {
    reset();
    DB.tabele.profiles = [{ id: 'cur-1', email: 'c@test', roles: ['partener_curier'] }];
    DB.utilizatori = { 'tok-cur': { id: 'cur-1', email: 'c@test' } };
    DB.tabele.partner_zona_curier = [
      { id: 'z1', partner_id: 'cur-1', tara_cod: 'RO', regiune_cod: 'Iasi', localitate: null, raza_livrare_km: 30, activ: true, created_at: '2026-10-01' },
      { id: 'z2', partner_id: 'cur-1', tara_cod: 'RO', regiune_cod: 'Zona mea', localitate: null, raza_livrare_km: 10, activ: true, created_at: '2026-10-02' },
    ];
    const apiZona = require(path.join(RADACINA, 'api/partener/zona-curier.js'));
    const res = raspuns();
    await apiZona(cerere({ metoda: 'GET', token: 'tok-cur' }), res);
    egal(res.statusCode, 200, JSON.stringify(res.corp));
    const z = Object.fromEntries(res.corp.zone.map((x) => [x.id, x]));
    egal([z.z1.regiune_cod, z.z1.regiune], ['Iasi', { cod: 'IS', denumire: 'Iași' }]);
    egal([z.z2.regiune_cod, z.z2.regiune], ['Zona mea', null], 'nerecunoscut: rămâne, fără eroare');
    egal(DB.tabele.partner_zona_curier.map((x) => x.regiune_cod), ['Iasi', 'Zona mea'], 'datele nu se modifică');
  });

  console.log('F. api/admin/investitori-kyc.js');
  await test('o eroare în decizie → 500 cu mesajul comun (error / error_en), fără promisiune neprinsă', async () => {
    reset();
    DB.tabele.profiles = [{ id: 'super', email: 'super@test', roles: ['superadmin'] }];
    DB.utilizatori = { 'tok-super': { id: 'super', email: 'super@test' } };
    const neprinse = [];
    const asculta = (e) => neprinse.push(e);
    process.on('unhandledRejection', asculta);
    // Citirea dosarului din decizie aruncă o eroare (simulată).
    const prinde = require.resolve(path.join(RADACINA, 'lib/investitori-kyc.js'));
    const K = require(prinde);
    const citesteOriginal = K.citesteKyc;
    K.citesteKyc = async () => { throw new Error('eroare simulată în decizie'); };
    delete require.cache[require.resolve(path.join(RADACINA, 'api/admin/investitori-kyc.js'))];
    const apiKyc = require(path.join(RADACINA, 'api/admin/investitori-kyc.js'));
    const res = raspuns();
    await apiKyc(cerere({ metoda: 'POST', token: 'tok-super', body: { user_id: 'u-1', actiune: 'aproba' } }), res);
    await new Promise((r) => setTimeout(r, 30));
    K.citesteKyc = citesteOriginal;
    process.off('unhandledRejection', asculta);
    egal([res.statusCode, res.corp.error, res.corp.error_en, res.corp.cod], [500, 'Eroare internă.', 'Internal error.', 'EROARE_SERVER']);
    adevarat(!JSON.stringify(res.corp).includes('eroare simulată'), 'detaliul erorii nu ajunge la client');
    egal(neprinse.length, 0, 'promisiuni respinse neprinse');
  });

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})();
