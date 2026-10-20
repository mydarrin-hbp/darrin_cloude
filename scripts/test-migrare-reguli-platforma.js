// scripts/test-migrare-reguli-platforma.js
// Test SQL pentru migrarea propusă a pasului 11-A
// (docs/migrations-propuse/2026-10-17_reguli_platforma.sql), pe un Postgres
// local (PGlite, în memorie). Nimic nu ajunge în Supabase.
//
// Schema de pornire e o copie minimă a backoffice_config (UNIQUE (cheie,
// tara_cod), după 2026-10-07_backoffice_config_unic_pe_tara.sql), cu câteva
// chei existente din secțiunea pricing.
//
// Verifică:
//   1. migrarea rulează de două ori, fără erori;
//   2. creează termen_plata_partener_zile = 6 (pricing, ALL, superadmin, zile);
//   3. nu atinge celelalte chei;
//   4. o valoare schimbată din panou nu e suprascrisă la o nouă rulare;
//   5. ultimul select întoarce rândul;
//   6. verificarea de la final oprește tranzacția dacă valoarea e nevalidă.
//
// Cerințe (nu e dependență a proiectului):
//   npm i --no-save @electric-sql/pglite
// Rulare: node scripts/test-migrare-reguli-platforma.js

const fs = require('fs');
const path = require('path');
const MIGRARE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations-propuse', '2026-10-17_reguli_platforma.sql'), 'utf8');

const SCHEMA = `
create table public.backoffice_config (
  id bigserial primary key,
  cheie text not null,
  valoare text,
  tip text,
  sectiune text,
  eticheta text,
  descriere text,
  unitate text,
  editabil_de text,
  tara_cod text not null default 'ALL',
  updated_at timestamptz default now(),
  constraint backoffice_config_cheie_tara_key unique (cheie, tara_cod)
);
insert into public.backoffice_config (cheie, valoare, tip, sectiune, unitate, editabil_de, tara_cod) values
  ('comision_platforma_default_pct', '12', 'number', 'pricing', '%', 'superadmin', 'ALL'),
  ('cost_marketing_pct', '3', 'number', 'pricing', '%', 'superadmin', 'ALL'),
  ('cost_mentenanta_pct', '2', 'number', 'pricing', '%', 'superadmin', 'RO');
`;

let ok = 0, esec = 0;
function verifica(cond, mesaj) {
  if (cond) { ok++; console.log('  ✓ ' + mesaj); } else { esec++; console.log('  ✗ ' + mesaj); }
}

(async () => {
  let PGlite;
  try { ({ PGlite } = require('@electric-sql/pglite')); }
  catch (e) { console.log('PGlite lipsește: npm i --no-save @electric-sql/pglite'); process.exit(1); }

  const db = new PGlite();
  await db.exec(SCHEMA);
  const inainte = (await db.query("select cheie, valoare, tara_cod from public.backoffice_config where cheie <> 'termen_plata_partener_zile' order by cheie, tara_cod")).rows;

  // 1–2. Prima rulare
  const r1 = await db.exec(MIGRARE);
  const rand = (await db.query("select * from public.backoffice_config where cheie = 'termen_plata_partener_zile'")).rows;
  verifica(rand.length === 1, 'prima rulare: un singur rând termen_plata_partener_zile');
  const x = rand[0] || {};
  verifica(x.valoare === '6' && x.tara_cod === 'ALL' && x.sectiune === 'pricing' && x.editabil_de === 'superadmin' && x.unitate === 'zile' && x.tip === 'number',
    'valoarea 6, ALL, pricing, number, zile, editabil de superadmin');
  verifica(/Termen de plată către partener/.test(x.eticheta || '') && /decizia LM B3/.test(x.descriere || ''), 'eticheta și descrierea în română, cu sursa (B3)');

  // 5. Ultimul select
  const ultim = r1[r1.length - 1];
  verifica(ultim && ultim.rows && ultim.rows.length === 1 && ultim.rows[0].valoare === '6', 'ultimul select întoarce rândul creat');

  // 3. Celelalte chei neatinse
  const dupa = (await db.query("select cheie, valoare, tara_cod from public.backoffice_config where cheie <> 'termen_plata_partener_zile' order by cheie, tara_cod")).rows;
  verifica(JSON.stringify(inainte) === JSON.stringify(dupa), 'celelalte chei rămân neschimbate');

  // 1 + 4. A doua rulare, după o schimbare din panou
  await db.exec("update public.backoffice_config set valoare = '5' where cheie = 'termen_plata_partener_zile' and tara_cod = 'ALL'");
  let eroare2 = null;
  try { await db.exec(MIGRARE); } catch (e) { eroare2 = e; }
  verifica(!eroare2, 'a doua rulare: fără erori');
  const r2 = (await db.query("select valoare from public.backoffice_config where cheie = 'termen_plata_partener_zile'")).rows;
  verifica(r2.length === 1 && r2[0].valoare === '5', 'a doua rulare nu suprascrie valoarea schimbată din panou (rămâne 5)');

  // 6. Verificarea oprește tranzacția la o valoare nevalidă
  await db.exec("update public.backoffice_config set valoare = 'abc' where cheie = 'termen_plata_partener_zile' and tara_cod = 'ALL'");
  let eroare3 = null;
  try { await db.exec(MIGRARE); } catch (e) { eroare3 = e; }
  verifica(eroare3 && /nevalidă/.test(eroare3.message), 'verificarea oprește tranzacția la o valoare nevalidă');
  await db.exec('rollback').catch(() => {});

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
