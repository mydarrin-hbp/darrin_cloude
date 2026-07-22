// /api/financiar/comision.js
// Ruta admin pentru eliberare manuală de escrow — logica reală (calcul split
// 3 părți + insert comisioane + escrow_eliberat) e acum în
// lib/elibereaza-escrow.js (Faza 5, 2026-07-22), reutilizată și de
// confirmarea automată/tacită a clientului. Comportamentul acestei rute
// rămâne identic celui dinainte de refactor — doar admin/superadmin,
// aceleași coduri de eroare.
//
// Body: { comanda_id }

const { requireAuth } = require('../../lib/auth-middleware');
const { elibereazaEscrow } = require('../../lib/elibereaza-escrow');

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { comanda_id } = req.body || {};
  if (!comanda_id) return res.status(400).json({ error: 'comanda_id este obligatoriu' });

  const rezultat = await elibereazaEscrow(comanda_id);
  if (!rezultat.ok) return res.status(rezultat.status || 500).json({ error: rezultat.error });

  return res.status(200).json({ ok: true, comision: rezultat.comision });
}

// Doar admin/superadmin sau un job intern de sistem ar trebui să apeleze
// eliberarea de fonduri — niciodată clientul sau partenerul direct.
module.exports = requireAuth(['admin', 'superadmin'], handler);
