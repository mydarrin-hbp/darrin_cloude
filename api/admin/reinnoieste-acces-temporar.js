// /api/admin/reinnoieste-acces-temporar.js
// Prelungește durata unui acces activ, fără să schimbe parola.
//
// Body: { email, ore_suplimentare } → { ok, expira_la }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const ORE_PERMISE = [1, 2, 8, 24, 48, 168];

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, ore_suplimentare } = req.body || {};
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email obligatoriu.' });
  if (!ORE_PERMISE.includes(Number(ore_suplimentare))) {
    return res.status(400).json({ error: `Ore valabile: ${ORE_PERMISE.join(', ')}` });
  }
  const emailNorm = email.toLowerCase().trim();

  const { data: acces, error: accesErr } = await supabaseAdmin
    .from('accese_temporare')
    .select('id, creat_de, expira_la')
    .eq('email', emailNorm)
    .eq('activ', true)
    .maybeSingle();
  if (accesErr) {
    console.error('[reinnoieste-acces-temporar]', accesErr);
    return res.status(500).json({ error: 'Eroare la căutarea accesului.' });
  }
  if (!acces) return res.status(404).json({ error: 'Nu există acces activ pentru acest email.' });

  const { data: profile } = await supabaseAdmin.from('profiles').select('roles').eq('id', user.id).single();
  const esteSuperadmin = Array.isArray(profile?.roles) && profile.roles.includes('superadmin');
  if (!esteSuperadmin && acces.creat_de !== user.id) {
    return res.status(403).json({ error: 'Nu poți reînnoi accese create de alți admini.' });
  }

  // Baza de calcul e max(expira_la curent, acum) — o reînnoire pe un acces
  // deja expirat pornește de la momentul curent, nu adaugă ore la un termen
  // trecut de mult.
  const bazaCalcul = Math.max(new Date(acces.expira_la).getTime(), Date.now());
  const expira_la = new Date(bazaCalcul + Number(ore_suplimentare) * 3600 * 1000).toISOString();

  const { error: updErr } = await supabaseAdmin
    .from('accese_temporare')
    .update({ expira_la })
    .eq('id', acces.id);
  if (updErr) {
    console.error('[reinnoieste-acces-temporar] update', updErr);
    return res.status(500).json({ error: 'Nu am putut reînnoi accesul.' });
  }

  return res.status(200).json({ ok: true, expira_la });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
