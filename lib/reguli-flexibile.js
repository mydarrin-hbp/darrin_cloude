// lib/reguli-flexibile.js
// Reguli configurabile de LM peste motorul de cost (Etapa 1, 9 oct. 2026):
//  - reguli_costuri_fixe: coeficienți pe deplasare/uzură/consumabile/testare,
//    prag de durată și plafon, pe domenii (serviciu > cod ESCO > categorie >
//    țară > ALL);
//  - reguli_niveluri: ce include fiecare nivel (Bronze…Platinum), pe serviciu,
//    cu valoare implicită pe categorie și apoi globală.
//
// Funcții pure, fără acces la baza de date: lib/calculeaza-cost-recipe.js le
// apelează cu regulile deja citite. Regula de aur: fără regulă aplicabilă
// (sau cu regula implicită: coeficienți 1, fără prag, fără plafon), rezultatul
// e identic la ban cu calculul de dinainte — aceleași valori, aceeași ordine
// a adunărilor.

const COMPONENTE_FIXE = ['deplasare', 'uzura', 'consumabile', 'testare'];

const REGULA_FIXE_IMPLICITA = Object.freeze({
  id: null,
  coef_deplasare: 1, coef_uzura: 1, coef_consumabile: 1, coef_testare: 1,
  prag_durata_ore: null, coef_sub_prag: null, plafon_pct_din_manopera: null,
});

const MATERIALE_NIVEL = ['nu', 'consumabile', 'complet'];

function numar(v, implicit) {
  if (v === null || v === undefined || v === '') return implicit;
  const n = Number(v);
  return Number.isFinite(n) ? n : implicit;
}

function esteValabila(r, dataIso) {
  if (r.activ === false) return false;
  if (r.valabil_de && dataIso < String(r.valabil_de).slice(0, 10)) return false;
  if (r.valabil_pana && dataIso > String(r.valabil_pana).slice(0, 10)) return false;
  return true;
}

// ── Costuri fixe ──────────────────────────────────────────────────────────
// Scor de specificitate; null = regula nu se aplică acestui context.
// serviciu (10000) > cod ESCO (1000) > subcategorie (150) > categorie (100) >
// țară (10) > ALL (0). Regiunea, dacă e completată, restrânge și departajează (+1).
function scorRegulaFixa(r, ctx) {
  if (r.serviciu_id && r.serviciu_id !== ctx.serviciuId) return null;
  if (r.cod_esco && r.cod_esco !== ctx.codEsco) return null;
  if (r.categorie_id && r.categorie_id !== ctx.categorieId && r.categorie_id !== ctx.subcategorieId) return null;
  const tara = r.tara_cod || 'ALL';
  if (tara !== 'ALL' && tara !== ctx.taraCod) return null;
  if (r.regiune && r.regiune !== ctx.regiune) return null;
  let scor = 0;
  if (r.serviciu_id) scor += 10000;
  if (r.cod_esco) scor += 1000;
  if (r.categorie_id) scor += r.categorie_id === ctx.subcategorieId ? 150 : 100;
  if (tara !== 'ALL') scor += 10;
  if (r.regiune) scor += 1;
  return scor;
}

function alegeRegula(reguli, ctx, scorFn) {
  const azi = ctx.dataIso || new Date().toISOString().slice(0, 10);
  let best = null;
  let bestScor = -1;
  for (const r of reguli || []) {
    if (!esteValabila(r, azi)) continue;
    const scor = scorFn(r, ctx);
    if (scor === null) continue;
    // La egalitate câștigă regula modificată cel mai recent.
    if (scor > bestScor || (scor === bestScor && String(r.updated_at || '') > String(best?.updated_at || ''))) {
      best = r;
      bestScor = scor;
    }
  }
  return best;
}

function alegeRegulaCosturiFixe(reguli, ctx) {
  return alegeRegula(reguli, ctx, scorRegulaFixa);
}

/**
 * Aplică regula pe componentele costurilor fixe ale unei meserii.
 * @param {{deplasare:number, uzura:number, consumabile:number, testare:number}} comp
 * @param {{ore:number, manopera:number}} context - orele de manoperă ale meseriei și valoarea lor
 * @param {object|null} regula - rând din reguli_costuri_fixe sau null (implicit)
 */
function aplicaCosturiFixe(comp, { ore = 0, manopera = 0 } = {}, regula = null) {
  const r = regula || REGULA_FIXE_IMPLICITA;
  const rez = {
    deplasare: (comp.deplasare || 0) * numar(r.coef_deplasare, 1),
    uzura: (comp.uzura || 0) * numar(r.coef_uzura, 1),
    consumabile: (comp.consumabile || 0) * numar(r.coef_consumabile, 1),
    testare: (comp.testare || 0) * numar(r.coef_testare, 1),
  };
  // Intervenție scurtă: sub pragul de durată, uzura sculelor se reduce
  // (ex. sub 0,5 h, × 0,25).
  const prag = numar(r.prag_durata_ore, null);
  const coefSubPrag = numar(r.coef_sub_prag, null);
  if (prag !== null && coefSubPrag !== null && ore < prag) rez.uzura *= coefSubPrag;

  // Aceeași ordine a adunărilor ca înainte: deplasare + uzură + consumabile + testare.
  let total = rez.deplasare + rez.uzura + rez.consumabile + rez.testare;

  // Plafon: costurile fixe nu depășesc X% din manoperă.
  const plafonPct = numar(r.plafon_pct_din_manopera, null);
  let plafonAplicat = false;
  if (plafonPct !== null && plafonPct >= 0) {
    const maxim = manopera * plafonPct / 100;
    if (total > maxim) {
      const factor = total > 0 ? maxim / total : 0;
      COMPONENTE_FIXE.forEach((k) => { rez[k] *= factor; });
      total = maxim;
      plafonAplicat = true;
    }
  }
  return { ...rez, total, plafon_aplicat: plafonAplicat, regula_id: r.id || null };
}

// ── Niveluri ──────────────────────────────────────────────────────────────
// serviciu (100) > subcategorie (15) > categorie (10) > global (0).
function scorRegulaNivel(r, ctx) {
  if (r.nivel !== ctx.nivel) return null;
  if (r.serviciu_id && r.serviciu_id !== ctx.serviciuId) return null;
  if (r.categorie_id && r.categorie_id !== ctx.categorieId && r.categorie_id !== ctx.subcategorieId) return null;
  let scor = 0;
  if (r.serviciu_id) scor += 100;
  if (r.categorie_id) scor += r.categorie_id === ctx.subcategorieId ? 15 : 10;
  return scor;
}

function alegeRegulaNivel(reguli, ctx) {
  return alegeRegula(reguli, ctx, scorRegulaNivel);
}

// Ce intră în calcul pentru un nivel. Fără regulă activă: totul, ca înainte.
function normalizeazaRegulaNivel(r) {
  if (!r) {
    return {
      regula_id: null, nivel_activ: true, materiale: 'complet', coef_manopera: 1,
      include_curatenie: false, include_testare: false, include_raport_digital: false,
      articole_extra: [], timp_raspuns_ore: null,
    };
  }
  const materiale = MATERIALE_NIVEL.includes(r.materiale) ? r.materiale : 'complet';
  const articoleExtra = [];
  if (r.include_curatenie && r.articol_curatenie_id) articoleExtra.push({ optiune: 'curatenie', articol_id: r.articol_curatenie_id });
  if (r.include_testare && r.articol_testare_id) articoleExtra.push({ optiune: 'testare', articol_id: r.articol_testare_id });
  if (r.include_raport_digital && r.articol_raport_id) articoleExtra.push({ optiune: 'raport_digital', articol_id: r.articol_raport_id });
  return {
    regula_id: r.id || null,
    nivel_activ: r.nivel_activ !== false,
    materiale,
    coef_manopera: numar(r.coef_manopera, 1),
    include_curatenie: !!r.include_curatenie,
    include_testare: !!r.include_testare,
    include_raport_digital: !!r.include_raport_digital,
    articole_extra: articoleExtra,
    timp_raspuns_ore: numar(r.timp_raspuns_ore, null),
  };
}

module.exports = {
  REGULA_FIXE_IMPLICITA, COMPONENTE_FIXE, MATERIALE_NIVEL,
  scorRegulaFixa, alegeRegulaCosturiFixe, aplicaCosturiFixe,
  scorRegulaNivel, alegeRegulaNivel, normalizeazaRegulaNivel,
};
