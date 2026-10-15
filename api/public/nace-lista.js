// /api/public/nace-lista.js
// Endpoint PUBLIC — taxonomia NACE reală (nace_reference/nace_sectiuni),
// pentru selectorul din Pasul 3 al wizard-ului de partener (Etapa 4,
// audit 2026-07-13). Date de referință, nesensibile — nu necesită autentificare.
//
// ?lang= (15 oct. 2026): `denumire` e eticheta în limba cerută —
// nace_reference.denumire_en pentru engleză, cu rezervă pe denumire_ro
// (coloană goală sau migrarea 2026-10-15_nace_en neaplicată). Fără ?lang,
// româna, ca înainte. `denumire_ro` rămâne în răspuns, pentru apelanții vechi.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { limbaNomenclator, eColoanaLipsa } = require('../../lib/limba-nomenclator');

async function clase(lang) {
  if (lang === 'en') {
    const { data, error } = await supabaseAdmin
      .from('nace_reference').select('cod, denumire_ro, denumire_en').eq('nivel', 'clasa').order('cod');
    if (!error) return (data || []).map((c) => ({ cod: c.cod, denumire_ro: c.denumire_ro, denumire: c.denumire_en || c.denumire_ro }));
    if (!eColoanaLipsa(error)) throw error;
  }
  const { data, error } = await supabaseAdmin
    .from('nace_reference').select('cod, denumire_ro').eq('nivel', 'clasa').order('cod');
  if (error) throw error;
  return (data || []).map((c) => ({ cod: c.cod, denumire_ro: c.denumire_ro, denumire: c.denumire_ro }));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Doar cod+denumire (cod = valoare de formular, niciodată afișat vizual
    // singur; denumire = eticheta văzută de utilizator) — cod_parinte și
    // sectiuni[] eliminate, confirmat neconsumate de niciun apelant.
    const lista = await clase(limbaNomenclator(req));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ ok: true, clase: lista });
  } catch (err) {
    console.error('[nace-lista]', err);
    return res.status(500).json({ error: 'Nu am putut încărca lista NACE' });
  }
};
