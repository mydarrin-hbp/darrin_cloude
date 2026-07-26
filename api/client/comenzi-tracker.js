// /api/client/comenzi-tracker.js
// G18 (26 Iulie 2026) — tracker real pentru client, în locul machetei din
// mydarrin-dashboard-client.html. Auditul a confirmat: timeline-ul din drawer
// (5 noduri) și lista "Comenzile mele" (4 comenzi demo, parteneri reali
// numiți explicit — contrazice chiar politica de confidențialitate a
// platformei) erau 100% text static, identic pentru orice cont logat, fără
// niciun fetch către `comenzi`.
//
// Stare reală disponibilă (CHECK constraint comenzi_status_check):
// in_cautare_partener -> acceptata -> in_executie -> finalizata ->
// confirmata_client (sau anulata oricând). NU există "% progres execuție"
// sau "dovezi foto" în schemă — machetate în UI fără sursă reală; noul
// tracker arată doar stările reale, nu le inventează pe cele lipsă.
//
// Identitatea partenerului NU se expune aici (parteneri operează sub
// pseudonim, per politica documentată) — doar dacă un rol e alocat sau nu.
//
// GET -> { ok, comenzi:[{ id, nr_comanda, status, suma_totala_platita,
//   moneda, creat_la, finalizat_la, confirmat_la, escrow_eliberat,
//   partener_alocat, token_confirmare (doar dacă status='finalizata',
//   necesar clientului pentru a confirma prin api/public/confirma-livrare) }] }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { data: comenzi, error } = await supabaseAdmin
    .from('comenzi')
    .select('id, nr_comanda, status, suma_totala_platita, moneda, creat_la, finalizat_la, confirmat_la, escrow_eliberat, garantie_cod, token_confirmare, partener_id')
    .eq('client_id', user.id)
    .order('creat_la', { ascending: false });
  if (error) {
    console.error('[client/comenzi-tracker]', error);
    return res.status(500).json({ error: 'Nu am putut încărca comenzile' });
  }

  const ids = (comenzi || []).map((c) => c.id);
  let alocariManopera = new Set();
  if (ids.length) {
    const { data: subc } = await supabaseAdmin
      .from('comanda_subcontractori')
      .select('comanda_id, actor_id')
      .in('comanda_id', ids)
      .eq('rol_tip', 'manopera')
      .not('actor_id', 'is', null);
    alocariManopera = new Set((subc || []).map((s) => s.comanda_id));
  }

  const rezultat = (comenzi || []).map((c) => ({
    id: c.id,
    nr_comanda: c.nr_comanda,
    status: c.status,
    suma_totala_platita: c.suma_totala_platita,
    moneda: c.moneda,
    creat_la: c.creat_la,
    finalizat_la: c.finalizat_la,
    confirmat_la: c.confirmat_la,
    escrow_eliberat: c.escrow_eliberat,
    garantie_cod: c.garantie_cod,
    partener_alocat: !!c.partener_id || alocariManopera.has(c.id),
    // token-ul se expune doar cât timp comanda chiar poate fi confirmată —
    // reduce fereastra în care ar putea fi refolosit degeaba
    token_confirmare: c.status === 'finalizata' ? c.token_confirmare : null,
  }));

  return res.status(200).json({ ok: true, comenzi: rezultat });
}

module.exports = requireAuth([], handler);
