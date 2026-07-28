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

async function handler(req, res, user) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { error } = await supabaseAdmin
    .from('checkout_inceput_log')
    .insert({ user_id: user.id });
  if (error) {
    console.error('[client/checkout-inceput]', error);
    return res.status(500).json({ error: 'Nu am putut înregistra vizita' });
  }

  return res.status(200).json({ ok: true });
}

module.exports = requireAuth([], handler);
