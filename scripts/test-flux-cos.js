// scripts/test-flux-cos.js
// Teste pentru pasul 11-C1 (3 nov. 2026): un singur coș, pe server
// (/api/client/cos-multi); serviciile prin configurare, cu adresa de prestare
// obligatorie și verificată pe server; materialele direct în coș. Peste un
// Supabase simulat (scripts/supabase-simulat.js) — nimic nu ajunge la producție.
//   A. lib/disponibilitate-adresa.js + api/public/disponibilitate-adresa.js:
//      câmpuri lipsă → 400 pe câmpul corect; județ necunoscut; serviciu
//      necunoscut → 404; țară inactivă / fără parteneri în zonă → indisponibil;
//      parteneri în zonă (și regula București-Ilfov) → disponibil, cu preț și
//      transport pentru un nivel cu rețetă;
//   B. api/client/cos-multi.js: serviciu fără adresă / în afara zonei → refuz,
//      nimic în coș; cu adresă în zonă → rândul are zona verificată; material
//      direct (cantitate 1, nivelul cel mai ieftin), PATCH cantitate / nivel,
//      material inexistent / fără preț; preia_sesiune (vizitator → cont);
//      api/client/cos.js (al doilea coș) → 410;
//   C. api/comenzi/creeaza.js: fără adresă → 400 'adresa'; fără datele
//      clientului → 400 'date_facturare'; altă metodă de plată → 400
//      'metoda_plata'; materiale din catalog comandate fără serviciu (cu nivel);
//      api/public/marketplace-produse (POST) le calculează prețul;
//   D. mydarrin-serviciu → redirect permanent spre catalog (vercel.json), fără
//      date inventate, fără legături rămase spre el;
//   E. paginile în Chromium: serviciu → configurare → fără adresă nu se adaugă
//      → cu adresă din zonă activă se adaugă → antetul arată 1; material din
//      catalog direct în coș (fără configurare); coșul (cantitate, total de pe
//      server, „Finalizează” → checkout); vizitator cu coș → conectare → coșul
//      e pe cont; după comandă, rândurile ies din coș; iconița de coș pe toate
//      paginile publice; 390 / 768 / 1024 / 1366 px fără derulare orizontală
//      și fără erori JS; textele noi în engleză.
// Capturi (opțional): CAPTURI=<folder> node scripts/test-flux-cos.js
// Rulare: node scripts/test-flux-cos.js   (FARA_BROWSER=1: doar A–D)

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
stub('lib/aloca-partener.js', { incearcaAlocarePartener: async () => ({ alocat: false, motiv: 'test' }) });
stub('lib/notificari-comanda.js', { notificaAdminFaraPartener: async () => true, notificaPartenerAlocat: async () => true, MOTIVE: {} });
stub('lib/contact-platforma.js', { incarcaContactPlatformaSigur: async () => null, incarcaContactPlatforma: async () => null, contactPlatformaDinCache: () => null });

// Calculul pe rețetă e simulat (cifre de test) și reține județul primit.
const RETETA = { regiuni: [] };
const modulReteta = require(path.join(RADACINA, 'lib/calculeaza-cost-recipe.js'));
modulReteta.calculeazaCostNivel = async ({ regiune }) => {
  RETETA.regiuni.push(regiune);
  return { nivel_activ: true, resurse_fara_pret: [], cost_baza_servicii: 300, cost_materiale: 0, cost_utilaj: 0, manopera_per_esco: {} };
};

const REGIUNE = require(path.join(RADACINA, 'lib/regiune.js'));
const apiDisp = require(path.join(RADACINA, 'api/public/disponibilitate-adresa.js'));
const apiCos = require(path.join(RADACINA, 'api/client/cos-multi.js'));
const apiCosVechi = require(path.join(RADACINA, 'api/client/cos.js'));
const apiCreeaza = require(path.join(RADACINA, 'api/comenzi/creeaza.js'));
const apiMp = require(path.join(RADACINA, 'api/public/marketplace-produse.js'));
const apiGeo = require(path.join(RADACINA, 'api/public/geo-regiuni.js'));

const U = 'a0000000-0000-4000-8000-00000000000a';
const ALT = 'b0000000-0000-4000-8000-00000000000b';
const SVC = 'c0000000-0000-4000-8000-0000000000c1';     // serviciu cu partener în CJ
const SVC_B = 'c0000000-0000-4000-8000-0000000000c2';   // serviciu cu partener în B-ILFOV
const INCH = 'c0000000-0000-4000-8000-0000000000c3';    // închiriere, fără parteneri
const MAT = 'd0000000-0000-4000-8000-0000000000d1';     // material cu prețuri RO
const MAT_FARA = 'd0000000-0000-4000-8000-0000000000d2';// material fără preț RO
const NIV_SVC = 'e0000000-0000-4000-8000-0000000000e1'; // nivel cu rețetă al lui SVC
const NIV_ALT = 'e0000000-0000-4000-8000-0000000000e2'; // nivel al altui serviciu
const GUEST = 'guest-token-11c1';
const ADR_CJ = { strada: 'Str. Memorandumului 10', localitate: 'Cluj-Napoca', judet: 'Cluj', tara_cod: 'RO' };

const PRET = (pret, tara = 'RO') => [{ pret, tara_cod: tara }];
function reset() {
  const niveluriMat = [
    { id: 'nm-b', serviciu_id: MAT, nivel: 'Bronze', catalog_preturi: PRET(35) },
    { id: 'nm-s', serviciu_id: MAT, nivel: 'Silver', catalog_preturi: PRET(50) },
    { id: 'nm-g', serviciu_id: MAT, nivel: 'Gold', catalog_preturi: PRET(70) },
  ];
  DB.tabele = {
    profiles: [{ id: U, email: 'client@example.com', roles: ['client'] }, { id: ALT, email: 'alt@example.com', roles: ['client'] }],
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
    geo_regiuni: [['B', 'București'], ['CJ', 'Cluj'], ['IF', 'Ilfov'], ['IS', 'Iași'], ['SB', 'Sibiu']]
      .map(([cod, denumire], i) => ({ id: 'g' + i, tara_cod: 'RO', cod, denumire, ordine: i + 1 }))
      .concat([{ id: 'gm', tara_cod: 'MD', cod: 'CU', denumire: 'Chișinău', ordine: 1 }]),
    catalog_servicii: [
      { id: SVC, id_serviciu: 'montaj-tablou-electric', titlu: 'Montaj tablou electric', categorie: 'servicii', status_public: true, unitate_masura: 'buc' },
      { id: SVC_B, id_serviciu: 'reparatie-garnituri-calorifer', titlu: 'Reparație garnituri calorifer', categorie: 'servicii', status_public: true, unitate_masura: 'interv.' },
      { id: INCH, id_serviciu: 'inch-scule', titlu: 'Închiriere scule', categorie: 'inchirieri', status_public: true, unitate_masura: 'zi' },
      { id: MAT, id_serviciu: 'mat-parchet', titlu: 'Parchet laminat 8 mm', categorie: 'materiale', status_public: true, unitate_masura: 'm²', domeniu: 'Pardoseli', catalog_niveluri: niveluriMat },
      { id: MAT_FARA, id_serviciu: 'mat-fara-pret', titlu: 'Material fără preț', categorie: 'materiale', status_public: true, unitate_masura: 'buc', catalog_niveluri: [{ id: 'nf', nivel: 'Bronze', catalog_preturi: PRET(10, 'MD') }] },
    ],
    catalog_niveluri: niveluriMat.concat([
      { id: 'nf', serviciu_id: MAT_FARA, nivel: 'Bronze', catalog_preturi: PRET(10, 'MD') },
      { id: NIV_SVC, serviciu_id: SVC, nivel: 'Gold' },
      { id: NIV_ALT, serviciu_id: SVC_B, nivel: 'Gold' },
    ]),
    partener_servicii_active: [
      { partener_id: 'p1', catalog_serviciu_id: SVC, activ: true },
      { partener_id: 'p2', catalog_serviciu_id: SVC_B, activ: true },
      { partener_id: 'p3', catalog_serviciu_id: SVC, activ: false },
    ],
    parteneri_disponibilitate: [
      { partener_id: 'p1', status_live: 'disponibil', tara_cod: 'RO', judete: ['CJ'] },
      { partener_id: 'p2', status_live: 'disponibil', tara_cod: 'RO', judete: ['B-ILFOV'] },
      { partener_id: 'p3', status_live: 'disponibil', tara_cod: 'RO', judete: ['IS'] },
    ],
    marketplace_materiale: [], marketplace_echipamente: [],
    cos_multi_itemi: [],
  };
  REGIUNE._golesteCache();
  DB.coloane = { cos_multi_itemi: ['id', 'client_id', 'sesiune_token', 'configurare', 'creat_la'] };
  DB.implicite = { comenzi: { moneda: 'RON' }, cos_multi_itemi: { creat_la: '2026-11-03T10:00:00Z' } };
  DB.rpc = { cripteaza_camp: async ({ valoare }) => 'cripta:' + Buffer.from(valoare).toString('base64') };
  DB.utilizatori = { 'tok-u': { id: U, email: 'client@example.com' }, 'tok-alt': { id: ALT, email: 'alt@example.com' } };
  RETETA.regiuni = [];
}

let ok = 0, esec = 0;
async function test(nume, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + nume); }
  catch (e) { esec++; console.log('  ✗ ' + nume + ' — ' + e.message); }
}
function egal(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(c, m) { if (!c) throw new Error(m || 'condiție falsă'); }

async function cheama(api, { token = null, metoda = 'POST', body = null, query = {} } = {}) {
  const res = raspuns();
  await api(cerere({ metoda, token, body, query }), res);
  return res;
}
const disp = (body) => cheama(apiDisp, { body });
const adauga = (configurare, { token = null, sesiune = GUEST } = {}) => cheama(apiCos, { token, body: Object.assign({ configurare }, token ? {} : { sesiune_token: sesiune }) });
const cos = () => DB.tabele.cos_multi_itemi;
const SERVICIU = (x = {}) => Object.assign({ tip: 'serviciu', slug: 'montaj-tablou-electric', titlu: 'Montaj tablou electric', adresa_prestare: ADR_CJ }, x);
const PF = { tip: 'pf', prenume: 'Ana', nume: 'Albu' };
const comanda = (body, token = 'tok-u') => cheama(apiCreeaza, { token, body: Object.assign({ adresa: 'Str. Memorandumului 10, Cluj-Napoca, Cluj', tara_cod: 'RO', regiune: 'Cluj', localitate: 'Cluj-Napoca', valoare_totala: 500, date_facturare: PF }, body) });
function formaComuna(corp, numeCamp) {
  adevarat(corp && corp.ok === false && corp.mesaj && corp.mesaj.ro && corp.mesaj.en, 'forma comună, RO + EN: ' + JSON.stringify(corp));
  if (numeCamp) egal([corp.camp, corp.campuri[0] && corp.campuri[0].camp], [numeCamp, numeCamp], 'câmpul');
}

async function testeServer() {
  console.log('A. Disponibilitatea la adresă (server)');
  await test('câmpuri lipsă → 400 pe câmpul corect (strada, localitate, judet), forma comună RO + EN', async () => {
    reset();
    for (const [lipsa, camp] of [['strada', 'strada'], ['localitate', 'localitate'], ['judet', 'judet']]) {
      const r = await disp({ slug: 'montaj-tablou-electric', adresa: Object.assign({}, ADR_CJ, { [lipsa]: '' }) });
      egal(r.statusCode, 400, lipsa);
      formaComuna(r.corp, camp);
    }
    const r = await disp({ slug: 'montaj-tablou-electric' });
    egal([r.statusCode, r.corp.camp], [400, 'strada'], 'fără adresă');
  });
  await test('județ necunoscut → 400 REGIUNE_NECUNOSCUTA pe judet; serviciu necunoscut / material → 404 pe serviciu', async () => {
    reset();
    const r = await disp({ slug: 'montaj-tablou-electric', adresa: Object.assign({}, ADR_CJ, { judet: 'Atlantida' }) });
    egal([r.statusCode, r.corp.cod, r.corp.camp], [400, 'REGIUNE_NECUNOSCUTA', 'judet']);
    const r2 = await disp({ slug: 'inventat-de-mana', adresa: ADR_CJ });
    egal([r2.statusCode, r2.corp.cod, r2.corp.camp], [404, 'SERVICIU_NECUNOSCUT', 'serviciu']);
    formaComuna(r2.corp, 'serviciu');
    egal((await disp({ slug: 'mat-parchet', adresa: ADR_CJ })).statusCode, 404, 'un material nu trece prin verificarea de prestare');
  });
  await test('fără parteneri activi în județ → disponibil:false, motiv fara_parteneri, mesaj RO + EN; partenerul inactiv nu contează', async () => {
    reset();
    const r = await disp({ slug: 'montaj-tablou-electric', adresa: Object.assign({}, ADR_CJ, { localitate: 'Iași', judet: 'Iași' }) });
    egal([r.statusCode, r.corp.ok, r.corp.disponibil, r.corp.motiv], [200, true, false, 'fara_parteneri']);
    adevarat(r.corp.mesaj.ro.includes('parteneri') && r.corp.mesaj.en.includes('partners'), 'mesajul explică motivul');
    const r2 = await disp({ slug: 'inch-scule', adresa: ADR_CJ });
    egal([r2.corp.disponibil, r2.corp.motiv], [false, 'fara_parteneri'], 'închiriere fără parteneri');
  });
  await test('țară fără checkout activ → disponibil:false, motiv tara_inactiva', async () => {
    reset();
    const r = await disp({ slug: 'montaj-tablou-electric', adresa: { strada: 'Str. Ștefan cel Mare 1', localitate: 'Chișinău', judet: 'CU', tara_cod: 'MD' } });
    egal([r.corp.disponibil, r.corp.motiv], [false, 'tara_inactiva']);
  });
  await test('partener în zonă → disponibil:true, zona cu codul județului; fără rețetă: preț și transport null (nu 0)', async () => {
    reset();
    const r = await disp({ slug: 'montaj-tablou-electric', adresa: ADR_CJ });
    egal([r.statusCode, r.corp.disponibil, r.corp.zona.regiune, r.corp.zona.judet, r.corp.serviciu.id], [200, true, 'CJ', 'Cluj', SVC]);
    egal([r.corp.pret_final, r.corp.transport], [null, null]);
  });
  await test('regula București-Ilfov: partener cu B-ILFOV → disponibil pentru o adresă din Ilfov și din București', async () => {
    reset();
    for (const judet of ['Ilfov', 'București']) {
      const r = await disp({ slug: 'reparatie-garnituri-calorifer', adresa: Object.assign({}, ADR_CJ, { localitate: 'Voluntari', judet }) });
      egal(r.corp.disponibil, true, judet);
    }
  });
  await test('nivel cu rețetă → preț final și transport calculate cu județul adresei; nivelul altui serviciu se ignoră', async () => {
    reset();
    const r = await disp({ serviciu_id: SVC, adresa: ADR_CJ, nivel_id: NIV_SVC, cantitate: 2 });
    adevarat(r.corp.disponibil && r.corp.pret_final > 0 && typeof r.corp.transport === 'number', JSON.stringify(r.corp));
    egal(RETETA.regiuni, ['CJ'], 'județul trimis la rețetă');
    const r2 = await disp({ serviciu_id: SVC, adresa: ADR_CJ, nivel_id: NIV_ALT });
    egal([r2.corp.disponibil, r2.corp.pret_final], [true, null]);
  });

  console.log('B. Coșul de pe server (api/client/cos-multi.js)');
  await test('serviciu fără adresă → 400 pe strada; în afara zonei → 409 SERVICIU_INDISPONIBIL; în coș nu intră nimic', async () => {
    reset();
    const r1 = await adauga(SERVICIU({ adresa_prestare: null }));
    egal(r1.statusCode, 400);
    formaComuna(r1.corp, 'strada');
    const r2 = await adauga(SERVICIU({ adresa_prestare: Object.assign({}, ADR_CJ, { judet: 'Sibiu', localitate: 'Sibiu' }) }));
    egal([r2.statusCode, r2.corp.cod, r2.corp.motiv], [409, 'SERVICIU_INDISPONIBIL', 'fara_parteneri']);
    formaComuna(r2.corp, 'adresa_prestare');
    const r3 = await adauga(SERVICIU({ slug: 'inventat' }));
    egal([r3.statusCode, r3.corp.camp], [404, 'serviciu']);
    const r4 = await adauga({ tip: 'inchiriere', slug: 'inch-scule', adresa_prestare: ADR_CJ });
    egal(r4.statusCode, 409, 'închirierea urmează regula serviciilor');
    egal(cos().length, 0, 'coșul gol');
  });
  await test('serviciu cu adresa în zonă → 200; rândul are zona verificată de server (cod județ, adresa, transport), nu ce a trimis pagina', async () => {
    reset();
    const r = await adauga(SERVICIU({ regiune: 'Altceva', addr: 'scris de pagină', verificare: { disponibil: true, pret_final: 1 } }));
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    egal(cos().length, 1);
    const c = cos()[0].configurare;
    egal([cos()[0].sesiune_token, c.tip, c.serviciu_id, c.regiune, c.localitate, c.tara_cod], [GUEST, 'serviciu', SVC, 'CJ', 'Cluj-Napoca', 'RO']);
    egal(c.addr, 'Str. Memorandumului 10, Cluj-Napoca, Cluj');
    egal([c.verificare.disponibil, c.verificare.pret_final], [true, null], 'verificarea e a serverului');
  });
  await test('cont conectat: rândul e pe client_id; GET vede doar coșul propriu', async () => {
    reset();
    egal((await adauga(SERVICIU(), { token: 'tok-u' })).statusCode, 200);
    egal((await adauga(SERVICIU())).statusCode, 200);
    const g = await cheama(apiCos, { metoda: 'GET', token: 'tok-u' });
    egal([g.corp.itemi.length, cos()[0].client_id, cos()[0].sesiune_token || null], [1, U, null]);
    const gv = await cheama(apiCos, { metoda: 'GET', query: { sesiune_token: GUEST } });
    egal(gv.corp.itemi.length, 1);
    const fara = await cheama(apiCos, { metoda: 'GET' });
    egal(fara.statusCode, 400);
    formaComuna(fara.corp);
  });
  await test('material direct: cantitate 1, nivelul cel mai ieftin cu preț, fără adresă', async () => {
    reset();
    const r = await adauga({ tip: 'material', slug: 'mat-parchet', titlu: 'Parchet' });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    const c = cos()[0].configurare;
    egal([c.tip, c.sursa, c.serviciu_id, c.qty, c.nivel, c.pret_unitar, c.niveluri.length, c.adresa_prestare], ['material', 'catalog', MAT, 1, 'Bronze', 35, 3, undefined]);
  });
  await test('material inexistent → 404 pe serviciu_id; fără preț în țară → 409; cantitate greșită → 400 pe qty; tip necunoscut → 400', async () => {
    reset();
    const r1 = await adauga({ tip: 'material', slug: 'cablu-scris-de-mana' });
    egal([r1.statusCode, r1.corp.cod, r1.corp.camp], [404, 'MATERIAL_INDISPONIBIL', 'serviciu_id']);
    formaComuna(r1.corp, 'serviciu_id');
    egal((await adauga({ tip: 'material', serviciu_id: MAT_FARA })).statusCode, 409);
    egal((await adauga({ tip: 'material', slug: 'mat-parchet', qty: 0 })).corp.camp, 'qty');
    egal((await adauga({ tip: 'material', slug: 'mat-parchet', nivel: 'Diamant' })).corp.camp, 'nivel');
    egal((await adauga({ tip: 'oricum' })).corp.camp, 'tip');
    egal(cos().length, 0);
  });
  await test('PATCH: cantitatea și nivelul unui material (preț recitit de pe server); serviciu → 400; alt coș → 404', async () => {
    reset();
    const id = (await adauga({ tip: 'material', slug: 'mat-parchet' })).corp.item.id;
    const p1 = await cheama(apiCos, { metoda: 'PATCH', query: { id, sesiune_token: GUEST }, body: { qty: 12 } });
    egal([p1.statusCode, cos()[0].configurare.qty], [200, 12]);
    const p2 = await cheama(apiCos, { metoda: 'PATCH', query: { id, sesiune_token: GUEST }, body: { nivel: 'Gold', pret_unitar: 1 } });
    egal([p2.statusCode, cos()[0].configurare.nivel, cos()[0].configurare.pret_unitar], [200, 'Gold', 70]);
    const p3 = await cheama(apiCos, { metoda: 'PATCH', query: { id, sesiune_token: GUEST }, body: { qty: 2.5 } });
    egal([p3.statusCode, p3.corp.camp], [400, 'qty']);
    egal((await cheama(apiCos, { metoda: 'PATCH', query: { id, sesiune_token: 'alt-vizitator' }, body: { qty: 2 } })).statusCode, 404);
    const sid = (await adauga(SERVICIU())).corp.item.id;
    egal((await cheama(apiCos, { metoda: 'PATCH', query: { id: sid, sesiune_token: GUEST }, body: { qty: 2 } })).corp.cod, 'DOAR_MATERIALE');
  });
  await test('DELETE: un rând al coșului propriu; alt coș nu-l poate șterge', async () => {
    reset();
    const id = (await adauga({ tip: 'material', slug: 'mat-parchet' })).corp.item.id;
    await cheama(apiCos, { metoda: 'DELETE', query: { id, sesiune_token: 'alt-vizitator' } });
    egal(cos().length, 1);
    egal((await cheama(apiCos, { metoda: 'DELETE', query: { id, sesiune_token: GUEST } })).statusCode, 200);
    egal(cos().length, 0);
  });
  await test('preia_sesiune: coșul vizitatorului trece pe cont (client_id, fără token); fără cont → 401; rândurile altui cont rămân', async () => {
    reset();
    await adauga(SERVICIU());
    await adauga({ tip: 'material', slug: 'mat-parchet' });
    await adauga({ tip: 'material', slug: 'mat-parchet' }, { token: 'tok-alt' });
    const r0 = await cheama(apiCos, { body: { preia_sesiune: GUEST } });
    egal(r0.statusCode, 401);
    formaComuna(r0.corp);
    const r = await cheama(apiCos, { token: 'tok-u', body: { preia_sesiune: GUEST } });
    egal([r.statusCode, r.corp.mutate], [200, 2]);
    egal(cos().filter((x) => x.client_id === U && !x.sesiune_token).length, 2);
    egal(cos().filter((x) => x.client_id === ALT).length, 1);
    egal((await cheama(apiCos, { metoda: 'GET', token: 'tok-u' })).corp.itemi.length, 2);
  });
  await test('api/client/cos.js (copia veche, al doilea coș) → 410 în forma comună', async () => {
    const r = await cheama(apiCosVechi, { metoda: 'POST', body: { configurare: {} } });
    egal(r.statusCode, 410);
    formaComuna(r.corp);
  });

  console.log('C. Checkout pe server (api/comenzi/creeaza.js)');
  await test('fără adresă sau adresă doar din spații → 400 ADRESA_LIPSA pe adresa, forma comună', async () => {
    reset();
    for (const adresa of [undefined, '   ']) {
      const r = await comanda({ adresa });
      egal([r.statusCode, r.corp.cod], [400, 'ADRESA_LIPSA']);
      formaComuna(r.corp, 'adresa');
    }
    egal(DB.tabele.comenzi.length, 0);
  });
  await test('fără datele clientului (tip PF / firmă) → 400 pe date_facturare; date incomplete → câmpul lor', async () => {
    reset();
    const r = await comanda({ date_facturare: null });
    egal(r.statusCode, 400);
    formaComuna(r.corp, 'date_facturare');
    egal((await comanda({ date_facturare: { tip: 'pf', prenume: 'Ana' } })).corp.camp, 'nume');
    egal(DB.tabele.comenzi.length, 0);
  });
  await test('altă metodă de plată decât ordinul de plată → 400 pe metoda_plata; fără cont → 401', async () => {
    reset();
    const r = await comanda({ metoda_plata: 'card' });
    egal(r.statusCode, 400);
    formaComuna(r.corp, 'metoda_plata');
    egal((await comanda({}, null)).statusCode, 401);
    egal((await comanda({})).statusCode, 200, 'cu toate datele, comanda trece');
  });
  await test('materiale din catalog fără serviciu (cu nivel) → comandă cu prețul calculat pe server; fără nivel → 400', async () => {
    reset();
    const r = await comanda({ valoare_totala: undefined, produse_marketplace: [{ id: MAT, qty: 10, nivel: 'Gold', pret: 1 }] });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    const c = DB.tabele.comenzi[0];
    egal([c.addon_materiale_selectate[0].nivel, c.addon_materiale_selectate[0].pret_unitar, c.suma_materiale], ['Gold', 70, 700]);
    adevarat(c.suma_totala_platita > 700, 'cu taxe și TVA');
    egal((await comanda({ valoare_totala: undefined, produse_marketplace: [{ id: MAT, qty: 1 }] })).statusCode, 400, 'fără nivel');
    egal((await comanda({ valoare_totala: undefined, produse_marketplace: [{ id: INCH, qty: 1, nivel: 'Gold' }] })).statusCode, 400, 'o închiriere nu trece ca material');
  });
  await test('marketplace-produse (POST): prețul materialelor din coș, același ca la comandă', async () => {
    reset();
    const r = await cheama(apiMp, { body: { produse: [{ id: MAT, qty: 10, nivel: 'Gold' }], tara_cod: 'RO' } });
    egal([r.statusCode, r.corp.disponibil, r.corp.itemi[0].id], [200, true, MAT], JSON.stringify(r.corp));
    const c = await comanda({ valoare_totala: undefined, produse_marketplace: [{ id: MAT, qty: 10, nivel: 'Gold' }] });
    egal(c.corp.comanda.suma_totala_platita, r.corp.pret_final);
    egal((await cheama(apiMp, { body: { produse: [{ id: MAT, qty: 1 }] } })).statusCode, 400, 'fără nivel');
  });

  console.log('D. mydarrin-serviciu.html (pagina veche)');
  await test('redirect permanent spre catalog (vercel.json); pagina nu mai are prețuri, devize sau alert()', async () => {
    const v = JSON.parse(fs.readFileSync(path.join(RADACINA, 'vercel.json'), 'utf8'));
    for (const sursa of ['/mydarrin-serviciu', '/mydarrin-serviciu.html']) {
      const r = (v.redirects || []).find((x) => x.source === sursa);
      adevarat(r && r.destination === '/mydarrin-catalog' && r.permanent === true, sursa);
    }
    const html = fs.readFileSync(path.join(RADACINA, 'mydarrin-serviciu.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    adevarat(!/alert\(|\d+\s*Lei|calorifer/i.test(html), 'conținut vechi rămas');
  });
  await test('nicio legătură rămasă: sitemap, lista SEO, accesul temporar, superadmin, paginile publice', async () => {
    const fisiere = ['api/public/sitemap.xml.js', 'lib/seo-pagini.js', 'api/admin/creeaza-acces-temporar.js', 'mydarrin-superadmin.html']
      .concat(fs.readdirSync(RADACINA).filter((f) => f.endsWith('.html') && f !== 'mydarrin-serviciu.html'));
    const cu = fisiere.filter((f) => /mydarrin-serviciu(\.html)?['"?#]/.test(fs.readFileSync(path.join(RADACINA, f), 'utf8')));
    egal(cu, [], 'fișiere cu legătura veche');
  });
  await test('niciun coș local rămas: cartItems / sertarul vechi lipsesc din catalog și din paginile de categorie', async () => {
    for (const f of ['mydarrin-catalog.html', 'mydarrin-categorie-servicii.html', 'mydarrin-categorie-materiale.html', 'mydarrin-categorie-inchirieri.html']) {
      const s = fs.readFileSync(path.join(RADACINA, f), 'utf8');
      adevarat(!/cartItems|id="cart-drawer"|PLATFORM_PCT/.test(s), f);
      adevarat(s.includes('src="cos-indicator.js"'), f + ': cos-indicator.js');
    }
  });
}

// ── E. Paginile în Chromium ─────────────────────────────────────────────
const PAGINI_COS = ['index', 'servicii-urgente', 'despre-noi', 'afla-ce-facem', 'mydarrin-contact', 'mydarrin-catalog',
  'mydarrin-categorie-servicii.html?type=servicii&cat=instalatii-electrice', 'mydarrin-categorie-materiale', 'mydarrin-categorie-inchirieri',
  'mydarrin-marketplace', 'mydarrin-marketplace-materiale', 'mydarrin-produs.html?slug=montaj-tablou-electric&type=serviciu',
  'mydarrin-checkout', 'mydarrin-cos', 'mydarrin-creeaza-deviz', 'mydarrin-cum-functioneaza', 'cum-comanzi', 'cum-platesc',
  'cum-programez-serviciu', 'cum-prestam-livram', 'intrebari-frecvente-clienti', 'intrebari-frecvente-parteneri',
  'garantii-si-asigurari', 'ghidul-asiguratorului', 'reclamatii', 'mydarrin-devino-partener', 'cum-devii-partenerul-nostru',
  'cum-devii-curier-de-cartier', 'cum-devii-furnizor-materiale', 'cum-devii-operator-inchirieri', 'mydarrin-termeni',
  'mydarrin-politica-confidentialitate'];
const PAGINI_CHEIE = ['index', 'mydarrin-catalog', 'mydarrin-categorie-materiale', 'mydarrin-marketplace-materiale',
  'mydarrin-produs.html?slug=montaj-tablou-electric&type=serviciu', 'mydarrin-cos', 'mydarrin-checkout'];
const url = (p) => '/' + (p.includes('.html') ? p : p + '.html');

async function testeBrowser() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { esec++; console.log('  ✗ Playwright lipsește'); return; }
  const { porneste } = require('./server-test');
  const CAPTURI = process.env.CAPTURI ? path.resolve(process.env.CAPTURI) : null;
  if (CAPTURI) fs.mkdirSync(CAPTURI, { recursive: true });

  const API = {
    '/api/public/disponibilitate-adresa': apiDisp,
    '/api/client/cos-multi': apiCos,
    '/api/comenzi/creeaza': apiCreeaza,
    '/api/public/marketplace-produse': apiMp,
    '/api/public/geo-regiuni': apiGeo,
    '/api/public/tari-active': async (req, res) => res.status(200).json({ ok: true, active: ['RO'], tari: [{ tara_cod: 'RO', tara_nume: 'România' }], tva: { RO: 21 } }),
    '/api/cont/profil': async (req, res) => res.status(200).json({ ok: true, email: 'client@example.com', nume: 'Ana Albu', roles: ['client'], roluri_dashboard: ['client'], partener: null, investitor: null }),
  };
  // Catalogul citește direct din Supabase (REST): materialul de test, restul gol.
  const REST = (u) => {
    if (/catalog_servicii\?categorie=eq\.materiale/.test(u)) return [{ id: MAT, id_serviciu: 'mat-parchet', titlu: 'Parchet laminat 8 mm', domeniu: 'Pardoseli', unitate_masura: 'm²', descriere: 'Parchet pentru test', imagini: [] }];
    return [];
  };

  // Sesiunea simulată: clientul Supabase al paginii (account-system.js nu-l poate înlocui).
  function sesiune(user) {
    const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
    const ses = user ? { access_token: 'tok-u', user } : null;
    const client = {
      auth: {
        getUser: async () => ({ data: { user }, error: null }),
        getSession: async () => ({ data: { session: ses }, error: null }),
        onAuthStateChange: (cb) => { setTimeout(() => cb(ses ? 'INITIAL_SESSION' : 'INITIAL_SESSION', ses), 50); return { data: { subscription: { unsubscribe() {} } } }; },
        signOut: async () => ({ error: null }),
      },
      from: () => lant({ data: [], error: null, count: 0 }), rpc: () => lant({ data: null, error: null }), storage: { from: () => lant({ data: null, error: null }) }, channel: () => lant({}), removeChannel: () => {},
    };
    const auth = new Proxy({ getCurrentUser: async () => user, getUserRoles: async () => (user ? user.roles : []), hasRole: async () => false, performLogout: () => {} }, { get: (t, k) => (k in t ? t[k] : async () => null) });
    const fix = (n, v) => Object.defineProperty(window, n, { configurable: true, get: () => v, set: () => {} });
    fix('supabaseClient', client); fix('MyDarrinAuth', auth);
  }

  async function context(browser, latime, { lang = 'ro', user = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 720 ? 844 : 900 }, hasTouch: latime < 720 });
    await ctx.addInitScript((l) => {
      try {
        localStorage.setItem('myd_lang_v1', l);
        localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
      } catch (e) {}
    }, lang);
    await ctx.addInitScript(sesiune, user);
    await ctx.route(/\.supabase\.co\/rest\/v1\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REST(r.request().url())) }));
    await ctx.route(/\.supabase\.co\/(?!rest\/v1\/)/, (r) => r.abort());
    await ctx.route(/\/api\//, async (r) => {
      const req = r.request();
      const u = new URL(req.url());
      let corp = null; try { corp = JSON.parse(req.postData() || 'null'); } catch (e) { corp = null; }
      const api = API[u.pathname];
      if (!api) return r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"API unavailable on the test server"}' });
      const res = raspuns();
      await api(cerere({ metoda: req.method(), token: (req.headers().authorization || '').replace('Bearer ', '') || null, body: corp, query: Object.fromEntries(u.searchParams) }), res);
      return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp || {}) });
    });
    return ctx;
  }
  async function pagina(ctx, adresa) {
    const pg = await ctx.newPage();
    pg.setDefaultTimeout(8000);
    pg.erori = [];
    pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 200)));
    if (process.env.DEPANARE) pg.on('console', (m) => console.log('    [consola] ' + m.text().slice(0, 200)));
    await pg.goto(baza + adresa, { waitUntil: 'load' });
    await pg.waitForTimeout(400);
    return pg;
  }
  const captura = async (pg, nume) => { if (CAPTURI) await pg.screenshot({ path: path.join(CAPTURI, nume + '.png') }).catch(() => {}); };
  const numarAntet = (pg) => pg.$eval('[data-cos-link] [data-cos-numar]', (e) => (getComputedStyle(e).display === 'none' ? 0 : Number(e.textContent)));
  const depasire = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const tokenVizitator = (pg) => pg.evaluate(() => localStorage.getItem('myd_guest_token'));

  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const latime of (process.env.LATIMI || '390,1366').split(',').map(Number)) {
      console.log(`E. Fluxul coșului în pagini (${latime}px)`);
      reset();
      const ctx = await context(browser, latime);
      const PRODUS = url('mydarrin-produs.html?slug=montaj-tablou-electric&type=serviciu');

      await test(`${latime}: serviciu → configurare: fără adresă butonul e blocat, cu explicație; pasul 2 nu se deschide; nimic în coș`, async () => {
        const pg = await pagina(ctx, PRODUS);
        await pg.waitForFunction(() => document.querySelectorAll('#adr-judet option').length > 1);
        egal(await pg.$eval('#btn-adauga-cos', (b) => b.disabled), true, 'buton blocat');
        adevarat((await pg.textContent('#btn-adauga-cos-motiv')).includes('adresa de prestare'), 'explicația');
        await pg.evaluate(() => completeStep(1));
        egal(await pg.evaluate(() => S.curStep), 1, 'rămâne la pasul 1');
        await pg.evaluate(() => adaugaInCosDinConfigurare(document.getElementById('btn-adauga-cos')));
        await pg.waitForTimeout(300);
        egal(cos().length, 0, 'coșul');
        egal(await numarAntet(pg), 0, 'insigna ascunsă la 0');
        egal(pg.erori, [], 'erori JS');
        await pg.close();
      });

      await test(`${latime}: adresă în afara zonei → mesaj roșu cu motivul, butonul rămâne blocat; în zonă activă → verde, se adaugă, antetul arată 1`, async () => {
        const pg = await pagina(ctx, PRODUS);
        await pg.waitForFunction(() => document.querySelectorAll('#adr-judet option').length > 1);
        await pg.selectOption('#adr-judet', 'IS');
        await pg.fill('#adr-localitate', 'Iași');
        await pg.fill('#addr-input', 'Str. Lăpușneanu 10');
        await pg.waitForSelector('#adr-disponibilitate.adr-eroare');
        adevarat((await pg.textContent('#adr-disponibilitate')).includes('parteneri'), 'motivul');
        egal(await pg.$eval('#btn-adauga-cos', (b) => b.disabled), true, 'blocat în afara zonei');
        await captura(pg, `produs-in-afara-zonei-${latime}`);
        await pg.selectOption('#adr-judet', 'CJ');
        await pg.fill('#adr-localitate', 'Cluj-Napoca');
        await pg.waitForSelector('#adr-disponibilitate.adr-ok');
        egal(await pg.$eval('#btn-adauga-cos', (b) => b.disabled), false, 'deblocat');
        egal(await pg.textContent('#btn-adauga-cos-motiv'), '', 'fără motiv de blocare');
        await pg.click('#btn-adauga-cos');
        await pg.waitForSelector('.md-toast-succes');
        adevarat(await pg.$('.md-toast-succes a.md-toast-actiune[href="mydarrin-cos.html"]'), '„Vezi coșul” în toast');
        await pg.waitForFunction(() => document.querySelector('[data-cos-link] [data-cos-numar]').textContent === '1');
        egal(await numarAntet(pg), 1, 'antetul');
        egal(cos().length, 1);
        const c = cos()[0];
        egal([c.sesiune_token === (await tokenVizitator(pg)), c.configurare.regiune, c.configurare.tip], [true, 'CJ', 'serviciu']);
        egal(await depasire(pg), 0, 'derulare orizontală');
        await captura(pg, `produs-adaugat-${latime}`);
        egal(pg.erori, [], 'erori JS');
        await pg.close();
      });

      await test(`${latime}: material din catalog → direct în coș, fără configurare (pagina nu se schimbă), antetul arată 2`, async () => {
        const pg = await pagina(ctx, '/mydarrin-catalog.html');
        await pg.waitForSelector('[data-slug="mat-parchet"] button.card-cta', { state: 'attached' });
        const inainte = pg.url();
        await pg.$eval('[data-slug="mat-parchet"] button.card-cta', (b) => b.click());
        await pg.waitForSelector('.md-toast-succes');
        await pg.waitForTimeout(300);
        egal(pg.url(), inainte, 'fără navigare spre configurare');
        const m = cos().find((x) => x.configurare.tip === 'material');
        adevarat(m, 'materialul în coș');
        egal([m.configurare.qty, m.configurare.nivel, m.configurare.serviciu_id], [1, 'Bronze', MAT]);
        await pg.waitForFunction(() => document.querySelector('[data-cos-link] [data-cos-numar]').textContent === '2');
        await captura(pg, `catalog-material-adaugat-${latime}`);
        egal(pg.erori, [], 'erori JS');
        await pg.close();
      });

      await test(`${latime}: coșul — serviciul cu adresa verificată, materialul cu cantitate (PATCH) și totalul de pe server; „Finalizează” → checkout`, async () => {
        const pg = await pagina(ctx, '/mydarrin-cos.html');
        await pg.waitForSelector('.item[data-tip="serviciu"]');
        adevarat((await pg.textContent('.item[data-tip="serviciu"]')).includes('Cluj-Napoca'), 'adresa');
        await pg.waitForFunction(() => /\d/.test(document.getElementById('total-materiale').textContent));
        const total1 = await pg.textContent('#total-materiale');
        await pg.fill('.item[data-tip="material"] input[type="number"]', '4');
        await pg.press('.item[data-tip="material"] input[type="number"]', 'Tab');
        await pg.waitForFunction(() => document.querySelector('.md-toast-succes'));
        await pg.waitForFunction((t) => /\d/.test(document.getElementById('total-materiale').textContent) && document.getElementById('total-materiale').textContent !== t, total1);
        egal(cos().find((x) => x.configurare.tip === 'material').configurare.qty, 4, 'cantitatea pe server');
        egal(await depasire(pg), 0, 'derulare orizontală');
        await captura(pg, `cos-${latime}`);
        await Promise.all([pg.waitForURL(/mydarrin-checkout/), pg.click('#btn-materiale')]);
        const cfg = await pg.evaluate(() => JSON.parse(sessionStorage.getItem('myd_checkout_config')));
        egal([cfg.tip_comanda, cfg.materiale[0].id, cfg.materiale[0].nivel, cfg.materiale[0].qty, cfg.cos_itemi_ids.length], ['marketplace', MAT, 'Bronze', 4, 1]);
        await pg.waitForTimeout(300);
        egal(await pg.$eval('#cos-gol', (e) => getComputedStyle(e).display), 'none', 'checkout cu produsele, nu gol');
        egal(pg.erori, [], 'erori JS');
        await pg.close();
      });

      await test(`${latime}: vizitator cu coș → conectare → coșul e pe cont; după comandă rândurile ies din coș`, async () => {
        const pg0 = await pagina(ctx, '/index.html');
        const token = await tokenVizitator(pg0);
        await pg0.close();
        adevarat(token, 'tokenul de vizitator');
        const ctxCont = await context(browser, latime, { user: { id: U, email: 'client@example.com', roles: ['client'] } });
        await ctxCont.addInitScript((t) => { try { if (!sessionStorage.getItem('_t')) { localStorage.setItem('myd_guest_token', t); sessionStorage.setItem('_t', '1'); } } catch (e) {} }, token);
        const pg = await pagina(ctxCont, '/index.html');
        await pg.waitForFunction(() => document.querySelector('[data-cos-link] [data-cos-numar]').textContent === '2');
        egal(cos().filter((x) => x.client_id === U && !x.sesiune_token).length, 2, 'rândurile pe cont');
        egal(await tokenVizitator(pg), null, 'tokenul de vizitator șters');
        const mat = cos().find((x) => x.configurare.tip === 'material');
        await pg.evaluate((id) => sessionStorage.setItem('myd_checkout_config', JSON.stringify({ tip_comanda: 'marketplace', titlu: 'Materiale', materiale: [], cos_itemi_ids: [id], total: 100 })), mat.id);
        await pg.goto(baza + '/mydarrin-checkout.html', { waitUntil: 'load' });
        await pg.evaluate(() => scoateDinCosDupaComanda(MYD_CFG));
        await pg.waitForFunction(() => document.querySelector('[data-cos-link] [data-cos-numar]').textContent === '1');
        egal(cos().map((x) => x.configurare.tip), ['serviciu'], 'materialul comandat a ieșit din coș');
        egal(pg.erori, [], 'erori JS');
        await pg.close();
        await ctxCont.close();
      });

      await test(`${latime}: mydarrin-serviciu.html → redirecționare spre catalog`, async () => {
        const pg = await pagina(ctx, '/mydarrin-serviciu.html');
        await pg.waitForURL(/\/mydarrin-catalog/);
        adevarat(!/calorifer/i.test(await pg.title()), 'titlul vechi');
        await pg.close();
      });
      await ctx.close();
    }

    console.log('E2. Iconița de coș în antet');
    for (const latime of [390, 1366]) {
      reset();
      const ctx = await context(browser, latime);
      for (const p of PAGINI_COS) {
        await test(`${latime}: ${p} — iconița în antet (spre coș), ascunsă la 0, fără derulare orizontală și fără erori JS`, async () => {
          const pg = await pagina(ctx, url(p));
          await pg.waitForSelector('[data-cos-link]', { state: 'attached', timeout: 4000 });
          const r = await pg.$eval('[data-cos-link]', (a) => {
            const q = a.getBoundingClientRect();
            return { href: a.getAttribute('href'), vizibil: q.width > 20 && q.height > 20 && q.right <= innerWidth + 1 && q.left >= -1 && getComputedStyle(a).visibility !== 'hidden', inAntet: !!a.closest('header') };
          });
          egal([r.href, r.vizibil, r.inAntet], ['mydarrin-cos.html', true, true]);
          egal(await numarAntet(pg), 0, 'insigna la 0');
          egal(await depasire(pg), 0, 'derulare orizontală');
          egal(pg.erori, [], 'erori JS');
          await pg.close();
        });
      }
      await ctx.close();
    }
    for (const latime of [768, 1024]) {
      reset();
      const ctx = await context(browser, latime);
      for (const p of PAGINI_CHEIE) {
        await test(`${latime}: ${p} — iconița vizibilă, fără derulare orizontală și fără erori JS`, async () => {
          const pg = await pagina(ctx, url(p));
          await pg.waitForSelector('[data-cos-link]', { state: 'visible', timeout: 4000 });
          egal(await depasire(pg), 0, 'derulare orizontală');
          egal(pg.erori, [], 'erori JS');
          await pg.close();
        });
      }
      await ctx.close();
    }

    console.log('E3. Engleză');
    for (const latime of [390, 1366]) {
      reset();
      const ctx = await context(browser, latime, { lang: 'en' });
      await test(`${latime}: EN — adresa de prestare, butonul și explicația, coșul gol: fără text românesc`, async () => {
        const pg = await pagina(ctx, url('mydarrin-produs.html?slug=montaj-tablou-electric&type=serviciu'));
        await pg.waitForFunction(() => document.querySelectorAll('#adr-judet option').length > 1);
        await pg.waitForTimeout(500);
        const text = await pg.evaluate(() => {
          const b = document.getElementById('adresa-prestare-bloc');
          const atr = [...b.querySelectorAll('[placeholder],[aria-label]')].map((e) => (e.getAttribute('placeholder') || '') + ' ' + (e.getAttribute('aria-label') || ''));
          return [b.querySelector('label').textContent, document.getElementById('btn-adauga-cos').textContent, document.getElementById('btn-adauga-cos-motiv').textContent, document.querySelector('.link-continua').textContent, document.querySelector('#adr-judet option').textContent].concat(atr).join(' | ');
        });
        adevarat(!/[ăâîșțĂÂÎȘȚ]|Adaug|Completeaz|Strada|Localitatea|Județ|Continuă/.test(text), 'text românesc: ' + text);
        await pg.close();
        const pc = await pagina(ctx, '/mydarrin-cos.html');
        await pc.waitForSelector('#empty-state', { state: 'visible' });
        const t2 = await pc.textContent('.wrap');
        adevarat(!/[ăâîșțĂÂÎȘȚ]/.test(t2), 'coșul gol în EN: ' + t2.trim().slice(0, 120));
        await captura(pc, `cos-gol-en-${latime}`);
        await pc.close();
      });
      await ctx.close();
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
