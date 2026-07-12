// /api/partener/login-config.js
// Autentificarea propriu-zisă (email+parolă, 2FA) rămâne pe supabase-js
// nativ, în app-ul mobil (signInWithPassword + verifyOtp pentru 2FA).
// Acest endpoint rulează DUPĂ autentificare și returnează ecranele/
// permisiunile corecte pentru rolul curent, ca appul mobil să se
// reconfigureze dinamic (o singură interfață de logare, N dashboard-uri).
//
// FIX (audit 2026-07-12):
//   - Citea doar user.user_metadata.roles (array) — dar partner-register.js
//     setează la invitare doar `role` (singular) în metadate, niciodată
//     `roles` (array). Rezultat: toți cei 5 parteneri înregistrați prin
//     wizard-ul public "Devino Partener" primeau 403 la primul login,
//     indiferent de tip. Acum citește profiles.roles (sursa autoritativă,
//     populată de handle_new_user() din schema.sql), cu fallback pe
//     user_metadata.role / .roles pentru rezistență la desincronizări.
//   - CONFIG_PER_ROL avea cheia 'furnizor_materiale' (valoarea din
//     TYPE_TO_ENUM, nu rolul real 'partener_materiale' din TYPE_TO_ROLE)
//     și nu avea deloc 'partener_inchirieri' — ambele tipuri de partener
//     nu găseau niciodată o configurație validă.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const CONFIG_PER_ROL = {
  partener_curier: {
    ecrane: ['cursa_curenta', 'harta_live', 'istoric_livrari', 'financiar', 'documente'],
    permisiuni: { accepta_curse: true, genereaza_cmr: true },
  },
  partener_servicii: {
    ecrane: ['solicitari_active', 'calendar', 'financiar', 'documente'],
    permisiuni: { accepta_interventii: true },
  },
  partener_materiale: {
    ecrane: ['catalog_produse', 'comenzi', 'stoc', 'financiar', 'documente'],
    permisiuni: { editeaza_catalog: true },
  },
  partener_inchirieri: {
    ecrane: ['catalog_echipamente', 'comenzi', 'disponibilitate', 'financiar', 'documente'],
    permisiuni: { editeaza_catalog: true, gestioneaza_disponibilitate: true },
  },
  partener_asigurari: {
    ecrane: ['polite_active', 'daune', 'financiar', 'documente'],
    permisiuni: { emite_polita: true },
  },
};

async function handler(req, res, user) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const roles = new Set();

  try {
    const { data } = await supabaseAdmin.from('profiles').select('roles').eq('id', user.id).single();
    if (Array.isArray(data?.roles)) data.roles.forEach(r => roles.add(r));
  } catch (e) {
    console.error('[login-config] eroare la citirea profiles.roles:', e);
  }

  const metaRole = user.user_metadata?.role;
  const metaRoles = user.user_metadata?.roles;
  if (metaRole) roles.add(metaRole);
  if (Array.isArray(metaRoles)) metaRoles.forEach(r => roles.add(r));

  const rolPartener = [...roles].find(r => CONFIG_PER_ROL[r]);

  if (!rolPartener) {
    return res.status(403).json({ error: 'Contul nu are niciun rol de partener activ' });
  }

  return res.status(200).json({
    ok: true,
    rol_activ: rolPartener,
    toate_rolurile_partener: [...roles].filter(r => CONFIG_PER_ROL[r]),
    config: CONFIG_PER_ROL[rolPartener],
  });
}

module.exports = requireAuth([], handler);
