// /api/admin/exemplu-pret.js
// Exemplul de calcul live din panoul „Comisioane & Tarifare” (superadmin,
// pasul 10b, 16 oct. 2026): „25 lei fără TVA → X lei pentru client”.
//
// POST { tara, cost_baza, comision_platforma_default_pct, cost_marketing_pct,
//        cost_mentenanta_pct, cost_asigurare_pct }
// → { ok, tara_tva, moneda, calc: { cost_baza, cost_asigurare, comision_platforma,
//     subtotal, cost_marketing, cost_mentenanta, tva_pct, tva_suma, pret_final } }
//
// Procentele vin din câmpurile panoului (valorile curente, încă nesalvate);
// TVA-ul se citește din tax_configurations, pentru țara aleasă (pentru
// „Toate țările” se folosește RO, spus explicit în răspuns). Calculul e
// aplicaFormulaPret din lib/calculeaza-pret.js — aceeași formulă ca la
// comenzi și pe marketplace, nu o copie. Nu scrie nimic.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { aplicaFormulaPret, citesteTva, CHEI_PRICING, EroareConfigPret } = require('../../lib/calculeaza-pret');

function procent(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  const tara = /^[A-Z]{2}$/.test(String(b.tara || '')) ? String(b.tara) : 'RO';
  const costBaza = Number(b.cost_baza);
  if (!Number.isFinite(costBaza) || costBaza < 0 || costBaza > 1e7) return res.status(400).json({ error: 'cost_baza invalid.' });

  const pricing = {};
  const lipsa = [];
  CHEI_PRICING.forEach((cheie) => { const p = procent(b[cheie]); if (p === null) lipsa.push(cheie); else pricing[cheie] = p; });
  const asigurare = procent(b.cost_asigurare_pct);
  if (asigurare === null) lipsa.push('cost_asigurare_pct');
  if (lipsa.length) return res.status(400).json({ error: `Completează procentele (0–100): ${lipsa.join(', ')}.` });

  try {
    const [tva_decimal, { data: tx }] = await Promise.all([
      citesteTva(tara),
      supabaseAdmin.from('tax_configurations').select('moneda').eq('tara_cod', tara).maybeSingle(),
    ]);
    const calc = aplicaFormulaPret(
      { cost_materiale: costBaza },
      { pricing, cost_asigurare_pct: asigurare, tva_decimal, prag_minim_comanda: 0 },
      undefined,
      { cuPragMinim: false },
    );
    return res.status(200).json({ ok: true, tara_tva: tara, moneda: tx?.moneda || null, calc });
  } catch (e) {
    if (e instanceof EroareConfigPret) return res.status(409).json({ error: e.message });
    console.error('[exemplu-pret]', e);
    return res.status(500).json({ error: 'Nu am putut calcula exemplul.' });
  }
}

module.exports = requireAuth(['superadmin', 'admin'], handler);
