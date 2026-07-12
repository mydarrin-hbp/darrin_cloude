// /api/admin/prospecti.js
// Adăugat 2026-07-12 — gestionare manuală a listei de prospecți pentru
// campania de recrutare parteneri. Punct de plecare "sigur": adaugă/listă/
// schimbă status — NU trimite niciun email. Trimiterea efectivă către
// prospecți e o etapă separată, care va fi construită abia după ce lista
// reală + aprobarea explicită a conținutului de campanie sunt gata.
//
// GET  ?status=nou            → listă prospecți (opțional filtrată)
// POST { action:'adauga', nume_firma, email, tara?, tip_partener?, nota? }
// POST { action:'status', id, status }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const STATUSURI_VALIDE = ['nou', 'contactat', 'inscris', 'refuzat'];

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    let query = supabaseAdmin.from('parteneri_prospecti').select('*').order('created_at', { ascending: false }).limit(500);
    if (req.query.status) query = query.eq('status', req.query.status);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, prospecti: data });
  }

  if (req.method === 'POST') {
    const { action } = req.body || {};

    if (action === 'adauga') {
      const { nume_firma, email, tara, tip_partener, nota } = req.body || {};
      if (!nume_firma || !email || !email.includes('@')) {
        return res.status(400).json({ error: 'nume_firma și email (valid) sunt obligatorii' });
      }
      const { data, error } = await supabaseAdmin
        .from('parteneri_prospecti')
        .insert({ nume_firma, email, tara: tara || null, tip_partener: tip_partener || null, nota: nota || null, adaugat_de: admin.id })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, prospect: data });
    }

    if (action === 'status') {
      const { id, status } = req.body || {};
      if (!id || !STATUSURI_VALIDE.includes(status)) {
        return res.status(400).json({ error: `id și status (${STATUSURI_VALIDE.join('|')}) sunt obligatorii` });
      }
      const { data, error } = await supabaseAdmin
        .from('parteneri_prospecti')
        .update({ status })
        .eq('id', id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, prospect: data });
    }

    return res.status(400).json({ error: "action trebuie să fie 'adauga' sau 'status'" });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
