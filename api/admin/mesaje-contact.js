// /api/admin/mesaje-contact.js
// Adăugat 2026-07-12 — administrare mesaje de contact din backoffice.
// GET  ?status=nou   → listă mesaje (opțional filtrate după status)
// POST { id, status } → actualizează statusul unui mesaj (nou|citit|raspuns)

const { requireAuth } = require('../../lib/auth-middleware');
const { formaComuna, trimiteEroare, trimiteEroareInterna } = require('../../lib/raspuns-eroare');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

const STATUSURI_VALIDE = ['nou', 'citit', 'raspuns'];

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    let query = supabaseAdmin.from('mesaje_contact').select('*').order('created_at', { ascending: false }).limit(200);
    if (req.query.status) query = query.eq('status', req.query.status);
    const { data, error } = await query;
    if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
    return res.status(200).json({ ok: true, mesaje: data });
  }

  if (req.method === 'POST') {
    const { id, status } = req.body || {};
    if (!id || !STATUSURI_VALIDE.includes(status)) {
      return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', `id și status (${STATUSURI_VALIDE.join('|')}) sunt obligatorii`, `id and status (${STATUSURI_VALIDE.join('|')}) are required.`);
    }
    const { data, error } = await supabaseAdmin
      .from('mesaje_contact')
      .update({ status })
      .eq('id', id)
      .select()
      .single();
    if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
    await inregistreazaAudit({ admin, req, actiune: 'actualizare_status_mesaj', entitate: 'mesaje_contact', entitate_id: id, detalii: { status } });
    return res.status(200).json({ ok: true, mesaj: data });
  }

  return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
