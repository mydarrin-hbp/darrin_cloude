-- ═══════════════════════════════════════════════════════════════════
-- PROPUNERE PENTRU REVIEW — NU SE APLICĂ ÎNCĂ (pasul 11-A, 17 oct. 2026)
-- backoffice_config: termenul de plată către partener
-- ═══════════════════════════════════════════════════════════════════
--
-- Ce face
--   Adaugă cheia `termen_plata_partener_zile` = 6, secțiunea `pricing`,
--   tara_cod = 'ALL', editabilă de superadmin în panoul „Comisioane &
--   Tarifare” (câmpul „Plata către parteneri”, mydarrin-superadmin.html).
--
-- Sursa valorii
--   Decizia LM B3 (17 oct. 2026, docs/decizii/2026-10-17_decizii_LM_RO.md):
--   partenerul primește plata în cel mult 6 zile de la ziua în care suma
--   devine eliberabilă (după confirmarea lucrării, explicită sau tacită
--   după 24 h). Configurabil din back-office.
--
-- Cine o citește
--   /api/public/reguli-platforma (rândul ALL și, peste el, rândul țării, dacă
--   există), pentru textele publice („Primești plata în cel mult 6 zile de la
--   eliberarea sumei”). Fără această cheie, textele rămân ascunse — nu există
--   valoare de rezervă în cod.
--
-- Siguranță
--   O singură tranzacție; rulabilă de mai multe ori: `on conflict do nothing`
--   nu șterge și nu modifică niciun rând existent (nici această cheie, dacă a
--   fost deja schimbată din panou). Nu atinge alte chei. Presupune
--   constrângerea UNIQUE (cheie, tara_cod) din
--   2026-10-07_backoffice_config_unic_pe_tara.sql (deja în producție).
-- ═══════════════════════════════════════════════════════════════════

begin;

insert into public.backoffice_config (cheie, valoare, tip, sectiune, eticheta, descriere, unitate, editabil_de, tara_cod)
values
  ('termen_plata_partener_zile', '6', 'number', 'pricing',
   'Termen de plată către partener (zile de la eliberarea sumei)',
   'Numărul maxim de zile în care partenerul primește plata, socotit de la ziua în care suma devine eliberabilă (după confirmarea lucrării, explicită sau tacită). Afișat pe paginile publice prin /api/public/reguli-platforma. Sursa: decizia LM B3, 17 oct. 2026.',
   'zile', 'superadmin', 'ALL')
on conflict (cheie, tara_cod) do nothing;

-- ═══ VERIFICARE ═══════════════════════════════════════════════════
do $$
declare
  v_valoare text;
begin
  select valoare into v_valoare
  from public.backoffice_config
  where cheie = 'termen_plata_partener_zile' and tara_cod = 'ALL';
  if v_valoare is null then
    raise exception 'Cheia termen_plata_partener_zile (ALL) lipsește din backoffice_config';
  end if;
  if v_valoare !~ '^[0-9]+$' or v_valoare::int < 1 then
    raise exception 'Cheia termen_plata_partener_zile (ALL) are o valoare nevalidă: %', v_valoare;
  end if;
end;
$$;

commit;

-- Rândul creat sau existent (după commit):
select cheie, valoare, tip, sectiune, eticheta, unitate, editabil_de, tara_cod
from public.backoffice_config
where cheie = 'termen_plata_partener_zile'
order by tara_cod;
