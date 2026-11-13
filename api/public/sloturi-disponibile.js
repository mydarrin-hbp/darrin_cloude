// /api/public/sloturi-disponibile.js
// G28 — sloturi de 2 ore real disponibile pentru o zonă + dată, folosit de
// calendarul din mydarrin-produs.html (înainte, toate sloturile erau mereu
// afișate ca disponibile, fără nicio verificare — vezi
// lib/calculeaza-sloturi-disponibile.js pentru mecanismul real).
//
// GET ?tara=RO&regiune=Bacău&data=2026-08-03
//
// Pasul 11-P3b: `regiune` se acceptă ca nume sau cod („Bacău”, „BC”,
// „Județul Bacău”) și se aduce la codul din geo_regiuni (lib/regiune.js);
// un județ nerecunoscut, pentru o țară cu regiuni → 400, camp 'regiune'.

const { calculeazaSloturiDisponibile } = require('../../lib/calculeaza-sloturi-disponibile');
const { rezolvaRegiune, MESAJ_REGIUNE } = require('../../lib/regiune');
const { trimiteEroare, camp } = require('../../lib/raspuns-eroare');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const { tara, regiune, data } = req.query || {};
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'data este obligatorie, format YYYY-MM-DD', 'data is required, in YYYY-MM-DD format.', ['data']);
  }

  try {
    const taraCod = tara ? String(tara).toUpperCase() : null;
    let regiuneCod = regiune || null;
    if (regiuneCod) {
      const r = await rezolvaRegiune(taraCod || 'RO', regiuneCod);
      if (r.areRegiuni && !r.regiune) {
        return trimiteEroare(res, 400, 'REGIUNE_NECUNOSCUTA', MESAJ_REGIUNE.ro, MESAJ_REGIUNE.en,
          [camp('regiune', MESAJ_REGIUNE.ro, MESAJ_REGIUNE.en)], { camp: 'regiune' });
      }
      if (r.regiune) regiuneCod = r.regiune.cod;
    }
    const rezultat = await calculeazaSloturiDisponibile({ taraCod, regiune: regiuneCod, data });
    res.setHeader('Cache-Control', 'public, max-age=120');
    return res.status(200).json({ ok: true, ...rezultat });
  } catch (err) {
    console.error('[sloturi-disponibile]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut calcula sloturile disponibile', 'We could not calculate the available slots.');
  }
};
