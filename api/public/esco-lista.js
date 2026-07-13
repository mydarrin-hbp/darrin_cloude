// /api/public/esco-lista.js
// Endpoint PUBLIC — taxonomia ESCO/ocupații (competente_esco), pentru
// selectorul de ocupație din Pasul 5 al wizard-ului de partener (Etapa 4,
// audit 2026-07-13). Date de referință, nesensibile.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data, error } = await supabaseAdmin
      .from('competente_esco')
      .select('cod_esco, denumire, domeniu, nace_code, certificare_ro')
      .order('domeniu')
      .order('denumire');
    if (error) throw error;

    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ ok: true, ocupatii: data || [] });
  } catch (err) {
    console.error('[esco-lista]', err);
    return res.status(500).json({ error: 'Nu am putut încărca lista de ocupații ESCO' });
  }
};
