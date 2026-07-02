// /api/deviz/calculate.js
// Rulează formula motorului de deviz (identică cu cea documentată în README /
// mydarrin-deviz-engine.html) și salvează rezultatul în tabelul `devize`.
//
// Body: { serviciu_id, cost_brut, tara, zone_coef, urgency_coef, tva }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const VMC = { RO: 100, MD: 400, DE: 25, FR: 25, BG: 40 }; // Valoare Minimă Calculabilă per țară
const INDIRECT = 0.10, MARKETING = 0.03, PLATFORMA = 0.03;

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    serviciu_id, cost_brut, tara = 'RO',
    mydarrin_pct = 0.10, zone_coef = 1, urgency_coef = 1, tva = 0.19,
    urgent = false, zona = null,
  } = req.body || {};

  if (!serviciu_id || typeof cost_brut !== 'number') {
    return res.status(400).json({ error: 'serviciu_id și cost_brut (numeric) sunt obligatorii' });
  }

  const vmcTara = VMC[tara] ?? VMC.RO;
  const costBaza = Math.max(cost_brut, vmcTara);
  const pretFinal =
    costBaza *
    (1 + INDIRECT + MARKETING + PLATFORMA) *
    (1 + mydarrin_pct) *
    zone_coef *
    urgency_coef *
    (1 + tva);

  const { data, error } = await supabaseAdmin
    .from('devize')
    .insert({
      client_id: user.id,
      serviciu_id,
      input_json: req.body,
      cost_brut,
      cost_baza: costBaza,
      pret_final: Math.round(pretFinal * 100) / 100,
      zona,
      urgent,
    })
    .select()
    .single();

  if (error) {
    console.error('[deviz/calculate]', error);
    return res.status(500).json({ error: 'Nu am putut salva devizul' });
  }

  return res.status(200).json({ ok: true, deviz: data });
}

module.exports = requireAuth([], handler); // orice user autentificat poate cere un deviz
