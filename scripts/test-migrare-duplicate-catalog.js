// scripts/test-migrare-duplicate-catalog.js
// Test SQL pentru migrarea propusă a pasului 11-C8
// (docs/migrations-propuse/2026-11-05_duplicate_catalog.sql și
// 2026-11-05_duplicate_catalog_revenire.sql), pe un Postgres local (PGlite, în
// memorie). Nimic nu ajunge în Supabase.
//
// Schema de pornire e o copie minimă a celei reale (5 nov. 2026, citită doar cu
// SELECT): catalog_servicii cu constrângerile de azi (fără trigger-e), plus
// catalog_niveluri, ca să se vadă că nivelurile nu se ating. Datele: cele 10
// grupuri × 10 copii, cu sufixele ca în baza de date (grupul k: vk, vk+10, …,
// vk+90), plus produse fără sufix și un produs ascuns cu sufix.
//
// Verifică:
//   1. prima rulare: în fiecare grup rămâne public doar rândul cu sufixul cel
//      mai mic (numeric: v9 înaintea lui v19), cu titlul curat RO și
//      traduceri.en.titlu; 90 de rânduri ascunse; copia are cele 100 de
//      rânduri cu valorile de dinainte; restul tabelului și nivelurile neatinse;
//   2. copia nu se vede prin API (RLS activat, fără drepturi pentru anon /
//      authenticated);
//   3. a doua rulare: fără erori, nicio schimbare (nici în copie);
//   4. revenirea: totul exact ca înainte; a doua revenire nu schimbă nimic;
//      migrarea se poate aplica din nou după revenire;
//   5. un produs public cu sufix neașteptat: migrarea se oprește, nimic schimbat;
//   6. revenirea fără copie: se oprește cu eroare clară, nimic schimbat.
//
// Cerințe (nu e dependență a proiectului):
//   npm i --no-save @electric-sql/pglite
// Rulare: node scripts/test-migrare-duplicate-catalog.js

const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'docs', 'migrations-propuse');
const MIGRARE = fs.readFileSync(path.join(DIR, '2026-11-05_duplicate_catalog.sql'), 'utf8');
const REVENIRE = fs.readFileSync(path.join(DIR, '2026-11-05_duplicate_catalog_revenire.sql'), 'utf8');

// [titlul de bază de azi, id_serviciu de bază, titlul curat RO, titlul EN]
const GRUPURI = [
  ['Robinet trecere sferic 1/2', 'mat-robinet-trecere-sferic-12', 'Robinet de trecere sferic 1/2"', '1/2" ball valve'],
  ['Priza dubla ceramica Schneider', 'mat-priza-dubla-ceramica-schneider', 'Priză dublă ceramică Schneider', 'Schneider double ceramic socket'],
  ['Siguranta automata diferentiala 16A', 'mat-siguranta-automata-diferentiala-16a', 'Siguranță automată diferențială 16 A', '16 A residual current circuit breaker'],
  ['Teava cupru 15mm', 'mat-teava-cupru-15mm', 'Țeavă cupru 15 mm', '15 mm copper pipe'],
  ['Cot cupru 90 grade 15mm', 'mat-cot-cupru-90-grade-15mm', 'Cot cupru 90°, 15 mm', '90° copper elbow, 15 mm'],
  ['Filtru Y pentru impuritati 3/4', 'mat-filtru-y-pentru-impuritati-34', 'Filtru Y pentru impurități 3/4"', '3/4" Y strainer'],
  ['Garnitura siliconica set 10 buc', 'mat-garnitura-siliconica-set-10-buc', 'Garnituri siliconice, set de 10 buc.', 'Silicone seals, set of 10'],
  ['Adeziv gresie/faianta sac 25kg', 'mat-adeziv-gresiefaianta-sac-25kg', 'Adeziv gresie și faianță, sac 25 kg', 'Floor and wall tile adhesive, 25 kg bag'],
  ['Vopsea lavabila alba 15L', 'mat-vopsea-lavabila-alba-15l', 'Vopsea lavabilă albă 15 L', 'White washable paint, 15 L'],
  ['Cablu electric CYY-F 3x2.5 m', 'mat-cablu-electric-cyy-f-3x25-m', 'Cablu electric CYY-F 3×2,5 mm²', 'CYY-F 3×2.5 mm² electrical cable'],
];
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const esc = (s) => s.replace(/'/g, "''");

function schema(extra = '') {
  let sql = `
create role anon; create role authenticated;
create table public.catalog_servicii (
  id uuid primary key default gen_random_uuid(),
  id_serviciu text unique,
  categorie text,
  domeniu text,
  titlu text not null,
  unitate_masura text,
  status_public boolean default true,
  stare text not null default 'ciorna',
  traduceri jsonb not null default '{}'::jsonb,
  creat_la timestamptz default now(),
  constraint catalog_servicii_categorie_check check (categorie = any (array['servicii', 'materiale', 'inchirieri'])),
  constraint catalog_servicii_stare_check check (stare = any (array['ciorna', 'in_verificare', 'publicat', 'retras'])),
  constraint catalog_servicii_public_doar_publicat check ((not status_public) or (stare = 'publicat')),
  constraint catalog_servicii_traduceri_obiect_check check (jsonb_typeof(traduceri) = 'object')
);
create table public.catalog_niveluri (id uuid primary key default gen_random_uuid(), serviciu_id uuid references public.catalog_servicii(id), nivel text, label text);
grant select on public.catalog_servicii to anon, authenticated;
`;
  const randuri = [];
  GRUPURI.forEach(([baza, idb], k) => {
    for (let j = 0; j < 10; j++) {
      const v = k + 1 + 10 * j;
      // Un produs păstrat are deja alte traduceri: trebuie să rămână.
      const trad = (k === 7 && j === 0) ? `{"en":{"descriere":"Tile adhesive"},"fr":{"titlu":"Colle"}}` : '{}';
      randuri.push(`('${uuid(1000 + 100 * k + v)}', '${idb}-v${v}', 'materiale', 'Bricolaj & Consumabile', '${esc(baza)} v${v}', 'buc', true, 'publicat', '${trad}', '2026-07-07T10:00:00Z')`);
    }
  });
  randuri.push(`('${uuid(1)}', 'wc-inlocuire', 'servicii', 'Instalații sanitare și termice', 'Înlocuire vas WC', 'buc', true, 'publicat', '{}', '2026-06-01T10:00:00Z')`);
  randuri.push(`('${uuid(2)}', 'montaj-parchet-laminat', 'servicii', 'Pardoseli & Parchet', 'Montaj Parchet Laminat', 'mp', true, 'publicat', '{"en":{"titlu":"Laminate flooring installation"}}', '2026-06-01T10:00:00Z')`);
  randuri.push(`('${uuid(3)}', 'kit-v2-premium', 'materiale', 'Bricolaj & Consumabile', 'Kit v2 premium', 'buc', true, 'publicat', '{}', '2026-06-01T10:00:00Z')`);
  randuri.push(`('${uuid(4)}', 'produs-retras-v5', 'materiale', 'Bricolaj & Consumabile', 'Produs retras v5', 'buc', false, 'retras', '{}', '2026-06-01T10:00:00Z')`);
  sql += `insert into public.catalog_servicii (id, id_serviciu, categorie, domeniu, titlu, unitate_masura, status_public, stare, traduceri, creat_la) values\n  ${randuri.join(',\n  ')};\n`;
  sql += `insert into public.catalog_niveluri (serviciu_id, nivel, label) select id, 'Bronze', 'Bronz' from public.catalog_servicii;\n`;
  return sql + extra;
}

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
  // Rulează fișierul ca în SQL Editor; întoarce rezultatul ultimei instrucțiuni.
  const ruleaza = async (db, sql) => {
    try {
      const rez = await db.exec(sql);
      return { eroare: null, rezultat: rez[rez.length - 1].rows };
    } catch (e) {
      try { await db.exec('rollback'); } catch (_) { /* nicio tranzacție deschisă */ }
      return { eroare: e.message, rezultat: null };
    }
  };
  const tabel = async (db) => JSON.stringify((await db.query('select id, id_serviciu, titlu, status_public, stare, traduceri, unitate_masura, creat_la from public.catalog_servicii order by id')).rows);
  const niveluri = async (db) => JSON.stringify((await db.query('select * from public.catalog_niveluri order by serviciu_id')).rows);
  const copie = async (db) => (await db.query("select * from public.catalog_servicii_backup_11c8 order by id")).rows;
  const rand = async (db, idServiciu) => (await db.query('select * from public.catalog_servicii where id_serviciu = $1', [idServiciu])).rows[0];

  const db = new PGlite();
  await db.exec(schema());
  const inainte = await tabel(db);
  const nivInainte = await niveluri(db);
  const publiceInainte = (await db.query('select count(*)::int n from public.catalog_servicii where status_public')).rows[0].n;

  console.log('1. Prima rulare');
  const r1 = await ruleaza(db, MIGRARE);
  test('rulează fără erori', r1.eroare === null, r1.eroare);
  for (const [baza, idb, ro, en] of GRUPURI) {
    const k = GRUPURI.findIndex((g) => g[0] === baza);
    const pastrat = await rand(db, `${idb}-v${k + 1}`);
    const publice = (await db.query('select id_serviciu from public.catalog_servicii where status_public and id_serviciu like $1', [idb + '-v%'])).rows.map((x) => x.id_serviciu);
    test(`${baza}: public doar v${k + 1} („${ro}” / „${en}”)`,
      JSON.stringify(publice) === JSON.stringify([`${idb}-v${k + 1}`]) && pastrat.titlu === ro && pastrat.traduceri.en && pastrat.traduceri.en.titlu === en,
      JSON.stringify({ publice, titlu: pastrat.titlu, traduceri: pastrat.traduceri }));
  }
  const vopsea = await rand(db, 'mat-vopsea-lavabila-alba-15l-v9');
  test('sufixul cel mai mic e numeric (v9 păstrat, nu v19)', vopsea.status_public === true && (await rand(db, 'mat-vopsea-lavabila-alba-15l-v19')).status_public === false);
  const adeziv = await rand(db, 'mat-adeziv-gresiefaianta-sac-25kg-v8');
  test('traducerile existente se păstrează (en.descriere, fr)', JSON.stringify(adeziv.traduceri) === JSON.stringify({ en: { titlu: 'Floor and wall tile adhesive, 25 kg bag', descriere: 'Tile adhesive' }, fr: { titlu: 'Colle' } }), JSON.stringify(adeziv.traduceri));
  const n = (await db.query(`select count(*) filter (where status_public)::int publice, count(*) filter (where not status_public and titlu ~ '\\s+v\\d+$')::int ascunse_sufix, count(*) filter (where status_public and titlu ~ '\\s+v\\d+$')::int publice_sufix from public.catalog_servicii`)).rows[0];
  test(`publice: ${publiceInainte} → ${publiceInainte - 90}; 0 titluri publice cu sufix`, n.publice === publiceInainte - 90 && n.publice_sufix === 0, JSON.stringify(n));
  const ascunse = (await db.query('select count(*)::int n from public.catalog_servicii s join public.catalog_servicii_backup_11c8 b on b.id = s.id where not s.status_public')).rows[0].n;
  test('90 de rânduri ascunse (fără ștergere: tot 104 rânduri în tabel)', ascunse === 90 && JSON.parse(await tabel(db)).length === JSON.parse(inainte).length, `${ascunse}`);
  const c1 = await copie(db);
  const orig = new Map(JSON.parse(inainte).map((r) => [r.id, r]));
  test('copia: 100 de rânduri, cu titlul, status_public și traduceri de dinainte',
    c1.length === 100 && c1.every((b) => orig.get(b.id) && orig.get(b.id).titlu === b.titlu && orig.get(b.id).status_public === b.status_public && JSON.stringify(orig.get(b.id).traduceri) === JSON.stringify(b.traduceri) && b.copiat_la),
    `${c1.length} rânduri`);
  const neatinse = JSON.parse(inainte).filter((r) => !/^mat-.*-v\d+$/.test(r.id_serviciu) || r.id_serviciu === 'produs-retras-v5');
  const acum = new Map(JSON.parse(await tabel(db)).map((r) => [r.id, r]));
  test('produsele fără sufix, „Kit v2 premium” și produsul ascuns cu sufix: neatinse', neatinse.every((r) => JSON.stringify(acum.get(r.id)) === JSON.stringify(r)), neatinse.length + ' produse');
  test('nivelurile neatinse', (await niveluri(db)) === nivInainte);
  test('raportul de la final: cele 10 produse păstrate, cu titlul vechi și nou (RO, EN) și 9 copii ascunse fiecare',
    Array.isArray(r1.rezultat) && r1.rezultat.length === 10 && r1.rezultat.every((x) => x.titlu_nou_en && Number(x.copii_ascunse) === 9) && r1.rezultat[0].titlu_vechi === 'Robinet trecere sferic 1/2 v1' && r1.rezultat[0].titlu_nou_ro === 'Robinet de trecere sferic 1/2"',
    JSON.stringify(r1.rezultat && r1.rezultat[0]));

  console.log('2. Copia nu se vede prin API');
  const sec = (await db.query("select c.relrowsecurity rls, has_table_privilege('anon', c.oid, 'select') anon, has_table_privilege('authenticated', c.oid, 'select') auth from pg_class c where c.oid = 'public.catalog_servicii_backup_11c8'::regclass")).rows[0];
  test('RLS activat, fără drept de citire pentru anon / authenticated', sec.rls === true && sec.anon === false && sec.auth === false, JSON.stringify(sec));

  console.log('3. A doua rulare');
  const dupaPrima = await tabel(db);
  const copiePrima = JSON.stringify(c1);
  const r2 = await ruleaza(db, MIGRARE);
  test('fără erori', r2.eroare === null, r2.eroare);
  test('nicio schimbare în catalog_servicii', (await tabel(db)) === dupaPrima);
  test('nicio schimbare în copie (100 de rânduri, aceleași valori și momente)', JSON.stringify(await copie(db)) === copiePrima);

  console.log('4. Revenirea');
  const v1 = await ruleaza(db, REVENIRE);
  test('fără erori', v1.eroare === null, v1.eroare);
  test('catalog_servicii exact ca înainte de migrare', (await tabel(db)) === inainte);
  test('nivelurile neatinse', (await niveluri(db)) === nivInainte);
  test('raportul: 10 grupuri × 10 copii, toate publice', Array.isArray(v1.rezultat) && v1.rezultat.length === 10 && v1.rezultat.every((x) => Number(x.copii) === 10 && Number(x.publice) === 10), JSON.stringify(v1.rezultat && v1.rezultat[0]));
  const v2 = await ruleaza(db, REVENIRE);
  test('a doua revenire: fără erori, nicio schimbare', v2.eroare === null && (await tabel(db)) === inainte, v2.eroare);
  const r3 = await ruleaza(db, MIGRARE);
  test('migrarea se aplică din nou după revenire, cu același rezultat', r3.eroare === null && (await tabel(db)) === dupaPrima, r3.eroare);
  test('copia rămâne cea originală (nu se suprascrie)', JSON.stringify(await copie(db)) === copiePrima);

  console.log('5. Un produs public cu sufix neașteptat');
  const db2 = new PGlite();
  await db2.exec(schema(`insert into public.catalog_servicii (id_serviciu, categorie, titlu, status_public, stare) values ('banda-v3', 'materiale', 'Banda izolatoare v3', true, 'publicat');`));
  const inainte2 = await tabel(db2);
  const r4 = await ruleaza(db2, MIGRARE);
  test('se oprește cu eroare clară', r4.eroare !== null && /sufix/.test(r4.eroare), r4.eroare);
  test('nimic schimbat (nici copia nu există)', (await tabel(db2)) === inainte2 && (await db2.query("select to_regclass('public.catalog_servicii_backup_11c8') t")).rows[0].t === null);

  console.log('6. Revenirea fără copie');
  const db3 = new PGlite();
  await db3.exec(schema());
  const inainte3 = await tabel(db3);
  const v3 = await ruleaza(db3, REVENIRE);
  test('se oprește cu eroare clară', v3.eroare !== null && /lipsește/.test(v3.eroare), v3.eroare);
  test('nimic schimbat', (await tabel(db3)) === inainte3);

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exitCode = picate ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
