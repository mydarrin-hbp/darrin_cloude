// /api/public/nda-info.js
// GET, cu Authorization: Bearer <access_token> — folosit de pagina
// /acord-confidentialitate ca să știe pentru cine afișează acordul (nume,
// prenume, email) și unde să-l trimită după acceptare.
//
// → { ok, nume, prenume, email, deja_acceptat, destinatie }
//   sau 404 dacă acest cont nu are niciun acces temporar activ (nu ar
//   trebui să ajungă niciodată aici fără unul — admin/superadmin nu
//   trece deloc prin acest flux, vezi destinatie-post-login.js).

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!user.email) return res.status(400).json({ error: 'Cont fără email.' });

  const { data: acces } = await supabaseAdmin
    .from('accese_temporare')
    .select('nume, prenume, ruta_url, nda_acceptat, expira_la')
    .eq('email', user.email.toLowerCase())
    .eq('activ', true)
    .maybeSingle();

  if (!acces || new Date(acces.expira_la) < new Date()) {
    return res.status(404).json({ error: 'Nu există niciun acces temporar activ pentru acest cont.' });
  }

  const destinatie = acces.ruta_url === '*' ? '/home' : acces.ruta_url;
  return res.status(200).json({
    ok: true,
    nume: acces.nume || '',
    prenume: acces.prenume || '',
    email: user.email,
    deja_acceptat: !!acces.nda_acceptat,
    destinatie,
  });
}

module.exports = requireAuth([], handler);
