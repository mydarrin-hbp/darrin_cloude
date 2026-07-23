// /api/admin/revoca-acces-temporar.js
// Revocare instant: (1) marchează accesul inactiv, (2) forțează sign-out pe
// TOATE sesiunile active ale userului prin Supabase Admin API — efectul e
// imediat, nu doar la următoarea expirare de token.
//
// Body: { email, motiv? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, motiv } = req.body || {};
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email obligatoriu.' });
  const emailNorm = email.toLowerCase().trim();

  const { data: acces, error: accesErr } = await supabaseAdmin
    .from('accese_temporare')
    .select('id, user_id, creat_de')
    .eq('email', emailNorm)
    .eq('activ', true)
    .maybeSingle();
  if (accesErr) {
    console.error('[revoca-acces-temporar]', accesErr);
    return res.status(500).json({ error: 'Eroare la căutarea accesului.' });
  }
  if (!acces) return res.status(404).json({ error: 'Nu există acces activ pentru acest email.' });

  const { data: profile } = await supabaseAdmin.from('profiles').select('roles').eq('id', user.id).single();
  const esteSuperadmin = Array.isArray(profile?.roles) && profile.roles.includes('superadmin');
  if (!esteSuperadmin && acces.creat_de !== user.id) {
    return res.status(403).json({ error: 'Nu poți revoca accese create de alți admini.' });
  }

  const { error: updErr } = await supabaseAdmin
    .from('accese_temporare')
    .update({
      activ: false,
      revocat_de: user.id,
      revocat_la: new Date().toISOString(),
      motiv_revocare: motiv ? String(motiv).slice(0, 300) : 'Revocat manual',
    })
    .eq('id', acces.id);
  if (updErr) {
    console.error('[revoca-acces-temporar] update', updErr);
    return res.status(500).json({ error: 'Nu am putut revoca accesul.' });
  }

  if (acces.user_id) {
    const { error: signOutErr } = await supabaseAdmin.auth.admin.signOut(acces.user_id, 'global');
    if (signOutErr) console.error('[revoca-acces-temporar] sign-out', signOutErr);
  }

  return res.status(200).json({
    ok: true,
    mesaj: `Accesul pentru ${emailNorm} a fost revocat.`,
  });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
