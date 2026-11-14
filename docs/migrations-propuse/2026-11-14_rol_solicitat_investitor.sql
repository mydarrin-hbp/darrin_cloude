-- ═══════════════════════════════════════════════════════════════════
-- My Darrin — pasul 11-I1 (14 nov. 2026): tipul de cont „Investitor” la înscriere
-- O rulează LM în Supabase → SQL Editor, ÎNAINTE de publicarea codului
-- din PR-ul pasului 11-I1. O singură tranzacție, idempotentă: se poate rula
-- de mai multe ori. Nu atinge alte tabele și nu inserează date de test.
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce schimbă:
--   1. constrângerea profiles_rol_solicitat_valid acceptă și 'investor'
--      (lista existentă: client și cele 5 roluri de partener);
--   2. handle_new_user() păstrează 'investor' din raw_user_meta_data.rol_solicitat
--      (până acum, orice valoare necunoscută devenea 'client').
--      Rolul `investor` NU se adaugă în profiles.roles la înscriere: înregistrarea
--      publică dă tot `client` (din app_metadata, ca înainte); rolul de investitor
--      îl pune doar serverul, la trimiterea dosarului (asiguraRolInvestitor).
--
-- Sursa definiției: producția, citită pe 14 nov. 2026 cu
--   select pg_get_functiondef('public.handle_new_user'::regproc);
-- identică cu docs/migrations-propuse/2026-11-01_fereastra_cont.sql (ultima
-- migrare care redefinește funcția; 2026-11-13_masurare_palnie.sql n-o atinge).
-- Singura diferență față de ea: 'investor' în lista pentru _rol_solicitat.
-- search_path fix ('public'), security definer, fără execute pentru anon /
-- authenticated — ca înainte.

begin;

-- ── 1. Constrângerea: lista existentă + 'investor' ──
alter table public.profiles drop constraint if exists profiles_rol_solicitat_valid;
alter table public.profiles add constraint profiles_rol_solicitat_valid check (
  rol_solicitat is null or rol_solicitat in (
    'client', 'partener_servicii', 'partener_materiale', 'partener_inchirieri',
    'partener_curier', 'partener_asigurari', 'investor'
  )
);

-- ── 2. handle_new_user(): 'investor' acceptat ca rol_solicitat ──
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

  -- Alegerea din fereastra de cont (pasul 11-R2; 'investor' de la pasul 11-I1); necunoscută → client.
  -- 'investor' e doar alegerea: rolul investor NU se pune în roles la înscriere,
  -- îl adaugă serverul la trimiterea dosarului (asiguraRolInvestitor).
  _rol_solicitat := lower(coalesce(new.raw_user_meta_data->>'rol_solicitat', ''));
  if _rol_solicitat not in ('client', 'partener_servicii', 'partener_materiale',
                            'partener_inchirieri', 'partener_curier', 'partener_asigurari',
                            'investor') then
    _rol_solicitat := 'client';
  end if;

  -- Telefonul: doar format internațional (+ și 8–15 cifre), altfel nu se salvează.
  _telefon := regexp_replace(coalesce(new.raw_user_meta_data->>'telefon', ''), '[\s\-\.\(\)]', '', 'g');
  if _telefon !~ '^\+[1-9][0-9]{7,14}$' then
    _telefon := null;
  end if;
  -- Telefonul e unic (profiles_phone_key): deja folosit pe alt profil → nu se
  -- salvează, iar contul se creează fără telefon.
  if _telefon is not null and exists (select 1 from public.profiles where phone = _telefon) then
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

-- Funcția de trigger nu se apelează direct (ca în 2026-11-01).
revoke execute on function public.handle_new_user() from anon, authenticated;

-- ── 3. Verificarea (fără inserări de probă) ──
do $$
declare
  _def text := pg_get_functiondef('public.handle_new_user'::regproc);
  _cons text;
begin
  select pg_get_constraintdef(oid) into _cons
    from pg_constraint
   where conname = 'profiles_rol_solicitat_valid' and conrelid = 'public.profiles'::regclass;
  if _cons is null or position('''investor''' in _cons) = 0 then
    raise exception 'profiles_rol_solicitat_valid nu acceptă investor: %', _cons;
  end if;
  -- 'investor' în lista pentru _rol_solicitat (nu doar într-un comentariu).
  if _def !~ $re$'partener_asigurari',\s*'investor'\) then$re$ then
    raise exception 'handle_new_user() nu conține investor în lista pentru _rol_solicitat';
  end if;
  -- Rolul investor nu ajunge în roles la înscriere: roles rămâne array[_role].
  if position('array[_role]' in _def) = 0 then
    raise exception 'handle_new_user(): roles nu mai e array[_role]';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.handle_new_user'::regproc
                  and prosecdef and proconfig::text like '%search_path=public%') then
    raise exception 'handle_new_user(): lipsește security definer sau search_path fix';
  end if;
  if has_function_privilege('anon', 'public.handle_new_user()', 'execute')
     or has_function_privilege('authenticated', 'public.handle_new_user()', 'execute') then
    raise exception 'handle_new_user() e executabilă de anon / authenticated';
  end if;
  raise notice 'OK: investor acceptat în profiles_rol_solicitat_valid și în handle_new_user()';
end
$$;

commit;
