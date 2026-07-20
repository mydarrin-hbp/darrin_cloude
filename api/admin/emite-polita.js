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

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { comanda_id, numar_polita, polita_url } = req.body || {};
  if (!comanda_id || !numar_polita || !polita_url) {
    return res.status(400).json({ error: 'comanda_id, numar_polita și polita_url sunt obligatorii' });
  }

  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('id, suma_asigurare, numar_polita')
    .eq('id', comanda_id)
    .maybeSingle();
  if (comErr || !comanda) return res.status(404).json({ error: 'Comanda nu există' });

  if (!(Number(comanda.suma_asigurare) > 0)) {
    return res.status(400).json({ error: 'Comanda nu are o primă de asigurare selectată' });
  }
  if (comanda.numar_polita) {
    return res.status(400).json({ error: `Comanda are deja înregistrată polița ${comanda.numar_polita}` });
  }

  const { data, error } = await supabaseAdmin
    .from('comenzi')
    .update({ numar_polita, polita_url })
    .eq('id', comanda_id)
    .select('id, numar_polita, polita_url')
    .single();
  if (error) {
    console.error('[admin/emite-polita]', error);
    return res.status(500).json({ error: 'Nu am putut înregistra polița' });
  }

  return res.status(200).json({ ok: true, comanda: data });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
