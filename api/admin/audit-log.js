// /api/admin/audit-log.js
// Etapa 4 (audit 2026-07-12) — citire a jurnalului real de audit, pentru
// panoul "Audit Log" din mydarrin-superadmin.html (care afișa până acum
// 10 evenimente hardcodate). Doar admin/superadmin.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

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
    return res.status(500).json({ error: 'Nu am putut încărca jurnalul de audit' });
  }
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
