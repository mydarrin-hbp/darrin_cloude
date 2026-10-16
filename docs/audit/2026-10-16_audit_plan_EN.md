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
