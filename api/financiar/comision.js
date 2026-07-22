// /api/financiar/comision.js
// Ruta admin pentru eliberare manuală de escrow — logica reală (split
// multi-partener + insert comanda_subcontractori/comisioane + escrow_eliberat)
// e în lib/elibereaza-escrow.js (rescrisă 2026-07-22), reutilizată și de
// confirmarea automată/tacită a clientului.
//
// FIX (audit 2026-07-22): handler-ul nu captă niciodată `user` din
// requireAuth (semnătura reală e (req,res,user), vezi lib/auth-middleware.js)
// — `eliberat_de` nu era setat NICIODATĂ, nici măcar la eliberarea manuală de
// admin, deși coloana există special pentru asta.
//
// Body: { comanda_id }

const { requireAuth } = require('../../lib/auth-middleware');
const { elibereazaEscrow } = require('../../lib/elibereaza-escrow');

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { comanda_id } = req.body || {};
  if (!comanda_id) return res.status(400).json({ error: 'comanda_id este obligatoriu' });

  const rezultat = await elibereazaEscrow(comanda_id, user.id);
  if (!rezultat.ok) return res.status(rezultat.status || 500).json({ error: rezultat.error });

  return res.status(200).json({ ok: true, comision: rezultat.comision, subcontractori: rezultat.subcontractori });
}

// Doar admin/superadmin sau un job intern de sistem ar trebui să apeleze
// eliberarea de fonduri — niciodată clientul sau partenerul direct.
module.exports = requireAuth(['admin', 'superadmin'], handler);
