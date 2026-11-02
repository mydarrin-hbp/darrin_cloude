// lib/destinatie-cont.js
// Destinația unui utilizator autentificat (pasul 10b, 16 oct. 2026), din
// profiles.roles și accese_temporare, cu harta unică din lib/destinatie-rol.js.
// Folosită de api/public/destinatie-post-login.js (după login) și de
// api/cont/profil.js (butonul de cont din antet), ca să dea același rezultat.
//
// Ordinea:
//   1. superadmin → /mydarrin-superadmin;
//   2. admin cu drept de catalog (admin_permissions, catalog_servicii) →
//      /mydarrin-admin-catalog;
//   3. rând ACTIV în accese_temporare (testeri) → ca înainte: NDA, apoi
//      ruta alocată; expirat → { tip: 'acces_expirat' };
//   4. un singur rol cu dashboard → dashboard-ul lui; mai multe → alegerea
//      rolului; admin fără catalog și fără alt rol → /mydarrin-superadmin;
//   5. niciun rol → null.
//
// Pasul 11-R2 (1 nov. 2026): contextCont citește și profiles.rol_solicitat
// (rolul ales la înscriere) și dacă clientul are cel puțin o comandă
// (comenzi.client_id). Clientul fără comenzi nu are dashboard; cine a ales un
// rol de partener pe care încă nu-l are ajunge la formularul firmei.
// Înainte de migrarea 2026-11-01_fereastra_cont.sql coloana rol_solicitat
// lipsește: se citește doar roles, ca înainte.

const { supabaseAdmin } = require('./supabaseAdmin');
const { alegeDestinatie } = require('./destinatie-rol');

async function areDreptCatalog(userId) {
  const { data, error } = await supabaseAdmin
    .from('admin_permissions')
    .select('sectiune_specializata')
    .eq('admin_id', userId).eq('sectiune', 'catalog_servicii').eq('poate_scrie', true)
    .maybeSingle();
  return !error && !!data && !!String(data.sectiune_specializata || '').trim();
}

function coloanaLipsa(error) {
  return !!error && (error.code === '42703' || error.code === 'PGRST204' || /rol_solicitat/.test(String(error.message || '')));
}

// true / false; null = nu s-a putut afla (clientul își păstrează dashboard-ul, ca înainte).
async function areComenzi(userId) {
  const { count, error } = await supabaseAdmin.from('comenzi').select('id', { count: 'exact', head: true }).eq('client_id', userId);
  if (error) { console.warn('[destinatie-cont] comenzi:', error.message || error); return null; }
  return (count || 0) > 0;
}

// { roles, rolSolicitat, areComenzi } pentru contul dat.
async function contextCont(user) {
  let { data: profile, error } = await supabaseAdmin.from('profiles').select('roles, rol_solicitat').eq('id', user.id).maybeSingle();
  if (coloanaLipsa(error)) ({ data: profile, error } = await supabaseAdmin.from('profiles').select('roles').eq('id', user.id).maybeSingle());
  if (error) throw error;
  const roles = Array.isArray(profile?.roles) ? profile.roles : [];
  const rolSolicitat = (profile && profile.rol_solicitat) || null;
  // Comenzile contează doar pentru client (dashboard-ul clientului).
  const comenzi = roles.includes('client') ? await areComenzi(user.id) : null;
  return { roles, rolSolicitat, areComenzi: comenzi };
}

async function destinatiePentru(user, context) {
  const ctx = context || await contextCont(user);
  const roles = ctx.roles;
  const optiuni = { rolSolicitat: ctx.rolSolicitat };
  if (ctx.areComenzi === false) optiuni.areComenzi = false;

  if (roles.includes('superadmin')) return alegeDestinatie(roles);
  if (roles.includes('admin') && await areDreptCatalog(user.id)) return alegeDestinatie(roles, { ...optiuni, adminCatalog: true });

  if (user.email) {
    const { data: acces } = await supabaseAdmin
      .from('accese_temporare')
      .select('ruta_url, expira_la, nda_acceptat')
      .eq('email', user.email.toLowerCase())
      .eq('activ', true)
      .maybeSingle();
    if (acces) {
      if (new Date(acces.expira_la) < new Date()) return { tip: 'acces_expirat', destinatie: null };
      // Acordul de confidențialitate (NDA) e obligatoriu ÎNAINTEA oricărei
      // pagini reale (vezi accepta-nda.js).
      if (!acces.nda_acceptat) return { tip: 'acces_temporar', destinatie: '/acord-confidentialitate' };
      // '*' = acces complet pe site-ul public; aterizăm pe homepage.
      return { tip: 'acces_temporar', destinatie: acces.ruta_url === '*' ? '/home' : acces.ruta_url };
    }
  }

  return alegeDestinatie(roles, optiuni);
}

module.exports = { destinatiePentru, contextCont, areDreptCatalog };
