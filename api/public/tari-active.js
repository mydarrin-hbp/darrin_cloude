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
      .select('tara_cod, tara_nume, cota_tva, checkout_activ')
      .eq('activ', true);
    if (error) throw error;

    const rows = data || [];
    const cuCheckout = rows.filter((t) => t.checkout_activ);
    // Cota de TVA pe țară (procent), pentru afișarea prețurilor pe paginile
    // publice (tva-config.js) — tax_configurations nu se poate citi direct
    // cu cheia anon. Pentru toate țările active, nu doar cele cu checkout.
    const tva = {};
    for (const t of rows) {
      const cota = Number(t.cota_tva);
      if (t.cota_tva != null && Number.isFinite(cota)) tva[t.tara_cod] = cota;
    }

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({
      ok: true,
      active: cuCheckout.map(t => t.tara_cod),
      tari: cuCheckout.map(({ tara_cod, tara_nume }) => ({ tara_cod, tara_nume })),
      tva,
    });
  } catch (err) {
    console.error('[tari-active]', err);
    return res.status(500).json({ error: 'Nu am putut încărca lista de țări active' });
  }
};
