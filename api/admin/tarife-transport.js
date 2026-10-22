// /api/admin/tarife-transport.js
// G2, partea 2 (cerință explicită 31 Iulie 2026) — grila reală de tarife
// transport-după-greutate + cost ajutor. Pornește goală; efectul asupra
// prețului final rămâne 0 până se configurează rânduri reale aici — vezi
// cuplarea în lib/calculeaza-pret.js.
//
// GET                          → listă completă
// POST { action:'salveaza', id?, tara_cod?, nivel_transport_marfa?, prag_kg_min, prag_kg_max?, tarif_ron_per_kg?, tarif_fix?, cost_ajutor?, moneda?, activ? }
// POST { action:'sterge', id }

const { requireAuth } = require('../../lib/auth-middleware');
const { trimiteEroare, camp, formaComuna } = require('../../lib/raspuns-eroare');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.from('tarife_transport').select('*').order('creat_la', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, tarife: data });
  }

  if (req.method === 'POST') {
    const { action } = req.body || {};

    if (action === 'sterge') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id este obligatoriu' });
      const { error } = await supabaseAdmin.from('tarife_transport').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      await inregistreazaAudit({ admin, req, actiune: 'stergere_tarif_transport', entitate: 'tarife_transport', entitate_id: id });
      return res.status(200).json({ ok: true });
    }

    if (action === 'salveaza') {
      const {
        id, tara_cod, nivel_transport_marfa, prag_kg_min, prag_kg_max,
        tarif_ron_per_kg, tarif_fix, cost_ajutor, moneda, activ,
      } = req.body;

      if (typeof prag_kg_min !== 'number' || prag_kg_min < 0) {
        return trimiteEroare(res, 400, 'DATE_INVALIDE', '«Prag min kg» trebuie să fie un număr ≥ 0.', '«Min kg threshold» must be a number ≥ 0.', [camp('prag_kg_min', '«Prag min kg» trebuie să fie un număr ≥ 0.', '«Min kg threshold» must be a number ≥ 0.')]);
      }
      if (prag_kg_max !== null && prag_kg_max !== undefined && (typeof prag_kg_max !== 'number' || prag_kg_max <= prag_kg_min)) {
        return trimiteEroare(res, 400, 'DATE_INVALIDE', '«Prag max kg» trebuie să fie mai mare decât «Prag min kg», sau gol (fără limită).', '«Max kg threshold» must be greater than «Min kg threshold», or empty (no limit).', [camp('prag_kg_max', '«Prag max kg» trebuie să fie mai mare decât «Prag min kg», sau gol.', '«Max kg threshold» must be greater than «Min kg threshold», or empty.')]);
      }
      const areTarif = (typeof tarif_ron_per_kg === 'number' && tarif_ron_per_kg > 0) || (typeof tarif_fix === 'number' && tarif_fix > 0);
      if (!areTarif) {
        return trimiteEroare(res, 400, 'DATE_INVALIDE', 'Completați «RON/kg» sau «Tarif fix» cu un număr pozitiv.', 'Fill in «RON/kg» or «Fixed rate» with a positive number.', [camp('tarif_ron_per_kg', 'Completați «RON/kg» sau «Tarif fix».', 'Fill in «RON/kg» or «Fixed rate».'), camp('tarif_fix', 'Completați «Tarif fix» sau «RON/kg».', 'Fill in «Fixed rate» or «RON/kg».')]);
      }

      const rand = {
        tara_cod: tara_cod ? String(tara_cod).toUpperCase() : null,
        nivel_transport_marfa: nivel_transport_marfa || null,
        prag_kg_min,
        prag_kg_max: prag_kg_max ?? null,
        tarif_ron_per_kg: tarif_ron_per_kg ?? null,
        tarif_fix: tarif_fix ?? null,
        cost_ajutor: Number(cost_ajutor) || 0,
        moneda: moneda || 'RON',
        activ: activ !== false,
        actualizat_la: new Date().toISOString(),
      };

      const query = id
        ? supabaseAdmin.from('tarife_transport').update(rand).eq('id', id)
        : supabaseAdmin.from('tarife_transport').insert(rand);
      const { data, error } = await query.select().single();
      if (error) return res.status(500).json({ error: error.message });

      await inregistreazaAudit({ admin, req, actiune: 'salvare_tarif_transport', entitate: 'tarife_transport', entitate_id: data.id, detalii: rand });
      return res.status(200).json({ ok: true, tarif: data });
    }

    return res.status(400).json({ error: `action necunoscută: ${action}` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
