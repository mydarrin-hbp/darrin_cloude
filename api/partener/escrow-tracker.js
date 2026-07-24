// /api/partener/escrow-tracker.js
// Auditul UI (24 Iulie 2026) a confirmat că dashboard-ul partenerului arăta
// sume/statusuri de escrow complet hardcodate ("Escrow activ: 610 Lei"),
// zero conectare la `comanda_subcontractori`/`comisioane`. Acest endpoint
// returnează alocările REALE ale partenerului logat, ca să înlocuiască acea
// machetă.
//
// GET → { ok, total_activ, total_eliberat, moneda, alocari: [
//   { comanda_id, nr_comanda, rol_tip, suma, status_comanda,
//     escrow_eliberat, escrow_eliberat_la, creat_la, finalizat_la }
// ] }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];

async function handler(req, res, user) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data: alocari, error } = await supabaseAdmin
    .from('comanda_subcontractori')
    .select('id, comanda_id, rol_tip, suma_neta_alocata, status, creat_la')
    .eq('actor_id', user.id)
    .order('creat_la', { ascending: false });
  if (error) {
    console.error('[escrow-tracker] comanda_subcontractori', error);
    return res.status(500).json({ error: 'Nu am putut încărca alocările.' });
  }
  if (!alocari.length) {
    return res.status(200).json({ ok: true, total_activ: 0, total_eliberat: 0, moneda: 'Lei', alocari: [] });
  }

  const idsComenzi = [...new Set(alocari.map((a) => a.comanda_id))];
  const { data: comenzi } = await supabaseAdmin
    .from('comenzi')
    .select('id, nr_comanda, status, moneda, escrow_eliberat, creat_la, finalizat_la')
    .in('id', idsComenzi);
  const comenziIdx = {};
  (comenzi || []).forEach((c) => { comenziIdx[c.id] = c; });

  const { data: comisioaneRows } = await supabaseAdmin
    .from('comisioane')
    .select('comanda_id, escrow_eliberat_la')
    .in('comanda_id', idsComenzi);
  const escrowLaIdx = {};
  (comisioaneRows || []).forEach((c) => { escrowLaIdx[c.comanda_id] = c.escrow_eliberat_la; });

  let totalActiv = 0;
  let totalEliberat = 0;
  let moneda = 'Lei';

  const rezultat = alocari.map((a) => {
    const c = comenziIdx[a.comanda_id] || {};
    const eliberatLa = escrowLaIdx[a.comanda_id] || null;
    const eliberat = !!c.escrow_eliberat || !!eliberatLa;
    if (c.moneda) moneda = c.moneda;
    if (eliberat) totalEliberat += Number(a.suma_neta_alocata) || 0;
    else totalActiv += Number(a.suma_neta_alocata) || 0;

    return {
      comanda_id: a.comanda_id,
      nr_comanda: c.nr_comanda || null,
      rol_tip: a.rol_tip,
      suma: Number(a.suma_neta_alocata) || 0,
      status_comanda: c.status || null,
      escrow_eliberat: eliberat,
      escrow_eliberat_la: eliberatLa,
      creat_la: a.creat_la,
      finalizat_la: c.finalizat_la || null,
    };
  });

  return res.status(200).json({
    ok: true,
    total_activ: Math.round(totalActiv * 100) / 100,
    total_eliberat: Math.round(totalEliberat * 100) / 100,
    moneda,
    alocari: rezultat,
  });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);
