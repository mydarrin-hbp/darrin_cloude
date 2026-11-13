// /api/public/geo-regiuni.js
// T5: nomenclator Țară→Regiune/Județ, citit din geo_regiuni (RO/MD/DE/FR/BG
// seedate — vezi migrația geo_regiuni_entitate_legala_treasury). Nivelul de
// localitate/oraș nu are tabel dedicat (vezi planul) — rămâne text liber.
//
// GET ?tara=RO → regiunile acelei țări

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const tara = String(req.query?.tara || '').toUpperCase();
  if (!tara) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'tara este obligatorie (ex: ?tara=RO)', 'tara is required (e.g. ?tara=RO).', ['tara']);

  try {
    const { data, error } = await supabaseAdmin
      .from('geo_regiuni')
      .select('cod, denumire, ordine')
      .eq('tara_cod', tara)
      .order('ordine', { ascending: true });
    if (error) throw error;

    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ ok: true, tara, regiuni: data || [] });
  } catch (err) {
    console.error('[geo-regiuni]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca nomenclatorul de regiuni', 'We could not load the list of regions.');
  }
};
