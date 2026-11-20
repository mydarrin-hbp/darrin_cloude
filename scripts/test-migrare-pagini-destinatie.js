// scripts/test-migrare-pagini-destinatie.js
// Pasul 12-L1 (19 nov. 2026): migrarea propusă
// docs/migrations-propuse/2026-11-19_pagini-destinatie.sql, pe un Postgres local
// (PGlite). Nimic nu ajunge în Supabase.
//
// Verifică:
//   1. migrarea rulează de două ori, fără erori, fără conținut inserat;
//   2. constrângerile: pagina din listă, numele variantei, limba, starea, limitele
//      de caractere (40 / 60 / 140 / 60 / 24 / 60 / 140), un rând publicat complet,
//      o singură ciornă și o singură publicare pe pagină + variantă + limbă;
//   3. RLS: activ, fără politici; anon / authenticated nu citesc nimic (nici
//      ciorne, nici publicate) și nu pot executa funcțiile; service_role da;
//   4. landing_publica: fără EN → refuzată (LANDING_LIPSA_LIMBA); EN incomplet →
//      LANDING_INCOMPLET_EN; RO + EN complete → versiunea 1; a doua publicare →
//      versiunea 2, iar versiunea 1 trece în istoric (ambele limbi);
//   5. landing_revino: versiunea 1 se publică din nou (versiunea 3), ciorna o
//      primește și ea; o versiune inexistentă → LANDING_VERSIUNE_LIPSA;
//   6. funcțiile: security invoker, search_path fix; bucket-ul seo-og existent
//      rămâne neschimbat.
// Rulare: node scripts/test-migrare-pagini-destinatie.js

const fs = require('fs');
const path = require('path');
const MIGRARE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations-propuse', '2026-11-19_pagini-destinatie.sql'), 'utf8');

const U = '62000000-0000-4000-8000-000000000001';
const SCHEMA = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls; -- ca în Supabase
create schema auth;
create table auth.users (id uuid primary key);
create table public.profiles (id uuid primary key references auth.users(id), roles text[]);
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
insert into storage.buckets values ('seo-og', 'seo-og', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']);
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema storage to service_role;
grant select on storage.buckets to service_role;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
insert into auth.users values ('${U}');
insert into public.profiles values ('${U}', array['superadmin']);
`;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) { ok++; console.log('  ✓ ' + m); } else { esec++; console.log('  ✗ ' + m); } }
async function esueaza(db, sql) { try { await db.exec(sql); return null; } catch (e) { return e; } }
const unu = async (db, sql) => (await db.query(sql)).rows[0];

const T = { eticheta: 'Parteneri de servicii', titlu: 'Instalator? Primește comenzi în zona ta.', subtitlu: 'Clienții comandă și plătesc în platformă.',
  beneficiu_1: 'Comenzi alocate automat', beneficiu_2: 'Plata e păstrată ca garanție', beneficiu_3: '100% din manoperă', buton: 'Devino partener', sub_buton: 'Gratuit' };
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
function ciorna(limba, x = {}, varianta = 'instalatori') {
  const r = Object.assign({}, T, x);
  const cols = Object.keys(r);
  return `insert into public.landing_continut (pagina, varianta, limba, stare, ${cols.join(', ')})
    values ('/parteneri/servicii', ${q(varianta)}, ${q(limba)}, 'ciorna', ${cols.map((k) => (r[k] == null ? 'null' : q(r[k]))).join(', ')})
    on conflict (pagina, varianta, limba, stare) do update set ${cols.map((k) => `${k} = excluded.${k}`).join(', ')}`;
}

(async () => {
  let PGlite;
  try { ({ PGlite } = require('@electric-sql/pglite')); }
  catch (e) { console.log('PGlite lipsește: npm i --no-save @electric-sql/pglite'); process.exit(1); }
  const db = new PGlite();
  await db.exec(SCHEMA);

  console.log('1. Rularea');
  const e1 = await esueaza(db, MIGRARE);
  verifica(!e1, 'prima rulare: fără erori' + (e1 ? ' — ' + e1.message : ''));
  const e2 = await esueaza(db, MIGRARE);
  verifica(!e2, 'a doua rulare: fără erori' + (e2 ? ' — ' + e2.message : ''));
  verifica((await unu(db, 'select count(*)::int as n from public.landing_continut')).n === 0, 'niciun conținut inserat');

  console.log('2. Constrângerile');
  verifica(!(await esueaza(db, ciorna('ro'))), 'ciornă RO completă: acceptată');
  verifica(!!(await esueaza(db, ciorna('ro').replace("'/parteneri/servicii'", "'/despre'"))), 'pagina din afara listei: refuzată');
  verifica(!!(await esueaza(db, ciorna('ro', {}, 'Instalatori Iarna'))), 'numele variantei cu majuscule / spații: refuzat');
  verifica(!!(await esueaza(db, ciorna('de'))), "limba 'de': refuzată");
  const lungimi = { eticheta: 41, titlu: 61, subtitlu: 141, beneficiu_1: 61, beneficiu_2: 61, beneficiu_3: 61, buton: 25, sub_buton: 61, imagine_alt: 141 };
  for (const [k, n] of Object.entries(lungimi)) {
    verifica(!!(await esueaza(db, ciorna('en', { [k]: 'x'.repeat(n) }))), `${k} cu ${n} caractere: refuzat`);
    verifica(!(await esueaza(db, ciorna('en', { [k]: 'x'.repeat(n - 1) }))), `${k} cu ${n - 1} caractere: acceptat`);
  }
  await db.exec(ciorna('en', {}));
  verifica(!!(await esueaza(db, ciorna('ro').split('\n    on conflict')[0])), 'a doua ciornă RO pe aceeași variantă: refuzată (cheia unică)');
  verifica(!!(await esueaza(db, `insert into public.landing_continut (pagina, varianta, limba, stare, titlu) values ('/parteneri/servicii', 'x', 'ro', 'publicat', 'T')`)), 'rând publicat incomplet: refuzat');
  verifica(!!(await esueaza(db, ciorna('ro', { imagine_url: 'http://x/a.webp' }))), 'imaginea fără https: refuzată');
  verifica(!!(await esueaza(db, ciorna('ro', { imagine_url: 'https://x/a.webp', imagine_latime: 2000, imagine_inaltime: 900 }))), 'imaginea peste 1600 px: refuzată');
  verifica(!!(await esueaza(db, ciorna('ro', { profesie: 'Instalator!' }))), 'profesia invalidă: refuzată');

  console.log('3. RLS și drepturi');
  for (const t of ['landing_continut', 'landing_continut_istoric']) {
    const d = await unu(db, `select (select relrowsecurity from pg_class where oid = 'public.${t}'::regclass) as rls,
      has_table_privilege('anon', 'public.${t}', 'SELECT') as a_s, has_table_privilege('anon', 'public.${t}', 'INSERT') as a_i,
      has_table_privilege('authenticated', 'public.${t}', 'SELECT') as u_s, has_table_privilege('authenticated', 'public.${t}', 'UPDATE') as u_u,
      has_table_privilege('service_role', 'public.${t}', 'SELECT') as s_s,
      (select count(*)::int from pg_policies where tablename = '${t}') as pol`);
    verifica(d.rls === true && !d.a_s && !d.a_i && !d.u_s && !d.u_u && d.s_s && d.pol === 0, `${t}: RLS activ, fără politici, anon / authenticated fără drepturi, service_role da (${JSON.stringify(d)})`);
  }
  for (const rol of ['anon', 'authenticated']) {
    await db.exec(`set role ${rol}`);
    const e = await esueaza(db, "select * from public.landing_continut where stare = 'ciorna'");
    const f = await esueaza(db, `select public.landing_publica('/parteneri/servicii', 'instalatori', '${U}')`);
    await db.exec('reset role');
    verifica(!!e && /permission denied/i.test(e.message), `${rol}: citirea ciornelor → permission denied`);
    verifica(!!f && /permission denied/i.test(f.message), `${rol}: landing_publica → permission denied`);
  }

  console.log('4. Publicarea');
  await db.exec("delete from public.landing_continut where limba = 'en'");
  let e = await esueaza(db, `select public.landing_publica('/parteneri/servicii', 'instalatori', '${U}')`);
  verifica(!!e && /LANDING_LIPSA_LIMBA/.test(e.message), 'fără EN: refuzată (LANDING_LIPSA_LIMBA)');
  await db.exec(ciorna('en', { buton: '  ' }));
  e = await esueaza(db, `select public.landing_publica('/parteneri/servicii', 'instalatori', '${U}')`);
  verifica(!!e && /LANDING_INCOMPLET_EN/.test(e.message), 'EN fără textul butonului: refuzată (LANDING_INCOMPLET_EN)');
  await db.exec(ciorna('ro', { imagine_url: 'https://x.supabase.co/a.webp', imagine_alt: null, imagine_latime: 1600, imagine_inaltime: 900 }));
  await db.exec(ciorna('en', { buton: 'Become a partner' }));
  e = await esueaza(db, `select public.landing_publica('/parteneri/servicii', 'instalatori', '${U}')`);
  verifica(!!e && /LANDING_INCOMPLET_RO/.test(e.message), 'imaginea fără text alternativ RO: refuzată (LANDING_INCOMPLET_RO)');
  await db.exec(ciorna('ro', { imagine_url: 'https://x.supabase.co/a.webp', imagine_alt: 'Instalator la lucru', imagine_latime: 1600, imagine_inaltime: 900 }));
  await db.exec(ciorna('en', { buton: 'Become a partner', imagine_url: 'https://x.supabase.co/a.webp', imagine_alt: 'Plumber at work', imagine_latime: 1600, imagine_inaltime: 900 }));
  await db.exec('set role service_role');
  const v1 = await unu(db, `select public.landing_publica('/parteneri/servicii', 'instalatori', '${U}') as v`);
  await db.exec('reset role');
  verifica(v1.v === 1, 'RO + EN complete: publicată, versiunea 1 (de service_role)');
  const pub = (await db.query("select limba, versiune, titlu from public.landing_continut where stare = 'publicat' order by limba")).rows;
  verifica(pub.length === 2 && pub.every((r) => r.versiune === 1), 'două rânduri publicate (RO, EN), versiunea 1');
  await db.exec(ciorna('ro', { titlu: 'Titlul nou', imagine_url: 'https://x.supabase.co/a.webp', imagine_alt: 'Instalator la lucru', imagine_latime: 1600, imagine_inaltime: 900 }));
  verifica((await unu(db, "select titlu from public.landing_continut where stare = 'publicat' and limba = 'ro'")).titlu === T.titlu, 'ciorna salvată nu schimbă varianta publicată');
  const v2 = await unu(db, `select public.landing_publica('/parteneri/servicii', 'instalatori', '${U}') as v`);
  verifica(v2.v === 2, 'a doua publicare: versiunea 2');
  const ist = (await db.query("select limba, versiune, titlu from public.landing_continut_istoric order by limba")).rows;
  verifica(ist.length === 2 && ist.every((r) => r.versiune === 1) && ist.find((r) => r.limba === 'ro').titlu === T.titlu, 'versiunea 1 (RO + EN) e în istoric');
  verifica((await unu(db, "select titlu from public.landing_continut where stare = 'publicat' and limba = 'ro'")).titlu === 'Titlul nou', 'publicat: titlul nou');

  console.log('5. Revenirea');
  const v3 = await unu(db, `select public.landing_revino('/parteneri/servicii', 'instalatori', 1, '${U}') as v`);
  verifica(v3.v === 3, 'revenirea la versiunea 1: publicată ca versiunea 3');
  const dupa = (await db.query("select stare, limba, titlu, versiune from public.landing_continut where limba = 'ro' order by stare")).rows;
  verifica(dupa.length === 2 && dupa.every((r) => r.titlu === T.titlu && r.versiune === 3), 'publicat și ciorna au conținutul versiunii 1 (versiunea 3)');
  verifica((await unu(db, 'select count(*)::int as n from public.landing_continut_istoric where versiune = 2')).n === 2, 'versiunea 2 a trecut în istoric');
  e = await esueaza(db, `select public.landing_revino('/parteneri/servicii', 'instalatori', 99, '${U}')`);
  verifica(!!e && /LANDING_VERSIUNE_LIPSA/.test(e.message), 'versiune inexistentă: LANDING_VERSIUNE_LIPSA');

  console.log('6. Funcțiile și bucket-ul');
  const f = (await db.query("select proname, prosecdef, array_to_string(proconfig, ',') as cfg from pg_proc where proname in ('landing_publica', 'landing_revino') order by proname")).rows;
  verifica(f.length === 2 && f.every((x) => x.prosecdef === false && /search_path=/.test(x.cfg || '')), `security invoker, search_path fix (${JSON.stringify(f)})`);
  const og = await unu(db, "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'seo-og'");
  verifica(og.public === true && Number(og.file_size_limit) === 5242880, 'seo-og existent: neschimbat (public, 5 MB)');

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
