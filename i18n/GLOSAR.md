# Glosar RO → EN — My Darrin

Engleză britanică, profesională și clară. Același termen român se traduce
mereu la fel, pe toate paginile, în `i18n/en.json` și `i18n/en/*.json`.
Ortografie britanică: *colour, organise, licence (substantiv), programme,
cheque, centre, catalogue* → excepție: **catalog** (numele secțiunii, fixat
în interfață), *enrol, fulfil, labour*.

## Nume proprii — nu se traduc
| RO | EN |
|---|---|
| My Darrin | My Darrin |
| Darrin AI | Darrin AI |
| Home Best Pal SRL / Home Best Pal LTD | Home Best Pal SRL / Home Best Pal LTD |
| Curier de Cartier (programul) | Neighbourhood Courier (descriere), numele programului: „Curier de Cartier” doar unde apare ca marcă |
| Escrow My Darrin | My Darrin Escrow |

## Platformă și roluri
| RO | EN |
|---|---|
| antreprenor general digital | digital general contractor |
| partener | partner |
| partener verificat | verified partner |
| furnizor | supplier |
| furnizor de servicii | service provider |
| furnizor de materiale | materials supplier |
| operator de închirieri / furnizor de închirieri | rental operator / rental supplier |
| asigurator | insurer |
| curier de cartier | neighbourhood courier |
| client | customer (în texte comerciale), client (în contracte) |
| investitor | investor |
| meșter, tehnician | tradesperson, technician |
| cont | account |
| autentificare | sign-in / log in (verb) |
| deconectare | sign out |
| creare cont | create account |
| înregistrare | registration / sign up |
| rolurile mele | my roles |
| dashboard / panou | dashboard |

## Catalog și comandă
| RO | EN |
|---|---|
| catalog | catalog |
| serviciu / servicii | service / services |
| materiale | materials |
| închirieri | rentals |
| marketplace | marketplace |
| categorie | category |
| deviz | quote |
| deviz instant / deviz inteligent | instant quote / smart quote |
| nivel (Bronz / Argint / Aur / Platinum) | service level (Bronze / Silver / Gold / Platinum) |
| configurare | configuration / configure |
| cantitate | quantity |
| manoperă | labour |
| utilaje | equipment / machinery |
| coș | basket |
| comandă (substantiv) | order |
| a comanda | to order |
| checkout / finalizare comandă | checkout |
| programare / interval orar | booking / time slot |
| urgență, cerere prioritară | urgent, priority request |
| locație | location |
| zonă | area |
| adresă | address |

## Bani și garanții
| RO | EN |
|---|---|
| Escrow / plată în Escrow | escrow / escrow payment |
| suma blocată în Escrow | amount held in escrow |
| eliberare plată | payment release |
| preț | price |
| preț calculat live din rețetă | price calculated live from the recipe |
| cost de bază | base cost |
| comision platformă | platform commission |
| TVA | VAT |
| TVA inclus | VAT included |
| prag minim de comandă | minimum order value |
| transfer bancar (ordin de plată) | bank transfer (payment order) |
| card bancar | bank card |
| factură | invoice |
| garanție digitală | digital warranty |
| asigurare / poliță | insurance / policy |
| poliță de bază (inclusă) | basic policy (included) |
| daune | damage |
| bună execuție | performance bond / workmanship |
| reclamație | complaint |
| rambursare | refund |

## Legal
| RO | EN |
|---|---|
| Termeni și Condiții | Terms and Conditions |
| Politica de Confidențialitate | Privacy Policy |
| prelucrarea datelor | data processing |
| operator de date | data controller |
| persoană vizată | data subject |
| consimțământ | consent |
| contract-cadru | framework agreement |
| acord de confidențialitate (NDA) | non-disclosure agreement (NDA) |

Pe paginile legale, sus, doar în engleză (formularea finală o decide LM):
> This is an English translation provided for convenience. In case of any discrepancy, the Romanian version prevails.

## Interfață
| RO | EN |
|---|---|
| Acasă | Home |
| Despre noi | About us |
| Cum funcționează | How it works |
| Devino partener | Become a partner |
| Întrebări frecvente | FAQ |
| Se încarcă… | Loading… |
| Se salvează… / ✓ Salvat / ✕ Nu s-a salvat | Saving… / ✓ Saved / ✕ Not saved |
| Renunță | Cancel |
| Închide | Close |
| ← Înapoi | ← Back |
| Vezi toate | See all |
| Alege | Choose |
| în curând | coming soon |

## Ce nu se traduce
- Prețurile și monedele: rămân pe țara aleasă (o vizită în engleză din România vede tot lei, TVA 21%); formatul numerelor urmează limba (EN `226.65`, RO `226,65`).
- Numele proprii de mai sus, numele orașelor (București, Iași, Chișinău), adresele, numerele de telefon, emailurile.
- Codurile tehnice (NACE, ESCO, Uniclass), numele județelor, numele firmelor și adresele (str. → St., bd. → Blvd. doar în exemplele de adresă).
- Numele limbilor din selector rămân în limba lor (Română, English, Deutsch); numele țărilor se traduc (România → Romania, Marea Britanie → United Kingdom).

## Cum se adaugă un text nou
- Textul român rămâne în HTML / în script; traducerea intră în `i18n/en.json` (text prezent pe 4+ pagini sau venit din baza de date) sau în `i18n/en/<pagina>.json`, la `_texte`, cu textul român exact (spațiile se normalizează) ca cheie.
- Textele cu numere sau nume variabile: `_modele`, ex. `"{n} servicii active": "{n} active services"` — `{n}` potrivește doar numere, orice altă variabilă potrivește text (și se traduce și ea, dacă se poate).
- În scripturi, pentru texte compuse: `t('cheie', 'Text român {x}', { x: valoare })`.
- Conținutul din baza de date: coloana `traduceri` (`{ "en": { "titlu": "..." } }`), citită de `/api/public/traduceri-catalog`.
- Un text care nu trebuie tradus (ex. originalul semnat al unui acord): `translate="no"` sau `data-i18n-skip` pe element.
