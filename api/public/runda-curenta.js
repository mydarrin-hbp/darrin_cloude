// /api/public/runda-curenta.js
// Runda de finanțare deschisă, pentru pagina publică Investitori (pasul 11-J,
// 21 oct. 2026). GET, fără date personale, cu cache scurt (5 minute).
//
// Doar runda deschisă cu vizibila_public = true; altfel { ok, runda: null }
// și pagina își păstrează textul fără rundă. Valorile calculate vin din
// lib/runda-finantare.js. Progresul (suma subscrierilor APROBATE) apare doar
// dacă runda are afiseaza_progres = true. Nicio dată despre investitori.
//
// Răspuns: { ok, runda: null | { cod, denumire_ro, denumire_en, descriere_ro,
//   descriere_en, stare, data_start, data_sfarsit, moneda, suma_tinta,
//   investitie_minima, pret_actiune, equity_oferit_pct, post_money, tickete,
//   instrumente, progres?: { stranse, pct } } }

const R = require('../../lib/runda-finantare');

const CACHE_SECUNDE = 300;
let cache = null; // { la, corp }

async function construieste() {
  const r = await R.rundaDeschisa();
  if (!r || r.vizibila_public !== true) return { ok: true, runda: null };
  const c = R.calculeaza(r);
  if (!c) return { ok: true, runda: null };
  const runda = {
    cod: r.cod, denumire_ro: r.denumire_ro, denumire_en: r.denumire_en,
    descriere_ro: r.descriere_ro || null, descriere_en: r.descriere_en || null,
    stare: r.stare, data_start: r.data_start || null, data_sfarsit: r.data_sfarsit || null,
    moneda: r.moneda, suma_tinta: Number(r.suma_tinta),
    investitie_minima: R.num(r.investitie_minima),
    pret_actiune: c.pret_actiune, equity_oferit_pct: c.equity_oferit_pct, post_money: c.post_money,
    tickete: Array.isArray(r.tickete) && r.tickete.length ? r.tickete.map(Number) : null,
    instrumente: Array.isArray(r.instrumente) ? r.instrumente : [],
  };
  if (r.afiseaza_progres === true) {
    const t = await R.totaluriRunda(r.id, ['aprobat']);
    runda.progres = { stranse: t.suma, pct: Math.min(100, Math.round((t.suma / Number(r.suma_tinta)) * 10000) / 100) };
  }
  return { ok: true, runda };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const acum = Date.now();
  if (cache && acum - cache.la < CACHE_SECUNDE * 1000) {
    res.setHeader('Cache-Control', `public, max-age=${CACHE_SECUNDE}, s-maxage=${CACHE_SECUNDE}`);
    return res.status(200).json(cache.corp);
  }
  try {
    const corp = await construieste();
    cache = { la: acum, corp };
    res.setHeader('Cache-Control', `public, max-age=${CACHE_SECUNDE}, s-maxage=${CACHE_SECUNDE}`);
    return res.status(200).json(corp);
  } catch (err) {
    console.error('[runda-curenta]', err);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, runda: null });
  }
}

module.exports = handler;
// Doar pentru teste.
module.exports._golesteCache = () => { cache = null; };
