# Corecturi pe paginile publice: preț real, checkout funcțional, mobil, fără date inventate

Branch: `corectii-public` → `main`

## Ce se schimbă pentru client

**Preț real**
- Prețul de pe pagina de produs vine din motorul de rețete (`/api/public/calculeaza-pret-nivel`), nu din tabele scrise în pagină. Nivelurile fără rețetă afișează „preț după evaluare”.
- TVA-ul se citește din `tax_configurations`: 21% în România.

**Checkout funcțional**
- Pașii Coș → Detalii → Plată se parcurg cu validare. Comanda pleacă doar din butonul de finalizare și cere cont.
- Scos codul promoțional `DARRIN10` (reducere calculată în browser) și codul mort cu comandă, adresă și partener inventate (`saveGuestOrder`).
- Datele de contact din pasul „Detalii” încă nu se salvează: `comenzi` nu are coloane pentru ele. Migrarea propusă e mai jos.

**Mobil**
- Pagina de produs și checkout-ul încap în ecran între 360 și 1920 px.
- Antetul, butoanele plutitoare, țintele de atingere și bannerul de cookie-uri sunt reparate.

**Butoane care nu făceau nimic**
- 153 de apeluri către funcții inexistente, pe 31 de pagini: meniul ≡, locația, GPS, contul, „Devino partener”, „Rolurile mele”.
- Cauza: paginile publicate în 15–19 iulie au primit antetul fără scriptul comun.
- Repararea e făcută o singură dată, în `ui-comun.js`, inclus pe 39 de pagini.
- Pe paginile fără meniu lateral, meniul se preia din `index.html`. Pe cele fără fereastră de cont, utilizatorul ajunge la `index.html?reason=cont`.
- Alte reparații:
  - `openConsultanta` din catalog se apela pe ea însăși la nesfârșit;
  - pe „Devino partener”, wizard-ul era suprascris de un modal vechi, iar `?type=…` arunca o eroare.

**Date inventate eliminate**
- Recenzii inventate (Elena S., Radu M. etc.) și cifre fără sursă: „2.140+”, „4.87★ din 1.834+”, „4.9★”, „4.92”, „26+”, „5+”, „1.800+ / 1.200+”, „276+ servicii active”.
- Unde există o sursă reală, cifra se citește din bază (`statistici-publice.js`): servicii publice, produse publice, țări active, parteneri, comenzi. O cifră egală cu 0 nu se afișează.
- Numărul de WhatsApp inventat (+40 721 234 567) a fost scos, inclusiv din antetul a 26 de pagini.
- Dashboard-urile furnizor, partener și client: secțiunile încă neconectate au un banner „Date demonstrative — secțiunea nu este încă conectată”.

**Contacte din back-office**
- Endpoint nou, public și doar pentru citire: `/api/public/contact`. Întoarce numai cheile din `backoffice_config`, secțiunea `contact`.
- `contact-public.js` completează datele pe pagini. O cheie lipsă înseamnă că rândul nu se afișează.
- Pagina de contact: butonul „Scrie-ne pe WhatsApp” e primul canal, urmat de telefon, email, suport și program.
- Subsolul a 33 de pagini are un bloc Contact.
- Pe investitori apare `investitori_email`; pe paginile de confidențialitate și GDPR, `gdpr_email`; pe reclamații și checkout, `suport_email`.
- Nici emailurile trimise de server nu mai au adrese scrise direct: footerul de dezabonare folosește `contact_email`, iar nota GDPR `gdpr_email`, ambele din aceeași sursă (`lib/contact-platforma.js`, cu cache). Dacă o cheie lipsește, rândul nu apare.
- Nicio pagină publică nu mai are telefoane sau emailuri scrise direct. Au dispărut și adresele care nu existau în back-office (`support@`, `dpo@`, `parteneri@`, `marketplace@`) și CUI-ul inventat din termeni.

**Promisiuni**
- „Rating ≥4.8★ = bonus lunar” a fost scos.
- „24/7” rămâne doar pentru chatul Darrin AI și pentru programul de contact; aparițiile care promiteau intervenții non-stop au fost scoase.
- „48h” rămâne.
- Scos și „Top curier al lunii = voucher extra” (curier de cartier).
- „Partener la ușa ta în sub 4 ore” și „<4h Timp răspuns urgențe” au fost înlocuite cu „Cerere prioritară — îți confirmăm disponibilitatea partenerilor din zona ta”, până când SLA-ul pentru urgențe va fi live.

**Comandă primită și notificări (Etapa 0 SLA)**
- La plasare, clientul primește „Am primit comanda ta”, fără termen promis.
- Confirmarea (partenerul și codul de verificare) pleacă doar dacă există un partener alocat.
- Partenerul alocat automat primește imediat un email cu serviciul, data, intervalul și localitatea, iar comanda îi apare la Sarcini.
- O comandă fără partener declanșează un email imediat la `suport_email`.
- Panoul „Comenzi Globale” din superadmin arată date reale: comenzile fără partener apar primele, cu vechimea în minute. Înainte era o machetă cu „247 active”.
- Au fost scoase promisiunile de timp la alocare: „<15 min”, „în sub 2 minute”, „Primești imediat confirmarea”, „Ai 5 minute să confirmi”.

## Commit-uri

| Commit | Descriere |
|---|---|
| `56bda73` | Reguli de lucru pentru proiect (CLAUDE.md) |
| `ce011bd` | Prețul de pe pagina de produs vine din motorul real; TVA din `tax_configurations` |
| `acfb5c2` | Mobil: pagina de produs și checkout încap în ecran la 360–1920 px |
| `4284ba3` | Date false eliminate de pe paginile publice |
| `720a872` | Antet, butoane plutitoare, ținte de atingere și banner cookie pe mobil |
| `b94871a` | Checkout: navigarea între pași reconstruită, cu validare; comanda pleacă doar din butonul de finalizare |
| `12295d5` | Checkout: eliminat codul promoțional DARRIN10 și reducerea calculată în browser |
| `5bcd5e7` | Date inventate eliminate: parteneri, indicatori pentru investitori, specialiști |
| `780c314` | Butoane moarte: funcțiile comune într-un singur script (`ui-comun.js`) |
| `08309f3` | Checkout: migrare propusă pentru datele de contact; cod mort cu date inventate șters |
| `357d63c` | Ultimele date inventate de pe paginile publice; banner pe secțiunile demonstrative |
| `b82ae31` | PR.md (prima versiune) |
| `86d64d1` | Contacte din back-office: `/api/public/contact`, WhatsApp primul canal, nicio adresă scrisă direct |
| `d2930e3` | Promisiuni: scos bonusul pentru rating ≥4.8★ și „24/7” care promitea intervenții non-stop |
| `700ecad` | Etapa 0 SLA: „comandă primită” la plasare, email către partenerul alocat și către admin fără partener |
| `71c6bb7` | Subsol: programul de contact afișat lizibil pe fundal închis |
| `aebdaea` | PR.md: contacte, promisiuni, Etapa 0 SLA |
| `16eff68` | Emailuri: adresa din footerul de dezabonare și din nota GDPR, din back-office |
| `4fc163d` | Curier de cartier: scos „Top curier al lunii = voucher extra” |
| `a3a0946` | Urgențe: „sub 4 ore” / „<4h” înlocuite cu „Cerere prioritară…” |

## Migrări

Codul din acest PR **nu are nevoie** de nicio migrare.

`docs/migrations-propuse/2026-10-09_comenzi_date_contact.sql` e doar o propunere: adaugă pe `comenzi` coloanele de contact și observații. Se aplică doar dacă LM o aprobă, iar codul care le folosește vine într-un PR separat.

## Ce s-a testat

Totul pe un server local care servește fișierele din branch și trimite `/api/*` la producție. Scrierile au fost interceptate și nu au ajuns la producție: `/api/comenzi/**` și POST pe coș.

- **Capturi** la 360, 390, 768, 1024, 1366 și 1920 px pentru index, catalog, produs „Înlocuire becuri”, checkout (până la ecranul de plată), despre-noi și contact. Rezultat: 36 din 36 fără erori JS și fără depășire pe orizontală.
- **Butoane:** pe cele 29 de pagini din inventar accesibile fără cont (din 36), la 390 și 1366 px, a fost apăsat fiecare buton distinct care apela o funcție lipsă: 1.070 de click-uri. Erorile găsite au fost reparate, iar paginile au fost retestate; rezultatul final e 0 erori `is not defined`. Pe fiecare pagină au fost verificate:
  - meniul ≡ se deschide și se închide;
  - o secțiune din meniu se extinde;
  - locația se salvează;
  - GPS-ul actualizează adresa (cu poziție simulată);
  - contul deschide fereastra de autentificare, direct sau prin index;
  - „Devino partener” duce la wizard.
- **Cifrele reale** (pe datele live din 9 oct.): 88 de servicii active în meniu, 226 de produse publice și 6 țări în catalog, 1 partener activ și 2 comenzi pe pagina de investitori.
- **Footerul emailurilor:** testul de plasare arată footerul cu `contact_email` când cheia există și niciun footer când lipsește.
- **Paginile atinse ultima dată** (curier de cartier, servicii urgente, cum comanzi): 18 capturi la 6 lățimi, fără erori și fără depășiri.
- **Contactele:** pe 9 pagini, la 390 și 1366 px, toate valorile vin din back-office și au linkurile corecte (`wa.me/40755511777`, `tel:`, `mailto:`), fără erori. Endpoint-ul nou nu există încă în producție; local a fost simulat cu aceleași date.
- **Plasarea comenzii** pe `api/comenzi/creeaza.js` real, cu baza în memorie și Resend interceptat:
  - cu partener: clientul primește „primită” plus proforma; partenerul primește „comandă alocată”; clientul primește apoi codul de verificare; statusul devine `acceptata`;
  - fără partener: clientul primește doar „primită”; adminul primește „Comandă fără partener”; statusul rămâne `in_cautare_partener`.

## Ce nu s-a testat

- **O comandă reală, cu cont autentificat, până la plată și confirmare.** În test, butonul de finalizare a fost oprit înainte de trimitere.
- **Dashboard-urile** (client, furnizor, partener, superadmin) și paginile interne (business-model, design-system, deviz-engine) redirecționează fără cont. Pe ele am verificat doar sintaxa scripturilor și analiza statică a funcțiilor, nu și click-uri în browser. Bannerele demonstrative și panoul „Comenzi Globale” nu au fost văzute în browser.
- **Emailurile reale** prin Resend (livrare, aspect în clienții de email).
- **Testele cu Safari sau iOS:** s-a folosit doar Chromium (Playwright).

## Verificări după publicare

- [ ] Pagina „Înlocuire becuri”: prețul și TVA 21% apar la toate nivelurile cu rețetă; nivelurile fără rețetă spun „preț după evaluare”.
- [ ] O comandă de test, cu un cont real, pleacă din checkout și apare în `comenzi` și în dashboard-ul clientului.
- [ ] Pe `cum-comanzi.html` și `intrebari-frecvente-clienti.html`, la 390 px, meniul ≡ se deschide (prima deschidere încarcă meniul din index). „Cont” duce la index cu fereastra de autentificare deschisă.
- [ ] „Devino partener” → `mydarrin-devino-partener.html?type=servicii` deschide wizard-ul, fără eroare în consolă.
- [ ] Meniul „Servicii” arată numărul real de servicii; hero-ul din catalog arată produsele și țările; investitorii arată partenerii și comenzile.
- [ ] `/api/public/contact` răspunde cu cele 7 chei; pagina de contact arată butonul WhatsApp primul; subsolul arată blocul Contact.
- [ ] O comandă de test cu partener disponibil: clientul primește „Am primit comanda ta” și codul de verificare, iar partenerul primește „Comandă nouă alocată ție” și o vede la Sarcini.
- [ ] O comandă de test fără partener: emailul „Comandă fără partener” ajunge la `suport_email`, iar comanda apare prima în „Comenzi Globale”.
- [ ] Dashboard-urile: bannerul „Date demonstrative” apare pe secțiunile listate în raport.
- [ ] Consola browserului: fără erori pe index, catalog, produs, checkout, despre-noi și contact.

## De decis de LM (nemodificate)

- `mydarrin-serviciu.html` (accesibilă doar din superadmin) încă afișează prețuri și recenzii scrise direct în pagină (280 / 460 Lei, „4.97 · 312 recenzii”).
- „Marfa transportată este asigurată automat prin My Darrin” (curier de cartier): de confirmat că asigurarea există pentru curieri.
