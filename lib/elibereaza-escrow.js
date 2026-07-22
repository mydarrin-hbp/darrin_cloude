// lib/elibereaza-escrow.js
// Extras din api/financiar/comision.js (Faza 5, 2026-07-22) — logica reală
// era deja corectă, doar accesibilă exclusiv prin ruta admin. Acum e un
// modul comun, apelabil și de la confirmarea automată/tacită a clientului
// (api/public/confirma-livrare.js, api/cron/auto-confirma-comenzi.js), fără
// să fie nevoie de un JWT de admin pentru declanșările din sistem.
//
// IMPORTANT: acest fișier NU procesează bani reali — calculează și
// înregistrează sumele. Transferul efectiv de fonduri necesită integrarea
// cu un procesator real, un proiect separat de configurare cont comerciant.

const { supabaseAdmin } = require('./supabaseAdmin');

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

/**
 * @returns {Promise<{ok: true, comision: object} | {ok: false, error: string, status: number}>}
 */
async function elibereazaEscrow(comandaId) {
  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('*')
    .eq('id', comandaId)
    .single();
  if (comErr || !comanda) return { ok: false, error: 'Comanda nu există', status: 404 };

  if (comanda.status !== 'finalizata') {
    return { ok: false, error: 'Comisionul se calculează doar pentru comenzi finalizate', status: 400 };
  }
  if (comanda.escrow_eliberat) {
    return { ok: false, error: 'Escrow deja eliberat pentru această comandă', status: 400 };
  }

  const sumaAsigurare = Number(comanda.suma_asigurare) || 0;
  const valoareServiciu = Number(comanda.suma_totala_platita) - sumaAsigurare;
  const procentComision = Number(comanda.comision_pct) || 12.0;
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
    console.error('[elibereaza-escrow]', comisionErr);
    return { ok: false, error: 'Nu am putut înregistra comisionul', status: 500 };
  }

  await supabaseAdmin.from('comenzi').update({ escrow_eliberat: true }).eq('id', comanda.id);

  return { ok: true, comision: comisionRow };
}

module.exports = { elibereazaEscrow };
