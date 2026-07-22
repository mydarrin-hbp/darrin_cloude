// /api/partener/confirma-cod.js
// Faza 3 — partenerul introduce, la sosire, codul de verificare primit de
// client pe email (vezi lib/aloca-partener.js). Confirmarea marchează
// începutul efectiv al lucrării — status 'acceptata' -> 'in_desfasurare'.
//
// Body: { comanda_id, cod }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { comanda_id, cod } = req.body || {};
  if (!comanda_id || !cod) {
    return res.status(400).json({ error: 'comanda_id și cod sunt obligatorii' });
  }

  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('id, partener_id, status, cod_verificare, cod_verificare_confirmat_la')
    .eq('id', comanda_id)
    .single();
  if (comErr || !comanda) return res.status(404).json({ error: 'Comanda nu există' });

  if (comanda.partener_id !== user.id) {
    return res.status(403).json({ error: 'Comanda nu îți este alocată' });
  }
  if (comanda.cod_verificare_confirmat_la) {
    return res.status(409).json({ error: 'Codul a fost deja confirmat pentru această comandă' });
  }
  if (comanda.status !== 'acceptata') {
    return res.status(409).json({ error: `Comanda nu este în starea potrivită pentru confirmare (status curent: ${comanda.status})` });
  }
  if (String(cod).trim() !== comanda.cod_verificare) {
    return res.status(400).json({ error: 'Cod de verificare incorect' });
  }

  const { data, error } = await supabaseAdmin
    .from('comenzi')
    .update({ cod_verificare_confirmat_la: new Date().toISOString(), status: 'in_desfasurare' })
    .eq('id', comanda_id)
    .select()
    .single();
  if (error) {
    console.error('[partener/confirma-cod]', error);
    return res.status(500).json({ error: 'Nu am putut confirma codul' });
  }

  return res.status(200).json({ ok: true, comanda: data });
}

module.exports = requireAuth([], handler);
