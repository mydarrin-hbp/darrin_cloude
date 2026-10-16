-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (16 octombrie 2026)
-- Pasul 11-H1, punctul 2.6: datele firmei furnizorului propriu, din ANAF
-- ═══════════════════════════════════════════════════════════════════
--
-- De ce
--   La înregistrare, contul de furnizor al Home Best Pal (partners) a
--   primit datele scrise de mână („Home Best Pal”, adresa „Nordului nr 3- A
--   11”), în timp ce entitatea RO a platformei (entitati_juridice_platforma)
--   are datele oficiale din ANAF („HOME BEST PAL S.R.L.”, J04/1319/2022,
--   adresa completă din Bacău). E aceeași firmă (decizia 26, pasul 10a).
--
-- Ce face
--   Pentru fiecare partener cu entitate_platforma_id setat (furnizorul
--   propriu), copiază din entitatea legată în partners:
--     denumire   → nume_firma
--     nr_reg_com → nr_reg_com
--     adresa     → adresa_sediu_social
--   doar unde valoarea entității nu e goală și diferă. CUI-ul nu se schimbă.
--   La final: lista rândurilor schimbate (înainte / după).
--
-- Ce schimbă azi (citit 16 oct. 2026, doar SELECT): 1 rând,
--   partners b6014c22-cdc0-4af2-8a1a-412f432fb917 (CUI RO46577229):
--     nume_firma          „Home Best Pal”       → „HOME BEST PAL S.R.L.”
--     adresa_sediu_social „Nordului nr 3- A 11” → „JUD. BACĂU, MUN. BACĂU, STR. NORDULUI, NR.3, SC.A, ET.2, AP.11”
--     nr_reg_com          J04/1319/2022 (identic, nu se schimbă)
--   Pe partners nu există trigger-e; constrângerile (cheia primară, CUI unic,
--   status_verificare, tip_entitate_legala, cheile externe) nu sunt atinse.
--
-- Cerință: migrarea 2026-10-16_furnizor_propriu.sql aplicată (coloana
-- partners.entitate_platforma_id). Fără ea, verificarea de mai jos oprește
-- tranzacția.
--
-- Cum se aplică
--   O singură tranzacție, rulabilă de mai multe ori (a doua rulare nu mai
--   schimbă nimic). Verificarea de la final oprește tranzacția dacă un
--   furnizor propriu are încă date diferite de entitate.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- Raportul rulării (tabelă temporară a sesiunii, doar pentru lista de la final).
drop table if exists pg_temp.furnizor_propriu_date_anaf_raport;
create temp table furnizor_propriu_date_anaf_raport (
  partener_id uuid,
  camp text,
  inainte text,
  dupa text
);

-- 1. Ce se schimbă (înainte / după), pe câmp ─────────────────────────
insert into furnizor_propriu_date_anaf_raport (partener_id, camp, inainte, dupa)
select p.id, c.camp, c.inainte, c.dupa
from public.partners p
join public.entitati_juridice_platforma e on e.id = p.entitate_platforma_id
cross join lateral (values
  ('nume_firma',          p.nume_firma,          nullif(btrim(e.denumire), '')),
  ('nr_reg_com',          p.nr_reg_com,          nullif(btrim(e.nr_reg_com), '')),
  ('adresa_sediu_social', p.adresa_sediu_social, nullif(btrim(e.adresa), ''))
) as c(camp, inainte, dupa)
where c.dupa is not null
  and c.inainte is distinct from c.dupa;

-- 2. Actualizarea (doar valorile nevide și diferite; CUI-ul rămâne) ─────
update public.partners p
set nume_firma = case when nullif(btrim(e.denumire), '') is not null
                      then btrim(e.denumire) else p.nume_firma end,
    nr_reg_com = case when nullif(btrim(e.nr_reg_com), '') is not null
                      then btrim(e.nr_reg_com) else p.nr_reg_com end,
    adresa_sediu_social = case when nullif(btrim(e.adresa), '') is not null
                               then btrim(e.adresa) else p.adresa_sediu_social end
from public.entitati_juridice_platforma e
where e.id = p.entitate_platforma_id
  and (
       (nullif(btrim(e.denumire), '')   is not null and p.nume_firma          is distinct from btrim(e.denumire))
    or (nullif(btrim(e.nr_reg_com), '') is not null and p.nr_reg_com          is distinct from btrim(e.nr_reg_com))
    or (nullif(btrim(e.adresa), '')     is not null and p.adresa_sediu_social is distinct from btrim(e.adresa))
  );

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'partners' and column_name = 'entitate_platforma_id'
  ) then
    raise exception 'partners.entitate_platforma_id lipsește: aplică întâi 2026-10-16_furnizor_propriu.sql';
  end if;

  if exists (
    select 1
    from public.partners p
    join public.entitati_juridice_platforma e on e.id = p.entitate_platforma_id
    where (nullif(btrim(e.denumire), '')   is not null and p.nume_firma          is distinct from btrim(e.denumire))
       or (nullif(btrim(e.nr_reg_com), '') is not null and p.nr_reg_com          is distinct from btrim(e.nr_reg_com))
       or (nullif(btrim(e.adresa), '')     is not null and p.adresa_sediu_social is distinct from btrim(e.adresa))
  ) then
    raise exception 'un furnizor propriu are încă date diferite de entitatea platformei';
  end if;
end;
$$;

commit;

-- Raportul: rândurile schimbate la această rulare (gol la a doua rulare).
select r.partener_id, p.cui, r.camp, r.inainte, r.dupa
from furnizor_propriu_date_anaf_raport r
join public.partners p on p.id = r.partener_id
order by r.partener_id, r.camp;
