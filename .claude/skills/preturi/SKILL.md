---
name: preturi
description: Formula prețului public My Darrin, procentele din backoffice_config, discounturile partenerilor (nepublice) și plata prin escrow. Se citește înainte de orice lucru la prețuri, coș, checkout, comenzi, devize, niveluri de preț, discounturi, escrow sau plăți către parteneri.
---

# Prețuri și bani — My Darrin

## Regulile (din CLAUDE.md, cuvânt cu cuvânt)
- Prețul public: cost de bază (manoperă + materiale + utilaje) + transport + asigurare (1% din costul de bază) + comision platformă (12% din costul de bază) + marketing 3% și mentenanță 2% (pe subtotal) + TVA. Procentele se citesc din backoffice_config, pe țară, cu ALL implicit.
- Discounturile partenerilor (5–15%, pe categorie) nu sunt publice și nu apar în niciun API public; la escrow, furnizorul primește prețul public minus discountul lui.
- Nicio cifră sau dată inventată în interfață; ce nu e real se marchează clar sau se ascunde.

## Formula, pe pași
1. cost de bază = manoperă + materiale + utilaje
2. + transport
3. + asigurare = 1% × cost de bază
4. + comision platformă = 12% × cost de bază
5. = subtotal; + marketing 3% × subtotal + mentenanță 2% × subtotal
6. + TVA (pe țară)

Procentele de mai sus sunt valorile implicite; sursa reală e `backoffice_config` (secțiunile `pricing` și `asigurari`), pe țară, cu rândul `ALL` ca implicit. Nu se scriu procente fixe în cod nou.

## Unde e codul
- `lib/calculeaza-pret.js`, `lib/pret-serviciu.js`, `lib/comanda-pret.js`, `lib/catalog-preturi.js`, `lib/calculeaza-cost-recipe.js`, `tva-config.js`
- `lib/discount-partener.js` (discounturi, doar pe server), `lib/elibereaza-escrow.js` (escrow)
- `api/comenzi/creeaza.js` — prețul comenzii se calculează doar pe server.

## Reguli
- Prețul se calculează doar pe server; aceeași valoare la configurare = coș = checkout = comandă.
- Discounturile nu apar în niciun răspuns public și nici în HTML-ul public.
- Escrow: furnizorul primește prețul public minus discountul lui.
- Teste: `node scripts/ruleaza-teste.js pret b2g deviz`

Task-urile cu prețuri se pornesc cu `/model opusplan` sau `/effort high`.
