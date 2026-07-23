// /api/admin/revoca-acces-temporar.js
// Revocare instant: (1) marchează accesul inactiv, (2) forțează sign-out pe
// TOATE sesiunile active ale userului, (3) invalidează parola temporară.
//
// FIX (testat live, 2026-07-23): marcarea accesului ca inactiv blochează
// DOAR poarta proprie (/api/public/verifica-acces-temporar), pe care pagina
// de login o apelează înainte de signInWithPassword() — dar contul Supabase
// Auth în sine rămâne neatins, cu aceeași parolă validă. Verificat live:
// după "revocare", un apel DIRECT către Supabase (ocolind pagina de login,
// deci și poarta) încă reușea să autentifice cu parola veche — sign-out-ul
// global invalidează doar sesiunile deja emise, nu împiedică o autentificare
// NOUĂ. Fără acest fix, revocarea era cosmetică pentru oricine avea deja
// parola. Acum parola e suprascrisă cu una aleatoare, necunoscută nimănui,
// simultan cu marcarea accesului ca inactiv.
//
// Body: { email, motiv? }

const crypto = require('crypto');
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

    // Invalidează parola — fără asta, contul rămâne autentificabil direct
    // cu parola veche, ocolind orice verificare din acest tool.
    const parolaAleatoare = crypto.randomBytes(24).toString('base64url');
    const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(acces.user_id, { password: parolaAleatoare });
    if (pwErr) console.error('[revoca-acces-temporar] invalidare parolă', pwErr);
  }

  return res.status(200).json({
    ok: true,
    mesaj: `Accesul pentru ${emailNorm} a fost revocat.`,
  });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
