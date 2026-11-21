---
name: bilingv
description: Regula bilingv RO + EN pentru tot ce se publică pe My Darrin — cheile i18n (ro.json, en.json, i18n/en/), traduceri.en în baza de date, emailurile din lib/i18n.js, mesajele de eroare, titlurile și meta, plus detectorul de română în modul EN. Se citește înainte de a adăuga sau schimba orice text vizibil, email, mesaj sau pagină.
---

# Bilingv RO + EN (decizie LM, 9 oct. 2026)

## Regula (din CLAUDE.md, cuvânt cu cuvânt)
- Tot ce se implementează sau se modifică pe platformă se face în ambele limbi, română și engleză, în același commit:
  - texte din HTML și JS (chei în `i18n/ro.json` și `i18n/en.json` sau în dicționarele din `i18n/en/`, cu `window.t`);
  - conținut din baza de date (`traduceri.en`, după aplicarea migrării);
  - emailuri (`lib/i18n.js`);
  - mesaje de eroare și de succes;
  - titluri și meta.
- Engleza e limba implicită la prima vizită; româna se alege din selector (`myd_lang_v1`). Geolocalizarea nu schimbă limba.
- Un text adăugat doar într-o limbă nu se acceptă. Detectorul de română (`scripts/detector-ro.js`) rulează în modul EN înainte de fiecare PR și trebuie să dea 0 (excepții: nume proprii, orașe, adrese).
- Paginile interne (superadmin, back-office) rămân în română.

## Unde sunt textele
- `i18n/ro.json`, `i18n/en.json` — dicționarul general (chei de forma `zona.subzona.cheie`, fișiere plate, mari: se caută cheia cu Grep, nu se citesc întregi).
- `i18n/en/<pagina>.json` — dicționarele pe pagină (textul românesc → engleză).
- `i18n/GLOSAR.md` — termenii consacrați; se respectă.
- `i18n-loader.js` — încărcarea limbii, `window.t`.
- `lib/i18n.js` — emailurile (ambele limbi).
- Baza de date: coloana `traduceri` (`traduceri.en`) — prin migrare (vezi skill-ul `migrari`).
- Erorile din API: `mesaj:{ro,en}` (vezi skill-ul `feedback-salvare`).

## Verificarea înainte de PR
- Local: `node scripts/server-test.js` (port 3000), apoi `node scripts/detector-ro.js` (modul EN, implicit) → trebuie 0 texte românești. `--cu-cont [--profil extern|propriu|inchirieri|curier|materiale|asigurari]` pentru paginile cu cont (date simulate); `LIMBA=ro` pentru testul inversat (chei netraduse); `--base https://mydarrin.homebestpal.com` pentru producție (doar citire).
- Teste: `node scripts/ruleaza-teste.js i18n bilingv erori-api-bilingv profiluri-partener-en`
- Rezultatul detectorului se scrie în `detector-out/` (folder neversionat, nu se atinge altfel).
