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
const v = require('../../lib/valideaza');
const { trimiteEroare, trimiteEroareInterna } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  tip_polita: v.text({ max: 100, eticheta: ['Tipul poliței', 'Policy type'] }),
  limita_acoperire_eur: v.numar({ min: 0, max: 10000000000, eticheta: ['Limita de acoperire (EUR)', 'Coverage limit (EUR)'] }),
  comision_pct: v.numar({ min: 0, max: 100, eticheta: ['Comision (%)', 'Commission (%)'] }),
};

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('partner_tipuri_polita')
      .select('id, tip_polita, limita_acoperire_eur, comision_pct, created_at')
      .eq('partner_id', user.id)
      .eq('activ', true)
      .order('created_at', { ascending: false });
    if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
    return res.status(200).json({ ok: true, tipuri: data || [] });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'id este obligatoriu', 'id is required.', ['id']);
    const { data, error } = await supabaseAdmin
      .from('partner_tipuri_polita')
      .update({ activ: false })
      .eq('id', id)
      .eq('partner_id', user.id)
      .select('id')
      .maybeSingle();
    if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
    if (!data) return trimiteEroare(res, 404, 'NU_EXISTA', 'Tipul de poliță nu există sau nu-ți aparține', 'The policy type does not exist or does not belong to you.');
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora' })) return;
  const { tip_polita, limita_acoperire_eur, comision_pct } = req.body || {};
  if (!tip_polita || typeof tip_polita !== 'string' || !tip_polita.trim()) {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'tip_polita este obligatoriu', 'tip_polita is required.', ['tip_polita']);
  }
  if (limita_acoperire_eur != null && !(typeof limita_acoperire_eur === 'number' && limita_acoperire_eur > 0)) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', 'limita_acoperire_eur trebuie să fie un număr pozitiv', 'limita_acoperire_eur must be a positive number.', ['limita_acoperire_eur']);
  }
  if (comision_pct != null && !(typeof comision_pct === 'number' && comision_pct >= 0 && comision_pct <= 100)) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', 'comision_pct trebuie să fie între 0 și 100', 'comision_pct must be between 0 and 100.', ['comision_pct']);
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
    return trimiteEroareInterna(res, 500, 'EROARE_SERVER', 'Nu am putut salva tipul de poliță', 'We could not save the policy type. Please try again.', err);
  }
}

module.exports = requireAuth(['partener_asigurari'], handler);
