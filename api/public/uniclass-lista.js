// /api/public/uniclass-lista.js
// Endpoint PUBLIC — codurile Uniclass reale (uniclass_codes), pentru
// selectorul opțional de pe formularul de produs marketplace (Faza 1,
// 29 sept. 2026, punctul 3 din decizii). Date de referință, nesensibile —
// nu necesită autentificare. Doar 27 coduri populate azi (nivel de produs,
// tabel Pr_/Ss_/Ac_) — insuficient pentru a fi obligatoriu, de-asta
// selectorul din formular rămâne opțional.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data, error } = await supabaseAdmin
      .from('uniclass_codes')
      .select('code, table_prefix, title_ro')
      .eq('is_active', true)
      .order('code');
    if (error) throw error;

    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ ok: true, coduri: data || [] });
  } catch (err) {
    console.error('[uniclass-lista]', err);
    return res.status(500).json({ error: 'Nu am putut încărca lista Uniclass' });
  }
};
