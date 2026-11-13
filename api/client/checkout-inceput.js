// /api/client/checkout-inceput.js
// G24b — instrumentare nouă, necesară pentru email-ul de „coș abandonat":
// arhitectura reală nu are un concept de comandă-început (comenzi.creat_la
// se scrie abia la trimiterea finală a checkout-ului, nu la intrarea pe
// pagină — comenzi_status_check nu are stare de „draft"). Acest endpoint
// e singurul semnal server-side care există pentru „utilizatorul autentificat
// a ajuns pe checkout" — apelat fire-and-forget din mydarrin-checkout.html
// la încărcarea paginii, doar dacă există o sesiune reală.
//
// POST (fără body) → { ok:true }. Autentificare obligatorie (requireAuth) —
// altfel oricine ar putea înregistra vizite false pentru orice user_id.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

async function handler(req, res, user) {
  if (req.method !== 'POST') {
    return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  }

  const { error } = await supabaseAdmin
    .from('checkout_inceput_log')
    .insert({ user_id: user.id });
  if (error) {
    console.error('[client/checkout-inceput]', error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut înregistra vizita', 'We could not record the visit.');
  }

  return res.status(200).json({ ok: true });
}

module.exports = requireAuth([], handler);
