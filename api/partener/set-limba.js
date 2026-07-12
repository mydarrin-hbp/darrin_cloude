// /api/partener/set-limba.js
// Adăugat 2026-07-12 — permite unui utilizator autentificat să-și schimbe
// manual limba folosită pentru emailuri/notificări. Limba e dedusă automat
// din țară la înregistrare, dar doar userul își poate schimba propria
// limbă ulterior — niciun alt endpoint nu scrie pe profiles.limba.
//
// Body: { limba: 'ro'|'en'|'it'|'fr'|'de'|'es' }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { limbaValida, LIMBI_DISPONIBILE } = require('../../lib/i18n');

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { limba } = req.body || {};
  if (!LIMBI_DISPONIBILE.includes(limba)) {
    return res.status(400).json({ error: `limba trebuie să fie una din: ${LIMBI_DISPONIBILE.join(', ')}` });
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ limba: limbaValida(limba) })
    .eq('id', user.id);

  if (error) {
    console.error('[set-limba]', error);
    return res.status(500).json({ error: 'Nu am putut actualiza limba' });
  }

  return res.status(200).json({ ok: true, limba: limbaValida(limba) });
}

module.exports = requireAuth([], handler);
