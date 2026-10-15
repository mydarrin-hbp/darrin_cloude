// lib/propune-reteta.js
// Rețetă propusă automat pentru un serviciu fără rețetă (pasul 8, 15 oct.
// 2026, decizie LM). Determinist, fără AI. Propunerea e o ciornă: nu se
// publică și nu intră în preț până n-o aprobă adminul dedicat
// (api/admin/ruta-incadrare.js → aproba_reteta).
//
// Fără date inventate: nicio linie nu primește cantitate, iar resursele noi
// nu primesc preț. Fiecare linie are un `motiv`, ca adminul să poată decide.
//
// Funcții pure: datele din baza de date vin prin `ref` (vezi propuneReteta).

const { normalizeazaNace, radaciniTitlu, asemanareTitlu } = require('./ruta-incadrare');

// Indicatorii de deviz tipici pentru o activitate Uniclass. Indicatorii „E*”
// și „RPI*” din normele românești nu au cod NACE sau Uniclass în
// devize_indicatoare, așa că legătura se face aici, explicit. Regulă de
// potrivire documentată în docs/regula-incadrare.md, de confirmat de LM.
const INDICATORI_PE_ACTIVITATE = {
  Ac_10_40_27: ['EF', 'EC', 'EA', 'EH'], // instalații electrice: tablou, cabluri, tuburi de protecție, probe
  Ac_10_40_63: ['RPIC', 'RPID', 'RPIE'], // conducte: conducte, armături, probe
  Ac_10_40_67: ['RPIC', 'RPID', 'RPIE'], // instalații sanitare: aceleași familii
};

// Ce lipsește din normele românești, pe teme (cuvinte din titlu). Liniile
// devin `resursa_noua`, fără cantitate și fără preț. Codurile Uniclass sunt
// din ediția NBS ianuarie 2026; `cod_sistem` (Ss_) se scrie pe articolul
// rețetei aprobate, dacă e activ în uniclass_codes.
const RESURSE_NOI_PE_TEMA = [
  {
    tema: 'fotovoltaic',
    cuvinte: ['fotovolt', 'photovolt', 'panouri solare', 'solar panel'],
    cod_sistem: 'Ss_70_10_70_35',
    resurse: [
      { tip_resursa: 'M', denumire: 'Module fotovoltaice', unitate_masura: 'buc', cod_uniclass: 'Pr_60_70_65_63' },
      { tip_resursa: 'M', denumire: 'Structură de montaj pentru module fotovoltaice', unitate_masura: 'set', cod_uniclass: 'Pr_20_85_32_80' },
      // Pr_20_29_03_78 a fost retras de NBS (2023-01); înlocuitorul pentru ancorele modulelor solare:
      { tip_resursa: 'M', denumire: 'Ancore de prindere pe acoperiș', unitate_masura: 'buc', cod_uniclass: 'Pr_80_77_27_72' },
      { tip_resursa: 'M', denumire: 'Protecție la supratensiune c.c.', unitate_masura: 'buc', cod_uniclass: 'Pr_65_72_27_62' },
      { tip_resursa: 'M', denumire: 'Invertor fotovoltaic', unitate_masura: 'buc', cod_uniclass: null },
      { tip_resursa: 'F', denumire: 'Punere în funcțiune sistem fotovoltaic', unitate_masura: 'ora', cod_uniclass: 'Ac_70_65' },
    ],
  },
];

const CATEGORIE_DIN_DENUMIRE = /\bcat(\.|egoria\b)/i; // „cat. I”, „categoria a IV-a”

function liniaGoala(extra) {
  return {
    tip: null, articol_id: null, resursa_id: null, denumire_propusa: null, tip_resursa: null,
    unitate_masura: null, consum_propus: null, cod_uniclass: null, cod_esco: null, motiv: null,
    decizie: 'in_asteptare', ...extra,
  };
}

/**
 * @param {object} p
 * @param {object} p.serviciu - { id, titlu, nace, cod_esco, cod_uniclass }
 * @param {object} p.ruta - { clasa?, esco?: { cod_esco, isco_group? } }
 * @param {Array}  p.asemanatoare - rezultatul serviciiAsemanatoare (cu de_copiat.articole)
 * @param {object} p.ref - {
 *   indicatori: [{ indicator_id, denumire_indicator, nace_cod, uniclass_ac_code }],
 *   articolePeIndicator: { <indicator_id>: [{ articol_id, simbol, varianta, denumire_articol, unitate_masura }] },
 *   articoleAsemanatoare: [{ articol_id, simbol, indicator_id, denumire_articol, unitate_masura, serviciu_titlu, nivel_potrivire }],
 *   resurseManopera: [{ resursa_id, cod_resursa, denumire_resursa, unitate_masura, esco_cod }],
 *   uniclassCoduri: Set | Array (codurile din uniclass_codes) }
 * @returns {{ linii: Array, rezumat: object }}
 */
function propuneReteta({ serviciu = {}, ruta = {}, asemanatoare = [], ref = {} } = {}) {
  const clasa = normalizeazaNace(ruta.clasa || serviciu.nace);
  const radacini = radaciniTitlu(serviciu.titlu);
  const uniclassCoduri = ref.uniclassCoduri instanceof Set ? ref.uniclassCoduri : new Set(ref.uniclassCoduri || []);
  const linii = [];

  // 1. Articole existente.
  // Indicatorii candidați: aceeași clasă NACE ca serviciul, cei tipici pentru
  // activitatea Uniclass a serviciului și cei folosiți de serviciile asemănătoare.
  const dinActivitate = new Set(INDICATORI_PE_ACTIVITATE[serviciu.cod_uniclass] || []);
  // Doar articolele serviciilor din aceeași clasă NACE (nivel_potrivire 0):
  // o grupă comună (43.2) nu ajunge — caloriferele nu intră în fotovoltaice.
  const articoleAsem = (ref.articoleAsemanatoare || []).filter((a) => a.nivel_potrivire === undefined || a.nivel_potrivire === 0);
  const dinAsemanatoare = new Set(articoleAsem.map((a) => a.indicator_id));
  const indicatori = (ref.indicatori || []).filter((i) => {
    const potrivireTitlu = [...radaciniTitlu(i.denumire_indicator)].some((r) => radacini.has(r));
    const aceeasiClasa = clasa && normalizeazaNace(i.nace_cod) === clasa;
    // aceeași clasă NACE contează doar dacă se potrivește și cu titlul sau cu activitatea
    return dinActivitate.has(i.indicator_id) || dinAsemanatoare.has(i.indicator_id) || (aceeasiClasa && potrivireTitlu);
  });
  const ordine = (id) => {
    const lista = INDICATORI_PE_ACTIVITATE[serviciu.cod_uniclass] || [];
    const k = lista.indexOf(id);
    return k < 0 ? lista.length : k;
  };
  indicatori.sort((a, b) => ordine(a.indicator_id) - ordine(b.indicator_id) || a.indicator_id.localeCompare(b.indicator_id));

  for (const ind of indicatori) {
    // Întâi articolul folosit de un serviciu asemănător; altfel cel mai
    // apropiat de titlu; la egalitate, primul simbol (variantă de referință).
    const dinAsem = articoleAsem.find((a) => a.indicator_id === ind.indicator_id);
    let articol = dinAsem || null;
    let motiv;
    if (dinAsem) {
      motiv = `Articolul ${dinAsem.simbol} e folosit de serviciul asemănător „${dinAsem.serviciu_titlu}”.`;
    } else {
      const candidati = (ref.articolePeIndicator || {})[ind.indicator_id] || [];
      articol = candidati
        .map((a) => ({ a, s: asemanareTitlu(serviciu.titlu, a.denumire_articol) }))
        .sort((x, y) => y.s - x.s || String(x.a.simbol).localeCompare(String(y.a.simbol)) || (x.a.varianta || 1) - (y.a.varianta || 1))
        .map((x) => x.a)[0] || null;
      const deCe = dinActivitate.has(ind.indicator_id)
        ? `indicatorul ${ind.indicator_id} („${ind.denumire_indicator}”) e tipic pentru activitatea ${serviciu.cod_uniclass}`
        : `indicatorul ${ind.indicator_id} („${ind.denumire_indicator}”) are aceeași clasă NACE (${clasa})`;
      motiv = articol
        ? `${deCe}; ${articol.simbol} e varianta propusă — alege articolul potrivit lucrării.`
        : `${deCe}; nu am găsit articole în indicator.`;
    }
    if (!articol) continue;
    linii.push(liniaGoala({
      tip: 'articol_existent', articol_id: articol.articol_id, denumire_propusa: articol.denumire_articol,
      unitate_masura: articol.unitate_masura || null, cod_uniclass: serviciu.cod_uniclass || null, motiv,
    }));
  }

  // 2. Manoperă: resurse F cu aceeași ocupație ESCO, altfel din aceeași grupă ESCO.
  const codEsco = ruta.esco?.cod_esco || serviciu.cod_esco || null;
  const grupaEsco = ruta.esco?.isco_group || (codEsco ? String(codEsco).slice(0, 4) : null);
  const manopera = ref.resurseManopera || [];
  const generica = (r) => (CATEGORIE_DIN_DENUMIRE.test(r.denumire_resursa) ? 1 : 0);
  const alege = (lista) => lista.slice().sort((a, b) => generica(a) - generica(b) || String(a.cod_resursa).localeCompare(String(b.cod_resursa)))[0] || null;
  const aceeasi = alege(manopera.filter((r) => codEsco && r.esco_cod === codEsco));
  const dinGrupa = aceeasi ? null : alege(manopera.filter((r) => grupaEsco && String(r.esco_cod || '').startsWith(grupaEsco)));
  const resursaF = aceeasi || dinGrupa;
  if (resursaF) {
    linii.push(liniaGoala({
      tip: 'resursa_existenta', resursa_id: resursaF.resursa_id, denumire_propusa: resursaF.denumire_resursa,
      tip_resursa: 'F', unitate_masura: resursaF.unitate_masura || null, cod_esco: resursaF.esco_cod || null,
      motiv: aceeasi
        ? `Manoperă cu aceeași ocupație ESCO (${codEsco}).`
        : `Manoperă din aceeași grupă ESCO (${grupaEsco}): ${resursaF.esco_cod}; nu există resursă pentru ${codEsco}.`,
    }));
  }

  // 3. Ce lipsește din normele românești: resurse noi, fără cantitate și fără preț.
  const teme = temePentruTitlu(serviciu.titlu);
  for (const tema of teme) {
    for (const r of tema.resurse) {
      const inTabel = r.cod_uniclass ? uniclassCoduri.has(r.cod_uniclass) : false;
      const notaUniclass = !r.cod_uniclass
        ? ' Fără cod Uniclass propus: îl alege adminul.'
        : inTabel ? '' : ` Codul ${r.cod_uniclass} nu e activ în uniclass_codes: se păstrează pe linie, nu pe resursă, până după importul Uniclass 2026.`;
      linii.push(liniaGoala({
        tip: 'resursa_noua', denumire_propusa: r.denumire, tip_resursa: r.tip_resursa, unitate_masura: r.unitate_masura,
        cod_uniclass: r.cod_uniclass, cod_esco: r.tip_resursa === 'F' ? codEsco : null,
        motiv: `Lipsește din normele românești (tema ${tema.tema}); fără cantitate și fără preț.${notaUniclass}`,
      }));
    }
  }

  return {
    linii,
    rezumat: {
      articole_existente: linii.filter((l) => l.tip === 'articol_existent').length,
      resurse_existente: linii.filter((l) => l.tip === 'resursa_existenta').length,
      resurse_noi: linii.filter((l) => l.tip === 'resursa_noua').length,
      cod_sistem: teme.find((t) => t.cod_sistem)?.cod_sistem || null,
    },
  };
}

// Temele (RESURSE_NOI_PE_TEMA) recunoscute în titlul unui serviciu.
function temePentruTitlu(titlu) {
  const mic = String(titlu || '').toLowerCase();
  return RESURSE_NOI_PE_TEMA.filter((t) => t.cuvinte.some((c) => mic.includes(c)));
}

// Aprobarea: nicio linie în așteptare, cel puțin o linie acceptată și
// fiecare linie acceptată / modificată are cantitate (consum_propus > 0).
function verificaAprobare(linii = []) {
  const erori = [];
  const asteptare = linii.filter((l) => l.decizie === 'in_asteptare');
  if (asteptare.length) {
    erori.push({ cod: 'LINII_IN_ASTEPTARE', mesaj_ro: `${asteptare.length} linii n-au încă o decizie.`, mesaj_en: `${asteptare.length} lines have no decision yet.` });
  }
  const acceptate = linii.filter((l) => l.decizie === 'acceptata' || l.decizie === 'modificata');
  const faraCantitate = acceptate.filter((l) => !(Number(l.consum_propus) > 0));
  if (faraCantitate.length) {
    erori.push({ cod: 'FARA_CANTITATE', mesaj_ro: `${faraCantitate.length} linii acceptate n-au cantitate.`, mesaj_en: `${faraCantitate.length} accepted lines have no quantity.` });
  }
  if (!acceptate.length) {
    erori.push({ cod: 'NICIO_LINIE', mesaj_ro: 'Nicio linie acceptată: rețeta ar fi goală.', mesaj_en: 'No accepted line: the recipe would be empty.' });
  }
  const noiFaraUnitate = acceptate.filter((l) => l.tip === 'resursa_noua' && (!l.unitate_masura || !l.tip_resursa || !l.denumire_propusa));
  if (noiFaraUnitate.length) {
    erori.push({ cod: 'RESURSA_INCOMPLETA', mesaj_ro: `${noiFaraUnitate.length} resurse noi n-au denumire, tip sau unitate de măsură.`, mesaj_en: `${noiFaraUnitate.length} new resources have no name, type or unit.` });
  }
  return { ok: erori.length === 0, erori };
}

/**
 * Planul de aprobare: rândurile devize_retete ale articolului nou.
 * articol_existent → rețeta lui, cu consumul înmulțit cu cantitatea liniei;
 * resursa_existenta → resursa, cu cantitatea liniei; resursa_noua → resursa
 * de creat. Aceeași resursă din mai multe linii se adună.
 * @param {Array} linii - liniile acceptate / modificate
 * @param {object} reteteArticole - { <articol_id>: [{ resursa_id, consum_specific }] }
 * @returns {{ existente: [{ resursa_id, consum_specific }], noi: [{ linie, consum_specific }] }}
 */
function planAprobare(linii = [], reteteArticole = {}) {
  const peResursa = new Map();
  const adauga = (id, consum) => peResursa.set(id, (peResursa.get(id) || 0) + consum);
  const noi = [];
  for (const l of linii) {
    if (l.decizie !== 'acceptata' && l.decizie !== 'modificata') continue;
    const cant = Number(l.consum_propus);
    if (l.tip === 'articol_existent') {
      for (const r of reteteArticole[l.articol_id] || []) adauga(r.resursa_id, (Number(r.consum_specific) || 0) * cant);
    } else if (l.tip === 'resursa_existenta') {
      adauga(l.resursa_id, cant);
    } else if (l.tip === 'resursa_noua') {
      noi.push({ linie: l, consum_specific: cant });
    }
  }
  const rotunjit = (n) => Math.round(n * 1e6) / 1e6;
  return {
    existente: [...peResursa].map(([resursa_id, c]) => ({ resursa_id, consum_specific: rotunjit(c) })),
    noi: noi.map((n) => ({ ...n, consum_specific: rotunjit(n.consum_specific) })),
  };
}

module.exports = { propuneReteta, verificaAprobare, planAprobare, temePentruTitlu, INDICATORI_PE_ACTIVITATE, RESURSE_NOI_PE_TEMA };
