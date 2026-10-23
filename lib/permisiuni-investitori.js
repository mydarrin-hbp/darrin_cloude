// lib/permisiuni-investitori.js
// Cine administrează secțiunea Investitori din back-office (pașii 11-L, 11-J
// și 11-N2). Doar din profiles.roles și admin_permissions (citite cu service
// role). Fail-closed: orice eroare la citire → fără drept.
//
// Pasul 11-N2 (22 oct. 2026; decizia LM): dreptul are două niveluri.
//   - citire:  superadmin, sau admin cu rând în admin_permissions pe
//              secțiunea `investitori` (lista rundelor, KPI-urile, cererile
//              KYC și documentele lor, subscrierile, previzualizarea calculului);
//   - scriere: superadmin, sau admin cu rând pe `investitori` ȘI
//              poate_scrie = true (creare / editare / deschidere / închidere
//              rundă, aprobare / respingere KYC, aprobare / respingere
//              subscriere, portofoliu).
// Înainte, rândul fără poate_scrie dădea și dreptul de scriere.
//
// Folosit de api/admin/runde-finantare.js, api/admin/investitori-kyc.js,
// api/admin/investitori-aprobare.js și api/admin/investitori-dashboard.js.

const { supabaseAdmin } = require('./supabaseAdmin');
const { trimiteEroare } = require('./raspuns-eroare');

const SECTIUNE = 'investitori';

// Nivelul de acces: null (fără drept), 'citire' sau 'scriere'.
async function nivelInvestitori(user) {
  if (!user || !user.id) return null;
  const { data: profil, error } = await supabaseAdmin.from('profiles').select('roles').eq('id', user.id).maybeSingle();
  if (error) return null;
  const roles = Array.isArray(profil && profil.roles) ? profil.roles : [];
  if (roles.includes('superadmin')) return 'scriere';
  if (!roles.includes('admin')) return null;
  const { data: perm, error: permErr } = await supabaseAdmin
    .from('admin_permissions').select('admin_id, poate_scrie').eq('admin_id', user.id).eq('sectiune', SECTIUNE).limit(1);
  if (permErr || !Array.isArray(perm) || !perm.length) return null;
  return perm[0].poate_scrie === true ? 'scriere' : 'citire';
}

async function arePermisiuneInvestitori(user, { scriere = false } = {}) {
  const nivel = await nivelInvestitori(user);
  return scriere ? nivel === 'scriere' : nivel != null;
}

// Refuzul comun (403, forma din lib/raspuns-eroare.js, RO + EN).
function refuzaFaraDrept(res) {
  return trimiteEroare(res, 403, 'FARA_DREPT', 'Nu ai drept pe secțiunea Investitori.', 'You do not have rights on the Investors section.');
}
function refuzaFaraScriere(res) {
  return trimiteEroare(res, 403, 'FARA_DREPT_SCRIERE',
    'Ai acces doar de citire pe secțiunea Investitori. Dreptul de scriere îl acordă superadminul.',
    'You have read-only access to the Investors section. Write access is granted by the superadmin.');
}

module.exports = { SECTIUNE, nivelInvestitori, arePermisiuneInvestitori, refuzaFaraDrept, refuzaFaraScriere };
