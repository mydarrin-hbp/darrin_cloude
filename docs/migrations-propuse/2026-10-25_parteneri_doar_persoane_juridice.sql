-- My Darrin — pasul 11-P1 / step 11-P1
-- Parteneri: doar entități cu statut juridic (fără persoană fizică).
-- Partners: legal entities only (no private individuals).
-- Rulează în Supabase SQL Editor ÎNAINTE de merge. / Run in the SQL Editor BEFORE merge.
-- Verificat read-only pe 25 oct. 2026: 3 rânduri în partners, toate 'srl', niciun 'persoana_fizica', niciun NULL.

begin;

-- 1. Garda: oprește dacă există parteneri persoană fizică sau fără formă juridică.
do $$
begin
  if exists (select 1 from public.partners
             where tip_entitate_legala is null or tip_entitate_legala = 'persoana_fizica') then
    raise exception '11-P1: există parteneri fără formă juridică sau persoană fizică. Oprește și anunță.';
  end if;
end $$;

-- 2. Lista nouă de forme juridice (fără persoana_fizica).
alter table public.partners drop constraint if exists partners_tip_entitate_legala_check;
alter table public.partners add constraint partners_tip_entitate_legala_check
  check (tip_entitate_legala in (
    'pfa', 'ii', 'if',                 -- PFA, întreprindere individuală, întreprindere familială
    'srl', 'srl_d', 'sa',
    'snc', 'scs', 'sca', 'cooperativa',
    'institutie_publica',
    'firma_straina'                    -- formă juridică dintr-o altă țară (Ltd, GmbH, EOOD…)
  ));

-- 3. Forma juridică devine obligatorie.
alter table public.partners alter column tip_entitate_legala set not null;

-- 4. Pentru firma_straina: denumirea formei juridice locale (ex. „GmbH”).
alter table public.partners add column if not exists forma_juridica_locala text;
alter table public.partners drop constraint if exists partners_forma_locala_check;
alter table public.partners add constraint partners_forma_locala_check
  check (tip_entitate_legala <> 'firma_straina' or nullif(trim(forma_juridica_locala), '') is not null);

commit;

-- Verificare / Check:
-- select tip_entitate_legala, count(*) from public.partners group by 1;
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'partners_tip_entitate_legala_check';
