// lib/aloca-subcontractori.js
// G11 (25 Iulie 2026) — extinde alocarea automată dincolo de manoperă
// (deja acoperită de lib/aloca-partener.js) la celelalte 4 roluri din
// comanda_subcontractori: materiale, rental_echipament, curier, asigurare.
// Până acum, lib/elibereaza-escrow.js insera aceste rânduri cu
// actor_id = null necondiționat — gap confirmat explicit în audit.
//
// Reutilizează exact motorul construit la G10 (partener_servicii_active,
// populat acum prin bifarea reală din catalog) + tiparul de matching
// geo/disponibilitate deja folosit de lib/aloca-partener.js pentru
// manoperă (parteneri_disponibilitate).
//
// Reguli de eligibilitate, în plus față de potrivirea pe categorie/zonă:
// partenerul trebuie să fie și "activabil" conform hard-stop-ului din G9
// (status_verificare='approved' + contract_semnat=true + cont bancar activ)
// — nu are sens să aloci automat plata către un partener care oricum n-ar
// putea prelua/încasa o comandă.
//
// LIMITĂ CUNOSCUTĂ (ca și la lib/aloca-partener.js): ia primul candidat
// eligibil găsit, nu neapărat cel mai apropiat sau cel mai bine cotat —
// clasare mai fină e un rafinament ulterior, nu blocant.

const { supabaseAdmin } = require('./supabaseAdmin');

const ROL_LA_TIP_PARTENER = {
  materiale: 'furnizor_materiale',
  rental_echipament: 'inchirieri_utilaje',
  curier: 'curier_utilitara',
  asigurare: 'asigurari',
};

// Doar materiale/rental au un catalog de bifat (vezi G10) — curier/asigurare
// se potrivesc exclusiv pe tip de partener + zonă/disponibilitate.
const ROL_LA_CATEGORIE_CATALOG = {
  materiale: 'materiale',
  rental_echipament: 'inchirieri',
};

/**
 * Găsește un partener eligibil pentru un rol de subcontractor pe o comandă.
 * @param {object} comanda - rândul din `comenzi` (are nevoie de tara_cod, regiune, catalog_serviciu_id)
 * @param {string} rolTip - unul din: materiale, rental_echipament, curier, asigurare
 * @returns {Promise<string|null>} partener_id sau null dacă nu s-a găsit
 */
async function gasesteActorPentruRol(comanda, rolTip) {
  const tipPartener = ROL_LA_TIP_PARTENER[rolTip];
  if (!tipPartener) return null;

  // 1. Partenerii de tipul corect, care ar putea și prelua/încasa comanda
  //    (aceleași 3 condiții ca hard-stop-ul de la G9).
  const { data: partneriTip } = await supabaseAdmin
    .from('partners')
    .select('id')
    .eq('partner_type', tipPartener)
    .eq('status_verificare', 'approved')
    .eq('contract_semnat', true);
  if (!partneriTip?.length) return null;

  const { data: conturi } = await supabaseAdmin
    .from('partner_conturi_bancare')
    .select('partner_id')
    .in('partner_id', partneriTip.map((p) => p.id))
    .eq('activ', true);
  let candidati = [...new Set((conturi || []).map((c) => c.partner_id))];
  if (!candidati.length) return null;

  // 2. Pentru materiale/închirieri, restrânge la cei care au bifat efectiv
  //    ceva din categoria de catalog corespunzătoare (motorul de la G10).
  const categorieCatalog = ROL_LA_CATEGORIE_CATALOG[rolTip];
  if (categorieCatalog) {
    const { data: catalogCat } = await supabaseAdmin
      .from('catalog_servicii')
      .select('id')
      .eq('categorie', categorieCatalog);
    const idsCatalog = (catalogCat || []).map((c) => c.id);
    if (!idsCatalog.length) return null;

    const { data: activi } = await supabaseAdmin
      .from('partener_servicii_active')
      .select('partener_id')
      .in('partener_id', candidati)
      .in('catalog_serviciu_id', idsCatalog)
      .eq('activ', true);
    if (!activi?.length) return null;
    candidati = [...new Set(activi.map((a) => a.partener_id))];
  }

  // 3. Disponibilitate + zonă — același tipar ca lib/aloca-partener.js.
  let query = supabaseAdmin
    .from('parteneri_disponibilitate')
    .select('partener_id')
    .in('partener_id', candidati)
    .eq('status_live', 'disponibil');
  if (comanda.tara_cod) query = query.eq('tara_cod', comanda.tara_cod);
  if (comanda.regiune) query = query.contains('judete', [comanda.regiune]);

  const { data: disponibili } = await query.limit(1);
  return disponibili?.[0]?.partener_id || null;
}

/**
 * Completează actor_id pentru rândurile de subcontractor care nu au deja
 * unul (adică toate în afară de manoperă, care e deja alocată la nivel de
 * comandă prin lib/aloca-partener.js).
 * @param {object} comanda
 * @param {Array<{rol_tip:string, actor_id:string|null, suma_neta_alocata:number}>} randuri
 */
async function completeazaActorii(comanda, randuri) {
  for (const rand of randuri) {
    if (rand.actor_id || rand.rol_tip === 'manopera') continue;
    rand.actor_id = await gasesteActorPentruRol(comanda, rand.rol_tip);
  }
  return randuri;
}

module.exports = { gasesteActorPentruRol, completeazaActorii };
