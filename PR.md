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
- Contact: telefonul și emailul se citesc din `backoffice_config`, secțiunea `contact`. Numărul de WhatsApp inventat (+40 721 234 567) a fost scos și din antetul a 26 de pagini.
- Dashboard-urile furnizor, partener și client: secțiunile încă neconectate au un banner „Date demonstrative — secțiunea nu este încă conectată”.

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
- **Cifrele reale** (pe datele live din 9 oct.): 88 de servicii active în meniu, 226 de produse publice și 6 țări în catalog, 1 partener activ și 2 comenzi pe pagina de investitori. Cardurile de contact sunt ascunse, pentru că cheile nu există încă.

## Ce nu s-a testat

- **O comandă reală, cu cont autentificat, până la plată și confirmare.** În test, butonul de finalizare a fost oprit înainte de trimitere.
- **Dashboard-urile** (client, furnizor, partener, superadmin) și paginile interne (business-model, design-system, deviz-engine) redirecționează fără cont. Pe ele am verificat doar sintaxa scripturilor și analiza statică a funcțiilor, nu și click-uri în browser. Bannerele demonstrative nu au fost văzute în browser.
- **Testele cu Safari sau iOS:** s-a folosit doar Chromium (Playwright).

## Verificări după publicare

- [ ] Pagina „Înlocuire becuri”: prețul și TVA 21% apar la toate nivelurile cu rețetă; nivelurile fără rețetă spun „preț după evaluare”.
- [ ] O comandă de test, cu un cont real, pleacă din checkout și apare în `comenzi` și în dashboard-ul clientului.
- [ ] Pe `cum-comanzi.html` și `intrebari-frecvente-clienti.html`, la 390 px, meniul ≡ se deschide (prima deschidere încarcă meniul din index). „Cont” duce la index cu fereastra de autentificare deschisă.
- [ ] „Devino partener” → `mydarrin-devino-partener.html?type=servicii` deschide wizard-ul, fără eroare în consolă.
- [ ] Meniul „Servicii” arată numărul real de servicii; hero-ul din catalog arată produsele și țările; investitorii arată partenerii și comenzile.
- [ ] Contact: după ce LM adaugă `contact_telefon` și `contact_email` în `backoffice_config` (secțiunea `contact`), cardurile apar.
- [ ] Dashboard-urile: bannerul „Date demonstrative” apare pe secțiunile listate în raport.
- [ ] Consola browserului: fără erori pe index, catalog, produs, checkout, despre-noi și contact.

## De decis de LM (nemodificate)

- Promisiunile „48h Aprobare”, „Rating ≥4.8★ = bonus lunar 10%” și „24/7”: tabelul cu fiecare apariție e în raportul de publicare.
- `mydarrin-serviciu.html` (accesibilă doar din superadmin) încă afișează prețuri scrise direct în pagină (280 / 460 Lei).
