// scripts/test-migrare-pitch-deck.js
// Test SQL pentru migrarea propusă a pasului 11-K
// (docs/migrations-propuse/2026-10-22_pitch_deck_limbi.sql), pe un Postgres
// local (PGlite). Nimic nu ajunge în Supabase.
//
// Schema de pornire copiază live-ul (23 oct. 2026): pitch_deck_versiuni cu
// 7 coloane, RLS activ fără politici, dar cu toate drepturile pentru anon /
// authenticated; backoffice_config cu UNIQUE (cheie, tara_cod); bucket-urile
// existente (fără pitch-deck-media).
//
// Verifică:
//   1. migrarea rulează de două ori, fără erori, fără conținut inserat;
//   2. coloanele noi și valorile implicite (limba 'ro', note_verificare []);
//   3. cel mult o versiune aprobată pe limbă (RO și EN aprobate în paralel);
//   4. limba doar 'ro' / 'en'; slide_uri și note_verificare doar liste;
//   5. RLS activ, anon / authenticated nu citesc și nu scriu tabela;
//   6. cheia pitch_deck_vizibilitate = investitori_aprobati, secțiunea
//      investitori, editabilă de superadmin; o valoare schimbată din panou
//      rămâne la a doua rulare;
//   7. bucket-ul pitch-deck-media: public, 5 MB, webp / png / jpeg; fără
//      politici de scriere.
// Rulare: node scripts/test-migrare-pitch-deck.js

const fs = require('fs');
const path = require('path');
const MIGRARE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations-propuse', '2026-10-22_pitch_deck_limbi.sql'), 'utf8');

const U = '60000000-0000-4000-8000-000000000001';
const SCHEMA = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table public.profiles (id uuid primary key references auth.users(id), roles text[]);
create table public.pitch_deck_versiuni (
  id uuid primary key default gen_random_uuid(),
  slide_uri jsonb not null,
  aprobat boolean not null default false,
  aprobat_de uuid references public.profiles(id),
  aprobat_la timestamptz,
  creat_de uuid references public.profiles(id),
  creat_la timestamptz not null default now()
);
alter table public.pitch_deck_versiuni enable row level security;
create table public.backoffice_config (
  id uuid primary key default gen_random_uuid(),
  cheie text not null, valoare text not null, tip text not null default 'number', sectiune text not null,
  eticheta text not null, descriere text, unitate text, editabil_de text default 'superadmin',
  tara_cod text not null default 'ALL', updated_at timestamptz default now(), updated_by uuid,
  unique (cheie, tara_cod)
);
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
insert into storage.buckets values ('investitori-kyc', 'investitori-kyc', false, 5242880, array['image/jpeg','application/pdf']);
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated;
insert into auth.users values ('${U}');
insert into public.profiles values ('${U}', array['superadmin']);
insert into public.backoffice_config (cheie, valoare, tip, sectiune, eticheta, tara_cod) values ('investitori_email', 'investor@example.com', 'text', 'contact', 'Email investitori', 'ALL');
`;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) { ok++; console.log('  ✓ ' + m); } else { esec++; console.log('  ✗ ' + m); } }
async function esueaza(db, sql) { try { await db.exec(sql); return null; } catch (e) { return e; } }
const unu = async (db, sql) => (await db.query(sql)).rows[0];

(async () => {
  let PGlite;
  try { ({ PGlite } = require('@electric-sql/pglite')); }
  catch (e) { console.log('PGlite lipsește: npm i --no-save @electric-sql/pglite'); process.exit(1); }
  const db = new PGlite();
  await db.exec(SCHEMA);

  // 1
  const e1 = await esueaza(db, MIGRARE);
  verifica(!e1, 'prima rulare: fără erori' + (e1 ? ' — ' + e1.message : ''));
  const e2 = await esueaza(db, MIGRARE);
  verifica(!e2, 'a doua rulare: fără erori' + (e2 ? ' — ' + e2.message : ''));
  verifica((await unu(db, 'select count(*)::int as n from public.pitch_deck_versiuni')).n === 0, 'niciun conținut de pitch deck inserat');

  // 2
  await db.exec(`insert into public.pitch_deck_versiuni (slide_uri) values ('[]'::jsonb)`);
  const v = await unu(db, 'select limba, note_verificare, actualizat_la is not null as la, titlu, sursa, disclaimer from public.pitch_deck_versiuni');
  verifica(v.limba === 'ro' && Array.isArray(v.note_verificare) && v.note_verificare.length === 0 && v.la && v.titlu === null && v.sursa === null && v.disclaimer === null,
    `valorile implicite: limba ro, note_verificare [], actualizat_la (${JSON.stringify(v)})`);
  await db.exec('delete from public.pitch_deck_versiuni');

  // 3
  await db.exec(`insert into public.pitch_deck_versiuni (slide_uri, limba, aprobat) values ('[]', 'ro', true), ('[]', 'en', true), ('[]', 'ro', false), ('[]', 'ro', false)`);
  verifica(true, 'o versiune aprobată RO și una EN, în paralel, plus ciorne RO');
  verifica(!!(await esueaza(db, `insert into public.pitch_deck_versiuni (slide_uri, limba, aprobat) values ('[]', 'ro', true)`)), 'a doua versiune aprobată RO e refuzată');
  verifica(!!(await esueaza(db, `update public.pitch_deck_versiuni set aprobat = true where limba = 'ro' and not aprobat`)), 'aprobarea unei ciorne RO lângă cea aprobată e refuzată');
  verifica(!(await esueaza(db, `update public.pitch_deck_versiuni set aprobat = false where limba = 'ro' and aprobat;
    update public.pitch_deck_versiuni set aprobat = true where id = (select id from public.pitch_deck_versiuni where limba = 'ro' and not aprobat limit 1)`)),
    'retragerea aprobării RO, apoi aprobarea altei versiuni RO: acceptată');
  verifica((await unu(db, `select count(*)::int as n from public.pitch_deck_versiuni where limba = 'en' and aprobat`)).n === 1, 'versiunea EN aprobată rămâne neatinsă');

  // 4
  verifica(!!(await esueaza(db, `insert into public.pitch_deck_versiuni (slide_uri, limba) values ('[]', 'de')`)), "limba 'de' e refuzată (doar ro / en)");
  verifica(!!(await esueaza(db, `insert into public.pitch_deck_versiuni (slide_uri) values ('{}')`)), 'slide_uri care nu e listă e refuzat');
  verifica(!!(await esueaza(db, `insert into public.pitch_deck_versiuni (slide_uri, note_verificare) values ('[]', '{}')`)), 'note_verificare care nu e listă e refuzat');

  // 5
  const rls = await unu(db, "select relrowsecurity as r from pg_class where oid = 'public.pitch_deck_versiuni'::regclass");
  verifica(rls.r === true, 'RLS activ pe pitch_deck_versiuni');
  const drepturi = await unu(db, `select has_table_privilege('anon', 'public.pitch_deck_versiuni', 'SELECT') as a_s, has_table_privilege('anon', 'public.pitch_deck_versiuni', 'INSERT') as a_i,
    has_table_privilege('authenticated', 'public.pitch_deck_versiuni', 'SELECT') as u_s, has_table_privilege('authenticated', 'public.pitch_deck_versiuni', 'UPDATE') as u_u,
    has_table_privilege('service_role', 'public.pitch_deck_versiuni', 'SELECT') as s_s`);
  verifica(!drepturi.a_s && !drepturi.a_i && !drepturi.u_s && !drepturi.u_u && drepturi.s_s, `anon / authenticated fără drepturi, service_role da (${JSON.stringify(drepturi)})`);
  await db.exec('set role anon');
  const eSel = await esueaza(db, 'select * from public.pitch_deck_versiuni');
  await db.exec('reset role');
  verifica(!!eSel && /permission denied/i.test(eSel.message), 'anon: select direct → permission denied');
  verifica((await unu(db, "select count(*)::int as n from pg_policies where tablename = 'pitch_deck_versiuni'")).n === 0, 'nicio politică RLS pe pitch_deck_versiuni');

  // 6
  const k = await unu(db, "select valoare, tip, sectiune, editabil_de, tara_cod from public.backoffice_config where cheie = 'pitch_deck_vizibilitate'");
  verifica(k && k.valoare === 'investitori_aprobati' && k.sectiune === 'investitori' && k.editabil_de === 'superadmin' && k.tara_cod === 'ALL',
    `pitch_deck_vizibilitate = investitori_aprobati, secțiunea investitori, superadmin, ALL (${JSON.stringify(k)})`);
  await db.exec("update public.backoffice_config set valoare = 'public' where cheie = 'pitch_deck_vizibilitate'");
  const e3 = await esueaza(db, MIGRARE);
  const k2 = await unu(db, "select valoare from public.backoffice_config where cheie = 'pitch_deck_vizibilitate'");
  verifica(!e3 && k2.valoare === 'public', 'a treia rulare păstrează valoarea aleasă de LM (public)');
  verifica((await unu(db, "select valoare from public.backoffice_config where cheie = 'investitori_email'")).valoare === 'investor@example.com', 'celelalte chei rămân neatinse');

  // 7
  const b = await unu(db, "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'pitch-deck-media'");
  verifica(b && b.public === true && Number(b.file_size_limit) === 5242880 && JSON.stringify(b.allowed_mime_types) === JSON.stringify(['image/webp', 'image/png', 'image/jpeg']),
    `bucket pitch-deck-media: public, 5 MB, webp / png / jpeg (${JSON.stringify(b)})`);
  verifica((await unu(db, "select count(*)::int as n from pg_policies where schemaname = 'storage' and policyname like 'pitch_deck_media%'")).n === 0, 'fără politici de scriere pe pitch-deck-media');
  verifica((await unu(db, "select public from storage.buckets where id = 'investitori-kyc'")).public === false, 'bucket-ul investitori-kyc rămâne privat');

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
