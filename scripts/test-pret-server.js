// scripts/test-pret-server.js
// Teste pentru pasul 11-C2 (3 nov. 2026): prețul comenzii calculat doar pe
// server (lib/pret-serviciu.js), același în configurare, coș, checkout și pe
// comandă; serviciile fără preț real → „Cere un deviz” (409 FARA_PRET);
// disponibilitatea în zonă verificată și la comanda directă; paginile de
// categorie din catalogul real. Peste un Supabase simulat — nimic nu ajunge la
// producție.
//   A. api/comenzi/creeaza.js: valoare_totala / cost_* / suma_asigurare din
//      cerere se ignoră; fără nivel cu preț → 409 FARA_PRET (forma comună,
//      mesajul cerut); adresă în afara zonei → 409 SERVICIU_INDISPONIBIL pe
//      adresa; ZONA_INDISPONIBILA în forma comună, cu diacritice;
//   B. prețul afișat (calculeaza-pret-nivel) = prețul din coș (cos-multi) =
//      prețul comenzii, pentru 3 servicii fără rețetă, 1 cu rețetă, 1 închiriere
//      și 1 material; serviciu fără preț în catalog → nu intră în coș;
//   C. api/public/catalog-categorie (prețurile catalogului, pasul 11-C4): doar produse din catalog (categoria și
//      subcategoriile ei), prețul „de la” doar din catalog_preturi (niveluri
//      fără rețetă), fără preț → null; paginile fără liste scrise de mână,
//      fără Unsplash, fără prețuri în cod;
//   D. niciun răspuns public nu conține discounturile partenerilor;
//   E. paginile în Chromium: configurarea arată prețul serverului (= coș =
//      checkout = comandă); fără preț / produs în afara catalogului → „Cere un
//      deviz”, fără buton de coș; paginile de categorie la 390 / 768 / 1024 /
//      1366 px, fără derulare orizontală și fără erori JS; EN fără română.
// Capturi (opțional): CAPTURI=<folder> node scripts/test-pret-server.js
// Rulare: node scripts/test-pret-server.js   (FARA_BROWSER=1: doar A–D)

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

const U = 'a0000000-0000-4000-8000-00000000000a';
const ID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NV = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CAT = 'f0000000-0000-4000-8000-000000000001';
const CAT_SUB = 'f0000000-0000-4000-8000-000000000002';
const CAT_ALTA = 'f0000000-0000-4000-8000-000000000003';
// Serviciile de test: 3 fără rețetă (preț din catalog), 1 cu rețetă, 1 fără preț,
// 1 închiriere, 1 material, 1 serviciu din altă categorie.
const P = {
  tablou: { id: ID(1), slug: 'montaj-tablou-electric', titlu: 'Montaj tablou electric', categorie: 'servicii', cat: CAT, niveluri: [[NV(11), 'Bronze', 450], [NV(12), 'Gold', 900]] },
  priza: { id: ID(2), slug: 'montaj-priza', titlu: 'Montaj priză', categorie: 'servicii', cat: CAT_SUB, niveluri: [[NV(21), 'Bronze', 80]] },
  bec: { id: ID(3), slug: 'inlocuire-becuri-corpuri', titlu: 'Înlocuire becuri', categorie: 'servicii', cat: CAT, niveluri: [[NV(31), 'Silver', 120]] },
  reteta: { id: ID(4), slug: 'montaj-parchet-laminat', titlu: 'Montaj parchet laminat', categorie: 'servicii', cat: CAT_ALTA, niveluri: [[NV(41), 'Gold', 999]] },
  faraPret: { id: ID(5), slug: 'serviciu-fara-pret', titlu: 'Testare instalație electrică', categorie: 'servicii', cat: CAT, niveluri: [[NV(51), 'Bronze', null]] },
  scule: { id: ID(6), slug: 'inch-scule', titlu: 'Închiriere scule', categorie: 'inchirieri', cat: CAT_ALTA, niveluri: [[NV(61), 'Bronze', 60]] },
  parchet: { id: ID(7), slug: 'mat-parchet', titlu: 'Parchet laminat 8 mm', categorie: 'materiale', cat: CAT_ALTA, niveluri: [[NV(71), 'Bronze', 35], [NV(72), 'Gold', 70]] },
};
const RETETA_NIVEL = NV(41);
const REGIUNI_RETETA = [];
const modulReteta = require(path.join(RADACINA, 'lib/calculeaza-cost-recipe.js'));
modulReteta.calculeazaCostNivel = async ({ nivelId, regiune, cantitate = 1 }) => {
  if (nivelId !== RETETA_NIVEL) return { nivel_id: nivelId, cost_baza_servicii: 0, cost_materiale: 0, cost_utilaj: 0, articole: [], resurse_fara_pret: [{ motiv: 'niciun_articol_legat_de_nivel' }] };
  REGIUNI_RETETA.push(regiune);
  return { nivel_activ: true, resurse_fara_pret: [], cost_baza_servicii: 300 * cantitate, cost_materiale: 40 * cantitate, cost_utilaj: 0, manopera_per_esco: {}, defalcare_cost_baza: null };
};

const REGIUNE = require(path.join(RADACINA, 'lib/regiune.js'));
const apiPret = require(path.join(RADACINA, 'api/public/calculeaza-pret-nivel.js'));
const apiCos = require(path.join(RADACINA, 'api/client/cos-multi.js'));
const apiCreeaza = require(path.join(RADACINA, 'api/comenzi/creeaza.js'));
const apiMp = require(path.join(RADACINA, 'api/public/marketplace-produse.js'));
const apiCat = require(path.join(RADACINA, 'api/public/catalog-categorie.js'));
const apiCatalog = require(path.join(RADACINA, 'api/public/catalog.js'));
const apiDisp = require(path.join(RADACINA, 'api/public/disponibilitate-adresa.js'));
const apiGeo = require(path.join(RADACINA, 'api/public/geo-regiuni.js'));

const ADR = { strada: 'Str. Memorandumului 10', localitate: 'Cluj-Napoca', judet: 'Cluj', tara_cod: 'RO' };
const GUEST = 'guest-11c2';

function reset() {
  const servicii = Object.values(P).map((p) => ({
    id: p.id, id_serviciu: p.slug, titlu: p.titlu, categorie: p.categorie, status_public: true, unitate_masura: p.categorie === 'materiale' ? 'm²' : 'buc',
    categorie_id: p.cat === CAT_SUB ? CAT : p.cat, subcategorie_id: p.cat === CAT_SUB ? CAT_SUB : null, imagini: p === P.tablou ? ['https://exemplu.supabase.co/storage/v1/object/public/catalog/tablou.webp'] : [],
    descriere: 'Descriere din catalog', cod_esco: null,
    catalog_niveluri: p.niveluri.map(([id, nivel, pret]) => ({ id, nivel, catalog_preturi: pret == null ? [] : [{ pret, tara_cod: 'RO' }] })),
  }));
  DB.tabele = {
    profiles: [{ id: U, email: 'client@example.com', roles: ['client'] }],
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
    geo_regiuni: [['B', 'București'], ['CJ', 'Cluj'], ['IF', 'Ilfov'], ['IS', 'Iași']]
      .map(([cod, denumire], i) => ({ id: 'g' + i, tara_cod: 'RO', cod, denumire, ordine: i + 1 })),
    categorii: [
      { id: CAT, slug: 'instalatii-electrice', title: 'Instalații electrice', title_en: 'Electrical installations', description: 'Lucrări electrice', icon_name: 'zap', parent_id: null, traduceri: { en: { description: 'Electrical work' } } },
      { id: CAT_SUB, slug: 'prize-intrerupatoare', title: 'Prize și întrerupătoare', title_en: 'Sockets and switches', icon_name: 'plug', parent_id: CAT },
      { id: CAT_ALTA, slug: 'alta', title: 'Altă categorie', icon_name: 'box', parent_id: null },
    ],
    catalog_relatii: [], // pasul 11-C10: /api/public/catalog citește și relațiile
    catalog_servicii: servicii,
    catalog_niveluri: Object.values(P).flatMap((p) => p.niveluri.map(([id, nivel, pret]) => ({ id, serviciu_id: p.id, nivel, catalog_preturi: pret == null ? [] : [{ pret, tara_cod: 'RO' }] }))),
    catalog_preturi: Object.values(P).flatMap((p) => p.niveluri.filter(([, , pret]) => pret != null).map(([id, , pret]) => ({ nivel_id: id, pret, tara_cod: 'RO' }))),
    devize_articole: [{ articol_id: 'art-1', catalog_nivel_id: RETETA_NIVEL }],
    partener_servicii_active: [P.tablou, P.priza, P.bec, P.reteta, P.faraPret, P.scule].map((p, i) => ({ partener_id: 'p' + i, catalog_serviciu_id: p.id, activ: true })),
    parteneri_disponibilitate: [0, 1, 2, 3, 4, 5].map((i) => ({ partener_id: 'p' + i, status_live: 'disponibil', tara_cod: 'RO', judete: ['CJ'] })),
    // Un discount de partener (privat): nu trebuie să apară în niciun răspuns public.
    partener_discounturi: [{ partener_id: 'p0', categorie: 'servicii', discount_pct: 11 }],
    marketplace_materiale: [], marketplace_echipamente: [],
    cos_multi_itemi: [],
  };
  REGIUNE._golesteCache();
  DB.coloane = {};
  DB.implicite = { comenzi: { moneda: 'RON' }, cos_multi_itemi: { creat_la: '2026-11-03T10:00:00Z' } };
  DB.rpc = { cripteaza_camp: async ({ valoare }) => 'cripta:' + valoare.length };
  DB.utilizatori = { 'tok-u': { id: U, email: 'client@example.com' } };
  REGIUNI_RETETA.length = 0;
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
function formaComuna(corp, numeCamp) {
  adevarat(corp && corp.ok === false && corp.mesaj && corp.mesaj.ro && corp.mesaj.en, 'forma comună, RO + EN: ' + JSON.stringify(corp));
  if (numeCamp) egal([corp.camp, corp.campuri[0] && corp.campuri[0].camp], [numeCamp, numeCamp], 'câmpul');
}
const nivel = (p, i = 0) => p.niveluri[i][0];
const pretAfisat = async (p, { qty = 1, i = 0, addon = [] } = {}) => (await cheama(apiPret, { body: { nivel_id: nivel(p, i), cantitate: qty, tara_cod: 'RO', regiune: 'Cluj', addon_materiale: addon } })).corp;
const comanda = (body) => cheama(apiCreeaza, { token: 'tok-u', body: Object.assign({
  adresa: 'Str. Memorandumului 10, Cluj-Napoca, Cluj', tara_cod: 'RO', regiune: 'Cluj', localitate: 'Cluj-Napoca',
  date_facturare: { tip: 'pf', prenume: 'Ana', nume: 'Albu' }, metoda_plata: 'ordin_plata',
}, body) });
const adaugaServiciu = (p, { qty = 1, i = 0, adresa = ADR } = {}) => cheama(apiCos, { body: { sesiune_token: GUEST, configurare: { tip: p.categorie === 'inchirieri' ? 'inchiriere' : 'serviciu', slug: p.slug, nivel_id: nivel(p, i), cantitate: qty, adresa_prestare: adresa } } });
const MESAJ_FARA_PRET = { ro: 'Acest serviciu nu are încă un preț fix. Cere un deviz.', en: 'This service does not have a fixed price yet. Ask for a quote.' };

async function testeServer() {
  console.log('A. Prețul comenzii, doar pe server (api/comenzi/creeaza.js)');
  await test('valoare_totala / cost_* / suma_asigurare trimise de browser se ignoră: prețul salvat e cel calculat pe server', async () => {
    reset();
    const asteptat = (await pretAfisat(P.tablou, { qty: 2 })).pret_final;
    const r = await comanda({ nivel_id: nivel(P.tablou), cantitate: 2, valoare_totala: 1, suma_asigurare: 0.5, cost_baza_servicii: 1, cost_asigurare: 0, cost_materiale: 0, cost_chirie_scule: 0 });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    const c = DB.tabele.comenzi[0];
    egal([c.suma_totala_platita, c.suma_manopera], [asteptat, 900]);
    adevarat(asteptat > 900, 'cu taxele platformei și TVA');
  });
  await test('fără nivel (doar valoare_totala / cost_*) → 409 FARA_PRET în forma comună, mesajul cerut; nicio comandă', async () => {
    reset();
    for (const body of [{ valoare_totala: 500 }, { cost_baza_servicii: 400, cost_asigurare: 4 }, {}]) {
      const r = await comanda(body);
      egal([r.statusCode, r.corp.cod], [409, 'FARA_PRET'], JSON.stringify(body));
      formaComuna(r.corp, 'nivel_id');
      egal(r.corp.mesaj, MESAJ_FARA_PRET);
    }
    egal(DB.tabele.comenzi.length, 0);
  });
  await test('nivel fără preț în catalog (și fără rețetă) → 409 FARA_PRET; nivel necunoscut → 409 NIVEL_NECUNOSCUT', async () => {
    reset();
    const r = await comanda({ nivel_id: nivel(P.faraPret) });
    egal([r.statusCode, r.corp.cod, r.corp.mesaj], [409, 'FARA_PRET', MESAJ_FARA_PRET]);
    formaComuna(r.corp, 'nivel_id');
    egal((await comanda({ nivel_id: NV(999) })).corp.cod, 'NIVEL_NECUNOSCUT');
    egal(DB.tabele.comenzi.length, 0);
  });
  await test('comandă directă cu adresa în afara zonei → 409 SERVICIU_INDISPONIBIL pe adresa', async () => {
    reset();
    const r = await comanda({ nivel_id: nivel(P.tablou), regiune: 'Iași', localitate: 'Iași', adresa: 'Str. Lăpușneanu 10, Iași, Iași' });
    egal([r.statusCode, r.corp.cod, r.corp.motiv], [409, 'SERVICIU_INDISPONIBIL', 'fara_parteneri']);
    formaComuna(r.corp, 'adresa');
    egal(DB.tabele.comenzi.length, 0);
  });
  await test('ZONA_INDISPONIBILA: forma comună, cu diacritice, RO + EN (code păstrat)', async () => {
    reset();
    const r = await comanda({ nivel_id: nivel(P.tablou), tara_cod: 'MD', regiune: null });
    egal([r.statusCode, r.corp.cod, r.corp.code], [403, 'ZONA_INDISPONIBILA', 'ZONA_INDISPONIBILA']);
    formaComuna(r.corp, 'tara_cod');
    adevarat(/ă|ț|î|ș/.test(r.corp.mesaj.ro) && /area/.test(r.corp.mesaj.en), 'diacritice / EN');
  });

  console.log('B. Același preț: configurare = coș = checkout = comandă');
  const cazuri = [['fără rețetă: tablou (Gold, 3 buc)', P.tablou, { i: 1, qty: 3 }], ['fără rețetă: priză', P.priza, { qty: 5 }], ['fără rețetă: becuri', P.bec, {}],
    ['cu rețetă: parchet laminat (12 m²)', P.reteta, { qty: 12 }], ['închiriere: scule (4 zile)', P.scule, { qty: 4 }]];
  for (const [nume, p, opt] of cazuri) {
    await test(`${nume}: afișat = coș = comandă`, async () => {
      reset();
      const afisat = await pretAfisat(p, opt);
      adevarat(afisat.disponibil && afisat.pret_final > 0, JSON.stringify(afisat));
      const c = await adaugaServiciu(p, opt);
      egal(c.statusCode, 200, JSON.stringify(c.corp));
      egal(c.corp.item.configurare.verificare.pret_final, afisat.pret_final, 'coșul');
      const d = await cheama(apiDisp, { body: { serviciu_id: p.id, adresa: ADR, nivel_id: nivel(p, opt.i || 0), cantitate: opt.qty || 1 } });
      egal(d.corp.pret_final, afisat.pret_final, 'verificarea din configurare');
      const r = await comanda({ nivel_id: nivel(p, opt.i || 0), cantitate: opt.qty || 1, valoare_totala: 1 });
      egal(r.statusCode, 200, JSON.stringify(r.corp));
      egal(DB.tabele.comenzi[0].suma_totala_platita, afisat.pret_final, 'comanda');
      if (p === P.reteta) egal(afisat.sursa, 'reteta');
      else egal(afisat.sursa, 'catalog');
    });
  }
  await test('material (Gold, 10 m²): coș (total de pe server) = comandă', async () => {
    reset();
    const c = await cheama(apiCos, { body: { sesiune_token: GUEST, configurare: { tip: 'material', slug: P.parchet.slug, nivel: 'Gold', qty: 10 } } });
    egal(c.statusCode, 200, JSON.stringify(c.corp));
    const total = await cheama(apiMp, { body: { produse: [{ id: P.parchet.id, qty: 10, nivel: 'Gold' }], tara_cod: 'RO' } });
    const afisat = await cheama(apiPret, { body: { nivel_id: nivel(P.parchet, 1), cantitate: 10, tara_cod: 'RO' } });
    egal(afisat.corp.pret_final, total.corp.pret_final, 'configurarea materialului = totalul din coș');
    const r = await comanda({ produse_marketplace: [{ id: P.parchet.id, qty: 10, nivel: 'Gold' }], valoare_totala: 1 });
    egal([r.statusCode, DB.tabele.comenzi[0].suma_totala_platita], [200, total.corp.pret_final]);
  });
  await test('serviciu fără preț în catalog: afișare → disponibil:false, motiv fara_pret (fără cifră); coșul → 409 FARA_PRET; fără nivel → 409', async () => {
    reset();
    const a = await pretAfisat(P.faraPret);
    egal([a.disponibil, a.motiv, a.pret_final], [false, 'fara_pret', undefined]);
    const c = await adaugaServiciu(P.faraPret);
    egal([c.statusCode, c.corp.cod], [409, 'FARA_PRET']);
    formaComuna(c.corp, 'nivel_id');
    const c2 = await cheama(apiCos, { body: { sesiune_token: GUEST, configurare: { tip: 'serviciu', slug: P.tablou.slug, adresa_prestare: ADR } } });
    egal([c2.statusCode, c2.corp.cod], [409, 'FARA_PRET'], 'fără nivel_id');
    egal(DB.tabele.cos_multi_itemi.length, 0);
  });

  console.log('C. Paginile de categorie — catalogul real');
  await test('catalog-categorie: doar produsele categoriei și ale subcategoriilor, din catalog; tipul paginii respectat', async () => {
    reset();
    const r = await cheama(apiCat, { metoda: 'GET', query: { cat: 'instalatii-electrice', tip: 'servicii', tara: 'RO' } });
    egal(r.statusCode, 200);
    egal(r.corp.produse.map((p) => p.slug).sort(), ['inlocuire-becuri-corpuri', 'montaj-priza', 'montaj-tablou-electric', 'serviciu-fara-pret']);
    egal([r.corp.categorie.title, r.corp.categorie.title_en, r.corp.categorie.icon_name], ['Instalații electrice', 'Electrical installations', 'zap']);
    egal((await cheama(apiCat, { metoda: 'GET', query: { cat: 'instalatii-electrice', tip: 'materiale' } })).corp.produse, [], 'materialele altei categorii');
    egal((await cheama(apiCat, { metoda: 'GET', query: { cat: 'inexistenta', tip: 'servicii' } })).corp.produse, [], 'categorie inexistentă → gol');
  });
  await test('prețul „de la” doar din catalog_preturi: cel mai mic nivel, cu formula publică, pe unitate; fără preț → null; imaginea doar din catalog', async () => {
    reset();
    const r = await cheama(apiCat, { metoda: 'GET', query: { cat: 'instalatii-electrice', tip: 'servicii' } });
    const dupa = Object.fromEntries(r.corp.produse.map((p) => [p.slug, p]));
    adevarat(dupa['montaj-priza'].pret_de_la > 80, 'priză, cu taxe și TVA');
    egal(dupa['montaj-priza'].pret_de_la, (await pretAfisat(P.priza)).pret_final, 'priză = configurarea');
    adevarat(dupa['montaj-tablou-electric'].pret_de_la === (await pretAfisat(P.tablou)).pret_final, 'tablou = configurarea la nivelul cel mai ieftin');
    egal(dupa['serviciu-fara-pret'].pret_de_la, null);
    egal([dupa['montaj-tablou-electric'].imagine.includes('supabase'), dupa['montaj-priza'].imagine], [true, null]);
    egal(r.corp.pret_maxim, Math.ceil(Math.max(...r.corp.produse.map((p) => p.pret_de_la).filter((x) => x != null))));
    const ret = await cheama(apiCat, { metoda: 'GET', query: { cat: 'alta', tip: 'servicii' } });
    egal(ret.corp.produse.find((p) => p.slug === 'montaj-parchet-laminat').pret_de_la, null, 'nivel cu rețetă: fără preț din catalog_preturi');
  });
  // Pasul 11-C4: paginile de categorie trimit spre catalog (înainte: citeau catalogul
  // prin categorie-catalog.js, acum șters); catalogul ia prețurile din același endpoint.
  await test('paginile de categorie: doar redirecționare spre catalog, fără liste, prețuri sau Unsplash; catalogul citește prețurile din /api/public/catalog', async () => {
    for (const f of ['mydarrin-categorie-servicii.html', 'mydarrin-categorie-materiale.html', 'mydarrin-categorie-inchirieri.html']) {
      const s = fs.readFileSync(path.join(RADACINA, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      adevarat(!/unsplash/i.test(s) && !/const SUBCATEGORY_DB|price\s*:\s*\d/.test(s), f + ': conținut vechi');
      adevarat(s.includes("location.replace('/mydarrin-catalog?"), f + ': redirecționarea');
    }
    adevarat(fs.readFileSync(path.join(RADACINA, 'mydarrin-catalog.html'), 'utf8').includes("'/api/public/catalog?tara='"), 'sursa prețurilor din catalog');
  });

  console.log('D. Discounturile partenerilor nu apar în răspunsurile publice');
  await test('calculeaza-pret-nivel, disponibilitate-adresa, catalog-categorie, marketplace-produse, cos-multi: fără „discount”', async () => {
    reset();
    const raspunsuri = [
      await pretAfisat(P.tablou), await pretAfisat(P.reteta),
      (await cheama(apiDisp, { body: { serviciu_id: P.tablou.id, adresa: ADR, nivel_id: nivel(P.tablou) } })).corp,
      (await cheama(apiCat, { metoda: 'GET', query: { cat: 'instalatii-electrice', tip: 'servicii' } })).corp,
      (await cheama(apiCatalog, { metoda: 'GET', query: { tara: 'RO', lang: 'ro' } })).corp,
      (await cheama(apiMp, { body: { produse: [{ id: P.parchet.id, qty: 1, nivel: 'Bronze' }] } })).corp,
      (await adaugaServiciu(P.tablou)).corp,
      (await cheama(apiCos, { metoda: 'GET', query: { sesiune_token: GUEST } })).corp,
    ];
    raspunsuri.forEach((x, i) => adevarat(!/discount/i.test(JSON.stringify(x)), 'răspunsul ' + i + ': ' + JSON.stringify(x).slice(0, 200)));
  });
}

// ── E. Paginile în Chromium ─────────────────────────────────────────────
async function testeBrowser() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { esec++; console.log('  ✗ Playwright lipsește'); return; }
  const { porneste } = require('./server-test');
  const CAPTURI = process.env.CAPTURI ? path.resolve(process.env.CAPTURI) : null;
  if (CAPTURI) fs.mkdirSync(CAPTURI, { recursive: true });
  const API = {
    '/api/public/calculeaza-pret-nivel': apiPret, '/api/client/cos-multi': apiCos, '/api/comenzi/creeaza': apiCreeaza,
    '/api/public/marketplace-produse': apiMp, '/api/public/catalog-categorie': apiCat, '/api/public/catalog': apiCatalog, '/api/public/disponibilitate-adresa': apiDisp,
    '/api/public/geo-regiuni': apiGeo,
    '/api/public/servicii-cu-reteta': async (req, res) => res.status(200).json({ ok: true, servicii: [{ id_serviciu: P.reteta.slug, serviciu_id: P.reteta.id }] }),
    '/api/public/tari-active': async (req, res) => res.status(200).json({ ok: true, active: ['RO'], tari: [{ tara_cod: 'RO', tara_nume: 'România' }], tva: { RO: 21 } }),
  };
  // Supabase REST (citirile directe ale paginii de configurare), din baza simulată: filtre „eq.”.
  function rest(url) {
    const u = new URL(url);
    const tabel = u.pathname.split('/').pop();
    let rows = (DB.tabele[tabel] || []).slice();
    u.searchParams.forEach((v, k) => {
      if (['select', 'order', 'limit', 'offset'].includes(k)) return;
      const m = String(v).match(/^eq\.(.*)$/);
      if (m) rows = rows.filter((r) => String(r[k]) === m[1]);
    });
    return rows.map((r) => { const c = Object.assign({}, r); delete c.catalog_niveluri; return c; });
  }
  async function context(browser, latime, lang = 'ro') {
    const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 720 ? 844 : 900 }, hasTouch: latime < 720 });
    await ctx.addInitScript((l) => { try { localStorage.setItem('myd_lang_v1', l); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), marketing: false, versiune: 2 })); } catch (e) {} }, lang);
    await ctx.route(/\.supabase\.co\/rest\/v1\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rest(r.request().url())) }));
    await ctx.route(/\.supabase\.co\/(?!rest\/v1\/)/, (r) => r.abort());
    await ctx.route(/ipapi\.co|nominatim/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    // Imaginea din catalog (storage): un pixel, ca să se încarce.
    await ctx.route(/supabase\.co\/storage\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
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
    await pg.goto(baza + adresa, { waitUntil: 'load' });
    await pg.waitForTimeout(400);
    return pg;
  }
  const captura = async (pg, nume) => { if (CAPTURI) await pg.screenshot({ path: path.join(CAPTURI, nume + '.png'), fullPage: false }).catch(() => {}); };
  const depasire = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const latime of [390, 1366]) {
      console.log(`E. Configurare → coș → checkout → comandă (${latime}px)`);
      reset();
      const ctx = await context(browser, latime);
      await test(`${latime}: serviciu fără rețetă — prețul din configurare = coș = checkout = comandă`, async () => {
        const pg = await pagina(ctx, `/mydarrin-produs.html?slug=${P.tablou.slug}&type=serviciu`);
        await pg.waitForFunction(() => typeof S !== "undefined" && S.pilotMode && S.total > 0);
        const config = await pg.evaluate(() => S.total);
        egal(config, (await pretAfisat(P.tablou)).pret_final, 'configurarea = serverul');
        egal(await pg.$eval('#cos-deviz', (e) => e.hidden), true, 'fără caseta de deviz');
        await pg.waitForFunction(() => document.querySelectorAll('#adr-judet option').length > 1);
        await pg.selectOption('#adr-judet', 'CJ');
        await pg.fill('#adr-localitate', 'Cluj-Napoca');
        await pg.fill('#addr-input', 'Str. Memorandumului 10');
        await pg.waitForSelector('#adr-disponibilitate.adr-ok');
        await pg.click('#btn-adauga-cos');
        await pg.waitForSelector('.md-toast-succes');
        const rand = DB.tabele.cos_multi_itemi[0];
        egal(rand.configurare.verificare.pret_final, config, 'coșul');
        await captura(pg, `produs-pret-server-${latime}`);
        egal(pg.erori, [], 'erori JS');
        await pg.close();

        const pc = await pagina(ctx, '/mydarrin-cos.html');
        await pc.waitForSelector('.item[data-tip="serviciu"] .item-price');
        await Promise.all([pc.waitForURL(/mydarrin-checkout/), pc.click('.item[data-tip="serviciu"] .btn-cta')]);
        await pc.waitForFunction(() => typeof PRET_SERVER !== 'undefined' && PRET_SERVER.stare === 'ok');
        const checkout = await pc.evaluate(() => PRET_SERVER.pret);
        egal(checkout, config, 'checkout-ul');
        const cfg = await pc.evaluate(() => MYD_CFG);
        const r = await comanda({ nivel_id: cfg.nivel_id, cantitate: cfg.cantitate, valoare_totala: 1, cost_baza_servicii: 1 });
        egal([r.statusCode, DB.tabele.comenzi[0].suma_totala_platita], [200, config], 'comanda');
        egal(pc.erori, [], 'erori JS');
        await pc.close();
      });
      await test(`${latime}: serviciu fără preț în catalog → „Prețul se stabilește prin deviz” și „Cere un deviz”, fără buton de coș și fără cifră`, async () => {
        const pg = await pagina(ctx, `/mydarrin-produs.html?slug=${P.faraPret.slug}&type=serviciu`);
        await pg.waitForSelector('#cos-deviz:not([hidden])');
        egal(await pg.$eval('#btn-adauga-cos', (b) => getComputedStyle(b).display), 'none');
        adevarat((await pg.getAttribute('#btn-cere-deviz', 'href')).startsWith('mydarrin-creeaza-deviz.html?descriere='), 'legătura spre deviz');
        adevarat(!/\d/.test(await pg.textContent('#s-total')), 'fără cifră: ' + await pg.textContent('#s-total'));
        await captura(pg, `produs-deviz-${latime}`);
        egal(pg.erori, [], 'erori JS');
        await pg.close();
      });
      await test(`${latime}: produs care nu e în catalog (tabelele vechi ale paginii) → doar „Cere un deviz”, fără prețuri`, async () => {
        const pg = await pagina(ctx, '/mydarrin-produs.html?slug=inlocuire-calorifer&type=serviciu');
        await pg.waitForSelector('#cos-deviz:not([hidden])');
        const preturi = await pg.evaluate(() => [...document.querySelectorAll('#s-total, #dv-total, #tier-detail-price, [id^="price-"]')].map((e) => e.textContent).join(' | '));
        adevarat(!/\d/.test(preturi), 'cifre rămase: ' + preturi);
        egal(await pg.$eval('#tier-section', (e) => getComputedStyle(e).display), 'none');
        egal(pg.erori, [], 'erori JS');
        await pg.close();
      });
      await ctx.close();
    }

    // Pasul 11-C4: paginile de categorie trimit spre catalogul filtrat — aceleași
    // verificări, pe catalog (înainte: pe mydarrin-categorie-servicii.html).
    console.log('E2. Catalogul filtrat pe categorie');
    for (const latime of [390, 768, 1024, 1366]) {
      reset();
      const ctx = await context(browser, latime);
      await test(`${latime}: catalogul, categoria Instalații electrice — produsele din catalog, „de la” = prețul de configurare, fără preț → deviz; fără derulare orizontală și fără erori JS`, async () => {
        const pg = await pagina(ctx, '/mydarrin-catalog.html?categorie=servicii&subcategorie=instalatii-electrice');
        await pg.waitForFunction(() => window.FILTRU_SUBCATEGORIE && document.querySelectorAll('#grid-servicii .db-card').length > 0);
        await pg.waitForTimeout(300);
        const carduri = await pg.$$eval('#grid-servicii .db-card', (c) => c.filter((x) => x.offsetParent !== null).map((x) => [x.dataset.slug, x.querySelector('.price-val') ? x.querySelector('.price-val').textContent.trim() : null, x.querySelector('.card-price').textContent]));
        egal(carduri.map((c) => c[0]).sort(), ['inlocuire-becuri-corpuri', 'montaj-priza', 'montaj-tablou-electric', 'serviciu-fara-pret']);
        const priza = await pg.evaluate((v) => (typeof window.formatCurrency === 'function' ? window.formatCurrency(v) : Math.round(v).toLocaleString('ro-RO') + ' Lei'), (await pretAfisat(P.priza)).pret_final);
        egal(carduri.find((c) => c[0] === 'montaj-priza')[1], priza, 'priză = configurarea');
        const fara = carduri.find((c) => c[0] === 'serviciu-fara-pret');
        adevarat(fara[1] === null && /deviz/.test(fara[2]), 'fără preț: ' + fara[2]);
        egal(await depasire(pg), 0, 'derulare orizontală');
        await captura(pg, `catalog-categorie-${latime}`);
        egal(pg.erori, [], 'erori JS');
        await pg.close();
      });
      await ctx.close();
    }
    reset();
    const ctx = await context(browser, 1366);
    await test('catalog: „Adaugă în coș” la un serviciu → configurarea, fără să adauge nimic', async () => {
      const pg = await pagina(ctx, '/mydarrin-catalog.html?categorie=servicii&subcategorie=instalatii-electrice');
      await pg.waitForSelector('[data-slug="montaj-priza"] .card-cta', { state: 'attached' });
      await Promise.all([pg.waitForURL(/mydarrin-produs\.html\?slug=montaj-priza&type=serviciu/), pg.$eval('[data-slug="montaj-priza"] .card-cta', (b) => b.click())]);
      egal(DB.tabele.cos_multi_itemi.length, 0);
      await pg.close();
    });
    await ctx.close();

    console.log('E3. Engleză');
    for (const latime of [390, 1366]) {
      reset();
      const ce = await context(browser, latime, 'en');
      await test(`${latime}: EN — „Ask for a quote”, catalogul filtrat (eticheta și prețurile) fără text românesc`, async () => {
        const pg = await pagina(ce, `/mydarrin-produs.html?slug=${P.faraPret.slug}&type=serviciu`);
        await pg.waitForSelector('#cos-deviz:not([hidden])');
        await pg.waitForTimeout(400);
        const t = await pg.textContent('#cos-deviz');
        adevarat(/Ask for a quote/.test(t) && !/[ăâîșț]|deviz/i.test(t), t);
        await pg.close();
        const pc = await pagina(ce, '/mydarrin-catalog.html?categorie=servicii&subcategorie=instalatii-electrice');
        await pc.waitForFunction(() => window.FILTRU_SUBCATEGORIE && !document.getElementById('filtru-subcategorie').hidden);
        await pc.waitForTimeout(400);
        adevarat((await pc.textContent('#filtru-subcategorie')).includes('Electrical installations'), 'eticheta categoriei');
        const preturi = await pc.$$eval('#grid-servicii .db-card .card-price, #grid-servicii .db-card .card-cta', (e) => e.map((x) => x.textContent).join(' | '));
        adevarat(!/[ăâîșț]|Adaug|Preț/.test(preturi), preturi);
        await captura(pc, `catalog-categorie-en-${latime}`);
        await pc.close();
      });
      await ce.close();
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
