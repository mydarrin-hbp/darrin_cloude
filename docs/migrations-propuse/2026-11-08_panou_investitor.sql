-- docs/migrations-propuse/2026-11-08_panou_investitor.sql
-- Pasul 11-I1 (8 nov. 2026): panoul investitorului pe pagină proprie.
-- Se aplică de LM în SQL Editor, ÎNAINTE de publicarea codului care o folosește.
-- O singură tranzacție; se poate rula de mai multe ori fără efect suplimentar.
--
-- Adaugă:
--   investitori_portofoliu: aprobat_la, aprobat_de — data și autorul deciziei din
--     back-office; lock-up-ul se calculează din aprobat_la. Fără completare
--     retroactivă (nu există subscrieri aprobate).
--   investitori_exit: actualizat_la, anulat_la, constrângerea pe status și indexul
--     pentru lista cererilor unui investitor.
-- Politicile RLS nu se schimbă: totul trece prin API-urile de pe server.
--
-- Valorile de status: codul scrie azi doar in_procesare, iar back-office-ul nu scrie
-- în investitori_exit. `finalizat` e inclusă pentru că schema.sql o documentează.
-- Dacă există rânduri cu altă valoare, migrarea se oprește, fără nicio schimbare.

begin;

alter table public.investitori_portofoliu
  add column if not exists aprobat_la timestamptz,
  add column if not exists aprobat_de uuid;

alter table public.investitori_exit
  add column if not exists actualizat_la timestamptz,
  add column if not exists anulat_la timestamptz;

do $$
declare
  necunoscute text;
begin
  select string_agg(distinct status, ', ') into necunoscute
  from public.investitori_exit
  where status is not null
    and status not in ('in_procesare', 'aprobat', 'respins', 'platit', 'finalizat', 'anulat');
  if necunoscute is not null then
    raise exception 'investitori_exit are valori de status necunoscute: %. Migrarea s-a oprit; nimic nu s-a schimbat.', necunoscute;
  end if;
end $$;

alter table public.investitori_exit drop constraint if exists investitori_exit_status_check;
alter table public.investitori_exit
  add constraint investitori_exit_status_check
  check (status in ('in_procesare', 'aprobat', 'respins', 'platit', 'finalizat', 'anulat'));

create index if not exists investitori_exit_user_creat_idx
  on public.investitori_exit (user_id, created_at desc);

-- Verificarea finală: orice lipsă oprește tranzacția.
do $$
declare
  lipsa text;
begin
  select string_agg(c.tabel || '.' || c.coloana, ', ') into lipsa
  from (values
    ('investitori_portofoliu', 'aprobat_la'),
    ('investitori_portofoliu', 'aprobat_de'),
    ('investitori_exit', 'actualizat_la'),
    ('investitori_exit', 'anulat_la')
  ) as c(tabel, coloana)
  where not exists (
    select 1 from information_schema.columns i
    where i.table_schema = 'public' and i.table_name = c.tabel and i.column_name = c.coloana
  );
  if lipsa is not null then
    raise exception 'Verificare eșuată: lipsesc coloanele %', lipsa;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'investitori_exit_status_check'
      and conrelid = 'public.investitori_exit'::regclass and contype = 'c'
  ) then
    raise exception 'Verificare eșuată: lipsește constrângerea investitori_exit_status_check';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'investitori_exit' and indexname = 'investitori_exit_user_creat_idx'
  ) then
    raise exception 'Verificare eșuată: lipsește indexul investitori_exit_user_creat_idx';
  end if;
end $$;

commit;
