// /api/public/trimite-bun-venit-client.js
// Pasul 11-R3c (decizia LM, 3 nov. 2026): endpoint-ul public primea doar
// emailul și trimitea bun venitul imediat după signUp, înainte de codul de 6
// cifre (contul încă neconfirmat). Emailul de bun venit pleacă acum din
// api/cont/bun-venit.js, cu sesiune, doar după confirmarea emailului.
//
// Endpoint-ul rămâne doar ca să răspundă clar unui client vechi (pagină din
// cache): 410 Gone, în forma comună. Nu trimite niciun email.

const { trimiteEroare } = require('../../lib/raspuns-eroare');

module.exports = async function handler(req, res) {
  return trimiteEroare(res, 410, 'BUN_VENIT_MUTAT',
    'Emailul de bun venit se trimite acum după confirmarea contului cu codul de 6 cifre.',
    'The welcome email is now sent after the account is confirmed with the 6-digit code.');
};
