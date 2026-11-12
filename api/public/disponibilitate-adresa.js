// /api/public/disponibilitate-adresa.js
// Pasul 11-C1 (3 nov. 2026): pagina de configurare (mydarrin-produs.html)
// întreabă aici, pentru adresa de prestare aleasă, dacă serviciul se poate
// comanda (parteneri activi în zonă) și cât costă transportul. Fără răspuns
// „disponibil”, butonul „Adaugă în coș” rămâne blocat; coșul
// (api/client/cos-multi.js) refă aceeași verificare la adăugare.
//
// POST { serviciu_id? | slug?, adresa: { strada, localitate, judet, tara_cod }, nivel_id?, cantitate? }
// -> 200 { ok:true, disponibil:true, serviciu, zona, pret_final, transport }
// -> 200 { ok:true, disponibil:false, motiv, mesaj:{ro,en}, zona }
// -> 400 / 404 în forma comună (lib/raspuns-eroare.js), cu câmpul greșit

const { checkRateLimit } = require('../../lib/rate-limit');
const { verificaDisponibilitate } = require('../../lib/disponibilitate-adresa');
const { trimiteEroare, camp } = require('../../lib/raspuns-eroare');
const v = require('../../lib/valideaza');

const SCHEMA = {
  slug: v.text({ max: 200, eticheta: ['Serviciu', 'Service'] }),
  serviciu_id: v.id({ eticheta: ['Serviciu', 'Service'] }),
  adresa: v.obiect({
    strada: v.text({ max: 200, eticheta: ['Strada', 'Street'] }),
    localitate: v.text({ max: 120, eticheta: ['Localitatea', 'City'] }),
    judet: v.text({ max: 120, eticheta: ['Județul', 'County'] }),
    tara_cod: v.text({ max: 8, eticheta: ['Țara', 'Country'] }),
  }, { eticheta: ['Adresa', 'Address'] }),
  nivel_id: v.id({ eticheta: ['Nivelul serviciului', 'Service level'] }),
  cantitate: v.numar({ min: 0, max: 100000, eticheta: ['Cantitate', 'Quantity'] }),
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const allowed = await checkRateLimit(req, { key: 'disponibilitate-adresa', limit: 60, windowSeconds: 60 });
  if (!allowed) return trimiteEroare(res, 429, 'PREA_MULTE_CERERI', 'Prea multe cereri. Încearcă din nou peste un minut.', 'Too many requests. Try again in a minute.');

  // Pasul 11-S1: tipuri, lungimi și câmpurile acceptate. Câmpurile obligatorii
  // ale adresei le verifică verificaDisponibilitate, cu mesajul pe câmp.
  if (!v.valideazaSauTrimite(req, res, SCHEMA)) return;

  const corp = req.body || {};
  try {
    const r = await verificaDisponibilitate({
      serviciu: { id: corp.serviciu_id, slug: corp.slug },
      adresa: corp.adresa,
      nivel_id: corp.nivel_id || null,
      cantitate: corp.cantitate,
    });
    if (!r.ok) return trimiteEroare(res, r.status, r.cod, r.mesaj.ro, r.mesaj.en, [camp(r.camp, r.mesaj.ro, r.mesaj.en)], { camp: r.camp });
    return res.status(200).json(r);
  } catch (err) {
    console.error('[public/disponibilitate-adresa]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut verifica disponibilitatea. Încearcă din nou.', 'We could not check availability. Please try again.');
  }
};
