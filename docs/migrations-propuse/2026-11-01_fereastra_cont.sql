-- ═══════════════════════════════════════════════════════════════════
-- My Darrin — pasul 11-R2: o singură fereastră de cont, cu rolul ales
-- la început (decizia LM, 1 nov. 2026)
-- O rulează LM în Supabase → SQL Editor, ÎNAINTE de publicarea codului
-- din PR-ul pasului 11-R2. Idempotentă: se poate rula de mai multe ori.
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce adaugă:
--   1. profiles.rol_solicitat — rolul ales în fereastra de cont, la înscriere:
--      null sau una dintre valorile client, partener_servicii,
--      partener_materiale, partener_inchirieri, partener_curier,
--      partener_asigurari. E DOAR o alegere, nu un drept: niciun cod nu pune
--      un rol în profiles.roles pe baza ei. Serverul o folosește doar ca să
--      trimită utilizatorul, după codul de confirmare, la formularul firmei
--      (/mydarrin-devino-partener.html?type=<tip>, modul „cont existent”);
--      rolul de partener îl adaugă tot serverul, după datele firmei
--      (api/partener/wizard-companie.js).
--   2. handle_new_user() citește în plus din raw_user_meta_data:
--        - rol_solicitat (valoare necunoscută sau lipsă → 'client');
--        - telefon → profiles.phone, cu phone_verificat = false (codul pe
--          telefon vine în pasul 11-R6; aici telefonul doar se salvează).
--
-- Sursa definiției actuale a handle_new_user():
--   docs/migrations-propuse/2026-10-14_securitate_roluri_pas2_app_metadata.sql
--   (ultima variantă din repo; rolul de partener doar din raw_app_meta_data,
--   înregistrarea publică = client). schema.sql (secțiunea 10) are o variantă
--   mai veche, înlocuită de cele două migrări din 14 oct. 2026.
--   LM compară definiția de mai jos cu cea din baza de date înainte de rulare:
--     select pg_get_functiondef('public.handle_new_user'::regproc);
--
-- Ce rămâne neschimbat față de varianta din 14 oct. 2026:
--   - rolul: din raw_app_meta_data->>'role' (scris doar de server), altfel
--     'client'; user_metadata nu decide niciun rol;
--   - status: 'active' pentru furnizorii externi (OAuth), altfel 'pending_otp';
--   - țara și limba din raw_user_meta_data (limba implicită 'ro');
--   - on conflict (id) do nothing.
-- Readus din schema.sql (secțiunea 10), pe care varianta din 14 oct. îl
-- pierduse: numele (profiles.nume) și consimțământul GDPR
-- (profiles.gdpr_consimtamant_at = now() când gdpr_acceptat = true).
-- Ambele coloane există în schema.sql; verificarea 4 de la final le arată.

begin;

-- ── 1. Coloana rol_solicitat ──
alter table public.profiles add column if not exists rol_solicitat text;

alter table public.profiles drop constraint if exists profiles_rol_solicitat_valid;
alter table public.profiles add constraint profiles_rol_solicitat_valid check (
  rol_solicitat is null or rol_solicitat in (
    'client', 'partener_servicii', 'partener_materiale',
    'partener_inchirieri', 'partener_curier', 'partener_asigurari'
  )
);

comment on column public.profiles.rol_solicitat is
  'Rolul ales la înscriere (pasul 11-R2). Doar o alegere, nu un drept: accesul vine numai din profiles.roles.';

-- Utilizatorul nu își poate schimba singur alegerea (a doua barieră, ca la
-- celelalte câmpuri protejate; scrierile din profiles trec doar prin server).
create or replace function public.protejeaza_campuri_profil()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and (
       new.id             is distinct from old.id
    or new.email          is distinct from old.email
    or new.role           is distinct from old.role
    or new.roles          is distinct from old.roles
    or new.status         is distinct from old.status
    or new.phone_verificat is distinct from old.phone_verificat
    or new.rol_solicitat  is distinct from old.rol_solicitat
  ) then
    raise exception 'Câmpurile protejate ale profilului se modifică doar de server.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ── 2. handle_new_user(): rol_solicitat și telefon ──
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _role text;
  _provider text;
  _status public.account_status;
  _rol_solicitat text;
  _telefon text;
  _nume text;
begin
  -- Rolul: doar din app_metadata (scris de server), ca în varianta din 14 oct. 2026.
  _role := lower(coalesce(new.raw_app_meta_data->>'role', ''));
  if _role not in ('partener_servicii', 'partener_materiale', 'partener_inchirieri',
                   'partener_curier', 'partener_asigurari') then
    _role := 'client';
  end if;

  _provider := new.raw_app_meta_data->>'provider';
  _status := case when _provider is not null and _provider <> 'email'
                  then 'active'::public.account_status
                  else 'pending_otp'::public.account_status end;

  -- Alegerea din fereastra de cont (pasul 11-R2); necunoscută → client.
  _rol_solicitat := lower(coalesce(new.raw_user_meta_data->>'rol_solicitat', ''));
  if _rol_solicitat not in ('client', 'partener_servicii', 'partener_materiale',
                            'partener_inchirieri', 'partener_curier', 'partener_asigurari') then
    _rol_solicitat := 'client';
  end if;

  -- Telefonul: doar format internațional (+ și 8–15 cifre), altfel nu se salvează.
  _telefon := regexp_replace(coalesce(new.raw_user_meta_data->>'telefon', ''), '[\s\-\.\(\)]', '', 'g');
  if _telefon !~ '^\+[1-9][0-9]{7,14}$' then
    _telefon := null;
  end if;

  -- Numele afișat: prenume + nume (fereastra de cont le trimite separat).
  _nume := nullif(trim(concat_ws(' ', nullif(trim(new.raw_user_meta_data->>'prenume'), ''),
                                      nullif(trim(new.raw_user_meta_data->>'nume'), ''))), '');

  insert into public.profiles (id, email, nume, role, roles, status, tara, limba,
                               gdpr_consimtamant_at, rol_solicitat, phone, phone_verificat)
  values (
    new.id,
    new.email,
    _nume,
    _role,
    array[_role],
    _status,
    new.raw_user_meta_data->>'tara',
    coalesce(new.raw_user_meta_data->>'limba', 'ro'),
    case when (new.raw_user_meta_data->>'gdpr_acceptat') = 'true' then now() else null end,
    _rol_solicitat,
    _telefon,
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

-- Funcția de trigger nu se apelează direct: nu o lăsăm executabilă de anon / authenticated.
-- (PUBLIC rămâne neatins: trigger-ul on_auth_user_created, care există deja,
-- rulează la fiecare înscriere; nu îl recreăm aici.)
revoke execute on function public.handle_new_user() from anon, authenticated;

commit;

-- ── Verificare (se rulează separat, după commit) ──
-- 1) Coloana există → 1 rând, data_type = text
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'profiles' and column_name = 'rol_solicitat';
--
-- 2) Funcția citește rol_solicitat și telefonul, are search_path fix → true, true, true
-- select position('rol_solicitat' in pg_get_functiondef('public.handle_new_user'::regproc)) > 0 as rol_solicitat,
--        position('''telefon''' in pg_get_functiondef('public.handle_new_user'::regproc)) > 0 as telefon,
--        exists (select 1 from pg_proc where proname = 'handle_new_user'
--                and proconfig::text like '%search_path%') as search_path_fix;
--
-- 3) Trigger-ul există → 1 rând
-- select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created';
--
-- 4) Coloanele scrise de funcție există în profiles → 6 rânduri
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'profiles'
--    and column_name in ('nume', 'gdpr_consimtamant_at', 'rol_solicitat', 'phone', 'phone_verificat', 'limba');
--
-- 5) Telefonul nu are constrângere de unicitate (altfel două conturi cu același
--    telefon nu s-ar putea crea) → 0 rânduri
-- select conname from pg_constraint
--  where conrelid = 'public.profiles'::regclass and contype = 'u'
--    and pg_get_constraintdef(oid) ilike '%phone%';
--
-- 6) După un cont nou de test: rol_solicitat, phone, phone_verificat = false, roles = {client}
-- select email, roles, rol_solicitat, phone, phone_verificat, gdpr_consimtamant_at
--   from public.profiles order by created_at desc limit 5;
