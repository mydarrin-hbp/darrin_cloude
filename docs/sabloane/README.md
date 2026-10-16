# Șabloane de import — lista de prețuri Home Best Pal / Import templates — the Home Best Pal price list

*(16 oct. 2026, pasul 10a / 16 Oct 2026, step 10a)*

| Fișier / File | Ce conține / What it holds |
|---|---|
| `import-hbp-materiale.csv`, `import-hbp-materiale_EN.csv` | materiale → `marketplace_materiale` / materials |
| `import-hbp-inchirieri.csv`, `import-hbp-inchirieri_EN.csv` | închirieri → `marketplace_echipamente` / rentals |

Numele coloanelor sunt aceleași în ambele limbi (sunt chei tehnice); diferă doar textul rândului-exemplu. / Column names are the same in both languages (they are technical keys); only the sample row text differs.

## Română

Rândul `EXEMPLU` arată formatul și **se șterge** înainte de import; câmpurile `<…>` se completează din lista de prețuri HBP. Nicio cifră nu se inventează.

**Materiale** (`tip = materiale`):

| Coloană | Obligatoriu | Regulă |
|---|---|---|
| `cod_produs_furnizor` | da | codul HBP; un rând cu același cod se actualizează (nu se dublează) |
| `denumire_produs` | da | 3–200 de caractere |
| `descriere` | da | 100–1.000 de caractere |
| `descriere_pret` | da | de exemplu „Preț per bucată” |
| `unitate_masura` | da | buc, m, m², kg, sac… |
| `pret_fara_tva` | da | număr > 0, din lista HBP; prețurile de referință din norme nu se folosesc |
| `cota_tva` | nu | dacă e dată, trebuie să fie cota țării (RO: 21) |
| `moneda` | da | o monedă activă (RON) |
| `stoc_disponibil`, `lead_time_zile` | nu | numere; 0 dacă lipsesc |
| `nod_menu` | da | slug-ul nodului din `categorii` (de exemplu `robinete-colectoare`); nod de materiale / capitolul G |
| `nace_cod` | da | clasă din capitolul G: 47.52, 47.54, 46.73, 46.83, 46.84… |
| `cod_uniclass` | da | cod `Pr_` activ (Uniclass 2015, ediția ianuarie 2026) |
| `imagine_url_1` … `imagine_url_6` | `imagine_url_1` da | imagini urcate întâi în platformă (`marketplace-media`) |
| `ambalaj`, `specificatii_tehnice`, `este_consumabil` | nu | |
| `cui_furnizor` | la importul din back-office | `RO46577229`; contul de furnizor importă doar pentru sine |
| `denumire_en`, `descriere_en`, `descriere_pret_en` | nu (recomandat) | textele în engleză, pentru pagina publică în engleză (`traduceri.en`, după aplicarea migrării `2026-10-16_furnizor_propriu.sql`); fără ele, produsul apare în română |

**Închirieri** (`tip = echipamente`): aceleași reguli, cu `tarif_zi` (obligatoriu, fără TVA), `tarif_ora` și `tarif_saptamana` (opționale), `buc_disponibile`, `operator_inclus` (`fara_operator` sau `cu_operator_optional`; `operator_obligatoriu` e un serviciu, NACE 43.99, nu o închiriere), `nace_cod` din capitolul O77 (77.11, 77.12, 77.21, 77.22, 77.32, 77.39), `nod_menu` din O77, `cod_uniclass` opțional (dacă e dat: `Pr_` activ). Unitatea e ziua.

**Ce se întâmplă la import**
- Fiecare rând trece prin validarea produsului și prin ruta de încadrare (`lib/ruta-incadrare.js`, `valideazaRutaProdus`).
- Rândurile fără preț, descriere sau imagine, sau cu rută greșită, **nu se importă**: apar în raport cu rândul, câmpul și mesajul (RO și EN).
- Produsele importate pornesc cu `status = 'in_asteptare'`; devin `live` doar după aprobare.
- Până la pasul 10, nodurile de materiale existente nu au capitol și clasă NACE: sunt acceptate ca noduri din G, cu avertisment. Pentru închirieri nu există încă niciun nod.

## English

The `EXAMPLE` row shows the format and **is deleted** before import; the `<…>` fields are filled in from the HBP price list. No figure is invented.

**Materials** (`tip = materiale`):

| Column | Required | Rule |
|---|---|---|
| `cod_produs_furnizor` | yes | the HBP code; a row with the same code is updated (not duplicated) |
| `denumire_produs` | yes | 3–200 characters |
| `descriere` | yes | 100–1,000 characters |
| `descriere_pret` | yes | e.g. "Price per piece" |
| `unitate_masura` | yes | buc, m, m², kg, sac… |
| `pret_fara_tva` | yes | number > 0, from the HBP list; the reference prices from the norms are not used |
| `cota_tva` | no | if given, it must be the country's rate (RO: 21) |
| `moneda` | yes | an active currency (RON) |
| `stoc_disponibil`, `lead_time_zile` | no | numbers; 0 when missing |
| `nod_menu` | yes | the node slug in `categorii` (e.g. `robinete-colectoare`); a materials / chapter G node |
| `nace_cod` | yes | a class from chapter G: 47.52, 47.54, 46.73, 46.83, 46.84… |
| `cod_uniclass` | yes | an active `Pr_` code (Uniclass 2015, January 2026 edition) |
| `imagine_url_1` … `imagine_url_6` | `imagine_url_1` yes | images uploaded to the platform first (`marketplace-media`) |
| `ambalaj`, `specificatii_tehnice`, `este_consumabil` | no | |
| `cui_furnizor` | when importing from the back office | `RO46577229`; the supplier account imports only for itself |
| `denumire_en`, `descriere_en`, `descriere_pret_en` | no (recommended) | the English texts, for the public page in English (`traduceri.en`, once the migration `2026-10-16_furnizor_propriu.sql` is applied); without them, the product shows in Romanian |

**Rentals** (`tip = echipamente`): the same rules, with `tarif_zi` (required, excl. VAT), `tarif_ora` and `tarif_saptamana` (optional), `buc_disponibile`, `operator_inclus` (`fara_operator` or `cu_operator_optional`; `operator_obligatoriu` is a service, NACE 43.99, not a rental), `nace_cod` from chapter O77 (77.11, 77.12, 77.21, 77.22, 77.32, 77.39), `nod_menu` from O77, `cod_uniclass` optional (if given: an active `Pr_`). The unit is the day.

**What happens on import**
- Every row goes through product validation and the classification route (`lib/ruta-incadrare.js`, `valideazaRutaProdus`).
- Rows without a price, description or image, or with a wrong route, **are not imported**: they appear in the report with the row, the field and the message (RO and EN).
- Imported products start with `status = 'in_asteptare'`; they become `live` only after approval.
- Until step 10, the existing material nodes have no chapter and NACE class: they are accepted as G nodes, with a warning. There is no rental node yet.
