-- My Darrin — pasul 11-P3b / step 11-P3b
-- Județul Călărași (CL) în geo_regiuni, între Caraș-Severin (12) și Cluj.
-- Călărași county (CL) in geo_regiuni, between Caraș-Severin (12) and Cluj.
-- DEJA RULATĂ de LM pe 28 oct. 2026 (43 de rânduri RO). Rulată din nou nu schimbă nimic.
-- ALREADY RUN by LM on 28 Oct 2026 (43 RO rows). Running it again changes nothing.

begin;

do $$
begin
  if not exists (select 1 from public.geo_regiuni where tara_cod = 'RO' and cod = 'CL') then
    -- Fă loc pe poziția 13: județele de la Cluj încolo coboară cu o poziție.
    update public.geo_regiuni
       set ordine = ordine + 1
     where tara_cod = 'RO' and ordine >= 13;

    insert into public.geo_regiuni (tara_cod, cod, denumire, ordine)
    values ('RO', 'CL', 'Călărași', 13);
  end if;
end $$;

commit;

-- Verificare / Check:
-- select count(*) from public.geo_regiuni where tara_cod = 'RO';            -- 43
-- select cod, denumire, ordine from public.geo_regiuni
--  where tara_cod = 'RO' and ordine between 12 and 14 order by ordine;     -- CS 12, CL 13, CJ 14
