// scripts/test-migrare-status-parteneri.js
// Test SQL pentru migrarea propusă a pasului 10c
// (docs/migrations-propuse/2026-10-16_status_parteneri.sql), pe un Postgres
// local (PGlite, în memorie). Nimic nu ajunge în Supabase.
//
// Schema de pornire e o copie minimă a celei reale (16 oct. 2026):
// auth.users (email_confirmed_at), profiles.status account_status,
// partners.partner_type partner_type_enum. Datele: cei trei parteneri de azi,
// în pending_otp (citirea live din pasul 10b, scripts/test-migrare-roluri-parteneri.js);
// emailul confirmat e o presupunere a testului — lista reală o dă ultimul
// select al migrării, la rulare. Plus cazuri de margine (partener cu emailul
// neconfirmat, partener suspendat, client în pending_otp).
//
// Verifică:
//   1. migrarea rulează de două ori, fără erori; a doua rulare nu corectează nimic;
//   2. partenerii cu emailul confirmat trec din pending_otp în active;
//   3. nu atinge alte conturi (client, email neconfirmat, suspendat, deja activ);
//   4. lista conturilor corectate (ultimul select);
//   5. verificarea de la final oprește tranzacția.
//
// Cerințe (nu e dependență a proiectului):
//   npm i --no-save @electric-sql/pglite
// Rulare: node scripts/test-migrare-status-parteneri.js

const fs = require('fs');
const path = require('path');
const MIGRARE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations-propuse', '2026-10-16_status_parteneri.sql'), 'utf8');

const HBP = 'b6014c22-cdc0-4af2-8a1a-412f432fb917';
const AROMA = '55cb02d3-834e-4971-8537-f2309610f843';
const PILOT = '1084a517-0619-4884-a11a-1a113d0b2a13';
const NECONFIRMAT = '20000000-0000-0000-0000-000000000001';
const SUSPENDAT = '20000000-0000-0000-0000-000000000002';
const ACTIV = '20000000-0000-0000-0000-000000000003';
const CLIENT = '20000000-0000-0000-0000-000000000004';

const SCHEMA = `
create schema if not exists auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create type public.account_status as enum ('pending_otp', 'active', 'suspended');
create type public.partner_type_enum as enum ('servicii_tehnice', 'curier_utilitara', 'asigurari', 'furnizor_materiale', 'inchirieri_utilaje');
create table public.profiles (id uuid primary key, email text not null, role text not null, roles text[] default '{}'::text[],
  status public.account_status default 'pending_otp');
create table public.partners (id uuid primary key, partner_type public.partner_type_enum not null, nume_firma text not null, cui text not null, status_verificare text);

insert into auth.users (id, email, email_confirmed_at) values
  ('${HBP}', 'contact@homebestpal.ro', '2026-10-01T10:00:00Z'),
  ('${AROMA}', 'contact@aromalive.ro', '2026-09-20T10:00:00Z'),
  ('${PILOT}', 'test.partener.pilot@homebestpal.com', '2026-09-10T10:00:00Z'),
  ('${NECONFIRMAT}', 'neconfirmat@test', null),
  ('${SUSPENDAT}', 'suspendat@test', '2026-09-01T10:00:00Z'),
  ('${ACTIV}', 'activ@test', '2026-09-01T10:00:00Z'),
  ('${CLIENT}', 'client@test', '2026-09-01T10:00:00Z');
insert into public.profiles (id, email, role, roles, status) values
  ('${HBP}', 'contact@homebestpal.ro', 'partener_materiale', '{client,partener_materiale}', 'pending_otp'),
  ('${AROMA}', 'contact@aromalive.ro', 'partener_servicii', '{partener_servicii}', 'pending_otp'),
  ('${PILOT}', 'test.partener.pilot@homebestpal.com', 'partener_servicii', '{partener_servicii}', 'pending_otp'),
  ('${NECONFIRMAT}', 'neconfirmat@test', 'partener_curier', '{partener_curier}', 'pending_otp'),
  ('${SUSPENDAT}', 'suspendat@test', 'partener_servicii', '{partener_servicii}', 'suspended'),
  ('${ACTIV}', 'activ@test', 'partener_inchirieri', '{partener_inchirieri}', 'active'),
  ('${CLIENT}', 'client@test', 'client', '{client}', 'pending_otp');
insert into public.partners (id, partner_type, nume_firma, cui, status_verificare) values
  ('${HBP}', 'furnizor_materiale', 'Home Best Pal', 'RO46577229', 'approved'),
  ('${AROMA}', 'servicii_tehnice', 'Aroma Live', 'RO2', 'pending_review'),
  ('${PILOT}', 'servicii_tehnice', 'Pilot', 'RO3', 'approved'),
  ('${NECONFIRMAT}', 'curier_utilitara', 'Neconfirmat', 'RO4', 'pending_review'),
  ('${SUSPENDAT}', 'servicii_tehnice', 'Suspendat', 'RO5', 'approved'),
  ('${ACTIV}', 'inchirieri_utilaje', 'Activ', 'RO6', 'approved');
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
  const status = async (id) => (await q(`select status::text as s from profiles where id = '${id}'`))[0].s;
  const profil = async (id) => (await q(`select role, roles, status::text from profiles where id = '${id}'`))[0];
  const ruleaza = async (sql) => {
    try { const r = await db.exec(sql); return { eroare: null, corectate: r[r.length - 1].rows }; } catch (e) {
      try { await db.exec('rollback'); } catch (_) { /* nicio tranzacție deschisă */ }
      return { eroare: e.message, corectate: null };
    }
  };

  const inainte = { hbp: await profil(HBP) };

  console.log('1. Rulare');
  const r1 = await ruleaza(MIGRARE);
  test('prima rulare, fără erori', r1.eroare === null, r1.eroare);
  const r2 = await ruleaza(MIGRARE);
  test('a doua rulare, fără erori (idempotentă)', r2.eroare === null, r2.eroare);
  test('a doua rulare nu mai corectează nimic', r2.corectate && r2.corectate.length === 0, JSON.stringify(r2.corectate));

  console.log('2. Partenerii cu emailul confirmat');
  test('contact@homebestpal.ro: pending_otp → active', (await status(HBP)) === 'active');
  test('contact@aromalive.ro: pending_otp → active', (await status(AROMA)) === 'active');
  test('test.partener.pilot: pending_otp → active', (await status(PILOT)) === 'active');
  const hbp = await profil(HBP);
  test('rolurile nu se schimbă', JSON.stringify(hbp.roles) === JSON.stringify(inainte.hbp.roles) && hbp.role === inainte.hbp.role, JSON.stringify(hbp));

  console.log('3. Alte conturi neatinse');
  test('partener cu emailul neconfirmat rămâne pending_otp', (await status(NECONFIRMAT)) === 'pending_otp');
  test('partener suspendat rămâne suspended', (await status(SUSPENDAT)) === 'suspended');
  test('partener deja activ rămâne active', (await status(ACTIV)) === 'active');
  test('client fără rând în partners rămâne pending_otp', (await status(CLIENT)) === 'pending_otp');

  console.log('4. Lista conturilor corectate (prima rulare)');
  const emailuri = (r1.corectate || []).map((c) => c.email);
  test('exact cei 3 parteneri de azi', JSON.stringify(emailuri) === JSON.stringify(['contact@aromalive.ro', 'contact@homebestpal.ro', 'test.partener.pilot@homebestpal.com']), JSON.stringify(emailuri));
  (r1.corectate || []).forEach((c) => console.log(`      ${c.email}: ${c.partner_type}, ${c.status_inainte} → ${c.status_dupa}`));

  console.log('5. Verificarea oprește tranzacția');
  // Un trigger care readuce statusul în pending_otp simulează o corectare eșuată.
  await db.exec(`
    create function readu_pending() returns trigger language plpgsql as $f$ begin new.status := 'pending_otp'; return new; end $f$;
    create trigger t_readu before update on profiles for each row execute function readu_pending();
    insert into auth.users (id, email, email_confirmed_at) values ('30000000-0000-0000-0000-000000000001', 'nou@test', now());
    insert into profiles (id, email, role, roles, status) values ('30000000-0000-0000-0000-000000000001', 'nou@test', 'partener_curier', '{partener_curier}', 'pending_otp');
    insert into partners (id, partner_type, nume_firma, cui) values ('30000000-0000-0000-0000-000000000001', 'curier_utilitara', 'Nou', 'RO9');
  `);
  const r3 = await ruleaza(MIGRARE);
  test('partener rămas în pending_otp → excepție, nimic aplicat', r3.eroare && /rămași în pending_otp/.test(r3.eroare), r3.eroare);

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
