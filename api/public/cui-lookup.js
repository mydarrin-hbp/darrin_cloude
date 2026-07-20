// /api/public/cui-lookup.js
// T6: auto-completare date firmă din CUI (România, ANAF) / VAT ID (UE, VIES).
// Public — apelat atât din pagina publică (înainte de cont) cât și din
// wizard-ul real de partener (după autentificare), deci nu trece prin
// requireAuth. Nu ține nicio cheie API — ambele servicii sunt gratuite,
// publice, fără autentificare.
//
// POST { tara, cui }
//   tara==='RO'          → ANAF PlatitorTvaRest (CUI românesc)
//   tara in {DE,FR,BG}   → VIES (VAT ID, țări membre UE active pe platformă)
//   tara==='MD' / eșec   → { ok:false, manual:true } — front-end-ul cade pe
//                          completare manuală, cerută explicit de spec.

const { checkRateLimit } = require('../../lib/rate-limit');

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
    denumire: dg.denumire || null,
    adresa: dg.adresa || null,
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const allowed = await checkRateLimit(req, { key: 'cui-lookup', limit: 20, windowSeconds: 600 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.' });

  const { tara, cui } = req.body || {};
  if (!tara || typeof tara !== 'string') return res.status(400).json({ error: 'tara este obligatorie' });
  if (!cui || typeof cui !== 'string') return res.status(400).json({ error: 'cui este obligatoriu' });

  try {
    if (tara === 'RO') {
      const cuiNumeric = curataCUI(cui);
      if (!cuiNumeric) return res.status(400).json({ error: 'CUI invalid' });
      const rezultat = await cautaANAF(cuiNumeric);
      if (!rezultat) return res.status(200).json({ ok: false, manual: true, motiv: 'CUI negăsit în registrul ANAF' });
      return res.status(200).json({ ok: true, ...rezultat });
    }

    if (TARI_VIES.has(tara)) {
      const vat = curataCUI(cui);
      if (!vat) return res.status(400).json({ error: 'VAT ID invalid' });
      const rezultat = await cautaVIES(tara, vat);
      if (!rezultat) return res.status(200).json({ ok: false, manual: true, motiv: 'VAT ID negăsit/invalid în VIES' });
      return res.status(200).json({ ok: true, ...rezultat });
    }

    // MD (și orice altă țară fără sursă publică de verificare) — fallback manual explicit.
    return res.status(200).json({ ok: false, manual: true, motiv: 'Fără sursă publică de verificare pentru această țară' });
  } catch (err) {
    console.error('[cui-lookup]', tara, err.message);
    // ANAF/VIES sunt cunoscute ca instabile intermitent — eșecul de rețea nu
    // e o eroare de request, e exact cazul de fallback manual cerut de spec.
    return res.status(200).json({ ok: false, manual: true, motiv: 'Serviciul de verificare este temporar indisponibil' });
  }
};
