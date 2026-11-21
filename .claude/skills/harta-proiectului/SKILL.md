---
name: harta-proiectului
description: Harta proiectului My Darrin — unde e fiecare modul (pagini HTML, api/, lib/, scripts/, i18n/, docs/) și cuprinsul fișierelor mari (peste 150 KB) cu intervalele de rânduri. Se citește înainte de a căuta cod, de a deschide un fișier mare (mydarrin-superadmin.html, mydarrin-catalog.html, mydarrin-produs.html etc.) sau de a începe un task într-o zonă necunoscută.
---

# Harta proiectului My Darrin

## Regula pentru fișierele mari
Fișierele de peste 150 KB se citesc pe intervale de rânduri (Read cu `offset` / `limit`) sau se caută în ele cu Grep, **nu întregi**. Cuprinsul lor, cu intervalele de rânduri pe secțiuni, e în [cuprins-fisiere-mari.md](cuprins-fisiere-mari.md) (se citește doar secțiunea fișierului necesar). Cuprinsul se regenerează cu `node scripts/genereaza-harta.js` după modificări mari; intervalele se verifică cu Grep înainte de editare.

Cele mai mari: `mydarrin-superadmin.html` (~510 KB), `mydarrin-catalog.html` (~380 KB), `mydarrin-produs.html` (~355 KB), `mydarrin-checkout.html`, `mydarrin-deviz-engine.html`, `index.html`, `mydarrin-dashboard-partener.html`, `mydarrin-marketplace.html`, `mydarrin-dashboard-client.html`, `mydarrin-investitori.html`, `mydarrin-cum-functioneaza.html`, `afla-ce-facem.html`, `i18n/en.json`, migrarea `2026-11-12_traduceri_en_catalog.sql`.

## Rădăcina — pagini și scripturi de pagină
- **Pagini publice:** `index.html`, `mydarrin-catalog.html` (catalogul, Darrin AI în pagină), `mydarrin-produs.html`, `mydarrin-serviciu.html`, `mydarrin-categorie-{servicii,materiale,inchirieri}.html`, `mydarrin-marketplace*.html`, `mydarrin-cos.html`, `mydarrin-checkout.html`, `mydarrin-creeaza-deviz.html`, `mydarrin-deviz-engine.html`, paginile informative (`cum-*.html`, `despre-noi.html`, `intrebari-frecvente-*.html`, `garantii-si-asigurari.html`, `reclamatii.html`, `servicii-urgente.html`, `mydarrin-termeni.html`, `mydarrin-politica-confidentialitate.html`).
- **Parteneri:** `mydarrin-devino-partener*.html`, `mydarrin-inscriere-partener.html`, `inscriere-partener.js`, `cum-devii-*.html`, `mydarrin-dashboard-partener.html`, `mydarrin-dashboard-furnizor.html`, `meniu-partener.js`, `ruta-partener.js`, `cta-partener.js`, `profil-partener-card.js`, `activare-pasi.js`.
- **Clienți și cont:** `mydarrin-dashboard-client.html`, `mydarrin-rolurile-mele.html`, `account-system.js`, `cont-fereastra.js`, `cont-dashboard.js`, `panou-cont-nou.js`, `agenda-cont.js`, `reset-password.html`.
- **Investitori:** `mydarrin-investitori.html`, `mydarrin-panou-investitor.html`, `panou-investitor.*`, `investitori-ruta.js`, `meniu-investitori.js`, `cta-investitor.js`, `mydarrin-pitch-deck.html`, `pitch-deck-*.js`, `pitch-deck-prezentator.html`.
- **Intern (doar română):** `mydarrin-superadmin.html` (panourile `#panel-*`), `mydarrin-admin-catalog.html`, `mydarrin-backoffice-serviciu.html`, `seo-panou*.js`.
- **Comune:** `ui-feedback.js` (MDFeedback), `ui-comun.js`, `ui-public.css`, `i18n-loader.js`, `seo-meta.js`, `cookie-consent.js`, `analytics-loader.js`, `masurare.js`, `branding-loader.js`, `format-currency.js`, `tva-config.js`, `tari-config.json`, `myd-geo.js`, `reguli-platforma.js`, `middleware.js` (adrese curate, SEO/OG), `vercel.json`, `sw.js`, `manifest.json`.
- `schema.sql` — schema de referință (nu se rulează).

## api/ (funcții Vercel)
- `api/admin/*` — superadmin și back-office (erori cu `trimiteEroare`).
- `api/public/*` — date publice (catalog, categorii, prețul pe nivel, contact) — fără discounturi.
- `api/client/*` (coș, checkout, facturare, daune), `api/comenzi/*` (`creeaza.js` — prețul pe server), `api/plati/*`, `api/financiar/*`.
- `api/partener/*` (cont, competențe, contract, accept comandă, activare), `api/marketplace/*` (produse, import CSV, KYC).
- `api/investitori/*`, `api/cont/*`, `api/auth/*`, `api/branding/*`, `api/email/*`, `api/darrin-ai/*`, `api/deviz/*`, `api/cron/*` (programate în `vercel.json`).

## lib/ (logica pe server)
- Prețuri și bani: `calculeaza-pret.js`, `pret-serviciu.js`, `comanda-pret.js`, `catalog-preturi.js`, `discount-partener.js`, `elibereaza-escrow.js`, `genereaza-proforma-pdf.js` (skill `preturi`).
- Alocare: `aloca-partener.js`, `aloca-subcontractori.js`, `eligibilitate-partener.js`, `calculeaza-sloturi-disponibile.js`, `competente-parteneri.js`.
- Parteneri și conturi: `activare-partener.js`, `roluri-partener.js`, `roluri-cont.js`, `profil-cont.js`, `verifica-firma-partener.js`, `cauta-firma.js`, `forme-juridice.js`, `contract-partener*.js`, `furnizor-propriu.js`, `categorii-inscriere.js`.
- Comune: `raspuns-eroare.js`, `valideaza.js`, `auth-middleware.js`, `rate-limit.js`, `supabaseAdmin.js`, `supabaseClient.js`, `i18n.js` (emailuri), `email-sender.js`, `traducere-continut.js`, `adrese-curate.js`, `seo-*.js`, `regiune.js`.

## scripts/
- `test-*.js` — teste (~100); se rulează doar cu `node scripts/ruleaza-teste.js [filtre]` (rezumat). `server-test.js` — server local de test, `supabase-simulat.js`, `retea-modelata.js` — simulări.
- `detector-ro.js` — detectorul de română (skill `bilingv`); `genereaza-*.js` — generatoare (inclusiv `genereaza-harta.js` pentru cuprinsul de aici).

## i18n/ și docs/
- `i18n/ro.json`, `i18n/en.json`, `i18n/en/<pagina>.json`, `i18n/GLOSAR.md` (skill `bilingv`).
- `docs/migrations-propuse/` — migrările (skill `migrari`); `docs/decizii/` — deciziile LM (RO + EN); `docs/audit*`, `docs/capturi-*` — rapoarte și capturi pe pași; `docs/sabloane/` — șabloane CSV de import; `docs/traduceri/`; `docs/arhitectura-statusuri.md`, `docs/regula-incadrare.md`.
- `PR.md` — raportul pasului curent pentru LM; `IMPLEMENTATION-PLAN.md`.

## Nu se ating
`continut/`, `detector-out/`, `.tmp.driveupload/`, `node_modules/`.
