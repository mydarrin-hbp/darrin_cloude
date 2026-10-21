-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (pasul 11-L, 17 oct. 2026)
-- Ruta de investitor legată de cont și verificarea identității
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce face
--   1. Bucket-ul privat `investitori-kyc` (fără acces public; JPEG, PNG,
--      WEBP, PDF; cel mult 5 MB pe fișier). Fișierele se încarcă pe calea
--      „<user_id>/…”, prin adrese semnate date de server
--      (api/investitori/kyc-document.js). Politica de storage: utilizatorul
--      autentificat citește doar fișierele din dosarul lui; nicio politică de
--      scriere pentru anon / authenticated (încărcarea merge doar prin adresa
--      semnată). Adminii citesc prin server (service role), cu adrese semnate
--      scurte (api/admin/investitori-kyc.js).
--   2. investitori_kyc: coloanele rutei (date personale, IBAN criptat și
--      ultimele 4 cifre, tipul și căile documentelor, răspunsurile MiFID,
--      declarațiile PEP și sancțiuni, rezidența fiscală, pasul curent,
--      motivul respingerii RO + EN, updated_at); starea `ciorna` pentru ruta
--      începută și netrimisă; submitted_at fără valoare implicită (se scrie la
--      trimitere); un rând pe utilizator (unic pe user_id). Fără CNP în clar.
--      RLS: utilizatorul își vede doar rândul lui; scrierile doar prin server
--      (insert / update / delete revocate pentru anon și authenticated).
--      Politicile vechi de scriere („investitor trimite KYC”, „admin
--      revizuieste KYC”) se șterg: fără drepturi de scriere nu mai aveau
--      efect, dar induceau în eroare (corecție 21 oct. 2026).
--   3. investitori_portofoliu: user_id (legătura cu contul), cu index;
--      instrument și status, dacă lipsesc. Un investitor poate avea mai
--      multe subscrieri (alte tickete, alte runde): unicitatea pe user_id
--      (investitori_portofoliu_user_id_key, live) se scoate — altfel a doua
--      subscriere a aceluiași investitor cădea cu 500 (corecție 21 oct. 2026).
--      Cheia străină existentă pe user_id (live: spre profiles(id), ON DELETE
--      CASCADE) rămâne; una nouă, spre auth.users, se adaugă doar dacă pe
--      user_id nu există deja nicio cheie străină.
--
-- Siguranță
--   O singură tranzacție; rulabilă de mai multe ori (if not exists / drop ...
--   if exists / on conflict). Nu șterge date. La bucket, dacă există deja,
--   doar îl face privat și îi pune limitele de tip și mărime.
--   La investitori_kyc.status: dacă există o constrângere CHECK pe status
--   care nu acceptă `ciorna`, e înlocuită cu una care acceptă vechile valori
--   (pending, in_verificare, aprobat, respins) și `ciorna`.
--
-- Ordine de lansare: înaintea codului din branch-ul ruta-investitor-roluri.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 1. Bucket-ul privat pentru documentele de identitate ────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('investitori-kyc', 'investitori-kyc', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "investitori_kyc_citire_proprie" on storage.objects;
create policy "investitori_kyc_citire_proprie" on storage.objects
  for select to authenticated
  using (bucket_id = 'investitori-kyc' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── 2. investitori_kyc: coloanele rutei de investitor ───────────────
alter table public.investitori_kyc
  add column if not exists date_personale      jsonb,
  add column if not exists iban_criptat        text,
  add column if not exists iban_ultimele4      text,
  add column if not exists tip_document        text,
  add column if not exists document_fata_path  text,
  add column if not exists document_verso_path text,
  add column if not exists mifid_raspunsuri    jsonb,
  add column if not exists pep_declaratie      jsonb,
  add column if not exists pep_check           boolean default false,
  add column if not exists sanctiuni_declarat  boolean,
  add column if not exists rezidenta_fiscala_tara text,
  add column if not exists pas_curent          integer default 1,
  add column if not exists motiv_respingere_ro text,
  add column if not exists motiv_respingere_en text,
  add column if not exists reviewed_at         timestamptz,
  add column if not exists reviewed_by         uuid,
  add column if not exists updated_at          timestamptz default now();

alter table public.investitori_kyc alter column submitted_at drop default;

-- Tipul documentului: carte de identitate, pașaport, permis de ședere.
alter table public.investitori_kyc drop constraint if exists investitori_kyc_tip_document_check;
alter table public.investitori_kyc add constraint investitori_kyc_tip_document_check
  check (tip_document is null or tip_document in ('ci', 'pasaport', 'permis_sedere'));

-- Starea `ciorna`: orice CHECK existent pe status care nu o acceptă e înlocuit.
do $$
declare
  c record;
begin
  for c in
    select con.conname, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    where con.conrelid = 'public.investitori_kyc'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
      and con.conname <> 'investitori_kyc_status_check_11l'
  loop
    if c.def not ilike '%ciorna%' then
      execute format('alter table public.investitori_kyc drop constraint %I', c.conname);
    end if;
  end loop;
end;
$$;
alter table public.investitori_kyc drop constraint if exists investitori_kyc_status_check_11l;
alter table public.investitori_kyc add constraint investitori_kyc_status_check_11l
  check (status is null or status in ('ciorna', 'pending', 'in_verificare', 'aprobat', 'respins'));

-- Un rând pe utilizator (upsert-urile serverului se bazează pe asta).
do $$
begin
  if not exists (
    select 1 from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.investitori_kyc'::regclass
      and i.indisunique and i.indnatts = 1 and a.attname = 'user_id'
  ) then
    create unique index investitori_kyc_user_id_unic on public.investitori_kyc (user_id);
  end if;
end;
$$;

-- RLS: utilizatorul își vede doar rândul lui; scrierile doar prin server.
alter table public.investitori_kyc enable row level security;
drop policy if exists "investitorul vede propriul KYC" on public.investitori_kyc;
drop policy if exists "investitor trimite KYC" on public.investitori_kyc;
drop policy if exists "admin revizuieste KYC" on public.investitori_kyc;
create policy "investitorul vede propriul KYC" on public.investitori_kyc
  for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.investitori_kyc from anon, authenticated;

-- ── 3. investitori_portofoliu: legătura cu contul ───────────────────
alter table public.investitori_portofoliu
  add column if not exists user_id    uuid,
  add column if not exists instrument text,
  add column if not exists status     text default 'in_asteptare';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.investitori_portofoliu'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) ilike 'FOREIGN KEY (user_id)%'
  ) then
    alter table public.investitori_portofoliu
      add constraint investitori_portofoliu_user_id_fkey foreign key (user_id) references auth.users(id);
  end if;
end;
$$;
create index if not exists investitori_portofoliu_user_id_idx on public.investitori_portofoliu (user_id);

-- Mai multe subscrieri pe investitor: fără unicitate pe user_id singur.
alter table public.investitori_portofoliu drop constraint if exists investitori_portofoliu_user_id_key;
do $$
declare
  c record;
begin
  -- orice altă constrângere UNIQUE / PRIMARY doar pe user_id
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.investitori_portofoliu'::regclass
      and con.contype = 'u'
      and con.conkey = array[(select attnum from pg_attribute
                              where attrelid = 'public.investitori_portofoliu'::regclass and attname = 'user_id')]::smallint[]
  loop
    execute format('alter table public.investitori_portofoliu drop constraint %I', c.conname);
  end loop;
  -- orice index unic rămas (fără constrângere) doar pe user_id
  for c in
    select ic.relname
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = 'public.investitori_portofoliu'::regclass
      and i.indisunique and i.indnatts = 1 and a.attname = 'user_id'
      and not exists (select 1 from pg_constraint con where con.conindid = i.indexrelid)
  loop
    execute format('drop index public.%I', c.relname);
  end loop;
end;
$$;

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
declare
  v_lipsa text;
begin
  if not exists (select 1 from storage.buckets where id = 'investitori-kyc' and public = false
                 and file_size_limit = 5242880 and 'application/pdf' = any(allowed_mime_types)) then
    raise exception 'Bucket-ul investitori-kyc lipsește, e public sau nu are limitele corecte';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'investitori_kyc_citire_proprie') then
    raise exception 'Politica de citire a bucket-ului investitori-kyc lipsește';
  end if;
  select string_agg(c, ', ') into v_lipsa
  from unnest(array['date_personale','iban_criptat','iban_ultimele4','tip_document','document_fata_path',
                    'document_verso_path','mifid_raspunsuri','pep_declaratie','sanctiuni_declarat',
                    'rezidenta_fiscala_tara','pas_curent','motiv_respingere_ro','motiv_respingere_en','updated_at']) c
  where not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'investitori_kyc' and column_name = c);
  if v_lipsa is not null then
    raise exception 'Coloane lipsă în investitori_kyc: %', v_lipsa;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.investitori_kyc'::regclass) then
    raise exception 'RLS nu e activ pe investitori_kyc';
  end if;
  if has_table_privilege('authenticated', 'public.investitori_kyc', 'INSERT')
     or has_table_privilege('authenticated', 'public.investitori_kyc', 'UPDATE') then
    raise exception 'authenticated poate încă scrie direct în investitori_kyc';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'investitori_portofoliu' and column_name = 'user_id') then
    raise exception 'investitori_portofoliu.user_id lipsește';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'investitori_portofoliu_user_id_idx') then
    raise exception 'Indexul investitori_portofoliu_user_id_idx lipsește';
  end if;
  if exists (
    select 1 from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = 'public.investitori_portofoliu'::regclass
      and i.indisunique and i.indnatts = 1 and a.attname = 'user_id'
  ) then
    raise exception 'investitori_portofoliu.user_id e încă unic: a doua subscriere a unui investitor ar eșua';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.investitori_portofoliu'::regclass
                 and contype = 'f' and pg_get_constraintdef(oid) ilike 'FOREIGN KEY (user_id)%') then
    raise exception 'investitori_portofoliu.user_id nu are cheie străină';
  end if;
  select string_agg(policyname || ' (' || cmd || ')', ', ') into v_lipsa
  from pg_policies
  where schemaname = 'public' and tablename = 'investitori_kyc' and cmd <> 'SELECT';
  if v_lipsa is not null then
    raise exception 'Pe investitori_kyc au rămas politici de scriere: %', v_lipsa;
  end if;
end;
$$;

commit;

-- Starea după migrare (doar citire):
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'investitori-kyc';
select count(*) as dosare_kyc, count(*) filter (where status = 'ciorna') as ciorne from public.investitori_kyc;
select count(*) as subscrieri, count(user_id) as cu_cont from public.investitori_portofoliu;
