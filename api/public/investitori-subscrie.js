// /api/public/investitori-subscrie.js
// FIX (audit 2026-07-14): finalizeazaSubscriere() din mydarrin-investitori.html
// nu scria niciodată un rând real în investitori_portofoliu — totul rămânea
// în sessionStorage (myd_investor), deci "portofoliul" investitorului
// dispărea la ștergerea datelor de navigare și, mai grav, fluxul public
// "live" de investiții (api/public/investitori-live.js) nu avea niciodată
// ce afișa. Acest endpoint scrie efectiv rândul.
//
// Fluxul de investitori nu cere o sesiune Supabase autentificată reală
// (leads gestionate prin email, în investitori_leads) — de aceea acest
// endpoint e public, rate-limited, nu requireAuth.
//
// Body: { email, suma_eur, actiuni, instrument, oras?, exit_estimat_luni?,
//         consimtamant_public? }

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const allowed = await checkRateLimit(req, { key: 'investitori-subscrie', limit: 10, windowSeconds: 600 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.' });

  const { email, suma_eur, actiuni, instrument, oras = null, exit_estimat_luni = null, consimtamant_public = false } = req.body || {};

  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email valid obligatoriu.' });
  if (typeof suma_eur !== 'number' || !(suma_eur > 0)) return res.status(400).json({ error: 'suma_eur (numeric, pozitiv) este obligatorie.' });
  if (typeof actiuni !== 'number' || !(actiuni > 0)) return res.status(400).json({ error: 'actiuni (numeric, pozitiv) este obligatoriu.' });

  try {
    const { data, error } = await supabaseAdmin.from('investitori_portofoliu').insert({
      email: email.trim().toLowerCase(),
      valoare_investita: suma_eur,
      actiuni,
      oras: oras ? String(oras).trim().slice(0, 100) : null,
      exit_estimat_luni: Number.isFinite(exit_estimat_luni) ? exit_estimat_luni : null,
      consimtamant_public: !!consimtamant_public,
    }).select().single();
    if (error) throw error;

    return res.status(200).json({ ok: true, portofoliu: data });
  } catch (err) {
    console.error('[investitori-subscrie]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut înregistra subscrierea' });
  }
};
