// lib/limba-nomenclator.js
// Limba denumirilor din nomenclatoare (NACE, ESCO), din ?lang= (15 oct. 2026).
// Fără parametru sau cu ?lang=ro: româna, ca înainte. Orice altă limbă
// primește engleza, ca în i18n-loader.js (engleza e rezerva oricărei limbi
// netraduse). Denumirea engleză lipsă (coloană negolită sau migrare
// neaplicată) cade pe cea română.

function limbaNomenclator(req) {
  const l = String(req?.query?.lang || '').trim().toLowerCase().slice(0, 2);
  return !l || l === 'ro' ? 'ro' : 'en';
}

// Coloana lipsă în Postgres (42703) sau în cache-ul de schemă PostgREST
// (PGRST204) — înainte de migrare, `denumire_en` nu există încă.
function eColoanaLipsa(error) {
  if (!error) return false;
  return error.code === '42703' || error.code === 'PGRST204' || /denumire_en/.test(error.message || '');
}

module.exports = { limbaNomenclator, eColoanaLipsa };
