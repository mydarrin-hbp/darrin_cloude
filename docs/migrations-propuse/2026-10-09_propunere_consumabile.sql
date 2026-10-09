-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU APROBARE LM — NU SE APLICĂ ÎNCĂ (9 octombrie 2026)
-- Marcarea consumabilelor în devize_resurse.este_consumabil
-- ═══════════════════════════════════════════════════════════════════
-- Necesită migrarea 2026-10-09_reguli_flexibile.sql (coloana este_consumabil).
-- Nivelul Silver cu „materiale = consumabile” include doar resursele marcate.
--
-- Pasul 1 (doar citire): lista propusă. Rulați, verificați, eliminați ce nu
-- e consumabil (ex. „bandă transportoare” nu e bandă izolatoare).
select resursa_id, cod_resursa, denumire_resursa, unitate_masura
from public.devize_resurse
where tip_resursa = 'M'
  and coalesce(este_consumabil, false) = false
  and (
       denumire_resursa ilike '%garnitur%'
    or denumire_resursa ilike '%teflon%'
    or denumire_resursa ilike '%calti%'  or denumire_resursa ilike '%câlți%' or denumire_resursa ilike '%cilti%'
    or denumire_resursa ilike '%banda izol%' or denumire_resursa ilike '%bandă izol%'
    or denumire_resursa ilike '%banda adeziv%' or denumire_resursa ilike '%bandă adeziv%'
    or denumire_resursa ilike '%surub%'  or denumire_resursa ilike '%șurub%' or denumire_resursa ilike '%şurub%'
    or denumire_resursa ilike '%diblu%'
    or denumire_resursa ilike '%papuc%'
    or denumire_resursa ilike '%colier%' or denumire_resursa ilike '%clema%' or denumire_resursa ilike '%clemă%'
    or denumire_resursa ilike '%dop %'   or denumire_resursa ilike '%piulit%' or denumire_resursa ilike '%saib%' or denumire_resursa ilike '%șaib%'
    or denumire_resursa ilike '%silicon%' or denumire_resursa ilike '%pasta de%' or denumire_resursa ilike '%pastă de%'
  )
order by denumire_resursa;

-- Pasul 2 (după aprobare): marcați doar id-urile aprobate.
-- begin;
-- update public.devize_resurse set este_consumabil = true
-- where resursa_id in (/* id-urile aprobate */);
-- select count(*) as consumabile_marcate from public.devize_resurse where este_consumabil;
-- commit;
