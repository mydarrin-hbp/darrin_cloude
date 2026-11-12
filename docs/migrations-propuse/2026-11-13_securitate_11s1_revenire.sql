-- docs/migrations-propuse/2026-11-13_securitate_11s1_revenire.sql
-- Revenirea pentru 2026-11-13_securitate_11s1.sql (pasul 11-S1).
-- Pune înapoi politicile șterse, cu definițiile exacte din producție de la
-- 12 nov. 2026 (citite din pg_policies), drepturile și limitele de dinainte.
-- O singură tranzacție; se poate rula de mai multe ori fără erori.
-- Atenție: după revenire, scrierile directe din browser sunt din nou posibile.

begin;

-- ─── A. Politicile de scriere directă ───────────────────────────────────────
drop policy if exists "client creeaza comanda proprie" on public.comenzi;
create policy "client creeaza comanda proprie" on public.comenzi
  as permissive for insert to public with check ((auth.uid() = client_id));

drop policy if exists "client inserează deviz" on public.devize;
create policy "client inserează deviz" on public.devize
  as permissive for insert to public with check ((auth.uid() = client_id));

drop policy if exists "partener_creeaza_propriile_facturi" on public.facturi_parteneri;
create policy "partener_creeaza_propriile_facturi" on public.facturi_parteneri
  as permissive for insert to public with check ((partener_id = auth.uid()));

drop policy if exists "partenerul adauga propriile discounturi" on public.parteneri_discounturi;
create policy "partenerul adauga propriile discounturi" on public.parteneri_discounturi
  as permissive for insert to public with check ((auth.uid() = partener_id));

drop policy if exists "partenerul modifica propriile discounturi" on public.parteneri_discounturi;
create policy "partenerul modifica propriile discounturi" on public.parteneri_discounturi
  as permissive for update to public using ((auth.uid() = partener_id)) with check ((auth.uid() = partener_id));

drop policy if exists "prestator_imagini_insert" on public.comenzi_imagini;
create policy "prestator_imagini_insert" on public.comenzi_imagini
  as permissive for insert to public with check ((partener_id = auth.uid()));

drop policy if exists "partener incarca documente" on public.documente_partener;
create policy "partener incarca documente" on public.documente_partener
  as permissive for insert to public with check ((auth.uid() = partener_id));

drop policy if exists "partener trimite sugestii" on public.servicii_sugerate;
create policy "partener trimite sugestii" on public.servicii_sugerate
  as permissive for insert to public with check ((auth.uid() = partener_id));

drop policy if exists "partner_tipuri_polita_insert" on public.partner_tipuri_polita;
create policy "partner_tipuri_polita_insert" on public.partner_tipuri_polita
  as permissive for insert to public with check ((partner_id = auth.uid()));

drop policy if exists "partner_tipuri_polita_update" on public.partner_tipuri_polita;
create policy "partner_tipuri_polita_update" on public.partner_tipuri_polita
  as permissive for update to public using ((partner_id = auth.uid()));

drop policy if exists "partner_zona_curier_insert" on public.partner_zona_curier;
create policy "partner_zona_curier_insert" on public.partner_zona_curier
  as permissive for insert to public with check ((partner_id = auth.uid()));

drop policy if exists "partner_zona_curier_update" on public.partner_zona_curier;
create policy "partner_zona_curier_update" on public.partner_zona_curier
  as permissive for update to public using ((partner_id = auth.uid()));

drop policy if exists "client sterge propriile itemi cos" on public.cos_multi_itemi;
create policy "client sterge propriile itemi cos" on public.cos_multi_itemi
  as permissive for delete to public using ((auth.uid() = client_id));

-- Politicile FOR ALL; politicile doar de citire adăugate de migrare se scot.
drop policy if exists "partener citeste propria pozitie" on public.gps_tracking;
drop policy if exists "partener scrie propria pozitie" on public.gps_tracking;
create policy "partener scrie propria pozitie" on public.gps_tracking
  as permissive for all to public using ((auth.uid() = partener_id)) with check ((auth.uid() = partener_id));

drop policy if exists "prestator_autorizatii_citire" on public.partener_autorizatii;
drop policy if exists "prestator_autorizatii" on public.partener_autorizatii;
create policy "prestator_autorizatii" on public.partener_autorizatii
  as permissive for all to public using ((partener_id = auth.uid()));

drop policy if exists "partener vede propriile competente" on public.partener_competente;
drop policy if exists "partener gestioneaza propriile competente" on public.partener_competente;
create policy "partener gestioneaza propriile competente" on public.partener_competente
  as permissive for all to public using ((auth.uid() = partener_id));

drop policy if exists "partener vede proprii servicii active" on public.partener_servicii_active;
drop policy if exists "partener gestioneaza proprii servicii active" on public.partener_servicii_active;
create policy "partener gestioneaza proprii servicii active" on public.partener_servicii_active
  as permissive for all to public using ((auth.uid() = partener_id));

drop policy if exists "partener_disponibilitate_citire" on public.parteneri_disponibilitate;
drop policy if exists "partener_disponibilitate" on public.parteneri_disponibilitate;
create policy "partener_disponibilitate" on public.parteneri_disponibilitate
  as permissive for all to public using ((partener_id = auth.uid()));

-- ─── D. Citirea publică ─────────────────────────────────────────────────────
drop policy if exists "public_read_config_chei_publice" on public.backoffice_config;
drop policy if exists "public_read_config" on public.backoffice_config;
create policy "public_read_config" on public.backoffice_config
  as permissive for select to public using (true);

drop policy if exists "program_lucru citire publica" on public.parteneri_program_lucru;
create policy "program_lucru citire publica" on public.parteneri_program_lucru
  as permissive for select to anon, authenticated using (true);

-- ─── B. Drepturile de dinainte, exact pe fiecare tabel (citite la 12 nov. 2026) ──
-- 105 tabele: anon avea INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES, MAINTAIN.
-- profiles, investitori_kyc: anon avea doar TRUNCATE, TRIGGER, REFERENCES, MAINTAIN.
-- Aceleași 107 tabele: authenticated avea TRUNCATE, TRIGGER, REFERENCES, MAINTAIN.
-- 6 tabele (catalog_servicii_backup_11c8, partener_activare_ciorna,
-- pitch_deck_versiuni, runde_finantare, seo_campanii_social, seo_config) nu
-- aveau niciun drept pentru anon / authenticated și rămân așa.
-- Un tabel care între timp nu mai există se sare.
do $$
declare
  t text;
  tabele_105 text[] := array['accese_temporare','admin_permissions','adrese_cont','alocari_fifo','audit_comenzi','audit_log',
    'backoffice_config','bank_accounts','catalog_disponibilitate','catalog_materiale_recomandate','catalog_niveluri',
    'catalog_preturi','catalog_relatii','catalog_servicii','catalog_servicii_template','catalog_traduceri','categorii',
    'certificari_necesare','checkout_inceput_log','clients','cmr_digital','comanda_subcontractori','comenzi',
    'comenzi_actori','comenzi_imagini','comisioane','competente_esco','cos_itemi','cos_multi_itemi','devize',
    'devize_ai_requests','devize_articole','devize_indicatoare','devize_resurse','devize_retete','devize_retete_arhiva',
    'discount_categorii','documente_partener','dosare_dauna','email_comportamental_log','email_domenii_disposable',
    'email_events_log','email_suppression_list','entitati_juridice_platforma','facturi_parteneri','financial_records',
    'garantii_lucrari','geo_context_cache','geo_regiuni','gps_tracking','integrari_furnizori','integrari_importuri_csv',
    'investitori_exit','investitori_leads','investitori_portofoliu','investors','invoices','manopera_costuri',
    'marketplace_echipamente','marketplace_importuri_csv','marketplace_materiale','materiale_referinta_ai',
    'materiale_referinta_ai_servicii','meniu_capitole','mesaje_contact','metode_plata_config','nace_reference',
    'nace_sectiuni','newsletter_subscribers','niveluri_pret','notificari_servicii_noi','partener_autorizatii',
    'partener_competente','partener_servicii_active','parteneri_discounturi','parteneri_disponibilitate',
    'parteneri_program_lucru','parteneri_prospecti','partner_alocari_sarcini','partner_angajati','partner_certificari',
    'partner_coduri_nace','partner_contract_otp','partner_contracte_semnate','partner_conturi_bancare',
    'partner_tipuri_polita','partner_utilaje','partner_zona_curier','partners','preturi_niveluri','profiluri_facturare',
    'reclamatii','reguli_costuri_fixe','reguli_niveluri','retete_propuse','retete_propuse_linii','sectoare_client',
    'servicii_sugerate','tari_lead_asteptare','tarife_materiale','tarife_resurse','tarife_transport',
    'tax_configurations','uniclass_codes','uniclass_tables'];
begin
  foreach t in array tabele_105 loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      execute format('grant insert, update, delete, truncate, trigger, references, maintain on table public.%I to anon', t);
      execute format('grant truncate, trigger, references, maintain on table public.%I to authenticated', t);
    end if;
  end loop;
  foreach t in array array['profiles', 'investitori_kyc'] loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      execute format('grant truncate, trigger, references, maintain on table public.%I to anon, authenticated', t);
    end if;
  end loop;
end $$;

alter default privileges in schema public
  grant insert, update, delete, truncate, trigger, references, maintain on tables to anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    begin
      execute 'alter default privileges for role supabase_admin in schema public grant insert, update, delete, truncate, trigger, references, maintain on tables to anon, authenticated';
    exception when insufficient_privilege then
      raise notice 'Implicitele pentru supabase_admin nu s-au putut schimba din acest rol (drept insuficient).';
    end;
  end if;
end $$;

-- ─── C. Funcția ─────────────────────────────────────────────────────────────
grant execute on function public.blocheaza_email_disposable() to anon, authenticated, public;

-- ─── E. Stocarea ────────────────────────────────────────────────────────────
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'facturi-parteneri';

-- ─── Verificare ─────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and policyname in (
        'client creeaza comanda proprie', 'client inserează deviz', 'partener_creeaza_propriile_facturi',
        'partenerul adauga propriile discounturi', 'partenerul modifica propriile discounturi',
        'prestator_imagini_insert', 'partener incarca documente', 'partener trimite sugestii',
        'partner_tipuri_polita_insert', 'partner_tipuri_polita_update', 'partner_zona_curier_insert',
        'partner_zona_curier_update', 'client sterge propriile itemi cos', 'partener scrie propria pozitie',
        'prestator_autorizatii', 'partener gestioneaza propriile competente',
        'partener gestioneaza proprii servicii active', 'partener_disponibilitate', 'public_read_config',
        'program_lucru citire publica')) <> 20 then
    raise exception 'Revenire eșuată: nu s-au refăcut toate cele 20 de politici';
  end if;
  if not has_function_privilege('anon', 'public.blocheaza_email_disposable()', 'EXECUTE') then
    raise exception 'Revenire eșuată: dreptul EXECUTE nu s-a refăcut';
  end if;
end $$;

commit;
