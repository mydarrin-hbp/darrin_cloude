# My Darrin — step 11a: audit and implementation plan (16 Oct 2026)

*(English version; `2026-10-16_audit_plan_RO.md` has the same content.)*

- Branch: `audit-11a`, created from `main` at `8c5de07` (merge of PR #19 `anaf-url`, step 10d).
- Type: audit only. No code, page, text or data was changed. Nothing was written to Supabase.
- Sources: the code on `main` (file and line for every finding), the figures read live by LM on 16 Oct and the public APIs of the production site (https://mydarrin.homebestpal.com), GET only.
- Where something could not be verified, it says "not verified" and why.

Severity: **critical** = wrong money, exposed data or a core function that does not work; **major** = false or missing information for a client / partner, or a business rule that is not applied; **minor** = appearance, wording, consistency.

---

## 1. Summary (one page)

*(Filled in at the end, after the 7 points.)*

---

## 2. The 7 points

### 2.1 Minimum order value, by country and currency

#### Current state (with evidence)

**Server (source of truth)**
- `lib/calculeaza-pret.js:120-128` — `citestePragMinimComanda(tara)` reads `tax_configurations.prag_minim_comanda`; if the value is missing, it returns `VMC_FALLBACK = 100` (`lib/calculeaza-pret.js:52`), **in any currency** (100 GBP, 100 EUR, 100 MDL just like 100 RON).
- `lib/calculeaza-pret.js:247-251` — `pret_final = max(subtotal + platform fees + VAT, threshold)`. The client pays the threshold; the order is not stopped.
- `api/comenzi/creeaza.js:421` — the non-itemised path: `suma_totala_platita = max(valoare_totala, threshold)`, where `valoare_totala` comes from the request body.
- `api/comenzi/creeaza.js:349-411` — an order has a single type: a service level (`nivel_id`), marketplace products (`produse_marketplace`) or the old path (`cost_*` / `valoare_totala`). The threshold applies to each order separately.
- The threshold is edited in superadmin → Accountancy (`mydarrin-superadmin.html:4037`, `:4088`, `:4171`; `api/accountancy.js:82-91`), with the placeholder "implicit 100" (default 100).

**What is stored on the order and where the top-up goes**
- The order stores the components (`suma_manopera`, `suma_materiale`, …, `tva_suma`) calculated **before** the threshold, and `suma_totala_platita` **after** it (`api/comenzi/creeaza.js:349-411`). The difference (threshold − price) has no column of its own.
- `lib/elibereaza-escrow.js:169-185` — the platform retains commission + marketing + maintenance + `tva_suma`; the top-up to the threshold is allocated to nobody (neither partner nor platform) and has no VAT calculated separately.
- `lib/genereaza-proforma-pdf.js:181-192` — the pro forma shows the lines, "Subtotal", "TVA" and "TOTAL DE PLATĂ = suma_totala_platita". When the threshold applies, Subtotal + VAT ≠ Total and no line explains the difference.
- Verified from the code only; no real order was created (rule: do not write to Supabase).

**What the client sees**

| Place | What it shows | Evidence |
|---|---|---|
| Service page, pilot mode (level with a recipe) | "Minimum order value applied: X", only once the threshold has been applied, with the amount from the server | `mydarrin-produs.html:4482-4486`, `api/public/calculeaza-pret-nivel.js:90-98` (`prag_aplicat`) |
| Service page, old path (no recipe) | "Below MOV (100 Lei) → minimum of 100 Lei applied automatically", threshold hard-coded as `const VMC = 100`, plus `PLATFORM_PCT = 0.31`, `ZONE_PCT = 1.05`, insurance 85 / 165 Lei | `mydarrin-produs.html:1725-1726`, `:2109`, `:3514-3523`, `:4749-4775` |
| `/mydarrin-catalog` | "Min. 100 Lei · +5% zonă" / "Min. 50 Lei · +5% zonă" on ~27 cards written in the HTML; `VMC_MAP = {RON:100, EUR:25, MDL:400}`; `vmcMap = {servicii:100, materiale:50, inchiriere:100}` | `mydarrin-catalog.html:2304-3281`, `:6467`, `:6526-6527`, `:6851-6855` |
| Marketplace (`mydarrin-marketplace-materiale.html`) | The unit price "VAT included", no threshold; on "Order" the server returns `pret_final` with the threshold, and checkout shows the total directly, without mentioning the threshold | `mydarrin-marketplace-materiale.html:251-280`, `api/public/marketplace-produse.js:183-198` |
| Checkout (`mydarrin-checkout.html`) | Only the total (`cfg.total`); no mention of the threshold | `mydarrin-checkout.html:3300-3307`, `:3322-3376` |
| Multi-service cart (`mydarrin-cos.html`) | The sum of the prices; each item becomes a separate order, so the threshold applies **to each item** | `mydarrin-cos.html:184-188`, `:221-285`; `api/client/cos-multi.js:7-11` |

**The currency shown**
- `format-currency.js:25-27` — the default currency is `RON` when the caller does not pass one; formatting always uses `ro-RO`.
- `mydarrin-produs.html:4688-4690` (`fmtCurrency(suma)`), `mydarrin-checkout.html:3305` and `mydarrin-cos.html:112-114` do not pass the currency → they show "Lei" for every country.
- The server knows the currency (`api/public/calculeaza-pret-nivel.js:64-65`, `api/public/marketplace-produse.js:194`), but the pages do not use it.
- `mydarrin-checkout.html:3082-3086` — exchange rates hard-coded (`RON:1, MDL:5, EUR:0.2, GBP:0.17, BGN:0.39`) for the `.dyn-price` elements.
- Live (GET `/api/public/tari-active`, 16 Oct): checkout is active in **6 countries**: RO, AT, BG, GR, GB, MD. The `prag_minim_comanda` values per country are not public — **not verified** (no public API returns them). If the value is empty for AT / BG / GR / GB / MD, 100 in the country's currency applies.

**A cart with products from different suppliers**
- Marketplace: the "Order" button sends a single product (`mydarrin-marketplace-materiale.html:262-275`); a cart with several products does not exist yet on the public page. The API accepts up to 50 products in one order (`api/comenzi/creeaza.js:162-170`), and escrow splits by supplier (`lib/elibereaza-escrow.js:76-94`), so the threshold would apply once to the whole order.
- Live (GET `/api/public/marketplace-produse?tip=materiale` and `?tip=echipamente`): 0 public products today, so the behaviour cannot be seen live — **not verified live**.
- The multi-service cart (`mydarrin-cos.html`) creates one order per item: a client with three small services pays the threshold three times.

#### Problems

| # | Problem | Severity |
|---|---|---|
| 1.1-a | The top-up to the threshold is not stored, has no VAT calculated and is not allocated in escrow; the pro forma shows Subtotal + VAT ≠ Total | **critical** |
| 1.1-b | The `VMC_FALLBACK = 100` fallback applies in any currency (6 countries with active checkout); it contradicts the 10b rule "no fallback values in code" | **critical** |
| 1.1-c | The client is not told before paying: checkout and the marketplace do not say the threshold was applied, nor how much it is | **major** |
| 1.1-d | The multi-service cart applies the threshold to each item (separate orders) | **major** |
| 1.1-e | Invented thresholds on pages: `VMC = 100`, `VMC_MAP`, "Min. 50 Lei", "+5% zonă", `PLATFORM_PCT = 0.31`, insurance 85 / 165 Lei | **major** |
| 1.1-f | The currency shown is always "Lei" (pages do not pass the currency); hard-coded exchange rates in checkout | **major** |
| 1.1-g | The non-itemised path accepts `valoare_totala` from the client (protected only by the threshold) | **major** (integrity; linked to 1.3) |
| 1.1-h | The `ZONA_INDISPONIBILA` message in `api/comenzi/creeaza.js:189-193` is in Romanian only, without diacritics | minor |

#### Decisions for LM

1. **Below the threshold:** (a) the client pays the threshold (today) or (b) the order is blocked until it reaches the threshold, with a clear message ("Add X more to be able to order").
   - (a) requires: a separate line on the pro forma / invoice ("top-up to the minimum value"), with VAT, and an escrow allocation rule (recommendation: platform revenue, as a separate line).
   - (b) is simpler for tax and more transparent; it needs a message in the cart, checkout and marketplace.
   - Recommendation: **(b)**, because it needs no new invoice line and creates no revenue without a service behind it.
2. **One threshold per country (today) or one per currency.** Today each country has a single currency (`tax_configurations.moneda`). Recommendation: **one threshold per country**, in the country's currency, until a country actually accepts several currencies.
3. **No threshold configured:** (a) checkout is stopped for that country until the threshold is filled in (recommended, like the percentages in 10b) or (b) no threshold (0).
4. **The multi-service cart:** threshold per order (today, so per item) or per whole cart. Depends on the "one combined order with a single escrow" decision (today: separate orders, decision of 30 Aug).

#### The plan

**Database (proposed migration)**
- `docs/migrations-propuse/YYYY-MM-DD_prag_minim_comanda.sql`: if LM picks (a), new columns on `comenzi`: `suma_completare_prag numeric(12,2) not null default 0` and `tva_completare_prag numeric(12,2) not null default 0`. If LM picks (b), no new columns are needed.
- Final check: the list of countries with `checkout_activ = true` and `prag_minim_comanda is null` (must be 0 once filled in from superadmin).

**Back-end**
- `lib/calculeaza-pret.js`: remove `VMC_FALLBACK`; missing threshold → `EroareConfigPret` (`tax_configurations.prag_minim_comanda`), as for VAT.
- Option (b): `aplicaFormulaPret` returns `sub_prag: true` and `lipsa_pana_la_prag`; `api/comenzi/creeaza.js` refuses with `400 SUB_PRAG_MINIM` (RO + EN message); `api/public/calculeaza-pret-nivel.js` and `api/public/marketplace-produse.js` (POST) return the same fields.
- Option (a): `aplicaFormulaPret` returns `completare_prag` and its VAT; it is stored on the order; `lib/elibereaza-escrow.js` adds it to `platformaRetine`; `lib/genereaza-proforma-pdf.js` shows it as its own line.
- `api/comenzi/creeaza.js:421`: the non-itemised path — to be closed together with the catalogue clean-up (1.3), once every service has a recipe.
- The `ZONA_INDISPONIBILA` message in RO + EN.

**Front-end**
- A single shared "minimum order" element (in `ui-comun.js` or a new file), fed from the server response: on the service page, the marketplace, the cart and checkout, with the currency received from the server.
- `format-currency.js`: no default `RON` currency; every call passes the currency received from the server; formatting follows the active language.
- Remove the hard-coded thresholds and percentages from `mydarrin-produs.html` (old path) and `mydarrin-catalog.html` (`VMC_MAP`, `vmcMap`, "+5% zonă", the hand-written cards — linked to 1.5), and the exchange rates from `mydarrin-checkout.html:3082`.
- `mydarrin-cos.html`: the threshold text per item or per cart, depending on decision 4.

**Content (RO + EN)**
- New texts in `i18n/en/mydarrin-produs.json`, `mydarrin-checkout.json`, `mydarrin-cos.json`, `mydarrin-marketplace-materiale.json`; the error message in `lib/i18n.js` if it appears in an email.
- The pages that mention "VMC" / "MOV" (`i18n/en/mydarrin-cum-functioneaza.json:56`, `i18n/en/mydarrin-investitori.json:122`) — wording aligned with the decision (see 1.2).

**Tests**
- `scripts/test-pret-config.js`: missing threshold → `CONFIG_PRET_LIPSA`; below the threshold → (a) top-up + correct VAT or (b) `SUB_PRAG_MINIM`.
- New pro forma test: Subtotal + VAT = Total in every case.
- Escrow test: allocated + retained = `suma_totala_platita`.
- The Romanian detector in EN on the changed pages (0).
