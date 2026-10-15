// scripts/test-migrare-ruta-incadrare.js
// Teste SQL pentru migrările propuse ale pasului 8 / 8b, pe un Postgres local
// (PGlite: Postgres compilat în WebAssembly, în memorie). Nimic nu ajunge în
// Supabase.
//
// Schema de pornire e o copie minimă a celei reale (15 oct. 2026): tabelele
// atinse, constrângerile lor și politicile RLS de azi pe catalog_servicii /
// catalog_niveluri / catalog_preturi (inclusiv „catalog citit public”,
// using (true)), plus rolul `anon`, ca în Supabase.
//
// Verifică:
//   1. 2026-10-15_ruta_incadrare.sql fără 2026-10-10_traduceri_catalog.sql →
//      se oprește cu „Aplică întâi 2026-10-10_traduceri_catalog.sql”, fără efect;
//   2. ordinea 2026-10-10, apoi 2026-10-15, fiecare rulată de două ori;
//   3. RLS cu rolul anon: ciorna nu se citește, serviciul publicat da;
//      nivelurile și prețurile ciornei nu se citesc; politicile de scriere
//      directă din client nu mai există;
//   4. constrângerile noi (ciornă publică, capitol în admin_permissions,
//      discount pe curier, rețete propuse).
//
// Cerințe (nu e dependență a proiectului):
//   npm i --no-save @electric-sql/pglite
// Rulare: node scripts/test-migrare-ruta-incadrare.js

const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'docs', 'migrations-propuse');
const TRADUCERI = fs.readFileSync(path.join(DIR, '2026-10-10_traduceri_catalog.sql'), 'utf8');
const RUTA = fs.readFileSync(path.join(DIR, '2026-10-15_ruta_incadrare.sql'), 'utf8');

const SCHEMA = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table public.profiles (id uuid primary key, role text, roles text[] default '{}');
create table public.nace_reference (cod text primary key, nivel text not null, denumire_ro text not null, cod_parinte text, revizie text not null default '2.1', denumire_en text);
create table public.uniclass_codes (code varchar primary key, table_prefix varchar, title_ro text not null, title_en text, is_active boolean default true);
create table public.categorii (id uuid primary key default gen_random_uuid(), title text not null, slug text not null unique, icon_name text not null, description text not null,
  category_type text not null check (category_type in ('servicii','materiale','inchiriere')), display_order int not null default 0, creat_la timestamptz not null default now(),
  parent_id uuid references public.categorii(id), nace_ref text references public.nace_reference(cod), uniclass_ref text references public.uniclass_codes(code));
create table public.competente_esco (cod_esco text primary key, denumire text not null, domeniu text not null, nace_code text, denumire_en text);
create table public.catalog_servicii (id uuid primary key default gen_random_uuid(), id_serviciu text not null unique, cod_esco text references public.competente_esco(cod_esco) on update cascade,
  cod_uniclass text, categorie text not null, domeniu text not null, titlu text not null, nace text, status_public boolean default true, categorie_id uuid references public.categorii(id));
create table public.catalog_niveluri (id uuid primary key default gen_random_uuid(), serviciu_id uuid references public.catalog_servicii(id) on delete cascade, nivel text not null,
  nivel_complexitate int not null default 1, norma_timp numeric not null default 1, label text, descriere text);
create table public.catalog_preturi (id uuid primary key default gen_random_uuid(), nivel_id uuid references public.catalog_niveluri(id) on delete cascade, tara_cod text not null,
  moneda text not null, pret numeric not null, activ boolean default true);
create table public.admin_permissions (id uuid primary key default gen_random_uuid(), admin_id uuid references public.profiles(id) on delete cascade, sectiune text not null,
  poate_scrie boolean default false, acordat_de uuid references public.profiles(id), created_at timestamptz default now(), tara_cod text, sectiune_specializata text,
  constraint admin_permissions_admin_id_sectiune_key unique (admin_id, sectiune),
  constraint admin_permissions_sectiune_specializata_check check ((sectiune_specializata = any (array['financiar','fiscal','catalog','deviz'])) or sectiune_specializata is null));
create table public.devize_indicatoare (indicator_id varchar primary key, denumire_indicator varchar not null, tip_lucrari text, nace_cod text, esco_cod_principal text, uniclass_ac_code text);
create table public.devize_articole (articol_id serial primary key, indicator_id varchar references public.devize_indicatoare(indicator_id), simbol varchar not null, varianta int default 1,
  denumire_articol text not null, unitate_masura varchar not null, catalog_nivel_id uuid references public.catalog_niveluri(id), constraint uq_articol unique (indicator_id, simbol, varianta));
create table public.devize_resurse (resursa_id serial primary key, tip_resursa varchar not null, cod_resursa varchar not null unique, denumire_resursa text not null, unitate_masura varchar not null);

-- RLS și politicile de azi (live, 15 oct. 2026)
alter table public.catalog_servicii enable row level security;
alter table public.catalog_niveluri enable row level security;
alter table public.catalog_preturi enable row level security;
create policy "catalog citit public" on public.catalog_servicii for select using (true);
create policy "catalog vizibil public" on public.catalog_servicii for select using (status_public = true);
create policy "admin gestioneaza catalog servicii" on public.catalog_servicii for all using (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'superadmin')
  or exists (select 1 from public.admin_permissions where admin_permissions.admin_id = auth.uid() and admin_permissions.sectiune = 'catalog' and admin_permissions.poate_scrie = true));
create policy "catalog scris de admini" on public.catalog_servicii for insert with check (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','superadmin'])));
create policy "catalog update de admini" on public.catalog_servicii for update using (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','superadmin'])));
create policy "niveluri citite public" on public.catalog_niveluri for select using (true);
create policy "niveluri vizibile public" on public.catalog_niveluri for select using (true);
create policy "admin gestioneaza catalog niveluri" on public.catalog_niveluri for all using (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'superadmin'));
create policy "preturi citite public" on public.catalog_preturi for select using (true);
create policy "admin scrie preturi" on public.catalog_preturi for all using (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = any (array['admin','superadmin'])));

grant select on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant select on tables to anon, authenticated;

insert into public.profiles (id, roles) values ('00000000-0000-0000-0000-000000000001', '{admin}');
insert into public.nace_reference (cod, nivel, denumire_ro) values ('F','sectiune','F'), ('43','diviziune','43'), ('43.2','clasa','43.2'), ('43.22','clasa','43.22');
insert into public.competente_esco (cod_esco, denumire, domeniu) values ('7127.1','a','d'), ('7411','b','d'), ('713701','c','d'), ('COR-712902','e','d'), ('7411.1.4','g','d');
insert into public.catalog_servicii (id, id_serviciu, categorie, domeniu, titlu, status_public) values
  ('10000000-0000-0000-0000-000000000001', 'publicat', 'servicii', 'D', 'Serviciu publicat', true),
  ('10000000-0000-0000-0000-000000000002', 'ascuns', 'servicii', 'D', 'Serviciu ascuns', false);
insert into public.catalog_niveluri (id, serviciu_id, nivel) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Bronze'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Bronze');
insert into public.catalog_preturi (nivel_id, tara_cod, moneda, pret) values
  ('20000000-0000-0000-0000-000000000001', 'RO', 'RON', 100), ('20000000-0000-0000-0000-000000000002', 'RO', 'RON', 200);
`;

let trecute = 0;
const picate = [];
function verifica(nume, conditie, detaliu) {
  if (conditie) { trecute++; console.log(`  ✓ ${nume}`); } else { picate.push(nume); console.log(`  ✗ ${nume}${detaliu ? ' — ' + detaliu : ''}`); }
}

async function main() {
  let PGlite;
  try { ({ PGlite } = require('@electric-sql/pglite')); } catch (e) {
    console.error('Lipsește PGlite: npm i --no-save @electric-sql/pglite');
    process.exit(2);
  }
  const db = new PGlite();
  await db.exec(SCHEMA);
  const q = async (sql) => (await db.query(sql)).rows;
  const caAnon = async (sql) => { await db.exec('set role anon'); try { return await q(sql); } finally { await db.exec('reset role'); } };
  const ruleaza = async (sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec('rollback'); } catch (_) { /* nicio tranzacție deschisă */ } return e.message; } };
  const incearca = async (sql) => ruleaza(sql);

  console.log('\n1. Dependența de 2026-10-10_traduceri_catalog.sql');
  const err = await ruleaza(RUTA);
  verifica('fără traduceri: migrarea se oprește cu „Aplică întâi 2026-10-10_traduceri_catalog.sql”', /Aplică întâi 2026-10-10_traduceri_catalog\.sql/.test(err || ''), err || 'a trecut');
  verifica('și nu lasă nimic în urmă (meniu_capitole nu există)', !(await q("select to_regclass('public.meniu_capitole') r"))[0].r);
  console.log(`    înainte de migrare, anon citește serviciul ascuns: ${(await caAnon("select count(*)::int n from catalog_servicii where not status_public"))[0].n} rând(uri)`);

  console.log('\n2. Ordinea: 2026-10-10, apoi 2026-10-15, fiecare de două ori');
  for (const [nume, sql] of [['2026-10-10_traduceri_catalog.sql', TRADUCERI], ['2026-10-15_ruta_incadrare.sql', RUTA]]) {
    for (const k of [1, 2]) {
      const e = await ruleaza(sql);
      verifica(`${nume}, rularea ${k}`, !e, e);
    }
  }

  console.log('\n3. RLS cu rolul anon');
  await db.exec(`insert into catalog_servicii (id, id_serviciu, categorie, domeniu, titlu, status_public, stare) values ('10000000-0000-0000-0000-000000000003', 'ciorna', 'servicii', 'D', 'Ciornă', false, 'ciorna');
    insert into catalog_niveluri (id, serviciu_id, nivel) values ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'Bronze');
    insert into catalog_preturi (nivel_id, tara_cod, moneda, pret) values ('20000000-0000-0000-0000-000000000003', 'RO', 'RON', 300);`);
  const servicii = (await caAnon('select id_serviciu from catalog_servicii order by 1')).map((r) => r.id_serviciu);
  console.log(`    anon vede serviciile: ${servicii.join(', ')}`);
  verifica('serviciul publicat se citește cu anon', servicii.includes('publicat'));
  verifica('ciorna nu se citește cu anon', !servicii.includes('ciorna'));
  verifica('serviciul ascuns nu se citește cu anon', !servicii.includes('ascuns'));
  const niveluri = (await caAnon('select serviciu_id from catalog_niveluri')).map((r) => r.serviciu_id);
  verifica('nivelul serviciului publicat se citește, al ciornei nu', niveluri.includes('10000000-0000-0000-0000-000000000001') && !niveluri.includes('10000000-0000-0000-0000-000000000003') && niveluri.length === 1, JSON.stringify(niveluri));
  const preturi = (await caAnon('select pret::int p from catalog_preturi order by 1')).map((r) => r.p);
  verifica('prețul serviciului publicat se citește (100), al ciornei (300) și al celui ascuns (200) nu', preturi.length === 1 && preturi[0] === 100, JSON.stringify(preturi));
  const politici = await q("select c.relname, p.polname, p.polcmd from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('catalog_servicii','catalog_niveluri','catalog_preturi') order by 1, 2");
  console.log(`    politici rămase: ${politici.map((p) => `${p.relname}: ${p.polname} [${p.polcmd}]`).join(' | ')}`);
  verifica('nicio politică de scriere directă din client', politici.every((p) => p.polcmd === 'r'));
  verifica('nicio politică using (true) pe cele trei tabele', !(await q("select 1 from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('catalog_servicii','catalog_niveluri','catalog_preturi') and pg_get_expr(p.polqual, p.polrelid) = 'true'")).length);
  const scriereAnon = await (async () => { await db.exec('set role anon'); try { await db.exec("update catalog_servicii set titlu = 'x'"); return null; } catch (e) { return e.message; } finally { await db.exec('reset role'); } })();
  verifica('anon nu poate scrie în catalog_servicii', !!scriereAnon || (await q("select count(*)::int n from catalog_servicii where titlu = 'x'"))[0].n === 0);

  console.log('\n4. Constrângeri');
  verifica('ciornă publică (status_public = true, stare = ciorna) → respinsă', !!(await incearca("insert into catalog_servicii (id_serviciu, categorie, domeniu, titlu, status_public) values ('x1','servicii','D','X',true)")));
  verifica('serviciile publice de dinainte au stare = publicat', (await q("select stare from catalog_servicii where id_serviciu = 'publicat'"))[0].stare === 'publicat');
  verifica('admin_permissions: catalog_servicii / F → acceptat', !(await incearca("insert into admin_permissions (admin_id, sectiune, poate_scrie, sectiune_specializata) values ('00000000-0000-0000-0000-000000000001','catalog_servicii',true,'F')")));
  verifica('admin_permissions: valoare invalidă → respinsă', !!(await incearca("update admin_permissions set sectiune_specializata = 'f; drop' where sectiune = 'catalog_servicii'")));
  verifica('meniu_capitole: discount pe curier → respins', !!(await incearca("update meniu_capitole set discount_permis = true where cod = 'H'")));
  verifica('competente_esco.tip_cod: 7127.1 esco, 7411 isco, 713701 cor, COR-712902 cor', JSON.stringify((await q("select tip_cod from competente_esco where cod_esco in ('7127.1','7411','713701','COR-712902') order by cod_esco")).map((r) => r.tip_cod)) === JSON.stringify(['esco', 'cor', 'isco', 'cor']));
  await db.exec("insert into retete_propuse (catalog_serviciu_id) values ('10000000-0000-0000-0000-000000000003')");
  verifica('retete_propuse: a doua rețetă deschisă pe același serviciu → respinsă', !!(await incearca("insert into retete_propuse (catalog_serviciu_id) values ('10000000-0000-0000-0000-000000000003')")));
  verifica('retete_propuse_linii: cantitate 0 → respinsă', !!(await incearca("insert into retete_propuse_linii (reteta_id, tip, denumire_propusa, tip_resursa, consum_propus) select id, 'resursa_noua', 'Module', 'M', 0 from retete_propuse limit 1")));
  verifica('retete_propuse_linii: resursă nouă fără cantitate (necunoscută) → acceptată', !(await incearca("insert into retete_propuse_linii (reteta_id, tip, denumire_propusa, tip_resursa) select id, 'resursa_noua', 'Module', 'M' from retete_propuse limit 1")));
  verifica('retete_propuse: respinsă fără motiv → respinsă', !!(await incearca("update retete_propuse set stare = 'respinsa'")));

  console.log(`\n${trecute} trecute, ${picate.length} picate${picate.length ? ': ' + picate.join(' | ') : ''}`);
  process.exitCode = picate.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
