// /api/admin/assign-role.js
// Permite unui superadmin să seteze/adauge un rol în user_metadata al unui
// utilizator existent (ex. promovare client -> partener_curier).
// Body: { user_id, role }

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { requireAuth } = require('../../lib/auth-middleware');

const ROLURI_VALIDE = [
  'client', 'partener_servicii', 'partener_materiale', 'partener_inchirieri',
  'partener_curier', 'partener_asigurari', 'investor', 'admin', 'superadmin',
];

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, role } = req.body || {};
  if (!user_id || !ROLURI_VALIDE.includes(role)) {
    return res.status(400).json({ error: 'user_id și role (valid) sunt obligatorii' });
  }

  try {
    const { data: existing, error: getErr } = await supabaseAdmin.auth.admin.getUserById(user_id);
    if (getErr) throw getErr;

    const rolesActuale = new Set(existing.user.user_metadata?.roles || []);
    rolesActuale.add(role);

    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
      user_metadata: { ...existing.user.user_metadata, roles: Array.from(rolesActuale) },
    });
    if (updErr) throw updErr;

    await supabaseAdmin.from('profiles').update({ roles: Array.from(rolesActuale) }).eq('id', user_id);

    return res.status(200).json({ ok: true, user_id, roles: Array.from(rolesActuale) });
  } catch (err) {
    console.error('[assign-role]', err);
    return res.status(500).json({ error: err.message || 'Eroare la alocarea rolului' });
  }
}

module.exports = requireAuth(['superadmin'], handler);
