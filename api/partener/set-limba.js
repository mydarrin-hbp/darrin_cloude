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
const v = require('../../lib/valideaza');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  limba: v.text({ max: 5, eticheta: ['Limba', 'Language'] }),
};

async function handler(req, res, user) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora' })) return;
  const { limba } = req.body || {};
  if (!LIMBI_DISPONIBILE.includes(limba)) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', `limba trebuie să fie una din: ${LIMBI_DISPONIBILE.join(', ')}`, `limba must be one of: ${LIMBI_DISPONIBILE.join(', ')}`, ['limba']);
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ limba: limbaValida(limba) })
    .eq('id', user.id);

  if (error) {
    console.error('[set-limba]', error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut actualiza limba', 'We could not update the language. Please try again.');
  }

  return res.status(200).json({ ok: true, limba: limbaValida(limba) });
}

module.exports = requireAuth([], handler);
