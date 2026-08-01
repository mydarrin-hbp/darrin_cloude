// /api/admin/facturi-parteneri.js
// Administrare facturi emise de parteneri către platformă (audit Secțiunea
// 41/42, 31 Iulie 2026). Plata rămâne manuală, prin transfer bancar real —
// niciun API de plăți automate nu există (Secțiunea 40) — acest endpoint
// doar ÎNREGISTREAZĂ că un transfer real a fost făcut, nu îl execută.
//
// GET  ?status=emisa           → listă facturi (opțional filtrată)
// POST { id, action:'confirma_plata' } → marchează plătită prin transfer bancar

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    let query = supabaseAdmin.from('facturi_parteneri').select('*').order('creat_la', { ascending: false });
    if (req.query.status) query = query.eq('status', req.query.status);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const idParteneri = [...new Set((data || []).map((f) => f.partener_id))];
    let emailIdx = {};
    if (idParteneri.length) {
      const { data: profiluri } = await supabaseAdmin.from('profiles').select('id, email').in('id', idParteneri);
      (profiluri || []).forEach((p) => { emailIdx[p.id] = p.email; });
    }
    const facturi = (data || []).map((f) => ({ ...f, partener_email: emailIdx[f.partener_id] || null }));

    return res.status(200).json({ ok: true, facturi });
  }

  if (req.method === 'POST') {
    const { id, action } = req.body || {};
    if (!id || action !== 'confirma_plata') {
      return res.status(400).json({ error: 'id și action="confirma_plata" sunt obligatorii' });
    }

    const { data: factura, error: selErr } = await supabaseAdmin
      .from('facturi_parteneri')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (selErr) return res.status(500).json({ error: selErr.message });
    if (!factura) return res.status(404).json({ error: 'Factura nu există' });
    if (factura.status === 'platita') return res.status(409).json({ error: 'Factura e deja marcată ca plătită' });

    const { data, error } = await supabaseAdmin
      .from('facturi_parteneri')
      .update({ status: 'platita', metoda_plata: 'transfer_bancar', platita_la: new Date().toISOString(), platita_de: admin.id })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await inregistreazaAudit({ admin, req, actiune: 'confirmare_plata_factura_partener', entitate: 'facturi_parteneri', entitate_id: id });
    return res.status(200).json({ ok: true, factura: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
