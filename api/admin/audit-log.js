// /api/admin/audit-log.js
// Etapa 4 (audit 2026-07-12) — citire a jurnalului real de audit, pentru
// panoul "Audit Log" din mydarrin-superadmin.html (care afișa până acum
// 10 evenimente hardcodate). Doar admin/superadmin.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

async function handler(req, res) {
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  try {
    const { data, error } = await supabaseAdmin
      .from('audit_log')
      .select('*')
      .order('creat_la', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return res.status(200).json({ ok: true, evenimente: data || [] });
  } catch (err) {
    console.error('[audit-log]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca jurnalul de audit', 'We could not load the audit log.');
  }
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
