// lib/roluri-cont.js
// Un cont, mai multe roluri (pasul 11-L, 17 oct. 2026). Un utilizator cu cont
// poate adăuga alt rol pe același cont: completează doar datele rolului nou,
// iar rolul se adaugă numai pe server, după ce cerințele lui sunt validate.
//
//   - rolurile de partener: lib/roluri-partener.js (asiguraRolInProfil),
//     apelat de api/public/partner-register.js (cont nou) și de
//     api/partener/wizard-companie.js (cont existent);
//   - rolul de investitor: asiguraRolInvestitor de mai jos, apelat de
//     api/investitori/kyc.js după confirmarea rutei de investitor (datele
//     personale, documentele, chestionarul, declarațiile și rezidența fiscală
//     sunt complete).
//
// Rolurile existente nu se șterg. profiles.role (rolul principal, vechi)
// nu se schimbă aici: accesul se decide doar din profiles.roles.

const { supabaseAdmin } = require('./supabaseAdmin');
const { adaugaRol } = require('./roluri-partener');

const ROL_INVESTITOR = 'investor';

/**
 * Adaugă rolul `investor` în profiles.roles (service role), lângă rolurile
 * existente. Apelantul răspunde de validarea cerințelor rolului.
 * @returns {Promise<{ adaugat: boolean, roles: string[] }>}
 */
async function asiguraRolInvestitor(userId) {
  if (!userId) throw new Error('userId lipsă');
  const { data: profil, error } = await supabaseAdmin
    .from('profiles').select('roles').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!profil) throw new Error('Profilul contului nu există.');

  const roles = adaugaRol(profil.roles, ROL_INVESTITOR);
  const adaugat = !(Array.isArray(profil.roles) && profil.roles.includes(ROL_INVESTITOR));
  if (adaugat) {
    const { error: updErr } = await supabaseAdmin.from('profiles').update({ roles }).eq('id', userId);
    if (updErr) throw updErr;
  }
  return { adaugat, roles };
}

module.exports = { ROL_INVESTITOR, asiguraRolInvestitor };
