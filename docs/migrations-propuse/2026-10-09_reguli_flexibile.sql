-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (9 octombrie 2026)
-- Reguli flexibile — Etapa 1: schemă pentru motorul de preț
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce adaugă
--   1. reguli_costuri_fixe: coeficienți pe costurile fixe ale meseriei
--      (deplasare / uzură scule / consumabile mici / echipament testare),
--      prag de durată și plafon, pe domenii: serviciu > cod ESCO >
--      categorie > țară > ALL. Regula implicită ALL are toți coeficienții 1
--      și niciun plafon: prețurile rămân identice la ban.
--   2. reguli_niveluri: ce include fiecare nivel (Bronze/Silver/Gold/
--      Platinum) — materiale (nu / consumabile / complet), curățenie,
--      testare, raport digital (cu articol de deviz opțional), coeficient
--      de manoperă, timp de răspuns. Pe serviciu > categorie > global.
--      Regulile implicite globale se creează INACTIVE (activ = false):
--      nu schimbă niciun preț până nu le activează LM.
--      devize_resurse.este_consumabil (implicit false).
--   3. catalog_servicii: unelte_necesare, fise_tehnice ([{titlu, url,
--      sursa}]), caracteristici_tehnice — toate jsonb, opționale.
--
-- Cum se aplică
--   O singură tranzacție, poate fi rulată de mai multe ori (if not exists /
--   drop ... if exists / on conflict). Verificarea de la final oprește
--   tranzacția dacă ceva lipsește. Se aplică ÎNAINTE de publicarea codului
--   (codul funcționează și fără ea: regulile lipsă = regula implicită).
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 0. Admin/superadmin după profiles.roles (identic cu 2026-10-06) ──
create or replace function public.este_admin_platforma()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.roles && array['admin', 'superadmin']
  );
$$;
revoke execute on function public.este_admin_platforma() from anon;

create or replace function public.fn_seteaza_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── 1. Reguli pentru costurile fixe ──────────────────────────────
create table if not exists public.reguli_costuri_fixe (
  id                       uuid primary key default gen_random_uuid(),
  -- domeniu de aplicare (cea mai specifică regulă câștigă)
  tara_cod                 text not null default 'ALL',
  regiune                  text,                 -- opțional, aceleași valori ca comenzi.regiune
  categorie_id             uuid references public.categorii(id) on delete cascade,
  cod_esco                 text,
  serviciu_id              uuid references public.catalog_servicii(id) on delete cascade,
  -- coeficienți pe componente (1 = tariful din manopera_costuri, neschimbat)
  coef_deplasare           numeric(6,3) not null default 1 check (coef_deplasare >= 0),
  coef_uzura               numeric(6,3) not null default 1 check (coef_uzura >= 0),
  coef_consumabile         numeric(6,3) not null default 1 check (coef_consumabile >= 0),
  coef_testare             numeric(6,3) not null default 1 check (coef_testare >= 0),
  -- intervenție scurtă: sub prag (ore de manoperă), uzura × coef_sub_prag
  prag_durata_ore          numeric(6,2) check (prag_durata_ore is null or prag_durata_ore > 0),
  coef_sub_prag            numeric(6,3) check (coef_sub_prag is null or coef_sub_prag >= 0),
  -- costurile fixe nu depășesc X% din manopera meseriei
  plafon_pct_din_manopera  numeric(6,2) check (plafon_pct_din_manopera is null or plafon_pct_din_manopera >= 0),
  activ                    boolean not null default true,
  valabil_de               date not null default current_date,
  valabil_pana             date,
  creat_de                 uuid references auth.users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint reguli_costuri_fixe_interval check (valabil_pana is null or valabil_pana >= valabil_de),
  constraint reguli_costuri_fixe_prag_complet check ((prag_durata_ore is null) = (coef_sub_prag is null))
);

-- O singură regulă activă pe același domeniu.
create unique index if not exists reguli_costuri_fixe_domeniu_activ
  on public.reguli_costuri_fixe (
    tara_cod, coalesce(regiune, ''), coalesce(categorie_id::text, ''),
    coalesce(cod_esco, ''), coalesce(serviciu_id::text, '')
  ) where activ;
create index if not exists reguli_costuri_fixe_tara on public.reguli_costuri_fixe (tara_cod) where activ;

drop trigger if exists trg_reguli_costuri_fixe_updated_at on public.reguli_costuri_fixe;
create trigger trg_reguli_costuri_fixe_updated_at
  before update on public.reguli_costuri_fixe
  for each row execute function public.fn_seteaza_updated_at();

-- RLS: doar admin citește și scrie direct; motorul citește prin service_role.
alter table public.reguli_costuri_fixe enable row level security;
drop policy if exists "admin gestioneaza reguli costuri fixe" on public.reguli_costuri_fixe;
create policy "admin gestioneaza reguli costuri fixe" on public.reguli_costuri_fixe
  for all using (public.este_admin_platforma()) with check (public.este_admin_platforma());

-- Regula implicită: ALL, toți coeficienții 1, fără prag și fără plafon.
insert into public.reguli_costuri_fixe (tara_cod, valabil_de)
select 'ALL', date '2026-01-01'
where not exists (
  select 1 from public.reguli_costuri_fixe
  where tara_cod = 'ALL' and regiune is null and categorie_id is null
    and cod_esco is null and serviciu_id is null and activ
);

-- ── 2. Reguli pe niveluri ────────────────────────────────────────
alter table public.devize_resurse
  add column if not exists este_consumabil boolean not null default false;

create table if not exists public.reguli_niveluri (
  id                      uuid primary key default gen_random_uuid(),
  -- domeniu: serviciu > categorie > global (ambele null)
  serviciu_id             uuid references public.catalog_servicii(id) on delete cascade,
  categorie_id            uuid references public.categorii(id) on delete cascade,
  nivel                   text not null check (nivel in ('Bronze', 'Silver', 'Gold', 'Platinum')),
  -- false = nivelul nu apare pe pagina de produs
  nivel_activ             boolean not null default true,
  materiale               text not null default 'complet' check (materiale in ('nu', 'consumabile', 'complet')),
  include_curatenie       boolean not null default false,
  include_testare         boolean not null default false,
  include_raport_digital  boolean not null default false,
  -- articol de deviz adăugat de opțiune (cost fix per intervenție), opțional
  articol_curatenie_id    bigint references public.devize_articole(articol_id) on delete set null,
  articol_testare_id      bigint references public.devize_articole(articol_id) on delete set null,
  articol_raport_id       bigint references public.devize_articole(articol_id) on delete set null,
  coef_manopera           numeric(6,3) not null default 1 check (coef_manopera > 0),
  timp_raspuns_ore        numeric(6,1) check (timp_raspuns_ore is null or timp_raspuns_ore > 0),
  -- regula se aplică doar când e activă (implicit: NU)
  activ                   boolean not null default false,
  valabil_de              date not null default current_date,
  valabil_pana            date,
  creat_de                uuid references auth.users(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint reguli_niveluri_interval check (valabil_pana is null or valabil_pana >= valabil_de)
);
-- Garanția rămâne în catalog_niveluri.garantie_luni (nu se dublează aici).

create unique index if not exists reguli_niveluri_domeniu
  on public.reguli_niveluri (coalesce(serviciu_id::text, ''), coalesce(categorie_id::text, ''), nivel);

drop trigger if exists trg_reguli_niveluri_updated_at on public.reguli_niveluri;
create trigger trg_reguli_niveluri_updated_at
  before update on public.reguli_niveluri
  for each row execute function public.fn_seteaza_updated_at();

-- RLS: admin citește și scrie; publicul vede doar câmpurile de afișare,
-- prin /api/public/calculeaza-pret-nivel (service_role), nu direct.
alter table public.reguli_niveluri enable row level security;
drop policy if exists "admin gestioneaza reguli niveluri" on public.reguli_niveluri;
create policy "admin gestioneaza reguli niveluri" on public.reguli_niveluri
  for all using (public.este_admin_platforma()) with check (public.este_admin_platforma());

-- Valorile implicite propuse, globale, INACTIVE:
--   Bronze: doar manoperă · Silver: consumabile + curățenie ·
--   Gold: complet + curățenie + testare · Platinum: + raport digital.
insert into public.reguli_niveluri (nivel, materiale, include_curatenie, include_testare, include_raport_digital, activ, valabil_de)
values
  ('Bronze',   'nu',          false, false, false, false, date '2026-01-01'),
  ('Silver',   'consumabile', true,  false, false, false, date '2026-01-01'),
  ('Gold',     'complet',     true,  true,  false, false, date '2026-01-01'),
  ('Platinum', 'complet',     true,  true,  true,  false, date '2026-01-01')
on conflict ((coalesce(serviciu_id::text, '')), (coalesce(categorie_id::text, '')), nivel) do nothing;

-- ── 3. Fișa de serviciu ──────────────────────────────────────────
alter table public.catalog_servicii
  add column if not exists unelte_necesare        jsonb,
  add column if not exists fise_tehnice           jsonb,
  add column if not exists caracteristici_tehnice jsonb;

alter table public.catalog_servicii drop constraint if exists catalog_servicii_unelte_necesare_lista;
alter table public.catalog_servicii add constraint catalog_servicii_unelte_necesare_lista
  check (unelte_necesare is null or jsonb_typeof(unelte_necesare) = 'array');
alter table public.catalog_servicii drop constraint if exists catalog_servicii_fise_tehnice_lista;
alter table public.catalog_servicii add constraint catalog_servicii_fise_tehnice_lista
  check (fise_tehnice is null or jsonb_typeof(fise_tehnice) = 'array');
alter table public.catalog_servicii drop constraint if exists catalog_servicii_caracteristici_obiect;
alter table public.catalog_servicii add constraint catalog_servicii_caracteristici_obiect
  check (caracteristici_tehnice is null or jsonb_typeof(caracteristici_tehnice) in ('object', 'array'));

comment on column public.catalog_servicii.fise_tehnice is
  'Listă [{titlu, url, sursa}]. Completată de admin; propunerile automate (ex. AI) se aprobă înainte de publicare.';

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.reguli_costuri_fixe') is null then
    raise exception 'Lipsește tabelul reguli_costuri_fixe';
  end if;
  if not exists (
    select 1 from public.reguli_costuri_fixe
    where tara_cod = 'ALL' and regiune is null and categorie_id is null and cod_esco is null
      and serviciu_id is null and activ
      and coef_deplasare = 1 and coef_uzura = 1 and coef_consumabile = 1 and coef_testare = 1
      and prag_durata_ore is null and plafon_pct_din_manopera is null
  ) then
    raise exception 'Lipsește regula implicită ALL (coeficienți 1, fără prag, fără plafon)';
  end if;
  if (select count(*) from public.reguli_niveluri where serviciu_id is null and categorie_id is null) < 4 then
    raise exception 'Lipsesc regulile implicite globale pe niveluri';
  end if;
  if exists (select 1 from public.reguli_niveluri where serviciu_id is null and categorie_id is null and activ) then
    raise notice 'Atenție: regulile globale pe niveluri sunt ACTIVE — prețurile Bronze/Silver se schimbă';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'devize_resurse' and column_name = 'este_consumabil') then
    raise exception 'Lipsește devize_resurse.este_consumabil';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'catalog_servicii'
      and column_name in ('unelte_necesare', 'fise_tehnice', 'caracteristici_tehnice')) <> 3 then
    raise exception 'Lipsesc coloanele noi din catalog_servicii';
  end if;
end;
$$;

commit;
