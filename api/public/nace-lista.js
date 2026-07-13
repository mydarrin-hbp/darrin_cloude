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
    const [{ data: clase, error: e1 }, { data: sectiuni, error: e2 }] = await Promise.all([
      supabaseAdmin.from('nace_reference').select('cod, denumire_ro, cod_parinte').eq('nivel', 'clasa').order('cod'),
      supabaseAdmin.from('nace_sectiuni').select('litera, denumire_ro').order('litera'),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;

    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ ok: true, clase: clase || [], sectiuni: sectiuni || [] });
  } catch (err) {
    console.error('[nace-lista]', err);
    return res.status(500).json({ error: 'Nu am putut încărca lista NACE' });
  }
};
