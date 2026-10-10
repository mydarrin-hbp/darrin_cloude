# My Darrin — reguli de lucru

## Limba
- Răspunsurile către LM, rapoartele, PR.md, mesajele de commit, comentariile din cod și textele vizibile utilizatorilor se scriu în limba română. Termenii tehnici și numele de fișiere, tabele și funcții rămân neschimbate.

## Git și publicare
- Nu se lucrează și nu se face commit direct pe main. Fiecare sarcină are branch propriu, creat din main actualizat (git pull).
- Fără push și fără merge fără confirmarea explicită a lui LM. Merge în main = publicare automată pe Vercel (darrin-cloude, mydarrin-api-hbp, mydarrin-admin-panel-hbp).
- Înainte de lucru: git status curat și branch-ul corect; la final: raport cu commit-urile și ce s-a testat.

## Baza de date (Supabase)
- Nicio modificare directă în producție din cod. Orice schimbare de schemă se scrie ca fișier în docs/migrations-propuse/, într-o singură tranzacție (begin/commit), rulabil de mai multe ori fără erori (if not exists / drop ... if exists), cu verificare la final.
- Migrările se aplică de LM în SQL Editor, ÎNAINTE de publicarea codului care le folosește.
- Funcțiile noi: search_path fix; funcțiile security definer nu se lasă executabile de anon.

## Feedback la salvare (decizie LM, 8 oct. 2026)
- Orice buton care salvează, trimite sau șterge date arată rezultatul: „Se salvează…” (buton blocat) → „✓ Salvat” verde + mesaj verde, sau „✕ Nu s-a salvat” roșu + mesaj roșu care rămâne până e închis, cu eroarea explicată în română; valorile introduse nu se pierd.
- Niciodată succes fals: mesajul verde apare doar după răspunsul real al serverului.
- Se folosește componenta comună ui-feedback.js (MDFeedback), nu alert() și nici mesaje proprii pe fiecare pagină.

## Prețuri și bani
- Prețul public: cost de bază (manoperă + materiale + utilaje) + transport + asigurare (1% din costul de bază) + comision platformă (12% din costul de bază) + marketing 3% și mentenanță 2% (pe subtotal) + TVA. Procentele se citesc din backoffice_config, pe țară, cu ALL implicit.
- Discounturile partenerilor (5–15%, pe categorie) nu sunt publice și nu apar în niciun API public; la escrow, furnizorul primește prețul public minus discountul lui.
- Nicio cifră sau dată inventată în interfață; ce nu e real se marchează clar sau se ascunde.

## Bilingv RO + EN (decizie LM, 9 oct. 2026)
- Tot ce se implementează sau se modifică pe platformă se face în ambele limbi, română și engleză, în același commit:
  - texte din HTML și JS (chei în `i18n/ro.json` și `i18n/en.json` sau în dicționarele din `i18n/en/`, cu `window.t`);
  - conținut din baza de date (`traduceri.en`, după aplicarea migrării);
  - emailuri (`lib/i18n.js`);
  - mesaje de eroare și de succes;
  - titluri și meta.
- Engleza e limba implicită la prima vizită; româna se alege din selector (`myd_lang_v1`). Geolocalizarea nu schimbă limba.
- Un text adăugat doar într-o limbă nu se acceptă. Detectorul de română (`scripts/detector-ro.js`) rulează în modul EN înainte de fiecare PR și trebuie să dea 0 (excepții: nume proprii, orașe, adrese).
- Paginile interne (superadmin, back-office) rămân în română.
- Prompturile primite de la LM vin în română și în engleză, cu conținut identic.
- Rapoartele către LM rămân în română.

## Bilingual RO + EN (LM's decision, 9 Oct 2026)
- Everything implemented or changed on the platform is done in both languages, Romanian and English, in the same commit:
  - HTML and JS text (keys in `i18n/ro.json` and `i18n/en.json`, or in the dictionaries in `i18n/en/`, via `window.t`);
  - database content (`traduceri.en`, once the migration is applied);
  - emails (`lib/i18n.js`);
  - error and success messages;
  - titles and meta tags.
- English is the default language on first visit; Romanian is chosen from the selector (`myd_lang_v1`). Geolocation does not change the language.
- Text added in only one language is not accepted. The Romanian detector (`scripts/detector-ro.js`) runs in EN mode before every PR and must return 0 (exceptions: proper names, cities, addresses).
- Internal pages (superadmin, back-office) stay in Romanian.
- Prompts from LM come in Romanian and English, with the same content.
- Reports to LM stay in Romanian.
