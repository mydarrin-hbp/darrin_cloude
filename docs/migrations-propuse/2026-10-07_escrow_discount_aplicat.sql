-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (7 octombrie 2026)
-- Escrow: discountul partenerului înlocuiește reținerea fixă de 15%
-- ═══════════════════════════════════════════════════════════════════
--
-- Decizia LM (7 octombrie 2026)
--   Plata din escrow către furnizorul de materiale / închirieri = preț
--   public × (1 − discount%). Discountul vine, în ordine, din factura
--   partenerului (salvat la emitere), din profilul partenerului
--   (parteneri_discounturi) sau, dacă lipsesc, din procentul din panou.
--   lib/elibereaza-escrow.js (aplicaDiscounturiParteneri) salvează pe
--   fiecare rând procentul aplicat și sursa lui.
--
-- Ordine de aplicare
--   Se aplică ÎNAINTE de deploy-ul codului care scrie aceste coloane
--   (altfel insert-ul din elibereazaEscrow eșuează), după
--   2026-10-06_parteneri_discounturi.sql.
-- ═══════════════════════════════════════════════════════════════════

alter table public.comanda_subcontractori
  add column if not exists discount_pct_aplicat numeric(5,2),
  add column if not exists discount_sursa       text;

alter table public.comanda_subcontractori
  add constraint comanda_subcontractori_discount_sursa_check
  check (discount_sursa is null or discount_sursa in ('factura', 'profil_partener', 'implicit_panou'));

comment on column public.comanda_subcontractori.discount_pct_aplicat is
  'Procentul reținut de Home Best Pal din prețul public la eliberarea escrow-ului. Intern — nu se expune clientului.';
comment on column public.comanda_subcontractori.discount_sursa is
  'De unde vine discount_pct_aplicat: factura | profil_partener | implicit_panou.';

-- Procentele din panou devin valoarea implicită, folosită doar când
-- furnizorul nu are discount (descrierea veche era și inversată).
update public.backoffice_config
set eticheta = 'Discount implicit — Furnizori Materiale (%)',
    descriere = 'Procentul reținut de Home Best Pal din prețul public al materialelor când furnizorul nu are un discount negociat activ. Furnizorul primește restul.'
where cheie = 'comision_bricolaj_contractat_pct';

update public.backoffice_config
set eticheta = 'Discount implicit — Furnizori Închirieri (%)',
    descriere = 'Procentul reținut de Home Best Pal din prețul public al închirierii când furnizorul nu are un discount negociat activ. Furnizorul primește restul.'
where cheie = 'comision_inchiriere_contractat_pct';

-- ── Asigurarea (decizie LM, 7 octombrie 2026) ────────────────────
-- Fără asigurător partener, suma de asigurare rămâne la Home Best Pal ca
-- rezervă de daune: rând separat cu rol_tip = 'rezerva_daune' (actor_id
-- null). Nu e venit, nu intră în comisioane.comision_platforma; din ea se
-- plătesc dosarele de daună (dosare_dauna).
alter table public.comanda_subcontractori
  drop constraint if exists comanda_subcontractori_rol_tip_check;
alter table public.comanda_subcontractori
  add constraint comanda_subcontractori_rol_tip_check
  check (rol_tip = any (array['manopera', 'materiale', 'rental_echipament', 'curier', 'asigurare',
                              'ajutor', 'transportator', 'specialist', 'rezerva_daune']));

-- Cu asigurător partener: ce reține Home Best Pal din prima lui (discountul
-- negociat sau comision_intermediere_pct din panou), separat de comisionul
-- platformei, la fel ca reținerile pe materiale și închirieri.
alter table public.comisioane
  add column if not exists comision_retinut_asigurari numeric not null default 0;
