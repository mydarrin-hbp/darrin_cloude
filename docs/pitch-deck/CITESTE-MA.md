# Pitch deck v1 — RO + EN (22 oct. 2026)

Dezarhivați **în rădăcina repo-ului** `darrin_cloude` (folderele se potrivesc cu căile din promptul 11-K):

- `assets/pitch-deck/v1/` — 9 imagini WebP (aceleași în RO și EN; extrase din PDF-urile Canva).
- `docs/pitch-deck/pitch-deck-v1-ro.json` — varianta română (Canva V1 RO), pentru limba `ro`.
- `docs/pitch-deck/pitch-deck-v1-en.json` — varianta engleză (Canva V2 EN, traducere corectată), pentru `en`, `bg`, `de`, `el`, `fr`, `tr`.
- `docs/pitch-deck/CORECTURI_CANVA_EN.md` — greșelile de traducere din Canva EN.

Ambele variante: 20 de slide-uri, aceeași structură, eticheta de prognoză, note de verificare de rezolvat înainte de aprobare. Slide-ul 18 (runda) nu are cifre: le ia live din runda deschisă.

## v1.2 — versiunea aprobată live (25 oct. 2026)

- `pitch-deck-v1.2-ro.json` / `-en.json` = versiunea v1.2 **aprobată pe 25 oct. 2026** (RO + EN), copiată exact din fișierele LM. Are conținut propriu față de v1.1 (sursele pe slide-urile de prognoză, slide-ul 10 „Ținte operaționale”, „Platforme de anunțuri”, profitul net din anul 5, textul cifrei de pe slide-ul 17) și conține deja etichetele seriilor din graficul slide-ului 17 (`eticheta_serie1` / `eticheta_serie2`): „Valoarea proiectelor” / „Profit net” (RO), „Project value” / „Net profit” (EN).
- **Nu trebuie reimportată**: e deja în baza de date, aprobată. Un import nou ar crea doar o ciornă dublă.
- Câmpurile `eticheta_serie1` / `eticheta_serie2` sunt opționale (cel mult 40 de caractere); fără ele, graficul arată „Venituri” / „Profit net” (RO) și „Revenue” / „Net profit” (EN).
