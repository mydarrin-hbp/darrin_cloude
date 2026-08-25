// /api/public/statistici-homepage.js
// Endpoint public, rate-limited — înlocuiește contoarele animate hardcodate
// din index.html (audit 25 august 2026: "12.400 Clienți activi"/"1.840
// Parteneri verificați"/"1.834 Devize AI/lună"/"4.87 Rating mediu" — toate
// literale în markup, data-target fix, zero legătură cu DB).
//
// "Rating mediu" NU e inclus în răspuns — tabela `recenzii` nu există deloc
// în schemă (verificat live) — nu se poate calcula onest, nu se inventează.
// Contorul corespunzător rămâne de eliminat din UI, nu de umplut cu 0.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const allowed = await checkRateLimit(req, { key: 'statistici-homepage', limit: 60, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe cereri.' });

  try {
    const inceputLuna = new Date();
    inceputLuna.setUTCDate(1);
    inceputLuna.setUTCHours(0, 0, 0, 0);

    const [{ count: clientiActivi }, { count: parteneriVerificati }, { count: devizeAiLuna }] = await Promise.all([
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).contains('roles', ['client']).eq('status', 'active'),
      supabaseAdmin.from('partners').select('id', { count: 'exact', head: true }).eq('status_verificare', 'approved'),
      supabaseAdmin.from('devize_ai_requests').select('id', { count: 'exact', head: true }).gte('created_at', inceputLuna.toISOString()),
    ]);

    return res.status(200).json({
      ok: true,
      clienti_activi: clientiActivi || 0,
      parteneri_verificati: parteneriVerificati || 0,
      devize_ai_luna: devizeAiLuna || 0,
    });
  } catch (err) {
    console.error('[statistici-homepage]', err);
    return res.status(500).json({ error: 'Nu am putut calcula statisticile' });
  }
};
