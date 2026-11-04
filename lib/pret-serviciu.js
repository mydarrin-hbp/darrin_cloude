// lib/pret-serviciu.js
// Pasul 11-C2 (3 nov. 2026, regula LM): prețul unui serviciu (sau al unei
// închirieri) se calculează doar pe server, într-un singur loc, folosit de:
//   - api/public/calculeaza-pret-nivel.js — afișarea în configurare, coș, checkout;
//   - api/comenzi/creeaza.js — prețul pus pe comandă;
//   - lib/disponibilitate-adresa.js — verificarea din configurare și din coș.
// Ce vede clientul e exact prețul comenzii; nicio cifră din browser nu intră.
//
// Sursa costului de bază, pe nivelul ales (catalog_niveluri):
//   1. rețeta tehnică legată de nivel (devize_articole.catalog_nivel_id),
//      prin lib/calculeaza-cost-recipe.js — cele cu rețetă;
//   2. altfel, prețul nivelului din catalog_preturi pentru țara comenzii ×
//      cantitatea (servicii → manoperă, închirieri → utilaje);
//   3. altfel nu există preț real: { ok:false, motiv:'fara_pret' } — pagina
//      scrie „Prețul se stabilește prin deviz”, comanda directă e refuzată.
// Peste costul de bază: materialele opționale (lib/rezolva-addon-materiale.js)
// și formula publică din lib/calculeaza-pret.js (asigurare, comision,
// marketing, mentenanță, TVA, pragul minim), din backoffice_config pe țară.
// Discounturile partenerilor nu intră aici și nu apar în niciun răspuns.
//
//   calculeazaPretServiciu({ nivelId, cantitate, taraCod, regiune, addonMateriale })
//     -> { ok:true, sursa:'reteta'|'catalog', nivel, cost, addon, calc, defalcare, include }
//     -> { ok:false, motiv:'nivel_necunoscut'|'nivel_inactiv'|'fara_pret'|'addon_fara_pret', mesaj:{ro,en}, ... }

const { supabaseAdmin } = require('./supabaseAdmin');
const reteta = require('./calculeaza-cost-recipe');
const { calculeazaPret } = require('./calculeaza-pret');
const { rezolvaAddonMateriale } = require('./rezolva-addon-materiale');
const { codPentruCitire } = require('./regiune');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESAJE = {
  fara_pret: {
    ro: 'Acest serviciu nu are încă un preț fix. Cere un deviz.',
    en: 'This service does not have a fixed price yet. Ask for a quote.',
  },
  nivel_necunoscut: {
    ro: 'Nivelul ales nu mai este în catalog. Alege din nou nivelul serviciului.',
    en: 'The chosen level is no longer in the catalogue. Choose the service level again.',
  },
  nivel_inactiv: {
    ro: 'Acest nivel nu mai este disponibil pentru comandă. Alege alt nivel.',
    en: 'This level is no longer available to order. Choose another level.',
  },
};

function refuz(motiv, extra) {
  const m = MESAJE[motiv];
  return Object.assign({ ok: false, motiv, mesaj: { ro: m.ro, en: m.en } }, extra);
}

const r2 = (n) => Math.round(n * 100) / 100;

// Prețul nivelului din catalog_preturi, pentru țară (null dacă nu există).
async function pretCatalog(nivelId, taraCod) {
  const { data } = await supabaseAdmin
    .from('catalog_preturi').select('pret, tara_cod').eq('nivel_id', nivelId).eq('tara_cod', taraCod);
  const p = (data || []).map((x) => Number(x.pret)).find((x) => x > 0);
  return p > 0 ? p : null;
}

async function calculeazaPretServiciu({ nivelId, cantitate = 1, taraCod = 'RO', regiune = null, addonMateriale = [] } = {}) {
  if (typeof nivelId !== 'string' || !UUID.test(nivelId)) return refuz('nivel_necunoscut');
  const cant = Number(cantitate);
  const qty = Number.isFinite(cant) && cant > 0 ? cant : 1;
  const tara = String(taraCod || 'RO').toUpperCase();

  const { data: nivel } = await supabaseAdmin
    .from('catalog_niveluri').select('id, serviciu_id, nivel').eq('id', nivelId).maybeSingle();
  if (!nivel) return refuz('nivel_necunoscut');
  const { data: serv } = await supabaseAdmin
    .from('catalog_servicii').select('id, categorie, status_public').eq('id', nivel.serviciu_id).maybeSingle();
  if (!serv || serv.status_public === false) return refuz('nivel_necunoscut');

  // 1. Rețeta tehnică (dacă nivelul are articole legate).
  const regiuneCod = regiune ? await codPentruCitire(tara, regiune) : null;
  const cost = await reteta.calculeazaCostNivel({ nivelId, taraCod: tara, cantitate: qty, regiune: regiuneCod });
  const faraReteta = (cost.resurse_fara_pret || []).some((r) => r && r.motiv === 'niciun_articol_legat_de_nivel');
  let sursa = 'reteta';
  let baza;
  if (!faraReteta) {
    if (cost.nivel_activ === false) return refuz('nivel_inactiv');
    if (cost.resurse_fara_pret && cost.resurse_fara_pret.length) {
      return refuz('fara_pret', { resurse_fara_pret: cost.resurse_fara_pret.map((r) => ({ denumire: r.denumire, tip: r.tip, unitate: r.unitate })) });
    }
    baza = { cost_baza_servicii: cost.cost_baza_servicii, cost_materiale: cost.cost_materiale, cost_chirie_scule: cost.cost_utilaj };
  } else {
    // 2. Prețul nivelului din catalog × cantitatea.
    const pret = await pretCatalog(nivelId, tara);
    if (pret == null) return refuz('fara_pret');
    sursa = 'catalog';
    const suma = r2(pret * qty);
    baza = serv.categorie === 'inchirieri'
      ? { cost_baza_servicii: 0, cost_materiale: 0, cost_chirie_scule: suma }
      : serv.categorie === 'materiale'
      ? { cost_baza_servicii: 0, cost_materiale: suma, cost_chirie_scule: 0 }
      : { cost_baza_servicii: suma, cost_materiale: 0, cost_chirie_scule: 0 };
  }

  let addon;
  try {
    addon = await rezolvaAddonMateriale(addonMateriale, nivel.nivel, tara);
  } catch (e) {
    if (e.code === 'ADDON_FARA_PRET' || e.code === 'ADDON_INVALID') return { ok: false, motiv: 'addon_fara_pret', mesaj: { ro: e.message, en: 'An optional material you added has no price for this level or country. Remove it to continue.' }, cod: e.code };
    throw e;
  }

  const calc = await calculeazaPret({
    cost_baza_servicii: baza.cost_baza_servicii,
    cost_materiale: baza.cost_materiale + addon.cost_materiale,
    cost_chirie_scule: baza.cost_chirie_scule + addon.cost_utilaj,
    tara,
  });

  // Defalcarea afișată clientului: aceleași sume din care se compune prețul,
  // fără costuri interne (tarife de resurse, discounturi de partener).
  const taxePlatforma = r2(calc.comision_platforma + calc.cost_marketing + calc.cost_mentenanta);
  const inaintePrag = r2(calc.subtotal + taxePlatforma + calc.tva_suma);
  const defalcare = {
    cost_baza: calc.cost_baza,
    asigurare: calc.cost_asigurare,
    transport: r2(calc.cost_curier + calc.cost_transport_greutate + calc.cost_ajutor),
    taxe_platforma: taxePlatforma,
    tva_pct: calc.tva_pct,
    tva_suma: calc.tva_suma,
    prag_aplicat: calc.pret_final > inaintePrag,
  };

  return {
    ok: true, sursa, cantitate: qty, tara_cod: tara,
    nivel: { id: nivel.id, nivel: nivel.nivel, serviciu_id: nivel.serviciu_id, categorie: serv.categorie },
    cost: sursa === 'reteta' ? cost : null,
    addon, calc, defalcare,
    include: sursa === 'reteta' ? (cost.nivel_include || null) : null,
  };
}

module.exports = { calculeazaPretServiciu, pretCatalog, MESAJE };
