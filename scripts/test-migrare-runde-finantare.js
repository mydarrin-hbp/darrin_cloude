// scripts/test-migrare-runde-finantare.js
// Test SQL pentru migrarea propusă a pasului 11-J
// (docs/migrations-propuse/2026-10-21_runde_finantare.sql), pe un Postgres
// local (PGlite). Nimic nu ajunge în Supabase.
//
// Schema de pornire copiază live-ul (21 oct. 2026): investitori_portofoliu
// după migrarea 11-L, investitori_kyc cu cele două politici de citire
// („investitor vede propriul KYC” dublă), cele patru funcții SECURITY DEFINER
// executabile de anon (corpul simplificat — contează doar drepturile).
//
// Verifică:
//   1. migrarea rulează de două ori, fără erori, și nu introduce nicio rundă;
//   2. valorile calculate (post-money, preț, procent, acțiuni noi) pe valori de test;
//   3. constrângerile: sume > 0, minim ≤ țintă, date, cod, cel mult o rundă deschisă;
//   4. investitori_portofoliu.runda_id cu cheie străină;
//   5. anon / authenticated nu mai execută get_live_investor_kpis și celelalte;
//      service_role da;
//   6. politica dublă a dispărut, „investitorul vede propriul KYC” rămâne;
//   7. runde_finantare nu se citește direct ca anon.
// Rulare: node scripts/test-migrare-runde-finantare.js

const fs = require('fs');
const path = require('path');
const MIGRARE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations-propuse', '2026-10-21_runde_finantare.sql'), 'utf8');

const U = '50000000-0000-4000-8000-000000000001';
const SCHEMA = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table public.profiles (id uuid primary key references auth.users(id), roles text[]);
create table public.investitori_kyc (id uuid primary key default gen_random_uuid(), user_id uuid unique, status text);
alter table public.investitori_kyc enable row level security;
create policy "investitorul vede propriul KYC" on public.investitori_kyc for select to authenticated using (auth.uid() = user_id);
create policy "investitor vede propriul KYC" on public.investitori_kyc for select using (auth.uid() = user_id);
create table public.investitori_portofoliu (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  actiuni integer not null, valoare_investita numeric not null,
  instrument text, status text default 'in_asteptare', email text, created_at timestamptz default now()
);
create function public.get_live_investor_kpis(p_tara_cod text default null) returns jsonb language plpgsql stable security definer set search_path = public as $$ begin return '{}'::jsonb; end $$;
create function public.admin_get_investitori_dashboard() returns jsonb language plpgsql stable security definer set search_path = public as $$ begin return '{}'::jsonb; end $$;
create function public.get_investor_portofoliu() returns jsonb language plpgsql stable security definer set search_path = public as $$ begin return '{}'::jsonb; end $$;
create function public.admin_update_kyc_status(p_user_id uuid, p_status text, p_scor_risc integer default null) returns jsonb language plpgsql security definer set search_path = public as $$ begin return '{}'::jsonb; end $$;
grant execute on function public.get_live_investor_kpis(text) to anon, authenticated;
grant execute on function public.admin_get_investitori_dashboard() to anon, authenticated;
grant execute on function public.get_investor_portofoliu() to anon, authenticated;
grant execute on function public.admin_update_kyc_status(uuid, text, integer) to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon, authenticated;
insert into auth.users values ('${U}');
insert into public.profiles values ('${U}', array['client','investor']);
insert into public.investitori_portofoliu (user_id, actiuni, valoare_investita, status) values ('${U}', 5, 5000, 'aprobat');
`;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) { ok++; console.log('  ✓ ' + m); } else { esec++; console.log('  ✗ ' + m); } }
async function esueaza(db, sql) { try { await db.exec(sql); return null; } catch (e) { return e; } }

(async () => {
  let PGlite;
  try { ({ PGlite } = require('@electric-sql/pglite')); }
  catch (e) { console.log('PGlite lipsește: npm i --no-save @electric-sql/pglite'); process.exit(1); }
  const db = new PGlite();
  await db.exec(SCHEMA);

  // 1
  verifica(!(await esueaza(db, MIGRARE)), 'prima rulare: fără erori');
  const e2 = await esueaza(db, MIGRARE);
  verifica(!e2, 'a doua rulare: fără erori' + (e2 ? ' — ' + e2.message : ''));
  verifica((await db.query('select count(*)::int as n from public.runde_finantare')).rows[0].n === 0, 'nicio rundă introdusă de migrare');

  // 2. valori de test (nu sunt cifrele reale ale rundei)
  await db.exec(`insert into public.runde_finantare (cod, denumire_ro, denumire_en, stare, evaluare_pre_money, suma_tinta, actiuni_existente, investitie_minima)
                 values ('test_a', 'Test A', 'Test A', 'deschisa', 900, 100, 90, 10)`);
  const r = (await db.query("select post_money, pret_actiune, equity_oferit_pct, actiuni_noi from public.runde_finantare where cod = 'test_a'")).rows[0];
  verifica(Number(r.post_money) === 1000 && Number(r.pret_actiune) === 10 && Number(r.equity_oferit_pct) === 10 && Number(r.actiuni_noi) === 10,
    `valorile calculate: post-money 1000, preț 10, procent 10, acțiuni noi 10 (${JSON.stringify(r)})`);

  // 3. constrângeri
  verifica(!!(await esueaza(db, `insert into public.runde_finantare (cod, denumire_ro, denumire_en, stare, evaluare_pre_money, suma_tinta, actiuni_existente) values ('test_b', 'B', 'B', 'deschisa', 10, 1, 1)`)),
    'a doua rundă deschisă e refuzată');
  verifica(!(await esueaza(db, `insert into public.runde_finantare (cod, denumire_ro, denumire_en, stare, evaluare_pre_money, suma_tinta, actiuni_existente) values ('test_c', 'C', 'C', 'planificata', 10, 1, 1)`)),
    'o rundă planificată, lângă cea deschisă, e acceptată');
  verifica(!!(await esueaza(db, `insert into public.runde_finantare (cod, denumire_ro, denumire_en, evaluare_pre_money, suma_tinta, actiuni_existente) values ('test_d', 'D', 'D', 0, 1, 1)`)), 'evaluarea 0 e refuzată');
  verifica(!!(await esueaza(db, `insert into public.runde_finantare (cod, denumire_ro, denumire_en, evaluare_pre_money, suma_tinta, actiuni_existente, investitie_minima) values ('test_e', 'E', 'E', 10, 5, 1, 6)`)), 'minimul peste țintă e refuzat');
  verifica(!!(await esueaza(db, `insert into public.runde_finantare (cod, denumire_ro, denumire_en, evaluare_pre_money, suma_tinta, actiuni_existente, data_start, data_sfarsit) values ('test_f', 'F', 'F', 10, 5, 1, '2026-12-01', '2026-11-01')`)), 'data de sfârșit înaintea celei de început e refuzată');
  verifica(!!(await esueaza(db, `insert into public.runde_finantare (cod, denumire_ro, denumire_en, stare, evaluare_pre_money, suma_tinta, actiuni_existente) values ('test_g', 'G', 'G', 'oricare', 10, 5, 1)`)), 'o stare necunoscută e refuzată');
  verifica(!!(await esueaza(db, `insert into public.runde_finantare (cod, denumire_ro, denumire_en, evaluare_pre_money, suma_tinta, actiuni_existente, tickete) values ('test_h', 'H', 'H', 10, 5, 1, array[5, -1])`)), 'un ticket negativ e refuzat');

  // 4. runda_id
  const id = (await db.query("select id from public.runde_finantare where cod = 'test_a'")).rows[0].id;
  verifica(!(await esueaza(db, `insert into public.investitori_portofoliu (user_id, actiuni, valoare_investita, runda_id) values ('${U}', 1, 10, '${id}')`)), 'subscriere cu runda_id');
  verifica(!!(await esueaza(db, `insert into public.investitori_portofoliu (user_id, actiuni, valoare_investita, runda_id) values ('${U}', 1, 10, gen_random_uuid())`)), 'runda_id inexistent e refuzat (cheie străină)');
  verifica((await db.query('select count(*)::int as n from public.investitori_portofoliu where runda_id is null')).rows[0].n === 1, 'subscrierea veche rămâne, fără rundă');

  // 5. funcțiile
  const drepturi = (await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as a, has_function_privilege('authenticated', p.oid, 'EXECUTE') as u, has_function_privilege('service_role', p.oid, 'EXECUTE') as s
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('get_live_investor_kpis','admin_get_investitori_dashboard','get_investor_portofoliu','admin_update_kyc_status')`)).rows;
  verifica(drepturi.length === 4 && drepturi.every((d) => !d.a && !d.u && d.s), 'anon și authenticated nu mai execută cele patru funcții; service_role da');
  await db.exec('set role anon');
  const eKpi = await esueaza(db, 'select public.get_live_investor_kpis()');
  await db.exec('reset role');
  verifica(!!eKpi && /permission denied/i.test(eKpi.message), 'anon: get_live_investor_kpis → permission denied');

  // 6. politicile
  const pol = (await db.query("select policyname from pg_policies where tablename = 'investitori_kyc' order by 1")).rows.map((x) => x.policyname);
  verifica(JSON.stringify(pol) === JSON.stringify(['investitorul vede propriul KYC']), 'pe investitori_kyc rămâne doar „investitorul vede propriul KYC” (' + pol.join(', ') + ')');

  // 7. citirea directă
  await db.exec('set role anon');
  const eSel = await esueaza(db, 'select * from public.runde_finantare');
  await db.exec('reset role');
  verifica(!!eSel, 'anon nu citește direct runde_finantare');

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
