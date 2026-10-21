// scripts/test-migrare-investitori-kyc.js
// Test SQL pentru migrarea propusă a pasului 11-L
// (docs/migrations-propuse/2026-10-17_investitori_kyc.sql), pe un Postgres
// local (PGlite, în memorie). Nimic nu ajunge în Supabase.
//
// Schema de pornire e o copie minimă a celei din schema.sql (investitori_kyc
// și investitori_portofoliu în forma live, 26 aug. 2026), plus ce oferă
// Supabase: schemele auth și storage (buckets, objects, storage.foldername),
// auth.uid() și rolurile anon / authenticated. Ca în producție (verificarea
// live din 21 oct. 2026): un CHECK vechi pe status, fără `ciorna`; politicile
// vechi „investitor trimite KYC” (INSERT) și „admin revizuieste KYC” (UPDATE);
// investitori_portofoliu cu UNIQUE (user_id) (investitori_portofoliu_user_id_key)
// și cheia străină user_id → profiles(id) ON DELETE CASCADE; un dosar și o
// subscriere existente, care nu trebuie atinse.
//
// Verifică:
//   1. migrarea rulează de două ori, fără erori;
//   2. bucket-ul e privat, cu limita de 5 MB și tipurile acceptate (și un
//      bucket public existent cu același nume devine privat);
//   3. coloanele noi, starea `ciorna`, unicitatea pe user_id;
//   4. RLS: utilizatorul își citește doar rândul lui; authenticated nu poate scrie;
//   5. politica de storage: utilizatorul citește doar fișierele din dosarul lui;
//   6. investitori_portofoliu: fără unicitate pe user_id (două subscrieri ale
//      aceluiași investitor intră fără eroare), cheia străină spre profiles
//      rămâne și nu se adaugă una nouă; index; datele existente rămân;
//   6b. pe investitori_kyc rămân doar politicile de citire;
//   7. verificarea de la final oprește tranzacția dacă bucket-ul nu e privat.
//
// Cerințe (nu e dependență a proiectului):
//   npm i --no-save @electric-sql/pglite
// Rulare: node scripts/test-migrare-investitori-kyc.js

const fs = require('fs');
const path = require('path');
const MIGRARE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations-propuse', '2026-10-17_investitori_kyc.sql'), 'utf8');

const A = '10000000-0000-4000-8000-00000000000a';
const B = '10000000-0000-4000-8000-00000000000b';

const SCHEMA = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id bigserial primary key, bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
grant usage on schema storage, auth to anon, authenticated;
grant select on storage.objects to authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;

create table public.profiles (id uuid primary key references auth.users(id), email text);

create table public.investitori_kyc (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) unique,
  ci_ocr_json jsonb,
  cnp_hash text,
  pep_check boolean default false,
  scor_risc integer,
  status text default 'in_verificare' check (status in ('pending','in_verificare','aprobat','respins')),
  submitted_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
alter table public.investitori_kyc enable row level security;
create policy "investitorul vede propriul KYC" on public.investitori_kyc for select using (auth.uid() = user_id);
create policy "investitor trimite KYC" on public.investitori_kyc for insert with check (auth.uid() = user_id);
create policy "admin revizuieste KYC" on public.investitori_kyc for update using (true);
grant select, insert, update, delete on public.investitori_kyc to anon, authenticated;

create table public.investitori_portofoliu (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  actiuni integer not null,
  valoare_investita numeric not null,
  roi_estimat numeric,
  ultima_evaluare timestamptz,
  oras text,
  consimtamant_public boolean default false,
  exit_estimat_luni integer,
  email text,
  status text default 'in_asteptare',
  created_at timestamptz default now(),
  constraint investitori_portofoliu_user_id_key unique (user_id)
);
grant select on public.investitori_portofoliu to authenticated;

insert into auth.users values ('${A}', 'a@test'), ('${B}', 'b@test');
insert into public.profiles values ('${A}', 'a@test'), ('${B}', 'b@test');
insert into public.investitori_kyc (user_id, status, pep_check) values ('${B}', 'aprobat', false);
insert into public.investitori_portofoliu (actiuni, valoare_investita, email) values (5, 5000, 'vechi@test');
-- un bucket cu același nume, public din greșeală: migrarea trebuie să-l facă privat
insert into storage.buckets (id, name, public) values ('investitori-kyc', 'investitori-kyc', true);
insert into storage.objects (bucket_id, name) values ('investitori-kyc', '${A}/fata-1.jpg'), ('investitori-kyc', '${B}/fata-2.jpg');
`;

let ok = 0, esec = 0;
function verifica(cond, mesaj) {
  if (cond) { ok++; console.log('  ✓ ' + mesaj); } else { esec++; console.log('  ✗ ' + mesaj); }
}

async function caUtilizator(db, uid, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await db.query(sql); }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

(async () => {
  let PGlite;
  try { ({ PGlite } = require('@electric-sql/pglite')); }
  catch (e) { console.log('PGlite lipsește: npm i --no-save @electric-sql/pglite'); process.exit(1); }

  const db = new PGlite();
  await db.exec(SCHEMA);

  // 1. De două ori
  let e1 = null, e2 = null;
  try { await db.exec(MIGRARE); } catch (e) { e1 = e; }
  verifica(!e1, 'prima rulare: fără erori' + (e1 ? ' — ' + e1.message : ''));
  try { await db.exec(MIGRARE); } catch (e) { e2 = e; }
  verifica(!e2, 'a doua rulare: fără erori' + (e2 ? ' — ' + e2.message : ''));

  // 2. Bucket
  const b = (await db.query("select * from storage.buckets where id = 'investitori-kyc'")).rows[0] || {};
  verifica(b.public === false, 'bucket-ul investitori-kyc e privat (era public)');
  verifica(Number(b.file_size_limit) === 5242880, 'limita de 5 MB');
  verifica(JSON.stringify(b.allowed_mime_types) === JSON.stringify(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']), 'tipurile acceptate: JPEG, PNG, WEBP, PDF');

  // 3. Coloane, ciorna, unicitate
  const col = (await db.query("select column_name from information_schema.columns where table_name = 'investitori_kyc'")).rows.map((r) => r.column_name);
  verifica(['date_personale', 'iban_criptat', 'document_fata_path', 'document_verso_path', 'mifid_raspunsuri', 'rezidenta_fiscala_tara', 'pas_curent', 'motiv_respingere_en'].every((c) => col.includes(c)), 'coloanele noi din investitori_kyc');
  let eCiorna = null;
  try { await db.exec(`insert into public.investitori_kyc (user_id, status) values ('${A}', 'ciorna')`); } catch (e) { eCiorna = e; }
  verifica(!eCiorna, 'starea ciorna e acceptată' + (eCiorna ? ' — ' + eCiorna.message : ''));
  const sub = (await db.query(`select submitted_at from public.investitori_kyc where user_id = '${A}'`)).rows[0];
  verifica(sub && sub.submitted_at === null, 'submitted_at nu mai are valoare implicită (ciorna nu pare trimisă)');
  let eStatus = null;
  try { await db.exec(`update public.investitori_kyc set status = 'oricare' where user_id = '${A}'`); } catch (e) { eStatus = e; }
  verifica(!!eStatus, 'o stare necunoscută e refuzată');
  let eDublu = null;
  try { await db.exec(`insert into public.investitori_kyc (user_id, status) values ('${A}', 'ciorna')`); } catch (e) { eDublu = e; }
  verifica(!!eDublu, 'un singur rând pe utilizator');
  let eTip = null;
  try { await db.exec(`update public.investitori_kyc set tip_document = 'carnet' where user_id = '${A}'`); } catch (e) { eTip = e; }
  verifica(!!eTip, 'tipul documentului: doar ci / pasaport / permis_sedere');
  const vechi = (await db.query(`select status from public.investitori_kyc where user_id = '${B}'`)).rows[0];
  verifica(vechi && vechi.status === 'aprobat', 'dosarul existent rămâne neatins');

  // 4. RLS
  const vedeA = await caUtilizator(db, A, 'select user_id from public.investitori_kyc');
  verifica(vedeA.rows.length === 1 && vedeA.rows[0].user_id === A, 'utilizatorul A își vede doar rândul lui');
  let eScriere = null;
  try { await caUtilizator(db, A, `update public.investitori_kyc set status = 'aprobat' where user_id = '${A}'`); } catch (e) { eScriere = e; }
  verifica(!!eScriere, 'authenticated nu poate scrie direct în investitori_kyc');

  // 5. Storage
  const fisiere = await caUtilizator(db, A, "select name from storage.objects where bucket_id = 'investitori-kyc'");
  verifica(fisiere.rows.length === 1 && fisiere.rows[0].name.startsWith(A + '/'), 'utilizatorul A citește doar fișierele din dosarul lui (nu pe ale lui B)');

  // 6. Portofoliu
  const colP = (await db.query("select column_name from information_schema.columns where table_name = 'investitori_portofoliu'")).rows.map((r) => r.column_name);
  verifica(['user_id', 'instrument', 'status'].every((c) => colP.includes(c)), 'investitori_portofoliu: user_id, instrument, status');
  const idx = (await db.query("select indexname from pg_indexes where indexname = 'investitori_portofoliu_user_id_idx'")).rows;
  verifica(idx.length === 1, 'indexul pe investitori_portofoliu.user_id');
  const p = (await db.query('select count(*)::int as n from public.investitori_portofoliu')).rows[0];
  verifica(p.n === 1, 'subscrierea existentă rămâne');
  let eDoua = null;
  try {
    await db.exec(`insert into public.investitori_portofoliu (user_id, actiuni, valoare_investita) values ('${A}', 25, 25000), ('${A}', 50, 50000)`);
  } catch (e) { eDoua = e; }
  verifica(!eDoua, 'două subscrieri pentru același user_id intră fără eroare' + (eDoua ? ' — ' + eDoua.message : ''));
  const unic = (await db.query(`select count(*)::int as n from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = 'public.investitori_portofoliu'::regclass and i.indisunique and i.indnatts = 1 and a.attname = 'user_id'`)).rows[0];
  verifica(unic.n === 0, 'nicio unicitate pe investitori_portofoliu.user_id singur');
  const fk = (await db.query(`select pg_get_constraintdef(oid) as d from pg_constraint
    where conrelid = 'public.investitori_portofoliu'::regclass and contype = 'f'`)).rows.map((r) => r.d);
  verifica(fk.length === 1 && /profiles\(id\)/.test(fk[0]) && /CASCADE/.test(fk[0]), 'cheia străină existentă spre profiles rămâne, fără una nouă spre auth.users (' + fk.join(' | ') + ')');

  // 6b. Politicile pe investitori_kyc
  const pol = (await db.query("select policyname, cmd from pg_policies where tablename = 'investitori_kyc' order by policyname")).rows;
  verifica(pol.length === 1 && pol[0].cmd === 'SELECT', 'pe investitori_kyc rămâne doar politica de citire (' + pol.map((x) => x.policyname + ':' + x.cmd).join(', ') + ')');

  // 7. Verificarea oprește tranzacția
  const db2 = new PGlite();
  await db2.exec(SCHEMA);
  await db2.exec(MIGRARE.replace("set public = false,", "set public = true,").replace("values ('investitori-kyc', 'investitori-kyc', false,", "values ('investitori-kyc', 'investitori-kyc', true,"));
  // ↑ o variantă greșită a migrării ar trebui să cadă la verificare; dacă a trecut, testul eșuează
  verifica(false, 'verificarea finală trebuia să oprească o migrare cu bucket public');
})().catch((e) => {
  if (/e public/.test(e.message)) { ok++; console.log('  ✓ verificarea finală oprește tranzacția dacă bucket-ul nu e privat'); }
  else { esec++; console.error('  ✗ eroare neașteptată:', e.message); }
}).finally(() => {
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
});
