-- My Darrin — pasul 11-P2b / step 11-P2b
-- Checkout: datele de facturare (persoană fizică sau firmă), salvate pe comandă.
-- Checkout: billing data (private individual or company), saved on the order.
-- Rulează în Supabase SQL Editor ÎNAINTE de merge. / Run in the SQL Editor BEFORE merge.
-- Verificat read-only pe 25 oct. 2026: 2 comenzi, ambele tip_client = 'b2c'.

begin;

-- 1. Tipul clientului: b2c (persoană fizică), b2b (factură pe firmă), b2g (fluxul existent).
alter table public.comenzi drop constraint if exists comenzi_tip_client_check;
alter table public.comenzi add constraint comenzi_tip_client_check
  check (tip_client in ('b2c', 'b2b', 'b2g'));

-- 2. Datele de facturare, copiate pe comandă la plasare (nu se schimbă dacă clientul își modifică profilul).
--    PF: { tip:'pf', prenume, nume, adresa:{strada,localitate,judet,cod_postal,tara}, cnp_furnizat, cnp_ultimele3 }
--    PJ: { tip:'pj', denumire, cui, nr_reg_com, adresa:{...}, tva_activ, sursa:'anaf'|'manual' }
alter table public.comenzi add column if not exists date_facturare jsonb;

-- 3. CNP-ul clientului persoană fizică (opțional), criptat cu rpc cripteaza_camp.
alter table public.comenzi add column if not exists client_cnp_criptat text;

commit;

-- Verificare / Check:
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'comenzi_tip_client_check';
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'comenzi' and column_name in ('date_facturare','client_cnp_criptat');
