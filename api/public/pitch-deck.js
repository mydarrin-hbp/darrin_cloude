// /api/public/pitch-deck.js
// Endpoint PUBLIC — ultima versiune APROBATĂ a Pitch Deck-ului (nu orice
// draft salvat din backoffice). Dacă nu există încă nicio versiune
// aprobată în DB, pagina publică folosește propriul conținut hardcodat de
// rezervă (construit din conținutul furnizat) — acest endpoint nu e o
// dependență obligatorie pentru ca deck-ul să funcționeze.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data, error } = await supabaseAdmin
      .from('pitch_deck_versiuni')
      .select('slide_uri, aprobat_la')
      .eq('aprobat', true)
      .order('aprobat_la', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ ok: true, slides: data?.slide_uri || null, aprobat_la: data?.aprobat_la || null });
  } catch (err) {
    console.error('[pitch-deck]', err);
    return res.status(500).json({ error: 'Nu am putut încărca Pitch Deck-ul' });
  }
};
