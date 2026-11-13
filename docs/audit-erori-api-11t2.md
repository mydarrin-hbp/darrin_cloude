# Pasul 11-T2: mesajele API în RO + EN și profilurile de partener rămase

Data: 13 nov. 2026. Ramura: `11t2-erori-api-bilingv`, din `main` cu 11-T1 (PR #65).

## Ce s-a făcut
- Toate răspunsurile de eroare din `api/` trec prin forma comună din `lib/raspuns-eroare.js`, inclusiv `api/admin/*` (punctul 3 e făcut tot în acest pas). Răspunsurile de eroare trimise din `lib/` (`auth-middleware`, `discount-partener`, `integrare-gate`, `runda-finantare`) au aceeași formă.
- Forma comună: `{ ok:false, cod, mesaj:{ro,en}, campuri:[{camp, mesaj:{ro,en}}] }`. Câmpurile `error` și `error_en` rămân în răspuns, cu același text, pentru paginile vechi.
- Statusurile HTTP și logica nu s-au schimbat. S-a schimbat doar forma corpului de eroare.
- Nu e nevoie de nicio migrare.

### Mesajele
- Fiecare răspuns are un `cod` stabil, cu litere mari și fără diacritice. Unde nu exista un cod, el vine din status: `CAMP_OBLIGATORIU`, `NU_EXISTA`, `EROARE_SERVER` etc.
- Fiecare mesaj are varianta în engleză, în engleza britanică.
- Mesajele cu valori (`${...}`) au aceleași valori și în engleză.
- Câmpul greșit e trecut în `campuri`, când mesajul numește un singur câmp. `trimiteEroare` acceptă și doar numele câmpului; acesta primește mesajul erorii în RO + EN.

### Detaliile interne
- 93 de răspunsuri trimiteau utilizatorului `error.message`, adică textul Postgres/PostgREST cu nume de tabele și coloane.
- Acum trec prin `trimiteEroareInterna(res, status, cod, ro, en, detaliu)`. Detaliul ajunge doar în log (`console.error`). Utilizatorul primește mesajul de rezervă al fișierului, dacă exista unul, sau mesajul generic:
  - RO: „A apărut o eroare pe server. Încearcă din nou peste câteva minute.”
  - EN: “Something went wrong on the server. Please try again in a few minutes.”
- Încălcarea limitelor la discount (cod Postgres 23514), care afișa mesajul bazei de date, are acum un mesaj fix: `DISCOUNT_IN_AFARA_LIMITELOR`, cu câmpul `discount_pct`.

### Texte române schimbate în răspunsurile API (doar unde lipsea româna sau apăreau detalii interne)
- 405: „Method not allowed” → „Metodă nepermisă.” (EN: “Method not allowed.”).
- `api/branding/*`: „Failed to read/save branding” → „Nu am putut citi / salva setările de branding.”
- `api/darrin-ai/deviz.js`: fără „(cheie API lipsă)” în mesajul pentru utilizator.
- Codurile cu litere mici devin cu litere mari:
  - `fara_cont` → `FARA_CONT`;
  - `kyc_neaprobat` → `KYC_NEAPROBAT`;
  - `alt_tip_partener` → `ALT_TIP_PARTENER`.

  Codurile le folosea doar un test, actualizat și el.

## Pe zone

| Zonă | Fișiere atinse | Răspunsuri transformate | dintre care fără `error_en` înainte | Rămase |
|---|---:|---:|---:|---:|
| `admin` | 44 | 304 | 282 | 0 |
| `partener` | 33 | 224 | 224 | 0 |
| `public` | 30 | 93 | 71 | 0 |
| `marketplace` | 3 | 29 | 29 | 0 |
| `investitori` | 7 | 24 | 13 | 0 |
| `client` | 4 | 17 | 17 | 0 |
| `accountancy` | 1 | 15 | 15 | 0 |
| `darrin-ai` | 1 | 14 | 14 | 0 |
| `comenzi` | 3 | 13 | 13 | 0 |
| `cron` | 5 | 10 | 10 | 0 |
| `lib` (comune) | 4 | 9 | 8 | 0 |
| `branding` | 3 | 8 | 8 | 0 |
| `deviz` | 1 | 7 | 7 | 0 |
| `plati` | 1 | 6 | 6 | 0 |
| `auth` | 1 | 3 | 3 | 0 |
| `email` | 1 | 3 | 3 | 0 |
| `financiar` | 1 | 3 | 3 | 0 |
| `cont` | 1 | 2 | 1 | 0 |
| **Total** | **144** | **784** | **727** | **0** |

„Răspunsuri transformate” înseamnă apeluri `res.status(4xx|5xx)` sau `res.status(<expresie>)` scrise direct pe `main`, numărate de `scripts/scaneaza-erori-api.js`.

## Paginile care afișează erorile (punctul 2)
- **Funcția comună:** `i18n-loader.js` are acum `MYD_I18N.eroare(corp, textRezerva)`, care alege în ordine:
  - `mesaj[limba]`;
  - apoi `error_en` / `error`;
  - apoi textul de rezervă, scris în română și tradus din dicționar.

  `MDFeedback.cerere` / `eroareDinRaspuns` citeau deja `mesaj`.
- **Pagini și fișiere trecute pe `MYD_I18N.eroare`** (116 locuri):
  - dashboard-uri: `mydarrin-dashboard-partener` (41), `mydarrin-dashboard-furnizor` (8), `mydarrin-dashboard-client` (4);
  - flux comercial: `mydarrin-marketplace` (8), `mydarrin-devino-partener-wizard` (8), `mydarrin-checkout` (3), `mydarrin-produs` (4), `mydarrin-catalog` (2), `mydarrin-creeaza-deviz` (2), `mydarrin-marketplace-materiale`;
  - investitori și acces: `mydarrin-investitori` (3), `acces-temporar` (2), `acord-confidentialitate` (2), `mydarrin-panou-investitor`;
  - scripturi comune: `cont-dashboard.js` (3), `catalog-niveluri.js`;
  - formularul de newsletter din subsolul paginilor publice: `index`, `afla-ce-facem`, `cum-*`, `despre-noi`, `garantii-si-asigurari`, `ghidul-asiguratorului`, `intrebari-frecvente-*`, `mydarrin-contact`, `mydarrin-cum-functioneaza`, `mydarrin-politica-confidentialitate`, `mydarrin-termeni`, `reclamatii`, `servicii-urgente`.
- **Ferestrele native trecute pe MDFeedback:**
  - `mydarrin-dashboard-client`: `alert(...)` → `MDFeedback.toast('eroare', ...)`, la confirmarea și la contestarea livrării;
  - `mydarrin-dashboard-partener`: `confirm(...)` → `MDFeedback.confirma(...)`, cu `periculos` la ștergeri; `alert('Eroare: ' + ...)` → `MDFeedback.toast`; textele din `prompt(...)` trec prin dicționar;
  - `mydarrin-dashboard-furnizor`: ștergerea unui produs, prin `MDFeedback.confirma`.
- **Neschimbate:**
  - paginile care citeau deja `error_en`: `account-system.js`, `confirmare-livrare`, `cos-indicator.js`, `mydarrin-cos`, `investitori-ruta.js`, unele locuri din checkout;
  - superadminul, care rămâne în română și citește `error`.

## Profilurile de partener (punctul 4)
Profilurile noi sunt în `scripts/detector-ro.js --cu-cont --profil curier | materiale | asigurari`.
- Fiecare profil deschide paginile lui (dashboard, „Rolurile mele”, completarea profilului) la 390 și 1366 px.
- Pe fiecare pagină, detectorul trece prin meniu și prin fiecare panou din meniu.
- Apoi reia panourile cu API-urile în eroare, în forma comună, și verifică faptul că mesajul EN apare.
- Testul nou `scripts/test-profiluri-partener-en.js` le rulează automat, cu serverul local.

| Profil | Găsit (EN) | Reparat |
|---|---|---|
| Curier de cartier | bannerul de instalare a aplicației (2 texte); „Rază: 15 km” pe zona de acoperire; în faza de eroare: „📄 Vezi contractul”, etichetele din profil (Formă juridică, Țară · regiune, Cont bancar activ, Nr. reg. comerțului, Adresă sediu social), „Nu am putut încărca datele reale / facturarea: …” | dicționarul `i18n/en/mydarrin-dashboard-partener.json` (`_texte` + `_modele`) |
| Asigurător / broker | „Vezi toate →” pe cardul polițelor; „Limită: €… · Discount: …%” la tipurile de poliță; dialogurile de aprobare / respingere a daunei și de ștergere (`prompt` / `confirm`, doar în română) | dicționar; `MDFeedback.confirma`; textele din `prompt` traduse |
| Furnizor de materiale (extern) | numele coloanei CSV `tarif_zi`, luat drept text românesc | numele coloanelor CSV marcate `translate="no"` (sunt nume tehnice, nu se traduc); ștergerea unui produs prin `MDFeedback.confirma` |

## Detectorul pentru API (punctul 5)
`scripts/test-erori-api-bilingv.js` scanează static toate fișierele din `api/` și din `lib/`, cu lexerul din `scripts/scaneaza-erori-api.js`, care sare peste șiruri și comentarii. Testul cade la:
- `res.status(4xx|5xx)` scris direct, `res.status(<expresie>).json(...)` sau `res.sendStatus(4xx|5xx)`;
- `trimiteEroare(...)` fără mesajul RO sau fără mesajul EN;
- un mesaj EN identic cu cel RO, sau scris în română (după `scripts/recunoaste-ro.js`, fără numele de câmpuri);
- un `cod` literal care nu e scris cu litere mari.

Testul verifică întâi, pe exemple, că prinde fiecare abatere, ca să nu treacă degeaba.

**Excepții: niciuna.**
- Webhook-ul de email (`api/email/webhook-primire.js`) folosește tot forma comună: furnizorul citește doar statusul HTTP.
- `api/public/sitemap.xml.js` răspunde în XML doar la GET; la alte metode trimite eroarea 405 în forma comună.

## Ce nu s-a schimbat
- Logica, statusurile HTTP, designul, textele în română ale paginilor.
- Superadminul, care rămâne în română.

## Altele găsite pe parcurs
- `mydarrin-produs`: titlurile din „Recomandări” erau în română în modul EN. Acum folosesc `traduceri.en`, prin `trDb`.
- `scripts/test-bilingv-date-reale.js` (partea B) număra ca „fără engleză” 35 de niveluri cu eticheta „Standard”. Ele au `traduceri.en`, iar dicționarul public omite textele identice în cele două limbi. Testul acceptă acum și `traduceri.en` completat.
