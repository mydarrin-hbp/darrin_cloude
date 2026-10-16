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

---

### 2.2 Presentation and conversion pages

#### The reference model (today)
- Home Best Pal SRL (CUI 46577229) is the general contractor and sells integrated services on demand. **Real ANAF data:** main CAEN code **4120** (construction of buildings). The open decision "the company's CAEN code: 41.00 / 43.xx vs 43.60" stays with LM; the pages never mention the code, and the "Antreprenor General Digital" (Digital General Contractor) positioning (`despre-noi.html:1242`, `afla-ce-facem.html:1241`, `cum-comanzi.html:917`) is compatible with 4120.
- 0% commission on labour, 100% to the partner.
- Public price = the back-office formula, with configurable percentages.
- Materials / rental suppliers (and insurers, `lib/discount-partener.js:19`, LM decision of 7 Oct) give a 5–15% discount; couriers do not (`lib/discount-partener.js:22-24`); HBP is the own supplier, with no discount and no partner invoice.
- A partner sells and receives orders only if approved, with a signed contract and a bank account (the 10c rule).
- The minimum order value (2.1).

**Real data for comparison** (live GET, 16 Oct): `/api/public/statistici-homepage` → `clienti_activi: 12`, `parteneri_verificati: 2`, `devize_ai_luna: 0`; `/api/public/tari-active` → checkout active in RO, AT, BG, GR, GB, MD; `/api/public/marketplace-produse` → 0 public products; `/api/public/pitch-deck` → no approved version (the page's fallback content is shown).

#### Problems common to all pages

| # | Finding | Where (examples) | Severity |
|---|---|---|---|
| 1.2-T1 | **"Escrow" / "amount blocked" / "card pre-authorised" / "guaranteed payment"**, but the only accepted payment method is a bank transfer, with no processor (`api/comenzi/creeaza.js:114-130`), and the order blocks no amount (the comment at `api/comenzi/creeaza.js:345-347`) | `mydarrin-cum-functioneaza.html:2451`, `cum-devii-operator-inchirieri.html:940`, `ghidul-asiguratorului.html:1264-1265`, `mydarrin-devino-partener.html:768`, `cum-devii-partenerul-nostru.html:2132-2133` | **critical** |
| 1.2-T2 | The countries "RO · MD · DE · FR · BG" — live they are RO, AT, BG, GR, GB, MD | `mydarrin-cum-functioneaza.html:2472`, `cum-devii-furnizor-materiale.html:936`, `ghidul-asiguratorului.html:1345`, `:1481`, `mydarrin-investitori.html:568`, the form at `mydarrin-marketplace.html:1408-1410` | **major** |
| 1.2-T3 | "Payment within 5 working days at most" — no rule in the code; a figure with no source | `mydarrin-cum-functioneaza.html:1242`, `cum-devii-furnizor-materiale.html:958`, `intrebari-frecvente-parteneri.html:993`, `ghidul-asiguratorului.html:1340`, `mydarrin-marketplace.html:1469`, `:1498`, `cum-devii-curier-de-cartier.html:954` | **major** (LM decision: the real term) |
| 1.2-T4 | The mobile app: the footer says "coming soon", other pages present it as existing ("Available on iOS & Android", "Install the Courier app", "App … Mandatory") | `cum-devii-partenerul-nostru.html:2158`, `cum-devii-curier-de-cartier.html:951`, `mydarrin-devino-partener.html:1392` (JS) | **major** |
| 1.2-T5 | SMS notifications promised; there is no SMS provider in `api/` or `lib/` | `cum-devii-partenerul-nostru.html:1982`, `:2038` | **major** |
| 1.2-T6 | The 10c rule (approval + signed contract + bank account) is missing from every presentation page except `mydarrin-devino-partener.html` (which asks for a contract and an IBAN) | all pages in the list | **major** |
| 1.2-T7 | The minimum order value is explained nowhere; `mydarrin-cum-functioneaza.html:1522` has in JS `vmcByCountry = {RON:'100 Lei', EUR:'25 EUR', MDL:'400 MDL', BGN:'40 BGN'}` and `vmc = 100` (`:1551`) | — | **major** |
| 1.2-T8 | "Darrin AI" promises: "checks documents instantly / automatically", "quote in 60 seconds", "AI picks the nearest supplier with stock". In the code, documents and partners are approved by an admin (`api/admin/verifica-document.js`); the rest — **not verified** | `mydarrin-devino-partener.html:722`, `:754`, `:761`, `:809`, `mydarrin-marketplace.html:1465` | **major** |
| 1.2-T9 | The account activation time: "48 hours" (FAQ, become-a-partner) vs "24h" (marketplace); neither is a rule in the code | `intrebari-frecvente-parteneri.html:923`, `mydarrin-devino-partener.html:724`, `mydarrin-marketplace.html:1437`, `:1444`, `:1457` | minor |
| 1.2-T10 | The footer: "© 2026 · Home Best Pal – UK · RO"; the contracting entity is Home Best Pal SRL (RO) | e.g. `cum-devii-furnizor-materiale.html:1216`, `mydarrin-cum-functioneaza.html:2732` | minor (LM decision) |
| 1.2-T11 | Newsletter: "weekly promotions" — **not verified** that they exist | the shared footer | minor |

#### Page by page

**`mydarrin-cum-functioneaza.html`**
- It does not say that Home Best Pal is the general contractor, it does not explain the price formula, nor 0% on labour (that only appears in the shared block at `:2885`). **major**
- `:2457` "No human intervention in dispatching" — when no partner is found, the order goes to the admin (`lib/notificari-comanda.js`, `notificaAdminFaraPartener`). minor
- `:2472` "VAT auto-detected from IP" — VAT follows the country of the order address (`mydarrin-produs.html:4391-4392`, `tva-config.js`). minor
- `:2477` "Guarantee … valid 6–36 months depending on the level" — no verified source. major

**`cum-devii-partenerul-nostru.html`**
- `:1278-1781` the list of services is hand-written (plumbing, joinery, appliances …), it does not come from the catalogue and the classification route. **major** (linked to 1.3 and step 11)
- `:1920`, `:2147-2148` "emergency rates configured separately in the back office" — **not verified** that such a rate exists.
- `:2026` "The materials have already been delivered by the My Darrin supplier before you arrive" — no flow guarantees this. major
- `:2132-2133` "card blocked" (1.2-T1), `:2158` the app (1.2-T4), `:1982`, `:2038` SMS (1.2-T5).
- Correct: `:2055-2067` 100% of the accepted amount, platform costs paid by the client.

**`cum-devii-furnizor-materiale.html`**
- `:914` "reach thousands of clients" — live: 12 active clients. **major**
- `:923-924`, `:955` delivery by Neighbourhood Couriers with "cargo insurance included" — **not verified**; there is no cargo policy in the code.
- `:977` returns within 48h — there is no return flow in the code. major
- `:984` different prices per country "from the supplier portal" — products have `moneda`, but **not verified** in the dashboard.
- Missing: the 10c rule, the feed / API integration (see 1.6).

**`cum-devii-operator-inchirieri.html`**
- `:940` "The amount is pre-authorised before delivery" (1.2-T1). critical
- `:946`, `:977` "security deposit" — does not exist in `api/` or `lib/`. major
- `:949`, `:984` "You have 2 hours to confirm" — no rule in the code. major
- `:927-928` "Real-time booking calendar" — the panel is empty in the dashboard (see 1.7). major

**`cum-devii-curier-de-cartier.html`**
- `:925-927` "Daily transfer / Daily payment" contradicts `:954` "payment within 5 working days at most" on the same page. major
- `:926` "distance bonus + rating bonus", `:931` "Maximum radius 15 km" (vs "we recommend max 5 km", `mydarrin-devino-partener.html:1563`, and the 5–100 km slider in `cum-devii-partenerul-nostru.html:1811`), `:951` a 30-minute course, `:958` "Android 8+ / iOS 13+" — no source. major
- Correct: the courier gives no discount (no discount is mentioned).

**`ghidul-asiguratorului.html`**
- `:1264-1265` "Card blocked, not charged … pre-authorised" (1.2-T1). critical
- `:1296-1298`, `:1405`, `:1417` limits of "€5,000" and "€10,000"; checkout says "up to 5,000 Lei" (`mydarrin-checkout.html:1557`). Figures with no source and contradictory. **major**
- `:1270`, `:1300`, `:1407-1425` "settlement within 7 days" — no source. major
- `:1325` "the request is sent to all insurers at once" — **not verified**; there is no integrated insurer today.
- Correct against the code: the insurer's discount (5–15%) is in `lib/discount-partener.js:19`.

**`intrebari-frecvente-parteneri.html`**
- `:1014` "If the client does not confirm within 48h … the system confirms automatically" — the code has **24h** (`api/cron/auto-confirma-comenzi.js:20`, `FEREASTRA_TACITA_ORE = 24`). **major**
- `:944` "The first 3 orders are monitored … rating ≥4.5★ → Verified partner" — does not exist in the code. major
- `:930` "ANRGN for gas installers" — the current authority is ANRE. minor
- Correct: `:1000` (0% on labour), `:958` (allocation + email + dashboard).

**`mydarrin-devino-partener.html`**
- `:768` "The client pays in full when placing the order. The amount is blocked in Escrow" (1.2-T1). critical
- `:691-696` "Automatic ASF reporting", "Own branding" — **not verified**. major
- `:735` "Dedicated support in the first 30 days" — **not verified**. minor
- JS `:1384` "Urgent +30%", `:1564` "+30%", `:1565` "+20% rate" — coefficients with no source. major
- Correct and aligned: `:775` (0% on labour, 5–15% discount), `:782` (the partner invoices Home Best Pal SRL, the general contractor), `:1553`, `:1983` (courier 0%).

**`mydarrin-marketplace.html`**
- `:1304-1306` "Main supplier: ACA BG · Bacău · CUI 32667674" — a real company presented as the main supplier; the own supplier is HBP, and live there is no public product. The same name appears on cards in `mydarrin-catalog.html:2866`, `:2902`, `:3010`, `:3087` and in `i18n/en/mydarrin-dashboard-furnizor.json:122`. **critical** (LM decision: is there an agreement with ACA BG?)
- `:1341`, `:1359-1365`, `:1594-1646` "WooCommerce · Shopify verified", "Verified compatible", "My Darrin plugin", "Set up in 10 minutes", "Shopify App Store" — there is no supplier integration at all (see 1.6). **critical** (a false promise to suppliers)
- `:1630` "PrestaShop ⏳ Q3 2026" — a date in the past; `:1638` "Q4 2026". major
- `:1342` "Stock managed in real time", `:1351` "Live availability calendar" — see 1.7. major
- `:1277` "Verified suppliers · Live" — 0 public products. minor
- The simulator (`:1530-1574`) is correctly labelled as a simulator; amounts are in Lei only. minor

**`mydarrin-marketplace-materiale.html`** (the public product list)
- The text is translated; the price is shown "VAT included"; the minimum order value is not mentioned (see 2.1). major

**`mydarrin-investitori.html`** — the most serious page
- `:1974-2141` the "KPIs Live · Updated in real time" window (opened from the button at `:1214`) shows **fixed figures written in the HTML**, presented as results: "↑ +24.7% MoM", "↑ +31% MoM", "+18% vs Q1", "NPS +68", orders Jan–Jun 2026 "312 · 401 · 518 · 634 · 800 · 1,000+", revenue by country (MD 7.7K, DE 2.9K, FR 1.4K, BG 0.4K), "Active orders now 247", "Escrow blocked: 284,000 Lei", CAC / LTV / 51% retention. Live: 12 active clients, 2 verified partners. **critical** (false information for investors)
- `:572` "Equity offered 20%" vs `:999` "12.5%" (and the pitch deck: 12.5%). **critical**
- `:1833-1841` "€25,000 · 2% equity", "€50,000 · 4%", "€100,000+ · 8%+" — at a €4,000,000 post-money, €25,000 = 0.625%, €50,000 = 1.25%, €100,000 = 2.5%. Wrong calculation. **critical**
- `:1207` "Minimum ticket €25K" vs `:1001` "Minimum investment €1,000 = 1 share". **critical**
- `:1022-1037`, `:1743-1745` "40% completed · €200,000 committed" — fixed values in the HTML, no source in the data. **critical** (LM decision: are there real commitments?)
- `:816` "Take rate: 10%" — contradicts the model (0% on labour; the commission from the back office). major
- `:956-967` TAM / SAM / SOM €180B / €12B / €120M vs the pitch deck €40B / €500M / €39.7M — no source and contradictory. major
- `:1056-1076` the allocation 40 / 25 / 20 / 15% vs the pitch deck 35 / 45 / 15 / 5%. major
- `:1129`, `:1157-1159` "ROI 20–48×" vs the pitch deck "6×–10×". major
- `:1096-1098` "Q1–Q2 2026 · Platform live in RO and MD … Done". major
- `:728` "ANAF tax 8% dividends" — a rate written in the page, with no source; the rate has changed since 2024 — to be confirmed with the accountant. major
- `:732` "Next distribution Q4 2026", `:747` buy-back "−10%", `:755` 12-month lock-up, `:1003` "12 months of runway guaranteed" — terms with no source document. major
- `:781` "Real data from Supabase" — the data comes from the RPC `get_live_investor_kpis`, called with the anon key (`mydarrin-investitori.html:1406-1427`, `:1562-1570`). The figures are **not verified** (a POST call, not GET). For LM to check: is the function `security definer` and executable by `anon`? (the CLAUDE.md rule).
- Translation: a few texts without EN ("Equity oferit", "angajat", "Take rate:"); the rest of the page is translated statically.

**`mydarrin-pitch-deck.html`** (+ `i18n/en/mydarrin-pitch-deck.json`, `api/public/pitch-deck.js`)
- The page is **public** (`middleware.js`, `PAGINI_PUBLICE`; `BARIERA_GENERALA_ACTIVA = false`), although the investors page points to a "Data Room … under NDA" (see 1.4).
- Live there is no approved version (`slides: null`), so `SLIDES_REZERVA` is shown (`:109-199`).
- Slide 8 (`:146-150`) "Traction & validation": "Validated in 7 regional hubs", "Preliminary agreements with insurers and developers" — presented as results, with no source. **critical**
- Slide 7 (`:145`) TAM €40B / SAM €500M / SOM €39.7M — no source; different from the investors page. major
- Slide 10 (`:156-158`) "Recurring SaaS subscriptions" — does not exist in the model or in the code. major
- Slide 12 (`:171`) "Guaranteed payment … real Escrow" (1.2-T1). critical
- Slides 15 and 17 are marked as projections / targets — correct.
- Translation: 132 slide texts, 12 without EN (proper names, "MY DARRIN", "Rezerve" — only "Rezerve" needs translating). An approved version from the back office (`pitch_deck_versiuni.slide_uri`) would have no EN: the table has no translation field. major (at the first approval)

#### The missing page: "How to use the marketplace" (proposal, not written)
- **File:** `cum-folosesc-marketplace.html` + `i18n/en/cum-folosesc-marketplace.json`; added to `PAGINI_PUBLICE` in `middleware.js` and to `sitemap.xml`.
- **Place in the menu:** footer → "Customer support" (next to "How to order", "How to pay"); side menu → "Catalogue / Marketplace"; a link in the header of `mydarrin-marketplace-materiale.html` ("How does it work?").
- **Content (RO + EN), by section:**
  1. What you find: materials and rentals from approved suppliers, at the public price (VAT included), sold by Home Best Pal as general contractor.
  2. How you choose: search, categories (from the classification route), quantity / rental days.
  3. On its own or with a service: a direct order or "Add to service" from the service configurator.
  4. The price: how it is built (no fixed percentages, "configured by the platform"), VAT included, the minimum order value (after the decision in 2.1).
  5. Payment: today bank transfer only; the pro forma; what escrow will mean once there is a processor (no false promises).
  6. Delivery / handover: who delivers, how you confirm receipt (`confirmare-livrare.html`).
  7. Problems and complaints: `reclamatii.html`; returns — only once LM decides the policy.
  8. A short FAQ.

#### Decisions for LM
1. **Escrow / payment:** until a processor is integrated, do all pages say "payment by bank transfer, the amount reaches Home Best Pal's account and is distributed after confirmation"? (recommended) Or do you keep "escrow" with an explanation?
2. **Payment terms to partners** (today "5 working days" with no source) and **the tacit confirmation term** (24h in the code vs 48h in the FAQ): which are the real ones?
3. **ACA BG:** is there an agreement that allows showing its name and CUI? If not, it is removed everywhere.
4. **The investors page and the pitch deck:** which are the official figures (equity, minimum ticket, allocation, TAM / SAM / SOM, ROI)? Is the "KPIs Live" window removed or tied to real data?
5. **Shop integrations** (WooCommerce, Shopify …): removed until the step from 1.6, or kept as "in preparation", without "verified"?
6. **The "Home Best Pal – UK · RO" footer:** which entities are shown?
7. **The CAEN code:** ANAF shows 4120; the "41.00 / 43.xx vs 43.60" decision stays open.

#### The plan
- **Database:** `pitch_deck_versiuni` — a `slide_uri_en jsonb` column (proposed migration), so that an approved version is bilingual.
- **Back-end:** `api/public/pitch-deck.js` returns `slide_uri_en` according to the language; `api/public/statistici-homepage` (or a new GET endpoint, with no personal data) as the single source for the figures shown (verified partners, active clients, active countries).
- **Front-end:** a shared file for the repeated blocks (active countries from `/api/public/tari-active`, terms, payment method), so that one text is no longer fixed in 10 pages; remove the fixed "KPIs Live" window from `mydarrin-investitori.html`.
- **Content (RO + EN):** rewrite the sentences in the tables above, page by page, in the same session for RO and EN (the `i18n/en/<page>.json` dictionaries); the new "How to use the marketplace" page.
- **Tests:** the Romanian detector in EN (0) on every page touched; a new test that searches the HTML for the words banned until the decision ("pre-autorizat", "card blocat", "RO · MD · DE · FR · BG", "ACA BG", "SMS"); a manual RO / EN check at 390 px and 1366 px.

---

### 2.3 The service catalogue (Romania)

#### Current state (with evidence)

**Live confirmation.** The `/mydarrin-catalog` page reads `catalog_servicii` directly through the Supabase REST API, with the anon key (`mydarrin-catalog.html:5673-5678`). I made the same read (GET, `select=*`, 16 Oct): `Content-Range: 0-225/226`. All of LM's figures are confirmed:

| Indicator | Live value | LM's figure |
|---|---|---|
| Rows | 226, all `stare = publicat`, `status_public = true` | 226 ✓ |
| By category | 88 `servicii`, 128 `materiale`, 10 `inchirieri` | ✓ |
| Test rows ("… vN") | 100, **all in `materiale`** (e.g. "Teava cupru 15mm v34", "Robinet trecere sferic 1/2 v1"), numbered v1–v100 | 100 ✓ |
| Images | 223 with none, 1 with 1–2, 2 with ≥ 3 (the only service: "Montaj Parchet Laminat", 3 images) | ✓ |
| Description ≥ 100 characters | 17 (11 services, 6 materials), all between 100 and 1,000 | 17 ✓ |
| Technical characteristics | 0; technical sheets 0; work stages 1 | 0 ✓ |
| EN translations | 0 rows with `traduceri` filled in; `/api/public/traduceri-catalog?lang=en` returns `_texte: {}` | — |
| Classification route | `nod_id` filled in: 0; `ruta_validata_la` filled in: 0 | — |
| Codes | `cod_esco`: 171; `cod_uniclass`: 159; `categorie_id`: 87 | — |
| Price computable from a recipe | 24 services (GET `/api/public/servicii-cu-reteta`); 33 services have no row in `catalog_niveluri` | — |
| `rating` | 36 rows have a 4.6–4.97 rating with no review behind it (not shown today) | — |
| **Compliant** | **0** | 0 ✓ |

- There is no country column: the catalogue is shared, the price is calculated per country (`lib/calculeaza-pret.js`).
- The anon key reads every column of the table, including internal ones (`creat_de`, `ruta_rezultat`).
- The prices of services without a recipe come from the page: `mydarrin-produs.html` has a hand-written `TIER_DB`, with fixed prices per level (`:3464`), and the old calculation path (see 2.1, 1.1-e, 1.1-g).

#### The "compliant service" criterion (proposal)
A `catalog_servicii` row with `categorie = servicii` is **compliant** if it meets every condition:
1. Title in RO and in EN (`traduceri.en.titlu`).
2. At least 3 real images (`imagini`), from real work; no generated image presented as real work.
3. A description of 100–1,000 characters, in RO and in EN.
4. Work stages (`etape_lucrare`) filled in, RO + EN.
5. Specifications (`caracteristici_tehnice` or `fise_tehnice`) filled in.
6. A price computable for RO at every active level (every `catalog_niveluri` row of the service has a priced recipe; `api/public/calculeaza-pret-nivel.js` returns `disponibil: true`).
7. A valid classification route: `nod_id` filled in, `ruta_validata_la` filled in, no errors (`lib/ruta-incadrare.js`).

The check is done in the back office (a "compliant / what is missing" column) and in a test script, not by hand.

#### The table per menu chapter
The chapter is computed from the row's NACE class, with the table in `docs/regula-incadrare.md:40-53` (explicit classes before divisions), because `nod_id` is empty everywhere and `meniu_capitole` cannot be read with the anon key.

| Chapter | Total | Real services | Test rows | Products to move to the marketplace | Services with a recipe (price computable) | Compliant |
|---|---|---|---|---|---|---|
| F — Construction and renovation | 177 | 50 | 100 | 27 | 20 | 0 |
| N — Design and technical services | 9 | 9 | 0 | 0 | 0 | 0 |
| O81 — Cleaning and green spaces | 11 | 10 | 0 | 1 | 1 | 0 |
| T — Home, car, motorcycle repairs | 7 | 6 | 0 | 1 | 1 | 0 |
| AGR — Agricultural services | 1 | 1 | 0 | 0 | 1 | 0 |
| H — Transport, removals, courier | 7 | 7 | 0 | 0 | 1 | 0 |
| E — Rubble and waste | 0 | 0 | 0 | 0 | 0 | 0 |
| O77 — Rentals | 9 | 0 | 0 | 9 | 0 | 0 |
| G — Material supplies | 0 | 0 | 0 | 0 | 0 | 0 |
| L — Insurance | 0 | 0 | 0 | 0 | 0 | 0 |
| O78 — Skilled staff | 0 | 0 | 0 | 0 | 0 | 0 |
| no NACE (`nace` empty) | 5 | 5 | 0 | 0 | 0 | 0 |
| **Total** | **226** | **88** | **100** | **38** | **24** | **0** |

Notes:
- The 38 products to move = 28 materials (non-test) + 10 rentals. Today they sit in chapters F, O81, T and O77 because they carry the service's NACE class, not the trade class (G) or the rental class (O77).
- 9 rows have no complete NACE class: 5 without NACE, 2 with only the division (`F 41`, `F 43`), 1 with the group (`N 77.1`) and 1 rental without a class. The route cannot be validated for them.
- The NACE section letter in the `nace` field is inconsistent: the same division 77 appears as `O 77.32` (6 rows) and as `N 77.32` / `N 77.39` / `N 77.1` (3 rows); in NACE Rev. 2.1, division 77 is in section N. The same for `O 81.10` / `N 81.30`. The chapter is computed correctly from the digits, but the text is to be made uniform when the route is filled in.

#### Problems

| # | Problem | Severity |
|---|---|---|
| 1.3-a | 100 test rows published, publicly visible, in the catalogue | **critical** |
| 1.3-b | 0 compliant services; 223 rows with no image; 0 with characteristics; 0 EN translations in the database (contradicts the bilingual rule) | **critical** |
| 1.3-c | 38 products (materials, rentals) in the service catalogue, left from the old model; they do not follow the "active supplier" rule (10c) and have no supplier | **major** |
| 1.3-d | The classification route is empty (`nod_id`, `ruta_validata_la`) on all 226 rows — this is also why the menu does not filter (see 1.5) | **major** |
| 1.3-e | 64 real services with no computable price (88 − 24); 33 with no level at all; for them the product page uses prices written in the code | **major** |
| 1.3-f | `rating` 4.6–4.97 on 36 rows, with no reviews — invented data (not shown today) | minor |
| 1.3-g | The anon key reads every `catalog_servicii` column | minor |

#### Decisions for LM
1. **Test rows:** permanent deletion (recommended, if they are not linked to orders) or just hidden (`stare = arhivat`).
2. **The 38 products:** re-entered as HBP products (own supplier) in the marketplace, through the templates in `docs/sabloane/`, **with prices from the HBP price list** (recommended), or deleted.
3. **Services without a recipe (64):** do they stay published "under assessment" (no price) or are they hidden until they have a recipe? Recommendation: hidden from the catalogue, visible only in the back office.
4. **Real images:** where they come from — (a) HBP photos of its own work, (b) photos from approved partners, from their portfolio, with their written consent, (c) licensed stock images, visibly marked "illustrative image". Generated images are not used as "real work". Recommendation: (a) + (b); (c) only with the label.
5. **The `rating` field:** emptied until there are real reviews.

#### The plan
**Database (proposed migrations, each in one transaction, re-runnable, with a final check)**
1. `YYYY-MM-DD_catalog_curatare_test.sql`: first lists the links of the "vN" rows (`catalog_relatii`, `catalog_niveluri`, `comenzi.addon_materiale_selectate`, `devize_articole`); then `stare = 'arhivat'`, `status_public = false`; deletion only for rows with no link at all. Check: 0 published "vN" rows.
2. `YYYY-MM-DD_catalog_produse_marketplace.sql`: after the HBP import, the 38 old products move to `arhivat`; `catalog_relatii` links → the new marketplace products (if LM wants them kept).
3. `YYYY-MM-DD_catalog_rating.sql`: `rating = null` where there are no reviews.
4. Optional: a public view `catalog_servicii_public` (only the displayed columns), and the anon key reads the view, not the table.

**Back-end**
- `api/admin/catalog.js`: the computed field "compliant / what is missing" for each service, using the criterion above; a "non-compliant" filter in the back office.
- Publishing (`stare = publicat`) refused for a non-compliant service (after decision 3).
- The HBP import through `api/marketplace/importa-csv.js` (already exists), with the own supplier.

**Front-end**
- `mydarrin-admin-catalog.html` / superadmin: the list of non-compliances per service; image upload (`api/admin/catalog-imagini.js`, already exists, max. 5) — with a minimum of 3 required for compliance.
- `mydarrin-catalog.html` and `mydarrin-produs.html`: show only published services; no prices from `TIER_DB` (linked to 2.1 and 2.5).

**Content (RO + EN)**
- For each of the 88 services: title, description, stages, specifications, in RO and EN (`traduceri.en`). The work is split by chapter (F first: 50 services, of which 20 have a recipe).
- Images, after decision 4.

**Tests**
- New script `scripts/test-catalog-conformitate.js`: applies the criterion on simulated data (each condition in turn).
- Check after the migration: 0 published "vN" rows; 0 published materials / rentals in `catalog_servicii`.
- The Romanian detector in EN on `/mydarrin-catalog` and on 3 service pages (0).

---

### 2.4 Social sharing and Open Graph

#### Current state (with evidence)

**OG / Twitter tags (52 HTML pages).** Confirmed: **27** pages have `og:image` and `twitter:card` (all 27 also have `og:title`, `og:description`).

| Group | Pages |
|---|---|
| With OG + Twitter (27) | `index`, `afla-ce-facem`, `cum-comanzi`, `cum-devii-curier-de-cartier`, `cum-devii-furnizor-materiale`, `cum-devii-operator-inchirieri`, `cum-devii-partenerul-nostru`, `cum-platesc`, `cum-prestam-livram`, `cum-programez-serviciu`, `despre-noi`, `garantii-si-asigurari`, `ghidul-asiguratorului`, `intrebari-frecvente-clienti`, `intrebari-frecvente-parteneri`, `mydarrin-app-mobile`, `mydarrin-catalog`, `mydarrin-categorie-inchirieri`, `mydarrin-categorie-materiale`, `mydarrin-categorie-servicii`, `mydarrin-cum-functioneaza`, `mydarrin-devino-partener`, `mydarrin-investitori`, `mydarrin-marketplace`, `mydarrin-produs`, `mydarrin-serviciu`, `servicii-urgente` |
| Public, **without** OG (to be added) | `mydarrin-marketplace-materiale`, `mydarrin-pitch-deck` (after the decision below), `mydarrin-contact`, `mydarrin-creeaza-deviz`, `mydarrin-cos`, `mydarrin-termeni`, `mydarrin-politica-confidentialitate`, `reclamatii` |
| Without OG, correctly so (account, payment, internal) | `mydarrin-checkout`, `confirmare-livrare`, `reset-password`, `acces-temporar`, `acord-confidentialitate`, the 3 dashboards, `mydarrin-devino-partener-wizard`, `mydarrin-admin-catalog`, `mydarrin-superadmin`, `mydarrin-backoffice-serviciu`, `mydarrin-deviz-engine`, `mydarrin-auth-schema`, `mydarrin-sync-architecture`, `mydarrin-business-model`, `mydarrin-design-system` |

**The OG image**
- 26 pages use the same Unsplash stock photo: `https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1200&q=80` (e.g. `cum-devii-furnizor-materiale.html:325`). Downloaded live: **1200 × 795**, not 1200 × 630; it is an external stock image, not a My Darrin one.
- `index.html:329` uses `/api/branding/logo-image?slot=header_logo` (the real logo): a **900 × 629** PNG, not 1200 × 630.
- None declares `og:image:width` / `og:image:height`; only `index.html` has `og:image:alt`.

**The title and description**
- All OG tags are written in Romanian, static, in the HTML. English is the default language on first visit, but a crawler (no `localStorage`, no JavaScript) always gets Romanian: `GET /?lang=en` with the `facebookexternalhit` agent returns `<html lang="ro">` and the Romanian title.
- `seo-meta.js:1-16` only overrides `title` / `description` from JS, after the API responds — social crawlers do not see it (the comment itself says so).
- `index.html:317-320`: the OG description promises "AI quote in 60 seconds, secure escrow payment" (see 1.2-T1, 1.2-T8).

**The share buttons**
- `share-widget.js` is included on the same 27 pages with OG (including `index` and `mydarrin-investitori`): the Web Share API (`navigator.share`) on mobile; on desktop Facebook, WhatsApp, X, LinkedIn, Email and "Copy link" (`share-widget.js:1-15`).
- `mydarrin-serviciu.html:1530-1532` also has an inline block (`MydShare.creeazaBlocInline`).
- The shared link is `location.href`, so a service link is right for a person, but the network's crawler reads it as shown below.

**Dynamic pages as seen by a crawler** (`curl -A "facebookexternalhit/1.1"`, production, 16 Oct)

| URL | What the crawler gets |
|---|---|
| `/catalog/servicii/instalatii-electrice/inlocuire-becuri-corpuri` | 200, `lang="ro"`, `og:title` "Configurare comandă \| My Darrin", `og:url` `…/mydarrin-produs` (no slug), the stock image |
| `/mydarrin-produs?slug=inlocuire-becuri-corpuri&type=servicii` | identical |
| `/mydarrin-serviciu` | `og:title` "Înlocuire calorifer — Bronz→Platinum", the same for every service (fixed text in `mydarrin-serviciu.html:310-316`) |
| `/mydarrin-marketplace-materiale` | only `<title>` "Materiale și închirieri", no OG |

Conclusion: **every shared service or product appears with the same generic card**, in Romanian, with a stock image, and `og:url` points to the page without the slug (the network may group every share under the same address).

**The pitch deck and the confidentiality agreement**
- `middleware.js`: `mydarrin-pitch-deck` and `mydarrin-investitori` are in `PAGINI_PUBLICE`; `BARIERA_GENERALA_ACTIVA = false`. Live: `GET /mydarrin-pitch-deck` → 200, no authentication.
- The `/acces-temporar` + `/acord-confidentialitate` flow exists (`middleware.js`, `treceBarieraPlatforma`, `nda_pending`), but applies only to pages outside `PAGINI_PUBLICE`, with the general barrier on.
- `mydarrin-investitori.html:1902-1916` says the documents and data are "Under NDA" and asks for the NDA to be accepted; the pitch deck (with the round's figures) is public anyway, and the investors page has a share button. **Conflict — LM decision.**

**A related finding (outside the list, but found here).** `mydarrin-business-model` and `mydarrin-design-system` (internal documents) answer live with 200, with no authentication: they are neither in `PAGINI_STRICTE` nor in `PAGINI_PUBLICE`, and with the barrier off they pass (`middleware.js`, `if (!BARIERA_GENERALA_ACTIVA) return next()`). `robots.txt` only blocks the `.html` variants, not the clean addresses (`/mydarrin-superadmin`, `/mydarrin-checkout`), with `cleanUrls: true` in `vercel.json`.

#### Problems

| # | Problem | Severity |
|---|---|---|
| 1.4-a | Shared services and products all appear with the same generic card; `og:url` without the slug | **major** |
| 1.4-b | OG in Romanian only, although English is the default; the crawler cannot get EN | **major** |
| 1.4-c | The pitch deck is public vs. "under NDA" on the investors page; a share button on the page with false figures (2.2) | **major** (LM decision) |
| 1.4-d | `mydarrin-business-model` and `mydarrin-design-system` are public | **major** |
| 1.4-e | The OG image: external stock, 1200 × 795; logo 900 × 629; no declared dimensions | minor |
| 1.4-f | 8 public pages without OG | minor |
| 1.4-g | `robots.txt` does not cover the addresses without `.html` | minor |

#### Decisions for LM
1. **Pitch deck:** (a) public, with figures marked "target" and no confidential data, or (b) behind the NDA (`/acord-confidentialitate`), removed from `PAGINI_PUBLICE`. Recommendation: **(b)** until the figures in 2.2 are fixed; the share button removed from `mydarrin-investitori`.
2. **The default OG image:** a 1200 × 630 brand image made by the HBP team (not stock); for services, the service's first real image, when there is one (see 1.3).
3. **Internal pages** (`business-model`, `design-system`): moved into `PAGINI_STRICTE` (recommended).

#### The plan
**Back-end**
- A new function `api/public/pagina-meta.js` (GET): takes the type (service / marketplace product), the slug and the language; reads `catalog_servicii` (title, description, first image, `traduceri.en`) or the marketplace product; returns the static page's HTML (`mydarrin-produs.html`, bundled with the function) with the `<head>` filled in on the server: `title`, `description`, `og:title`, `og:description`, `og:image` (+ `width` / `height` / `alt`), a canonical `og:url` with the slug, `og:locale` (`en_GB` / `ro_RO`), `og:locale:alternate`, `twitter:*`, `link rel="canonical"` and `hreflang`. No user-agent switch (the same HTML for people and crawlers — no cloaking).
- `middleware.js`: the routes `/catalog/:tip/:categorie/:slug` and `mydarrin-produs?slug=` are rewritten to `api/public/pagina-meta`; the same for a new route for marketplace products (`/marketplace/:tip/:slug`).
- Language: `?lang=en|ro`; with no parameter → English (the CLAUDE.md rule); the link copied by `share-widget.js` adds `lang` from the active language.
- `middleware.js`: `mydarrin-business-model`, `mydarrin-design-system` into `PAGINI_STRICTE`; `mydarrin-pitch-deck` after decision 1.

**Front-end**
- `share-widget.js`: the canonical URL (with slug and `lang`), not the raw `location.href`.
- OG tags for the 8 public pages without OG; `og:image:width/height/alt` everywhere; the default 1200 × 630 image in `assets/`.
- `robots.txt`: the addresses without `.html` too.

**Content (RO + EN)**
- OG title and description in RO and EN for each static page (`i18n/en/<page>.json` already holds the title texts; the EN variant of the static tags is served by the same function or by generated `?lang=en` files).
- The OG description on `index` aligned with 1.2 (no "secure escrow" / "60 seconds").

**Tests**
- New script `scripts/test-og-crawler.js`: for 3 services and 2 products, `GET` with the `facebookexternalhit` agent (locally, `vercel dev`) → the service title, `og:url` with the slug, the 1200 × 630 image or the service image, EN by default, RO with `?lang=ro`.
- Manual check in the Facebook Sharing Debugger and the LinkedIn Post Inspector after publication (LM).

---

### 2.5 The filters on `/mydarrin-catalog` do nothing

#### How I tested
Playwright (Chromium), locally, on `main` (`8c5de07`): files served from the repo; `/api/*` requests and the Supabase REST API sent as **GET** to production, every other method blocked; RO language; 1366 px. For each entry in the "Services" side menu I called `filterCat('servicii', key, element)` and counted the cards left visible. No JS errors.

#### The result

The grid has **102 cards**: **14 static** ones, written in the HTML (`mydarrin-catalog.html:2278-3281`, with "Min. 100 Lei · +5% zonă", "ACA BG"), and **88 from the database** (every published service). The counter says "102 rezultate".

| Menu entry (key) | Cards visible after the click | From the database | Real services in the database for that NACE class |
|---|---|---|---|
| All plumbing & heating (`F4322`) | 9 | 6 | 20 (NACE 43.22) |
| · **Radiators** (`F4322-cal`) | **102 (all)** | 88 | 10 have "calorifer" in the title |
| · Sanitary fittings (`F4322-ob`) | **102 (all)** | 88 | — |
| All electrical (`F4321`) | 9 | 8 | 15 (NACE 43.21) |
| · Light fittings (`F4321-ilum`) | **102 (all)** | 88 | — |
| Doors, windows, parquet (`F4332`) | 2 | 1 | 1 |
| Cleaning (`O8121`) | 2 | 1 | 5 (NACE 81.2x) |
| Car & service (`T9531`) | 2 | 1 | 6 (NACE 95) |
| Consultancy (`N71`) | 2 | 2 | 7 (NACE 71) |
| Repairs & installation (`S9522`) | 1 | 1 — "Mutare mobilă și electrocasnice apartament" (a transport service) | — |
| Hospitality (`I5510`) | 0 | 0 | 0 |

#### The exact cause
1. **Sub-categories do not filter at all.** In `NACE_MAP` (`mydarrin-catalog.html:5838-5856`), the sub-categories only have `keywords` (e.g. `'F4322-cal': {…, keywords:['calorifer','radiator','termic']}`), no `domains`. `applyFilters()` filters by category **only** when there are `domains` (`mydarrin-catalog.html:5946-5958`: `acceptedDomains` stays `null`; the condition at `:5970` is `if (acceptedDomains !== null)`). The keywords are only checked inside that condition, so they are never applied. Result: a click on "Radiators" → all 102 cards stay → "nothing happens".
2. **Categories filter by text, not by code.** Database cards get `data-cat` / `data-subcat` from a hand-written dictionary, `DOM`, based on the text of the `domeniu` field (`mydarrin-catalog.html:5468-5530`, `mkCard` at `:5548-5557`); they get neither NACE, nor node, nor category slug (`data-nace`, read at `:5963`, is never set on the cards). The filter compares domain names from `NACE_MAP` (e.g. "Instalații sanitare") with `data-subcat` (e.g. "Sanitare & Termo") or with the title. That is why "All plumbing & heating" shows 6 of 20 services, "All electrical" 8 of 15, and "Repairs & installation" shows a removals service.
3. **The menu is hand-written** (`mydarrin-catalog.html:1907-2071`): it has entries with no service (Hospitality, `I 55.10`) and no entries for domains that exist in the database (Transport / removals, Demolition, Concrete, Technical design, Motorcycle service). The `cat-count` counters stay "—" (the function meant to fill them, `updateSidebar` in the data module, `:5636-5654`, looks for the `sidebar-servicii-cats` container, which does not exist).
4. **The static cards** (14) mix with the real ones and have their own `data-cat` (e.g. "Instalații", "Exterior"), so they show up in filter results.

All of these share one root cause: in the database, `catalog_servicii.nod_id` is empty on all 226 rows (see 2.3), so the page has no code to filter by and ended up guessing from text.

#### Problems

| # | Problem | Severity |
|---|---|---|
| 1.5-a | The menu's sub-categories do not filter (all 102 cards stay) | **major** |
| 1.5-b | Categories show only part of the services (6 / 20, 8 / 15, 1 / 5) or the wrong services | **major** |
| 1.5-c | 14 static demo cards mixed with the real services | **major** |
| 1.5-d | The menu does not match the catalogue (empty entries, missing domains), "—" counters | minor |

#### Decision for LM
- None new: the fix is the already planned step 11 (menus generated from the classification route). The recommendation is **not to repair `NACE_MAP`** (it would be one more hand-written menu).

#### The plan (tied to step 11)
**Precondition:** the classification route filled in for the published services (`catalog_servicii.nod_id` → `categorii`, chapter → `meniu_capitole`), see 2.3.

**Database**
- No new migration for the filters, if `meniu_capitole` and `categorii.capitol_cod` already exist (migration `2026-10-15_ruta_incadrare.sql`). Only filling in the data (`nod_id`) through the back office.

**Back-end**
- A new public GET endpoint, `api/public/meniu-catalog.js`: the active chapters (`meniu_capitole`, RO + EN) → the nodes (`categorii`, RO + EN, slug) → the number of published services per node; the same source for the marketplace (chapters G and O77). Short cache (60 s).
- Optional: `api/public/catalog-servicii.js` (GET, paginated, filtered by `capitol` / `nod`), instead of reading the table directly with the anon key (linked to 1.3-g).

**Front-end**
- `mydarrin-catalog.html`: the side menu generated from the endpoint (chapter → node), no hand-written HTML; each card gets `data-capitol` and `data-nod` (slug) from the database; the filter compares the code, not the text.
- Delete `NACE_MAP`, `NACE_MAP_MAT`, `NACE_MAP_INC`, `DOM` and the 14 static cards; counters from the endpoint.
- The filter in the URL (`?capitol=F&nod=calorifere`), so a filter can be shared (linked to 2.4).

**Content (RO + EN)**
- Chapter and node names come from `meniu_capitole.titlu_ro/titlu_en` and `categorii.title/title_en` — no new texts in the page.

**Tests**
- A new Playwright test (`scripts/test-filtre-catalog.js`, locally, with simulated responses): for each node, the visible cards = the services with that `nod_id`; no static card; a node with no services does not appear in the menu.
- The Romanian detector in EN on `/mydarrin-catalog` (0).
