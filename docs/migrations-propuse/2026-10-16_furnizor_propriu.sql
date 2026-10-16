-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (16 octombrie 2026)
-- Furnizorul propriu al platformei (Home Best Pal SRL) și entitățile
-- juridice ale platformei
-- ═══════════════════════════════════════════════════════════════════
--
-- Decizia LM (16 oct. 2026)
--   Home Best Pal SRL (CUI RO46577229) e furnizorul real al platformei
--   pentru materiale și închirieri, cu contul bricolage@homebestpal.com.
--   HBP SRL e și entitatea platformei (cea căreia îi facturează
--   partenerii): pentru produsele HBP nu există factură de partener către
--   sine și nici discount de 5–15%. HBP vinde direct clientului.
--
-- Ce face
--   1. partners.entitate_platforma_id (fk entitati_juridice_platforma,
--      nullable): un partener cu această coloană setată e furnizorul
--      propriu al platformei. O entitate are cel mult un cont de partener
--      (index unic parțial). Migrarea NU leagă HBP: superadminul îl leagă
--      din interfață (Entități juridice → „Leagă de contul de furnizor”).
--   2. comanda_subcontractori.discount_sursa: valoarea nouă
--      'furnizor_propriu' (0% reținut, fără factură de partener).
--   3. Entitatea „Home Best Pal Moldova SRL (FICTIV — testare…)”:
--      activa = false (nu se șterge; poate avea legături). Codul citește
--      doar entitățile active.
--   4. entitati_juridice_platforma: politica public_read_entitati_juridice
--      (citire `true` pentru oricine, inclusiv IBAN-ul) se șterge. Datele
--      publice (denumire, cui, nr_reg_com, adresa, tara_cod) se citesc prin
--      /api/public/entitati-juridice, doar pentru entitățile active; IBAN-ul
--      rămâne accesibil doar prin service role (API-urile de admin).
--      Verificat 16 oct. 2026: nicio pagină nu citește tabela direct cu
--      cheia anon; superadmin_write_entitati_juridice rămâne neschimbată.
--
-- Ordine de aplicare
--   ÎNAINTE de publicarea codului din branch-ul furnizor-propriu-hbp
--   (codul tolerează lipsa coloanei: fără ea, niciun partener nu e
--   furnizor propriu și totul merge ca azi).
--
-- Cum se aplică
--   O singură tranzacție, rulabilă de mai multe ori (if not exists /
--   drop ... if exists). Verificarea de la final oprește tranzacția dacă
--   ceva nu e cum trebuie.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- 1. Furnizorul propriu ───────────────────────────────────────────────
alter table public.partners
  add column if not exists entitate_platforma_id uuid;

alter table public.partners
  drop constraint if exists partners_entitate_platforma_id_fkey;
alter table public.partners
  add constraint partners_entitate_platforma_id_fkey
  foreign key (entitate_platforma_id) references public.entitati_juridice_platforma(id)
  on delete set null;

-- O entitate a platformei — cel mult un cont de partener.
create unique index if not exists partners_entitate_platforma_id_unic
  on public.partners (entitate_platforma_id)
  where entitate_platforma_id is not null;

comment on column public.partners.entitate_platforma_id is
  'Setat = partenerul e furnizorul propriu al platformei (aceeași firmă ca entitatea juridică): fără factură de partener și fără discount; vinde direct clientului. Se setează din superadmin (Entități juridice).';

-- 2. Escrow: sursa „furnizor_propriu” ────────────────────────────────
alter table public.comanda_subcontractori
  drop constraint if exists comanda_subcontractori_discount_sursa_check;
alter table public.comanda_subcontractori
  add constraint comanda_subcontractori_discount_sursa_check
  check (discount_sursa is null or discount_sursa in ('factura', 'profil_partener', 'implicit_panou', 'furnizor_propriu'));

comment on column public.comanda_subcontractori.discount_sursa is
  'De unde vine discount_pct_aplicat: factura | profil_partener | implicit_panou | furnizor_propriu (0%, vânzare directă a platformei, fără factură de partener).';

-- 3. Entitatea fictivă din Moldova: inactivă, nu ștearsă ─────────────
update public.entitati_juridice_platforma
set activa = false,
    actualizat_la = now()
where tara_cod = 'MD'
  and denumire ilike '%FICTIV%'
  and activa = true;

-- 4. Fără citire publică a tabelei (IBAN) ────────────────────────────
drop policy if exists public_read_entitati_juridice on public.entitati_juridice_platforma;

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
declare
  v_def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'partners' and column_name = 'entitate_platforma_id'
  ) then
    raise exception 'partners.entitate_platforma_id lipsește';
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'partners_entitate_platforma_id_unic') then
    raise exception 'indexul unic partners_entitate_platforma_id_unic lipsește';
  end if;

  select pg_get_constraintdef(oid) into v_def from pg_constraint
  where conrelid = 'public.comanda_subcontractori'::regclass and conname = 'comanda_subcontractori_discount_sursa_check';
  if v_def is null or v_def not like '%furnizor_propriu%' then
    raise exception 'comanda_subcontractori_discount_sursa_check nu acceptă furnizor_propriu';
  end if;

  if exists (select 1 from public.entitati_juridice_platforma where denumire ilike '%FICTIV%' and activa) then
    raise exception 'o entitate marcată FICTIV e încă activă';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'entitati_juridice_platforma' and policyname = 'public_read_entitati_juridice'
  ) then
    raise exception 'politica public_read_entitati_juridice există încă';
  end if;
end;
$$;

commit;
