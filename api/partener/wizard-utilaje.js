// /api/partener/wizard-utilaje.js
// Wizard partener în 8 pași (Etapa 4, audit 2026-07-13) — Pasul 4:
// declarație utilaje/echipamente.
//
// GET  → utilajele declarate curent
// POST { utilaje: [{ denumire, tip?, cantitate?, an_fabricatie? }, ...] }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('partner_utilaje')
      .select('*')
      .eq('partner_id', user.id)
      .order('creat_la', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, utilaje: data || [] });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { utilaje } = req.body || {};
  if (!Array.isArray(utilaje) || !utilaje.length) {
    return res.status(400).json({ error: 'Declară cel puțin un utilaj/echipament' });
  }
  for (const u of utilaje) {
    if (!u.denumire || typeof u.denumire !== 'string') {
      return res.status(400).json({ error: 'Fiecare utilaj trebuie să aibă o denumire' });
    }
  }

  try {
    const { error: delErr } = await supabaseAdmin.from('partner_utilaje').delete().eq('partner_id', user.id);
    if (delErr) throw delErr;

    const randuri = utilaje.map((u) => ({
      partner_id: user.id,
      denumire: u.denumire,
      tip: u.tip || null,
      cantitate: Number.isFinite(u.cantitate) && u.cantitate > 0 ? u.cantitate : 1,
      an_fabricatie: Number.isFinite(u.an_fabricatie) ? u.an_fabricatie : null,
    }));
    const { error: insErr } = await supabaseAdmin.from('partner_utilaje').insert(randuri);
    if (insErr) throw insErr;

    return res.status(200).json({ ok: true, count: randuri.length });
  } catch (err) {
    console.error('[wizard-utilaje]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut salva utilajele' });
  }
}

module.exports = requireAuth([], handler);
