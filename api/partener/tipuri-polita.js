// /api/partener/tipuri-polita.js
// Etapa CAT-3b (28 august 2026) — cerere fondator: partenerii de asigurări
// să poată configura real ce oferă (tipuri de poliță, limite de acoperire,
// comision negociat) înainte de campania de atragere parteneri. Auditat
// înainte de implementare (agent Explore): NU exista niciun mecanism pentru
// asta — panoul "Polițe emise" din dashboard e machetă completă (date
// hardcodate), și e conceptual diferit oricum (polițe deja emise pe comenzi
// reale, nu tipurile de poliță pe care un asigurător le oferă). Singurul loc
// unde conceptul era măcar SCHIȚAT era `mydarrin-auth-schema.html` (document
// de arhitectură, marcat explicit "Draft v1", fără implementare reală) —
// `specific_per_tip.asigurari: { tipuri_polite[], limita_acoperire_eur, comision_pct }`.
//
// Urmează exact tiparul deja stabilit pentru Echipă/Utilaje/Certificări/Cont
// bancar/Zonă curier: POST = adaugă (nu înlocuiește, un asigurător poate
// oferi mai multe tipuri de poliță), DELETE dedicat pe un singur tip
// (dezactivare, nu ștergere fizică).
//
// GET    → tipurile de poliță active
// POST   { tip_polita, limita_acoperire_eur?, comision_pct? } → adaugă un tip nou
// DELETE { id } → dezactivează un singur tip

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('partner_tipuri_polita')
      .select('id, tip_polita, limita_acoperire_eur, comision_pct, created_at')
      .eq('partner_id', user.id)
      .eq('activ', true)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, tipuri: data || [] });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id este obligatoriu' });
    const { data, error } = await supabaseAdmin
      .from('partner_tipuri_polita')
      .update({ activ: false })
      .eq('id', id)
      .eq('partner_id', user.id)
      .select('id')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Tipul de poliță nu există sau nu-ți aparține' });
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tip_polita, limita_acoperire_eur, comision_pct } = req.body || {};
  if (!tip_polita || typeof tip_polita !== 'string' || !tip_polita.trim()) {
    return res.status(400).json({ error: 'tip_polita este obligatoriu' });
  }
  if (limita_acoperire_eur != null && !(typeof limita_acoperire_eur === 'number' && limita_acoperire_eur > 0)) {
    return res.status(400).json({ error: 'limita_acoperire_eur trebuie să fie un număr pozitiv' });
  }
  if (comision_pct != null && !(typeof comision_pct === 'number' && comision_pct >= 0 && comision_pct <= 100)) {
    return res.status(400).json({ error: 'comision_pct trebuie să fie între 0 și 100' });
  }

  try {
    const { data: tip, error: insErr } = await supabaseAdmin.from('partner_tipuri_polita').insert({
      partner_id: user.id,
      tip_polita: tip_polita.trim().slice(0, 200),
      limita_acoperire_eur: limita_acoperire_eur ?? null,
      comision_pct: comision_pct ?? null,
    }).select('id').single();
    if (insErr) throw insErr;
    return res.status(200).json({ ok: true, tip });
  } catch (err) {
    console.error('[tipuri-polita]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut salva tipul de poliță' });
  }
}

module.exports = requireAuth(['partener_asigurari'], handler);
