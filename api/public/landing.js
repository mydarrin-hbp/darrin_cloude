// /api/public/landing.js — conținutul publicat al paginilor de destinație (pasul 12-L1, 19 nov. 2026)
//
// GET ?pagina=/parteneri/servicii[&varianta=<utm_campaign>]
//   → { ok, pagina, varianta, versiune, continut: { ro: {…}, en: {…} } | null, imagine: {…} | null }
//
// Doar rândurile PUBLICATE (stare = 'publicat') din landing_continut — ciornele nu
// ies niciodată de aici. Varianta cerută (numele din utm_campaign, litere mici),
// dacă e publicată în RO și EN; altfel varianta „implicita” publicată; altfel
// continut: null (pagina rămâne cu textele implicite din HTML și din dicționare).
// Citirea se face cu service role (tabela nu are drepturi pentru anon); cache
// scurt: 60 s în memorie și pe CDN (s-maxage), plus stale-while-revalidate.
// Fără date personale (nici autorul, nici datele interne).

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare } = require('../../lib/raspuns-eroare');
const L = require('../../lib/landing-pagini');

const TABEL = 'landing_continut';
const CACHE_S = 60;
const cache = new Map(); // `${pagina}|${varianta}` → { la, corp }

function rand(r) {
  const o = {};
  L.CAMPURI_TEXT.forEach((k) => { o[k] = r[k] == null ? '' : String(r[k]); });
  return o;
}

// { ro, en, versiune, imagine } pentru o variantă publicată complet, altfel null.
async function publicata(pagina, varianta) {
  const { data, error } = await supabaseAdmin.from(TABEL)
    .select('*').eq('pagina', pagina).eq('varianta', varianta).eq('stare', 'publicat');
  if (error) throw error;
  const pe = {};
  (data || []).forEach((r) => { pe[r.limba] = r; });
  if (!pe.ro || !pe.en) return null;
  const ro = pe.ro;
  return {
    versiune: ro.versiune,
    continut: { ro: rand(pe.ro), en: rand(pe.en) },
    imagine: ro.imagine_url ? {
      url: ro.imagine_url,
      latime: ro.imagine_latime || null,
      inaltime: ro.imagine_inaltime || null,
      variante: Array.isArray(ro.imagine_variante) ? ro.imagine_variante.filter((v) => v && v.url && v.w).map((v) => ({ w: Number(v.w), url: String(v.url) })) : [],
    } : null,
  };
}

async function construieste(pagina, varianta) {
  if (varianta) {
    const v = await publicata(pagina, varianta);
    if (v) return { ok: true, pagina, varianta, versiune: v.versiune, continut: v.continut, imagine: v.imagine };
  }
  const imp = await publicata(pagina, L.IMPLICITA);
  if (imp) return { ok: true, pagina, varianta: L.IMPLICITA, versiune: imp.versiune, continut: imp.continut, imagine: imp.imagine };
  return { ok: true, pagina, varianta: null, versiune: null, continut: null, imagine: null };
}

async function handler(req, res) {
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  const q = req.query || {};
  const pagina = String(q.pagina || '');
  if (!L.esteCunoscuta(pagina)) {
    return trimiteEroare(res, 400, 'PAGINA_INVALIDA', 'Pagina nu este o pagină de destinație.', 'The page is not a landing page.');
  }
  const varianta = L.variantaDinCampanie(q.varianta);
  const cheie = pagina + '|' + (varianta || '');
  const acum = Date.now();
  const c = cache.get(cheie);
  res.setHeader('Cache-Control', `public, max-age=${CACHE_S}, s-maxage=${CACHE_S}, stale-while-revalidate=300`);
  if (c && acum - c.la < CACHE_S * 1000) return res.status(200).json(c.corp);
  try {
    const corp = await construieste(pagina, varianta);
    cache.set(cheie, { la: acum, corp });
    return res.status(200).json(corp);
  } catch (err) {
    // Fără migrare sau cu baza indisponibilă: pagina rămâne cu conținutul implicit.
    console.error('[public/landing]', err && (err.code || err.message));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, pagina, varianta: null, versiune: null, continut: null, imagine: null });
  }
}

module.exports = handler;
// Doar pentru teste.
module.exports._golesteCache = () => { cache.clear(); };
