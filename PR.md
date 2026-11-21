# Pasul 13-C0: configurarea Claude Code pentru consum mai mic, fără să se piardă vreo regulă

Branch: `13c0-configurare-claude-code` → `main` (fără push și fără merge până la confirmarea LM).

**Fără migrare. Codul platformei nu se schimbă** — doar `CLAUDE.md`, `.claude/` (skill-uri, subagent, setări), două scripturi noi în `scripts/` și un script în `package.json`. Merge-ul nu schimbă nimic pe site.

## Ce s-a făcut
1. **`CLAUDE.md` doar în română, scurt:** toate regulile, formulate scurt, plus secțiunile noi „Conceptul My Darrin”, „Înainte de…”, „Consum mic” și „Compact instructions”. Secțiunile în engleză (Bilingual, Workspace) erau dublura secțiunilor în română și au fost scoase; conținutul lor e în rândurile românești echivalente (vezi tabelul).
2. **Skill-uri în proiect** (`.claude/skills/<nume>/SKILL.md`), cu detaliile procedurale, cuvânt cu cuvânt din vechiul `CLAUDE.md`:
   - `migrari` — regulile, șablonul de migrare (begin / commit, `if not exists`, verificarea în același bloc, fără tabele temporare, `search_path`, `security definer` fără anon), ordinea „LM rulează înainte de merge”;
   - `feedback-salvare` — principiul, toate funcțiile MDFeedback cu parametrii, `trimiteEroare`, interdicția `alert(` / `confirm(` în superadmin;
   - `preturi` — formula completă, pe pași, discounturile, escrow, unde e codul;
   - `bilingv` — regula întreagă, unde sunt textele (i18n, `traduceri.en`, emailuri), cum se rulează detectorul EN;
   - `harta-proiectului` — unde e fiecare modul (pagini, `api/`, `lib/`, `scripts/`, `i18n/`, `docs/`) și `cuprins-fisiere-mari.md`: cuprinsul celor 17 fișiere de peste 150 KB, cu intervalele de rânduri pe secțiuni. Cuprinsul se generează cu `node scripts/genereaza-harta.js` (se poate rula din nou oricând). Regula: fișierele mari se citesc pe intervale de rânduri, nu întregi.
3. **Testele, cu rezumat:** `scripts/ruleaza-teste.js` și `npm run test:rezumat` rulează `scripts/test-*.js` (2 deodată, cel mult 900 s pe test) și arată doar testele picate, cu primele 8 rânduri de eroare, plus totalul. Filtre pe nume (`node scripts/ruleaza-teste.js pret alocare`), `--complet` pentru ieșirea completă, `--paralel`, `--randuri`, `--timeout`.
4. **Subagentul** `.claude/agents/rulare-teste.md` (`model: haiku`, doar Bash / Read / Grep): rulează suita sau testele cerute și întoarce doar rezumatul; nu modifică fișiere.
5. **Setările proiectului** `.claude/settings.json`: `"model": "sonnet"`, `"effortLevel": "medium"`. Fără `settings.local.json`, fără chei. În `CLAUDE.md`: pentru migrări, alocare, prețuri sau arhitectură se pornește cu `/model opusplan` sau `/effort high`.

## Commit-uri
- `af48d22` (A) `scripts/ruleaza-teste.js` și `npm run test:rezumat`
- `895ba0c` (B) skill-ul `harta-proiectului` și `scripts/genereaza-harta.js`
- `f8ea6d7` (C) skill-urile `migrari`, `feedback-salvare`, `preturi`, `bilingv`
- `6a308c4` (D) subagentul `rulare-teste` și `.claude/settings.json`
- `22c0e6a` (E) `CLAUDE.md` nou
- (F) „branch-ul corect” readus în `CLAUDE.md`, plus acest PR.md

## Verificarea „nu se pierde nimic”: fiecare regulă din vechiul CLAUDE.md
„La fel” = textul e identic. Unde scrie „scurtat”, textul vechi întreg e păstrat cuvânt cu cuvânt în skill-ul indicat.

| # | Regula veche (secțiunea) | Unde e acum | Textul nou, dacă diferă |
|---|---|---|---|
| 1 | Limba: răspunsurile către LM, rapoartele, PR.md, commit-urile, comentariile, textele pentru utilizatori în română; termenii tehnici și numele rămân | `CLAUDE.md` › Limba | „În română: răspunsurile și rapoartele către LM, PR.md, mesajele de commit, comentariile din cod, textele pentru utilizatori. Termenii tehnici și numele de fișiere, tabele și funcții rămân neschimbate.” |
| 2 | Git: nu se lucrează și nu se face commit direct pe main; fiecare sarcină are branch propriu, din main actualizat (git pull) | `CLAUDE.md` › Git | „…branch nou din main pentru fiecare sarcină; se lucrează doar pe branch-ul corect, nimic direct pe main.” |
| 3 | Git: fără push și fără merge fără confirmarea explicită a lui LM; merge = publicare pe Vercel (3 proiecte) | `CLAUDE.md` › Git | la fel |
| 4 | Git: înainte de lucru git status curat și branch-ul corect; la final raport cu commit-urile și ce s-a testat | `CLAUDE.md` › Git | împărțit: „Înainte de lucru: … git status curat … branch-ul corect” și „La final: raport cu commit-urile și ce s-a testat.” |
| 5 | Supabase: nicio modificare directă în producție; fișier în docs/migrations-propuse/, o tranzacție, rulabil de mai multe ori, verificare la final | `CLAUDE.md` › Baza de date (scurtat) + `migrari` (cuvânt cu cuvânt) | „Nimic direct în producție din cod. Schimbările de schemă: fișier în docs/migrations-propuse/, o singură tranzacție (begin/commit), rulabil de mai multe ori (if not exists / drop ... if exists), cu verificare la final.” |
| 6 | Supabase: migrările le aplică LM în SQL Editor, ÎNAINTE de publicarea codului | `CLAUDE.md` + `migrari` | „LM aplică migrările în SQL Editor, ÎNAINTE de publicarea codului care le folosește.” |
| 7 | Supabase: funcțiile noi cu search_path fix; security definer neexecutabil de anon | `CLAUDE.md` + `migrari` | „Funcții noi: search_path fix; security definer neexecutabil de anon.” |
| 8 | Feedback: „Se salvează…” → „✓ Salvat” / „✕ Nu s-a salvat”, mesajul roșu rămâne, eroarea explicată în română, valorile nu se pierd | `CLAUDE.md` (scurtat) + `feedback-salvare` (cuvânt cu cuvânt) | „Orice salvare / trimitere / ștergere arată rezultatul: „Se salvează…” (buton blocat) → „✓ Salvat” verde, sau „✕ Nu s-a salvat” roșu, cu mesaj care rămâne până e închis și eroarea explicată în română; valorile introduse nu se pierd.” |
| 9 | Feedback: niciodată succes fals | `CLAUDE.md` + `feedback-salvare` | „Niciodată succes fals: verde doar după răspunsul real al serverului.” |
| 10 | Feedback: componenta comună ui-feedback.js (MDFeedback), nu alert(), nu mesaje proprii | `CLAUDE.md` + `feedback-salvare` | „Doar componenta comună ui-feedback.js (MDFeedback); fără alert() și fără mesaje proprii pe pagină” |
| 11 | Funcția `salveaza(...)` cu parametrii | `feedback-salvare` | la fel |
| 12 | Funcția `mesaj(...)` | `feedback-salvare` | la fel |
| 13 | Funcția `toast(...)` | `feedback-salvare` | la fel |
| 14 | Funcția `confirma(...)` | `feedback-salvare` | la fel |
| 15 | Funcția `aplicaErori(...)` | `feedback-salvare` | la fel |
| 16 | Funcția `cerere(...)` | `feedback-salvare` | la fel |
| 17 | Erorile din `api/admin/*`: `trimiteEroare(...)` → forma comună | `feedback-salvare` (întreg) + `CLAUDE.md` (trimitere) | în `CLAUDE.md`: „Erorile din `api/admin/*`: `trimiteEroare` (`lib/raspuns-eroare.js`).” |
| 18 | În `mydarrin-superadmin.html` fără `alert(` / `confirm(` (test-texte-interzise.js) | `CLAUDE.md` + `feedback-salvare` (cu numele testului) | „în superadmin fără `alert(` / `confirm(`” |
| 19 | Prețul public: formula completă; procentele din backoffice_config, pe țară, ALL implicit | `CLAUDE.md` (principiul) + `preturi` (cuvânt cu cuvânt și pe pași) | „Preț public = cost de bază + transport + asigurare + comision platformă + marketing + mentenanță + TVA; procentele din backoffice_config, pe țară, cu ALL implicit (formula completă în `preturi`).” |
| 20 | Discounturile partenerilor 5–15% nepublice; la escrow furnizorul primește prețul public minus discountul | `CLAUDE.md` + `preturi` | la fel |
| 21 | Nicio cifră sau dată inventată în interfață | `CLAUDE.md` + `preturi` | la fel |
| 22 | Bilingv: totul în RO și EN, în același commit (HTML/JS cu chei i18n și `window.t`, `traduceri.en`, emailuri `lib/i18n.js`, mesaje, titluri și meta) | `CLAUDE.md` (scurtat) + `bilingv` (cuvânt cu cuvânt, cu toate cele 5 puncte) | „Tot ce se implementează sau se modifică pe platformă: în română și engleză, în același commit (texte HTML / JS, `traduceri.en`, emailuri, mesaje de eroare și succes, titluri și meta).” |
| 23 | Engleza implicită la prima vizită; româna din selector (`myd_lang_v1`); geolocalizarea nu schimbă limba | `CLAUDE.md` + `bilingv` | „Engleza e implicită la prima vizită; româna din selector (`myd_lang_v1`); geolocalizarea nu schimbă limba.” |
| 24 | Text într-o singură limbă nu se acceptă | `CLAUDE.md` + `bilingv` | „Textul într-o singură limbă nu se acceptă.” |
| 25 | Detectorul de română în modul EN înainte de fiecare PR = 0 (excepții: nume proprii, orașe, adrese) | `CLAUDE.md` + `bilingv` (cu modul de rulare) | „`scripts/detector-ro.js` în modul EN înainte de fiecare PR: 0 (excepții: nume proprii, orașe, adrese).” |
| 26 | Paginile interne (superadmin, back-office) rămân în română | `CLAUDE.md` + `bilingv` | la fel |
| 27 | Prompturile de la LM vin în RO și EN, cu conținut identic | `CLAUDE.md` › Limba | „Prompturile de la LM vin în RO și EN, cu conținut identic.” |
| 28 | Rapoartele către LM rămân în română | `CLAUDE.md` › Limba | inclus în rândul 1: „În română: răspunsurile și rapoartele către LM…” |
| 29–34 | Secțiunea în engleză „Bilingual RO + EN” (aceleași 6 reguli ca 22–28) | aceleași locuri ca 22–28 | scoasă ca dublură; conținutul identic rămâne în rândurile românești |
| 35 | Spațiu de lucru: DOAR folderul darrin_cloude, repo-ul mydarrin-hbp/darrin_cloude | `CLAUDE.md` › Spațiu de lucru | „DOAR folderul C:\Users\admin\Desktop\darrin_cloude, repo-ul mydarrin-hbp/darrin_cloude.” |
| 36 | Fără copii temporare (AppData\Local\Temp, scratchpad); nu atingi alte proiecte (mydarrin-platform) | `CLAUDE.md` › Spațiu de lucru | „Fără copii temporare (AppData\Local\Temp, scratchpad); nu atingi alte proiecte (de exemplu mydarrin-platform).” |
| 37 | Remote-ul; push doar cu mydarrin-hbp, niciodată cu alt cont (openstaffeu-lab) | `CLAUDE.md` › Spațiu de lucru | „Push doar cu contul mydarrin-hbp, niciodată cu altul (de exemplu openstaffeu-lab).” |
| 38 | Înainte de orice lucru: git checkout main && git pull, apoi branch nou din main | `CLAUDE.md` › Git | „Înainte de lucru: `git checkout main && git pull`, … branch nou din main pentru fiecare sarcină” |
| 39–42 | Secțiunea în engleză „Workspace” (aceleași 4 reguli ca 35–38) | aceleași locuri ca 35–38 | scoasă ca dublură |
| — | Datele deciziilor LM (8 oct., 9 oct., 14 oct. 2026; pasul 11-N1, 22 oct. 2026) | titlurile din `CLAUDE.md` și din skill-uri | păstrate |

Nicio regulă nu a rămas fără loc. Alinierea globală (12-U1b) nu era în `CLAUDE.md`, deci nu a fost nimic de mutat.

**Reguli noi** (cerute de 13-C0): conceptul My Darrin, „Înainte de…”, citirea fișierelor mari pe intervale, testele doar cu rezumat, `/model opusplan` / `/effort high` pentru task-urile grele, compact instructions; în `migrari`: verificarea în același bloc, fără tabele temporare.

## Dimensiunile înainte / după
| Fișier | Rânduri | Caractere | Când se încarcă |
|---|---:|---:|---|
| `CLAUDE.md` înainte | 71 | 6 668 | la fiecare mesaj |
| `CLAUDE.md` după | 58 | 4 729 | la fiecare mesaj (**−29%**) |
| `skills/migrari/SKILL.md` | 62 | 3 193 | doar când e folosit |
| `skills/feedback-salvare/SKILL.md` | 29 | 2 498 | doar când e folosit |
| `skills/preturi/SKILL.md` | 34 | 2 096 | doar când e folosit |
| `skills/bilingv/SKILL.md` | 31 | 2 419 | doar când e folosit |
| `skills/harta-proiectului/SKILL.md` | 45 | 5 719 | doar când e folosit |
| `skills/harta-proiectului/cuprins-fisiere-mari.md` | 1 024 | 37 049 | doar secțiunea necesară, la cerere |
| `agents/rulare-teste.md` | 25 | 1 566 | doar în subagent |

La pornire, din skill-uri se încarcă doar numele și descrierea (câte un rând).
Câștigul mare nu e în `CLAUDE.md`, ci în cele două obiceiuri noi: un fișier de 510 KB citit întreg înseamnă peste 100 000 de tokeni, iar un interval de 150 de rânduri câteva mii; la teste, rezumatul are câteva rânduri, față de mii de rânduri pentru toată suita.

## Ce s-a testat
- Skill-urile și subagentul: o sesiune `claude -p` (Haiku) pornită în proiect le vede pe toate — skill-urile `bilingv`, `feedback-salvare`, `harta-proiectului`, `migrari`, `preturi` (ce apare în `/skills`) și subagentul `rulare-teste` (ce apare în `/agents`).
- `node scripts/genereaza-harta.js`: 17 fișiere, 961 de secțiuni; rulat din nou, dă același rezultat.
- Suita cu `node scripts/ruleaza-teste.js`: prima rulare (4 deodată, 240 s pe test): 102 teste, 92 trecute, 10 picate — 7 opriți de limita de 240 s și 2 de viteză sub încărcare. De aceea valorile implicite au devenit 2 deodată și 900 s. Cele 10 rulate din nou pe rând: **toate trec, în afară de 2**, care nu țin de acest pas (branch-ul nu schimbă niciun fișier al platformei, deci pică la fel pe main):
  - `test-pagini-destinatie.js` (1 din 378): `ghidul-asiguratorului.html` și `mydarrin-investitori.html` „nu sunt la zi” față de `scripts/genereaza-pagini-destinatie.js` — de reparat într-un pas separat (rularea generatorului);
  - `test-panou-investitor.js`: cererea către `https://ipapi.co/json/` e blocată de CORS pe localhost și apare ca eroare în consolă — ține de mediul local / serviciul extern, nu de cod nou.
- Rezumatul a scos din ieșire doar rândurile utile: la 102 teste, câteva zeci de rânduri în loc de mii.
- Regulile: tabelul de mai sus, verificat rând cu rând față de `git show main:CLAUDE.md`.

## După merge
Nimic de rulat în Supabase. La următoarea sesiune Claude Code în folder, modelul implicit e Sonnet cu effort medium; `/model` sau `/effort` schimbă pe loc.
