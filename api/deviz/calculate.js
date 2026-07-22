// /api/deviz/calculate.js
// Rulează formula motorului de deviz (rețetă multi-partener) și salvează
// rezultatul în `devize`.
//
// FIX (2026-07-22): înlocuită formula veche, multiplicativă pe un singur
// "cost_brut" (MAX(cost_brut,VMC) × coeficienți zonă/urgență × comision),
// cu suma directă a componentelor de cost — fiecare componentă corespunde
// unui rol plătit separat la eliberarea escrow (vezi lib/elibereaza-escrow.js
// + tabela comanda_subcontractori, deja proiectată pentru exact acest model,
// dar orfană până acum). VMC și coeficienții de zonă/urgență din formula
// veche NU au echivalent în noua rețetă — eliminați, nu ascunși. Formula
// propriu-zisă e acum în lib/calculeaza-pret.js (sursă unică, folosită și
// de api/comenzi/creeaza.js, ca sumele înghețate pe comandă să provină din
// exact același calcul).
//
// FIX SECURITATE (păstrat din audit 2026-07-10): procentele de comision/
// marketing/mentenanță și TVA sunt constante SERVER-SIDE (citite din
// backoffice_config / tax_configurations), niciodată acceptate din req.body.
//
// Body: { serviciu_id, tara?, nivel?,
//         cost_baza_servicii?, cost_materiale?, cost_chirie_scule?,
//         cost_curier?, cost_asigurare?,
//         cost_brut? }  -- cost_brut e alias legacy pentru cost_baza_servicii,
//                          păstrat ca să nu rupă apelul existent din
//                          mydarrin-catalog.html (confirmaEstimareAI()), care
//                          nu produce încă o defalcare pe componente.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { calculeazaPret } = require('../../lib/calculeaza-pret');

function numarPozitiv(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function handler(req, res, user) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  // Refuză explicit orice câmp de preț trimis din client — server-side only.
  const CAMPURI_INTERZISE = [
    'comision_pct', 'cost_marketing_pct', 'cost_mentenanta_pct', 'tva',
    'comision_bricolaj_contractat_pct', 'comision_inchiriere_contractat_pct',
    'mydarrin_pct', 'zone_coef', 'urgency_coef',
  ];
  const campInterzisGasit = CAMPURI_INTERZISE.find((c) => c in body);
  if (campInterzisGasit) {
    return res.status(400).json({
      error: `Câmpul '${campInterzisGasit}' nu este acceptat din client. Parametrii de preț sunt calculați server-side.`,
    });
  }

  const { serviciu_id, tara = 'RO', nivel = null, cost_brut } = body;

  if (!serviciu_id || typeof serviciu_id !== 'string' || serviciu_id.length > 200) {
    return res.status(400).json({ error: 'serviciu_id (string, max 200 chars) este obligatoriu' });
  }
  if (!['RO', 'MD', 'DE', 'FR', 'BG'].includes(tara)) {
    return res.status(400).json({ error: 'tara invalid. Valori acceptate: RO, MD, DE, FR, BG' });
  }

  const costBazaServicii = numarPozitiv(body.cost_baza_servicii ?? cost_brut ?? 0);
  const costMateriale = numarPozitiv(body.cost_materiale);
  const costChirieScule = numarPozitiv(body.cost_chirie_scule);
  const costCurier = numarPozitiv(body.cost_curier);
  const costAsigurare = numarPozitiv(body.cost_asigurare);

  const subtotalCerut = costBazaServicii + costMateriale + costChirieScule + costCurier + costAsigurare;
  if (subtotalCerut <= 0) {
    return res.status(400).json({ error: 'Cel puțin o componentă de cost (servicii/materiale/scule/curier/asigurare) trebuie să fie pozitivă' });
  }
  if (subtotalCerut > 1_000_000) {
    return res.status(400).json({ error: 'Suma componentelor depășește limita acceptată (1.000.000)' });
  }

  const calc = await calculeazaPret({
    cost_baza_servicii: costBazaServicii,
    cost_materiale: costMateriale,
    cost_chirie_scule: costChirieScule,
    cost_curier: costCurier,
    cost_asigurare: costAsigurare,
    tara,
  });

  const { data, error } = await supabaseAdmin
    .from('devize')
    .insert({
      client_id: user.id,
      serviciu_id,
      nivel,
      input_json: {
        serviciu_id, tara,
        cost_baza_servicii: calc.cost_baza_servicii, cost_materiale: calc.cost_materiale,
        cost_chirie_scule: calc.cost_chirie_scule, cost_curier: calc.cost_curier, cost_asigurare: calc.cost_asigurare,
        cost_marketing: calc.cost_marketing, cost_mentenanta: calc.cost_mentenanta,
        comision_platforma: calc.comision_platforma, tva_pct: calc.tva_pct, tva_suma: calc.tva_suma,
      },
      cost_brut: calc.cost_baza_servicii, // păstrat pentru compatibilitate cu rândurile vechi
      cost_baza: calc.subtotal,
      pret_final: calc.pret_final,
      tara_cod: tara,
      moneda: { RO: 'RON', MD: 'MDL', DE: 'EUR', FR: 'EUR', BG: 'BGN' }[tara] ?? 'RON',
    })
    .select()
    .single();

  if (error) {
    console.error('[deviz/calculate]', error);
    return res.status(500).json({ error: 'Nu am putut salva devizul' });
  }

  return res.status(200).json({ ok: true, deviz: data, _debug: calc });
}

module.exports = requireAuth([], handler);
