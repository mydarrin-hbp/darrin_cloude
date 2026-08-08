// /api/public/nace-lista.js
// Endpoint PUBLIC — taxonomia NACE reală (nace_reference/nace_sectiuni),
// pentru selectorul din Pasul 3 al wizard-ului de partener (Etapa 4,
// audit 2026-07-13). Date de referință, nesensibile — nu necesită autentificare.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Doar cod+denumire (cod = valoare de formular, niciodată afișat vizual
    // singur; denumire_ro = eticheta văzută de utilizator) — cod_parinte și
    // sectiuni[] eliminate, confirmat neconsumate de niciun apelant.
    const { data: clase, error: e1 } = await supabaseAdmin
      .from('nace_reference').select('cod, denumire_ro').eq('nivel', 'clasa').order('cod');
    if (e1) throw e1;

    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ ok: true, clase: clase || [] });
  } catch (err) {
    console.error('[nace-lista]', err);
    return res.status(500).json({ error: 'Nu am putut încărca lista NACE' });
  }
};
