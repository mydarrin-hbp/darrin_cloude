// lib/roluri-partener.js
// Harta unică tip partener → rol (pasul 10b, 16 oct. 2026). O folosesc
// înregistrarea (api/public/partner-register.js), aprobarea
// (api/admin/verifica-document.js) și migrarea
// docs/migrations-propuse/2026-10-16_roluri_parteneri.sql (aceleași perechi,
// verificate de scripts/test-roluri-partener.js).
//
// Accesul se decide doar din profiles.roles (securitate, 14 oct. 2026), deci
// rolul de partener trebuie să ajungă acolo. Trigger-ul handle_new_user() nu-l
// vede la createUser (app_metadata e scrisă după inserare) și pune 'client'.

const { supabaseAdmin } = require('./supabaseAdmin');

// partners.partner_type → rolul din profiles.roles
const ROL_DUPA_TIP_PARTENER = Object.freeze({
  servicii_tehnice: 'partener_servicii',
  furnizor_materiale: 'partener_materiale',
  inchirieri_utilaje: 'partener_inchirieri',
  curier_utilitara: 'partener_curier',
  asigurari: 'partener_asigurari',
});

// Tipul scurt din formularul public (?tip=materiale) → partners.partner_type
const TIP_PARTENER_DUPA_FORMULAR = Object.freeze({
  servicii: 'servicii_tehnice',
  materiale: 'furnizor_materiale',
  inchirieri: 'inchirieri_utilaje',
  curier: 'curier_utilitara',
  asigurari: 'asigurari',
});

const ROLURI_PARTENER = Object.freeze(Object.values(ROL_DUPA_TIP_PARTENER));

function rolPentruTipPartener(partnerType) {
  return ROL_DUPA_TIP_PARTENER[partnerType] || null;
}

// Lista de roluri după adăugare: păstrează ordinea și rolurile existente.
function adaugaRol(roluri, rol) {
  const lista = Array.isArray(roluri) ? roluri.filter(Boolean) : [];
  return lista.includes(rol) ? lista : [...lista, rol];
}

/**
 * Adaugă rolul în profiles.roles (service role). Nu șterge alte roluri;
 * profiles.role devine rolul de partener doar dacă acum e gol sau 'client'.
 * Opțional, status → 'active' (cont creat de server, cu emailul confirmat).
 * @returns {Promise<{ adaugat: boolean, roles: string[] }>}
 */
async function asiguraRolInProfil(userId, rol, { email = null, activeaza = false } = {}) {
  if (!ROLURI_PARTENER.includes(rol)) throw new Error(`Rol de partener necunoscut: ${rol}`);
  const { data: profil, error } = await supabaseAdmin
    .from('profiles').select('role, roles, status').eq('id', userId).maybeSingle();
  if (error) throw error;

  const roles = adaugaRol(profil?.roles, rol);
  const adaugat = !(Array.isArray(profil?.roles) && profil.roles.includes(rol));
  const rolPrincipal = !profil?.role || profil.role === 'client' ? rol : profil.role;

  if (!profil) {
    // Trigger-ul n-a creat rândul (nu ar trebui): îl creăm noi.
    const { error: insErr } = await supabaseAdmin.from('profiles').insert({
      id: userId, email, role: rol, roles, ...(activeaza ? { status: 'active' } : {}),
    });
    if (insErr) throw insErr;
    return { adaugat: true, roles };
  }

  const schimbari = {};
  if (adaugat) schimbari.roles = roles;
  if (rolPrincipal !== profil.role) schimbari.role = rolPrincipal;
  if (activeaza && profil.status === 'pending_otp') schimbari.status = 'active';
  if (Object.keys(schimbari).length) {
    const { error: updErr } = await supabaseAdmin.from('profiles').update(schimbari).eq('id', userId);
    if (updErr) throw updErr;
  }
  return { adaugat, roles };
}

module.exports = {
  ROL_DUPA_TIP_PARTENER,
  TIP_PARTENER_DUPA_FORMULAR,
  ROLURI_PARTENER,
  rolPentruTipPartener,
  adaugaRol,
  asiguraRolInProfil,
};
