// /api/public/esco-lista.js
// Endpoint PUBLIC — taxonomia ESCO/ocupații (competente_esco), pentru
// selectorul de ocupație din Pasul 5 al wizard-ului de partener (Etapa 4,
// audit 2026-07-13). Date de referință, nesensibile.
//
// ?lang= (15 oct. 2026): pentru engleză, `denumire` vine din
// competente_esco.denumire_en (exportul oficial ESCO), cu rezervă pe
// denumirea română. Fără ?lang, româna, ca înainte.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { limbaNomenclator, eColoanaLipsa } = require('../../lib/limba-nomenclator');
const { citesteTot } = require('../../lib/citeste-tot');

// Toate cele ~3.062 de ocupații (15 oct. 2026): fără paginare, Supabase
// întorcea doar primele 1.000. Ordonare stabilă: domeniu, denumire, cod_esco.
const interogare = (coloane) => () => supabaseAdmin
  .from('competente_esco')
  .select(coloane)
  .order('domeniu')
  .order('denumire')
  .order('cod_esco');

async function ocupatii(lang) {
  if (lang === 'en') {
    const { data, error } = await citesteTot(interogare('cod_esco, denumire, denumire_en, domeniu'));
    if (!error) {
      return (data || []).map((o) => ({ cod_esco: o.cod_esco, denumire: o.denumire_en || o.denumire, domeniu: o.domeniu }))
        .sort((a, b) => String(a.domeniu || '').localeCompare(String(b.domeniu || '')) || a.denumire.localeCompare(b.denumire, 'en') || String(a.cod_esco).localeCompare(String(b.cod_esco)));
    }
    if (!eColoanaLipsa(error)) throw error;
  }
  const { data, error } = await citesteTot(interogare('cod_esco, denumire, domeniu'));
  if (error) throw error;
  return data || [];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Doar câmpurile folosite de wizard (cod_esco = valoare de formular,
    // niciodată afișată vizual; denumire/domeniu = eticheta văzută de
    // utilizator) — nace_code/certificare_ro eliminate, neconsumate de
    // niciun apelant, regulă de vizibilitate coduri (nu se expune public
    // mai mult decât e strict necesar funcțional).
    const lista = await ocupatii(limbaNomenclator(req));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ ok: true, ocupatii: lista });
  } catch (err) {
    console.error('[esco-lista]', err);
    return res.status(500).json({ error: 'Nu am putut încărca lista de ocupații ESCO' });
  }
};
