// scripts/test-note-prezentator.js
// Pasul 11-K3 (23 oct. 2026): notele prezentatorului (`note_prezentator`),
// cu Supabase simulat (scripts/supabase-simulat.js). Nimic nu ajunge la producție.
//   A. schema: câmpul e opțional pe fiecare tip de slide, text de cel mult
//      2.000 de caractere; 2.001 → eroare pe câmp; null / lipsă → valid;
//   B. api/public/pitch-deck.js NU întoarce niciodată note_prezentator: cu
//      vizibilitate publică și restrânsă, fără sesiune, cu investitor aprobat,
//      cu sesiune de superadmin, și cu doar_stare;
//   C. api/admin/pitch-deck.js le întoarce (previzualizare, prezentare) doar cu
//      drept de citire pe Investitori: superadmin și admin cu rând → da; admin
//      fără rând, client, fără sesiune → refuz; fiecare limbă cu notele ei;
//   D. salvarea ciornei păstrează notele; peste 2.000 de caractere → 400 pe câmp.
// Notele de aici sunt DE TEST: versiunile reale nu au note.
// Rulare: node scripts/test-note-prezentator.js

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
const RO = require(path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1.1-ro.json'));
const EN = require(path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1.1-en.json'));
const copie = (o) => JSON.parse(JSON.stringify(o));

const SUPER = 'u-super', CITESTE = 'u-citeste', FARA = 'u-admin-fara', INV = 'u-inv', CLIENT = 'u-client';
const TOKEN = { [SUPER]: 'tok-super', [CITESTE]: 'tok-citeste', [FARA]: 'tok-fara', [INV]: 'tok-inv', [CLIENT]: 'tok-client' };
const NOTA_RO = 'NOTĂ DE TEST RO — nu se publică';
const NOTA_EN = 'TEST NOTE EN — never public';

function versiune(j, id, nota) {
  const { slide_uri } = P.extrageNote(copie(j.slide_uri));
  return {
    id, limba: j.meta.limba, titlu: 'Pitch deck ' + j.meta.versiune, sursa: j.meta.sursa, disclaimer: j.meta.disclaimer,
    slide_uri: slide_uri.map((s) => ({ ...(s.prognoza ? { ...s, sursa: 'Sursă DE TEST' } : s), note_prezentator: nota + ' · slide ' + s.nr })),
    note_verificare: [], aprobat: true, aprobat_la: '2026-10-22T10:00:00Z', creat_la: '2026-10-22T09:00:00Z',
  };
}
function reset({ vizibilitate = 'public' } = {}) {
  DB.tabele = {
    profiles: [
      { id: SUPER, email: 'super@test', roles: ['superadmin'] },
      { id: CITESTE, email: 'citeste@test', roles: ['admin'] },
      { id: FARA, email: 'fara@test', roles: ['admin'] },
      { id: INV, email: 'inv@test', roles: ['client', 'investor'] },
      { id: CLIENT, email: 'client@test', roles: ['client'] },
    ],
    admin_permissions: [{ admin_id: CITESTE, sectiune: 'investitori', poate_scrie: false }],
    investitori_kyc: [{ user_id: INV, status: 'aprobat' }],
    backoffice_config: [
      { cheie: 'investitori_email', valoare: 'investor@example.com', sectiune: 'contact', tara_cod: 'ALL' },
      { cheie: 'pitch_deck_vizibilitate', valoare: vizibilitate, sectiune: 'investitori', tara_cod: 'ALL' },
    ],
    runde_finantare: [], investitori_portofoliu: [], audit_log: [],
    pitch_deck_versiuni: [versiune(RO, 'v-ro', NOTA_RO), versiune(EN, 'v-en', NOTA_EN), { ...versiune(RO, 'v-ciorna', NOTA_RO), aprobat: false, aprobat_la: null }],
  };
  DB.coloane = {};
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
async function public_(query, id) {
  const res = raspuns();
  await apiPublic(cerere({ metoda: 'GET', token: id ? TOKEN[id] : null, query }), res);
  return res;
}
// Nicio urmă a notelor în răspuns: nici cheia, nici textul.
function faraNote(corp, m) {
  const t = JSON.stringify(corp);
  adevarat(!/note_prezentator/.test(t) && !t.includes('NOTĂ DE TEST') && !t.includes('TEST NOTE'), (m || '') + ' răspunsul conține note: ' + t.slice(0, 160));
}

(async () => {
  console.log('A. schema');
  const slide = () => copie(RO.slide_uri.map((s) => { const { de_verificat: _x, ...r } = s; return r; }));
  await test('note_prezentator e un câmp comun, opțional, text lung ≤ 2.000', async () => {
    const d = S.COMUNE.note_prezentator;
    egal([d.t, d.max, !!d.obl, d.nul], ['lung', 2000, false, true]);
    Object.keys(S.TIPURI).forEach((tip) => adevarat(S.campuriTip(tip).note_prezentator === d, 'lipsește pe ' + tip));
  });
  await test('fără note / null / text ≤ 2.000 → valid, pe toate cele 20 de slide-uri', async () => {
    egal(S.valideaza(slide()), []);
    const a = slide(); a.forEach((s, i) => { s.note_prezentator = i % 2 ? null : 'x'.repeat(2000); });
    egal(S.valideaza(a), []);
  });
  await test('2.001 de caractere → eroare pe câmp (RO + EN)', async () => {
    const a = slide(); a[4].note_prezentator = 'x'.repeat(2001);
    const e = S.valideaza(a);
    egal(e.map((x) => x.camp), ['slide_uri.4.note_prezentator']);
    adevarat(/2000/.test(e[0].ro) && /2000/.test(e[0].en), JSON.stringify(e));
  });
  await test('o valoare care nu e text → eroare pe câmp', async () => {
    const a = slide(); a[0].note_prezentator = 12;
    egal(S.valideaza(a).map((x) => x.camp), ['slide_uri.0.note_prezentator']);
  });

  console.log('B. api/public/pitch-deck.js nu întoarce niciodată notele');
  for (const viz of ['public', 'investitori_aprobati']) {
    for (const [cine, id] of [['fără sesiune', null], ['investitor aprobat', INV], ['superadmin', SUPER], ['admin cu drept', CITESTE]]) {
      for (const limba of ['ro', 'en', 'de']) {
        await test(`vizibilitate ${viz} · ${cine} · ${limba}`, async () => {
          reset({ vizibilitate: viz });
          const r = await public_({ limba }, id);
          egal(r.statusCode, 200);
          adevarat(r.corp.deck && r.corp.deck.slide_uri.length >= 3, 'fără slide-uri');
          faraNote(r.corp);
        });
      }
    }
    await test(`vizibilitate ${viz} · doar_stare`, async () => { reset({ vizibilitate: viz }); const r = await public_({ limba: 'ro', doar_stare: '1' }); faraNote(r.corp); });
  }
  await test('cu vizibilitate restrânsă și fără sesiune: rezumatul, tot fără note', async () => {
    reset({ vizibilitate: 'investitori_aprobati' });
    const r = await public_({ limba: 'en' });
    egal([r.corp.stare, r.corp.deck.slide_uri.length], ['rezumat', 3]);
    faraNote(r.corp);
  });
  await test('construiestePayload: implicit fără note; { note: true } doar la cerere', async () => {
    reset();
    const v = DB.tabele.pitch_deck_versiuni[0];
    faraNote(await P.construiestePayload(v));
    faraNote(await P.construiestePayload(v, { rezumat: true }));
    const cu = await P.construiestePayload(v, { note: true });
    egal(cu.deck.slide_uri[1].note_prezentator, NOTA_RO + ' · slide 2');
  });

  console.log('C. api/admin/pitch-deck.js: notele doar cu drept pe Investitori');
  for (const [cine, id] of [['superadmin', SUPER], ['admin cu drept de citire', CITESTE]]) {
    await test(`${cine}: previzualizarea are notele`, async () => {
      reset();
      const r = await admin(id, { actiune: 'previzualizare', id: 'v-ciorna' });
      egal(r.statusCode, 200, JSON.stringify(r.corp));
      egal(r.corp.deck.slide_uri[0].note_prezentator, NOTA_RO + ' · slide 1');
    });
    for (const [limba, nota, l] of [['ro', NOTA_RO, 'ro'], ['en', NOTA_EN, 'en'], ['de', NOTA_EN, 'en'], ['fr', NOTA_EN, 'en']]) {
      await test(`${cine}: prezentarea ${limba} → versiunea aprobată ${l.toUpperCase()}, cu notele ei`, async () => {
        reset({ vizibilitate: 'investitori_aprobati' });
        const r = await admin(id, { actiune: 'prezentare', limba });
        egal(r.statusCode, 200, JSON.stringify(r.corp));
        egal([r.corp.limba, r.corp.stare, r.corp.deck.slide_uri.length], [l, 'complet', 20]);
        egal(r.corp.deck.slide_uri[19].note_prezentator, nota + ' · slide 20');
        adevarat(!JSON.stringify(r.corp).includes(l === 'ro' ? NOTA_EN : NOTA_RO), 'notele celeilalte limbi');
      });
    }
  }
  for (const [cine, id, cod] of [['admin fără rând pe Investitori', FARA, 403], ['client', CLIENT, 403], ['investitor aprobat', INV, 403], ['fără sesiune', null, 401]]) {
    for (const corp of [{ actiune: 'prezentare', limba: 'ro' }, { actiune: 'previzualizare', id: 'v-ro' }]) {
      await test(`${cine}: ${corp.actiune} refuzată (${cod}), fără note`, async () => {
        reset();
        const r = await admin(id, corp);
        egal(r.statusCode, cod, JSON.stringify(r.corp));
        faraNote(r.corp);
      });
    }
  }
  await test('prezentarea fără versiune aprobată → 404 VERSIUNE_LIPSA', async () => {
    reset();
    DB.tabele.pitch_deck_versiuni = DB.tabele.pitch_deck_versiuni.filter((v) => v.limba !== 'en');
    const r = await admin(SUPER, { actiune: 'prezentare', limba: 'en' });
    egal([r.statusCode, r.corp.cod], [404, 'VERSIUNE_LIPSA']);
  });

  console.log('D. salvarea ciornei');
  await test('notele se salvează pe slide, în versiunea limbii ei', async () => {
    reset();
    const v = DB.tabele.pitch_deck_versiuni.find((x) => x.id === 'v-ciorna');
    const slide_uri = copie(v.slide_uri); slide_uri[2].note_prezentator = 'Notă nouă DE TEST'; slide_uri[3].note_prezentator = null;
    const r = await admin(SUPER, { actiune: 'salveaza', id: v.id, titlu: v.titlu, sursa: v.sursa, disclaimer: v.disclaimer, slide_uri, note_verificare: [] });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    egal([r.corp.versiune.slide_uri[2].note_prezentator, r.corp.versiune.slide_uri[3].note_prezentator], ['Notă nouă DE TEST', null]);
  });
  await test('peste 2.000 de caractere → 400 CONTINUT_INVALID pe câmpul notelor', async () => {
    reset();
    const v = DB.tabele.pitch_deck_versiuni.find((x) => x.id === 'v-ciorna');
    const slide_uri = copie(v.slide_uri); slide_uri[6].note_prezentator = 'y'.repeat(2001);
    const r = await admin(SUPER, { actiune: 'salveaza', id: v.id, titlu: v.titlu, sursa: v.sursa, disclaimer: v.disclaimer, slide_uri, note_verificare: [] });
    egal([r.statusCode, r.corp.cod, r.corp.campuri.map((c) => c.camp)], [400, 'CONTINUT_INVALID', ['slide_uri.6.note_prezentator']]);
  });
  await test('fișierele v1 / v1.1 din docs/pitch-deck nu au note (nu scriem note)', async () => {
    ['v1-ro', 'v1-en', 'v1.1-ro', 'v1.1-en'].forEach((f) => {
      const j = require(path.join(RADACINA, `docs/pitch-deck/pitch-deck-${f}.json`));
      adevarat(!JSON.stringify(j).includes('note_prezentator'), f);
    });
  });

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
