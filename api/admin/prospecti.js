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
const { formaComuna, trimiteEroare, trimiteEroareInterna } = require('../../lib/raspuns-eroare');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

const STATUSURI_VALIDE = ['nou', 'contactat', 'inscris', 'refuzat'];

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    let query = supabaseAdmin.from('parteneri_prospecti').select('*').order('created_at', { ascending: false }).limit(500);
    if (req.query.status) query = query.eq('status', req.query.status);
    const { data, error } = await query;
    if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
    return res.status(200).json({ ok: true, prospecti: data });
  }

  if (req.method === 'POST') {
    const { action } = req.body || {};

    if (action === 'adauga') {
      const { nume_firma, email, tara, tip_partener, nota } = req.body || {};
      if (!nume_firma || !email || !email.includes('@')) {
        return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'nume_firma și email (valid) sunt obligatorii', 'nume_firma and a valid email are required.');
      }
      const { data, error } = await supabaseAdmin
        .from('parteneri_prospecti')
        .insert({ nume_firma, email, tara: tara || null, tip_partener: tip_partener || null, nota: nota || null, adaugat_de: admin.id })
        .select()
        .single();
      if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
      await inregistreazaAudit({ admin, req, actiune: 'adaugare_prospect', entitate: 'parteneri_prospecti', entitate_id: data.id, detalii: { nume_firma, email, tara } });
      return res.status(200).json({ ok: true, prospect: data });
    }

    if (action === 'status') {
      const { id, status } = req.body || {};
      if (!id || !STATUSURI_VALIDE.includes(status)) {
        return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', `id și status (${STATUSURI_VALIDE.join('|')}) sunt obligatorii`, `id and status (${STATUSURI_VALIDE.join('|')}) are required.`);
      }
      const { data, error } = await supabaseAdmin
        .from('parteneri_prospecti')
        .update({ status })
        .eq('id', id)
        .select()
        .single();
      if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
      await inregistreazaAudit({ admin, req, actiune: 'actualizare_status_prospect', entitate: 'parteneri_prospecti', entitate_id: id, detalii: { status } });
      return res.status(200).json({ ok: true, prospect: data });
    }

    return trimiteEroare(res, 400, 'ACTIUNE_NECUNOSCUTA', "action trebuie să fie 'adauga' sau 'status'", 'action must be \'adauga\' or \'status\'.', ['action']);
  }

  return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
