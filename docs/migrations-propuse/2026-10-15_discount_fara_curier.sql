-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (15 octombrie 2026)
-- Curierii nu acordă discount — și în baza de date
-- ═══════════════════════════════════════════════════════════════════
--
-- Regula LM (14 oct. 2026): curieratul e transport, cu 0% comision;
-- curierul primește 100% din tarif și nu acordă discount. Codul o aplică
-- deja (lib/discount-partener.js: TIPURI_FARA_DISCOUNT = curier,
-- curier_utilitara). Migrarea o aduce și în constrângeri:
--   - parteneri_discounturi.tip_partener: fără 'curier';
--   - discount_categorii.tip_partener: fără 'curier' (lista de categorii
--     din care se aleg discounturile, legată prin cheie externă).
--   'curier_utilitara' nu a fost niciodată permis în aceste constrângeri.
--
-- Date: ambele tabele sunt goale azi (verificat 15 oct. 2026). Dacă între
-- timp apare vreun rând de curier, migrarea se oprește (nu șterge nimic).
-- comanda_subcontractori.rol_tip = 'curier' (escrow, transport) nu e atins.
--
-- Cum se aplică
--   O singură tranzacție, rulabilă de mai multe ori (drop constraint if
--   exists + add). Verificarea de la final oprește tranzacția dacă ceva
--   nu e cum trebuie.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- 0. Nimic de pierdut: fără rânduri de curier în niciunul dintre tabele.
do $$
begin
  if exists (select 1 from public.parteneri_discounturi where tip_partener = 'curier') then
    raise exception 'parteneri_discounturi are rânduri cu tip_partener = curier; le verifică LM înainte de migrare';
  end if;
  if exists (select 1 from public.discount_categorii where tip_partener = 'curier') then
    raise exception 'discount_categorii are categorii cu tip_partener = curier; le verifică LM înainte de migrare';
  end if;
end;
$$;

-- 1. Discounturile partenerilor: doar materiale, închirieri, asigurări.
alter table public.parteneri_discounturi
  drop constraint if exists parteneri_discounturi_tip_partener_check;
alter table public.parteneri_discounturi
  add constraint parteneri_discounturi_tip_partener_check
  check (tip_partener in ('materiale', 'inchirieri', 'asigurari'));

-- 2. Categoriile de discount: aceleași trei tipuri.
alter table public.discount_categorii
  drop constraint if exists discount_categorii_tip_partener_check;
alter table public.discount_categorii
  add constraint discount_categorii_tip_partener_check
  check (tip_partener in ('materiale', 'inchirieri', 'asigurari'));

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
  where conrelid = 'public.parteneri_discounturi'::regclass and conname = 'parteneri_discounturi_tip_partener_check';
  if v_def is null or v_def like '%curier%' then
    raise exception 'Constrângerea parteneri_discounturi_tip_partener_check lipsește sau permite încă curier: %', v_def;
  end if;
  select pg_get_constraintdef(oid) into v_def from pg_constraint
  where conrelid = 'public.discount_categorii'::regclass and conname = 'discount_categorii_tip_partener_check';
  if v_def is null or v_def like '%curier%' then
    raise exception 'Constrângerea discount_categorii_tip_partener_check lipsește sau permite încă curier: %', v_def;
  end if;
end;
$$;

commit;
