// /api/public/lead-zona.js
// Endpoint PUBLIC — captează lead-uri din zone unde checkout-ul nu e încă
// activ (Etapa 4, audit 2026-07-12), pentru strategia de scalare/înființare
// entități juridice. Strict listă de așteptare — nicio trimitere automată
// de email nu pleacă de aici (aceeași regulă ca la parteneri_prospecti).

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const allowed = await checkRateLimit(req, { key: 'lead-zona', limit: 5, windowSeconds: 600 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.' });

  const { email, nume, tara_cod, tara_nume } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Email valid obligatoriu.' });
  }

  try {
    const { error } = await supabaseAdmin.from('tari_lead_asteptare').insert({
      email: email.trim().toLowerCase(),
      nume: nume ? String(nume).trim().slice(0, 200) : null,
      tara_cod: tara_cod ? String(tara_cod).trim().slice(0, 8).toUpperCase() : null,
      tara_nume: tara_nume ? String(tara_nume).trim().slice(0, 100) : null,
    });
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[lead-zona]', err);
    return res.status(500).json({ error: 'Nu am putut înregistra cererea.' });
  }
};
