// /api/public/accepta-nda.js
// POST, cu Authorization: Bearer <access_token> — înregistrează acceptarea
// acordului de confidențialitate (NDA) pentru accesul temporar activ al
// userului curent. Nu poate fi apelat "în numele" altcuiva — emailul vine
// din JWT-ul deja verificat de requireAuth, nu din body.
//
// → { ok, destinatie } — pagina reală la care userul are voie acum.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const NDA_VERSIUNE = 'v1-2026-07-23';

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!user.email) return res.status(400).json({ error: 'Cont fără email.' });

  const { accept } = req.body || {};
  if (accept !== true) {
    return res.status(400).json({ error: 'Trebuie să bifezi acordul înainte de a continua.' });
  }

  const { data: acces } = await supabaseAdmin
    .from('accese_temporare')
    .select('id, ruta_url, expira_la')
    .eq('email', user.email.toLowerCase())
    .eq('activ', true)
    .maybeSingle();

  if (!acces || new Date(acces.expira_la) < new Date()) {
    return res.status(404).json({ error: 'Nu există niciun acces temporar activ pentru acest cont.' });
  }

  const { error: updErr } = await supabaseAdmin
    .from('accese_temporare')
    .update({
      nda_acceptat: true,
      nda_acceptat_la: new Date().toISOString(),
      nda_versiune: NDA_VERSIUNE,
      nda_ip: getClientIp(req),
    })
    .eq('id', acces.id);

  if (updErr) {
    console.error('[accepta-nda]', updErr);
    return res.status(500).json({ error: 'Nu am putut înregistra acceptarea.' });
  }

  const destinatie = acces.ruta_url === '*' ? '/home' : acces.ruta_url;
  return res.status(200).json({ ok: true, destinatie });
}

module.exports = requireAuth([], handler);
