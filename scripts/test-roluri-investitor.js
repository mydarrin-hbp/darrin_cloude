// scripts/test-roluri-investitor.js
// Teste pentru pasul 11-L (17 oct. 2026), peste un Supabase simulat
// (scripts/supabase-simulat.js) — nimic nu ajunge la Supabase sau la producție:
//   A. ruta de investitor (api/investitori/kyc.js): un cont de client devine
//      investitor — păstrează `client` și primește `investor`, doar după ce
//      dosarul e complet; IBAN validat și salvat criptat; progresul pe pași;
//      dosarul trimis nu se mai modifică;
//   B. rolul de partener pe un cont de investitor (api/partener/wizard-companie.js):
//      același cont, ambele roluri; alt tip de partener → 409;
//      api/public/partner-register.js refuză un utilizator autentificat;
//   C. documentele KYC (api/investitori/kyc-document.js): tip greșit sau fișier
//      prea mare refuzate; calea e în dosarul contului; utilizatorul A nu poate
//      citi sau șterge fișierele lui B;
//   D. subscrierea (api/investitori/subscrie.js): doar cu rolul investor, cu
//      user_id; fără KYC aprobat se salvează, dar aprobarea adminului e refuzată
//      (api/admin/investitori-aprobare.js); după aprobarea KYC, se aprobă;
//   E. verificarea manuală (api/admin/investitori-kyc.js): acces doar cu drept,
//      respingerea cere motivul RO + EN, documentul prin adresă semnată, audit;
//   F. /api/cont/profil: starea rutei de investitor și datele de precompletare;
//   G. exit (api/investitori/exit.js): se numără doar acțiunile din subscrierile
//      aprobate (corecție 21 oct. 2026); buy-back-ul doar cu discountul și
//      lock-up-ul rundei (11-J); piața secundară nu e disponibilă.
// Pasul 11-J: subscrierea se face pe runda deschisă (runde_finantare), cu
// acțiunile calculate pe server. Valorile rundei de mai jos sunt DE TEST
// (preț 1.000 / acțiune), nu cifrele reale ale rundei Seed.
// Rulare: node scripts/test-roluri-investitor.js

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
stub('lib/eligibilitate-partener.js', { eligibilitatePartener: async (id) => {
  const p = DB.tabele.partners.find((x) => x.id === id);
  return p ? { nume_firma: p.nume_firma, partner_type: p.partner_type, status_verificare: p.status_verificare, contract_semnat: false, cont_bancar: false, poate_vinde: false, motiv: 'in_verificare', furnizor_propriu: false } : null;
} });
stub('lib/destinatie-cont.js', { destinatiePentru: async () => null });

const apiKyc = require(path.join(RADACINA, 'api/investitori/kyc.js'));
const apiDoc = require(path.join(RADACINA, 'api/investitori/kyc-document.js'));
const apiSub = require(path.join(RADACINA, 'api/investitori/subscrie.js'));
const apiAprobare = require(path.join(RADACINA, 'api/admin/investitori-aprobare.js'));
const apiAdminKyc = require(path.join(RADACINA, 'api/admin/investitori-kyc.js'));
// Pasul 11-P1: rutele de partener verifică starea firmei la ANAF; aici ANAF
// e simulat (firmă activă), fără rețea.
const fetchOriginal = global.fetch;
global.fetch = async (url, opt) => {
  if (!String(url).includes('anaf.ro')) return fetchOriginal(url, opt);
  const item = { date_generale: { cui: 46577229, denumire: 'FIRMA SIMULATA SRL' }, inregistrare_scop_Tva: { scpTVA: true }, stare_inactiv: { statusInactivi: false } };
  return { ok: true, status: 200, json: async () => ({ found: [item], notFound: [] }) };
};
const apiWizard = require(path.join(RADACINA, 'api/partener/wizard-companie.js'));
const apiRegister = require(path.join(RADACINA, 'api/public/partner-register.js'));
const apiProfil = require(path.join(RADACINA, 'api/cont/profil.js'));
const apiExit = require(path.join(RADACINA, 'api/investitori/exit.js'));
const apiIndicatori = require(path.join(RADACINA, 'api/investitori/indicatori.js'));
const apiPortofoliu = require(path.join(RADACINA, 'api/investitori/portofoliu.js'));
const apiRundaCurenta = require(path.join(RADACINA, 'api/public/runda-curenta.js'));
const apiAdminRunde = require(path.join(RADACINA, 'api/admin/runde-finantare.js'));
const apiAdminDashboard = require(path.join(RADACINA, 'api/admin/investitori-dashboard.js'));

const A = '30000000-0000-4000-8000-00000000000a';
const B = '30000000-0000-4000-8000-00000000000b';
const ADMIN = '30000000-0000-4000-8000-0000000000ad';
const SUPER = '30000000-0000-4000-8000-0000000000sa';
const IBAN = 'RO49AAAA1B31007593840000';

// Rundă de test: pre-money 900.000, țintă 100.000, 900 de acțiuni → preț 1.000.
const RUNDA_TEST = (x = {}) => Object.assign({
  id: 'r-test', cod: 'test', denumire_ro: 'Rundă de test', denumire_en: 'Test round', stare: 'deschisa', moneda: 'EUR',
  evaluare_pre_money: 900000, suma_tinta: 100000, actiuni_existente: 900, investitie_minima: 1000, tickete: [25000, 50000],
  instrumente: ['actiuni', 'safe'], lock_up_luni: null, discount_buyback_pct: null, afiseaza_progres: false, vizibila_public: false,
}, x);

function reset() {
  DB.tabele = {
    profiles: [
      { id: A, email: 'a@test', roles: ['client'], phone: '+40700000001', tara: 'RO', limba: 'ro' },
      { id: B, email: 'b@test', roles: ['client'], tara: 'RO' },
      { id: ADMIN, email: 'admin@test', roles: ['admin'] },
      { id: SUPER, email: 'super@test', roles: ['superadmin'] },
    ],
    investitori_kyc: [], investitori_portofoliu: [], investitori_exit: [], partners: [], partner_conturi_bancare: [], audit_log: [], admin_permissions: [],
    runde_finantare: [RUNDA_TEST()],
  };
  DB.coloane = {};
  DB.storage = {};
  DB.rpc = { cripteaza_camp: async ({ valoare }) => 'cripta:' + Buffer.from(valoare).toString('base64') };
  DB.utilizatori = {
    'tok-a': { id: A, email: 'a@test', user_metadata: { prenume: 'Ana', nume: 'Albu' } },
    'tok-b': { id: B, email: 'b@test', user_metadata: {} },
    'tok-admin': { id: ADMIN, email: 'admin@test' },
    'tok-super': { id: SUPER, email: 'super@test' },
  };
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
const roluri = (id) => DB.tabele.profiles.find((p) => p.id === id).roles;

// Ruta completă pentru un cont (fișierele „încărcate” în storage-ul simulat).
async function rutaCompleta(token, id) {
  egal((await cheama(apiKyc, { token, metoda: 'POST', body: { pas: 1, date: { prenume: 'Ana', nume: 'Albu', telefon: '+40700000001', tara: 'RO', iban: IBAN } } })).statusCode, 200, 'pas 1');
  const fata = (await cheama(apiDoc, { token, metoda: 'POST', body: { latura: 'fata', mime: 'image/jpeg', marime: 1000 } })).corp.path;
  const verso = (await cheama(apiDoc, { token, metoda: 'POST', body: { latura: 'verso', mime: 'application/pdf', marime: 2000 } })).corp.path;
  DB.storage['investitori-kyc'] = DB.storage['investitori-kyc'] || new Set();
  DB.storage['investitori-kyc'].add(fata); DB.storage['investitori-kyc'].add(verso);
  egal((await cheama(apiKyc, { token, metoda: 'POST', body: { pas: 2, date: { tip_document: 'ci', document_fata_path: fata, document_verso_path: verso } } })).statusCode, 200, 'pas 2');
  egal((await cheama(apiKyc, { token, metoda: 'POST', body: { pas: 3, date: { mifid: { experienta: 1, toleranta: 0, scop: 2 }, este_pep: false, sanctiuni_declarat: true } } })).statusCode, 200, 'pas 3');
  egal((await cheama(apiKyc, { token, metoda: 'POST', body: { pas: 4, date: { rezidenta_fiscala_tara: 'RO' } } })).statusCode, 200, 'pas 4');
  return { fata, verso };
}

(async () => {
  console.log('A. Ruta de investitor');
  await test('client → investitor: păstrează client, adaugă investor, doar la trimitere', async () => {
    reset();
    await rutaCompleta('tok-a', A);
    egal(roluri(A), ['client'], 'înainte de trimitere');
    const r = await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 5, date: { confirma: true } } });
    egal(r.statusCode, 200);
    egal(roluri(A), ['client', 'investor']);
    egal(r.corp.kyc.status, 'in_verificare');
    adevarat(DB.tabele.investitori_kyc[0].submitted_at, 'submitted_at setat');
  });
  await test('IBAN-ul se salvează criptat; proprietarul vede doar ultimele 4 cifre', async () => {
    reset();
    await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 1, date: { prenume: 'Ana', nume: 'Albu', telefon: '1', tara: 'RO', iban: IBAN } } });
    const rand = DB.tabele.investitori_kyc[0];
    adevarat(rand.iban_criptat && !String(rand.iban_criptat).includes(IBAN), 'IBAN criptat, nu în clar');
    egal(rand.iban_ultimele4, '0000');
    const g = await cheama(apiKyc, { token: 'tok-a' });
    egal(g.corp.kyc.iban_mascat, '•••• 0000');
    adevarat(!JSON.stringify(g.corp).includes(IBAN) && !JSON.stringify(g.corp).includes('cripta:'), 'nici IBAN, nici forma criptată în răspuns');
  });
  await test('IBAN invalid → 400, nimic salvat', async () => {
    reset();
    const r = await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 1, date: { prenume: 'Ana', nume: 'Albu', telefon: '1', tara: 'RO', iban: 'RO49AAAA1B31007593840001' } } });
    egal(r.statusCode, 400); egal(r.corp.cod, 'iban'); adevarat(r.corp.error_en, 'mesaj EN');
    egal(DB.tabele.investitori_kyc.length, 0);
  });
  await test('progresul pe server: pas_curent avansează, GET îl întoarce cu datele contului', async () => {
    reset();
    await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 1, date: { prenume: 'Ana', nume: 'Albu', telefon: '1', tara: 'RO', iban: IBAN } } });
    const g = await cheama(apiKyc, { token: 'tok-a' });
    egal(g.corp.kyc.pas_curent, 2); egal(g.corp.kyc.status, 'ciorna');
    egal(g.corp.cont.email, 'a@test'); egal(g.corp.cont.prenume, 'Ana'); egal(g.corp.cont.telefon, '+40700000001');
  });
  await test('trimiterea unui dosar incomplet → 400 cu lista, fără rol', async () => {
    reset();
    await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 1, date: { prenume: 'Ana', nume: 'Albu', telefon: '1', tara: 'RO', iban: IBAN } } });
    const r = await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 5, date: { confirma: true } } });
    egal(r.statusCode, 400); adevarat(r.corp.lipsa.includes('document_fata') && r.corp.lipsa.includes('mifid'), 'lista lipsurilor');
    egal(roluri(A), ['client']);
  });
  await test('un fișier al altui cont în pasul 2 → 400', async () => {
    reset();
    const r = await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 2, date: { tip_document: 'pasaport', document_fata_path: B + '/fata-1.jpg' } } });
    egal(r.statusCode, 400); egal(r.corp.cod, 'fisier_strain');
  });
  await test('pașaport: fără verso; carte de identitate: verso obligatoriu', async () => {
    reset();
    const r1 = await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 2, date: { tip_document: 'ci', document_fata_path: A + '/fata-1.jpg' } } });
    egal(r1.corp.cod, 'document_verso');
    const r2 = await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 2, date: { tip_document: 'pasaport', document_fata_path: A + '/fata-1.jpg' } } });
    egal(r2.statusCode, 200);
  });
  await test('dosarul trimis nu se mai modifică (409)', async () => {
    reset();
    await rutaCompleta('tok-a', A);
    await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 5, date: { confirma: true } } });
    const r = await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 4, date: { rezidenta_fiscala_tara: 'DE' } } });
    egal(r.statusCode, 409); egal(r.corp.cod, 'blocat');
  });
  await test('fără sesiune → 401', async () => {
    reset();
    egal((await cheama(apiKyc, {})).statusCode, 401);
  });

  console.log('B. Rol de partener pe același cont');
  await test('investitor → partener de materiale: același cont, ambele roluri', async () => {
    reset();
    DB.tabele.profiles.find((p) => p.id === A).roles = ['client', 'investor'];
    const r = await cheama(apiWizard, { token: 'tok-a', metoda: 'POST', body: { nume_firma: 'Albu Materiale SRL', cui: 'RO46577229', partner_type: 'materiale', tip_entitate_legala: 'srl' } });
    egal(r.statusCode, 200);
    egal(roluri(A), ['client', 'investor', 'partener_materiale']);
    egal(DB.tabele.partners.length, 1); egal(DB.tabele.partners[0].id, A); egal(DB.tabele.partners[0].status_verificare, 'pending_review');
  });
  await test('al doilea tip de partener pe același cont → 409', async () => {
    reset();
    DB.tabele.partners.push({ id: A, partner_type: 'furnizor_materiale', nume_firma: 'X', cui: 'RO46577229', tip_entitate_legala: 'srl', status_verificare: 'pending_review' });
    const r = await cheama(apiWizard, { token: 'tok-a', metoda: 'POST', body: { nume_firma: 'X', cui: 'RO46577229', partner_type: 'curier', tip_entitate_legala: 'srl' } });
    egal(r.statusCode, 409); egal(r.corp.cod, 'alt_tip_partener');
  });
  await test('partner-register refuză un utilizator autentificat (fără cont nou)', async () => {
    reset();
    const r = await cheama(apiRegister, { token: 'tok-a', metoda: 'POST', body: { email: 'a@test', tip: 'materiale', nume_firma: 'X', cui: '1' } });
    egal(r.statusCode, 409); egal(r.corp.cod, 'cont_existent_autentificat');
  });

  console.log('C. Documentele KYC');
  await test('tip greșit → 400; fișier peste 5 MB → 400; gol → 400', async () => {
    reset();
    egal((await cheama(apiDoc, { token: 'tok-a', metoda: 'POST', body: { latura: 'fata', mime: 'text/plain', marime: 10 } })).corp.cod, 'tip');
    egal((await cheama(apiDoc, { token: 'tok-a', metoda: 'POST', body: { latura: 'fata', mime: 'image/png', marime: 5 * 1024 * 1024 + 1 } })).corp.cod, 'marime');
    egal((await cheama(apiDoc, { token: 'tok-a', metoda: 'POST', body: { latura: 'fata', mime: 'image/png', marime: 0 } })).corp.cod, 'gol');
  });
  await test('încărcarea primește o adresă semnată pe calea contului', async () => {
    reset();
    const r = await cheama(apiDoc, { token: 'tok-a', metoda: 'POST', body: { latura: 'verso', mime: 'application/pdf', marime: 4 * 1024 * 1024 } });
    egal(r.statusCode, 200);
    adevarat(r.corp.path.startsWith(A + '/verso-') && r.corp.path.endsWith('.pdf'), r.corp.path);
    adevarat(r.corp.token, 'token de încărcare');
  });
  await test('A nu poate citi sau șterge fișierele lui B (403)', async () => {
    reset();
    const caleB = B + '/fata-1-abc.jpg';
    DB.storage['investitori-kyc'] = new Set([caleB]);
    egal((await cheama(apiDoc, { token: 'tok-a', query: { path: caleB } })).statusCode, 403);
    egal((await cheama(apiDoc, { token: 'tok-a', metoda: 'DELETE', query: { path: caleB } })).statusCode, 403);
    adevarat(DB.storage['investitori-kyc'].has(caleB), 'fișierul lui B rămâne');
    egal((await cheama(apiDoc, { token: 'tok-a', query: { path: '../' + caleB } })).statusCode, 403);
    egal((await cheama(apiDoc, { token: 'tok-b', query: { path: caleB } })).statusCode, 200, 'B își vede fișierul');
  });
  await test('ștergerea propriului fișier golește și legătura din dosar', async () => {
    reset();
    const { fata } = await rutaCompleta('tok-a', A);
    const r = await cheama(apiDoc, { token: 'tok-a', metoda: 'DELETE', query: { path: fata } });
    egal(r.statusCode, 200);
    egal(DB.tabele.investitori_kyc[0].document_fata_path, null);
    adevarat(!DB.storage['investitori-kyc'].has(fata), 'fișierul șters din storage');
  });

  console.log('D. Subscrierea');
  await test('fără rolul investor → 403', async () => {
    reset();
    egal((await cheama(apiSub, { token: 'tok-a', metoda: 'POST', body: { suma: 25000, instrument: 'safe' } })).statusCode, 403);
  });
  await test('cu rolul investor: salvată cu user_id; fără KYC aprobat, aprobarea e refuzată', async () => {
    reset();
    await rutaCompleta('tok-a', A);
    await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 5, date: { confirma: true } } });
    // acțiunile trimise de browser se ignoră: le calculează serverul din rundă
    const r = await cheama(apiSub, { token: 'tok-a', metoda: 'POST', body: { suma: 25000, actiuni: 999999, instrument: 'safe' } });
    egal(r.statusCode, 200); egal(r.corp.kyc_status, 'in_verificare'); egal(r.corp.actiuni, 25);
    const sub = DB.tabele.investitori_portofoliu[0];
    egal(sub.user_id, A); egal(sub.status, 'in_asteptare'); egal(sub.email, 'a@test');
    egal(sub.runda_id, 'r-test'); egal(sub.actiuni, 25); egal(sub.instrument, 'safe');
    const ap = await cheama(apiAprobare, { token: 'tok-super', metoda: 'POST', body: { id: sub.id, actiune: 'aproba' } });
    egal(ap.statusCode, 409); egal(ap.corp.cod, 'kyc_neaprobat');
    egal(DB.tabele.investitori_portofoliu[0].status, 'in_asteptare');
  });
  await test('după aprobarea KYC, subscrierea se aprobă', async () => {
    reset();
    await rutaCompleta('tok-a', A);
    await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 5, date: { confirma: true } } });
    await cheama(apiSub, { token: 'tok-a', metoda: 'POST', body: { suma: 25000, instrument: 'safe' } });
    egal((await cheama(apiAdminKyc, { token: 'tok-super', metoda: 'POST', body: { user_id: A, actiune: 'aproba' } })).statusCode, 200);
    const ap = await cheama(apiAprobare, { token: 'tok-super', metoda: 'POST', body: { id: DB.tabele.investitori_portofoliu[0].id, actiune: 'aproba' } });
    egal(ap.statusCode, 200); egal(DB.tabele.investitori_portofoliu[0].status, 'aprobat');
  });
  await test('a doua subscriere a aceluiași investitor → 200 (două rânduri)', async () => {
    reset();
    DB.tabele.profiles.find((p) => p.id === A).roles = ['client', 'investor'];
    egal((await cheama(apiSub, { token: 'tok-a', metoda: 'POST', body: { suma: 25000, instrument: 'safe' } })).statusCode, 200, 'prima');
    egal((await cheama(apiSub, { token: 'tok-a', metoda: 'POST', body: { suma: 50000, instrument: 'actiuni' } })).statusCode, 200, 'a doua');
    egal(DB.tabele.investitori_portofoliu.filter((r) => r.user_id === A).map((r) => r.actiuni), [25, 50]);
    egal(DB.tabele.investitori_portofoliu.map((r) => r.runda_id), ['r-test', 'r-test']);
  });
  await test('o subscriere veche, fără cont, nu se poate aproba', async () => {
    reset();
    DB.tabele.investitori_portofoliu.push({ id: 'vechi', email: 'x@test', actiuni: 1, valoare_investita: 1000, status: 'in_asteptare' });
    const ap = await cheama(apiAprobare, { token: 'tok-super', metoda: 'POST', body: { id: 'vechi', actiune: 'aproba' } });
    egal(ap.statusCode, 409); egal(ap.corp.cod, 'fara_cont');
  });
  await test('sumă sau instrument invalid → 400', async () => {
    reset();
    DB.tabele.profiles.find((p) => p.id === A).roles = ['client', 'investor'];
    egal((await cheama(apiSub, { token: 'tok-a', metoda: 'POST', body: { suma: 0, instrument: 'safe' } })).statusCode, 400);
    egal((await cheama(apiSub, { token: 'tok-a', metoda: 'POST', body: { suma: 1000, instrument: 'Bitcoin' } })).statusCode, 400);
    egal((await cheama(apiSub, { token: 'tok-a', metoda: 'POST', body: { suma: 500, instrument: 'safe' } })).statusCode, 400, 'sub investiția minimă');
    egal((await cheama(apiSub, { token: 'tok-a', metoda: 'POST', body: { suma: 100001, instrument: 'safe' } })).statusCode, 400, 'peste ținta rundei');
    egal(DB.tabele.investitori_portofoliu.length, 0);
  });
  await test('fără rundă deschisă → 409 RUNDA_INCHISA, nimic salvat', async () => {
    reset();
    DB.tabele.runde_finantare[0].stare = 'inchisa';
    DB.tabele.profiles.find((p) => p.id === A).roles = ['client', 'investor'];
    const r = await cheama(apiSub, { token: 'tok-a', metoda: 'POST', body: { suma: 25000, instrument: 'safe' } });
    egal(r.statusCode, 409); egal(r.corp.cod, 'RUNDA_INCHISA'); adevarat(r.corp.error && r.corp.error_en, 'mesaj RO + EN');
    egal(DB.tabele.investitori_portofoliu.length, 0);
  });

  console.log('E. Verificarea manuală (admin)');
  await test('admin fără drept pe Investitori → 403; cu drept → lista', async () => {
    reset();
    egal((await cheama(apiAdminKyc, { token: 'tok-admin' })).statusCode, 403);
    DB.tabele.admin_permissions.push({ admin_id: ADMIN, sectiune: 'investitori', poate_scrie: true });
    egal((await cheama(apiAdminKyc, { token: 'tok-admin' })).statusCode, 200);
    egal((await cheama(apiAdminKyc, { token: 'tok-a' })).statusCode, 403, 'client');
  });
  await test('lista: cererile trimise (nu ciornele), cu starea KYC lângă subscrieri', async () => {
    reset();
    await rutaCompleta('tok-a', A);
    await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 5, date: { confirma: true } } });
    await cheama(apiKyc, { token: 'tok-b', metoda: 'POST', body: { pas: 1, date: { prenume: 'B', nume: 'B', telefon: '1', tara: 'RO', iban: IBAN } } });
    await cheama(apiSub, { token: 'tok-a', metoda: 'POST', body: { suma: 25000, instrument: 'safe' } });
    const r = await cheama(apiAdminKyc, { token: 'tok-super' });
    egal(r.corp.cereri.map((c) => c.user_id), [A]);
    egal(r.corp.cereri[0].email, 'a@test'); egal(r.corp.cereri[0].tip_document, 'ci');
    adevarat(!JSON.stringify(r.corp).includes(IBAN), 'fără IBAN în clar');
    egal(r.corp.subscrieri[0].kyc_status, 'in_verificare');
  });
  await test('respingerea cere motivul RO + EN; apoi e salvată și auditată', async () => {
    reset();
    await rutaCompleta('tok-a', A);
    await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 5, date: { confirma: true } } });
    egal((await cheama(apiAdminKyc, { token: 'tok-super', metoda: 'POST', body: { user_id: A, actiune: 'respinge', motiv_ro: 'Poză neclară' } })).statusCode, 400);
    const r = await cheama(apiAdminKyc, { token: 'tok-super', metoda: 'POST', body: { user_id: A, actiune: 'respinge', motiv_ro: 'Poză neclară', motiv_en: 'Blurry photo' } });
    egal(r.statusCode, 200);
    const k = DB.tabele.investitori_kyc[0];
    egal([k.status, k.motiv_respingere_ro, k.motiv_respingere_en, k.reviewed_by], ['respins', 'Poză neclară', 'Blurry photo', SUPER]);
    adevarat(DB.tabele.audit_log.some((a) => a.actiune === 'investitori_kyc_respins'), 'audit');
    // investitorul vede motivul și poate corecta: dosarul redevine editabil
    const g = await cheama(apiKyc, { token: 'tok-a' });
    egal(g.corp.kyc.motiv_respingere_en, 'Blurry photo');
    egal((await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 4, date: { rezidenta_fiscala_tara: 'RO' } } })).statusCode, 200, 'corectare după respingere');
  });
  await test('documentul: adresă semnată doar pentru un fișier dintr-un dosar, cu audit', async () => {
    reset();
    const { fata } = await rutaCompleta('tok-a', A);
    await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 5, date: { confirma: true } } });
    const r = await cheama(apiAdminKyc, { token: 'tok-super', query: { document: fata } });
    egal(r.statusCode, 200); adevarat(/exp=120/.test(r.corp.url), 'adresă de 2 minute');
    adevarat(DB.tabele.audit_log.some((a) => a.actiune === 'investitori_kyc_document_vazut'), 'audit');
    egal((await cheama(apiAdminKyc, { token: 'tok-super', query: { document: A + '/altceva.jpg' } })).statusCode, 404);
  });
  await test('decizia doar pentru un dosar în verificare (409 altfel)', async () => {
    reset();
    await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 1, date: { prenume: 'A', nume: 'A', telefon: '1', tara: 'RO', iban: IBAN } } });
    egal((await cheama(apiAdminKyc, { token: 'tok-super', metoda: 'POST', body: { user_id: A, actiune: 'aproba' } })).statusCode, 409);
  });

  console.log('F. Profilul contului');
  await test('/api/cont/profil: starea investitorului și precompletarea', async () => {
    reset();
    await cheama(apiKyc, { token: 'tok-a', metoda: 'POST', body: { pas: 1, date: { prenume: 'Ana', nume: 'Albu', telefon: '1', tara: 'RO', iban: IBAN } } });
    const r = await cheama(apiProfil, { token: 'tok-a' });
    egal(r.statusCode, 200);
    egal(r.corp.investitor.status, 'ciorna'); egal(r.corp.investitor.pas_curent, 2);
    egal([r.corp.prenume, r.corp.nume_familie, r.corp.telefon, r.corp.tara], ['Ana', 'Albu', '+40700000001', 'RO']);
  });

  console.log('G. Exit');
  const VECHE = '2020-01-01T00:00:00Z';
  await test('se numără doar acțiunile din subscrierile aprobate', async () => {
    reset();
    DB.tabele.runde_finantare[0].discount_buyback_pct = 10;
    DB.tabele.profiles.find((p) => p.id === A).roles = ['client', 'investor'];
    DB.tabele.investitori_portofoliu.push(
      { id: 's1', user_id: A, runda_id: 'r-test', actiuni: 10, valoare_investita: 10000, status: 'aprobat', created_at: VECHE },
      { id: 's2', user_id: A, runda_id: 'r-test', actiuni: 50, valoare_investita: 50000, status: 'in_asteptare', created_at: VECHE },
      { id: 's3', user_id: A, runda_id: 'r-test', actiuni: 40, valoare_investita: 40000, status: 'respins', created_at: VECHE },
    );
    const peste = await cheama(apiExit, { token: 'tok-a', metoda: 'POST', body: { tip: 'buyback', numar_actiuni: 11 } });
    egal(peste.statusCode, 400, 'peste acțiunile aprobate');
    adevarat(/10 acțiuni/.test(peste.corp.error), peste.corp.error);
    egal(DB.tabele.investitori_exit.length, 0);
    const ok10 = await cheama(apiExit, { token: 'tok-a', metoda: 'POST', body: { tip: 'buyback', numar_actiuni: 10 } });
    egal(ok10.statusCode, 200, 'exact acțiunile aprobate');
    egal(DB.tabele.investitori_exit.length, 1);
  });
  await test('fără subscrieri aprobate → nicio acțiune deținută', async () => {
    reset();
    DB.tabele.profiles.find((p) => p.id === A).roles = ['client', 'investor'];
    DB.tabele.runde_finantare[0].discount_buyback_pct = 10;
    DB.tabele.investitori_portofoliu.push({ id: 's2', user_id: A, runda_id: 'r-test', actiuni: 50, valoare_investita: 50000, status: 'in_asteptare', created_at: VECHE });
    egal((await cheama(apiExit, { token: 'tok-a', metoda: 'POST', body: { tip: 'buyback', numar_actiuni: 1 } })).statusCode, 409);
    egal(DB.tabele.investitori_exit.length, 0);
  });
  await test('buy-back fără discount configurat în rundă → 409; piața secundară → 409', async () => {
    reset();
    DB.tabele.profiles.find((p) => p.id === A).roles = ['client', 'investor'];
    DB.tabele.investitori_portofoliu.push({ id: 's1', user_id: A, runda_id: 'r-test', actiuni: 10, valoare_investita: 10000, status: 'aprobat', created_at: VECHE });
    const r = await cheama(apiExit, { token: 'tok-a', metoda: 'POST', body: { tip: 'buyback', numar_actiuni: 1 } });
    egal(r.statusCode, 409); egal(r.corp.cod, 'INDISPONIBIL');
    egal((await cheama(apiExit, { token: 'tok-a', metoda: 'POST', body: { tip: 'piata_secundara', numar_actiuni: 1 } })).statusCode, 409);
    egal(DB.tabele.investitori_exit.length, 0);
  });
  await test('lock-up-ul rundei: acțiunile mai noi decât lock-up-ul nu se pot vinde', async () => {
    reset();
    Object.assign(DB.tabele.runde_finantare[0], { discount_buyback_pct: 10, lock_up_luni: 12 });
    DB.tabele.profiles.find((p) => p.id === A).roles = ['client', 'investor'];
    DB.tabele.investitori_portofoliu.push(
      { id: 's1', user_id: A, runda_id: 'r-test', actiuni: 10, valoare_investita: 10000, status: 'aprobat', created_at: VECHE },
      { id: 's2', user_id: A, runda_id: 'r-test', actiuni: 5, valoare_investita: 5000, status: 'aprobat', created_at: new Date().toISOString() },
    );
    egal((await cheama(apiExit, { token: 'tok-a', metoda: 'POST', body: { tip: 'buyback', numar_actiuni: 11 } })).statusCode, 400, 'în lock-up');
    egal((await cheama(apiExit, { token: 'tok-a', metoda: 'POST', body: { tip: 'buyback', numar_actiuni: 10 } })).statusCode, 200, 'după lock-up');
  });

  console.log('H. Indicatorii platformei (11-J, 2.5)');
  // Răspunsul RPC-ului, simulat (cifre de test).
  const KPIS = (x = {}) => ({ timestamp: 'acum', kpis: Object.assign({ comenzi_total: 12, gmv_total: 3400, revenue_total: 408, parteneri_activi: 3, comenzi_luna: 2, revenue_luna: 60, take_rate_pct: 12, tari_active: 5 }, x),
    per_tara: [{ tara_cod: 'RO', moneda: 'RON', comenzi: 12 }, { tara_cod: 'IT', moneda: 'EUR', comenzi: 0 }] });
  await test('fără verificarea identității aprobată → 403, fără cifre; fără rolul investor → 403', async () => {
    reset();
    let apelat = false;
    DB.rpc.get_live_investor_kpis = async () => { apelat = true; return KPIS(); };
    egal((await cheama(apiIndicatori, { token: 'tok-a' })).statusCode, 403, 'client');
    DB.tabele.profiles.find((p) => p.id === A).roles = ['client', 'investor'];
    DB.tabele.investitori_kyc.push({ user_id: A, status: 'in_verificare' });
    const r = await cheama(apiIndicatori, { token: 'tok-a' });
    egal(r.statusCode, 403); egal(r.corp.cod, 'KYC_NEAPROBAT'); adevarat(r.corp.error && r.corp.error_en, 'mesaj RO + EN');
    adevarat(!('indicatori' in r.corp) && !apelat, 'nicio cifră, RPC-ul nu e apelat');
  });
  await test('cu verificarea aprobată: doar câmpurile reale (fără tari_active), moneda unică', async () => {
    reset();
    DB.rpc.get_live_investor_kpis = async () => KPIS();
    DB.tabele.profiles.find((p) => p.id === A).roles = ['client', 'investor'];
    DB.tabele.investitori_kyc.push({ user_id: A, status: 'aprobat' });
    const r = await cheama(apiIndicatori, { token: 'tok-a' });
    egal(r.statusCode, 200);
    egal(r.corp.indicatori, { comenzi_total: 12, comenzi_luna: 2, parteneri_activi: 3, gmv_total: 3400, revenue_total: 408, revenue_luna: 60, take_rate_pct: 12 });
    egal(r.corp.moneda, 'RON');
  });
  await test('fără comenzi: fără take_rate_pct (10 din funcție); ramura de eroare → 503', async () => {
    reset();
    DB.tabele.profiles.find((p) => p.id === A).roles = ['client', 'investor'];
    DB.tabele.investitori_kyc.push({ user_id: A, status: 'aprobat' });
    DB.rpc.get_live_investor_kpis = async () => KPIS({ comenzi_total: 0, gmv_total: 0, revenue_total: 0, take_rate_pct: 10 });
    const r = await cheama(apiIndicatori, { token: 'tok-a' });
    egal(r.statusCode, 200); adevarat(!('take_rate_pct' in r.corp.indicatori), 'fără take rate');
    DB.rpc.get_live_investor_kpis = async () => Object.assign(KPIS(), { error: 'Temporar indisponibil' });
    egal((await cheama(apiIndicatori, { token: 'tok-a' })).statusCode, 503);
  });

  console.log('I. Fără migrarea rundelor (11-J, 2.6)');
  // Ca în producție înainte de migrare: fără tabela runde_finantare și fără
  // coloana investitori_portofoliu.runda_id.
  function faraMigrare() {
    reset();
    delete DB.tabele.runde_finantare;
    DB.coloane.investitori_portofoliu = ['id', 'user_id', 'email', 'valoare_investita', 'actiuni', 'instrument', 'consimtamant_public', 'status', 'created_at'];
    DB.tabele.profiles.find((p) => p.id === A).roles = ['client', 'investor'];
    apiRundaCurenta._golesteCache();
  }
  await test('runda curentă → 200, runda null (pagina păstrează textul fără rundă)', async () => {
    faraMigrare();
    const r = await cheama(apiRundaCurenta, {});
    egal(r.statusCode, 200); egal(r.corp, { ok: true, runda: null });
  });
  await test('subscrierea → 409 RUNDA_INCHISA, nimic salvat', async () => {
    faraMigrare();
    const r = await cheama(apiSub, { token: 'tok-a', metoda: 'POST', body: { suma: 25000, instrument: 'safe' } });
    egal(r.statusCode, 409); egal(r.corp.cod, 'RUNDA_INCHISA');
    egal(DB.tabele.investitori_portofoliu.length, 0);
  });
  await test('portofoliul → 200, fără rundă, fără exit; subscrierile vechi se văd', async () => {
    faraMigrare();
    DB.tabele.investitori_portofoliu.push({ id: 'v1', user_id: A, actiuni: 10, valoare_investita: 1000, status: 'aprobat', created_at: VECHE });
    const r = await cheama(apiPortofoliu, { token: 'tok-a' });
    egal(r.statusCode, 200); egal(r.corp.runda, null); egal(r.corp.exit.buyback_disponibil, false);
    egal(r.corp.actiuni, 10); egal(r.corp.subscrieri.length, 1);
  });
  await test('exit (buy-back) → 409 INDISPONIBIL, nu eroare de server', async () => {
    faraMigrare();
    DB.tabele.investitori_portofoliu.push({ id: 'v1', user_id: A, actiuni: 10, valoare_investita: 1000, status: 'aprobat', created_at: VECHE });
    const r = await cheama(apiExit, { token: 'tok-a', metoda: 'POST', body: { tip: 'buyback', numar_actiuni: 1 } });
    egal(r.statusCode, 409); egal(r.corp.cod, 'INDISPONIBIL');
  });
  await test('back-office: lista rundelor → migrare_lipsa; dashboard-ul → 200, fără rundă', async () => {
    faraMigrare();
    const l = await cheama(apiAdminRunde, { token: 'tok-super' });
    egal(l.statusCode, 200); egal(l.corp.migrare_lipsa, true); egal(l.corp.runde, []);
    const d = await cheama(apiAdminDashboard, { token: 'tok-super' });
    egal(d.statusCode, 200); egal(d.corp.runda, null);
  });

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})();
