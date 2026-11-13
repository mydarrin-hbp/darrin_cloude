// /api/public/calculeaza-pret-nivel.js
// "Preț per cantitate reală comandată" (22 August 2026) — endpoint public,
// fără autentificare, care calculează prețul REAL, server-side, pentru un
// nivel de catalog, la o cantitate dată. Alimentează afișarea prețului în
// mydarrin-produs.html, în coș și în checkout.
//
// Pasul 11-C2 (3 nov. 2026): calculul e cel din lib/pret-serviciu.js, același
// care pune prețul pe comandă (api/comenzi/creeaza.js) — rețeta, dacă nivelul
// are una, altfel prețul nivelului din catalog_preturi. Fără niciuna:
// disponibil:false, motiv 'fara_pret' („Prețul se stabilește prin deviz”).
//
// Body: { nivel_id (uuid, obligatoriu), cantitate (implicit 1), tara_cod
//         (implicit 'RO'), regiune?, addon_materiale? ([{id,qty}]) }
// -> { ok:true, disponibil:true, pret_final, prag_minim_comanda, subtotal_variabil,
//      defalcare, include, addon_materiale, sursa, cantitate, tara_cod, moneda }
// -> { ok:true, disponibil:false, motiv:'fara_pret'|'nivel_inactiv'|'addon_fara_pret'|'nivel_necunoscut', mesaj:{ro,en} }

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');
const { calculeazaPretServiciu } = require('../../lib/pret-serviciu');

const CANTITATE_MAX = 100000;

const v = require('../../lib/valideaza');
const { trimiteEroare } = require('../../lib/raspuns-eroare');
const SCHEMA = {
  nivel_id: v.id({ obligatoriu: true, eticheta: ['Nivelul serviciului', 'Service level'] }),
  cantitate: v.numar({ min: 0, max: CANTITATE_MAX, eticheta: ['Cantitate', 'Quantity'] }),
  tara_cod: v.text({ max: 8, eticheta: ['Țară', 'Country'] }),
  regiune: v.text({ max: 80, eticheta: ['Regiune', 'Region'] }),
  addon_materiale: v.lista(v.ITEM_PRODUS, { max: 50, eticheta: ['Materiale și închirieri', 'Materials and rentals'] }),
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const allowed = await checkRateLimit(req, { key: 'calculeaza-pret-nivel', limit: 60, windowSeconds: 60 });
  if (!allowed) return trimiteEroare(res, 429, 'PREA_MULTE_CERERI', 'Prea multe cereri. Încearcă din nou mai târziu.', 'Too many requests. Please try again later.');

  // Pasul 11-S1: tipuri, lungimi și câmpurile acceptate.
  if (!v.valideazaSauTrimite(req, res, SCHEMA)) return;

  const { nivel_id, cantitate = 1, tara_cod = 'RO', regiune = null, addon_materiale = [] } = req.body || {};

  if (!nivel_id || typeof nivel_id !== 'string') {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'nivel_id (uuid) este obligatoriu.', 'nivel_id (uuid) is required.', ['nivel_id']);
  }
  const cantitateNum = Number(cantitate);
  if (!Number.isFinite(cantitateNum) || cantitateNum <= 0 || cantitateNum > CANTITATE_MAX) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', `cantitate trebuie să fie un număr pozitiv, sub ${CANTITATE_MAX}.`, `cantitate must be a positive number below ${CANTITATE_MAX}.`, ['cantitate']);
  }
  const taraCod = String(tara_cod || 'RO').toUpperCase();

  try {
    const r = await calculeazaPretServiciu({
      nivelId: nivel_id, cantitate: cantitateNum, taraCod,
      regiune: typeof regiune === 'string' ? regiune.slice(0, 80) : null,
      addonMateriale: addon_materiale,
    });
    if (!r.ok) {
      return res.status(200).json({
        ok: true, disponibil: false, motiv: r.motiv, mesaj: r.mesaj.ro, mesaj_en: r.mesaj.en,
        ...(r.resurse_fara_pret ? { resurse_fara_pret: r.resurse_fara_pret } : {}),
      });
    }

    const { data: taraCfg } = await supabaseAdmin
      .from('tax_configurations').select('moneda').eq('tara_cod', taraCod).maybeSingle();

    return res.status(200).json({
      ok: true, disponibil: true,
      pret_final: r.calc.pret_final,
      prag_minim_comanda: r.calc.prag_minim_comanda,
      subtotal_variabil: r.calc.subtotal,
      defalcare: r.defalcare,
      // Ce include nivelul, doar pentru afișare (fără coeficienți interni).
      include: r.include,
      addon_materiale: r.addon.itemi,
      sursa: r.sursa,
      cantitate: cantitateNum, tara_cod: taraCod, moneda: taraCfg?.moneda || 'RON',
    });
  } catch (err) {
    console.error('[public/calculeaza-pret-nivel]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut calcula prețul.', 'We could not calculate the price. Please try again.');
  }
};
