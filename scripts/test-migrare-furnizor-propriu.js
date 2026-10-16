// scripts/test-migrare-furnizor-propriu.js
// Test SQL pentru migrarea propusă a pasului 10a
// (docs/migrations-propuse/2026-10-16_furnizor_propriu.sql), pe un Postgres
// local (PGlite: Postgres compilat în WebAssembly, în memorie). Nimic nu
// ajunge în Supabase.
//
// Schema de pornire e o copie minimă a celei reale (16 oct. 2026): tabelele
// atinse, constrângerile și politicile RLS de azi pe
// entitati_juridice_platforma (inclusiv „public_read_entitati_juridice”,
// using (true)), plus rolul `anon`, ca în Supabase.
//
// Verifică:
//   1. migrarea rulează de două ori, fără erori;
//   2. partners.entitate_platforma_id: cheie externă, cel mult un cont pe entitate;
//   3. discount_sursa acceptă 'furnizor_propriu' (și refuză altceva);
//   4. entitatea fictivă din MD devine inactivă (nu e ștearsă); RO și GB rămân active;
//   5. anon nu mai citește entitati_juridice_platforma (IBAN-ul nu mai e public);
//   6. coloana traduceri pe produsele din marketplace.
//
// Cerințe (nu e dependență a proiectului):
//   npm i --no-save @electric-sql/pglite
// Rulare: node scripts/test-migrare-furnizor-propriu.js

const fs = require('fs');
const path = require('path');
const MIGRARE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations-propuse', '2026-10-16_furnizor_propriu.sql'), 'utf8');

const SCHEMA = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table public.profiles (id uuid primary key, role text, roles text[] default '{}');
create table public.entitati_juridice_platforma (id uuid primary key default gen_random_uuid(), tara_cod text not null unique, denumire text, cui text, nr_reg_com text,
  adresa text, iban text, activa boolean not null default false, creat_la timestamptz not null default now(), actualizat_la timestamptz not null default now());
create table public.partners (id uuid primary key, partner_type text not null, nume_firma text not null, cui text not null, status_verificare text);
create table public.comanda_subcontractori (id uuid primary key default gen_random_uuid(), comanda_id uuid, actor_id uuid, rol_tip text not null, suma_neta_alocata numeric not null,
  status text, discount_pct_aplicat numeric(5,2), discount_sursa text,
  constraint comanda_subcontractori_discount_sursa_check check (discount_sursa is null or discount_sursa in ('factura', 'profil_partener', 'implicit_panou')));
create table public.marketplace_materiale (id uuid primary key default gen_random_uuid(), furnizor_id uuid references public.partners(id), denumire text not null);
create table public.marketplace_echipamente (id uuid primary key default gen_random_uuid(), furnizor_id uuid references public.partners(id), denumire text not null);

alter table public.entitati_juridice_platforma enable row level security;
create policy public_read_entitati_juridice on public.entitati_juridice_platforma for select using (true);
create policy superadmin_write_entitati_juridice on public.entitati_juridice_platforma for all using (
  exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = any (array['admin', 'superadmin'])));
grant select, insert, update, delete on all tables in schema public to anon, authenticated;

-- Datele de azi (16 oct. 2026)
insert into public.entitati_juridice_platforma (id, tara_cod, denumire, iban, activa) values
  ('e0000000-0000-0000-0000-0000000000a1', 'RO', 'Home Best Pal SRL', 'RO49AAAA1B31007593840000', true),
  ('e0000000-0000-0000-0000-0000000000a2', 'GB', 'Home Best Pal LTD', null, true),
  ('e0000000-0000-0000-0000-0000000000a3', 'MD', 'Home Best Pal Moldova SRL (FICTIV — testare, de înlocuit la înființarea oficială)', null, true);
insert into public.partners (id, partner_type, nume_firma, cui, status_verificare) values
  ('b6014c22-cdc0-4af2-8a1a-412f432fb917', 'furnizor_materiale', 'Home Best Pal', 'RO46577229', 'approved'),
  ('10000000-0000-0000-0000-000000000002', 'furnizor_materiale', 'Alt Furnizor SRL', 'RO1', 'approved');
`;

let trecute = 0;
let picate = 0;
function test(nume, ok, detalii) {
  if (ok) { trecute++; console.log(`  ✓ ${nume}`); } else { picate++; console.log(`  ✗ ${nume}${detalii ? `\n      ${detalii}` : ''}`); }
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
  const ruleaza = async (sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec('rollback'); } catch (_) { /* nicio tranzacție deschisă */ } return e.message; } };

  console.log('1. Rulare');
  const e1 = await ruleaza(MIGRARE);
  test('prima rulare, fără erori', e1 === null, e1);
  const e2 = await ruleaza(MIGRARE);
  test('a doua rulare, fără erori (idempotentă)', e2 === null, e2);

  console.log('2. Furnizorul propriu');
  const eLeaga = await ruleaza("update partners set entitate_platforma_id = 'e0000000-0000-0000-0000-0000000000a1' where id = 'b6014c22-cdc0-4af2-8a1a-412f432fb917'");
  test('contul HBP se poate lega de entitatea RO', eLeaga === null, eLeaga);
  const eDublu = await ruleaza("update partners set entitate_platforma_id = 'e0000000-0000-0000-0000-0000000000a1' where id = '10000000-0000-0000-0000-000000000002'");
  test('un al doilea cont pe aceeași entitate e refuzat (index unic)', eDublu && /partners_entitate_platforma_id_unic|duplicate/.test(eDublu), eDublu);
  const eFk = await ruleaza("update partners set entitate_platforma_id = 'e0000000-0000-0000-0000-0000000000ff' where id = '10000000-0000-0000-0000-000000000002'");
  test('o entitate inexistentă e refuzată (cheie externă)', eFk && /foreign key|partners_entitate_platforma_id_fkey/.test(eFk), eFk);
  const legaturi = await q('select count(*)::int n from partners where entitate_platforma_id is not null');
  test('migrarea nu leagă singură niciun cont (doar legătura făcută în test)', legaturi[0].n === 1, JSON.stringify(legaturi));

  console.log('3. Escrow');
  const eSursa = await ruleaza("insert into comanda_subcontractori (rol_tip, suma_neta_alocata, discount_pct_aplicat, discount_sursa) values ('materiale', 100, 0, 'furnizor_propriu')");
  test("discount_sursa acceptă 'furnizor_propriu'", eSursa === null, eSursa);
  const eAlta = await ruleaza("insert into comanda_subcontractori (rol_tip, suma_neta_alocata, discount_sursa) values ('materiale', 100, 'altceva')");
  test('discount_sursa refuză o valoare necunoscută', eAlta && /discount_sursa_check/.test(eAlta), eAlta);

  console.log('4. Entitățile');
  const ent = await q('select tara_cod, activa from entitati_juridice_platforma order by tara_cod');
  test('MD (fictivă) inactivă, nu ștearsă; GB și RO rămân active', JSON.stringify(ent) === JSON.stringify([{ tara_cod: 'GB', activa: true }, { tara_cod: 'MD', activa: false }, { tara_cod: 'RO', activa: true }]), JSON.stringify(ent));

  console.log('5. Citirea publică');
  await db.exec('set role anon');
  let randuriAnon;
  try { randuriAnon = (await db.query('select iban from entitati_juridice_platforma')).rows; } finally { await db.exec('reset role'); }
  test('anon nu mai citește tabela (nici IBAN-ul)', randuriAnon.length === 0, JSON.stringify(randuriAnon));
  const pol = await q("select policyname from pg_policies where tablename = 'entitati_juridice_platforma' order by 1");
  test('rămâne doar politica de scriere a adminilor', JSON.stringify(pol.map((p) => p.policyname)) === JSON.stringify(['superadmin_write_entitati_juridice']), JSON.stringify(pol));

  console.log('6. Traducerile produselor');
  const col = await q("select table_name, column_default from information_schema.columns where column_name = 'traduceri' and table_name like 'marketplace_%' order by 1");
  test('traduceri jsonb, implicit {}, pe ambele tabele', col.length === 2 && col.every((c) => /'\{\}'::jsonb/.test(c.column_default)), JSON.stringify(col));

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
