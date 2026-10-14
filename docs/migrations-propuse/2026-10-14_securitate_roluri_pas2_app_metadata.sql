-- ═══════════════════════════════════════════════════════════════════
-- My Darrin — securitate, pasul 2: rolul de partener doar din
-- app_metadata (14 oct. 2026)
-- ✔ Condiția e îndeplinită: PR #8 (`securitate-roluri`) e unit în main
--   (32092eb) și publicat pe Vercel pe 14 oct. 2026 — partner-register.js
--   scrie deja rolul în app_metadata. Se poate rula acum.
-- Idempotentă. O rulează LM în Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce închide: după pasul 1, un signUp public cu { role: 'partener_curier' }
-- în user_metadata primea încă rol de partener. app_metadata poate fi scris
-- doar de server (service_role), deci rolul de partener se ia de acolo.
-- user_metadata nu mai decide niciun rol: înregistrarea publică = client.

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
  _role := lower(coalesce(new.raw_app_meta_data->>'role', ''));
  if _role not in ('partener_servicii', 'partener_materiale', 'partener_inchirieri',
                   'partener_curier', 'partener_asigurari') then
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

-- Verificare: trebuie să întoarcă true
select position('raw_app_meta_data->>''role''' in pg_get_functiondef('public.handle_new_user'::regproc)) > 0 as citeste_app_metadata;
