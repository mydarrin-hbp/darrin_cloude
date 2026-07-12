// /api/comenzi/creeaza.js
// Adăugat în audit 2026-07-11 — până acum nu exista NICIUN endpoint care
// să insereze efectiv un rând în `comenzi`; mydarrin-checkout.html salva
// „comanda" doar în sessionStorage (saveGuestOrder), niciodată în Supabase.
//
// FIX (Etapa 4, audit 2026-07-12): endpointul crăpa la fiecare cerere reală
// — coloanele inserate (`numar_comanda`, `deviz_id`, `tip_serviciu`,
// `valoare_totala`) nu există în tabelul `comenzi` din baza live (verificat
// direct în information_schema, nu presupus din schema.sql). Coloanele
// reale: `nr_comanda`, `suma_totala_platita`; `deviz_id`/`tip_serviciu` nu
// au niciun echivalent (catalog_serviciu_id există, dar checkout.html nu
// trimite încă un ID real de serviciu din catalog — gap separat, neatins
// aici). Query-ul de numerotare folosea și el `created_at` — coloana reală
// e `creat_la`.
//
// Status inițial: 'in_cautare_partener', conform ciclului de viață
// documentat în schema.sql. Notă: motorul de matching care ar trebui să
// populeze `alocari_fifo` pe baza acestui status nu există încă (vezi
// auditul extins, secțiunea 3) — comanda e persistată real, dar alocarea
// automată către un partener rămâne un pas separat, neconstruit.
//
// Body: { valoare_totala, adresa, tara_cod?, regiune?, localitate? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { valoare_totala, adresa, tara_cod = null, regiune = null, localitate = null } = req.body || {};

  if (typeof valoare_totala !== 'number' || !(valoare_totala > 0)) {
    return res.status(400).json({ error: 'valoare_totala (numeric, pozitiv) este obligatorie' });
  }
  if (!adresa || typeof adresa !== 'string') {
    return res.status(400).json({ error: 'adresa este obligatorie' });
  }

  // FIX (Etapa 4, audit 2026-07-12): "prima țară activă este România" —
  // verificare server-side, reală, nu doar bannerul din UI (ocolibil de
  // oricine trimite direct un POST). Blocăm doar dacă tara_cod e cunoscută
  // și explicit inactivă — nu blocăm cereri fără tara_cod (compatibil cu
  // orice apelant mai vechi care încă nu o trimite).
  if (tara_cod) {
    const { data: config } = await supabaseAdmin
      .from('tax_configurations')
      .select('checkout_activ')
      .eq('tara_cod', String(tara_cod).toUpperCase())
      .maybeSingle();
    if (!config || !config.checkout_activ) {
      return res.status(403).json({
        error: 'Darrin inca nu este disponibil in zona ta. Imediat ce suntem live, te vom anunta cu email. Multumim pentru intelegere.',
        code: 'ZONA_INDISPONIBILA',
      });
    }
  }

  try {
    const year = new Date().getFullYear();
    const { count } = await supabaseAdmin
      .from('comenzi')
      .select('id', { count: 'exact', head: true })
      .gte('creat_la', `${year}-01-01`);

    const nr_comanda = `DA-${year}-${String((count || 0) + 1).padStart(5, '0')}`;

    const { data, error } = await supabaseAdmin
      .from('comenzi')
      .insert({
        nr_comanda,
        client_id: user.id,
        status: 'in_cautare_partener',
        suma_totala_platita: valoare_totala,
        tara_cod: tara_cod ? String(tara_cod).toUpperCase() : null,
        regiune,
        localitate,
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
