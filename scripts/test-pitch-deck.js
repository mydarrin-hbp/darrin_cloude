// scripts/test-pitch-deck.js
// Pasul 11-K (22 oct. 2026): pitch deck-ul RO + EN, cu Supabase simulat
// (scripts/supabase-simulat.js). Nimic nu ajunge la producție.
//   A. schema: fiecare tip de slide din cele două JSON-uri reale
//      (docs/pitch-deck/) trece; un JSON stricat → erori pe câmp;
//   B. maparea limbilor: ro → RO; en, bg, de, el, fr, tr (și orice altceva) → EN;
//   C. notele de verificare: importul le scoate din slide-uri; aprobarea e
//      refuzată cu note nerezolvate sau cu slide-uri de prognoză fără sursă;
//      aprobarea RO nu atinge versiunea EN aprobată;
//   D. QR-ul generat (SVG) se decodează la url_investitori;
//   E. API-ul public: fără versiune aprobată → în pregătire; vizibilitate
//      restrânsă fără sesiune → doar rezumatul; investitor cu KYC aprobat →
//      deck complet; runda și emailul vin din date, nu din JSON;
//   F. API-ul de administrare: drepturi (11-N2), ciorne, versiune aprobată
//      needitabilă, vizibilitatea doar de superadmin, audit;
//   G. formatarea numerelor RO / EN (pitch-deck-render.js);
//   H. evoluția lunară: 403 fără KYC aprobat; doar comenzi finalizate reale.
// Cifrele rundei sunt DE TEST (900.000 / 100.000), nu ale rundei Seed reale.
// Rulare: node scripts/test-pitch-deck.js

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

function stub(fisier, exp) {
  const p = require.resolve(path.join(RADACINA, fisier));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };
}
stub('lib/rate-limit.js', { checkRateLimit: async () => true });

const S = require(path.join(RADACINA, 'pitch-deck-schema.js'));
const P = require(path.join(RADACINA, 'lib/pitch-deck.js'));
const apiAdmin = require(path.join(RADACINA, 'api/admin/pitch-deck.js'));
const apiPublic = require(path.join(RADACINA, 'api/public/pitch-deck.js'));
const RO = require(path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1-ro.json'));
const EN = require(path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1-en.json'));
const copie = (o) => JSON.parse(JSON.stringify(o));

const SUPER = 'u-super', SCRIE = 'u-scrie', CITESTE = 'u-citeste', INV_OK = 'u-inv-ok', INV_NU = 'u-inv-nu', CLIENT = 'u-client';
const TOKEN = { [SUPER]: 'tok-super', [SCRIE]: 'tok-scrie', [CITESTE]: 'tok-citeste', [INV_OK]: 'tok-inv-ok', [INV_NU]: 'tok-inv-nu', [CLIENT]: 'tok-client' };

function reset({ vizibilitate = 'investitori_aprobati', runda = true } = {}) {
  DB.tabele = {
    profiles: [
      { id: SUPER, email: 'super@test', roles: ['superadmin'] },
      { id: SCRIE, email: 'scrie@test', roles: ['admin'] },
      { id: CITESTE, email: 'citeste@test', roles: ['admin'] },
      { id: INV_OK, email: 'inv-ok@test', roles: ['client', 'investor'] },
      { id: INV_NU, email: 'inv-nu@test', roles: ['client', 'investor'] },
      { id: CLIENT, email: 'client@test', roles: ['client'] },
    ],
    admin_permissions: [
      { admin_id: SCRIE, sectiune: 'investitori', poate_scrie: true },
      { admin_id: CITESTE, sectiune: 'investitori', poate_scrie: false },
    ],
    investitori_kyc: [{ user_id: INV_OK, status: 'aprobat' }, { user_id: INV_NU, status: 'in_verificare' }],
    backoffice_config: [
      { cheie: 'investitori_email', valoare: 'investor@example.com', sectiune: 'contact', tara_cod: 'ALL' },
      ...(vizibilitate ? [{ cheie: 'pitch_deck_vizibilitate', valoare: vizibilitate, sectiune: 'investitori', tara_cod: 'ALL' }] : []),
    ],
    runde_finantare: runda ? [{ id: 'r-test', cod: 'test', denumire_ro: 'Test', denumire_en: 'Test', stare: 'deschisa', vizibila_public: true, moneda: 'EUR',
      evaluare_pre_money: 900000, suma_tinta: 100000, actiuni_existente: 900, investitie_minima: 1000, tickete: [5000], data_start: '2099-11-01', data_sfarsit: '2100-06-30' }] : [],
    investitori_portofoliu: [],
    pitch_deck_versiuni: [],
    audit_log: [],
    comenzi: [],
  };
  DB.coloane = {};
  DB.implicite = { pitch_deck_versiuni: { aprobat: false, note_verificare: [], creat_la: new Date().toISOString() } };
  DB.utilizatori = {};
  Object.keys(TOKEN).forEach((id) => { DB.utilizatori[TOKEN[id]] = { id, email: id + '@test' }; });
  // Contactul platformei e păstrat în cache 5 minute: îl golim între teste.
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
  await apiAdmin(cerere({ metoda: body ? 'POST' : 'GET', token: TOKEN[id], body, query: query || {} }), res);
  return res;
}
async function public_(query, id) {
  const res = raspuns();
  await apiPublic(cerere({ metoda: 'GET', token: id ? TOKEN[id] : null, query }), res);
  return res;
}
// Importă ambele fișiere și rezolvă tot (note + surse), ca să se poată aproba.
async function importaSiPregateste(limbi = ['ro', 'en']) {
  const ids = {};
  for (const l of limbi) {
    const r = await admin(SCRIE, { actiune: 'importa', fisier: copie(l === 'ro' ? RO : EN) });
    egal(r.statusCode, 200, 'import ' + l + ' ' + JSON.stringify(r.corp));
    const v = r.corp.versiune;
    const slide_uri = v.slide_uri.map((s) => (s.prognoza ? { ...s, sursa: 'Sursă de test (nu e sursa reală)' } : s));
    const s = await admin(SCRIE, { actiune: 'salveaza', id: v.id, titlu: v.titlu, sursa: v.sursa, disclaimer: v.disclaimer, slide_uri, note_verificare: v.note_verificare.map((n) => ({ id: n.id, rezolvat: true })) });
    egal(s.statusCode, 200, 'salvare ' + l + ' ' + JSON.stringify(s.corp));
    ids[l] = v.id;
  }
  return ids;
}

(async () => {
  console.log('A. Schema');
  const TIPURI_JSON = [...new Set(RO.slide_uri.map((s) => s.tip))];
  await test(`cele 19 tipuri din JSON au schemă (${TIPURI_JSON.length})`, async () => {
    egal(TIPURI_JSON.length, 19);
    egal(TIPURI_JSON.filter((t) => !S.TIPURI[t]), []);
    egal(Object.keys(S.TIPURI).sort(), TIPURI_JSON.slice().sort());
  });
  for (const [l, j] of [['RO', RO], ['EN', EN]]) {
    await test(`JSON-ul real ${l}: 20 de slide-uri, fiecare tip valid`, async () => {
      egal(j.slide_uri.length, 20);
      for (const s of j.slide_uri) egal(S.valideaza([{ ...s, nr: 1 }]), [], `slide ${s.nr} (${s.tip})`);
      egal(S.valideaza(j.slide_uri), []);
    });
  }
  await test('JSON stricat → erori pe câmp, RO + EN', async () => {
    const j = copie(RO.slide_uri);
    j[3].cifre[1].valoare = '50';
    j[13].randuri[0].valori.pop();
    j[0].imagine = '../secret.webp';
    delete j[19].url_investitori;
    j[5].tip = 'necunoscut';
    j[16].venituri.pop();
    j[8].nr = 99;
    const e = S.valideaza(j);
    const campuri = e.map((x) => x.camp);
    for (const c of ['slide_uri.3.cifre.1.valoare', 'slide_uri.13.randuri.0.valori', 'slide_uri.0.imagine', 'slide_uri.19.url_investitori', 'slide_uri.5.tip', 'slide_uri.16.venituri', 'slide_uri.8.nr']) {
      adevarat(campuri.includes(c), `lipsește eroarea pe ${c} (${campuri.join(', ')})`);
    }
    adevarat(e.every((x) => x.ro && x.en && /^Slide \d+/.test(x.ro)), 'mesaj RO + EN, cu numărul slide-ului');
    egal(S.valideaza([]).length, 1, 'listă goală');
    adevarat(S.valideaza([{ nr: 1, tip: 'coperta', animatie: 'imagine', titlu: 'x', imagine: 'https://evil.example/x.webp' }]).length === 1, 'imagine din afara pitch-deck-media → eroare');
    egal(S.valideaza([{ nr: 1, tip: 'coperta', animatie: 'imagine', titlu: 'x', imagine: 'https://abc.supabase.co/storage/v1/object/public/pitch-deck-media/v/2026-10-22-ab.webp' }]), [], 'imagine din pitch-deck-media → validă');
  });

  console.log('B. Limbile');
  await test('ro → RO; en, bg, de, el, fr, tr → EN; necunoscut → EN', async () => {
    egal(P.limbaDeck('ro'), 'ro'); egal(P.limbaDeck('RO-ro'), 'ro');
    for (const l of ['en', 'bg', 'de', 'el', 'fr', 'tr', 'es', '', null, undefined]) egal(P.limbaDeck(l), 'en', String(l));
  });

  console.log('C. Note de verificare și aprobare');
  await test('importul: o ciornă per limbă, note_verificare din de_verificat, nimic public', async () => {
    reset();
    const nrNote = (j) => j.slide_uri.reduce((n, s) => n + (s.de_verificat || []).length, 0);
    for (const [l, j] of [['ro', RO], ['en', EN]]) {
      const r = await admin(SCRIE, { actiune: 'importa', fisier: copie(j) });
      egal(r.statusCode, 200, JSON.stringify(r.corp));
      const v = r.corp.versiune;
      egal([v.limba, v.aprobat], [l, false]);
      egal(v.note_verificare.length, nrNote(j), 'numărul notelor');
      adevarat(v.note_verificare.every((n) => n.rezolvat === false && n.slide >= 1 && n.text), 'note nerezolvate');
      adevarat(v.slide_uri.every((s) => !('de_verificat' in s)), 'de_verificat scos din slide-uri');
      egal(v.disclaimer, j.meta.disclaimer, 'eticheta de prognoză din meta');
    }
    egal(DB.tabele.pitch_deck_versiuni.length, 2);
    egal((await public_({ limba: 'ro' })).corp.stare, 'in_pregatire', 'importul nu publică nimic');
    adevarat(DB.tabele.audit_log.filter((a) => a.actiune === 'pitch_deck_importat').length === 2, 'audit');
  });
  await test('aprobarea cu note nerezolvate → 409 NOTE_NEREZOLVATE (RO + EN), pe câmp', async () => {
    reset();
    const v = (await admin(SCRIE, { actiune: 'importa', fisier: copie(RO) })).corp.versiune;
    const r = await admin(SCRIE, { actiune: 'aproba', id: v.id });
    egal(r.statusCode, 409); egal(r.corp.cod, 'NOTE_NEREZOLVATE');
    egal(r.corp.mesaj.ro, 'Rezolvați notele de verificare înainte de aprobare.');
    egal(r.corp.mesaj.en, 'Resolve the verification notes before approval.');
    adevarat(r.corp.campuri.some((c) => /^note_verificare\./.test(c.camp)) && r.corp.campuri.some((c) => c.camp === 'slide_uri.3.sursa'), 'note și surse lipsă');
    egal(DB.tabele.pitch_deck_versiuni[0].aprobat, false);
  });
  await test('note rezolvate, dar sursa lipsă pe un slide de prognoză → tot refuzată', async () => {
    reset();
    const v = (await admin(SCRIE, { actiune: 'importa', fisier: copie(RO) })).corp.versiune;
    await admin(SCRIE, { actiune: 'salveaza', id: v.id, titlu: v.titlu, disclaimer: v.disclaimer, slide_uri: v.slide_uri, note_verificare: v.note_verificare.map((n) => ({ id: n.id, rezolvat: true })) });
    const r = await admin(SCRIE, { actiune: 'aproba', id: v.id });
    egal(r.statusCode, 409);
    egal(r.corp.campuri.map((c) => c.camp), [4, 9, 10, 12, 15, 17, 19].map((n) => `slide_uri.${n - 1}.sursa`));
  });
  await test('totul rezolvat → aprobată; aprobarea RO nu atinge EN; a doua aprobare RO o retrage doar pe prima RO', async () => {
    reset();
    const ids = await importaSiPregateste();
    egal((await admin(SCRIE, { actiune: 'aproba', id: ids.en })).statusCode, 200);
    const ro1 = await admin(SCRIE, { actiune: 'aproba', id: ids.ro });
    egal(ro1.statusCode, 200, JSON.stringify(ro1.corp)); egal(ro1.corp.retrase, []);
    const dup = (await admin(SCRIE, { actiune: 'duplica', id: ids.ro })).corp.versiune;
    egal([dup.aprobat, dup.limba], [false, 'ro']);
    const ro2 = await admin(SUPER, { actiune: 'aproba', id: dup.id });
    egal(ro2.statusCode, 200); egal(ro2.corp.retrase, [ids.ro]);
    const st = Object.fromEntries(DB.tabele.pitch_deck_versiuni.map((v) => [v.id, v.aprobat]));
    egal([st[ids.ro], st[dup.id], st[ids.en]], [false, true, true], 'RO veche retrasă, RO nouă aprobată, EN neatinsă');
    egal(DB.tabele.pitch_deck_versiuni.filter((v) => v.aprobat && v.limba === 'ro').length, 1, 'o singură RO aprobată');
  });

  console.log('D. QR');
  await test('QR-ul generat (SVG) se decodează la url_investitori', async () => {
    const jsQR = require('jsqr');
    const url = RO.slide_uri[19].url_investitori;
    const svg = await P.qrSvg(url);
    adevarat(/^<svg[^>]*viewBox="0 0 (\d+) \1"/.test(svg), 'SVG cu viewBox pătrat');
    // Rasterizăm traseul SVG (M x y / m dx dy / h n), 8 px pe modul.
    const n = Number(svg.match(/viewBox="0 0 (\d+)/)[1]);
    const d = svg.match(/<path[^>]*stroke[^>]*d="([^"]+)"/)[1];
    const K = 8, W = n * K;
    const px = new Uint8ClampedArray(W * W * 4).fill(255);
    let x = 0, y = 0;
    const re = /([MmHh])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g; let m;
    while ((m = re.exec(d))) {
      const a = Number(m[2]), b = Number(m[3]);
      if (m[1] === 'M') { x = a; y = b; } else if (m[1] === 'm') { x += a; y += b; }
      else { const l = m[1] === 'h' ? a : a - x; const r0 = Math.floor(y);
        for (let c = Math.min(x, x + l); c < Math.max(x, x + l); c++) for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) { const o = ((r0 * K + i) * W + c * K + j) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
        x += l; }
    }
    const cod = jsQR(px, W, W);
    adevarat(cod, 'QR-ul nu s-a putut decoda');
    egal(cod.data, url);
    egal(await P.qrSvg('javascript:alert(1)'), null, 'adresă nevalidă → fără QR');
  });

  console.log('E. API-ul public');
  await test('fără versiune aprobată → „în pregătire” (RO și EN)', async () => {
    reset();
    for (const l of ['ro', 'en', 'de']) { const r = await public_({ limba: l }); egal([r.statusCode, r.corp.stare, r.corp.deck], [200, 'in_pregatire', undefined], l); }
    egal((await public_({ limba: 'ro', doar_stare: '1' })).corp.stare, 'in_pregatire');
  });
  await test('migrarea neaplicată (coloana limba lipsă) → „în pregătire”, nu eroare', async () => {
    reset();
    DB.coloane.pitch_deck_versiuni = ['id', 'slide_uri', 'aprobat', 'aprobat_de', 'aprobat_la', 'creat_de', 'creat_la'];
    const r = await public_({ limba: 'ro' });
    egal([r.statusCode, r.corp.stare], [200, 'in_pregatire']);
  });
  await test('vizibilitate restrânsă, fără sesiune → doar rezumatul (titlul + slide-urile 1–3), fără rundă / QR', async () => {
    reset();
    const ids = await importaSiPregateste(); await admin(SCRIE, { actiune: 'aproba', id: ids.ro }); await admin(SCRIE, { actiune: 'aproba', id: ids.en });
    for (const [l, id] of [['ro', null], ['en', null], ['ro', CLIENT], ['ro', INV_NU]]) {
      const r = await public_({ limba: l }, id);
      egal([r.corp.stare, r.corp.deck.slide_uri.length, r.corp.deck.total_slideuri], ['rezumat', 3, 20], `${l} ${id}`);
      egal([r.corp.runda, r.corp.qr_svg], [null, null], 'rezumat fără rundă și QR');
      egal(r.headere['Cache-Control'], 'private, no-store');
    }
    egal((await public_({ limba: 'ro', doar_stare: '1' })).corp, { ok: true, stare: 'disponibil', limba: 'ro', vizibilitate: 'investitori_aprobati' });
  });
  await test('investitor cu KYC aprobat → deck complet, cu runda, emailul și QR-ul din date', async () => {
    reset();
    const ids = await importaSiPregateste(); await admin(SCRIE, { actiune: 'aproba', id: ids.ro }); await admin(SCRIE, { actiune: 'aproba', id: ids.en });
    const r = await public_({ limba: 'ro' }, INV_OK);
    egal([r.corp.stare, r.corp.limba, r.corp.deck.slide_uri.length], ['complet', 'ro', 20]);
    egal([r.corp.runda.post_money, r.corp.runda.equity_oferit_pct, r.corp.runda.pret_actiune, r.corp.runda.evaluare_pre_money], [1000000, 10, 1000, 900000], 'runda din runde_finantare');
    egal(r.corp.contact, { investitori_email: 'investor@example.com' }, 'emailul din backoffice_config');
    adevarat(/^<svg/.test(r.corp.qr_svg), 'QR');
    for (const l of ['en', 'bg', 'de', 'el', 'fr', 'tr']) { const e = await public_({ limba: l }, INV_OK); egal([e.corp.limba, e.corp.deck.slide_uri[0].subtitlu], ['en', EN.slide_uri[0].subtitlu], l); }
  });
  await test('vizibilitate public → deck complet fără sesiune; cheia lipsă → varianta prudentă', async () => {
    reset({ vizibilitate: 'public' });
    const ids = await importaSiPregateste(['ro']); await admin(SCRIE, { actiune: 'aproba', id: ids.ro });
    const r = await public_({ limba: 'ro' });
    egal([r.corp.stare, r.corp.deck.slide_uri.length], ['complet', 20]);
    adevarat(/public/.test(r.headere['Cache-Control']), 'cache public');
    DB.tabele.backoffice_config = DB.tabele.backoffice_config.filter((c) => c.cheie !== 'pitch_deck_vizibilitate');
    egal((await public_({ limba: 'ro' })).corp.stare, 'rezumat', 'fără cheie → investitori_aprobati');
    DB.tabele.backoffice_config.push({ cheie: 'pitch_deck_vizibilitate', valoare: 'oricine', sectiune: 'investitori', tara_cod: 'ALL' });
    egal((await public_({ limba: 'ro' })).corp.stare, 'rezumat', 'valoare necunoscută → investitori_aprobati');
  });
  await test('fără rundă publică → runda null (slide-ul arată „Termenii rundei vor fi anunțați”)', async () => {
    reset({ vizibilitate: 'public', runda: false });
    const ids = await importaSiPregateste(['ro']); await admin(SCRIE, { actiune: 'aproba', id: ids.ro });
    egal((await public_({ limba: 'ro' })).corp.runda, null);
    DB.tabele.runde_finantare.push({ id: 'r2', cod: 'x', denumire_ro: 'X', denumire_en: 'X', stare: 'deschisa', vizibila_public: false, moneda: 'EUR', evaluare_pre_money: 10, suma_tinta: 1, actiuni_existente: 1 });
    egal((await public_({ limba: 'ro' })).corp.runda, null, 'runda deschisă dar nepublică');
  });

  console.log('F. API-ul de administrare');
  await test('admin doar cu citire: lista și previzualizarea da; importul, salvarea, aprobarea → 403 FARA_DREPT_SCRIERE', async () => {
    reset();
    const ids = await importaSiPregateste(['ro']);
    const l = await admin(CITESTE);
    egal([l.statusCode, l.corp.poate_scrie, l.corp.versiuni.length], [200, false, 1]);
    egal((await admin(CITESTE, { actiune: 'previzualizare', id: ids.ro })).corp.stare, 'complet');
    const inainte = JSON.stringify(DB.tabele.pitch_deck_versiuni);
    for (const body of [{ actiune: 'importa', fisier: copie(EN) }, { actiune: 'aproba', id: ids.ro }, { actiune: 'duplica', id: ids.ro }, { actiune: 'retrage', id: ids.ro }, { actiune: 'url_incarcare', tip: 'image/webp', marime: 1000 }]) {
      const r = await admin(CITESTE, body);
      egal([r.statusCode, r.corp.cod], [403, 'FARA_DREPT_SCRIERE'], body.actiune);
    }
    egal(JSON.stringify(DB.tabele.pitch_deck_versiuni), inainte, 'nimic scris');
    egal((await admin(CLIENT)).statusCode, 403, 'client');
  });
  await test('versiunea aprobată nu se editează (409); se duplică', async () => {
    reset();
    const ids = await importaSiPregateste(['ro']);
    await admin(SCRIE, { actiune: 'aproba', id: ids.ro });
    const v = DB.tabele.pitch_deck_versiuni[0];
    const r = await admin(SCRIE, { actiune: 'salveaza', id: ids.ro, titlu: 'x', slide_uri: v.slide_uri });
    egal([r.statusCode, r.corp.cod], [409, 'VERSIUNE_APROBATA']);
  });
  await test('salvarea cu un câmp greșit → 400 cu câmpul marcat, nimic scris', async () => {
    reset();
    const v = (await admin(SCRIE, { actiune: 'importa', fisier: copie(RO) })).corp.versiune;
    const s = copie(v.slide_uri); s[8].nivele[0].valoare = 'mult';
    const r = await admin(SCRIE, { actiune: 'salveaza', id: v.id, titlu: '', slide_uri: s });
    egal(r.statusCode, 400);
    egal(r.corp.campuri.map((c) => c.camp), ['titlu', 'slide_uri.8.nivele.0.valoare']);
    egal(DB.tabele.pitch_deck_versiuni[0].slide_uri[8].nivele[0].valoare, 500000000000, 'valoarea salvată rămâne');
  });
  await test('notele: editorul schimbă doar bifa, nu textul', async () => {
    reset();
    const v = (await admin(SCRIE, { actiune: 'importa', fisier: copie(RO) })).corp.versiune;
    const n0 = v.note_verificare[0];
    await admin(SCRIE, { actiune: 'salveaza', id: v.id, titlu: v.titlu, slide_uri: v.slide_uri, note_verificare: [{ id: n0.id, rezolvat: true, text: 'alt text' }] });
    const n = DB.tabele.pitch_deck_versiuni[0].note_verificare;
    egal([n[0].rezolvat, n[0].text, n.filter((x) => x.rezolvat).length], [true, n0.text, 1]);
  });
  await test('vizibilitatea: adminul cu scriere → 403 DOAR_SUPERADMIN; superadminul o schimbă, cu audit', async () => {
    reset();
    egal((await admin(SCRIE, { actiune: 'vizibilitate', valoare: 'public' })).corp.cod, 'DOAR_SUPERADMIN');
    egal((await admin(SUPER, { actiune: 'vizibilitate', valoare: 'oricine' })).statusCode, 400);
    const r = await admin(SUPER, { actiune: 'vizibilitate', valoare: 'public' });
    egal([r.statusCode, r.corp.vizibilitate], [200, 'public']);
    egal(await P.citesteVizibilitate(), 'public');
    adevarat(DB.tabele.audit_log.some((a) => a.actiune === 'pitch_deck_vizibilitate'), 'audit');
  });
  await test('încărcarea imaginii: doar webp / png / jpg, cel mult 5 MB, adresă în pitch-deck-media', async () => {
    reset();
    process.env.SUPABASE_URL = 'https://abc.supabase.co';
    egal((await admin(SCRIE, { actiune: 'url_incarcare', tip: 'image/gif', marime: 10 })).corp.cod, 'TIP_FISIER');
    egal((await admin(SCRIE, { actiune: 'url_incarcare', tip: 'image/webp', marime: 6 * 1024 * 1024 })).corp.cod, 'FISIER_PREA_MARE');
    const r = await admin(SCRIE, { actiune: 'url_incarcare', tip: 'image/png', marime: 1000 });
    egal(r.statusCode, 200);
    adevarat(S.RE_MEDIA.test(r.corp.url_public), 'adresa publică trece validarea schemei: ' + r.corp.url_public);
  });
  await test('fiecare acțiune de scriere se auditează', async () => {
    reset();
    const ids = await importaSiPregateste(['ro']);
    await admin(SCRIE, { actiune: 'aproba', id: ids.ro });
    await admin(SCRIE, { actiune: 'retrage', id: ids.ro });
    await admin(SCRIE, { actiune: 'duplica', id: ids.ro });
    const a = DB.tabele.audit_log.map((x) => x.actiune);
    for (const x of ['pitch_deck_importat', 'pitch_deck_ciorna_salvata', 'pitch_deck_aprobat', 'pitch_deck_aprobare_retrasa', 'pitch_deck_duplicat']) adevarat(a.includes(x), x);
  });

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
