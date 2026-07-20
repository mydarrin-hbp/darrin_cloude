// /api/financiar/comision.js
// Se apelează la finalizarea unei comenzi: calculează comisionul platformei
// (din comanda.comision_pct, implicit 12% dacă lipsește) și eliberează escrow-ul.
//
// IMPORTANT: acest endpoint NU procesează bani reali — calculează și
// înregistrează sumele. Transferul efectiv de fonduri necesită integrarea
// cu un procesator real (Stripe Connect / EuPlătesc / Netopia escrow API),
// care e un proiect separat de configurare cont comerciant, nu doar cod.
//
// FIX (T8, 2026-07-20): split real pe 3 părți când comanda are o primă de
// asigurare (comanda.suma_asigurare > 0) — Partener/Platformă rămân pe
// valoarea serviciului ca înainte; din prima de asigurare, un procent
// configurabil (backoffice_config: sectiune=asigurari,
// cheie=comision_intermediere_pct) rămâne la platformă, restul e marcat
// pentru asigurator (comisioane.suma_asigurator). `asigurator_partener_id`
// rămâne null la insert — niciun partener real de tip `asigurari` nu
// există încă în DB; se asignează manual din backoffice, nu presupus aici.
//
// Body: { comanda_id }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const COMISION_INTERMEDIERE_FALLBACK_PCT = 15;

async function comisionIntermedierePct() {
  const { data } = await supabaseAdmin
    .from('backoffice_config')
    .select('valoare')
    .eq('sectiune', 'asigurari')
    .eq('cheie', 'comision_intermediere_pct')
    .maybeSingle();
  const pct = Number(data?.valoare);
  return Number.isFinite(pct) ? pct : COMISION_INTERMEDIERE_FALLBACK_PCT;
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { comanda_id } = req.body || {};
  if (!comanda_id) return res.status(400).json({ error: 'comanda_id este obligatoriu' });

  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('*')
    .eq('id', comanda_id)
    .single();
  if (comErr || !comanda) return res.status(404).json({ error: 'Comanda nu există' });

  if (comanda.status !== 'finalizata') {
    return res.status(400).json({ error: 'Comisionul se calculează doar pentru comenzi finalizate' });
  }
  // FIX (T8, 2026-07-20): coloana reală e `escrow_eliberat` (boolean) — codul
  // anterior verifica `escrow_status` (text), o coloană inexistentă în DB;
  // endpoint-ul ar fi eșuat la orice apel real, netestat vreodată live.
  if (comanda.escrow_eliberat) {
    return res.status(400).json({ error: 'Escrow deja eliberat pentru această comandă' });
  }

  // Comisionul de serviciu se calculează doar pe partea de serviciu, nu pe
  // toată suma — prima de asigurare (dacă există) are propriul split, mai jos.
  const sumaAsigurare = Number(comanda.suma_asigurare) || 0;
  const valoareServiciu = Number(comanda.suma_totala_platita) - sumaAsigurare;
  const procentComision = Number(comanda.comision_pct) || 12.0; // comision_pct există deja pe comandă, ignorat până acum
  const comisionPlatforma = Math.round(valoareServiciu * (procentComision / 100) * 100) / 100;
  const sumaPartener = Math.round((valoareServiciu - comisionPlatforma) * 100) / 100;

  let sumaAsigurator = 0;
  if (sumaAsigurare > 0) {
    const pctIntermediere = await comisionIntermedierePct();
    sumaAsigurator = Math.round(sumaAsigurare * (1 - pctIntermediere / 100) * 100) / 100;
  }

  const { data: comisionRow, error: comisionErr } = await supabaseAdmin
    .from('comisioane')
    .insert({
      comanda_id: comanda.id,
      valoare_totala: comanda.suma_totala_platita,
      comision_platforma: comisionPlatforma,
      suma_partener: sumaPartener,
      suma_asigurator: sumaAsigurator,
      tara_cod: comanda.tara_cod,
      moneda: comanda.moneda,
    })
    .select()
    .single();
  if (comisionErr) {
    console.error('[financiar/comision]', comisionErr);
    return res.status(500).json({ error: 'Nu am putut înregistra comisionul' });
  }

  await supabaseAdmin.from('comenzi').update({ escrow_eliberat: true }).eq('id', comanda.id);

  return res.status(200).json({ ok: true, comision: comisionRow });
}

// Doar admin/superadmin sau un job intern de sistem ar trebui să apeleze
// eliberarea de fonduri — niciodată clientul sau partenerul direct.
module.exports = requireAuth(['admin', 'superadmin'], handler);
