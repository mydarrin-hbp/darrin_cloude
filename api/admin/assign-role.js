// /api/admin/assign-role.js
// Permite unui superadmin să adauge un rol unui utilizator existent
// (ex. promovare client -> partener_curier).
// Body: { user_id, role }
//
// Securitate (14 oct. 2026): rolurile se scriu în profiles.roles (singura
// sursă pentru decizii de acces), cu oglindă în app_metadata, pe care doar
// serverul o poate scrie. user_metadata nu mai primește roluri.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { requireAuth } = require('../../lib/auth-middleware');
const { trimiteEroare, trimiteEroareInterna } = require('../../lib/raspuns-eroare');

const ROLURI_VALIDE = [
  'client', 'partener_servicii', 'partener_materiale', 'partener_inchirieri',
  'partener_curier', 'partener_asigurari', 'investor', 'admin', 'superadmin',
];

async function handler(req, res) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const { user_id, role } = req.body || {};
  if (!user_id || !ROLURI_VALIDE.includes(role)) {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'user_id și role (valid) sunt obligatorii', 'user_id and a valid role are required.');
  }

  try {
    const { data: profil, error: getErr } = await supabaseAdmin
      .from('profiles').select('role, roles').eq('id', user_id).single();
    if (getErr) throw getErr;

    const rolesActuale = new Set(Array.isArray(profil?.roles) ? profil.roles : []);
    rolesActuale.add(role);
    const roles = Array.from(rolesActuale);

    const update = { roles };
    if (!profil?.role) update.role = role;
    const { error: updErr } = await supabaseAdmin.from('profiles').update(update).eq('id', user_id);
    if (updErr) throw updErr;

    // Oglindă informativă; accesul se decide doar din profiles.roles.
    const { data: existing } = await supabaseAdmin.auth.admin.getUserById(user_id);
    const { error: metaErr } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
      app_metadata: { ...(existing?.user?.app_metadata || {}), roles },
    });
    if (metaErr) console.error('[assign-role] app_metadata', metaErr);

    return res.status(200).json({ ok: true, user_id, roles });
  } catch (err) {
    console.error('[assign-role]', err);
    return trimiteEroareInterna(res, 500, 'EROARE_SERVER', 'Eroare la alocarea rolului', 'Error while assigning the role.', err);
  }
}

module.exports = requireAuth(['superadmin'], handler);
