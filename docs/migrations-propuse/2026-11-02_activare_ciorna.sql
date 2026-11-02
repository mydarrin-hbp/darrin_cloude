-- ═══════════════════════════════════════════════════════════════════
-- My Darrin — pasul 11-R3, corecție: ciorna activării pe pași
-- (decizia LM, 2 nov. 2026)
-- O rulează LM în Supabase → SQL Editor. Idempotentă: se poate rula de mai
-- multe ori. Codul merge și înainte de rulare: fără tabel, salvarea automată
-- se oprește în tăcere, iar pașii salvați rămân.
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce adaugă: tabelul partener_activare_ciorna — ciorna pașilor din lista
-- „Activează contul” (dashboard-ul partenerului), salvată automat, ca
-- utilizatorul să reia exact de unde a rămas, de pe orice dispozitiv.
--   user_id        cheie primară; contul (auth.users), ștearsă odată cu el;
--   pas_curent     pasul la care a rămas (1–6);
--   date           valorile introduse și încă nesalvate (jsonb, fără fișiere,
--                  fără IBAN și fără coduri; limita de 50 KB o impune serverul);
--   actualizat_la  ora ultimei salvări automate.
--
-- Ciorna e doar un ajutor: nu acordă nimic și nu înlocuiește salvarea
-- pasului. Rolul de partener se acordă tot doar la salvarea pasului „Firma”
-- (api/partener/wizard-companie.js, cu verificarea ANAF).
--
-- Acces: RLS activ, fără nicio politică pentru anon / authenticated, deci
-- tabelul se citește și se scrie doar prin server (supabaseAdmin, în
-- api/partener/activare-ciorna.js), pentru utilizatorul conectat.

begin;

create table if not exists public.partener_activare_ciorna (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  pas_curent    integer not null default 1,
  date          jsonb not null default '{}'::jsonb,
  actualizat_la timestamptz not null default now()
);

alter table public.partener_activare_ciorna drop constraint if exists partener_activare_ciorna_pas_valid;
alter table public.partener_activare_ciorna add constraint partener_activare_ciorna_pas_valid
  check (pas_curent between 1 and 6);

alter table public.partener_activare_ciorna enable row level security;

-- Nicio politică: anon și authenticated nu citesc și nu scriu nimic.
revoke all on table public.partener_activare_ciorna from anon, authenticated;

comment on table public.partener_activare_ciorna is
  'Ciorna activării contului de partener (pasul 11-R3). Doar ajutor: nu acordă niciun drept. Acces doar prin server.';

commit;

-- ── Verificare (se rulează separat, după commit) ──
-- 1) Tabelul și coloanele → 4 rânduri
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'partener_activare_ciorna' order by ordinal_position;
--
-- 2) RLS activ → true
-- select relrowsecurity from pg_class where oid = 'public.partener_activare_ciorna'::regclass;
--
-- 3) Nicio politică → 0 rânduri
-- select policyname from pg_policies where schemaname = 'public' and tablename = 'partener_activare_ciorna';
--
-- 4) Niciun drept pentru anon / authenticated → 0 rânduri
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'partener_activare_ciorna' and grantee in ('anon', 'authenticated');
