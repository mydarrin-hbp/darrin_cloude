// /api/admin/emite-polita.js
// T8: înregistrarea reală a unei polițe de asigurare emise pentru o comandă.
//
// FIX (2026-07-20): "Darrin AI declanșează automat emiterea poliței prin
// API-ul asigurătorilor" din spec era teatru complet — niciun API de
// asigurator nu e integrat nicăieri (verificat prin audit), doar un
// alert() static și un setTimeout fals cu numărul "TEST-RO-ASF-0000".
// Până nu există un contract real cu un asigurator (nu există încă niciun
// partener de tip `asigurari` real în DB), emiterea e manuală — un
// admin/superadmin înregistrează aici polița pe care a aranjat-o în afara
// platformei. Funcția e izolată intenționat: când va exista un API real de
// integrat, doar acest handler se schimbă, restul fluxului (deviz,
// checkout, split) rămâne neschimbat.
//
// Body: { comanda_id, numar_polita, polita_url }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

async function handler(req, res) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const { comanda_id, numar_polita, polita_url } = req.body || {};
  if (!comanda_id || !numar_polita || !polita_url) {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'comanda_id, numar_polita și polita_url sunt obligatorii', 'comanda_id, numar_polita and polita_url are required.');
  }

  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('id, suma_asigurare, numar_polita')
    .eq('id', comanda_id)
    .maybeSingle();
  if (comErr || !comanda) return trimiteEroare(res, 404, 'COMANDA_NU_EXISTA', 'Comanda nu există', 'The order does not exist.');

  if (!(Number(comanda.suma_asigurare) > 0)) {
    return trimiteEroare(res, 400, 'FARA_PRIMA', 'Comanda nu are o primă de asigurare selectată', 'The order has no insurance premium selected.');
  }
  if (comanda.numar_polita) {
    return trimiteEroare(res, 400, 'POLITA_EXISTENTA', `Comanda are deja înregistrată polița ${comanda.numar_polita}`, `The order already has the policy ${comanda.numar_polita} recorded.`);
  }

  const { data, error } = await supabaseAdmin
    .from('comenzi')
    .update({ numar_polita, polita_url })
    .eq('id', comanda_id)
    .select('id, numar_polita, polita_url')
    .single();
  if (error) {
    console.error('[admin/emite-polita]', error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut înregistra polița', 'We could not record the policy.');
  }

  return res.status(200).json({ ok: true, comanda: data });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
