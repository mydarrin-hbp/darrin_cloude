# Pasul 12-P2 (temporar, până la B2): la înscriere se alege categoria principală din arborele unic, nu profesia

Branch: `12p2-categorie-inscriere` → `main` (fără push și fără merge până la confirmarea LM).

**Fără migrare.** Datele se salvează în `partener_activare_ciorna.date.preinscriere`, care există deja.

## Ce se schimbă

### 1. API public nou: `/api/public/categorii?tip=servicii|materiale|inchirieri&lang=ro|en`
- Întoarce doar categoriile principale active din `categorii` (`parent_id` gol, `activ = true`), în ordinea `display_order`.
- Câmpuri: `id`, `slug`, `denumire` (EN: `title_en` / `traduceri.en.title`, cu rezervă pe `title`). Nimic intern, nicio dată personală.
- Cache 5 minute.
- Cu `&profesie=<slug>` (doar la servicii) spune și categoria legată de profesie: aceeași clasă NACE (`categorii.nace_ref`), prima în ordine. Exemplu: `instalator` (43.22) → „Instalații sanitare”.
- În bază, închirierile au `category_type = 'inchiriere'` (la singular); API-ul primește `tip=inchirieri`.

### 2. Pagina `/parteneri/inscriere`
- **La Servicii, Materiale și Închirieri:**
  - câmpul „Profesia” e înlocuit cu **„Categoria principală” / „Main category”**;
  - lista se schimbă când se schimbă tipul;
  - ultima opțiune e **„Altceva” / „Something else”**, cu un câmp de text opțional (max. 80);
  - câmpul e obligatoriu, dar „Altceva” e mereu o alegere validă (și fără text).
- **La Curier și Asigurări** câmpul nu apare.
- Sub câmp: „Profesia, serviciile și zona le alegi în panoul tău, după ce îți faci contul.” / „You choose your trade, services and area in your dashboard after you sign up.”
- Fără categorie: mesajul apare sub câmp (MDFeedback), cu focus pe câmp; valorile introduse rămân.
- **Reclamele:**
  - `?categorie=servicii` (și vechiul `?type=`) alege tipul, ca înainte;
  - `?domeniu=<slug>` preselectează categoria;
  - `?profesie=<slug>` se salvează ca indiciu (`profesie_slug`) și preselectează categoria legată, dacă există; altfel nu preselectează nimic;
  - `?domeniu=` are prioritate față de `?profesie=`;
  - „Aleasă deja din reclamă; o poți schimba.” apare doar la o preselecție.

  Linkurile reclamelor active (`?profesie=instalator`, `?categorie=…`, `?type=…`) merg mai departe.
- **Nimeni nu e blocat:**
  - dacă lista nu se poate încărca, rămâne doar textul opțional și contul se creează (salvat ca „Altceva”);
  - dacă o categorie e dezactivată între încărcarea paginii și cod, serverul o refuză, iar pagina salvează datele ca „Altceva”; partenerul ajunge în panou și alege din nou acolo.

### 3. Salvarea și verificarea pe server
În `date.preinscriere` se salvează:
- `categorie_id`, `categorie_slug`, `categorie_denumire` (și `categorie_denumire_en`, pentru panoul în engleză);
- sau `categorie_altceva: true` + `categorie_text`;
- `profesie_slug`, doar ca indiciu;
- ca înainte: `categorie` (tipul), `rol`, `oras`, `creat_la`;
- `nace`: din profesia din reclamă sau din categorie. Precompletează codul NACE la pasul „Profesii”, ca înainte.

`/api/partener/activare-ciorna` verifică pre-înscrierea când se schimbă (`lib/categorii-inscriere.js`):
- `categorie_id` trebuie să existe, să fie activ, principal și de tipul ales; altfel 400 `CATEGORIE_INVALIDA` / `CATEGORIE_ALT_TIP` pe câmpul `categorie_id`, cu mesaj RO + EN;
- la Servicii, Materiale și Închirieri cere un `categorie_id` valid sau „Altceva” (`CATEGORIE_OBLIGATORIE`);
- textul se curăță: fără HTML, fără caractere de control, max. 80;
- slug-ul și denumirile se iau din bază, nu din cerere;
- salvarea automată a pașilor (care trimite aceeași pre-înscriere) nu se mai verifică, deci nu e blocată dacă o categorie devine inactivă mai târziu;
- la DELETE (după contract) restul ciornei se șterge, dar categoria rămâne: e singurul loc unde e salvată.

### 4. Panoul partenerului
- Primul rând din „Ce mai ai de făcut” e **„Ce lucrări faci” / „What work you do”**. Nu intră în cei 6 pași, deci „{n} din 6” nu se schimbă.
- Rândul deschide, în același panou, portofoliul existent (`/api/partener/portofoliu`):
  - serviciile din categoria aleasă (și din subcategoriile ei) apar primele, sub „Din categoria ta: …”, apoi „Alte servicii”;
  - bifarea arată „Se salvează…”, apoi „✓ Salvat” sau „✕ Nu s-a salvat” după răspunsul serverului; la eroare bifa revine;
  - nu e ecran nou: aceleași carduri și rânduri ale panoului.
- Subtitlul și cardul turcoaz arată categoria aleasă (de exemplu „Comenzi în zona ta · Instalații sanitare · Iași”).
- `/api/partener/portofoliu` merge acum și pentru contul nou: rolul de partener ales la înscriere (`rol_solicitat`), fără rând în `partners`. Înainte, contul nou primea 403.

### 5. Back-office
În superadmin → Parteneri, sub tipul partenerului, apare:
- „Categorie: Instalații sanitare”;
- sau „Categorie scrisă de partener: „…””.

Datele vin din `/api/admin/parteneri-lista` (`categorie_inscriere`).

## Câmpurile obligatorii pe tot drumul

| Etapă | Câmpuri obligatorii | Ce poate bloca |
|---|---|---|
| **Pre-înscriere** | tipul (implicit Servicii); categoria principală (doar S / M / Î; „Altceva” e mereu validă; fără listă nu se cere); orașul; prenumele; numele; telefonul (cu prefixul țării); emailul; parola (min. 8); acordul pentru Termeni și Politica de confidențialitate | emailul are deja cont (apare linkul de logare / recuperare); limita de emailuri a Supabase |
| **Codul** | codul de 6 cifre din email | codul expirat sau greșit (retrimitere după 45 s) |
| **Panoul** | nimic | — |
| **1. Firma** | forma juridică; CUI; denumirea (firmă străină: și forma juridică locală) | CUI folosit de alt cont (409); firmă inactivă / radiată la ANAF; **persoana fizică fără PFA / II / firmă nu poate trece** (regula existentă) |
| **2. Cont bancar** | titularul; IBAN valid; banca; moneda | IBAN invalid |
| **3. Profesii** | codul NACE principal (precompletat din categorie sau profesie); curier: județul și raza 1–200 km | la închirieri, categoriile nu au NACE: se alege manual |
| **4. Dotări** | servicii / închirieri: cel puțin un utilaj sau o sculă; curier: vehiculul; materiale: cel puțin un produs în catalog; asigurări: cel puțin un tip de poliță | la materiale, pasul cere catalogul plin |
| **5. Documente** | cel puțin un document (PDF / JPG / PNG, max. 10 MB) | — |
| **6. Contract** | codul OTP din email | se semnează doar după aprobarea firmei |

Pașii 2–6 așteaptă firma (pasul 1), ca înainte.

**Reparat aici:** singurul lucru care bloca crearea contului, profesia obligatorie din 23 de meserii.

**Doar raportate**, nu blochează crearea contului:
- persoana fizică fără firmă;
- catalogul obligatoriu la materiale;
- NACE manual la închirieri.

## Testele
**`scripts/test-preinscriere-partener.js`: 433 / 433** (înainte 229).
- **Server:**
  - `/api/public/categorii`: doar active, pe tip, ordinea, RO / EN, `?profesie=`, tip invalid → 400;
  - refuzul categoriei inexistente, inactive, subcategorie sau de alt tip;
  - „Altceva” cu text curățat; curier și asigurări fără categorie;
  - API-ul ciornei: 400 pe `categorie_id`, ce se salvează, salvarea automată neblocată, DELETE;
  - portofoliul contului nou: categoria aleasă primele, 403 fără rol de partener;
  - back-office.
- **Browser, RO și EN, la 390 și 1366 px:**
  - lista schimbată cu tipul; „Altceva”;
  - câmpul lipsă la curier și asigurări;
  - `?domeniu=`, `?profesie=instalator`, `?type=`;
  - eroarea sub câmp;
  - lista indisponibilă; categoria refuzată după cont;
  - cele 5 tipuri până la ciorna salvată;
  - „Ce lucrări faci”: ordinea, bifarea cu feedback, eroarea;
  - un singur buton portocaliu, fără depășiri, 0 erori JS, 0 texte românești în EN.

**Suita completă:** 99 / 101 fișiere trec. Cele 2 care pică, pică **identic pe `main`**, deci nu vin din acest pas:
- `test-pagini-destinatie`: `genereaza-pagini-destinatie.js --verifica` spune că unele pagini de destinație nu sunt la zi (pagini neatinse aici);
- `test-panou-investitor`: 7 erori de consolă, cererea spre `ipapi.co`, blocată local (CORS).

**Detectorul EN:** 0 texte românești, 80 de combinații pagină × lățime, 0 erori JS, 0 depășiri. `scripts/server-test.js` simulează acum `/api/public/categorii`, ca detectorul să vadă lista.

## Capturi (`docs/capturi-12p2/`, 390 px, RO și EN)
- Înainte:
  - `inainte-preinscriere-*` (câmpul „Profesia”);
  - `inainte-panou-*`.
- După:
  - `dupa-preinscriere-*` (din reclamă, categoria preselectată);
  - `dupa-preinscriere-materiale-*`;
  - `dupa-preinscriere-altceva-*`;
  - `dupa-preinscriere-curier-*` (fără câmp);
  - `dupa-preinscriere-eroare-*`;
  - `dupa-panou-*`;
  - `dupa-lucrari-*`.

## De știut / de decis de LM
1. **Unde stă „Ce lucrări faci”:** l-am pus primul în listă, deasupra lui „Cont creat”, cum cere pasul. Textul de sub titlu rămâne „Începi cu firma; restul îl faci în ce ordine vrei.”
2. **Acces mai larg la portofoliu:** contul care a ales un rol de partener poate bifa servicii înainte de firmă. Bifarea nu aduce comenzi: alocarea cere și disponibilitatea în zonă, iar acceptarea cere aprobarea, contractul și IBAN-ul (neschimbate, verificate în test).
3. **Ordinea „categoria aleasă primele”** funcționează azi doar la servicii. Produsele de materiale (38) și închirieri (10) din catalog nu au `categorie_id` completat.
4. **Lista din back-office** arată doar partenerii cu firmă salvată (rând în `partners`). Conturile care n-au trecut de pasul 1 nu apar acolo (ca înainte).
5. **Diferență față de audit:** închirierile au 7 categorii principale, dar **0 subcategorii** în bază (serviciile au 30, materialele 20).
6. **Profesia din reclamă** e legată de categorie prin codul NACE. „Zugravi și vopsitori” (43.30) nu are categorie cu același cod („Zugrăveli & Finisaje” are 43.34), deci nu preselectează nimic.

## Ce nu s-a testat
- Pe un telefon real (doar Chromium, prin Playwright).
- Pe baza reală: datele din teste sunt simulate. Structura tabelului `categorii` și numerele de mai sus le-am citit din producție, doar cu SELECT.

## Commit-uri
| Commit | Descriere |
|---|---|
| `4c43828` | (A) `lib/categorii-inscriere.js`, `/api/public/categorii`, verificarea în `/api/partener/activare-ciorna` |
| `6756d8b` | (B) Pagina de înscriere: „Categoria principală”, „Altceva”, parametrii din reclame (RO + EN) |
| `d2e7bc1` | (C) Panoul: „Ce lucrări faci”, portofoliul cu categoria aleasă primele (RO + EN) |
| `e2fcda3` | (D) Back-office: categoria în fișa partenerului |
| `bf4a3dc` | (E) Testele |
| `b1e9e82` | (F) Capturile și categoriile simulate pentru detector |
| _(acest commit)_ | `PR.md` |

**Fișiere noi:**
- `lib/categorii-inscriere.js`;
- `api/public/categorii.js`;
- `docs/capturi-12p2/`.

**Fișiere modificate:**
- `mydarrin-inscriere-partener.html`, `inscriere-partener.js`, `cont-fereastra.js`;
- `panou-cont-nou.js`;
- `api/partener/activare-ciorna.js`, `api/partener/portofoliu.js`, `api/admin/parteneri-lista.js`;
- `mydarrin-superadmin.html`;
- `i18n/en.json`, `i18n/en/mydarrin-inscriere-partener.json`;
- `scripts/test-preinscriere-partener.js`, `scripts/server-test.js`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
