// /api/admin/deviz-recipe.js
// G14 (25 Iulie 2026) — expune motorul de calcul din
// lib/calculeaza-cost-recipe.js: pentru fiecare articol de rețetă
// (devize_articole), costul de manoperă calculat real din devize_retete +
// devize_resurse + manopera_costuri (G13). Admin/superadmin only, doar
// citire — panoul „Motor de rețete" din mydarrin-deviz-engine.html.
//
// GET ?tara=RO → { ok, articole:[{ articol_id, denumire_articol,
//   unitate_masura, catalog_nivel_id, ...cost calculat }] }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { calculeazaCostRecipeArticol } = require('../../lib/calculeaza-cost-recipe');

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const taraCod = ['RO', 'MD', 'DE', 'FR', 'BG'].includes(req.query.tara) ? req.query.tara : 'RO';

  const { data: articole, error } = await supabaseAdmin
    .from('devize_articole')
    .select('articol_id, denumire_articol, unitate_masura, uniclass_system_code, catalog_nivel_id')
    .order('articol_id');
  if (error) {
    return res.status(500).json({ error: 'Eroare la citirea articolelor de rețetă' });
  }

  const rezultate = [];
  for (const articol of articole || []) {
    const cost = await calculeazaCostRecipeArticol({ articolId: articol.articol_id, taraCod });
    rezultate.push({ ...articol, ...cost });
  }

  return res.status(200).json({ ok: true, tara: taraCod, articole: rezultate });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
