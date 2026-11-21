# Pasul 12-U1b: reparația rutelor spre catalog, aliniată pe tot site-ul

Branch: `12u1b-rute-catalog` (din main după 12-P2 și 13-C0). Fără migrări, nimic scris în Supabase.

## Ce s-a făcut
1. **Cardurile din „Servicii complete la cerere”** (`index.html`, `renderCatTile`): adresa vine din `MYD_ADRESE.adresaCatalog(tip, slug)` (pagina încarcă acum `/lib/adrese-curate.js`). Afectate erau toate cele trei grile (servicii, materiale, închirieri): `/catalogservicii&subcategorie=…` → 404; acum `/servicii?subcategorie=…`, `/materiale?…`, `/inchirieri?…`.
2. **Toate linkurile `?subcategorie=` de pe site** (475 de înlocuiri în 28 de pagini: antet „Servicii”, meniul lateral, caruselele din catalog și din pagina principală, butoanele din pagina principală) duc la un slug real și la fila lui. Nu s-au creat categorii și nu s-au șters intrări din meniu.
3. **Redirect 301 pentru adresele stricate de la 12-U1** (`/catalogservicii&…`, `/catalogmateriale&…`, `/cataloginchirieri&…`, și forma fără `subcategorie`): regula în `lib/adrese-curate.js` (`redirect`), condiția din `middleware.js` (`redirectAdresaVeche`) și oglinda din `scripts/server-test.js`; parametrii de după `&` și cei din `?` se păstrează. Teste în `scripts/test-adrese-curate.js`.
4. **Subcategorie inexistentă în catalog**: bara `.filtru-subcategorie` arată „Categoria căutată nu mai există. Îți arătăm toate serviciile / materialele / închirierile.” (EN în `i18n/en.json`), cu „×” de închidere, iar parametrul greșit e scos din adresă. Mesajul apare doar când citirea din `categorii` s-a făcut și slug-ul chiar lipsește; o eroare de rețea nu mai e confundată cu „nu există” (`rest()` întoarce acum `null` la eroare, nu `[]`).
5. **Testul de rute** `scripts/test-linkuri-interne.js` (intră automat în suita `scripts/test-*.js`): extrage `href`, `location.href/replace/assign`, apeluri `adresaCatalog` din toate `.html` / `.js` din rădăcină + `lib/i18n.js`; verifică existența căii, „&” înainte de „?”, adresa veche care ar trebui să fie curată, slug-ul real și fila potrivită, concatenarea adreselor catalogului. Lista de slug-uri: `scripts/date-test/slug-uri-categorii.json`, regenerabilă cu `scripts/genereaza-slug-uri-categorii.js <adresa-site>` (doar GET, la cerere).
6. **Regula de aliniere globală** în `CLAUDE.md` (secțiunea „Aliniere globală”, doar în română).
7. **Test în browser** `scripts/test-rute-catalog.js`: 390 și 1366 px, RO și EN.

## Atenție: lista de slug-uri NU a fost verificată din nou pe baza reală
Promptul cerea reverificarea listei din `categorii`. Citirea directă din Supabase (MCP) a fost refuzată de sistemul de permisiuni, așa că **fișierul de test conține lista din prompt (20 nov. 2026)**, nu una proaspătă. Se poate regenera cu `scripts/genereaza-slug-uri-categorii.js` (dacă `/api/public/categorii` întoarce toate categoriile; acum endpoint-ul întoarce doar categoriile principale, deci pentru subcategorii trebuie citirea `categorii` sau API-ul din 12-T1). LM poate rula interogarea `select category_type, slug from categorii` și compara.

## Tabelul de corespondență (15 valori inexistente → slug real)
| Valoare veche | Unde era | Acum | Observație |
|---|---|---|---|
| `Instala%C8%9Bii` (sanitare) | antet, 26 pagini | `/servicii?subcategorie=instalatii-sanitare` | după textul intrării |
| `Instala%C8%9Bii` (electrice) | antet, 26 pagini | `/servicii?subcategorie=instalatii-electrice` | după textul intrării |
| `Construc%C8%9Bii` | antet | `constructii-renovari` | |
| `Climatizare` | antet | `hvac-climatizare` | |
| `Finisaje` | antet | `zugraveli-finisaje` | |
| `Exterior` | antet | `gradinarit-agri` | |
| `profesionisti-inc` | meniu lateral, 11 pagini | `/inchirieri?subcategorie=profesionist-inchiriere` | |
| `utilaje-grele` | carusel, pagina principală | `utilaje-constructii` (închirieri) | |
| `vehicule-transport` | carusel | `transport` (închirieri) | |
| `inchiriere-echipamente-vacanta` | carusel | `vacanta` (închirieri) | |
| `schi` | meniu lateral | fără echivalent → `/inchirieri` | M1 decide |
| `plaja` | meniu lateral | fără echivalent → `/inchirieri` | M1 decide |
| `drumetie` | meniu lateral | fără echivalent → `/inchirieri` | M1 decide |
| `echip-sportive` | meniu lateral | fără echivalent → `/inchirieri` | M1 decide |
| `alte-inchirieri` | meniu lateral | fără echivalent → `/inchirieri` | M1 decide |
| `alte-materiale` | meniu lateral | fără echivalent → `/materiale` | M1 decide |

(Rămân 16 rânduri fiindcă „Instalații” acoperă două intrări. Linkurile cu `/catalog?subcategorie=<slug real>` care nu aveau fila, de exemplu `/catalog?subcategorie=betoane`, au primit și ele fila potrivită: `/materiale?subcategorie=betoane`.)

## Rezultatul testului de rute
- Înainte (starea din main, cu testul nou): **159 de probleme** (subcategorii inexistente, linkuri `/catalog?subcategorie=` fără filă, adresa concatenată din `index.html`).
- După: **0 probleme** (106 fișiere verificate).

## Teste
- `test-adrese-curate.js`: 1355 trecute, 0 picate (cu cele 4 cazuri noi de 301 + țintă 200).
- `test-rute-catalog.js` (Chromium, 390 / 1366 px, RO / EN): 86 trecute, 0 picate. Acoperă: cardurile de serviciu, material și închiriere din pagina principală (adresă + 200), meniurile din antet și laterale din `/cum-comanzi`, 3 adrese stricate (301 → 200), 3 subcategorii inexistente (mesajul RO / EN, parametrul scos din adresă, fără erori JS), o subcategorie existentă (fără mesaj).
- Detectorul de română în modul EN: **0** texte românești, 80 pagini × lățimi, 0 erori JS, 0 depășiri.
- Suita completă (`npm run test:rezumat`): 104 teste, 101 trecute, 3 picate (11549 verificări trecute, 1 picată). Picate: `test-pagini-destinatie` (paginile generate `ghidul-asiguratorului` / `mydarrin-investitori` etc. „nu sunt la zi”) și `test-panou-investitor` (CORS spre ipapi.co în Chromium) — **la fel pe main**, verificat; `test-profiluri-partener-en` a picat o dată, instabil, și trece la rerulare separată.
- Capturile Playwright se pot genera cu `CAPTURI=<folder> node scripts/test-rute-catalog.js`.

## Ce rămâne pentru M1 și de ce
- Meniurile (antet „Servicii” și meniul lateral) rămân scrise de mână în fiecare pagină: decizia LM din 21 nov. este să se refacă din arbore la M1. Aici s-au corectat doar destinațiile; structura nu s-a schimbat.
- Cele 6 intrări fără echivalent (`schi`, `plaja`, `drumetie`, `echip-sportive`, `alte-inchirieri`, `alte-materiale`) duc acum la fila tipului: LM decide la M1 dacă rămân, se redenumesc sau dispar.
- Cheile de stil `utilaje-grele`, `vehicule-transport` din `CAT_TILE_STYLE` (`index.html`) nu mai corespund niciunui slug; sunt inofensive și se curăță la M1 odată cu iconițele din arbore.
- Darrin AI, înscrierea partenerului (12-P2) și back-office-ul: căutat în tot repo-ul, nu construiesc adrese de catalog cu `?subcategorie=` (singura concatenare era în `index.html`). Testul de rute le verifică de acum.
- `mydarrin-serviciu.html`, `mydarrin-categorie-*.html` (pagini-releu vechi) rămân: doar păstrează parametrii și `#ancora`, testul le permite.

## Regula nouă în CLAUDE.md (tabelul din PR.md)
| # | Regula | Unde e | Textul |
|---|---|---|---|
| 43 | Aliniere globală: ce se auditează / decide se aplică în toate modulele, rutele și fluxurile; rutele doar cu `lib/adrese-curate.js`; `test-linkuri-interne.js` = 0 înainte de PR | `CLAUDE.md` › Aliniere globală | „Tot ce se auditează (rute, fluxuri, pagini, logică) și tot ce se decide (modificări, ajustări, implementări) se aplică aliniat în toate modulele, toate rutele și toate fluxurile care folosesc același lucru: …” |

## Commit-uri
Vezi `git log main..12u1b-rute-catalog`.

Push doar după confirmarea LM; fără merge.
