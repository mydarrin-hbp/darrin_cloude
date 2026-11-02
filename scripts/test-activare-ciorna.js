// scripts/test-activare-ciorna.js
// Pasul 11-R3, corecție (2 nov. 2026): ciorna activării pe pași
// (api/partener/activare-ciorna.js, tabelul din
// docs/migrations-propuse/2026-11-02_activare_ciorna.sql). Supabase simulat.
//   - GET întoarce doar ciorna utilizatorului conectat (altul nu o poate citi);
//   - PUT: rol de partener ales sau acordat (altfel 403), cel mult 50 KB
//     (altfel 413), pasul 1–6; IBAN-ul și codurile nu se păstrează;
//   - DELETE șterge ciorna; contract-confirma-otp o șterge la semnare;
//   - fără tabel (migrarea neaplicată) → 503 CIORNA_INDISPONIBILA, RO + EN;
//   - migrarea: o singură tranzacție, RLS fără politici, rulabilă de mai multe ori.
// Rulare: node scripts/test-activare-ciorna.js

const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
const { DB, cerere, raspuns, RADACINA } = sim;
sim.instaleaza();

const api = require(path.join(RADACINA, 'api/partener/activare-ciorna.js'));

let trecute = 0, picate = 0;
async function test(nume, fn) {
  try { await fn(); trecute++; console.log(`  ✓ ${nume}`); } catch (e) { picate++; console.log(`  ✗ ${nume}\n      ${e.message}`); }
}
function egal(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} — așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(v, m) { if (!v) throw new Error(m || 'condiție falsă'); }

function reset() {
  DB.tabele = { profiles: [], partener_activare_ciorna: [] };
  DB.coloane = {};
  DB.utilizatori = {};
  [['a', ['client'], 'partener_servicii'], ['b', ['client', 'partener_materiale'], null], ['c', ['client'], 'client']].forEach(([id, roles, rol]) => {
    DB.tabele.profiles.push({ id, email: `${id}@test`, roles, rol_solicitat: rol });
    DB.utilizatori[`tok-${id}`] = { id, email: `${id}@test` };
  });
}
async function cheama(opt) {
  const res = raspuns();
  const e = console.error; console.error = () => {};
  try { await api(cerere(opt), res); } finally { console.error = e; }
  return res;
}

(async () => {
  console.log('Ciorna activării');
  await test('PUT → salvată; GET o întoarce doar proprietarului', async () => {
    reset();
    const put = await cheama({ metoda: 'PUT', token: 'tok-a', body: { pas_curent: 2, date: { cont_bancar: { banca: 'Banca X' } } } });
    egal(put.statusCode, 200, JSON.stringify(put.corp));
    const a = await cheama({ token: 'tok-a' });
    egal([a.corp.ciorna.pas_curent, a.corp.ciorna.date.cont_bancar.banca], [2, 'Banca X']);
    const b = await cheama({ token: 'tok-b' });
    egal(b.corp.ciorna, null, 'alt utilizator citește ciorna');
  });
  await test('rol de partener acordat (fără rol_solicitat) → poate salva', async () => {
    reset();
    egal((await cheama({ metoda: 'PUT', token: 'tok-b', body: { pas_curent: 3, date: {} } })).statusCode, 200);
  });
  await test('fără rol de partener ales sau acordat → 403, RO + EN', async () => {
    reset();
    const r = await cheama({ metoda: 'PUT', token: 'tok-c', body: { pas_curent: 1, date: {} } });
    egal([r.statusCode, r.corp.cod], [403, 'FARA_ROL_PARTENER']);
    adevarat(r.corp.mesaj.ro && r.corp.mesaj.en);
    egal(DB.tabele.partener_activare_ciorna.length, 0);
  });
  await test('peste 50 KB → 413, nimic salvat', async () => {
    reset();
    const r = await cheama({ metoda: 'PUT', token: 'tok-a', body: { pas_curent: 1, date: { firma: { nume_firma: 'x'.repeat(51 * 1024) } } } });
    egal([r.statusCode, r.corp.cod], [413, 'CIORNA_PREA_MARE']);
    egal(DB.tabele.partener_activare_ciorna.length, 0);
  });
  await test('pas în afara 1–6 sau date care nu sunt obiect → 400', async () => {
    reset();
    egal((await cheama({ metoda: 'PUT', token: 'tok-a', body: { pas_curent: 7, date: {} } })).statusCode, 400);
    egal((await cheama({ metoda: 'PUT', token: 'tok-a', body: { pas_curent: 2, date: [1] } })).statusCode, 400);
  });
  await test('IBAN-ul și codurile nu se păstrează în ciornă', async () => {
    reset();
    await cheama({ metoda: 'PUT', token: 'tok-a', body: { pas_curent: 2, date: { cont_bancar: { banca: 'B', iban: 'RO49AAAA1B31007593840000' }, contract: { cod: '123456' } } } });
    const d = DB.tabele.partener_activare_ciorna[0].date;
    egal(d, { cont_bancar: { banca: 'B' }, contract: {} });
  });
  await test('DELETE șterge ciorna', async () => {
    reset();
    await cheama({ metoda: 'PUT', token: 'tok-a', body: { pas_curent: 2, date: {} } });
    egal((await cheama({ metoda: 'DELETE', token: 'tok-a' })).statusCode, 200);
    egal(DB.tabele.partener_activare_ciorna.length, 0);
  });
  await test('fără sesiune → 401', async () => {
    reset();
    egal((await cheama({ metoda: 'PUT', body: { pas_curent: 1, date: {} } })).statusCode, 401);
  });
  await test('fără tabel (migrarea neaplicată) → 503 CIORNA_INDISPONIBILA, RO + EN; DELETE nu dă eroare', async () => {
    reset();
    delete DB.tabele.partener_activare_ciorna;
    const g = await cheama({ token: 'tok-a' });
    egal([g.statusCode, g.corp.cod], [503, 'CIORNA_INDISPONIBILA']);
    adevarat(g.corp.mesaj.ro && g.corp.mesaj.en);
    egal((await cheama({ metoda: 'PUT', token: 'tok-a', body: { pas_curent: 1, date: {} } })).statusCode, 503);
    egal((await cheama({ metoda: 'DELETE', token: 'tok-a' })).statusCode, 200);
  });
  await test('contract-confirma-otp șterge ciorna la semnare', () => {
    const t = fs.readFileSync(path.join(RADACINA, 'api/partener/contract-confirma-otp.js'), 'utf8');
    adevarat(/from\('partener_activare_ciorna'\)\.delete\(\)\.eq\('user_id', user\.id\)/.test(t), 'ștergerea lipsește');
  });

  console.log('\nMigrarea');
  await test('o tranzacție, idempotentă, RLS fără politici, fără drepturi pentru anon / authenticated', () => {
    const sql = fs.readFileSync(path.join(RADACINA, 'docs/migrations-propuse/2026-11-02_activare_ciorna.sql'), 'utf8');
    const cod = sql.replace(/--[^\n]*/g, '');
    egal((cod.match(/\bbegin;/g) || []).length, 1);
    egal((cod.match(/\bcommit;/g) || []).length, 1);
    adevarat(/create table if not exists public\.partener_activare_ciorna/.test(cod));
    adevarat(/user_id\s+uuid primary key references auth\.users\(id\) on delete cascade/.test(cod));
    adevarat(/pas_curent\s+integer/.test(cod) && /date\s+jsonb/.test(cod) && /actualizat_la\s+timestamptz/.test(cod));
    adevarat(/enable row level security/.test(cod));
    adevarat(!/create policy/i.test(cod), 'nu trebuie să existe politici');
    adevarat(/revoke all on table public\.partener_activare_ciorna from anon, authenticated/.test(cod));
    adevarat(/drop constraint if exists/.test(cod));
  });

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
})();
