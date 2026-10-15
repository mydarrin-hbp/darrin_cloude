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
| E5 | Codul Uniclass nu există în `uniclass_codes` sau e din tabelul greșit (serviciu fără `Ac_`, material fără `Pr_`). |
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
3. **Ce lipsește din normele românești:** linii `resursa_noua`, cu cod Uniclass `Pr_` și **fără cantitate și fără preț**. Pentru fotovoltaice: module, structură de montaj, ancore de acoperiș, protecție la supratensiune c.c., invertor, punere în funcțiune.
4. Fiecare linie are un `motiv`.

Adminul decide fiecare linie (`decide_linie`: acceptă, modifică cantitatea sau resursa, respinge). `aproba_reteta` trece doar dacă nicio linie nu e în așteptare și fiecare linie acceptată are cantitate. La aprobare se creează un articol nou sub indicatorul `MDR`, legat de nivel, cu rețeta lui; resursele noi primesc `sursa_catalog = 'catalog_nou_2026'`, ca rețetele manuale existente. Resursele noi fără tarif nu primesc preț inventat: prețul serviciului rămâne „la cerere” până se completează tariful.

**De știut (15 oct. 2026):** `uniclass_codes` are doar 27 de coduri. `Ac_70_65` și codurile `Pr_` propuse pentru fotovoltaice nu sunt încă acolo; rămân pe linia rețetei (`cod_uniclass`), iar pe resursă se scriu doar după ce LM le adaugă (cheie externă).

### 6. Două scenarii

**A. „Reparat calorifer” — există un serviciu asemănător.** `cauta_asemanatoare` întoarce primul „Reparație / Recondiționare calorifer” (43.22, rețeta `RPIB03A`). Ruta: F → 43 → 43.2 → 43.22 → nodul „Instalații sanitare, termice și climatizare” → ESCO `7127.1` → Uniclass `Ac_10_40_63`. Adminul copiază serviciul (`copiaza_din`: nod, ESCO, Uniclass, niveluri fără prețuri, rețeta ca variantă nouă), completează titlul EN și prețurile, validează și publică. Validarea dă și A4 (titlu asemănător): adminul confirmă că e un serviciu distinct sau renunță.

**B. „Montaj panouri fotovoltaice cu instalație și punere în funcțiune” — fără rețetă.** NACE 43.21 (Eurostat: „photovoltaic systems on buildings”) → capitolul F → nodul „Instalații electrice” → ESCO `7411.1.4` (tehnician energie solară) → Uniclass `Ac_10_40_27` (instalare); punerea în funcțiune (`Ac_70_65`) e o linie a rețetei. `cauta_asemanatoare` sugerează „Montaj tablou electric pe instalație nouă” (`EF04A1`) și „Testare & verificare instalație electrică” (`EH05B1`). `propune_reteta` dă articole `EF`, `EC`, `EA`, `EH`, manoperă `7411.1` și resursele noi de la punctul 5. Validarea: A3 (autorizare ANRE) și E7 până la aprobarea rețetei și completarea prețurilor. Un parc fotovoltaic la sol ar fi 42.22 (alt nod): pus sub 43.21, dă E2.

---

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
| E5 | The Uniclass code does not exist in `uniclass_codes` or is from the wrong table (service without `Ac_`, material without `Pr_`). |
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
3. **What the Romanian norms lack:** `resursa_noua` lines, with a `Pr_` Uniclass code and **no quantity and no price**. For photovoltaics: modules, mounting frame, roof anchors, d.c. surge protection, inverter, commissioning.
4. Each line has a `motiv` (reason).

The admin decides each line (`decide_linie`: accept, edit the quantity or resource, reject). `aproba_reteta` goes through only if no line is pending and every accepted line has a quantity. On approval, a new item is created under the `MDR` indicator, linked to the level, with its recipe; new resources get `sursa_catalog = 'catalog_nou_2026'`, like the existing manual recipes. New resources without a rate get no invented price: the service price stays "on request" until the rate is filled in.

**Note (15 Oct 2026):** `uniclass_codes` holds only 27 codes. `Ac_70_65` and the `Pr_` codes proposed for photovoltaics are not there yet; they stay on the recipe line (`cod_uniclass`) and are written to the resource only once LM adds them (foreign key).

### 6. Two scenarios

**A. "Reparat calorifer" — a similar service exists.** `cauta_asemanatoare` returns "Reparație / Recondiționare calorifer" first (43.22, recipe `RPIB03A`). Route: F → 43 → 43.2 → 43.22 → node "Plumbing, heating and air conditioning" → ESCO `7127.1` → Uniclass `Ac_10_40_63`. The admin copies the service (`copiaza_din`: node, ESCO, Uniclass, levels without prices, the recipe as a new variant), fills in the EN title and the prices, validates and publishes. Validation also gives A4 (similar title): the admin confirms it is a distinct service, or drops it.

**B. "Montaj panouri fotovoltaice cu instalație și punere în funcțiune" — no recipe.** NACE 43.21 (Eurostat: "photovoltaic systems on buildings") → chapter F → node "Electrical installations" → ESCO `7411.1.4` (solar energy technician) → Uniclass `Ac_10_40_27` (installation); commissioning (`Ac_70_65`) is a recipe line. `cauta_asemanatoare` suggests "Montaj tablou electric pe instalație nouă" (`EF04A1`) and "Testare & verificare instalație electrică" (`EH05B1`). `propune_reteta` gives `EF`, `EC`, `EA`, `EH` items, `7411.1` labour and the new resources in point 5. Validation: A3 (ANRE authorisation) and E7 until the recipe is approved and the prices are filled in. A ground-mounted solar farm would be 42.22 (another node): placed under 43.21, it gives E2.
