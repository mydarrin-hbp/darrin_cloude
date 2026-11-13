# Audit bilingv RO + EN — pasul 11-T1 (13 nov. 2026)

Punctul de plecare pentru pașii 11-T1 și 11-T2: ce apare încă în română în modul EN, pe pagină, flux și sursă (HTML, JS, bază de date, email, API), înainte și după 11-T1.

## Cum s-a măsurat

| Sursă | Cum | Unde |
|---|---|---|
| Pagini publice, date reale | `scripts/detector-ro.js --base https://mydarrin.homebestpal.com` (modul EN, 390 și 1366 px, cu meniul, fereastra de cont și preferințele cookie deschise) | 38 de pagini publice + 4 pagini cu produse și categorii reale; doar citire |
| Pagini cu cont | `scripts/detector-ro.js --cu-cont --profil extern / propriu / inchirieri`, local, cu sesiuni și date simulate | dashboard client, partener, furnizor, completarea profilului de partener, rolurile mele, panoul investitorului (toate secțiunile), admin-catalog |
| Conținutul din baza de date | Supabase REST cu cheia anon (aceleași citiri ca paginile publice), doar citire; salvat în `docs/traduceri/11t1_continut_public.json` | `catalog_servicii` publice, `catalog_niveluri` ale lor, `categorii` |
| Emailuri | fiecare șablon din `lib/i18n.js` redat în EN + căutarea trimiterilor din afara lui | `lib/`, `api/` |
| Erori API | căutare statică a mesajelor `error` / `mesaj` / `message` doar în română | `api/` |
| MDFeedback | textele trecute prin `tr()` în `ui-feedback.js`, căutate în `i18n/en.json` | `ui-feedback.js` |
| Titluri și meta | `<title>` și meta description în detector; `og:*`, `twitter:*`, `description` căutate static în dicționarele EN | paginile publice |

Recunoașterea românei: diacritice sau cuvinte frecvente, după excepții (nume proprii, orașe, adrese, mărci, autorizări). Lista excepțiilor e explicită în `scripts/recunoaste-ro.js`.

Limite:
- Producția nu are conturi de test, iar paginile cu cont s-au verificat local, pe date simulate.
- Profilurile de partener verificate sunt furnizor de servicii (extern), furnizorul propriu și închirieri. Curier, materiale și asigurări folosesc același dashboard (`mydarrin-dashboard-partener` / `-furnizor`), cu altă listă de file, și nu au profil simulat în detector.
- Fluxurile cu trimitere (plasarea comenzii, plata, semnarea contractului, subscrierea, exitul) sunt acoperite de testele existente (`test-flux-cos`, `test-feedback-salvare`, `test-panou-investitor` etc.), nu de detector.

## Rezumat, înainte → după 11-T1

| Pagina / fluxul | Sursa | Înainte (texte RO în EN) | După 11-T1 | Exemple / observații |
|---|---|---|---|---|
| 38 de pagini publice × 2 lățimi | HTML + JS | 0 | 0 | Dicționarele `i18n/en.json` și `i18n/en/*.json` acoperă textele fixe. |
| Catalog (toate filele, carusel, filtre, categorii) | bază de date | 0 afișate | 0 | Titlurile din catalog se traduc pe pagină din `i18n/en.json` (traducerile din octombrie, pe potrivire exactă), deși baza nu are engleză. |
| Produs „Acoperiș & Șarpantă”, „Montaj materiale acoperiș” | bază de date | 0 | 0 | — |
| Produs „Montaj Parchet Laminat” — materialele opționale | bază de date | 6 (× 2 lățimi) | 0 după deploy | „Parchet laminat, clasă de uzură AC3…”: descrierea era trunchiată la 70 de caractere înainte de traducere. Acum se alege traducerea înainte de trunchiere. |
| Produs — titlu, descriere, etape, întreținere, niveluri, unitatea („Quantity (buc)”) | bază de date | tradus doar prin potrivire exactă | `traduceri.en` din rând (rezervă: dicționarul, apoi româna) | `mydarrin-produs.html` → `trDb()` |
| Coș, checkout, confirmare | HTML + JS | 0 | 0 | Coșul păstrează datele în română (comanda), afișarea e tradusă. |
| Confirmarea livrării — erori de la server | API | 13 mesaje doar RO | 0 | `comanda-token.js`, `confirma-livrare.js` → `error_en`, afișat în EN. |
| Dashboard client, partener (servicii, propriu, închirieri), furnizor, rolurile mele, completare profil | HTML + JS | 0 (date simulate) | 0 | Conținutul real din comenzi se traduce prin același dicționar. |
| Panoul investitorului (subscriere, participații, istoric, exit, date) | HTML + JS | 0 (date simulate) | 0 | — |
| Emailuri din `lib/i18n.js` (18 șabloane) | email | 0 | 0 | Toate au EN. |
| Emailuri trimise în afara `lib/i18n.js` | email | 4 doar RO | 0 | Coș abandonat, codul pentru contract, lucrare finalizată, serviciu nou: mutate în `lib/i18n.js` (RO + EN). |
| Emailul „Comandă alocată” către partener | email + bază | numele serviciului în RO | `traduceri.<limba>.titlu` | `lib/notificari-comanda.js` |
| Emailul „Serviciu nou” către parteneri | email + bază | RO | titlul tradus | `lib/notifica-servicii-noi.js` |
| Mesajele MDFeedback (`ui-feedback.js`) | JS | 0 (13/13 cu EN) | 0 | — |
| `<title>` și meta description | HTML | 0 | 0 | — |
| `og:*`, `twitter:*`, `description` (static) | HTML | 1 fără EN din 65 | 0 | `acord-confidentialitate` — meta description. |
| Erori API în afara `api/admin` | API | 280 doar RO, în 75 de fișiere | 267, în 72 de fișiere | Lista e mai jos; rămâne pentru 11-T2. |

## Conținutul din baza de date

| Tabel | Rânduri | Cu engleză înainte | După migrare |
|---|---|---|---|
| `catalog_servicii` publice | 136 | 10 (doar `titlu`; fără `domeniu` și unitate) | 136 complete (titlu, domeniu, descriere, etape, întreținere, unitate unde diferă) |
| `catalog_niveluri` ale produselor publice | 275 | 0 | 275 (label, descriere) |
| `categorii` | 81 | 0 (`title_en` gol) | 81 (`title_en`, `traduceri.en.title`, `description`) |

Migrarea: `docs/migrations-propuse/2026-11-12_traduceri_en_catalog.sql`. Verificarea textelor: `docs/traduceri/11t1_catalog_en.csv`. Generatorul: `scripts/genereaza-traduceri-11t1.js`.

Pe ecran, catalogul arată deja în engleză, prin dicționarul paginii. Lipsa din bază se vede:
- în API-urile publice (`/api/public/catalog?lang=en` trimite `traduceri.en` doar pentru 10 produse);
- în dicționarul public `/api/public/traduceri-catalog`;
- în emailuri;
- în orice text compus sau trunchiat (cazul materialelor de mai sus).

### De verificat de LM (conținut, nu traducere)
- 3 niveluri au în descriere note interne afișate public: „PLACEHOLDER — norma de timp … NU e reală”, „Normă de timp generată automat, placeholder — de confirmat de admin”.
- 10 produse de test sunt publice. Nivelurile lor au descrieri „Material tip … v1…v10 - Nivel …”.
- Materialul „Plintă PVC” are în descrierea nivelului calculul intern de preț („18,29 lei/ml material (max. piață RO, Leroy Merlin/Dedeman…)”).

## Ce rămâne pentru 11-T2

> Rezolvat în pasul 11-T2 (13 nov. 2026): erorile API (inclusiv `api/admin`) și profilurile curier, materiale și asigurări. Vezi `docs/audit-erori-api-11t2.md`.

1. **Erorile API în afara `api/admin` (267 de mesaje, 72 de fișiere).** Se trec pe forma comună `trimiteEroare(...)` din `lib/raspuns-eroare.js` (`mesaj:{ro,en}`), iar paginile le afișează prin MDFeedback. Prioritate: `partener/*` (dashboard-ul partenerului), `marketplace/*`, `darrin-ai/deviz.js`, `public/*`.
2. **Profilurile de partener curier, materiale și asigurări:** profil simulat în `detector-ro.js --cu-cont`.
3. **Fluxurile cu trimitere, în EN, pe producție, cu un cont de test** (dacă LM creează unul): comandă, plată, contract, subscriere, exit.
4. **După aplicarea migrării:** `node scripts/test-bilingv-date-reale.js --pagini` pe producție trebuie să dea 0.
5. **Observat, fără legătură cu limba:** `mydarrin-pitch-deck` depășește lățimea ecranului cu 7–8 px (397/390, 1374/1366).

### Erorile API doar în română (fără `api/admin`), pe fișier

| Fișier | Mesaje | Exemplu |
|---|---|---|
| `api/accountancy.js` | 9 | Factura nu există |
| `api/auth/verify-otp.js` | 1 | Telefonul nu a fost încă verificat prin OTP (pas anterior lipsă) |
| `api/branding/upload.js` | 3 | slot invalid. Trebuie să fie unul din: ${VALID_SLOTS.join(', ')} |
| `api/client/checkout-inceput.js` | 1 | Nu am putut înregistra vizita |
| `api/client/comenzi-tracker.js` | 1 | Nu am putut încărca comenzile |
| `api/client/date-facturare.js` | 1 | Nu am putut citi datele de facturare. |
| `api/client/dauna.js` | 8 | Nu am putut încărca dosarele. |
| `api/comenzi/upload-imagine.js` | 7 | comanda_id și tip (before/after) sunt obligatorii |
| `api/cron/auto-confirma-comenzi.js` | 1 | Eroare la căutarea comenzilor eligibile |
| `api/cron/email-cont-abandonat.js` | 2 | Eroare la căutarea clienților candidați |
| `api/cron/email-cos-abandonat.js` | 1 | Eroare la căutarea vizitelor de checkout |
| `api/cron/expira-acces-temporar.js` | 1 | Eroare la căutarea acceselor expirate |
| `api/cron/reminder-profil-partener.js` | 1 | Eroare la căutarea candidaților |
| `api/darrin-ai/deviz.js` | 11 | Serviciul Darrin AI nu este configurat (cheie API lipsă). Contactează  |
| `api/deviz/calculate.js` | 4 | Câmpul '${campInterzisGasit}' nu este acceptat din client. Parametrii  |
| `api/email/webhook-primire.js` | 2 | Metodă nepermisă |
| `api/financiar/comision.js` | 1 | comanda_id este obligatoriu |
| `api/investitori/evolutie-lunara.js` | 1 | Evoluția lunară e disponibilă după aprobarea verificării identității t |
| `api/investitori/exit.js` | 4 | tip (buyback) și numar_actiuni (>0) sunt obligatorii |
| `api/investitori/indicatori.js` | 1 | Indicatorii financiari sunt disponibili după aprobarea verificării ide |
| `api/marketplace/importa-csv.js` | 6 | cui_furnizor lipsă — obligatoriu când importul acoperă mai mulți furni |
| `api/marketplace/produse.js` | 11 | tip trebuie să fie 'materiale' sau 'echipamente' |
| `api/marketplace/upload-document-kyc.js` | 3 | tip_document trebuie să fie una din: ${TIPURI_VALIDE.join(', ')} |
| `api/partener/accept-comanda.js` | 10 | Cont de partener inexistent. |
| `api/partener/cmr-generare.js` | 6 | comanda_id, furnizor_id și continut_document sunt obligatorii |
| `api/partener/competente.js` | 4 | Nu am putut încărca lista de competențe. |
| `api/partener/confirma-cod.js` | 6 | comanda_id și cod sunt obligatorii |
| `api/partener/cont.js` | 6 | Nu am putut încărca contul de partener. |
| `api/partener/contract-confirma-otp.js` | 6 | Cod invalid — introdu cele 6 cifre primite pe email. |
| `api/partener/contract-status.js` | 1 | Cont de partener inexistent. |
| `api/partener/contract-trimite-otp.js` | 8 | Cont de partener inexistent. |
| `api/partener/contract.js` | 1 | Cont de partener inexistent. |
| `api/partener/conturi-bancare.js` | 3 | id este obligatoriu |
| `api/partener/discounturi.js` | 3 | id este obligatoriu |
| `api/partener/documente.js` | 9 | id este obligatoriu. |
| `api/partener/dosare-dauna.js` | 7 | Doar asiguratorii aprobați au acces la dosarele de daună. |
| `api/partener/escrow-tracker.js` | 1 | Nu am putut încărca alocările. |
| `api/partener/facturi.js` | 11 | Nu am putut încărca alocările |
| `api/partener/finalizeaza-comanda.js` | 6 | comanda_id este obligatoriu |
| `api/partener/gps.js` | 9 | lat și lng (numerice) sunt obligatorii |
| `api/partener/heartbeat.js` | 1 | lat și lng, dacă sunt trimise, trebuie să fie numerice |
| `api/partener/login-config.js` | 2 | Eroare internă de autentificare |
| `api/partener/portofoliu.js` | 4 | Cont de partener inexistent. |
| `api/partener/profil-status.js` | 1 | Nu am putut verifica profilul de partener |
| `api/partener/program-lucru.js` | 5 | Nu am putut încărca programul de lucru |
| `api/partener/set-limba.js` | 1 | limba trebuie să fie una din: ${LIMBI_DISPONIBILE.join(', ')} |
| `api/partener/status-aplicare.js` | 1 | Contul de partener nu a fost găsit |
| `api/partener/tipuri-polita.js` | 5 | id este obligatoriu |
| `api/partener/wizard-alocare.js` | 4 | Alocă cel puțin un angajat pe o competență |
| `api/partener/wizard-angajati.js` | 7 | id și disponibil (boolean) sunt obligatorii |
| `api/partener/wizard-certificari.js` | 6 | id este obligatoriu |
| `api/partener/wizard-companie.js` | 1 | Contul tău are deja un rol de partener. Un cont poate avea un singur t |
| `api/partener/wizard-nace.js` | 1 | Un cod NACE principal este obligatoriu |
| `api/partener/wizard-utilaje.js` | 6 | id este obligatoriu |
| `api/partener/zona-curier.js` | 4 | id este obligatoriu |
| `api/plati/proceseaza-card.js` | 5 | comanda_id este obligatoriu |
| `api/public/accepta-nda.js` | 3 | Cont fără email. |
| `api/public/calculeaza-pret-nivel.js` | 4 | Prea multe cereri. Încearcă din nou mai târziu. |
| `api/public/contact.js` | 1 | Nu am putut încărca datele de contact |
| `api/public/cui-lookup.js` | 3 | Prea multe cereri. Încearcă din nou mai târziu. |
| `api/public/destinatie-post-login.js` | 2 | Acest cont nu are încă acces alocat pe platformă. Contactează administ |
| `api/public/entitati-juridice.js` | 1 | Nu am putut încărca entitățile juridice |
| `api/public/esco-lista.js` | 1 | Nu am putut încărca lista de ocupații ESCO |
| `api/public/geo-regiuni.js` | 2 | tara este obligatorie (ex: ?tara=RO) |
| `api/public/investitori-live.js` | 1 | Nu am putut încărca fluxul de investiții |
| `api/public/marketplace-produse.js` | 9 | Id de produs invalid. |
| `api/public/nace-lista.js` | 1 | Nu am putut încărca lista NACE |
| `api/public/nda-info.js` | 2 | Cont fără email. |
| `api/public/servicii-cu-reteta.js` | 2 | Prea multe cereri. Încearcă din nou mai târziu. |
| `api/public/sloturi-disponibile.js` | 1 | data este obligatorie, format YYYY-MM-DD |
| `api/public/tari-active.js` | 1 | Nu am putut încărca lista de țări active |
| `api/public/traduceri-catalog.js` | 1 | Parametrul lang lipsește sau nu e suportat |
