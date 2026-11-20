# Pasul 12-L1: paginile de destinație după macheta L1, cu conținutul editabil din back-office

Branch: `12l1-pagini-destinatie` → `main` (fără push și fără merge până la confirmarea LM).

**Înainte de merge:** LM rulează migrarea `docs/migrations-propuse/2026-11-19_pagini-destinatie.sql` în SQL Editor (SHA-256 mai jos). Fără migrare, paginile se afișează cu textele implicite, iar tabul din back-office spune „aplicați migrarea”.

## Ce se schimbă

### Primul ecran (macheta L1.1–L1.4)
Pe `/parteneri`, `/parteneri/servicii`, `/materiale`, `/inchirieri`, `/curieri`, `/asigurari` și `/investitori`, primul ecran are:
- eticheta;
- titlul;
- subtitlul;
- 3 beneficii;
- un singur buton portocaliu;
- textul de sub buton.

Totul încape fără derulare la 360 × 640 și la 390 × 844, în RO și în EN.

Cele 5 categorii de partener folosesc același șablon (`landing.css`). Markup-ul îl scrie `scripts/genereaza-pagini-destinatie.js` din sursa unică `lib/landing-pagini.js`, cu textele RO + EN. Testul pică dacă paginile nu sunt la zi.

Textele de pe `/parteneri/servicii` sunt cele din machetă, în forma generală. Exemplul „Instalator? …” din machetă a devenit varianta „instalatori”.

### Butonul merge din prima secundă
- **Destinația e scrisă în HTML:**
  - categoriile: `/parteneri/inscriere?categorie=<categorie>`;
  - `/parteneri`: `/parteneri/inscriere`;
  - `/investitori`: `/investitori?ruta=investitor`, adică fluxul existent din 11-I2.
- **Parametrii adresei:** un script mic, scris imediat după buton, adaugă `profesie`, `lang` și UTM-urile, înainte de `DOMContentLoaded` și de orice cod de sesiune. `fbclid` nu se transmite.
- **`cta-partener.js`:**
  - nu mai ascunde butonul;
  - nu mai schimbă destinația vizitatorului (nici spre `#tipuri`);
  - după sesiune schimbă textul și destinația doar pentru conturile de partener (activare, verificare, activ): „Mergi în panoul tău”, spre dashboard.
- **Adresele vechi cu `?type=`** (ex. `/mydarrin-devino-partener?type=curier`, redirecționată 301 spre `/parteneri?type=curier`): același script transformă `type` în `categorie`, iar cardul tipului e marcat pe hub, ca înainte.
- **Butonul din meniul „Devino partener”** are acum direct `/parteneri/inscriere`.
- **Investitori:** butonul se numește „Creează cont de investitor”. Vizitatorul primește fereastra de cont de azi (cont fără date de identitate, KYC doar la „Investește”).

> **De decis de LM:** clientul conectat fără rol de partener păstrează comportamentul de azi: linkul rămâne, iar clicul alege tipul pe contul existent. Altfel ar ajunge la pre-înscriere și și-ar face un al doilea cont. Dacă LM vrea strict linkul, se scoate un singur bloc din `cta-partener.js`.

### Sub primul ecran
- **Categoriile:**
  - imaginea campaniei, doar dacă varianta publicată are una;
  - „Cum funcționează” în 3 pași;
  - linkul spre `/parteneri/intrebari#<categorie>`.
- **`/parteneri`:** cele 5 carduri de categorie, cu `data-cta="categorie-<tip>"`, și linkul spre întrebări.
- **`/investitori`:**
  - „Runda curentă”, doar cu valorile publicate din `/api/public/runda-curenta`. Fără rundă activă, secțiunea și linkul „Runda” din meniu lipsesc. Nicio cifră nu e scrisă în cod.
  - „Cum devii investitor” în 3 pași, apoi „Pașii în detaliu” (închis) și parcursul investitorului.
  - Pitch deck-ul, panoul și contactul rămân neschimbate.

### Ce s-a mutat în `/parteneri/intrebari`
Secțiune nouă, „Pe tipuri de partener” (`#pe-tipuri`), cu ancore pe tip: `#general`, `#servicii`, `#materiale`, `#inchirieri`, `#curieri` și `#asigurari`. Fiecare bloc are textul de azi, neschimbat, cu traducerea EN existentă (284 de texte, 0 lipsă).

| Pagina | Ce s-a mutat |
|---|---|
| `/parteneri` | Tipurile de parteneriat (descrierile celor 5 carduri vechi); „Pașii înregistrării” (4 pași); cele 5 întrebări (documente, aprobare, escrow, comision, factură) |
| `/parteneri/servicii` | Ce câștigi (3); Ce îți trebuie la activare (6 + nota); Pas cu pas (5); 5 întrebări; „Modelul My Darrin, pe scurt” |
| `/parteneri/materiale` | Ce câștigi (3); Ce îți trebuie (6); Pas cu pas (5); 4 întrebări; Modelul + categoriile de materiale acceptate |
| `/parteneri/inchirieri` | Ce câștigi (3); Ce îți trebuie (6); Pas cu pas (5); 4 întrebări; Modelul + categoriile de echipamente acceptate |
| `/parteneri/curieri` | Ce câștigi (3); Ce îți trebuie (6); Pas cu pas (4); 3 întrebări; Modelul |
| `/parteneri/asigurari` | Ce câștigi (3); Ce îți trebuie (6); Pas cu pas (4); 5 întrebări; tabelele „Comparativ acoperire client” și „Constatarea și plata daunelor” |
| `/investitori` | Cei 7 pași detaliați au rămas pe pagină, în „Pașii în detaliu” (închis) |

Propoziția „Înscrierea e pentru firme, PFA și întreprinderi individuale.” (decizia LM din 25 oct.) rămâne pe `/parteneri` și pe cele 5 categorii, sub primul ecran.

**Scos, pentru că nu mai e folosit:**
- insigna „GRATUIT” și butonul secundar „Cum funcționează ↓”;
- banda finală „Gata să…” și bara fixă de pe telefon (paginile de partener);
- rândul „Alte întrebări? Contactează-ne” (există pe pagina de întrebări);
- insigna „Runda curentă: …” din hero-ul investitorilor;
- textul „Nu există acum o rundă deschisă publicului”;
- din dicționarele EN ale celor 6 pagini de partener: 555 de intrări care nu mai apar nicăieri (nici în pagină, nici în scripturi). Pe `/investitori` s-au scos doar cele 5 ale blocurilor înlocuite.

### Back-office → SEO → „Pagini de destinație” (macheta L1.5)
În `mydarrin-superadmin.html` → SEO există acum două secțiuni: „Titluri, partajare și campanii” (cea de azi) și „Pagini de destinație” (`seo-panou-landing.js`). Pagina internă rămâne în română.
- **Lista:** cele 7 pagini și variantele fiecăreia: „Implicită” plus câte una pe `utm_campaign`, fiecare cu starea ei (Din fișier / Ciornă / Publicată vN / Modificată).
- **Câmpurile, pe limbă (tab Română / English), cu contoare:**
  - eticheta (40);
  - titlul (60);
  - subtitlul (140);
  - beneficiile 1–3 (60);
  - textul butonului (24);
  - textul de sub buton (60);
  - textul alternativ al imaginii (140).

  Limitele se verifică în panou, pe server și în baza de date.
- **Ciornă / Publică:**
  - publicul vede doar varianta publicată;
  - publicarea cere RO și EN complete. Fără EN, mesajul spune ce lipsește și se deschide tabul „English”, cu câmpurile marcate;
  - fiecare publicare mută versiunea anterioară în istoric;
  - „Revino la vN” publică din nou acea versiune, ca versiune nouă, după confirmarea în fereastra proprie (MDFeedback).
- **Previzualizarea:** telefon (390 px) sau desktop (1280 px), cu stilul real al paginii, din ciorna din formular.
- **Linkul pentru reclamă:** ex. `https://mydarrin.homebestpal.com/parteneri/servicii?utm_campaign=instalatori&profesie=instalator`, cu „Copiază”. Adresa vine din `SITE_URL` (12-U1).
- **Imaginea:**
  - se convertește în browser în WebP: latura mare de cel mult 1600 px, cel mult 300 KB, fără EXIF / XMP, în 3 mărimi (1600 / 800 / 480) pentru `srcset`;
  - se încarcă direct în Storage, pe adresa semnată, ca în `seo-panou-media.js`;
  - serverul verifică conținutul: WebP real, ≤ 300 KB, ≤ 1600 px, fără EXIF / XMP. Altfel fișierul se șterge și mesajul explică de ce.
  - Pe pagina publică: `srcset` + `sizes`, `loading="lazy"`, `fetchpriority="low"`, cu lățimea și înălțimea scrise. Imaginea e sub primul ecran și nu întârzie titlul.
- **Permisiuni:**
  - citirea: dreptul SEO (`lib/permisiuni-seo.js`);
  - scrierea: SEO cu `poate_scrie`, altfel 403;
  - erorile au forma comună (`trimiteEroare`), RO + EN, cu câmpul greșit;
  - salvările folosesc MDFeedback, fără `alert(` / `confirm(`;
  - fiecare scriere se auditează.

### Pagina publică și varianta campaniei
- **Fără `utm_campaign`:** conținutul implicit din HTML și din dicționarele RO / EN se afișează imediat, fără să aștepte API-ul.
- **Cu `utm_campaign`:**
  - doar textele primului ecran sunt ascunse vizual (locul lor rămâne), cel mult 300 ms;
  - varianta publicată sosită în fereastra de 300 ms se aplică; mai târziu nu (rămâne implicita, fără schimbări bruște);
  - nepublicată sau inexistentă → implicita.
- **„Implicită”, publicată din back-office,** se aplică tot în fereastra de 300 ms, dar fără ascundere. Ca textul nou să fie în HTML de la prima afișare, LM poate cere actualizarea lui la următoarea publicare de cod.
- **API-ul public:** `/api/public/landing`, cu cache de 60 s (CDN + memorie). Întoarce doar rânduri publicate, fără autor sau date interne.

### Viteza
- **Cauza:** cele 7 pagini foloseau Tailwind de pe CDN, adică ~100 KB de JavaScript, compilat în browser, cu ~1 s de procesor pe telefon.
- **Ce s-a schimbat:**
  - același CSS, precompilat: `landing-tailwind.css`, 14 KB, 3,6 KB comprimat. Îl generează `scripts/genereaza-tailwind-destinatie.js`, iar testul verifică amprenta claselor;
  - Lucide și DOMPurify se încarcă acum cu `defer`;
  - fonturile Google (Syne, Inter), nefolosite pe aceste pagini, au fost scoase.
- Antetul, meniul și subsolul arată la fel (capturile).

### Măsurarea (pregătită pentru 12-M1)
- `data-cta="principal"` pe butonul principal și `data-cta="categorie-<tip>"` pe cardurile de pe `/parteneri`.
- `partner_landing_view` primește `variant`: `default` sau numele campaniei. Cheia permisă e nouă în `masurare.js`, iar evenimentul pleacă după alegerea variantei (≤ 300 ms).

### Butoanele plutitoare
`landing.js` compară dreptunghiurile la derulare și la redimensionare. Dacă butonul de distribuire sau Darrin AI s-ar suprapune peste butonul principal, se ascunde cât durează suprapunerea.

Pe paginile scurte, butonul „Abonează-te” din subsol intra în primul ecran pe telefon. Pe aceste pagini e bleumarin, ca în primul ecran să rămână un singur buton portocaliu.

## Migrarea
`docs/migrations-propuse/2026-11-19_pagini-destinatie.sql` — SHA-256: `884348160858a4f762e993c3b7c1a3dd066f069762996d1b70791c99c1a9867b` (fișierul din repo, cu capete de rând LF)
- `landing_continut`: pagina, varianta, limba, starea (ciorna / publicat), câmpurile cu limitele lor, imaginea, profesia, versiunea, autorul, datele. Cheie unică (pagina, varianta, limba, stare).
- `landing_continut_istoric`: versiunile anterioare.
- **RLS:** activ, fără politici, fără drepturi pentru `anon` / `authenticated`. Citirea publică trece doar prin `/api/public/landing`, iar scrierea doar prin `api/admin/seo-landing.js`.
- **Funcțiile `landing_publica` și `landing_revino`:**
  - atomice;
  - SECURITY INVOKER, `search_path` fix;
  - executabile doar de `service_role`;
  - publicarea refuză lipsa EN (`LANDING_LIPSA_LIMBA` / `LANDING_INCOMPLET_EN`).
- **Imaginile:** bucket-ul public existent `seo-og`, subfolderul `landing/`. Regulile lui (public, WebP permis, scriere doar prin adrese semnate de server) sunt exact ce trebuie, deci nu e nevoie de un bucket nou. Limita de 300 KB și formatul WebP le verifică serverul. Migrarea creează bucket-ul doar dacă lipsește și nu îl modifică dacă există.
- O tranzacție, rulabilă de mai multe ori, cu verificare la final.

## Viteza (Android simulat, Slow 4G: RTT 150 ms, 1,6 Mbit/s, procesor × 4; mediana din 3)

| Pagina | LCP înainte | LCP după | CLS înainte | CLS după |
|---|---|---|---|---|
| `/parteneri` EN | 2 956 ms | 1 212 ms | 0,012 | 0,004 |
| `/parteneri` RO | 2 860 ms | 1 044 ms | 0,012 | 0,004 |
| `/parteneri/servicii` EN | 2 672 ms | 1 112 ms | 0 | 0 |
| `/parteneri/materiale` EN | 2 808 ms | 1 124 ms | 0 | 0 |
| `/parteneri/inchirieri` EN | 2 716 ms | 1 116 ms | 0 | 0 |
| `/parteneri/curieri` EN | 2 580 ms | 1 116 ms | 0 | 0 |
| `/parteneri/asigurari` EN | 3 140 ms | 1 140 ms | 0 | 0 |
| `/investitori` EN | 2 956 ms | 1 372 ms | 0,012 | 0,012 |
| `/parteneri/servicii?utm_campaign=instalatori` RO | — | 908 ms | — | 0 |

Rețeaua e modelată în Playwright (`scripts/retea-modelata.js`, același model ca `test-viteza-investitor.js`), deci nu e o măsurătoare pe un telefon real. Concurența cererilor pentru aceeași bandă nu e modelată.

## Testele
**Noi:**

| Test | Rezultat | Ce verifică |
|---|---|---|
| `scripts/test-pagini-destinatie.js` (Playwright) | 378 / 378 | primul ecran la 360 × 640 și 390 × 844, RO + EN, 7 pagini; un singur buton portocaliu; destinația corectă la `DOMContentLoaded` și înaintea oricărui cod de sesiune, cu `profesie`, `lang`, UTM; fără JavaScript; contul de partener → „Mergi în panoul tău”; variantele (publicată / nepublicată / fără parametru, ≤ 300 ms, `variant` în `partner_landing_view`); viteza (Slow 4G, CPU × 4); butoanele plutitoare la 360–1920 px; runda; paginile generate și CSS-ul precompilat la zi |
| `scripts/test-pagini-destinatie-server.js` | 77 / 77 | publicul nu vede ciornele; 401 / 403 fără dreptul SEO; doar citire → 403 la scriere; limitele de caractere pe server, cu câmpul greșit; publicarea fără EN → refuzată, cu mesaj clar; publicare, istoric, revenire; imaginea: alt format, peste 300 KB, peste 1600 px, EXIF → refuzate |
| `scripts/test-migrare-pagini-destinatie.js` (PGlite) | 51 / 51 | rulare dublă; constrângerile și limitele; RLS: `anon` / `authenticated` nu citesc ciorne și nu pot executa funcțiile; publicarea fără EN refuzată; istoric și revenire; funcțiile fără `security definer`, cu `search_path` fix |
| `scripts/test-pagini-destinatie-backoffice.js` (Playwright) | 31 / 31 | lista, varianta nouă, contoarele; salvarea ciornei („✓ Salvat”, mesaj verde); limita depășită (mesaj roșu, câmpul marcat, valorile rămân); publicarea fără EN (tabul „English” deschis); publicare v1 / v2, istoric, revenire (fereastra MDFeedback); previzualizarea telefon / desktop; linkul copiat; imaginea PNG 2400 × 1350 → WebP 1600 × 900 în 3 mărimi; doar citire; fără `alert(` / `confirm(` |

**Suita completă:** 101 / 101 fișiere de test trec.

Am actualizat 14 teste vechi care verificau șablonul 11-R3g, înlocuit acum de macheta L1:
- `test-cta-partener`, `test-ruta-partener`, `test-meniu-devino-partener`, `test-clicuri-meniu`, `test-emailuri-cod`, `test-fereastra-cont`, `test-masurare-11a1`;
- `test-pagina-investitori`, `test-investitori-public`, `test-runda-pagina`, `test-permisiuni-runda-pagina`, `test-ruta-investitor`, `test-ruta-investitor-cont`, `test-panou-investitor-cont-nou`.

Ce s-a schimbat în ele:
- selectorii: butonul `#lp-cta` în loc de `.rp-hero [data-rp-principal]` / `#hero-intra-runda`;
- textele noi ale butoanelor;
- fără rundă activă, secțiunea lipsește;
- „Runda curentă” stă înaintea pașilor.

Verificările de comportament (redirecționările, `?type=`, fereastra de cont, ruta KYC, „0 lei”, linkurile 200) au rămas.

Două eșecuri din prima rulare au fost de rețea și au trecut la reluare: Tailwind de pe CDN pe `reclamatii` (pagină neatinsă) și `test-pitch-deck-prezentare`.

**Detectorul EN:** 0 texte românești pe toate paginile publice (80 de combinații pagină × lățime), fără erori JS și fără depășiri.

## Capturi (`docs/capturi-12l1/`)
- Înainte / după, la 390 și 1366 px, RO și EN, pentru cele 7 pagini și varianta „instalatori”: `inainte-*` / `dupa-*`.
- Back-office, după:
  - `dupa-backoffice-lista`;
  - `dupa-backoffice-editor` (și `-390`);
  - `dupa-backoffice-previzualizare`;
  - `dupa-backoffice-istoric`.
- Back-office, înainte: `inainte-backoffice-seo-*` (tabul nu exista).

## Pașii pentru LM
**1. Varianta „instalatori”**
1. Rulați migrarea în SQL Editor (înainte de merge).
2. Back-office → SEO → „Pagini de destinație” → `/parteneri/servicii`.
3. „+ Variantă nouă” → numele `instalatori` (exact valoarea `utm_campaign` din reclamă) → „Creează varianta”. Varianta pornește cu textele variantei deschise.
4. În tabul „Română” completați eticheta, titlul, subtitlul, cele 3 beneficii, butonul și textul de sub buton. Opțional: „Încarcă imaginea” și textul alternativ.
5. În tabul „English”, aceleași câmpuri în engleză.
6. La „Profesia din linkul pentru reclamă” alegeți `instalator`.
7. „Salvează ciorna” → verificați în previzualizare (Telefon / Desktop) → „Publică”. Publicarea cere RO și EN complete.

**2. Linkul pentru reclamă**
- În dreapta, sub previzualizare: „Link pentru reclamă” → „Copiază”.
- Rezultatul: `https://mydarrin.homebestpal.com/parteneri/servicii?utm_campaign=instalatori&profesie=instalator`.
- În Ads Manager, adăugați la link, dacă vreți, `utm_source` / `utm_medium`; se transmit mai departe la înscriere.

**3. Revenirea**
„Istoricul modificărilor” → „Revino la vN” → confirmați.

## De decis de LM
1. **Clientul conectat fără rol de partener** (vezi mai sus): păstrează alegerea tipului pe contul existent sau merge la pre-înscriere?
2. **`/parteneri`:** macheta L1.3 nu are etichetă și beneficii, dar cerința pasului le cere pe toate cele 7 pagini. Le-am pus; textele sunt de confirmat.
3. **Textele implicite noi ale primului ecran** (RO + EN, în `lib/landing-pagini.js`) sunt scrise din faptele de pe paginile de azi. Toate se pot schimba din back-office, fără cod.

## Ce nu s-a testat
- Pe un telefon real și în browserul Facebook (doar Chromium, prin Playwright).
- Migrarea pe Supabase: doar pe PGlite (Postgres local). LM o rulează.
- Încărcarea imaginii în Storage-ul real (adresa semnată e simulată; conținutul e verificat de server, real).

## Commit-uri
| Commit | Descriere |
|---|---|
| `35fcd3e` | (A) Migrarea, `lib/landing-pagini.js`, `/api/public/landing`, `/api/admin/seo-landing`; testele migrării și ale serverului |
| `47fdaf3` | (B) Primul ecran pe cele 7 pagini, butonul cu destinația în HTML, variantele, viteza, textele mutate în `/parteneri/intrebari` (RO + EN) |
| `3287a0e` | (C) Back-office → SEO → „Pagini de destinație” și testul lui |
| `2eaae30` | (D) Testele vechi aliniate la macheta L1 |
| `5e2616d` | (E) Capturile înainte / după |
| _(acest commit)_ | `PR.md` |

**Fișiere noi:**
- `landing.css`, `landing.js`, `landing-tailwind.css`, `lib/landing-pagini.js`, `seo-panou-landing.js`;
- `api/public/landing.js`, `api/admin/seo-landing.js`, `docs/migrations-propuse/2026-11-19_pagini-destinatie.sql`;
- `scripts/genereaza-pagini-destinatie.js`, `scripts/genereaza-tailwind-destinatie.js`, `scripts/retea-modelata.js`, `scripts/landing-rpc-simulat.js`;
- `scripts/test-pagini-destinatie*.js`, `scripts/test-migrare-pagini-destinatie.js`;
- `docs/capturi-12l1/`.

**Fișiere modificate:**
- cele 7 pagini și `intrebari-frecvente-parteneri.html`;
- dicționarele EN ale lor și `i18n/en.json`;
- `cta-partener.js`, `cta-investitor.js`, `meniu-partener.js`, `masurare.js`, `lib/verifica-fisier.js`;
- `mydarrin-superadmin.html`, `seo-panou.css`.
