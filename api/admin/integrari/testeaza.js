// /api/admin/integrari/testeaza.js
// Testează o configurare de integrare — ONEST, nu simulat. Pentru
// categoriile care au deja o sursă reală în platformă (ANAF pentru
// date_companii_ro, VIES pentru vat, ipapi.co pentru geolocalizare —
// aceleași folosite în api/public/cui-lookup.js și myd-geo.js), rulează un
// test real de conectivitate/protocol. Pentru orice altă categorie, fără
// un furnizor real configurat cu API propriu, răspunde clar că testarea
// automată nu e disponibilă — nu inventează un "✅ Conectat" fals.
//
// Body: { id }

const { requireAuth } = require('../../../lib/auth-middleware');
const { supabaseAdmin } = require('../../../lib/supabaseAdmin');

const FETCH_TIMEOUT_MS = 6000;

async function fetchCuTimeout(url, opts) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// Verifică doar că API-ul e viu și vorbește protocolul așteptat — nu caută
// o firmă anume (nu presupunem un CUI real "corect" pentru orice mediu).
async function testeazaAnaf() {
  const azi = new Date().toISOString().slice(0, 10);
  const res = await fetchCuTimeout('https://webservicesp.anaf.ro/PlatitorTvaRest/api/v9/ws/tva', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([{ cui: 1, data: azi }]),
  });
  if (!res.ok) throw new Error(`ANAF a răspuns ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json?.found) || !Array.isArray(json?.notFound)) throw new Error('Răspuns ANAF în format neașteptat');
  return 'ANAF răspunde corect (format valid).';
}

async function testeazaVies() {
  const res = await fetchCuTimeout('https://ec.europa.eu/taxation_customs/vies/rest-api/ms/DE/vat/000000000', { method: 'GET' });
  if (!res.ok) throw new Error(`VIES a răspuns ${res.status}`);
  const json = await res.json();
  if (typeof json?.isValid !== 'boolean') throw new Error('Răspuns VIES în format neașteptat');
  return 'VIES răspunde corect (format valid).';
}

async function testeazaGeolocalizare() {
  const res = await fetchCuTimeout('https://ipapi.co/json/', { method: 'GET' });
  if (!res.ok) throw new Error(`ipapi.co a răspuns ${res.status}`);
  const json = await res.json();
  if (!json?.country_code) throw new Error('Răspuns ipapi.co în format neașteptat');
  return 'ipapi.co răspunde corect.';
}

const TESTE_REALE = {
  date_companii_ro: testeazaAnaf,
  vat: testeazaVies,
  geolocalizare: testeazaGeolocalizare,
};

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id este obligatoriu' });

  const { data: integrare, error: getErr } = await supabaseAdmin
    .from('integrari_furnizori')
    .select('id, categorie, api_key_criptat')
    .eq('id', id)
    .maybeSingle();
  if (getErr || !integrare) return res.status(404).json({ error: 'Integrarea nu există' });

  const testFn = TESTE_REALE[integrare.categorie];
  let rezultat;
  if (!testFn) {
    rezultat = {
      ok: false,
      motiv: integrare.api_key_criptat
        ? 'Testare automată nu e disponibilă pentru această categorie — necesită implementare specifică furnizorului configurat.'
        : 'Testare automată nu e disponibilă pentru această categorie și nicio cheie API nu e configurată încă.',
    };
  } else {
    try {
      const mesaj = await testFn();
      rezultat = { ok: true, mesaj };
    } catch (err) {
      rezultat = { ok: false, motiv: err.message || 'Test eșuat' };
    }
  }

  await supabaseAdmin
    .from('integrari_furnizori')
    .update({
      ultima_verificare_la: new Date().toISOString(),
      ultima_verificare_status: rezultat.ok ? 'ok' : 'eroare',
    })
    .eq('id', id);

  return res.status(200).json(rezultat);
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
