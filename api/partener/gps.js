// /api/partener/gps.js
// POST — partenerul activ trimite constant coordonate din fundal (recomandat:
// interval de 10-15s, cu throttling pe client pentru economie baterie).
// GET  — clientul citește poziția curierului alocat comenzii lui (fără să
//        aibă acces direct la tabelul gps_tracking, care e RLS-protejat doar
//        pentru partener; aici verificăm manual că userul e clientul comenzii).

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handlePost(req, res, user) {
  const { comanda_id, lat, lng, eta_minute } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat și lng (numerice) sunt obligatorii' });
  }

  const { error } = await supabaseAdmin
    .from('gps_tracking')
    .upsert(
      { partener_id: user.id, comanda_id, lat, lng, eta_minute, updated_at: new Date().toISOString() },
      { onConflict: 'partener_id' }
    );

  if (error) {
    console.error('[gps POST]', error);
    return res.status(500).json({ error: 'Nu am putut salva poziția' });
  }
  return res.status(200).json({ ok: true });
}

async function handleGet(req, res, user) {
  const { comanda_id } = req.query;
  if (!comanda_id) return res.status(400).json({ error: 'comanda_id este obligatoriu (query param)' });

  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('client_id, partener_id')
    .eq('id', comanda_id)
    .single();
  if (comErr || !comanda) return res.status(404).json({ error: 'Comanda nu există' });

  if (comanda.client_id !== user.id && comanda.partener_id !== user.id) {
    return res.status(403).json({ error: 'Nu ai acces la această comandă' });
  }

  const { data, error } = await supabaseAdmin
    .from('gps_tracking')
    .select('lat, lng, eta_minute, updated_at')
    .eq('comanda_id', comanda_id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Eroare la citirea poziției' });
  return res.status(200).json({ ok: true, pozitie: data || null });
}

async function handler(req, res, user) {
  if (req.method === 'POST') return handlePost(req, res, user);
  if (req.method === 'GET') return handleGet(req, res, user);
  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth([], handler);
