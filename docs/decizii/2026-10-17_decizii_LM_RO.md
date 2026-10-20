# Deciziile LM (17 oct. 2026) — extras pentru pasul 11-A
*(Versiunea în engleză: `2026-10-17_decizii_LM_EN.md`; conținut identic.)*

- **B1. Plata** — descrierea completă a modelului proiectat: plata cu cardul (prin procesatorul de plăți, integrat înainte de lansarea live) și prin ordin de plată; suma ține loc de garanție (escrow) și ajunge la partener după confirmarea lucrării. Metodele afișate ca disponibile vin din back-office (`metode_plata_config`). Observat: `metode_plata_config` are azi un singur rând global cu `["card"]`, iar `api/comenzi/creeaza.js` acceptă doar ordin de plată — de aliniat în 11-C.
- **B2. Confirmarea tacită: 24 de ore** de la momentul în care partenerul raportează finalizarea prestării. Clauza apare în contracte, acorduri, proforme și facturi.
- **B3. Plata către partener:** în cel mult **6 zile** de la ziua în care suma devine eliberabilă (după confirmarea lucrării, explicită sau tacită după 24 h). Configurabil din back-office.
- **B4. ACA BUSINESS GROUP:** se integrează ca **furnizor extern** (cont real, date ANAF, aprobare, contract, cont bancar, discount 5–15%, factură către Home Best Pal SRL, catalog real importat). Până atunci, nicio mențiune scrisă de mână.
- **B5. Integrările WooCommerce / Shopify:** scoase de pe pagini până există (pașii 11-F).
- **B6. Subsolul:** „© 2026 Home Best Pal SRL (România) · Home Best Pal LTD (Marea Britanie)”.
- **C1. Investitori:** doar cifre reale, din modulul de contabilitate / financiar. Secțiunile publice cu cifre și rapoarte se restricționează acum. Rămân live: crearea contului de investitor, achiziția de acțiuni / cote și dashboard-ul investitorului.
- **C2. Rundele de finanțare** (Seed, Series A, B, C … IPO), configurabile din back-office de superadmin și adminii cu permisiune; runda curentă: Seed. Funcție nouă — pasul 11-J.
- **C3. Pitch deck-ul** editabil din back-office, pe versiuni, cu media încărcate — pasul 11-K. Până la prima versiune aprobată, pagina publică arată „Pitch deck în pregătire” — pasul 11-B.
- **A. Valoarea minimă de comandă** (pasul 11-C, nu acum): prag doar la servicii, pe partener (o singură dată dacă același partener face mai multe servicii în coș), diferența până la prag adăugată la manopera partenerului („intervenție minimă”, cu TVA); produsele din catalog fără prag; o țară nu poate fi activată fără prag; un prag pe țară, în moneda țării.
- **D1.** `mydarrin-business-model` și `mydarrin-design-system` — doar pentru admini (pasul 11-B).
