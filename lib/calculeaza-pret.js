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

// FIX (gaură de integritate, 22 august 2026): fix-ul din 2026-07-22 a
// eliminat DELIBERAT vechiul VMC ("Valoare Minimă Comandă") din formulă —
// corect pentru arhitectura de rețetă aditivă. Dar front-end-ul nu a fost
// aliniat: încă aplica local `Math.max(brut, 100)`, promisiune pe care
// server-ul nu o mai impunea deloc — ocolibilă la un apel direct API.
// Prima reparație (aceeași zi) a impus 100 hardcodat și server-side.
//
// EXTENSIE (configurabil per țară, 22 august 2026): 100 hardcodat nu are
// sens pentru orice altă țară/monedă (100 RON ≠ 100 GBP). Pragul e acum
// citit din tax_configurations.prag_minim_comanda (coloană nouă, aceeași
// tabelă/tipar ca cota_tva) — administrabil din panel-accountancy, la fel
// ca TVA. RO e populat azi cu valoarea reală deja existentă (100 RON, nu
// inventată). Restul țărilor: NULL — fallback-ul de mai jos (100) le
// acoperă cu comportamentul de dinainte, nu presupune o valoare corectă
// pentru monede necunoscute încă.
const VMC_FALLBACK = 100;

// Panoul „Comisioane & Tarifare" salvează câte un rând per (cheie, tara_cod).
// Înainte se citeau toate rândurile secțiunii fără filtru de țară, așa că
// la un rând `ALL` și unul `RO` pentru aceeași cheie câștiga unul oarecare.
// Acum: întâi rândurile `ALL` (sau fără țară), apoi cele ale țării, care le
// suprascriu. Rândurile altor țări sunt ignorate.
// Folosită și de lib/elibereaza-escrow.js, pentru toate cheile numerice ale
// unei secțiuni (inclusiv cele fără fallback aici).
async function citesteConfigSectiune(sectiune, tara) {
  const { data } = await supabaseAdmin
    .from('backoffice_config')
    .select('cheie, valoare, tara_cod')
    .eq('sectiune', sectiune);
  const cfg = {};
  const rows = data || [];
  const generale = rows.filter((r) => r.tara_cod == null || r.tara_cod === 'ALL');
  const peTara = rows.filter((r) => r.tara_cod === tara);
  for (const row of [...generale, ...peTara]) {
    const val = Number(row.valoare);
    if (Number.isFinite(val)) cfg[row.cheie] = val;
  }
  return cfg;
}

async function citesteConfigPricing(tara) {
  const citit = await citesteConfigSectiune('pricing', tara);
  const cfg = { ...PRICING_FALLBACK };
  for (const cheie of Object.keys(cfg)) {
    if (cheie in citit) cfg[cheie] = citit[cheie];
  }
  return cfg;
}

// Asigurare inclusă în preț (6 octombrie 2026, decizie LM): procent din
// costul de bază (manoperă + materiale + utilaje), configurabil din panoul
// „Comisioane & Tarifare" (backoffice_config, secțiunea `asigurari`, cheia
// `cost_asigurare_pct`). Diferit de `comision_intermediere_pct` (comisionul
// My Darrin din prima asigurătorului). Rândul specific țării are prioritate
// față de cel `ALL`. Mai târziu procentul va veni de la partenerii asigurători.
const ASIGURARE_PCT_FALLBACK = 1;

async function citesteConfigAsigurari(tara) {
  const { data } = await supabaseAdmin
    .from('backoffice_config')
    .select('cheie, valoare, tara_cod')
    .eq('sectiune', 'asigurari')
    .eq('cheie', 'cost_asigurare_pct');
  const rows = data || [];
  const row = rows.find((r) => r.tara_cod === tara) || rows.find((r) => r.tara_cod === 'ALL');
  const val = Number(row?.valoare);
  return { cost_asigurare_pct: row && Number.isFinite(val) && val >= 0 ? val : ASIGURARE_PCT_FALLBACK };
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

async function citestePragMinimComanda(tara) {
  const { data } = await supabaseAdmin
    .from('tax_configurations')
    .select('prag_minim_comanda')
    .eq('tara_cod', tara)
    .maybeSingle();
  if (data?.prag_minim_comanda != null) return Number(data.prag_minim_comanda);
  return VMC_FALLBACK;
}

// G2, partea 2 (cerință explicită 31 Iulie 2026) — grila reală de transport-
// după-greutate + cost ajutor. Cât timp tarife_transport rămâne goală (azi:
// 0 rânduri, verificat live), întoarce mereu {0,0} — comportament IDENTIC
// (ca sumă totală) cu cel dinainte de acest cuplaj. Efectul devine real
// doar după ce un admin configurează rânduri reale din panoul „Tarife
// Transport".
//
// EXTINDERE (D2b, 25 august 2026, aprobat): înainte întorcea o singură
// sumă combinată (greutate + ajutor) — imposibil de alocat separat la doi
// actori diferiți (transportator vs. ajutor de încărcare/descărcare), și
// nici măcar citită la eliberarea escrow-ului (gaură de integritate reală,
// vezi lib/elibereaza-escrow.js). Acum întoarce cele două componente
// separat; suma lor rămâne identică cu ce întorcea funcția înainte.
async function citesteTarifTransport(masaKg, nivelTransportMarfa, tara) {
  if (!(masaKg > 0)) return { cost_transportator: 0, cost_ajutor: 0 };

  const { data, error } = await supabaseAdmin
    .from('tarife_transport')
    .select('*')
    .eq('activ', true)
    .lte('prag_kg_min', masaKg);
  if (error || !data?.length) return { cost_transportator: 0, cost_ajutor: 0 };

  const candidate = data.filter((r) =>
    (r.prag_kg_max === null || masaKg <= Number(r.prag_kg_max)) &&
    (r.tara_cod === null || r.tara_cod === tara) &&
    (r.nivel_transport_marfa === null || r.nivel_transport_marfa === nivelTransportMarfa)
  );
  if (!candidate.length) return { cost_transportator: 0, cost_ajutor: 0 };

  // Cel mai specific rând câștigă (potriveşte pe țară ȘI nivel > doar unul > niciunul).
  candidate.sort((a, b) => {
    const specA = (a.tara_cod !== null ? 1 : 0) + (a.nivel_transport_marfa !== null ? 1 : 0);
    const specB = (b.tara_cod !== null ? 1 : 0) + (b.nivel_transport_marfa !== null ? 1 : 0);
    return specB - specA;
  });

  const tarif = candidate[0];
  const costGreutate = tarif.tarif_fix != null
    ? Number(tarif.tarif_fix)
    : Number(tarif.tarif_ron_per_kg || 0) * masaKg;
  return {
    cost_transportator: Math.round(costGreutate * 100) / 100,
    cost_ajutor: Math.round(Number(tarif.cost_ajutor || 0) * 100) / 100,
  };
}

function numarPozitiv(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Configurația formulei pentru o țară: procentele din backoffice_config, TVA-ul
 * și pragul minim de comandă. Separată de calcul (16 oct. 2026), ca o listă de
 * produse (api/public/marketplace-produse.js) să citească configurația o
 * singură dată și să calculeze prețul fiecărui produs cu aceeași formulă.
 * @param {string} tara
 * @param {{ cuAsigurare?: boolean }} [opt] - false: nu citește procentul de
 *   asigurare (apelantul îl trimite explicit în input.cost_asigurare)
 */
async function incarcaConfigPret(tara = 'RO', { cuAsigurare = true } = {}) {
  const [asigurari, pricing, tva_decimal, prag_minim_comanda] = await Promise.all([
    cuAsigurare ? citesteConfigAsigurari(tara) : Promise.resolve({ cost_asigurare_pct: null }),
    citesteConfigPricing(tara),
    citesteTva(tara),
    citestePragMinimComanda(tara),
  ]);
  return { tara, cost_asigurare_pct: asigurari.cost_asigurare_pct, pricing, tva_decimal, prag_minim_comanda };
}

/**
 * Formula prețului public, fără acces la baza de date.
 * @param {object} input - aceleași câmpuri ca la calculeazaPret
 * @param {object} cfg - din incarcaConfigPret
 * @param {{cost_transportator:number, cost_ajutor:number}} [transport]
 * @param {{ cuPragMinim?: boolean }} [opt] - false: fără pragul minim de comandă
 *   (prețul unitar al unui produs; comanda întreagă îl aplică)
 */
function aplicaFormulaPret(input = {}, cfg, transport = { cost_transportator: 0, cost_ajutor: 0 }, { cuPragMinim = true } = {}) {
  const cost_baza_servicii = numarPozitiv(input.cost_baza_servicii);
  const cost_materiale = numarPozitiv(input.cost_materiale);
  const cost_chirie_scule = numarPozitiv(input.cost_chirie_scule);
  const cost_curier = numarPozitiv(input.cost_curier);
  const costBaza = cost_baza_servicii + cost_materiale + cost_chirie_scule;

  // Asigurarea: trimisă explicit (inclusiv 0, ex. clientul a ales altă
  // poliță) → se folosește valoarea trimisă; lipsă → % din costul de bază.
  const asigurareExplicita = input.cost_asigurare !== undefined && input.cost_asigurare !== null;
  let cost_asigurare;
  let cost_asigurare_pct = null;
  if (asigurareExplicita) {
    cost_asigurare = numarPozitiv(input.cost_asigurare);
  } else {
    cost_asigurare_pct = cfg.cost_asigurare_pct;
    cost_asigurare = Math.round(costBaza * (cost_asigurare_pct / 100) * 100) / 100;
  }

  // G2, partea 2 — transport-după-greutate + cost ajutor. Rămân 0 dacă
  // masa_totala_kg lipsește SAU dacă nicio grilă reală nu e configurată
  // încă (tarife_transport goală) — identic ca sumă totală cu comportamentul
  // dinainte de D2b, doar separate acum în două componente alocabile.
  const { cost_transportator, cost_ajutor } = transport;
  const cost_transport_greutate = cost_transportator;

  const subtotal = costBaza + cost_curier + cost_asigurare + cost_transport_greutate + cost_ajutor;

  const pricing = cfg.pricing;
  const tva_decimal = cfg.tva_decimal;

  const cost_marketing = Math.round(subtotal * (pricing.cost_marketing_pct / 100) * 100) / 100;
  const cost_mentenanta = Math.round(subtotal * (pricing.cost_mentenanta_pct / 100) * 100) / 100;
  // Comisionul platformei se aplică pe costul de bază (manoperă + materiale
  // + utilaje), nu pe subtotalul cu transport și asigurare (6 octombrie
  // 2026, decizie LM). Marketingul și mentenanța rămân pe subtotal.
  const comision_platforma = Math.round(costBaza * (pricing.comision_platforma_default_pct / 100) * 100) / 100;

  const subtotalCuTaxePlatforma = subtotal + cost_marketing + cost_mentenanta + comision_platforma;
  const tva_suma = Math.round(subtotalCuTaxePlatforma * tva_decimal * 100) / 100;
  const pragMinimComanda = cfg.prag_minim_comanda;
  const pretFaraPrag = Math.round((subtotalCuTaxePlatforma + tva_suma) * 100) / 100;
  const pret_final = cuPragMinim ? Math.max(pretFaraPrag, pragMinimComanda) : pretFaraPrag;

  return {
    cost_baza_servicii, cost_materiale, cost_chirie_scule, cost_curier, cost_asigurare, cost_asigurare_pct, cost_transport_greutate, cost_ajutor,
    cost_baza: Math.round(costBaza * 100) / 100,
    subtotal, cost_marketing, cost_mentenanta, comision_platforma,
    tva_decimal, tva_pct: Math.round(tva_decimal * 10000) / 100, tva_suma, pret_final,
    prag_minim_comanda: pragMinimComanda,
  };
}

/**
 * @param {{cost_baza_servicii?:number, cost_materiale?:number, cost_chirie_scule?:number,
 *           cost_curier?:number, cost_asigurare?:number, tara?:string,
 *           masa_totala_kg?:number, nivel_transport_marfa?:string}} input
 * @returns {Promise<{
 *   cost_baza_servicii:number, cost_materiale:number, cost_chirie_scule:number,
 *   cost_curier:number, cost_asigurare:number, cost_asigurare_pct:number|null,
 *   cost_transport_greutate:number, cost_ajutor:number, cost_baza:number, subtotal:number,
 *   cost_marketing:number, cost_mentenanta:number, comision_platforma:number,
 *   tva_decimal:number, tva_pct:number, tva_suma:number, pret_final:number
 * }>}
 */
async function calculeazaPret(input = {}) {
  const tara = input.tara || 'RO';
  const asigurareExplicita = input.cost_asigurare !== undefined && input.cost_asigurare !== null;
  const [cfg, transport] = await Promise.all([
    incarcaConfigPret(tara, { cuAsigurare: !asigurareExplicita }),
    citesteTarifTransport(numarPozitiv(input.masa_totala_kg), input.nivel_transport_marfa || null, tara),
  ]);
  return aplicaFormulaPret(input, cfg, transport);
}

module.exports = { calculeazaPret, incarcaConfigPret, aplicaFormulaPret, citestePragMinimComanda, citesteConfigAsigurari, citesteConfigSectiune };
