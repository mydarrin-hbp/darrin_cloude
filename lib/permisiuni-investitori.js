// lib/permisiuni-investitori.js
// Cine administrează secțiunea Investitori din back-office (pașii 11-L și
// 11-J): superadminul și adminii cu rând în admin_permissions pe secțiunea
// `investitori`. Folosit de api/admin/investitori-kyc.js,
// api/admin/runde-finantare.js și api/admin/investitori-dashboard.js.
// Doar din profiles.roles (citit cu service role). Fail-closed.

const { supabaseAdmin } = require('./supabaseAdmin');

const SECTIUNE = 'investitori';

async function arePermisiuneInvestitori(user) {
  if (!user || !user.id) return false;
  const { data: profil, error } = await supabaseAdmin.from('profiles').select('roles').eq('id', user.id).maybeSingle();
  if (error) return false;
  const roles = Array.isArray(profil && profil.roles) ? profil.roles : [];
  if (roles.includes('superadmin')) return true;
  if (!roles.includes('admin')) return false;
  const { data: perm, error: permErr } = await supabaseAdmin
    .from('admin_permissions').select('admin_id').eq('admin_id', user.id).eq('sectiune', SECTIUNE).limit(1);
  return !permErr && Array.isArray(perm) && perm.length > 0;
}

module.exports = { SECTIUNE, arePermisiuneInvestitori };
