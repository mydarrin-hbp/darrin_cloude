// lib/permisiuni-seo.js
// Cine administrează secțiunea „SEO — Titluri & Descrieri” și campaniile
// social media (pasul 11-S, 23 oct. 2026). Același tipar ca
// lib/permisiuni-investitori.js: doar din profiles.roles și admin_permissions
// (citite cu service role); fail-closed — orice eroare la citire → fără drept.
//   - citire:  superadmin, sau admin cu rând în admin_permissions pe `seo`;
//   - scriere: superadmin, sau admin cu rând pe `seo` ȘI poate_scrie = true.
//
// Folosit de api/admin/seo.js și api/admin/seo-campanii.js.

const { supabaseAdmin } = require('./supabaseAdmin');
const { trimiteEroare } = require('./raspuns-eroare');

const SECTIUNE = 'seo';

// Nivelul de acces: null (fără drept), 'citire' sau 'scriere'.
async function nivelSeo(user) {
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

function refuzaFaraDrept(res) {
  return trimiteEroare(res, 403, 'FARA_DREPT', 'Nu ai drept pe secțiunea SEO.', 'You do not have rights on the SEO section.');
}
function refuzaFaraScriere(res) {
  return trimiteEroare(res, 403, 'FARA_DREPT_SCRIERE',
    'Ai acces doar de citire pe secțiunea SEO. Dreptul de scriere îl acordă superadminul.',
    'You have read-only access to the SEO section. Write access is granted by the superadmin.');
}

module.exports = { SECTIUNE, nivelSeo, refuzaFaraDrept, refuzaFaraScriere };
