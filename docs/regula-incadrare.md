# Regula de încadrare a serviciilor / The service classification rule

*Pasul 8, 15 oct. 2026 — decizie LM. Sursa regulilor: registrul `My_Darrin_aliniere_meniu_NACE_ESCO_Uniclass_retete.xlsx`, foaia „Reguli”.*
*Step 8, 15 Oct 2026 — LM's decision. Source of the rules: the workbook `My_Darrin_aliniere_meniu_NACE_ESCO_Uniclass_retete.xlsx`, sheet "Reguli".*

Documentul de referință pentru back-office, pentru pasul 9 (asistentul din back-office) și pentru oricine creează servicii. Codul: `lib/ruta-incadrare.js` (regulile), `lib/propune-reteta.js` (rețeta propusă), `api/admin/ruta-incadrare.js` (API), `docs/migrations-propuse/2026-10-15_ruta_incadrare.sql` (schema).

The reference for the back-office, for step 9 (the back-office wizard) and for anyone creating services. Code: `lib/ruta-incadrare.js` (the rules), `lib/propune-reteta.js` (the proposed recipe), `api/admin/ruta-incadrare.js` (API), `docs/migrations-propuse/2026-10-15_ruta_incadrare.sql` (schema).

---

## Română

### 1. Ruta de încadrare

Orice serviciu ajunge în catalog pe același drum, în aceeași ordine:

`Secțiune NACE → Diviziune → Grupă → Clasă NACE (= cod CAEN Rev. 3) → Capitol de meniu → Nod de meniu → Ocupație ESCO → Uniclass → Rețetă → Prețuri → Publicare`

Fiecare pas se alege doar din opțiunile compatibile cu pasul anterior (acțiunea `pasi` din API). Un serviciu se publică doar dacă ruta e validă (acțiunea `publica`).

**Adminul dedicat.** Superadminul numește pentru un domeniu un admin de catalog: un rând în `admin_permissions` cu `sectiune = 'catalog_servicii'`, `poate_scrie = true`, `sectiune_specializata` = codul capitolului (`F`, `N`…), o listă (`F,N`) sau `*` pentru toate, și opțional `tara_cod`. Acesta poate crea servicii și rețete, le poate publica și le poate așeza în meniu, dar **numai pe o rută validă** și numai în capitolele lui. Fără rând: acces refuzat (403).

**Fără rețetă.** Adminul pornește de la un serviciu asemănător (aceeași clasă NACE, aceeași grupă sau elemente comune) și îi copiază ruta și fluxul (`cauta_asemanatoare`, apoi `copiaza_din`), sau cere o rețetă propusă automat (punctul 5).

### 2. Regulile

1. Capitolul (nivelul 1) urmează secțiunea / diviziunea NACE Rev. 2.1 a serviciului.
2. Nodul (nivelul 2) = o clasă NACE Rev. 2.1 = același cod CAEN Rev. 3. Nume comercial în RO și EN; codul nu se afișează public.
3. Serviciul (nivelul 3) = rețeta: denumirea comercială, legată de articole de deviz sau de o rețetă manuală.
4. ESCO = ocupația care face lucrarea (cod ESCO cu punct, de exemplu `7126.8`), nu o grupă ISCO și nu un cod COR.
5. Uniclass = activitate (`Ac_`) pentru servicii, produs (`Pr_`) pentru materiale; codul trebuie să existe.
6. Produsele nu sunt servicii: merg la Aprovizionare (furnizori, discount 5–15%).
7. Proiectarea (71.11 / 71.12 / 74.13) stă la Proiectare, chiar când e despre instalații.
8. Un nod fără servicii active în țara clientului se ascunde automat.
9. Fiecare capitol are tipul de partener și regula de bani: servicii 100% din manoperă; curierat / transport fără discount; furnizori, închirieri, asigurări discount 5–15%.
10. Meniul Acasă (Urgențe / Proiecte / Materiale și închirieri) e doar o scurtătură spre aceleași noduri.

### 3. Cele 11 capitole

| Cod | Capitol | NACE | Partener | Discount |
|---|---|---|---|---|
| F | Construcții și renovări | 41, 42, 43 | servicii | nu |
| N | Proiectare și servicii tehnice | 71, 74.13 | servicii | nu |
| O81 | Curățenie și spații verzi | 81 | servicii | nu |
| T | Reparații pentru casă, auto și moto | 95 | servicii | nu |
| AGR | Servicii agricole | 01.61, 33.12, 77.31 | servicii | nu |
| H | Transport, mutări și curierat | 49, 53 | curier | nu |
| E | Moloz și deșeuri | 38 | servicii | nu |
| O77 | Închirieri | 77 (fără 77.31) | închirieri | da |
| G | Aprovizionare materiale | 23.63, 46, 47 | materiale | da |
| L | Asigurări | 65, 66 | asigurări | da |
| O78 | Personal calificat | 78 | personal | nu |

Capitolul se calculează din clasa NACE: **clasele explicite au prioritate față de diviziuni** (77.31 → AGR, nu O77; 74.13 → N), diviziunile față de secțiuni.

### 4. Validarea rutei

**Erori — blochează publicarea:**

| Cod | Regula |
|---|---|
| E1 | Clasa NACE nu există în `nace_reference` (Rev. 2.1, 4 cifre). |
| E2 | Clasa NACE a serviciului ≠ `nace_clasa` a nodului (sau serviciul nu are nod). |
| E3 | Capitolul nodului ≠ capitolul calculat din NACE. |
| E4 | ESCO lipsește sau nu e de tip `esco` (grupă ISCO sau cod COR). |
| E5 | Codul Uniclass nu există în `uniclass_codes`, e retras (`is_active = false`; mesajul dă înlocuitorul din `inlocuit_de`, dacă există) sau e din tabelul greșit (serviciu fără `Ac_`, material fără `Pr_`). |
| E6 | Un produs publicat drept serviciu. |
| E7 | Niciun nivel cu preț activ într-o țară și nicio rețetă calculabilă. O rețetă propusă, neaprobată, nu dă preț. |
| E8 | Lipsește titlul în RO sau în EN (EN: `traduceri.en.titlu`, după migrarea 2026-10-10). |
| E9 | Discount pe un capitol cu `discount_permis = false`. |

**Avertismente — publicarea cere confirmare (`confirm_avertismente: true`):**

| Cod | Regula |
|---|---|
| A1 | Ocupația ESCO are alt `nace_code` decât serviciul (comparat la nivel de diviziune, după normalizarea `F 43.21` / `4321` / `43.21`). |
| A2 | Un articol al rețetei are un indicator din altă clasă NACE. |
| A3 | Nodul cere o autorizare (`autorizare_necesara`, de exemplu ANRE), iar serviciul n-o menționează. |
| A4 | Titlul seamănă cu un serviciu existent (posibil duplicat). |

### 5. Rețeta propusă automat

Când un serviciu n-are rețetă, sistemul **propune** una, ca ciornă (`retete_propuse`, `stare = 'propusa'`). Nu se publică și nu intră în preț până n-o aprobă adminul dedicat.

1. **Articole existente:** din indicatorii cu aceeași clasă NACE (dacă se potrivesc și cu titlul), din rețetele serviciilor asemănătoare din aceeași clasă NACE și din indicatorii tipici activității Uniclass. Indicatorii `E*` și `RPI*` din normele românești n-au cod NACE sau Uniclass, așa că legătura activitate → indicatori e explicită în `lib/propune-reteta.js` și **trebuie confirmată de LM**:
   - `Ac_10_40_27` (instalații electrice): `EF` tablouri, `EC` cabluri, `EA` tuburi de protecție, `EH` probe și verificări;
   - `Ac_10_40_63` / `Ac_10_40_67` (conducte, sanitare): `RPIC`, `RPID`, `RPIE`.
2. **Manoperă:** resurse `F` cu aceeași ocupație ESCO, altfel din aceeași grupă ESCO (de exemplu „Instalator electrician”, `7411.1`).
3. **Ce lipsește din normele românești:** linii `resursa_noua`, cu cod Uniclass `Pr_` și **fără cantitate și fără preț**. Pentru fotovoltaice: module (`Pr_60_70_65_63`), structură de montaj (`Pr_20_85_32_80`), ancore de acoperiș (`Pr_80_77_27_72`; `Pr_20_29_03_78` a fost retras de NBS în 2023-01), protecție la supratensiune c.c. (`Pr_65_72_27_62`), invertor, punere în funcțiune (`Ac_70_65`). Sistemul: `Ss_70_10_70_35`, scris pe articolul rețetei aprobate.
4. Fiecare linie are un `motiv`.

Adminul decide fiecare linie (`decide_linie`: acceptă, modifică cantitatea sau resursa, respinge). `aproba_reteta` trece doar dacă nicio linie nu e în așteptare și fiecare linie acceptată are cantitate. La aprobare se creează un articol nou sub indicatorul `MDR`, legat de nivel, cu rețeta lui; resursele noi primesc `sursa_catalog = 'catalog_nou_2026'`, ca rețetele manuale existente. Resursele noi fără tarif nu primesc preț inventat: prețul serviciului rămâne „la cerere” până se completează tariful.

**Uniclass 2026.** LM încarcă toate cele 15 tabele Uniclass 2015, ediția NBS ianuarie 2026 (19.084 de coduri). După import, `uniclass_codes` are în plus `versiune`, `inlocuit_de`, `retras_in`, iar `title_ro` e opțional: titlul se afișează din `title_ro`, cu rezervă pe `title_en`. Până la import (azi: 27 de coduri), codurile propuse care lipsesc rămân pe linia rețetei (`cod_uniclass`) și se scriu pe resursă doar când sunt active în `uniclass_codes` (cheie externă).

### 5b. Ciornele sunt private

O ciornă (`stare` ≠ `publicat`) nu se citește public: după migrare, citirea publică (cheia `anon`) e permisă doar pentru serviciile cu `status_public = true` și, prin ele, pentru nivelurile și prețurile lor. Nu există scriere directă din browser în `catalog_servicii`, `catalog_niveluri`, `catalog_preturi`: totul trece prin `api/admin/*`.

### 5c. Ordinea de aplicare

1. Merge în `main` (codul merge și fără migrare).
2. `docs/migrations-propuse/2026-10-10_traduceri_catalog.sql` (titlul EN al serviciului, regula E8).
3. `docs/migrations-propuse/2026-10-15_ruta_incadrare.sql` (se oprește dacă lipsește pasul 2).

Invers nu: aplicată înainte de merge, migrarea ar bloca crearea de servicii din codul vechi (`status_public = true` cu `stare` implicit `ciorna`).

### 6. Două scenarii

**A. „Reparat calorifer” — există un serviciu asemănător.** `cauta_asemanatoare` întoarce primul „Reparație / Recondiționare calorifer” (43.22, rețeta `RPIB03A`). Ruta: F → 43 → 43.2 → 43.22 → nodul „Instalații sanitare, termice și climatizare” → ESCO `7127.1` → Uniclass `Ac_10_40_63`. Adminul copiază serviciul (`copiaza_din`: nod, ESCO, Uniclass, niveluri fără prețuri, rețeta ca variantă nouă), completează titlul EN și prețurile, validează și publică. Validarea dă și A4 (titlu asemănător): adminul confirmă că e un serviciu distinct sau renunță.

**B. „Montaj panouri fotovoltaice cu instalație și punere în funcțiune” — fără rețetă.** NACE 43.21 (Eurostat: „photovoltaic systems on buildings”) → capitolul F → nodul „Instalații electrice” → ESCO `7411.1.4` (tehnician energie solară) → Uniclass `Ac_10_40_27` (instalare); punerea în funcțiune (`Ac_70_65`) e o linie a rețetei. `cauta_asemanatoare` sugerează „Montaj tablou electric pe instalație nouă” (`EF04A1`) și „Testare & verificare instalație electrică” (`EH05B1`). `propune_reteta` dă articole `EF`, `EC`, `EA`, `EH`, manoperă `7411.1` și resursele noi de la punctul 5. Validarea: A3 (autorizare ANRE) și E7 până la aprobarea rețetei și completarea prețurilor. Un parc fotovoltaic la sol ar fi 42.22 (alt nod): pus sub 43.21, dă E2.

---

### 7. Furnizorul propriu

Decizia LM (16 oct. 2026): **Home Best Pal SRL (CUI RO46577229)** e furnizorul real al platformei pentru **materiale și închirieri**. HBP SRL e și entitatea platformei din România (cea căreia îi facturează partenerii). Contul de furnizor propriu este **contact@homebestpal.ro** (partener `furnizor_materiale`, aprobat; decizia LM, 16 oct. 2026).

- Un partener e **furnizor propriu** când `partners.entitate_platforma_id` e setat (migrarea `2026-10-16_furnizor_propriu.sql`). O entitate are cel mult un cont de partener. Legătura o face superadminul: Entități juridice → „Leagă de contul de furnizor”.
- **Ce poate face în fiecare stare** (regula unică `lib/eligibilitate-partener.js`, pasul 10c): un furnizor își poate pregăti catalogul în orice stare, în afară de cont suspendat; produsele lui apar public și primește comenzi doar dacă e aprobat, cu contract semnat și cont bancar activ. Furnizorul propriu, aprobat, poate vinde fără contract și fără cont bancar de partener: nu semnează contract cu sine, iar banii intră în contul entității platformei.
- **Fără factură de partener**: furnizorul propriu nu își facturează sieși. `api/partener/facturi.js` nu îi arată alocări facturabile și refuză încărcarea unei facturi.
- **Fără discount**: nu i se aplică `parteneri_discounturi` (5–15%) și nici procentul implicit din panou. La escrow, rândul lui rămâne cu suma întreagă, `discount_pct_aplicat = 0`, `discount_sursa = 'furnizor_propriu'`.
- **Prețul final**: costul materialului sau al închirierii intră în prețul clientului, cu formula publică (cost de bază + asigurare + comision + marketing + mentenanță + TVA, din `backoffice_config`), facturat de entitatea platformei din țara comenzii. Prețurile de referință din norme nu se folosesc ca prețuri de vânzare.
- **Produsele din marketplace** (`marketplace_materiale`, `marketplace_echipamente`) au furnizorul pe produs; la comandă, `addon_materiale_selectate` păstrează `furnizor_id`, iar escrow-ul înregistrează suma pe acel furnizor. Un furnizor extern rămâne ca azi (discountul lui, factura lui).
- **Ruta produselor la import** (aceeași regulă ca la servicii, `valideazaRutaProdus` din `lib/ruta-incadrare.js`):
  - materiale: clasa NACE din capitolul `G` (de exemplu 47.52, 47.54, 46.73, 46.83, 46.84), nodul de meniu din capitolul `G` și cod Uniclass `Pr_` activ;
  - închirieri: clasa NACE din capitolul `O77` (77.11, 77.12, 77.21, 77.22, 77.32, 77.39), nodul din `O77`; un utilaj cu operator obligatoriu e un serviciu (43.99), nu o închiriere;
  - produsele importate pornesc cu `status = 'in_asteptare'` și devin `live` doar după aprobare (`api/admin/marketplace-aprobari.js`).
- Tranziție: până la pasul 10, nodurile de materiale existente nu au încă `capitol_cod` și `nace_clasa`. Un nod de tip `materiale` fără capitol e acceptat ca nod din `G`, cu avertisment; un nod cu alt capitol sau cu altă clasă NACE dă eroare. Pentru închirieri nu există încă niciun nod: se creează la pasul 10.

## English

### 1. The classification route

Every service reaches the catalogue along the same route, in the same order:

`NACE section → Division → Group → NACE class (= CAEN Rev. 3 code) → Menu chapter → Menu node → ESCO occupation → Uniclass → Recipe → Prices → Publication`

Each step only offers the options compatible with the previous step (the API's `pasi` action). A service is published only if the route is valid (the `publica` action).

**The dedicated admin.** The superadmin appoints a catalogue admin for a domain: a row in `admin_permissions` with `sectiune = 'catalog_servicii'`, `poate_scrie = true`, `sectiune_specializata` = the chapter code (`F`, `N`…), a list (`F,N`) or `*` for all, and optionally `tara_cod`. This admin can create services and recipes, publish them and place them in the menu, but **only along a valid route** and only in their own chapters. With no row: access denied (403).

**No recipe.** The admin starts from a similar service (same NACE class, same group, or shared elements) and copies its route and flow (`cauta_asemanatoare`, then `copiaza_din`), or asks for an automatically proposed recipe (point 5).

### 2. The rules

1. The chapter (level 1) follows the service's NACE Rev. 2.1 section / division.
2. The node (level 2) = one NACE Rev. 2.1 class = the same CAEN Rev. 3 code. Commercial name in RO + EN; the code is hidden from the public.
3. The service (level 3) = the recipe: the commercial name, linked to estimate items or to a manual recipe.
4. ESCO = the occupation that does the work (an ESCO code with a dot, e.g. `7126.8`), not an ISCO group and not a COR code.
5. Uniclass = activity (`Ac_`) for services, product (`Pr_`) for materials; the code must exist.
6. Products are not services: they go to Supplies (suppliers, 5–15% discount).
7. Design (71.11 / 71.12 / 74.13) sits under Design, even when it is about installations.
8. A node with no active services in the client's country is hidden automatically.
9. Each chapter carries its partner type and money rule: services 100% of labour; courier / transport no discount; suppliers, rentals, insurance 5–15% discount.
10. The Home menu (Emergencies / Projects / Materials and rentals) is only a shortcut to the same nodes.

### 3. The 11 chapters

| Code | Chapter | NACE | Partner | Discount |
|---|---|---|---|---|
| F | Construction and renovation | 41, 42, 43 | services | no |
| N | Design and technical services | 71, 74.13 | services | no |
| O81 | Cleaning and green spaces | 81 | services | no |
| T | Home, car and motorcycle repairs | 95 | services | no |
| AGR | Agricultural services | 01.61, 33.12, 77.31 | services | no |
| H | Transport, removals and courier | 49, 53 | courier | no |
| E | Rubble and waste | 38 | services | no |
| O77 | Rentals | 77 (except 77.31) | rentals | yes |
| G | Material supplies | 23.63, 46, 47 | materials | yes |
| L | Insurance | 65, 66 | insurance | yes |
| O78 | Skilled staff | 78 | staff | no |

The chapter is computed from the NACE class: **explicit classes take priority over divisions** (77.31 → AGR, not O77; 74.13 → N), divisions over sections.

### 4. Route validation

**Errors — block publication:**

| Code | Rule |
|---|---|
| E1 | The NACE class does not exist in `nace_reference` (Rev. 2.1, 4 digits). |
| E2 | The service's NACE class ≠ the node's `nace_clasa` (or the service has no node). |
| E3 | The node's chapter ≠ the chapter computed from NACE. |
| E4 | ESCO missing or not of type `esco` (an ISCO group or a COR code). |
| E5 | The Uniclass code does not exist in `uniclass_codes`, is withdrawn (`is_active = false`; the message gives the replacement from `inlocuit_de`, if any) or is from the wrong table (service without `Ac_`, material without `Pr_`). |
| E6 | A product record published as a service. |
| E7 | No level with an active price in any country and no computable recipe. A proposed, unapproved recipe gives no price. |
| E8 | The RO or EN title is missing (EN: `traduceri.en.titlu`, after the 2026-10-10 migration). |
| E9 | A discount on a chapter with `discount_permis = false`. |

**Warnings — publication requires confirmation (`confirm_avertismente: true`):**

| Code | Rule |
|---|---|
| A1 | The ESCO occupation has a different `nace_code` than the service (compared at division level, after normalising `F 43.21` / `4321` / `43.21`). |
| A2 | A recipe item has an indicator with a different NACE class. |
| A3 | The node requires an authorisation (`autorizare_necesara`, e.g. ANRE) and the service does not mention it. |
| A4 | The title resembles an existing service (possible duplicate). |

### 5. The automatically proposed recipe

When a service has no recipe, the system **proposes** one, as a draft (`retete_propuse`, `stare = 'propusa'`). It is not published and not used for pricing until the dedicated admin approves it.

1. **Existing items:** from the indicators with the same NACE class (if they also match the title), from the recipes of similar services in the same NACE class, and from the indicators typical of the Uniclass activity. The `E*` and `RPI*` indicators in the Romanian norms have no NACE or Uniclass code, so the activity → indicators link is explicit in `lib/propune-reteta.js` and **must be confirmed by LM**:
   - `Ac_10_40_27` (electrical installation): `EF` panels, `EC` cables, `EA` protective conduits, `EH` tests and checks;
   - `Ac_10_40_63` / `Ac_10_40_67` (pipework, plumbing): `RPIC`, `RPID`, `RPIE`.
2. **Labour:** `F` resources with the same ESCO occupation, otherwise from the same ESCO group (e.g. "Instalator electrician", `7411.1`).
3. **What the Romanian norms lack:** `resursa_noua` lines, with a `Pr_` Uniclass code and **no quantity and no price**. For photovoltaics: modules (`Pr_60_70_65_63`), mounting frame (`Pr_20_85_32_80`), roof anchors (`Pr_80_77_27_72`; `Pr_20_29_03_78` was withdrawn by NBS in 2023-01), d.c. surge protection (`Pr_65_72_27_62`), inverter, commissioning (`Ac_70_65`). The system: `Ss_70_10_70_35`, written on the approved recipe item.
4. Each line has a `motiv` (reason).

The admin decides each line (`decide_linie`: accept, edit the quantity or resource, reject). `aproba_reteta` goes through only if no line is pending and every accepted line has a quantity. On approval, a new item is created under the `MDR` indicator, linked to the level, with its recipe; new resources get `sursa_catalog = 'catalog_nou_2026'`, like the existing manual recipes. New resources without a rate get no invented price: the service price stays "on request" until the rate is filled in.

**Uniclass 2026.** LM loads all 15 Uniclass 2015 tables, NBS January 2026 edition (19,084 codes). After the import, `uniclass_codes` also has `versiune`, `inlocuit_de`, `retras_in`, and `title_ro` becomes optional: the title is shown from `title_ro`, falling back to `title_en`. Until the import (today: 27 codes), proposed codes that are missing stay on the recipe line (`cod_uniclass`) and are written to the resource only when they are active in `uniclass_codes` (foreign key).

### 5b. Drafts are private

A draft (`stare` ≠ `publicat`) cannot be read publicly: after the migration, public reads (the `anon` key) are allowed only for services with `status_public = true` and, through them, for their levels and prices. There is no direct browser write to `catalog_servicii`, `catalog_niveluri`, `catalog_preturi`: everything goes through `api/admin/*`.

### 5c. Order of application

1. Merge into `main` (the code works without the migration too).
2. `docs/migrations-propuse/2026-10-10_traduceri_catalog.sql` (the service's EN title, rule E8).
3. `docs/migrations-propuse/2026-10-15_ruta_incadrare.sql` (it stops if step 2 is missing).

Not the other way round: applied before the merge, the migration would block service creation by the old code (`status_public = true` with `stare` defaulting to `ciorna`).

### 6. Two scenarios

**A. "Reparat calorifer" — a similar service exists.** `cauta_asemanatoare` returns "Reparație / Recondiționare calorifer" first (43.22, recipe `RPIB03A`). Route: F → 43 → 43.2 → 43.22 → node "Plumbing, heating and air conditioning" → ESCO `7127.1` → Uniclass `Ac_10_40_63`. The admin copies the service (`copiaza_din`: node, ESCO, Uniclass, levels without prices, the recipe as a new variant), fills in the EN title and the prices, validates and publishes. Validation also gives A4 (similar title): the admin confirms it is a distinct service, or drops it.

**B. "Montaj panouri fotovoltaice cu instalație și punere în funcțiune" — no recipe.** NACE 43.21 (Eurostat: "photovoltaic systems on buildings") → chapter F → node "Electrical installations" → ESCO `7411.1.4` (solar energy technician) → Uniclass `Ac_10_40_27` (installation); commissioning (`Ac_70_65`) is a recipe line. `cauta_asemanatoare` suggests "Montaj tablou electric pe instalație nouă" (`EF04A1`) and "Testare & verificare instalație electrică" (`EH05B1`). `propune_reteta` gives `EF`, `EC`, `EA`, `EH` items, `7411.1` labour and the new resources in point 5. Validation: A3 (ANRE authorisation) and E7 until the recipe is approved and the prices are filled in. A ground-mounted solar farm would be 42.22 (another node): placed under 43.21, it gives E2.

### 7. Own supplier

LM's decision (16 Oct 2026): **Home Best Pal SRL (CUI RO46577229)** is the platform's real supplier for **materials and rentals**. HBP SRL is also the platform's entity in Romania (the one partners invoice). The own-supplier account is **contact@homebestpal.ro** (partner `furnizor_materiale`, approved; LM's decision, 16 Oct 2026).

- A partner is the **own supplier** when `partners.entitate_platforma_id` is set (migration `2026-10-16_furnizor_propriu.sql`). An entity has at most one partner account. The superadmin makes the link: Legal entities → "Link to the supplier account".
- **What it can do in each state** (the single rule `lib/eligibilitate-partener.js`, step 10c): a supplier can prepare its catalogue in any state except a suspended account; its products appear publicly and it receives orders only if it is approved, with a signed contract and an active bank account. The approved own supplier can sell without a contract and without a partner bank account: it does not sign a contract with itself, and the money goes into the platform entity's account.
- **No partner invoice**: the own supplier does not invoice itself. `api/partener/facturi.js` shows it no invoiceable allocations and refuses an invoice upload.
- **No discount**: neither `parteneri_discounturi` (5–15%) nor the panel's default percentage applies. At escrow, its row keeps the full amount, `discount_pct_aplicat = 0`, `discount_sursa = 'furnizor_propriu'`.
- **Final price**: the cost of the material or rental goes into the client's price, with the public formula (base cost + insurance + commission + marketing + maintenance + VAT, from `backoffice_config`), invoiced by the platform entity of the order's country. The reference prices from the norms are not used as selling prices.
- **Marketplace products** (`marketplace_materiale`, `marketplace_echipamente`) carry their supplier; on an order, `addon_materiale_selectate` keeps `furnizor_id`, and escrow records the amount against that supplier. An external supplier works as today (its discount, its invoice).
- **Product route on import** (the same rule as services, `valideazaRutaProdus` in `lib/ruta-incadrare.js`):
  - materials: a NACE class from chapter `G` (e.g. 47.52, 47.54, 46.73, 46.83, 46.84), a menu node from chapter `G` and an active `Pr_` Uniclass code;
  - rentals: a NACE class from chapter `O77` (77.11, 77.12, 77.21, 77.22, 77.32, 77.39), a node from `O77`; machinery with a mandatory operator is a service (43.99), not a rental;
  - imported products start with `status = 'in_asteptare'` and become `live` only after approval (`api/admin/marketplace-aprobari.js`).
- Transition: until step 10, the existing material nodes do not yet have `capitol_cod` and `nace_clasa`. A `materiale` node with no chapter is accepted as a `G` node, with a warning; a node with another chapter or another NACE class gives an error. There is no rental node yet: it is created in step 10.
