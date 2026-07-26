// /api/partener/sarcini.js
// G-nou (26 Iulie 2026) — "Sarcini LIVE" din mydarrin-dashboard-partener.html
// era 100% machetă: 4 task-card-uri demo, butoane Accept/Refuz/Finalizează/
// Problemă fără niciun fetch. Lanțul real de acțiuni EXISTA deja, complet
// funcțional, doar niciodată conectat la această listă:
//   alocari_fifo (ofertă) -> accept-comanda.js (acceptata) ->
//   confirma-cod.js (in_executie, cod cerut clientului la sosire) ->
//   upload-imagine.js (before/after) -> finalizeaza-comanda.js (finalizata,
//   token trimis clientului) -> confirmare-livrare.html (client confirmă).
//
// Acest endpoint e doar CITIREA — lista de sarcini pe cele 3 stadii reale.
// NU expune comenzi.cod_verificare partenerului: codul e cunoscut clientului
// și verifică fizic prezența partenerului la adresă — expunerea lui aici
// ar anula exact scopul verificării.
//
// GET -> { ok, primite:[...], active:[...], finalizate:[...] }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];

const CAMPURI_COMANDA = 'id, nr_comanda, status, suma_totala_platita, moneda, tara_cod, regiune, localitate, creat_la, finalizat_la';

async function handler(req, res, user) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data: oferte } = await supabaseAdmin
    .from('alocari_fifo')
    .select('comanda_id, notificat_la')
    .eq('partener_id', user.id)
    .eq('raspuns', 'in_asteptare');

  const idPrimite = (oferte || []).map((o) => o.comanda_id);
  let primite = [];
  if (idPrimite.length) {
    const { data } = await supabaseAdmin
      .from('comenzi')
      .select(CAMPURI_COMANDA)
      .in('id', idPrimite)
      .eq('status', 'in_cautare_partener');
    primite = data || [];
  }

  const { data: active } = await supabaseAdmin
    .from('comenzi')
    .select(CAMPURI_COMANDA)
    .eq('partener_id', user.id)
    .in('status', ['acceptata', 'in_executie'])
    .order('creat_la', { ascending: false });

  const { data: finalizate } = await supabaseAdmin
    .from('comenzi')
    .select(CAMPURI_COMANDA)
    .eq('partener_id', user.id)
    .in('status', ['finalizata', 'confirmata_client'])
    .order('finalizat_la', { ascending: false })
    .limit(20);

  const idActive = (active || []).map((c) => c.id);
  let poze = [];
  if (idActive.length) {
    const { data } = await supabaseAdmin
      .from('comenzi_imagini')
      .select('comanda_id, tip')
      .in('comanda_id', idActive)
      .eq('partener_id', user.id);
    poze = data || [];
  }
  const activeCuPoze = (active || []).map((c) => ({
    ...c,
    are_poza_before: poze.some((p) => p.comanda_id === c.id && p.tip === 'before'),
    are_poza_after: poze.some((p) => p.comanda_id === c.id && p.tip === 'after'),
  }));

  return res.status(200).json({ ok: true, primite, active: activeCuPoze, finalizate: finalizate || [] });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);
