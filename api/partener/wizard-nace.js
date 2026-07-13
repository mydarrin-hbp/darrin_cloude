// /api/partener/wizard-nace.js
// Wizard partener în 8 pași (Etapa 4, audit 2026-07-13) — Pasul 3: selector
// NACE (1 cod principal + maximum 15 secundare), validat contra
// nace_reference (taxonomia reală, nu o listă hardcodată în front-end).
//
// GET  → codurile NACE selectate curent de acest partener
// POST { principal: 'cod', secundare: ['cod', ...] }  (max 15 secundare)

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('partner_coduri_nace')
      .select('cod_nace, principal, nace_reference(denumire_ro)')
      .eq('partner_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, coduri: data || [] });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { principal, secundare = [] } = req.body || {};
  if (!principal || typeof principal !== 'string') {
    return res.status(400).json({ error: 'Un cod NACE principal este obligatoriu' });
  }
  if (!Array.isArray(secundare) || secundare.length > 15) {
    return res.status(400).json({ error: 'Maximum 15 coduri NACE secundare' });
  }
  const toateCodurile = [principal, ...secundare.filter((c) => c !== principal)];

  try {
    const { data: valide, error: refErr } = await supabaseAdmin
      .from('nace_reference')
      .select('cod')
      .in('cod', toateCodurile);
    if (refErr) throw refErr;
    const codValidSet = new Set((valide || []).map((r) => r.cod));
    const invalide = toateCodurile.filter((c) => !codValidSet.has(c));
    if (invalide.length) {
      return res.status(400).json({ error: `Coduri NACE necunoscute: ${invalide.join(', ')}` });
    }

    // Înlocuire completă — mai simplu și mai puțin predispus la erori decât
    // un diff parțial, iar wizardul trimite mereu setul complet curent.
    const { error: delErr } = await supabaseAdmin.from('partner_coduri_nace').delete().eq('partner_id', user.id);
    if (delErr) throw delErr;

    const randuri = toateCodurile.map((cod) => ({
      partner_id: user.id, cod_nace: cod, principal: cod === principal,
    }));
    const { error: insErr } = await supabaseAdmin.from('partner_coduri_nace').insert(randuri);
    if (insErr) throw insErr;

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[wizard-nace]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut salva codurile NACE' });
  }
}

module.exports = requireAuth([], handler);
