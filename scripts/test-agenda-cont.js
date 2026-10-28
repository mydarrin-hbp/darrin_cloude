// scripts/test-agenda-cont.js
// Teste pentru pasul 11-P3a (26 oct. 2026): agenda contului (adresele și
// profilurile de facturare), peste un Supabase simulat (scripts/supabase-simulat.js)
// și un ANAF simulat (fetch înlocuit în acest proces) — nimic nu ajunge la
// Supabase, la ANAF sau la producție:
//   A. api/cont/agenda.js: CRUD pe adrese și profiluri; `id` al altui cont → 404;
//      limitele 10 / 5 → 409; o singură implicită pe tip; CNP-ul nu apare
//      niciodată în clar; ANAF inactivă → refuz, indisponibil → sursa manual;
//      ștergerea adresei folosite de un profil; „Folosește datele firmei mele”;
//   B. api/comenzi/creeaza.js: profil_facturare_id / adresa_prestare_id proprii →
//      copia corectă (și CNP-ul criptat); id-uri străine → 404; salveaza_in_cont →
//      apar în agendă (fără dubluri); agenda indisponibilă → agenda_nesalvata;
//      modificarea agendei nu schimbă comanda;
//   B2. corecția PR #36: cu adresa_prestare_id, țara, județul și localitatea
//      comenzii vin doar din adresa salvată (și prețul pe calea nivel_id se
//      calculează cu județul ei); altă țară → 409 ADRESA_ALTA_TARA; preț din
//      client cu altă localitate / alt județ → 409 ADRESA_SCHIMBATA_PRET;
//   C. api/client/date-facturare.js: profilul implicit din agendă;
//   D. paginile în Chromium, 390 și 1366 px, RO și EN: secțiunea din fiecare
//      dashboard; alegerea și gestionarea din checkout (panoul se deschide și
//      se închide din tastatură, selecția păstrată după editare, ștergerea
//      adresei alese golește selecția); sincronizarea dashboard ↔ checkout;
//      coșul pentru un client fără comenzi; nicio depășire pe lățime;
//      checkout-ul recalculează prețul și disponibilitatea când se schimbă
//      adresa de prestare (corecția PR #36).
// Capturi (opțional): CAPTURI=<folder> node scripts/test-agenda-cont.js
// Rulare: node scripts/test-agenda-cont.js   (FARA_BROWSER=1: doar A–C; LIMBI=ro LATIMI=390: o parte din D)

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

// ANAF simulat: ANAF.mod = 'activa' | 'inactiva' | 'indisponibil'.
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

// Calea nivel_id: calculul pe rețetă e simulat (cifre de test) și reține
// județul cu care e chemat; restul modulului rămâne cel real.
const RETETA = { regiuni: [] };
const modulReteta = require(path.join(RADACINA, 'lib/calculeaza-cost-recipe.js'));
modulReteta.calculeazaCostNivel = async ({ regiune }) => {
  RETETA.regiuni.push(regiune);
  return { nivel_activ: true, resurse_fara_pret: [], cost_baza_servicii: 300, cost_materiale: 0, cost_utilaj: 0, manopera_per_esco: {} };
};

const apiAgenda = require(path.join(RADACINA, 'api/cont/agenda.js'));
const apiCreeaza = require(path.join(RADACINA, 'api/comenzi/creeaza.js'));
const apiDateFacturare = require(path.join(RADACINA, 'api/client/date-facturare.js'));
const apiCuiLookup = require(path.join(RADACINA, 'api/public/cui-lookup.js'));

const U = 'a0000000-0000-4000-8000-00000000000a';   // contul testat
const ALT = 'b0000000-0000-4000-8000-00000000000b'; // alt cont
const CUI = 'RO46577229';
function cuControl(primele12) {
  const cheie = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9];
  const r = primele12.split('').reduce((s, c, i) => s + Number(c) * cheie[i], 0) % 11;
  return primele12 + (r === 10 ? 1 : r);
}
const CNP = cuControl('185031440123');
const CNP_INVALID = CNP.slice(0, 12) + ((Number(CNP[12]) + 1) % 10);
const ADR = (x = {}) => Object.assign({ eticheta: 'Acasă', folosire: 'ambele', strada: 'Str. Lucrării 1', localitate: 'Cluj-Napoca', judet: 'Cluj', cod_postal: '400001', tara: 'RO' }, x);

function reset() {
  DB.tabele = {
    profiles: [{ id: U, email: 'client@example.com', roles: ['client'] }, { id: ALT, email: 'alt@example.com', roles: ['client'] }],
    tax_configurations: [{ tara_cod: 'RO', moneda: 'RON', cota_tva: 21, prag_minim_comanda: 100, checkout_activ: true }],
    comenzi: [], invoices: [], tarife_transport: [],
    backoffice_config: [
      { sectiune: 'pricing', cheie: 'cost_marketing_pct', valoare: '3', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'cost_mentenanta_pct', valoare: '2', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'comision_platforma_default_pct', valoare: '12', tara_cod: 'ALL' },
      { sectiune: 'asigurari', cheie: 'cost_asigurare_pct', valoare: '1', tara_cod: 'ALL' },
    ],
    adrese_cont: [], profiluri_facturare: [], partners: [],
  };
  DB.coloane = {};
  DB.implicite = { comenzi: { moneda: 'RON' }, adrese_cont: { creat_la: '2026-10-26T00:00:00Z' }, profiluri_facturare: { creat_la: '2026-10-26T00:00:00Z' } };
  DB.rpc = { cripteaza_camp: async ({ valoare }) => 'cripta:' + Buffer.from(valoare).toString('base64') };
  DB.utilizatori = { 'tok-u': { id: U, email: 'client@example.com' }, 'tok-alt': { id: ALT, email: 'alt@example.com' } };
  ANAF.mod = 'activa';
  ANAF.apeluri = 0;
  RETETA.regiuni = [];
}

let ok = 0, esec = 0;
async function test(nume, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + nume); }
  catch (e) { esec++; console.log('  ✗ ' + nume + ' — ' + e.message); }
}
function egal(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(c, m) { if (!c) throw new Error(m || 'condiție falsă'); }

async function cheama(api, { token = 'tok-u', metoda = 'POST', body = null } = {}) {
  const res = raspuns();
  await api(cerere({ metoda, token, body }), res);
  return res;
}
const agenda = (body, token) => cheama(apiAgenda, { body, token });
const citeste = (token) => cheama(apiAgenda, { metoda: 'GET', token });
// Prețul de test (calea veche) e calculat pentru zona adreselor din ADR(): Cluj-Napoca, Cluj.
const comanda = (body, token) => cheama(apiCreeaza, { body: Object.assign({ adresa: 'Str. X 1, Cluj-Napoca, Cluj', tara_cod: 'RO', regiune: 'Cluj', localitate: 'Cluj-Napoca', valoare_totala: 500 }, body), token });
const adreseU = () => DB.tabele.adrese_cont.filter((a) => a.user_id === U);
const profiluriU = () => DB.tabele.profiluri_facturare.filter((p) => p.user_id === U);
function faraCnp(corp) {
  const t = JSON.stringify(corp);
  adevarat(!t.includes(CNP) && !t.includes('cripta:') && !t.includes('cnp_criptat'), 'răspunsul conține CNP-ul (în clar sau criptat)');
}

async function testeServer() {
  console.log('A. api/cont/agenda.js');
  await test('GET gol → liste goale, fără firma partenerului; fără autentificare → 401', async () => {
    reset();
    const r = await citeste();
    egal([r.statusCode, r.corp], [200, { ok: true, adrese: [], profiluri: [], firma_partener: null }]);
    egal((await citeste(null)).statusCode, 401);
  });
  await test('adresa: salvată; prima adresă „ambele” devine implicită pentru prestare și facturare; user_id nu iese', async () => {
    reset();
    const r = await agenda({ actiune: 'adresa_salveaza', ...ADR() });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    egal(r.corp.adrese.length, 1);
    const a = r.corp.adrese[0];
    egal([a.id === r.corp.id, a.strada, a.implicita_prestare, a.implicita_facturare, 'user_id' in a], [true, 'Str. Lucrării 1', true, true, false]);
  });
  await test('adresa invalidă → 400 cu camp (strada, judet pentru RO, folosire), mesaj RO + EN', async () => {
    reset();
    const r1 = await agenda({ actiune: 'adresa_salveaza', ...ADR({ strada: '' }) });
    egal([r1.statusCode, r1.corp.camp, r1.corp.campuri[0].camp], [400, 'strada', 'strada']);
    adevarat(r1.corp.mesaj.ro && r1.corp.mesaj.en, 'RO + EN');
    egal((await agenda({ actiune: 'adresa_salveaza', ...ADR({ judet: '' }) })).corp.camp, 'judet');
    egal((await agenda({ actiune: 'adresa_salveaza', ...ADR({ folosire: 'oricum' }) })).corp.camp, 'folosire');
    egal((await agenda({ actiune: 'adresa_salveaza', ...ADR({ tara: 'DE', judet: '' }) })).statusCode, 200, 'DE fără județ');
  });
  await test('o singură implicită pe tip: a doua setată implicită o scoate pe prima', async () => {
    reset();
    const a1 = (await agenda({ actiune: 'adresa_salveaza', ...ADR() })).corp.id;
    const a2 = (await agenda({ actiune: 'adresa_salveaza', ...ADR({ eticheta: 'Birou', strada: 'Str. Birou 2', implicita_prestare: true }) })).corp.id;
    egal(adreseU().filter((a) => a.implicita_prestare).map((a) => a.id), [a2]);
    egal(adreseU().filter((a) => a.implicita_facturare).map((a) => a.id), [a1]);
    const r = await agenda({ actiune: 'seteaza_implicit', tip: 'adresa_facturare', id: a2 });
    egal(r.statusCode, 200);
    egal(adreseU().filter((a) => a.implicita_facturare).map((a) => a.id), [a2]);
  });
  await test('editare: folosire „facturare” scoate marcajul de prestare; implicită pe o folosire nepotrivită → 400', async () => {
    reset();
    const id = (await agenda({ actiune: 'adresa_salveaza', ...ADR() })).corp.id;
    const r = await agenda({ actiune: 'adresa_salveaza', id, ...ADR({ folosire: 'facturare', eticheta: 'Sediu' }) });
    egal(r.statusCode, 200);
    egal([adreseU()[0].eticheta, adreseU()[0].implicita_prestare, adreseU()[0].implicita_facturare, adreseU()[0].instructiuni_acces], ['Sediu', false, true, null]);
    const r2 = await agenda({ actiune: 'seteaza_implicit', tip: 'adresa_prestare', id });
    egal([r2.statusCode, r2.corp.camp], [400, 'tip']);
  });
  await test('id-ul altui cont → 404 la editare, ștergere, implicit și ca adresă de profil; nimic modificat', async () => {
    reset();
    const strain = (await agenda({ actiune: 'adresa_salveaza', ...ADR() }, 'tok-alt')).corp.id;
    const profilStrain = (await agenda({ actiune: 'profil_salveaza', tip: 'pf', prenume: 'Alt', nume: 'Cont' }, 'tok-alt')).corp.id;
    for (const body of [
      { actiune: 'adresa_salveaza', id: strain, ...ADR({ eticheta: 'furat' }) },
      { actiune: 'adresa_sterge', id: strain },
      { actiune: 'seteaza_implicit', tip: 'adresa_prestare', id: strain },
      { actiune: 'profil_salveaza', id: profilStrain, tip: 'pf', prenume: 'X', nume: 'Y' },
      { actiune: 'profil_sterge', id: profilStrain },
      { actiune: 'seteaza_implicit', tip: 'profil', id: profilStrain },
      { actiune: 'profil_salveaza', tip: 'pj', cui: CUI, denumire: 'Firma', adresa_facturare_id: strain },
    ]) {
      const r = await agenda(body);
      egal([r.statusCode, r.corp.cod], [404, 'NU_EXISTA'], body.actiune);
    }
    egal([DB.tabele.adrese_cont.length, DB.tabele.adrese_cont[0].eticheta, DB.tabele.profiluri_facturare.length], [1, 'Acasă', 1]);
  });
  await test('limita de 10 adrese → 409 LIMITA_ATINSA, mesaj clar', async () => {
    reset();
    for (let i = 0; i < 10; i++) egal((await agenda({ actiune: 'adresa_salveaza', ...ADR({ strada: 'Str. ' + i + ' nr. 1' }) })).statusCode, 200);
    const r = await agenda({ actiune: 'adresa_salveaza', ...ADR({ strada: 'Str. 11 nr. 1' }) });
    egal([r.statusCode, r.corp.cod], [409, 'LIMITA_ATINSA']);
    adevarat(/10 adrese/.test(r.corp.mesaj.ro) && /10 saved addresses/.test(r.corp.mesaj.en), 'mesaj');
    egal(adreseU().length, 10);
  });
  await test('profil PF cu CNP: criptat + ultimele 3; CNP-ul nu apare în răspuns; câmpul gol păstrează CNP-ul; sterge_cnp îl șterge', async () => {
    reset();
    const r = await agenda({ actiune: 'profil_salveaza', tip: 'pf', prenume: 'Ana', nume: 'Albu', cnp: CNP });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    faraCnp(r.corp);
    const p = r.corp.profiluri[0];
    egal([p.cnp_furnizat, p.cnp_ultimele3, p.implicit, p.adresa_facturare_id], [true, CNP.slice(-3), true, null]);
    egal(profiluriU()[0].cnp_criptat, 'cripta:' + Buffer.from(CNP).toString('base64'));
    const r2 = await agenda({ actiune: 'profil_salveaza', id: p.id, tip: 'pf', prenume: 'Ana Maria', nume: 'Albu', cnp: '' });
    faraCnp(r2.corp);
    egal([profiluriU()[0].prenume, !!profiluriU()[0].cnp_criptat], ['Ana Maria', true], 'gol → păstrat');
    faraCnp((await citeste()).corp);
    await agenda({ actiune: 'profil_salveaza', id: p.id, tip: 'pf', prenume: 'Ana', nume: 'Albu', sterge_cnp: true });
    egal([profiluriU()[0].cnp_criptat, profiluriU()[0].cnp_ultimele3], [null, null]);
  });
  await test('profil PF cu CNP invalid → 400 pe cnp; fără nume → 400 pe nume', async () => {
    reset();
    egal((await agenda({ actiune: 'profil_salveaza', tip: 'pf', prenume: 'Ana', nume: 'Albu', cnp: CNP_INVALID })).corp.camp, 'cnp');
    egal((await agenda({ actiune: 'profil_salveaza', tip: 'pf', prenume: 'Ana', nume: '' })).corp.camp, 'nume');
    egal(profiluriU().length, 0);
  });
  await test('profil PJ: fără sediu → 400; cu adresă nouă → adresa creată (facturare) și legată; ANAF activă → sursa anaf', async () => {
    reset();
    egal((await agenda({ actiune: 'profil_salveaza', tip: 'pj', cui: CUI, denumire: 'Firma Simulata SRL' })).corp.camp, 'adresa_facturare_id');
    const r = await agenda({ actiune: 'profil_salveaza', tip: 'pj', cui: CUI, denumire: 'Firma Simulata SRL', nr_reg_com: 'J12/3456/2020', adresa_noua: { strada: 'Str. Exemplu nr. 1', localitate: 'Cluj-Napoca', judet: 'Cluj', tara: 'RO' } });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    const p = profiluriU()[0];
    egal([p.tip, p.sursa, p.tva_activ, p.adresa_facturare_id === adreseU()[0].id, adreseU()[0].folosire, adreseU()[0].implicita_facturare], ['pj', 'anaf', true, true, 'facturare', true]);
    const rau = await agenda({ actiune: 'profil_salveaza', tip: 'pj', cui: CUI, denumire: 'X', adresa_noua: { strada: '', localitate: 'Cluj', judet: 'Cluj', tara: 'RO' } });
    egal(rau.corp.camp, 'adresa_noua.strada');
  });
  await test('profil PJ inactivă la ANAF → 400 FIRMA_INACTIVA, nimic salvat (nici adresa nouă); ANAF indisponibil → sursa manual', async () => {
    reset();
    ANAF.mod = 'inactiva';
    const r = await agenda({ actiune: 'profil_salveaza', tip: 'pj', cui: CUI, denumire: 'Firma', adresa_noua: { strada: 'Str. Exemplu 1', localitate: 'Cluj-Napoca', judet: 'Cluj', tara: 'RO' } });
    egal([r.statusCode, r.corp.cod, r.corp.camp, r.corp.mesaj.ro], [400, 'FIRMA_INACTIVA', 'cui', 'Firma apare ca inactivă sau radiată la ANAF.']);
    egal([profiluriU().length, adreseU().length], [0, 0]);
    ANAF.mod = 'indisponibil';
    const r2 = await agenda({ actiune: 'profil_salveaza', tip: 'pj', cui: CUI, denumire: 'Firma', adresa_noua: { strada: 'Str. Exemplu 1', localitate: 'Cluj-Napoca', judet: 'Cluj', tara: 'RO' } });
    egal([r2.statusCode, profiluriU()[0].sursa, profiluriU()[0].tva_activ], [200, 'manual', null]);
  });
  await test('limita de 5 profiluri → 409; un singur profil implicit', async () => {
    reset();
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await agenda({ actiune: 'profil_salveaza', tip: 'pf', prenume: 'Ana' + i, nume: 'Albu' })).corp.id);
    const r = await agenda({ actiune: 'profil_salveaza', tip: 'pf', prenume: 'Ana6', nume: 'Albu' });
    egal([r.statusCode, r.corp.cod], [409, 'LIMITA_ATINSA']);
    egal(profiluriU().filter((p) => p.implicit).map((p) => p.id), [ids[0]]);
    await agenda({ actiune: 'seteaza_implicit', tip: 'profil', id: ids[3] });
    egal(profiluriU().filter((p) => p.implicit).map((p) => p.id), [ids[3]]);
  });
  await test('ștergerea adresei folosite de un profil: profilul rămâne, fără adresă, și e semnalat', async () => {
    reset();
    const a = (await agenda({ actiune: 'adresa_salveaza', ...ADR() })).corp.id;
    const p = (await agenda({ actiune: 'profil_salveaza', tip: 'pj', cui: CUI, denumire: 'Firma', adresa_facturare_id: a })).corp.id;
    const r = await agenda({ actiune: 'adresa_sterge', id: a });
    egal([r.statusCode, r.corp.profiluri_fara_adresa, r.corp.adrese.length, r.corp.profiluri.length, r.corp.profiluri[0].adresa_facturare_id], [200, [p], 0, 1, null]);
    egal((await agenda({ actiune: 'profil_sterge', id: p })).corp.profiluri.length, 0);
  });
  await test('partenerul primește datele firmei din partners („Folosește datele firmei mele”)', async () => {
    reset();
    DB.tabele.partners.push({ id: U, nume_firma: 'Partener Test SRL', cui: CUI, nr_reg_com: 'J12/1/2020', adresa_sediu_social: 'Str. Sediu 3, Cluj' });
    egal((await citeste()).corp.firma_partener, { denumire: 'Partener Test SRL', cui: CUI, nr_reg_com: 'J12/1/2020', sediu: 'Str. Sediu 3, Cluj' });
  });
  await test('acțiune necunoscută → 400; altă metodă → 405', async () => {
    reset();
    egal((await agenda({ actiune: 'sterge_tot' })).statusCode, 400);
    egal((await cheama(apiAgenda, { metoda: 'PUT' })).statusCode, 405);
  });

  console.log('B. api/comenzi/creeaza.js cu agenda');
  async function agendaCompleta() {
    const a = (await agenda({ actiune: 'adresa_salveaza', ...ADR() })).corp.id;
    const b = (await agenda({ actiune: 'adresa_salveaza', ...ADR({ eticheta: 'Sediu', folosire: 'facturare', strada: 'Str. Facturii 5' }) })).corp.id;
    const pf = (await agenda({ actiune: 'profil_salveaza', tip: 'pf', prenume: 'Ana', nume: 'Albu', cnp: CNP, adresa_facturare_id: b })).corp.id;
    const pj = (await agenda({ actiune: 'profil_salveaza', tip: 'pj', cui: CUI, denumire: 'Firma Simulata SRL', nr_reg_com: 'J12/3456/2020', adresa_facturare_id: b })).corp.id;
    return { a, b, pf, pj };
  }
  await test('adresa_prestare_id + profil PF propriu → adresa comenzii, copia date_facturare și CNP-ul criptat copiat', async () => {
    reset();
    const { a, pf } = await agendaCompleta();
    const r = await comanda({ adresa: 'ignorată', adresa_prestare_id: a, profil_facturare_id: pf });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    faraCnp(r.corp);
    const c = DB.tabele.comenzi[0];
    egal([c.adresa, c.tip_client, c.date_facturare.prenume, c.date_facturare.adresa.strada, c.date_facturare.cnp_furnizat, c.date_facturare.cnp_ultimele3],
      ['Str. Lucrării 1, Cluj-Napoca, Cluj', 'b2c', 'Ana', 'Str. Facturii 5', true, CNP.slice(-3)]);
    egal(c.client_cnp_criptat, profiluriU().find((p) => p.id === pf).cnp_criptat);
  });
  await test('PF cu adresa_facturare_id „lucrare” → facturat la adresa lucrării', async () => {
    reset();
    const { a, pf } = await agendaCompleta();
    await comanda({ adresa_prestare_id: a, profil_facturare_id: pf, adresa_facturare_id: 'lucrare' });
    egal(DB.tabele.comenzi[0].date_facturare.adresa, { strada: 'Str. Lucrării 1', localitate: 'Cluj-Napoca', judet: 'Cluj', cod_postal: '400001', tara: 'RO' });
  });
  await test('profil PJ → b2b, verificat la ANAF (sursa anaf); inactivă → 400 FIRMA_INACTIVA', async () => {
    reset();
    const { a, pj } = await agendaCompleta();
    egal((await comanda({ adresa_prestare_id: a, profil_facturare_id: pj })).statusCode, 200);
    egal([DB.tabele.comenzi[0].tip_client, DB.tabele.comenzi[0].date_facturare.cui, DB.tabele.comenzi[0].date_facturare.sursa], ['b2b', CUI, 'anaf']);
    ANAF.mod = 'inactiva';
    egal((await comanda({ adresa_prestare_id: a, profil_facturare_id: pj })).corp.cod, 'FIRMA_INACTIVA');
  });
  await test('id-uri ale altui cont (adresă, profil, adresă de facturare) → 404, nicio comandă', async () => {
    reset();
    const mine = await agendaCompleta();
    const strainA = (await agenda({ actiune: 'adresa_salveaza', ...ADR() }, 'tok-alt')).corp.id;
    const strainP = (await agenda({ actiune: 'profil_salveaza', tip: 'pf', prenume: 'Alt', nume: 'Cont' }, 'tok-alt')).corp.id;
    for (const body of [
      { adresa_prestare_id: strainA, profil_facturare_id: mine.pf },
      { adresa_prestare_id: mine.a, profil_facturare_id: strainP },
      { adresa_prestare_id: mine.a, profil_facturare_id: mine.pf, adresa_facturare_id: strainA },
    ]) {
      const r = await comanda(body);
      egal([r.statusCode, r.corp.cod], [404, 'NU_EXISTA'], JSON.stringify(body));
    }
    egal(DB.tabele.comenzi.length, 0);
  });
  await test('salveaza_in_cont cu date noi → adresa și profilul apar în agendă (cu CNP-ul criptat); a doua oară, fără dubluri', async () => {
    reset();
    const corp = {
      adresa_lucrare: { strada: 'Str. Nouă 7', localitate: 'Iași', judet: 'Iași', tara: 'RO' },
      date_facturare: { tip: 'pf', prenume: 'Dan', nume: 'Pop', cnp: CNP, adresa_alta: true, adresa: { strada: 'Str. Factura 9', localitate: 'Iași', judet: 'Iași', tara: 'RO' } },
      salveaza_in_cont: true,
    };
    const r = await comanda(corp);
    egal([r.statusCode, 'agenda_nesalvata' in r.corp], [200, false], JSON.stringify(r.corp));
    egal(adreseU().map((a) => [a.strada, a.folosire]).sort(), [['Str. Factura 9', 'facturare'], ['Str. Nouă 7', 'prestare']]);
    const p = profiluriU()[0];
    egal([profiluriU().length, p.prenume, p.cnp_ultimele3, p.adresa_facturare_id === adreseU().find((a) => a.strada === 'Str. Factura 9').id], [1, 'Dan', CNP.slice(-3), true]);
    adevarat(p.cnp_criptat && p.cnp_criptat === DB.tabele.comenzi[0].client_cnp_criptat, 'CNP criptat copiat');
    await comanda(corp);
    egal([adreseU().length, profiluriU().length], [2, 1], 'fără dubluri');
  });
  await test('fără salveaza_in_cont → nimic în agendă', async () => {
    reset();
    await comanda({ adresa_lucrare: { strada: 'Str. Nouă 7', localitate: 'Iași', judet: 'Iași', tara: 'RO' }, date_facturare: { tip: 'pf', prenume: 'Dan', nume: 'Pop' } });
    egal([adreseU().length, profiluriU().length], [0, 0]);
  });
  await test('agenda indisponibilă (tabelul lipsește) → comanda rămâne validă, cu agenda_nesalvata: true', async () => {
    reset();
    delete DB.tabele.adrese_cont;
    const r = await comanda({ adresa_lucrare: { strada: 'Str. Nouă 7', localitate: 'Iași', judet: 'Iași', tara: 'RO' }, date_facturare: { tip: 'pf', prenume: 'Dan', nume: 'Pop' }, salveaza_in_cont: true });
    egal([r.statusCode, r.corp.agenda_nesalvata, DB.tabele.comenzi.length], [200, true, 1]);
  });
  await test('comanda păstrează copia: modificarea profilului după plasare nu o schimbă', async () => {
    reset();
    const { a, pf } = await agendaCompleta();
    await comanda({ adresa_prestare_id: a, profil_facturare_id: pf });
    await agenda({ actiune: 'profil_salveaza', id: pf, tip: 'pf', prenume: 'Schimbat', nume: 'Albu' });
    egal(DB.tabele.comenzi[0].date_facturare.prenume, 'Ana');
  });

  console.log('B2. Zona comenzii din adresa salvată (corecția PR #36)');
  const adresaIasi = async () => (await agenda({ actiune: 'adresa_salveaza', ...ADR({ eticheta: 'Iași', strada: 'Str. Iașului 3', localitate: 'Iași', judet: 'Iași', cod_postal: '700001' }) })).corp.id;
  await test('adresă salvată din alt județ decât serviciul (nivel_id) → comanda are țara, județul și localitatea adresei; prețul se calculează cu județul ei', async () => {
    reset();
    const { pf } = await agendaCompleta();
    const iasi = await adresaIasi();
    const r = await comanda({ adresa_prestare_id: iasi, profil_facturare_id: pf, nivel_id: 'nivel-test', valoare_totala: undefined, tara_cod: 'RO', regiune: 'Cluj', localitate: 'Cluj-Napoca' });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    const c = DB.tabele.comenzi[0];
    egal([c.tara_cod, c.regiune, c.localitate, c.adresa], ['RO', 'Iași', 'Iași', 'Str. Iașului 3, Iași, Iași']);
    egal(RETETA.regiuni, ['Iași'], 'județul folosit la calculul prețului');
  });
  await test('pagina fără tara_cod / regiune / localitate (nivel_id) → toate din adresa salvată', async () => {
    reset();
    const { pf } = await agendaCompleta();
    const iasi = await adresaIasi();
    const r = await comanda({ adresa_prestare_id: iasi, profil_facturare_id: pf, nivel_id: 'nivel-test', valoare_totala: undefined, tara_cod: undefined, regiune: undefined, localitate: undefined });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    egal([DB.tabele.comenzi[0].tara_cod, DB.tabele.comenzi[0].regiune, DB.tabele.comenzi[0].localitate], ['RO', 'Iași', 'Iași']);
  });
  await test('adresă salvată în altă țară decât cea a serviciului → 409 ADRESA_ALTA_TARA (RO + EN), nicio comandă', async () => {
    reset();
    const { pf } = await agendaCompleta();
    DB.tabele.adrese_cont.push({ id: 'adr-md', user_id: U, eticheta: 'Chișinău', folosire: 'ambele', strada: 'Str. Ștefan cel Mare 1', localitate: 'Chișinău', judet: null, cod_postal: null, tara: 'MD', implicita_prestare: false, implicita_facturare: false });
    for (const extra of [{}, { nivel_id: 'nivel-test', valoare_totala: undefined }]) {
      const r = await comanda({ adresa_prestare_id: 'adr-md', profil_facturare_id: pf, tara_cod: 'RO', ...extra });
      egal([r.statusCode, r.corp.cod, r.corp.camp], [409, 'ADRESA_ALTA_TARA', 'adresa_prestare_id'], JSON.stringify(extra));
      adevarat(/altă țară/.test(r.corp.error) && /different country/.test(r.corp.error_en), 'mesaj RO + EN');
    }
    egal([DB.tabele.comenzi.length, RETETA.regiuni.length], [0, 0]);
  });
  await test('calea veche (valoare_totala din pagină) cu altă localitate sau alt județ → 409 ADRESA_SCHIMBATA_PRET, prețul vechi nu se acceptă', async () => {
    reset();
    const { a, pf } = await agendaCompleta();
    for (const zona of [{ localitate: 'Turda' }, { regiune: 'Iași' }, { regiune: null, localitate: null }]) {
      const r = await comanda({ adresa_prestare_id: a, profil_facturare_id: pf, ...zona });
      egal([r.statusCode, r.corp.cod], [409, 'ADRESA_SCHIMBATA_PRET'], JSON.stringify(zona));
      adevarat(/Recalculează prețul/.test(r.corp.error) && /Recalculate the price/.test(r.corp.error_en), 'mesaj RO + EN');
    }
    const iasi = await adresaIasi();
    egal((await comanda({ adresa_prestare_id: iasi, profil_facturare_id: pf })).corp.cod, 'ADRESA_SCHIMBATA_PRET', 'adresa din Iași, preț pentru Cluj');
    egal(DB.tabele.comenzi.length, 0);
  });
  await test('calea veche, aceeași zonă scrisă altfel („Județul Cluj”, „cluj-napoca”) → comanda trece, cu zona adresei salvate', async () => {
    reset();
    const { a, pf } = await agendaCompleta();
    const r = await comanda({ adresa_prestare_id: a, profil_facturare_id: pf, regiune: 'Județul Cluj', localitate: 'cluj-napoca' });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    egal([DB.tabele.comenzi[0].regiune, DB.tabele.comenzi[0].localitate, DB.tabele.comenzi[0].suma_totala_platita], ['Cluj', 'Cluj-Napoca', 500]);
  });

  console.log('C. api/client/date-facturare.js');
  await test('întoarce profilul implicit din agendă (sursa agenda), fără CNP', async () => {
    reset();
    const { pj } = await agendaCompleta();
    await agenda({ actiune: 'seteaza_implicit', tip: 'profil', id: pj });
    const r = await cheama(apiDateFacturare, { metoda: 'GET' });
    egal([r.corp.sursa, r.corp.date_facturare.tip, r.corp.date_facturare.cui, r.corp.date_facturare.adresa.strada], ['agenda', 'pj', CUI, 'Str. Facturii 5']);
    faraCnp(r.corp);
  });
}

// ═══ D. Paginile, în Chromium ════════════════════════════════════════
async function testePagini() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { esec++; console.log('  ✗ Playwright lipsește'); return; }
  const { porneste } = require('./server-test');
  const CAPTURI = process.env.CAPTURI ? path.resolve(process.env.CAPTURI) : null;
  if (CAPTURI) fs.mkdirSync(CAPTURI, { recursive: true });

  const ROLURI = { client: ['client'], partener: ['partener_servicii'], furnizor: ['partener_materiale'], investitor: ['client', 'investor'] };
  let rolCurent = ['client'];
  const json = (corp) => async (req, res) => res.status(200).json(corp);
  const API = {
    '/api/cont/agenda': apiAgenda,
    '/api/comenzi/creeaza': apiCreeaza,
    '/api/client/date-facturare': apiDateFacturare,
    '/api/public/cui-lookup': apiCuiLookup,
    '/api/public/tari-active': json({ ok: true, active: ['RO'], tari: [{ tara_cod: 'RO', tara_nume: 'România' }], tva: { RO: 21 } }),
    // Paza dashboard-urilor (cont-dashboard.js): doar rolurile contului simulat.
    '/api/cont/profil': async (req, res) => res.status(200).json({ ok: true, email: 'client@example.com', nume: 'Ana Albu', roles: rolCurent, roluri_dashboard: rolCurent.filter((r) => r !== 'investor'), partener: null, investitor: rolCurent.includes('investor') ? { status: 'aprobat' } : null }),
    '/api/client/cos-multi': async (req, res) => res.status(200).json({ ok: true, itemi: req.method === 'GET' ? COS : [] }),
    // Corecția PR #36: prețul pe rețetă și sloturile, simulate (cifre de test).
    '/api/public/calculeaza-pret-nivel': async (req, res) => res.status(200).json({ ok: true, disponibil: true, pret_final: req.body.regiune === 'Iași' ? 777 : 500, moneda: 'RON', tara_cod: req.body.tara_cod }),
    '/api/public/sloturi-disponibile': async (req, res) => res.status(200).json({ ok: true, sloturi: [{ inceput: '10:00', sfarsit: '12:00', disponibil: req.query.regiune !== 'Iași' }] }),
  };
  let COS = [];

  function sesiune(user) {
    const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
    const ses = { access_token: 'tok-u', user };
    const client = {
      auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: ses }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) },
      from: () => lant({ data: [], error: null, count: 0 }), rpc: () => lant({ data: null, error: null }), storage: { from: () => lant({ data: null, error: null }) }, channel: () => lant({}), removeChannel: () => {},
    };
    const auth = new Proxy({ getCurrentUser: async () => user, getUserRoles: async () => user.roles, hasRole: async () => true, performLogout: () => {} }, { get: (t, k) => (k in t ? t[k] : async () => null) });
    const fix = (n, v) => Object.defineProperty(window, n, { configurable: true, get: () => v, set: () => {} });
    fix('supabaseClient', client); fix('MyDarrinAuth', auth);
  }

  async function context(browser, latime, lang, cfg) {
    const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 720 ? 844 : 900 }, hasTouch: latime < 720 });
    await ctx.addInitScript(([l, c]) => {
      try {
        localStorage.setItem('myd_lang_v1', l);
        localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
        if (c) sessionStorage.setItem('myd_checkout_config', JSON.stringify(c));
      } catch (e) {}
    }, [lang, cfg || null]);
    await ctx.addInitScript(sesiune, { id: U, email: 'client@example.com', roles: rolCurent, user_metadata: { prenume: 'Ana', nume: 'Albu' } });
    await ctx.route(/\.supabase\.co\//, (r) => r.abort());
    ctx.cereri = [];
    await ctx.route(/\/api\//, async (r) => {
      const req = r.request();
      const url = new URL(req.url());
      let corp = null; try { corp = JSON.parse(req.postData() || 'null'); } catch (e) { corp = null; }
      ctx.cereri.push({ cale: url.pathname, metoda: req.method(), corp });
      const api = API[url.pathname];
      if (!api) return r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"API unavailable on the test server"}' });
      const res = raspuns();
      await api(cerere({ metoda: req.method(), token: (req.headers().authorization || '').replace('Bearer ', '') || null, body: corp, query: Object.fromEntries(url.searchParams) }), res);
      return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp || {}) });
    });
    return ctx;
  }
  async function pagina(ctx, url) {
    const pg = await ctx.newPage();
    pg.setDefaultTimeout(8000);
    pg.erori = [];
    pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 200)));
    if (process.env.DEPANARE) pg.on('console', (m) => console.log('    [consola] ' + m.text().slice(0, 200)));
    await pg.goto(url, { waitUntil: 'networkidle' });
    await pg.waitForTimeout(300);
    return pg;
  }
  const depasire = (pg, sel) => pg.evaluate((s) => {
    const W = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > W + 1) return 'pagina: ' + document.documentElement.scrollWidth;
    return [...document.querySelectorAll(s + ', ' + s + ' *')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width) return false;
      for (let e = el.parentElement; e; e = e.parentElement) { if (getComputedStyle(e).overflowX !== 'visible') return false; }
      return r.left < -1 || r.right > W + 1;
    }).slice(0, 3).map((el) => (el.id || el.className || el.tagName) + ' ' + Math.round(el.getBoundingClientRect().right)).join(', ');
  }, sel);
  const captura = async (pg, nume) => { if (CAPTURI) await pg.screenshot({ path: path.join(CAPTURI, nume + '.png') }).catch(() => {}); };
  const RO_TEXT = /[ăâîșțĂÂÎȘȚ]|Adrese și|Adaugă|Editează|Șterge|Gestionează/;
  // Textele vizibile din secțiune (fără valorile introduse de utilizator: adrese, nume).
  const texteSectiune = (pg, sel) => pg.$eval(sel, (r) => [...r.querySelectorAll('h2, button, label, .mya-et, .mya-insigna, .mya-gol, option')]
    .filter((el) => el.offsetParent !== null || el.tagName === 'OPTION').map((el) => el.tagName === 'OPTION' && el.value && el.value !== 'nou' && el.value !== 'lucrare' ? '' : el.textContent).join(' | '));

  async function seedAgenda() {
    await agenda({ actiune: 'adresa_salveaza', ...ADR() });
    await agenda({ actiune: 'adresa_salveaza', ...ADR({ eticheta: 'Birou', folosire: 'prestare', strada: 'Str. Birou 2' }) });
    await agenda({ actiune: 'profil_salveaza', tip: 'pf', prenume: 'Ana', nume: 'Albu', cnp: CNP });
    await agenda({ actiune: 'profil_salveaza', tip: 'pj', cui: CUI, denumire: 'Firma Simulata SRL', nr_reg_com: 'J12/3456/2020', adresa_facturare_id: adreseU()[0].id });
  }

  async function adaugaAdresaUI(pg, radacina, strada) {
    await pg.click(`${radacina} [data-mya="adauga-adresa"]`);
    const f = `${radacina} form[data-mya-form="adresa"]`;
    await pg.fill(`${f} [name="eticheta"]`, 'Nouă');
    await pg.fill(`${f} [name="strada"]`, strada);
    await pg.fill(`${f} [name="localitate"]`, 'Brașov');
    await pg.fill(`${f} [name="judet"]`, 'Brașov');
    await pg.click(`${f} button[type="submit"]`);
    await pg.waitForFunction((s) => [...document.querySelectorAll('.mya-det')].some((d) => d.textContent.includes(s)), strada, { timeout: 5000 });
  }

  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  const DASH = [
    ['client', '/mydarrin-dashboard-client.html', (pg) => pg.evaluate(() => showTab('profil'))],
    ['partener', '/mydarrin-dashboard-partener.html', (pg) => pg.evaluate(() => showPanel('profil'))],
    // Pe mobil meniul lateral e închis: intrarea din meniu trebuie să existe, panoul se deschide direct.
    ['furnizor', '/mydarrin-dashboard-furnizor.html?type=materiale', async (pg) => {
      egal(await pg.$$eval('#fb-nav button', (b) => b.filter((x) => x.getAttribute('onclick') === "showPanel('adrese')").length), 1, 'intrarea din meniu');
      await pg.evaluate(() => showPanel('adrese'));
    }],
    ['investitor', '/mydarrin-investitori.html', async () => {}],
  ];
  try {
    // LIMBI=ro / LATIMI=390: doar o parte (la depanare); implicit toate.
    for (const lang of (process.env.LIMBI || 'ro,en').split(',')) {
      for (const latime of (process.env.LATIMI || '390,1366').split(',').map(Number)) {
        const et = `${lang.toUpperCase()} ${latime}px`;
        // ── Dashboard-urile ──
        for (const [rol, url, deschide] of DASH) {
          reset();
          rolCurent = ROLURI[rol];
          await seedAgenda();
          const ctx = await context(browser, latime, lang);
          const pg = await pagina(ctx, baza + url);
          await test(`${et} · dashboard ${rol}: secțiunea „Adrese și facturare”, adăugare, fără depășire, 0 erori JS`, async () => {
            await deschide(pg);
            await pg.waitForSelector('#agenda-cont-sectiune .mya-rand', { state: 'visible', timeout: 8000 });
            const titlu = (await pg.textContent('#agenda-cont-sectiune h2')).trim();
            egal(titlu, lang === 'en' ? 'Addresses and billing' : 'Adrese și facturare');
            egal(await pg.$$eval('#agenda-cont-sectiune [data-adresa-id]', (x) => x.length), 2);
            const ins = await pg.textContent('#agenda-cont-sectiune');
            adevarat(lang === 'en' ? /Default for service/.test(ins) && /•••••••••/.test(ins) : /Implicită pentru prestare/.test(ins), 'insigne / CNP mascat');
            adevarat(!ins.includes(CNP), 'CNP în clar în pagină');
            await adaugaAdresaUI(pg, '#agenda-cont-sectiune', 'Str. Dashboard ' + rol);
            egal(adreseU().length, 3);
            if (lang === 'en') { const t = await texteSectiune(pg, '#agenda-cont-sectiune'); adevarat(!RO_TEXT.test(t), 'text românesc: ' + t.slice(0, 300)); }
            egal(await depasire(pg, '#agenda-cont-sectiune'), '');
            await captura(pg, `11p3a-dash-${rol}-${lang}-${latime}`);
            egal(pg.erori, []);
          });
          await ctx.close();
        }

        // ── Checkout: alegerea, gestionarea din panou, selecția ──
        reset();
        rolCurent = ROLURI.client;
        await seedAgenda();
        const CFG = { titlu: 'Serviciu de test', total: 500, bazaRaw: 400, tara_cod: 'RO', regiune: 'Cluj', addr: '', localitate: 'Cluj-Napoca', materiale: [], inchirieri: [] };
        const ctx = await context(browser, latime, lang, CFG);
        const pg = await pagina(ctx, baza + '/mydarrin-checkout.html');
        await pg.evaluate(() => goToStep('details'));
        const selP = '#agenda-prestare select[name="adresa_prestare_id"]';
        const selF = '#agenda-facturare select[name="profil_facturare_id"]';
        const idAcasa = adreseU()[0].id, idBirou = adreseU()[1].id;
        await test(`${et} · checkout: precompletat cu cele implicite; formularele manuale ascunse`, async () => {
          await pg.waitForSelector(selP, { state: 'visible' });
          egal(await pg.inputValue(selP), idAcasa);
          egal(await pg.inputValue(selF), profiluriU()[0].id);
          egal([await pg.isVisible('#co-adresa'), await pg.isVisible('#fact-tip-pf'), await pg.isVisible('#co-salveaza-cont')], [false, false, false]);
          egal(await depasire(pg, '#step-details'), '');
          await captura(pg, `11p3a-checkout-${lang}-${latime}`);
        });
        await test(`${et} · checkout: „Gestionează” se deschide din tastatură (Enter), focusul rămâne în panou, Esc închide și revine pe buton`, async () => {
          await pg.focus('[data-mya="gestioneaza-prestare"]');
          await pg.keyboard.press('Enter');
          await pg.waitForSelector('[role="dialog"] .mya-rand', { state: 'visible' });
          adevarat(await pg.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), 'focus în panou');
          for (let i = 0; i < 25; i++) await pg.keyboard.press('Tab');
          adevarat(await pg.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement)), 'Tab rămâne în panou');
          egal(await depasire(pg, '[role="dialog"]'), '', 'panou');
          await captura(pg, `11p3a-panou-${lang}-${latime}`);
          await pg.keyboard.press('Escape');
          egal(await pg.$('[role="dialog"]'), null);
          egal(await pg.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-mya')), 'gestioneaza-prestare');
        });
        await test(`${et} · checkout: editarea adresei alese în panou păstrează selecția și actualizează lista`, async () => {
          await pg.selectOption(selP, idBirou);
          await pg.click('[data-mya="gestioneaza-prestare"]');
          await pg.click(`[role="dialog"] [data-adresa-id="${idBirou}"] [data-mya="editeaza"]`);
          await pg.fill('[role="dialog"] form[data-mya-form="adresa"] [name="eticheta"]', 'Birou nou');
          await pg.click('[role="dialog"] form[data-mya-form="adresa"] button[type="submit"]');
          await pg.waitForSelector(`[role="dialog"] [data-adresa-id="${idBirou}"]`);
          await pg.click('[data-mya="inchide"]');
          egal(await pg.inputValue(selP), idBirou);
          adevarat((await pg.$eval(`${selP} option[value="${idBirou}"]`, (o) => o.textContent)).startsWith('Birou nou'), 'textul opțiunii');
          egal(adreseU().find((a) => a.id === idBirou).eticheta, 'Birou nou');
        });
        await test(`${et} · checkout: ștergerea adresei alese (cu confirmare) golește selecția și cere alta`, async () => {
          await pg.click('[data-mya="gestioneaza-prestare"]');
          await pg.click(`[role="dialog"] [data-adresa-id="${idBirou}"] [data-mya="sterge"]`);
          await pg.waitForSelector('.md-confirma');
          await pg.click('.md-confirma-ok');
          await pg.waitForFunction((id) => !document.querySelector(`[role="dialog"] [data-adresa-id="${id}"]`), idBirou);
          await pg.keyboard.press('Escape');
          egal(await pg.inputValue(selP), '');
          adevarat(await pg.isVisible('#agenda-prestare .mya-avert'), 'mesajul „alege alta”');
          await pg.evaluate(() => goToStep('payment'));
          egal(await pg.isVisible('#step-details'), true, 'pasul nu avansează');
          egal(await pg.$eval(selP, (s) => s.getAttribute('aria-invalid')), 'true');
          egal(adreseU().length, 1);
        });
        await test(`${et} · checkout: comanda cu alegerile din agendă (adresă + profil PJ)`, async () => {
          await pg.selectOption(selP, idAcasa);
          await pg.selectOption(selF, profiluriU()[1].id);
          await pg.fill('#co-prenume', 'Ana'); await pg.fill('#co-nume', 'Albu');
          await pg.fill('#co-telefon', '+40 721 000 000'); await pg.fill('#co-email', 'client@example.com');
          await pg.evaluate(() => goToStep('payment'));
          await pg.click('#btn-finalizeaza');
          await pg.waitForSelector('#order-confirm-overlay', { timeout: 6000 });
          const trimis = ctx.cereri.filter((c) => c.cale === '/api/comenzi/creeaza').pop().corp;
          egal([trimis.adresa_prestare_id, trimis.profil_facturare_id, 'date_facturare' in trimis], [idAcasa, profiluriU()[1].id, false]);
          const c = DB.tabele.comenzi[0];
          egal([c.adresa, c.tip_client, c.date_facturare.denumire], ['Str. Lucrării 1, Cluj-Napoca, Cluj', 'b2b', 'Firma Simulata SRL']);
        });
        await test(`${et} · checkout: „Adaugă alta” → formularele, cu „Salvează în contul meu” bifată; datele ajung în agendă`, async () => {
          await pg.evaluate(() => { document.getElementById('order-confirm-overlay')?.remove(); goToStep('details'); });
          await pg.selectOption(selP, 'nou');
          await pg.selectOption(selF, 'nou');
          egal([await pg.isVisible('#co-adresa'), await pg.isVisible('#fact-tip-pf'), await pg.isChecked('#co-salveaza-cont')], [true, true, true]);
          await pg.fill('#co-adresa', 'Str. Checkout 9'); await pg.fill('#co-oras', 'Sibiu'); await pg.selectOption('#co-judet', 'Sibiu');
          await pg.evaluate(() => goToStep('payment'));
          await pg.click('#btn-finalizeaza');
          await pg.waitForSelector('#order-confirm-overlay', { timeout: 6000 });
          adevarat(adreseU().some((a) => a.strada === 'Str. Checkout 9' && a.folosire === 'prestare'), 'adresa salvată');
          egal(profiluriU().filter((p) => p.tip === 'pf' && p.prenume === 'Ana').length, 1, 'profilul existent refolosit');
          egal(pg.erori, []);
        });
        await ctx.close();

        // ── Corecția PR #36: schimbarea adresei de prestare reface prețul și disponibilitatea ──
        for (const [caz, cfgExtra] of [['nivel_id', { nivel_id: 'nivel-test', cantitate: 1 }], ['preț din pagină', {}], ['interval programat', { nivel_id: 'nivel-test', cantitate: 1, selDateISO: '2026-11-10', selDate: '10 nov.', selOraInceput: '10:00:00', selOraSfarsit: '12:00:00' }]]) {
          reset();
          rolCurent = ROLURI.client;
          await seedAgenda();
          const idIasi = (await agenda({ actiune: 'adresa_salveaza', ...ADR({ eticheta: 'Iași', folosire: 'prestare', strada: 'Str. Iașului 3', localitate: 'Iași', judet: 'Iași', cod_postal: '700001' }) })).corp.id;
          DB.tabele.adrese_cont.push({ id: 'adr-md', user_id: U, eticheta: 'Chișinău', folosire: 'prestare', strada: 'Str. Mare 1', localitate: 'Chișinău', judet: null, cod_postal: null, tara: 'MD', implicita_prestare: false, implicita_facturare: false, creat_la: '2026-10-26T00:00:00Z' });
          const CFGZ = { titlu: 'Serviciu de test', total: 500, bazaRaw: 400, tara_cod: 'RO', regiune: 'Cluj', localitate: 'Cluj-Napoca', addr: '', materiale: [], inchirieri: [], ...cfgExtra };
          const ctxz = await context(browser, latime, lang, CFGZ);
          const pz = await pagina(ctxz, baza + '/mydarrin-checkout.html');
          await pz.evaluate(() => goToStep('details'));
          const selPz = '#agenda-prestare select[name="adresa_prestare_id"]';
          await pz.waitForSelector(selPz);
          const zona = () => pz.textContent('#agenda-prestare-zona');
          await pz.fill('#co-prenume', 'Ana'); await pz.fill('#co-nume', 'Albu');
          await pz.fill('#co-telefon', '+40 721 000 000'); await pz.fill('#co-email', 'client@example.com');
          await test(`${et} · checkout (${caz}): altă adresă de prestare → prețul și disponibilitatea refăcute înainte de „Plasează comanda”`, async () => {
            await pz.selectOption(selPz, idIasi);
            await pz.waitForFunction(() => /✓|✕|recalcul|valabil|nu e disponibil|Reconfigur|reconfigur|recalculated|valid|not available/.test(document.getElementById('agenda-prestare-zona').textContent), null, { timeout: 5000 });
            const t = await zona();
            const ultimaPret = ctxz.cereri.filter((c) => c.cale === '/api/public/calculeaza-pret-nivel').pop();
            if (caz === 'nivel_id') {
              egal(ultimaPret && [ultimaPret.corp.regiune, ultimaPret.corp.tara_cod], ['Iași', 'RO'], 'prețul cerut pentru județul nou');
              adevarat(/777/.test(await pz.textContent('#total-price')), 'totalul nou: ' + await pz.textContent('#total-price'));
              adevarat(lang === 'en' ? /recalculated for Iași, Iași/.test(t) : /recalculat pentru Iași, Iași/.test(t), t);
              await pz.evaluate(() => goToStep('payment'));
              egal(await pz.isVisible('#step-payment'), true, 'pasul avansează');
              await pz.evaluate(() => goToStep('details'));
              await pz.selectOption(selPz, adreseU()[0].id);
              await pz.waitForFunction(() => /500/.test(document.getElementById('total-price').textContent), null, { timeout: 5000 });
            } else if (caz === 'preț din pagină') {
              adevarat(lang === 'en' ? /different city/.test(t) && /Reconfigure/.test(t) : /altă localitate/.test(t) && /Reconfigurează/.test(t), t);
              egal(ultimaPret, undefined, 'fără calcul de preț în pagină');
              await pz.evaluate(() => goToStep('payment'));
              egal(await pz.isVisible('#step-details'), true, 'pasul nu avansează');
            } else {
              adevarat(ctxz.cereri.some((c) => c.cale === '/api/public/sloturi-disponibile' && c.corp === null), 'sloturile cerute');
              adevarat(lang === 'en' ? /not available for Iași/.test(t) : /nu e disponibil pentru Iași/.test(t), t);
              await pz.evaluate(() => goToStep('payment'));
              egal(await pz.isVisible('#step-details'), true, 'pasul nu avansează');
            }
            if (lang === 'en') adevarat(!/[ăâîșțĂÂÎȘȚ]/.test(t.replace(/Iași/g, '')), 'text românesc: ' + t);
          });
          if (caz === 'nivel_id') {
            await test(`${et} · checkout: adresă în altă țară decât serviciul → mesaj clar, comanda nu avansează`, async () => {
              await pz.selectOption(selPz, 'adr-md');
              await pz.waitForFunction(() => /țară|country/.test(document.getElementById('agenda-prestare-zona').textContent), null, { timeout: 5000 });
              const t = await zona();
              adevarat(lang === 'en' ? /different country/.test(t) : /altă țară/.test(t), t);
              await pz.evaluate(() => goToStep('payment'));
              egal(await pz.isVisible('#step-details'), true, 'pasul nu avansează');
              egal(await depasire(pz, '#step-details'), '');
              egal(pz.erori, []);
            });
          }
          await ctxz.close();
        }

        // ── Sincronizare: dashboard ↔ checkout, în același cont ──
        reset();
        rolCurent = ROLURI.client;
        await seedAgenda();
        const ctx2 = await context(browser, latime, lang, CFG);
        const co = await pagina(ctx2, baza + '/mydarrin-checkout.html');
        await co.evaluate(() => goToStep('details'));
        const dash = await pagina(ctx2, baza + '/mydarrin-dashboard-client.html');
        await dash.evaluate(() => showTab('profil'));
        await test(`${et} · sincronizare: adresa adăugată / setată implicită în dashboard apare în checkout fără reîncărcare (și invers)`, async () => {
          await dash.waitForSelector('#agenda-cont-sectiune .mya-rand');
          await adaugaAdresaUI(dash, '#agenda-cont-sectiune', 'Str. Din Dashboard 4');
          await co.waitForFunction(() => [...document.querySelectorAll('#agenda-prestare option')].some((o) => o.textContent.includes('Str. Din Dashboard 4')), null, { timeout: 5000 });
          // invers: setată implicită din checkout → insigna apare în dashboard
          const nou = adreseU().find((a) => a.strada === 'Str. Din Dashboard 4').id;
          await co.click('[data-mya="gestioneaza-prestare"]');
          await co.click(`[role="dialog"] [data-adresa-id="${nou}"] [data-mya="implicit-adresa_prestare"]`);
          await co.waitForFunction((id) => !document.querySelector(`[role="dialog"] [data-adresa-id="${id}"] [data-mya="implicit-adresa_prestare"]`), nou);
          await co.keyboard.press('Escape');
          await dash.waitForFunction((id) => { const r = document.querySelector(`#agenda-cont-sectiune [data-adresa-id="${id}"]`); return r && r.querySelector('.mya-insigna'); }, nou, { timeout: 5000 });
          egal(adreseU().filter((a) => a.implicita_prestare).map((a) => a.id), [nou]);
          egal([co.erori, dash.erori], [[], []]);
        });
        await ctx2.close();

        // ── Coșul: client fără comenzi și fără agendă ──
        reset();
        rolCurent = ROLURI.client;
        COS = [{ id: 'cos-1', configurare: { titlu: 'Serviciu de test', addr: 'Str. Coș 3, Cluj-Napoca', tara_cod: 'RO', bazaRaw: 400, materiale: [], inchirieri: [] } }];
        const ctx3 = await context(browser, latime, lang);
        const cos = await pagina(ctx3, baza + '/mydarrin-cos.html');
        await test(`${et} · coș: client nou adaugă profilul din panou (tastatură) și trimite comanda`, async () => {
          await cos.waitForSelector('[data-mya="adauga-profil"]', { state: 'visible' });
          egal(await depasire(cos, '.wrap'), '');
          await cos.focus('[data-mya="adauga-profil"]');
          await cos.keyboard.press('Enter');
          const f = '[role="dialog"] form[data-mya-form="profil"]';
          await cos.waitForSelector(f);
          await cos.fill(`${f} [name="prenume"]`, 'Ioana');
          await cos.fill(`${f} [name="nume"]`, 'Pop');
          await cos.click(`${f} button[type="submit"]`);
          await cos.waitForSelector('[role="dialog"] [data-profil-id]');
          if (lang === 'en') { const t = await texteSectiune(cos, '[role="dialog"]'); adevarat(!RO_TEXT.test(t), 'text românesc: ' + t.slice(0, 300)); }
          await cos.keyboard.press('Escape');
          await cos.waitForSelector('#cos-facturare select[name="profil_facturare_id"]');
          egal(await cos.inputValue('#cos-facturare select[name="profil_facturare_id"]'), profiluriU()[0].id);
          egal(await depasire(cos, '.wrap'), '');
          await captura(cos, `11p3a-cos-${lang}-${latime}`);
          await cos.click('#btn-submit');
          await cos.waitForFunction(() => getComputedStyle(document.getElementById('status-ok')).display !== 'none' || getComputedStyle(document.getElementById('status-err')).display !== 'none', null, { timeout: 8000 });
          egal(DB.tabele.comenzi.length, 1, await cos.textContent('#status-err'));
          egal([DB.tabele.comenzi[0].date_facturare.prenume, DB.tabele.comenzi[0].date_facturare.adresa.strada], ['Ioana', 'Str. Coș 3, Cluj-Napoca']);
          egal(cos.erori, []);
        });
        await ctx3.close();
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

(async () => {
  await testeServer();
  if (!process.env.FARA_BROWSER) {
    console.log('D. Paginile (Chromium)');
    await testePagini();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})();
