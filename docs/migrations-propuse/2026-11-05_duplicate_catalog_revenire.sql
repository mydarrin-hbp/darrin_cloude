-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (5 noiembrie 2026)
-- Pasul 11-C8 — REVENIRE: anulează 2026-11-05_duplicate_catalog.sql
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce face
--   Pentru fiecare rând din public.catalog_servicii_backup_11c8 (copia făcută
--   de migrarea 11-C8), pune înapoi în catalog_servicii exact valorile de
--   dinainte: titlu, status_public și traduceri. Celelalte coloane și
--   celelalte produse nu se ating.
--   Copia de siguranță rămâne (revenirea se poate rula de mai multe ori; după
--   revenire, migrarea se poate aplica din nou). Tabelul de copie se poate
--   șterge separat, când LM decide: drop table public.catalog_servicii_backup_11c8;
--
-- Verificarea de la final (raise exception → nimic nu se schimbă): niciun
-- rând din copie nu mai diferă de catalog_servicii, iar toate cele 100 de
-- produse sunt din nou publice, cu titlul cu sufix.
--
-- Cum se aplică
--   O singură tranzacție, rulabilă de mai multe ori (a doua rulare nu mai
--   schimbă nimic).
-- ═══════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if to_regclass('public.catalog_servicii_backup_11c8') is null then
    raise exception '11-C8 revenire: lipsește public.catalog_servicii_backup_11c8 (migrarea 11-C8 nu a fost aplicată) — nimic de refăcut';
  end if;
end;
$$;

update public.catalog_servicii s
set titlu         = b.titlu,
    status_public = b.status_public,
    traduceri     = b.traduceri
from public.catalog_servicii_backup_11c8 b
where b.id = s.id
  and (s.titlu is distinct from b.titlu
       or s.status_public is distinct from b.status_public
       or s.traduceri is distinct from b.traduceri);

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
declare
  n_copie     int;
  n_diferite  int;
  n_publice   int;
begin
  select count(*) into n_copie from public.catalog_servicii_backup_11c8;
  select count(*) into n_diferite
  from public.catalog_servicii_backup_11c8 b
  left join public.catalog_servicii s on s.id = b.id
  where s.id is null
     or s.titlu is distinct from b.titlu
     or s.status_public is distinct from b.status_public
     or s.traduceri is distinct from b.traduceri;
  select count(*) into n_publice
  from public.catalog_servicii s
  join public.catalog_servicii_backup_11c8 b on b.id = s.id
  where s.status_public and s.titlu ~ '\s+v\d+$';

  if n_diferite <> 0 then
    raise exception '11-C8 revenire: % rânduri diferă încă de copie — nimic nu s-a schimbat', n_diferite;
  end if;
  if n_publice <> n_copie then
    raise exception '11-C8 revenire: % produse publice cu sufix din % copiate — nimic nu s-a schimbat', n_publice, n_copie;
  end if;
end;
$$;

commit;

-- Rezultatul: rândurile refăcute, pe grupuri (10 grupuri × 10 copii, toate publice).
select regexp_replace(s.titlu, '\s+v\d+$', '') as titlu_baza,
       count(*)                                  as copii,
       count(*) filter (where s.status_public)   as publice
from public.catalog_servicii s
join public.catalog_servicii_backup_11c8 b on b.id = s.id
group by 1
order by 1;
