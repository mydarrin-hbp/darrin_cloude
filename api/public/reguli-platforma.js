// /api/public/reguli-platforma.js
// Sursa unică a regulilor afișate pe paginile publice (pasul 11-A, 17 oct.
// 2026): niciun termen, nicio țară și nicio metodă de plată nu se mai scrie
// de mână în pagini. GET, fără date personale, cu cache scurt (5 minute).
//
// Răspuns:
//   { ok,
//     tari: [{ tara_cod, tara_nume, moneda, prag_minim_comanda, metode_plata, termen_plata_partener_zile }],
//     metode_plata,                 // rândul global din metode_plata_config
//     confirmare_tacita_ore,        // lib/reguli-comenzi.js (aceeași constantă ca cron-ul)
//     termen_plata_partener_zile,   // backoffice_config, rândul ALL (decizie LM B3)
//     entitati: [{ denumire, tara_cod }] }
//
// Surse:
//   - țările cu checkout activ: tax_configurations (ca api/public/tari-active.js);
//   - pragul minim de comandă: tax_configurations.prag_minim_comanda, în moneda
//     țării — doar citit (regulile pragului se schimbă în pasul 11-C);
//   - metodele de plată: metode_plata_config (rândurile active, fără regiune
//     și fără categorie de serviciu);
//   - termenul de plată către partener: backoffice_config,
//     termen_plata_partener_zile (migrarea 2026-10-17_reguli_platforma.sql);
//   - entitățile juridice din footer: entitati_juridice_platforma, doar cele active.
//
// Fără valori de rezervă: ce lipsește din baza de date (sau nu s-a putut
// citi) vine null / listă goală, iar pagina lasă elementul gol. Un răspuns
// incomplet din cauza unei erori nu se păstrează în cache.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { FEREASTRA_TACITA_ORE } = require('../../lib/reguli-comenzi');

const CACHE_SECUNDE = 300;
let cache = null; // { la: ms, corp }

function numarSauNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function metodeSauNull(v) {
  return Array.isArray(v) && v.length ? v.map(String) : null;
}

async function citeste(promisiune) {
  try {
    const { data, error } = await promisiune;
    if (error) return { eroare: true, data: null };
    return { eroare: false, data: data || [] };
  } catch (e) {
    return { eroare: true, data: null };
  }
}

async function construiesteReguli() {
  const [taxe, metode, config, entitati] = await Promise.all([
    citeste(supabaseAdmin.from('tax_configurations')
      .select('tara_cod, tara_nume, moneda, prag_minim_comanda, checkout_activ')
      .eq('activ', true)),
    citeste(supabaseAdmin.from('metode_plata_config')
      .select('tara_cod, regiune, categorie_serviciu_slug, metode_acceptate')
      .eq('activ', true)),
    citeste(supabaseAdmin.from('backoffice_config')
      .select('cheie, valoare, tara_cod')
      .eq('cheie', 'termen_plata_partener_zile')),
    citeste(supabaseAdmin.from('entitati_juridice_platforma')
      .select('denumire, tara_cod')
      .eq('activa', true)
      .order('tara_cod', { ascending: true })),
  ]);

  // Metodele de plată: rândul global (fără țară) și, peste el, rândul țării.
  const randuriMetode = (metode.data || []).filter((r) => r.regiune == null && r.categorie_serviciu_slug == null);
  const metodeGlobal = metodeSauNull((randuriMetode.find((r) => r.tara_cod == null) || {}).metode_acceptate);
  const metodePeTara = (tara) => {
    const r = randuriMetode.find((x) => x.tara_cod === tara);
    return r ? metodeSauNull(r.metode_acceptate) : metodeGlobal;
  };

  // Termenul de plată către partener: rândul ALL și, peste el, rândul țării.
  const randuriTermen = config.data || [];
  const termenGlobal = numarSauNull((randuriTermen.find((r) => r.tara_cod === 'ALL') || {}).valoare);
  const termenPeTara = (tara) => {
    const r = randuriTermen.find((x) => x.tara_cod === tara);
    const v = r ? numarSauNull(r.valoare) : null;
    return v != null ? v : termenGlobal;
  };

  const tari = (taxe.data || [])
    .filter((t) => t.checkout_activ)
    .sort((a, b) => String(a.tara_cod).localeCompare(String(b.tara_cod)))
    .map((t) => ({
      tara_cod: t.tara_cod,
      tara_nume: t.tara_nume || null,
      moneda: t.moneda || null,
      prag_minim_comanda: numarSauNull(t.prag_minim_comanda),
      metode_plata: metodePeTara(t.tara_cod),
      termen_plata_partener_zile: termenPeTara(t.tara_cod),
    }));

  const corp = {
    ok: true,
    tari,
    metode_plata: metodeGlobal,
    confirmare_tacita_ore: FEREASTRA_TACITA_ORE,
    termen_plata_partener_zile: termenGlobal,
    entitati: (entitati.data || [])
      .filter((e) => e.denumire)
      .map((e) => ({ denumire: e.denumire, tara_cod: e.tara_cod || null })),
  };
  const complet = !taxe.eroare && !metode.eroare && !config.eroare && !entitati.eroare;
  return { corp, complet };
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

  const { corp, complet } = await construiesteReguli();
  if (complet) {
    cache = { la: acum, corp };
    res.setHeader('Cache-Control', `public, max-age=${CACHE_SECUNDE}, s-maxage=${CACHE_SECUNDE}`);
  } else {
    console.error('[reguli-platforma] o parte din reguli nu s-a putut citi — răspuns incomplet, fără cache');
    res.setHeader('Cache-Control', 'no-store');
  }
  return res.status(200).json(corp);
}

module.exports = handler;
// Doar pentru teste (scripts/test-reguli-platforma.js).
module.exports._golesteCache = () => { cache = null; };
module.exports.CACHE_SECUNDE = CACHE_SECUNDE;
