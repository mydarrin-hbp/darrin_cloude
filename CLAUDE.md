# My Darrin — reguli de lucru

## Conceptul My Darrin
- Marketplace de antreprenor general: servicii, materiale, închirieri, curier, asigurări — clientul comandă tot dintr-un singur loc.
- Firma: Home Best Pal SRL (România) / Home Best Pal LTD.
- Un singur arbore de categorii (catalog, înscrierea partenerilor, alocare).
- Prețul public se calculează doar pe server; plata trece prin escrow.
- Darrin AI caută și propune doar din catalogul My Darrin. Aplicațiile mobile se fac prin Capacitor.

## Înainte de…
- migrare, funcție sau politică Supabase → skill-ul `migrari`;
- buton care salvează / trimite / șterge, formular, erori din API → `feedback-salvare`;
- prețuri, coș, checkout, comenzi, devize, discounturi, escrow → `preturi`;
- orice text vizibil, email, mesaj, titlu, pagină → `bilingv`;
- căutarea codului sau un fișier mare → `harta-proiectului`;
- rularea testelor → subagentul `rulare-teste` sau `npm run test:rezumat`.

## Aliniere globală (decizie LM, 20 nov. 2026)
- Tot ce se auditează (rute, fluxuri, pagini, logică) și tot ce se decide (modificări, ajustări, implementări) se aplică aliniat în toate modulele, toate rutele și toate fluxurile care folosesc același lucru: site public, cont client, cont partener, back-office, Darrin AI, e-mailuri, aplicația mobilă. Înainte de o modificare se caută toate locurile afectate; raportul spune unde s-a aplicat și ce a rămas, cu motivul. Rutele se construiesc doar cu funcțiile comune (`lib/adrese-curate.js`), nu cu șiruri lipite de mână. `scripts/test-linkuri-interne.js` rulează înainte de fiecare PR și trebuie să dea 0.

## Limba
- În română: răspunsurile și rapoartele către LM, PR.md, mesajele de commit, comentariile din cod, textele pentru utilizatori. Termenii tehnici și numele de fișiere, tabele și funcții rămân neschimbate.
- Prompturile de la LM vin în RO și EN, cu conținut identic.

## Spațiu de lucru (decizie LM, 14 oct. 2026)
- DOAR folderul C:\Users\admin\Desktop\darrin_cloude, repo-ul mydarrin-hbp/darrin_cloude. Fără copii temporare (AppData\Local\Temp, scratchpad); nu atingi alte proiecte (de exemplu mydarrin-platform).
- Remote: https://mydarrin-hbp@github.com/mydarrin-hbp/darrin_cloude.git. Push doar cu contul mydarrin-hbp, niciodată cu altul (de exemplu openstaffeu-lab).

## Git și publicare
- Înainte de lucru: `git checkout main && git pull`, git status curat, branch nou din main pentru fiecare sarcină; se lucrează doar pe branch-ul corect, nimic direct pe main.
- Fără push și fără merge fără confirmarea explicită a lui LM. Merge în main = publicare automată pe Vercel (darrin-cloude, mydarrin-api-hbp, mydarrin-admin-panel-hbp).
- La final: raport cu commit-urile și ce s-a testat.

## Baza de date (Supabase)
- Nimic direct în producție din cod. Schimbările de schemă: fișier în docs/migrations-propuse/, o singură tranzacție (begin/commit), rulabil de mai multe ori (if not exists / drop ... if exists), cu verificare la final.
- LM aplică migrările în SQL Editor, ÎNAINTE de publicarea codului care le folosește.
- Funcții noi: search_path fix; security definer neexecutabil de anon.

## Feedback la salvare (decizie LM, 8 oct. 2026)
- Orice salvare / trimitere / ștergere arată rezultatul: „Se salvează…” (buton blocat) → „✓ Salvat” verde, sau „✕ Nu s-a salvat” roșu, cu mesaj care rămâne până e închis și eroarea explicată în română; valorile introduse nu se pierd.
- Niciodată succes fals: verde doar după răspunsul real al serverului.
- Doar componenta comună ui-feedback.js (MDFeedback); fără alert() și fără mesaje proprii pe pagină; în superadmin fără `alert(` / `confirm(`. Erorile din `api/admin/*`: `trimiteEroare` (`lib/raspuns-eroare.js`).

## Prețuri și bani
- Preț public = cost de bază + transport + asigurare + comision platformă + marketing + mentenanță + TVA; procentele din backoffice_config, pe țară, cu ALL implicit (formula completă în `preturi`).
- Discounturile partenerilor (5–15%, pe categorie) nu sunt publice și nu apar în niciun API public; la escrow, furnizorul primește prețul public minus discountul lui.
- Nicio cifră sau dată inventată în interfață; ce nu e real se marchează clar sau se ascunde.

## Bilingv RO + EN (decizie LM, 9 oct. 2026)
- Tot ce se implementează sau se modifică pe platformă: în română și engleză, în același commit (texte HTML / JS, `traduceri.en`, emailuri, mesaje de eroare și succes, titluri și meta). Textul într-o singură limbă nu se acceptă.
- Engleza e implicită la prima vizită; româna din selector (`myd_lang_v1`); geolocalizarea nu schimbă limba.
- `scripts/detector-ro.js` în modul EN înainte de fiecare PR: 0 (excepții: nume proprii, orașe, adrese).
- Paginile interne (superadmin, back-office) rămân în română.

## Consum mic
- Fișierele de peste 150 KB (`mydarrin-superadmin.html`, `mydarrin-catalog.html`, `mydarrin-produs.html` etc.) se citesc pe intervale de rânduri sau cu Grep, nu întregi (cuprinsul în `harta-proiectului`).
- Testele se rulează doar cu `node scripts/ruleaza-teste.js [filtre]` / `npm run test:rezumat` (doar picatele + totalul); ieșirea completă (`--complet`) doar la cerere.
- Proiectul pornește cu Sonnet, effort medium. Pentru migrări, alocare, prețuri sau arhitectură: `/model opusplan` sau `/effort high`.

## Compact instructions
La compactare se păstrează: branch-ul, deciziile LM, fișierele modificate (și migrările), testele picate și cauza, ce s-a testat, pașii rămași.
