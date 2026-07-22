// lib/elibereaza-escrow.js
// REScris (2026-07-22) — arhitectura veche (single-partner: comision_platforma
// + suma_partener = restul, plus split separat pentru asigurare) a fost
// semnalată explicit ca incorectă: presupunea UN singur beneficiar pentru
// toată "valoarea serviciului", când de fapt o comandă poate implica până
// la 5 actori diferiți, plătiți separat din ACEEAȘI comandă — profesionist
// (manoperă), furnizor materiale, furnizor închiriere echipamente, curier
// de cartier, asigurător. Tabela `comanda_subcontractori` exista deja în
// schemă, cu exact aceste 5 valori pentru `rol_tip` — orfană până acum
// (nicio linie de cod nu o folosea).
//
// IMPORTANT: acest fișier NU procesează bani reali — calculează și
// înregistrează sumele (status 'alocat' în comanda_subcontractori: sumă
// determinată, transfer efectiv încă neexecutat). Transferul efectiv
// necesită integrarea cu un procesator real, un proiect separat de
// configurare cont comerciant.
//
// GAP CUNOSCUT, semnalat explicit (nu ascuns): pentru rolurile materiale/
// rental_echipament/curier/asigurare, `comenzi` nu are nicio coloană care să
// identifice CE partener anume a livrat materialul/scula/cursa/polița —
// singura potrivire de partener implementată (lib/aloca-partener.js) e
// pentru rolul 'manopera' (comenzi.partener_id). Rândurile din
// `comanda_subcontractori` pentru celelalte 4 roluri se inserează cu
// actor_id = null până când va exista un mecanism real de potrivire pentru
// acele roluri — sumele sunt corecte, dar cui-i revine efectiv nu e încă
// determinat de sistem.
//
// Cele DOUĂ căi de calcul de mai jos:
//  - itemizată (rețetă multi-partener): comanda are componentele de cost
//    înghețate la creare (api/comenzi/creeaza.js, cu lib/calculeaza-pret.js)
//    — sumele NU se recalculează aici, doar se citesc și se împart.
//  - legacy (fallback): comenzi vechi/apeluri care au trimis doar
//    `valoare_totala` — nicio componentă itemizată. Comportamentul e cel
//    dinainte de acest audit, DAR cu o corecție reală: modelul vechi calcula
//    `suma_asigurator = suma_asigurare × (1 − pct_intermediere/100)` și
//    PIERDEA restul (comisionul de intermediere reținut nu ajungea niciodată
//    în `comisioane.comision_platforma` sau oriunde altundeva) — o comandă
//    de 980 Lei cu 100 Lei asigurare la 15% intermediere "rătăcea" efectiv
//    15 Lei, niciunde înregistrați. Acum comisionul de intermediere reținut
//    e adăugat explicit la `comision_platforma`, ca identitatea sumelor să
//    țină și pentru comenzile vechi.

const { supabaseAdmin } = require('./supabaseAdmin');

const COMISION_INTERMEDIERE_ASIGURARE_FALLBACK_PCT = 15;

async function citesteConfigPricing() {
  const { data } = await supabaseAdmin
    .from('backoffice_config')
    .select('cheie, valoare')
    .eq('sectiune', 'pricing');
  const cfg = {};
  for (const row of data || []) {
    const val = Number(row.valoare);
    if (Number.isFinite(val)) cfg[row.cheie] = val;
  }
  return cfg;
}

async function comisionIntermediereAsigurarePct() {
  const { data } = await supabaseAdmin
    .from('backoffice_config')
    .select('valoare')
    .eq('sectiune', 'asigurari')
    .eq('cheie', 'comision_intermediere_pct')
    .maybeSingle();
  const pct = Number(data?.valoare);
  return Number.isFinite(pct) ? pct : COMISION_INTERMEDIERE_ASIGURARE_FALLBACK_PCT;
}

function rotund(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Calea itemizată — comanda are componentele de cost înghețate la creare.
 * Returnează rândurile de inserat în comanda_subcontractori + totalul reținut
 * de platformă (pentru rândul din `comisioane`).
 */
async function planificaSplitItemizat(comanda) {
  const cfg = await citesteConfigPricing();
  const pctBricolaj = Number.isFinite(cfg.comision_bricolaj_contractat_pct) ? cfg.comision_bricolaj_contractat_pct : 15;
  const pctInchirieri = Number.isFinite(cfg.comision_inchiriere_contractat_pct) ? cfg.comision_inchiriere_contractat_pct : 15;

  const manopera = Number(comanda.suma_manopera) || 0;
  const materiale = Number(comanda.suma_materiale) || 0;
  const chirieScule = Number(comanda.suma_chirie_scule) || 0;
  const curier = Number(comanda.suma_transport) || 0;
  const asigurare = Number(comanda.suma_asigurare) || 0;

  const comisionRetinutBricolaj = rotund(materiale * (pctBricolaj / 100));
  const comisionRetinutInchirieri = rotund(chirieScule * (pctInchirieri / 100));

  const randuri = [];
  if (manopera > 0) {
    randuri.push({ rol_tip: 'manopera', actor_id: comanda.partener_id || null, suma_neta_alocata: manopera });
  }
  if (materiale > 0) {
    randuri.push({ rol_tip: 'materiale', actor_id: null, suma_neta_alocata: rotund(materiale - comisionRetinutBricolaj) });
  }
  if (chirieScule > 0) {
    randuri.push({ rol_tip: 'rental_echipament', actor_id: null, suma_neta_alocata: rotund(chirieScule - comisionRetinutInchirieri) });
  }
  if (curier > 0) {
    randuri.push({ rol_tip: 'curier', actor_id: null, suma_neta_alocata: curier });
  }
  if (asigurare > 0) {
    randuri.push({ rol_tip: 'asigurare', actor_id: null, suma_neta_alocata: asigurare });
  }

  const comisionPlatforma = Number(comanda.suma_comision_platforma) || 0;
  const costMarketing = Number(comanda.suma_marketing) || 0;
  const costMentenanta = Number(comanda.suma_mentenanta) || 0;
  const tvaPlatforma = Number(comanda.tva_suma) || 0;

  const platformaRetine = {
    comision_platforma: comisionPlatforma,
    suma_marketing: costMarketing,
    suma_mentenanta: costMentenanta,
    comision_retinut_bricolaj: comisionRetinutBricolaj,
    comision_retinut_inchirieri: comisionRetinutInchirieri,
    tva_platforma: tvaPlatforma,
  };
  const totalRetinut = rotund(
    comisionPlatforma + costMarketing + costMentenanta + comisionRetinutBricolaj + comisionRetinutInchirieri + tvaPlatforma
  );

  return { randuri, platformaRetine, totalRetinut, sumaPartenerCompat: randuri.find(r => r.rol_tip === 'manopera')?.suma_neta_alocata || 0, sumaAsiguratorCompat: asigurare };
}

/**
 * Calea legacy — comandă fără componente itemizate, doar suma_totala_platita
 * (+ eventual suma_asigurare). Corectează scurgerea din modelul vechi
 * (comisionul de intermediere asigurare reținut era pierdut, niciodată
 * înregistrat).
 */
async function planificaSplitLegacy(comanda) {
  const sumaAsigurare = Number(comanda.suma_asigurare) || 0;
  const valoareServiciu = (Number(comanda.suma_totala_platita) || 0) - sumaAsigurare;
  const procentComision = Number(comanda.comision_pct) || 12.0;
  const comisionServiciu = rotund(valoareServiciu * (procentComision / 100));
  const sumaPartener = rotund(valoareServiciu - comisionServiciu);

  let sumaAsigurator = 0;
  let comisionRetinutAsigurare = 0;
  if (sumaAsigurare > 0) {
    const pctIntermediere = await comisionIntermediereAsigurarePct();
    comisionRetinutAsigurare = rotund(sumaAsigurare * (pctIntermediere / 100));
    sumaAsigurator = rotund(sumaAsigurare - comisionRetinutAsigurare);
  }

  const randuri = [];
  if (sumaPartener > 0) {
    randuri.push({ rol_tip: 'manopera', actor_id: comanda.partener_id || null, suma_neta_alocata: sumaPartener });
  }
  if (sumaAsigurator > 0) {
    randuri.push({ rol_tip: 'asigurare', actor_id: null, suma_neta_alocata: sumaAsigurator });
  }

  const comisionPlatformaTotal = rotund(comisionServiciu + comisionRetinutAsigurare);
  const platformaRetine = {
    comision_platforma: comisionPlatformaTotal,
    suma_marketing: 0,
    suma_mentenanta: 0,
    comision_retinut_bricolaj: 0,
    comision_retinut_inchirieri: 0,
    tva_platforma: 0,
  };

  return { randuri, platformaRetine, totalRetinut: comisionPlatformaTotal, sumaPartenerCompat: sumaPartener, sumaAsiguratorCompat: sumaAsigurator };
}

/**
 * @param {string} comandaId
 * @param {string|null} eliberatDe - comisioane.eliberat_de e UUID (FK către un admin real) —
 *   NULL înseamnă eliberare automată de sistem (cron tacit / confirmare client), un UUID real
 *   înseamnă eliberare manuală declanșată de acel admin din backoffice.
 * @returns {Promise<{ok: true, comision: object, subcontractori: object[]} | {ok: false, error: string, status: number}>}
 */
async function elibereazaEscrow(comandaId, eliberatDe = null) {
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

  const areComponenteItemizate = [comanda.suma_manopera, comanda.suma_materiale, comanda.suma_chirie_scule, comanda.suma_transport]
    .some((v) => (Number(v) || 0) > 0);

  const plan = areComponenteItemizate ? await planificaSplitItemizat(comanda) : await planificaSplitLegacy(comanda);

  if (!plan.randuri.length) {
    return { ok: false, error: 'Comanda nu are nicio componentă de cost pozitivă de alocat', status: 400 };
  }

  const acum = new Date().toISOString();

  const { data: subcontractori, error: subErr } = await supabaseAdmin
    .from('comanda_subcontractori')
    .insert(plan.randuri.map((r) => ({
      comanda_id: comanda.id,
      actor_id: r.actor_id,
      rol_tip: r.rol_tip,
      suma_neta_alocata: r.suma_neta_alocata,
      status: 'alocat',
      creat_la: acum,
    })))
    .select();
  if (subErr) {
    console.error('[elibereaza-escrow] comanda_subcontractori', subErr);
    return { ok: false, error: 'Nu am putut înregistra alocarea pe subcontractori', status: 500 };
  }

  const { data: comisionRow, error: comisionErr } = await supabaseAdmin
    .from('comisioane')
    .insert({
      comanda_id: comanda.id,
      valoare_totala: comanda.suma_totala_platita,
      comision_platforma: plan.platformaRetine.comision_platforma,
      suma_partener: plan.sumaPartenerCompat,
      suma_asigurator: plan.sumaAsiguratorCompat,
      suma_marketing: plan.platformaRetine.suma_marketing,
      suma_mentenanta: plan.platformaRetine.suma_mentenanta,
      comision_retinut_bricolaj: plan.platformaRetine.comision_retinut_bricolaj,
      comision_retinut_inchirieri: plan.platformaRetine.comision_retinut_inchirieri,
      tva_platforma: plan.platformaRetine.tva_platforma,
      tara_cod: comanda.tara_cod,
      moneda: comanda.moneda,
      // FIX (audit 2026-07-22): în versiunea veche aceste două coloane nu
      // erau setate NICIODATĂ, deși existau în schemă — rupea calculul de
      // dividende pentru investitori (nicio comisioane row nu avea vreodată
      // escrow_eliberat_la, deci orice raportare filtrată pe interval de timp
      // nu găsea nimic).
      escrow_eliberat_la: acum,
      eliberat_de: eliberatDe,
    })
    .select()
    .single();
  if (comisionErr) {
    console.error('[elibereaza-escrow] comisioane', comisionErr);
    return { ok: false, error: 'Nu am putut înregistra comisionul', status: 500 };
  }

  await supabaseAdmin.from('comenzi').update({ escrow_eliberat: true }).eq('id', comanda.id);

  return { ok: true, comision: comisionRow, subcontractori };
}

module.exports = { elibereazaEscrow, planificaSplitItemizat, planificaSplitLegacy };
