# Pasul 11-A1: măsurarea campaniilor și a pâlniei „Devino partener”

Data: 13 nov. 2026. Ramura: `11a1-masurare`, din `main` cu 11-T2 (PR #66).

## 1. GA4 în producție (verificat pe 13 nov. 2026, doar citire)
Am verificat cu un browser real pe `https://mydarrin.homebestpal.com`, fără acord, cu „Doar esențiale” și cu „Acceptă toate”, pe 7 adrese: `/`, `/?lang=en`, `/partener`, `/servicii/instalatii`, `/mydarrin-devino-partener-wizard`, `/mydarrin-catalog`, `/mydarrin-checkout`.

- **Fără acord și cu acord refuzat:** nu pleacă nicio cerere spre Google. Comportamentul e corect.
- **Cu acord, GA4 nu a primit niciodată date.**
  - `analytics-loader.js` cere `https://www.googletagmanager.com/gtag/js?id=G-3F5HVDYJPX`, dar CSP-ul din `vercel.json` nu permite domeniul. Browserul blochează scriptul: „violates the following Content Security Policy directive: script-src …”.
  - `connect-src` nu permitea nici domeniile de colectare (`*.google-analytics.com`, `*.analytics.google.com`).
  - De aceea, în GA4 nu există date, oricâte vizite ar fi venit din campanii.
- **Evenimentele trimise azi:** niciunul propriu. Codul punea în coadă doar `js` și `config`, adică `page_view` automat, care oricum era blocat. Nu exista niciun apel `gtag('event', …)`.
- **Pagini fără GA4 și fără bannerul de consimțământ:**
  - `mydarrin-devino-partener-wizard` (formularul de înscriere ca partener);
  - `mydarrin-rolurile-mele`, `mydarrin-cos`, `mydarrin-marketplace-materiale`.
- **Rutele curate:**
  - **`/partener`, `/curier-cartier`, `/asigurator`:** scripturile se încarcă. `page_view` ar avea `page_location` = adresa curată, deci e corect.
  - **`/servicii/:slug`, `/materiale/:slug`, `/inchiriere/:slug`, `/catalog/:tip/:categorie/:slug`:**
    - Pagina cerea fișierele cu cale relativă, de exemplu `/servicii/cookie-consent.js`, și primea 404 pe toate: bannerul, GA4, contul, coșul, meniurile, logo-ul.
    - Pe aceste rute nu exista consimțământ, deci nici măsurare. Contul și coșul nu funcționau.
- **`?lang=`:** `page_view` pleacă o singură dată, cu `?lang=en` în `page_location`. Raportul GA4 „Page path” nu include parametrii, deci pagina nu se dublează. Limba vine acum și ca parametru `language` pe fiecare eveniment propriu.

**Reparat în acest pas:**
- CSP-ul permite GA4: `script-src https://www.googletagmanager.com`; `connect-src https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com`.
- Cele 4 pagini fără GA4 au acum bannerul, GA4 și măsurarea.
- `mydarrin-catalog` și `mydarrin-produs` cer fișierele, imaginile și legăturile cu cale absolută (`/…`).

## 1b. Vercel Web Analytics
- **Stare:** e activ pe domeniu. `/_vercel/insights/script.js` se servește, iar `/_vercel/insights/view` răspunde.
- **Scriptul `<script src="/_vercel/insights/script.js" defer>`:**
  - adăugat pe 41 de pagini publice și cu cont;
  - nu e pe paginile interne: superadmin, catalogul adminilor, back-office, motorul de deviz, schemele tehnice, design system, modelul de business, pitch deck-ul și vederea prezentatorului.
- **Consimțământ:** Web Analytics nu folosește cookie-uri, deci nu depinde de banner.
- **Verificarea vizitelor reale și a UTM-urilor:** se poate face doar după publicare. Codul nu e încă în producție.

## 2. Sursa campaniei, păstrată până la conversie
- **Ce se păstrează:** `masurare.js` citește din adresă `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `ttclid` și `li_fat_id`.
- **Unde:** în `localStorage` (`myd_utm_v1`), 30 de zile.
- **Când:**
  - doar cu acordul pentru cookie-uri analitice;
  - dacă acordul vine din banner pe aceeași pagină, sursa se salvează atunci;
  - fără acord, valorile rămân doar în memoria paginii și se pierd la plecare.
- **Ce sursă rămâne:** prima sursă din cele 30 de zile.
- **Retragerea acordului:** sursa se șterge.
- **Filtrul:** valorile care seamănă cu un email, un telefon sau un CUI nu se păstrează. Id-urile de clic trebuie să aibă formatul lor (litere, cifre, `_ - .`).
- **În evenimente:** sursa intră în fiecare eveniment: `account_created`, `partner_step_completed` și celelalte.
- **Pe cont:**
  - la creare, sursa se pune în metadatele contului (`user_metadata.sursa`);
  - migrarea o copiază în `profiles.sursa_utm`, printr-un declanșator nou;
  - `handle_new_user` rămâne neschimbat.

## 3. Evenimentele
Toate trec prin `MYD_MASURARE.eveniment()`, care respectă următoarele reguli:
- fără acord nu trimite nimic;
- acceptă doar numele din listă;
- acceptă doar parametrii permiși: `partner_type`, `position`, `role`, `step`, `item_type`, `item_category`, `item_slug`, `order_type`, `page`, plus sursa și `language`;
- elimină orice valoare care seamănă cu un email, un telefon sau un CUI.

| Eveniment | Pagina | Momentul | Parametri |
|---|---|---|---|
| `partner_landing_view` | `/partener`, `cum-devii-partenerul-nostru`, `cum-devii-furnizor-servicii`, `cum-devii-furnizor-materiale`, `cum-devii-operator-inchirieri`, `cum-devii-curier-de-cartier` (`/curier-cartier`), `ghidul-asiguratorului` (`/asigurator`), `intrebari-frecvente-parteneri`, `mydarrin-devino-partener-wizard` | la încărcare (sau la acordul dat din banner pe pagină) | `partner_type`: general, services, materials, rentals, courier, insurance; `page` |
| `partner_cta_click` | orice pagină cu un buton `[data-cta-partener]` (inclusiv meniul „Devino partener”) | la clic | `partner_type`, `position` (`menu`, `type_card`, `header`, `footer`, id-ul secțiunii sau `cta_N`), `page` |
| `account_created` | fereastra de cont (`account-system.js` → `performRegister`) | după răspunsul reușit de la Supabase | `role`: client, partner_services, partner_materials, partner_rentals, partner_courier, partner_insurance, investor |
| `partner_step_completed` | fereastra de cont (codul din email) | după confirmarea codului, doar la conturile de partener | `step`: email_confirmed, `role` |
| `partner_step_completed` | dashboard-ul partenerului, fluxul „Activează contul” (`activare-pasi.js`) | după salvarea reușită a pasului pe server | `step`: company_details, bank_account, trades, equipment, documents, contract; `partner_type` |
| `partner_activation_completed` | același flux | când serverul raportează activarea completă (pașii 1–5 și contractul semnat sau după verificare) | `partner_type` |
| `zone_unavailable_view` | `index`, catalog, produs, checkout, „Cum funcționează” (fereastra `#zone-unavailable`) | când fereastra devine vizibilă, o dată pe pagină | `page` |
| `service_view` | pagina de produs (`mydarrin-produs`, `/catalog/:tip/:categorie/:slug`) | la încărcare | `item_type` (service, material, rental), `item_category`, `item_slug` |
| `add_to_cart` | catalog, produs (`cos-indicator.js`) | după răspunsul reușit al coșului | `item_type`, `item_slug` |
| `checkout_started` | `mydarrin-checkout` (`/cos`) | la încărcare | `page` |
| `order_created` | `mydarrin-checkout` | după comanda creată pe server | `order_type`: standard, b2g (fără sumă) |
| `darrin_ai_used` | `mydarrin-creeaza-deviz` | după estimarea reușită de la Darrin AI | `page` |

**Pe server:** `palnie_evenimente` ține momentele pâlniei, pentru raportul intern.
- `api/cont/profil` scrie pașii activării. Fluxul de activare îl reapelează după fiecare pas salvat, iar starea pașilor vine din tabelele reale (`lib/activare-partener.js`).
- `api/cont/bun-venit` și `api/cont/profil` scriu emailul confirmat, cu data reală a confirmării.
- Fiecare moment se scrie o singură dată pe cont.
- Fără migrare, scrierea se oprește în tăcere.

## 4. Pixelii rețelelor: pregătiți, opriți
- **Încărcarea:** `masurare.js` poate încărca pixelul Meta, pixelul TikTok și LinkedIn Insight Tag.
- **Condițiile:** pixelul se încarcă doar dacă sunt îndeplinite amândouă:
  1. acord pentru cookie-uri de marketing (`MYD_CONSENT.marketingAllowed()`);
  2. ID-ul setat în Vercel, citit prin `/api/public/config-masurare`, cu format verificat.
- **Fără ID**, pixelul nu se încarcă. Niciun ID nu e scris în cod.
- **Bannerul de consimțământ nu are categoria „marketing”.**
  - Are doar „Cookie-uri esențiale” și „Cookie-uri analitice”.
  - Pixelii nu pot porni până nu se adaugă categoria. Pentru asta trebuie o machetă separată, de aprobat.
  - Nu am schimbat bannerul.
- **Corespondența evenimentelor:**

| Eveniment | Meta | TikTok |
|---|---|---|
| `account_created` | `CompleteRegistration` | `CompleteRegistration` |
| `partner_activation_completed` | `SubmitApplication` | `SubmitForm` |
| `partner_landing_view`, `service_view` | `ViewContent` | `ViewContent` |
| `add_to_cart` | `AddToCart` | `AddToCart` |
| `checkout_started` | `InitiateCheckout` | `InitiateCheckout` |
| `order_created` | `OrderCreated` (personalizat, fără sumă) | `PlaceAnOrder` |
| `partner_cta_click` | `PartnerCtaClick` (personalizat) | `ClickButton` |
| `partner_step_completed`, `zone_unavailable_view`, `darrin_ai_used` | personalizate, cu același nume în PascalCase | — |

- **LinkedIn:** Insight Tag trimite vizitele. Conversiile se definesc în Campaign Manager, după adresa paginii, de exemplu `/mydarrin-dashboard-partener`.
- **Ce primesc pixelii:** doar categoria (`content_category`), fără sursa UTM și fără date personale.
- **CSP:** domeniile pixelilor NU sunt adăugate, pentru că pixelii nu sunt activi. Se adaugă în `vercel.json` în același PR cu activarea:
  - Meta: `script-src https://connect.facebook.net`; `connect-src https://www.facebook.com https://connect.facebook.net`;
  - TikTok: `script-src https://analytics.tiktok.com`; `connect-src https://analytics.tiktok.com`;
  - LinkedIn: `script-src https://snap.licdn.com`; `connect-src https://px.ads.linkedin.com`.

  `img-src` permite deja `https:`.

## 5. Raportul intern
`GET /api/admin/palnie-parteneri?zile=30` (admin / superadmin; `zile` între 1 și 365, implicit 30).
- **Ce numără:**
  - conturile create și conturile de partener, din `profiles`;
  - emailurile confirmate, pașii activării și activările complete, din `palnie_evenimente`.
- **Grupare:** totalul, pe sursă (`utm_source` / `utm_campaign`) și pe zi × sursă. Fără sursă: `(fara_sursa)`.
- **Fără migrare:** conturile se numără tot, fără sursă, iar răspunsul are `migrare_aplicata: false`. Nicio cifră nu e inventată.
- **Date personale:** niciuna în răspuns.

## Migrarea
`docs/migrations-propuse/2026-11-13_masurare_palnie.sql` se rulează de LM înainte de merge.
- **Structura:** o singură tranzacție, rulabilă de mai multe ori, cu verificare la final.
- **Ce adaugă:**
  - `profiles.sursa_utm` (jsonb);
  - tabelul `palnie_evenimente`, cu RLS activ, fără politici și fără drepturi pentru `anon` / `authenticated`;
  - funcțiile `sursa_utm_curata` și `profiles_sursa_utm_din_metadata`, cu `search_path` fix și neexecutabile de `anon`;
  - declanșatorul `profiles_sursa_utm`, `before insert` pe `profiles`;
  - completarea o singură dată a sursei pentru conturile existente care o au deja în metadate.
- **Test:** `scripts/test-migrare-masurare-palnie.js` (PGlite).

## Ce nu s-a schimbat
- Designul și bannerul de consimțământ.
- Datele personale: niciuna în evenimente.
- `continut/`, `detector-out/` și `.gitignore` sunt neatinse.
