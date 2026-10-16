-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (16 octombrie 2026)
-- Rolul de partener în profiles.roles pentru toți partenerii (pasul 10b)
-- ═══════════════════════════════════════════════════════════════════
--
-- Problema (audit live, 16 oct. 2026)
--   api/public/partner-register.js creează contul cu
--   auth.admin.createUser({ app_metadata: { role } }), dar trigger-ul
--   handle_new_user() rulează la inserare, înainte ca app_metadata să fie
--   scrisă, deci pune 'client'. Accesul se decide doar din profiles.roles
--   (securitate, 14 oct. 2026), așa că partenerul primește 403 pe API-urile
--   de partener / furnizor.
--   Azi (citire live): contact@homebestpal.ro (Home Best Pal,
--   furnizor_materiale, aprobat) are roles = {client}. Ceilalți doi parteneri
--   (servicii_tehnice) au deja rolul corect.
--
-- Ce face
--   Pentru fiecare rând din partners: adaugă în profiles.roles rolul
--   corespunzător lui partner_type, dacă lipsește. Nu șterge alte roluri
--   (un client care devine partener le păstrează pe amândouă).
--   profiles.role devine rolul de partener doar dacă acum e 'client' (sau gol).
--   Harta e aceeași ca în lib/roluri-partener.js (verificată de
--   scripts/test-roluri-partener.js):
--     servicii_tehnice   → partener_servicii
--     furnizor_materiale → partener_materiale
--     inchirieri_utilaje → partener_inchirieri
--     curier_utilitara   → partener_curier
--     asigurari          → partener_asigurari
--
-- Ce NU face
--   Nu modifică handle_new_user() (codul scrie rolul explicit după
--   createUser) și nu schimbă profiles.status.
--
-- Ordine de aplicare
--   Oricând: codul din branch-ul acces-cont-partener nu depinde de ea, doar
--   repară conturile create înainte de el.
--
-- Cum se aplică
--   O singură tranzacție, rulabilă de mai multe ori (a doua rulare nu mai
--   găsește nimic de corectat). Verificarea de la final oprește tranzacția
--   dacă un partener rămâne fără rolul lui. Ultimul select arată conturile
--   corectate la această rulare.
-- ═══════════════════════════════════════════════════════════════════

begin;

drop table if exists pg_temp.roluri_parteneri_corectate;
create temp table roluri_parteneri_corectate (
  id uuid, email text, partner_type text, rol_adaugat text, roles_inainte text[], roles_dupa text[]
) on commit preserve rows;

with harta (partner_type, rol) as (
  values
    ('servicii_tehnice',   'partener_servicii'),
    ('furnizor_materiale', 'partener_materiale'),
    ('inchirieri_utilaje', 'partener_inchirieri'),
    ('curier_utilitara',   'partener_curier'),
    ('asigurari',          'partener_asigurari')
),
de_corectat as (
  select pr.id, pr.email, p.partner_type::text as partner_type, h.rol,
         coalesce(pr.roles, '{}'::text[]) as roles_inainte
  from public.partners p
  join harta h on h.partner_type = p.partner_type::text
  join public.profiles pr on pr.id = p.id
  where not (h.rol = any (coalesce(pr.roles, '{}'::text[])))
     or pr.role is null or pr.role in ('', 'client')
),
actualizate as (
  update public.profiles pr
  set roles = case when d.rol = any (d.roles_inainte) then d.roles_inainte
                   else array_append(d.roles_inainte, d.rol) end,
      role  = case when pr.role is null or pr.role in ('', 'client') then d.rol else pr.role end
  from de_corectat d
  where pr.id = d.id
  returning pr.id, pr.roles
)
insert into roluri_parteneri_corectate (id, email, partner_type, rol_adaugat, roles_inainte, roles_dupa)
select d.id, d.email, d.partner_type, d.rol, d.roles_inainte, a.roles
from de_corectat d join actualizate a on a.id = d.id;

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
declare
  v_lipsa text;
begin
  select string_agg(coalesce(pr.email, p.id::text), ', ') into v_lipsa
  from public.partners p
  left join public.profiles pr on pr.id = p.id
  where p.partner_type::text in ('servicii_tehnice', 'furnizor_materiale', 'inchirieri_utilaje', 'curier_utilitara', 'asigurari')
    and (pr.id is null or not (
      case p.partner_type::text
        when 'servicii_tehnice'   then 'partener_servicii'
        when 'furnizor_materiale' then 'partener_materiale'
        when 'inchirieri_utilaje' then 'partener_inchirieri'
        when 'curier_utilitara'   then 'partener_curier'
        when 'asigurari'          then 'partener_asigurari'
      end = any (coalesce(pr.roles, '{}'::text[]))));
  if v_lipsa is not null then
    raise exception 'Parteneri fără rolul lor în profiles.roles: %', v_lipsa;
  end if;

  if exists (select 1 from public.partners p join public.profiles pr on pr.id = p.id where pr.role = 'client') then
    raise exception 'Un partener are încă profiles.role = client';
  end if;
end;
$$;

commit;

-- Conturile corectate la această rulare (gol la a doua rulare)
select email, partner_type, rol_adaugat, roles_inainte, roles_dupa
from roluri_parteneri_corectate
order by email;
