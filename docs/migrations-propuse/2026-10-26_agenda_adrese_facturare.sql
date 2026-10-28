-- My Darrin — pasul 11-P3a / step 11-P3a
-- Agenda contului: adresele (de prestare / livrare și de facturare) și profilurile de facturare,
-- gestionate din dashboard-ul fiecărui cont și folosite la checkout și în coș.
-- Account book: addresses (service / delivery and billing) and billing profiles,
-- managed from each account's dashboard and used at checkout and in the cart.
-- Rulează în Supabase SQL Editor ÎNAINTE de merge. / Run in the SQL Editor BEFORE merge.

begin;

-- 1. Adresele contului.
create table if not exists public.adrese_cont (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  eticheta             text,                                   -- ex. „Acasă”, „Birou”
  folosire             text not null default 'ambele'
                         check (folosire in ('prestare', 'facturare', 'ambele')),
  strada               text not null check (length(trim(strada)) >= 3),
  localitate           text not null check (length(trim(localitate)) >= 2),
  judet                text,
  cod_postal           text,
  tara                 text not null check (tara ~ '^[A-Z]{2}$'),
  instructiuni_acces   text,                                   -- interfon, cod poartă (doar prestare)
  implicita_prestare   boolean not null default false,
  implicita_facturare  boolean not null default false,
  creat_la             timestamptz not null default now(),
  actualizat_la        timestamptz not null default now(),
  constraint adrese_cont_judet_ro check (tara <> 'RO' or nullif(trim(judet), '') is not null)
);
create index if not exists adrese_cont_user on public.adrese_cont (user_id);
create unique index if not exists adrese_cont_o_implicita_prestare
  on public.adrese_cont (user_id) where implicita_prestare;
create unique index if not exists adrese_cont_o_implicita_facturare
  on public.adrese_cont (user_id) where implicita_facturare;

-- 2. Profilurile de facturare (persoană fizică sau firmă).
create table if not exists public.profiluri_facturare (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  eticheta              text,
  tip                   text not null check (tip in ('pf', 'pj')),
  prenume               text,
  nume                  text,
  cnp_criptat           text,                                  -- opțional, rpc cripteaza_camp
  cnp_ultimele3         text,
  denumire              text,
  cui                   text,
  nr_reg_com            text,
  tva_activ             boolean,
  sursa                 text check (sursa is null or sursa in ('anaf', 'manual')),
  adresa_facturare_id   uuid references public.adrese_cont(id) on delete set null,
  implicit              boolean not null default false,
  creat_la              timestamptz not null default now(),
  actualizat_la         timestamptz not null default now(),
  constraint profiluri_facturare_pf check (tip <> 'pf' or (nullif(trim(prenume), '') is not null and nullif(trim(nume), '') is not null)),
  constraint profiluri_facturare_pj check (tip <> 'pj' or (nullif(trim(denumire), '') is not null and nullif(trim(cui), '') is not null))
);
create index if not exists profiluri_facturare_user on public.profiluri_facturare (user_id);
create unique index if not exists profiluri_facturare_un_implicit
  on public.profiluri_facturare (user_id) where implicit;

-- 3. Acces doar prin API (service role); fără politici publice.
alter table public.adrese_cont enable row level security;
alter table public.profiluri_facturare enable row level security;

commit;

-- Verificare / Check:
-- select table_name from information_schema.tables where table_schema = 'public' and table_name in ('adrese_cont','profiluri_facturare');
-- select indexname from pg_indexes where tablename in ('adrese_cont','profiluri_facturare') order by 1;
-- select relname, relrowsecurity from pg_class where relname in ('adrese_cont','profiluri_facturare');
