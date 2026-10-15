-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (15 octombrie 2026)
-- Regula universală de încadrare: NACE → meniu → serviciu publicat
-- (pasul 8; documentul de referință: docs/regula-incadrare.md)
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce adaugă
--   1. meniu_capitole (nou): cele 11 capitole ale meniului, cu secțiunile /
--      diviziunile / clasele NACE, tipul de partener și regula de bani
--      (discount_permis = doar furnizori, închirieri, asigurări).
--   2. categorii (nodul de meniu): capitol_cod, nace_clasa, title_en,
--      autorizare_necesara, activ. Doar coloane; datele se completează la
--      pasul 10, după deciziile LM.
--   3. catalog_servicii: nod_id, stare (ciorna / in_verificare / publicat /
--      retras), creat_din_serviciu_id, ruta_validata_la, ruta_rezultat.
--      Serviciile publice de azi (status_public = true) primesc stare
--      'publicat', ca să rămână vizibile; restul rămân 'ciorna'. De acum,
--      status_public = true doar cu stare = 'publicat' (constrângere).
--   4. competente_esco.tip_cod: 'esco' / 'isco' / 'cor', calculat din
--      formatul codului (coloană generată). Etichetele nu se corectează aici.
--   5. admin_permissions: ATENȚIE — singura modificare de structură aici e
--      relaxarea constrângerii sectiune_specializata, care azi permite doar
--      financiar / fiscal / catalog / deviz. Regula adminului de catalog
--      (sectiune = 'catalog_servicii', sectiune_specializata = codul
--      capitolului sau '*') nu poate fi salvată altfel. Se permit în plus
--      '*' și o listă de coduri de capitol separate prin virgulă ("F,N").
--      Unicitatea (admin_id, sectiune) rămâne: un singur rând de catalog pe admin.
--   6. retete_propuse + retete_propuse_linii (noi): rețeta propusă automat,
--      aprobată de adminul dedicat.
--   7. devize_indicatoare: indicatorul 'MDR' („My Darrin — rețete aprobate în
--      back-office”), sub care se creează articolele rețetelor aprobate
--      (devize_articole.indicator_id are cheie externă spre indicatori).
--
--   8. RLS pe catalog_servicii / catalog_niveluri / catalog_preturi (pasul 8b):
--      ciornele nu mai sunt publice. Citirea publică rămâne doar pentru
--      serviciile publice și, prin ele, pentru nivelurile și prețurile lor.
--      Se șterg politicile de scriere directă din client (pe coloana veche
--      profiles.role), care ocoleau ruta: nicio pagină nu scrie direct în
--      aceste tabele, totul trece prin api/admin/* cu service_role.
--
-- RLS: tabelele noi au RLS activ și nicio politică pentru anon /
-- authenticated; scrie doar service_role, prin API (api/admin/ruta-incadrare.js).
--
-- Necesită întâi 2026-10-10_traduceri_catalog.sql
--   Titlul în engleză al serviciului (regula E8) se citește din
--   catalog_servicii.traduceri.en.titlu. Fără coloana `traduceri`, orice
--   publicare ar da E8; de aceea migrarea se oprește dacă ea lipsește.
--
-- Ordinea de aplicare (pasul 8b, corectată)
--   1. Merge în main (codul merge și fără migrare: crearea de servicii
--      rămâne cea de azi, endpoint-ul de rută răspunde clar).
--   2. 2026-10-10_traduceri_catalog.sql, în SQL Editor.
--   3. Această migrare, în SQL Editor.
--   Invers nu: aplicată înainte de merge, codul vechi din main ar crea
--   servicii cu status_public = true și stare implicit 'ciorna', pe care
--   constrângerea catalog_servicii_public_doar_publicat le-ar bloca.
--
-- Cum se aplică
--   O singură tranzacție, rulabilă de mai multe ori (if not exists / drop ...
--   if exists / on conflict do nothing). Verificarea de la final oprește
--   tranzacția dacă ceva lipsește.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 0. Dependența: traducerile catalogului ───────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'catalog_servicii' and column_name = 'traduceri') then
    raise exception 'Aplică întâi 2026-10-10_traduceri_catalog.sql';
  end if;
end;
$$;

-- ── 1. Capitolele meniului ───────────────────────────────────────
create table if not exists public.meniu_capitole (
  cod              text primary key,
  titlu_ro         text not null,
  titlu_en         text not null,
  sectiuni_nace    text[] not null default '{}',
  diviziuni_nace   text[] not null default '{}',
  clase_nace       text[] not null default '{}',   -- capitole compuse (ex. AGR = 01.61, 33.12, 77.31); au prioritate față de diviziuni
  tip_partener     text not null check (tip_partener in ('servicii', 'curier', 'materiale', 'inchirieri', 'asigurari', 'personal')),
  discount_permis  boolean not null default false,
  ordine           integer not null default 0,
  activ            boolean not null default true,
  creat_la         timestamptz not null default now(),
  -- regula 9: discount doar la furnizori, închirieri și asigurări
  constraint meniu_capitole_regula_bani check (discount_permis = (tip_partener in ('materiale', 'inchirieri', 'asigurari')))
);
alter table public.meniu_capitole enable row level security;

insert into public.meniu_capitole (cod, titlu_ro, titlu_en, sectiuni_nace, diviziuni_nace, clase_nace, tip_partener, discount_permis, ordine) values
  ('F',   'Construcții și renovări',             'Construction and renovation',        '{F}', '{41,42,43}', '{}',                  'servicii',   false, 1),
  ('N',   'Proiectare și servicii tehnice',      'Design and technical services',      '{}',  '{71}',       '{74.13}',             'servicii',   false, 2),
  ('O81', 'Curățenie și spații verzi',           'Cleaning and green spaces',          '{}',  '{81}',       '{}',                  'servicii',   false, 3),
  ('T',   'Reparații pentru casă, auto și moto', 'Home, car and motorcycle repairs',   '{}',  '{95}',       '{}',                  'servicii',   false, 4),
  ('AGR', 'Servicii agricole',                   'Agricultural services',              '{}',  '{}',         '{01.61,33.12,77.31}', 'servicii',   false, 5),
  ('H',   'Transport, mutări și curierat',       'Transport, removals and courier',    '{}',  '{49,53}',    '{}',                  'curier',     false, 6),
  ('E',   'Moloz și deșeuri',                    'Rubble and waste',                   '{}',  '{38}',       '{}',                  'servicii',   false, 7),
  ('O77', 'Închirieri',                          'Rentals',                            '{}',  '{77}',       '{}',                  'inchirieri', true,  8),
  ('G',   'Aprovizionare materiale',             'Material supplies',                  '{}',  '{46,47}',    '{23.63}',             'materiale',  true,  9),
  ('L',   'Asigurări',                           'Insurance',                          '{}',  '{65,66}',    '{}',                  'asigurari',  true,  10),
  ('O78', 'Personal calificat',                  'Skilled staff',                      '{}',  '{78}',       '{}',                  'personal',   false, 11)
on conflict (cod) do nothing;
-- O77 = diviziunea 77 fără 77.31: clasa 77.31 e explicit în AGR, iar clasele
-- explicite au prioritate față de diviziuni (lib/ruta-incadrare.js).

-- ── 2. Nodul de meniu: categorii ─────────────────────────────────
alter table public.categorii add column if not exists capitol_cod text references public.meniu_capitole(cod);
alter table public.categorii add column if not exists nace_clasa text;
alter table public.categorii add column if not exists title_en text;
alter table public.categorii add column if not exists autorizare_necesara text;
alter table public.categorii add column if not exists activ boolean not null default true;

alter table public.categorii drop constraint if exists categorii_nace_clasa_format;
alter table public.categorii add constraint categorii_nace_clasa_format
  check (nace_clasa is null or nace_clasa ~ '^\d{2}\.\d{2}$');
comment on column public.categorii.nace_clasa is
  'Clasa NACE Rev. 2.1 a nodului (4 cifre, NN.NN = cod CAEN Rev. 3). Cheie logică spre nace_reference.cod; codul nu se afișează public.';
comment on column public.categorii.autorizare_necesara is
  'Autorizarea cerută lucrărilor din nod (ex. ANRE, autorizație de mediu). Avertisment A3 la publicare.';
create index if not exists categorii_capitol_cod on public.categorii (capitol_cod);
create index if not exists categorii_nace_clasa on public.categorii (nace_clasa);

-- ── 3. catalog_servicii: nodul, starea și ruta validată ─────────
alter table public.catalog_servicii add column if not exists nod_id uuid references public.categorii(id);
alter table public.catalog_servicii add column if not exists stare text not null default 'ciorna';
alter table public.catalog_servicii add column if not exists creat_din_serviciu_id uuid references public.catalog_servicii(id) on delete set null;
alter table public.catalog_servicii add column if not exists ruta_validata_la timestamptz;
alter table public.catalog_servicii add column if not exists ruta_rezultat jsonb;

alter table public.catalog_servicii drop constraint if exists catalog_servicii_stare_check;
alter table public.catalog_servicii add constraint catalog_servicii_stare_check
  check (stare in ('ciorna', 'in_verificare', 'publicat', 'retras'));

-- Serviciile publice de azi rămân publice: primesc stare 'publicat'.
update public.catalog_servicii set stare = 'publicat' where status_public and stare <> 'publicat';

-- De acum: public doar ce e publicat (publicarea trece prin ruta de încadrare).
alter table public.catalog_servicii drop constraint if exists catalog_servicii_public_doar_publicat;
alter table public.catalog_servicii add constraint catalog_servicii_public_doar_publicat
  check (not status_public or stare = 'publicat');
create index if not exists catalog_servicii_nod_id on public.catalog_servicii (nod_id);
create index if not exists catalog_servicii_stare on public.catalog_servicii (stare);

-- ── 4. competente_esco.tip_cod ───────────────────────────────────
alter table public.competente_esco add column if not exists tip_cod text generated always as (
  case
    when cod_esco ~ '^\d{4}(\.\d+)+$' then 'esco'
    when cod_esco ~ '^\d{4}$' then 'isco'
    when cod_esco ~ '^\d{6}$' or cod_esco like 'COR-%' then 'cor'
  end
) stored;
create index if not exists competente_esco_tip_cod on public.competente_esco (tip_cod);

-- ── 5. admin_permissions: capitolul adminului de catalog ─────────
alter table public.admin_permissions drop constraint if exists admin_permissions_sectiune_specializata_check;
alter table public.admin_permissions add constraint admin_permissions_sectiune_specializata_check
  check (
    sectiune_specializata is null
    or sectiune_specializata in ('financiar', 'fiscal', 'catalog', 'deviz')
    or sectiune_specializata ~ '^(\*|[A-Z][A-Z0-9]{0,3}(,[A-Z][A-Z0-9]{0,3})*)$'
  );
comment on column public.admin_permissions.sectiune_specializata is
  'Pentru sectiune = catalog_servicii: codul capitolului (F, N, O81...), o listă „F,N” sau * pentru toate. Altfel: financiar / fiscal / catalog / deviz.';

-- ── 6. Rețete propuse ────────────────────────────────────────────
create table if not exists public.retete_propuse (
  id                  uuid primary key default gen_random_uuid(),
  catalog_serviciu_id uuid not null references public.catalog_servicii(id) on delete cascade,
  catalog_nivel_id    uuid references public.catalog_niveluri(id) on delete set null,
  stare               text not null default 'propusa' check (stare in ('propusa', 'aprobata', 'respinsa')),
  sursa               text not null default 'automat' check (sursa in ('automat', 'copiata', 'manual')),
  propusa_de          uuid references public.profiles(id),
  aprobata_de         uuid references public.profiles(id),
  aprobata_la         timestamptz,
  motiv_respingere    text,
  articol_creat_id    integer references public.devize_articole(articol_id) on delete set null,  -- articolul creat la aprobare
  creat_la            timestamptz not null default now(),
  constraint retete_propuse_respingere_cu_motiv check (stare <> 'respinsa' or nullif(trim(motiv_respingere), '') is not null)
);
alter table public.retete_propuse enable row level security;
create index if not exists retete_propuse_serviciu on public.retete_propuse (catalog_serviciu_id);
-- O singură rețetă propusă deschisă pe serviciu și nivel.
create unique index if not exists retete_propuse_una_deschisa
  on public.retete_propuse (catalog_serviciu_id, coalesce(catalog_nivel_id::text, '')) where stare = 'propusa';

create table if not exists public.retete_propuse_linii (
  id                uuid primary key default gen_random_uuid(),
  reteta_id         uuid not null references public.retete_propuse(id) on delete cascade,
  tip               text not null check (tip in ('articol_existent', 'resursa_existenta', 'resursa_noua')),
  articol_id        integer references public.devize_articole(articol_id),
  resursa_id        integer references public.devize_resurse(resursa_id),
  denumire_propusa  text,
  tip_resursa       text check (tip_resursa is null or tip_resursa in ('F', 'M', 'U')),
  unitate_masura    text,
  consum_propus     numeric check (consum_propus is null or consum_propus > 0),  -- gol = necunoscut; fără cantități inventate
  cod_uniclass      text,   -- fără cheie externă: codurile propuse pot lipsi încă din uniclass_codes
  cod_esco          text,
  motiv             text,
  decizie           text not null default 'in_asteptare' check (decizie in ('in_asteptare', 'acceptata', 'modificata', 'respinsa')),
  creat_la          timestamptz not null default now(),
  constraint retete_propuse_linii_tip_complet check (
    (tip = 'articol_existent' and articol_id is not null)
    or (tip = 'resursa_existenta' and resursa_id is not null)
    or (tip = 'resursa_noua' and nullif(trim(denumire_propusa), '') is not null and tip_resursa is not null)
  )
);
alter table public.retete_propuse_linii enable row level security;
create index if not exists retete_propuse_linii_reteta on public.retete_propuse_linii (reteta_id);

-- ── 7. Indicatorul rețetelor aprobate ────────────────────────────
insert into public.devize_indicatoare (indicator_id, denumire_indicator, tip_lucrari)
values ('MDR', 'My Darrin — rețete aprobate în back-office', 'Rețete aprobate')
on conflict (indicator_id) do nothing;

-- ── 8. RLS: ciornele nu sunt publice ─────────────────────────────
-- catalog_servicii: rămâne „catalog vizibil public” (status_public = true).
drop policy if exists "catalog citit public" on public.catalog_servicii;
-- Scrierea directă din client, pe coloana veche profiles.role, ocolea ruta.
drop policy if exists "admin gestioneaza catalog servicii" on public.catalog_servicii;
drop policy if exists "catalog scris de admini" on public.catalog_servicii;
drop policy if exists "catalog update de admini" on public.catalog_servicii;

-- catalog_niveluri: citire doar pentru nivelurile unui serviciu public.
drop policy if exists "niveluri citite public" on public.catalog_niveluri;
drop policy if exists "niveluri vizibile public" on public.catalog_niveluri;
drop policy if exists "admin gestioneaza catalog niveluri" on public.catalog_niveluri;
drop policy if exists "niveluri citite pentru servicii publice" on public.catalog_niveluri;
create policy "niveluri citite pentru servicii publice" on public.catalog_niveluri
  for select using (
    exists (select 1 from public.catalog_servicii s where s.id = catalog_niveluri.serviciu_id and s.status_public)
  );

-- catalog_preturi: citire doar pentru prețurile unui nivel de serviciu public.
drop policy if exists "preturi citite public" on public.catalog_preturi;
drop policy if exists "admin scrie preturi" on public.catalog_preturi;
drop policy if exists "preturi citite pentru servicii publice" on public.catalog_preturi;
create policy "preturi citite pentru servicii publice" on public.catalog_preturi
  for select using (
    exists (
      select 1 from public.catalog_niveluri n
      join public.catalog_servicii s on s.id = n.serviciu_id
      where n.id = catalog_preturi.nivel_id and s.status_public
    )
  );

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
declare
  v_n integer;
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'catalog_servicii' and column_name = 'traduceri') then
    raise exception 'Aplică întâi 2026-10-10_traduceri_catalog.sql';
  end if;
  -- Nicio citire liberă (using true) pe catalog: ciornele rămân private.
  if exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
             join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname in ('catalog_servicii', 'catalog_niveluri', 'catalog_preturi')
               and p.polcmd in ('r', '*') and pg_get_expr(p.polqual, p.polrelid) = 'true') then
    raise exception 'Există încă o politică de citire using (true) pe catalog_servicii / catalog_niveluri / catalog_preturi';
  end if;
  -- Nicio scriere directă din client pe catalog.
  if exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
             join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname in ('catalog_servicii', 'catalog_niveluri', 'catalog_preturi')
               and p.polcmd in ('a', 'w', 'd', '*')) then
    raise exception 'Există încă o politică de scriere din client pe catalog_servicii / catalog_niveluri / catalog_preturi';
  end if;
  select count(*) into v_n from public.meniu_capitole
  where cod in ('F', 'N', 'O81', 'T', 'AGR', 'H', 'E', 'O77', 'G', 'L', 'O78');
  if v_n <> 11 then
    raise exception 'meniu_capitole: % din 11 capitole', v_n;
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'categorii'
      and column_name in ('capitol_cod', 'nace_clasa', 'title_en', 'autorizare_necesara', 'activ')) <> 5 then
    raise exception 'Lipsesc coloane noi din categorii';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'catalog_servicii'
      and column_name in ('nod_id', 'stare', 'creat_din_serviciu_id', 'ruta_validata_la', 'ruta_rezultat')) <> 5 then
    raise exception 'Lipsesc coloane noi din catalog_servicii';
  end if;
  if exists (select 1 from public.catalog_servicii where status_public and stare <> 'publicat') then
    raise exception 'Există servicii publice care nu sunt în starea publicat';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'competente_esco' and column_name = 'tip_cod') then
    raise exception 'Lipsește competente_esco.tip_cod';
  end if;
  if to_regclass('public.retete_propuse') is null or to_regclass('public.retete_propuse_linii') is null then
    raise exception 'Lipsesc tabelele retete_propuse / retete_propuse_linii';
  end if;
  if not exists (select 1 from public.devize_indicatoare where indicator_id = 'MDR') then
    raise exception 'Lipsește indicatorul MDR';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname in ('meniu_capitole', 'retete_propuse', 'retete_propuse_linii')
               and not c.relrowsecurity) then
    raise exception 'RLS nu e activ pe un tabel nou';
  end if;
  if exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
             where c.relname in ('meniu_capitole', 'retete_propuse', 'retete_propuse_linii')) then
    raise exception 'Un tabel nou are politici RLS: trebuie să scrie doar service_role';
  end if;
end;
$$;

commit;

-- Control (după commit): tipurile de cod ESCO și stările serviciilor.
select tip_cod, count(*) from public.competente_esco group by 1 order by 1;
select stare, status_public, count(*) from public.catalog_servicii group by 1, 2 order by 1, 2;
