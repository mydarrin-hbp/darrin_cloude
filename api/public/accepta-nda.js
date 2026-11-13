// /api/public/accepta-nda.js
// POST, cu Authorization: Bearer <access_token> — înregistrează acceptarea
// acordului de confidențialitate (NDA) pentru accesul temporar activ al
// userului curent. Nu poate fi apelat "în numele" altcuiva — emailul vine
// din JWT-ul deja verificat de requireAuth, nu din body.
//
// → { ok, destinatie } — pagina reală la care userul are voie acum.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const v = require('../../lib/valideaza');
const { limiteazaCererea } = require('../../lib/rate-limit');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: singurul câmp acceptat.
const SCHEMA = {
  accept: v.boolean({ obligatoriu: true, adevarat: true, eticheta: ['Acordul de confidențialitate', 'Confidentiality agreement'] }),
};

const NDA_VERSIUNE = 'v1-2026-07-23';

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  if (!user.email) return trimiteEroare(res, 400, 'FARA_EMAIL', 'Cont fără email.', 'The account has no email.');

  const date = v.valideazaSauTrimite(req, res, SCHEMA);
  if (!date) return;

  // Pasul 11-S1: cel mult 5 cereri în 10 minute, pe IP și pe emailul contului.
  if (!(await limiteazaCererea(req, res, { key: 'accepta-nda', limit: 5, windowSeconds: 600, email: user.email }))) return;

  const { data: acces } = await supabaseAdmin
    .from('accese_temporare')
    .select('id, ruta_url, expira_la')
    .eq('email', user.email.toLowerCase())
    .eq('activ', true)
    .maybeSingle();

  if (!acces || new Date(acces.expira_la) < new Date()) {
    return trimiteEroare(res, 404, 'NU_EXISTA', 'Nu există niciun acces temporar activ pentru acest cont.', 'There is no active temporary access for this account.');
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
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut înregistra acceptarea.', 'We could not record the acceptance. Please try again.');
  }

  const destinatie = acces.ruta_url === '*' ? '/home' : acces.ruta_url;
  return res.status(200).json({ ok: true, destinatie });
}

module.exports = requireAuth([], handler);
