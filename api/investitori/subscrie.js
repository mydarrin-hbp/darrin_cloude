// /api/investitori/subscrie.js
// Subscrierea (achiziția de acțiuni / cote), legată de cont (pasul 11-L,
// 17 oct. 2026; decizia LM C1: achiziția rămâne funcțională). Înlocuiește
// api/public/investitori-subscrie.js, care era public și lega subscrierea doar
// de un email, fără user_id.
//
// Doar pentru conturi cu rolul `investor` (profiles.roles). O subscriere se
// poate trimite oricând după ruta de investitor; o aprobă adminul
// (api/admin/investitori-aprobare.js) doar dacă verificarea identității
// (investitori_kyc) e aprobată.
//
// Suma și numărul de acțiuni le calculează azi pagina, din valorile scrise de
// mână ale rundei (EVAL_PARAMS din mydarrin-investitori.html) — de mutat în
// back-office la pasul 11-J (rundele de finanțare). Aici nu se adaugă praguri.
//
// POST { suma_eur, actiuni, instrument? } → { ok, portofoliu, kyc_status }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');
const { citesteKyc } = require('../../lib/investitori-kyc');

const INSTRUMENTE = ['SAFE', 'Equity', 'Convertible', 'Negociabil'];

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const permis = await checkRateLimit(req, { key: 'investitori-subscrie', limit: 10, windowSeconds: 600 });
  if (!permis) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.', error_en: 'Too many requests. Please try again later.' });

  const { suma_eur, actiuni, instrument = null } = req.body || {};
  if (typeof suma_eur !== 'number' || !Number.isFinite(suma_eur) || !(suma_eur > 0)) {
    return res.status(400).json({ error: 'Alege suma investiției.', error_en: 'Choose the investment amount.' });
  }
  if (!Number.isInteger(actiuni) || !(actiuni > 0)) {
    return res.status(400).json({ error: 'Numărul de acțiuni nu e valid.', error_en: 'The number of shares is not valid.' });
  }
  if (instrument !== null && !INSTRUMENTE.includes(instrument)) {
    return res.status(400).json({ error: 'Instrumentul ales nu e valid.', error_en: 'The chosen instrument is not valid.' });
  }

  try {
    const kyc = await citesteKyc(user.id);
    const { data, error } = await supabaseAdmin.from('investitori_portofoliu').insert({
      user_id: user.id,
      email: user.email ? String(user.email).trim().toLowerCase() : null,
      valoare_investita: suma_eur,
      actiuni,
      instrument,
      consimtamant_public: false,
      status: 'in_asteptare',
    }).select().single();
    if (error) throw error;
    return res.status(200).json({ ok: true, portofoliu: data, kyc_status: (kyc && kyc.status) || null });
  } catch (err) {
    console.error('[investitori/subscrie]', err);
    return res.status(500).json({ error: 'Nu am putut înregistra subscrierea.', error_en: 'We could not record the subscription.' });
  }
}

module.exports = requireAuth(['investor'], handler);
