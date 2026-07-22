// lib/calculeaza-pret.js
// Formula aditivă a rețetei multi-partener (2026-07-22) — sursă unică,
// folosită atât de api/deviz/calculate.js (deviz, la momentul estimării),
// cât și de api/comenzi/creeaza.js (comandă, la momentul plasării).
//
// NOTĂ IMPORTANTĂ: deviz-urile (`devize`) și comenzile (`comenzi`) NU sunt
// legate printr-un deviz_id (coloana nu există în `comenzi` — comenzi.
// catalog_serviciu_id e singura legătură, cu serviciul din catalog, nu cu
// un deviz anume). Asta înseamnă că prețul poate fi recalculat de două ori
// (o dată la deviz, o dată la comandă) cu risc teoretic de drift dacă
// procentele din backoffice_config se schimbă exact în intervalul dintre
// cele două — comportament deja existent înainte de acest audit (comision_pct
// era deja "înghețat" per-comandă la creare, nu recalculat la eliberare).
// Această rescriere NU rezolvă legătura deviz→comandă (schimbare de schemă
// mai amplă, în afara scopului cerut) — doar păstrează, pentru fiecare
// comandă, exact sumele calculate la momentul creării ei, ca eliberarea de
// escrow să nu recalculeze niciodată, doar să citească ce a fost înghețat.

const { supabaseAdmin } = require('./supabaseAdmin');

const TVA_FALLBACK = { RO: 0.21, MD: 0.20, DE: 0.19, FR: 0.20, BG: 0.20 };
const PRICING_FALLBACK = {
  cost_marketing_pct: 3,
  cost_mentenanta_pct: 2,
  comision_platforma_default_pct: 12,
};

async function citesteConfigPricing() {
  const { data } = await supabaseAdmin
    .from('backoffice_config')
    .select('cheie, valoare')
    .eq('sectiune', 'pricing');
  const cfg = { ...PRICING_FALLBACK };
  for (const row of data || []) {
    const val = Number(row.valoare);
    if (Number.isFinite(val) && row.cheie in cfg) cfg[row.cheie] = val;
  }
  return cfg;
}

async function citesteTva(tara) {
  const { data } = await supabaseAdmin
    .from('tax_configurations')
    .select('cota_tva')
    .eq('tara_cod', tara)
    .maybeSingle();
  if (data?.cota_tva != null) return Number(data.cota_tva) / 100;
  return TVA_FALLBACK[tara] ?? 0.20;
}

function numarPozitiv(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * @param {{cost_baza_servicii?:number, cost_materiale?:number, cost_chirie_scule?:number,
 *           cost_curier?:number, cost_asigurare?:number, tara?:string}} input
 * @returns {Promise<{
 *   cost_baza_servicii:number, cost_materiale:number, cost_chirie_scule:number,
 *   cost_curier:number, cost_asigurare:number, subtotal:number,
 *   cost_marketing:number, cost_mentenanta:number, comision_platforma:number,
 *   tva_decimal:number, tva_pct:number, tva_suma:number, pret_final:number
 * }>}
 */
async function calculeazaPret(input = {}) {
  const cost_baza_servicii = numarPozitiv(input.cost_baza_servicii);
  const cost_materiale = numarPozitiv(input.cost_materiale);
  const cost_chirie_scule = numarPozitiv(input.cost_chirie_scule);
  const cost_curier = numarPozitiv(input.cost_curier);
  const cost_asigurare = numarPozitiv(input.cost_asigurare);
  const tara = input.tara || 'RO';

  const subtotal = cost_baza_servicii + cost_materiale + cost_chirie_scule + cost_curier + cost_asigurare;

  const cfg = await citesteConfigPricing();
  const tva_decimal = await citesteTva(tara);

  const cost_marketing = Math.round(subtotal * (cfg.cost_marketing_pct / 100) * 100) / 100;
  const cost_mentenanta = Math.round(subtotal * (cfg.cost_mentenanta_pct / 100) * 100) / 100;
  const comision_platforma = Math.round(subtotal * (cfg.comision_platforma_default_pct / 100) * 100) / 100;

  const subtotalCuTaxePlatforma = subtotal + cost_marketing + cost_mentenanta + comision_platforma;
  const tva_suma = Math.round(subtotalCuTaxePlatforma * tva_decimal * 100) / 100;
  const pret_final = Math.round((subtotalCuTaxePlatforma + tva_suma) * 100) / 100;

  return {
    cost_baza_servicii, cost_materiale, cost_chirie_scule, cost_curier, cost_asigurare,
    subtotal, cost_marketing, cost_mentenanta, comision_platforma,
    tva_decimal, tva_pct: Math.round(tva_decimal * 10000) / 100, tva_suma, pret_final,
  };
}

module.exports = { calculeazaPret };
