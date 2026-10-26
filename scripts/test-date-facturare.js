// scripts/test-date-facturare.js
// Teste pentru pasul 11-P2b (25 oct. 2026): datele de facturare la checkout
// (persoană fizică sau firmă), peste un Supabase simulat
// (scripts/supabase-simulat.js) și un ANAF simulat (fetch înlocuit în acest
// proces) — nimic nu ajunge la Supabase, la ANAF sau la producție:
//   A. lib/date-facturare.js: PF / PJ, adresa copiată, CNP doar pentru RO,
//      firmă din altă țară cu număr de înregistrare liber;
//   B. api/comenzi/creeaza.js: PF fără CNP → trece; CNP invalid → 400 pe `cnp`;
//      CNP valid → client_cnp_criptat, fără CNP în date_facturare sau în
//      răspuns; PJ cu CUI invalid → 400; PJ inactivă la ANAF → 400
//      FIRMA_INACTIVA; ANAF indisponibil → trece cu sursa 'manual'; fără
//      adresă de facturare → copia adresei lucrării; fără date_facturare → 400;
//      B2G neatins;
//   C. api/client/date-facturare.js: ultima comandă, fără CNP; null fără comenzi;
//   D. proforma PDF: blocul „CLIENT” cu datele de facturare;
//   E. mydarrin-checkout.html în Chromium, la 390 și 1366 px, RO și EN:
//      comutarea PF / PJ (și din tastatură), câmpurile corecte, nicio depășire
//      pe lățime, căutarea ANAF, comanda trimisă cu date_facturare, eroarea
//      serverului sub câmp, B2G fără blocul de facturare, precompletarea.
// Capturi (opțional): CAPTURI=<folder> node scripts/test-date-facturare.js
// Rulare: node scripts/test-date-facturare.js   (FARA_BROWSER=1: doar A–D)

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
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

// ANAF simulat: `ANAF.mod` = 'activa' | 'inactiva' | 'indisponibil'.
const { ANAF_URL } = require(path.join(RADACINA, 'lib/cauta-firma.js'));
const ANAF = { mod: 'activa', apeluri: 0 };
const fetchReal = global.fetch;
global.fetch = async (url, opt) => {
  if (String(url) !== ANAF_URL) return fetchReal(url, opt);
  ANAF.apeluri++;
  if (ANAF.mod === 'indisponibil') throw new TypeError('fetch failed');
  const cui = JSON.parse(opt.body)[0].cui;
  const item = {
    date_generale: { cui, denumire: 'FIRMA SIMULATA SRL', adresa: 'JUD. CLUJ, MUN. CLUJ-NAPOCA, STR. EXEMPLU NR. 1', nrRegCom: 'J12/3456/2020' },
    adresa_sediu_social: { sdenumire_Strada: 'Str. Exemplu', snumar_Strada: '1', sdenumire_Localitate: 'Mun. Cluj-Napoca', sdenumire_Judet: 'CLUJ', scod_Postal: '400001' },
    inregistrare_scop_Tva: { scpTVA: true },
    ...(ANAF.mod === 'inactiva' ? { stare_inactiv: { statusInactivi: true } } : {}),
  };
  return new Response(JSON.stringify({ found: [item], notFound: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const F = require(path.join(RADACINA, 'lib/date-facturare.js'));
const apiCreeaza = require(path.join(RADACINA, 'api/comenzi/creeaza.js'));
const apiDateFacturare = require(path.join(RADACINA, 'api/client/date-facturare.js'));
const apiCuiLookup = require(path.join(RADACINA, 'api/public/cui-lookup.js'));
const { genereazaProformaPDF } = require(path.join(RADACINA, 'lib/genereaza-proforma-pdf.js'));

const CLIENT = 'c0000000-0000-4000-8000-00000000000c';
const CUI = 'RO46577229';
const CUI_INVALID = 'RO46577228';
function cuControl(primele12) {
  const cheie = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9];
  const r = primele12.split('').reduce((s, c, i) => s + Number(c) * cheie[i], 0) % 11;
  return primele12 + (r === 10 ? 1 : r);
}
const CNP = cuControl('185031440123');
const CNP_INVALID = CNP.slice(0, 12) + ((Number(CNP[12]) + 1) % 10);
const ADRESA_FACT = { strada: 'Str. Facturii 5', localitate: 'Cluj-Napoca', judet: 'Cluj', cod_postal: '400002', tara: 'RO' };
const PF = (x = {}) => Object.assign({ tip: 'pf', prenume: 'Ana', nume: 'Albu' }, x);
const PJ = (x = {}) => Object.assign({ tip: 'pj', cui: CUI, denumire: 'Firma Simulata SRL', nr_reg_com: 'J12/3456/2020', adresa: ADRESA_FACT }, x);
const COMANDA = (x = {}) => Object.assign({ adresa: 'Str. Lucrării 1, Cluj-Napoca, Cluj', tara_cod: 'RO', regiune: 'Cluj', localitate: 'Cluj-Napoca', valoare_totala: 500 }, x);

function reset() {
  DB.tabele = {
    profiles: [{ id: CLIENT, email: 'client@test', roles: ['client'] }],
    tax_configurations: [{ tara_cod: 'RO', moneda: 'RON', cota_tva: 21, prag_minim_comanda: 100, checkout_activ: true }],
    comenzi: [], invoices: [], tarife_transport: [],
    // Configurația de preț (aceleași valori ca în scripts/test-marketplace-public.js).
    backoffice_config: [
      { sectiune: 'pricing', cheie: 'cost_marketing_pct', valoare: '3', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'cost_mentenanta_pct', valoare: '2', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'comision_platforma_default_pct', valoare: '12', tara_cod: 'ALL' },
      { sectiune: 'asigurari', cheie: 'cost_asigurare_pct', valoare: '1', tara_cod: 'ALL' },
    ],
  };
  DB.coloane = {};
  DB.implicite = { comenzi: { moneda: 'RON' } };
  DB.rpc = { cripteaza_camp: async ({ valoare }) => 'cripta:' + Buffer.from(valoare).toString('base64') };
  DB.utilizatori = { 'tok-client': { id: CLIENT, email: 'client@test' } };
  ANAF.mod = 'activa';
  ANAF.apeluri = 0;
}

let ok = 0, esec = 0;
async function test(nume, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + nume); }
  catch (e) { esec++; console.log('  ✗ ' + nume + ' — ' + e.message); }
}
function egal(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(c, m) { if (!c) throw new Error(m || 'condiție falsă'); }

async function cheama(api, { token = 'tok-client', metoda = 'POST', body = null, query = {} } = {}) {
  const res = raspuns();
  await api(cerere({ metoda, token, body, query }), res);
  return res;
}
const comanda = (body) => cheama(apiCreeaza, { body });
const ultima = () => DB.tabele.comenzi[DB.tabele.comenzi.length - 1];

async function testeServer() {
  console.log('A. lib/date-facturare.js');
  await test('PF fără adresă de facturare → b2c, copia adresei lucrării, fără CNP', async () => {
    const lucrare = { strada: 'Str. Lucrării 1', localitate: 'Cluj-Napoca', judet: 'Cluj', tara: 'RO' };
    const r = F.valideazaDateFacturare(PF(), { taraComanda: 'RO', adresaLucrare: lucrare });
    egal([r.ok, r.tip_client, r.cnp], [true, 'b2c', null]);
    egal(r.date_facturare, { tip: 'pf', prenume: 'Ana', nume: 'Albu', adresa: { strada: 'Str. Lucrării 1', localitate: 'Cluj-Napoca', judet: 'Cluj', cod_postal: null, tara: 'RO' }, cnp_furnizat: false, cnp_ultimele3: null });
  });
  await test('PF cu adresă separată: strada, localitatea, țara obligatorii; județul doar pentru RO', async () => {
    const r = (a) => F.valideazaDateFacturare(PF({ adresa_alta: true, adresa: a }), { taraComanda: 'RO' });
    egal(r(ADRESA_FACT).date_facturare.adresa, ADRESA_FACT);
    egal(r({ ...ADRESA_FACT, strada: '' }).camp, 'adresa.strada');
    egal(r({ ...ADRESA_FACT, localitate: '' }).camp, 'adresa.localitate');
    egal(r({ ...ADRESA_FACT, judet: '' }).camp, 'adresa.judet');
    egal(r({ strada: 'Hauptstraße 1', localitate: 'Berlin', tara: 'DE' }).ok, true, 'DE fără județ');
  });
  await test('PF: CNP invalid → camp cnp, mesaj RO + EN; CNP valid → doar ultimele 3 în date_facturare', async () => {
    const rau = F.valideazaDateFacturare(PF({ cnp: CNP_INVALID }), { taraComanda: 'RO' });
    egal([rau.ok, rau.camp], [false, 'cnp']);
    adevarat(rau.error && rau.error_en && rau.error !== rau.error_en, 'mesaj RO + EN');
    const bun = F.valideazaDateFacturare(PF({ cnp: ' ' + CNP + ' ' }), { taraComanda: 'RO' });
    egal([bun.cnp, bun.date_facturare.cnp_furnizat, bun.date_facturare.cnp_ultimele3], [CNP, true, CNP.slice(-3)]);
    adevarat(!JSON.stringify(bun.date_facturare).includes(CNP), 'CNP-ul nu e în date_facturare');
  });
  await test('PF din altă țară: CNP-ul nu se cere și nu se folosește', async () => {
    const r = F.valideazaDateFacturare(PF({ cnp: CNP_INVALID, adresa_alta: true, adresa: { strada: 'Hauptstraße 1', localitate: 'Berlin', tara: 'DE' } }), { taraComanda: 'RO' });
    egal([r.ok, r.cnp, r.date_facturare.cnp_furnizat], [true, null, false]);
  });
  await test('PJ: CUI lipsă / invalid → camp cui; denumire lipsă → camp denumire; sediul obligatoriu', async () => {
    egal(F.valideazaDateFacturare(PJ({ cui: '' }), {}).camp, 'cui');
    egal(F.valideazaDateFacturare(PJ({ cui: CUI_INVALID }), {}).camp, 'cui');
    egal(F.valideazaDateFacturare(PJ({ denumire: '' }), {}).camp, 'denumire');
    egal(F.valideazaDateFacturare(PJ({ adresa: null }), {}).camp, 'adresa.strada');
    const r = F.valideazaDateFacturare(PJ({ cui: 'ro 46577229' }), {});
    egal([r.ok, r.tip_client, r.date_facturare.cui, r.date_facturare.sursa], [true, 'b2b', 'RO46577229', 'manual']);
  });
  await test('PJ din altă țară: număr de înregistrare / TVA liber, 4–30 caractere', async () => {
    const strain = (cui) => F.valideazaDateFacturare(PJ({ cui, adresa: { strada: 'Hauptstraße 1', localitate: 'Berlin', tara: 'DE' } }), {});
    egal(strain('DE 123456789').ok, true);
    egal(strain('ABC').camp, 'cui');
    egal(strain('DE#123').camp, 'cui');
  });
  await test('fără date / tip necunoscut → camp date_facturare', async () => {
    egal(F.valideazaDateFacturare(null, {}).camp, 'date_facturare');
    egal(F.valideazaDateFacturare({ tip: 'pfa' }, {}).camp, 'date_facturare');
  });

  console.log('B. api/comenzi/creeaza.js');
  await test('PF fără CNP → 200, tip_client b2c, fără client_cnp_criptat', async () => {
    reset();
    const r = await comanda(COMANDA({ date_facturare: PF() }));
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    const c = ultima();
    egal([c.tip_client, c.date_facturare.tip, c.date_facturare.cnp_furnizat, 'client_cnp_criptat' in c], ['b2c', 'pf', false, false]);
  });
  await test('PF cu CNP invalid → 400 pe cnp (forma comună, RO + EN), nicio comandă', async () => {
    reset();
    const r = await comanda(COMANDA({ date_facturare: PF({ cnp: CNP_INVALID }) }));
    egal([r.statusCode, r.corp.cod, r.corp.camp, r.corp.campuri[0].camp], [400, 'DATE_FACTURARE_INVALIDE', 'cnp', 'cnp']);
    adevarat(r.corp.mesaj.ro && r.corp.mesaj.en && r.corp.error_en, 'mesaj RO + EN');
    egal(DB.tabele.comenzi.length, 0);
  });
  await test('PF cu CNP valid → client_cnp_criptat setat; CNP-ul nu apare în date_facturare sau în răspuns', async () => {
    reset();
    const r = await comanda(COMANDA({ date_facturare: PF({ cnp: CNP }) }));
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    const c = ultima();
    egal(c.client_cnp_criptat, 'cripta:' + Buffer.from(CNP).toString('base64'));
    egal([c.date_facturare.cnp_furnizat, c.date_facturare.cnp_ultimele3], [true, CNP.slice(-3)]);
    adevarat(!JSON.stringify(c.date_facturare).includes(CNP), 'date_facturare fără CNP');
    const t = JSON.stringify(r.corp);
    adevarat(!t.includes(CNP) && !t.includes('cripta:') && !('client_cnp_criptat' in r.corp.comanda), 'răspunsul fără CNP, nici criptat');
  });
  await test('criptarea eșuează → 500, nicio comandă', async () => {
    reset();
    DB.rpc = {};
    const r = await comanda(COMANDA({ date_facturare: PF({ cnp: CNP }) }));
    egal([r.statusCode, DB.tabele.comenzi.length], [500, 0]);
  });
  await test('PJ cu CUI invalid → 400 pe cui, fără apel ANAF', async () => {
    reset();
    const r = await comanda(COMANDA({ date_facturare: PJ({ cui: CUI_INVALID }) }));
    egal([r.statusCode, r.corp.camp, ANAF.apeluri, DB.tabele.comenzi.length], [400, 'cui', 0, 0]);
  });
  await test('PJ activă la ANAF → 200, tip_client b2b, sursa anaf, tva_activ', async () => {
    reset();
    const r = await comanda(COMANDA({ date_facturare: PJ() }));
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    const c = ultima();
    egal([c.tip_client, c.date_facturare.sursa, c.date_facturare.tva_activ, c.date_facturare.denumire, ANAF.apeluri], ['b2b', 'anaf', true, 'Firma Simulata SRL', 1]);
  });
  await test('PJ inactivă la ANAF → 400 FIRMA_INACTIVA, mesajul MESAJE_ANAF.firma_inactiva, nicio comandă', async () => {
    reset();
    ANAF.mod = 'inactiva';
    const r = await comanda(COMANDA({ date_facturare: PJ() }));
    egal([r.statusCode, r.corp.cod, r.corp.camp, r.corp.mesaj.ro, r.corp.mesaj.en],
      [400, 'FIRMA_INACTIVA', 'cui', 'Firma apare ca inactivă sau radiată la ANAF.', 'The company is listed as inactive or deregistered with ANAF.']);
    egal(DB.tabele.comenzi.length, 0);
  });
  await test('ANAF indisponibil → comanda trece, cu sursa manual', async () => {
    reset();
    ANAF.mod = 'indisponibil';
    const r = await comanda(COMANDA({ date_facturare: PJ() }));
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    egal([ultima().tip_client, ultima().date_facturare.sursa, ultima().date_facturare.tva_activ], ['b2b', 'manual', null]);
  });
  await test('PJ din altă țară: fără apel ANAF, sursa manual', async () => {
    reset();
    const r = await comanda(COMANDA({ date_facturare: PJ({ cui: 'DE123456789', adresa: { strada: 'Hauptstraße 1', localitate: 'Berlin', tara: 'DE' } }) }));
    egal([r.statusCode, ANAF.apeluri, ultima().date_facturare.sursa], [200, 0, 'manual']);
  });
  await test('fără adresă de facturare → copia adresei lucrării (adresa_lucrare pe câmpuri sau adresa comenzii)', async () => {
    reset();
    await comanda(COMANDA({ date_facturare: PF(), adresa_lucrare: { strada: 'Str. Lucrării 1', localitate: 'Cluj-Napoca', judet: 'Cluj', tara: 'RO' } }));
    egal(ultima().date_facturare.adresa, { strada: 'Str. Lucrării 1', localitate: 'Cluj-Napoca', judet: 'Cluj', cod_postal: null, tara: 'RO' });
    await comanda(COMANDA({ date_facturare: PF() }));
    egal(ultima().date_facturare.adresa, { strada: 'Str. Lucrării 1, Cluj-Napoca, Cluj', localitate: 'Cluj-Napoca', judet: 'Cluj', cod_postal: null, tara: 'RO' });
  });
  await test('comandă fără date_facturare → 400 cu camp date_facturare, nicio comandă', async () => {
    reset();
    const r = await comanda(COMANDA());
    egal([r.statusCode, r.corp.cod, r.corp.camp], [400, 'DATE_FACTURARE_INVALIDE', 'date_facturare']);
    adevarat(r.corp.mesaj.ro && r.corp.mesaj.en, 'mesaj RO + EN');
    egal(DB.tabele.comenzi.length, 0);
  });
  await test('B2G neatins: api/comenzi/creeaza-b2g.js identic cu main, fără date_facturare', async () => {
    const lucru = fs.readFileSync(path.join(RADACINA, 'api/comenzi/creeaza-b2g.js'), 'utf8').replace(/\r\n/g, '\n');
    const main = execFileSync('git', ['show', 'main:api/comenzi/creeaza-b2g.js'], { cwd: RADACINA, encoding: 'utf8' }).replace(/\r\n/g, '\n');
    egal(lucru === main, true, 'diferă de main');
    adevarat(!lucru.includes('date_facturare'), 'nu citește date_facturare');
  });

  console.log('C. api/client/date-facturare.js');
  await test('fără comenzi → null; fără autentificare → 401', async () => {
    reset();
    const r = await cheama(apiDateFacturare, { metoda: 'GET' });
    egal([r.statusCode, r.corp], [200, { ok: true, date_facturare: null }]);
    egal((await cheama(apiDateFacturare, { metoda: 'GET', token: null })).statusCode, 401);
  });
  await test('ultima comandă a clientului, fără CNP (doar cnp_furnizat și cnp_ultimele3)', async () => {
    reset();
    await comanda(COMANDA({ date_facturare: PJ() }));
    DB.tabele.comenzi[0].creat_la = '2026-10-20T10:00:00Z';
    await comanda(COMANDA({ date_facturare: PF({ cnp: CNP, adresa_alta: true, adresa: ADRESA_FACT }) }));
    DB.tabele.comenzi[1].creat_la = '2026-10-25T10:00:00Z';
    DB.tabele.comenzi.push({ id: 'alt', client_id: 'altcineva', creat_la: '2026-10-26T00:00:00Z', date_facturare: PJ() });
    const r = await cheama(apiDateFacturare, { metoda: 'GET' });
    egal(r.corp.date_facturare, { tip: 'pf', prenume: 'Ana', nume: 'Albu', cnp_furnizat: true, cnp_ultimele3: CNP.slice(-3), adresa: ADRESA_FACT });
    adevarat(!JSON.stringify(r.corp).includes(CNP) && !JSON.stringify(r.corp).includes('cripta:'), 'fără CNP');
  });
  await test('POST → 405', async () => {
    reset();
    egal((await cheama(apiDateFacturare, { metoda: 'POST' })).statusCode, 405);
  });

  console.log('D. Proforma PDF');
  const PDFDocument = require('pdfkit');
  async function texteProforma(comandaRow) {
    const texte = [];
    const orig = PDFDocument.prototype.text;
    PDFDocument.prototype.text = function (t, ...rest) { texte.push(String(t)); return orig.call(this, t, ...rest); };
    try {
      const buf = await genereazaProformaPDF({ invoice: { numar_document: 'PF-2026-000001', emisa_la: '2026-10-25', suma_totala: 500, moneda: 'RON' }, comanda: { nr_comanda: 'DA-2026-00001', adresa: 'Str. Lucrării 1', ...comandaRow }, serviciu: null, clientEmail: 'client@test', entitateJuridica: null, contBancar: null });
      adevarat(buf.slice(0, 4).toString() === '%PDF', 'PDF valid');
    } finally { PDFDocument.prototype.text = orig; }
    const i = texte.indexOf('CLIENT');
    return texte.slice(i + 1, texte.indexOf('LOCAȚIA PRESTĂRII / LIVRĂRII'));
  }
  await test('PF: nume, prenume și adresa, fără CNP', async () => {
    reset();
    await comanda(COMANDA({ date_facturare: PF({ cnp: CNP, adresa_alta: true, adresa: ADRESA_FACT }) }));
    const t = await texteProforma(ultima());
    egal(t, ['Albu Ana', 'Adresa: Str. Facturii 5, Cluj-Napoca, Cluj, 400002, RO', 'client@test']);
    adevarat(!t.join(' ').includes(CNP), 'fără CNP');
  });
  await test('PJ: denumire, CUI, Nr. Reg. Com., sediu', async () => {
    reset();
    await comanda(COMANDA({ date_facturare: PJ() }));
    egal(await texteProforma(ultima()), ['Firma Simulata SRL', 'CUI: RO46577229', 'Nr. reg. com.: J12/3456/2020', 'Sediu: Str. Facturii 5, Cluj-Napoca, Cluj, 400002, RO', 'client@test']);
  });
  await test('comandă veche, fără date_facturare: doar emailul, ca înainte', async () => {
    egal(await texteProforma({}), ['client@test']);
  });
}

// ═══ E. Pagina, în Chromium ══════════════════════════════════════════
async function testePagina() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { esec++; console.log('  ✗ Playwright lipsește'); return; }
  const { porneste } = require('./server-test');
  const CAPTURI = process.env.CAPTURI ? path.resolve(process.env.CAPTURI) : null;
  if (CAPTURI) fs.mkdirSync(CAPTURI, { recursive: true });
  const USER = { id: CLIENT, email: 'client@test', roles: ['client'] };
  const CFG = { titlu: 'Serviciu de test', total: 500, bazaRaw: 400, tara_cod: 'RO', addr: 'Str. Lucrării 1', localitate: 'Cluj-Napoca', materiale: [], inchirieri: [] };
  const API = {
    '/api/comenzi/creeaza': apiCreeaza,
    '/api/client/date-facturare': apiDateFacturare,
    '/api/public/cui-lookup': apiCuiLookup,
    '/api/public/tari-active': async (req, res) => res.status(200).json({ ok: true, active: ['RO'], tari: [{ tara_cod: 'RO', tara_nume: 'România' }], tva: { RO: 21 } }),
  };

  function sesiune(user) {
    const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
    const ses = { access_token: 'tok-client', user };
    const client = {
      auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: ses }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) },
      from: () => lant({ data: [], error: null, count: 0 }), rpc: () => lant({ data: null, error: null }), storage: { from: () => lant({ data: null, error: null }) }, channel: () => lant({}), removeChannel: () => {},
    };
    const auth = new Proxy({ getCurrentUser: async () => user, getUserRoles: async () => user.roles, hasRole: async () => true, performLogout: () => {} }, { get: (t, k) => (k in t ? t[k] : async () => null) });
    const fix = (n, v) => Object.defineProperty(window, n, { configurable: true, get: () => v, set: () => {} });
    fix('supabaseClient', client); fix('MyDarrinAuth', auth);
  }

  async function deschide(browser, baza, latime, lang) {
    const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 720 ? 844 : 900 }, hasTouch: latime < 720 });
    await ctx.addInitScript(([l, cfg]) => {
      try {
        localStorage.setItem('myd_lang_v1', l);
        localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
        sessionStorage.setItem('myd_checkout_config', JSON.stringify(cfg));
      } catch (e) {}
    }, [lang, CFG]);
    await ctx.addInitScript(sesiune, USER);
    await ctx.route(/\.supabase\.co\//, (r) => r.abort());
    const cereri = [];
    await ctx.route(/\/api\//, async (r) => {
      const req = r.request();
      const url = new URL(req.url());
      let corp = null; try { corp = JSON.parse(req.postData() || 'null'); } catch (e) { corp = null; }
      cereri.push({ cale: url.pathname, metoda: req.method(), corp });
      const api = API[url.pathname];
      if (!api) return r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"API unavailable on the test server"}' });
      const res = raspuns();
      await api(cerere({ metoda: req.method(), token: (req.headers().authorization || '').replace('Bearer ', '') || null, body: corp, query: Object.fromEntries(url.searchParams) }), res);
      return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp || {}) });
    });
    const pg = await ctx.newPage();
    pg.setDefaultTimeout(8000);
    pg.erori = [];
    pg.cereri = cereri;
    pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 200)));
    await pg.goto(baza + '/mydarrin-checkout.html', { waitUntil: 'networkidle' });
    await pg.waitForTimeout(400);
    return { ctx, pg };
  }
  const vizibil = (pg, sel) => pg.isVisible(sel);
  const depasire = (pg) => pg.evaluate(() => {
    const W = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > W + 1) return 'pagina: ' + document.documentElement.scrollWidth;
    return [...document.querySelectorAll('#step-details *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width && (r.left < -1 || r.right > W + 1);
    }).slice(0, 3).map((el) => el.id || el.tagName).join(', ');
  });
  const completeazaContact = async (pg) => {
    await pg.fill('#co-prenume', 'Ana'); await pg.fill('#co-nume', 'Albu');
    await pg.fill('#co-telefon', '+40 721 000 000'); await pg.fill('#co-email', 'client@example.com');
    await pg.fill('#co-adresa', 'Str. Lucrării 1'); await pg.fill('#co-oras', 'Cluj-Napoca');
    await pg.selectOption('#co-judet', 'Cluj');
  };
  const captura = async (pg, nume) => { if (CAPTURI) await pg.screenshot({ path: path.join(CAPTURI, nume + '.png'), fullPage: false }).catch(() => {}); };

  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const lang of ['ro', 'en']) {
      for (const latime of [390, 1366]) {
        const et = `${lang.toUpperCase()} ${latime}px`;
        reset();
        const { ctx, pg } = await deschide(browser, baza, latime, lang);
        await pg.evaluate(() => goToStep('details'));
        await pg.waitForTimeout(200);

        await test(`${et}: implicit „Persoană fizică”: CNP opțional și bifa adresei, fără câmpurile de firmă`, async () => {
          egal(await pg.isChecked('#fact-tip-pf'), true);
          egal([await vizibil(pg, '#fact-cnp'), await vizibil(pg, '#fact-adresa-alta'), await vizibil(pg, '#fact-cui'), await vizibil(pg, '#fact-strada')], [true, true, false, false]);
          await pg.check('#fact-adresa-alta');
          egal(await vizibil(pg, '#fact-strada'), true, 'bifa arată adresa de facturare');
          await pg.uncheck('#fact-adresa-alta');
        });
        await test(`${et}: din tastatură (săgeată) → „Factură pe firmă”: CUI, căutare, denumire, Nr. Reg. Com., sediu; fără CNP`, async () => {
          await pg.focus('#fact-tip-pf');
          await pg.keyboard.press('ArrowRight');
          egal(await pg.isChecked('#fact-tip-pj'), true);
          egal([await vizibil(pg, '#fact-cui'), await vizibil(pg, '#fact-cauta'), await vizibil(pg, '#fact-denumire'), await vizibil(pg, '#fact-nrregcom'), await vizibil(pg, '#fact-strada'), await vizibil(pg, '#fact-cnp')], [true, true, true, true, true, false]);
        });
        await test(`${et}: textele blocului în limba paginii`, async () => {
          // textContent al părților vizibile (etichetele au uppercase din CSS).
          const t = await pg.$eval('#fact-bloc', (b) => [...b.querySelectorAll('label, legend, span, button, div')]
            .filter((el) => el.offsetParent !== null && !el.children.length).map((el) => el.textContent).join(' | '));
          if (lang === 'en') {
            for (const s of ['Invoice to a company', 'Private individual', 'Look up', 'Company name', 'Registered office']) adevarat(t.includes(s), 'lipsește „' + s + '”');
            adevarat(!/[ăâîșțĂÂÎȘȚ]/.test(t) && !/Persoană|Factură|Caută|Denumirea|Sediul/.test(t), 'text românesc în EN: ' + t.replace(/\s+/g, ' ').slice(0, 200));
          } else {
            for (const s of ['Factură pe firmă', 'Persoană fizică', 'Caută la ANAF', 'Denumirea firmei', 'Sediul firmei']) adevarat(t.includes(s), 'lipsește „' + s + '”');
          }
        });
        await test(`${et}: nicio depășire pe lățime (PF și PJ)`, async () => {
          egal(await depasire(pg), '', 'PJ');
          await captura(pg, `11p2b-pj-${lang}-${latime}`);
          await pg.check('#fact-tip-pf'); await pg.check('#fact-adresa-alta');
          egal(await depasire(pg), '', 'PF cu adresă');
          await captura(pg, `11p2b-pf-${lang}-${latime}`);
          await pg.uncheck('#fact-adresa-alta'); await pg.check('#fact-tip-pj');
        });
        await test(`${et}: CUI invalid → eroarea sub câmp, pasul nu avansează`, async () => {
          await completeazaContact(pg);
          await pg.fill('#fact-cui', CUI_INVALID);
          await pg.evaluate(() => goToStep('payment'));
          egal(await vizibil(pg, '#step-details'), true);
          const err = await pg.$eval('#fact-cui', (el) => [el.getAttribute('aria-invalid'), el.parentElement.querySelector('.co-eroare')?.textContent || '']);
          egal(err[0], 'true');
          adevarat(lang === 'en' ? /not valid/.test(err[1]) : /nu este valid/.test(err[1]), 'mesaj: ' + err[1]);
        });
        await test(`${et}: „Caută la ANAF” precompletează denumirea, Nr. Reg. Com. și sediul (editabile)`, async () => {
          await pg.fill('#fact-cui', CUI);
          await pg.click('#fact-cauta');
          await pg.waitForFunction(() => document.getElementById('fact-denumire').value !== '', null, { timeout: 5000 });
          egal([await pg.inputValue('#fact-denumire'), await pg.inputValue('#fact-nrregcom'), await pg.inputValue('#fact-localitate'), await pg.inputValue('#fact-judet')], ['FIRMA SIMULATA SRL', 'J12/3456/2020', 'Mun. Cluj-Napoca', 'CLUJ']);
          egal(await pg.isEditable('#fact-denumire'), true);
          const st = await pg.innerText('#fact-anaf-status');
          adevarat(lang === 'en' ? /register/.test(st) : /registru/.test(st), 'stare: ' + st);
        });
        await test(`${et}: firmă inactivă → comanda refuzată, eroarea ANAF sub CUI în pasul „Detalii”`, async () => {
          ANAF.mod = 'inactiva';
          await pg.evaluate(() => goToStep('payment'));
          await pg.click('#btn-finalizeaza');
          await pg.waitForFunction(() => document.getElementById('fact-cui').getAttribute('aria-invalid') === 'true', null, { timeout: 5000 });
          egal(await vizibil(pg, '#step-details'), true);
          const m = await pg.$eval('#fact-cui', (el) => el.parentElement.querySelector('.co-eroare').textContent);
          egal(m, lang === 'en' ? 'The company is listed as inactive or deregistered with ANAF.' : 'Firma apare ca inactivă sau radiată la ANAF.');
          egal(DB.tabele.comenzi.length, 0);
          ANAF.mod = 'activa';
        });
        await test(`${et}: comanda trimisă cu date_facturare (PJ) → salvată b2b, sursa anaf`, async () => {
          await pg.evaluate(() => goToStep('payment'));
          await pg.click('#btn-finalizeaza');
          await pg.waitForSelector('#order-confirm-overlay', { timeout: 5000 });
          const trimis = pg.cereri.filter((c) => c.cale === '/api/comenzi/creeaza').pop().corp;
          egal([trimis.date_facturare.tip, trimis.date_facturare.cui, trimis.adresa_lucrare.strada], ['pj', CUI, 'Str. Lucrării 1']);
          egal([ultima().tip_client, ultima().date_facturare.sursa, ultima().date_facturare.denumire], ['b2b', 'anaf', 'FIRMA SIMULATA SRL']);
        });
        await test(`${et}: 0 erori JS`, async () => { egal(pg.erori, []); });
        await ctx.close();
      }
    }

    // PF cu CNP, B2G și precompletarea (o singură lățime e de ajuns pentru flux).
    {
      reset();
      const { ctx, pg } = await deschide(browser, baza, 390, 'ro');
      await pg.evaluate(() => goToStep('details'));
      await completeazaContact(pg);
      await test('RO 390px: CNP invalid → eroarea sub CNP; CNP valid → comanda b2c, CNP-ul doar criptat', async () => {
        await pg.fill('#fact-cnp', CNP_INVALID);
        await pg.evaluate(() => goToStep('payment'));
        egal(await pg.$eval('#fact-cnp', (el) => el.getAttribute('aria-invalid')), 'true');
        await pg.fill('#fact-cnp', CNP);
        await pg.evaluate(() => goToStep('payment'));
        await pg.click('#btn-finalizeaza');
        await pg.waitForSelector('#order-confirm-overlay', { timeout: 5000 });
        const c = ultima();
        egal([c.tip_client, c.date_facturare.prenume, c.date_facturare.adresa.strada, c.date_facturare.cnp_ultimele3], ['b2c', 'Ana', 'Str. Lucrării 1', CNP.slice(-3)]);
        adevarat(c.client_cnp_criptat && !JSON.stringify(c.date_facturare).includes(CNP), 'criptat, nu în date_facturare');
      });
      await test('RO 390px: B2G bifat → blocul de facturare ascuns și netrimis', async () => {
        await pg.evaluate(() => { document.getElementById('order-confirm-overlay')?.remove(); goToStep('payment'); });
        await pg.check('#b2g-toggle');
        await pg.evaluate(() => goToStep('details'));
        egal(await vizibil(pg, '#fact-bloc'), false);
        await pg.evaluate(() => goToStep('payment'));
        await pg.fill('#b2g-denumire', 'Primăria Test'); await pg.fill('#b2g-cui', CUI);
        await pg.click('#btn-finalizeaza');
        await pg.waitForTimeout(500);
        const b2g = pg.cereri.filter((c) => c.cale === '/api/comenzi/creeaza-b2g').pop();
        adevarat(b2g, 'cererea B2G a plecat');
        adevarat(!('date_facturare' in b2g.corp) && !('adresa_lucrare' in b2g.corp), 'fără date_facturare în B2G');
      });
      await test('RO 390px: 0 erori JS', async () => { egal(pg.erori, []); });
      await ctx.close();
    }
    {
      // Ultima comandă e o factură pe firmă: pagina pornește cu ea precompletată.
      reset();
      await comanda(COMANDA({ date_facturare: PJ() }));
      const { ctx, pg } = await deschide(browser, baza, 1366, 'en');
      await pg.evaluate(() => goToStep('details'));
      await test('EN 1366px: precompletare din ultima comandă (PJ, CUI, denumire, sediu)', async () => {
        await pg.waitForFunction(() => document.getElementById('fact-cui').value !== '', null, { timeout: 5000 });
        egal([await pg.isChecked('#fact-tip-pj'), await pg.inputValue('#fact-cui'), await pg.inputValue('#fact-denumire'), await pg.inputValue('#fact-strada')], [true, CUI, 'Firma Simulata SRL', 'Str. Facturii 5']);
        egal(await vizibil(pg, '#fact-cui'), true);
      });
      await test('EN 1366px: 0 erori JS', async () => { egal(pg.erori, []); });
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

(async () => {
  await testeServer();
  // FARA_BROWSER=1: doar testele de server (A–D).
  if (!process.env.FARA_BROWSER) {
    console.log('E. mydarrin-checkout.html (Chromium)');
    await testePagina();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})();
