# My Darrin — pasul 11a: audit și plan de implementare (16 oct. 2026)

*(Versiunea în română; `2026-10-16_audit_plan_EN.md` are același conținut.)*

- Branch: `audit-11a`, creat din `main` la `8c5de07` (merge PR #19 `anaf-url`, pasul 10d).
- Tip: doar audit. Niciun cod, nicio pagină, niciun text și nicio dată nu au fost modificate. Nimic nu a fost scris în Supabase.
- Surse: codul din `main` (fișier și linie la fiecare constatare), cifrele citite live de LM pe 16 oct. și API-urile publice ale site-ului de producție (https://mydarrin.homebestpal.com), numai GET.
- Unde ceva nu a putut fi verificat, scrie „neverificat” și motivul.

Severitate: **critic** = bani greșiți, date expuse sau o funcție de bază care nu merge; **major** = informație falsă sau lipsă pentru client / partener, ori o regulă de business neaplicată; **minor** = aspect, text, consistență.

---

## 1. Rezumat (o pagină)

*(Se completează la final, după cele 7 puncte.)*

---

## 2. Cele 7 puncte

### 2.1 Valoarea minimă de comandă, pe țară și monedă

#### Starea actuală (cu dovezi)

**Server (sursa de adevăr)**
- `lib/calculeaza-pret.js:120-128` — `citestePragMinimComanda(tara)` citește `tax_configurations.prag_minim_comanda`; dacă valoarea lipsește, întoarce `VMC_FALLBACK = 100` (`lib/calculeaza-pret.js:52`), **în orice monedă** (100 GBP, 100 EUR, 100 MDL la fel ca 100 RON).
- `lib/calculeaza-pret.js:247-251` — `pret_final = max(subtotal + taxe platformă + TVA, prag)`. Clientul plătește pragul; comanda nu e oprită.
- `api/comenzi/creeaza.js:421` — calea neitemizată: `suma_totala_platita = max(valoare_totala, prag)`, unde `valoare_totala` vine din corpul cererii.
- `api/comenzi/creeaza.js:349-411` — o comandă are un singur tip: serviciu pe nivel (`nivel_id`), produse marketplace (`produse_marketplace`) sau calea veche (`cost_*` / `valoare_totala`). Pragul se aplică pe fiecare comandă în parte.
- Pragul se editează din superadmin → Accountancy (`mydarrin-superadmin.html:4037`, `:4088`, `:4171`; `api/accountancy.js:82-91`), cu placeholder „implicit 100”.

**Ce se salvează pe comandă și unde ajunge diferența până la prag**
- Pe comandă se salvează componentele (`suma_manopera`, `suma_materiale`, …, `tva_suma`) calculate **înainte** de prag și `suma_totala_platita` **după** prag (`api/comenzi/creeaza.js:349-411`). Diferența (prag − preț) nu are nicio coloană proprie.
- `lib/elibereaza-escrow.js:169-185` — platforma reține comision + marketing + mentenanță + `tva_suma`; diferența până la prag nu e alocată nimănui (nici partener, nici platformă) și nu are TVA calculat separat.
- `lib/genereaza-proforma-pdf.js:181-192` — proforma afișează liniile, „Subtotal”, „TVA” și „TOTAL DE PLATĂ = suma_totala_platita”. Când pragul se aplică, Subtotal + TVA ≠ Total și nu există o linie care să explice diferența.
- Verificat doar din cod; nicio comandă reală nu a fost creată (regula „nu scrii în Supabase”).

**Ce vede clientul**

| Loc | Ce arată | Dovadă |
|---|---|---|
| Pagina de serviciu, mod pilot (nivel cu rețetă) | „Prag minim de comandă aplicat: X”, doar după ce pragul s-a aplicat, cu suma din server | `mydarrin-produs.html:4482-4486`, `api/public/calculeaza-pret-nivel.js:90-98` (`prag_aplicat`) |
| Pagina de serviciu, calea veche (fără rețetă) | „Sub VMC (100 Lei) → minim 100 Lei aplicat automat”, prag scris în cod `const VMC = 100`, plus `PLATFORM_PCT = 0.31`, `ZONE_PCT = 1.05`, asigurări 85 / 165 Lei | `mydarrin-produs.html:1725-1726`, `:2109`, `:3514-3523`, `:4749-4775` |
| `/mydarrin-catalog` | „Min. 100 Lei · +5% zonă” / „Min. 50 Lei · +5% zonă” pe ~27 de carduri scrise în HTML; `VMC_MAP = {RON:100, EUR:25, MDL:400}`; `vmcMap = {servicii:100, materiale:50, inchiriere:100}` | `mydarrin-catalog.html:2304-3281`, `:6467`, `:6526-6527`, `:6851-6855` |
| Marketplace (`mydarrin-marketplace-materiale.html`) | Prețul unitar „TVA inclus”, fără prag; la „Comandă” serverul întoarce `pret_final` cu prag, iar checkout-ul afișează direct totalul, fără mențiunea pragului | `mydarrin-marketplace-materiale.html:251-280`, `api/public/marketplace-produse.js:183-198` |
| Checkout (`mydarrin-checkout.html`) | Doar totalul (`cfg.total`); nicio mențiune despre prag | `mydarrin-checkout.html:3300-3307`, `:3322-3376` |
| Coșul multi-serviciu (`mydarrin-cos.html`) | Suma prețurilor; fiecare item devine o comandă separată, deci pragul se aplică **pe fiecare item** | `mydarrin-cos.html:184-188`, `:221-285`; `api/client/cos-multi.js:7-11` |

**Moneda afișată**
- `format-currency.js:25-27` — moneda implicită e `RON` dacă apelantul nu o trimite; formatarea folosește mereu `ro-RO`.
- `mydarrin-produs.html:4688-4690` (`fmtCurrency(suma)`), `mydarrin-checkout.html:3305` și `mydarrin-cos.html:112-114` nu trimit moneda → afișează „Lei” pentru orice țară.
- Serverul știe moneda (`api/public/calculeaza-pret-nivel.js:64-65`, `api/public/marketplace-produse.js:194`), dar paginile nu o folosesc.
- `mydarrin-checkout.html:3082-3086` — cursuri de schimb scrise în cod (`RON:1, MDL:5, EUR:0.2, GBP:0.17, BGN:0.39`) pentru elementele `.dyn-price`.
- Live (GET `/api/public/tari-active`, 16 oct.): checkout activ în **6 țări**: RO, AT, BG, GR, GB, MD. Valorile `prag_minim_comanda` pe țară nu sunt publice — **neverificat** (nu există API public care să le întoarcă). Dacă pentru AT / BG / GR / GB / MD valoarea e goală, se aplică 100 în moneda țării.

**Coș cu produse de la furnizori diferiți**
- Marketplace: butonul „Comandă” trimite un singur produs (`mydarrin-marketplace-materiale.html:262-275`); un coș cu mai multe produse nu există încă pe pagina publică. API-ul acceptă până la 50 de produse într-o comandă (`api/comenzi/creeaza.js:162-170`), iar escrow-ul împarte pe furnizori (`lib/elibereaza-escrow.js:76-94`), deci pragul s-ar aplica o singură dată pe comanda întreagă.
- Live (GET `/api/public/marketplace-produse?tip=materiale` și `?tip=echipamente`): 0 produse publice azi, deci comportamentul nu poate fi văzut live — **neverificat live**.
- Coșul multi-serviciu (`mydarrin-cos.html`) face câte o comandă pe item: un client cu trei servicii mici plătește pragul de trei ori.

#### Probleme

| # | Problemă | Severitate |
|---|---|---|
| 1.1-a | Diferența până la prag nu e salvată, nu are TVA calculat și nu e alocată în escrow; proforma arată Subtotal + TVA ≠ Total | **critic** |
| 1.1-b | Rezerva `VMC_FALLBACK = 100` se aplică în orice monedă (6 țări cu checkout activ); contrazice regula din 10b „fără valori de rezervă în cod” | **critic** |
| 1.1-c | Clientul nu e informat înainte de plată: checkout-ul și marketplace-ul nu spun că s-a aplicat pragul și nici cât e | **major** |
| 1.1-d | Coșul multi-serviciu aplică pragul pe fiecare item (comenzi separate) | **major** |
| 1.1-e | Praguri inventate în pagini: `VMC = 100`, `VMC_MAP`, „Min. 50 Lei”, „+5% zonă”, `PLATFORM_PCT = 0.31`, asigurări 85 / 165 Lei | **major** |
| 1.1-f | Moneda afișată e mereu „Lei” (paginile nu trimit moneda); cursuri de schimb scrise în cod în checkout | **major** |
| 1.1-g | Calea neitemizată acceptă `valoare_totala` din client (protejată doar de prag) | **major** (integritate; legată de 1.3) |
| 1.1-h | Mesajul `ZONA_INDISPONIBILA` din `api/comenzi/creeaza.js:189-193` e doar în română, fără diacritice | minor |

#### Decizii pentru LM

1. **Sub prag:** (a) clientul plătește pragul (azi) sau (b) comanda e blocată până ajunge la prag, cu mesaj clar („Mai adaugă X pentru a putea comanda”).
   - (a) cere: o linie separată pe proformă / factură („completare până la valoarea minimă”), cu TVA, și o regulă de alocare în escrow (recomandare: venit al platformei, ca linie distinctă).
   - (b) e mai simplu fiscal și mai transparent; cere un mesaj în coș, checkout și marketplace.
   - Recomandare: **(b)**, pentru că nu cere o linie de factură nouă și nu creează un venit fără serviciu în spate.
2. **Un prag pe țară (azi) sau un prag pe monedă.** Azi fiecare țară are o singură monedă (`tax_configurations.moneda`). Recomandare: **un prag pe țară**, în moneda țării, până când o țară acceptă efectiv mai multe monede.
3. **Fără prag configurat:** (a) checkout-ul e oprit pentru țara respectivă până se completează pragul (recomandat, la fel ca procentele din 10b) sau (b) fără prag (0).
4. **Coșul multi-serviciu:** pragul pe comandă (azi, deci pe fiecare item) sau pe coșul întreg. Depinde de decizia „o comandă compusă cu escrow unic” (azi: comenzi separate, decizie din 30 aug.).

#### Planul

**Bază de date (migrare propusă)**
- `docs/migrations-propuse/AAAA-LL-ZZ_prag_minim_comanda.sql`: dacă LM alege (a), coloane noi pe `comenzi`: `suma_completare_prag numeric(12,2) not null default 0` și `tva_completare_prag numeric(12,2) not null default 0`. Dacă alege (b), nu e nevoie de coloane noi.
- Verificare la final: lista țărilor cu `checkout_activ = true` și `prag_minim_comanda is null` (trebuie 0 după completarea din superadmin).

**Back-end**
- `lib/calculeaza-pret.js`: eliminarea `VMC_FALLBACK`; prag lipsă → `EroareConfigPret` (`tax_configurations.prag_minim_comanda`), ca la TVA.
- Varianta (b): `aplicaFormulaPret` întoarce `sub_prag: true` și `lipsa_pana_la_prag`; `api/comenzi/creeaza.js` refuză cu `400 SUB_PRAG_MINIM` (mesaj RO + EN); `api/public/calculeaza-pret-nivel.js` și `api/public/marketplace-produse.js` (POST) întorc aceleași câmpuri.
- Varianta (a): `aplicaFormulaPret` întoarce `completare_prag` și TVA-ul ei; se salvează pe comandă; `lib/elibereaza-escrow.js` o adaugă la `platformaRetine`; `lib/genereaza-proforma-pdf.js` o afișează ca linie proprie.
- `api/comenzi/creeaza.js:421`: calea neitemizată — de închis împreună cu curățarea catalogului (1.3), când toate serviciile au rețetă.
- Mesajul `ZONA_INDISPONIBILA` în RO + EN.

**Front-end**
- Un singur element comun „pragul minim” (în `ui-comun.js` sau un fișier nou), alimentat din răspunsul serverului: în pagina de serviciu, în marketplace, în coș și în checkout, cu moneda primită de la server.
- `format-currency.js`: fără monedă implicită `RON`; toate apelurile trimit moneda primită de la server; formatarea după limba activă.
- Eliminarea pragurilor și procentelor scrise în cod din `mydarrin-produs.html` (calea veche) și `mydarrin-catalog.html` (`VMC_MAP`, `vmcMap`, „+5% zonă”, cardurile scrise de mână — legat de 1.5), și a cursurilor de schimb din `mydarrin-checkout.html:3082`.
- `mydarrin-cos.html`: textul pragului pe fiecare item sau pe coș, după decizia 4.

**Conținut (RO + EN)**
- Texte noi în `i18n/en/mydarrin-produs.json`, `mydarrin-checkout.json`, `mydarrin-cos.json`, `mydarrin-marketplace-materiale.json`; mesajul de eroare în `lib/i18n.js` dacă apare în email.
- Paginile care menționează „VMC” (`i18n/en/mydarrin-cum-functioneaza.json:56`, `i18n/en/mydarrin-investitori.json:122`) — formulare aliniată la decizie (vezi 1.2).

**Teste**
- `scripts/test-pret-config.js`: prag lipsă → `CONFIG_PRET_LIPSA`; sub prag → (a) completare + TVA corect sau (b) `SUB_PRAG_MINIM`.
- Test nou pentru proformă: Subtotal + TVA = Total în toate cazurile.
- Test pentru escrow: suma alocată + reținută = `suma_totala_platita`.
- Detectorul de română în EN pe paginile modificate (0).
