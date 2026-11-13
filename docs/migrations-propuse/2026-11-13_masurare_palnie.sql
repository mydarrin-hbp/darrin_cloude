-- docs/migrations-propuse/2026-11-13_masurare_palnie.sql
-- Pasul 11-A1 (13 nov. 2026): măsurarea campaniilor și a pâlniei „Devino partener”.
-- Se aplică de LM în SQL Editor, ÎNAINTE de publicarea codului care o folosește.
-- O singură tranzacție; se poate rula de mai multe ori fără efect suplimentar.
--
-- Adaugă:
--   profiles.sursa_utm (jsonb) — sursa campaniei cu care a venit contul:
--     utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid,
--     ttclid, li_fat_id, salvat_la. Vine din auth.users.raw_user_meta_data->'sursa',
--     pe care pagina o trimite la crearea contului DOAR dacă vizitatorul a dat
--     acord pentru cookie-uri analitice (masurare.js). Fără acord: null.
--     Se completează la inserarea profilului (declanșator nou, separat de
--     handle_new_user, care rămâne neschimbat) și, o dată, pentru conturile
--     existente care au deja sursa în metadate.
--   palnie_evenimente — momentul în care un cont a terminat un pas al pâlniei
--     (email confirmat, pașii activării de partener, activarea completă).
--     Un singur rând pe cont, eveniment și pas. Scris doar de server
--     (api/cont/profil, api/cont/bun-venit), citit doar de
--     api/admin/palnie-parteneri. RLS activ, fără politici: anon și
--     authenticated nu au acces.
--
-- Nicio dată personală: doar id-ul contului, numele pasului și data.

begin;

alter table public.profiles
  add column if not exists sursa_utm jsonb;

create table if not exists public.palnie_evenimente (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  eveniment text not null,
  pas text not null default '',
  creat_la timestamptz not null default now()
);

alter table public.palnie_evenimente
  drop constraint if exists palnie_evenimente_eveniment_check;
alter table public.palnie_evenimente
  add constraint palnie_evenimente_eveniment_check
  check (eveniment in ('email_confirmed', 'partner_step_completed', 'partner_activation_completed'));

alter table public.palnie_evenimente
  drop constraint if exists palnie_evenimente_pas_check;
alter table public.palnie_evenimente
  add constraint palnie_evenimente_pas_check
  check (pas in ('', 'company_details', 'bank_account', 'trades', 'equipment', 'documents', 'contract'));

create unique index if not exists palnie_evenimente_unic_idx
  on public.palnie_evenimente (user_id, eveniment, pas);
create index if not exists palnie_evenimente_creat_la_idx
  on public.palnie_evenimente (creat_la);

alter table public.palnie_evenimente enable row level security;
revoke all on table public.palnie_evenimente from anon, authenticated;

-- Doar cheile cunoscute, ca text de cel mult 200 de caractere.
create or replace function public.sursa_utm_curata(s jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case when s is null or jsonb_typeof(s) <> 'object' then null else (
    select nullif(coalesce(jsonb_object_agg(k, left(s->>k, 200)), '{}'::jsonb), '{}'::jsonb)
    from unnest(array['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
                      'fbclid', 'ttclid', 'li_fat_id', 'salvat_la']) as k
    where jsonb_typeof(s->k) = 'string' and length(s->>k) > 0
  ) end
$$;
revoke execute on function public.sursa_utm_curata(jsonb) from public, anon, authenticated;

create or replace function public.profiles_sursa_utm_din_metadata()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.sursa_utm is null then
    select public.sursa_utm_curata(u.raw_user_meta_data->'sursa')
      into new.sursa_utm
      from auth.users u
     where u.id = new.id;
  else
    new.sursa_utm := public.sursa_utm_curata(new.sursa_utm);
  end if;
  return new;
end
$$;
revoke execute on function public.profiles_sursa_utm_din_metadata() from public, anon, authenticated;

drop trigger if exists profiles_sursa_utm on public.profiles;
create trigger profiles_sursa_utm
  before insert on public.profiles
  for each row execute function public.profiles_sursa_utm_din_metadata();

-- Conturile existente care au deja sursa în metadate (o singură dată).
update public.profiles p
   set sursa_utm = public.sursa_utm_curata(u.raw_user_meta_data->'sursa')
  from auth.users u
 where u.id = p.id
   and p.sursa_utm is null
   and public.sursa_utm_curata(u.raw_user_meta_data->'sursa') is not null;

-- Verificare la final: dacă lipsește ceva, tranzacția se oprește.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'sursa_utm'
  ) then
    raise exception 'Verificare eșuată: lipsește profiles.sursa_utm';
  end if;
  if to_regclass('public.palnie_evenimente') is null then
    raise exception 'Verificare eșuată: lipsește tabelul palnie_evenimente';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'palnie_evenimente_unic_idx') then
    raise exception 'Verificare eșuată: lipsește indexul palnie_evenimente_unic_idx';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.palnie_evenimente'::regclass and relrowsecurity) then
    raise exception 'Verificare eșuată: RLS nu e activ pe palnie_evenimente';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'palnie_evenimente') then
    raise exception 'Verificare eșuată: palnie_evenimente nu trebuie să aibă politici RLS';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'profiles_sursa_utm' and tgrelid = 'public.profiles'::regclass and not tgisinternal
  ) then
    raise exception 'Verificare eșuată: lipsește declanșatorul profiles_sursa_utm';
  end if;
end $$;

commit;
