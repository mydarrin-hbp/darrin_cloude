// scripts/test-pitch-deck-11k4.js
// Pasul 11-K4 (24 oct. 2026), cu Supabase simulat (scripts/supabase-simulat.js).
// Nimic nu ajunge la producție.
//   A. `lipsuri` (ce mai lipsește pentru aprobare): v1.1 → 14 note + 7 surse = 21,
//      în listă, în GET ?id și în refuzul acțiunii `aproba`, din aceeași funcție
//      ca verificarea serverului; o versiune completă → 0 și se aprobă;
//   B. `sterge`: doar ciornele, doar cu drept de scriere pe Investitori, cu audit
//      (titlu, limbă, număr de slide-uri); versiunea aprobată → 409;
// Cifrele rundei sunt DE TEST, nu ale rundei Seed reale.
// Rulare: node scripts/test-pitch-deck-11k4.js

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

function stub(fisier, exp) {
  const p = require.resolve(path.join(RADACINA, fisier));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };
}
stub('lib/rate-limit.js', { checkRateLimit: async () => true });

const P = require(path.join(RADACINA, 'lib/pitch-deck.js'));
const apiAdmin = require(path.join(RADACINA, 'api/admin/pitch-deck.js'));
const RO11 = require(path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1.1-ro.json'));
const EN11 = require(path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1.1-en.json'));
const copie = (o) => JSON.parse(JSON.stringify(o));

const SUPER = 'u-super', SCRIE = 'u-scrie', CITESTE = 'u-citeste', FARA = 'u-fara', INV = 'u-inv';
const TOKEN = { [SUPER]: 'tok-super', [SCRIE]: 'tok-scrie', [CITESTE]: 'tok-citeste', [FARA]: 'tok-fara', [INV]: 'tok-inv' };

function reset() {
  DB.tabele = {
    profiles: [
      { id: SUPER, email: 'super@test', roles: ['superadmin'] },
      { id: SCRIE, email: 'scrie@test', roles: ['admin'] },
      { id: CITESTE, email: 'citeste@test', roles: ['admin'] },
      { id: FARA, email: 'fara@test', roles: ['admin'] },
      { id: INV, email: 'inv@test', roles: ['client', 'investor'] },
    ],
    admin_permissions: [
      { admin_id: SCRIE, sectiune: 'investitori', poate_scrie: true },
      { admin_id: CITESTE, sectiune: 'investitori', poate_scrie: false },
      { admin_id: FARA, sectiune: 'catalog', poate_scrie: true },
    ],
    investitori_kyc: [{ user_id: INV, status: 'aprobat' }],
    backoffice_config: [
      { cheie: 'investitori_email', valoare: 'investor@example.com', sectiune: 'contact', tara_cod: 'ALL' },
      { cheie: 'pitch_deck_vizibilitate', valoare: 'investitori_aprobati', sectiune: 'investitori', tara_cod: 'ALL' },
    ],
    runde_finantare: [{ id: 'r-test', cod: 'test', denumire_ro: 'Test', denumire_en: 'Test', stare: 'deschisa', vizibila_public: true, moneda: 'EUR',
      evaluare_pre_money: 900000, suma_tinta: 100000, actiuni_existente: 900, investitie_minima: 1000, tickete: [5000], data_start: '2099-11-01', data_sfarsit: '2100-06-30' }],
    investitori_portofoliu: [], pitch_deck_versiuni: [], audit_log: [], comenzi: [],
  };
  DB.coloane = {};
  DB.implicite = { pitch_deck_versiuni: { aprobat: false, note_verificare: [], creat_la: new Date().toISOString() } };
  DB.utilizatori = {};
  Object.keys(TOKEN).forEach((id) => { DB.utilizatori[TOKEN[id]] = { id, email: id + '@test' }; });
  delete require.cache[require.resolve(path.join(RADACINA, 'lib/contact-platforma.js'))];
}

let ok = 0, esec = 0;
async function test(nume, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + nume); }
  catch (e) { esec++; console.log('  ✗ ' + nume + ' — ' + e.message); }
}
function egal(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(c, m) { if (!c) throw new Error(m || 'condiție falsă'); }

async function admin(id, body, query) {
  const res = raspuns();
  await apiAdmin(cerere({ metoda: body ? 'POST' : 'GET', token: id ? TOKEN[id] : null, body, query: query || {} }), res);
  return res;
}
async function importa(fisier) {
  const r = await admin(SCRIE, { actiune: 'importa', fisier: copie(fisier) });
  egal(r.statusCode, 200, 'import ' + JSON.stringify(r.corp));
  return r.corp.versiune;
}
// Rezolvă tot (note + surse), ca versiunea să se poată aproba.
async function completeaza(v) {
  const slide_uri = v.slide_uri.map((s) => (s.prognoza ? { ...s, sursa: 'Sursă DE TEST (nu e sursa reală)' } : s));
  const r = await admin(SCRIE, { actiune: 'salveaza', id: v.id, titlu: v.titlu, sursa: v.sursa, disclaimer: v.disclaimer, slide_uri, note_verificare: v.note_verificare.map((n) => ({ id: n.id, rezolvat: true })) });
  egal(r.statusCode, 200, 'salvare ' + JSON.stringify(r.corp));
  return r.corp.versiune;
}
const numara = (l) => l.reduce((o, x) => { o[x.tip] = (o[x.tip] || 0) + 1; return o; }, {});

(async () => {
  console.log('A. Ce mai lipsește pentru aprobare (`lipsuri`)');
  await test('v1.1 RO: 14 note + 7 surse = 21, în listă și în GET ?id', async () => {
    reset();
    const v = await importa(RO11);
    const l = await admin(SCRIE);
    const rand = l.corp.versiuni.find((x) => x.id === v.id);
    egal(rand.lipsuri.length, 21, 'lista');
    egal(numara(rand.lipsuri), { nota: 14, sursa: 7 });
    egal(rand.lipsuri.filter((x) => x.tip === 'sursa').map((x) => x.slide), [4, 9, 10, 12, 15, 17, 19]);
    const unu = await admin(SCRIE, null, { id: v.id });
    egal(unu.corp.lipsuri, rand.lipsuri, 'GET ?id = lista');
    // aceeași funcție ca verificarea serverului
    egal(rand.lipsuri.length, P.blocajeAprobare(unu.corp.versiune).length + P.valideaza(unu.corp.versiune.slide_uri).length);
    const nota = rand.lipsuri.find((x) => x.tip === 'nota');
    adevarat(nota.nota && nota.camp === 'note_verificare.' + nota.nota && typeof nota.text === 'string' && nota.text.length > 3, 'nota are id, câmp și text');
    const s9 = rand.lipsuri.filter((x) => x.slide === 9);
    egal(numara(s9), { nota: 2, sursa: 1 }, 'slide 9');
    egal(s9.find((x) => x.tip === 'sursa').camp, 'slide_uri.8.sursa');
  });
  await test('v1.1 EN: aceeași structură (21)', async () => {
    reset();
    const v = await importa(EN11);
    const unu = await admin(CITESTE, null, { id: v.id });
    egal(unu.corp.lipsuri.length, 21);
  });
  await test('refuzul `aproba` trimite aceleași `lipsuri` (409 NOTE_NEREZOLVATE), nimic aprobat', async () => {
    reset();
    const v = await importa(RO11);
    const lista = (await admin(SCRIE)).corp.versiuni[0].lipsuri;
    const r = await admin(SCRIE, { actiune: 'aproba', id: v.id });
    egal(r.statusCode, 409); egal(r.corp.cod, 'NOTE_NEREZOLVATE');
    egal(r.corp.lipsuri, lista);
    egal(r.corp.campuri.length, 21);
    adevarat(DB.tabele.pitch_deck_versiuni.every((x) => !x.aprobat), 'nimic aprobat');
  });
  await test('versiune completă → lipsuri 0 și aprobarea trece; versiunea aprobată → lipsuri []', async () => {
    reset();
    const v = await completeaza(await importa(RO11));
    egal((await admin(SCRIE)).corp.versiuni[0].lipsuri, []);
    egal((await admin(SCRIE, null, { id: v.id })).corp.lipsuri, []);
    const r = await admin(SCRIE, { actiune: 'aproba', id: v.id });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    egal((await admin(SCRIE)).corp.versiuni[0].lipsuri, []);
  });
  await test('o singură sursă lipsă după completare → 1 lipsă, pe slide-ul ei', async () => {
    reset();
    const v = await completeaza(await importa(RO11));
    const slide_uri = copie(v.slide_uri); slide_uri[16].sursa = null;
    const s = await admin(SCRIE, { actiune: 'salveaza', id: v.id, titlu: v.titlu, sursa: v.sursa, disclaimer: v.disclaimer, slide_uri, note_verificare: v.note_verificare });
    egal(s.statusCode, 200);
    egal((await admin(SCRIE)).corp.versiuni[0].lipsuri.map((x) => [x.slide, x.tip, x.camp]), [[17, 'sursa', 'slide_uri.16.sursa']]);
  });
  await test('eticheta de prognoză lipsă → o lipsă fără slide (tip „eticheta”)', async () => {
    reset();
    const v = await completeaza(await importa(RO11));
    await admin(SCRIE, { actiune: 'salveaza', id: v.id, titlu: v.titlu, sursa: v.sursa, disclaimer: '', slide_uri: v.slide_uri, note_verificare: v.note_verificare });
    egal((await admin(SCRIE)).corp.versiuni[0].lipsuri.map((x) => [x.slide, x.tip, x.camp]), [[null, 'eticheta', 'disclaimer']]);
  });

  console.log('B. Ștergerea ciornei (`sterge`)');
  await test('ciorna dublă (importată de două ori) se șterge, cu audit; cealaltă rămâne', async () => {
    reset();
    const a = await importa(RO11);
    const b = await importa(RO11);
    const r = await admin(SCRIE, { actiune: 'sterge', id: b.id });
    egal(r.statusCode, 200, JSON.stringify(r.corp)); egal(r.corp.sters, b.id);
    egal(DB.tabele.pitch_deck_versiuni.map((x) => x.id), [a.id]);
    const au = DB.tabele.audit_log.find((x) => x.actiune === 'pitch_deck_ciorna_stearsa');
    adevarat(au && au.entitate_id === b.id, 'audit');
    egal(au.detalii, { titlu: 'Pitch deck v1.1 · RO', limba: 'ro', slideuri: 20 });
  });
  await test('versiunea aprobată → 409 VERSIUNE_APROBATA (RO + EN), nimic șters', async () => {
    reset();
    const v = await completeaza(await importa(RO11));
    egal((await admin(SCRIE, { actiune: 'aproba', id: v.id })).statusCode, 200);
    const r = await admin(SUPER, { actiune: 'sterge', id: v.id });
    egal(r.statusCode, 409); egal(r.corp.cod, 'VERSIUNE_APROBATA');
    adevarat(/Retrage aprobarea/.test(r.corp.mesaj.ro) && /withdraw the approval/.test(r.corp.mesaj.en), 'mesajul spune ce e de făcut');
    egal(DB.tabele.pitch_deck_versiuni.length, 1);
    adevarat(!DB.tabele.audit_log.some((x) => x.actiune === 'pitch_deck_ciorna_stearsa'), 'fără audit de ștergere');
    // după „Retrage aprobarea”, se poate șterge
    egal((await admin(SCRIE, { actiune: 'retrage', id: v.id })).statusCode, 200);
    egal((await admin(SCRIE, { actiune: 'sterge', id: v.id })).statusCode, 200);
    egal(DB.tabele.pitch_deck_versiuni.length, 0);
  });
  await test('admin fără poate_scrie → 403 FARA_DREPT_SCRIERE; fără drept pe Investitori → 403; investitor → 403; fără sesiune → 401', async () => {
    reset();
    const v = await importa(RO11);
    const r = await admin(CITESTE, { actiune: 'sterge', id: v.id });
    egal(r.statusCode, 403); egal(r.corp.cod, 'FARA_DREPT_SCRIERE');
    egal((await admin(FARA, { actiune: 'sterge', id: v.id })).statusCode, 403);
    egal((await admin(INV, { actiune: 'sterge', id: v.id })).statusCode, 403);
    egal((await admin(null, { actiune: 'sterge', id: v.id })).statusCode, 401);
    egal(DB.tabele.pitch_deck_versiuni.length, 1);
  });
  await test('id inexistent → 404 VERSIUNE_LIPSA', async () => {
    reset();
    const r = await admin(SCRIE, { actiune: 'sterge', id: 'nu-exista' });
    egal(r.statusCode, 404); egal(r.corp.cod, 'VERSIUNE_LIPSA');
  });

  console.log('C. Ciorna pentru administratori (`ciorna`)');
  await test('fără drept → 403 (investitor cu KYC, admin fără Investitori); fără sesiune → 401; nimic din conținut', async () => {
    reset();
    await importa(RO11);
    for (const [id, st] of [[INV, 403], [FARA, 403], [null, 401]]) {
      for (const body of [{ actiune: 'ciorna', limba: 'ro' }, { actiune: 'ciorna', limba: 'ro', doar_stare: true }]) {
        const r = await admin(id, body);
        egal(r.statusCode, st, `${id} ${JSON.stringify(body)}`);
        adevarat(!r.corp.deck && r.corp.exista === undefined && !JSON.stringify(r.corp).includes('Proiecții'), 'fără conținut');
      }
    }
  });
  await test('admin doar cu citire: cea mai nouă ciornă a limbii, fără notele prezentatorului', async () => {
    reset();
    const vechi = await importa(RO11);
    DB.tabele.pitch_deck_versiuni.find((x) => x.id === vechi.id).actualizat_la = '2026-10-20T10:00:00Z';
    const v = await importa(RO11);
    const sl = copie(v.slide_uri); sl[0].note_prezentator = 'NOTĂ INTERNĂ DE TEST';
    await admin(SCRIE, { actiune: 'salveaza', id: v.id, titlu: 'Ciorna nouă', sursa: v.sursa, disclaimer: v.disclaimer, slide_uri: sl, note_verificare: v.note_verificare });
    const st = await admin(CITESTE, { actiune: 'ciorna', limba: 'ro', doar_stare: true });
    egal(st.statusCode, 200); egal(st.corp, { ok: true, exista: true, limba: 'ro' });
    const r = await admin(CITESTE, { actiune: 'ciorna', limba: 'ro' });
    egal(r.statusCode, 200, JSON.stringify(r.corp).slice(0, 200));
    egal(r.corp.ciorna.id, v.id); egal(r.corp.ciorna.titlu, 'Ciorna nouă');
    egal(r.corp.deck.slide_uri.length, 20); egal(r.corp.limba, 'ro');
    adevarat(!JSON.stringify(r.corp).includes('NOTĂ INTERNĂ DE TEST'), 'fără note_prezentator');
  });
  await test('limbile: de / fr → ciorna EN; fără ciornă în limbă → exista: false și 404 CIORNA_LIPSA', async () => {
    reset();
    await importa(RO11);
    egal((await admin(SCRIE, { actiune: 'ciorna', limba: 'de', doar_stare: true })).corp, { ok: true, exista: false, limba: 'en' });
    const r = await admin(SCRIE, { actiune: 'ciorna', limba: 'fr' });
    egal(r.statusCode, 404); egal(r.corp.cod, 'CIORNA_LIPSA');
    const en = await importa(EN11);
    const r2 = await admin(SUPER, { actiune: 'ciorna', limba: 'tr' });
    egal(r2.statusCode, 200); egal(r2.corp.ciorna.id, en.id); egal(r2.corp.limba, 'en');
  });
  await test('versiunea aprobată nu e „ciornă”; API-ul public rămâne „în pregătire” fără aprobare', async () => {
    reset();
    const v = await completeaza(await importa(RO11));
    egal((await admin(SCRIE, { actiune: 'aproba', id: v.id })).statusCode, 200);
    egal((await admin(SCRIE, { actiune: 'ciorna', limba: 'ro', doar_stare: true })).corp.exista, false);
    reset();
    await importa(RO11);
    const apiPublic = require(path.join(RADACINA, 'api/public/pitch-deck.js'));
    for (const tok of [null, TOKEN[CITESTE]]) {
      const res = raspuns();
      await apiPublic(cerere({ metoda: 'GET', token: tok, query: { limba: 'ro', ciorna: '1' } }), res);
      egal(res.corp.stare, 'in_pregatire', 'public ' + tok);
      adevarat(!res.corp.deck, 'fără deck');
    }
  });

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})();
