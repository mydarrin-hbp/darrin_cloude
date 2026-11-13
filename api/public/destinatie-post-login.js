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
//
// Pasul 11-R3 (2 nov. 2026): clientul fără nicio comandă nu are dashboard →
// { tip: 'client_fara_comenzi', destinatie: '/mydarrin-catalog.html' }. Rolul
// de partener ales și încă neacordat → { tip: 'activare_partener', destinatie:
// dashboard-ul rolului } (lista „Activează contul”). Revenirea în coș sau în
// checkout o face browserul (myd_revenire_dupa_login), înaintea acestui apel.

const { requireAuth } = require('../../lib/auth-middleware');
const { destinatiePentru } = require('../../lib/destinatie-cont');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

const FARA_ACCES = {
  error: 'Acest cont nu are încă acces alocat pe platformă. Contactează administratorul.',
  error_en: 'This account has not been granted access to the platform yet. Contact the administrator.',
};
const ACCES_EXPIRAT = {
  error: 'Accesul temporar a expirat. Contactează administratorul.',
  error_en: 'Your temporary access has expired. Contact the administrator.',
};

async function handler(req, res, user) {
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  try {
    const d = await destinatiePentru(user);
    if (d && d.tip === 'acces_expirat') return trimiteEroare(res, 403, 'ACCES_EXPIRAT', ACCES_EXPIRAT.error, ACCES_EXPIRAT.error_en);
    if (!d || !d.destinatie) return trimiteEroare(res, 403, 'FARA_ACCES', FARA_ACCES.error, FARA_ACCES.error_en);
    return res.status(200).json({ ok: true, ...d });
  } catch (err) {
    console.error('[destinatie-post-login]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut stabili destinația.', 'Could not determine where to take you.');
  }
}

module.exports = requireAuth([], handler);
