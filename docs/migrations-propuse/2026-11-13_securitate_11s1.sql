-- docs/migrations-propuse/2026-11-13_securitate_11s1.sql
-- Pasul 11-S1 (13 nov. 2026): securitate — scrieri directe în baza de date,
-- drepturi, funcții, date citite public, stocare.
-- Se aplică de LM în SQL Editor, ÎNAINTE de publicarea codului din pasul 11-S1.
-- O singură tranzacție; se poate rula de mai multe ori fără erori și fără
-- efect suplimentar. Revenire: 2026-11-13_securitate_11s1_revenire.sql.
--
-- A. Politicile de scriere directă din browser (cheia publică + JWT) se șterg.
--    Niciun HTML sau JS din front-end nu le folosește (căutare în tot
--    proiectul, inclusiv prin variabile, /rest/v1 și funcții comune); toate
--    scrierile trec prin API, cu cheia de serviciu (lib/supabaseAdmin.js),
--    care nu depinde de RLS. Politicile FOR ALL dădeau și citirea rândurilor
--    proprii: citirea se păstrează printr-o politică nouă, doar SELECT, cu
--    aceeași condiție.
-- B. anon și authenticated pierd TRUNCATE, TRIGGER, REFERENCES (și MAINTAIN,
--    la fel de nefolosit) pe toate tabelele din public, plus implicitele pentru
--    tabelele viitoare. anon pierde INSERT / UPDATE / DELETE pe fiecare tabel
--    pe care nicio politică nu i le permite explicit (lista se calculează aici,
--    din pg_policies).
-- C. blocheaza_email_disposable() (funcție de trigger pe auth.users) nu mai
--    poate fi apelată prin /rest/v1/rpc/. Postgres verifică EXECUTE doar la
--    CREATE TRIGGER, nu la declanșare, deci trigger-ul funcționează în continuare.
--    is_superadmin() și este_admin_platforma() rămân executabile de
--    authenticated (le folosesc politicile RLS); se verifică search_path fix.
-- D. backoffice_config: citirea publică se restrânge la secțiunile folosite de
--    paginile publice (consultanta, proiectare — mydarrin-catalog.html).
--    Restul (pricing, asigurari, contact, seo, routing, investitori) se citește
--    doar de admini (politica superadmin_full_config) și de server.
--    parteneri_program_lucru: citirea publică se scoate; nicio pagină publică
--    nu o folosește, partenerul își citește programul prin
--    api/partener/program-lucru.js.
-- E. Bucket-ul facturi-parteneri: 10 MB, PDF / JPEG / PNG (ce acceptă
--    api/partener/facturi.js).

begin;

-- ─── A. Politici de scriere directă ─────────────────────────────────────────
drop policy if exists "client creeaza comanda proprie" on public.comenzi;
drop policy if exists "client inserează deviz" on public.devize;
drop policy if exists "partener_creeaza_propriile_facturi" on public.facturi_parteneri;
drop policy if exists "partenerul adauga propriile discounturi" on public.parteneri_discounturi;
drop policy if exists "partenerul modifica propriile discounturi" on public.parteneri_discounturi;
drop policy if exists "prestator_imagini_insert" on public.comenzi_imagini;
drop policy if exists "partener incarca documente" on public.documente_partener;
drop policy if exists "partener trimite sugestii" on public.servicii_sugerate;
drop policy if exists "partner_tipuri_polita_insert" on public.partner_tipuri_polita;
drop policy if exists "partner_tipuri_polita_update" on public.partner_tipuri_polita;
drop policy if exists "partner_zona_curier_insert" on public.partner_zona_curier;
drop policy if exists "partner_zona_curier_update" on public.partner_zona_curier;
drop policy if exists "client sterge propriile itemi cos" on public.cos_multi_itemi;

-- Politicile FOR ALL: se șterg; citirea rândurilor proprii rămâne.
drop policy if exists "partener scrie propria pozitie" on public.gps_tracking;
drop policy if exists "partener citeste propria pozitie" on public.gps_tracking;
create policy "partener citeste propria pozitie" on public.gps_tracking
  for select using (auth.uid() = partener_id);

drop policy if exists "prestator_autorizatii" on public.partener_autorizatii;
drop policy if exists "prestator_autorizatii_citire" on public.partener_autorizatii;
create policy "prestator_autorizatii_citire" on public.partener_autorizatii
  for select using (partener_id = auth.uid());

drop policy if exists "partener gestioneaza propriile competente" on public.partener_competente;
drop policy if exists "partener vede propriile competente" on public.partener_competente;
create policy "partener vede propriile competente" on public.partener_competente
  for select using (auth.uid() = partener_id);

drop policy if exists "partener gestioneaza proprii servicii active" on public.partener_servicii_active;
drop policy if exists "partener vede proprii servicii active" on public.partener_servicii_active;
create policy "partener vede proprii servicii active" on public.partener_servicii_active
  for select using (auth.uid() = partener_id);

drop policy if exists "partener_disponibilitate" on public.parteneri_disponibilitate;
drop policy if exists "partener_disponibilitate_citire" on public.parteneri_disponibilitate;
create policy "partener_disponibilitate_citire" on public.parteneri_disponibilitate
  for select using (partener_id = auth.uid());

-- ─── B. Drepturi ────────────────────────────────────────────────────────────
revoke truncate, trigger, references, maintain on all tables in schema public from anon, authenticated;

alter default privileges in schema public
  revoke truncate, trigger, references, maintain on tables from anon, authenticated;
alter default privileges in schema public
  revoke insert, update, delete on tables from anon;

-- Tabelele create de supabase_admin (de exemplu din Table Editor): implicitele
-- lui se pot schimba doar de un membru al rolului. Dacă rolul curent nu are
-- dreptul, pasul se sare, cu o notă; restul migrării continuă.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    begin
      execute 'alter default privileges for role supabase_admin in schema public revoke truncate, trigger, references, maintain on tables from anon, authenticated';
      execute 'alter default privileges for role supabase_admin in schema public revoke insert, update, delete on tables from anon';
    exception when insufficient_privilege then
      raise notice 'Implicitele pentru supabase_admin nu s-au putut schimba din acest rol (drept insuficient). Tabelele existente sunt tratate mai sus.';
    end;
  end if;
end $$;

-- anon: INSERT / UPDATE / DELETE se revocă pe fiecare tabel pe care nicio
-- politică nu i le permite explicit. O politică permite anon dacă se aplică
-- rolului anon (sau public) și condiția ei nu cere un utilizator autentificat
-- (auth.uid(), auth.jwt(), auth.role(), is_superadmin(), este_admin_platforma()).
do $$
declare
  r record;
  priv text;
  cmduri text[];
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    foreach priv in array array['insert', 'update', 'delete'] loop
      cmduri := array[upper(priv), 'ALL'];
      if not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = r.relname
          and p.cmd = any (cmduri)
          and p.permissive = 'PERMISSIVE'
          and (p.roles && array['anon', 'public']::name[])
          and coalesce(p.with_check, '') || ' ' || coalesce(p.qual, '')
              !~* '(auth\.uid\(\)|auth\.jwt\(\)|auth\.role\(\)|is_superadmin\(\)|este_admin_platforma\(\))'
      ) then
        execute format('revoke %s on table public.%I from anon', priv, r.relname);
      end if;
    end loop;
  end loop;
end $$;

-- ─── C. Funcții ─────────────────────────────────────────────────────────────
revoke execute on function public.blocheaza_email_disposable() from anon, authenticated, public;
-- Rolul care inserează în auth.users păstrează explicit dreptul (nu e necesar
-- pentru declanșare, dar documentează cine are nevoie de funcție).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.blocheaza_email_disposable() to supabase_auth_admin';
  end if;
end $$;

-- ─── D. Date citite public ──────────────────────────────────────────────────
drop policy if exists "public_read_config" on public.backoffice_config;
drop policy if exists "public_read_config_chei_publice" on public.backoffice_config;
create policy "public_read_config_chei_publice" on public.backoffice_config
  for select using (sectiune in ('consultanta', 'proiectare'));

drop policy if exists "program_lucru citire publica" on public.parteneri_program_lucru;

-- ─── E. Stocare ─────────────────────────────────────────────────────────────
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png']
 where id = 'facturi-parteneri';

-- ─── Verificarea finală: orice abatere oprește tranzacția ──────────────────
do $$
declare
  lipsa text;
begin
  -- A + D: politicile șterse nu mai există.
  select string_agg(v.tabel || ' / ' || v.politica, '; ') into lipsa
  from (values
    ('comenzi', 'client creeaza comanda proprie'),
    ('devize', 'client inserează deviz'),
    ('facturi_parteneri', 'partener_creeaza_propriile_facturi'),
    ('parteneri_discounturi', 'partenerul adauga propriile discounturi'),
    ('parteneri_discounturi', 'partenerul modifica propriile discounturi'),
    ('comenzi_imagini', 'prestator_imagini_insert'),
    ('documente_partener', 'partener incarca documente'),
    ('servicii_sugerate', 'partener trimite sugestii'),
    ('partner_tipuri_polita', 'partner_tipuri_polita_insert'),
    ('partner_tipuri_polita', 'partner_tipuri_polita_update'),
    ('partner_zona_curier', 'partner_zona_curier_insert'),
    ('partner_zona_curier', 'partner_zona_curier_update'),
    ('cos_multi_itemi', 'client sterge propriile itemi cos'),
    ('gps_tracking', 'partener scrie propria pozitie'),
    ('partener_autorizatii', 'prestator_autorizatii'),
    ('partener_competente', 'partener gestioneaza propriile competente'),
    ('partener_servicii_active', 'partener gestioneaza proprii servicii active'),
    ('parteneri_disponibilitate', 'partener_disponibilitate'),
    ('backoffice_config', 'public_read_config'),
    ('parteneri_program_lucru', 'program_lucru citire publica')
  ) as v(tabel, politica)
  where exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = v.tabel and p.policyname = v.politica);
  if lipsa is not null then
    raise exception 'Verificare eșuată: politicile încă există: %', lipsa;
  end if;

  -- A: nicio politică de scriere pentru partener / client pe tabelele de la A.
  select string_agg(p.tablename || ' / ' || p.policyname, '; ') into lipsa
  from pg_policies p
  where p.schemaname = 'public' and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and p.tablename in ('comenzi', 'devize', 'facturi_parteneri', 'parteneri_discounturi', 'comenzi_imagini',
      'documente_partener', 'servicii_sugerate', 'partner_tipuri_polita', 'partner_zona_curier', 'gps_tracking',
      'partener_autorizatii', 'partener_competente', 'partener_servicii_active', 'parteneri_disponibilitate',
      'cos_multi_itemi')
    and coalesce(p.with_check, '') || ' ' || coalesce(p.qual, '') ~* '(partener_id|partner_id|client_id)\s*=\s*auth\.uid\(\)|auth\.uid\(\)\s*=\s*(partener_id|partner_id|client_id)';
  if lipsa is not null then
    raise exception 'Verificare eșuată: au rămas politici de scriere pe rândurile proprii: %', lipsa;
  end if;

  -- A: citirea rândurilor proprii a rămas.
  select string_agg(v.tabel, ', ') into lipsa
  from (values
    ('gps_tracking', 'partener citeste propria pozitie'),
    ('partener_autorizatii', 'prestator_autorizatii_citire'),
    ('partener_competente', 'partener vede propriile competente'),
    ('partener_servicii_active', 'partener vede proprii servicii active'),
    ('parteneri_disponibilitate', 'partener_disponibilitate_citire'),
    ('backoffice_config', 'public_read_config_chei_publice')
  ) as v(tabel, politica)
  where not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = v.tabel
                      and p.policyname = v.politica and p.cmd = 'SELECT');
  if lipsa is not null then
    raise exception 'Verificare eșuată: lipsesc politicile de citire pe: %', lipsa;
  end if;

  -- B: TRUNCATE / TRIGGER / REFERENCES revocate.
  select string_agg(distinct g.grantee || ':' || g.privilege_type || ':' || g.table_name, ', ') into lipsa
  from information_schema.role_table_grants g
  where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')
    and g.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES');
  if lipsa is not null then
    raise exception 'Verificare eșuată: drepturi rămase: %', lipsa;
  end if;

  -- B: anon fără scrieri pe tabelele sensibile.
  select string_agg(t, ', ') into lipsa
  from unnest(array['comenzi', 'devize', 'facturi_parteneri', 'backoffice_config', 'parteneri_discounturi']) t
  where has_table_privilege('anon', 'public.' || t, 'INSERT')
     or has_table_privilege('anon', 'public.' || t, 'UPDATE')
     or has_table_privilege('anon', 'public.' || t, 'DELETE');
  if lipsa is not null then
    raise exception 'Verificare eșuată: anon încă poate scrie în: %', lipsa;
  end if;

  -- C: funcția de trigger nu mai e executabilă de anon / authenticated.
  if has_function_privilege('anon', 'public.blocheaza_email_disposable()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.blocheaza_email_disposable()', 'EXECUTE') then
    raise exception 'Verificare eșuată: blocheaza_email_disposable() e încă executabilă de anon / authenticated';
  end if;

  -- C: is_superadmin() și este_admin_platforma(): executabile de authenticated, cu search_path fix.
  select string_agg(p.proname, ', ') into lipsa
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('is_superadmin', 'este_admin_platforma')
    and (p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
         or not has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if lipsa is not null then
    raise exception 'Verificare eșuată: fără search_path fix sau neexecutabile de authenticated: %', lipsa;
  end if;

  -- E: limitele bucket-ului.
  if exists (select 1 from storage.buckets where id = 'facturi-parteneri'
             and (file_size_limit is distinct from 10485760
                  or allowed_mime_types is distinct from array['application/pdf', 'image/jpeg', 'image/png'])) then
    raise exception 'Verificare eșuată: bucket-ul facturi-parteneri nu are limitele setate';
  end if;
end $$;

commit;
