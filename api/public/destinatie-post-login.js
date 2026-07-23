// /api/public/destinatie-post-login.js
// FIX CRITIC (2026-07-23): de când middleware.js blochează tot site-ul
// implicit, /acces-temporar a devenit singura poartă de intrare — inclusiv
// pentru conturi REALE (admin/superadmin/client/partener), nu doar pentru
// testerii cu parolă temporară. Formularul real de login (email+parolă),
// folosit până acum pentru admin/superadmin, e un modal încorporat direct
// în 14 pagini (homepage, catalog etc.) — toate acum blocate pentru un
// vizitator fără sesiune. Fără acest fix, NIMENI (nici superadminul) nu mai
// putea ajunge vreodată la propriul formular de login.
//
// GET, cu Authorization: Bearer <access_token proaspăt din signInWithPassword>
// → { ok, destinatie } sau { error } dacă contul n-are niciun acces alocat.
//
// Decide unde ajunge userul DUPĂ ce Supabase i-a confirmat deja parola
// (acest endpoint nu verifică parola — doar decide destinația, pe baza
// rolului real din profiles sau a unui rând activ din accese_temporare):
//   1. admin/superadmin → /mydarrin-superadmin (bypass, ca în middleware).
//   2. altfel, rând ACTIV+neexpirat în accese_temporare → ruta_url alocată.
//   3. altfel → 403, „acest cont nu are încă acces alocat".

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data: profile } = await supabaseAdmin.from('profiles').select('roles').eq('id', user.id).single();
  const roles = Array.isArray(profile?.roles) ? profile.roles : [];
  if (roles.includes('admin') || roles.includes('superadmin')) {
    return res.status(200).json({ ok: true, destinatie: '/mydarrin-superadmin' });
  }

  if (!user.email) return res.status(403).json({ error: 'Acest cont nu are încă acces alocat pe platformă.' });

  const { data: acces } = await supabaseAdmin
    .from('accese_temporare')
    .select('ruta_url, expira_la')
    .eq('email', user.email.toLowerCase())
    .eq('activ', true)
    .maybeSingle();

  if (acces && new Date(acces.expira_la) >= new Date()) {
    // '*' = acces complet pe tot site-ul public (vezi creeaza-acces-temporar.js
    // și middleware.js) — nu e o rută reală de redirecționat, aterizăm pe
    // homepage ca punct de start; de-acolo poate naviga oriunde public.
    const destinatie = acces.ruta_url === '*' ? '/home' : acces.ruta_url;
    return res.status(200).json({ ok: true, destinatie });
  }

  return res.status(403).json({ error: 'Acest cont nu are încă acces alocat pe platformă. Contactează administratorul.' });
}

module.exports = requireAuth([], handler);
