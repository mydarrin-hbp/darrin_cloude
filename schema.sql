-- ════════════════════════════════════════════════════════════════
-- MY DARRIN — Schema Supabase (Postgres)
-- Rulează acest fișier o singură dată în SQL Editor din Supabase,
-- pe un proiect nou, ÎNAINTE de a conecta orice endpoint API.
-- ════════════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";

-- ── 1. PROFILE (extensie a auth.users) ──────────────────────────
-- Rolurile principale (client / partener_* / investor / superadmin / admin)
-- se salvează în auth.users.raw_user_meta_data.role conform cerinței,
-- dar ținem și o copie normalizată aici pentru query-uri rapide + RLS.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nume text,
  telefon text,
  telefon_verificat boolean default false,
  roles text[] default '{}',           -- ex: {client, partener_curier, investor}
  cnp_hash text,                       -- NICIODATĂ CNP în clar — doar hash (vezi lib/crypto.js)
  gdpr_consimtamant_at timestamptz,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;
create policy "user citeste propriul profil" on public.profiles
  for select using (auth.uid() = id);
create policy "user actualizeaza propriul profil" on public.profiles
  for update using (auth.uid() = id);

-- ── 2. PERMISIUNI GRANULARE ADMIN (Etapa 2) ─────────────────────
create table if not exists public.admin_permissions (
  id uuid primary key default uuid_generate_v4(),
  admin_id uuid references auth.users(id) on delete cascade,
  sectiune text not null,   -- ex: 'aprobare_pfa_cui' | 'comisioane' | 'curieri' | 'asigurari_escrow' | 'accountancy'
  tara_cod text,            -- restrânge permisiunea la o singură țară (null = toate); folosit de api/accountancy.js
  poate_scrie boolean default false,
  acordat_de uuid references auth.users(id),
  created_at timestamptz default now()
);
alter table public.admin_permissions enable row level security;
create policy "doar superadmin gestioneaza permisiuni" on public.admin_permissions
  for all using (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'superadmin'
  );

-- ── 3. DEVIZE (Motor Deviz AI — Etapa 3.1) ──────────────────────
create table if not exists public.devize (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references auth.users(id),
  serviciu_id text not null,
  input_json jsonb not null,          -- datele brute introduse de client
  cost_brut numeric,
  cost_baza numeric,
  pret_final numeric,
  zona text,
  urgent boolean default false,
  created_at timestamptz default now()
);
alter table public.devize enable row level security;
create policy "client vede propriile devize" on public.devize
  for select using (auth.uid() = client_id);

-- ── 4. COMENZI ───────────────────────────────────────────────────
create table if not exists public.comenzi (
  id uuid primary key default uuid_generate_v4(),
  numar_comanda text unique not null,  -- format Darrin AI: DA-2026-XXXXX
  client_id uuid references auth.users(id),
  deviz_id uuid references public.devize(id),
  tip_serviciu text not null,
  status text not null default 'creata', -- creata|in_cautare_partener|acceptata|in_desfasurare|finalizata|anulata
  partener_id uuid references auth.users(id),
  valoare_totala numeric,
  escrow_status text default 'neinitiat', -- neinitiat|blocat|eliberat_partial|eliberat|litigiu
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.comenzi enable row level security;
create policy "client vede propriile comenzi" on public.comenzi
  for select using (auth.uid() = client_id or auth.uid() = partener_id);

-- ── 5. COADĂ FIFO ALOCARE PARTENERI (Etapa 4.2) ─────────────────
create table if not exists public.alocari_fifo (
  id uuid primary key default uuid_generate_v4(),
  comanda_id uuid references public.comenzi(id) on delete cascade,
  partener_id uuid references auth.users(id),
  distanta_km numeric,
  notificat_at timestamptz default now(),
  raspuns text default 'in_asteptare', -- in_asteptare|acceptat|refuzat|expirat
  raspuns_at timestamptz
);
alter table public.alocari_fifo enable row level security;
create policy "partener vede propriile alocari" on public.alocari_fifo
  for select using (auth.uid() = partener_id);

-- ── 6. GEOLOCAȚIE LIVE (Etapa 4.3) ──────────────────────────────
create table if not exists public.gps_tracking (
  partener_id uuid primary key references auth.users(id) on delete cascade,
  comanda_id uuid references public.comenzi(id),
  lat double precision not null,
  lng double precision not null,
  eta_minute integer,
  updated_at timestamptz default now()
);
alter table public.gps_tracking enable row level security;
create policy "partenerul isi actualizeaza propria pozitie" on public.gps_tracking
  for all using (auth.uid() = partener_id);
-- Notă: clienții citesc poziția prin endpoint-ul API (service role),
-- nu direct din tabel, ca să nu expunem GPS-ul tuturor curierilor public.

-- ── 7. DOCUMENTE PARTENERI + CMR DIGITAL (Etapa 4.4) ────────────
create table if not exists public.documente_partener (
  id uuid primary key default uuid_generate_v4(),
  partener_id uuid references auth.users(id) on delete cascade,
  tip_document text not null, -- cui | licenta_arr | cazier_judiciar
  url_fisier text not null,
  status text default 'in_verificare', -- in_verificare|aprobat|respins
  verificat_de uuid references auth.users(id),
  created_at timestamptz default now()
);
alter table public.documente_partener enable row level security;
create policy "partenerul vede propriile documente" on public.documente_partener
  for select using (auth.uid() = partener_id);

create table if not exists public.cmr_digital (
  id uuid primary key default uuid_generate_v4(),
  comanda_id uuid references public.comenzi(id),
  curier_id uuid references auth.users(id),
  furnizor_id uuid references auth.users(id),
  hash_document text not null,   -- SHA-256, echivalent semnătură eIDAS simplificată
  generat_at timestamptz default now()
);
alter table public.cmr_digital enable row level security;

-- ── 8. FINANCIAR: COMISIOANE + ESCROW (Etapa 4.5) ───────────────
create table if not exists public.comisioane (
  id uuid primary key default uuid_generate_v4(),
  comanda_id uuid references public.comenzi(id),
  partener_id uuid references auth.users(id),
  valoare_comanda numeric not null,
  procent_comision numeric not null default 12.0,
  valoare_comision numeric generated always as (valoare_comanda * procent_comision / 100) stored,
  status_plata text default 'in_asteptare', -- in_asteptare|platit
  created_at timestamptz default now()
);
alter table public.comisioane enable row level security;
create policy "partener vede propriile comisioane" on public.comisioane
  for select using (auth.uid() = partener_id);

-- ── 9. KYC INVESTITORI (Etapa 3.3) ──────────────────────────────
create table if not exists public.investitori_kyc (
  id uuid primary key default uuid_generate_v4(),
  investitor_id uuid references auth.users(id) unique,
  profil_risc jsonb,               -- răspunsuri chestionar
  document_identitate_url text,
  pep boolean default false,       -- Persoană Expusă Politic
  status text default 'in_verificare', -- in_verificare|aprobat|respins
  verificat_de uuid references auth.users(id),
  created_at timestamptz default now()
);
alter table public.investitori_kyc enable row level security;
create policy "investitorul vede propriul KYC" on public.investitori_kyc
  for select using (auth.uid() = investitor_id);

create table if not exists public.investitori_portofoliu (
  id uuid primary key default uuid_generate_v4(),
  investitor_id uuid references auth.users(id),
  actiuni numeric not null,
  suma_investita numeric not null,
  roi_curent numeric default 0,
  dividende_incasate numeric default 0,
  created_at timestamptz default now()
);
alter table public.investitori_portofoliu enable row level security;
create policy "investitorul vede propriul portofoliu" on public.investitori_portofoliu
  for select using (auth.uid() = investitor_id);

create table if not exists public.investitori_exit (
  id uuid primary key default uuid_generate_v4(),
  investitor_id uuid references auth.users(id),
  tip text not null,               -- 'buyback' | 'piata_secundara'
  numar_actiuni numeric not null,
  status text default 'in_procesare', -- in_procesare|aprobat|respins|finalizat
  created_at timestamptz default now()
);
alter table public.investitori_exit enable row level security;
create policy "investitorul vede propriile cereri exit" on public.investitori_exit
  for select using (auth.uid() = investitor_id);

-- ── 10. Trigger: sincronizează profiles la fiecare user nou ─────
-- FIX (audit 2026-07-11): varianta veche nu copia `roles` din
-- raw_user_meta_data — orice user nou (inclusiv superadminul creat manual
-- din Pasul 2 al IMPLEMENTATION-PLAN.md) rămânea cu profiles.roles = '{}',
-- deși verificarea de rol citește ACUM profiles.roles ca sursă principală.
-- Copiem și gdpr_consimtamant_at, setat de account-system.js la signup.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, nume, roles, gdpr_consimtamant_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nume', ''),
    case
      when new.raw_user_meta_data ? 'roles' then
        array(select jsonb_array_elements_text(new.raw_user_meta_data->'roles'))
      when new.raw_user_meta_data ? 'role' then
        array[new.raw_user_meta_data->>'role']
      else '{}'
    end,
    case when (new.raw_user_meta_data->>'gdpr_acceptat')::boolean is true then now() else null end
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Pentru useri deja existenți creați cu varianta veche a trigger-ului
-- (profiles.roles = '{}' deși au un rol în user_metadata), rulează o
-- singură dată, manual, după deploy:
--   update public.profiles p set roles = array[u.raw_user_meta_data->>'role']
--   from auth.users u where u.id = p.id and p.roles = '{}' and u.raw_user_meta_data ? 'role';

-- ── 11. AUDIT LOG IMUABIL (adăugat în audit 2026-07-11) ─────────
-- Jurnal insert-only pentru tranzacții financiare, prețuri și alocări —
-- necesar pentru modelul de răspundere legală de Antreprenor General.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  tabel text not null,
  rand_id uuid not null,
  operatie text not null,               -- INSERT | UPDATE | DELETE
  actor_id uuid references auth.users(id),
  date_vechi jsonb,
  date_noi jsonb,
  creat_at timestamptz not null default now()
);
-- Imuabil: nimeni (nici service_role) nu poate modifica/șterge un rând deja scris.
revoke update, delete on public.audit_log from anon, authenticated, service_role;

create or replace function public.fn_audit_trail()
returns trigger as $$
begin
  insert into public.audit_log(tabel, rand_id, operatie, actor_id, date_vechi, date_noi)
  values (
    TG_TABLE_NAME,
    coalesce(new.id, old.id),
    TG_OP,
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when TG_OP in ('UPDATE','INSERT') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$ language plpgsql security definer;
-- Notă: current_setting('request.jwt.claim.sub') e populat doar pentru scrieri
-- prin PostgREST (client anon/authenticated). Scrierile din lib/supabaseAdmin.js
-- (service_role, direct prin driver Postgres) NU trec prin PostgREST — pentru
-- acelea, actor_id va rămâne null în acest trigger; dacă ai nevoie de actor_id
-- corect și pe calea service_role, loghează explicit din API (vezi handlerele
-- din /api care au deja `user` disponibil din requireAuth).

create trigger trg_audit_comenzi
  after insert or update or delete on public.comenzi
  for each row execute procedure public.fn_audit_trail();

create trigger trg_audit_comisioane
  after insert or update or delete on public.comisioane
  for each row execute procedure public.fn_audit_trail();

create trigger trg_audit_devize
  after update of pret_final on public.devize
  for each row execute procedure public.fn_audit_trail();

create trigger trg_audit_alocari
  after insert or update on public.alocari_fifo
  for each row execute procedure public.fn_audit_trail();

-- ── 12. MATCHING: PostGIS + taxonomii + heartbeat ────────────────
-- Bază pentru motorul de matching cerut (competențe NACE/ESCO/Uniclass +
-- rază geografică + status live) — schema + funcție de căutare; orchestrarea
-- efectivă (populare alocari_fifo la o comandă nouă) rămâne de construit
-- ca endpoint separat, pe măsură ce fluxul de creare comandă e implementat.
create extension if not exists postgis;

alter table public.profiles
  add column if not exists locatie geography(point, 4326),
  add column if not exists last_seen_at timestamptz;

create table if not exists public.partener_competente (
  partener_id uuid references auth.users(id) on delete cascade,
  standard text not null,        -- 'nace' | 'esco' | 'uniclass'
  cod text not null,
  primary key (partener_id, standard, cod)
);
alter table public.partener_competente enable row level security;
create policy "partenerul vede propriile competente" on public.partener_competente
  for select using (auth.uid() = partener_id);

create or replace function public.gaseste_parteneri_eligibili(
  p_lat double precision, p_lng double precision,
  p_raza_km numeric, p_cod_competenta text
) returns setof uuid as $$
  select pr.id
  from public.profiles pr
  join public.partener_competente pc on pc.partener_id = pr.id
  where pc.cod = p_cod_competenta
    and pr.last_seen_at > now() - interval '5 minutes'   -- "heartbeat"
    and ST_DWithin(
          pr.locatie,
          ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
          p_raza_km * 1000
        )
  order by ST_Distance(pr.locatie, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography);
$$ language sql stable;

-- ── 13. GARANȚII DIGITALE + TRASABILITATE DAUNE ──────────────────
create table if not exists public.garantii (
  id uuid primary key default uuid_generate_v4(),
  comanda_id uuid references public.comenzi(id) not null,
  furnizor_id uuid references auth.users(id) not null,
  durata_luni integer not null default 12,
  inceput_at timestamptz not null default now(),
  expira_at timestamptz generated always as (inceput_at + (durata_luni || ' months')::interval) stored,
  status text not null default 'activa', -- activa|reclamatie_deschisa|remediere_in_curs|inchisa|expirata
  created_at timestamptz default now()
);
alter table public.garantii enable row level security;
create policy "clientul vede garantia comenzii sale" on public.garantii
  for select using (
    auth.uid() in (select client_id from public.comenzi where id = comanda_id)
  );

create table if not exists public.garantii_evenimente (
  id uuid primary key default uuid_generate_v4(),
  garantie_id uuid references public.garantii(id) on delete cascade,
  tip text not null,          -- inspectie_initiala | reclamatie | remediere | inchidere
  descriere text,
  raportat_de uuid references auth.users(id),
  document_url text,          -- poze/video ale defectului, stocate în bucket privat
  created_at timestamptz default now()
);
alter table public.garantii_evenimente enable row level security;
create policy "clientul vede evenimentele garantiei sale" on public.garantii_evenimente
  for select using (
    garantie_id in (
      select g.id from public.garantii g
      join public.comenzi c on c.id = g.comanda_id
      where c.client_id = auth.uid()
    )
  );
