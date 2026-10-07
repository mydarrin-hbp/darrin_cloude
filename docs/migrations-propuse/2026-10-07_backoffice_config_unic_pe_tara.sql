-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (7 octombrie 2026)
-- backoffice_config: o cheie poate avea câte un rând pe țară
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce rezolvă
--   Panoul „Comisioane & Tarifare” salvează câte un rând pe (cheie, tara_cod)
--   (upsert cu onConflict 'cheie,tara_cod' în mydarrin-superadmin.html), iar
--   codul citește întâi `ALL`, apoi rândul țării (lib/calculeaza-pret.js,
--   lib/elibereaza-escrow.js). Cu UNIQUE(cheie), un rând pe țară nu putea
--   exista deloc.
--
-- Starea producției (verificată 7 octombrie 2026, în timpul review-ului)
--   Schimbarea pare deja făcută direct în producție, fără înregistrare în
--   lista de migrări: tara_cod e NOT NULL cu default 'ALL', există
--   backoffice_config_cheie_tara_key UNIQUE (cheie, tara_cod), iar
--   backoffice_config_cheie_key nu mai există. Toate cele 28 de rânduri au
--   tara_cod = 'ALL'. Migrarea e scrisă idempotent: pe producție nu schimbă
--   nimic, pe un mediu nou (sau pe backup) aduce schema în aceeași stare.
--
-- Ordine de lansare: PRIMA, înaintea 2026-10-07_escrow_discount_aplicat.sql
-- și 2026-10-06_parteneri_discounturi.sql (care inserează cu
-- on conflict (cheie, tara_cod)). Vezi PR.md.
-- ═══════════════════════════════════════════════════════════════════

-- 1. tara_cod obligatoriu; rândurile fără țară devin `ALL`.
update public.backoffice_config set tara_cod = 'ALL' where tara_cod is null;
alter table public.backoffice_config alter column tara_cod set default 'ALL';
alter table public.backoffice_config alter column tara_cod set not null;

-- 2. Cheia nu mai e unică singură…
alter table public.backoffice_config drop constraint if exists backoffice_config_cheie_key;

-- 3. …ci împreună cu țara.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.backoffice_config'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (cheie, tara_cod)'
  ) then
    alter table public.backoffice_config
      add constraint backoffice_config_cheie_tara_key unique (cheie, tara_cod);
  end if;
end;
$$;
