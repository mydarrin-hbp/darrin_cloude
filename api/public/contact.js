// /api/public/contact.js
// Endpoint PUBLIC, doar citire (9 oct. 2026) — datele de contact ale
// platformei, din backoffice_config, secțiunea `contact`. Întoarce NUMAI
// cheile din această secțiune, ca obiect { cheie: valoare }. Valoarea pe
// țară (?tara=RO) are prioritate față de ALL.
//
// Folosit de contact-public.js: pagina de contact, subsolul paginilor
// publice, investitori, paginile legale / GDPR. Nicio pagină nu mai are
// telefoane sau emailuri scrise direct; o cheie lipsă = rândul nu se afișează.
//
// GET ?tara=RO -> { ok, contact: { contact_whatsapp, contact_telefon, ... } }

const { supabaseAdmin } = require('../../lib/supabaseAdmin');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const tara = /^[A-Z]{2}$/.test(String(req.query?.tara || '').toUpperCase()) ? String(req.query.tara).toUpperCase() : null;

  try {
    const { data, error } = await supabaseAdmin
      .from('backoffice_config')
      .select('cheie, valoare, tara_cod')
      .eq('sectiune', 'contact')
      .in('tara_cod', tara ? ['ALL', tara] : ['ALL']);
    if (error) throw error;

    const contact = {};
    // ALL întâi, apoi țara, care suprascrie.
    for (const r of (data || []).sort((a, b) => (a.tara_cod === 'ALL' ? -1 : 1) - (b.tara_cod === 'ALL' ? -1 : 1))) {
      const v = r.valoare == null ? '' : String(r.valoare).trim();
      if (v) contact[r.cheie] = v;
    }

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ ok: true, contact });
  } catch (err) {
    console.error('[public/contact]', err);
    return res.status(500).json({ error: 'Nu am putut încărca datele de contact' });
  }
};
