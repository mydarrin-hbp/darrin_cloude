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
  sectiune text not null,   -- ex: 'aprobare_pfa_cui' | 'comisioane' | 'curieri' | 'asigurari_escrow'
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
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, nume)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nume', ''));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
