// /api/investitori/exit.js
// Procesează o cerere de exit: fie Buy-Back (My Darrin răscumpără la -10% din
// evaluarea curentă, conform README), fie listare pe Piața Secundară internă.
//
// Body: { tip: 'buyback' | 'piata_secundara', numar_actiuni }
//
// FIX (Etapa INV, audit 26 august 2026): endpoint-ul citea/scria pe coloana
// investitor_id, dar schema reală (drift, aplicat direct pe DB, corectat
// acum în schema.sql) are user_id — orice cerere eșua. Tabela investitori_exit
// nici nu exista în DB — creată acum (vezi schema.sql). Calculul sumei de
// buyback și listarea pe piața secundară rămân TODO neimplementate — fac
// parte din mecanismul de lichiditate mai amplu (drept de preemțiune,
// termene de 30 zile), în așteptarea revizuirii juridice a mecanismului.

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
    .eq('user_id', user.id);
  if (portErr) return res.status(500).json({ error: 'Eroare la citirea portofoliului' });

  const totalActiuni = (portofoliu || []).reduce((sum, r) => sum + Number(r.actiuni), 0);
  if (numar_actiuni > totalActiuni) {
    return res.status(400).json({ error: `Deții doar ${totalActiuni} acțiuni, nu poți solicita exit pentru ${numar_actiuni}` });
  }

  const { data, error } = await supabaseAdmin
    .from('investitori_exit')
    .insert({ user_id: user.id, tip, numar_actiuni, status: 'in_procesare' })
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
