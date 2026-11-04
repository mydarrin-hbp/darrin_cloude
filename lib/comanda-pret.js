// lib/comanda-pret.js
// Pasul 11-C3 (4 nov. 2026, regula LM): prețul oricărei comenzi se calculează
// doar pe server, în același loc pentru toate tipurile de client. Folosit de
// api/comenzi/creeaza.js (persoane fizice și firme) și de
// api/comenzi/creeaza-b2g.js (instituții publice) — înainte, B2G lua încă
// prețul din cerere (valoare_totala / cost_*).
//
// Ce e comun aici (diferențele rămân în fiecare endpoint: agenda și facturarea
// la B2C; instituția, metoda de plată și lipsa alocării la creare la B2G):
//   pregatesteRegiune(corp)       — județul → codul din geo_regiuni (11-P3b)
//   valideazaCorp(corp)           — nivel / cantitate / produse / date / adresă;
//                                   fără nivel și fără produse → 409 FARA_PRET
//   verificaTaraActiva(tara_cod)  — 403 ZONA_INDISPONIBILA
//   calculeazaSume(corp, { cantitate, adresaLucrare })
//                                 — nivel_id → lib/pret-serviciu.js + zona
//                                   (lib/disponibilitate-adresa.js → 409
//                                   SERVICIU_INDISPONIBIL); produse_marketplace →
//                                   lib/rezolva-addon-materiale.js; ambele cu
//                                   formula din lib/calculeaza-pret.js.
// `valoare_totala`, `suma_asigurare` și `cost_*` din cerere nu sunt citite.
// Fiecare funcție întoarce { ok:true, ... } sau { ok:false, eroare }; eroarea se
// trimite cu trimiteEroareComanda(res, eroare), în forma comună (RO + EN).

const { supabaseAdmin } = require('./supabaseAdmin');
const { trimiteEroare, camp } = require('./raspuns-eroare');
const { calculeazaPret } = require('./calculeaza-pret');
const { calculeazaPretServiciu, MESAJE: MESAJE_PRET } = require('./pret-serviciu');
const { verificaDisponibilitate } = require('./disponibilitate-adresa');
const { rezolvaAddonMateriale, parseazaIdMarketplace } = require('./rezolva-addon-materiale');
const { rezolvaRegiune, MESAJ_REGIUNE } = require('./regiune');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESAJE = {
  adresa: {
    ro: 'Completează adresa de prestare sau de livrare (strada, numărul și localitatea).',
    en: 'Fill in the service or delivery address (street, number and town).',
  },
  zona_indisponibila: {
    ro: 'My Darrin nu este încă disponibil în zona ta. Imediat ce pornim aici, te anunțăm pe email. Mulțumim pentru înțelegere.',
    en: 'My Darrin is not available in your area yet. As soon as we launch here, we will let you know by email. Thank you for your understanding.',
  },
  regiune_text: { ro: 'regiune trebuie să fie text.', en: 'The county must be text.' },
  nivel_uuid: { ro: 'nivel_id trebuie să fie un uuid (text).', en: 'nivel_id must be a uuid (text).' },
  cantitate: { ro: 'cantitate trebuie să fie un număr pozitiv.', en: 'The quantity must be a positive number.' },
  masa: { ro: 'masa_totala_kg trebuie să fie un număr pozitiv', en: 'masa_totala_kg must be a positive number' },
  transport_marfa: { ro: 'nivel_transport_marfa trebuie să fie text', en: 'nivel_transport_marfa must be text' },
  data: { ro: 'data_programata trebuie în format YYYY-MM-DD', en: 'data_programata must use the YYYY-MM-DD format' },
  ora: { ro: 'ora_inceput_programata/ora_sfarsit_programata trebuie în format HH:MM', en: 'The scheduled times must use the HH:MM format' },
  produse_goale: { ro: 'produse_marketplace trebuie să fie o listă ne-goală.', en: 'produse_marketplace must be a non-empty list.' },
  produse_invalide: { ro: 'produse_marketplace: id de produs invalid sau prea multe produse (maximum 50).', en: 'produse_marketplace: invalid product id or too many products (50 at most).' },
  addon_en: 'A product you chose has no price for this level or country, or is no longer available. Remove it to continue.',
};

function eroare(status, cod, m, numeCamp, extra) {
  return { ok: false, eroare: { status, cod, ro: m.ro, en: m.en, camp: numeCamp || null, extra: extra || null } };
}

function trimiteEroareComanda(res, e) {
  return trimiteEroare(res, e.status, e.cod, e.ro, e.en, e.camp ? [camp(e.camp, e.ro, e.en)] : [],
    Object.assign(e.camp ? { camp: e.camp } : {}, e.extra || {}));
}

const taraCod = (t) => (typeof t === 'string' && t.trim() ? t.trim().toUpperCase() : null);

// Pasul 11-P3b: județul comenzii → codul din geo_regiuni („Cluj”, „Cluj County”,
// „Județul Cluj”, „CJ” → „CJ”), o singură dată; pe comandă se salvează codul,
// denumirea rămâne pentru adresa copiată la facturare. Modifică corp.regiune.
async function pregatesteRegiune(corp) {
  if (corp.regiune == null || corp.regiune === '') return { ok: true, regiuneDenumire: null };
  if (typeof corp.regiune !== 'string') return eroare(400, 'DATE_INVALIDE', MESAJE.regiune_text, 'regiune');
  const rz = await rezolvaRegiune(taraCod(corp.tara_cod) || 'RO', corp.regiune);
  if (rz.areRegiuni && !rz.regiune) return eroare(400, 'REGIUNE_NECUNOSCUTA', MESAJ_REGIUNE, 'regiune');
  const regiuneDenumire = rz.regiune ? rz.regiune.denumire : corp.regiune.trim();
  if (rz.regiune) corp.regiune = rz.regiune.cod;
  return { ok: true, regiuneDenumire };
}

// Validarea corpului comun (fără prețuri): nivel + cantitate SAU produse, date,
// adresă. Întoarce calea de preț aleasă.
function valideazaCorp(corp) {
  const { nivel_id = null, cantitate = null, produse_marketplace = null, adresa,
    masa_totala_kg = null, nivel_transport_marfa = null,
    data_programata = null, ora_inceput_programata = null, ora_sfarsit_programata = null } = corp;

  const areNivelId = typeof nivel_id === 'string' && nivel_id.length > 0;
  if (nivel_id !== null && nivel_id !== undefined && !areNivelId) return eroare(400, 'DATE_INVALIDE', MESAJE.nivel_uuid, 'nivel_id');
  let cantitateNivel = 1;
  if (areNivelId) {
    cantitateNivel = cantitate === null || cantitate === undefined ? 1 : Number(cantitate);
    if (!Number.isFinite(cantitateNivel) || cantitateNivel <= 0) return eroare(400, 'DATE_INVALIDE', MESAJE.cantitate, 'cantitate');
  }

  if (masa_totala_kg !== null && !(typeof masa_totala_kg === 'number' && masa_totala_kg > 0)) return eroare(400, 'DATE_INVALIDE', MESAJE.masa, 'masa_totala_kg');
  if (nivel_transport_marfa !== null && typeof nivel_transport_marfa !== 'string') return eroare(400, 'DATE_INVALIDE', MESAJE.transport_marfa, 'nivel_transport_marfa');
  if (data_programata !== null && !/^\d{4}-\d{2}-\d{2}$/.test(data_programata)) return eroare(400, 'DATE_INVALIDE', MESAJE.data, 'data_programata');
  for (const ora of [ora_inceput_programata, ora_sfarsit_programata]) {
    if (ora !== null && !/^\d{2}:\d{2}(:\d{2})?$/.test(ora)) return eroare(400, 'DATE_INVALIDE', MESAJE.ora, 'ora_inceput_programata');
  }

  // Produse din marketplace (pasul 10a) și materiale din catalog comandate din
  // coș (pasul 11-C1, {id, qty, nivel}); prețul se calculează doar pe server.
  const areProduse = !areNivelId && Array.isArray(produse_marketplace) && produse_marketplace.length > 0;
  if (produse_marketplace !== null && produse_marketplace !== undefined && !areNivelId && !areProduse) return eroare(400, 'DATE_INVALIDE', MESAJE.produse_goale, 'produse_marketplace');
  const esteProdusValid = (p) => !!p && (!!parseazaIdMarketplace(p.id)
    || (typeof p.id === 'string' && UUID.test(p.id) && typeof p.nivel === 'string' && p.nivel.length > 0));
  if (areProduse && (produse_marketplace.length > 50 || !produse_marketplace.every(esteProdusValid))) return eroare(400, 'DATE_INVALIDE', MESAJE.produse_invalide, 'produse_marketplace');

  // Pasul 11-C2: fără nivel din catalog (deci fără preț real) nu se comandă direct.
  if (!areNivelId && !areProduse) return eroare(409, 'FARA_PRET', MESAJE_PRET.fara_pret, 'nivel_id');

  if (typeof adresa !== 'string' || adresa.trim().length < 5) return eroare(400, 'ADRESA_LIPSA', MESAJE.adresa, 'adresa');
  return { ok: true, cale: areNivelId ? 'nivel' : 'produse', cantitate: cantitateNivel };
}

// Țara comenzii trebuie să aibă checkout-ul activ (tax_configurations). Fără
// tara_cod nu se blochează (compatibil cu apelanții care nu o trimit).
async function verificaTaraActiva(tara_cod) {
  const t = taraCod(tara_cod);
  if (!t) return { ok: true };
  const { data: config } = await supabaseAdmin.from('tax_configurations').select('checkout_activ').eq('tara_cod', t).maybeSingle();
  if (!config || !config.checkout_activ) return eroare(403, 'ZONA_INDISPONIBILA', MESAJE.zona_indisponibila, 'tara_cod', { code: 'ZONA_INDISPONIBILA' });
  return { ok: true };
}

const sumeDinCalc = (calc) => ({
  suma_totala_platita: calc.pret_final,
  suma_manopera: calc.cost_baza_servicii,
  suma_materiale: calc.cost_materiale,
  suma_chirie_scule: calc.cost_chirie_scule,
  suma_transport: calc.cost_curier,
  suma_transport_greutate: calc.cost_transport_greutate,
  suma_ajutor: calc.cost_ajutor,
  suma_asigurare: calc.cost_asigurare,
  suma_marketing: calc.cost_marketing,
  suma_mentenanta: calc.cost_mentenanta,
  suma_comision_platforma: calc.comision_platforma,
  tva_pct: calc.tva_pct,
  tva_suma: calc.tva_suma,
});

/**
 * Prețul comenzii, pe calea aleasă de valideazaCorp.
 * @returns {Promise<{ok:true, catalog_serviciu_id, campuri, manopera_defalcare}|{ok:false, eroare}>}
 *   campuri: coloanele de preț (și nivel_id / cantitate / addon / ESCO) de pus pe comandă
 */
async function calculeazaSume(corp, { cale, cantitate, adresaLucrare }) {
  const tara = taraCod(corp.tara_cod) || 'RO';

  if (cale === 'produse') {
    let rez;
    try {
      rez = await rezolvaAddonMateriale(corp.produse_marketplace, null, tara);
    } catch (e) {
      if (e.code === 'ADDON_FARA_PRET' || e.code === 'ADDON_INVALID') return eroare(400, e.code, { ro: e.message, en: MESAJE.addon_en }, 'produse_marketplace', { code: e.code });
      throw e;
    }
    const calc = await calculeazaPret({ cost_materiale: rez.cost_materiale, cost_chirie_scule: rez.cost_utilaj, tara });
    // furnizor_id rămâne pe fiecare item: escrow-ul înregistrează suma pe furnizor.
    return { ok: true, catalog_serviciu_id: null, manopera_defalcare: null, campuri: Object.assign({ addon_materiale_selectate: rez.itemi }, sumeDinCalc(calc), { suma_manopera: 0 }) };
  }

  // Serviciu / închiriere: rețeta nivelului sau prețul lui din catalog (lib/pret-serviciu.js).
  const pret = await calculeazaPretServiciu({ nivelId: corp.nivel_id, cantitate, taraCod: tara, regiune: corp.regiune || null, addonMateriale: corp.addon_materiale || [] });
  if (!pret.ok) {
    if (pret.motiv === 'addon_fara_pret') return eroare(400, pret.cod || 'ADDON_FARA_PRET', pret.mesaj, 'addon_materiale');
    const cod = pret.motiv === 'nivel_inactiv' ? 'NIVEL_INACTIV' : pret.motiv === 'nivel_necunoscut' ? 'NIVEL_NECUNOSCUT' : 'FARA_PRET';
    return eroare(409, cod, pret.mesaj, 'nivel_id', pret.resurse_fara_pret ? { resurse_fara_pret: pret.resurse_fara_pret } : null);
  }
  const serviciuId = pret.nivel.serviciu_id;

  // Pasul 11-C2: fără parteneri activi în zona adresei, comanda nu pleacă.
  const a = adresaLucrare || {};
  const disp = await verificaDisponibilitate({
    serviciu: { id: serviciuId },
    adresa: { strada: a.strada || corp.adresa, localitate: a.localitate || corp.localitate, judet: corp.regiune || a.judet, tara_cod: tara },
  });
  if (!disp.ok) return eroare(disp.status, disp.cod, disp.mesaj, disp.camp);
  if (!disp.disponibil) return eroare(409, 'SERVICIU_INDISPONIBIL', disp.mesaj, 'adresa', { motiv: disp.motiv });

  const cost = pret.cost || {};
  // Venitul defalcat al partenerului (9 oct. 2026): manoperă + costuri fixe, fără comisioanele platformei.
  let manoperaDefalcare = null;
  if (cost.defalcare_cost_baza) {
    const d = cost.defalcare_cost_baza;
    manoperaDefalcare = {
      manopera: d.manopera, deplasare: d.deplasare, uzura_scule: d.uzura, consumabile: d.consumabile,
      echipament_testare: d.testare, optiuni_nivel: d.optiuni_nivel || 0, alte_costuri_fixe: d.alte_costuri_fixe || 0,
      total: d.total, reguli_costuri_fixe: cost.reguli_costuri_fixe || {}, regula_nivel_id: cost.regula_nivel_id || null,
    };
  }

  // Varianta 2 „Echipă” (24 august 2026): manopera pe cod ESCO, cu exact un rând
  // principal (codul serviciului sau, altfel, primul) pentru lib/elibereaza-escrow.js.
  let breakdown = null;
  const escoIntrari = Object.entries(cost.manopera_per_esco || {});
  if (escoIntrari.length) {
    const { data: servRow } = await supabaseAdmin.from('catalog_servicii').select('cod_esco').eq('id', serviciuId).maybeSingle();
    const escoPrincipal = servRow?.cod_esco || null;
    breakdown = escoIntrari.map(([cod_esco, suma]) => ({ cod_esco, suma, principal: cod_esco === escoPrincipal }));
    if (!breakdown.some((b) => b.principal)) breakdown[0].principal = true;
  }

  return {
    ok: true,
    catalog_serviciu_id: serviciuId,
    manopera_defalcare: manoperaDefalcare,
    campuri: Object.assign({
      nivel_id: corp.nivel_id,
      cantitate,
      manopera_esco_breakdown: breakdown,
      addon_materiale_selectate: pret.addon.itemi.length ? pret.addon.itemi : null,
    }, sumeDinCalc(pret.calc)),
  };
}

module.exports = { pregatesteRegiune, valideazaCorp, verificaTaraActiva, calculeazaSume, trimiteEroareComanda, MESAJE };
