// /api/partener/login-config.js
// Autentificarea propriu-zisă (email+parolă, 2FA) rămâne pe supabase-js
// nativ, în app-ul mobil (signInWithPassword + verifyOtp pentru 2FA).
// Acest endpoint rulează DUPĂ autentificare și returnează ecranele/
// permisiunile corecte pentru rolul curent, ca appul mobil să se
// reconfigureze dinamic (o singură interfață de logare, N dashboard-uri).

const { requireAuth } = require('../../lib/auth-middleware');

const CONFIG_PER_ROL = {
  partener_curier: {
    ecrane: ['cursa_curenta', 'harta_live', 'istoric_livrari', 'financiar', 'documente'],
    permisiuni: { accepta_curse: true, genereaza_cmr: true },
  },
  partener_servicii: {
    ecrane: ['solicitari_active', 'calendar', 'financiar', 'documente'],
    permisiuni: { accepta_interventii: true },
  },
  furnizor_materiale: {
    ecrane: ['catalog_produse', 'comenzi', 'stoc', 'financiar', 'documente'],
    permisiuni: { editeaza_catalog: true },
  },
  partener_asigurari: {
    ecrane: ['polite_active', 'daune', 'financiar', 'documente'],
    permisiuni: { emite_polita: true },
  },
};

async function handler(req, res, user) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const roles = user.user_metadata?.roles || [];
  const rolPartener = roles.find(r => CONFIG_PER_ROL[r]);

  if (!rolPartener) {
    return res.status(403).json({ error: 'Contul nu are niciun rol de partener activ' });
  }

  return res.status(200).json({
    ok: true,
    rol_activ: rolPartener,
    toate_rolurile_partener: roles.filter(r => CONFIG_PER_ROL[r]),
    config: CONFIG_PER_ROL[rolPartener],
  });
}

module.exports = requireAuth([], handler);
