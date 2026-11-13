// scripts/test-migrare-masurare-palnie.js
// Test SQL pentru migrarea propusă a pasului 11-A1
// (docs/migrations-propuse/2026-11-13_masurare_palnie.sql), pe un Postgres local
// (PGlite, în memorie). Nimic nu ajunge în Supabase.
//
// Verifică:
//   1. prima rulare: profiles.sursa_utm, tabelul palnie_evenimente (RLS fără
//      politici, unicitatea), declanșatorul; conturile existente își primesc
//      sursa din metadate, curățată (doar cheile cunoscute, cel mult 200 de caractere);
//   2. un cont nou primește sursa din metadate; fără sursă rămâne null;
//      emailul sau alte chei din metadate nu ajung în sursa_utm;
//   3. a doua rulare: fără erori și fără nicio schimbare;
//   4. constrângerile refuză evenimente și pași necunoscuți;
//   5. verificarea de la final oprește tranzacția dacă lipsește ceva.
//
// Cerințe (nu e dependență a proiectului): npm i --no-save @electric-sql/pglite
// Rulare: node scripts/test-migrare-masurare-palnie.js

const fs = require('fs');
const path = require('path');
const MIGRARE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations-propuse', '2026-11-13_masurare_palnie.sql'), 'utf8');
const U1 = '00000000-0000-0000-0000-000000000001';
const U2 = '00000000-0000-0000-0000-000000000002';
const U3 = '00000000-0000-0000-0000-000000000003';
const U4 = '00000000-0000-0000-0000-000000000004';

const LUNG = 'x'.repeat(300);
const SCHEMA = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create table public.profiles (id uuid primary key references auth.users(id), email text, rol_solicitat text, created_at timestamptz default now());
grant all on public.profiles to anon, authenticated;
insert into auth.users values
  ('${U1}', 'a@exemplu.ro', '{"nume":"Ana","sursa":{"utm_source":"facebook","utm_campaign":"parteneri_nov","fbclid":"AbC_1","email":"a@exemplu.ro","utm_term":"${LUNG}"}}'),
  ('${U2}', 'b@exemplu.ro', '{"nume":"Bogdan"}');
insert into public.profiles (id, email) values ('${U1}', 'a@exemplu.ro'), ('${U2}', 'b@exemplu.ro');
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
  await randuri(db, 'select to_jsonb(p) j from public.profiles p order by id'),
  await randuri(db, "select column_name, data_type from information_schema.columns where table_schema='public' and table_name in ('profiles','palnie_evenimente') order by table_name, column_name"),
  await randuri(db, "select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid = to_regclass('public.palnie_evenimente') order by conname"),
  await randuri(db, "select indexname, indexdef from pg_indexes where tablename='palnie_evenimente' order by indexname"),
  await randuri(db, "select tgname from pg_trigger where not tgisinternal order by tgname"),
  await randuri(db, 'select tablename, policyname from pg_policies order by 1, 2'),
]);
async function esueaza(db, sql) {
  try { await db.exec(sql); return null; } catch (e) { try { await db.exec('rollback'); } catch (x) {} return e.message; }
}

(async () => {
  {
    const db = await baza();
    await db.exec(MIGRARE);

    const col = await randuri(db, "select data_type from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='sursa_utm'");
    verifica(col.length === 1 && col[0].data_type === 'jsonb', 'profiles.sursa_utm (jsonb) lipsește');

    const [p1] = await randuri(db, `select sursa_utm from public.profiles where id='${U1}'`);
    const s1 = p1.sursa_utm || {};
    verifica(s1.utm_source === 'facebook' && s1.utm_campaign === 'parteneri_nov' && s1.fbclid === 'AbC_1', `sursa contului existent: ${JSON.stringify(s1)}`);
    verifica(!('email' in s1), 'emailul din metadate a ajuns în sursa_utm');
    verifica(s1.utm_term && s1.utm_term.length === 200, 'valorile lungi nu sunt tăiate la 200 de caractere');
    const [p2] = await randuri(db, `select sursa_utm from public.profiles where id='${U2}'`);
    verifica(p2.sursa_utm === null, 'contul fără sursă a primit o sursă');

    // Cont nou: declanșatorul copiază sursa din metadate.
    await db.exec(`insert into auth.users values ('${U3}', 'c@exemplu.ro', '{"sursa":{"utm_source":"tiktok","utm_medium":"paid","telefon":"0722123456"}}');
      insert into public.profiles (id, email) values ('${U3}', 'c@exemplu.ro');
      insert into auth.users values ('${U4}', 'd@exemplu.ro', '{"sursa":"text"}');
      insert into public.profiles (id, email) values ('${U4}', 'd@exemplu.ro');`);
    const [p3] = await randuri(db, `select sursa_utm from public.profiles where id='${U3}'`);
    verifica(JSON.stringify(p3.sursa_utm) === JSON.stringify({ utm_medium: 'paid', utm_source: 'tiktok' }), `contul nou: ${JSON.stringify(p3.sursa_utm)}`);
    const [p4] = await randuri(db, `select sursa_utm from public.profiles where id='${U4}'`);
    verifica(p4.sursa_utm === null, 'o sursă care nu e obiect a fost acceptată');

    // Tabelul pâlniei.
    verifica((await esueaza(db, `insert into public.palnie_evenimente (user_id, eveniment, pas) values ('${U1}', 'partner_step_completed', 'company_details')`)) === null, 'pasul company_details e refuzat');
    verifica((await esueaza(db, `insert into public.palnie_evenimente (user_id, eveniment) values ('${U1}', 'email_confirmed')`)) === null, 'email_confirmed e refuzat');
    verifica(/palnie_evenimente_unic_idx|duplicate/.test(await esueaza(db, `insert into public.palnie_evenimente (user_id, eveniment, pas) values ('${U1}', 'partner_step_completed', 'company_details')`) || ''), 'același pas de două ori e acceptat');
    verifica(/eveniment_check/.test(await esueaza(db, `insert into public.palnie_evenimente (user_id, eveniment) values ('${U1}', 'altceva')`) || ''), 'un eveniment necunoscut e acceptat');
    verifica(/pas_check/.test(await esueaza(db, `insert into public.palnie_evenimente (user_id, eveniment, pas) values ('${U1}', 'partner_step_completed', 'firma')`) || ''), 'un pas necunoscut e acceptat');
    const [rls] = await randuri(db, "select relrowsecurity from pg_class where oid='public.palnie_evenimente'::regclass");
    verifica(rls.relrowsecurity === true, 'RLS nu e activ');
    const drepturi = await randuri(db, "select grantee from information_schema.role_table_grants where table_name='palnie_evenimente' and grantee in ('anon','authenticated')");
    verifica(drepturi.length === 0, `anon / authenticated au drepturi: ${JSON.stringify(drepturi)}`);
    const fn = await randuri(db, "select proname, prosecdef, proconfig from pg_proc where proname in ('profiles_sursa_utm_din_metadata','sursa_utm_curata') order by 1");
    verifica(fn.length === 2 && fn.every((f) => (f.proconfig || []).some((c) => /^search_path=/.test(c))), 'funcțiile nu au search_path fix');
    const exec = await randuri(db, "select has_function_privilege('anon', 'public.profiles_sursa_utm_din_metadata()', 'execute') a, has_function_privilege('anon', 'public.sursa_utm_curata(jsonb)', 'execute') b");
    verifica(exec[0].a === false && exec[0].b === false, 'anon poate executa funcțiile noi');

    // A doua rulare.
    const inainte = await instantanee(db);
    await db.exec(MIGRARE);
    verifica(await instantanee(db) === inainte, 'a doua rulare a schimbat ceva');
    verifica((await randuri(db, 'select count(*)::int n from public.palnie_evenimente'))[0].n === 2, 'a doua rulare a atins rândurile pâlniei');
  }
  {
    const db = await baza();
    const inainte = await instantanee(db);
    const rupta = MIGRARE.replace(/create trigger profiles_sursa_utm[\s\S]*?execute function public\.profiles_sursa_utm_din_metadata\(\);/, '');
    verifica(rupta !== MIGRARE, 'testul nu a putut scoate declanșatorul');
    verifica(/lipsește declanșatorul/.test(await esueaza(db, rupta) || ''), 'verificarea finală nu oprește la declanșator lipsă');
    verifica(await instantanee(db) === inainte, 'verificarea eșuată a lăsat modificări');
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
