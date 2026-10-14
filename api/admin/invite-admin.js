// /api/admin/invite-admin.js
// Doar un superadmin poate invita un admin secundar și îi poate seta
// permisiuni granulare pe secțiuni (aprobare PFA/CUI, comisioane, curieri, asigurări/escrow).
//
// Body: { email, permisiuni: { aprobare_pfa_cui: true, comisioane: false, curieri: true, asigurari_escrow: false } }

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { requireAuth } = require('../../lib/auth-middleware');

async function handler(req, res, superadmin) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, permisiuni } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email este obligatoriu' });
  }

  try {
    // 1. Invitație prin email (Supabase creează userul + trimite magic link de invitație)
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
    if (inviteErr) throw inviteErr;

    // 1b. Rolul de admin se scrie de server în profiles (singura sursă pentru
    // acces) și în app_metadata. Nu în user_metadata: îl poate scrie
    // utilizatorul, iar handle_new_user() nu mai acceptă de acolo roluri
    // de admin (securitate, 14 oct. 2026).
    const { error: rolErr } = await supabaseAdmin
      .from('profiles').update({ role: 'admin', roles: ['admin'] }).eq('id', invited.user.id);
    if (rolErr) throw rolErr;
    const { error: metaErr } = await supabaseAdmin.auth.admin.updateUserById(invited.user.id, {
      app_metadata: { ...(invited.user.app_metadata || {}), role: 'admin', roles: ['admin'] },
    });
    if (metaErr) console.error('[invite-admin] app_metadata', metaErr);

    // 2. Salvează permisiunile granulare
    const sectiuni = Object.keys(permisiuni || {});
    if (sectiuni.length > 0) {
      const rows = sectiuni.map(sectiune => ({
        admin_id: invited.user.id,
        sectiune,
        poate_scrie: !!permisiuni[sectiune],
        acordat_de: superadmin.id,
      }));
      const { error: permErr } = await supabaseAdmin.from('admin_permissions').insert(rows);
      if (permErr) throw permErr;
    }

    return res.status(200).json({ ok: true, admin_id: invited.user.id, email });
  } catch (err) {
    console.error('[invite-admin]', err);
    return res.status(500).json({ error: err.message || 'Eroare la invitarea adminului' });
  }
}

module.exports = requireAuth(['superadmin'], handler);
