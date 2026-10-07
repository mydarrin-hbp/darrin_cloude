# Rețetă de preț, pasul 2–3: asigurare inclusă, discounturi parteneri, escrow pe discount

Branch: `pret-reteta-pas2` → `main`

## Ce schimbă

**Prețul către client** (`lib/calculeaza-pret.js`)
- Costurile fixe de manoperă se adună o singură dată pe meserie.
- Asigurarea e inclusă în preț: 1% din costul de bază, configurabil (`asigurari.cost_asigurare_pct`); devizul o primește automat când clientul nu o trimite.
- Comisionul platformei se calculează pe costul de bază, nu pe subtotal.
- Procentele din panou se citesc pe țară, cu `ALL` ca valoare implicită.

**Discounturile partenerilor** (decizie LM, 7 octombrie 2026)
- Furnizorii de materiale, închirieri și asigurări acordă Home Best Pal un discount negociat, între 5% și 15% (limite în `backoffice_config`, verificate în API și în trigger).
- Partenerul își propune discountul din dashboard (`api/partener/discounturi.js`); back-office-ul îl setează, îl aprobă sau îl dezactivează (`api/admin/discounturi-parteneri.js`, cu `audit_log`).
- Discountul nu e vizibil clientului și nu apare în API-urile publice.

**Eliberarea escrow-ului** (`lib/elibereaza-escrow.js`)
- Discountul partenerului înlocuiește reținerea fixă de 15%. Furnizorul primește preț public × (1 − discount%). Ordinea surselor: factura partenerului → profilul partenerului → procentul din panou.
- Fiecare rând din `comanda_subcontractori` păstrează procentul aplicat și sursa lui.
- Asigurarea fără asigurător partener devine rând `rezerva_daune` la Home Best Pal (nu e venit). Cu asigurător, se reține discountul lui sau comisionul de intermediere, în `comisioane.comision_retinut_asigurari`.
- Calea legacy rămâne neschimbată.

**`backoffice_config` unic pe (cheie, țară)**
- Citirile pe o singură cheie filtrează pe `tara_cod = 'ALL'`.
- `api/admin/email-gateway.js` face upsert pe `cheie,tara_cod`. Azi, în producție, salvarea numelui expeditorului eșuează, pentru că `UNIQUE(cheie)` nu mai există.

## Ordinea de lansare

Migrările sunt în `docs/migrations-propuse/` și nu sunt aplicate. Ordinea contează: fiecare pas depinde de cel dinainte.

| # | Pas | De ce în această ordine |
|---|---|---|
| 1 | `2026-10-07_backoffice_config_unic_pe_tara.sql` | Pașii 2 și 3 inserează și citesc pe `(cheie, tara_cod)`. În producție schimbarea pare deja făcută direct; migrarea e idempotentă și nu schimbă nimic acolo. |
| 2 | `2026-10-07_escrow_discount_aplicat.sql` | Adaugă coloanele pe care codul nou le scrie la eliberarea escrow-ului (`discount_pct_aplicat`, `discount_sursa`, `comision_retinut_asigurari`) și `rezerva_daune` în check-ul `rol_tip`. Fără ea, orice eliberare de escrow eșuează. |
| 3 | `2026-10-06_parteneri_discounturi.sql` | Creează `discount_categorii`, `parteneri_discounturi`, limitele 5–15% și coloanele de discount pe `facturi_parteneri`. Până atunci escrow-ul cade pe procentul din panou (testat). |
| 4 | Deploy cod (merge în `main`) | Doar după ce 1–3 sunt aplicate și verificate. |

### Înainte de pasul 4
- [ ] `select conname from pg_constraint where conrelid = 'public.backoffice_config'::regclass;` arată `backoffice_config_cheie_tara_key` și nu `backoffice_config_cheie_key`.
- [ ] `comanda_subcontractori` are `discount_pct_aplicat` și `discount_sursa`; `comisioane` are `comision_retinut_asigurari`.
- [ ] `backoffice_config` are `discount_partener_min_pct = 5` și `discount_partener_max_pct = 15` (rânduri `ALL`).
- [ ] `discount_categorii` e populată (de stabilit cu LM), altfel partenerii nu pot salva discounturi.

### După deploy
- [ ] O eliberare de escrow pe o comandă de test: suma rândurilor + total reținut = `suma_totala_platita`.
- [ ] Salvarea numelui expeditorului din back-office (Email Gateway) merge.

## Rămâne deschis
- Factura partenerului e legată de `comanda_subcontractori`, care se creează abia la eliberarea escrow-ului. Sursa `factura` devine activă doar când partenerii vor factura înainte de eliberare.
- Un rând de escrow nu are categorie de produs. Dacă partenerul are discounturi pe mai multe categorii, se aplică cel mai mic. De confirmat cu LM.
- Plata dosarelor de daună din rezervă nu e încă implementată; rezerva doar se înregistrează.
- Dashboard-ul admin (`api/admin/dashboard-stats.js`) numără ca venit doar `comision_platforma`, fără reținerile de la furnizori și asigurători.
- Contractul-cadru partener afișează procentele din panou ca reținere fixă; după decizia LM, ele sunt doar valoarea implicită când partenerul nu are discount.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
