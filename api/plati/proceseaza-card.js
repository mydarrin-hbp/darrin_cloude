// /api/plati/proceseaza-card.js
// Exemplu concret de folosire a "ușii" (lib/integrare-gate.js) pentru
// categoria 'procesatori_carduri' — cerută explicit ca exemplu de referință
// pentru orice altă integrare externă opțională (asigurări, curieri,
// contabilitate etc., aceeași poartă, altă categorie).
//
// Azi (2026-07-23): integrari_furnizori are 0 rânduri pentru orice
// categorie — niciun procesator de carduri real nu e configurat. Acest
// endpoint NU simulează o plată reușită și NU aruncă o eroare brută —
// răspunde curat cu INTEGRARE_IN_ASTEPTARE (503), din poartă. Când un admin
// adaugă un rând activ în integrari_furnizori pentru 'procesatori_carduri'
// (din panoul „Platforme & Integrări", deja construit), poarta se
// deschide — dar apelul REAL către procesator (charge/payment intent) tot
// trebuie scris atunci, aici mai jos e doar un TODO explicit, nu o
// simulare.
//
// Body: { comanda_id }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { verificaIntegrare } = require('../../lib/integrare-gate');

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { comanda_id } = req.body || {};
  if (!comanda_id) return res.status(400).json({ error: 'comanda_id este obligatoriu' });

  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('id, client_id, tara_cod, suma_totala_platita, moneda')
    .eq('id', comanda_id)
    .maybeSingle();
  if (comErr) {
    console.error('[plati/proceseaza-card]', comErr);
    return res.status(500).json({ error: 'Eroare la căutarea comenzii' });
  }
  if (!comanda) return res.status(404).json({ error: 'Comanda nu există' });
  if (comanda.client_id !== user.id) return res.status(403).json({ error: 'Nu ai acces la această comandă' });

  const furnizor = await verificaIntegrare(res, 'procesatori_carduri', { tara_cod: comanda.tara_cod });
  if (!furnizor) return; // răspunsul 503 „integrare în așteptare" a fost deja trimis de poartă

  // TODO (când furnizor.status devine 'activ' cu date reale): apel real
  // către procesator — create payment intent / charge, folosind
  // furnizor.api_endpoint și cheia din furnizor.api_key_criptat (decriptată
  // server-side, niciodată expusă către client). Nescris încă — poarta de
  // mai sus doar permite să se ajungă până aici, nu simulează plata.
  return res.status(501).json({
    error: 'Furnizor de plăți configurat ca activ, dar apelul real către procesator nu e încă implementat',
    code: 'PROCESATOR_NEIMPLEMENTAT',
  });
}

module.exports = requireAuth([], handler);
