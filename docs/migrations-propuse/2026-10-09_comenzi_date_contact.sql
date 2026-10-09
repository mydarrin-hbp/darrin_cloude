-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (9 octombrie 2026)
-- Comenzi: datele de contact din pasul „Detalii” al checkout-ului
-- ═══════════════════════════════════════════════════════════════════
--
-- Problema
--   Checkout-ul cere și validează prenume, nume, telefon și email
--   (co-prenume, co-nume, co-telefon, co-email), dar `comenzi` nu are
--   nicio coloană pentru ele: verificat 9 oct. 2026 prin API-ul REST
--   (select=<coloană>&limit=0 → „column does not exist” pentru toate
--   variantele: nume/telefon/email/contact_*/observatii/persoana_contact…;
--   `adresa` există). Partenerul nu are, deci, telefonul de contact la
--   adresă — doar contul clientului (profiles), care poate fi altă
--   persoană decât cea de la adresă.
--
-- Ce adaugă
--   contact_nume, contact_telefon, contact_email — persoana de contact
--     pentru comanda asta (implicit cea din formular);
--   contact_adresa_nume, contact_adresa_telefon — persoana care deschide
--     la adresă, dacă e alta (câmp nou în formular, opțional);
--   observatii — instrucțiuni pentru partener (acces, interfon, parcare).
--   Toate opționale (comenzile vechi rămân valide). Fără coloane noi de
--   RLS: rândul e deja protejat de politicile existente pe `comenzi`.
--
-- După aplicare (cod, commit separat)
--   - mydarrin-checkout.html trimite câmpurile în body-ul către
--     /api/comenzi/creeaza (+ câmpurile noi „Persoana de la adresă” și
--     „Observații”);
--   - api/comenzi/creeaza.js le validează (lungime, format telefon) și
--     le salvează în insertBase;
--   - partenerul le vede în api/partener/sarcini.js doar după acceptare.
--
-- Ordine de aplicare
--   Oricând, ÎNAINTE de deploy-ul codului care le scrie.
-- ═══════════════════════════════════════════════════════════════════

begin;

alter table public.comenzi
  add column if not exists contact_nume           text,
  add column if not exists contact_telefon        text,
  add column if not exists contact_email          text,
  add column if not exists contact_adresa_nume    text,
  add column if not exists contact_adresa_telefon text,
  add column if not exists observatii             text;

-- Limite de lungime (idempotent: se creează doar dacă lipsesc).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'comenzi_contact_lungimi_check') then
    alter table public.comenzi add constraint comenzi_contact_lungimi_check check (
      coalesce(length(contact_nume), 0)           <= 200 and
      coalesce(length(contact_telefon), 0)        <= 40  and
      coalesce(length(contact_email), 0)          <= 254 and
      coalesce(length(contact_adresa_nume), 0)    <= 200 and
      coalesce(length(contact_adresa_telefon), 0) <= 40  and
      coalesce(length(observatii), 0)             <= 2000
    );
  end if;
end $$;

comment on column public.comenzi.contact_nume is 'Persoana de contact pentru comandă (din checkout, pasul „Detalii”).';
comment on column public.comenzi.contact_telefon is 'Telefonul persoanei de contact. Vizibil partenerului doar după acceptarea comenzii.';
comment on column public.comenzi.contact_email is 'Emailul persoanei de contact (poate diferi de emailul contului).';
comment on column public.comenzi.contact_adresa_nume is 'Persoana care deschide la adresă, dacă e alta decât contactul.';
comment on column public.comenzi.contact_adresa_telefon is 'Telefonul persoanei de la adresă. Vizibil partenerului doar după acceptare.';
comment on column public.comenzi.observatii is 'Instrucțiuni pentru partener: acces, interfon, parcare.';

-- Verificare
do $$
declare
  lipsa text;
begin
  select string_agg(c, ', ') into lipsa
  from unnest(array['contact_nume','contact_telefon','contact_email','contact_adresa_nume','contact_adresa_telefon','observatii']) c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'comenzi' and column_name = c
  );
  if lipsa is not null then
    raise exception 'Coloane lipsă pe comenzi: %', lipsa;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'comenzi_contact_lungimi_check') then
    raise exception 'Lipsește constrângerea comenzi_contact_lungimi_check';
  end if;
end $$;

commit;
