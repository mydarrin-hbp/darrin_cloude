// /api/comenzi/creeaza.js
// Adăugat în audit 2026-07-11 — până acum nu exista NICIUN endpoint care
// să insereze efectiv un rând în `comenzi`; mydarrin-checkout.html salva
// „comanda" doar în sessionStorage (saveGuestOrder), niciodată în Supabase.
//
// Status inițial: 'in_cautare_partener', conform ciclului de viață
// documentat în schema.sql. Notă: motorul de matching care ar trebui să
// populeze `alocari_fifo` pe baza acestui status nu există încă (vezi
// auditul extins, secțiunea 3) — comanda e persistată real, dar alocarea
// automată către un partener rămâne un pas separat, neconstruit.
//
// Body: { tip_serviciu, valoare_totala, adresa, zona?, urgent?, deviz_id? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tip_serviciu, valoare_totala, adresa, zona = null, urgent = false, deviz_id = null } = req.body || {};

  if (!tip_serviciu || typeof tip_serviciu !== 'string') {
    return res.status(400).json({ error: 'tip_serviciu este obligatoriu' });
  }
  if (typeof valoare_totala !== 'number' || !(valoare_totala > 0)) {
    return res.status(400).json({ error: 'valoare_totala (numeric, pozitiv) este obligatorie' });
  }
  if (!adresa || typeof adresa !== 'string') {
    return res.status(400).json({ error: 'adresa este obligatorie' });
  }

  try {
    const year = new Date().getFullYear();
    const { count } = await supabaseAdmin
      .from('comenzi')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', `${year}-01-01`);

    const numar_comanda = `DA-${year}-${String((count || 0) + 1).padStart(5, '0')}`;

    const { data, error } = await supabaseAdmin
      .from('comenzi')
      .insert({
        numar_comanda,
        client_id: user.id,
        deviz_id,
        tip_serviciu,
        status: 'in_cautare_partener',
        valoare_totala,
        // 'neinitiat', nu 'blocat': acest endpoint nu procesează plăți reale
        // (niciun procesator de plăți nu e integrat — vezi api/financiar/comision.js),
        // deci ar fi incorect să pretindem că suma e deja blocată în escrow.
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ ok: true, comanda: data });
  } catch (err) {
    console.error('[comenzi/creeaza]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut înregistra comanda' });
  }
}

module.exports = requireAuth([], handler);
