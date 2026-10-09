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
const { alegeRegulaCosturiFixe, aplicaCosturiFixe } = require('./reguli-flexibile');

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
  // Varianta 2 "Echipă" (24 august 2026) — manopera și extrasele atașate
  // fiecărui cod ESCO folosit, urmărite separat, ca un serviciu cu rețetă
  // multi-ESCO (mai mult de o meserie) să poată fi ulterior alocat pe mai
  // mulți specialiști, nu doar unui singur partener. Azi toate rețetele
  // reale au un singur cod ESCO — hărțile astea au mereu o singură intrare,
  // egală cu `manopera`/`extras_manopera` de mai jos.
  const manoperaPerEsco = new Map();
  const extrasPerEsco = new Map();
  // Reguli flexibile (9 oct. 2026): orele de manoperă și componentele
  // costurilor fixe, pe meserie — necesare pentru prag de durată și defalcare.
  const orePerEsco = new Map();
  const extrasComponentePerEsco = new Map();
  let manopera = 0;
  let materiale = 0;
  let utilaj = 0;
  const resurseFaraPret = [];
  // Materiale mărunte / consumabile exprimate în procente (UM „%"),
  // conform indicatoarelor de deviz RO: consumul NU e o cantitate de
  // înmulțit cu un preț unitar, ci un procent din valoarea materialelor
  // articolului (ex. 5 = 5% din valoarea materialelor). Se aplică după ce
  // valoarea materialelor e cunoscută — vezi mai jos, după buclă.
  let procentMaterialeMarunte = 0;

  for (const { resursa_id, consum_specific } of retete) {
    const res = resursaMap.get(resursa_id);
    if (!res) continue;
    const consum = parseFloat(consum_specific) || 0;

    if (res.tip_resursa === 'M' && _esteProcent(res.unitate_masura)) {
      procentMaterialeMarunte += consum;
      continue;
    }

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
      const valoareManopera = consum * (parseFloat(tarifExista.cost_ora) || 0);
      manopera += valoareManopera;
      manoperaPerEsco.set(res.esco_cod, (manoperaPerEsco.get(res.esco_cod) || 0) + valoareManopera);
      orePerEsco.set(res.esco_cod, (orePerEsco.get(res.esco_cod) || 0) + consum);
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

  // Baza procentului = valoarea materialelor cu preț din acest articol.
  // Dacă unele materiale n-au încă preț, baza e incompletă — semnalăm
  // onest, nu ascundem (costul mărunt va crește când se completează prețurile).
  const materialeMarunte = materiale * procentMaterialeMarunte / 100;
  const bazaIncompleta = procentMaterialeMarunte > 0 && resurseFaraPret.some((r) => r.tip === 'M');
  if (procentMaterialeMarunte > 0 && materiale === 0) {
    resurseFaraPret.push({
      cod_resursa: null, denumire: 'Materiale mărunte (%)', tip: 'M', unitate: '%',
      consum: procentMaterialeMarunte, esco_cod: null, motiv: 'procent_fara_baza_materiale',
    });
  }
  materiale += materialeMarunte;

  // Componentele G13 (deplasare/uzură scule/consumabile mici/echipament
  // testare) sunt costuri fixe per intervenție ale meseriei, nu costuri
  // orare — se adaugă o singură dată per meserie folosită în rețetă, nu
  // înmulțite cu fracțiuni mici de oră ca manopera propriu-zisă.
  let extrasManopera = 0;
  for (const codEsco of escoCodesFolosite) {
    const extrasEsco = await _extrasEsco(codEsco, taraCod);
    extrasManopera += extrasEsco;
    extrasPerEsco.set(codEsco, (extrasPerEsco.get(codEsco) || 0) + extrasEsco);
    extrasComponentePerEsco.set(codEsco, await _extrasComponente(codEsco, taraCod));
  }

  return {
    articol_id: articolId,
    manopera: Math.round(manopera * 100) / 100,
    extras_manopera: Math.round(extrasManopera * 100) / 100,
    total: Math.round((manopera + extrasManopera) * 100) / 100,
    cost_materiale: Math.round(materiale * 100) / 100,
    cost_utilaj: Math.round(utilaj * 100) / 100,
    materiale_marunte_procent: Math.round(procentMaterialeMarunte * 1000) / 1000,
    cost_materiale_marunte: Math.round(materialeMarunte * 100) / 100,
    materiale_marunte_baza_incompleta: bazaIncompleta,
    esco_codes_folosite: [...escoCodesFolosite],
    manopera_per_esco: Object.fromEntries(manoperaPerEsco),
    extras_per_esco: Object.fromEntries(extrasPerEsco),
    ore_per_esco: Object.fromEntries(orePerEsco),
    extras_componente_per_esco: Object.fromEntries(extrasComponentePerEsco),
    resurse_fara_pret: resurseFaraPret,
  };
}

function _esteProcent(um) {
  return String(um || '').trim() === '%';
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
// Aceleași valori ca _extrasEsco, pe componente (adunate în aceeași ordine
// dau exact suma de mai sus).
async function _extrasComponente(codEsco, taraCod) {
  const tarif = await _tarifEsco(codEsco, taraCod);
  if (!tarif) return { deplasare: 0, uzura: 0, consumabile: 0, testare: 0 };
  return {
    deplasare: parseFloat(tarif.cost_deplasare) || 0,
    uzura: parseFloat(tarif.cost_uzura_scule) || 0,
    consumabile: parseFloat(tarif.cost_consumabile_mici) || 0,
    testare: parseFloat(tarif.cost_echipament_testare) || 0,
  };
}

// ── Reguli flexibile: citire din baza de date ─────────────────────────────
// Dacă tabelele nu există încă (migrare neaplicată) sau citirea eșuează,
// motorul folosește regula implicită: prețurile rămân cele de azi.
let _avertizatReguliFixe = false;
async function _reguliCosturiFixe(taraCod) {
  const { data, error } = await supabaseAdmin
    .from('reguli_costuri_fixe')
    .select('id, tara_cod, regiune, categorie_id, cod_esco, serviciu_id, coef_deplasare, coef_uzura, coef_consumabile, coef_testare, prag_durata_ore, coef_sub_prag, plafon_pct_din_manopera, activ, valabil_de, valabil_pana, updated_at')
    .eq('activ', true)
    .in('tara_cod', ['ALL', taraCod]);
  if (error) {
    if (!_avertizatReguliFixe) { console.warn('[calculeaza-cost-recipe] reguli_costuri_fixe indisponibile, se folosește regula implicită:', error.message); _avertizatReguliFixe = true; }
    return [];
  }
  return data || [];
}

async function _contextNivel(nivelId) {
  const { data: nivel } = await supabaseAdmin
    .from('catalog_niveluri').select('serviciu_id, nivel').eq('id', nivelId).maybeSingle();
  if (!nivel?.serviciu_id) return { serviciuId: null, categorieId: null, subcategorieId: null, nivel: nivel?.nivel || null };
  const { data: serv } = await supabaseAdmin
    .from('catalog_servicii').select('categorie_id, subcategorie_id').eq('id', nivel.serviciu_id).maybeSingle();
  return { serviciuId: nivel.serviciu_id, categorieId: serv?.categorie_id || null, subcategorieId: serv?.subcategorie_id || null, nivel: nivel.nivel };
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
//
// EXTINDERE (22 August 2026, "preț per cantitate reală comandată") —
// parametru nou `cantitate`. IMPORTANT: doar partea VARIABILĂ (manoperă,
// materiale, utilaj — toate proporționale cu cât se comandă) se înmulțește
// cu cantitatea. `extras_manopera` (deplasare/uzură scule/consumabile mici/
// echipament testare, din `calculeazaCostRecipeArticol`) e deja proiectat
// ca cost FIX per intervenție (vezi comentariul de acolo) — NU se scalează,
// altfel s-ar strica exact semantica "cost minim de intervenție" pentru care
// a fost construit. `cantitate` implicit 1 păstrează comportamentul dinainte
// identic (retrocompatibil cu `recalculeaza_pret`, care nu-l trimite).
async function calculeazaCostNivel({ nivelId, taraCod = 'RO', cantitate = 1, regiune = null }) {
  const cantitateNum = Number(cantitate);
  if (!Number.isFinite(cantitateNum) || cantitateNum <= 0) {
    throw new Error('cantitate trebuie să fie un număr pozitiv');
  }

  const { data: articole, error } = await supabaseAdmin
    .from('devize_articole')
    .select('articol_id')
    .eq('catalog_nivel_id', nivelId);
  if (error) throw error;

  if (!articole?.length) {
    return {
      nivel_id: nivelId, tara_cod: taraCod, cantitate: cantitateNum,
      cost_baza_servicii: 0, cost_materiale: 0, cost_utilaj: 0,
      articole: [], resurse_fara_pret: [{ motiv: 'niciun_articol_legat_de_nivel' }],
    };
  }

  let manoperaVariabila = 0;
  let extrasFix = 0;
  let cost_materiale = 0;
  let cost_utilaj = 0;
  const resurseFaraPret = [];
  const rezultatePerArticol = [];
  // Varianta 2 "Echipă" (24 august 2026) — agregă manopera per cod ESCO
  // peste toate articolele nivelului; extras-ul fix e luat o singură dată
  // per ESCO (vezi mai jos).
  const manoperaPerEscoTotal = new Map();
  const extrasPerEscoTotal = new Map();
  // Pentru regulile de costuri fixe: componentele articolului care a dat
  // maximul pe meserie și orele de manoperă ale meseriei, pe tot nivelul.
  const extrasComponenteTotal = new Map();
  const orePerEscoTotal = new Map();

  // Costuri fixe o singură dată pe meserie (6 octombrie 2026, decizie LM):
  // înainte, extras_manopera (deplasare/uzură scule/consumabile mici/
  // echipament testare) se aduna pe fiecare articol — un nivel cu 3 articole
  // ale aceluiași electrician plătea deplasarea de 3 ori. Acum, per cod ESCO
  // se păstrează valoarea maximă (același tarif → aceeași valoare), iar
  // extrasFix = suma pe meserii distincte. Un nivel cu 1 articol dă exact
  // același rezultat ca înainte.
  let extrasFaraEsco = 0;

  for (const { articol_id } of articole) {
    const r = await calculeazaCostRecipeArticol({ articolId: articol_id, taraCod });
    manoperaVariabila += r.manopera;
    cost_materiale += r.cost_materiale;
    cost_utilaj += r.cost_utilaj;
    r.resurse_fara_pret.forEach((x) => resurseFaraPret.push({ ...x, articol_id }));
    rezultatePerArticol.push({ articol_id, ...r });
    for (const [esco, val] of Object.entries(r.manopera_per_esco || {})) {
      manoperaPerEscoTotal.set(esco, (manoperaPerEscoTotal.get(esco) || 0) + val);
    }
    for (const [esco, ore] of Object.entries(r.ore_per_esco || {})) {
      orePerEscoTotal.set(esco, (orePerEscoTotal.get(esco) || 0) + ore);
    }
    const extrasPerEsco = Object.entries(r.extras_per_esco || {});
    for (const [esco, val] of extrasPerEsco) {
      const anterior = extrasPerEscoTotal.get(esco) || 0;
      extrasPerEscoTotal.set(esco, Math.max(anterior, val));
      if (!extrasComponenteTotal.has(esco) || val > anterior) {
        extrasComponenteTotal.set(esco, (r.extras_componente_per_esco || {})[esco] || { deplasare: val, uzura: 0, consumabile: 0, testare: 0 });
      }
    }
    // Fallback: extras fără defalcare pe ESCO — adunat ca înainte, ca să nu se piardă costuri.
    if (!extrasPerEsco.length && r.extras_manopera > 0) extrasFaraEsco += r.extras_manopera;
  }

  // Reguli de costuri fixe (9 oct. 2026): pe fiecare meserie, regula cea mai
  // specifică (serviciu > cod ESCO > categorie > țară > ALL). Fără regulă,
  // aplicaCosturiFixe întoarce exact valorile tarifului (coeficienți 1).
  const reguliFixe = extrasPerEscoTotal.size ? await _reguliCosturiFixe(taraCod) : [];
  const ctx = reguliFixe.length ? await _contextNivel(nivelId) : {};
  const fixePerEsco = new Map();
  extrasFix = extrasFaraEsco;
  for (const esco of extrasPerEscoTotal.keys()) {
    const regula = reguliFixe.length ? alegeRegulaCosturiFixe(reguliFixe, { ...ctx, codEsco: esco, taraCod, regiune }) : null;
    const aplicat = aplicaCosturiFixe(
      extrasComponenteTotal.get(esco),
      { ore: (orePerEscoTotal.get(esco) || 0) * cantitateNum, manopera: (manoperaPerEscoTotal.get(esco) || 0) * cantitateNum },
      regula,
    );
    fixePerEsco.set(esco, aplicat);
    extrasFix += aplicat.total;
  }

  const cost_baza_servicii = (manoperaVariabila * cantitateNum) + extrasFix;

  const manoperaPerEsco = {};
  const escoUnite = new Set([...manoperaPerEscoTotal.keys(), ...extrasPerEscoTotal.keys()]);
  for (const esco of escoUnite) {
    const val = (manoperaPerEscoTotal.get(esco) || 0) * cantitateNum + (fixePerEsco.get(esco)?.total || 0);
    manoperaPerEsco[esco] = Math.round(val * 100) / 100;
  }

  // Defalcarea costului de bază, pentru afișare și pentru venitul partenerului.
  const r2 = (n) => Math.round(n * 100) / 100;
  const sumaComp = (k) => [...fixePerEsco.values()].reduce((acc, f) => acc + f[k], 0);
  const defalcare = {
    manopera: 0,
    deplasare: r2(sumaComp('deplasare')),
    uzura: r2(sumaComp('uzura')),
    consumabile: r2(sumaComp('consumabile')),
    testare: r2(sumaComp('testare')),
    alte_costuri_fixe: r2(extrasFaraEsco),
    total: r2(cost_baza_servicii),
  };
  // Manopera primește restul, ca suma componentelor rotunjite să fie exact totalul.
  defalcare.manopera = r2(defalcare.total - defalcare.deplasare - defalcare.uzura - defalcare.consumabile - defalcare.testare - defalcare.alte_costuri_fixe);
  const reguliFolosite = {};
  for (const [esco, f] of fixePerEsco) reguliFolosite[esco] = { regula_id: f.regula_id, plafon_aplicat: f.plafon_aplicat };

  return {
    nivel_id: nivelId, tara_cod: taraCod, cantitate: cantitateNum,
    cost_baza_servicii: Math.round(cost_baza_servicii * 100) / 100,
    cost_materiale: Math.round(cost_materiale * cantitateNum * 100) / 100,
    cost_utilaj: Math.round(cost_utilaj * cantitateNum * 100) / 100,
    manopera_per_esco: manoperaPerEsco,
    defalcare_cost_baza: defalcare,
    reguli_costuri_fixe: reguliFolosite,
    articole: rezultatePerArticol,
    resurse_fara_pret: resurseFaraPret,
  };
}

module.exports = { calculeazaCostRecipeArticol, calculeazaCostNivel };
