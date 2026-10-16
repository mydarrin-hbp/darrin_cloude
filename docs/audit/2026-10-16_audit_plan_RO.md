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
