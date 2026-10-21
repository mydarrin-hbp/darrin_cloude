-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (pasul 11-J, 21 oct. 2026)
-- Rundele de finanțare, configurabile din back-office (decizia LM C2)
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce face
--   1. Tabela runde_finantare (Seed, Series A, B, C … IPO). Nu se introduce
--      nicio rundă și nicio cifră: le completează LM din back-office
--      (superadmin → Investitori Admin → Runde de finanțare). Valorile
--      calculate (post-money, prețul pe acțiune, procentul oferit, acțiunile
--      noi) sunt coloane generate, din câmpurile introduse — aceleași formule
--      ca în lib/runda-finantare.js. Constrângeri: sumele > 0; cel mult o
--      rundă deschisă; data_sfarsit ≥ data_start; investiția minimă ≤ ținta.
--      RLS activ, fără politici: citirea publică doar prin
--      api/public/runda-curenta.js (rundele cu vizibila_public = true),
--      scrierile doar prin server (api/admin/runde-finantare.js).
--   2. investitori_portofoliu.runda_id (cheie străină spre runde_finantare,
--      nulă pentru subscrierile vechi), cu index.
--   3. Securitate: get_live_investor_kpis (SECURITY DEFINER, întoarce
--      comenzile, GMV-ul și veniturile platformei) nu mai e executabilă de
--      anon / public / authenticated. Indicatorii îi citește doar serverul,
--      pentru investitorii cu KYC aprobat (api/investitori/indicatori.js).
--      La fel, funcțiile vechi cu cifre scrise de mână, înlocuite de
--      calculele de pe server (lib/runda-finantare.js):
--        admin_get_investitori_dashboard() — 4000 de acțiuni, 1000 EUR,
--          4.000.000, 500.000 → api/admin/investitori-dashboard.js;
--        get_investor_portofoliu() — 10.000.000 de acțiuni, un singur rând
--          de subscriere → api/investitori/portofoliu.js;
--        admin_update_kyc_status(...) — verifica doar profiles.role, fără
--          audit și fără email → api/admin/investitori-kyc.js (pasul 11-L).
--      Funcțiile rămân în baza de date (nu se șterg), dar nu mai pot fi
--      apelate din browser; le poate șterge LM ulterior.
--   4. Curățenie: politica dublă „investitor vede propriul KYC” de pe
--      investitori_kyc („investitorul vede propriul KYC” rămâne).
--
-- Siguranță
--   O singură tranzacție; rulabilă de mai multe ori. Nu șterge date.
--   Ordine de lansare: înaintea codului din branch-ul runde-finantare-11j.
--   Fără migrare, codul nou arată pagina Investitori fără rundă (nu eroare).
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 1. Rundele de finanțare ─────────────────────────────────────────
create table if not exists public.runde_finantare (
  id                   uuid primary key default gen_random_uuid(),
  cod                  text not null,
  denumire_ro          text not null,
  denumire_en          text not null,
  descriere_ro         text,
  descriere_en         text,
  stare                text not null default 'planificata',
  moneda               text not null default 'EUR',
  evaluare_pre_money   numeric not null,
  suma_tinta           numeric not null,
  actiuni_existente    numeric not null,
  investitie_minima    numeric,
  tickete              numeric[],
  data_start           date,
  data_sfarsit         date,
  instrumente          text[] not null default array['actiuni'],
  lock_up_luni         integer,
  discount_buyback_pct numeric,
  afiseaza_progres     boolean not null default false,
  vizibila_public      boolean not null default false,
  post_money           numeric generated always as (evaluare_pre_money + suma_tinta) stored,
  pret_actiune         numeric generated always as (evaluare_pre_money / actiuni_existente) stored,
  equity_oferit_pct    numeric generated always as (suma_tinta / (evaluare_pre_money + suma_tinta) * 100) stored,
  actiuni_noi          numeric generated always as (floor(suma_tinta / (evaluare_pre_money / actiuni_existente))) stored,
  creat_de             uuid,
  actualizat_de        uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'runde_finantare_cod_check') then
    alter table public.runde_finantare add constraint runde_finantare_cod_check check (cod ~ '^[a-z0-9_]{2,40}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'runde_finantare_cod_key') then
    alter table public.runde_finantare add constraint runde_finantare_cod_key unique (cod);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'runde_finantare_stare_check') then
    alter table public.runde_finantare add constraint runde_finantare_stare_check check (stare in ('planificata', 'deschisa', 'inchisa'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'runde_finantare_sume_check') then
    alter table public.runde_finantare add constraint runde_finantare_sume_check check (
      evaluare_pre_money > 0 and suma_tinta > 0 and actiuni_existente > 0
      and (investitie_minima is null or (investitie_minima > 0 and investitie_minima <= suma_tinta))
      and (tickete is null or 0 < all (tickete))
      and (lock_up_luni is null or lock_up_luni >= 0)
      and (discount_buyback_pct is null or (discount_buyback_pct >= 0 and discount_buyback_pct < 100))
      and char_length(moneda) = 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'runde_finantare_date_check') then
    alter table public.runde_finantare add constraint runde_finantare_date_check
      check (data_start is null or data_sfarsit is null or data_sfarsit >= data_start);
  end if;
end;
$$;

-- Cel mult o rundă deschisă.
create unique index if not exists runde_finantare_o_deschisa on public.runde_finantare ((true)) where stare = 'deschisa';

alter table public.runde_finantare enable row level security;
revoke all on public.runde_finantare from anon, authenticated;
grant all on public.runde_finantare to service_role;

-- ── 2. Subscrierile, legate de rundă ────────────────────────────────
alter table public.investitori_portofoliu add column if not exists runda_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'investitori_portofoliu_runda_id_fkey') then
    alter table public.investitori_portofoliu
      add constraint investitori_portofoliu_runda_id_fkey foreign key (runda_id) references public.runde_finantare(id);
  end if;
end;
$$;
create index if not exists investitori_portofoliu_runda_id_idx on public.investitori_portofoliu (runda_id);

-- ── 3. Funcțiile cu date financiare sau cifre scrise de mână ────────
-- Indiferent de semnătură: nimeni din browser (anon / public / authenticated)
-- nu le mai execută; doar serverul (service_role).
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as semnatura
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_live_investor_kpis', 'admin_get_investitori_dashboard', 'get_investor_portofoliu', 'admin_update_kyc_status')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.semnatura);
    execute format('grant execute on function %s to service_role', f.semnatura);
  end loop;
end;
$$;

-- ── 4. Politica dublă de citire pe investitori_kyc ──────────────────
drop policy if exists "investitor vede propriul KYC" on public.investitori_kyc;

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
declare
  f record;
begin
  if to_regclass('public.runde_finantare') is null then
    raise exception 'Tabela runde_finantare lipsește';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.runde_finantare'::regclass) then
    raise exception 'RLS nu e activ pe runde_finantare';
  end if;
  if has_table_privilege('anon', 'public.runde_finantare', 'SELECT')
     or has_table_privilege('authenticated', 'public.runde_finantare', 'INSERT') then
    raise exception 'runde_finantare e accesibilă direct din browser';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'runde_finantare_o_deschisa') then
    raise exception 'Lipsește indexul care permite o singură rundă deschisă';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'investitori_portofoliu' and column_name = 'runda_id') then
    raise exception 'investitori_portofoliu.runda_id lipsește';
  end if;
  for f in
    select p.oid::regprocedure as semnatura, p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_live_investor_kpis', 'admin_get_investitori_dashboard', 'get_investor_portofoliu', 'admin_update_kyc_status')
  loop
    if has_function_privilege('anon', f.oid, 'EXECUTE') or has_function_privilege('authenticated', f.oid, 'EXECUTE') then
      raise exception 'Funcția % e încă executabilă din browser', f.semnatura;
    end if;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'investitori_kyc'
             and policyname = 'investitor vede propriul KYC') then
    raise exception 'Politica dublă „investitor vede propriul KYC” a rămas';
  end if;
end;
$$;

commit;

-- Starea după migrare (doar citire):
select count(*) as runde, count(*) filter (where stare = 'deschisa') as deschise from public.runde_finantare;
select p.oid::regprocedure as functie,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_executa,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_executa
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_live_investor_kpis', 'admin_get_investitori_dashboard', 'get_investor_portofoliu', 'admin_update_kyc_status');
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'investitori_kyc';
