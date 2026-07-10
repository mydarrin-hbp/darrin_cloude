// /api/deviz/calculate.js
// Rulează formula motorului de deviz și salvează rezultatul în `devize`.
//
// FIX SECURITATE (audit 2026-07-10):
//   - mydarrin_pct, zone_coef, urgency_coef sunt constante SERVER-SIDE
//     nu mai sunt acceptate din req.body (manipulare de preț)
//   - tva se citește din tax_configurations (nu mai e hardcodat 0.19)
//   - Validare strictă pe toți parametrii acceptați din client
//
// Body acceptat: { serviciu_id, cost_brut, tara?, zona?, urgent? }
// Body REFUZAT:  orice mydarrin_pct / zone_coef / urgency_coef / tva din client

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

// ── Constante server-side (nu vin niciodată din client) ──────────
const VMC = { RO: 100, MD: 400, DE: 25, FR: 25, BG: 40 };
const INDIRECT   = 0.10;   // 10% costuri indirecte
const MARKETING  = 0.03;   // 3% marketing
const PLATFORMA  = 0.03;   // 3% platformă
const MYDARRIN_PCT = 0.10; // 10% comision My Darrin — NICIODATĂ din client

// Coeficienți de zonă server-side
const ZONE_COEF = {
  urban:   1.0,
  suburban: 1.1,
  rural:   1.2,
  remote:  1.5,
};

// Coeficienți urgență server-side
const URGENCY_COEF = {
  normal:  1.0,
  urgent:  1.3,
  express: 1.6,
};

// TVA fallback per țară (dacă DB-ul nu răspunde)
const TVA_FALLBACK = { RO: 0.21, MD: 0.20, DE: 0.19, FR: 0.20, BG: 0.20 };

async function handler(req, res, user) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Parametri acceptați din client ──────────────────────────────
  const {
    serviciu_id,
    cost_brut,
    tara   = 'RO',
    zona   = 'urban',
    urgent = false,
    tip_urgenta = 'normal',
  } = req.body || {};

  // ── Validare: refuză explicit orice multiplicator de preț din body ──
  const CAMPURI_INTERZISE = ['mydarrin_pct','zone_coef','urgency_coef','tva','INDIRECT','MARKETING','PLATFORMA'];
  const campInterzisGasit = CAMPURI_INTERZISE.find(c => c in (req.body || {}));
  if (campInterzisGasit) {
    return res.status(400).json({
      error: `Câmpul '${campInterzisGasit}' nu este acceptat din client. Parametrii de preț sunt calculați server-side.`
    });
  }

  // ── Validare parametri obligatorii ──────────────────────────────
  if (!serviciu_id || typeof serviciu_id !== 'string' || serviciu_id.length > 200) {
    return res.status(400).json({ error: 'serviciu_id (string, max 200 chars) este obligatoriu' });
  }
  if (typeof cost_brut !== 'number' || cost_brut < 0 || cost_brut > 1_000_000) {
    return res.status(400).json({ error: 'cost_brut (numeric, 0–1.000.000) este obligatoriu' });
  }
  if (!['RO','MD','DE','FR','BG'].includes(tara)) {
    return res.status(400).json({ error: `tara invalid. Valori acceptate: RO, MD, DE, FR, BG` });
  }
  if (!ZONE_COEF[zona]) {
    return res.status(400).json({ error: `zona invalid. Valori acceptate: ${Object.keys(ZONE_COEF).join(', ')}` });
  }

  // ── Citește TVA din tax_configurations (configurabil din Backoffice) ──
  let tvaDecimal = TVA_FALLBACK[tara] ?? 0.20;
  try {
    const { data: taxData, error: taxErr } = await supabaseAdmin
      .from('tax_configurations')
      .select('cota_tva')
      .eq('tara_cod', tara)
      .single();
    if (!taxErr && taxData?.cota_tva != null) {
      tvaDecimal = Number(taxData.cota_tva) / 100;
    }
  } catch (e) {
    console.warn('[deviz/calculate] fallback TVA pentru', tara, ':', e.message);
  }

  // ── Calcul formula deviz ─────────────────────────────────────────
  // PRET_FINAL = MAX(cost_brut, VMC) × (1 + INDIRECT + MARKETING + PLATFORMA)
  //              × (1 + MYDARRIN_PCT) × zone_coef × urgency_coef × (1 + TVA)
  const vmcTara     = VMC[tara] ?? VMC.RO;
  const costBaza    = Math.max(cost_brut, vmcTara);
  const urgCoef     = URGENCY_COEF[tip_urgenta] ?? URGENCY_COEF.normal;
  const zoneCoef    = ZONE_COEF[zona];

  const pretFinal = Math.round(
    costBaza
    * (1 + INDIRECT + MARKETING + PLATFORMA)
    * (1 + MYDARRIN_PCT)
    * zoneCoef
    * urgCoef
    * (1 + tvaDecimal)
    * 100
  ) / 100;

  // ── Salvează devizul ─────────────────────────────────────────────
  const { data, error } = await supabaseAdmin
    .from('devize')
    .insert({
      client_id:   user.id,
      serviciu_id,
      nivel:       req.body.nivel ?? null,
      input_json:  { serviciu_id, cost_brut, tara, zona, urgent, tip_urgenta },
      cost_brut,
      cost_baza:   costBaza,
      pret_final:  pretFinal,
      tara_cod:    tara,
      zona,
      urgent:      Boolean(urgent),
      moneda:      { RO:'RON', MD:'MDL', DE:'EUR', FR:'EUR', BG:'BGN' }[tara] ?? 'RON',
    })
    .select()
    .single();

  if (error) {
    console.error('[deviz/calculate]', error);
    return res.status(500).json({ error: 'Nu am putut salva devizul' });
  }

  return res.status(200).json({
    ok: true,
    deviz: data,
    _debug: {
      vmcTara,
      costBaza,
      tvaDecimal,
      zoneCoef,
      urgCoef,
      mydarrin_pct: MYDARRIN_PCT,
    },
  });
}

// orice user autentificat poate cere un deviz
module.exports = requireAuth([], handler);
