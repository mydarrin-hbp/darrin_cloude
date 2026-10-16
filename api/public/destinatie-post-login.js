// /api/public/destinatie-post-login.js
// FIX CRITIC (2026-07-23): de când middleware.js blochează tot site-ul
// implicit, /acces-temporar a devenit singura poartă de intrare — inclusiv
// pentru conturi REALE (admin/superadmin/client/partener), nu doar pentru
// testerii cu parolă temporară.
//
// GET, cu Authorization: Bearer <access_token proaspăt din signInWithPassword>
// → { ok, destinatie, tip, rol?, roluri? } sau { error, error_en } (403) dacă
// contul n-are niciun rol și niciun acces temporar.
//
// Decide unde ajunge userul DUPĂ ce Supabase i-a confirmat deja parola
// (acest endpoint nu verifică parola). Pasul 10b (16 oct. 2026): destinația
// vine din profiles.roles, cu harta unică — vezi lib/destinatie-cont.js.

const { requireAuth } = require('../../lib/auth-middleware');
const { destinatiePentru } = require('../../lib/destinatie-cont');

const FARA_ACCES = {
  error: 'Acest cont nu are încă acces alocat pe platformă. Contactează administratorul.',
  error_en: 'This account has not been granted access to the platform yet. Contact the administrator.',
};
const ACCES_EXPIRAT = {
  error: 'Accesul temporar a expirat. Contactează administratorul.',
  error_en: 'Your temporary access has expired. Contact the administrator.',
};

async function handler(req, res, user) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const d = await destinatiePentru(user);
    if (d && d.tip === 'acces_expirat') return res.status(403).json(ACCES_EXPIRAT);
    if (!d || !d.destinatie) return res.status(403).json(FARA_ACCES);
    return res.status(200).json({ ok: true, ...d });
  } catch (err) {
    console.error('[destinatie-post-login]', err);
    return res.status(500).json({ error: 'Nu am putut stabili destinația.', error_en: 'Could not determine where to take you.' });
  }
}

module.exports = requireAuth([], handler);
