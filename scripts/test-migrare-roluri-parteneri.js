// scripts/test-migrare-roluri-parteneri.js
// Test SQL pentru migrarea propusă a pasului 10b
// (docs/migrations-propuse/2026-10-16_roluri_parteneri.sql), pe un Postgres
// local (PGlite, în memorie). Nimic nu ajunge în Supabase.
//
// Schema de pornire e o copie minimă a celei reale (16 oct. 2026):
// profiles.role text not null, profiles.roles text[], profiles.status
// account_status, partners.partner_type partner_type_enum. Datele: cei trei
// parteneri reali de azi (contact@homebestpal.ro cu roles = {client}) plus
// cazuri de margine (client devenit partener, investitor, curier fără rol).
//
// Verifică:
//   1. migrarea rulează de două ori, fără erori; a doua rulare nu corectează nimic;
//   2. contact@homebestpal.ro primește partener_materiale și păstrează client;
//   3. partenerii cu rol corect rămân neschimbați;
//   4. alte roluri nu se șterg; profiles.role se schimbă doar dacă era client;
//   5. lista conturilor corectate (ultimul select).
//
// Cerințe (nu e dependență a proiectului):
//   npm i --no-save @electric-sql/pglite
// Rulare: node scripts/test-migrare-roluri-parteneri.js

const fs = require('fs');
const path = require('path');
const MIGRARE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations-propuse', '2026-10-16_roluri_parteneri.sql'), 'utf8');

const HBP = 'b6014c22-cdc0-4af2-8a1a-412f432fb917';
const AROMA = '55cb02d3-834e-4971-8537-f2309610f843';
const PILOT = '1084a517-0619-4884-a11a-1a113d0b2a13';
const CLIENT_PARTENER = '20000000-0000-0000-0000-000000000001';
const INVESTITOR = '20000000-0000-0000-0000-000000000002';
const CURIER = '20000000-0000-0000-0000-000000000003';
const DOAR_CLIENT = '20000000-0000-0000-0000-000000000004';

const SCHEMA = `
create type public.account_status as enum ('pending_otp', 'active', 'suspended');
create type public.partner_type_enum as enum ('servicii_tehnice', 'curier_utilitara', 'asigurari', 'furnizor_materiale', 'inchirieri_utilaje');
create table public.profiles (id uuid primary key, email text not null, role text not null, roles text[] default '{}'::text[],
  status public.account_status default 'pending_otp');
create table public.partners (id uuid primary key, partner_type public.partner_type_enum not null, nume_firma text not null, cui text not null, status_verificare text);

-- Datele de azi (16 oct. 2026, citire live) + cazuri de margine
insert into public.profiles (id, email, role, roles, status) values
  ('${HBP}', 'contact@homebestpal.ro', 'client', '{client}', 'pending_otp'),
  ('${AROMA}', 'contact@aromalive.ro', 'partener_servicii', '{partener_servicii}', 'pending_otp'),
  ('${PILOT}', 'test.partener.pilot@homebestpal.com', 'partener_servicii', '{partener_servicii}', 'pending_otp'),
  ('${CLIENT_PARTENER}', 'client.partener@test', 'client', '{client}', 'active'),
  ('${INVESTITOR}', 'investitor@test', 'investor', '{investor}', 'active'),
  ('${CURIER}', 'curier@test', 'client', null, 'active'),
  ('${DOAR_CLIENT}', 'doar.client@test', 'client', '{client}', 'active');
insert into public.partners (id, partner_type, nume_firma, cui, status_verificare) values
  ('${HBP}', 'furnizor_materiale', 'Home Best Pal', 'RO46577229', 'approved'),
  ('${AROMA}', 'servicii_tehnice', 'Aroma Live', 'RO2', 'pending_review'),
  ('${PILOT}', 'servicii_tehnice', 'Pilot', 'RO3', 'approved'),
  ('${CLIENT_PARTENER}', 'inchirieri_utilaje', 'Client Partener', 'RO4', 'pending_review'),
  ('${INVESTITOR}', 'asigurari', 'Investitor Asigurări', 'RO5', 'approved'),
  ('${CURIER}', 'curier_utilitara', 'Curier', 'RO6', 'pending_review');
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
  const profil = async (id) => (await q(`select role, roles, status::text from profiles where id = '${id}'`))[0];
  const ruleaza = async (sql) => {
    try { const r = await db.exec(sql); return { eroare: null, corectate: r[r.length - 1].rows }; } catch (e) {
      try { await db.exec('rollback'); } catch (_) { /* nicio tranzacție deschisă */ }
      return { eroare: e.message, corectate: null };
    }
  };

  const inainte = { aroma: await profil(AROMA), pilot: await profil(PILOT), client: await profil(DOAR_CLIENT) };

  console.log('1. Rulare');
  const r1 = await ruleaza(MIGRARE);
  test('prima rulare, fără erori', r1.eroare === null, r1.eroare);
  const r2 = await ruleaza(MIGRARE);
  test('a doua rulare, fără erori (idempotentă)', r2.eroare === null, r2.eroare);
  test('a doua rulare nu mai corectează nimic', r2.corectate && r2.corectate.length === 0, JSON.stringify(r2.corectate));

  console.log('2. Home Best Pal');
  const hbp = await profil(HBP);
  test('contact@homebestpal.ro: roles = {client, partener_materiale}', JSON.stringify(hbp.roles) === JSON.stringify(['client', 'partener_materiale']), JSON.stringify(hbp));
  test('contact@homebestpal.ro: role = partener_materiale', hbp.role === 'partener_materiale', hbp.role);
  test('status neschimbat (migrarea nu atinge status)', hbp.status === 'pending_otp', hbp.status);

  console.log('3. Partenerii cu rol corect rămân neschimbați');
  test('contact@aromalive.ro neschimbat', JSON.stringify(await profil(AROMA)) === JSON.stringify(inainte.aroma));
  test('test.partener.pilot neschimbat', JSON.stringify(await profil(PILOT)) === JSON.stringify(inainte.pilot));
  test('un client fără rând în partners neschimbat', JSON.stringify(await profil(DOAR_CLIENT)) === JSON.stringify(inainte.client));

  console.log('4. Margini');
  const cp = await profil(CLIENT_PARTENER);
  test('client devenit partener: păstrează client, primește partener_inchirieri', JSON.stringify(cp.roles) === JSON.stringify(['client', 'partener_inchirieri']) && cp.role === 'partener_inchirieri', JSON.stringify(cp));
  const inv = await profil(INVESTITOR);
  test('investitor: păstrează investor și rolul principal, primește partener_asigurari', JSON.stringify(inv.roles) === JSON.stringify(['investor', 'partener_asigurari']) && inv.role === 'investor', JSON.stringify(inv));
  const cur = await profil(CURIER);
  test('curier cu roles null: primește partener_curier', JSON.stringify(cur.roles) === JSON.stringify(['partener_curier']) && cur.role === 'partener_curier', JSON.stringify(cur));

  console.log('5. Lista conturilor corectate (prima rulare)');
  const emailuri = (r1.corectate || []).map((c) => c.email);
  test('exact cele 4 conturi fără rol (HBP + 3 de test)', JSON.stringify(emailuri) === JSON.stringify(['client.partener@test', 'contact@homebestpal.ro', 'curier@test', 'investitor@test']), JSON.stringify(emailuri));
  (r1.corectate || []).forEach((c) => console.log(`      ${c.email}: ${c.partner_type} → +${c.rol_adaugat} (${JSON.stringify(c.roles_inainte)} → ${JSON.stringify(c.roles_dupa)})`));

  console.log('6. Verificarea oprește tranzacția');
  await db.exec(`insert into profiles (id, email, role, roles) values ('30000000-0000-0000-0000-000000000001', 'fara.profil@test', 'client', '{client}')`);
  await db.exec(`delete from profiles where id = '30000000-0000-0000-0000-000000000001'`);
  await db.exec(`insert into partners (id, partner_type, nume_firma, cui) values ('30000000-0000-0000-0000-000000000001', 'asigurari', 'Fără profil', 'RO9')`);
  const r3 = await ruleaza(MIGRARE);
  test('un partener fără profil → excepție, nimic aplicat', r3.eroare && /fără rolul lor/.test(r3.eroare), r3.eroare);

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
