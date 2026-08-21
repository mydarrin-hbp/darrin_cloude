// lib/calculeaza-cost-recipe.js
// G14 (25 Iulie 2026) — motorul real de calcul cost pe rețetă Uniclass/ESCO,
// peste tabelele deja existente dar niciodată conectate: devize_articole
// (articol de lucru, cod Uniclass) <-> devize_retete (consum_specific) <->
// devize_resurse (resursă: manoperă/material/utilaj, cod ESCO pentru F).
//
// GOL GENUIN, verificat direct: devize_articole.catalog_nivel_id (coloana
// care ar lega un articol de rețetă de un nivel real din catalog_niveluri)
// e NULL pentru toate cele 8 articole existente — nicio rețetă nu e azi
// legată de vreun serviciu real din catalog. Nu inventăm această legătură
// aici (ar fi o decizie de business, nu de cod) — construim doar motorul de
// calcul, verificabil pe datele reale deja existente (rețete importate din
// indicatoare de deviz RO), gata de folosit în ziua în care mapping-ul
// catalog_nivel_id se populează.
//
// EXTINDERE (19 August 2026): golul de mai sus s-a populat parțial —
// catalog_nivel_id e azi setat pe 5 din 21.366 articole (cele 5 „servicii
// pilot autonome": mutări/reparații utilaje agricole/service moto/turnare
// beton/grădinărit). Adăugat calculeazaCostNivel(), care agregă toate
// articolele legate de un nivel real. Adăugate și sursele reale de tarif
// pentru 'U' (utilaje, din tarife_resurse) și 'M' (materiale, din
// tarife_materiale, tabel nou) — anterior ambele intrau necondiționat pe
// "fără preț". Ambele tabele sunt azi goale de prețuri reale (schelet, NULL
// peste tot) — motorul le citește corect, doar că azi nu găsește nimic,
// exact ca la manoperă înainte ca manopera_costuri să fie populat.

const { supabaseAdmin } = require('./supabaseAdmin');

async function calculeazaCostRecipeArticol({ articolId, taraCod = 'RO' }) {
  const { data: retete, error: reteteErr } = await supabaseAdmin
    .from('devize_retete')
    .select('resursa_id, consum_specific')
    .eq('articol_id', articolId);
  if (reteteErr) throw reteteErr;
  if (!retete?.length) {
    return {
      articol_id: articolId, manopera: 0, extras_manopera: 0, total: 0,
      cost_materiale: 0, cost_utilaj: 0, esco_codes_folosite: [],
      resurse_fara_pret: [{ cod_resursa: null, denumire: null, tip: null, unitate: null, consum: null, esco_cod: null, motiv: 'articol_fara_nicio_reteta' }],
    };
  }

  const resursaIds = retete.map((r) => r.resursa_id);
  const { data: resurse, error: resurseErr } = await supabaseAdmin
    .from('devize_resurse')
    .select('resursa_id, tip_resursa, cod_resursa, denumire_resursa, unitate_masura, esco_cod')
    .in('resursa_id', resursaIds);
  if (resurseErr) throw resurseErr;
  const resursaMap = new Map(resurse.map((r) => [r.resursa_id, r]));

  const escoCodesFolosite = new Set();
  let manopera = 0;
  let materiale = 0;
  let utilaj = 0;
  const resurseFaraPret = [];

  for (const { resursa_id, consum_specific } of retete) {
    const res = resursaMap.get(resursa_id);
    if (!res) continue;
    const consum = parseFloat(consum_specific) || 0;

    // FIX (testat, 3 August 2026): o resursă F cu esco_cod valid dar FĂRĂ
    // tarif real în manopera_costuri (meserie nou adăugată, tarif încă
    // neconfirmat) intra tăcut pe ramura de mai jos, adunând 0 la cost fără
    // nicio semnalare — motorul PĂREA că raportează onest "resurse_fara_pret"
    // în orice caz, dar de fapt doar resursele non-F sau fără esco_cod
    // ajungeau acolo. Acum se verifică explicit dacă tariful chiar există.
    const tarifExista = res.tip_resursa === 'F' && res.esco_cod ? await _tarifEsco(res.esco_cod, taraCod) : null;

    if (res.tip_resursa === 'F' && res.esco_cod && tarifExista) {
      escoCodesFolosite.add(res.esco_cod);
      // costul orar propriu-zis se adună mai jos, pe cod ESCO — evită
      // sumarea de mai multe ori a tarifului dacă aceeași meserie apare
      // pe mai multe rânduri de rețetă
      manopera += consum * (parseFloat(tarifExista.cost_ora) || 0);
    } else if (res.tip_resursa === 'U') {
      const tarifUtilaj = await _tarifResursa(res.resursa_id, taraCod);
      if (tarifUtilaj && tarifUtilaj.pret_unitar != null) {
        utilaj += consum * (parseFloat(tarifUtilaj.pret_unitar) || 0);
      } else {
        resurseFaraPret.push({
          cod_resursa: res.cod_resursa, denumire: res.denumire_resursa,
          tip: res.tip_resursa, unitate: res.unitate_masura, consum, esco_cod: null,
          motiv: tarifUtilaj ? 'tarife_resurse_pret_unitar_null' : 'tarife_resurse_fara_rand',
        });
      }
    } else if (res.tip_resursa === 'M') {
      const tarifMaterial = await _tarifMaterial(res.resursa_id, taraCod);
      if (tarifMaterial && tarifMaterial.pret_unitar != null) {
        materiale += consum * (parseFloat(tarifMaterial.pret_unitar) || 0);
      } else {
        resurseFaraPret.push({
          cod_resursa: res.cod_resursa, denumire: res.denumire_resursa,
          tip: res.tip_resursa, unitate: res.unitate_masura, consum, esco_cod: null,
          motiv: tarifMaterial ? 'tarife_materiale_pret_unitar_null' : 'tarife_materiale_fara_rand',
        });
      }
    } else {
      resurseFaraPret.push({
        cod_resursa: res.cod_resursa, denumire: res.denumire_resursa,
        tip: res.tip_resursa, unitate: res.unitate_masura, consum,
        esco_cod: res.esco_cod || null,
        motiv: res.tip_resursa === 'F' && res.esco_cod ? 'esco_fara_tarif_in_manopera_costuri' : 'tip_resursa_neconectat_la_niciun_tarif',
      });
    }
  }

  // Componentele G13 (deplasare/uzură scule/consumabile mici/echipament
  // testare) sunt costuri fixe per intervenție ale meseriei, nu costuri
  // orare — se adaugă o singură dată per meserie folosită în rețetă, nu
  // înmulțite cu fracțiuni mici de oră ca manopera propriu-zisă.
  let extrasManopera = 0;
  for (const codEsco of escoCodesFolosite) {
    extrasManopera += await _extrasEsco(codEsco, taraCod);
  }

  return {
    articol_id: articolId,
    manopera: Math.round(manopera * 100) / 100,
    extras_manopera: Math.round(extrasManopera * 100) / 100,
    total: Math.round((manopera + extrasManopera) * 100) / 100,
    cost_materiale: Math.round(materiale * 100) / 100,
    cost_utilaj: Math.round(utilaj * 100) / 100,
    esco_codes_folosite: [...escoCodesFolosite],
    resurse_fara_pret: resurseFaraPret,
  };
}

const _cacheTarife = new Map();
async function _tarifEsco(codEsco, taraCod) {
  const key = `${codEsco}|${taraCod}`;
  if (_cacheTarife.has(key)) return _cacheTarife.get(key);
  const { data } = await supabaseAdmin
    .from('manopera_costuri')
    .select('cost_ora, cost_deplasare, cost_uzura_scule, cost_consumabile_mici, cost_echipament_testare')
    .eq('cod_esco', codEsco).eq('tara_cod', taraCod)
    .maybeSingle();
  _cacheTarife.set(key, data || null);
  return data;
}
async function _costOraEsco(codEsco, taraCod) {
  const tarif = await _tarifEsco(codEsco, taraCod);
  return tarif ? parseFloat(tarif.cost_ora) || 0 : 0;
}
async function _extrasEsco(codEsco, taraCod) {
  const tarif = await _tarifEsco(codEsco, taraCod);
  if (!tarif) return 0;
  return (parseFloat(tarif.cost_deplasare) || 0) + (parseFloat(tarif.cost_uzura_scule) || 0) +
         (parseFloat(tarif.cost_consumabile_mici) || 0) + (parseFloat(tarif.cost_echipament_testare) || 0);
}

const _cacheTarifResursa = new Map();
async function _tarifResursa(resursaId, taraCod) {
  const key = `${resursaId}|${taraCod}`;
  if (_cacheTarifResursa.has(key)) return _cacheTarifResursa.get(key);
  const { data } = await supabaseAdmin
    .from('tarife_resurse')
    .select('pret_unitar')
    .eq('resursa_id', resursaId).eq('tara_cod', taraCod).eq('activ', true)
    .maybeSingle();
  _cacheTarifResursa.set(key, data || null);
  return data;
}

const _cacheTarifMaterial = new Map();
async function _tarifMaterial(resursaId, taraCod) {
  const key = `${resursaId}|${taraCod}`;
  if (_cacheTarifMaterial.has(key)) return _cacheTarifMaterial.get(key);
  const { data } = await supabaseAdmin
    .from('tarife_materiale')
    .select('pret_unitar')
    .eq('resursa_id', resursaId).eq('tara_cod', taraCod).eq('activ', true)
    .maybeSingle();
  _cacheTarifMaterial.set(key, data || null);
  return data;
}

// EXTINDERE (19 August 2026) — agregă toate articolele de rețetă legate de
// un nivel real din catalog (catalog_niveluri, via devize_articole.
// catalog_nivel_id). Azi mereu 1 articol per nivel (cele 5 servicii pilot),
// dar proiectat pentru N — un nivel de catalog poate necesita mai multe
// articole tehnice de rețetă (ex. montaj + accesorii separate).
async function calculeazaCostNivel({ nivelId, taraCod = 'RO' }) {
  const { data: articole, error } = await supabaseAdmin
    .from('devize_articole')
    .select('articol_id')
    .eq('catalog_nivel_id', nivelId);
  if (error) throw error;

  if (!articole?.length) {
    return {
      nivel_id: nivelId, tara_cod: taraCod,
      cost_baza_servicii: 0, cost_materiale: 0, cost_utilaj: 0,
      articole: [], resurse_fara_pret: [{ motiv: 'niciun_articol_legat_de_nivel' }],
    };
  }

  let cost_baza_servicii = 0;
  let cost_materiale = 0;
  let cost_utilaj = 0;
  const resurseFaraPret = [];
  const rezultatePerArticol = [];

  for (const { articol_id } of articole) {
    const r = await calculeazaCostRecipeArticol({ articolId: articol_id, taraCod });
    cost_baza_servicii += r.total;
    cost_materiale += r.cost_materiale;
    cost_utilaj += r.cost_utilaj;
    r.resurse_fara_pret.forEach((x) => resurseFaraPret.push({ ...x, articol_id }));
    rezultatePerArticol.push({ articol_id, ...r });
  }

  return {
    nivel_id: nivelId, tara_cod: taraCod,
    cost_baza_servicii: Math.round(cost_baza_servicii * 100) / 100,
    cost_materiale: Math.round(cost_materiale * 100) / 100,
    cost_utilaj: Math.round(cost_utilaj * 100) / 100,
    articole: rezultatePerArticol,
    resurse_fara_pret: resurseFaraPret,
  };
}

module.exports = { calculeazaCostRecipeArticol, calculeazaCostNivel };
