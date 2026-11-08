// scripts/test-migrare-panou-investitor.js
// Test SQL pentru migrarea propusă a pasului 11-I1
// (docs/migrations-propuse/2026-11-08_panou_investitor.sql), pe un Postgres local
// (PGlite, în memorie). Nimic nu ajunge în Supabase.
//
// Verifică:
//   1. prima rulare: coloanele noi, constrângerea, indexul; rândurile existente
//      rămân neschimbate, fără completare retroactivă;
//   2. a doua rulare: fără erori și fără nicio schimbare;
//   3. constrângerea acceptă cele 6 stări și refuză altele;
//   4. un rând cu status necunoscut: migrarea se oprește, nimic schimbat;
//   5. verificarea de la final oprește tranzacția dacă lipsește ceva;
//   6. politicile RLS rămân aceleași.
//
// Cerințe (nu e dependență a proiectului): npm i --no-save @electric-sql/pglite
// Rulare: node scripts/test-migrare-panou-investitor.js

const fs = require('fs');
const path = require('path');
const MIGRARE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations-propuse', '2026-11-08_panou_investitor.sql'), 'utf8');
const U1 = '00000000-0000-0000-0000-000000000001';

const SCHEMA = `
create schema if not exists auth;
create table auth.users (id uuid primary key);
insert into auth.users values ('${U1}');
create function auth.uid() returns uuid language sql as $$ select '${U1}'::uuid $$;
create table public.investitori_portofoliu (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id),
  actiuni integer not null, valoare_investita numeric not null, roi_estimat numeric, exit_estimat_luni integer,
  status text default 'in_asteptare', created_at timestamptz default now());
alter table public.investitori_portofoliu enable row level security;
create policy "investitorul vede propriul portofoliu" on public.investitori_portofoliu for select using (auth.uid() = user_id);
create table public.investitori_exit (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id),
  tip text check (tip in ('buyback','piata_secundara')), numar_actiuni integer not null, suma_calculata numeric,
  status text default 'in_procesare', created_at timestamptz default now());
alter table public.investitori_exit enable row level security;
create policy "investitorul vede propriile cereri de exit" on public.investitori_exit for select using (auth.uid() = user_id);
`;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

async function baza(extra) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(SCHEMA + (extra || ''));
  return db;
}
const randuri = async (db, q) => (await db.query(q)).rows;
const instantanee = async (db) => JSON.stringify([
  await randuri(db, 'select * from public.investitori_portofoliu order by id'),
  await randuri(db, 'select * from public.investitori_exit order by id'),
  await randuri(db, "select column_name from information_schema.columns where table_schema='public' and table_name like 'investitori_%' order by table_name, column_name"),
  await randuri(db, "select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.investitori_exit'::regclass order by conname"),
  await randuri(db, "select indexname, indexdef from pg_indexes where tablename='investitori_exit' order by indexname"),
  await randuri(db, "select tablename, policyname, cmd, qual from pg_policies order by tablename, policyname"),
]);
async function esueaza(db, sql) {
  try { await db.exec(sql); return null; } catch (e) { try { await db.exec('rollback'); } catch (x) {} return e.message; }
}

(async () => {
  const INSERARI = `
    insert into public.investitori_portofoliu (user_id, actiuni, valoare_investita, roi_estimat, status) values ('${U1}', 10, 1000, 12.5, 'in_asteptare');
    insert into public.investitori_exit (user_id, tip, numar_actiuni, status) values ('${U1}', 'buyback', 5, 'in_procesare');`;
  {
    const db = await baza(INSERARI);
    const politiciInainte = JSON.stringify(await randuri(db, 'select tablename, policyname, cmd, qual from pg_policies order by 1, 2'));
    await db.exec(MIGRARE);
    const col = (await randuri(db, "select table_name t, column_name c, data_type d from information_schema.columns where table_schema='public' and column_name in ('aprobat_la','aprobat_de','actualizat_la','anulat_la') order by 1, 2")).map((r) => `${r.t}.${r.c}:${r.d}`);
    verifica(col.join() === 'investitori_exit.actualizat_la:timestamp with time zone,investitori_exit.anulat_la:timestamp with time zone,investitori_portofoliu.aprobat_de:uuid,investitori_portofoliu.aprobat_la:timestamp with time zone', `coloanele: ${col}`);
    const [p] = await randuri(db, 'select aprobat_la, aprobat_de, actiuni, status, roi_estimat from public.investitori_portofoliu');
    verifica(p.aprobat_la === null && p.aprobat_de === null && p.actiuni === 10 && p.status === 'in_asteptare' && Number(p.roi_estimat) === 12.5, `fără completare retroactivă: ${JSON.stringify(p)}`);
    const [e] = await randuri(db, 'select status, actualizat_la, anulat_la from public.investitori_exit');
    verifica(e.status === 'in_procesare' && e.actualizat_la === null && e.anulat_la === null, `rândul de exit: ${JSON.stringify(e)}`);
    verifica((await randuri(db, "select 1 from pg_indexes where indexname='investitori_exit_user_creat_idx' and indexdef ilike '%user_id, created_at desc%'")).length === 1, 'indexul (user_id, created_at desc) lipsește');
    verifica(JSON.stringify(await randuri(db, 'select tablename, policyname, cmd, qual from pg_policies order by 1, 2')) === politiciInainte, 'politicile RLS s-au schimbat');

    const inainte = await instantanee(db);
    await db.exec(MIGRARE);
    verifica(await instantanee(db) === inainte, 'a doua rulare a schimbat ceva');

    for (const st of ['in_procesare', 'aprobat', 'respins', 'platit', 'finalizat', 'anulat']) {
      verifica(await esueaza(db, `insert into public.investitori_exit (user_id, tip, numar_actiuni, status) values ('${U1}', 'buyback', 1, '${st}')`) === null, `starea ${st} e refuzată`);
    }
    verifica(/investitori_exit_status_check/.test(await esueaza(db, `insert into public.investitori_exit (user_id, tip, numar_actiuni, status) values ('${U1}', 'buyback', 1, 'altceva')`) || ''), 'starea necunoscută e acceptată');
  }
  {
    const db = await baza(`insert into public.investitori_exit (user_id, tip, numar_actiuni, status) values ('${U1}', 'buyback', 5, 'ciudat');`);
    const inainte = await instantanee(db);
    const m = await esueaza(db, MIGRARE);
    verifica(/status necunoscute: ciudat/.test(m || ''), `status necunoscut: ${m}`);
    verifica(await instantanee(db) === inainte, 'migrarea oprită a lăsat modificări');
  }
  {
    const db = await baza();
    const inainte = await instantanee(db);
    const rupta = MIGRARE.replace(/create index if not exists investitori_exit_user_creat_idx\s+on public\.investitori_exit \(user_id, created_at desc\);/, '');
    verifica(rupta !== MIGRARE, 'testul nu a putut scoate indexul');
    verifica(/lipsește indexul/.test(await esueaza(db, rupta) || ''), 'verificarea finală nu oprește la index lipsă');
    verifica(await instantanee(db) === inainte, 'verificarea eșuată a lăsat modificări');
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
