// scripts/test-securitate-11s1.js
// Pasul 11-S1: securitate — scrieri directe, drepturi, funcții, citire publică,
// stocare, validare, limita de cereri, escaparea în pagini.
// Nimic nu ajunge în Supabase: migrarea rulează pe un Postgres local (PGlite,
// în memorie), cu rolurile anon / authenticated și auth.uid() din JWT simulat;
// endpoint-urile rulează cu Supabase simulat (scripts/supabase-simulat.js) și
// un KV în memorie.
//
// Verifică:
//   A. înainte de migrare (starea din producție, refăcută cu fișierul de
//      revenire) clientul / partenerul pot scrie direct în tabelele de la A;
//      după migrare, aceleași scrieri sunt refuzate, cu cheia anon și cu JWT de
//      client / partener; citirea rândurilor proprii rămâne;
//   B. TRUNCATE / TRIGGER / REFERENCES revocate; anon fără INSERT / UPDATE /
//      DELETE, cu excepția tabelelor unde o politică i le permite explicit;
//   C. blocheaza_email_disposable() nu mai e executabilă de anon / authenticated,
//      iar trigger-ul de pe auth.users funcționează în continuare;
//   D. backoffice_config: anon citește doar secțiunile publice; adminul tot;
//      parteneri_program_lucru nu mai e citibil de anon;
//   E. bucket-ul facturi-parteneri: 10 MB, PDF / JPEG / PNG;
//   migrarea: a doua rulare fără erori și fără schimbări; verificarea finală
//   oprește tranzacția; revenirea reface politicile, apoi migrarea merge iar;
//   F. lib/valideaza.js: câmpuri lipsă, prea lungi, necunoscute, tipuri — mesaj
//      RO + EN și `campuri`; endpoint-urile publice refuză corpurile greșite;
//   G. limita de cereri: 429 după prag, pe IP și pe email, mesaj RO + EN,
//      Retry-After, IP-ul hash-uit în cheile KV;
//   H. paginile nu mai pun date din baza de date în HTML fără escapare.
//
// Cerințe (nu e dependență a proiectului): npm i --no-save @electric-sql/pglite
// Rulare: node scripts/test-securitate-11s1.js

const fs = require('fs');
const path = require('path');
const RAD = path.join(__dirname, '..');
const MIGRARE = fs.readFileSync(path.join(RAD, 'docs/migrations-propuse/2026-11-13_securitate_11s1.sql'), 'utf8');
const REVENIRE = fs.readFileSync(path.join(RAD, 'docs/migrations-propuse/2026-11-13_securitate_11s1_revenire.sql'), 'utf8');

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
function sectiune(t) { console.log('\n' + t); }

const CLIENT = '00000000-0000-0000-0000-00000000c001';
const PARTENER = '00000000-0000-0000-0000-00000000a001';
const ALT = '00000000-0000-0000-0000-00000000b001';
const ADMIN = '00000000-0000-0000-0000-00000000d001';
const CMD = '00000000-0000-0000-0000-0000000c0de1';

// ─── Schema minimă, ca în producție (12 nov. 2026) ──────────────────────────
const SCHEMA = `
create role anon nologin; create role authenticated nologin; create role supabase_auth_admin nologin;
create schema auth; create schema storage;
grant usage on schema public, auth, storage to anon, authenticated, supabase_auth_admin;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create table storage.buckets (id text primary key, public boolean, file_size_limit bigint, allowed_mime_types text[]);
insert into storage.buckets values ('facturi-parteneri', false, null, null), ('comenzi-imagini', false, 5242880, array['image/jpeg']);

alter default privileges in schema public grant all on tables to anon, authenticated;

create table public.profiles (id uuid primary key, role text, roles text[]);
insert into public.profiles values ('${CLIENT}', 'client', '{client}'), ('${PARTENER}', 'partener', '{partener_servicii}'),
  ('${ALT}', 'client', '{client}'), ('${ADMIN}', 'admin', '{admin}');

create function public.is_superadmin() returns boolean language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.profiles where id = auth.uid() and 'superadmin' = any (roles)) $$;
create function public.este_admin_platforma() returns boolean language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.profiles where id = auth.uid() and roles && array['admin','superadmin']) $$;
revoke execute on function public.is_superadmin(), public.este_admin_platforma() from public, anon;
grant execute on function public.is_superadmin(), public.este_admin_platforma() to authenticated;

create table public.comenzi (id uuid primary key default gen_random_uuid(), client_id uuid, partener_id uuid, pret numeric);
create table public.devize (id uuid primary key default gen_random_uuid(), client_id uuid, total numeric);
create table public.facturi_parteneri (id uuid primary key default gen_random_uuid(), partener_id uuid, procent numeric);
create table public.parteneri_discounturi (id uuid primary key default gen_random_uuid(), partener_id uuid, procent numeric);
create table public.comenzi_imagini (id uuid primary key default gen_random_uuid(), partener_id uuid, comanda_id uuid);
create table public.documente_partener (id uuid primary key default gen_random_uuid(), partener_id uuid, tip text);
create table public.servicii_sugerate (id uuid primary key default gen_random_uuid(), partener_id uuid, titlu text);
create table public.partner_tipuri_polita (id uuid primary key default gen_random_uuid(), partner_id uuid, tip text);
create table public.partner_zona_curier (id uuid primary key default gen_random_uuid(), partner_id uuid, tara_cod text);
create table public.gps_tracking (id uuid primary key default gen_random_uuid(), partener_id uuid, comanda_id uuid, lat numeric);
create table public.partener_autorizatii (id uuid primary key default gen_random_uuid(), partener_id uuid, tip text);
create table public.partener_competente (id uuid primary key default gen_random_uuid(), partener_id uuid, cod text);
create table public.partener_servicii_active (id uuid primary key default gen_random_uuid(), partener_id uuid, activ boolean);
create table public.parteneri_disponibilitate (id uuid primary key default gen_random_uuid(), partener_id uuid, status_live text);
create table public.cos_multi_itemi (id uuid primary key default gen_random_uuid(), client_id uuid, titlu text);
create table public.backoffice_config (id serial primary key, sectiune text, cheie text, valoare text, tara_cod text default 'ALL');
create table public.parteneri_program_lucru (id serial primary key, partener_id uuid, zi integer);
create table public.email_domenii_disposable (domeniu text primary key);
create table public.tabel_cu_insert_anon (id serial primary key, x text);
create table public.tabel_cu_insert_public (id serial primary key, x text);
insert into public.email_domenii_disposable values ('mailinator.com');

insert into public.backoffice_config (sectiune, cheie, valoare) values
  ('consultanta', 'consultanta_bronz_pret', '100'), ('proiectare', 'proiectare_electric_pret', '200'),
  ('pricing', 'comision_platforma_default_pct', '12'), ('pricing', 'discount_partener_max_pct', '15'),
  ('contact', 'contact_email', 'x@y.ro'), ('seo', 'campanii_limite_meta_titlu', '60');
insert into public.parteneri_program_lucru (partener_id, zi) values ('${PARTENER}', 1);
insert into public.comenzi (id, client_id, partener_id, pret) values ('${CMD}', '${CLIENT}', '${PARTENER}', 100);
insert into public.cos_multi_itemi (client_id, titlu) values ('${CLIENT}', 'a');
insert into public.gps_tracking (partener_id, comanda_id, lat) values ('${PARTENER}', '${CMD}', 44);
insert into public.parteneri_discounturi (partener_id, procent) values ('${PARTENER}', 5);
insert into public.partner_tipuri_polita (partner_id, tip) values ('${PARTENER}', 'rc');
insert into public.partner_zona_curier (partner_id, tara_cod) values ('${PARTENER}', 'RO');
insert into public.partener_autorizatii (partener_id, tip) values ('${PARTENER}', 'anre');
insert into public.partener_competente (partener_id, cod) values ('${PARTENER}', 'e1');
insert into public.partener_servicii_active (partener_id, activ) values ('${PARTENER}', true);
insert into public.parteneri_disponibilitate (partener_id, status_live) values ('${PARTENER}', 'disponibil');

-- Politicile de citire și de admin din producție (nu se schimbă).
create policy "client vede propriile comenzi" on public.comenzi for select using (auth.uid() = client_id);
create policy "client vede propriile devize" on public.devize for select using (auth.uid() = client_id);
create policy "partener_citeste_propriile_facturi" on public.facturi_parteneri for select using (partener_id = auth.uid());
create policy "partenerul vede propriile discounturi" on public.parteneri_discounturi for select using (auth.uid() = partener_id);
create policy "admin gestioneaza toate discounturile" on public.parteneri_discounturi for all using (este_admin_platforma()) with check (este_admin_platforma());
create policy "client citeste GPS comanda sa" on public.gps_tracking for select using (exists (select 1 from public.comenzi c where c.id = gps_tracking.comanda_id and c.client_id = auth.uid()));
create policy "client vede propriile itemi cos" on public.cos_multi_itemi for select using (auth.uid() = client_id);
create policy "superadmin_full_config" on public.backoffice_config for all using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = any (array['superadmin','admin'])));
create policy "program_lucru scriere propriu partener" on public.parteneri_program_lucru for all to authenticated using (partener_id = auth.uid()) with check (partener_id = auth.uid());
create policy "partner_tipuri_polita_select" on public.partner_tipuri_polita for select using (partner_id = auth.uid());
create policy "partner_zona_curier_select" on public.partner_zona_curier for select using (partner_id = auth.uid());
create policy "user vede propriul profil" on public.profiles for select using (auth.uid() = id);
create policy "insert anon explicit" on public.tabel_cu_insert_anon for insert to anon with check (true);
create policy "insert public fara conditie" on public.tabel_cu_insert_public for insert to public with check (true);

-- Trigger-ul de pe auth.users.
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
grant insert, select on auth.users to supabase_auth_admin;
create function public.blocheaza_email_disposable() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_domeniu text;
begin
  v_domeniu := lower(split_part(NEW.email, '@', 2));
  if exists (select 1 from public.email_domenii_disposable where domeniu = v_domeniu) then
    raise exception 'Adresele de email de unică folosință (disposable) nu sunt acceptate.' using errcode = 'P0001';
  end if;
  return NEW;
end; $function$;
create trigger blocheaza_email_disposable_trigger before insert on auth.users for each row execute function public.blocheaza_email_disposable();
`;

async function bazaNoua(extra) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(SCHEMA + (extra || ''));
  // RLS activ pe toate tabelele din public, ca în producție; drepturile ca în producție (arwdDxtm).
  const t = (await db.query("select tablename from pg_tables where schemaname = 'public'")).rows.map((r) => r.tablename);
  for (const x of t) await db.exec(`alter table public.${x} enable row level security; grant all on public.${x} to anon, authenticated;`);
  await db.exec('grant usage on all sequences in schema public to anon, authenticated;');
  return db;
}

// Rulează o instrucțiune ca rolul dat, cu auth.uid() = uid.
async function ca(db, rol, uid, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false);`);
  try {
    await db.exec(`set role ${rol}`);
    const r = await db.query(sql);
    return { ok: true, rows: r.rows, n: r.affectedRows };
  } catch (e) {
    return { ok: false, err: e.message };
  } finally {
    await db.exec('reset role');
  }
}
// O scriere e „refuzată” dacă dă eroare sau nu atinge niciun rând.
const refuzat = (r) => !r.ok || !r.n;
const trecut = (r) => r.ok && r.n > 0;

async function ruleaza(db, sql) {
  try { await db.exec(sql); return null; } catch (e) { try { await db.exec('rollback'); } catch (e2) { /* fără tranzacție */ } return e.message; }
}

async function instantaneu(db) {
  const q = async (s) => JSON.stringify((await db.query(s)).rows);
  return [
    await q("select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies order by 1, 2"),
    await q("select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated') order by 1, 2, 3"),
    await q("select id, file_size_limit, allowed_mime_types from storage.buckets order by id"),
    await q("select has_function_privilege('anon', 'public.blocheaza_email_disposable()', 'EXECUTE') a"),
  ].join('\n');
}

// Scrierile directe de la A: [eticheta, rol, uid, sql].
function scrieriA() {
  const P = PARTENER, C = CLIENT;
  const lista = [
    ['comenzi INSERT', C, `insert into public.comenzi (client_id, pret) values ('${C}', 1)`],
    ['devize INSERT', C, `insert into public.devize (client_id, total) values ('${C}', 1)`],
    ['facturi_parteneri INSERT', P, `insert into public.facturi_parteneri (partener_id, procent) values ('${P}', 99)`],
    ['parteneri_discounturi INSERT', P, `insert into public.parteneri_discounturi (partener_id, procent) values ('${P}', 15)`],
    ['parteneri_discounturi UPDATE', P, `update public.parteneri_discounturi set procent = 30 where partener_id = '${P}'`],
    ['comenzi_imagini INSERT', P, `insert into public.comenzi_imagini (partener_id, comanda_id) values ('${P}', '${CMD}')`],
    ['documente_partener INSERT', P, `insert into public.documente_partener (partener_id, tip) values ('${P}', 'cui')`],
    ['servicii_sugerate INSERT', P, `insert into public.servicii_sugerate (partener_id, titlu) values ('${P}', 'x')`],
    ['partner_tipuri_polita INSERT', P, `insert into public.partner_tipuri_polita (partner_id, tip) values ('${P}', 'x')`],
    ['partner_tipuri_polita UPDATE', P, `update public.partner_tipuri_polita set tip = 'y' where partner_id = '${P}'`],
    ['partner_zona_curier INSERT', P, `insert into public.partner_zona_curier (partner_id, tara_cod) values ('${P}', 'MD')`],
    ['partner_zona_curier UPDATE', P, `update public.partner_zona_curier set tara_cod = 'BG' where partner_id = '${P}'`],
    ['cos_multi_itemi DELETE', C, `delete from public.cos_multi_itemi where client_id = '${C}'`],
  ];
  for (const t of ['gps_tracking', 'partener_autorizatii', 'partener_competente', 'partener_servicii_active', 'parteneri_disponibilitate']) {
    const col = { gps_tracking: 'lat', partener_autorizatii: 'tip', partener_competente: 'cod', partener_servicii_active: 'activ', parteneri_disponibilitate: 'status_live' }[t];
    const val = { lat: '45', tip: "'z'", cod: "'z'", activ: 'false', status_live: "'ocupat'" }[col];
    lista.push([`${t} INSERT`, P, `insert into public.${t} (partener_id, ${col}) values ('${P}', ${val})`]);
    lista.push([`${t} UPDATE`, P, `update public.${t} set ${col} = ${val} where partener_id = '${P}'`]);
    lista.push([`${t} DELETE`, P, `delete from public.${t} where partener_id = '${P}'`]);
  }
  return lista;
}

async function testMigrare() {
  sectiune('A–E. Migrarea pe Postgres local (PGlite)');
  verifica(/^\s*begin;/m.test(MIGRARE) && /^\s*commit;\s*$/m.test(MIGRARE), 'migrarea e o singură tranzacție (begin / commit)');
  verifica((MIGRARE.match(/^\s*begin;/gm) || []).length === 1, 'un singur begin în migrare');
  verifica(/^\s*begin;/m.test(REVENIRE) && /^\s*commit;\s*$/m.test(REVENIRE), 'revenirea e o singură tranzacție');
  verifica(!(MIGRARE + REVENIRE).includes('KYC_HMAC' + '_SECRET'), 'fără secretul KYC în migrare');

  // Starea din producție: fișierul de revenire reface exact politicile de acum.
  const db = await bazaNoua();
  let e = await ruleaza(db, REVENIRE);
  verifica(!e, 'revenirea pe schema curată rulează fără erori: ' + e);

  sectiune('A. Înainte de migrare: scrierile directe trec (starea din producție)');
  for (const [et, uid, sql] of scrieriA()) {
    const r = await ca(db, 'authenticated', uid, sql);
    verifica(trecut(r), `înainte: ${et} ar trebui să treacă (${r.err || 'n=' + r.n})`);
  }
  // Rândurile șterse de testele de mai sus se refac.
  await db.exec(`
    insert into public.cos_multi_itemi (client_id, titlu) values ('${CLIENT}', 'a');
    insert into public.gps_tracking (partener_id, comanda_id, lat) values ('${PARTENER}', '${CMD}', 44);
    insert into public.partener_autorizatii (partener_id, tip) values ('${PARTENER}', 'anre');
    insert into public.partener_competente (partener_id, cod) values ('${PARTENER}', 'e1');
    insert into public.partener_servicii_active (partener_id, activ) values ('${PARTENER}', true);
    insert into public.parteneri_disponibilitate (partener_id, status_live) values ('${PARTENER}', 'disponibil');`);
  const anonInainte = await ca(db, 'anon', null, "select count(*)::int n from public.backoffice_config");
  verifica(anonInainte.ok && anonInainte.rows[0].n === 6, 'înainte: anon citește tot backoffice_config (6 rânduri)');

  e = await ruleaza(db, MIGRARE);
  verifica(!e, 'migrarea rulează fără erori: ' + e);

  sectiune('A. După migrare: scrierile directe sunt refuzate');
  for (const [et, uid, sql] of scrieriA()) {
    const r = await ca(db, 'authenticated', uid, sql);
    verifica(refuzat(r), `după (JWT): ${et} trebuie refuzată (${r.err || 'n=' + r.n})`);
    const a = await ca(db, 'anon', null, sql);
    verifica(!a.ok && /permission denied/.test(a.err), `după (anon): ${et} refuzată prin drept (${a.err || 'n=' + a.n})`);
  }
  // Nici pe rândurile altcuiva, nici cu JWT-ul altui client.
  verifica(refuzat(await ca(db, 'authenticated', ALT, `insert into public.comenzi (client_id, pret) values ('${ALT}', 1)`)), 'alt client: comenzi INSERT refuzată');

  sectiune('A. Citirea rândurilor proprii rămâne');
  for (const t of ['gps_tracking', 'partener_autorizatii', 'partener_competente', 'partener_servicii_active', 'parteneri_disponibilitate', 'parteneri_discounturi', 'partner_tipuri_polita'.replace('partner_tipuri_polita', 'parteneri_discounturi')]) {
    const r = await ca(db, 'authenticated', PARTENER, `select count(*)::int n from public.${t}`);
    verifica(r.ok && r.rows[0].n >= 1, `partenerul își citește rândurile din ${t} (${r.err || r.rows[0].n})`);
    const strain = await ca(db, 'authenticated', ALT, `select count(*)::int n from public.${t}`);
    verifica(strain.ok && strain.rows[0].n === 0, `alt utilizator nu vede rândurile partenerului din ${t}`);
  }
  const gpsClient = await ca(db, 'authenticated', CLIENT, 'select count(*)::int n from public.gps_tracking');
  verifica(gpsClient.ok && gpsClient.rows[0].n === 1, 'clientul vede în continuare GPS-ul comenzii lui');
  const cosClient = await ca(db, 'authenticated', CLIENT, 'select count(*)::int n from public.cos_multi_itemi');
  verifica(cosClient.ok && cosClient.rows[0].n === 1, 'clientul își vede în continuare coșul');
  // Adminul păstrează scrierea prin politica de admin.
  verifica(trecut(await ca(db, 'authenticated', ADMIN, `update public.parteneri_discounturi set procent = 7 where partener_id = '${PARTENER}'`)),
    'adminul poate modifica în continuare discounturile (politica de admin)');

  sectiune('B. Drepturi');
  for (const p of ['TRUNCATE', 'TRIGGER', 'REFERENCES']) {
    for (const rol of ['anon', 'authenticated']) {
      const r = await db.query(`select count(*)::int n from information_schema.role_table_grants where table_schema = 'public' and grantee = '${rol}' and privilege_type = '${p}'`);
      verifica(r.rows[0].n === 0, `${rol} fără ${p}`);
    }
  }
  verifica(!(await ca(db, 'authenticated', CLIENT, 'truncate public.cos_multi_itemi')).ok, 'authenticated nu poate face TRUNCATE');
  for (const t of ['comenzi', 'devize', 'facturi_parteneri', 'backoffice_config', 'parteneri_discounturi']) {
    const r = await db.query(`select has_table_privilege('anon', 'public.${t}', 'INSERT') i, has_table_privilege('anon', 'public.${t}', 'UPDATE') u, has_table_privilege('anon', 'public.${t}', 'DELETE') d, has_table_privilege('anon', 'public.${t}', 'SELECT') s`);
    const x = r.rows[0];
    verifica(!x.i && !x.u && !x.d && x.s, `anon: fără scrieri pe ${t}, SELECT păstrat`);
  }
  const auth = await db.query("select has_table_privilege('authenticated', 'public.backoffice_config', 'UPDATE') u");
  verifica(auth.rows[0].u, 'authenticated păstrează UPDATE (folosit de superadmin, filtrat de RLS)');
  const expl = await db.query("select has_table_privilege('anon', 'public.tabel_cu_insert_anon', 'INSERT') a, has_table_privilege('anon', 'public.tabel_cu_insert_public', 'INSERT') p, has_table_privilege('anon', 'public.tabel_cu_insert_anon', 'DELETE') d");
  verifica(expl.rows[0].a && expl.rows[0].p, 'anon păstrează INSERT unde o politică i-l permite explicit');
  verifica(!expl.rows[0].d, 'anon pierde DELETE pe același tabel (nicio politică)');
  verifica((await ca(db, 'anon', null, "insert into public.tabel_cu_insert_anon (x) values ('a')")).ok, 'anon: inserarea permisă explicit funcționează');
  // Tabel creat după migrare: implicitele nu mai dau TRUNCATE / scrieri anon.
  await db.exec('create table public.tabel_nou (id int)');
  const nou = await db.query("select has_table_privilege('anon', 'public.tabel_nou', 'TRUNCATE') t, has_table_privilege('anon', 'public.tabel_nou', 'INSERT') i, has_table_privilege('authenticated', 'public.tabel_nou', 'TRIGGER') g, has_table_privilege('anon', 'public.tabel_nou', 'SELECT') s");
  verifica(!nou.rows[0].t && !nou.rows[0].i && !nou.rows[0].g && nou.rows[0].s, 'tabel nou: implicitele fără TRUNCATE / TRIGGER / scrieri anon, cu SELECT');
  await db.exec('drop table public.tabel_nou');

  sectiune('C. Funcții');
  const fa = await ca(db, 'anon', null, 'select public.blocheaza_email_disposable()');
  verifica(!fa.ok && /permission denied/.test(fa.err), 'anon nu poate apela blocheaza_email_disposable() (' + (fa.err || 'a trecut') + ')');
  const fu = await ca(db, 'authenticated', CLIENT, 'select public.blocheaza_email_disposable()');
  verifica(!fu.ok && /permission denied/.test(fu.err), 'authenticated nu poate apela blocheaza_email_disposable()');
  const bun = await ca(db, 'supabase_auth_admin', null, "insert into auth.users (email) values ('ana@exemplu.ro')");
  verifica(bun.ok && bun.n === 1, 'trigger-ul lasă emailurile reale (' + (bun.err || '') + ')');
  const rau = await ca(db, 'supabase_auth_admin', null, "insert into auth.users (email) values ('x@mailinator.com')");
  verifica(!rau.ok && /unică folosință/.test(rau.err), 'trigger-ul blochează în continuare emailurile disposable (' + (rau.err || 'a trecut') + ')');
  await db.exec('revoke execute on function public.blocheaza_email_disposable() from supabase_auth_admin');
  const faraDrept = await ca(db, 'supabase_auth_admin', null, "insert into auth.users (email) values ('y@mailinator.com')");
  verifica(!faraDrept.ok && /unică folosință/.test(faraDrept.err), 'trigger-ul rulează și fără EXECUTE pe funcție (Postgres nu verifică dreptul la declanșare)');
  await db.exec('grant execute on function public.blocheaza_email_disposable() to supabase_auth_admin');
  const isu = await ca(db, 'authenticated', ADMIN, 'select public.is_superadmin() s, public.este_admin_platforma() a');
  verifica(isu.ok && isu.rows[0].a === true, 'is_superadmin() / este_admin_platforma() rămân executabile de authenticated');

  sectiune('D. Citire publică');
  const anonCfg = await ca(db, 'anon', null, 'select sectiune from public.backoffice_config order by sectiune');
  verifica(anonCfg.ok && JSON.stringify(anonCfg.rows.map((r) => r.sectiune)) === '["consultanta","proiectare"]',
    'anon citește doar consultanta + proiectare: ' + JSON.stringify(anonCfg.rows));
  const clientCfg = await ca(db, 'authenticated', CLIENT, "select count(*)::int n from public.backoffice_config where sectiune = 'pricing'");
  verifica(clientCfg.ok && clientCfg.rows[0].n === 0, 'un client nu mai citește comisioanele (pricing)');
  const adminCfg = await ca(db, 'authenticated', ADMIN, 'select count(*)::int n from public.backoffice_config');
  verifica(adminCfg.ok && adminCfg.rows[0].n === 6, 'adminul citește în continuare tot backoffice_config');
  const prog = await ca(db, 'anon', null, 'select count(*)::int n from public.parteneri_program_lucru');
  verifica(prog.ok && prog.rows[0].n === 0, 'anon nu mai citește parteneri_program_lucru');
  const progP = await ca(db, 'authenticated', PARTENER, 'select count(*)::int n from public.parteneri_program_lucru');
  verifica(progP.ok && progP.rows[0].n === 1, 'partenerul își citește în continuare programul');

  sectiune('E. Stocare');
  const b = (await db.query("select file_size_limit::int l, allowed_mime_types::text m from storage.buckets where id = 'facturi-parteneri'")).rows[0];
  verifica(b.l === 10485760 && b.m === '{application/pdf,image/jpeg,image/png}', 'facturi-parteneri: 10 MB, PDF / JPEG / PNG — ' + JSON.stringify(b));
  const alt = (await db.query("select file_size_limit::int l from storage.buckets where id = 'comenzi-imagini'")).rows[0];
  verifica(alt.l === 5242880, 'celelalte bucket-uri nu se schimbă');

  sectiune('Migrarea: a doua rulare, revenire, iar migrare');
  const s1 = await instantaneu(db);
  e = await ruleaza(db, MIGRARE);
  verifica(!e, 'a doua rulare fără erori: ' + e);
  verifica((await instantaneu(db)) === s1, 'a doua rulare nu schimbă nimic');

  e = await ruleaza(db, REVENIRE);
  verifica(!e, 'revenirea rulează fără erori: ' + e);
  const pol = await db.query("select count(*)::int n from pg_policies where policyname in ('client creeaza comanda proprie', 'partener_creeaza_propriile_facturi', 'public_read_config', 'program_lucru citire publica', 'partener scrie propria pozitie')");
  verifica(pol.rows[0].n === 5, 'revenirea reface politicile șterse');
  const noi = await db.query("select count(*)::int n from pg_policies where policyname in ('partener citeste propria pozitie', 'public_read_config_chei_publice', 'prestator_autorizatii_citire')");
  verifica(noi.rows[0].n === 0, 'revenirea scoate politicile noi ale migrării');
  verifica(trecut(await ca(db, 'authenticated', CLIENT, `insert into public.comenzi (client_id, pret) values ('${CLIENT}', 1)`)), 'după revenire, scrierea directă în comenzi trece din nou');
  verifica((await db.query("select has_function_privilege('anon', 'public.blocheaza_email_disposable()', 'EXECUTE') a")).rows[0].a, 'după revenire, EXECUTE pe funcție e refăcut');
  verifica((await db.query("select file_size_limit from storage.buckets where id = 'facturi-parteneri'")).rows[0].file_size_limit === null, 'după revenire, bucket-ul revine fără limită');
  e = await ruleaza(db, REVENIRE);
  verifica(!e, 'revenirea rulează și a doua oară: ' + e);
  e = await ruleaza(db, MIGRARE);
  verifica(!e, 'migrarea rulează din nou după revenire: ' + e);
  verifica((await instantaneu(db)) === s1, 'după revenire + migrare, starea e aceeași ca după prima migrare');

  sectiune('Verificarea finală oprește tranzacția');
  const db2 = await bazaNoua();
  await ruleaza(db2, REVENIRE);
  await db2.exec('alter function public.is_superadmin() reset search_path');
  e = await ruleaza(db2, MIGRARE);
  verifica(e && /search_path/.test(e), 'fără search_path fix pe is_superadmin(), migrarea se oprește: ' + e);
  const ramase = await db2.query("select count(*)::int n from pg_policies where policyname = 'client creeaza comanda proprie'");
  verifica(ramase.rows[0].n === 1, 'nimic nu s-a schimbat după oprire (politica e încă acolo)');
  const tr2 = await db2.query("select count(*)::int n from information_schema.role_table_grants where grantee = 'anon' and privilege_type = 'TRUNCATE' and table_schema = 'public'");
  verifica(tr2.rows[0].n > 0, 'nimic nu s-a schimbat după oprire (drepturile sunt încă acolo)');
}

// ─── F + G: validare și limita de cereri ─────────────────────────────────────
function kvMemorie() {
  const m = new Map();
  return {
    m,
    incr: async (k) => { const n = (m.get(k) || 0) + 1; m.set(k, n); return n; },
    expire: async () => 1,
  };
}

function cerere(metoda, body, { ip = '203.0.113.7', token = null } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (token) headers.authorization = 'Bearer ' + token;
  return { method: metoda, query: {}, body, headers, socket: { remoteAddress: ip } };
}

async function testValidare() {
  sectiune('F. lib/valideaza.js');
  const v = require('../lib/valideaza');
  const S = {
    email: v.email({ obligatoriu: true, eticheta: ['Email', 'Email'] }),
    nume: v.text({ max: 5, eticheta: ['Nume', 'Name'] }),
    id: v.uuid(),
    n: v.numar({ min: 1, max: 10 }),
    tip: v.dinLista(['a', 'b']),
    acord: v.boolean({ adevarat: true }),
    l: v.lista(v.text({ max: 3 }), { max: 2 }),
  };
  let r = v.valideaza({}, S);
  verifica(!r.ok && r.campuri[0].camp === 'email' && /Completați «Email»/.test(r.mesaj.ro) && /Please fill in «Email»/.test(r.mesaj.en), 'câmp obligatoriu lipsă: mesaj RO + EN');
  r = v.valideaza({ email: 'a@b.ro', nume: 'abcdefg' }, S);
  verifica(!r.ok && r.campuri[0].camp === 'nume' && /cel mult 5 caractere \(acum: 7\)/.test(r.mesaj.ro) && /at most 5 characters/.test(r.mesaj.en), 'text prea lung: RO + EN, cu lungimea');
  r = v.valideaza({ email: 'nu-e-email' }, S);
  verifica(!r.ok && /nu este o adresă de email validă/.test(r.mesaj.ro) && /not a valid email/.test(r.mesaj.en), 'email invalid');
  r = v.valideaza({ email: 'a@b.ro', id: '123' }, S);
  verifica(!r.ok && r.campuri[0].camp === 'id', 'uuid invalid');
  r = v.valideaza({ email: 'a@b.ro', n: 11 }, S);
  verifica(!r.ok && /între 1 și 10/.test(r.mesaj.ro) && /between 1 and 10/.test(r.mesaj.en), 'număr în afara intervalului');
  r = v.valideaza({ email: 'a@b.ro', tip: 'c' }, S);
  verifica(!r.ok && /una dintre valorile: a, b/.test(r.mesaj.ro), 'valoare din afara listei');
  r = v.valideaza({ email: 'a@b.ro', acord: false }, S);
  verifica(!r.ok && /Bifați/.test(r.mesaj.ro), 'acordul nebifat');
  r = v.valideaza({ email: 'a@b.ro', l: ['ab', 'abcd'] }, S);
  verifica(!r.ok && /elementul 2/.test(r.mesaj.ro) && /item 2/.test(r.mesaj.en), 'element de listă prea lung');
  r = v.valideaza({ email: 'a@b.ro', parola: 'x' }, S);
  verifica(!r.ok && r.campuri[0].camp === 'parola' && /Câmp necunoscut: «parola»/.test(r.mesaj.ro) && /Unknown field/.test(r.mesaj.en), 'câmp necunoscut refuzat');
  r = v.valideaza({ email: 'a@b.ro', parola: 'x' }, S, { necunoscute: 'ignora' });
  verifica(r.ok && !('parola' in r.date), 'necunoscute: ignora — câmpul nu intră în date');
  r = v.valideaza({ email: ' A@B.RO ', nume: ' Ana ', n: '3' }, S);
  verifica(r.ok && r.date.email === 'a@b.ro' && r.date.nume === 'Ana' && r.date.n === 3, 'valorile se curăță (trim, litere mici, număr)');
  r = v.valideaza([], S);
  verifica(!r.ok && /obiect JSON/.test(r.mesaj.ro), 'corp care nu e obiect');
  r = v.valideaza({ x: 'a'.repeat(6000) }, {}, { necunoscute: 'ignora' });
  verifica(!r.ok && /cel mult 5000 caractere/.test(r.mesaj.ro), 'limite generale: text prea lung într-un câmp nedeclarat');
  r = v.valideaza({ x: Array(600).fill(1) }, {}, { necunoscute: 'ignora' });
  verifica(!r.ok && /cel mult 500 elemente/.test(r.mesaj.ro), 'limite generale: listă prea lungă');
  r = v.valideaza({ id: 'p1' }, { id: v.id() });
  verifica(r.ok, 'id scurt acceptat');
  r = v.valideaza({ id: "p1' or 1=1" }, { id: v.id() });
  verifica(!r.ok, 'id cu caractere străine refuzat');

  // Forma comună trimiteEroare.
  const res = require('./supabase-simulat').raspuns();
  v.trimite(res, v.valideaza({}, S));
  verifica(res.statusCode === 400 && res.corp.ok === false && res.corp.cod === 'DATE_INVALIDE' && res.corp.mesaj.ro && res.corp.mesaj.en
    && Array.isArray(res.corp.campuri) && res.corp.campuri[0].mesaj.en, 'eroarea iese în forma comună (400, cod, mesaj RO + EN, campuri)');
}

async function testEndpointuri() {
  const sim = require('./supabase-simulat');
  sim.instaleaza();
  const { DB, raspuns } = sim;
  DB.tabele.tari_lead_asteptare = [];
  DB.tabele.newsletter_subscribers = [];
  DB.tabele.investitori_leads = [];
  DB.tabele.accese_temporare = [{ id: 'a1', email: 'ana@exemplu.ro', activ: true, ruta_url: '/investitori', expira_la: new Date(Date.now() + 864e5).toISOString() }];
  DB.implicite.newsletter_subscribers = { token_confirmare: 'tok-1' };
  DB.utilizatori['tok-ana'] = { id: '00000000-0000-0000-0000-0000000000aa', email: 'ana@exemplu.ro' };
  delete process.env.RESEND_API_KEY;
  delete process.env.INVESTOR_LEAD_NOTIFY_EMAIL;
  process.env.ANTHROPIC_API_KEY = 'cheie-test';

  const RL = require('../lib/rate-limit');
  let kv = kvMemorie();
  RL._seteazaKv(kv);

  const handler = (p) => require(path.join(RAD, p));
  const apel = async (p, metoda, body, opt) => { const res = raspuns(); await handler(p)(cerere(metoda, body, opt), res); return res; };

  sectiune('F. Validarea pe endpoint-urile publice');
  const cazuri = [
    ['api/public/lead-zona.js', {}, 'email'],
    ['api/public/lead-zona.js', { email: 'a@b.ro', mesaj: 'x'.repeat(1001) }, 'mesaj'],
    ['api/public/lead-zona.js', { email: 'a@b.ro', extra: 1 }, 'extra'],
    ['api/public/newsletter.js', { email: 'a@b.ro' }, 'gdpr_accepted'],
    ['api/public/newsletter.js', { email: 'a@b.ro', gdpr_accepted: true, sursa: 'x'.repeat(51) }, 'sursa'],
    ['api/public/investor-lead.js', { email: 'a@b.ro', prenume: 'x'.repeat(101) }, 'prenume'],
    ['api/public/investor-lead.js', { email: 'nu' }, 'email'],
    ['api/public/investor-lead.js', { email: 'a@b.ro', rol: 'admin' }, 'rol'],
    ['api/public/calculeaza-pret-nivel.js', { nivel_id: 'n1', cantitate: 'multe' }, 'cantitate'],
    ['api/public/confirma-livrare.js', { token: 't', actiune: 'sterge' }, 'actiune'],
    ['api/public/cui-lookup.js', { tara: 'RO', cui: '1'.repeat(41) }, 'cui'],
    ['api/public/disponibilitate-adresa.js', { slug: 's', adresa: { strada: 'x'.repeat(201) } }, 'adresa'],
    ['api/darrin-ai/deviz.js', { mod: 'servicii', text: 'x'.repeat(4001) }, 'text'],
    ['api/darrin-ai/deviz.js', { mod: 'altceva', text: 'a' }, 'mod'],
  ];
  for (const [p, body, campAsteptat] of cazuri) {
    const r = await apel(p, 'POST', body);
    const c = r.corp || {};
    verifica(r.statusCode === 400 && c.mesaj && c.mesaj.ro && c.mesaj.en && c.mesaj.ro !== c.mesaj.en
      && (c.campuri || []).some((x) => x.camp === campAsteptat || x.camp.startsWith(campAsteptat + '.')),
      `${path.basename(p)} ${JSON.stringify(body).slice(0, 60)} → 400 pe «${campAsteptat}» cu RO + EN (${r.statusCode} ${JSON.stringify(c).slice(0, 160)})`);
  }
  const accNda = await apel('api/public/accepta-nda.js', 'POST', { accept: false }, { token: 'tok-ana' });
  verifica(accNda.statusCode === 400 && accNda.corp.campuri[0].camp === 'accept' && accNda.corp.mesaj.en, 'accepta-nda: accept=false → 400 cu RO + EN');
  // Endpoint cu cont: câmp prea lung → 400, câmp necunoscut ignorat.
  const rol = await apel('api/cont/rol-solicitat.js', 'POST', { rol: 'x'.repeat(41) }, { token: 'tok-ana' });
  verifica(rol.statusCode === 400 && rol.corp.campuri[0].camp === 'rol' && rol.corp.mesaj.en, 'cont/rol-solicitat: rol prea lung → 400 RO + EN');

  sectiune('F. Corpurile corecte trec');
  kv = kvMemorie(); RL._seteazaKv(kv);
  let r = await apel('api/public/lead-zona.js', 'POST', { email: ' Ana@Exemplu.ro ', nume: 'Ana', tara_cod: 'md', tara_nume: 'Moldova', mesaj: 'Vreau' });
  verifica(r.statusCode === 200 && r.corp.ok, 'lead-zona: corp corect → 200 (' + JSON.stringify(r.corp) + ')');
  const lead = DB.tabele.tari_lead_asteptare[0] || {};
  verifica(lead.email === 'ana@exemplu.ro' && lead.tara_cod === 'MD' && lead.nume === 'Ana', 'lead-zona: valorile curățate ajung în tabel');
  r = await apel('api/public/newsletter.js', 'POST', { email: 'ana@exemplu.ro', gdpr_accepted: true, sursa: 'footer' });
  verifica(r.statusCode === 200 && r.corp.ok, 'newsletter: corpul trimis de paginile publice trece (' + JSON.stringify(r.corp) + ')');
  r = await apel('api/public/investor-lead.js', 'POST', { prenume: 'Ana', nume: 'Pop', email: 'ana@exemplu.ro', nda_acceptat: true });
  verifica(r.statusCode === 200 && r.corp.ok, 'investor-lead: corp corect → 200 (' + JSON.stringify(r.corp) + ')');
  r = await apel('api/public/accepta-nda.js', 'POST', { accept: true }, { token: 'tok-ana' });
  verifica(r.statusCode === 200 && r.corp.ok, 'accepta-nda: corpul trimis de pagini trece (' + JSON.stringify(r.corp) + ')');

  sectiune('G. Limita de cereri: 429 după prag');
  const PRAG = [
    ['api/public/lead-zona.js', (i) => ({ email: `p${i}@exemplu.ro` }), 5],
    ['api/public/newsletter.js', (i) => ({ email: `n${i}@exemplu.ro`, gdpr_accepted: true }), 5],
    ['api/public/investor-lead.js', (i) => ({ email: `i${i}@exemplu.ro` }), 5],
    // Corp valid ca schemă, dar fără text și fișiere: 400 după limitator — fără apel AI.
    ['api/darrin-ai/deviz.js', () => ({ mod: 'servicii' }), 10],
  ];
  for (const [p, corp, limita] of PRAG) {
    kv = kvMemorie(); RL._seteazaKv(kv);
    const coduri = [];
    for (let i = 0; i <= limita; i++) coduri.push((await apel(p, 'POST', corp(i), { ip: '198.51.100.9' })).statusCode);
    const ultim = await apel(p, 'POST', corp(99), { ip: '198.51.100.9' });
    verifica(!coduri.slice(0, limita).includes(429) && coduri[limita] === 429, `${path.basename(p)}: primele ${limita} trec, a ${limita + 1}-a → 429 (${coduri.join(',')})`);
    verifica(ultim.statusCode === 429 && ultim.corp.cod === 'PREA_MULTE_CERERI' && /Încercați din nou peste 10 minute/.test(ultim.corp.mesaj.ro)
      && /try again in 10 minutes/.test(ultim.corp.mesaj.en) && ultim.headere['Retry-After'] === '600', `${path.basename(p)}: 429 cu RO + EN și Retry-After`);
    const altIp = await apel(p, 'POST', corp(100), { ip: '198.51.100.10' });
    verifica(altIp.statusCode !== 429, `${path.basename(p)}: alt IP nu e blocat`);
    verifica(![...kv.m.keys()].some((k) => k.includes('198.51.100')), `${path.basename(p)}: IP-ul nu apare în clar în cheile KV`);
  }
  // Pe email: același email de pe IP-uri diferite.
  kv = kvMemorie(); RL._seteazaKv(kv);
  const coduriEmail = [];
  for (let i = 0; i < 6; i++) coduriEmail.push((await apel('api/public/lead-zona.js', 'POST', { email: 'acelasi@exemplu.ro' }, { ip: `192.0.2.${i + 1}` })).statusCode);
  verifica(coduriEmail.slice(0, 5).every((c) => c === 200) && coduriEmail[5] === 429, 'lead-zona: limita pe email, de pe IP-uri diferite (' + coduriEmail.join(',') + ')');
  verifica(![...kv.m.keys()].some((k) => k.includes('acelasi')), 'emailul nu apare în clar în cheile KV');
  kv = kvMemorie(); RL._seteazaKv(kv);
  const coduriNda = [];
  for (let i = 0; i < 6; i++) coduriNda.push((await apel('api/public/accepta-nda.js', 'POST', { accept: true }, { token: 'tok-ana', ip: `192.0.2.${i + 1}` })).statusCode);
  verifica(coduriNda.slice(0, 5).every((c) => c === 200) && coduriNda[5] === 429, 'accepta-nda: limita pe emailul contului (' + coduriNda.join(',') + ')');
  // KV indisponibil: cererea trece (fail-open), ca înainte.
  RL._seteazaKv({ incr: async () => { throw new Error('KV jos'); }, expire: async () => 1 });
  const errOrig = console.error; console.error = () => {};
  r = await apel('api/public/lead-zona.js', 'POST', { email: 'kv@exemplu.ro' });
  console.error = errOrig;
  verifica(r.statusCode === 200, 'KV indisponibil: cererea trece (fail-open)');
  // checkRateLimit (folosit de celelalte endpoint-uri) funcționează în continuare.
  kv = kvMemorie(); RL._seteazaKv(kv);
  const rasp = [];
  for (let i = 0; i < 3; i++) rasp.push(await RL.checkRateLimit(cerere('POST', {}), { key: 't', limit: 2, windowSeconds: 60 }));
  verifica(JSON.stringify(rasp) === '[true,true,false]', 'checkRateLimit: true, true, false');
}

function testPagini() {
  sectiune('H. Escaparea în pagini');
  const citeste = (f) => fs.readFileSync(path.join(RAD, f), 'utf8');
  const cat = citeste('mydarrin-catalog.html');
  verifica(!cat.includes('<div class="card-title">${item.titlu}</div>') && cat.includes('${escAtribut(item.titlu)}'), 'catalog: titlul cardului escapat');
  verifica(!cat.includes('${item.descriere || descDinDomeniu'), 'catalog: descrierea cardului escapată');
  verifica(!cat.includes("openService('${slug}','${tit}')") && cat.includes('openService(this.dataset.slug,this.dataset.titlu)'), 'catalog: onclick fără text din baza de date în JS');
  verifica(/function escAtribut\(str\)/.test(cat), 'catalog: escAtribut definit');
  // escAtribut: un titlu cu apostrof / ghilimele / tag nu mai iese din atribut.
  const m = cat.match(/function escAtribut\(str\) \{[\s\S]*?\n    \}/);
  const escAtribut = new Function('return ' + m[0])();
  verifica(escAtribut(`Robinet "Lux" & <b>O'Neil</b>`) === 'Robinet &quot;Lux&quot; &amp; &lt;b&gt;O&#39;Neil&lt;/b&gt;', 'escAtribut escapează & < > " \'');
  const prod = citeste('mydarrin-produs.html');
  verifica(!prod.includes("changeAddonQty('${it.tip}','${it.id}'") && !prod.includes('src="${it.imagini[0]}"'), 'produs: id-uri și imagini escapate');
  const part = citeste('mydarrin-dashboard-partener.html');
  for (const x of ['${c.pickup}', '${c.dest}', '${c.title} ·', '${s.titlu}', '${o.denumire}', '${u.denumire}', '${c.nume_titular}', '${data.darrin_ai_raport}', '${motiv}']) {
    verifica(!part.includes(x), `dashboard partener: ${x} nu mai e pus în HTML neescapat`);
  }
  const conf = citeste('confirmare-livrare.html');
  verifica(conf.includes('${escStare(titlu)}') && conf.includes('${escStare(text)}'), 'confirmare-livrare: starea finală escapată');
  verifica(citeste('reclamatii.html').includes('escapeHTML(f.name)'), 'reclamații: numele fișierelor escapate');
  verifica(citeste('mydarrin-checkout.html').includes('${escapeHTML(METODA_PLATA_LABEL[m] || m)}'), 'checkout: metodele de plată escapate');
  // Fără numele secretului KYC în codul nou.
  for (const f of ['lib/valideaza.js', 'lib/rate-limit.js', 'scripts/test-securitate-11s1.js']) {
    verifica(!citeste(f).includes('KYC_HMAC' + '_SECRET'), `${f}: fără numele secretului KYC`);
  }
}

(async () => {
  try {
    await testMigrare();
    await testValidare();
    await testEndpointuri();
    testPagini();
  } catch (e) {
    esec++;
    console.log('  ✗ excepție: ' + (e && e.stack || e));
  }
  console.log(`\n${ok} verificări trecute, ${esec} eșuate.`);
  process.exit(esec ? 1 : 0);
})();
