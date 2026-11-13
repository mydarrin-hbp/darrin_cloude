// /api/partener/confirma-cod.js
// Faza 3 — partenerul introduce, la sosire, codul de verificare primit de
// client pe email (vezi lib/aloca-partener.js). Confirmarea marchează
// începutul efectiv al lucrării — status 'acceptata' -> 'in_executie'
// (valorile reale permise de constraint-ul comenzi_status_check, verificate
// live: in_cautare_partener, acceptata, in_executie, finalizata,
// confirmata_client, anulata).
//
// Body: { comanda_id, cod }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const v = require('../../lib/valideaza');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  comanda_id: v.id({ eticheta: ['Comanda', 'Order'] }),
  cod: v.text({ max: 20, eticheta: ['Cod', 'Code'] }),
};

async function handler(req, res, user) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora' })) return;
  const { comanda_id, cod } = req.body || {};
  if (!comanda_id || !cod) {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'comanda_id și cod sunt obligatorii', 'comanda_id and cod are required.');
  }

  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('id, partener_id, status, cod_verificare, cod_verificare_confirmat_la')
    .eq('id', comanda_id)
    .single();
  if (comErr || !comanda) return trimiteEroare(res, 404, 'COMANDA_NU_EXISTA', 'Comanda nu există', 'The order does not exist.');

  if (comanda.partener_id !== user.id) {
    return trimiteEroare(res, 403, 'COMANDA_NEALOCATA', 'Comanda nu îți este alocată', 'This order is not assigned to you.');
  }
  if (comanda.cod_verificare_confirmat_la) {
    return trimiteEroare(res, 409, 'DEJA_CONFIRMAT', 'Codul a fost deja confirmat pentru această comandă', 'The code has already been confirmed for this order.');
  }
  if (comanda.status !== 'acceptata') {
    return trimiteEroare(res, 409, 'STARE_GRESITA', `Comanda nu este în starea potrivită pentru confirmare (status curent: ${comanda.status})`, `The order is not in the right state for confirmation (current status: ${comanda.status}).`);
  }
  if (String(cod).trim() !== comanda.cod_verificare) {
    return trimiteEroare(res, 400, 'COD_INCORECT', 'Cod de verificare incorect', 'Incorrect verification code.', ['cod']);
  }

  const { data, error } = await supabaseAdmin
    .from('comenzi')
    .update({ cod_verificare_confirmat_la: new Date().toISOString(), status: 'in_executie' })
    .eq('id', comanda_id)
    .select()
    .single();
  if (error) {
    console.error('[partener/confirma-cod]', error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut confirma codul', 'We could not confirm the code. Please try again.');
  }

  return res.status(200).json({ ok: true, comanda: data });
}

module.exports = requireAuth([], handler);
