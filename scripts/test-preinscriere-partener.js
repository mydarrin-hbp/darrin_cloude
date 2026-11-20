// scripts/test-preinscriere-partener.js
// Pasul 12-P1 (17 nov. 2026): pre-înscrierea partenerului în 60 de secunde și
// panoul „cont nou” (machetele B1.1–B1.5).
//   A. Server, fără browser:
//      - stareContPartener (lib/activare-partener.js): cont nou (1/6), profil
//        incomplet, în verificare, necesită completări (firmă / document respins,
//        cu motiv), activ;
//      - /api/public/profesii: ocupațiile clasificate din competente_esco, slug,
//        NACE, denumirea în engleză;
//      - regulile din server neschimbate: accept-comanda refuză partenerul
//        neaprobat, fără IBAN sau fără contract;
//      - rutele: vercel.json și middleware.js, /parteneri/inscriere.
//   B. Browser (Playwright), 390 și 1366 px, RO și EN:
//      - pagina: câmpurile obligatorii (MDFeedback.aplicaErori), profesia
//        preselectată din ?profesie=instalator, ascunsă la Materiale, ?lang=ro,
//        UTM-ul ajuns la înregistrare;
//      - înregistrarea trimite rol_solicitat corect pentru cele 5 categorii;
//      - ecranul de cod: lipirea, temporizatorul, „Deschide Gmail” doar la @gmail.com;
//      - după cod: panoul „cont nou”, nu pasul „Firma”; datele pre-înscrierii în
//        ciorna activării și precompletate la „Profesii”;
//      - stările în panou; rândurile deschid pașii în orice ordine și revin în panou;
//      - butoanele „Devino partener” (vizitator) și „Partener” din fereastră → /parteneri/inscriere;
//      - un singur buton portocaliu pe ecran; fără depășiri; 0 erori JS.
// Pasul 12-P2 (20 nov. 2026): categoria principală din arborele unic, în locul profesiei.
//   A'. Server: /api/public/categorii (doar principalele active, pe tip, RO / EN,
//       ?profesie= → categoria cu același NACE); valideazaPreinscriere (inexistentă,
//       inactivă, subcategorie, alt tip → refuzate; „Altceva” + text curățat; curier /
//       asigurări fără categorie); API-ul ciornei (400 cu câmpul categorie_id, ce se
//       salvează, salvarea automată neblocată, DELETE păstrează categoria); portofoliul
//       contului nou (categoria aleasă primele, 403 fără rol); back-office.
//   B. Browser: lista se schimbă cu tipul, „Altceva”, câmpul lipsă la curier / asigurări,
//       ?domeniu= / ?profesie= / ?type=, eroarea sub câmp, lista indisponibilă, categoria
//       refuzată de server după cont (salvată ca „Altceva”), „Ce lucrări faci” în panou.
// Nimic nu ajunge la Supabase sau la producție (clientul Supabase e simulat în pagină).
// Cu --capturi <dosar>: capturile „după”, la 390 px, RO și EN (docs/capturi-12p2/).
// Cu --doar-server: doar partea A.
// Rulare: node scripts/test-preinscriere-partener.js [--capturi <dosar>] [--doar-server]

const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
const { stareContPartener } = require(path.join(RADACINA, 'lib/activare-partener.js'));
const apiProfesii = require(path.join(RADACINA, 'api/public/profesii.js'));
const apiAccept = require(path.join(RADACINA, 'api/partener/accept-comanda.js'));
// Pasul 12-P2: categoria principală din arborele unic.
const RL = require(path.join(RADACINA, 'lib/rate-limit.js'));
RL._seteazaKv({ incr: async () => 1, expire: async () => 1, ttl: async () => 60 });
const CI = require(path.join(RADACINA, 'lib/categorii-inscriere.js'));
const apiCategorii = require(path.join(RADACINA, 'api/public/categorii.js'));
const apiCiorna = require(path.join(RADACINA, 'api/partener/activare-ciorna.js'));
const apiPortofoliu = require(path.join(RADACINA, 'api/partener/portofoliu.js'));
const apiParteneriLista = require(path.join(RADACINA, 'api/admin/parteneri-lista.js'));
const { corpEroare } = require(path.join(RADACINA, 'lib/raspuns-eroare.js'));

const arg = process.argv.slice(2);
const iCap = arg.indexOf('--capturi');
const CAPTURI = iCap !== -1 ? arg[iCap + 1] : null;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A. Server ─────────────────────────────────────────────────────────────
const PASI = ['firma', 'cont_bancar', 'profesii', 'dotari', 'documente', 'contract'];
const act = (o, extra) => ({ rol: 'partener_servicii', tip: 'servicii', mod_activare: !extra || !extra.rol, verificare: (extra && extra.verificare) || null, activ: !!(extra && extra.activ), complet: false, pasi: PASI.map((c) => ({ cheie: c, stare: o[c] })) });
const NOU = { firma: 'de_completat', cont_bancar: 'blocat', profesii: 'blocat', dotari: 'blocat', documente: 'blocat', contract: 'blocat' };
const INCOMPLET = { firma: 'in_verificare', cont_bancar: 'de_completat', profesii: 'de_completat', dotari: 'de_completat', documente: 'de_completat', contract: 'dupa_verificare' };
const VERIFICARE = { firma: 'in_verificare', cont_bancar: 'completat', profesii: 'completat', dotari: 'completat', documente: 'in_verificare', contract: 'dupa_verificare' };
const RESPINS = { firma: 'de_completat', cont_bancar: 'completat', profesii: 'completat', dotari: 'completat', documente: 'completat', contract: 'dupa_verificare' };
const ACTIV = { firma: 'completat', cont_bancar: 'completat', profesii: 'completat', dotari: 'completat', documente: 'completat', contract: 'completat' };

async function testeServer() {
  let s = stareContPartener(act(NOU));
  verifica(s.stare === 'profil_incomplet' && s.pasi_facuti === 1 && s.urmatorul === 'firma' && s.randuri.length === 6 && s.randuri[0].stare === 'facut', `A1 cont nou: ${JSON.stringify(s)}`);
  verifica(s.randuri.filter((r) => r.stare === 'blocat').length === 4, 'A1 cont nou: pașii de după firmă așteaptă firma');
  s = stareContPartener(act(INCOMPLET, { verificare: 'pending_review', rol: 1 }));
  verifica(s.stare === 'profil_incomplet' && s.pasi_facuti === 2 && s.urmatorul === 'cont_bancar', `A2 profil incomplet: ${s.stare} ${s.pasi_facuti} ${s.urmatorul}`);
  s = stareContPartener(act(VERIFICARE, { verificare: 'pending_review', rol: 1 }));
  verifica(s.stare === 'in_verificare' && s.pasi_facuti === 5 && s.urmatorul === null, `A3 în verificare: ${s.stare} ${s.pasi_facuti} ${s.urmatorul}`);
  s = stareContPartener(act(RESPINS, { verificare: 'rejected', rol: 1 }), { motivFirma: 'CUI-ul nu corespunde firmei.' });
  verifica(s.stare === 'necesita_completari' && s.motiv === 'CUI-ul nu corespunde firmei.' && s.urmatorul === 'firma' && s.randuri[1].stare === 'respins', `A4 firmă respinsă: ${JSON.stringify(s)}`);
  s = stareContPartener(act({ ...ACTIV, documente: 'de_completat', contract: 'de_completat' }, { verificare: 'approved', rol: 1 }), { documenteRespinse: true, motivDocumente: 'Poza e neclară.' });
  verifica(s.stare === 'necesita_completari' && s.motiv === 'Poza e neclară.' && s.urmatorul === 'documente', `A5 document respins: ${JSON.stringify(s)}`);
  s = stareContPartener(act(ACTIV, { verificare: 'approved', activ: true, rol: 1 }));
  verifica(s.stare === 'activ' && s.pasi_facuti === 6, `A6 activ: ${s.stare} ${s.pasi_facuti}`);
  verifica(stareContPartener(null) === null, 'A7 fără activare → null');

  // Profesiile
  const randuri = [
    { cod_esco: '712601', denumire: 'Instalator', denumire_en: 'Plumber (RO specific)', domeniu: 'Construcții & Renovări', nace_code: 'F 43.22' },
    { cod_esco: '7132', denumire: 'Zugravi și vopsitori', denumire_en: 'Painters and related workers', domeniu: 'Construcții & Renovări', nace_code: 'F 43.30' },
    { cod_esco: 'COR-712902', denumire: 'Pavator', denumire_en: null, domeniu: 'Construcții & Renovări', nace_code: null },
    { cod_esco: '7126.8', denumire: 'instalator/instalatoare', denumire_en: 'plumber', domeniu: 'ESCO - neclasificat', nace_code: '4322' },
  ];
  const ro = apiProfesii.profesii(randuri, 'ro');
  const en = apiProfesii.profesii(randuri, 'en');
  verifica(ro.length === 3 && !ro.some((p) => p.cod === '7126.8'), `A8 doar ocupațiile clasificate (${ro.length})`);
  const inst = ro.find((p) => p.slug === 'instalator');
  verifica(inst && inst.nace === '43.22' && inst.cod === '712601', `A9 instalator: slug, cod ESCO, NACE 43.22 (${JSON.stringify(inst)})`);
  verifica(ro.some((p) => p.slug === 'zugravi-si-vopsitori'), 'A10 slug fără diacritice');
  verifica(en.find((p) => p.slug === 'instalator').denumire === 'Plumber', 'A11 EN: „Plumber”, fără „(RO specific)”');
  verifica(en.find((p) => p.slug === 'pavator').denumire === 'Pavator', 'A12 fără EN în bază: rezerva românească (tradusă în pagină din dicționar)');
  const dict = JSON.parse(fs.readFileSync(path.join(RADACINA, 'i18n/en/mydarrin-inscriere-partener.json'), 'utf8'));
  verifica(dict._texte.Pavator === 'Paver', 'A12 „Pavator” are traducere în dicționarul paginii');
  DB.tabele = { competente_esco: randuri };
  const res = raspuns();
  await apiProfesii(cerere({ metoda: 'GET', query: { lang: 'en' } }), res);
  verifica(res.statusCode === 200 && res.corp.ok && res.corp.profesii.length === 3, `A13 GET /api/public/profesii: ${res.statusCode}`);

  // Regulile din server, neschimbate: accept-comanda refuză fără aprobare / IBAN / contract.
  const PART = (id, o) => Object.assign({ id, partner_type: 'servicii', status_verificare: 'approved', contract_semnat: true, entitate_platforma_id: null, nume_firma: 'Test SRL' }, o);
  DB.tabele = {
    partners: [PART('p-neaprobat', { status_verificare: 'pending_review' }), PART('p-fara-iban'), PART('p-fara-contract', { contract_semnat: false })],
    partner_conturi_bancare: [{ partner_id: 'p-neaprobat', activ: true }, { partner_id: 'p-fara-contract', activ: true }],
    profiles: [{ id: 'p-neaprobat', status: 'activ' }, { id: 'p-fara-iban', status: 'activ' }, { id: 'p-fara-contract', status: 'activ' }],
    comenzi: [],
  };
  DB.utilizatori = { 't-1': { id: 'p-neaprobat' }, 't-2': { id: 'p-fara-iban' }, 't-3': { id: 'p-fara-contract' } };
  for (const [tok, et] of [['t-1', 'neaprobat'], ['t-2', 'fără IBAN'], ['t-3', 'fără contract']]) {
    const r = raspuns();
    await apiAccept(cerere({ metoda: 'POST', token: tok, body: { comanda_id: 'c-1' } }), r);
    verifica(r.statusCode === 403, `A14 accept-comanda, partener ${et}: refuzat (${r.statusCode} ${r.corp && r.corp.cod})`);
  }

  // Rutele
  const vj = JSON.parse(fs.readFileSync(path.join(RADACINA, 'vercel.json'), 'utf8'));
  // Pasul 12-U1: rescrierea vine din tabelul comun (lib/adrese-curate.js), fără .html în destinație.
  verifica(vj.rewrites.some((r) => r.source === '/parteneri/inscriere' && r.destination === '/mydarrin-inscriere-partener'), 'A15 vercel.json: /parteneri/inscriere');
  const mw = fs.readFileSync(path.join(RADACINA, 'middleware.js'), 'utf8');
  verifica(/adreseCurate\.rescriere\(pathname\)/.test(mw) && require(path.join(RADACINA, 'lib/adrese-curate.js')).rescriere('/parteneri/inscriere').fisier === 'mydarrin-inscriere-partener', 'A15 middleware.js: /parteneri/inscriere');
}

// ── A'. Pasul 12-P2: categoria principală (server) ────────────────────────
const UID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CAT = {
  sanitare: UID(1), electrice: UID(2), hvac: UID(3), inactiva: UID(4), sub: UID(5),
  mat_zidarie: UID(11), mat_sanitare: UID(12), inc_utilaje: UID(21), inc_scule: UID(22),
};
// Arborele, ca în bază: category_type la singular pentru închirieri („inchiriere”).
const CATEGORII = [
  { id: CAT.hvac, slug: 'hvac-climatizare', title: 'HVAC & Climatizare', title_en: 'HVAC & Air Conditioning', traduceri: {}, category_type: 'servicii', parent_id: null, activ: true, display_order: 4, nace_ref: '43.22' },
  { id: CAT.sanitare, slug: 'instalatii-sanitare', title: 'Instalații sanitare', title_en: null, traduceri: { en: { title: 'Plumbing' } }, category_type: 'servicii', parent_id: null, activ: true, display_order: 1, nace_ref: '43.22' },
  { id: CAT.electrice, slug: 'instalatii-electrice', title: 'Instalații electrice', title_en: 'Electrical installations', traduceri: {}, category_type: 'servicii', parent_id: null, activ: true, display_order: 2, nace_ref: '43.21' },
  { id: CAT.inactiva, slug: 'retrasa', title: 'Categorie retrasă', title_en: 'Retired category', traduceri: {}, category_type: 'servicii', parent_id: null, activ: false, display_order: 3, nace_ref: null },
  { id: CAT.sub, slug: 'desfundari', title: 'Desfundări', title_en: 'Drain unblocking', traduceri: {}, category_type: 'servicii', parent_id: CAT.sanitare, activ: true, display_order: 1, nace_ref: '43.22' },
  { id: CAT.mat_zidarie, slug: 'zidarie-beton', title: 'Zidărie & Beton', title_en: 'Masonry & Concrete', traduceri: {}, category_type: 'materiale', parent_id: null, activ: true, display_order: 2, nace_ref: '47.52' },
  { id: CAT.mat_sanitare, slug: 'sanitare-termice', title: 'Sanitare & Termice', title_en: 'Plumbing & Heating', traduceri: {}, category_type: 'materiale', parent_id: null, activ: true, display_order: 1, nace_ref: '43.22' },
  { id: CAT.inc_utilaje, slug: 'utilaje-constructii', title: 'Utilaje construcții', title_en: 'Construction machinery', traduceri: {}, category_type: 'inchiriere', parent_id: null, activ: true, display_order: 1, nace_ref: null },
  { id: CAT.inc_scule, slug: 'scule-echipamente', title: 'Scule & Echipamente profesionale', title_en: 'Professional Tools & Equipment', traduceri: {}, category_type: 'inchiriere', parent_id: null, activ: true, display_order: 3, nace_ref: null },
];
const COMPETENTE = [
  { cod_esco: '712601', denumire: 'Instalator', denumire_en: 'Plumber (RO specific)', domeniu: 'Construcții & Renovări', nace_code: 'F 43.22' },
  { cod_esco: 'COR-712902', denumire: 'Pavator', denumire_en: null, domeniu: 'Construcții & Renovări', nace_code: null },
  { cod_esco: '7132', denumire: 'Zugravi și vopsitori', denumire_en: 'Painters', domeniu: 'Construcții & Renovări', nace_code: 'F 43.30' },
];
const copie = (x) => JSON.parse(JSON.stringify(x));
const arbore = () => ({ categorii: copie(CATEGORII), competente_esco: copie(COMPETENTE) });

async function testeServer12p2() {
  // P1. API-ul public: doar principalele active, pe tip, în ordine, RO / EN.
  DB.tabele = arbore();
  const get = async (query) => { const r = raspuns(); await apiCategorii(cerere({ metoda: 'GET', query }), r); return r; };
  let r = await get({ tip: 'servicii', lang: 'ro' });
  verifica(r.statusCode === 200 && r.corp.ok, `P1 GET servicii: ${r.statusCode}`);
  verifica(JSON.stringify(r.corp.categorii.map((c) => c.slug)) === JSON.stringify(['instalatii-sanitare', 'instalatii-electrice', 'hvac-climatizare']), `P1 servicii: doar principalele active, după display_order (${r.corp.categorii.map((c) => c.slug)})`);
  verifica(r.corp.categorii[0].denumire === 'Instalații sanitare' && Object.keys(r.corp.categorii[0]).sort().join() === 'denumire,id,slug', `P1 RO: denumirea și doar id / slug / denumire (${JSON.stringify(r.corp.categorii[0])})`);
  verifica(/max-age=300/.test(r.headere['Cache-Control'] || ''), `P1 cache scurt (${r.headere['Cache-Control']})`);
  r = await get({ tip: 'servicii', lang: 'en' });
  verifica(r.corp.categorii[0].denumire === 'Plumbing' && r.corp.categorii[1].denumire === 'Electrical installations', `P1 EN: traduceri.en / title_en (${r.corp.categorii.map((c) => c.denumire)})`);
  r = await get({ tip: 'materiale', lang: 'en' });
  verifica(JSON.stringify(r.corp.categorii.map((c) => c.denumire)) === JSON.stringify(['Plumbing & Heating', 'Masonry & Concrete']), `P1 materiale EN (${r.corp.categorii.map((c) => c.denumire)})`);
  r = await get({ tip: 'inchirieri', lang: 'ro' });
  verifica(r.corp.categorii.length === 2 && r.corp.categorii[0].slug === 'utilaje-constructii', `P1 închirieri: category_type „inchiriere” din bază (${r.corp.categorii.map((c) => c.slug)})`);
  r = await get({ tip: 'curier', lang: 'ro' });
  verifica(r.statusCode === 400 && r.corp.cod === 'TIP_INVALID' && r.corp.campuri[0].camp === 'tip', `P1 tip invalid → 400 cu câmpul „tip” (${r.statusCode})`);
  r = await get({ tip: 'servicii', lang: 'ro', profesie: 'instalator' });
  verifica(r.corp.profesie && r.corp.profesie.slug === 'instalator' && r.corp.profesie.categorie_id === CAT.sanitare, `P1 ?profesie=instalator → categoria cu același NACE, prima în ordine (${JSON.stringify(r.corp.profesie)})`);
  r = await get({ tip: 'servicii', lang: 'ro', profesie: 'zugravi-si-vopsitori' });
  verifica(r.corp.profesie && r.corp.profesie.categorie_id === null, `P1 profesie fără categorie legată → nimic preselectat (${JSON.stringify(r.corp.profesie)})`);
  r = await get({ tip: 'servicii', lang: 'ro', profesie: 'nu-exista' });
  verifica(r.corp.profesie === null, 'P1 profesie necunoscută → profesie: null');
  verifica(!JSON.stringify(r.corp).includes('nace') && !JSON.stringify(r.corp).includes('activ'), 'P1 fără câmpuri interne în răspuns');

  // P2. Verificarea pre-înscrierii (lib/categorii-inscriere.js).
  DB.tabele = arbore();
  const V = CI.valideazaPreinscriere;
  let v = await V({ categorie: 'servicii', oras: 'Iași', categorie_id: CAT.sanitare, categorie_denumire: 'Orice scrie clientul', profesie_slug: 'instalator' });
  verifica(v.ok && v.pre.categorie_id === CAT.sanitare && v.pre.categorie_slug === 'instalatii-sanitare' && v.pre.categorie_denumire === 'Instalații sanitare' && v.pre.categorie_denumire_en === 'Plumbing' && v.pre.categorie_altceva === false && v.pre.categorie_text === null, `P2 servicii, categorie validă: denumirile din bază (${JSON.stringify(v.pre)})`);
  verifica(v.ok && v.pre.profesie_slug === 'instalator' && v.pre.nace === '43.22' && v.pre.oras === 'Iași', `P2 profesia din reclamă păstrată ca indiciu, NACE-ul ei (${v.pre && v.pre.nace})`);
  v = await V({ categorie: 'servicii', categorie_id: UID(999) });
  verifica(!v.ok && v.cod === 'CATEGORIE_INVALIDA' && v.camp === 'categorie_id', `P2 categorie inexistentă → refuzată (${v.cod})`);
  v = await V({ categorie: 'servicii', categorie_id: CAT.inactiva });
  verifica(!v.ok && v.cod === 'CATEGORIE_INVALIDA', `P2 categorie inactivă → refuzată (${v.cod})`);
  v = await V({ categorie: 'servicii', categorie_id: CAT.sub });
  verifica(!v.ok && v.cod === 'CATEGORIE_INVALIDA', `P2 subcategorie (nu principală) → refuzată (${v.cod})`);
  v = await V({ categorie: 'materiale', categorie_id: CAT.sanitare });
  verifica(!v.ok && v.cod === 'CATEGORIE_ALT_TIP' && v.mesaj.ro && v.mesaj.en, `P2 categorie de alt tip → refuzată, mesaj RO + EN (${v.cod})`);
  v = await V({ categorie: 'inchirieri', categorie_id: CAT.inc_scule });
  verifica(v.ok && v.pre.categorie_slug === 'scule-echipamente', 'P2 închirieri: categoria „inchiriere” se potrivește cu tipul „inchirieri”');
  v = await V({ categorie: 'servicii', categorie_id: 'nu-e-uuid' });
  verifica(!v.ok && v.cod === 'CATEGORIE_INVALIDA', 'P2 id care nu e UUID → refuzat');
  for (const tip of ['servicii', 'materiale', 'inchirieri']) {
    v = await V({ categorie: tip, oras: 'Cluj' });
    verifica(!v.ok && v.cod === 'CATEGORIE_OBLIGATORIE' && v.camp === 'categorie_id', `P2 ${tip} fără categorie → CATEGORIE_OBLIGATORIE (${v.cod})`);
  }
  const lung = '<b>Sobe</b> de teracotă' + String.fromCharCode(7) + ' și șeminee '.repeat(10);
  v = await V({ categorie: 'materiale', categorie_altceva: true, categorie_text: lung, categorie_id: null });
  verifica(v.ok && v.pre.categorie_altceva === true && v.pre.categorie_id === null && v.pre.categorie_text.length <= 80 && !/[<>]/.test(v.pre.categorie_text) && v.pre.categorie_text.startsWith('Sobe de teracotă și'), `P2 „Altceva”: textul curățat, cel mult 80 (${JSON.stringify(v.pre && v.pre.categorie_text)})`);
  v = await V({ categorie: 'servicii', categorie_altceva: true, categorie_text: '   ' });
  verifica(v.ok && v.pre.categorie_altceva === true && v.pre.categorie_text === null, 'P2 „Altceva” fără text → valid (textul e opțional)');
  v = await V({ categorie: 'servicii', categorie_altceva: true, categorie_id: CAT.sanitare });
  verifica(v.ok && v.pre.categorie_altceva === true && v.pre.categorie_id === null, 'P2 „Altceva” are prioritate: fără id păstrat');
  for (const tip of ['curier', 'asigurari']) {
    v = await V({ categorie: tip, oras: 'Iași', categorie_id: CAT.sanitare, categorie_text: 'x' });
    verifica(v.ok && v.pre.categorie_id === null && v.pre.categorie_text === null && v.pre.categorie_altceva === false, `P2 ${tip}: fără categorie, oricare ar veni (${JSON.stringify(v.pre)})`);
  }
  v = await V({ categorie: 'servicii', categorie_id: CAT.sanitare, profesie_slug: '<script>' });
  verifica(v.ok && v.pre.profesie_slug === null, 'P2 indiciu de profesie necunoscut / greșit → nu se păstrează');
  v = await V({ categorie: 'partener' });
  verifica(!v.ok && v.cod === 'TIP_PARTENER_INVALID', 'P2 tip de partener necunoscut → refuzat');

  // P3. API-ul ciornei: refuzul pe server, ce se salvează, salvarea automată, DELETE.
  const ID = 'u-12p2';
  DB.tabele = Object.assign(arbore(), {
    profiles: [{ id: ID, roles: ['client'], rol_solicitat: 'partener_servicii' }],
    partener_activare_ciorna: [],
  });
  DB.utilizatori = { 'tok-12p2': { id: ID, email: 'ana@example.com' } };
  const ciorna = async (metoda, body) => { const res = raspuns(); await apiCiorna(cerere({ metoda, token: 'tok-12p2', body }), res); return res; };
  const salvata = () => (DB.tabele.partener_activare_ciorna.find((x) => x.user_id === ID) || {}).date;
  for (const [id, cod] of [[UID(999), 'CATEGORIE_INVALIDA'], [CAT.inactiva, 'CATEGORIE_INVALIDA'], [CAT.mat_zidarie, 'CATEGORIE_ALT_TIP']]) {
    r = await ciorna('PUT', { pas_curent: 1, date: { preinscriere: { categorie: 'servicii', categorie_id: id } } });
    verifica(r.statusCode === 400 && r.corp.cod === cod && r.corp.campuri[0].camp === 'categorie_id' && r.corp.mesaj.ro && r.corp.mesaj.en && !salvata(), `P3 PUT cu categorie ${cod} → 400, nimic salvat (${r.statusCode} ${r.corp.cod})`);
  }
  r = await ciorna('PUT', { pas_curent: 1, date: { preinscriere: { categorie: 'servicii' } } });
  verifica(r.statusCode === 400 && r.corp.cod === 'CATEGORIE_OBLIGATORIE', `P3 servicii fără categorie → 400 (${r.corp.cod})`);
  r = await ciorna('PUT', { pas_curent: 1, date: { preinscriere: { categorie: 'servicii', rol: 'partener_servicii', oras: 'Iași', categorie_id: CAT.sanitare, categorie_slug: 'fals', categorie_denumire: 'Fals', profesie_slug: 'instalator', creat_la: '2026-11-20T08:00:00Z' } } });
  let d = salvata();
  verifica(r.statusCode === 200 && d && d.preinscriere.categorie_id === CAT.sanitare && d.preinscriere.categorie_slug === 'instalatii-sanitare' && d.preinscriere.categorie_denumire === 'Instalații sanitare' && d.preinscriere.profesie_slug === 'instalator' && d.preinscriere.categorie_text === null, `P3 ce se salvează în date.preinscriere (${JSON.stringify(d && d.preinscriere)})`);
  // Salvarea automată a pașilor trimite aceeași pre-înscriere: nu se mai verifică (categoria poate fi între timp inactivă).
  DB.tabele.categorii.find((c) => c.id === CAT.sanitare).activ = false;
  r = await ciorna('PUT', { pas_curent: 2, date: Object.assign({}, copie(d), { pas1: { cui: '123' } }) });
  verifica(r.statusCode === 200 && salvata().pas1 && salvata().preinscriere.categorie_id === CAT.sanitare, `P3 salvarea automată a pașilor nu e blocată de categoria dezactivată (${r.statusCode})`);
  DB.tabele.categorii.find((c) => c.id === CAT.sanitare).activ = true;
  r = await ciorna('PUT', { pas_curent: 2, date: { preinscriere: { categorie: 'servicii', categorie_altceva: true, categorie_text: 'Sobe de teracotă' } } });
  verifica(r.statusCode === 200 && salvata().preinscriere.categorie_altceva === true && salvata().preinscriere.categorie_text === 'Sobe de teracotă', 'P3 „Altceva” + text, salvat');
  r = await ciorna('DELETE');
  d = salvata();
  verifica(r.statusCode === 200 && d && Object.keys(d).join() === 'preinscriere' && d.preinscriere.categorie_text === 'Sobe de teracotă', `P3 DELETE (după contract): restul ciornei se șterge, categoria rămâne (${JSON.stringify(d)})`);

  // P4. Portofoliul: contul nou (doar rol_solicitat, fără rând în partners), categoria aleasă primele.
  DB.tabele = Object.assign(arbore(), {
    profiles: [{ id: ID, roles: ['client'], rol_solicitat: 'partener_servicii' }, { id: 'u-client', roles: ['client'], rol_solicitat: null }, { id: 'u-curier', roles: ['client'], rol_solicitat: 'partener_curier' }],
    partners: [],
    partener_activare_ciorna: [{ user_id: ID, pas_curent: 1, date: { preinscriere: { categorie: 'servicii', categorie_id: CAT.sanitare, categorie_denumire: 'Instalații sanitare', categorie_denumire_en: 'Plumbing' } } }],
    catalog_servicii: [
      { id: 's-zugrav', id_serviciu: 'Z1', titlu: 'Zugrăvit perete', domeniu: 'Finisaje', nace: '43.34', cod_esco: null, categorie: 'servicii', status_public: true, categorie_id: UID(50), subcategorie_id: null, traduceri: { en: { titlu: 'Wall painting' } } },
      { id: 's-robinet', id_serviciu: 'S1', titlu: 'Montaj robinet', domeniu: 'Sanitare', nace: '43.22', cod_esco: null, categorie: 'servicii', status_public: true, categorie_id: CAT.sanitare, subcategorie_id: null, traduceri: { en: { titlu: 'Tap fitting' } } },
      { id: 's-desfundare', id_serviciu: 'S2', titlu: 'Desfundare scurgere', domeniu: 'Sanitare', nace: '43.22', cod_esco: null, categorie: 'servicii', status_public: true, categorie_id: UID(51), subcategorie_id: CAT.sub, traduceri: {} },
      { id: 's-privat', id_serviciu: 'S3', titlu: 'Nepublic', domeniu: 'Sanitare', nace: '43.22', cod_esco: null, categorie: 'servicii', status_public: false, categorie_id: CAT.sanitare, subcategorie_id: null, traduceri: {} },
    ],
    partener_servicii_active: [],
    partner_conturi_bancare: [],
    email_comportamental_log: [],
  });
  DB.utilizatori = { 'tok-12p2': { id: ID }, 'tok-client': { id: 'u-client' }, 'tok-curier': { id: 'u-curier' } };
  const port = async (tok, metoda, body) => { const res = raspuns(); await apiPortofoliu(cerere({ metoda: metoda || 'GET', token: tok, body }), res); return res; };
  r = await port('tok-12p2');
  const ord = r.corp && r.corp.servicii ? r.corp.servicii.map((s) => s.id) : [];
  verifica(r.statusCode === 200 && r.corp.categorie === 'servicii', `P4 contul nou (rol ales, fără firmă) vede portofoliul (${r.statusCode} ${r.corp && r.corp.cod})`);
  verifica(JSON.stringify(ord.slice(0, 2).sort()) === JSON.stringify(['s-desfundare', 's-robinet']) && ord[2] === 's-zugrav' && !ord.includes('s-privat'), `P4 serviciile din categoria aleasă (și subcategorii) primele (${ord})`);
  verifica(r.corp.servicii[0].din_categoria_aleasa === true && r.corp.servicii[2].din_categoria_aleasa === false && r.corp.categoria_aleasa && r.corp.categoria_aleasa.id === CAT.sanitare, 'P4 marcajul din_categoria_aleasa și categoria_aleasa');
  verifica(r.corp.servicii.find((s) => s.id === 's-robinet').titlu_en === 'Tap fitting', 'P4 titlul în engleză (traduceri.en.titlu)');
  r = await port('tok-12p2', 'POST', { action: 'toggle', catalog_serviciu_id: 's-robinet', activ: true });
  verifica(r.statusCode === 200 && DB.tabele.partener_servicii_active.some((x) => x.partener_id === ID && x.catalog_serviciu_id === 's-robinet' && x.activ), `P4 bifarea se salvează (${r.statusCode})`);
  r = await port('tok-client');
  verifica(r.statusCode === 403, `P4 cont fără rol de partener → 403 (${r.statusCode})`);
  r = await port('tok-curier');
  verifica(r.statusCode === 200 && r.corp.categorie === null && r.corp.servicii.length === 0, 'P4 curier: fără catalog de bifat');

  // P5. Back-office: categoria din înscriere în lista partenerilor.
  DB.tabele = {
    profiles: [{ id: 'adm', roles: ['superadmin'] }],
    partners: [
      { id: 'p-a', partner_type: 'servicii_tehnice', nume_firma: 'A SRL', cui: '1', status_verificare: 'pending_review', contract_semnat: false, tip_entitate_legala: null, forma_juridica_locala: null, regiune_cod: 'IS', creata_la: '2026-11-20' },
      { id: 'p-b', partner_type: 'furnizor_materiale', nume_firma: 'B SRL', cui: '2', status_verificare: 'pending_review', contract_semnat: false, tip_entitate_legala: null, forma_juridica_locala: null, regiune_cod: 'CJ', creata_la: '2026-11-19' },
      { id: 'p-c', partner_type: 'curierat', nume_firma: 'C SRL', cui: '3', status_verificare: 'approved', contract_semnat: true, tip_entitate_legala: null, forma_juridica_locala: null, regiune_cod: 'B', creata_la: '2026-11-18' },
    ],
    audit_log: [],
    partener_activare_ciorna: [
      { user_id: 'p-a', date: { preinscriere: { categorie: 'servicii', categorie_id: CAT.sanitare, categorie_slug: 'instalatii-sanitare', categorie_denumire: 'Instalații sanitare' } } },
      { user_id: 'p-b', date: { preinscriere: { categorie: 'materiale', categorie_altceva: true, categorie_text: 'Sobe de teracotă' } } },
    ],
  };
  DB.utilizatori = { 'tok-adm': { id: 'adm' } };
  r = raspuns();
  await apiParteneriLista(cerere({ metoda: 'GET', token: 'tok-adm' }), r);
  const dupaId = (id) => (r.corp.parteneri || []).find((p) => p.id === id) || {};
  verifica(r.statusCode === 200 && dupaId('p-a').categorie_inscriere && dupaId('p-a').categorie_inscriere.denumire === 'Instalații sanitare', `P5 back-office: categoria aleasă (${JSON.stringify(dupaId('p-a').categorie_inscriere)})`);
  verifica(dupaId('p-b').categorie_inscriere && dupaId('p-b').categorie_inscriere.altceva === true && dupaId('p-b').categorie_inscriere.text === 'Sobe de teracotă', 'P5 back-office: textul de la „Altceva”');
  verifica(dupaId('p-c').categorie_inscriere === null, 'P5 back-office: fără categorie (curier) → null');
  const sa = fs.readFileSync(path.join(RADACINA, 'mydarrin-superadmin.html'), 'utf8');
  verifica(/Categorie scrisă de partener/.test(sa) && /categorieInscriereHtml\(p\.categorie_inscriere\)/.test(sa), 'P5 superadmin: eticheta „Categorie scrisă de partener” în fișa partenerului');
}

// ── B. Browser ────────────────────────────────────────────────────────────
const PROFESII = [
  { slug: 'electrician', cod: '741101', denumire_ro: 'Electrician', nace: '43.21' },
  { slug: 'instalator', cod: '712601', denumire_ro: 'Instalator', nace: '43.22' },
  { slug: 'zugravi-si-vopsitori', cod: '7132', denumire_ro: 'Zugravi și vopsitori', nace: '43.30' },
];
const PROFESII_EN = { electrician: 'Electrician', instalator: 'Plumber', 'zugravi-si-vopsitori': 'Painters and related workers' };

// Clientul Supabase simulat (în pagină): înregistrarea, codul, sesiunea.
function supabaseSimulat() {
  const areSes = () => { try { return sessionStorage.getItem('sim_ses') === '1'; } catch (e) { return false; } };
  const user = () => ({ id: '50000000-0000-4000-8000-000000000001', email: (sessionStorage.getItem('sim_email') || 'ion@gmail.com'), email_confirmed_at: '2026-11-17T08:00:00Z', user_metadata: { prenume: 'Ion' } });
  const ses = () => (areSes() ? { access_token: 'tok-test', user: user() } : null);
  const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
  window.__auth = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: areSes() ? user() : null }, error: null }),
      getSession: async () => ({ data: { session: ses() }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { sessionStorage.removeItem('sim_ses'); return { error: null }; },
      signUp: async (o) => { window.__auth.push({ tip: 'signUp', o }); sessionStorage.setItem('sim_email', o.email); localStorage.setItem('__signup', JSON.stringify(o)); return { data: { user: { id: 'u', identities: [{}] } }, error: null }; },
      verifyOtp: async (o) => {
        window.__auth.push({ tip: 'verifyOtp', o });
        if (o.token !== '123456') return { data: {}, error: { message: 'Token has expired or is invalid', status: 403 } };
        sessionStorage.setItem('sim_ses', '1');
        return { data: { user: user(), session: ses() }, error: null };
      },
      resend: async () => ({ error: null }),
      signInWithPassword: async (o) => {
        window.__auth.push({ tip: 'login', email: o.email });
        if (o.password !== 'Parola-Test-1') return { data: {}, error: { message: 'Invalid login credentials', status: 400 } };
        sessionStorage.setItem('sim_email', o.email); sessionStorage.setItem('sim_ses', '1');
        return { data: { user: user(), session: ses() }, error: null };
      },
    },
    from: () => lant({ data: null, error: null }),
    rpc: () => lant({ data: null, error: null }),
    channel: () => lant({}),
    removeChannel: () => {},
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  };
  Object.defineProperty(window, 'supabaseClient', { configurable: true, get: () => client, set: () => {} });
}

// Serverul simulat: profilul (starea calculată cu stareContPartener reală), ciorna, profesiile.
// Panoul partenerului, ca lib/destinatie-rol.js: materialele și închirierile pe dashboard-ul de furnizor.
const paginaPanou = (tip) => (tip === 'materiale' || tip === 'inchirieri' ? '/mydarrin-dashboard-furnizor.html?type=' : '/mydarrin-dashboard-partener.html?type=') + tip;
function serverSimulat(opt) {
  const s = { ciorna: null, puturi: [], stare: (opt && opt.stare) || 'nou', categorie: (opt && opt.categorie) || 'servicii', motiv: (opt && opt.motiv) || null, profilCereri: 0, refuzuri: [], bifari: [], bifaEsueaza: false };
  // Pasul 12-P2: portofoliul simulat (serviciile din categoria aleasă primele, ca serverul real).
  s.portofoliu = [
    { id: 's-robinet', titlu: 'Montaj robinet', titlu_en: 'Tap fitting', domeniu: 'Sanitare', bifat: false, din_categoria_aleasa: true },
    { id: 's-boiler', titlu: 'Montaj boiler', titlu_en: 'Water heater fitting', domeniu: 'Sanitare', bifat: true, din_categoria_aleasa: true },
    { id: 's-zugrav', titlu: 'Zugrăvit perete', titlu_en: 'Wall painting', domeniu: 'Finisaje', bifat: false, din_categoria_aleasa: false },
  ];
  const ROL = { servicii: 'partener_servicii', materiale: 'partener_materiale', inchirieri: 'partener_inchirieri', curier: 'partener_curier', asigurari: 'partener_asigurari' };
  function profil() {
    const pasi = { nou: NOU, incomplet: INCOMPLET, verificare: VERIFICARE, respins: RESPINS, activ: ACTIV }[s.stare];
    const extra = { nou: {}, incomplet: { verificare: 'pending_review', rol: 1 }, verificare: { verificare: 'pending_review', rol: 1 }, respins: { verificare: 'rejected', rol: 1 }, activ: { verificare: 'approved', activ: true, rol: 1 } }[s.stare];
    const a = act(pasi, extra);
    a.rol = ROL[s.categorie]; a.tip = s.categorie;
    a.pasi = a.pasi.map((x) => Object.assign(x, { deschide: null }));
    a.stare_cont = stareContPartener(a, { motivFirma: s.motiv });
    const areRol = s.stare !== 'nou';
    return {
      ok: true, email: 'ion@gmail.com', nume: 'Ion Popescu', prenume: 'Ion', nume_familie: 'Popescu', telefon: '+40712345678', tara: 'RO', limba: null,
      roles: areRol ? ['client', a.rol] : ['client'], roluri_dashboard: areRol ? [a.rol] : [], are_comenzi: false,
      destinatie: paginaPanou(s.categorie), tip_destinatie: 'activare_partener', rol_solicitat: a.rol,
      partener: areRol ? { nume_firma: 'Ion SRL', partner_type: s.categorie, rol: a.rol, status_verificare: extra.verificare, contract_semnat: s.stare === 'activ', cont_bancar: s.stare !== 'incomplet', motiv_respingere: s.motiv, poate_vinde: s.stare === 'activ' } : null,
      investitor: null, activare: a, furnizor_propriu: false,
    };
  }
  async function trateaza(route) {
    const req = route.request();
    const u = new URL(req.url());
    const m = req.method();
    const corp = () => { try { return JSON.parse(req.postData() || '{}'); } catch (e) { return {}; } };
    const json = (cod, b) => route.fulfill({ status: cod, contentType: 'application/json', body: JSON.stringify(b) });
    switch (u.pathname) {
      case '/api/public/profesii': {
        const en = u.searchParams.get('lang') === 'en';
        return json(200, { ok: true, profesii: PROFESII.map((p) => Object.assign({}, p, { denumire: en ? PROFESII_EN[p.slug] : p.denumire_ro })) });
      }
      case '/api/cont/profil': s.profilCereri++; return json(200, profil());
      // Pasul 12-P2: lista reală (handler-ul și arborele simulat din DB).
      case '/api/public/categorii': {
        if (s.faraCategorii) return json(503, { ok: false });
        const r = raspuns();
        await apiCategorii(cerere({ metoda: 'GET', query: Object.fromEntries(u.searchParams) }), r);
        return json(r.statusCode, r.corp);
      }
      case '/api/partener/activare-ciorna':
        if (m === 'GET') return json(200, { ok: true, ciorna: s.ciorna });
        if (m === 'PUT') {
          const b = corp(); s.puturi.push(b);
          // Verificarea reală a pre-înscrierii (lib/categorii-inscriere.js), ca în API.
          const vechi = s.ciorna && s.ciorna.date ? s.ciorna.date.preinscriere : undefined;
          if (b.date && b.date.preinscriere && JSON.stringify(vechi) !== JSON.stringify(b.date.preinscriere)) {
            const v = await CI.valideazaPreinscriere(b.date.preinscriere);
            if (!v.ok) { s.refuzuri.push(v.cod); return json(400, corpEroare(v.cod, v.mesaj.ro, v.mesaj.en, [{ camp: v.camp, mesaj: v.mesaj }])); }
            b.date.preinscriere = v.pre;
          }
          s.ciorna = Object.assign({}, b, { actualizat_la: new Date().toISOString() });
          return json(200, { ok: true, actualizat_la: s.ciorna.actualizat_la });
        }
        s.ciorna = null; return json(200, { ok: true });
      case '/api/partener/portofoliu':
        if (m === 'GET') return json(200, { ok: true, categorie: ['servicii', 'materiale', 'inchirieri'].includes(s.categorie) ? s.categorie : null, servicii: s.portofoliu, categoria_aleasa: null });
        {
          const b = corp(); s.bifari.push(b);
          if (s.bifaEsueaza) return json(500, corpEroare('EROARE_SERVER', 'Nu am putut salva.', 'We could not save. Please try again.'));
          const x = s.portofoliu.find((y) => y.id === b.catalog_serviciu_id); if (x) x.bifat = b.activ;
          return json(200, { ok: true });
        }
      case '/api/public/destinatie-post-login': return json(200, { ok: true, destinatie: paginaPanou(s.categorie), tip: 'activare_partener' });
      case '/api/cont/bun-venit': return json(200, { ok: true, trimis: false });
      case '/api/public/nace-lista': return json(200, { ok: true, clase: [{ cod: '43.21', denumire: 'Lucrări de instalații electrice' }, { cod: '43.22', denumire: 'Lucrări de instalații sanitare, de încălzire și de aer condiționat' }] });
      case '/api/partener/wizard-nace': return json(200, { ok: true, coduri: [] });
      case '/api/public/geo-regiuni': return json(200, { ok: true, regiuni: [{ cod: 'IS', denumire: 'Iași' }] });
      case '/api/public/forme-juridice': return route.fallback();
      default:
        if (/^\/api\/public\/(reguli-platforma|tari-active)/.test(u.pathname)) return route.fallback();
        return json(503, { ok: false });
    }
  }
  return { s, trateaza };
}

async function testeBrowser() {
  const { chromium } = require('playwright');
  const { porneste } = require('./server-test');
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  // Arborele de categorii și profesiile, citite de handler-ele reale prin serverul simulat.
  DB.tabele = arbore();
  const ZGOMOT = /Failed to load resource|net::ERR_|status of 50[0-9]|status of 40[0-9]|cdn\.tailwindcss\.com|favicon/i;

  async function context(latime, limba, server, o) {
    const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 800 ? 844 : 900 } });
    await ctx.addInitScript(([l, ses]) => {
      try {
        if (!sessionStorage.getItem('__init')) {
          if (l) localStorage.setItem('myd_lang_v1', l);
          localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: true, marketing: false, data: new Date().toISOString(), versiune: 2 }));
          if (ses) sessionStorage.setItem('sim_ses', '1');
          sessionStorage.setItem('__init', '1');
        }
      } catch (e) {}
    }, [limba, !!(o && o.sesiune)]);
    await ctx.addInitScript(supabaseSimulat);
    // Trackerele și Supabase: după domeniu (adresa paginii poate conține utm_source=facebook).
    await ctx.route((u) => /(\.supabase\.co|googletagmanager\.com|google-analytics\.com|ipapi\.co|facebook\.(net|com)|tiktok\.com|licdn\.com)$/.test(u.hostname) || /^\/_vercel\/insights/.test(u.pathname), (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await ctx.route(/\/api\//, server.trateaza);
    // Pagina principală (după ieșire): o oprim aici.
    await ctx.route(/mydarrin\.homebestpal\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>site</body></html>' }));
    const p = await ctx.newPage();
    const erori = [];
    p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
    p.on('console', (m) => { if (m.type() === 'error' && !ZGOMOT.test(m.text())) erori.push('console: ' + m.text().slice(0, 160)); });
    return { ctx, p, erori };
  }
  const PAGINA = '/mydarrin-inscriere-partener.html';
  const depaseste = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const portocalii = (p, rad) => p.evaluate((sel) => {
    const r = sel ? document.querySelector(sel) : document;
    if (!r) return -1;
    // Butoanele (și ce e în ele) cu fundal portocaliu; punctele decorative nu contează.
    return [...r.querySelectorAll('*')].filter((b) => {
      if (!b.closest('button, a')) return false;
      if (!b.getClientRects().length) return false;
      const cs = getComputedStyle(b);
      return cs.visibility !== 'hidden' && /255, 140, 0/.test(cs.backgroundColor);
    }).length;
  }, rad || null);

  try {
    for (const lang of ['ro', 'en']) {
      for (const latime of [390, 1366]) {
        const et = `${lang} ${latime}`;
        // ── B1. Pagina: obligatorii, categoria din reclamă (?profesie=), lang, UTM ──
        {
          const server = serverSimulat();
          const { ctx, p, erori } = await context(latime, null, server);
          await p.goto(`${baza}${PAGINA}?profesie=instalator&lang=${lang}&utm_source=facebook&utm_campaign=instalatori-iasi`, { waitUntil: 'load' });
          await p.waitForFunction(() => document.querySelectorAll('#pi-domeniu option').length > 2, null, { timeout: 10000 });
          verifica(await p.evaluate(() => document.documentElement.lang) === lang, `${et} B1: ?lang=${lang} aplicat`);
          verifica(!(await p.$('#pi-profesie')), `${et} B1: câmpul „Profesia” nu mai există`);
          const eticheta = await p.evaluate(() => document.getElementById('pi-domeniu-camp').firstChild.textContent.trim());
          verifica(eticheta === (lang === 'ro' ? 'Categoria principală' : 'Main category'), `${et} B1: eticheta „${eticheta}”`);
          verifica(await p.inputValue('#pi-domeniu') === CAT.sanitare, `${et} B1: ?profesie=instalator preselectează categoria legată (${await p.inputValue('#pi-domeniu')})`);
          verifica(await p.isVisible('#pi-domeniu-reclama'), `${et} B1: „Aleasă deja din reclamă” vizibil`);
          const optiuni = await p.evaluate(() => [...document.querySelectorAll('#pi-domeniu option')].map((o) => [o.value, o.textContent]));
          verifica(optiuni.length === 5 && optiuni[1][1] === (lang === 'ro' ? 'Instalații sanitare' : 'Plumbing') && optiuni[4][0] === 'altceva' && optiuni[4][1] === (lang === 'ro' ? 'Altceva' : 'Something else'), `${et} B1: lista din arbore, „${lang === 'ro' ? 'Altceva' : 'Something else'}” ultima (${optiuni.map((o) => o[1]).join(' | ')})`);
          const ajutor = (await p.textContent('#pi-domeniu-ajutor')).trim();
          verifica(ajutor === (lang === 'ro' ? 'Profesia, serviciile și zona le alegi în panoul tău, după ce îți faci contul.' : 'You choose your trade, services and area in your dashboard after you sign up.'), `${et} B1: textul de sub câmp (${ajutor})`);
          verifica(await p.getAttribute('#pi-domeniu', 'required') !== null, `${et} B1: câmpul e obligatoriu`);
          verifica(await p.isChecked('input[name="pi-categorie"][value="servicii"]'), `${et} B1: Servicii ales implicit`);
          verifica(await portocalii(p) === 1, `${et} B1: un singur buton portocaliu (${await portocalii(p)})`);
          verifica(await depaseste(p) <= 0, `${et} B1: pagina nu iese din ecran (${await depaseste(p)} px)`);
          // Obligatorii: trimitere goală → erorile sub câmpuri.
          await p.click('#pi-trimite');
          await p.waitForSelector('#pi-oras[aria-invalid="true"]', { timeout: 5000 }).catch(() => {});
          const invalide = await p.evaluate(() => [...document.querySelectorAll('#pi-form [aria-invalid="true"]')].map((e) => e.id));
          verifica(['pi-oras', 'pi-prenume', 'pi-nume', 'pi-tel', 'pi-email', 'pi-parola', 'pi-gdpr'].every((id) => invalide.includes(id)), `${et} B1: câmpurile obligatorii marcate (${invalide.join(',')})`);
          // Materiale: lista se schimbă cu tipul (categoriile de materiale).
          await p.click('label.pi-cip:has(input[value="materiale"])');
          await p.waitForFunction(() => document.querySelectorAll('#pi-domeniu option').length === 4, null, { timeout: 8000 }).catch(() => {});
          const mat = await p.evaluate(() => [...document.querySelectorAll('#pi-domeniu option')].map((o) => o.textContent));
          verifica(await p.isVisible('#pi-domeniu') && mat[1] === (lang === 'ro' ? 'Sanitare & Termice' : 'Plumbing & Heating') && mat.length === 4, `${et} B1: la Materiale, categoriile de materiale (${mat.join(' | ')})`);
          verifica(await p.inputValue('#pi-domeniu') === '', `${et} B1: la Materiale, nimic preselectat din profesie`);
          const nota = await p.textContent('#pi-nota');
          verifica(!/0%/.test(nota), `${et} B1: „0% comision din manoperă” doar la servicii și curieri (${nota.trim()})`);
          // Curier și Asigurări: câmpul nu apare și nu e obligatoriu.
          for (const tipFara of ['curier', 'asigurari']) {
            await p.click(`label.pi-cip:has(input[value="${tipFara}"])`);
            verifica(!(await p.isVisible('#pi-domeniu')) && !(await p.isVisible('#pi-altceva')) && await p.getAttribute('#pi-domeniu', 'required') === null, `${et} B1: la ${tipFara}, fără categorie`);
          }
          await p.click('label.pi-cip:has(input[value="servicii"])');
          verifica(await p.inputValue('#pi-domeniu') === CAT.sanitare, `${et} B1: înapoi la Servicii, categoria din reclamă rămâne`);
          // Româna nu apare în EN (textul vizibil).
          if (lang === 'en') {
            const text = await p.evaluate(() => document.body.innerText);
            const { eRo } = require('./recunoaste-ro');
            const ro = text.split('\n').map((x) => x.trim()).filter((x) => x && eRo(x));
            verifica(!ro.length, `${et} B1: text românesc în EN: ${ro.slice(0, 4).join(' | ')}`);
          }
          // Înregistrarea completă (Servicii), cu UTM-ul păstrat.
          await p.fill('#pi-oras', 'Iași');
          await p.fill('#pi-prenume', 'Ion');
          await p.fill('#pi-nume', 'Popescu');
          await p.fill('#pi-tel', '+40 712 345 678');
          await p.fill('#pi-email', 'ion@gmail.com');
          await p.fill('#pi-parola', 'Parola-Test-1');
          await p.check('#pi-gdpr');
          await p.click('#pi-trimite');
          await p.waitForSelector('#auth-verify-cod:not([hidden])', { timeout: 10000 }).catch(() => {});
          const su = await p.evaluate(() => JSON.parse(localStorage.getItem('__signup') || 'null'));
          verifica(su && su.options.data.rol_solicitat === 'partener_servicii' && su.options.data.telefon === '+40712345678' && su.options.data.gdpr_acceptat === true, `${et} B1: înregistrarea (${su && JSON.stringify(su.options.data).slice(0, 160)})`);
          verifica(su && su.options.data.sursa && su.options.data.sursa.utm_source === 'facebook', `${et} B1: UTM-ul ajunge la cont (sursa: ${su && JSON.stringify(su.options.data.sursa)})`);
          verifica(su && su.options.data.limba === lang || su && su.options.data.limba, `${et} B1: limba trimisă la înregistrare`);
          const pre = await p.evaluate(() => JSON.parse(sessionStorage.getItem('myd_preinscriere_v1') || 'null'));
          verifica(pre && pre.categorie === 'servicii' && pre.categorie_id === CAT.sanitare && pre.categorie_slug === 'instalatii-sanitare' && pre.categorie_altceva === false && pre.profesie_slug === 'instalator' && pre.oras === 'Iași', `${et} B1: datele pre-înscrierii păstrate (${JSON.stringify(pre)})`);

          // ── B2. Ecranul de cod ──
          verifica(await p.isVisible('#auth-verify-cod'), `${et} B2: ecranul de cod`);
          verifica(await p.isVisible('#mdc-gmail'), `${et} B2: „Deschide Gmail” la @gmail.com`);
          verifica(await p.getAttribute('#mdc-gmail', 'href') === 'https://mail.google.com/', `${et} B2: linkul Gmail`);
          const ret = await p.evaluate(() => ({ t: document.getElementById('mdc-retrimite').textContent, d: document.getElementById('mdc-retrimite').disabled }));
          verifica(ret.d && /0:4\d/.test(ret.t), `${et} B2: „Retrimite (0:4x)”, dezactivat (${ret.t})`);
          const sfat = await p.textContent('#mdc-cod-indiciu');
          verifica((lang === 'ro' ? /Promoții și Spam/.test(sfat) : /Promotions and Spam/.test(sfat)) && !/@/.test(sfat), `${et} B2: sfatul Promoții / Spam, fără expeditor neconfirmat (${sfat.trim()})`);
          verifica(await portocalii(p, '#auth-modal') === 1, `${et} B2: un singur buton portocaliu`);
          // Lipirea: „12 34 56” → 123456, în cele 6 căsuțe.
          await p.fill('#verify-cod-input', 'Cod: 65 43 21');
          const cutii = await p.evaluate(() => [...document.querySelectorAll('#mdc-cutii span')].map((s) => s.textContent).join(''));
          verifica(cutii === '654321' && await p.inputValue('#verify-cod-input') === '654321', `${et} B2: codul lipit în căsuțe (${cutii})`);
          // Cod greșit → eroare, rămâne pe ecran.
          await p.click('#mdc-cod-btn');
          await p.waitForSelector('#verify-cod-msg .md-feedback-eroare', { timeout: 5000 }).catch(() => {});
          verifica(await p.isVisible('#auth-verify-cod'), `${et} B2: codul greșit lasă ecranul de cod`);
          // Codul corect → panoul „cont nou”.
          await p.fill('#verify-cod-input', '123456');
          await p.click('#mdc-cod-btn');
          await p.waitForURL(/mydarrin-dashboard-partener/, { timeout: 15000 }).catch(() => {});
          await p.waitForSelector('#myd-panou-nou .mpn-stare', { timeout: 15000 }).catch(() => {});
          verifica(/mydarrin-dashboard-partener\.html\?type=servicii/.test(p.url()), `${et} B3: după cod, panoul partenerului (${p.url()})`);
          verifica(await p.isVisible('#myd-panou-nou'), `${et} B3: panoul „cont nou” deschis`);
          verifica(!(await p.$('#myd-activare-pagina')), `${et} B3: nu se deschide pasul „Firma”`);
          const salvat = server.s.ciorna && server.s.ciorna.date && server.s.ciorna.date.preinscriere;
          verifica(salvat && salvat.categorie_id === CAT.sanitare && salvat.categorie_denumire === 'Instalații sanitare' && salvat.categorie_denumire_en === 'Plumbing' && salvat.profesie_slug === 'instalator' && salvat.nace === '43.22' && salvat.oras === 'Iași', `${et} B3: datele pre-înscrierii în ciornă, verificate (${JSON.stringify(salvat)})`);
          const salut = await p.textContent('.mpn-salut');
          verifica(salut.includes(lang === 'ro' ? 'Bun venit, Ion' : 'Welcome, Ion') && salut.includes(lang === 'ro' ? 'Instalații sanitare' : 'Plumbing') && salut.includes('Iași'), `${et} B3: salutul și categoria (${salut.replace(/\s+/g, ' ').trim()})`);
          const info = await p.textContent('.mpn-info b');
          verifica(info === (lang === 'ro' ? 'Comenzi în zona ta · Instalații sanitare · Iași' : 'Orders in your area · Plumbing · Iași'), `${et} B3: cardul turcoaz (${info})`);
          // „Ce lucrări faci”: primul rând al listei.
          const randuri = await p.evaluate(() => [...document.querySelectorAll('.mpn-lista .mpn-rand')].map((r) => r.getAttribute('data-mpn-rand')));
          verifica(randuri[0] === 'lucrari', `${et} B3: primul rând e „Ce lucrări faci” (${randuri.join(',')})`);
          const tLucrari = await p.evaluate(() => document.querySelector('.mpn-rand[data-mpn-rand="lucrari"] b').firstChild.textContent.trim());
          verifica(tLucrari === (lang === 'ro' ? 'Ce lucrări faci' : 'What work you do'), `${et} B3: titlul rândului (${tLucrari})`);
          const subLista = await p.textContent('.mpn-lista > .mpn-mic');
          verifica(subLista === (lang === 'ro' ? 'Începi cu firma; restul îl faci în ce ordine vrei.' : 'Start with the company; do the rest in any order.'), `${et} B3: textul listei (${subLista})`);
          verifica(await p.textContent('.mpn-stare .mpn-insigna') === (lang === 'ro' ? 'Profil incomplet' : 'Profile incomplete'), `${et} B3: starea „Profil incomplet”`);
          const port = await p.evaluate(() => [...document.querySelectorAll('#myd-panou-nou *')].filter((b) => b.closest('button, a') && b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden' && /255, 140, 0/.test(getComputedStyle(b).backgroundColor)).map((b) => b.tagName + '.' + b.className + ' ' + b.textContent.trim().slice(0, 30)));
          verifica(port.length === 1, `${et} B3: un singur buton portocaliu în panou (${port.join(' | ')})`);
          verifica(await p.evaluate(() => document.getElementById('myd-panou-nou').scrollWidth <= window.innerWidth), `${et} B3: panoul nu iese din ecran`);
          verifica(latime < 1024 ? await p.isVisible('.mpn-jos') : await p.isVisible('.mpn-meniu'), `${et} B3: ${latime < 1024 ? 'bara de jos' : 'meniul lateral'}`);
          // EN: niciun text românesc vizibil în panou (B1.4) și pe ecranul de cod de dinainte.
          if (lang === 'en') {
            const { eRo } = require('./recunoaste-ro');
            const text = await p.evaluate(() => document.getElementById('myd-panou-nou').innerText);
            const ro = text.split('\n').map((x) => x.trim()).filter((x) => x && eRo(x));
            verifica(!ro.length, `${et} B3: text românesc în panoul EN: ${ro.slice(0, 4).join(' | ')}`);
          }
          // Secțiunile fără date: stări goale, fără cifre.
          await p.click(`${latime < 1024 ? '.mpn-jos' : '.mpn-meniu'} [data-mpn-sec="comenzi"]`);
          const gol = await p.textContent('[data-mpn-gol="comenzi"]');
          verifica(!/\d/.test(gol), `${et} B3: „Comenzi” fără cifre (${gol.trim().slice(0, 80)})`);
          await p.click(`${latime < 1024 ? '.mpn-jos' : '.mpn-meniu'} [data-mpn-sec="activitate"]`);
          // ── B3b. „Ce lucrări faci” → portofoliul, categoria aleasă primele; bifarea cu feedback ──
          await p.click('.mpn-rand[data-mpn-rand="lucrari"]');
          await p.waitForSelector('#mpn-lucrari-lista input[data-mpn-serviciu]', { timeout: 10000 }).catch(() => {});
          const lucr = await p.evaluate(() => ({
            cap: (document.querySelector('#mpn-lucrari-lista h3') || {}).textContent,
            ids: [...document.querySelectorAll('#mpn-lucrari-lista input[data-mpn-serviciu]')].map((i) => i.getAttribute('data-mpn-serviciu')),
            prim: (document.querySelector('#mpn-lucrari-lista .mpn-txt b') || {}).textContent,
            bifat: (document.querySelector('input[data-mpn-serviciu="s-boiler"]') || {}).checked,
          }));
          verifica(lucr.cap === (lang === 'ro' ? 'Din categoria ta: Instalații sanitare' : 'From your category: Plumbing') && lucr.ids.join() === 's-robinet,s-boiler,s-zugrav' && lucr.bifat, `${et} B3b: portofoliul, categoria aleasă primele (${JSON.stringify(lucr)})`);
          verifica(lucr.prim === (lang === 'ro' ? 'Montaj robinet' : 'Tap fitting'), `${et} B3b: titlul serviciului în limba paginii (${lucr.prim})`);
          await p.check('input[data-mpn-serviciu="s-robinet"]');
          await p.waitForSelector('#mpn-lucrari-msg .md-feedback-ok, #mpn-lucrari-msg [class*="ok"]', { timeout: 8000 }).catch(() => {});
          const msgOk = (await p.textContent('#mpn-lucrari-msg')).trim();
          verifica(server.s.bifari.some((b) => b.catalog_serviciu_id === 's-robinet' && b.activ === true) && msgOk.startsWith('✓'), `${et} B3b: bifarea se salvează, „✓ Salvat” după răspunsul serverului (${msgOk})`);
          server.s.bifaEsueaza = true;
          await p.click('input[data-mpn-serviciu="s-zugrav"]');
          await p.waitForFunction(() => /✕/.test(document.getElementById('mpn-lucrari-msg').textContent), null, { timeout: 8000 }).catch(() => {});
          const msgErr = (await p.textContent('#mpn-lucrari-msg')).trim();
          verifica(msgErr.startsWith('✕') && !(await p.isChecked('input[data-mpn-serviciu="s-zugrav"]')), `${et} B3b: eroarea serverului → mesaj roșu, bifa revine (${msgErr})`);
          server.s.bifaEsueaza = false;
          if (lang === 'en') {
            const { eRo } = require('./recunoaste-ro');
            const text = await p.evaluate(() => document.getElementById('myd-panou-nou').innerText);
            const ro = text.split('\n').map((x) => x.trim()).filter((x) => x && eRo(x));
            verifica(!ro.length, `${et} B3b: text românesc în „What work you do”: ${ro.slice(0, 4).join(' | ')}`);
          }
          verifica(await portocalii(p, '#myd-panou-nou') <= 1, `${et} B3b: cel mult un buton portocaliu`);
          verifica(await p.evaluate(() => document.getElementById('myd-panou-nou').scrollWidth <= window.innerWidth), `${et} B3b: fără depășire`);
          await p.click('#mpn-lucrari-inapoi');
          await p.waitForSelector('#myd-panou-nou .mpn-stare', { timeout: 8000 }).catch(() => {});
          verifica(await p.isVisible('.mpn-rand[data-mpn-rand="lucrari"]'), `${et} B3b: „Înapoi la panou” revine la listă`);
          // „Continuă cu firma” → pasul Firma, „Înapoi la panou” → panoul.
          // Telefon: butonul „Continuă cu firma”; desktop (B1.5): „Completează” din rândul Firma.
          await p.click(latime < 1024 ? '#mpn-continua' : '.mpn-rand[data-mpn-rand="firma"]');
          await p.waitForSelector('#myd-activare-pagina #mya-corp', { timeout: 10000 });
          verifica(await p.isVisible('#myd-activare-pagina #mya-cui'), `${et} B4: „Continuă cu firma” / „Completează” deschide pasul Firma`);
          await p.click('#mya-inapoi');
          await p.waitForSelector('#myd-activare-pagina', { state: 'detached', timeout: 10000 }).catch(() => {});
          verifica(!(await p.$('#myd-activare-pagina')) && await p.isVisible('#myd-panou-nou .mpn-stare'), `${et} B4: „Înapoi la panou” revine în panou`);
          // Documente (încă după firmă): explicația, fără formular; înapoi în panou.
          await p.click('.mpn-rand[data-mpn-rand="documente"]');
          await p.waitForSelector('#myd-activare-pagina #mya-corp', { timeout: 10000 });
          const expl = await p.textContent('#myd-activare-pagina #mya-corp');
          verifica(lang === 'ro' ? /după ce salvezi firma/.test(expl) : /after you save your company/.test(expl), `${et} B4: pasul care așteaptă firma explică de ce (${expl.trim().slice(0, 80)})`);
          await p.click('#mya-inapoi');
          await p.waitForSelector('#myd-activare-pagina', { state: 'detached', timeout: 10000 }).catch(() => {});
          verifica(await p.isVisible('#myd-panou-nou .mpn-stare'), `${et} B4: înapoi în panou din „Documente”`);
          verifica(!erori.length, `${et} B: erori JS (${erori.slice(0, 3).join(' | ')})`);
          await ctx.close();
        }
      }
    }

    // ── B4b. Pasul 12-P1b: „Ai deja cont? Intră în cont” sub butonul portocaliu → logarea → panoul ──
    for (const lang of ['ro', 'en']) {
      for (const latime of [390, 1366]) {
        const et = `${lang} ${latime}`;
        const server = serverSimulat();
        const { ctx, p, erori } = await context(latime, lang, server);
        await p.goto(`${baza}${PAGINA}`, { waitUntil: 'load' });
        await p.waitForFunction(() => window.MDCont && window.MDFeedback && !document.documentElement.classList.contains('myd-i18n-pending'), null, { timeout: 10000 }).catch(() => {});
        const rand = await p.evaluate(() => {
          const r = document.getElementById('pi-am-cont'), b = document.getElementById('pi-intra-jos'), t = document.getElementById('pi-trimite');
          const cs = getComputedStyle(b);
          return { text: r.innerText.replace(/\s+/g, ' ').trim(), vizibil: !!r.getClientRects().length, subButon: r.getBoundingClientRect().top > t.getBoundingClientRect().bottom, culoare: cs.color, marime: cs.fontSize, aliniere: getComputedStyle(r).textAlign };
        });
        verifica(rand.vizibil && rand.text === (lang === 'ro' ? 'Ai deja cont? Intră în cont' : 'Already have an account? Sign in'), `${et} B4b: rândul de logare (${rand.text})`);
        verifica(rand.subButon && rand.culoare === 'rgb(0, 51, 102)' && rand.marime === '14px' && rand.aliniere === 'center', `${et} B4b: sub butonul portocaliu, albastru #003366, 14 px, centrat (${JSON.stringify(rand)})`);
        await p.click('#pi-intra-jos');
        await p.waitForSelector('#auth-login:not([hidden])', { timeout: 8000 }).catch(() => {});
        verifica(await p.isVisible('#login-email'), `${et} B4b: se deschide fereastra de logare, tabul „Intră în cont”`);
        await p.fill('#login-email', 'ion@gmail.com');
        await p.fill('#login-pass', 'Parola-Test-1');
        await p.click('#mdc-login-btn');
        await p.waitForURL(/mydarrin-dashboard-partener/, { timeout: 15000 }).catch(() => {});
        await p.waitForSelector('#myd-panou-nou .mpn-stare', { timeout: 15000 }).catch(() => {});
        verifica(/mydarrin-dashboard-partener\.html\?type=servicii/.test(p.url()) && await p.isVisible('#myd-panou-nou'), `${et} B4b: după logare, panoul partenerului (${p.url()})`);
        verifica(!erori.length, `${et} B4b: erori JS (${erori.slice(0, 3).join(' | ')})`);
        await ctx.close();
      }
    }

    // ── B5. Cele 5 tipuri → rol_solicitat, categoria, contul creat, ce ajunge în ciornă ──
    // Servicii și Materiale: o categorie din listă; Închirieri: „Altceva” + text; Curier și Asigurări: fără câmp.
    const completeaza = async (p, email) => {
      await p.fill('#pi-oras', 'Cluj-Napoca');
      await p.fill('#pi-prenume', 'Ana');
      await p.fill('#pi-nume', 'Test');
      await p.fill('#pi-tel', '+40712345679');
      await p.fill('#pi-email', email || 'ana@example.com');
      await p.fill('#pi-parola', 'Parola-Test-2');
      await p.check('#pi-gdpr');
    };
    const prinCod = async (p, server) => {
      await p.waitForSelector('#auth-verify-cod:not([hidden])', { timeout: 10000 }).catch(() => {});
      await p.fill('#verify-cod-input', '123456');
      await p.click('#mdc-cod-btn');
      await p.waitForSelector('#myd-panou-nou .mpn-stare', { timeout: 15000 }).catch(() => {});
      return server.s.ciorna && server.s.ciorna.date ? server.s.ciorna.date.preinscriere : null;
    };
    const ASTEPTAT = {
      servicii: { id: CAT.sanitare, slug: 'instalatii-sanitare' },
      materiale: { id: CAT.mat_sanitare, slug: 'sanitare-termice' },
      inchirieri: { altceva: 'Remorci auto' },
    };
    for (const cat of ['servicii', 'materiale', 'inchirieri', 'curier', 'asigurari']) {
      const server = serverSimulat({ categorie: cat });
      const { ctx, p, erori } = await context(390, 'ro', server);
      await p.goto(`${baza}${PAGINA}?categorie=${cat}`, { waitUntil: 'load' });
      await p.waitForFunction(() => window.MDFeedback && window.MDCont, null, { timeout: 10000 });
      verifica(await p.isChecked(`input[name="pi-categorie"][value="${cat}"]`), `B5 ${cat}: tipul din ?categorie=`);
      const a = ASTEPTAT[cat];
      if (a) {
        await p.waitForFunction(() => document.querySelectorAll('#pi-domeniu option').length > 2, null, { timeout: 10000 });
        if (a.altceva) {
          await p.selectOption('#pi-domeniu', 'altceva');
          verifica(await p.isVisible('#pi-altceva'), `B5 ${cat}: „Altceva” arată câmpul de text opțional`);
          verifica(await p.getAttribute('#pi-altceva', 'maxlength') === '80', `B5 ${cat}: textul are cel mult 80 de caractere`);
          await p.fill('#pi-altceva', a.altceva);
        } else {
          await p.selectOption('#pi-domeniu', { index: 1 });
          verifica(!(await p.isVisible('#pi-altceva')), `B5 ${cat}: fără „Altceva”, câmpul de text ascuns`);
        }
      } else {
        verifica(!(await p.isVisible('#pi-domeniu')) && !(await p.isVisible('#pi-altceva')), `B5 ${cat}: câmpul de categorie nu apare`);
      }
      await completeaza(p);
      await p.click('#pi-trimite');
      await p.waitForSelector('#auth-verify-cod:not([hidden])', { timeout: 10000 }).catch(() => {});
      const su = await p.evaluate(() => JSON.parse(localStorage.getItem('__signup') || 'null'));
      verifica(su && su.options.data.rol_solicitat === 'partener_' + cat, `B5 ${cat}: contul se creează, rol_solicitat ${su && su.options.data.rol_solicitat}`);
      verifica(!(await p.isVisible('#mdc-gmail')), `B5 ${cat}: fără „Deschide Gmail” la o adresă care nu e Gmail`);
      const pre = await prinCod(p, server);
      if (a && a.id) verifica(pre && pre.categorie === cat && pre.categorie_id === a.id && pre.categorie_slug === a.slug && pre.categorie_altceva === false && pre.categorie_text === null, `B5 ${cat}: în ciornă, categoria din listă (${JSON.stringify(pre)})`);
      else if (a) verifica(pre && pre.categorie === cat && pre.categorie_id === null && pre.categorie_altceva === true && pre.categorie_text === a.altceva, `B5 ${cat}: în ciornă, „Altceva” + text (${JSON.stringify(pre)})`);
      else verifica(pre && pre.categorie === cat && pre.categorie_id === null && pre.categorie_altceva === false && pre.categorie_text === null, `B5 ${cat}: în ciornă, fără categorie (${JSON.stringify(pre)})`);
      verifica(!server.s.refuzuri.length && await p.isVisible('#myd-panou-nou'), `B5 ${cat}: după cod, panoul; serverul nu a refuzat nimic (${server.s.refuzuri.join(',')})`);
      verifica(!erori.length, `B5 ${cat}: erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }

    // ── B5b. Fără lista de categorii (API indisponibil): doar textul opțional, contul se creează ──
    {
      const server = serverSimulat();
      server.s.faraCategorii = true;
      const { ctx, p } = await context(390, 'ro', server);
      await p.goto(`${baza}${PAGINA}?profesie=instalator`, { waitUntil: 'load' });
      await p.waitForFunction(() => window.MDCont && document.getElementById('pi-domeniu-camp').hidden && !document.getElementById('pi-altceva-camp').hidden, null, { timeout: 10000 }).catch(() => {});
      verifica(!(await p.isVisible('#pi-domeniu')) && await p.isVisible('#pi-altceva'), 'B5b: fără lista de categorii, rămâne doar textul opțional');
      await completeaza(p, 'ion@example.com');
      await p.click('#pi-trimite');
      verifica(await p.waitForSelector('#auth-verify-cod:not([hidden])', { timeout: 10000 }).then(() => true, () => false), 'B5b: contul se creează și fără listă');
      const pre = await prinCod(p, server);
      verifica(pre && pre.categorie_altceva === true && pre.categorie_id === null, `B5b: salvat ca „Altceva” (${JSON.stringify(pre)})`);
      await ctx.close();
    }

    // ── B5c. Parametrii din reclame: ?domeniu= și ?profesie= ──
    for (const [adresa, asteptat, et] of [
      ['?domeniu=hvac-climatizare', CAT.hvac, '?domeniu=hvac-climatizare'],
      ['?categorie=materiale&domeniu=zidarie-beton', CAT.mat_zidarie, '?categorie=materiale&domeniu=zidarie-beton'],
      ['?categorie=inchirieri&domeniu=scule-echipamente&lang=en', CAT.inc_scule, 'închirieri, EN'],
      ['?domeniu=nu-exista', '', '?domeniu necunoscut'],
      ['?profesie=instalator&domeniu=instalatii-electrice', CAT.electrice, '?domeniu are prioritate față de ?profesie'],
      ['?profesie=zugravi-si-vopsitori', '', '?profesie fără categorie legată'],
      ['?type=servicii&profesie=instalator', CAT.sanitare, '?type= (reclamele vechi)'],
    ]) {
      const server = serverSimulat();
      const { ctx, p, erori } = await context(390, 'ro', server);
      await p.goto(`${baza}${PAGINA}${adresa}`, { waitUntil: 'load' });
      await p.waitForFunction(() => document.querySelectorAll('#pi-domeniu option').length > 2, null, { timeout: 10000 }).catch(() => {});
      const val = await p.inputValue('#pi-domeniu');
      verifica(val === asteptat, `B5c ${et}: preselecție „${val}” (așteptat „${asteptat}”)`);
      verifica(await p.isVisible('#pi-domeniu-reclama') === !!asteptat, `B5c ${et}: „Aleasă deja din reclamă” ${asteptat ? 'vizibil' : 'ascuns'}`);
      if (adresa.includes('zugravi')) {
        // Profesia rămâne indiciu chiar fără categorie legată.
        await p.selectOption('#pi-domeniu', { index: 2 });
        verifica(!(await p.isVisible('#pi-domeniu-reclama')), 'B5c: alegerea utilizatorului ascunde „Aleasă deja din reclamă”');
        await completeaza(p);
        await p.click('#pi-trimite');
        const pre = await prinCod(p, server);
        verifica(pre && pre.profesie_slug === 'zugravi-si-vopsitori' && pre.categorie_id === CAT.electrice, `B5c: profesia salvată ca indiciu, categoria aleasă de utilizator (${JSON.stringify(pre)})`);
      }
      verifica(!erori.length, `B5c ${et}: erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }

    // ── B5d. Fără categorie: mesaj clar sub câmp (MDFeedback.aplicaErori), apoi „Altceva” merge ──
    for (const lang of ['ro', 'en']) {
      for (const latime of [390, 1366]) {
        const et = `${lang} ${latime}`;
        const server = serverSimulat();
        const { ctx, p, erori } = await context(latime, lang, server);
        await p.goto(`${baza}${PAGINA}`, { waitUntil: 'load' });
        await p.waitForFunction(() => document.querySelectorAll('#pi-domeniu option').length > 2 && !document.documentElement.classList.contains('myd-i18n-pending'), null, { timeout: 10000 }).catch(() => {});
        verifica(await p.inputValue('#pi-domeniu') === '', `${et} B5d: fără parametri, nimic preselectat`);
        await completeaza(p);
        await p.click('#pi-trimite');
        await p.waitForSelector('#pi-domeniu[aria-invalid="true"]', { timeout: 5000 }).catch(() => {});
        const err = await p.evaluate(() => {
          const s = document.getElementById('pi-domeniu');
          const ids = (s.getAttribute('aria-describedby') || '').split(/\s+/);
          const m = ids.map((i) => document.getElementById(i)).find((x) => x && x.classList.contains('md-camp-eroare'));
          return { invalid: s.getAttribute('aria-invalid'), text: m ? m.textContent : null, focus: document.activeElement === s, cod: !document.getElementById('auth-verify-cod') || document.getElementById('auth-verify-cod').hidden };
        });
        verifica(err.invalid === 'true' && err.text && err.text.includes(lang === 'ro' ? 'Categoria principală' : 'Main category') && err.focus, `${et} B5d: mesajul sub câmp, focus pe câmp (${JSON.stringify(err)})`);
        const su = await p.evaluate(() => localStorage.getItem('__signup'));
        verifica(!su, `${et} B5d: fără categorie, contul nu se trimite`);
        verifica(await p.inputValue('#pi-email') === 'ana@example.com' && await p.inputValue('#pi-oras') === 'Cluj-Napoca', `${et} B5d: valorile introduse rămân`);
        if (lang === 'en') {
          const { eRo } = require('./recunoaste-ro');
          const text = await p.evaluate(() => document.body.innerText);
          const ro = text.split('\n').map((x) => x.trim()).filter((x) => x && eRo(x));
          verifica(!ro.length, `${et} B5d: text românesc în EN: ${ro.slice(0, 4).join(' | ')}`);
        }
        verifica(await depaseste(p) <= 0, `${et} B5d: fără depășire`);
        await p.selectOption('#pi-domeniu', 'altceva');
        verifica(await p.getAttribute('#pi-domeniu', 'aria-invalid') === null, `${et} B5d: eroarea dispare când câmpul e corectat`);
        await p.click('#pi-trimite');
        verifica(await p.waitForSelector('#auth-verify-cod:not([hidden])', { timeout: 10000 }).then(() => true, () => false), `${et} B5d: „Altceva” fără text e o alegere validă, contul se creează`);
        verifica(!erori.length, `${et} B5d: erori JS (${erori.slice(0, 3).join(' | ')})`);
        await ctx.close();
      }
    }

    // ── B5e. Categoria dezactivată între încărcarea paginii și cod: serverul o refuză, contul nu e blocat ──
    {
      const server = serverSimulat();
      const { ctx, p } = await context(390, 'ro', server);
      await p.goto(`${baza}${PAGINA}?domeniu=hvac-climatizare`, { waitUntil: 'load' });
      await p.waitForFunction(() => document.querySelectorAll('#pi-domeniu option').length > 2, null, { timeout: 10000 });
      await completeaza(p);
      await p.click('#pi-trimite');
      await p.waitForSelector('#auth-verify-cod:not([hidden])', { timeout: 10000 }).catch(() => {});
      DB.tabele.categorii.find((c) => c.id === CAT.hvac).activ = false;
      const pre = await prinCod(p, server);
      DB.tabele.categorii.find((c) => c.id === CAT.hvac).activ = true;
      verifica(server.s.refuzuri.includes('CATEGORIE_INVALIDA'), `B5e: serverul refuză categoria inactivă (${server.s.refuzuri.join(',')})`);
      verifica(pre && pre.categorie_altceva === true && pre.categorie_id === null && await p.isVisible('#myd-panou-nou'), `B5e: salvat ca „Altceva”, partenerul ajunge în panou (${JSON.stringify(pre)})`);
      await ctx.close();
    }

    // ── B6. Stările în panou și precompletarea „Profesii” ──
    for (const [stare, insigna, motiv] of [['incomplet', 'Profil incomplet'], ['verificare', 'În verificare'], ['respins', 'Necesită completări', 'CUI-ul nu corespunde firmei.']]) {
      const server = serverSimulat({ stare, motiv });
      server.s.ciorna = { pas_curent: 1, date: { preinscriere: { categorie: 'servicii', profesie_slug: 'instalator', profesie_cod: '712601', profesie_ro: 'Instalator', nace: '43.22', oras: 'Iași' } } };
      const { ctx, p, erori } = await context(1366, 'ro', server, { sesiune: true });
      await p.goto(`${baza}/mydarrin-dashboard-partener.html?type=servicii`, { waitUntil: 'load' });
      await p.waitForSelector('#myd-panou-nou .mpn-stare', { timeout: 15000 }).catch(() => {});
      const ins = await p.textContent('.mpn-salut .mpn-insigna').catch(() => '');
      verifica(ins === insigna, `B6 ${stare}: insigna „${ins}”`);
      if (motiv) verifica((await p.textContent('#mpn-motiv')).includes(motiv), 'B6 respins: motivul verificării apare');
      if (stare === 'verificare') verifica(!(await p.$('#mpn-continua')), 'B6 în verificare: niciun buton „Continuă” (nimic de făcut acum)');
      verifica(!!(await p.$('#mpn-complet')), `B6 ${stare}: partenerul cu rol poate deschide panoul complet`);
      if (stare === 'incomplet') {
        // Profesii și dotări: NACE-ul profesiei precompletat.
        await p.click('.mpn-rand[data-mpn-rand="profesii_dotari"]');
        await p.waitForSelector('#mya-nace input[type=radio]', { timeout: 10000 }).catch(() => {});
        const principal = await p.evaluate(() => (document.querySelector('#mya-nace input[name="mya-principal"]:checked') || {}).value);
        verifica(principal === '43.22', `B6: „Profesii” precompletat cu NACE-ul profesiei (${principal})`);
        await p.click('#mya-inapoi');
        await p.waitForSelector('#myd-activare-pagina', { state: 'detached', timeout: 10000 }).catch(() => {});
        verifica(await p.isVisible('#myd-panou-nou'), 'B6: înapoi în panou din „Profesii”');
      }
      verifica(!erori.length, `B6 ${stare}: erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }
    {
      const server = serverSimulat({ stare: 'activ' });
      const { ctx, p } = await context(1366, 'ro', server, { sesiune: true });
      await p.goto(`${baza}/mydarrin-dashboard-partener.html?type=servicii`, { waitUntil: 'load' });
      await asteapta(2500);
      verifica(!(await p.$('#myd-panou-nou')), 'B6 activ: dashboard-ul obișnuit, fără panoul „cont nou”');
      await ctx.close();
    }

    // ── B7. „Devino partener” (vizitator) și „Partener” din fereastră → /parteneri/inscriere ──
    {
      const server = serverSimulat();
      const { ctx, p } = await context(1366, 'ro', server);
      await p.goto(`${baza}/cum-devii-furnizor-servicii.html`, { waitUntil: 'load' });
      await p.waitForSelector('[data-cta-partener][data-cta-stare="vizitator"]', { timeout: 10000 }).catch(() => {});
      const hrefuri = await p.evaluate(() => [...document.querySelectorAll('[data-cta-partener][data-cta-stare="vizitator"]')].map((a) => a.getAttribute('href')));
      verifica(hrefuri.length && hrefuri.every((h) => /^\/parteneri\/inscriere(\?categorie=[a-z]+)?$/.test(h)), `B7: butoanele „Devino partener” → /parteneri/inscriere (${hrefuri.join(', ')})`);
      await p.evaluate(() => window.MDCont.deschide({ tab: 'register', rol: 'partener_curier' }));
      await p.waitForURL(/mydarrin-inscriere-partener|parteneri\/inscriere/, { timeout: 8000 }).catch(() => {});
      verifica(/categorie=curier/.test(p.url()), `B7: „Partener” din fereastra de cont → pre-înscriere (${p.url()})`);
      await ctx.close();
    }

    if (CAPTURI) await capturi(baza);
  } finally {
    await browser.close();
    srv.close();
  }

  // ── Capturile pentru aprobarea LM ──
  async function capturi(bazaUrl) {
    // Pasul 12-P2: capturile „după”, la 390 px, RO și EN (docs/capturi-12p2/dupa-*.png).
    fs.mkdirSync(CAPTURI, { recursive: true });
    const br = await require('playwright').chromium.launch();
    const cale = (nume) => path.join(CAPTURI, nume);
    const pagina = async (server, lang) => {
      const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.addInitScript(([l]) => { try { if (!sessionStorage.getItem('__init')) { localStorage.setItem('myd_lang_v1', l); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, marketing: false, data: new Date().toISOString(), versiune: 2 })); sessionStorage.setItem('__init', '1'); } } catch (e) {} }, [lang]);
      await ctx.addInitScript(supabaseSimulat);
      await ctx.route((u) => /(\.supabase\.co|googletagmanager\.com|google-analytics\.com|ipapi\.co)$/.test(u.hostname) || /^\/_vercel\/insights/.test(u.pathname), (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
      await ctx.route(/\/api\//, server.trateaza);
      return { ctx, p: await ctx.newPage() };
    };
    const completeaza = async (p) => {
      await p.fill('#pi-oras', 'Iași'); await p.fill('#pi-prenume', 'Ion'); await p.fill('#pi-nume', 'Popescu');
      await p.fill('#pi-tel', '+40 712 345 678'); await p.fill('#pi-email', 'ion@gmail.com'); await p.fill('#pi-parola', 'Parola-Test-1'); await p.check('#pi-gdpr');
    };
    const gata = (p) => p.waitForFunction(() => document.querySelectorAll('#pi-domeniu option').length > 2 && !document.documentElement.classList.contains('myd-i18n-pending'), null, { timeout: 10000 }).catch(() => {});
    try {
      for (const lang of ['ro', 'en']) {
        // 1. Servicii, din reclamă (?profesie=instalator): categoria preselectată.
        {
          const server = serverSimulat();
          const { ctx, p } = await pagina(server, lang);
          await p.goto(`${bazaUrl}${PAGINA}?profesie=instalator`, { waitUntil: 'load' });
          await gata(p); await completeaza(p); await asteapta(400);
          await p.screenshot({ path: cale(`dupa-preinscriere-${lang}-390.png`), fullPage: true });
          // 2. După cod: panoul, cu „Ce lucrări faci” primul.
          await p.click('#pi-trimite');
          await p.waitForSelector('#auth-verify-cod:not([hidden])', { timeout: 10000 }).catch(() => {});
          await p.fill('#verify-cod-input', '123456');
          await p.click('#mdc-cod-btn');
          await p.waitForSelector('#myd-panou-nou .mpn-stare', { timeout: 15000 }).catch(() => {});
          await asteapta(5000);
          const h = await p.evaluate(() => document.getElementById('myd-panou-nou').scrollHeight + 70);
          await p.setViewportSize({ width: 390, height: Math.max(844, Math.min(h, 2200)) });
          await asteapta(300);
          await p.screenshot({ path: cale(`dupa-panou-${lang}-390.png`) });
          // 3. „Ce lucrări faci”: portofoliul, categoria aleasă primele.
          await p.setViewportSize({ width: 390, height: 844 });
          await p.click('.mpn-rand[data-mpn-rand="lucrari"]');
          await p.waitForSelector('#mpn-lucrari-lista input[data-mpn-serviciu]', { timeout: 10000 }).catch(() => {});
          await p.check('input[data-mpn-serviciu="s-robinet"]');
          await p.waitForSelector('#mpn-lucrari-msg .md-feedback-ok', { timeout: 8000 }).catch(() => {});
          await asteapta(300);
          await p.screenshot({ path: cale(`dupa-lucrari-${lang}-390.png`) });
          await ctx.close();
        }
        // 4. Materiale: lista de materiale. 5. Închirieri: „Altceva” + text. 6. Fără categorie: eroarea sub câmp.
        for (const [adresa, nume, actiune] of [
          ['?categorie=materiale', 'materiale', async (p) => { await p.selectOption('#pi-domeniu', { index: 2 }); }],
          ['?categorie=inchirieri', 'altceva', async (p) => { await p.selectOption('#pi-domeniu', 'altceva'); await p.fill('#pi-altceva', lang === 'ro' ? 'Remorci auto' : 'Car trailers'); }],
          ['', 'eroare', async (p) => { await p.click('#pi-trimite'); await p.waitForSelector('#pi-domeniu[aria-invalid="true"]', { timeout: 5000 }).catch(() => {}); await p.evaluate(() => window.scrollTo(0, 0)); }],
          ['?categorie=curier', 'curier', async () => {}],
        ]) {
          const server = serverSimulat();
          const { ctx, p } = await pagina(server, lang);
          await p.goto(`${bazaUrl}${PAGINA}${adresa}`, { waitUntil: 'load' });
          if (nume !== 'curier') await gata(p); else await asteapta(800);
          await completeaza(p);
          await actiune(p);
          await asteapta(500);
          await p.screenshot({ path: cale(`dupa-preinscriere-${nume}-${lang}-390.png`), fullPage: true });
          await ctx.close();
        }
      }
    } finally { await br.close(); }
  }
}

(async () => {
  await testeServer();
  await testeServer12p2();
  if (arg.includes('--doar-server')) { console.log(`\n${ok} trecute, ${esec} picate`); process.exit(esec ? 1 : 0); }
  let pw = null;
  try { pw = require('playwright'); } catch (e) { console.log('  (Playwright lipsește — partea B sărită)'); }
  if (pw) await testeBrowser();
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
