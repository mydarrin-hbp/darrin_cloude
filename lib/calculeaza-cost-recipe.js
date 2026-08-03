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
// Al doilea gol genuin: doar resursele de tip 'F' (Forță de muncă) au sursă
// reală de preț (esco_cod -> manopera_costuri, cu cele 5 componente din
// G13). Resursele 'M' (Materiale) și 'U' (Utilaje) nu au NICIO tabelă de
// tarife conectată azi — raportate explicit ca "fără preț", nu estimate.

const { supabaseAdmin } = require('./supabaseAdmin');

async function calculeazaCostRecipeArticol({ articolId, taraCod = 'RO' }) {
  const { data: retete, error: reteteErr } = await supabaseAdmin
    .from('devize_retete')
    .select('resursa_id, consum_specific')
    .eq('articol_id', articolId);
  if (reteteErr) throw reteteErr;
  if (!retete?.length) {
    return { articol_id: articolId, manopera: 0, extras_manopera: 0, total: 0, resurse_fara_pret: [], esco_codes_folosite: [] };
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

module.exports = { calculeazaCostRecipeArticol };
