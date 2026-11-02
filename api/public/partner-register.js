// /api/public/partner-register.js
// Pasul 11-R3 (decizia LM, 2 nov. 2026): înscrierea partenerului fără parolă
// (formularul public de 14 câmpuri din „Devino partener”, cu invitație pe
// email) nu mai există. Partenerul își face contul în fereastra comună de cont
// (cont-fereastra.js: parolă + codul de 6 cifre), cu rolul ales, apoi
// completează lista „Activează contul” din dashboard-ul lui; firma se salvează
// prin api/partener/wizard-companie.js, care adaugă și rolul.
//
// Endpoint-ul rămâne doar ca să răspundă clar unui client vechi: 410 Gone,
// cu mesajul în română și engleză (forma comună din lib/raspuns-eroare.js).
// Nu creează niciun cont și nu trimite niciun email.

const { trimiteEroare } = require('../../lib/raspuns-eroare');

const MESAJ = {
  ro: 'Înscrierea partenerilor s-a mutat: creează-ți contul cu „Creare cont” (alege tipul de partener), apoi completează datele firmei din dashboard-ul tău.',
  en: 'Partner sign-up has moved: create your account with “Create account” (choose the partner type), then fill in your company details from your dashboard.',
};

module.exports = async function handler(req, res) {
  return trimiteEroare(res, 410, 'INSCRIERE_MUTATA', MESAJ.ro, MESAJ.en);
};
