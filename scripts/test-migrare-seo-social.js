// scripts/test-migrare-seo-social.js
// Test SQL pentru migrarea propusă a pasului 11-S
// (docs/migrations-propuse/2026-10-23_seo_social_campanii.sql), pe un Postgres
// local (PGlite). Nimic nu ajunge în Supabase.
//
// Schema de pornire copiază live-ul (23 oct. 2026): seo_config cu 7 coloane,
// UNIQUE seo_config_page_path_key, RLS cu politica „seo_config citire publica”
// și toate drepturile pentru anon / authenticated; bucket-urile existente.
//
// Verifică:
//   1. migrarea rulează de două ori, fără erori, fără conținut inserat;
//   2. cheia unică (page_path, limba): RO și EN pe aceeași pagină, dublura refuzată;
//      limba doar ro / en; coloanele OG;
//   3. seo_campanii_social: valori implicite, stare / CTA / platforme din listă,
//      unicitate (page_path, limba, nume_campanie), media obiect;
//   4. RLS activ, fără politici, anon / authenticated fără acces;
//   5. bucket-urile: seo-og public 5 MB, campanii-media privat 50 MB;
//   6. limitele campanii_limite_* (secțiunea seo); o valoare schimbată rămâne.
// Rulare: node scripts/test-migrare-seo-social.js

const fs = require('fs');
const path = require('path');
const MIGRARE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations-propuse', '2026-10-23_seo_social_campanii.sql'), 'utf8');

const U = '61000000-0000-4000-8000-000000000001';
const SCHEMA = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table public.profiles (id uuid primary key references auth.users(id), roles text[]);
create table public.seo_config (
  id uuid primary key default gen_random_uuid(),
  page_path text not null unique,
  meta_title text, meta_description text, canonical_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.seo_config enable row level security;
create policy "seo_config citire publica" on public.seo_config for select using (true);
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
insert into storage.buckets values ('pitch-deck-media', 'pitch-deck-media', true, 5242880, array['image/webp']);
insert into storage.buckets values ('investitori-kyc', 'investitori-kyc', false, 5242880, array['image/jpeg']);
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
  verifica((await unu(db, 'select count(*)::int as n from public.seo_config')).n === 0, 'niciun rând SEO inserat');
  verifica((await unu(db, 'select count(*)::int as n from public.seo_campanii_social')).n === 0, 'nicio campanie inserată');

  // 2
  await db.exec(`insert into public.seo_config (page_path, meta_title) values ('/despre-noi', 'RO')`);
  verifica((await unu(db, "select limba from public.seo_config where page_path = '/despre-noi'")).limba === 'ro', 'limba implicită: ro');
  verifica(!(await esueaza(db, `insert into public.seo_config (page_path, limba, meta_title) values ('/despre-noi', 'en', 'EN')`)), 'aceeași pagină în EN: acceptată (cheia veche pe page_path a dispărut)');
  verifica(!!(await esueaza(db, `insert into public.seo_config (page_path, limba) values ('/despre-noi', 'en')`)), 'a doua suprascriere EN pe aceeași pagină: refuzată');
  verifica(!!(await esueaza(db, `insert into public.seo_config (page_path, limba) values ('/x', 'de')`)), "limba 'de' refuzată (doar ro / en)");
  verifica(!(await esueaza(db, `update public.seo_config set og_titlu = 't', og_descriere = 'd', og_imagine_url = 'https://x/og.jpg', og_imagine_alt = 'a', og_imagine_latime = 1200, og_imagine_inaltime = 630 where page_path = '/despre-noi'`)), 'coloanele OG există și se pot scrie');
  verifica(!!(await esueaza(db, `update public.seo_config set og_imagine_latime = 0`)), 'lățimea imaginii OG 0: refuzată');
  verifica(!!(await esueaza(db, `insert into public.seo_config (page_path, limba) values ('/despre-noi', 'ro') on conflict (page_path) do nothing`)) , 'on conflict (page_path) nu mai e posibil (cheia e acum pe pagină + limbă)');
  verifica(!(await esueaza(db, `insert into public.seo_config (page_path, limba, meta_title) values ('/despre-noi', 'ro', 'RO2') on conflict (page_path, limba) do update set meta_title = excluded.meta_title`)), 'upsert pe (page_path, limba): acceptat');

  // 3
  await db.exec(`insert into public.seo_campanii_social (page_path, nume_campanie) values ('/', 'Lansare')`);
  const c = await unu(db, "select limba, stare, platforme, media, created_at is not null as c, updated_at is not null as u from public.seo_campanii_social");
  verifica(c.limba === 'ro' && c.stare === 'ciorna' && Array.isArray(c.platforme) && !c.platforme.length && JSON.stringify(c.media) === '{}' && c.c && c.u,
    `campanie: implicit ro, ciornă, fără platforme, media {} (${JSON.stringify(c)})`);
  verifica(!(await esueaza(db, `insert into public.seo_campanii_social (page_path, limba, nume_campanie) values ('/', 'en', 'Lansare')`)), 'același nume în EN: acceptat');
  verifica(!!(await esueaza(db, `insert into public.seo_campanii_social (page_path, limba, nume_campanie) values ('/', 'ro', 'Lansare')`)), 'același nume, aceeași pagină și limbă: refuzat');
  verifica(!!(await esueaza(db, `insert into public.seo_campanii_social (page_path, nume_campanie) values ('/', '  ')`)), 'nume gol: refuzat');
  verifica(!!(await esueaza(db, `insert into public.seo_campanii_social (page_path, nume_campanie, stare) values ('/', 'a', 'publicata')`)), 'stare din afara listei: refuzată');
  verifica(!!(await esueaza(db, `insert into public.seo_campanii_social (page_path, nume_campanie, cta) values ('/', 'b', 'click_aici')`)), 'CTA din afara listei: refuzat');
  verifica(!(await esueaza(db, `insert into public.seo_campanii_social (page_path, nume_campanie, cta, platforme) values ('/', 'c', 'cere_oferta', array['facebook','tiktok','vertical_mobil'])`)), 'CTA și platforme din listă: acceptate');
  verifica(!!(await esueaza(db, `insert into public.seo_campanii_social (page_path, nume_campanie, platforme) values ('/', 'd', array['facebook','snapchat'])`)), 'platformă din afara listei: refuzată');
  verifica(!!(await esueaza(db, `insert into public.seo_campanii_social (page_path, nume_campanie, media) values ('/', 'e', '[]')`)), 'media care nu e obiect: refuzată');
  verifica(!!(await esueaza(db, `insert into public.seo_campanii_social (page_path, limba, nume_campanie) values ('/', 'fr', 'f')`)), "limba 'fr' refuzată");

  // 4
  for (const t of ['seo_config', 'seo_campanii_social']) {
    const r = await unu(db, `select relrowsecurity as r from pg_class where oid = 'public.${t}'::regclass`);
    const d = await unu(db, `select has_table_privilege('anon', 'public.${t}', 'SELECT') as a_s, has_table_privilege('anon', 'public.${t}', 'INSERT') as a_i,
      has_table_privilege('authenticated', 'public.${t}', 'SELECT') as u_s, has_table_privilege('authenticated', 'public.${t}', 'UPDATE') as u_u,
      has_table_privilege('service_role', 'public.${t}', 'SELECT') as s_s`);
    verifica(r.r === true, `RLS activ pe ${t}`);
    verifica(!d.a_s && !d.a_i && !d.u_s && !d.u_u && d.s_s, `${t}: anon / authenticated fără drepturi, service_role da (${JSON.stringify(d)})`);
    verifica((await unu(db, `select count(*)::int as n from pg_policies where tablename = '${t}'`)).n === 0, `nicio politică RLS pe ${t}`);
    await db.exec('set role anon');
    const e = await esueaza(db, `select * from public.${t}`);
    await db.exec('reset role');
    verifica(!!e && /permission denied/i.test(e.message), `anon: select direct pe ${t} → permission denied`);
  }

  // 5
  const og = await unu(db, "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'seo-og'");
  verifica(og && og.public === true && Number(og.file_size_limit) === 5242880 && JSON.stringify(og.allowed_mime_types) === JSON.stringify(['image/jpeg', 'image/png', 'image/webp']),
    `bucket seo-og: public, 5 MB, jpeg / png / webp (${JSON.stringify(og)})`);
  const cm = await unu(db, "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'campanii-media'");
  verifica(cm && cm.public === false && Number(cm.file_size_limit) === 52428800
    && JSON.stringify(cm.allowed_mime_types) === JSON.stringify(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']),
    `bucket campanii-media: privat, 50 MB, imagini + mp4 / quicktime / webm (${JSON.stringify(cm)})`);
  verifica((await unu(db, "select count(*)::int as n from pg_policies where schemaname = 'storage'")).n === 0, 'fără politici de scriere / citire pe storage.objects');
  verifica((await unu(db, "select public from storage.buckets where id = 'investitori-kyc'")).public === false, 'celelalte bucket-uri rămân neatinse');

  // 6
  const lim = (await db.query("select cheie, valoare, sectiune, editabil_de from public.backoffice_config where cheie like 'campanii_limite_%' order by cheie")).rows;
  verifica(lim.length === 4 && lim.every((l) => l.sectiune === 'seo' && l.editabil_de === 'superadmin'), `4 limite în secțiunea seo, editabile de superadmin (${lim.map((l) => l.cheie + '=' + l.valoare).join(', ')})`);
  const v = Object.fromEntries(lim.map((l) => [l.cheie, l.valoare]));
  verifica(v.campanii_limite_meta_titlu === '40' && v.campanii_limite_meta_text === '125' && v.campanii_limite_meta_descriere === '30' && v.campanii_limite_tiktok_text === '100', 'valorile implicite: 40 / 125 / 30 / 100');
  await db.exec("update public.backoffice_config set valoare = '60' where cheie = 'campanii_limite_meta_titlu'");
  const e3 = await esueaza(db, MIGRARE);
  verifica(!e3 && (await unu(db, "select valoare from public.backoffice_config where cheie = 'campanii_limite_meta_titlu'")).valoare === '60', 'a treia rulare păstrează limita schimbată din panou');
  verifica((await unu(db, "select count(*)::int as n from public.seo_config")).n === 2, 'a treia rulare păstrează rândurile SEO existente');

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
