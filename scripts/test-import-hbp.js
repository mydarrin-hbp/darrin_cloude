// scripts/test-import-hbp.js
// Teste pentru importul listei de prețuri HBP pe ruta de încadrare (pasul
// 10a, 2.3, 16 oct. 2026): un fișier de test cu rânduri valide și invalide
// (Uniclass inexistent, NACE din alt capitol, descriere scurtă, fără imagine,
// fără preț…) → raport corect, cu rândul, câmpul și mesajul în RO și EN;
// produsele importate pornesc „in_asteptare”. Citește și șabloanele din
// docs/sabloane/, cu parserul CSV al paginilor (myd-csv.js).
// Supabase simulat — fără rețea.
//
// Rulare: node scripts/test-import-hbp.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

const importaCsv = require(path.join(RADACINA, 'api/marketplace/importa-csv.js'));
const R = require(path.join(RADACINA, 'lib/ruta-incadrare.js'));

// Parserul CSV al paginilor (window._mydCSV), încărcat ca în browser.
const fereastra = {};
vm.runInNewContext(fs.readFileSync(path.join(RADACINA, 'myd-csv.js'), 'utf8'), { window: fereastra });
const parseCSV = (text) => fereastra._mydCSV.parse(text);

let trecute = 0;
let picate = 0;
async function test(nume, fn) {
  try { await fn(); trecute++; console.log(`  ✓ ${nume}`); } catch (e) { picate++; console.log(`  ✗ ${nume}\n      ${e.message}`); }
}
function egal(a, b, mesaj) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${mesaj || ''} — așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(v, mesaj) { if (!v) throw new Error(mesaj || 'condiție falsă'); }

// ── Date de referință (după datele reale din 16 oct. 2026) ────────────────
const CAPITOLE = [
  { cod: 'F', sectiuni_nace: ['F'], diviziuni_nace: ['41', '42', '43'], clase_nace: [], tip_partener: 'servicii', activ: true },
  { cod: 'G', sectiuni_nace: [], diviziuni_nace: ['46', '47'], clase_nace: ['23.63'], tip_partener: 'materiale', activ: true },
  { cod: 'O77', sectiuni_nace: [], diviziuni_nace: ['77'], clase_nace: [], tip_partener: 'inchirieri', activ: true },
  { cod: 'AGR', sectiuni_nace: [], diviziuni_nace: [], clase_nace: ['01.61', '33.12', '77.31'], tip_partener: 'servicii', activ: true },
];
const NACE = ['43.22', '43.99', '46.73', '46.83', '46.84', '47.52', '47.54', '77.11', '77.31', '77.32', '77.39'];
// Nodurile de materiale există azi fără capitol_cod / nace_clasa; nodul din
// O77 e cel propus pentru pasul 10 (azi nu există niciun nod de închirieri).
const NODURI = [
  { id: 'n-robinete', slug: 'robinete-colectoare', title: 'Robinete și colectoare', title_en: null, capitol_cod: null, nace_clasa: null, category_type: 'materiale', activ: true },
  { id: 'n-g-fierarie', slug: 'fierarie', title: 'Fierărie', title_en: 'Hardware', capitol_cod: 'G', nace_clasa: '47.52', category_type: 'materiale', activ: true },
  { id: 'n-sanitar', slug: 'instalatii-sanitare', title: 'Instalații sanitare, termice și climatizare', title_en: 'Plumbing, heating and air conditioning', capitol_cod: 'F', nace_clasa: '43.22', category_type: 'servicii', activ: true },
  { id: 'n-o77-utilaje', slug: 'utilaje-constructii', title: 'Utilaje pentru construcții', title_en: 'Construction machinery', capitol_cod: 'O77', nace_clasa: '77.32', category_type: 'inchirieri', activ: true },
];
const UNICLASS = [
  { code: 'Pr_65_54_95_16', is_active: true },
  { code: 'Pr_20_29_03_78', is_active: false },
  { code: 'Ac_10_40_63', is_active: true },
];
const HBP = 'p-hbp';
const IMAGINE = 'https://aacojyvujhywanaulvuu.supabase.co/storage/v1/object/public/marketplace-media/hbp/robinet.jpg';
const DESCRIERE = 'Robinet cu sferă din alamă nichelată, filet interior 1/2 țoli, pentru instalații de apă rece și caldă; presiune nominală indicată de producător.';

function reseteaza() {
  DB.tabele = {
    profiles: [{ id: HBP, roles: ['partener_materiale'], tara: 'RO' }, { id: 'u-super', roles: ['superadmin'] }],
    partners: [{ id: HBP, cui: 'RO46577229' }],
    categorii: NODURI.map((n) => ({ ...n })),
    meniu_capitole: CAPITOLE,
    nace_reference: NACE.map((cod) => ({ cod, nivel: 'clasa' })),
    uniclass_codes: UNICLASS,
    tax_configurations: [{ tara_cod: 'RO', moneda: 'RON', cota_tva: 21 }],
    marketplace_importuri_csv: [],
    marketplace_materiale: [],
    marketplace_echipamente: [],
  };
  DB.implicite = { marketplace_importuri_csv: { cursor_pozitie: 0, randuri_procesate: 0, randuri_erori: 0, erori_detalii: [], status: 'procesare' } };
  DB.utilizatori = { 'tok-hbp': { id: HBP }, 'tok-super': { id: 'u-super' } };
}

// Fișierul de test: exact formatul din docs/sabloane/import-hbp-materiale.csv.
const COLOANE_MAT = 'cod_produs_furnizor,denumire_produs,descriere,descriere_pret,unitate_masura,pret_fara_tva,cota_tva,moneda,stoc_disponibil,lead_time_zile,nod_menu,nace_cod,cod_uniclass,imagine_url_1,imagine_url_2,imagine_url_3,imagine_url_4,imagine_url_5,imagine_url_6,ambalaj,specificatii_tehnice,este_consumabil,cui_furnizor';
const r = (cod, { denumire = `Produs ${cod}`, descriere = DESCRIERE, pret = '25.50', cota = '21', nod = 'robinete-colectoare', nace = '47.52', uniclass = 'Pr_65_54_95_16', imagine = IMAGINE } = {}) =>
  [cod, denumire, `"${descriere}"`, 'Preț per bucată', 'buc', pret, cota, 'RON', '10', '2', nod, nace, uniclass, imagine, '', '', '', '', '', '', '', 'false', 'RO46577229'].join(',');
const FISIER_MAT = [
  COLOANE_MAT,
  r('OK-1'),                                               // 1 valid (nod fără capitol → avertisment A5)
  r('OK-2', { nod: 'fierarie' }),                          // 2 valid, nod din G cu clasa 47.52
  r('ERR-UNI', { uniclass: 'Pr_99_99_99_99' }),            // 3 Uniclass inexistent
  r('ERR-NACE', { nace: '43.22' }),                        // 4 NACE din capitolul F
  r('ERR-DESC', { descriere: 'Prea scurtă.' }),            // 5 descriere scurtă
  r('ERR-IMG', { imagine: '' }),                           // 6 fără imagine
  r('ERR-PRET', { pret: '' }),                             // 7 fără preț
  r('ERR-NOD', { nod: 'instalatii-sanitare' }),            // 8 nod din capitolul F
  r('ERR-RETRAS', { uniclass: 'Pr_20_29_03_78' }),         // 9 Uniclass retras
  r('ERR-AC', { uniclass: 'Ac_10_40_63' }),                // 10 Uniclass Ac_ la un material
  r('ERR-TVA', { cota: '19' }),                            // 11 cota TVA alta decât a țării
  r('ERR-NODLIPSA', { nod: 'nu-exista' }),                 // 12 nod inexistent
  r('ERR-CLASANOD', { nod: 'fierarie', nace: '47.54' }),   // 13 clasa produsului ≠ clasa nodului
].join('\r\n');

async function importa(token, tip, randuri) {
  let jobId = null;
  const erori = [];
  const avertismente = [];
  let ultim;
  for (let pas = 0; pas < 10; pas++) {
    const res = raspuns();
    await importaCsv(cerere({ metoda: 'POST', token, body: { tip, randuri, job_id: jobId } }), res);
    if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.corp)}`);
    ultim = res.corp;
    jobId = ultim.job_id;
    erori.push(...ultim.erori);
    avertismente.push(...ultim.avertismente);
    if (!ultim.continua) break;
  }
  return { ultim, erori, avertismente };
}
const SEP = String.fromCharCode(10);
const eroriRand = (erori, n) => erori.filter((e) => e.rand === n);

(async () => {
  console.log('1. Materiale: fișier cu rânduri valide și invalide');
  reseteaza();
  const { records } = parseCSV(FISIER_MAT);
  const { ultim, erori, avertismente } = await importa('tok-hbp', 'materiale', records);

  await test('2 rânduri importate, 11 respinse', async () => {
    egal([ultim.randuri_procesate, ultim.randuri_erori], [13, 11]);
    egal(DB.tabele.marketplace_materiale.map((p) => p.cod_produs_furnizor), ['OK-1', 'OK-2']);
  });
  await test('produsele importate pornesc „in_asteptare”, pe nodul ales, pe furnizorul HBP', async () => {
    egal(DB.tabele.marketplace_materiale.map((p) => [p.status, p.categorie_id, p.furnizor_id]), [['in_asteptare', 'n-robinete', HBP], ['in_asteptare', 'n-g-fierarie', HBP]]);
    egal(DB.tabele.marketplace_materiale[0].pret_cu_tva, 30.86, 'preț cu TVA 21%');
  });
  await test('nod de materiale fără capitol → acceptat, cu avertismentul A5 (RO și EN)', async () => {
    egal(avertismente.map((a) => [a.rand, a.cod, a.camp]), [[1, 'A5', 'nod_menu']]);
    adevarat(avertismente[0].mesaj_en && /step 10/.test(avertismente[0].mesaj_en), avertismente[0].mesaj_en);
  });
  const asteptat = [
    [3, 'cod_uniclass', /nu există/, /does not exist/],
    [4, 'nace_cod', /capitolul F.*capitolul G/, /chapter F.*chapter G/],
    [5, 'descriere', /între 100 și 1000/, /between 100 and 1,000/],
    [6, 'imagini', /cel puțin o imagine/, /At least one main image/],
    [7, 'pret_fara_tva', /Preț fără TVA/, /price excl\. VAT/],
    [8, 'nod_menu', /capitolul F/, /chapter F/],
    [9, 'cod_uniclass', /retras/, /withdrawn/],
    [10, 'cod_uniclass', /tabelul greșit/, /wrong table/],
    [11, 'cota_tva', /Cota TVA din fișier \(19%\)/, /VAT rate in the file \(19%\)/],
    [12, 'nod_menu', /nu există sau e inactiv/, /does not exist or is inactive/],
    [13, 'nace_cod', /diferă de clasa nodului/, /differs from the class of node/],
  ];
  for (const [rand, camp, ro, en] of asteptat) {
    await test(`rândul ${rand}: eroare pe „${camp}”, cu mesaj RO și EN`, async () => {
      const e = eroriRand(erori, rand).find((x) => x.camp === camp);
      adevarat(e, `nicio eroare pe ${camp}: ${JSON.stringify(eroriRand(erori, rand))}`);
      adevarat(ro.test(e.mesaj), `RO: ${e.mesaj}`);
      adevarat(en.test(e.mesaj_en), `EN: ${e.mesaj_en}`);
      adevarat(e.produs && e.produs.startsWith('Produs '), 'denumirea produsului lipsește din raport');
    });
  }
  await test('nicio eroare fără traducere EN', async () => {
    adevarat(erori.every((e) => e.mesaj_en && e.mesaj_en !== e.mesaj), JSON.stringify(erori.filter((e) => !e.mesaj_en || e.mesaj_en === e.mesaj)));
  });
  await test('coloanele *_en ajung în traduceri.en', async () => {
    const coloane = COLOANE_MAT + ',denumire_en,descriere_en,descriere_pret_en';
    await importa('tok-hbp', 'materiale', parseCSV([coloane, r('EN-1') + ',Brass ball valve,"' + 'English description of the valve. '.repeat(4) + '",Price per piece'].join(SEP)).records);
    const p = DB.tabele.marketplace_materiale.find((x) => x.cod_produs_furnizor === 'EN-1');
    egal(p.traduceri.en.denumire, 'Brass ball valve');
    egal(p.traduceri.en.descriere_pret, 'Price per piece');
  });
  await test('fără coloana traduceri (migrare neaplicată) → produsul se salvează fără traducere', async () => {
    DB.coloane.marketplace_materiale = Object.keys(DB.tabele.marketplace_materiale[0]).filter((c) => c !== 'traduceri');
    const coloane = COLOANE_MAT + ',denumire_en';
    await importa('tok-hbp', 'materiale', parseCSV([coloane, r('EN-2') + ',Valve'].join(SEP)).records);
    const p = DB.tabele.marketplace_materiale.find((x) => x.cod_produs_furnizor === 'EN-2');
    adevarat(p && !p.traduceri, JSON.stringify(p));
    delete DB.coloane.marketplace_materiale;
  });
  await test('reimportul aceluiași cod actualizează rândul, nu îl dublează', async () => {
    await importa('tok-hbp', 'materiale', parseCSV([COLOANE_MAT, r('OK-1', { pret: '27.00' })].join('\n')).records);
    egal(DB.tabele.marketplace_materiale.filter((p) => p.cod_produs_furnizor === 'OK-1').map((p) => p.pret_fara_tva), [27]);
  });

  console.log('2. Importul din back-office');
  await test('superadminul importă pentru HBP (cui_furnizor) → tot „in_asteptare”, nu „live”', async () => {
    reseteaza();
    await importa('tok-super', 'materiale', parseCSV([COLOANE_MAT, r('ADM-1')].join('\n')).records);
    egal(DB.tabele.marketplace_materiale.map((p) => [p.furnizor_id, p.status]), [[HBP, 'in_asteptare']]);
  });

  console.log('3. Închirieri');
  const COLOANE_ECH = 'cod_produs_furnizor,denumire_produs,descriere,descriere_pret,tarif_zi,tarif_ora,tarif_saptamana,cota_tva,moneda,buc_disponibile,operator_inclus,nod_menu,nace_cod,cod_uniclass,imagine_url_1,imagine_url_2,imagine_url_3,imagine_url_4,imagine_url_5,imagine_url_6,specificatii_tehnice,cui_furnizor';
  const e = (cod, { operator = 'fara_operator', nod = 'utilaje-constructii', nace = '77.32', tarif = '120' } = {}) =>
    [cod, `Utilaj ${cod}`, `"${DESCRIERE}"`, 'Preț per zi', tarif, '', '', '21', 'RON', '2', operator, nod, nace, '', IMAGINE, '', '', '', '', '', '', 'RO46577229'].join(',');
  reseteaza();
  const ech = await importa('tok-hbp', 'echipamente', parseCSV([COLOANE_ECH, e('U-OK'), e('U-OP', { operator: 'operator_obligatoriu' }), e('U-NACE', { nace: '43.99' }), e('U-AGR', { nace: '77.31' }), e('U-NODMAT', { nod: 'robinete-colectoare' })].join('\n')).records);
  await test('utilaj fără operator, 77.32, nod din O77 → importat „in_asteptare”', async () => {
    egal(DB.tabele.marketplace_echipamente.map((p) => [p.cod_produs_furnizor, p.status, p.categorie_id]), [['U-OK', 'in_asteptare', 'n-o77-utilaje']]);
  });
  await test('operator obligatoriu → serviciu 43.99, nu închiriere', async () => {
    const x = eroriRand(ech.erori, 2).find((y) => y.camp === 'operator_inclus');
    adevarat(x && /43\.99/.test(x.mesaj) && /43\.99/.test(x.mesaj_en), JSON.stringify(eroriRand(ech.erori, 2)));
  });
  await test('NACE 43.99 (capitolul F) la o închiriere → eroare pe nace_cod', async () => {
    adevarat(eroriRand(ech.erori, 3).some((y) => y.camp === 'nace_cod' && /capitolul F/.test(y.mesaj)), JSON.stringify(eroriRand(ech.erori, 3)));
  });
  await test('NACE 77.31 (capitolul AGR, nu O77) → eroare pe nace_cod', async () => {
    adevarat(eroriRand(ech.erori, 4).some((y) => y.camp === 'nace_cod' && /AGR/.test(y.mesaj)), JSON.stringify(eroriRand(ech.erori, 4)));
  });
  await test('nod de materiale la o închiriere → eroare pe nod_menu', async () => {
    adevarat(eroriRand(ech.erori, 5).some((y) => y.camp === 'nod_menu'), JSON.stringify(eroriRand(ech.erori, 5)));
  });

  console.log('4. Șabloanele din docs/sabloane');
  for (const [fisier, tip] of [['import-hbp-materiale.csv', 'materiale'], ['import-hbp-materiale_EN.csv', 'materiale'], ['import-hbp-inchirieri.csv', 'echipamente'], ['import-hbp-inchirieri_EN.csv', 'echipamente']]) {
    await test(`${fisier}: se citește (1 rând-exemplu), cu toate coloanele, iar exemplul nu trece la import`, async () => {
      const { header, records: rr } = parseCSV(fs.readFileSync(path.join(RADACINA, 'docs/sabloane', fisier), 'utf8'));
      egal(rr.length, 1);
      for (const c of ['cod_produs_furnizor', 'denumire_produs', 'descriere', 'descriere_pret', 'cota_tva', 'moneda', 'nod_menu', 'nace_cod', 'cod_uniclass', 'imagine_url_1', tip === 'materiale' ? 'pret_fara_tva' : 'tarif_zi']) {
        adevarat(header.includes(c), `lipsește coloana ${c}`);
      }
      reseteaza();
      const rez = await importa('tok-hbp', tip, rr);
      egal(rez.ultim.randuri_erori, 1, 'rândul-exemplu (cu <…>) trebuie respins');
    });
  }

  console.log('5. Motorul: valideazaRutaProdus');
  await test('material corect pe nod din G → fără erori și fără avertismente', async () => {
    const v = R.valideazaRutaProdus({ tip: 'materiale', produs: { nace_cod: '47.52', cod_uniclass: 'Pr_65_54_95_16', nod_menu: 'fierarie' }, nod: NODURI[1], uniclass: UNICLASS[0], ref: { capitole: CAPITOLE, naceClase: NACE } });
    egal([v.ok, v.erori.length, v.avertismente.length], [true, 0, 0]);
  });
  await test('valideazaRuta pentru servicii rămâne neschimbată (aceleași exporturi)', async () => {
    adevarat(typeof R.valideazaRuta === 'function' && typeof R.serviciiAsemanatoare === 'function');
  });

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
})();
