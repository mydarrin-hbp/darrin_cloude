// lib/cauta-firma.js
// Datele unei firme din registrele publice: ANAF (România, PlatitorTvaRest)
// și VIES (UE). Mutat din api/public/cui-lookup.js (16 oct. 2026), ca să
// fie folosit și de api/admin/entitati-juridice.js („Completează din ANAF”),
// cu aceleași câmpuri. Fără chei API: ambele servicii sunt publice.
//
// Adresa ANAF (16 oct. 2026): vechea /PlatitorTvaRest/api/v9/ws/tva dă 404;
// adresa documentată pentru v9 e cea de mai jos. E scrisă doar aici și e
// folosită și de api/admin/integrari/testeaza.js.
// Atenție: pentru un CUI inexistent, v9 răspunde HTTP 404 cu corp JSON
// valid ({"found":[],"notFound":[cui]}) — deci 404 nu înseamnă automat
// adresă greșită; se citește corpul înainte de a decide.

const ANAF_URL = 'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva';
const VIES_URL = (tara, vat) => `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${tara}/vat/${vat}`;
const TARI_VIES = new Set(['DE', 'FR', 'BG']);
const FETCH_TIMEOUT_MS = 6000;

function curataCUI(cui) {
  return String(cui || '').trim().toUpperCase().replace(/^RO/, '').replace(/[^0-9]/g, '');
}

async function fetchCuTimeout(url, opts) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// Mesajele spuse utilizatorului când ANAF nu poate fi folosit, în RO și EN.
// - indisponibil: timeout, eroare de rețea, 5xx (sau 429) — trece de la sine;
// - configurare: 404 / 400 / alt cod sau format neașteptat — nu trece de la
//   sine, se vede în log cu codul HTTP și adresa apelată.
const MESAJE_ANAF = {
  anaf_indisponibil: {
    ro: 'ANAF nu răspunde acum. Încearcă din nou peste câteva minute; nimic nu s-a modificat.',
    en: 'ANAF is not responding right now. Try again in a few minutes; nothing was changed.',
  },
  anaf_configurare: {
    ro: 'Căutarea la ANAF nu funcționează (eroare de configurare). Am înregistrat problema; poți completa datele manual.',
    en: 'The ANAF lookup is not working (configuration error). We have logged the problem; you can fill in the details manually.',
  },
  // Pasul 11-P1: o firmă inactivă sau radiată nu se poate înscrie ca partener.
  firma_inactiva: {
    ro: 'Firma apare ca inactivă sau radiată la ANAF.',
    en: 'The company is listed as inactive or deregistered with ANAF.',
  },
};

function eroareAnaf(cod, detaliu) {
  const e = new Error(`ANAF: ${detaliu}`);
  e.cod = cod;
  return e;
}

async function cautaANAF(cuiNumeric) {
  const azi = new Date().toISOString().slice(0, 10);
  let res;
  try {
    res = await fetchCuTimeout(ANAF_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ cui: Number(cuiNumeric), data: azi }]),
    });
  } catch (err) {
    throw eroareAnaf('anaf_indisponibil', `${err.name === 'AbortError' ? 'timeout' : err.message} (${ANAF_URL})`);
  }
  if (!res.ok && (res.status >= 500 || res.status === 429)) {
    throw eroareAnaf('anaf_indisponibil', `HTTP ${res.status} (${ANAF_URL})`);
  }
  let json = null;
  try { json = await res.json(); } catch (_) { json = null; }
  const formatValid = json && Array.isArray(json.found);
  // 404 cu {"found":[],"notFound":[...]} = CUI negăsit, nu adresă greșită.
  const cuiNegasit = res.status === 404 && formatValid && Array.isArray(json.notFound);
  if ((!res.ok && !cuiNegasit) || !formatValid) {
    const detaliu = `HTTP ${res.status}${formatValid ? '' : ', format neașteptat'} (${ANAF_URL})`;
    console.error('[cauta-firma] ANAF eroare de configurare:', detaliu);
    throw eroareAnaf('anaf_configurare', detaliu);
  }
  const item = json.found[0];
  if (!item) return null;
  const dg = item.date_generale || {};
  // Pasul 11-P1: inactivă (stare_inactiv.statusInactivi) sau radiată
  // (stare_inactiv.dataRadiere / stare_inregistrare „RADIERE…”). Câmpurile
  // apar doar când ANAF le semnalează; o firmă activă are forma de dinainte.
  const si = item.stare_inactiv || {};
  const inactiva = si.statusInactivi === true;
  const radiata = !!si.dataRadiere || /RADIER|RADIAT/i.test(String(dg.stare_inregistrare || ''));
  // Pasul 11-P2b: sediul pe câmpuri (adresa_sediu_social), pentru adresa de
  // facturare din checkout; apare doar când ANAF trimite blocul.
  const ss = item.adresa_sediu_social || null;
  const sediu = ss ? {
    strada: [ss.sdenumire_Strada, ss.snumar_Strada ? 'nr. ' + ss.snumar_Strada : null, ss.sdetalii_Adresa].filter(Boolean).join(', ') || null,
    localitate: ss.sdenumire_Localitate || null,
    judet: ss.sdenumire_Judet || null,
    cod_postal: ss.scod_Postal || null,
  } : null;
  return {
    cui: dg.cui != null ? String(dg.cui) : null,
    denumire: dg.denumire || null,
    adresa: dg.adresa || null,
    nr_reg_com: dg.nrRegCom || null,
    tva_activ: !!item.inregistrare_scop_Tva?.scpTVA,
    ...(sediu ? { sediu } : {}),
    ...(inactiva ? { inactiva: true } : {}),
    ...(radiata ? { radiata: true } : {}),
  };
}

// Pasul 11-P1: verificarea făcută de rutele de înregistrare a partenerului.
//   { stare: 'activa' }                     → se continuă;
//   { stare: 'inactiva' }                   → înregistrarea se refuză (MESAJE_ANAF.firma_inactiva);
//   { stare: 'neverificata', motiv }        → ANAF nu răspunde sau CUI negăsit:
//                                             înregistrarea continuă, adminul verifică manual.
async function verificaFirmaRoLaAnaf(cui) {
  const cuiNumeric = curataCUI(cui);
  try {
    const r = await cautaANAF(cuiNumeric);
    if (!r) return { stare: 'neverificata', motiv: 'cui_negasit_anaf' };
    if (r.inactiva || r.radiata) return { stare: 'inactiva', anaf: r };
    return { stare: 'activa', anaf: r };
  } catch (err) {
    console.error('[cauta-firma] verificare ANAF la înregistrare:', err.message);
    return { stare: 'neverificata', motiv: err.cod || 'anaf_indisponibil' };
  }
}

async function cautaVIES(tara, vat) {
  const res = await fetchCuTimeout(VIES_URL(tara, vat), { method: 'GET' });
  if (!res.ok) throw new Error(`VIES a răspuns ${res.status}`);
  const json = await res.json();
  if (!json || json.isValid !== true) return null;
  return {
    denumire: json.name && json.name !== '---' ? json.name : null,
    adresa: json.address && json.address !== '---' ? json.address : null,
    tva_activ: true,
  };
}

module.exports = { ANAF_URL, MESAJE_ANAF, curataCUI, cautaANAF, cautaVIES, TARI_VIES, verificaFirmaRoLaAnaf };
