-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — SE APLICĂ DE LM ÎN SQL EDITOR, ÎNAINTE DE MERGE
-- Pasul 12-L1 (19 nov. 2026): paginile de destinație, cu conținutul editabil
-- din back-office (SEO → Pagini de destinație)
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce face
--   1. landing_continut (nouă): conținutul primului ecran al celor 7 pagini de
--      destinație (/parteneri, /parteneri/servicii, /materiale, /inchirieri,
--      /curieri, /asigurari, /investitori), pe pagină, pe variantă
--      („implicita” sau numele din utm_campaign) și pe limbă (ro / en), în două
--      stări: „ciorna” (ce editează back-office-ul) și „publicat” (ce vede
--      publicul). Câmpurile: eticheta (max. 40), titlul (60), subtitlul (140),
--      beneficiile 1–3 (60), textul butonului (24), textul de sub buton (60),
--      imaginea principală (adresa publică, dimensiunile, variantele pentru
--      srcset) cu textul alternativ (140), profesia din linkul pentru reclamă;
--      versiunea, autorul și datele. Limitele sunt verificate și aici, nu doar
--      pe server.
--   2. landing_continut_istoric (nouă): fiecare publicare mută versiunea
--      publicată anterior aici (ambele limbi), ca să se poată reveni la ea.
--   3. Funcțiile landing_publica(pagina, varianta, autor) și
--      landing_revino(pagina, varianta, versiune, autor): publicarea și
--      revenirea, atomice (o tranzacție, cu blocare pe pagină + variantă).
--      Publicarea cere RO și EN complete (refuz: LANDING_INCOMPLET_RO / _EN /
--      LANDING_LIPSA_LIMBA). SECURITY INVOKER, search_path fix, executabile
--      DOAR de service_role (api/admin/seo-landing.js, după verificarea
--      dreptului SEO din lib/permisiuni-seo.js). Nicio funcție security definer.
--   4. RLS activ pe ambele tabele, fără politici, fără drepturi pentru anon /
--      authenticated: publicul citește doar rândurile publicate, prin
--      /api/public/landing (service role, cache scurt); scrierea doar prin
--      api/admin/seo-landing.js.
--   5. Imaginile: bucket-ul public existent seo-og (pasul 11-S: public, 5 MB,
--      jpeg / png / webp), subfolderul landing/. Regulile lui permit WebP și
--      citirea publică, iar scrierea se face doar prin adrese semnate emise de
--      server — exact ce trebuie, deci nu e nevoie de un bucket nou. Limita de
--      300 KB și formatul WebP le verifică serverul (după conținut, nu după
--      extensie). Dacă bucket-ul lipsește (migrarea 2026-10-23 neaplicată), se
--      creează cu aceleași setări; dacă există, NU se modifică.
--
-- Ce NU face
--   Nu inserează conținut: paginile au textele implicite în HTML și în
--   dicționarele RO / EN; variantele (de ex. „instalatori”) le creează LM din
--   back-office. Nu șterge rânduri.
--
-- Siguranță
--   O singură tranzacție; rulabilă de mai multe ori (if not exists, drop ...
--   if exists, create or replace, on conflict do nothing), cu verificare la final.
--
-- Ordine de lansare: înaintea codului din branch-ul 12l1-pagini-destinatie.
-- Fără migrare, paginile se afișează cu textele implicite, iar tabul din
-- back-office răspunde „aplicați migrarea”.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 1. landing_continut ──────────────────────────────────────────────
create table if not exists public.landing_continut (
  id uuid primary key default gen_random_uuid(),
  pagina text not null,
  varianta text not null default 'implicita',
  limba text not null,
  stare text not null default 'ciorna',
  eticheta text,
  titlu text,
  subtitlu text,
  beneficiu_1 text,
  beneficiu_2 text,
  beneficiu_3 text,
  buton text,
  sub_buton text,
  imagine_url text,
  imagine_alt text,
  imagine_latime integer,
  imagine_inaltime integer,
  imagine_variante jsonb not null default '[]'::jsonb,
  profesie text,
  versiune integer not null default 0,
  autor uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  publicat_la timestamptz
);

alter table public.landing_continut drop constraint if exists landing_continut_pagina_check;
alter table public.landing_continut add constraint landing_continut_pagina_check check (pagina in
  ('/parteneri', '/parteneri/servicii', '/parteneri/materiale', '/parteneri/inchirieri',
   '/parteneri/curieri', '/parteneri/asigurari', '/investitori'));

alter table public.landing_continut drop constraint if exists landing_continut_varianta_check;
alter table public.landing_continut add constraint landing_continut_varianta_check
  check (varianta ~ '^[a-z0-9][a-z0-9._-]{0,59}$');

alter table public.landing_continut drop constraint if exists landing_continut_limba_check;
alter table public.landing_continut add constraint landing_continut_limba_check check (limba in ('ro', 'en'));

alter table public.landing_continut drop constraint if exists landing_continut_stare_check;
alter table public.landing_continut add constraint landing_continut_stare_check check (stare in ('ciorna', 'publicat'));

alter table public.landing_continut drop constraint if exists landing_continut_lungimi;
alter table public.landing_continut add constraint landing_continut_lungimi check (
  coalesce(char_length(eticheta), 0) <= 40 and coalesce(char_length(titlu), 0) <= 60
  and coalesce(char_length(subtitlu), 0) <= 140 and coalesce(char_length(beneficiu_1), 0) <= 60
  and coalesce(char_length(beneficiu_2), 0) <= 60 and coalesce(char_length(beneficiu_3), 0) <= 60
  and coalesce(char_length(buton), 0) <= 24 and coalesce(char_length(sub_buton), 0) <= 60
  and coalesce(char_length(imagine_alt), 0) <= 140);

-- Un rând publicat are toate textele (RO și EN se verifică în landing_publica).
alter table public.landing_continut drop constraint if exists landing_continut_publicat_complet;
alter table public.landing_continut add constraint landing_continut_publicat_complet check (
  stare <> 'publicat' or (
    coalesce(btrim(eticheta), '') <> '' and coalesce(btrim(titlu), '') <> '' and coalesce(btrim(subtitlu), '') <> ''
    and coalesce(btrim(beneficiu_1), '') <> '' and coalesce(btrim(beneficiu_2), '') <> '' and coalesce(btrim(beneficiu_3), '') <> ''
    and coalesce(btrim(buton), '') <> '' and coalesce(btrim(sub_buton), '') <> ''
    and (imagine_url is null or coalesce(btrim(imagine_alt), '') <> '')));

alter table public.landing_continut drop constraint if exists landing_continut_imagine_check;
alter table public.landing_continut add constraint landing_continut_imagine_check check (
  jsonb_typeof(imagine_variante) = 'array'
  and (imagine_latime is null or (imagine_latime > 0 and imagine_latime <= 1600))
  and (imagine_inaltime is null or (imagine_inaltime > 0 and imagine_inaltime <= 1600))
  and (imagine_url is null or imagine_url ~ '^https://'));

alter table public.landing_continut drop constraint if exists landing_continut_profesie_check;
alter table public.landing_continut add constraint landing_continut_profesie_check
  check (profesie is null or profesie ~ '^[a-z0-9][a-z0-9-]{0,59}$');

alter table public.landing_continut drop constraint if exists landing_continut_unic;
alter table public.landing_continut add constraint landing_continut_unic unique (pagina, varianta, limba, stare);

create index if not exists landing_continut_pagina_varianta on public.landing_continut (pagina, varianta);

-- ── 2. landing_continut_istoric ──────────────────────────────────────
create table if not exists public.landing_continut_istoric (
  id uuid primary key default gen_random_uuid(),
  pagina text not null,
  varianta text not null,
  limba text not null,
  versiune integer not null,
  eticheta text,
  titlu text,
  subtitlu text,
  beneficiu_1 text,
  beneficiu_2 text,
  beneficiu_3 text,
  buton text,
  sub_buton text,
  imagine_url text,
  imagine_alt text,
  imagine_latime integer,
  imagine_inaltime integer,
  imagine_variante jsonb not null default '[]'::jsonb,
  profesie text,
  publicat_de uuid references public.profiles(id) on delete set null,
  publicat_la timestamptz,
  arhivat_de uuid references public.profiles(id) on delete set null,
  arhivat_la timestamptz not null default now()
);

alter table public.landing_continut_istoric drop constraint if exists landing_continut_istoric_limba_check;
alter table public.landing_continut_istoric add constraint landing_continut_istoric_limba_check check (limba in ('ro', 'en'));

alter table public.landing_continut_istoric drop constraint if exists landing_continut_istoric_unic;
alter table public.landing_continut_istoric add constraint landing_continut_istoric_unic unique (pagina, varianta, limba, versiune);

create index if not exists landing_continut_istoric_pagina on public.landing_continut_istoric (pagina, varianta, versiune desc);

-- ── 3. RLS: nimic din browser; doar prin server (service role) ───────
alter table public.landing_continut enable row level security;
alter table public.landing_continut_istoric enable row level security;
revoke all on table public.landing_continut from anon, authenticated;
revoke all on table public.landing_continut_istoric from anon, authenticated;
grant all on table public.landing_continut to service_role;
grant all on table public.landing_continut_istoric to service_role;

-- ── 4. Publicarea și revenirea ───────────────────────────────────────
-- Versiunea publicată curent (dacă există) → istoric; ciorna RO + EN → publicat,
-- cu versiunea următoare. Întoarce versiunea nouă.
create or replace function public.landing_publica(p_pagina text, p_varianta text, p_autor uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_noua integer;
  v_lipsa text;
  r record;
begin
  perform pg_advisory_xact_lock(hashtext('landing:' || p_pagina || '|' || p_varianta));

  if (select count(*) from public.landing_continut
      where pagina = p_pagina and varianta = p_varianta and stare = 'ciorna' and limba in ('ro', 'en')) < 2 then
    raise exception 'LANDING_LIPSA_LIMBA' using errcode = 'P0001';
  end if;

  for r in select * from public.landing_continut
           where pagina = p_pagina and varianta = p_varianta and stare = 'ciorna' order by limba desc loop
    select string_agg(c, ', ') into v_lipsa from (values
      ('eticheta', r.eticheta), ('titlu', r.titlu), ('subtitlu', r.subtitlu), ('beneficiu_1', r.beneficiu_1),
      ('beneficiu_2', r.beneficiu_2), ('beneficiu_3', r.beneficiu_3), ('buton', r.buton), ('sub_buton', r.sub_buton)) as t(c, v)
    where coalesce(btrim(v), '') = '';
    if v_lipsa is null and r.imagine_url is not null and coalesce(btrim(r.imagine_alt), '') = '' then
      v_lipsa := 'imagine_alt';
    end if;
    if v_lipsa is not null then
      raise exception 'LANDING_INCOMPLET_%', upper(r.limba) using errcode = 'P0001', detail = v_lipsa;
    end if;
  end loop;

  select coalesce(max(versiune), 0) + 1 into v_noua from (
    select versiune from public.landing_continut where pagina = p_pagina and varianta = p_varianta
    union all
    select versiune from public.landing_continut_istoric where pagina = p_pagina and varianta = p_varianta) x;

  insert into public.landing_continut_istoric (pagina, varianta, limba, versiune, eticheta, titlu, subtitlu,
      beneficiu_1, beneficiu_2, beneficiu_3, buton, sub_buton, imagine_url, imagine_alt, imagine_latime,
      imagine_inaltime, imagine_variante, profesie, publicat_de, publicat_la, arhivat_de)
  select pagina, varianta, limba, versiune, eticheta, titlu, subtitlu, beneficiu_1, beneficiu_2, beneficiu_3,
      buton, sub_buton, imagine_url, imagine_alt, imagine_latime, imagine_inaltime, imagine_variante, profesie,
      autor, publicat_la, p_autor
  from public.landing_continut
  where pagina = p_pagina and varianta = p_varianta and stare = 'publicat'
  on conflict (pagina, varianta, limba, versiune) do nothing;

  delete from public.landing_continut where pagina = p_pagina and varianta = p_varianta and stare = 'publicat';

  insert into public.landing_continut (pagina, varianta, limba, stare, eticheta, titlu, subtitlu, beneficiu_1,
      beneficiu_2, beneficiu_3, buton, sub_buton, imagine_url, imagine_alt, imagine_latime, imagine_inaltime,
      imagine_variante, profesie, versiune, autor, created_at, updated_at, publicat_la)
  select pagina, varianta, limba, 'publicat', btrim(eticheta), btrim(titlu), btrim(subtitlu), btrim(beneficiu_1),
      btrim(beneficiu_2), btrim(beneficiu_3), btrim(buton), btrim(sub_buton), imagine_url, nullif(btrim(imagine_alt), ''),
      imagine_latime, imagine_inaltime, imagine_variante, profesie, v_noua, p_autor, now(), now(), now()
  from public.landing_continut
  where pagina = p_pagina and varianta = p_varianta and stare = 'ciorna';

  update public.landing_continut set versiune = v_noua
  where pagina = p_pagina and varianta = p_varianta and stare = 'ciorna';

  return v_noua;
end;
$$;

-- Revenirea la o versiune din istoric: se publică din nou (cu versiunea
-- următoare), iar ciorna primește același conținut. Întoarce versiunea nouă.
create or replace function public.landing_revino(p_pagina text, p_varianta text, p_versiune integer, p_autor uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_noua integer;
begin
  perform pg_advisory_xact_lock(hashtext('landing:' || p_pagina || '|' || p_varianta));

  if (select count(*) from public.landing_continut_istoric
      where pagina = p_pagina and varianta = p_varianta and versiune = p_versiune and limba in ('ro', 'en')) < 2 then
    raise exception 'LANDING_VERSIUNE_LIPSA' using errcode = 'P0001';
  end if;

  select coalesce(max(versiune), 0) + 1 into v_noua from (
    select versiune from public.landing_continut where pagina = p_pagina and varianta = p_varianta
    union all
    select versiune from public.landing_continut_istoric where pagina = p_pagina and varianta = p_varianta) x;

  insert into public.landing_continut_istoric (pagina, varianta, limba, versiune, eticheta, titlu, subtitlu,
      beneficiu_1, beneficiu_2, beneficiu_3, buton, sub_buton, imagine_url, imagine_alt, imagine_latime,
      imagine_inaltime, imagine_variante, profesie, publicat_de, publicat_la, arhivat_de)
  select pagina, varianta, limba, versiune, eticheta, titlu, subtitlu, beneficiu_1, beneficiu_2, beneficiu_3,
      buton, sub_buton, imagine_url, imagine_alt, imagine_latime, imagine_inaltime, imagine_variante, profesie,
      autor, publicat_la, p_autor
  from public.landing_continut
  where pagina = p_pagina and varianta = p_varianta and stare = 'publicat'
  on conflict (pagina, varianta, limba, versiune) do nothing;

  delete from public.landing_continut where pagina = p_pagina and varianta = p_varianta;

  insert into public.landing_continut (pagina, varianta, limba, stare, eticheta, titlu, subtitlu, beneficiu_1,
      beneficiu_2, beneficiu_3, buton, sub_buton, imagine_url, imagine_alt, imagine_latime, imagine_inaltime,
      imagine_variante, profesie, versiune, autor, created_at, updated_at, publicat_la)
  select h.pagina, h.varianta, h.limba, s.stare, h.eticheta, h.titlu, h.subtitlu, h.beneficiu_1, h.beneficiu_2,
      h.beneficiu_3, h.buton, h.sub_buton, h.imagine_url, h.imagine_alt, h.imagine_latime, h.imagine_inaltime,
      h.imagine_variante, h.profesie, v_noua, p_autor, now(), now(),
      case when s.stare = 'publicat' then now() else null end
  from public.landing_continut_istoric h
  cross join (values ('ciorna'), ('publicat')) as s(stare)
  where h.pagina = p_pagina and h.varianta = p_varianta and h.versiune = p_versiune and h.limba in ('ro', 'en');

  return v_noua;
end;
$$;

revoke all on function public.landing_publica(text, text, uuid) from public, anon, authenticated;
revoke all on function public.landing_revino(text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.landing_publica(text, text, uuid) to service_role;
grant execute on function public.landing_revino(text, text, integer, uuid) to service_role;

-- ── 5. Imaginile: bucket-ul public seo-og, subfolderul landing/ ──────
-- Creat doar dacă lipsește, cu setările din migrarea 2026-10-23; altfel neatins.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('seo-og', 'seo-og', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
declare
  v_f text;
begin
  if to_regclass('public.landing_continut') is null or to_regclass('public.landing_continut_istoric') is null then
    raise exception 'Lipsesc tabelele landing_continut / landing_continut_istoric';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.landing_continut'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.landing_continut_istoric'::regclass) then
    raise exception 'RLS nu e activ pe tabelele paginilor de destinație';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('landing_continut', 'landing_continut_istoric')) then
    raise exception 'Au rămas politici RLS pe tabelele paginilor de destinație';
  end if;
  if has_table_privilege('anon', 'public.landing_continut', 'SELECT')
     or has_table_privilege('authenticated', 'public.landing_continut', 'SELECT')
     or has_table_privilege('anon', 'public.landing_continut', 'INSERT')
     or has_table_privilege('authenticated', 'public.landing_continut', 'UPDATE')
     or has_table_privilege('anon', 'public.landing_continut_istoric', 'SELECT')
     or has_table_privilege('authenticated', 'public.landing_continut_istoric', 'SELECT') then
    raise exception 'anon / authenticated au încă drepturi pe tabelele paginilor de destinație';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.landing_continut'::regclass and conname = 'landing_continut_unic') then
    raise exception 'Lipsește cheia unică (pagina, varianta, limba, stare)';
  end if;
  foreach v_f in array array['public.landing_publica(text, text, uuid)', 'public.landing_revino(text, text, integer, uuid)'] loop
    if to_regprocedure(v_f) is null then
      raise exception 'Lipsește funcția %', v_f;
    end if;
    if (select prosecdef from pg_proc where oid = to_regprocedure(v_f)) then
      raise exception 'Funcția % nu trebuie să fie security definer', v_f;
    end if;
    if not exists (select 1 from pg_proc where oid = to_regprocedure(v_f)
                   and proconfig is not null and array_to_string(proconfig, ',') like '%search_path=%') then
      raise exception 'Funcția % nu are search_path fix', v_f;
    end if;
    if has_function_privilege('anon', v_f, 'EXECUTE') or has_function_privilege('authenticated', v_f, 'EXECUTE') then
      raise exception 'Funcția % e executabilă de anon / authenticated', v_f;
    end if;
    if not has_function_privilege('service_role', v_f, 'EXECUTE') then
      raise exception 'service_role nu poate executa %', v_f;
    end if;
  end loop;
  if not exists (select 1 from storage.buckets where id = 'seo-og' and public = true
                 and (allowed_mime_types is null or 'image/webp' = any(allowed_mime_types))) then
    raise exception 'Bucket-ul seo-og lipsește, nu e public sau nu acceptă WebP';
  end if;
end;
$$;

commit;

-- ═══ STAREA DUPĂ MIGRARE (doar citire) ═════════════════════════════
select pagina, varianta, limba, stare, versiune from public.landing_continut order by pagina, varianta, limba, stare;

select pagina, varianta, count(*) as versiuni_in_istoric from public.landing_continut_istoric group by pagina, varianta order by pagina, varianta;

select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'seo-og';
