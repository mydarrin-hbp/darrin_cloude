// /api/client/cos.js
// Etapa 1 (26 august 2026): copia de pe server a configurării curente de
// checkout (cos_itemi, un singur rând pe client / vizitator).
//
// Pasul 11-C1 (3 nov. 2026): scos din folosire. Site-ul are un singur coș, pe
// server: /api/client/cos-multi (cos_multi_itemi). Nicio pagină nu mai scrie
// sau citește aici; o pagină veche, rămasă în cache, primește 410 și un mesaj
// clar. Tabelul cos_itemi rămâne neatins (fără migrare).

const { trimiteEroare } = require('../../lib/raspuns-eroare');

module.exports = async function handler(req, res) {
  return trimiteEroare(res, 410, 'COS_VECHI',
    'Coșul vechi nu mai este folosit. Reîncarcă pagina: produsele se adaugă acum în coșul din antet.',
    'The old basket is no longer used. Reload the page: products are now added to the basket in the header.');
};
