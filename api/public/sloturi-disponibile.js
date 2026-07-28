// /api/public/sloturi-disponibile.js
// G28 — sloturi de 2 ore real disponibile pentru o zonă + dată, folosit de
// calendarul din mydarrin-produs.html (înainte, toate sloturile erau mereu
// afișate ca disponibile, fără nicio verificare — vezi
// lib/calculeaza-sloturi-disponibile.js pentru mecanismul real).
//
// GET ?tara=RO&regiune=Bacău&data=2026-08-03

const { calculeazaSloturiDisponibile } = require('../../lib/calculeaza-sloturi-disponibile');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { tara, regiune, data } = req.query || {};
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return res.status(400).json({ error: 'data este obligatorie, format YYYY-MM-DD' });
  }

  try {
    const rezultat = await calculeazaSloturiDisponibile({
      taraCod: tara ? String(tara).toUpperCase() : null,
      regiune: regiune || null,
      data,
    });
    res.setHeader('Cache-Control', 'public, max-age=120');
    return res.status(200).json({ ok: true, ...rezultat });
  } catch (err) {
    console.error('[sloturi-disponibile]', err);
    return res.status(500).json({ error: 'Nu am putut calcula sloturile disponibile' });
  }
};
