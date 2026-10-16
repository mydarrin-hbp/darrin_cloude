-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (16 octombrie 2026)
-- Starea profilului pentru partenerii creați de server (pasul 10c)
-- ═══════════════════════════════════════════════════════════════════
--
-- Problema (auditul traseului de partener, după pasul 10b)
--   Conturile de partener create de server înainte de 10b
--   (api/public/partner-register.js, auth.admin.createUser cu emailul
--   confirmat) au rămas cu profiles.status = 'pending_otp': trigger-ul
--   handle_new_user() pune 'pending_otp', iar contul nu trece prin
--   verificarea OTP de la înregistrarea clientului. De la 10b, codul
--   (lib/roluri-partener.js, asiguraRolInProfil cu activeaza) pune 'active'
--   pentru conturile noi. Azi nu blochează nimic, dar e o stare falsă
--   (de exemplu contact@homebestpal.ro).
--
-- Ce face
--   Pentru conturile care au un rând în partners, emailul confirmat în
--   auth.users (email_confirmed_at setat) și profiles.status = 'pending_otp':
--   status → 'active'.
--
-- Ce NU face
--   Nu atinge alte conturi: clienții, conturile fără email confirmat și
--   conturile suspendate rămân cum sunt. Nu schimbă rolurile și nici
--   partners.status_verificare (aprobarea partenerului e separată).
--
-- Ordine de aplicare
--   Oricând: codul din branch-ul eligibilitate-partener nu depinde de ea.
--
-- Cum se aplică
--   O singură tranzacție, rulabilă de mai multe ori (a doua rulare nu mai
--   găsește nimic de corectat). Verificarea de la final oprește tranzacția
--   dacă un partener cu emailul confirmat rămâne în 'pending_otp'. Ultimul
--   select arată conturile corectate la această rulare.
-- ═══════════════════════════════════════════════════════════════════

begin;

drop table if exists pg_temp.status_parteneri_corectati;
create temp table status_parteneri_corectati (
  id uuid, email text, partner_type text, status_inainte text, status_dupa text
) on commit preserve rows;

with de_corectat as (
  select pr.id, coalesce(pr.email, u.email) as email, p.partner_type::text as partner_type
  from public.profiles pr
  join public.partners p on p.id = pr.id
  join auth.users u on u.id = pr.id
  where pr.status = 'pending_otp'
    and u.email_confirmed_at is not null
),
actualizate as (
  update public.profiles pr
  set status = 'active'
  from de_corectat d
  where pr.id = d.id
    and pr.status = 'pending_otp'
  returning pr.id, pr.status::text as status
)
insert into status_parteneri_corectati (id, email, partner_type, status_inainte, status_dupa)
select d.id, d.email, d.partner_type, 'pending_otp', a.status
from de_corectat d join actualizate a on a.id = d.id;

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
declare
  v_ramase text;
begin
  select string_agg(coalesce(pr.email, pr.id::text), ', ') into v_ramase
  from public.profiles pr
  join public.partners p on p.id = pr.id
  join auth.users u on u.id = pr.id
  where pr.status = 'pending_otp'
    and u.email_confirmed_at is not null;
  if v_ramase is not null then
    raise exception 'Parteneri cu emailul confirmat rămași în pending_otp: %', v_ramase;
  end if;
end;
$$;

commit;

-- Conturile corectate la această rulare (gol la a doua rulare)
select email, partner_type, status_inainte, status_dupa
from status_parteneri_corectati
order by email;
