// scripts/test-migrare-traduceri-en.js
// Test SQL pentru migrarea propusă a pasului 11-T1
// (docs/migrations-propuse/2026-11-12_traduceri_en_catalog.sql), pe un Postgres local
// (PGlite, în memorie), cu conținutul public real din 13 nov. 2026
// (docs/traduceri/11t1_continut_public.json: 136 de servicii, 275 de niveluri, 81 de
// categorii, cu traducerile existente). Nimic nu ajunge în Supabase.
//
// Verifică:
//   1. fișierele generate sunt la zi (genereaza-traduceri-11t1.js --verifica);
//   2. prima rulare: 0 produse publice, 0 niveluri, 0 categorii fără engleză; title_en
//      completat; cheile existente din traduceri.en (cele 10 produse) neschimbate;
//      celelalte limbi din traduceri neatinse; coloanele românești neschimbate;
//      produsele ascunse și nivelurile lor neatinse;
//   3. a doua rulare: fără erori, nicio schimbare;
//   4. etape_lucrare ca text[] (nu jsonb): migrarea merge la fel;
//   5. un titlu român schimbat după 13 nov.: rândul nu primește traducerea, verificarea
//      de la final oprește migrarea (rollback, nimic schimbat);
//   6. un produs public nou, fără engleză: migrarea se oprește cu mesaj clar.
//
// Cerințe (nu e dependență a proiectului): npm i --no-save @electric-sql/pglite
// Rulare: node scripts/test-migrare-traduceri-en.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const R = path.join(__dirname, '..');
const MIGRARE = fs.readFileSync(path.join(R, 'docs/migrations-propuse/2026-11-12_traduceri_en_catalog.sql'), 'utf8');
const DATE = JSON.parse(fs.readFileSync(path.join(R, 'docs/traduceri/11t1_continut_public.json'), 'utf8'));

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const lit = (v) => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const js = (v) => lit(JSON.stringify(v == null ? {} : v)) + '::jsonb';

function schema(etapeTip) {
  const etape = (v) => v == null ? 'null' : etapeTip === 'text[]' ? `array[${v.map(lit).join(',')}]::text[]` : js(v);
  let s = `
create table public.catalog_servicii (id uuid primary key, id_serviciu text, titlu text not null, categorie text, domeniu text, descriere text,
  unitate_masura text, etape_lucrare ${etapeTip}, instructiuni_intretinere text, status_public boolean default true,
  traduceri jsonb not null default '{}'::jsonb check (jsonb_typeof(traduceri) = 'object'));
create table public.catalog_niveluri (id uuid primary key, serviciu_id uuid references public.catalog_servicii(id), nivel text, label text, descriere text,
  traduceri jsonb not null default '{}'::jsonb check (jsonb_typeof(traduceri) = 'object'));
create table public.categorii (id uuid primary key, slug text, parent_id uuid, title text, title_en text, description text,
  traduceri jsonb not null default '{}'::jsonb check (jsonb_typeof(traduceri) = 'object'));
`;
  // Un produs ascuns cu un nivel: nu trebuie atinse.
  const servicii = DATE.catalog_servicii.map((r) => ({ ...r, status_public: true }));
  servicii.push({ id: '00000000-0000-0000-0000-00000000aaaa', id_serviciu: 'ascuns', titlu: 'Înlocuire calorifer defect', categorie: 'servicii', domeniu: 'Instalații sanitare și termice', status_public: false, traduceri: {} });
  for (const r of servicii) {
    s += `insert into public.catalog_servicii values (${lit(r.id)}, ${lit(r.id_serviciu)}, ${lit(r.titlu)}, ${lit(r.categorie)}, ${lit(r.domeniu)}, ${lit(r.descriere)}, ${lit(r.unitate_masura)}, ${etape(r.etape_lucrare)}, ${lit(r.instructiuni_intretinere)}, ${r.status_public}, ${js(r.traduceri)});\n`;
  }
  const niveluri = DATE.catalog_niveluri.slice();
  niveluri.push({ id: '00000000-0000-0000-0000-00000000bbbb', serviciu_id: '00000000-0000-0000-0000-00000000aaaa', nivel: 'Bronze', label: 'Manoperă', descriere: 'Echipă calificată, scule. Materialele sunt furnizate de client.', traduceri: {} });
  for (const r of niveluri) s += `insert into public.catalog_niveluri values (${lit(r.id)}, ${lit(r.serviciu_id)}, ${lit(r.nivel)}, ${lit(r.label)}, ${lit(r.descriere)}, ${js(r.traduceri)});\n`;
  // Un rând de categorie are deja o altă limbă: trebuie să rămână.
  DATE.categorii.forEach((r, i) => {
    const tr = i === 0 ? { fr: { title: 'Plomberie' } } : r.traduceri;
    s += `insert into public.categorii values (${lit(r.id)}, ${lit(r.slug)}, null, ${lit(r.title)}, ${lit(r.title_en)}, ${lit(r.description)}, ${js(tr)});\n`;
  });
  return s;
}

async function baza(etapeTip = 'jsonb', extra = '') {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(schema(etapeTip) + extra);
  return db;
}
const instantaneu = async (db) => JSON.stringify((await db.query(`
  select 's' t, id::text, titlu || coalesce(domeniu,'') || coalesce(descriere,'') || coalesce(unitate_masura,'') ro, traduceri::text tr, null te from public.catalog_servicii
  union all select 'n', id::text, coalesce(label,'') || coalesce(descriere,''), traduceri::text, null from public.catalog_niveluri
  union all select 'c', id::text, coalesce(title,'') || coalesce(description,''), traduceri::text, title_en from public.categorii order by 1, 2`)).rows);
async function lipsa(db) {
  const r = await db.query(`select
    (select count(*) from public.catalog_servicii where status_public and coalesce(traduceri->'en'->>'titlu','') = '')::int s,
    (select count(*) from public.catalog_niveluri nv where exists (select 1 from public.catalog_servicii x where x.id = nv.serviciu_id and x.status_public)
       and ((coalesce(descriere,'') <> '' and coalesce(traduceri->'en'->>'descriere','') = '') or (coalesce(label,'') <> '' and coalesce(traduceri->'en'->>'label','') = '')))::int n,
    (select count(*) from public.categorii where coalesce(title_en,'') = '' or coalesce(traduceri->'en'->>'title','') = '')::int c`);
  return r.rows[0];
}

(async () => {
  console.log('1. Fișierele generate sunt la zi');
  try { execFileSync(process.execPath, [path.join(__dirname, 'genereaza-traduceri-11t1.js'), '--verifica'], { stdio: 'pipe' }); verifica(true); }
  catch (e) { verifica(false, 'migrarea sau CSV-ul diferă de generator: ' + String(e.stdout || e.message).trim()); }
  verifica(/^begin;$/m.test(MIGRARE) && /^commit;$/m.test(MIGRARE) && (MIGRARE.match(/^begin;$/gm) || []).length === 1, 'o singură tranzacție begin/commit');

  console.log('2. Prima rulare');
  const db = await baza();
  const inainte = await lipsa(db);
  verifica(inainte.s === 126 && inainte.n === 275 && inainte.c === 81, `înainte: ${JSON.stringify(inainte)} (așteptat 126 / 275 / 81)`);
  const zece = (await db.query(`select id::text, traduceri from public.catalog_servicii where traduceri->'en'->>'titlu' is not null`)).rows;
  const roInainte = (await db.query(`select string_agg(titlu || '|' || coalesce(domeniu,'') || '|' || coalesce(unitate_masura,''), ';' order by id) x from public.catalog_servicii`)).rows[0].x;
  await db.exec(MIGRARE);
  const dupa = await lipsa(db);
  verifica(dupa.s === 0 && dupa.n === 0 && dupa.c === 0, `după: ${JSON.stringify(dupa)}`);
  for (const z of zece) {
    const acum = (await db.query(`select traduceri from public.catalog_servicii where id = $1`, [z.id])).rows[0].traduceri;
    verifica(acum.en.titlu === z.traduceri.en.titlu, `traducerea existentă rămâne: ${z.traduceri.en.titlu} → ${acum.en.titlu}`);
    verifica(acum.en.domeniu === 'DIY & Consumables', `cheia lipsă se completează (domeniu): ${acum.en.domeniu}`);
  }
  verifica((await db.query(`select title_en from public.categorii where title = 'Instalații sanitare'`)).rows[0].title_en === 'Plumbing', 'title_en completat');
  const fr = (await db.query(`select traduceri from public.categorii where id = $1`, [DATE.categorii[0].id])).rows[0].traduceri;
  verifica(fr.fr && fr.fr.title === 'Plomberie' && fr.en && fr.en.title, `celelalte limbi rămân: ${JSON.stringify(fr)}`);
  verifica((await db.query(`select string_agg(titlu || '|' || coalesce(domeniu,'') || '|' || coalesce(unitate_masura,''), ';' order by id) x from public.catalog_servicii`)).rows[0].x === roInainte, 'coloanele românești neschimbate');
  const ascuns = (await db.query(`select (select traduceri::text from public.catalog_servicii where id_serviciu = 'ascuns') s, (select traduceri::text from public.catalog_niveluri where id = '00000000-0000-0000-0000-00000000bbbb') n`)).rows[0];
  verifica(ascuns.s === '{}' && ascuns.n === '{}', `produsul ascuns și nivelul lui neatinse: ${JSON.stringify(ascuns)}`);
  const ex = (await db.query(`select traduceri->'en' en from public.catalog_servicii where id_serviciu = 'acoperis-sarpanta'`)).rows[0].en;
  verifica(ex && ex.titlu === 'Roofing & Roof Timbers' && ex.unitate_masura === undefined, `exemplu acoperis-sarpanta: ${JSON.stringify(ex)} (m² rămâne m²)`);
  const unit = (await db.query(`select traduceri->'en'->>'unitate_masura' u from public.catalog_servicii where unitate_masura = 'buc' limit 1`)).rows[0].u;
  verifica(unit === 'pcs', `unitatea buc → pcs (${unit})`);

  console.log('3. A doua rulare');
  const s1 = await instantaneu(db);
  await db.exec(MIGRARE);
  verifica(s1 === await instantaneu(db), 'a doua rulare nu schimbă nimic');
  await db.close();

  console.log('4. etape_lucrare ca text[]');
  const db2 = await baza('text[]');
  await db2.exec(MIGRARE);
  const d2 = await lipsa(db2);
  verifica(d2.s + d2.n + d2.c === 0, `text[]: ${JSON.stringify(d2)}`);
  const et = (await db2.query(`select traduceri->'en'->'etape_lucrare' e from public.catalog_servicii where etape_lucrare is not null`)).rows[0].e;
  verifica(Array.isArray(et) && et.length === 5 && /screed/.test(et[0]), `etapele traduse: ${JSON.stringify(et && et[0])}`);
  await db2.close();

  console.log('5. Un titlu schimbat după 13 nov.');
  const db3 = await baza('jsonb', `update public.catalog_servicii set titlu = 'Înlocuire calorifer (nou)' where id_serviciu = 'inlocuire-calorifer';`);
  const s3 = await instantaneu(db3);
  let eroare = null;
  try { await db3.exec(MIGRARE); } catch (e) { eroare = e.message; }
  verifica(eroare && /Fără engleză: 1 produse publice/.test(eroare), `migrarea se oprește cu mesaj clar: ${eroare}`);
  try { await db3.exec('rollback'); } catch (e) {}
  verifica(s3 === await instantaneu(db3), 'rollback: nimic schimbat');
  await db3.close();

  console.log('6. Un produs public nou, fără engleză');
  const db4 = await baza('jsonb', `insert into public.catalog_servicii (id, titlu, status_public) values ('00000000-0000-0000-0000-00000000cccc', 'Produs nou', true);`);
  eroare = null;
  try { await db4.exec(MIGRARE); } catch (e) { eroare = e.message; }
  verifica(eroare && /00000000-0000-0000-0000-00000000cccc/.test(eroare), `mesajul numește rândul: ${eroare}`);
  await db4.close();

  console.log(`\n${ok} verificări trecute, ${esec} eșuate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
