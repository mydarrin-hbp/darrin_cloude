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

---

### 2.2 Paginile de prezentare și conversie

#### Modelul de referință (azi)
- Home Best Pal SRL (CUI 46577229) e antreprenorul general și vinde servicii integrate, la cerere. **Date ANAF reale:** cod CAEN principal **4120** (construcții de clădiri). Decizia deschisă „codul CAEN al firmei: 41.00 / 43.xx vs 43.60” rămâne la LM; paginile nu menționează nicăieri codul, iar prezentarea „Antreprenor General Digital” (`despre-noi.html:1242`, `afla-ce-facem.html:1241`, `cum-comanzi.html:917`) e compatibilă cu 4120.
- 0% comision din manoperă, 100% la partener.
- Prețul public = formula din back-office, cu procente configurabile.
- Furnizorii de materiale / închirieri (și asigurătorii, `lib/discount-partener.js:19`, decizie LM 7 oct.) dau discount 5–15%; curierii nu (`lib/discount-partener.js:22-24`); HBP e furnizorul propriu, fără discount și fără factură de partener.
- Un partener vinde și primește comenzi doar dacă e aprobat, are contractul semnat și un cont bancar (regula 10c).
- Valoarea minimă de comandă (2.1).

**Date reale de comparație** (GET live, 16 oct.): `/api/public/statistici-homepage` → `clienti_activi: 12`, `parteneri_verificati: 2`, `devize_ai_luna: 0`; `/api/public/tari-active` → checkout activ în RO, AT, BG, GR, GB, MD; `/api/public/marketplace-produse` → 0 produse publice; `/api/public/pitch-deck` → nicio versiune aprobată (se afișează conținutul de rezervă din pagină).

#### Probleme comune tuturor paginilor

| # | Constatare | Unde (exemple) | Severitate |
|---|---|---|---|
| 1.2-T1 | **„Escrow” / „suma blocată” / „card pre-autorizat” / „plată garantată”**, dar singura metodă de plată acceptată e ordinul de plată, fără procesator (`api/comenzi/creeaza.js:114-130`), iar comanda nu blochează nicio sumă (comentariul de la `api/comenzi/creeaza.js:345-347`) | `mydarrin-cum-functioneaza.html:2451`, `cum-devii-operator-inchirieri.html:940`, `ghidul-asiguratorului.html:1264-1265`, `mydarrin-devino-partener.html:768`, `cum-devii-partenerul-nostru.html:2132-2133` | **critic** |
| 1.2-T2 | Țările „RO · MD · DE · FR · BG” — live sunt RO, AT, BG, GR, GB, MD | `mydarrin-cum-functioneaza.html:2472`, `cum-devii-furnizor-materiale.html:936`, `ghidul-asiguratorului.html:1345`, `:1481`, `mydarrin-investitori.html:568`, formularul `mydarrin-marketplace.html:1408-1410` | **major** |
| 1.2-T3 | „Plata în maximum 5 zile lucrătoare” — nicio regulă în cod; cifră fără sursă | `mydarrin-cum-functioneaza.html:1242`, `cum-devii-furnizor-materiale.html:958`, `intrebari-frecvente-parteneri.html:993`, `ghidul-asiguratorului.html:1340`, `mydarrin-marketplace.html:1469`, `:1498`, `cum-devii-curier-de-cartier.html:954` | **major** (decizie LM: termenul real) |
| 1.2-T4 | Aplicația mobilă: subsolul spune „în curând”, alte pagini o dau ca existentă („Disponibilă iOS & Android”, „Instalezi aplicația Curier”, „App … Obligatoriu”) | `cum-devii-partenerul-nostru.html:2158`, `cum-devii-curier-de-cartier.html:951`, `mydarrin-devino-partener.html:1392` (JS) | **major** |
| 1.2-T5 | Notificări SMS promise; în `api/` și `lib/` nu există niciun furnizor SMS | `cum-devii-partenerul-nostru.html:1982`, `:2038` | **major** |
| 1.2-T6 | Regula 10c (aprobare + contract semnat + cont bancar) lipsește din toate paginile de prezentare, cu excepția `mydarrin-devino-partener.html` (care cere contract și IBAN) | toate cele din listă | **major** |
| 1.2-T7 | Valoarea minimă de comandă nu e explicată nicăieri; `mydarrin-cum-functioneaza.html:1522` are în JS `vmcByCountry = {RON:'100 Lei', EUR:'25 EUR', MDL:'400 MDL', BGN:'40 BGN'}` și `vmc = 100` (`:1551`) | — | **major** |
| 1.2-T8 | Promisiuni „Darrin AI”: „verifică documentele instant / automat”, „deviz în 60 de secunde”, „AI selectează furnizorul cel mai apropiat, cu stoc”. În cod, documentele și partenerii sunt aprobați de admin (`api/admin/verifica-document.js`); restul — **neverificat** | `mydarrin-devino-partener.html:722`, `:754`, `:761`, `:809`, `mydarrin-marketplace.html:1465` | **major** |
| 1.2-T9 | Termenul de activare a contului: „48 de ore” (FAQ, devino-partener) vs „24h” (marketplace); niciunul nu e regulă în cod | `intrebari-frecvente-parteneri.html:923`, `mydarrin-devino-partener.html:724`, `mydarrin-marketplace.html:1437`, `:1444`, `:1457` | minor |
| 1.2-T10 | Subsolul: „© 2026 · Home Best Pal – UK · RO”; entitatea contractantă e Home Best Pal SRL (RO) | ex. `cum-devii-furnizor-materiale.html:1216`, `mydarrin-cum-functioneaza.html:2732` | minor (decizie LM) |
| 1.2-T11 | Newsletter: „promoții săptămânale” — **neverificat** că există | subsolul comun | minor |

#### Pe pagini

**`mydarrin-cum-functioneaza.html`**
- Nu spune că Home Best Pal e antreprenorul general, nu explică formula prețului și nici 0% din manoperă (apare doar în blocul comun de la `:2885`). **major**
- `:2457` „Fără intervenție umană în dispecerizare” — când nu se găsește partener, comanda ajunge la admin (`lib/notificari-comanda.js`, `notificaAdminFaraPartener`). minor
- `:2472` „TVA auto-detectat din IP” — TVA-ul se ia după țara adresei comenzii (`mydarrin-produs.html:4391-4392`, `tva-config.js`). minor
- `:2477` „Garanție … valabilă 6–36 luni după nivel” — fără sursă verificată. major

**`cum-devii-partenerul-nostru.html`**
- `:1278-1781` lista de servicii e scrisă de mână (instalații, tâmplărie, electrocasnice …), nu vine din catalog și din ruta de încadrare. **major** (legat de 1.3 și pasul 11)
- `:1920`, `:2147-2148` „tarife de urgență configurate separat în back-office” — **neverificat** că există un astfel de tarif.
- `:2026` „Materialele au fost deja livrate de furnizorul My Darrin înainte de sosirea ta” — nu există un flux care să garanteze asta. major
- `:2132-2133` „card blocat” (1.2-T1), `:2158` aplicația (1.2-T4), `:1982`, `:2038` SMS (1.2-T5).
- Corect: `:2055-2067` 100% din suma acceptată, costurile platformei plătite de client.

**`cum-devii-furnizor-materiale.html`**
- `:914` „ajunge la mii de clienți” — live: 12 clienți activi. **major**
- `:923-924`, `:955` livrare prin Curieri de Cartier cu „asigurare cargo inclusă” — **neverificat**; nu există o poliță cargo în cod.
- `:977` retur în 48h — nu există flux de retur în cod. major
- `:984` prețuri diferite pe țări „din portalul furnizor” — produsele au `moneda`, dar **neverificat** în dashboard.
- Lipsește: regula 10c, integrarea prin feed / API (vezi 1.6).

**`cum-devii-operator-inchirieri.html`**
- `:940` „Suma este pre-autorizată înainte de livrare” (1.2-T1). critic
- `:946`, `:977` „depozit de garanție” — nu există în `api/` sau `lib/`. major
- `:949`, `:984` „Ai 2 ore să confirmi” — nicio regulă în cod. major
- `:927-928` „Calendar rezervări în timp real” — panoul e gol în dashboard (vezi 1.7). major

**`cum-devii-curier-de-cartier.html`**
- `:925-927` „Virament zilnic / Plată zilnică” contrazice `:954` „plata în maximum 5 zile lucrătoare” pe aceeași pagină. major
- `:926` „bonus distanță + rating bonus”, `:931` „Raza maximă 15 km” (vs „recomandăm max 5 km”, `mydarrin-devino-partener.html:1563`, și cursorul 5–100 km din `cum-devii-partenerul-nostru.html:1811`), `:951` curs de 30 de minute, `:958` „Android 8+ / iOS 13+” — fără sursă. major
- Corect: curierul nu dă discount (nu apare nicio mențiune de discount).

**`ghidul-asiguratorului.html`**
- `:1264-1265` „Card blocat, nu colectat … pre-autorizată” (1.2-T1). critic
- `:1296-1298`, `:1405`, `:1417` plafoane „5.000 €” și „10.000 €”; checkout-ul spune „până la 5.000 Lei” (`mydarrin-checkout.html:1557`). Cifre fără sursă și contradictorii. **major**
- `:1270`, `:1300`, `:1407-1425` „decontare în 7 zile” — fără sursă. major
- `:1325` „cererea se trimite simultan tuturor asigurătorilor” — **neverificat**; nu există azi un asigurător integrat.
- Corect față de cod: discountul asigurătorului (5–15%) e în `lib/discount-partener.js:19`.

**`intrebari-frecvente-parteneri.html`**
- `:1014` „Dacă clientul nu confirmă în 48h … sistemul confirmă automat” — codul are **24h** (`api/cron/auto-confirma-comenzi.js:20`, `FEREASTRA_TACITA_ORE = 24`). **major**
- `:944` „Primele 3 comenzi monitorizate … rating ≥4.5★ → Partener verificat” — nu există în cod. major
- `:930` „ANRGN pentru instalatori gaz” — autoritatea actuală e ANRE. minor
- Corect: `:1000` (0% din manoperă), `:958` (alocare + email + dashboard).

**`mydarrin-devino-partener.html`**
- `:768` „Clientul plătește integral la plasarea comenzii. Suma este blocată în Escrow” (1.2-T1). critic
- `:691-696` „Raportare automată ASF”, „Branding propriu” — **neverificat**. major
- `:735` „Suport dedicat în primele 30 de zile” — **neverificat**. minor
- JS `:1384` „Urgent +30%”, `:1564` „+30%”, `:1565` „+20% tarif” — coeficienți fără sursă. major
- Corect și aliniat: `:775` (0% din manoperă, discount 5–15%), `:782` (partenerul facturează către Home Best Pal SRL, antreprenor general), `:1553`, `:1983` (curier 0%).

**`mydarrin-marketplace.html`**
- `:1304-1306` „Furnizor principal: ACA BG · Bacău · CUI 32667674” — o firmă reală prezentată ca furnizor principal; furnizorul propriu e HBP, iar live nu există niciun produs public. Același nume apare pe carduri în `mydarrin-catalog.html:2866`, `:2902`, `:3010`, `:3087` și în `i18n/en/mydarrin-dashboard-furnizor.json:122`. **critic** (decizie LM: există un acord cu ACA BG?)
- `:1341`, `:1359-1365`, `:1594-1646` „WooCommerce · Shopify verificate”, „Compatibil verificat”, „plugin My Darrin”, „Instalare în 10 minute”, „Shopify App Store” — nu există nicio integrare pentru furnizori (vezi 1.6). **critic** (promisiune falsă către furnizori)
- `:1630` „PrestaShop ⏳ Q3 2026” — termen trecut; `:1638` „Q4 2026”. major
- `:1342` „Stoc gestionat în timp real”, `:1351` „Calendar disponibilitate live” — vezi 1.7. major
- `:1277` „Furnizori verificați · Live” — 0 produse publice. minor
- Simulatorul (`:1530-1574`) e marcat corect ca simulator; sumele sunt doar în Lei. minor

**`mydarrin-marketplace-materiale.html`** (lista publică de produse)
- Textul e tradus; prețul afișat „TVA inclus”; lipsește mențiunea pragului minim (vezi 2.1). major

**`mydarrin-investitori.html`** — cea mai gravă pagină
- `:1974-2141` fereastra „KPIs Live · Actualizat în timp real” (deschisă din butonul `:1214`) afișează cifre **fixe, scrise în HTML**, prezentate ca rezultate: „↑ +24.7% MoM”, „↑ +31% MoM”, „+18% vs T1”, „NPS +68”, comenzi Ian–Iun 2026 „312 · 401 · 518 · 634 · 800 · 1.000+”, venit pe țări (MD 7.7K, DE 2.9K, FR 1.4K, BG 0.4K), „Comenzi active acum 247”, „Escrow blocat: 284.000 Lei”, CAC / LTV / retenție 51%. Live: 12 clienți activi, 2 parteneri verificați. **critic** (informații false pentru investitori)
- `:572` „Equity oferit 20%” vs `:999` „12,5%” (și pitch deck-ul: 12,5%). **critic**
- `:1833-1841` „25.000 EUR · 2% equity”, „50.000 EUR · 4%”, „100.000+ EUR · 8%+” — la post-money 4.000.000 EUR, 25.000 EUR = 0,625%, 50.000 = 1,25%, 100.000 = 2,5%. Calcul greșit. **critic**
- `:1207` „Ticket minim 25K EUR” vs `:1001` „Investiție minimă 1.000 EUR = 1 acțiune”. **critic**
- `:1022-1037`, `:1743-1745` „40% completat · 200.000 EUR angajat” — valori fixe în HTML, fără sursă în date. **critic** (decizie LM: există angajamente reale?)
- `:816` „Take rate: 10%” — contrazice modelul (0% din manoperă; comisionul din back-office). major
- `:956-967` TAM / SAM / SOM €180B / €12B / €120M vs pitch deck 40 Mld. € / 500 Mil. € / 39,7 Mil. € — fără sursă și contradictorii. major
- `:1056-1076` alocarea 40 / 25 / 20 / 15% vs pitch deck 35 / 45 / 15 / 5%. major
- `:1129`, `:1157-1159` „ROI 20–48×” vs pitch deck „6×–10×”. major
- `:1096-1098` „Q1–Q2 2026 · Platformă live în RO și MD … Realizat”. major
- `:728` „Impozit ANAF 8% dividende” — cotă scrisă în pagină, fără sursă; cota s-a schimbat după 2024 — de confirmat cu contabilul. major
- `:732` „Next distribuție Q4 2026”, `:747` buy-back „−10%”, `:755` lock-up 12 luni, `:1003` „12 luni runway garantat” — termeni fără document sursă. major
- `:781` „Date reale din Supabase” — datele vin din RPC `get_live_investor_kpis`, apelat cu cheia anon (`mydarrin-investitori.html:1406-1427`, `:1562-1570`). Cifrele **neverificate** (apel POST, nu GET). De verificat de LM: funcția e `security definer` și executabilă de `anon`? (regula din CLAUDE.md).
- Traducere: câteva texte fără EN („Equity oferit”, „angajat”, „Take rate:”); restul paginii e tradus static.

**`mydarrin-pitch-deck.html`** (+ `i18n/en/mydarrin-pitch-deck.json`, `api/public/pitch-deck.js`)
- Pagina e **publică** (`middleware.js`, `PAGINI_PUBLICE`; `BARIERA_GENERALA_ACTIVA = false`), deși investitori trimite la „Data Room … sub NDA” (vezi 1.4).
- Live nu există o versiune aprobată (`slides: null`), deci se afișează `SLIDES_REZERVA` (`:109-199`).
- Slide 8 (`:146-150`) „Tracțiune & validare”: „Validare în 7 hub-uri regionale”, „Acorduri prealabile cu asigurători și dezvoltatori” — prezentate ca rezultate, fără sursă. **critic**
- Slide 7 (`:145`) TAM 40 Mld. € / SAM 500 Mil. € / SOM 39,7 Mil. € — fără sursă; diferite de investitori. major
- Slide 10 (`:156-158`) „Abonamente SaaS recurente” — nu există în model sau în cod. major
- Slide 12 (`:171`) „Plată garantată … Escrow real” (1.2-T1). critic
- Slide 15 și 17 sunt marcate ca proiecții / ținte — corect.
- Traducere: 132 de texte de slide, 12 fără EN (nume proprii, „MY DARRIN”, „Rezerve” — doar „Rezerve” e de tradus). O versiune aprobată din back-office (`pitch_deck_versiuni.slide_uri`) n-ar avea EN: tabela nu are câmp de traducere. major (la prima aprobare)

#### Pagina lipsă: „Cum folosesc marketplace-ul” (propunere, nu scrisă)
- **Fișier:** `cum-folosesc-marketplace.html` + `i18n/en/cum-folosesc-marketplace.json`; adăugată în `PAGINI_PUBLICE` din `middleware.js` și în `sitemap.xml`.
- **Loc în meniu:** subsol → „Suport Clienți” (lângă „Cum comand”, „Cum plătesc”); meniul lateral → „Catalog / Marketplace”; link din antetul `mydarrin-marketplace-materiale.html` („Cum funcționează?”).
- **Conținut (RO + EN), pe secțiuni:**
  1. Ce găsești: materiale și închirieri de la furnizori aprobați, la prețul public (cu TVA), vândute de Home Best Pal ca antreprenor general.
  2. Cum alegi: căutare, categorii (din ruta de încadrare), cantitate / zile de închiriere.
  3. Singur sau cu un serviciu: comandă directă sau „Adaugă la serviciu” din configuratorul serviciului.
  4. Prețul: cum se formează (fără procente fixe, „configurate de platformă”), TVA inclus, valoarea minimă de comandă (după decizia din 2.1).
  5. Plata: azi doar ordin de plată; proforma; ce înseamnă escrow când va exista un procesator (fără promisiuni false).
  6. Livrarea / predarea: cine livrează, cum confirmi recepția (`confirmare-livrare.html`).
  7. Probleme și reclamații: `reclamatii.html`; returul — doar după ce LM decide politica.
  8. Întrebări frecvente scurte.

#### Decizii pentru LM
1. **Escrow / plata:** până la integrarea unui procesator, toate paginile spun „plată prin ordin de plată, suma ajunge în contul Home Best Pal și se distribuie după confirmare”? (recomandat) Sau păstrați „escrow” cu o explicație?
2. **Termenele de plată către parteneri** (azi „5 zile lucrătoare” fără sursă) și **termenul de confirmare tacită** (24h în cod vs 48h în FAQ): care sunt cele reale?
3. **ACA BG:** există un acord care permite afișarea numelui și CUI-ului? Dacă nu, se scoate de peste tot.
4. **Pagina de investitori și pitch deck-ul:** care sunt cifrele oficiale (equity, ticket minim, alocare, TAM / SAM / SOM, ROI)? Fereastra „KPIs Live” se scoate sau se leagă de date reale?
5. **Integrările de magazin** (WooCommerce, Shopify …): se scot până la pasul din 1.6 sau rămân ca „în pregătire”, fără „verificat”?
6. **Subsolul „Home Best Pal – UK · RO”:** ce entități se afișează?
7. **Codul CAEN:** ANAF arată 4120; decizia „41.00 / 43.xx vs 43.60” rămâne deschisă.

#### Planul
- **Bază de date:** `pitch_deck_versiuni` — coloană `slide_uri_en jsonb` (migrare propusă), ca o versiune aprobată să fie bilingvă.
- **Back-end:** `api/public/pitch-deck.js` întoarce `slide_uri_en` după limbă; `api/public/statistici-homepage` (sau un endpoint nou, GET, fără date personale) ca sursă unică pentru cifrele afișate (parteneri verificați, clienți activi, țări active).
- **Front-end:** un fișier comun pentru blocurile repetate (țări active din `/api/public/tari-active`, termene, metoda de plată), ca un text să nu mai fie corectat în 10 pagini; scoaterea ferestrei „KPIs Live” fixe din `mydarrin-investitori.html`.
- **Conținut (RO + EN):** rescrierea frazelor din tabelele de mai sus, pagină cu pagină, în aceeași sesiune pentru RO și EN (dicționarele `i18n/en/<pagina>.json`); pagina nouă „Cum folosesc marketplace-ul”.
- **Teste:** detectorul de română în EN (0) pe toate paginile atinse; un test nou care caută în HTML cuvintele interzise până la decizie („pre-autorizat”, „card blocat”, „RO · MD · DE · FR · BG”, „ACA BG”, „SMS”); verificare manuală RO / EN la 390 px și 1366 px.

---

### 2.3 Catalogul de servicii (România)

#### Starea actuală (cu dovezi)

**Confirmare live.** Pagina `/mydarrin-catalog` citește `catalog_servicii` direct prin REST-ul Supabase, cu cheia anon (`mydarrin-catalog.html:5673-5678`). Am făcut aceeași citire (GET, `select=*`, 16 oct.): `Content-Range: 0-225/226`. Toate cifrele lui LM se confirmă:

| Indicator | Valoare live | Cifra LM |
|---|---|---|
| Rânduri | 226, toate `stare = publicat`, `status_public = true` | 226 ✓ |
| Pe categorii | 88 `servicii`, 128 `materiale`, 10 `inchirieri` | ✓ |
| Rânduri de test („… vN”) | 100, **toate în `materiale`** (ex. „Teava cupru 15mm v34”, „Robinet trecere sferic 1/2 v1”), numerotate v1–v100 | 100 ✓ |
| Imagini | 223 fără, 1 cu 1–2, 2 cu ≥ 3 (singurul serviciu: „Montaj Parchet Laminat”, 3 imagini) | ✓ |
| Descriere ≥ 100 caractere | 17 (11 servicii, 6 materiale), toate între 100 și 1.000 | 17 ✓ |
| Caracteristici tehnice | 0; fișe tehnice 0; etape de lucru 1 | 0 ✓ |
| Traduceri EN | 0 rânduri cu `traduceri` completat; `/api/public/traduceri-catalog?lang=en` întoarce `_texte: {}` | — |
| Ruta de încadrare | `nod_id` completat: 0; `ruta_validata_la` completat: 0 | — |
| Coduri | `cod_esco`: 171; `cod_uniclass`: 159; `categorie_id`: 87 | — |
| Preț calculabil din rețetă | 24 de servicii (GET `/api/public/servicii-cu-reteta`); 33 de servicii nu au niciun rând în `catalog_niveluri` | — |
| `rating` | 36 de rânduri au o notă 4,6–4,97 fără nicio recenzie în spate (nu e afișată azi) | — |
| **Conforme** | **0** | 0 ✓ |

- Nu există coloană de țară: catalogul e comun, prețul se calculează pe țară (`lib/calculeaza-pret.js`).
- Cheia anon citește toate coloanele tabelului, inclusiv cele interne (`creat_de`, `ruta_rezultat`).
- Prețurile serviciilor fără rețetă vin din pagină: `mydarrin-produs.html` are `TIER_DB` scris de mână, cu prețuri fixe pe nivel (`:3464`) și calea veche de calcul (vezi 2.1, 1.1-e, 1.1-g).

#### Criteriul „serviciu conform” (propunere)
Un rând din `catalog_servicii` cu `categorie = servicii` e **conform** dacă îndeplinește toate condițiile:
1. Titlu în RO și în EN (`traduceri.en.titlu`).
2. Cel puțin 3 imagini reale (`imagini`), din lucrări reale; nicio imagine generată prezentată ca lucrare reală.
3. Descriere de 100–1.000 de caractere, în RO și în EN.
4. Etape de lucru (`etape_lucrare`) completate, RO + EN.
5. Specificații (`caracteristici_tehnice` sau `fise_tehnice`) completate.
6. Preț calculabil pentru RO la fiecare nivel activ (fiecare `catalog_niveluri` al serviciului are rețetă tarifată; `api/public/calculeaza-pret-nivel.js` întoarce `disponibil: true`).
7. Ruta de încadrare validă: `nod_id` completat, `ruta_validata_la` completat, fără erori (`lib/ruta-incadrare.js`).

Verificarea se face în back-office (o coloană „conform / ce lipsește”) și într-un script de test, nu manual.

#### Tabelul pe capitole de meniu
Capitolul e calculat din clasa NACE a rândului, cu tabelul din `docs/regula-incadrare.md:40-53` (clasele explicite înaintea diviziunilor), pentru că `nod_id` e gol peste tot și `meniu_capitole` nu se poate citi cu cheia anon.

| Capitol | Total | Servicii reale | Rânduri de test | Produse de mutat în marketplace | Servicii cu rețetă (preț calculabil) | Conforme |
|---|---|---|---|---|---|---|
| F — Construcții și renovări | 177 | 50 | 100 | 27 | 20 | 0 |
| N — Proiectare și servicii tehnice | 9 | 9 | 0 | 0 | 0 | 0 |
| O81 — Curățenie și spații verzi | 11 | 10 | 0 | 1 | 1 | 0 |
| T — Reparații casă, auto, moto | 7 | 6 | 0 | 1 | 1 | 0 |
| AGR — Servicii agricole | 1 | 1 | 0 | 0 | 1 | 0 |
| H — Transport, mutări, curierat | 7 | 7 | 0 | 0 | 1 | 0 |
| E — Moloz și deșeuri | 0 | 0 | 0 | 0 | 0 | 0 |
| O77 — Închirieri | 9 | 0 | 0 | 9 | 0 | 0 |
| G — Aprovizionare materiale | 0 | 0 | 0 | 0 | 0 | 0 |
| L — Asigurări | 0 | 0 | 0 | 0 | 0 | 0 |
| O78 — Personal calificat | 0 | 0 | 0 | 0 | 0 | 0 |
| fără NACE (`nace` gol) | 5 | 5 | 0 | 0 | 0 | 0 |
| **Total** | **226** | **88** | **100** | **38** | **24** | **0** |

Note:
- Cele 38 de produse de mutat = 28 de materiale (fără test) + 10 închirieri. Ele apar azi la capitolele F, O81, T și O77 pentru că au clasa NACE a serviciului, nu a comerțului (G) sau a închirierii (O77).
- 9 rânduri nu au o clasă NACE completă: 5 fără NACE, 2 cu doar diviziunea (`F 41`, `F 43`), 1 cu grupa (`N 77.1`) și 1 de închiriere fără clasă. Ruta nu se poate valida pentru ele.
- Litera secțiunii NACE din câmpul `nace` e neuniformă: aceeași diviziune 77 apare ca `O 77.32` (6 rânduri) și `N 77.32` / `N 77.39` / `N 77.1` (3 rânduri); în NACE Rev. 2.1, diviziunea 77 e în secțiunea N. La fel `O 81.10` / `N 81.30`. Capitolul se calculează corect din cifre, dar textul se uniformizează când se completează ruta.

#### Probleme

| # | Problemă | Severitate |
|---|---|---|
| 1.3-a | 100 de rânduri de test publicate, vizibile public, în catalog | **critic** |
| 1.3-b | 0 servicii conforme; 223 de rânduri fără imagine; 0 cu caracteristici; 0 traduceri EN în baza de date (contrazice regula bilingvă) | **critic** |
| 1.3-c | 38 de produse (materiale, închirieri) în catalogul de servicii, din modelul vechi; nu respectă regula „active supplier” (10c) și nu au furnizor | **major** |
| 1.3-d | Ruta de încadrare goală (`nod_id`, `ruta_validata_la`) pe toate cele 226 de rânduri — de aici și meniul care nu filtrează (vezi 1.5) | **major** |
| 1.3-e | 64 de servicii reale fără preț calculabil (88 − 24); 33 fără niciun nivel; pentru ele pagina de produs folosește prețuri scrise în cod | **major** |
| 1.3-f | `rating` 4,6–4,97 pe 36 de rânduri, fără recenzii — date inventate (neafișate azi) | minor |
| 1.3-g | Cheia anon citește toate coloanele `catalog_servicii` | minor |

#### Decizii pentru LM
1. **Rândurile de test:** ștergere definitivă (recomandat, dacă nu sunt legate de comenzi) sau doar ascunse (`stare = arhivat`).
2. **Cele 38 de produse:** reintroduse ca produse HBP (furnizor propriu) în marketplace, prin șabloanele din `docs/sabloane/`, **cu prețuri din lista HBP** (recomandat), sau șterse.
3. **Serviciile fără rețetă (64):** rămân publicate „la evaluare” (fără preț) sau se ascund până au rețetă? Recomandare: ascunse din catalog, vizibile doar în back-office.
4. **Imaginile reale:** de unde vin — (a) fotografii HBP din lucrări proprii, (b) fotografii ale partenerilor aprobați, din portofoliu, cu acordul lor scris, (c) imagini de stoc licențiate, marcate vizibil „imagine ilustrativă”. Imaginile generate nu se folosesc ca „lucrare reală”. Recomandare: (a) + (b); (c) doar cu marcaj.
5. **Câmpul `rating`:** se golește până există recenzii reale.

#### Planul
**Bază de date (migrări propuse, fiecare într-o tranzacție, rulabilă de mai multe ori, cu verificare la final)**
1. `AAAA-LL-ZZ_catalog_curatare_test.sql`: listează întâi legăturile rândurilor „vN” (`catalog_relatii`, `catalog_niveluri`, `comenzi.addon_materiale_selectate`, `devize_articole`); apoi `stare = 'arhivat'`, `status_public = false`; ștergerea doar pentru rândurile fără nicio legătură. Verificare: 0 rânduri „vN” publicate.
2. `AAAA-LL-ZZ_catalog_produse_marketplace.sql`: după importul HBP, cele 38 de produse vechi trec pe `arhivat`; legăturile `catalog_relatii` → produsele noi din marketplace (dacă LM le vrea păstrate).
3. `AAAA-LL-ZZ_catalog_rating.sql`: `rating = null` unde nu există recenzii.
4. Opțional: o vedere publică `catalog_servicii_public` (doar coloanele afișate), iar cheia anon citește vederea, nu tabelul.

**Back-end**
- `api/admin/catalog.js`: câmpul calculat „conform / ce lipsește” pentru fiecare serviciu, după criteriul de mai sus; filtrul „neconforme” în back-office.
- Publicarea (`stare = publicat`) refuzată pentru un serviciu neconform (după decizia 3).
- Importul HBP prin `api/marketplace/importa-csv.js` (deja există), cu furnizorul propriu.

**Front-end**
- `mydarrin-admin-catalog.html` / superadmin: lista neconformităților pe serviciu; încărcarea imaginilor (`api/admin/catalog-imagini.js`, deja există, max. 5) — de ridicat la minimum 3 cerute pentru conformitate.
- `mydarrin-catalog.html` și `mydarrin-produs.html`: afișează doar serviciile publicate; fără prețuri din `TIER_DB` (legat de 2.1 și 2.5).

**Conținut (RO + EN)**
- Pentru fiecare dintre cele 88 de servicii: titlu, descriere, etape, specificații, în RO și EN (`traduceri.en`). Lucrul se împarte pe capitole (F întâi: 50 de servicii, dintre care 20 au rețetă).
- Imaginile, după decizia 4.

**Teste**
- Script nou `scripts/test-catalog-conformitate.js`: aplică criteriul pe date simulate (fiecare condiție, pe rând).
- Verificare după migrare: 0 rânduri „vN” publicate; 0 materiale / închirieri în `catalog_servicii` publicate.
- Detectorul de română în EN pe `/mydarrin-catalog` și pe 3 pagini de serviciu (0).

---

### 2.4 Distribuirea pe rețele sociale și Open Graph

#### Starea actuală (cu dovezi)

**Etichetele OG / Twitter (52 de pagini HTML).** Confirmat: **27** de pagini au `og:image` și `twitter:card` (toate 27 au și `og:title`, `og:description`).

| Grup | Pagini |
|---|---|
| Cu OG + Twitter (27) | `index`, `afla-ce-facem`, `cum-comanzi`, `cum-devii-curier-de-cartier`, `cum-devii-furnizor-materiale`, `cum-devii-operator-inchirieri`, `cum-devii-partenerul-nostru`, `cum-platesc`, `cum-prestam-livram`, `cum-programez-serviciu`, `despre-noi`, `garantii-si-asigurari`, `ghidul-asiguratorului`, `intrebari-frecvente-clienti`, `intrebari-frecvente-parteneri`, `mydarrin-app-mobile`, `mydarrin-catalog`, `mydarrin-categorie-inchirieri`, `mydarrin-categorie-materiale`, `mydarrin-categorie-servicii`, `mydarrin-cum-functioneaza`, `mydarrin-devino-partener`, `mydarrin-investitori`, `mydarrin-marketplace`, `mydarrin-produs`, `mydarrin-serviciu`, `servicii-urgente` |
| Publice, **fără** OG (de completat) | `mydarrin-marketplace-materiale`, `mydarrin-pitch-deck` (după decizia de mai jos), `mydarrin-contact`, `mydarrin-creeaza-deviz`, `mydarrin-cos`, `mydarrin-termeni`, `mydarrin-politica-confidentialitate`, `reclamatii` |
| Fără OG, corect așa (cont, plată, interne) | `mydarrin-checkout`, `confirmare-livrare`, `reset-password`, `acces-temporar`, `acord-confidentialitate`, cele 3 dashboard-uri, `mydarrin-devino-partener-wizard`, `mydarrin-admin-catalog`, `mydarrin-superadmin`, `mydarrin-backoffice-serviciu`, `mydarrin-deviz-engine`, `mydarrin-auth-schema`, `mydarrin-sync-architecture`, `mydarrin-business-model`, `mydarrin-design-system` |

**Imaginea OG**
- 26 de pagini folosesc aceeași fotografie de stoc Unsplash: `https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1200&q=80` (ex. `cum-devii-furnizor-materiale.html:325`). Descărcată live: **1200 × 795**, nu 1200 × 630; e o imagine de stoc externă, nu a My Darrin.
- `index.html:329` folosește `/api/branding/logo-image?slot=header_logo` (logo-ul real): **900 × 629** PNG, nu 1200 × 630.
- Niciuna nu declară `og:image:width` / `og:image:height`; doar `index.html` are `og:image:alt`.

**Titlul și descrierea**
- Toate etichetele OG sunt scrise în română, statice, în HTML. Engleza e limba implicită la prima vizită, dar un crawler (fără `localStorage`, fără JavaScript) primește mereu româna: `GET /?lang=en` cu agentul `facebookexternalhit` întoarce `<html lang="ro">` și titlul român.
- `seo-meta.js:1-16` suprascrie doar `title` / `description` din JS, după răspunsul API-ului — crawlerele sociale nu-l văd (spune chiar comentariul).
- `index.html:317-320`: descrierea OG promite „deviz AI în 60 de secunde, plată escrow securizată” (vezi 1.2-T1, 1.2-T8).

**Butoanele de distribuire**
- `share-widget.js` e inclus pe aceleași 27 de pagini cu OG (inclusiv `index` și `mydarrin-investitori`): Web Share API (`navigator.share`) pe mobil; pe desktop Facebook, WhatsApp, X, LinkedIn, Email și „Copiază linkul” (`share-widget.js:1-15`).
- `mydarrin-serviciu.html:1530-1532` are și un bloc inline (`MydShare.creeazaBlocInline`).
- Linkul distribuit e `location.href`, deci un link de serviciu e corect pentru om, dar crawlerul rețelei îl citește ca mai jos.

**Paginile dinamice văzute de un crawler** (`curl -A "facebookexternalhit/1.1"`, producție, 16 oct.)

| URL | Ce primește crawlerul |
|---|---|
| `/catalog/servicii/instalatii-electrice/inlocuire-becuri-corpuri` | 200, `lang="ro"`, `og:title` „Configurare comandă \| My Darrin”, `og:url` `…/mydarrin-produs` (fără slug), imaginea de stoc |
| `/mydarrin-produs?slug=inlocuire-becuri-corpuri&type=servicii` | identic |
| `/mydarrin-serviciu` | `og:title` „Înlocuire calorifer — Bronz→Platinum”, același pentru orice serviciu (text fix în `mydarrin-serviciu.html:310-316`) |
| `/mydarrin-marketplace-materiale` | doar `<title>` „Materiale și închirieri”, fără OG |

Concluzie: **orice serviciu sau produs distribuit apare cu același card generic**, în română, cu o imagine de stoc, iar `og:url` trimite spre pagina fără slug (rețeaua poate grupa toate distribuirile pe aceeași adresă).

**Pitch deck-ul și acordul de confidențialitate**
- `middleware.js`: `mydarrin-pitch-deck` și `mydarrin-investitori` sunt în `PAGINI_PUBLICE`; `BARIERA_GENERALA_ACTIVA = false`. Live: `GET /mydarrin-pitch-deck` → 200, fără autentificare.
- Fluxul `/acces-temporar` + `/acord-confidentialitate` există (`middleware.js`, `treceBarieraPlatforma`, `nda_pending`), dar se aplică doar paginilor din afara `PAGINI_PUBLICE`, cu bariera generală pornită.
- `mydarrin-investitori.html:1902-1916` spune că actele și datele sunt „Sub NDA” și cere acceptarea NDA-ului; pitch deck-ul (cu cifrele rundei) e totuși public, iar pagina de investitori are buton de distribuire. **Conflict — decizie LM.**

**Constatare conexă (în afara listei, dar găsită aici).** `mydarrin-business-model` și `mydarrin-design-system` (documente interne) răspund live cu 200, fără autentificare: nu sunt nici în `PAGINI_STRICTE`, nici în `PAGINI_PUBLICE`, iar cu bariera oprită trec (`middleware.js`, `if (!BARIERA_GENERALA_ACTIVA) return next()`). `robots.txt` blochează doar variantele `.html`, nu și adresele curate (`/mydarrin-superadmin`, `/mydarrin-checkout`), cu `cleanUrls: true` în `vercel.json`.

#### Probleme

| # | Problemă | Severitate |
|---|---|---|
| 1.4-a | Serviciile și produsele distribuite apar toate cu același card generic; `og:url` fără slug | **major** |
| 1.4-b | OG doar în română, deși engleza e implicită; crawlerul nu poate primi EN | **major** |
| 1.4-c | Pitch deck-ul public vs. „sub NDA” pe pagina de investitori; buton de distribuire pe pagina cu cifre false (2.2) | **major** (decizie LM) |
| 1.4-d | `mydarrin-business-model` și `mydarrin-design-system` publice | **major** |
| 1.4-e | Imaginea OG: stoc extern, 1200 × 795; logo 900 × 629; fără dimensiuni declarate | minor |
| 1.4-f | 8 pagini publice fără OG | minor |
| 1.4-g | `robots.txt` nu acoperă adresele fără `.html` | minor |

#### Decizii pentru LM
1. **Pitch deck:** (a) public, cu cifre marcate „țintă” și fără date confidențiale, sau (b) în spatele NDA-ului (`/acord-confidentialitate`), scos din `PAGINI_PUBLICE`. Recomandare: **(b)** până la corectarea cifrelor din 2.2; butonul de distribuire scos de pe `mydarrin-investitori`.
2. **Imaginea OG implicită:** o imagine de marcă 1200 × 630, făcută de echipa HBP (nu stoc); pentru servicii, prima imagine reală a serviciului, când există (vezi 1.3).
3. **Paginile interne** (`business-model`, `design-system`): mutate în `PAGINI_STRICTE` (recomandat).

#### Planul
**Back-end**
- Funcție nouă `api/public/pagina-meta.js` (GET): primește tipul (serviciu / produs marketplace), slug-ul și limba; citește `catalog_servicii` (titlu, descriere, prima imagine, `traduceri.en`) sau produsul din marketplace; întoarce HTML-ul paginii statice (`mydarrin-produs.html`, inclus în funcție) cu `<head>` completat pe server: `title`, `description`, `og:title`, `og:description`, `og:image` (+ `width` / `height` / `alt`), `og:url` canonic cu slug, `og:locale` (`en_GB` / `ro_RO`), `og:locale:alternate`, `twitter:*`, `link rel="canonical"` și `hreflang`. Fără cod după agent (același HTML pentru oameni și crawlere — nu e „cloaking”).
- `middleware.js`: rutele `/catalog/:tip/:categorie/:slug` și `mydarrin-produs?slug=` se rescriu spre `api/public/pagina-meta`; la fel o rută nouă pentru produsele din marketplace (`/marketplace/:tip/:slug`).
- Limba: `?lang=en|ro`; fără parametru → engleza (regula din CLAUDE.md); linkul copiat de `share-widget.js` adaugă `lang` după limba activă.
- `middleware.js`: `mydarrin-business-model`, `mydarrin-design-system` în `PAGINI_STRICTE`; `mydarrin-pitch-deck` după decizia 1.

**Front-end**
- `share-widget.js`: URL-ul canonic (cu slug și `lang`), nu `location.href` brut.
- Etichete OG pentru cele 8 pagini publice fără OG; `og:image:width/height/alt` pe toate; imaginea implicită 1200 × 630 în `assets/`.
- `robots.txt`: și adresele fără `.html`.

**Conținut (RO + EN)**
- Titlu și descriere OG în RO și EN pentru fiecare pagină statică (în `i18n/en/<pagina>.json` există deja textele de titlu; varianta EN a etichetelor statice se servește prin aceeași funcție sau prin fișiere `?lang=en` generate).
- Descrierea OG de pe `index` aliniată la 1.2 (fără „escrow securizat” / „60 de secunde”).

**Teste**
- Script nou `scripts/test-og-crawler.js`: pentru 3 servicii și 2 produse, `GET` cu agentul `facebookexternalhit` (local, `vercel dev`) → titlul serviciului, `og:url` cu slug, imaginea 1200 × 630 sau imaginea serviciului, EN implicit, RO cu `?lang=ro`.
- Verificare manuală în Facebook Sharing Debugger și LinkedIn Post Inspector după publicare (LM).

---

### 2.5 Filtrele din `/mydarrin-catalog` nu fac nimic

#### Cum am testat
Playwright (Chromium), local, pe `main` (`8c5de07`): fișierele servite din repo; cererile `/api/*` și REST-ul Supabase trimise ca **GET** spre producție, orice altă metodă blocată; limba RO; 1366 px. Pentru fiecare intrare din meniul lateral „Servicii” am apelat `filterCat('servicii', cheie, element)` și am numărat cardurile rămase vizibile. Nicio eroare JS.

#### Rezultatul

Grila are **102 carduri**: **14 statice**, scrise în HTML (`mydarrin-catalog.html:2278-3281`, cu „Min. 100 Lei · +5% zonă”, „ACA BG”), și **88 din baza de date** (toate serviciile publicate). Contorul spune „102 rezultate”.

| Intrare din meniu (cheie) | Carduri vizibile după click | Din baza de date | Servicii reale în baza de date pentru acea clasă NACE |
|---|---|---|---|
| Toate sanitare & termice (`F4322`) | 9 | 6 | 20 (NACE 43.22) |
| · **Calorifere & Radiatoare** (`F4322-cal`) | **102 (toate)** | 88 | 10 au „calorifer” în titlu |
| · Obiecte sanitare (`F4322-ob`) | **102 (toate)** | 88 | — |
| Toate electrice (`F4321`) | 9 | 8 | 15 (NACE 43.21) |
| · Corpuri iluminat (`F4321-ilum`) | **102 (toate)** | 88 | — |
| Uși, ferestre, parchet (`F4332`) | 2 | 1 | 1 |
| Curățenie (`O8121`) | 2 | 1 | 5 (NACE 81.2x) |
| Auto & Service (`T9531`) | 2 | 1 | 6 (NACE 95) |
| Consultanță (`N71`) | 2 | 2 | 7 (NACE 71) |
| Reparații & Instalare (`S9522`) | 1 | 1 — „Mutare mobilă și electrocasnice apartament” (un serviciu de transport) | — |
| Ospitalitate (`I5510`) | 0 | 0 | 0 |

#### Cauza exactă
1. **Subcategoriile nu filtrează deloc.** În `NACE_MAP` (`mydarrin-catalog.html:5838-5856`), subcategoriile au doar `keywords` (ex. `'F4322-cal': {…, keywords:['calorifer','radiator','termic']}`), fără `domains`. `applyFilters()` filtrează pe categorie **doar** dacă există `domains` (`mydarrin-catalog.html:5947-5958`: `acceptedDomains` rămâne `null`; condiția de la `:5970` este `if (acceptedDomains !== null)`). Cuvintele cheie se verifică numai în interiorul acelei condiții, deci nu se aplică niciodată. Rezultat: click pe „Calorifere & Radiatoare” → toate cele 102 carduri rămân → „nu se întâmplă nimic”.
2. **Categoriile filtrează după text, nu după cod.** Cardurile din baza de date primesc `data-cat` / `data-subcat` dintr-un dicționar scris de mână, `DOM`, după textul câmpului `domeniu` (`mydarrin-catalog.html:5468-5530`, `mkCard` la `:5548-5557`); nu primesc nici NACE, nici nod, nici slug de categorie (`data-nace`, citit la `:5963`, nu e pus pe carduri). Filtrul compară numele de domenii din `NACE_MAP` (ex. „Instalații sanitare”) cu `data-subcat` (ex. „Sanitare & Termo”) sau cu titlul. De aceea „Toate sanitare & termice” arată 6 din 20 de servicii, „Toate electrice” 8 din 15, iar „Reparații & Instalare” arată un serviciu de mutări.
3. **Meniul e scris de mână** (`mydarrin-catalog.html:1907-2071`): are intrări fără niciun serviciu (Ospitalitate, `I 55.10`) și nu are intrări pentru domenii care există în baza de date (Transport / mutări, Demolări, Betoane, Proiectare tehnică, Service moto). Contoarele `cat-count` rămân „—” (funcția care ar trebui să le completeze, `updateSidebar` din modulul de date, `:5636-5654`, caută containerul `sidebar-servicii-cats`, care nu există).
4. **Cardurile statice** (14) se amestecă cu cele reale și au propriile `data-cat` (ex. „Instalații”, „Exterior”), deci apar în rezultatele filtrelor.

Toate acestea au aceeași cauză de fond: în baza de date, `catalog_servicii.nod_id` e gol pe toate cele 226 de rânduri (vezi 2.3), deci pagina nu are după ce cod să filtreze și a ajuns să ghicească după text.

#### Probleme

| # | Problemă | Severitate |
|---|---|---|
| 1.5-a | Subcategoriile din meniu nu filtrează (toate cele 102 carduri rămân) | **major** |
| 1.5-b | Categoriile arată doar o parte din servicii (6 / 20, 8 / 15, 1 / 5) sau servicii greșite | **major** |
| 1.5-c | 14 carduri statice, demonstrative, amestecate cu serviciile reale | **major** |
| 1.5-d | Meniul nu corespunde catalogului (intrări goale, domenii lipsă), contoare „—” | minor |

#### Decizie pentru LM
- Niciuna nouă: soluția e pasul 11 deja planificat (meniuri generate din ruta de încadrare). Se recomandă **să nu se repare `NACE_MAP`** (ar fi încă un meniu scris de mână).

#### Planul (legat de pasul 11)
**Precondiție:** ruta de încadrare completată pentru serviciile publicate (`catalog_servicii.nod_id` → `categorii`, capitol → `meniu_capitole`), vezi 2.3.

**Bază de date**
- Nicio migrare nouă pentru filtre, dacă `meniu_capitole` și `categorii.capitol_cod` există deja (migrarea `2026-10-15_ruta_incadrare.sql`). Doar completarea datelor (`nod_id`) prin back-office.

**Back-end**
- Endpoint public nou, GET, `api/public/meniu-catalog.js`: capitolele active (`meniu_capitole`, RO + EN) → nodurile (`categorii`, RO + EN, slug) → numărul de servicii publicate pe nod; aceeași sursă și pentru marketplace (capitolele G și O77). Cache scurt (60 s).
- Opțional: `api/public/catalog-servicii.js` (GET, paginat, filtrat după `capitol` / `nod`), în locul citirii directe a tabelului cu cheia anon (legat de 1.3-g).

**Front-end**
- `mydarrin-catalog.html`: meniul lateral generat din endpoint (capitol → nod), fără HTML scris de mână; fiecare card primește `data-capitol` și `data-nod` (slug) din baza de date; filtrul compară codul, nu textul.
- Ștergerea `NACE_MAP`, `NACE_MAP_MAT`, `NACE_MAP_INC`, `DOM` și a celor 14 carduri statice; contoarele din endpoint.
- Adresa filtrului în URL (`?capitol=F&nod=calorifere`), ca un filtru să poată fi distribuit (legat de 2.4).

**Conținut (RO + EN)**
- Numele capitolelor și nodurilor vin din `meniu_capitole.titlu_ro/titlu_en` și `categorii.title/title_en` — fără texte noi în pagină.

**Teste**
- Test Playwright nou (`scripts/test-filtre-catalog.js`, local, cu răspunsuri simulate): pentru fiecare nod, cardurile vizibile = serviciile cu acel `nod_id`; niciun card static; un nod fără servicii nu apare în meniu.
- Detectorul de română în EN pe `/mydarrin-catalog` (0).

---

### 2.6 Marketplace-ul hibrid: magazinul furnizorului prin API sau marketplace-ul My Darrin

#### Modelul cerut de LM
Un furnizor de materiale / închirieri fie își conectează magazinul online, fie folosește marketplace-ul My Darrin; în ambele cazuri, produsele apar unificat și public în catalogul My Darrin, pe infrastructura platformei.

#### Ce există azi (cu dovezi)

| Componentă | Ce face | Dovadă |
|---|---|---|
| Import CSV | Rânduri parsate în pagină, trimise ca JSON; loturi de 300; job în `marketplace_importuri_csv`; validare (`lib/valideaza-produs-marketplace.js`) + ruta de încadrare (`valideazaRutaProdus`); `upsert` pe `(furnizor_id, cod_produs_furnizor)`; furnizorul importă doar pentru sine, adminul pentru oricine (după `cui_furnizor`) | `api/marketplace/importa-csv.js:1-30`, `:190-192` |
| Starea după import | **Fiecare rând importat primește `status: 'in_asteptare'`**, inclusiv un produs deja `live` reimportat | `api/marketplace/importa-csv.js:186` |
| Introducere manuală | CRUD pentru furnizor (doar pe propriul `furnizor_id`) și admin | `api/marketplace/produse.js:1-14` |
| Imagini | Obligatoriu 1–6 imagini, **toate urcate în `marketplace-media`**; un URL extern e refuzat | `lib/valideaza-produs-marketplace.js:94-100` |
| Aprobare | Produsul devine `live` doar după aprobarea adminului | `api/admin/marketplace-aprobari.js` |
| Regula „furnizor activ” (10c) | Public apar doar produsele furnizorilor care pot vinde (aprobat + contract + cont bancar, sau furnizorul propriu) | `lib/eligibilitate-partener.js:1-20`, `:136-139`; `api/public/marketplace-produse.js:140-142` |
| Prețul public | Calculat din prețul furnizorului cu formula din back-office; discountul partenerului nu apare public | `api/public/marketplace-produse.js`, `lib/calculeaza-pret.js` |
| Rate limit | Fereastră fixă pe IP, în Vercel KV; „fail-open” la eroare KV | `lib/rate-limit.js:20-36` |
| Integrări | `integrari_furnizori` (categorii: asigurări, marketplace_bricolaj, procesatori de carduri, curieri …), cheie API criptată (`cripteaza_camp`) — **pentru integrările platformei, gestionate de admin**, nu pentru furnizori | `api/admin/integrari/salveaza.js:1-16`, `lib/integrare-gate.js:1-12` |
| Panoul furnizorului | Se numește „Import CSV / API” | `mydarrin-dashboard-furnizor.html:547`, `:706` |
| Integrare furnizor prin API / feed | **Nu există** (niciun endpoint, nicio cheie per furnizor, niciun cron de sincronizare) | `vercel.json` (`crons`: niciun job de produse) |

Live (GET 16 oct.): 0 produse publice în marketplace (materiale și închirieri).

#### Probleme

| # | Problemă | Severitate |
|---|---|---|
| 1.6-a | Paginile promit integrări care nu există: „WooCommerce · Shopify verificate”, „plugin”, „API key”, „Instalare în 10 minute” (`mydarrin-marketplace.html:1359-1365`, `:1594-1646`); panoul se numește „Import CSV / API” | **critic** (vezi și 2.2) |
| 1.6-b | Reimportul unui produs `live` îl trece înapoi în `in_asteptare` — o sincronizare periodică l-ar scoate de pe site la fiecare rulare | **major** (blochează orice feed) |
| 1.6-c | Imaginile trebuie urcate manual în platformă; un feed nu poate trimite URL-uri | **major** (de rezolvat în arhitectură) |
| 1.6-d | Rate limit doar pe IP, „fail-open” — insuficient pentru un API public de scriere | **major** (pentru API-ul nou) |

#### Arhitectura propusă
Două canale de intrare, **o singură bandă de procesare** (aceeași validare, aceeași rută, aceeași aprobare, aceeași regulă „furnizor activ”, același preț public).

**Canalul A — feed (citit de platformă).**
- Furnizorul dă o adresă HTTPS a unui fișier CSV, JSON sau XML (formatele uzuale de export: șablonul My Darrin, Google Merchant, export WooCommerce).
- Un job programat (Vercel Cron, frecvența aleasă de LM; propunere: la 6 ore) citește fișierul, îl împarte în loturi de 300 (ca importul CSV de azi) și le trece prin bandă.
- Autentificarea la feed, dacă e nevoie, se dă ca antet (`Authorization` / cheie), salvată criptat (`cripteaza_camp`, ca la IBAN) — **niciodată în URL**.

**Canalul B — API (trimis de furnizor).**
- `POST /api/furnizor/v1/produse` (creare / actualizare în bloc, max. 500 de produse pe apel), `PATCH /api/furnizor/v1/stoc-pret` (doar preț și stoc, rapid), `DELETE /api/furnizor/v1/produse/:cod`, `GET /api/furnizor/v1/produse` (ce e publicat și starea fiecărui produs).
- Cheie per furnizor în antet: `Authorization: Bearer mdk_live_…`; în baza de date se păstrează doar prefixul și hash-ul (SHA-256); cheia se arată o singură dată; rotire și revocare din dashboard; `Idempotency-Key` pe scrieri.
- Rate limit pe cheie (nu doar pe IP), „fail-closed” pentru API-ul de scriere.

**Banda comună**
1. **Normalizare:** coloanele furnizorului → câmpurile validatorului, după o mapare salvată per sursă (`mapare_coloane`).
2. **Încadrare:** categoria furnizorului → nodul de meniu, clasa NACE și codul Uniclass `Pr_`, prin tabelul `furnizor_mapari_categorii` (o categorie a furnizorului se mapează o dată, de furnizor, verificat de admin). Rândurile fără mapare nu se publică; apar în „De încadrat” în dashboard.
3. **Validare:** `lib/valideaza-produs-marketplace.js` + `valideazaRutaProdus` (cele de azi). Erorile per rând, în RO și EN, în jurnalul sincronizării.
4. **Imagini:** platforma descarcă imaginile din URL-urile feed-ului (doar HTTPS, tip imagine, max. 5 MB, max. 6) și le urcă în `marketplace-media`; păstrează hash-ul ca să nu le descarce din nou.
5. **Aprobare:**
   - produs nou → `in_asteptare` → aprobarea adminului (ca azi);
   - schimbare doar de preț sau stoc → aplicată direct, fără reaprobare;
   - schimbare de titlu, descriere, imagini sau categorie → versiune nouă „în așteptare”; versiunea aprobată rămâne live până la aprobare.
6. **Prețul public:** mereu din formula din back-office, pornind de la `pret_fara_tva` al furnizorului; furnizorul nu trimite niciodată prețul public; discountul lui (`parteneri_discounturi`) rămâne intern. O schimbare de preț peste un prag (propunere: ±30%) se marchează pentru verificare (decizie LM).
7. **Stocul:** `stoc = 0` → produsul rămâne publicat, marcat „indisponibil”, fără buton de comandă; la checkout, stocul se verifică din nou (**neverificat** azi în `lib/rezolva-addon-materiale.js`; de confirmat la implementare).
8. **Produs șters la furnizor:**
   - API: `DELETE` → `activ = false` (offline), nu ștergere fizică (comenzile vechi îl referă);
   - feed complet: un produs care lipsește din 2 citiri consecutive → offline; revine automat dacă reapare;
   - după 90 de zile offline → arhivat (decizie LM).
9. **Regula „furnizor activ”:** sursele unui furnizor care încă nu poate vinde se pot sincroniza (catalog pregătit), dar produsele nu apar public până când `poateVinde` e adevărat (ca azi).
10. **Jurnal:** fiecare rulare scrie în `furnizor_sincronizari` (noi / actualizate / offline / erori), vizibil furnizorului și adminului; erorile repetate trimit un email (RO + EN).

**Securitate**
- Doar HTTPS; protecție SSRF la citirea feed-ului (fără IP-uri private, `localhost`, adrese de metadate; maximum 3 redirecționări; timp maxim 30 s; fișier maxim 20 MB).
- XML citit fără entități externe (XXE); JSON / CSV cu limită de rânduri pe rulare.
- Cheia API: doar în antet, păstrată ca hash, cu prefix vizibil pentru identificare; jurnal de audit la creare / rotire / revocare (`lib/audit-log.js`).
- Rate limit pe cheie și pe furnizor; răspuns `429` cu `Retry-After`.
- Validare strictă a fiecărui câmp (aceeași ca la CSV); niciun HTML acceptat în descriere.

**Conectorii WooCommerce / Shopify** (faza 2): un tip de sursă în plus, care citește API-ul magazinului cu o cheie **doar de citire** dată de furnizor și trece prin aceeași bandă. Nu se scrie „verificat” pe pagini până nu există și nu e testat.

#### Bază de date (migrare propusă, o tranzacție, rulabilă de mai multe ori)
- `furnizor_surse_produse` (id, `furnizor_id`, tip `feed` / `api`, format `csv` / `json` / `xml` / `woocommerce` / `shopify`, `url`, `antet_auth_criptat`, `frecventa_ore`, `mapare_coloane jsonb`, `activ`, `ultima_rulare_la`, `ultim_status`).
- `furnizor_chei_api` (id, `furnizor_id`, `prefix`, `hash`, `scopuri`, `creat_la`, `ultima_folosire_la`, `revocat_la`).
- `furnizor_mapari_categorii` (`furnizor_id`, `categorie_furnizor`, `nod_slug`, `nace_clasa`, `cod_uniclass`, `verificat_de`, `verificat_la`).
- `furnizor_sincronizari` (id, `sursa_id`, început / sfârșit, numărători, `erori jsonb`).
- Pe `marketplace_materiale` și `marketplace_echipamente`: `sursa` (`manual` / `csv` / `feed` / `api`), `sursa_id`, `vazut_ultima_data_la`, `hash_continut`, `versiune_in_asteptare jsonb`.
- RLS: furnizorul își vede doar rândurile proprii; funcțiile noi cu `search_path` fix; nimic `security definer` executabil de `anon`.

#### Texte de actualizat (RO + EN)
- `cum-devii-furnizor-materiale.html` și `cum-devii-operator-inchirieri.html`: cele două canale (marketplace sau magazin conectat), regula 10c, aprobarea, prețul public din formulă.
- `intrebari-frecvente-parteneri.html`: întrebări noi („Pot conecta magazinul meu?”, „Cât de des se actualizează prețul și stocul?”, „Ce se întâmplă cu un produs șters la mine?”).
- `mydarrin-marketplace.html`: secțiunea „Integrare magazin existent” rescrisă fără „verificat” / „10 minute” (vezi 2.2).
- `mydarrin-dashboard-furnizor.html`: panoul „Import CSV / API” → „Produse: import și conectare” (CSV, feed, chei API, mapări, jurnal).
- `docs/regula-incadrare.md` (RO + EN): maparea categoriilor furnizorului la nod / NACE / Uniclass.
- `docs/sabloane/README.md`: formatul feed-ului (aceleași coloane ca șablonul CSV) și documentația API.
- Emailurile de eroare de sincronizare (`lib/i18n.js`).

#### Decizii pentru LM
1. Ce canale întâi: (a) feed CSV / JSON + API propriu (recomandat), (b) și conectori WooCommerce / Shopify de la început.
2. Frecvența feed-ului (propunere: 6 ore) și pragul de variație de preț care cere verificare (propunere: ±30%).
3. Schimbările de titlu / imagini după aprobare: reaprobare (recomandat) sau publicare directă.
4. Produsele lipsă din feed: offline după 2 citiri, arhivate după 90 de zile?
5. Cine mapează categoriile furnizorului: furnizorul, cu verificarea adminului (recomandat), sau doar adminul.

#### Planul
- Pașii 11-F1 … 11-F5 din capitolul 3 (migrare → bandă comună și corectarea reimportului → API cu chei → feed + cron → dashboard și texte).

#### Teste
- `scripts/test-sincronizare-produse.js` (date simulate): produs nou → în așteptare; doar preț / stoc → live, fără reaprobare; titlu schimbat → versiune în așteptare, cea veche rămâne live; produs lipsă de 2 ori → offline; furnizor care nu poate vinde → nimic public; prețul public = formula.
- Securitate: feed spre `http://169.254.169.254` / `localhost` → refuzat; XML cu entitate externă → refuzat; cheie revocată → `401`; peste limită → `429`.
- Detectorul de română în EN pe paginile și panoul modificate (0).
