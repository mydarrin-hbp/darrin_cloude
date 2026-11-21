# Pasul 12-P2 (temporar, până la B2): înscriere fără profesie și fără categorie, după macheta R1; alocarea doar spre parteneri eligibili

Branch: `12p2-categorie-inscriere` → `main` (fără push și fără merge până la confirmarea LM).

**Fără migrare.** Datele se salvează în `partener_activare_ciorna.date.preinscriere`, care există deja.

**Macheta R1** (aprobată de LM pe 21 nov.) înlocuiește prima variantă a pasului, cea cu câmpul „Categoria principală” și „Altceva”. Ce scrie mai jos e starea finală a branch-ului.

## Ce se schimbă

### 1. Formularul `/parteneri/inscriere`
- La crearea contului rămân doar:
  - tipul (Servicii · Materiale · Închirieri · Curier · Asigurări);
  - prenumele și numele;
  - telefonul;
  - emailul;
  - parola;
  - acordul pentru Termeni și Politica de confidențialitate.
- **Scoase**, în RO și EN:
  - profesia (lista celor 23 de meserii, care bloca înscrierea);
  - „Categoria principală” și „Altceva” cu text liber;
  - **orașul** (vezi „De decis”, punctul 1).
- Cheile de traducere rămase fără folos sunt șterse:
  - din `i18n/en/mydarrin-inscriere-partener.json`, 14: cele 6 vechi (profesia, orașul, două nume de profesii) și cele 8 adăugate în prima variantă;
  - din `i18n/en.json`, cele 3 ale primei variante din panou („Primele: …”, „Din categoria ta…”).

  Un test verifică acum că dicționarul paginii nu mai are chei nefolosite.

### 2. Indiciul din reclame (ascuns)
- `?categorie=` (și vechiul `?type=`) alege tipul, ca înainte.
- `?domeniu=<slug>` și `?profesie=<slug>` nu apar ca întrebare. Se salvează în ciornă, iar serverul le verifică:
  - `?domeniu=`: slug-ul unei categorii principale active a tipului ales → `categorie_id`, `categorie_slug`, denumirile RO / EN din bază, `categorie_sursa: 'domeniu'`;
  - `?profesie=`: profesia cunoscută se păstrează ca `profesie_slug`; la servicii, dacă lipsește `?domeniu=`, dă categoria cu același cod NACE (de exemplu `instalator` → „Instalații sanitare”), cu `categorie_sursa: 'profesie'`;
  - orice slug necunoscut, greșit, inactiv, subcategorie sau de alt tip **se ignoră fără eroare**;
  - la curier și asigurări, indiciul de categorie se ignoră.
- Indiciul ordonează „Ce lucrări faci” din panou. Nu apare ca alegere a partenerului: nici în salut, nici pe cardul turcoaz.
- Linkurile reclamelor active merg mai departe.

### 3. Serverul (`lib/categorii-inscriere.js`, `/api/partener/activare-ciorna`)
- La pre-înscriere nu mai e nimic obligatoriu în afară de tip.
- Textul liber la categorie (`categorie_text` / `categorie_altceva`) **nu se mai acceptă**: 400 `CATEGORIE_TEXT_NEACCEPTAT`, mesaj RO + EN.
- Un `categorie_id` trimis explicit se verifică ca înainte: inexistent, inactiv sau subcategorie → `CATEGORIE_INVALIDA`; de alt tip → `CATEGORIE_ALT_TIP` (400 pe câmpul `categorie_id`).
- Pre-înscrierea se verifică doar când se schimbă. Salvarea automată a pașilor nu e blocată nici dacă o categorie devine inactivă mai târziu.
- La DELETE (după contract), restul ciornei se șterge, dar indiciul rămâne.
- Dacă serverul refuză totuși o categorie după ce contul există (de exemplu, o sesiune veche), pagina salvează datele fără categorie. Partenerul nu rămâne blocat.

### 4. Panoul partenerului (neschimbat față de prima variantă, cu o excepție)
- „Ce lucrări faci” / „What work you do” e primul rând din „Ce mai ai de făcut”, deasupra lui „Cont creat”. Nu intră în cei 6 pași.
- Rândul deschide portofoliul existent (`/api/partener/portofoliu`):
  - serviciile din categoria indicată de reclamă (și din subcategoriile ei) apar primele;
  - bifarea afișează mesajele MDFeedback („Se salvează…” → „✓ Salvat” / „✕ Nu s-a salvat”, după răspunsul serverului).
- **Excepția:** titlul grupului e acum „Recomandate pentru tine: …” / „Recommended for you: …”, în loc de „Din categoria ta: …”. Partenerul nu mai alege categoria, deci „a ta” nu mai era adevărat.
- `/api/partener/portofoliu` merge și pentru contul nou (rol ales la înscriere, fără firmă).

### 5. Back-office
În superadmin → Parteneri, sub tipul partenerului:
- apare „Indiciu din reclamă: Instalații sanitare”, doar dacă există un indiciu;
- altfel nu apare nimic.

### 6. Alocarea automată (reparație, cerută de LM)
- `lib/aloca-partener.js` filtrează candidații cu serviciul bifat prin regula unică `poatePrimiComenzi` (`lib/eligibilitate-partener.js`): aprobat, contract semnat, cont bancar activ, cont nesuspendat; furnizorul propriu, aprobat.
- Starea se citește o singură dată, cu `incarcaEligibilitate`.
- Abia apoi urmează competențele, disponibilitatea (`status_live`), zona și echipa, ca înainte.
- Fără niciun partener eligibil, comanda rămâne `in_cautare_partener`, cu motivul `niciun_partener_eligibil`.
- Dacă eligibilitatea nu se poate citi, comanda tot rămâne în căutare (`eligibilitate_indisponibila`); nu se alocă fără verificare.
- În log apar doar id-ul comenzii și numărul de candidați pe motiv, de exemplu `{"fara_contract":1}`. Fără id de partener, nume sau email.

**Locurile care scriu `comenzi.partener_id`:**

| Loc | Regula |
|---|---|
| `lib/aloca-partener.js` (alocarea automată; apelat din `api/comenzi/creeaza.js` și `api/admin/comenzi-b2g.js`) | **reparat acum**: `poatePrimiComenzi` |
| `api/partener/accept-comanda.js` (partenerul acceptă) | folosea deja `poatePrimiComenzi` (neschimbat) |

În afara codului, în producție (citit doar cu SELECT): tabelul `comenzi` are doar politici RLS de citire, iar funcțiile SQL care îl ating doar raportează. Clientul nu poate scrie `partener_id`.

`lib/aloca-subcontractori.js` scrie subcontractorii comenzii (`partener_id` pe alt tabel) și folosea deja regula unică (`parteneriCarePotVinde`).

**Efect în producție:** singurul partener „disponibil” azi e aprobat, dar fără contract semnat. După publicare nu mai primește comenzi alocate automat până semnează contractul.

## Câmpurile obligatorii pe tot drumul

| Etapă | Câmpuri obligatorii | Ce poate bloca |
|---|---|---|
| **Pre-înscriere** | tipul (implicit Servicii); prenumele; numele; telefonul (cu prefixul țării); emailul; parola (min. 8); acordul | emailul are deja cont (apare linkul de logare / recuperare); limita de emailuri a Supabase |
| **Codul** | codul de 6 cifre din email | codul expirat sau greșit (retrimitere după 45 s) |
| **Panoul** | nimic | — |
| **1. Firma** | forma juridică; CUI; denumirea (firmă străină: și forma juridică locală) | CUI folosit de alt cont (409); firmă inactivă / radiată la ANAF; **persoana fizică fără PFA / II / firmă nu poate trece** (regula existentă) |
| **2. Cont bancar** | titularul; IBAN valid; banca; moneda | IBAN invalid |
| **3. Profesii** | codul NACE principal (precompletat din indiciu, dacă există); curier: județul și raza 1–200 km | la închirieri, categoriile nu au NACE: se alege manual |
| **4. Dotări** | servicii / închirieri: cel puțin un utilaj sau o sculă; curier: vehiculul; materiale: cel puțin un produs în catalog; asigurări: cel puțin un tip de poliță | la materiale, pasul cere catalogul plin |
| **5. Documente** | cel puțin un document (PDF / JPG / PNG, max. 10 MB) | — |
| **6. Contract** | codul OTP din email | se semnează doar după aprobarea firmei |

Pașii 2–6 așteaptă firma (pasul 1), ca înainte. **Comenzile** vin doar după aprobare, contract și IBAN, acum și la alocarea automată.

**Doar raportate** (nu blochează crearea contului):
- persoana fizică fără firmă;
- catalogul obligatoriu la materiale;
- NACE manual la închirieri.

## Testele
| Test | Rezultat | Ce verifică |
|---|---|---|
| `scripts/test-preinscriere-partener.js` | **401 / 401** | vezi mai jos |
| `scripts/test-alocare-eligibilitate.js` (nou) | **12 / 12** | vezi mai jos |

**`test-preinscriere-partener.js`:**
- **Server:**
  - `/api/public/categorii`: active, pe tip, ordinea, RO / EN, `?profesie=`;
  - pre-înscrierea: doar tipul obligatoriu; indiciul valid / necunoscut / inactiv / subcategorie / de alt tip / greșit / prea lung; `?domeniu=` înaintea lui `?profesie=`; `categorie_id` verificat; text liber refuzat;
  - API-ul ciornei: ce se salvează, refuzurile, salvarea automată, DELETE;
  - portofoliul contului nou; back-office (indiciul doar dacă există);
  - dicționarul paginii fără chei nefolosite.
- **Browser, RO + EN, 390 și 1366 px:**
  - formularul are exact câmpurile R1; obligatoriile marcate sub câmp (MDFeedback);
  - cele 5 tipuri până la ciornă și panou;
  - 10 combinații de parametri din reclame, inclusiv cele invalide, fără eroare;
  - indiciul dezactivat între pagină și cod; `categorie_id` refuzat după cont, fără blocaj;
  - „Ce lucrări faci” primul, cu „Recomandate pentru tine”, bifarea cu feedback;
  - un singur buton portocaliu, fără depășiri, 0 erori JS, 0 texte românești în EN.

**`test-alocare-eligibilitate.js`** (cele 9 cazuri cerute):
- control eligibil → alocat;
- `status_live` „indisponibil” și fără rând de disponibilitate → nealocate;
- neaprobat, respins, fără contract, fără IBAN, suspendat, cont nou 12-P2 fără firmă → nealocate, comanda rămâne `in_cautare_partener`;
- în plus: un candidat neaprobat lângă unul eligibil → e ales cel eligibil; jurnalul fără id / firmă / email; eligibilitatea necitibilă → comanda rămâne în căutare.

Înainte de reparație, 6 din cele 9 cazuri picau.

`test-regiune.js`: modulul de eligibilitate înlocuit în test (unde toți partenerii sunt eligibili) a primit și funcțiile noi; 21 / 21.

**Suita completă: 100 / 102 fișiere trec.**
- Prima rulare: 98 / 102.
  - `test-emailuri-cod` și `test-fereastra-cont` completau încă orașul scos. Le-am aliniat, iar la reluare trec: 117 / 117 și 422 / 422.
- Cele 2 care pică, pică și pe `main` și nu țin de acest pas:
  - `test-pagini-destinatie`: `✗ genereaza-pagini-destinatie.js --verifica: ✗ /parteneri/asigurari: ghidul-asiguratorului.html nu e la zi … | ✗ /investitori: mydarrin-investitori.html nu e la zi …`. Diferența e doar de terminații de rând (CRLF pe Windows); conținutul e identic.
  - `test-panou-investitor`: 7 × `✗ console: Access to fetch at 'https://ipapi.co/json/' … has been blocked by CORS policy`. Depinde de rețea: pe `main` și pe branch a picat și a trecut la fel; fișierele investitorului nu sunt atinse.

**Detectorul EN:** 0 texte românești, 80 de combinații pagină × lățime (inclusiv `/parteneri/inscriere` și `?profesie=instalator`, la 390 și 1366 px), 0 pagini nerandate, 0 erori JS, 0 depășiri.

## Capturi (`docs/capturi-12p2/`, 390 px, RO și EN)
- Înainte:
  - `inainte-preinscriere-*` (câmpul „Profesia” și orașul);
  - `inainte-panou-*`.
- După:
  - `dupa-preinscriere-*` (formularul R1, din reclamă);
  - `dupa-preinscriere-materiale-*`;
  - `dupa-preinscriere-eroare-*` (obligatoriile sub câmp);
  - `dupa-panou-*` („Ce lucrări faci” primul);
  - `dupa-lucrari-*` („Recomandate pentru tine”, „✓ Salvat”).
- Capturile primei variante („Altceva”, Curier cu categorie) sunt scoase.

## De decis / de știut
1. **Orașul scos:** „rămân doar tipul, numele, emailul, telefonul, parola și acordul” nu include orașul, așa că l-am scos.
   - Efecte: cardul turcoaz din panou nu mai arată orașul („Comenzi în zona ta · Furnizor de Servicii”); la curier, localitatea nu mai e precompletată la pasul „Profesii”.
   - Zona se alege oricum în panou. Dacă orașul trebuie păstrat, revin cu el.
2. **„Recomandate pentru tine”** în loc de „Din categoria ta” (motivul e mai sus, la punctul 4).
3. **Alocarea:** partenerul de azi fără contract nu mai primește comenzi automat după publicare.
4. **Ordonarea după indiciu** funcționează azi doar la servicii: produsele de materiale (38) și închirieri (10) din catalog nu au `categorie_id`.
5. **Lista din back-office** arată doar partenerii cu firmă salvată (ca înainte).
6. **Închirierile** au 7 categorii principale și **0 subcategorii** în bază.
7. **Testele care picau la prima rulare** (și pe `main`):
   - `test-pagini-destinatie`: diferența e doar de terminații de rând (CRLF pe Windows, din `core.autocrlf`); conținutul paginilor e identic;
   - `test-panou-investitor`: cereri spre `ipapi.co`, dependente de rețea; la reluare a trecut pe ambele.

## Ce nu s-a testat
- Pe un telefon real (doar Chromium, prin Playwright).
- Pe baza reală: datele din teste sunt simulate. Structura tabelelor, politicile RLS și numerele de mai sus le-am citit din producție, doar cu SELECT.

## Commit-uri
| Commit | Descriere |
|---|---|
| `4c43828` | (A) `lib/categorii-inscriere.js`, `/api/public/categorii`, verificarea în `/api/partener/activare-ciorna` |
| `6756d8b` | (B) Pagina de înscriere, prima variantă (categorie + „Altceva”) |
| `d2e7bc1` | (C) Panoul: „Ce lucrări faci”, portofoliul ordonat |
| `e2fcda3` | (D) Back-office |
| `bf4a3dc` | (E) Testele, prima variantă |
| `b1e9e82` | (F) Capturile, prima variantă, și categoriile simulate pentru detector |
| `5edec85` | `PR.md`, prima variantă |
| `e325b9c` | (G) Alocarea automată doar spre partenerii eligibili + `test-alocare-eligibilitate.js` |
| `e20a2ff` | (H) Macheta R1: formular fără categorie / oraș, indiciul ascuns, text liber refuzat, back-office, testele și capturile refăcute |
| `420042e` | (I) `test-emailuri-cod`, `test-fereastra-cont` aliniate la formularul fără oraș |
| _(acest commit)_ | `PR.md` |

**Fișiere noi:**
- `lib/categorii-inscriere.js`;
- `api/public/categorii.js`;
- `scripts/test-alocare-eligibilitate.js`;
- `docs/capturi-12p2/`.

**Fișiere modificate:**
- `mydarrin-inscriere-partener.html`, `inscriere-partener.js`, `cont-fereastra.js`, `panou-cont-nou.js`;
- `api/partener/activare-ciorna.js`, `api/partener/portofoliu.js`, `api/admin/parteneri-lista.js`;
- `lib/aloca-partener.js`;
- `mydarrin-superadmin.html`;
- `i18n/en.json`, `i18n/en/mydarrin-inscriere-partener.json`;
- `scripts/test-preinscriere-partener.js`, `scripts/test-regiune.js`, `scripts/test-emailuri-cod.js`, `scripts/test-fereastra-cont.js`, `scripts/server-test.js`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
