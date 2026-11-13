// scripts/genereaza-traduceri-11t1.js
// Pasul 11-T1 (13 nov. 2026): generează migrarea propusă cu traducerile în engleză ale
// conținutului public din baza de date și CSV-ul pentru verificarea lui LM.
//
// Intrări:
//   docs/traduceri/11t1_continut_public.json — conținutul public actual (136 de servicii,
//     275 de niveluri, 81 de categorii), citit din Supabase REST cu cheia anon, aceleași
//     citiri ca paginile publice (doar citire);
//   scripts/traduceri-catalog-en.sql — traducerile din 10 oct. 2026 (pe id), niciodată
//     aplicate; acoperă toate rândurile actuale, mai puțin unitatea de măsură;
//   CORECTII / TERMENI / UNITATI de mai jos — engleza britanică din construcții și instalații
//     (consumer unit, catalogue, emulsion, shower enclosure) și textele refăcute.
// Ieșiri:
//   docs/migrations-propuse/2026-11-12_traduceri_en_catalog.sql
//   docs/traduceri/11t1_catalog_en.csv (tabel, id, câmp, română, engleză)
//
// Rulare: node scripts/genereaza-traduceri-11t1.js [--verifica]
//   --verifica: nu scrie nimic; iese cu 1 dacă fișierele generate diferă de cele din repo.

const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const DATE = JSON.parse(fs.readFileSync(path.join(R, 'docs/traduceri/11t1_continut_public.json'), 'utf8'));
const SQL_VECHI = fs.readFileSync(path.join(R, 'scripts/traduceri-catalog-en.sql'), 'utf8');
const IESIRE_SQL = path.join(R, 'docs/migrations-propuse/2026-11-12_traduceri_en_catalog.sql');
const IESIRE_CSV = path.join(R, 'docs/traduceri/11t1_catalog_en.csv');

// ── Traducerile din octombrie, pe id ──────────────────────────────────────
const VECHI = {};
for (const m of SQL_VECHI.matchAll(/update public\.(\w+) set traduceri = jsonb_set\(traduceri, '\{en\}', '(.*?)'::jsonb\) where id = '([^']+)';/g)) {
  VECHI[m[1] + ':' + m[3]] = JSON.parse(m[2].replace(/''/g, "'"));
}

// ── Termeni: engleza britanică din construcții (aplicat pe orice traducere) ─
const TERMENI = [
  [/\bfuse boards\b/g, 'consumer units'], [/\bFuse boards\b/g, 'Consumer units'], [/\bFuse Boards\b/g, 'Consumer Units'],
  [/\bfuse board\b/g, 'consumer unit'], [/\bFuse board\b/g, 'Consumer unit'], [/\bFuse Board\b/g, 'Consumer Unit'],
  [/\bcatalog\b/g, 'catalogue'],
  [/\bwashable and epoxy paints\b/g, 'washable emulsions and epoxy paints'],
  [/\bwashable paint\b/g, 'washable emulsion'],
  [/\bshower cabins\b/g, 'shower enclosures'], [/\bShower cabins\b/g, 'Shower enclosures'],
  [/\bRoof Frames\b/g, 'Roof Timbers'], [/\broof frames\b/g, 'roof timbers'],
];
const termeni = (s) => TERMENI.reduce((x, [a, b]) => x.replace(a, b), s);

// ── Corecturi pe textul român exact ───────────────────────────────────────
const CORECTII = {
  'Acoperiș & Șarpantă': 'Roofing & Roof Timbers',
  'Acoperișuri & Șarpante': 'Roofing & Roof Timbers',
  'Tablou electric': 'Consumer units',
  'Tablou metalic 12 module recessed': 'Metal consumer unit, 12 modules, flush-mounted',
  'Reparație / Înlocuire elemente tablou': 'Consumer unit component repair / replacement',
};
// Produsele de test din catalog (sufix „vN”): nivelurile lor au descrieri generate,
// „Material tip <nume> - Nivel <NIVEL>. Livrare rapida din stoc public de bricolaj.”
const PRODUSE_TEST = {
  'Adeziv gresie/faianta sac 25kg v8': 'Tile adhesive, 25 kg bag v8',
  'Cablu electric CYY-F 3x2.5 m v10': 'CYY-F 3×2.5 electrical cable v10',
  'Cot cupru 90 grade 15mm v5': '90° copper elbow, 15 mm v5',
  'Filtru Y pentru impuritati 3/4 v6': '3/4" Y strainer v6',
  'Garnitura siliconica set 10 buc v7': 'Silicone seals, set of 10 v7',
  'Priza dubla ceramica Schneider v2': 'Schneider double ceramic socket v2',
  'Robinet trecere sferic 1/2 v1': '1/2" ball valve v1',
  'Siguranta automata diferentiala 16A v3': '16 A residual current circuit breaker v3',
  'Teava cupru 15mm v4': '15 mm copper pipe v4',
  'Vopsea lavabila alba 15L v9': 'White washable emulsion, 15 L v9',
};
const NIVEL = { BRONZ: 'BRONZE', ARGINT: 'SILVER', AUR: 'GOLD', PLATINUM: 'PLATINUM' };
function descriereTest(ro) {
  const m = ro.match(/^Material tip (.+) - Nivel (BRONZ|ARGINT|AUR|PLATINUM)\. Livrare rapida din stoc public de bricolaj\.$/);
  if (!m) return null;
  if (!PRODUSE_TEST[m[1]]) throw new Error('Produs de test fără traducere: ' + m[1]);
  return `${PRODUSE_TEST[m[1]]} material - ${NIVEL[m[2]]} level. Fast delivery from public DIY stock.`;
}

// ── Unitățile de măsură (doar unde engleza diferă) ─────────────────────────
// „ml” = metru liniar în tot catalogul (profile, conducte, plinte) → „lm”.
const UNITATI = {
  buc: 'pcs', 'buc/kg': 'pcs/kg', mp: 'm²', mc: 'm³', m3: 'm³', ml: 'lm', 'ml/buc': 'lm/pc', 'kg/ml': 'kg/lm', 'm³/ml': 'm³/lm',
  'oră': 'hour', ore: 'hours', zi: 'day', zile: 'days', 'săptămâni': 'weeks', 'set/zi': 'set/day',
  'interv.': 'call-out', proiect: 'project', sesiune: 'session', punct: 'point', sac: 'bag', 'găleată': 'tub',
};
const LA_FEL = new Set(['m', 'm²', 'km', 'set', '']);

function traduce(tabel, r, camp) {
  const ro = r[camp];
  if (camp === 'unitate_masura') {
    if (LA_FEL.has(ro)) return null;
    if (!UNITATI[ro]) throw new Error('Unitate fără traducere: ' + ro);
    return UNITATI[ro];
  }
  if (typeof ro === 'string' && CORECTII[ro]) return CORECTII[ro];
  if (tabel === 'catalog_niveluri' && camp === 'descriere') { const t = descriereTest(ro); if (t) return t; }
  const v = (VECHI[tabel + ':' + r.id] || {})[camp];
  if (v == null) throw new Error(`Fără traducere: ${tabel} ${r.id} ${camp}`);
  return Array.isArray(v) ? v.map(termeni) : termeni(v);
}

const SURSE = [
  { tabel: 'catalog_servicii', campuri: ['titlu', 'domeniu', 'descriere', 'etape_lucrare', 'instructiuni_intretinere', 'unitate_masura'] },
  { tabel: 'catalog_niveluri', campuri: ['label', 'descriere'] },
  { tabel: 'categorii', campuri: ['title', 'description'] },
];
const gol = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
const sqlText = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const sqlJson = (o) => sqlText(JSON.stringify(o)) + '::jsonb';

const randuri = []; // { tabel, id, en:{...}, ro:{...} }
const csv = [['tabel', 'id', 'camp', 'romana', 'engleza']];
const dictionar = new Map(); // text român → engleză (dicționarul aplicat de i18n-loader.js trebuie să fie unic)
const conflicte = [];
const numar = { catalog_servicii: 0, catalog_niveluri: 0, categorii: 0 };
for (const s of SURSE) {
  for (const r of DATE[s.tabel]) {
    const existent = (r.traduceri && r.traduceri.en) || {};
    const en = {}, ro = {};
    for (const c of s.campuri) {
      if (gol(r[c])) continue;
      const t = traduce(s.tabel, r, c);
      if (t == null) continue;
      ro[c] = r[c];
      const vechi = existent[c];
      // ce există deja în producție rămâne; intră în dicționar ca atare
      const final = gol(vechi) ? t : vechi;
      if (gol(vechi)) en[c] = t;
      const perechi = Array.isArray(r[c]) ? r[c].map((x, i) => [x, final[i]]) : [[r[c], final]];
      for (const [a, b] of perechi) {
        const k = String(a).replace(/\s+/g, ' ').trim();
        if (dictionar.has(k) && dictionar.get(k) !== b) conflicte.push(`${k}: „${dictionar.get(k)}” / „${b}”`);
        dictionar.set(k, b);
      }
      if (gol(vechi)) csv.push([s.tabel, r.id, c, Array.isArray(r[c]) ? r[c].join(' | ') : r[c], Array.isArray(t) ? t.join(' | ') : t]);
    }
    if (s.tabel === 'categorii' && gol(r.title_en)) en.__title_en = (existent.title || en.title);
    if (Object.keys(en).length) { randuri.push({ tabel: s.tabel, id: r.id, en, ro }); numar[s.tabel]++; }
  }
}
if (conflicte.length) { console.error('Același text român cu traduceri diferite:\n  ' + conflicte.join('\n  ')); process.exit(1); }

// ── Migrarea ──────────────────────────────────────────────────────────────
const L = [];
L.push(`-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — pasul 11-T1 (13 noiembrie 2026)
-- Traducerile în engleză ale conținutului public din baza de date
-- ═══════════════════════════════════════════════════════════════════
--
-- Generat de scripts/genereaza-traduceri-11t1.js — nu se editează de mână.
-- Verificarea textelor: docs/traduceri/11t1_catalog_en.csv (tabel, id, câmp, română, engleză).
--
-- Problema (citire 13 nov. 2026, Supabase REST public, cheia anon)
--   catalog_servicii publice: 136, dintre care 10 cu traduceri.en (doar titlul);
--   catalog_niveluri ale produselor publice: 275, niciunul cu traduceri.en;
--   categorii: 81, niciuna cu title_en sau traduceri.en.
--   În modul EN, 126 de produse, toate nivelurile și toate categoriile apar în română.
--
-- Ce face
--   Completează traduceri.en, câmp cu câmp, DOAR unde lipsește: o cheie existentă în
--   traduceri.en nu se suprascrie (fuziunea pune valorile existente peste cele noi):
--     catalog_servicii publice  — titlu, domeniu, descriere, etape_lucrare,
--                                 instructiuni_intretinere, unitate_masura (unde diferă);
--     catalog_niveluri publice  — label, descriere;
--     categorii                 — traduceri.en (title, description) și title_en (dacă e gol).
--   Fiecare update se aplică doar dacă textul român e cel tradus (același id și același
--   text): un rând modificat între timp nu primește o traducere greșită și apare la
--   verificarea de la final.
--   Coloana traduceri vine din 2026-10-10_traduceri_catalog.sql (aplicată: 10 produse
--   au deja traduceri.en).
--
-- Cine o citește
--   /api/public/traduceri-catalog?lang=en (dicționarul aplicat de i18n-loader.js pe pagini)
--   și /api/public/catalog, /api/public/catalog-categorie la lang=en.
--
-- Rânduri completate: catalog_servicii ${numar.catalog_servicii}, catalog_niveluri ${numar.catalog_niveluri}, categorii ${numar.categorii}.
--
-- De verificat de LM, separat de traducere (conținut, nu limbă):
--   - 3 niveluri au în descriere note interne afișate public („PLACEHOLDER — norma de timp
--     … NU e reală”, „placeholder — de confirmat de admin”); traduse fidel;
--   - 10 produse de test sunt publice; nivelurile lor au descrieri „Material tip … v1…v10”.
--
-- Rulabil de mai multe ori fără erori. LM o aplică în SQL Editor înainte de merge.
-- ═══════════════════════════════════════════════════════════════════

begin;
`);
let tabelCurent = null;
for (const r of randuri) {
  if (r.tabel !== tabelCurent) { tabelCurent = r.tabel; L.push(`\n-- ${r.tabel}`); }
  const titluEn = r.en.__title_en; delete r.en.__title_en;
  const filtruPublic = r.tabel === 'catalog_servicii' ? ' and status_public'
    : r.tabel === 'catalog_niveluri' ? ' and exists (select 1 from public.catalog_servicii s where s.id = serviciu_id and s.status_public)' : '';
  // etape_lucrare e text[] sau jsonb: comparația se face pe forma jsonb
  const cond = Object.entries(r.ro).map(([c, v]) => Array.isArray(v) ? `to_jsonb(${c}) = ${sqlJson(v)}` : `${c} = ${sqlText(v)}`).join(' and ');
  const set = [`traduceri = jsonb_set(coalesce(traduceri, '{}'::jsonb), '{en}', ${sqlJson(r.en)} || coalesce(traduceri->'en', '{}'::jsonb))`];
  if (titluEn) set.push(`title_en = coalesce(nullif(title_en, ''), ${sqlText(titluEn)})`);
  L.push(`update public.${r.tabel} set ${set.join(', ')} where id = '${r.id}'${filtruPublic} and ${cond};`);
}
L.push(`
-- ── Verificare: 0 produse publice, 0 niveluri și 0 categorii fără engleză ──
do $$
declare
  s int; n int; c int; exemple text;
begin
  select count(*) into s from public.catalog_servicii
   where status_public and coalesce(traduceri->'en'->>'titlu', '') = '';
  select count(*) into n from public.catalog_niveluri nv
   where exists (select 1 from public.catalog_servicii x where x.id = nv.serviciu_id and x.status_public)
     and ((coalesce(nv.descriere, '') <> '' and coalesce(nv.traduceri->'en'->>'descriere', '') = '')
       or (coalesce(nv.label, '') <> '' and coalesce(nv.traduceri->'en'->>'label', '') = ''));
  select count(*) into c from public.categorii
   where coalesce(title_en, '') = '' or coalesce(traduceri->'en'->>'title', '') = '';
  if s + n + c > 0 then
    select string_agg(id::text, ', ') into exemple from (
      (select id from public.catalog_servicii where status_public and coalesce(traduceri->'en'->>'titlu', '') = '' limit 5)
      union all
      (select id from public.categorii where coalesce(title_en, '') = '' or coalesce(traduceri->'en'->>'title', '') = '' limit 5)
    ) x;
    raise exception 'Fără engleză: % produse publice, % niveluri, % categorii (ex.: %). Rândurile au fost modificate sau adăugate după 13 nov. 2026: se regenerează migrarea.', s, n, c, coalesce(exemple, '—');
  end if;
  raise notice 'Traduceri EN complete: produse publice, niveluri și categorii.';
end $$;

commit;
`);
const sql = L.join('\n');
const csvText = '﻿' + csv.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\r\n') + '\r\n';

if (process.argv.includes('--verifica')) {
  // fără diferențe de sfârșit de linie (git poate schimba LF ↔ CRLF la checkout)
  const lf = (t) => t.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  const a = fs.existsSync(IESIRE_SQL) && lf(fs.readFileSync(IESIRE_SQL, 'utf8')) === lf(sql);
  const b = fs.existsSync(IESIRE_CSV) && lf(fs.readFileSync(IESIRE_CSV, 'utf8')) === lf(csvText);
  console.log(a && b ? 'Fișierele generate sunt la zi.' : 'Fișierele generate diferă: rulează scripts/genereaza-traduceri-11t1.js');
  process.exit(a && b ? 0 : 1);
}
fs.writeFileSync(IESIRE_SQL, sql);
fs.writeFileSync(IESIRE_CSV, csvText);
console.log(`Rânduri: catalog_servicii ${numar.catalog_servicii}, catalog_niveluri ${numar.catalog_niveluri}, categorii ${numar.categorii}; perechi în CSV: ${csv.length - 1}; texte distincte în dicționar: ${dictionar.size}`);
