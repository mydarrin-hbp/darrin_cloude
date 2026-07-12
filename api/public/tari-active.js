// /api/public/tari-active.js
// Endpoint PUBLIC — lista țărilor unde checkout-ul e activ chiar acum
// (Etapa 4, audit 2026-07-12: "prima țară activă este România"). Citită
// live din tax_configurations.checkout_activ, nu hardcodată — checkout.html
// avea anterior 3 liste hardcodate diferite (['RO','MD','DE','FR','BG']),
// toate greșite față de realitatea comercială curentă.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data, error } = await supabaseAdmin
      .from('tax_configurations')
      .select('tara_cod, tara_nume')
      .eq('checkout_activ', true)
      .eq('activ', true);
    if (error) throw error;

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({
      ok: true,
      active: (data || []).map(t => t.tara_cod),
      tari: data || [],
    });
  } catch (err) {
    console.error('[tari-active]', err);
    return res.status(500).json({ error: 'Nu am putut încărca lista de țări active' });
  }
};
