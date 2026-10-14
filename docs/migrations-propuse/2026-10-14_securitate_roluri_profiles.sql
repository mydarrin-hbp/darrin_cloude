-- ═══════════════════════════════════════════════════════════════════
-- My Darrin — securitate: rolurile din profiles nu mai pot fi
-- modificate de utilizator (14 oct. 2026)
-- Se rulează o singură dată, în Supabase → SQL Editor, de LM.
-- Se poate rula de mai multe ori fără erori (idempotentă).
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce repară (verificat pe baza live, 14 oct. 2026):
--   C2. Politica „user actualizeaza propriul profil” + dreptul UPDATE al
--       rolurilor anon/authenticated pe TOATE coloanele permit oricărui
--       utilizator logat să-și scrie singur profiles.roles = {superadmin}.
--   C3. Trigger-ul handle_new_user() copiază la înregistrare rolul trimis
--       de utilizator în user_metadata.role direct în profiles.role/roles.
--       Un signUp cu { role: 'superadmin' } creează direct un superadmin.
--
-- Ce NU se schimbă:
--   - Serverul (API-ul, cu service_role) scrie în profiles exact ca acum.
--   - Funcțiile security definer (is_superadmin, admin_set_portofoliu etc.)
--     rulează ca proprietar și nu sunt afectate.
--   - Niciun client nu scrie direct în profiles (verificat în cod: toate
--     scrierile trec prin api/ cu supabaseAdmin).
--   - Conturile existente rămân neatinse. Azi au rol de admin doar:
--     cristianpopaban@gmail.com (superadmin) și
--     test.admin.pilot@homebestpal.com (admin).

begin;

-- ── C2: utilizatorii nu mai pot modifica direct rândul din profiles ──
revoke insert, update, delete on table public.profiles from anon, authenticated;

-- A doua barieră: chiar dacă un drept ar fi redat din greșeală,
-- câmpurile protejate nu pot fi schimbate decât de server.
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
  ) then
    raise exception 'Câmpurile protejate ale profilului se modifică doar de server.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protejeaza_campuri_profil on public.profiles;
create trigger protejeaza_campuri_profil
  before update on public.profiles
  for each row execute function public.protejeaza_campuri_profil();

-- ── C3: la înregistrare se acceptă doar roluri neprivilegiate ──
-- client (înregistrarea publică) și rolurile de partener create de
-- server prin api/public/partner-register.js. Orice altă valoare
-- (admin, superadmin, investitor etc.) devine „client”.
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
begin
  _role := lower(coalesce(new.raw_user_meta_data->>'role', 'client'));
  if _role not in ('client', 'partener_servicii', 'partener_materiale',
                   'partener_inchirieri', 'partener_curier', 'partener_asigurari') then
    _role := 'client';
  end if;

  _provider := new.raw_app_meta_data->>'provider';
  _status := case when _provider is not null and _provider <> 'email'
                  then 'active'::public.account_status
                  else 'pending_otp'::public.account_status end;

  insert into public.profiles (id, email, role, roles, status, tara, limba)
  values (
    new.id,
    new.email,
    _role,
    array[_role],
    _status,
    new.raw_user_meta_data->>'tara',
    coalesce(new.raw_user_meta_data->>'limba', 'ro')
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

commit;

-- ── Verificare (rezultatele trebuie să fie cele de mai jos) ──
-- 1) Niciun drept de scriere pentru anon/authenticated → 0 rânduri
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'profiles'
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

-- 2) Trigger-ul de protecție există → 1 rând
select tgname from pg_trigger
where tgrelid = 'public.profiles'::regclass and tgname = 'protejeaza_campuri_profil';

-- 3) Conturile cu rol de admin → doar cele 2 așteptate
select u.email, p.role, p.roles
from public.profiles p join auth.users u on u.id = p.id
where p.roles && array['superadmin', 'admin']::text[] or p.role in ('superadmin', 'admin');
