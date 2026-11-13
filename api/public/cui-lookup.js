// /api/public/cui-lookup.js
// T6: auto-completare date firmă din CUI (România, ANAF) / VAT ID (UE, VIES).
// Public — apelat atât din pagina publică (înainte de cont) cât și din
// wizard-ul real de partener (după autentificare), deci nu trece prin
// requireAuth. Nu ține nicio cheie API — ambele servicii sunt gratuite,
// publice, fără autentificare.
//
// POST { tara, cui }
//   tara==='RO'          → ANAF PlatitorTvaRest (CUI românesc)
//   tara in {DE,FR,BG}   → VIES (VAT ID, țări membre UE active pe platformă)
//   tara==='MD' / eșec   → { ok:false, manual:true } — front-end-ul cade pe
//                          completare manuală, cerută explicit de spec.

const { checkRateLimit } = require('../../lib/rate-limit');
const v = require('../../lib/valideaza');

const SCHEMA = {
  tara: v.text({ obligatoriu: true, max: 8, eticheta: ['Țară', 'Country'] }),
  cui: v.text({ obligatoriu: true, max: 40, eticheta: ['CUI / cod fiscal', 'Tax ID'] }),
};

const { curataCUI, cautaANAF, cautaVIES, TARI_VIES, MESAJE_ANAF } = require('../../lib/cauta-firma');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const allowed = await checkRateLimit(req, { key: 'cui-lookup', limit: 20, windowSeconds: 600 });
  if (!allowed) return trimiteEroare(res, 429, 'PREA_MULTE_CERERI', 'Prea multe cereri. Încearcă din nou mai târziu.', 'Too many requests. Please try again later.');

  // Pasul 11-S1: tipuri, lungimi și câmpurile acceptate.
  if (!v.valideazaSauTrimite(req, res, SCHEMA)) return;

  const { tara, cui } = req.body || {};
  if (!tara || typeof tara !== 'string') return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'tara este obligatorie', 'tara is required.', ['tara']);
  if (!cui || typeof cui !== 'string') return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'cui este obligatoriu', 'cui is required.', ['cui']);

  try {
    if (tara === 'RO') {
      const cuiNumeric = curataCUI(cui);
      if (!cuiNumeric) return trimiteEroare(res, 400, 'CUI_INVALID', 'CUI invalid', 'The CUI is not valid.', ['cui']);
      const rezultat = await cautaANAF(cuiNumeric);
      if (!rezultat) return res.status(200).json({ ok: false, manual: true, motiv: 'CUI negăsit în registrul ANAF' });
      // Pasul 11-P1: firma inactivă sau radiată nu se poate înscrie ca partener;
      // formularul arată motivul, iar partner-register / wizard-companie o refuză.
      if (rezultat.inactiva || rezultat.radiata) {
        const m = MESAJE_ANAF.firma_inactiva;
        return res.status(200).json({ ok: true, ...rezultat, cod: 'firma_inactiva', motiv: m.ro, motiv_en: m.en });
      }
      return res.status(200).json({ ok: true, ...rezultat });
    }

    if (TARI_VIES.has(tara)) {
      const vat = curataCUI(cui);
      if (!vat) return trimiteEroare(res, 400, 'CUI_INVALID', 'VAT ID invalid', 'Invalid VAT ID.', ['cui']);
      const rezultat = await cautaVIES(tara, vat);
      if (!rezultat) return res.status(200).json({ ok: false, manual: true, motiv: 'VAT ID negăsit/invalid în VIES' });
      return res.status(200).json({ ok: true, ...rezultat });
    }

    // MD (și orice altă țară fără sursă publică de verificare) — fallback manual explicit.
    return res.status(200).json({ ok: false, manual: true, motiv: 'Fără sursă publică de verificare pentru această țară' });
  } catch (err) {
    console.error('[cui-lookup]', tara, err.message);
    // ANAF spune adevărul: indisponibil (trece de la sine) sau eroare de
    // configurare (nu trece de la sine). În ambele cazuri formularul rămâne
    // completabil manual (manual:true), deci înscrierea nu se blochează.
    const mesaj = err.cod && MESAJE_ANAF[err.cod];
    if (mesaj) return res.status(200).json({ ok: false, manual: true, cod: err.cod, motiv: mesaj.ro, motiv_en: mesaj.en });
    // ANAF/VIES sunt cunoscute ca instabile intermitent — eșecul de rețea nu
    // e o eroare de request, e exact cazul de fallback manual cerut de spec.
    return res.status(200).json({ ok: false, manual: true, motiv: 'Serviciul de verificare este temporar indisponibil' });
  }
};
