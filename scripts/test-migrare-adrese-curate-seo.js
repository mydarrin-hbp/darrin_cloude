// scripts/test-migrare-adrese-curate-seo.js
// Test SQL pentru migrarea pasului 12-U1
// (docs/migrations-propuse/2026-11-19_adrese-curate-seo.sql), pe un Postgres
// local (PGlite). Nimic nu ajunge în Supabase.
//
// Schema de pornire copiază live-ul (19 nov. 2026): seo_config cu cheia unică
// (page_path, limba) și coloanele OG, seo_campanii_social cu cheia unică
// (page_path, limba, nume_campanie); rândurile sunt cele din live (căile,
// limbile, datele), cu texte de test.
//
// Verifică:
//   1. harta din SQL = lib/seo-pagini.js → ALIASURI (adresele curate);
//   2. migrarea rulează de două ori, fără erori; a doua oară nu schimbă nimic;
//   3. fiecare rând de pe o adresă veche e pe adresa nouă; ciocnirile (două
//      rânduri pe aceeași cheie) păstrează rândul cel mai recent, iar celelalte
//      sunt în seo_arhiva_adrese_12u1, întregi;
//   4. canonical_url / url_destinatie: calea veche din link → calea nouă,
//      parametrii păstrați; /parteneri-x sau alt domeniu rămân neatinse;
//   5. tabelul de arhivă: RLS activ, anon / authenticated fără acces.
// Rulare: node scripts/test-migrare-adrese-curate-seo.js

const fs = require('fs');
const path = require('path');
const SP = require('../lib/seo-pagini');

const MIGRARE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations-propuse', '2026-11-19_adrese-curate-seo.sql'), 'utf8');
let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

const SCHEMA = `
create role anon nologin;
create role authenticated nologin;
create table public.seo_config (
  id uuid primary key default gen_random_uuid(),
  page_path text not null, meta_title text, meta_description text, canonical_url text,
  updated_at timestamptz not null default now(), updated_by uuid,
  limba text not null default 'ro', og_titlu text, og_descriere text, og_imagine_url text,
  og_imagine_alt text, og_imagine_latime int, og_imagine_inaltime int,
  constraint seo_config_page_path_limba_key unique (page_path, limba)
);
create table public.seo_campanii_social (
  id uuid primary key default gen_random_uuid(),
  page_path text not null, limba text not null, nume_campanie text not null,
  url_destinatie text, stare text not null default 'ciorna',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint seo_campanii_social_unic unique (page_path, limba, nume_campanie)
);
grant select on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant select on tables to anon, authenticated;
`;

// Rândurile din live (19 nov. 2026), cu texte de test.
const D = 'https://mydarrin.homebestpal.com';
const RANDURI = `
insert into public.seo_config (page_path, limba, updated_at, og_titlu, canonical_url) values
  ('/', 'en', '2026-11-13 14:06:06+00', 'Acasa EN', null),
  ('/', 'ro', '2026-11-13 14:06:22+00', 'Acasa RO', null),
  ('/cum-devii-partenerul-nostru', 'en', '2026-11-11 18:33:03+00', 'Hub EN', null),
  ('/cum-devii-partenerul-nostru', 'ro', '2026-11-14 19:33:30+00', 'Hub RO', '${D}/cum-devii-partenerul-nostru?lang=ro'),
  ('/investitor', 'en', '2026-11-13 20:38:57+00', 'Inv EN', null),
  ('/investitor', 'ro', '2026-11-13 20:43:37+00', 'Inv RO', '${D}/investitor'),
  ('/mydarrin-catalog', 'en', '2026-11-11 18:24:46+00', 'Cat EN', null),
  ('/mydarrin-catalog', 'ro', '2026-11-17 21:15:23+00', 'Cat RO', '${D}/mydarrin-catalog#top'),
  ('/mydarrin-serviciu', 'en', '2026-10-31 15:04:38+00', 'Serv EN', null),
  ('/mydarrin-serviciu', 'ro', '2026-10-31 15:05:37+00', 'Serv RO', null),
  ('/partener', 'ro', '2026-10-31 15:07:09+00', 'Partener vechi', null),
  ('/despre-noi', 'ro', '2026-11-01 10:00:00+00', 'Despre', '${D}/despre-noi-x'),
  ('/termeni', 'ro', '2026-11-02 10:00:00+00', 'Termeni', 'https://alt-domeniu.ro/mydarrin-termeni');
insert into public.seo_campanii_social (page_path, limba, nume_campanie, url_destinatie, updated_at) values
  ('/partener', 'en', 'Parteneri nov', null, '2026-11-10 10:00:00+00'),
  ('/partener', 'ro', 'Parteneri nov', '${D}/partener?utm_source=facebook', '2026-11-10 10:00:00+00'),
  ('/cum-devii-partenerul-nostru', 'ro', 'Parteneri nov', '${D}/cum-devii-partenerul-nostru', '2026-11-12 10:00:00+00'),
  ('/mydarrin-catalog', 'ro', 'Catalog', '${D}/mydarrin-catalog?utm_campaign=x#f', '2026-11-12 10:00:00+00');
`;

(async () => {
  let PGlite;
  try { ({ PGlite } = require('@electric-sql/pglite')); }
  catch (e) { console.log('PGlite lipsește: npm i --no-save @electric-sql/pglite'); process.exit(1); }

  // 1. Harta din SQL = ALIASURI.
  console.log('1. Harta adreselor');
  const dinSql = new Map([...MIGRARE.matchAll(/\('(\/[^']*)', '(\/[^']*)'\)/g)].map((m) => [m[1], m[2]]));
  const asteptat = Object.entries(SP.ALIASURI).filter(([v, n]) => v !== n && v !== '/index' && v !== '/home');
  verifica(dinSql.size === asteptat.length, `harta are ${dinSql.size} perechi, ALIASURI ${asteptat.length}`);
  for (const [v, n] of asteptat) verifica(dinSql.get(v) === n, `harta: ${v} → ${dinSql.get(v)} (aștept ${n})`);
  verifica(/^begin;/m.test(MIGRARE) && /^commit;/m.test(MIGRARE), 'o singură tranzacție (begin / commit)');
  verifica(!/security definer/i.test(MIGRARE) && !/create (or replace )?function/i.test(MIGRARE), 'fără funcții noi');

  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(RANDURI);

  // 2. De două ori.
  console.log('2. Rulare de două ori');
  let eroare = null;
  try { await db.exec(MIGRARE); } catch (e) { eroare = e.message; }
  verifica(!eroare, 'prima rulare: ' + eroare);
  const instantaneu = async () => JSON.stringify((await db.query(`select page_path, limba, og_titlu, canonical_url from public.seo_config order by 1, 2`)).rows) +
    JSON.stringify((await db.query(`select page_path, limba, nume_campanie, url_destinatie from public.seo_campanii_social order by 1, 2, 3`)).rows) +
    JSON.stringify((await db.query(`select count(*)::int n from public.seo_arhiva_adrese_12u1`)).rows);
  const dupaPrima = await instantaneu();
  eroare = null;
  try { await db.exec(MIGRARE); } catch (e) { eroare = e.message; }
  verifica(!eroare, 'a doua rulare: ' + eroare);
  verifica(await instantaneu() === dupaPrima, 'a doua rulare a schimbat ceva');

  // 3. Rândurile.
  console.log('3. seo_config');
  const cfg = (await db.query(`select page_path, limba, og_titlu, canonical_url from public.seo_config order by 1, 2`)).rows;
  const g = (p, l) => cfg.find((r) => r.page_path === p && r.limba === l);
  verifica(!cfg.some((r) => dinSql.has(r.page_path)), 'a rămas un rând pe o adresă veche: ' + cfg.filter((r) => dinSql.has(r.page_path)).map((r) => r.page_path));
  verifica(g('/', 'ro') && g('/', 'en'), 'pagina de start rămâne neschimbată');
  verifica(g('/parteneri', 'ro') && g('/parteneri', 'ro').og_titlu === 'Hub RO', '/parteneri ro: rămâne rândul cel mai recent (14 nov.)');
  verifica(g('/parteneri', 'en') && g('/parteneri', 'en').og_titlu === 'Hub EN', '/parteneri en');
  verifica(g('/investitori', 'ro') && g('/investitori', 'en'), '/investitor → /investitori');
  verifica(g('/catalog', 'ro') && g('/catalog', 'ro').og_titlu === 'Cat RO' && g('/catalog', 'en').og_titlu === 'Cat EN', '/catalog: rămân rândurile /mydarrin-catalog (mai noi)');
  verifica(g('/despre', 'ro'), '/despre-noi → /despre');
  verifica(cfg.length === 10, `10 rânduri în seo_config (sunt ${cfg.length})`);
  console.log('4. Linkurile din rânduri');
  verifica(g('/parteneri', 'ro').canonical_url === D + '/parteneri?lang=ro', 'canonical cu parametri: ' + g('/parteneri', 'ro').canonical_url);
  verifica(g('/investitori', 'ro').canonical_url === D + '/investitori', 'canonical: ' + g('/investitori', 'ro').canonical_url);
  verifica(g('/catalog', 'ro').canonical_url === D + '/catalog#top', 'canonical cu ancoră: ' + g('/catalog', 'ro').canonical_url);
  verifica(g('/despre', 'ro').canonical_url === D + '/despre-noi-x', 'o cale care doar începe la fel rămâne: ' + g('/despre', 'ro').canonical_url);
  verifica(g('/termeni', 'ro').canonical_url === 'https://alt-domeniu.ro/mydarrin-termeni', 'alt domeniu rămâne neatins');

  console.log('3b. seo_campanii_social');
  const camp = (await db.query(`select page_path, limba, nume_campanie, url_destinatie from public.seo_campanii_social order by 1, 2, 3`)).rows;
  verifica(!camp.some((r) => dinSql.has(r.page_path)), 'a rămas o campanie pe o adresă veche');
  const cRo = camp.find((r) => r.page_path === '/parteneri' && r.limba === 'ro');
  verifica(cRo && cRo.url_destinatie === D + '/parteneri', 'campania ro: rămâne cea mai recentă, cu linkul nou: ' + (cRo && cRo.url_destinatie));
  verifica(camp.some((r) => r.page_path === '/parteneri' && r.limba === 'en'), 'campania en pe /parteneri');
  const cCat = camp.find((r) => r.page_path === '/catalog');
  verifica(cCat && cCat.url_destinatie === D + '/catalog?utm_campaign=x#f', 'url_destinatie cu UTM și ancoră: ' + (cCat && cCat.url_destinatie));

  console.log('3c. Arhiva');
  const arh = (await db.query(`select tabel, cale_veche, cale_noua, rand from public.seo_arhiva_adrese_12u1 order by tabel, cale_veche, rand->>'limba'`)).rows;
  const arhCfg = arh.filter((a) => a.tabel === 'seo_config');
  verifica(arhCfg.length === 3, `3 rânduri seo_config arhivate (sunt ${arhCfg.length})`);
  verifica(arhCfg.some((a) => a.cale_veche === '/partener' && a.cale_noua === '/parteneri' && a.rand.og_titlu === 'Partener vechi'), '/partener ro arhivat întreg');
  verifica(arhCfg.filter((a) => a.cale_veche === '/mydarrin-serviciu' && a.cale_noua === '/catalog').length === 2, '/mydarrin-serviciu (ro, en) arhivate');
  const arhCamp = arh.filter((a) => a.tabel === 'seo_campanii_social');
  verifica(arhCamp.length === 1 && arhCamp[0].cale_veche === '/partener' && arhCamp[0].rand.url_destinatie === D + '/partener?utm_source=facebook', 'campania ro mai veche arhivată, cu linkul ei original');

  console.log('5. Drepturile pe arhivă');
  const rls = (await db.query(`select relrowsecurity from pg_class where oid = 'public.seo_arhiva_adrese_12u1'::regclass`)).rows[0];
  verifica(rls && rls.relrowsecurity === true, 'RLS activ pe arhivă');
  const drept = (await db.query(`select has_table_privilege('anon', 'public.seo_arhiva_adrese_12u1', 'select') a, has_table_privilege('authenticated', 'public.seo_arhiva_adrese_12u1', 'select') b`)).rows[0];
  verifica(!drept.a && !drept.b, 'anon / authenticated nu citesc arhiva');

  await db.close();
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exitCode = esec ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
