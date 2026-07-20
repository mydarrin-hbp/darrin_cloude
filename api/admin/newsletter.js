// /api/admin/newsletter.js
// Administrare abonați Newsletter din backoffice.
// GET  ?status=activ   → listă abonați (opțional filtrată după status)
// POST { id, status }  → actualizează statusul unui abonat (activ|dezabonat)

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

const STATUSURI_VALIDE = ['activ', 'dezabonat'];

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    let query = supabaseAdmin.from('newsletter_subscribers').select('*').order('created_at', { ascending: false }).limit(500);
    if (req.query.status) query = query.eq('status', req.query.status);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, abonati: data });
  }

  if (req.method === 'POST') {
    const { id, status } = req.body || {};
    if (!id || !STATUSURI_VALIDE.includes(status)) {
      return res.status(400).json({ error: `id și status (${STATUSURI_VALIDE.join('|')}) sunt obligatorii` });
    }
    const { data, error } = await supabaseAdmin
      .from('newsletter_subscribers')
      .update({ status, dezabonat_la: status === 'dezabonat' ? new Date().toISOString() : null })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await inregistreazaAudit({ admin, req, actiune: 'actualizare_status_abonat_newsletter', entitate: 'newsletter_subscribers', entitate_id: id, detalii: { status } });
    return res.status(200).json({ ok: true, abonat: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
