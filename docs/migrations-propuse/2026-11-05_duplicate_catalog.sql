-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (5 noiembrie 2026)
-- Pasul 11-C8: duplicatele „v1”…„v100” din catalog ascunse (fără ștergere),
-- titluri curate RO + EN, cu copie de siguranță și revenire
-- ═══════════════════════════════════════════════════════════════════
--
-- De ce
--   În catalog_servicii sunt 100 de produse publice din „Bricolaj &
--   Consumabile” care sunt 10 produse de bază, fiecare de 10 ori, cu sufixul
--   „ v1”…„ v100” în titlu (create pe 7 iul. 2026, de admin). Copiile aceluiași
--   produs au exact aceleași prețuri; 0 comenzi și 0 produse în coș pe ele
--   (raportul 11-C7, verificat de LM). Decizia LM (5 nov. 2026): din fiecare
--   grup rămâne public un singur produs, cel cu sufixul cel mai mic; celelalte
--   90 se ascund, nu se șterg.
--
-- Ce face
--   1. Copia de siguranță: tabelul public.catalog_servicii_backup_11c8
--      (id, titlu, status_public, traduceri, copiat_la), creat dacă lipsește.
--      Se adaugă doar rândurile care se schimbă acum și care nu sunt deja în
--      copie — prima copie (valorile originale) nu se suprascrie niciodată.
--      Tabelul are RLS activat, fără politici, și fără drepturi pentru anon /
--      authenticated: nu se vede prin API-ul public.
--   2. Grupurile: produsele publice cu sufix (titlu ~ '\s+v\d+$'), grupate
--      după titlul fără sufix — doar cele 10 titluri de bază din lista de mai
--      jos. În fiecare grup se păstrează rândul cu sufixul cel mai mic
--      (numeric: v2 < v10).
--   3. Celelalte 90 primesc status_public = false. Nivelurile, prețurile și
--      restul coloanelor rămân neatinse (nicio ștergere).
--   4. Cele 10 păstrate primesc titlul curat în română (fără sufix, cu
--      diacritice) și traduceri.en.titlu în engleză — aceeași formă ca în
--      api/admin/ruta-incadrare.js: { "en": { "titlu": "…" } }; celelalte
--      chei din traduceri se păstrează.
--   5. Verificarea de la final (raise exception → nimic nu se schimbă):
--      exact 10 produse publice din aceste grupuri, 0 titluri publice cu
--      sufix v\d+, 90 de rânduri ascunse și copia cu 100 de rânduri.
--
-- Ce schimbă azi (citit 5 nov. 2026, doar SELECT): 100 de rânduri.
--   Păstrate (10):  id_serviciu mat-…-v1 … mat-…-v10 (unul pe grup).
--   Ascunse (90):   restul copiilor. Publice după migrare: 226 → 136.
--   Pe catalog_servicii nu există trigger-e; constrângerile (traduceri
--   obiect, public ⇒ stare publicat, id_serviciu unic) nu sunt încălcate.
--
-- Cum se aplică
--   O singură tranzacție, rulabilă de mai multe ori: a doua rulare nu mai
--   găsește titluri publice cu sufix și nu schimbă nimic. Revenirea:
--   2026-11-05_duplicate_catalog_revenire.sql.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- Titlurile curate: titlul de bază (fără sufix, cum e azi) → RO și EN.
drop table if exists pg_temp.duplicate_catalog_titluri;
create temp table duplicate_catalog_titluri (
  baza     text primary key,
  titlu_ro text not null,
  titlu_en text not null
);
insert into duplicate_catalog_titluri (baza, titlu_ro, titlu_en) values
  ('Robinet trecere sferic 1/2',          'Robinet de trecere sferic 1/2"',         '1/2" ball valve'),
  ('Priza dubla ceramica Schneider',      'Priză dublă ceramică Schneider',          'Schneider double ceramic socket'),
  ('Siguranta automata diferentiala 16A', 'Siguranță automată diferențială 16 A',    '16 A residual current circuit breaker'),
  ('Teava cupru 15mm',                    'Țeavă cupru 15 mm',                       '15 mm copper pipe'),
  ('Cot cupru 90 grade 15mm',             'Cot cupru 90°, 15 mm',                    '90° copper elbow, 15 mm'),
  ('Filtru Y pentru impuritati 3/4',      'Filtru Y pentru impurități 3/4"',         '3/4" Y strainer'),
  ('Garnitura siliconica set 10 buc',     'Garnituri siliconice, set de 10 buc.',    'Silicone seals, set of 10'),
  ('Adeziv gresie/faianta sac 25kg',      'Adeziv gresie și faianță, sac 25 kg',     'Floor and wall tile adhesive, 25 kg bag'),
  ('Vopsea lavabila alba 15L',            'Vopsea lavabilă albă 15 L',               'White washable paint, 15 L'),
  ('Cablu electric CYY-F 3x2.5 m',        'Cablu electric CYY-F 3×2,5 mm²',          'CYY-F 3×2.5 mm² electrical cable');

-- 1. Copia de siguranță (creată o singură dată; nu se vede prin API).
create table if not exists public.catalog_servicii_backup_11c8 as
  select id, titlu, status_public, traduceri, now() as copiat_la
  from public.catalog_servicii
  where false;
create unique index if not exists catalog_servicii_backup_11c8_id on public.catalog_servicii_backup_11c8 (id);
alter table public.catalog_servicii_backup_11c8 enable row level security;
revoke all on public.catalog_servicii_backup_11c8 from anon, authenticated;
comment on table public.catalog_servicii_backup_11c8 is
  'Pasul 11-C8 (5 nov. 2026): copia rândurilor din catalog_servicii schimbate de 2026-11-05_duplicate_catalog.sql (valorile dinainte). Folosită de 2026-11-05_duplicate_catalog_revenire.sql.';

-- 2. Grupurile: produse publice cu sufix, doar cele 10 titluri de bază din listă.
drop table if exists pg_temp.duplicate_catalog_randuri;
create temp table duplicate_catalog_randuri as
select s.id,
       s.titlu,
       s.status_public,
       s.traduceri,
       regexp_replace(s.titlu, '\s+v\d+$', '')          as baza,
       (substring(s.titlu from '\s+v(\d+)$'))::int        as sufix,
       row_number() over (
         partition by regexp_replace(s.titlu, '\s+v\d+$', '')
         order by (substring(s.titlu from '\s+v(\d+)$'))::int, s.id
       ) = 1                                              as pastrat
from public.catalog_servicii s
join duplicate_catalog_titluri t on t.baza = regexp_replace(s.titlu, '\s+v\d+$', '')
where s.status_public = true
  and s.titlu ~ '\s+v\d+$';

-- Copia: doar rândurile care se schimbă acum și care nu sunt deja copiate.
insert into public.catalog_servicii_backup_11c8 (id, titlu, status_public, traduceri, copiat_la)
select r.id, r.titlu, r.status_public, r.traduceri, now()
from duplicate_catalog_randuri r
on conflict (id) do nothing;

-- 3. Copiile în plus se ascund (nu se șterg).
update public.catalog_servicii s
set status_public = false
from duplicate_catalog_randuri r
where r.id = s.id
  and not r.pastrat;

-- 4. Cel păstrat: titlul curat RO + traduceri.en.titlu (celelalte chei rămân).
update public.catalog_servicii s
set titlu     = t.titlu_ro,
    traduceri = jsonb_set(
                  coalesce(s.traduceri, '{}'::jsonb),
                  '{en}',
                  (case when jsonb_typeof(s.traduceri -> 'en') = 'object' then s.traduceri -> 'en' else '{}'::jsonb end)
                    || jsonb_build_object('titlu', t.titlu_en),
                  true)
from duplicate_catalog_randuri r
join duplicate_catalog_titluri t on t.baza = r.baza
where r.id = s.id
  and r.pastrat;

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
declare
  n_copie    int;
  n_publice  int;
  n_ascunse  int;
  n_sufix    int;
  n_curate   int;
begin
  select count(*) into n_copie from public.catalog_servicii_backup_11c8;
  select count(*) filter (where s.status_public),
         count(*) filter (where not coalesce(s.status_public, false))
    into n_publice, n_ascunse
  from public.catalog_servicii s
  join public.catalog_servicii_backup_11c8 b on b.id = s.id;
  select count(*) into n_sufix from public.catalog_servicii where status_public and titlu ~ '\s+v\d+$';
  select count(*) into n_curate
  from public.catalog_servicii s
  join pg_temp.duplicate_catalog_titluri t on t.titlu_ro = s.titlu
  join public.catalog_servicii_backup_11c8 b on b.id = s.id
  where s.status_public and s.traduceri -> 'en' ->> 'titlu' = t.titlu_en;

  if n_sufix <> 0 then
    raise exception '11-C8: % produse publice au încă sufix „ vN” în titlu (așteptat 0) — nimic nu s-a schimbat', n_sufix;
  end if;
  if n_copie <> 100 then
    raise exception '11-C8: copia de siguranță are % rânduri (așteptat 100) — nimic nu s-a schimbat', n_copie;
  end if;
  if n_publice <> 10 then
    raise exception '11-C8: % produse publice din aceste grupuri (așteptat 10) — nimic nu s-a schimbat', n_publice;
  end if;
  if n_ascunse <> 90 then
    raise exception '11-C8: % rânduri ascunse (așteptat 90) — nimic nu s-a schimbat', n_ascunse;
  end if;
  if n_curate <> 10 then
    raise exception '11-C8: % produse păstrate au titlul curat RO + EN (așteptat 10) — nimic nu s-a schimbat', n_curate;
  end if;
end;
$$;

commit;

-- Rezultatul: cele 10 produse rămase publice (titlul vechi → nou, RO și EN)
-- și numărul de rânduri ascunse. La a doua rulare arată același lucru.
select b.id,
       s.id_serviciu,
       b.titlu                         as titlu_vechi,
       s.titlu                         as titlu_nou_ro,
       s.traduceri -> 'en' ->> 'titlu' as titlu_nou_en,
       (select count(*) from public.catalog_servicii_backup_11c8 b2
          join public.catalog_servicii s2 on s2.id = b2.id
         where not coalesce(s2.status_public, false)
           and regexp_replace(b2.titlu, '\s+v\d+$', '') = regexp_replace(b.titlu, '\s+v\d+$', '')) as copii_ascunse
from public.catalog_servicii_backup_11c8 b
join public.catalog_servicii s on s.id = b.id
where s.status_public
order by (substring(b.titlu from '\s+v(\d+)$'))::int;
