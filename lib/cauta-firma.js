// lib/cauta-firma.js
// Datele unei firme din registrele publice: ANAF (România, PlatitorTvaRest)
// și VIES (UE). Mutat din api/public/cui-lookup.js (16 oct. 2026), ca să
// fie folosit și de api/admin/entitati-juridice.js („Completează din ANAF”),
// cu aceleași câmpuri. Fără chei API: ambele servicii sunt publice.

const ANAF_URL = 'https://webservicesp.anaf.ro/PlatitorTvaRest/api/v9/ws/tva';
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

async function cautaANAF(cuiNumeric) {
  const azi = new Date().toISOString().slice(0, 10);
  const res = await fetchCuTimeout(ANAF_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([{ cui: Number(cuiNumeric), data: azi }]),
  });
  if (!res.ok) throw new Error(`ANAF a răspuns ${res.status}`);
  const json = await res.json();
  const item = json?.found?.[0];
  if (!item) return null;
  const dg = item.date_generale || {};
  return {
    cui: dg.cui != null ? String(dg.cui) : null,
    denumire: dg.denumire || null,
    adresa: dg.adresa || null,
    nr_reg_com: dg.nrRegCom || null,
    tva_activ: !!item.inregistrare_scop_Tva?.scpTVA,
  };
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

module.exports = { curataCUI, cautaANAF, cautaVIES, TARI_VIES };
