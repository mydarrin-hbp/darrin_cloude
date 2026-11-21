---
name: feedback-salvare
description: Cum arată rezultatul oricărui buton care salvează, trimite sau șterge date (componenta MDFeedback din ui-feedback.js) și forma comună a erorilor din api/admin/* (trimiteEroare). Se citește înainte de a lucra la un formular, un buton de salvare sau ștergere ori un endpoint care întoarce erori.
---

# Feedback la salvare (decizie LM, 8 oct. 2026)

## Principiul (din CLAUDE.md, cuvânt cu cuvânt)
- Orice buton care salvează, trimite sau șterge date arată rezultatul: „Se salvează…” (buton blocat) → „✓ Salvat” verde + mesaj verde, sau „✕ Nu s-a salvat” roșu + mesaj roșu care rămâne până e închis, cu eroarea explicată în română; valorile introduse nu se pierd.
- Niciodată succes fals: mesajul verde apare doar după răspunsul real al serverului.
- Se folosește componenta comună ui-feedback.js (MDFeedback), nu alert() și nici mesaje proprii pe fiecare pagină.

## Funcțiile MDFeedback (pasul 11-N1, 22 oct. 2026)
- `salveaza(buton, zona, fn, { form, toast, textSalveaza, textOk })` — blochează butonul (fără clic dublu), timeout 15 s → eroare cu „Reîncearcă”; cu `form`, verifică întâi câmpurile obligatorii (`required` / `data-obligatoriu`) și marchează câmpurile primite de la server; fără zonă de mesaj, rezultatul apare ca toast;
- `mesaj(zona, 'ok' | 'eroare' | 'info', text)` — mesajul de sub formular;
- `toast('succes' | 'eroare' | 'info', text, { reincearca })` — succesul dispare după ~4 s, eroarea rămâne până e închisă;
- `confirma(text, { textOk, textAnulare, periculos })` → Promise<boolean> — fereastră proprie, nu `confirm()`; la acțiunile periculoase focusul e pe „Anulează”;
- `aplicaErori(form, campuri)` — `aria-invalid`, chenar roșu, mesajul sub câmp (`aria-describedby`), focus pe primul câmp greșit; eroarea dispare când câmpul e corectat;
- `cerere(url, optiuni)` — fetch cu timeout de 15 s; citește forma comună de eroare.

## Forma comună de eroare
- Erorile din `api/admin/*` folosesc forma comună din `lib/raspuns-eroare.js`: `trimiteEroare(res, status, cod, mesaj_ro, mesaj_en, campuri)` → `{ ok:false, cod, mesaj:{ro,en}, campuri:[{camp, mesaj:{ro,en}}] }`; mesajul spune ce câmp e greșit și ce trebuie făcut.
- Mesajele de eroare și de succes sunt în ambele limbi (vezi skill-ul `bilingv`).

## Interdicții
- În `mydarrin-superadmin.html` nu se folosesc `alert(` și `confirm(` (verificat de `scripts/test-texte-interzise.js`).

## Teste utile
`node scripts/ruleaza-teste.js feedback raspuns-eroare texte-interzise erori-api`
