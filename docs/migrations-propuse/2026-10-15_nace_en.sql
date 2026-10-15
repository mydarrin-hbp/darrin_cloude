-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (15 octombrie 2026)
-- NACE Rev. 2.1 în engleză: doar coloanele, fără date
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce adaugă
--   nace_reference.denumire_en și nace_sectiuni.denumire_en (text, goale).
--   Denumirile oficiale în engleză (Eurostat, NACE Rev. 2.1: 22 secțiuni,
--   87 diviziuni, 939 clase) le încarcă LM separat, cu un SQL verificat în
--   afara acestui task. Nu se folosesc fișierele CAEN Rev. 2 de pe
--   data.gov.ro (doar română, revizia veche).
--
-- Codul
--   /api/public/nace-lista și /api/partener/wizard-nace întorc, pentru
--   ?lang=en, denumire_en cu rezervă pe denumire_ro. Înainte de migrare și
--   cât timp denumire_en e goală, răspunsul e identic cu cel de azi.
--
-- Cum se aplică
--   O singură tranzacție, rulabilă de mai multe ori (add column if not
--   exists). Verificarea de la final oprește tranzacția dacă ceva lipsește.
-- ═══════════════════════════════════════════════════════════════════

begin;

alter table public.nace_reference
  add column if not exists denumire_en text;
comment on column public.nace_reference.denumire_en is
  'Denumirea oficială în engleză (Eurostat, NACE Rev. 2.1). Goală până la încărcarea traducerii; aplicația cade pe denumire_ro.';

alter table public.nace_sectiuni
  add column if not exists denumire_en text;
comment on column public.nace_sectiuni.denumire_en is
  'Denumirea oficială în engleză a secțiunii (Eurostat, NACE Rev. 2.1). Goală până la încărcarea traducerii.';

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'nace_reference' and column_name = 'denumire_en') then
    raise exception 'Lipsește nace_reference.denumire_en';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'nace_sectiuni' and column_name = 'denumire_en') then
    raise exception 'Lipsește nace_sectiuni.denumire_en';
  end if;
end;
$$;

commit;

-- Control (după commit): rândurile și câte au deja denumire în engleză.
select 'nace_reference' tabel, count(*) total, count(denumire_en) cu_en from public.nace_reference
union all
select 'nace_sectiuni', count(*), count(denumire_en) from public.nace_sectiuni;
