-- My Darrin — pasul 11-P2a / step 11-P2a
-- Investitori persoane fizice: datele de identificare în dosarul KYC.
-- Private-individual investors: identification data in the KYC file.
-- Rulează în Supabase SQL Editor ÎNAINTE de merge. / Run in the SQL Editor BEFORE merge.
-- Verificat read-only pe 25 oct. 2026: 1 dosar în investitori_kyc (respins), cnp_hash gol.

begin;

alter table public.investitori_kyc
  add column if not exists data_nasterii          date,
  add column if not exists cetatenie              text,     -- cod de țară ISO, 2 litere
  add column if not exists adresa_domiciliu       jsonb,    -- { strada, localitate, judet, cod_postal, tara }
  add column if not exists id_fiscal_tip          text,     -- 'cnp' (cetățeni români) sau 'nif' (străini)
  add column if not exists id_fiscal_criptat      text,     -- CNP / NIF, criptat cu rpc cripteaza_camp
  add column if not exists id_fiscal_ultimele3    text,     -- doar pentru afișare mascată
  add column if not exists act_serie_numar_criptat text,    -- seria și numărul actului, criptate
  add column if not exists act_ultimele3          text,
  add column if not exists act_valabil_pana       date;

alter table public.investitori_kyc drop constraint if exists investitori_kyc_cetatenie_check;
alter table public.investitori_kyc add constraint investitori_kyc_cetatenie_check
  check (cetatenie is null or cetatenie ~ '^[A-Z]{2}$');

alter table public.investitori_kyc drop constraint if exists investitori_kyc_id_fiscal_tip_check;
alter table public.investitori_kyc add constraint investitori_kyc_id_fiscal_tip_check
  check (id_fiscal_tip is null or id_fiscal_tip in ('cnp', 'nif'));

-- Același CNP / NIF nu poate exista pe două conturi (cnp_hash = HMAC calculat pe server).
create unique index if not exists investitori_kyc_cnp_hash_unic
  on public.investitori_kyc (cnp_hash) where cnp_hash is not null;

commit;

-- Verificare / Check:
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'investitori_kyc'
--    and column_name in ('data_nasterii','cetatenie','adresa_domiciliu','id_fiscal_tip','id_fiscal_criptat',
--                        'id_fiscal_ultimele3','act_serie_numar_criptat','act_ultimele3','act_valabil_pana');
-- select indexname from pg_indexes where indexname = 'investitori_kyc_cnp_hash_unic';
