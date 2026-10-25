// scripts/test-identitate-pf.js
// Teste pentru pasul 11-P2a (25 oct. 2026): datele de identificare ale
// investitorilor persoane fizice, peste un Supabase simulat
// (scripts/supabase-simulat.js) — nimic nu ajunge la Supabase sau la producție:
//   A. lib/identitate-pf.js: CNP valid / cifră de control greșită / dată
//      imposibilă / rezident străin (7/8); vârsta (minor de 17 ani); NIF valid /
//      invalid; amprenta HMAC; mascarea;
//   B. pasul 1 (api/investitori/kyc.js): fără CNP pentru cetățean RO → 400 cu
//      `camp`; CNP cu altă dată decât cea declarată; minor refuzat; NIF pentru
//      străini; același CNP pe două conturi → 409 ID_FISCAL_FOLOSIT; câmpul gol
//      păstrează valoarea salvată; fără KYC_HMAC_SECRET → 500, nimic salvat;
//   C. pasul 2: seria și numărul actului, criptate; act expirat refuzat;
//   D. proprietarul nu primește niciodată valorile în clar;
//   E. back-office (api/admin/investitori-kyc.js): lista mascată; acțiunea
//      date_identitate fără drept → 403, cu drept → valori + rând în audit_log;
//      fără rândul de audit, datele nu se trimit.
// Secretul HMAC e o valoare de test, setată doar în acest proces.
// Rulare: node scripts/test-identitate-pf.js

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

const SECRET_TEST = 'test-' + '0'.repeat(59);
process.env.KYC_HMAC_SECRET = SECRET_TEST;

function stub(fisier, exp) {
  const p = require.resolve(path.join(RADACINA, fisier));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };
}
stub('lib/rate-limit.js', { checkRateLimit: async () => true });
stub('lib/contact-platforma.js', { incarcaContactPlatformaSigur: async () => null, incarcaContactPlatforma: async () => null, contactPlatformaDinCache: () => null });

const I = require(path.join(RADACINA, 'lib/identitate-pf.js'));
const K = require(path.join(RADACINA, 'lib/investitori-kyc.js'));
const apiKyc = require(path.join(RADACINA, 'api/investitori/kyc.js'));
const apiAdminKyc = require(path.join(RADACINA, 'api/admin/investitori-kyc.js'));

const A = '40000000-0000-4000-8000-00000000000a';
const B = '40000000-0000-4000-8000-00000000000b';
const ADMIN = '40000000-0000-4000-8000-0000000000ad';
const SUPER = '40000000-0000-4000-8000-0000000000sa';
const IBAN = 'RO49AAAA1B31007593840000';

// Cifra de control calculată independent de lib (cheia oficială 279146358279).
function cuControl(primele12) {
  const cheie = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9];
  const r = primele12.split('').reduce((s, c, i) => s + Number(c) * cheie[i], 0) % 11;
  return primele12 + (r === 10 ? 1 : r);
}
const CNP_A = cuControl('185031440123');      // bărbat, 14.03.1985
const CNP_B = cuControl('296112540017');      // femeie, 25.11.1996
const CNP_STRAIN = cuControl('790072040011'); // rezident străin, 20.07.(19)90
const ACT_A = 'RX 123456';

// Data de azi deplasată cu `ani` ani, „AAAA-LL-ZZ”.
function dataPeste(ani, zile = 0) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + ani);
  d.setUTCDate(d.getUTCDate() + zile);
  return d.toISOString().slice(0, 10);
}

const ADRESA_RO = { strada: 'Str. Exemplu nr. 1', localitate: 'Cluj-Napoca', judet: 'Cluj', cod_postal: '400001', tara: 'RO' };
const PAS1 = (x = {}) => Object.assign({
  prenume: 'Ana', nume: 'Albu', telefon: '+40700000001', tara: 'RO', iban: IBAN,
  data_nasterii: '1985-03-14', cetatenie: 'RO', adresa_domiciliu: ADRESA_RO, id_fiscal_tip: 'cnp', id_fiscal: CNP_A,
}, x);

function reset() {
  DB.tabele = {
    profiles: [
      { id: A, email: 'a@test', roles: ['client'], tara: 'RO' },
      { id: B, email: 'b@test', roles: ['client'], tara: 'RO' },
      { id: ADMIN, email: 'admin@test', roles: ['admin'] },
      { id: SUPER, email: 'super@test', roles: ['superadmin'] },
    ],
    investitori_kyc: [], investitori_portofoliu: [], audit_log: [], admin_permissions: [],
  };
  DB.coloane = {};
  DB.storage = {};
  DB.rpc = {
    cripteaza_camp: async ({ valoare }) => 'cripta:' + Buffer.from(valoare).toString('base64'),
    decripteaza_camp: async ({ valoare_criptata }) => Buffer.from(String(valoare_criptata).replace(/^cripta:/, ''), 'base64').toString(),
  };
  DB.utilizatori = {
    'tok-a': { id: A, email: 'a@test', user_metadata: { prenume: 'Ana', nume: 'Albu' } },
    'tok-b': { id: B, email: 'b@test', user_metadata: {} },
    'tok-admin': { id: ADMIN, email: 'admin@test' },
    'tok-super': { id: SUPER, email: 'super@test' },
  };
  process.env.KYC_HMAC_SECRET = SECRET_TEST;
}

let ok = 0, esec = 0;
async function test(nume, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + nume); }
  catch (e) { esec++; console.log('  ✗ ' + nume + ' — ' + e.message); }
}
function egal(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(c, m) { if (!c) throw new Error(m || 'condiție falsă'); }

async function cheama(api, { token, metoda = 'GET', body = null, query = {} }) {
  const res = raspuns();
  await api(cerere({ metoda, token, body, query }), res);
  return res;
}
const pas1 = (token, date) => cheama(apiKyc, { token, metoda: 'POST', body: { pas: 1, date } });
const pas2 = (token, date) => cheama(apiKyc, { token, metoda: 'POST', body: { pas: 2, date: Object.assign({ tip_document: 'pasaport', document_fata_path: A + '/fata-1.jpg' }, date) } });
const kycA = () => DB.tabele.investitori_kyc.find((k) => k.user_id === A);

// Nicio valoare sensibilă în clar (nici forma criptată, nici amprenta) în răspuns.
function faraValoriInClar(corp) {
  const t = JSON.stringify(corp);
  for (const v of [CNP_A, ACT_A, 'RX123456', 'cripta:']) adevarat(!t.includes(v), 'răspunsul conține ' + v);
  const h = kycA() && kycA().cnp_hash;
  if (h) adevarat(!t.includes(h), 'răspunsul conține amprenta cnp_hash');
}

(async () => {
  console.log('A. lib/identitate-pf.js');
  await test('CNP valid → data nașterii din CNP (1/2 → 1900, 5/6 → 2000, 3/4 → 1800)', async () => {
    egal(I.valideazaCnp(CNP_A), { ok: true, data_nasterii: '1985-03-14' });
    egal(I.valideazaCnp(CNP_B), { ok: true, data_nasterii: '1996-11-25' });
    egal(I.valideazaCnp(cuControl('503021540012')).data_nasterii, '2003-02-15');
    egal(I.valideazaCnp(cuControl('399123140019')).data_nasterii, '1899-12-31');
    egal(I.valideazaCnp(' ' + CNP_A.slice(0, 6) + ' ' + CNP_A.slice(6)).ok, true, 'cu spații');
  });
  await test('CNP cu cifra de control greșită / prima cifră 0 sau 9 / alt format → invalid', async () => {
    const gresit = CNP_A.slice(0, 12) + ((Number(CNP_A[12]) + 1) % 10);
    egal(I.valideazaCnp(gresit), { ok: false });
    egal(I.valideazaCnp(cuControl('085031440123')), { ok: false });
    egal(I.valideazaCnp(cuControl('985031440123')), { ok: false });
    egal(I.valideazaCnp(CNP_A.slice(0, 12)), { ok: false });
    egal(I.valideazaCnp('18503144012AB'), { ok: false });
    egal(I.valideazaCnp(null), { ok: false });
  });
  await test('CNP cu dată imposibilă (31 februarie, luna 13) → invalid', async () => {
    egal(I.valideazaCnp(cuControl('185023140123')), { ok: false });
    egal(I.valideazaCnp(cuControl('185130140123')), { ok: false });
    egal(I.valideazaCnp(cuControl('100022940123')), { ok: false }, '1900 nu e an bisect');
    egal(I.valideazaCnp(cuControl('500022940123')).data_nasterii, '2000-02-29', '2000 e an bisect');
  });
  await test('rezident străin (7/8): secolul din anul datei declarate', async () => {
    egal(I.valideazaCnp(CNP_STRAIN, '1990-07-20'), { ok: true, data_nasterii: '1990-07-20' });
    egal(I.valideazaCnp(cuControl('705010340011'), '2005-01-03').data_nasterii, '2005-01-03');
  });
  await test('vârsta: 18 ani împliniți azi → 18; cu o zi mai puțin → 17; dată invalidă → null', async () => {
    const azi = new Date();
    egal(I.varsta(dataPeste(-18), azi), 18);
    egal(I.varsta(dataPeste(-18, 1), azi), 17);
    egal(I.varsta('2001-02-30', azi), null);
  });
  await test('NIF: 4–30 caractere, litere, cifre, spațiu, „-” și „/”', async () => {
    for (const v of ['DE123456789', '12 345/678-9', 'ABCD', 'A'.repeat(30)]) adevarat(I.valideazaNif(v), 'valid: ' + v);
    for (const v of ['ABC', 'A'.repeat(31), 'DE#123', 'DE_123', '', null]) adevarat(!I.valideazaNif(v), 'invalid: ' + v);
  });
  await test('amprenta: HMAC-SHA256 pe „tip:valoare normalizată”, în hex; fără secret → eroare', async () => {
    reset();
    const h = I.hashIdFiscal('nif', ' de 123 ');
    adevarat(/^[0-9a-f]{64}$/.test(h), 'hex de 64 de caractere');
    const asteptat = require('crypto').createHmac('sha256', SECRET_TEST).update('nif:DE123').digest('hex');
    egal(h, asteptat);
    adevarat(I.hashIdFiscal('cnp', CNP_A) !== I.hashIdFiscal('nif', CNP_A), 'tipul intră în amprentă');
    process.env.KYC_HMAC_SECRET = 'scurt';
    let aruncat = false;
    try { I.hashIdFiscal('cnp', CNP_A); } catch (e) { aruncat = e.message === 'KYC_HMAC_SECRET lipsește'; }
    adevarat(aruncat, 'secret mai scurt de 32 de caractere → eroare');
    delete process.env.KYC_HMAC_SECRET;
    adevarat(!I.secretDisponibil(), 'fără secret');
    reset();
  });
  await test('mascarea: •••••••••123, fără lungimea reală', async () => {
    egal(I.mascheaza('1850314401234'), '•••••••••234');
    egal(I.mascheaza('234'), '•••••••••234');
    egal(I.mascheaza('ABCDEF', 2), '•••••••••EF');
    egal(I.mascheaza(null), null);
  });

  console.log('B. Pasul 1');
  await test('cetățean RO fără CNP → 400, cod id_fiscal_lipsa, camp id_fiscal, mesaj RO + EN', async () => {
    reset();
    const r = await pas1('tok-a', PAS1({ id_fiscal: '' }));
    egal(r.statusCode, 400); egal(r.corp.cod, 'id_fiscal_lipsa'); egal(r.corp.camp, 'id_fiscal');
    adevarat(r.corp.error && r.corp.error_en, 'mesaj RO + EN');
    egal(DB.tabele.investitori_kyc.length, 0);
  });
  await test('CNP valid: salvat criptat, cu ultimele 3 cifre și amprenta HMAC', async () => {
    reset();
    const r = await pas1('tok-a', PAS1());
    egal(r.statusCode, 200);
    const k = kycA();
    egal([k.id_fiscal_tip, k.id_fiscal_ultimele3, k.data_nasterii, k.cetatenie], ['cnp', CNP_A.slice(-3), '1985-03-14', 'RO']);
    adevarat(k.id_fiscal_criptat && !k.id_fiscal_criptat.includes(CNP_A), 'criptat, nu în clar');
    egal(k.cnp_hash, I.hashIdFiscal('cnp', CNP_A));
    egal(k.adresa_domiciliu, ADRESA_RO);
  });
  await test('CNP invalid → cnp_invalid; CNP cu altă dată decât cea declarată → cnp_data', async () => {
    reset();
    const r1 = await pas1('tok-a', PAS1({ id_fiscal: CNP_A.slice(0, 12) + ((Number(CNP_A[12]) + 1) % 10) }));
    egal([r1.statusCode, r1.corp.cod, r1.corp.camp], [400, 'cnp_invalid', 'id_fiscal']);
    const r2 = await pas1('tok-a', PAS1({ data_nasterii: '1985-03-15' }));
    egal([r2.statusCode, r2.corp.cod, r2.corp.camp], [400, 'cnp_data', 'id_fiscal']);
    egal(DB.tabele.investitori_kyc.length, 0);
  });
  await test('minor (17 ani) refuzat; 18 ani împliniți azi acceptat', async () => {
    reset();
    const nascut17 = dataPeste(-18, 1);
    const cnp17 = cuControl('6' + nascut17.slice(2, 4) + nascut17.slice(5, 7) + nascut17.slice(8, 10) + '40011');
    const r = await pas1('tok-a', PAS1({ data_nasterii: nascut17, id_fiscal: cnp17 }));
    egal([r.statusCode, r.corp.cod, r.corp.camp], [400, 'minor', 'data_nasterii']);
    const nascut18 = dataPeste(-18);
    const cnp18 = cuControl('6' + nascut18.slice(2, 4) + nascut18.slice(5, 7) + nascut18.slice(8, 10) + '40011');
    egal((await pas1('tok-a', PAS1({ data_nasterii: nascut18, id_fiscal: cnp18 }))).statusCode, 200);
  });
  await test('data nașterii lipsă / în viitor; cetățenie lipsă; adresa incompletă (județ doar pentru RO)', async () => {
    reset();
    egal((await pas1('tok-a', PAS1({ data_nasterii: '' }))).corp.camp, 'data_nasterii');
    egal((await pas1('tok-a', PAS1({ data_nasterii: dataPeste(1) }))).corp.cod, 'data_nasterii');
    egal((await pas1('tok-a', PAS1({ cetatenie: '' }))).corp.camp, 'cetatenie');
    egal((await pas1('tok-a', PAS1({ adresa_domiciliu: { ...ADRESA_RO, strada: '' } }))).corp.camp, 'adresa_strada');
    egal((await pas1('tok-a', PAS1({ adresa_domiciliu: { ...ADRESA_RO, localitate: '' } }))).corp.camp, 'adresa_localitate');
    egal((await pas1('tok-a', PAS1({ adresa_domiciliu: { ...ADRESA_RO, judet: '' } }))).corp.camp, 'adresa_judet');
    egal((await pas1('tok-a', PAS1({ adresa_domiciliu: { ...ADRESA_RO, tara: '' } }))).corp.camp, 'adresa_tara');
    egal(DB.tabele.investitori_kyc.length, 0);
    egal((await pas1('tok-a', PAS1({ adresa_domiciliu: { strada: 'Hauptstr. 5', localitate: 'Berlin', tara: 'DE' } }))).statusCode, 200, 'fără județ în afara RO');
  });
  await test('străin: NIF valid → nif; NIF invalid → nif_invalid; CNP de rezident străin (7) → cnp', async () => {
    reset();
    const r = await pas1('tok-a', PAS1({ cetatenie: 'DE', id_fiscal_tip: 'nif', id_fiscal: 'de 123 456 789' }));
    egal(r.statusCode, 200);
    egal([kycA().id_fiscal_tip, kycA().id_fiscal_ultimele3, kycA().cnp_hash], ['nif', '789', I.hashIdFiscal('nif', 'DE123456789')]);
    const r2 = await pas1('tok-b', PAS1({ cetatenie: 'DE', id_fiscal_tip: 'nif', id_fiscal: 'DE#1' }));
    egal([r2.statusCode, r2.corp.cod, r2.corp.camp], [400, 'nif_invalid', 'id_fiscal']);
    const r3 = await pas1('tok-b', PAS1({ cetatenie: 'IT', data_nasterii: '1990-07-20', id_fiscal_tip: 'nif', id_fiscal: CNP_STRAIN }));
    egal(r3.statusCode, 200);
    egal(DB.tabele.investitori_kyc.find((k) => k.user_id === B).id_fiscal_tip, 'cnp');
  });
  await test('același CNP pe două conturi → 409 ID_FISCAL_FOLOSIT, fără să spună care cont', async () => {
    reset();
    egal((await pas1('tok-a', PAS1())).statusCode, 200);
    const r = await pas1('tok-b', PAS1({ prenume: 'Bianca', iban: 'DE89370400440532013000' }));
    egal(r.statusCode, 409); egal(r.corp.cod, 'ID_FISCAL_FOLOSIT'); egal(r.corp.camp, 'id_fiscal');
    egal(r.corp.error, 'Acest CNP / număr fiscal e deja folosit de alt cont. Scrie-ne la investor@homebestpal.com.');
    egal(r.corp.error_en, 'This personal / tax ID number is already used by another account. Write to us at investor@homebestpal.com.');
    const t = JSON.stringify(r.corp);
    adevarat(!t.includes(A) && !t.includes('a@test') && !t.includes('Albu'), 'nu dezvăluie contul');
    egal(DB.tabele.investitori_kyc.length, 1, 'nimic salvat pentru B');
    egal((await pas1('tok-a', PAS1())).statusCode, 200, 'același cont își poate retrimite CNP-ul');
  });
  await test('indexul unic din baza de date (23505 pe cnp_hash) → tot 409', async () => {
    reset();
    egal((await pas1('tok-a', PAS1())).statusCode, 200);
    // ca o cursă: interogarea de verificare nu vede rândul, dar indexul îl refuză
    const original = sim.supabaseAdmin.from;
    sim.supabaseAdmin.from = (t) => {
      const q = original(t);
      if (t !== 'investitori_kyc') return q;
      const neq = q.neq; q.neq = (...a) => { neq(...a); q.eq('user_id', '__nimeni__'); return q; };
      const insert = q.insert; q.insert = (d) => { insert(d); q.then = (ok) => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "investitori_kyc_cnp_hash_unic" (cnp_hash)' } }).then(ok); return q; };
      return q;
    };
    try {
      const r = await pas1('tok-b', PAS1());
      egal([r.statusCode, r.corp.cod], [409, 'ID_FISCAL_FOLOSIT']);
    } finally { sim.supabaseAdmin.from = original; }
  });
  await test('CNP gol la retrimitere păstrează valoarea salvată; după schimbarea cetățeniei trebuie reintrodus', async () => {
    reset();
    await pas1('tok-a', PAS1());
    const inainte = { ...kycA() };
    const r = await pas1('tok-a', PAS1({ id_fiscal: '', iban: '', telefon: '+40700000009' }));
    egal(r.statusCode, 200);
    egal([kycA().id_fiscal_criptat, kycA().cnp_hash, kycA().iban_criptat], [inainte.id_fiscal_criptat, inainte.cnp_hash, inainte.iban_criptat]);
    egal(kycA().date_personale.telefon, '+40700000009');
    const r2 = await pas1('tok-a', PAS1({ id_fiscal: '', cetatenie: 'DE' }));
    egal([r2.statusCode, r2.corp.cod], [400, 'id_fiscal_lipsa'], 'altă cetățenie');
    const r3 = await pas1('tok-a', PAS1({ id_fiscal: '', data_nasterii: '1985-03-15' }));
    egal([r3.statusCode, r3.corp.cod], [400, 'id_fiscal_lipsa'], 'altă dată a nașterii, CNP nereverificat');
  });
  await test('fără KYC_HMAC_SECRET (sau mai scurt de 32) → 500 intern, nimic salvat, mesaj în log', async () => {
    for (const secret of [undefined, 'a'.repeat(31)]) {
      reset();
      if (secret === undefined) delete process.env.KYC_HMAC_SECRET; else process.env.KYC_HMAC_SECRET = secret;
      const log = []; const ce = console.error; console.error = (...a) => log.push(a.join(' '));
      let r;
      try { r = await pas1('tok-a', PAS1()); } finally { console.error = ce; }
      egal([r.statusCode, r.corp.cod], [500, 'intern']);
      egal(DB.tabele.investitori_kyc.length, 0);
      adevarat(log.some((l) => l.includes('KYC_HMAC_SECRET lipsește')), 'mesajul din log');
      adevarat(!log.join(' ').includes(SECRET_TEST), 'secretul nu apare în log');
    }
    reset();
  });

  console.log('C. Pasul 2: actul de identitate');
  await test('seria și numărul: salvate criptat, cu ultimele 3 caractere; câmpul gol păstrează valoarea', async () => {
    reset();
    const r = await pas2('tok-a', { act_serie_numar: ' rx  123456 ', act_valabil_pana: dataPeste(5) });
    egal(r.statusCode, 200);
    const k = kycA();
    egal([k.act_ultimele3, k.act_valabil_pana], ['456', dataPeste(5)]);
    adevarat(k.act_serie_numar_criptat && !Buffer.from(k.act_serie_numar_criptat.replace('cripta:', ''), 'base64').toString().includes('  '), 'normalizat');
    egal(Buffer.from(k.act_serie_numar_criptat.replace('cripta:', ''), 'base64').toString(), ACT_A);
    const criptat = k.act_serie_numar_criptat;
    egal((await pas2('tok-a', { act_serie_numar: '', act_valabil_pana: dataPeste(6) })).statusCode, 200);
    egal(kycA().act_serie_numar_criptat, criptat);
  });
  await test('act expirat → act_expirat; fără dată → act_valabil_pana; serie prea scurtă / lipsă → act_serie_numar', async () => {
    reset();
    const r = await pas2('tok-a', { act_serie_numar: ACT_A, act_valabil_pana: dataPeste(0, -1) });
    egal([r.statusCode, r.corp.cod, r.corp.camp], [400, 'act_expirat', 'act_valabil_pana']);
    adevarat(r.corp.error && r.corp.error_en, 'mesaj RO + EN');
    egal((await pas2('tok-a', { act_serie_numar: ACT_A, act_valabil_pana: '' })).corp.cod, 'act_valabil_pana');
    egal((await pas2('tok-a', { act_serie_numar: 'AB', act_valabil_pana: dataPeste(1) })).corp.cod, 'act_serie_numar');
    egal((await pas2('tok-a', { act_serie_numar: 'A'.repeat(21), act_valabil_pana: dataPeste(1) })).corp.cod, 'act_serie_numar');
    egal((await pas2('tok-a', { act_serie_numar: '', act_valabil_pana: dataPeste(1) })).corp.camp, 'act_serie_numar', 'fără valoare salvată');
    egal(DB.tabele.investitori_kyc.length, 0);
    egal((await pas2('tok-a', { act_serie_numar: ACT_A, act_valabil_pana: dataPeste(0) })).statusCode, 200, 'valabil până azi');
  });
  await test('cerinteLipsa: datele de identificare și actul; un act expirat între timp lipsește', async () => {
    reset();
    const l0 = K.cerinteLipsa(null);
    for (const c of ['data_nasterii', 'cetatenie', 'adresa_domiciliu', 'id_fiscal', 'act_serie_numar', 'act_valabil_pana']) adevarat(l0.includes(c), 'lipsește ' + c);
    await pas1('tok-a', PAS1());
    await pas2('tok-a', { act_serie_numar: ACT_A, act_valabil_pana: dataPeste(2) });
    const l1 = K.cerinteLipsa(kycA());
    for (const c of ['data_nasterii', 'cetatenie', 'adresa_domiciliu', 'id_fiscal', 'act_serie_numar', 'act_valabil_pana']) adevarat(!l1.includes(c), 'complet ' + c);
    adevarat(K.cerinteLipsa({ ...kycA(), act_valabil_pana: dataPeste(0, -1) }).includes('act_valabil_pana'), 'act expirat');
    adevarat(K.cerinteLipsa({ ...kycA(), id_fiscal_tip: 'nif' }).includes('id_fiscal'), 'cetățean RO cu NIF');
    adevarat(K.cerinteLipsa({ ...kycA(), adresa_domiciliu: { ...ADRESA_RO, judet: '' } }).includes('adresa_domiciliu'), 'RO fără județ');
  });

  console.log('D. Proprietarul');
  await test('GET / POST: doar valorile mascate, niciodată CNP-ul, actul, forma criptată sau amprenta', async () => {
    reset();
    const r1 = await pas1('tok-a', PAS1());
    faraValoriInClar(r1.corp);
    const r2 = await pas2('tok-a', { act_serie_numar: ACT_A, act_valabil_pana: dataPeste(3) });
    faraValoriInClar(r2.corp);
    const g = await cheama(apiKyc, { token: 'tok-a' });
    faraValoriInClar(g.corp);
    egal(g.corp.kyc.id_fiscal_mascat, '•••••••••' + CNP_A.slice(-3));
    egal(g.corp.kyc.act_serie_numar_mascat, '•••••••••456');
    egal([g.corp.kyc.data_nasterii, g.corp.kyc.cetatenie, g.corp.kyc.id_fiscal_tip], ['1985-03-14', 'RO', 'cnp']);
    adevarat(!('cnp_hash' in g.corp.kyc) && !('id_fiscal_criptat' in g.corp.kyc), 'fără câmpurile interne');
    // și erorile nu repetă valorile
    faraValoriInClar((await pas2('tok-a', { act_serie_numar: ACT_A, act_valabil_pana: '2000-01-01' })).corp);
  });

  console.log('E. Back-office');
  async function dosarTrimis() {
    await pas1('tok-a', PAS1());
    await pas2('tok-a', { act_serie_numar: ACT_A, act_valabil_pana: dataPeste(3) });
    Object.assign(kycA(), { status: 'in_verificare', submitted_at: new Date().toISOString() });
  }
  await test('lista: valorile mascate, fără valori în clar', async () => {
    reset();
    await dosarTrimis();
    const r = await cheama(apiAdminKyc, { token: 'tok-super' });
    egal(r.statusCode, 200);
    const c = r.corp.cereri[0];
    egal([c.id_fiscal_mascat, c.act_serie_numar_mascat, c.data_nasterii, c.cetatenie], ['•••••••••' + CNP_A.slice(-3), '•••••••••456', '1985-03-14', 'RO']);
    faraValoriInClar(r.corp);
  });
  await test('date_identitate fără drept pe Investitori → 403, fără valori, fără audit', async () => {
    reset();
    await dosarTrimis();
    const r = await cheama(apiAdminKyc, { token: 'tok-admin', query: { identitate: A } });
    egal(r.statusCode, 403);
    faraValoriInClar(r.corp);
    egal(DB.tabele.audit_log.length, 0);
    egal((await cheama(apiAdminKyc, { token: 'tok-a', query: { identitate: A } })).statusCode, 403, 'investitorul însuși');
  });
  await test('date_identitate cu drept de citire → valori decriptate + rând investitor_identitate_vazuta', async () => {
    reset();
    await dosarTrimis();
    DB.tabele.admin_permissions.push({ admin_id: ADMIN, sectiune: 'investitori', poate_scrie: false });
    const r = await cheama(apiAdminKyc, { token: 'tok-admin', query: { identitate: A } });
    egal(r.statusCode, 200);
    egal([r.corp.id_fiscal_tip, r.corp.id_fiscal, r.corp.act_serie_numar], ['cnp', CNP_A, ACT_A]);
    const a = DB.tabele.audit_log.filter((x) => x.actiune === 'investitor_identitate_vazuta');
    egal(a.length, 1);
    egal([a[0].admin_id, a[0].entitate, a[0].entitate_id], [ADMIN, 'investitori_kyc', A]);
    adevarat(!JSON.stringify(a[0]).includes(CNP_A) && !JSON.stringify(a[0]).includes(ACT_A), 'valorile nu intră în audit');
    await cheama(apiAdminKyc, { token: 'tok-super', query: { identitate: A } });
    egal(DB.tabele.audit_log.filter((x) => x.actiune === 'investitor_identitate_vazuta').length, 2, 'fiecare acces');
  });
  await test('date_identitate: dosar fără date → 404; auditul nu se poate scrie → 500, fără valori', async () => {
    reset();
    egal((await cheama(apiAdminKyc, { token: 'tok-super', query: { identitate: B } })).statusCode, 404);
    await dosarTrimis();
    delete DB.tabele.audit_log;
    const ce = console.error; console.error = () => {};
    let r;
    try { r = await cheama(apiAdminKyc, { token: 'tok-super', query: { identitate: A } }); } finally { console.error = ce; }
    egal(r.statusCode, 500);
    faraValoriInClar(r.corp);
  });

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})();
