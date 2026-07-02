// /api/investitori/exit.js
// Procesează o cerere de exit: fie Buy-Back (My Darrin răscumpără la -10% din
// evaluarea curentă, conform README), fie listare pe Piața Secundară internă.
//
// Body: { tip: 'buyback' | 'piata_secundara', numar_actiuni }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tip, numar_actiuni } = req.body || {};
  if (!['buyback', 'piata_secundara'].includes(tip) || !(numar_actiuni > 0)) {
    return res.status(400).json({ error: 'tip (buyback|piata_secundara) și numar_actiuni (>0) sunt obligatorii' });
  }

  // Verifică dacă investitorul chiar deține atâtea acțiuni
  const { data: portofoliu, error: portErr } = await supabaseAdmin
    .from('investitori_portofoliu')
    .select('actiuni')
    .eq('investitor_id', user.id);
  if (portErr) return res.status(500).json({ error: 'Eroare la citirea portofoliului' });

  const totalActiuni = (portofoliu || []).reduce((sum, r) => sum + Number(r.actiuni), 0);
  if (numar_actiuni > totalActiuni) {
    return res.status(400).json({ error: `Deții doar ${totalActiuni} acțiuni, nu poți solicita exit pentru ${numar_actiuni}` });
  }

  const { data, error } = await supabaseAdmin
    .from('investitori_exit')
    .insert({ investitor_id: user.id, tip, numar_actiuni, status: 'in_procesare' })
    .select()
    .single();

  if (error) {
    console.error('[investitori/exit]', error);
    return res.status(500).json({ error: 'Nu am putut înregistra cererea de exit' });
  }

  // TODO: buyback -> calcul automat sumă (evaluare_curentă × 0.9 × pondere_actiuni)
  //       piata_secundara -> listare în tabelul de piață secundară (nu implementat aici)

  return res.status(200).json({ ok: true, cerere: data });
}

module.exports = requireAuth(['investor'], handler);
