-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (6–7 octombrie 2026)
-- parteneri_discounturi: discounturi negociate cu partenerii furnizori
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce rezolvă
--   Partenerii de materiale, închirieri, asigurări și curierat acordă
--   Home Best Pal (antreprenor general) un discount pe categorie. Discountul
--   se aplică pe facturile emise de partener către Home Best Pal și reduce
--   costul de achiziție al HBP. Prețul public către client NU se schimbă:
--   lib/calculeaza-pret.js și API-urile publice de preț nu citesc tabela.
--
-- Decizii LM (7 octombrie 2026)
--   1. `categorie` vine dintr-o listă controlată (discount_categorii),
--      administrată de admin. FK compus (tip_partener, categorie): o
--      categorie de asigurări nu poate fi folosită pe un discount de
--      materiale.
--   2. Fără suprapuneri: un singur discount activ pe (partener, tip,
--      categorie) într-un interval dat (exclusion constraint).
--   3. Discountul se salvează pe factură la emitere (coloane noi pe
--      facturi_parteneri). Modificările ulterioare ale discountului nu
--      schimbă facturile deja emise; coloanele salvate nu se mai pot edita.
--
-- Reguli de acces (RLS)
--   - Partenerul titular își vede și își editează propriile discounturi.
--   - Admin / superadmin văd și editează tot.
--   - Nicio politică pentru anon: discounturile nu sunt niciodată publice.
--   - Partenerul nu se poate auto-aproba: orice modificare făcută de el
--     golește aprobat_de (trigger). Un discount se aplică pe facturi doar
--     dacă e activ, aprobat și în intervalul de valabilitate
--     (funcția discount_aplicabil).
--
-- Limitele discountului (decizie LM, 7 octombrie 2026)
--   Configurabile în backoffice_config, secțiunea `pricing`:
--   discount_partener_min_pct (5) și discount_partener_max_pct (15).
--   Verificate la salvare de API (lib/discount-partener.js) și de trigger-ul
--   trg_parteneri_discounturi_limite. Nu e un `check` fix în tabel, ca
--   limitele să rămână modificabile din panou.
--
-- Pași ulteriori, separați (după aprobarea schemei)
--   - api/partener/facturi.js: la emitere, apelează discount_aplicabil()
--     și completează coloanele de discount pe factură.
--   - UI: wizard „Devino partener”, dashboard partener, back-office.
--   - Popularea listei discount_categorii (de stabilit cu LM).
-- ═══════════════════════════════════════════════════════════════════

-- Necesară pentru exclusion constraint-ul de nesuprapunere (uuid/text cu `=` în gist).
create extension if not exists btree_gist;

-- ── 0. Limitele discountului, în panoul „Comisioane & Tarifare” ──
insert into public.backoffice_config (cheie, valoare, tip, sectiune, eticheta, descriere, unitate, editabil_de, tara_cod)
values
  ('discount_partener_min_pct', '5', 'number', 'pricing', 'Discount partener — minim (%)',
   'Cel mai mic discount pe care un furnizor (materiale, închirieri, asigurări) îl poate acorda Home Best Pal.', '%', 'superadmin', 'ALL'),
  ('discount_partener_max_pct', '15', 'number', 'pricing', 'Discount partener — maxim (%)',
   'Cel mai mare discount pe care un furnizor (materiale, închirieri, asigurări) îl poate acorda Home Best Pal.', '%', 'superadmin', 'ALL')
on conflict (cheie, tara_cod) do nothing;

-- ── 1. Admin/superadmin după profiles.roles ──────────────────────
-- Aceeași sursă prioritară ca lib/auth-middleware.js.
create or replace function public.este_admin_platforma()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.roles && array['admin', 'superadmin']
  );
$$;

-- ── 2. Lista controlată de categorii ─────────────────────────────
create table if not exists public.discount_categorii (
  tip_partener  text not null check (tip_partener in ('materiale', 'inchirieri', 'asigurari', 'curier')),
  cod           text not null,                       -- ex. 'electrice', 'schele', 'rc-profesionala'
  denumire      text not null,
  activ         boolean not null default true,
  created_at    timestamptz not null default now(),
  primary key (tip_partener, cod)
);

alter table public.discount_categorii enable row level security;
-- Partenerii autentificați văd lista, ca să aleagă categoria; doar adminul o modifică.
create policy "utilizatorii autentificati vad categoriile" on public.discount_categorii
  for select using (auth.role() = 'authenticated');
create policy "admin gestioneaza categoriile" on public.discount_categorii
  for all using (public.este_admin_platforma()) with check (public.este_admin_platforma());

-- ── 3. Discounturile partenerilor ────────────────────────────────
create table if not exists public.parteneri_discounturi (
  id            uuid primary key default uuid_generate_v4(),
  partener_id   uuid not null references auth.users(id) on delete cascade,
  tip_partener  text not null check (tip_partener in ('materiale', 'inchirieri', 'asigurari', 'curier')),
  categorie     text not null,                       -- cod din discount_categorii, pentru același tip_partener
  discount_pct  numeric(5,2) not null check (discount_pct > 0 and discount_pct < 100),
  valabil_de    date not null default current_date,
  valabil_pana  date,                                -- null = fără termen
  activ         boolean not null default true,
  creat_de      uuid references auth.users(id),
  aprobat_de    uuid references auth.users(id),     -- null = în așteptarea aprobării
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (tip_partener, categorie) references public.discount_categorii (tip_partener, cod),
  check (valabil_pana is null or valabil_pana >= valabil_de),
  -- fără suprapuneri: un singur discount activ pe (partener, tip, categorie) într-un interval dat
  exclude using gist (
    partener_id with =, tip_partener with =, categorie with =,
    daterange(valabil_de, coalesce(valabil_pana, 'infinity'::date), '[]') with &&
  ) where (activ)
);

-- updated_at, creat_de, iar partenerul nu se poate auto-aproba
create or replace function public.fn_parteneri_discounturi_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and new.creat_de is null then
    new.creat_de := auth.uid();
  end if;
  -- service_role = API-ul server (lib/supabaseAdmin.js), care verifică rolul în requireAuth
  if coalesce(auth.role(), '') <> 'service_role' and not public.este_admin_platforma() then
    new.aprobat_de := null;
  end if;
  return new;
end;
$$;

create trigger trg_parteneri_discounturi_guard
  before insert or update on public.parteneri_discounturi
  for each row execute function public.fn_parteneri_discounturi_guard();

-- Discountul trebuie să fie între limitele din backoffice_config (rândurile
-- `ALL`). Valorile implicite 5–15 se folosesc doar dacă rândurile lipsesc.
-- Se verifică doar când discount_pct se schimbă, ca un discount vechi să
-- poată fi dezactivat și după ce limitele s-au modificat.
create or replace function public.fn_parteneri_discounturi_limite()
returns trigger language plpgsql stable set search_path = public as $$
declare
  v_min numeric;
  v_max numeric;
begin
  if tg_op = 'UPDATE' and new.discount_pct is not distinct from old.discount_pct then
    return new;
  end if;
  select
    coalesce(max(case when cheie = 'discount_partener_min_pct' then nullif(valoare, '')::numeric end), 5),
    coalesce(max(case when cheie = 'discount_partener_max_pct' then nullif(valoare, '')::numeric end), 15)
  into v_min, v_max
  from public.backoffice_config
  where sectiune = 'pricing'
    and cheie in ('discount_partener_min_pct', 'discount_partener_max_pct')
    and coalesce(tara_cod, 'ALL') = 'ALL';
  if new.discount_pct < v_min or new.discount_pct > v_max then
    raise exception 'Discountul trebuie să fie între % și % (primit %).', v_min, v_max, new.discount_pct
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_parteneri_discounturi_limite
  before insert or update on public.parteneri_discounturi
  for each row execute function public.fn_parteneri_discounturi_limite();

alter table public.parteneri_discounturi enable row level security;

create policy "partenerul vede propriile discounturi" on public.parteneri_discounturi
  for select using (auth.uid() = partener_id);
create policy "partenerul adauga propriile discounturi" on public.parteneri_discounturi
  for insert with check (auth.uid() = partener_id);
create policy "partenerul modifica propriile discounturi" on public.parteneri_discounturi
  for update using (auth.uid() = partener_id) with check (auth.uid() = partener_id);
create policy "admin gestioneaza toate discounturile" on public.parteneri_discounturi
  for all using (public.este_admin_platforma()) with check (public.este_admin_platforma());
-- Fără politică de delete pentru partener: dezactivează (activ = false), istoricul rămâne.
-- Un discount folosit pe o factură nu poate fi șters (FK on delete restrict, secțiunea 4).

-- Audit: fn_audit_trail nu există în producție, deci fără trigger de audit.
-- Setările, aprobările și dezactivările din back-office se înregistrează în
-- audit_log de api/admin/discounturi-parteneri.js (inregistreazaAudit).

-- Discountul aplicabil la o dată: activ, aprobat, în interval. Cel mult
-- un rând, garantat de exclusion constraint. Apelată server-side la
-- emiterea facturii (service_role), nu expusă clienților.
create or replace function public.discount_aplicabil(
  p_partener_id uuid, p_tip_partener text, p_categorie text, p_data date default current_date
)
returns public.parteneri_discounturi language sql stable set search_path = public as $$
  select d.* from public.parteneri_discounturi d
  where d.partener_id = p_partener_id
    and d.tip_partener = p_tip_partener
    and d.categorie = p_categorie
    and d.activ
    and d.aprobat_de is not null
    and p_data >= d.valabil_de
    and (d.valabil_pana is null or p_data <= d.valabil_pana)
  limit 1;
$$;
revoke execute on function public.discount_aplicabil(uuid, text, text, date) from public, anon, authenticated;

-- ── 4. Discountul salvat pe factură ──────────────────────────────
-- `suma` rămâne suma facturată de partener (netă, după discount).
-- suma_bruta / discount_pct / suma_discount păstrează calculul de la emitere.
alter table public.facturi_parteneri
  add column if not exists discount_id    uuid references public.parteneri_discounturi(id) on delete restrict,
  add column if not exists discount_pct   numeric(5,2) not null default 0 check (discount_pct >= 0 and discount_pct < 100),
  add column if not exists suma_bruta     numeric(12,2),
  add column if not exists suma_discount  numeric(12,2) not null default 0 check (suma_discount >= 0);

alter table public.facturi_parteneri
  add constraint facturi_parteneri_discount_consistent
  check (suma_bruta is null or round(suma_bruta - suma_discount, 2) = round(suma, 2));

-- Odată emisă, factura nu-și mai schimbă discountul.
create or replace function public.fn_facturi_parteneri_discount_inghetat()
returns trigger language plpgsql as $$
begin
  if (new.discount_id, new.discount_pct, new.suma_bruta, new.suma_discount)
     is distinct from (old.discount_id, old.discount_pct, old.suma_bruta, old.suma_discount) then
    raise exception 'Discountul unei facturi emise nu se mai poate modifica (factura %).', old.id;
  end if;
  return new;
end;
$$;

create trigger trg_facturi_parteneri_discount_inghetat
  before update on public.facturi_parteneri
  for each row execute function public.fn_facturi_parteneri_discount_inghetat();
