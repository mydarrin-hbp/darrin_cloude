// lib/reguli-comenzi.js
// Regulile fixe ale fluxului de comandă, într-un singur loc (pasul 11-A,
// 17 oct. 2026), ca textele publice și codul să nu mai poată spune lucruri
// diferite.
//
// FEREASTRA_TACITA_ORE — confirmarea tacită (decizie LM B2, 17 oct. 2026):
// dacă în 24 de ore de la momentul în care partenerul raportează lucrarea ca
// finalizată clientul nu confirmă și nu deschide o reclamație, comanda se
// consideră confirmată și suma se eliberează. Folosită de
// api/cron/auto-confirma-comenzi.js (regula) și de
// api/public/reguli-platforma.js (textul afișat pe paginile publice).

const FEREASTRA_TACITA_ORE = 24;

module.exports = { FEREASTRA_TACITA_ORE };
