// /api/admin/entitati-juridice.js
// Configurare identitate juridică/fiscală a platformei, per țară (audit
// Secțiunea 41/42, 31 Iulie 2026, cerință explicită: "fiecare țară va avea
// o identitate juridică și fiscală înființată"). Folosit ca destinatar al
// facturilor emise de parteneri (api/partener/facturi.js).
//
// GET              → listă completă (toate țările configurate)
// POST { tara_cod, denumire, cui, nr_reg_com, adresa, iban, activa } → upsert

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('entitati_juridice_platforma')
      .select('*')
      .order('tara_cod', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, entitati: data });
  }

  if (req.method === 'POST') {
    const { tara_cod, denumire, cui, nr_reg_com, adresa, iban, activa } = req.body || {};
    if (!tara_cod) return res.status(400).json({ error: 'tara_cod este obligatoriu' });

    const { data, error } = await supabaseAdmin
      .from('entitati_juridice_platforma')
      .upsert({
        tara_cod,
        denumire: denumire || null,
        cui: cui || null,
        nr_reg_com: nr_reg_com || null,
        adresa: adresa || null,
        iban: iban || null,
        activa: !!activa,
        actualizat_la: new Date().toISOString(),
      }, { onConflict: 'tara_cod' })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await inregistreazaAudit({ admin, req, actiune: 'actualizare_entitate_juridica', entitate: 'entitati_juridice_platforma', entitate_id: tara_cod, detalii: { tara_cod, denumire, activa: !!activa } });
    return res.status(200).json({ ok: true, entitate: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
