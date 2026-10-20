# LM's decisions (17 Oct 2026) — extract for step 11-A
*(Romanian version: `2026-10-17_decizii_LM_RO.md`; identical content.)*

- **B1. Payment** — the full description of the designed model: payment by card (through the payment processor, integrated before the live launch) and by bank transfer; the amount is held as a guarantee (escrow) and reaches the partner after the work is confirmed. The methods shown as available come from the back office (`metode_plata_config`). Noted: `metode_plata_config` currently has a single global row with `["card"]`, while `api/comenzi/creeaza.js` accepts only bank transfer — to be aligned in 11-C.
- **B2. Tacit confirmation: 24 hours** from the moment the partner reports the service as completed. The clause appears in contracts, agreements, pro forma invoices and invoices.
- **B3. Payment to the partner:** within at most **6 days** from the day the amount becomes releasable (after the work is confirmed, explicitly or tacitly after 24 h). Configurable from the back office.
- **B4. ACA BUSINESS GROUP:** joins as an **external supplier** (real account, ANAF data, approval, contract, bank account, 5–15% discount, invoice to Home Best Pal SRL, real imported catalogue). Until then, no hand-written mention.
- **B5. WooCommerce / Shopify integrations:** removed from the pages until they exist (steps 11-F).
- **B6. Footer:** "© 2026 Home Best Pal SRL (Romania) · Home Best Pal LTD (United Kingdom)".
- **C1. Investors:** only real figures, from the accounting / finance module. The public sections with figures and reports are restricted now. Still live: creating an investor account, buying shares / units and the investor dashboard.
- **C2. Funding rounds** (Seed, Series A, B, C … IPO), configurable from the back office by the superadmin and admins with permission; current round: Seed. New feature — step 11-J.
- **C3. The pitch deck** editable from the back office, in versions, with uploaded media — step 11-K. Until the first approved version, the public page shows "Pitch deck in preparation" — step 11-B.
- **A. Minimum order value** (step 11-C, not now): threshold only on services, per partner (once if the same partner does several services in the basket), the difference up to the threshold added to the partner's labour ("minimum call-out", with VAT); catalogue products without a threshold; a country cannot be activated without a threshold; one threshold per country, in the country's currency.
- **D1.** `mydarrin-business-model` and `mydarrin-design-system` — admins only (step 11-B).
