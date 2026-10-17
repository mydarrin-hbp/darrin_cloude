// scripts/test-migrare-furnizor-propriu-date-anaf.js
// Test SQL pentru migrarea propusă a pasului 11-H1, punctul 2.6
// (docs/migrations-propuse/2026-10-16_furnizor_propriu_date_anaf.sql), pe un
// Postgres local (PGlite, în memorie). Nimic nu ajunge în Supabase.
//
// Schema de pornire e o copie minimă a celei reale (16 oct. 2026, citită doar
// cu SELECT): partners cu constrângerile de azi (fără trigger-e) și
// entitati_juridice_platforma, cu datele HBP de azi.
//
// Verifică:
//   1. prima rulare: HBP primește denumirea și adresa din ANAF; nr_reg_com și
//      CUI-ul rămân; raportul are exact cele 2 schimbări (înainte / după);
//   2. un partener extern (fără entitate) nu se atinge;
//   3. o valoare goală în entitate nu suprascrie datele partenerului;
//   4. a doua rulare: fără erori, nicio schimbare, raport gol;
//   5. fără coloana entitate_platforma_id: migrarea se oprește, nimic schimbat.
//
// Cerințe (nu e dependență a proiectului):
//   npm i --no-save @electric-sql/pglite
// Rulare: node scripts/test-migrare-furnizor-propriu-date-anaf.js

const fs = require('fs');
const path = require('path');
const MIGRARE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations-propuse', '2026-10-16_furnizor_propriu_date_anaf.sql'), 'utf8');

const HBP = 'b6014c22-cdc0-4af2-8a1a-412f432fb917';
const EXTERN = '10000000-0000-0000-0000-000000000002';
const GB_PARTENER = '10000000-0000-0000-0000-000000000003';

const SCHEMA_DE_BAZA = `
create table public.profiles (id uuid primary key);
create table public.entitati_juridice_platforma (id uuid primary key default gen_random_uuid(), tara_cod text not null unique, denumire text, cui text, nr_reg_com text,
  adresa text, iban text, activa boolean not null default false);
create table public.partners (id uuid primary key references public.profiles(id) on delete cascade, partner_type text not null, nume_firma text not null, cui text not null unique,
  nr_reg_com text, adresa_sediu_social text, tip_entitate_legala text, status_verificare text,
  constraint partners_status_verificare_check check (status_verificare = any (array['pending_review', 'approved', 'rejected'])),
  constraint partners_tip_entitate_legala_check check (tip_entitate_legala = any (array['persoana_fizica', 'pfa', 'srl', 'srl_d', 'sa', 'institutie_publica'])));
insert into public.entitati_juridice_platforma (id, tara_cod, denumire, cui, nr_reg_com, adresa, activa) values
  ('e0000000-0000-0000-0000-0000000000a1', 'RO', 'HOME BEST PAL S.R.L.', '46577229', 'J04/1319/2022', 'JUD. BACĂU, MUN. BACĂU, STR. NORDULUI, NR.3, SC.A, ET.2, AP.11', true),
  ('e0000000-0000-0000-0000-0000000000a2', 'GB', 'Home Best Pal LTD', null, null, '   ', true);
insert into public.profiles (id) values ('${HBP}'), ('${EXTERN}'), ('${GB_PARTENER}');
insert into public.partners (id, partner_type, nume_firma, cui, nr_reg_com, adresa_sediu_social, tip_entitate_legala, status_verificare) values
  ('${HBP}', 'furnizor_materiale', 'Home Best Pal', 'RO46577229', 'J04/1319/2022', 'Nordului nr 3- A 11', 'srl', 'approved'),
  ('${EXTERN}', 'furnizor_materiale', 'Alt Furnizor SRL', 'RO1', 'J01/1/2020', 'Str. Exemplu 1', 'srl', 'approved'),
  ('${GB_PARTENER}', 'inchirieri_utilaje', 'HBP UK (test)', 'GB1', 'X-1', 'Londra, adresa de test', 'srl', 'approved');
`;
const CU_COLOANA = `
alter table public.partners add column entitate_platforma_id uuid references public.entitati_juridice_platforma(id) on delete set null;
update public.partners set entitate_platforma_id = 'e0000000-0000-0000-0000-0000000000a1' where id = '${HBP}';
update public.partners set entitate_platforma_id = 'e0000000-0000-0000-0000-0000000000a2' where id = '${GB_PARTENER}';
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

  // Rulează migrarea ca în SQL Editor; întoarce rezultatul ultimei instrucțiuni (raportul).
  const ruleaza = async (db, sql) => {
    try {
      const rez = await db.exec(sql);
      return { eroare: null, raport: rez[rez.length - 1].rows };
    } catch (e) {
      try { await db.exec('rollback'); } catch (_) { /* nicio tranzacție deschisă */ }
      return { eroare: e.message, raport: null };
    }
  };
  const partener = async (db, id) => (await db.query(`select nume_firma, cui, nr_reg_com, adresa_sediu_social from public.partners where id = '${id}'`)).rows[0];

  const db = new PGlite();
  await db.exec(SCHEMA_DE_BAZA + CU_COLOANA);
  const externInainte = await partener(db, EXTERN);
  const gbInainte = await partener(db, GB_PARTENER);

  console.log('1. Prima rulare');
  const r1 = await ruleaza(db, MIGRARE);
  test('rulează fără erori', r1.eroare === null, r1.eroare);
  const hbp = await partener(db, HBP);
  test('HBP: denumirea din ANAF', hbp.nume_firma === 'HOME BEST PAL S.R.L.', JSON.stringify(hbp));
  test('HBP: adresa din ANAF', hbp.adresa_sediu_social === 'JUD. BACĂU, MUN. BACĂU, STR. NORDULUI, NR.3, SC.A, ET.2, AP.11', JSON.stringify(hbp));
  test('HBP: nr_reg_com și CUI-ul neschimbate', hbp.nr_reg_com === 'J04/1319/2022' && hbp.cui === 'RO46577229', JSON.stringify(hbp));
  const raport = (r1.raport || []).map((x) => [x.partener_id, x.camp, x.inainte, x.dupa]);
  test('raportul: cele 2 schimbări ale HBP și denumirea partenerului GB de test, înainte / după', JSON.stringify(raport) === JSON.stringify([
    [GB_PARTENER, 'nume_firma', 'HBP UK (test)', 'Home Best Pal LTD'],
    [HBP, 'adresa_sediu_social', 'Nordului nr 3- A 11', 'JUD. BACĂU, MUN. BACĂU, STR. NORDULUI, NR.3, SC.A, ET.2, AP.11'],
    [HBP, 'nume_firma', 'Home Best Pal', 'HOME BEST PAL S.R.L.'],
  ]), JSON.stringify(raport));

  console.log('2. Ce nu se atinge');
  test('partenerul extern (fără entitate) neschimbat', JSON.stringify(await partener(db, EXTERN)) === JSON.stringify(externInainte));
  const gb = await partener(db, GB_PARTENER);
  test('entitate cu nr_reg_com și adresă goale: doar denumirea se copiază, restul rămâne',
    gb.nume_firma === 'Home Best Pal LTD' && gb.nr_reg_com === gbInainte.nr_reg_com && gb.adresa_sediu_social === gbInainte.adresa_sediu_social, JSON.stringify(gb));

  console.log('3. A doua rulare');
  const dupaPrima = await db.query('select * from public.partners order by id');
  const r2 = await ruleaza(db, MIGRARE);
  test('a doua rulare: fără erori', r2.eroare === null, r2.eroare);
  test('a doua rulare: raport gol', Array.isArray(r2.raport) && r2.raport.length === 0, JSON.stringify(r2.raport));
  const dupaADoua = await db.query('select * from public.partners order by id');
  test('a doua rulare: nicio schimbare în partners', JSON.stringify(dupaPrima.rows) === JSON.stringify(dupaADoua.rows));

  console.log('4. Fără migrarea 2026-10-16_furnizor_propriu.sql');
  const db2 = new PGlite();
  await db2.exec(SCHEMA_DE_BAZA);
  const r3 = await ruleaza(db2, MIGRARE);
  test('se oprește cu eroare (coloana entitate_platforma_id lipsește)', r3.eroare !== null, 'fără eroare');
  test('nimic schimbat', (await partener(db2, HBP)).nume_firma === 'Home Best Pal');

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exitCode = picate ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
