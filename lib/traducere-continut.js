// lib/traducere-continut.js
// Pasul 11-T1 (13 nov. 2026): textul unui rând din baza de date în limba cerută.
// Conținutul (catalog_servicii, catalog_niveluri, categorii) are româna în coloanele
// obișnuite și traducerile în coloana `traduceri` (jsonb): { "<limba>": { "<coloană>": "text" } }.
// Regula: limba cerută; pentru orice limbă în afară de română, engleza e rezerva; româna
// rămâne rezerva finală, doar dacă traducerea lipsește.
//
//   textTradus({ titlu: 'Înlocuire calorifer', traduceri: { en: { titlu: 'Radiator replacement' } } }, 'titlu', 'en')
//     -> 'Radiator replacement'

function textTradus(rand, camp, limba) {
  if (!rand) return null;
  const ro = rand[camp];
  if (!limba || limba === 'ro') return ro;
  const tr = rand.traduceri && typeof rand.traduceri === 'object' ? rand.traduceri : {};
  const gol = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
  if (tr[limba] && !gol(tr[limba][camp])) return tr[limba][camp];
  if (tr.en && !gol(tr.en[camp])) return tr.en[camp];
  // categorii: title_en (coloana veche, completată de migrarea 11-T1)
  if (camp === 'title' && rand.title_en) return rand.title_en;
  return ro;
}

module.exports = { textTradus };
