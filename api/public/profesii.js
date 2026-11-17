// /api/public/profesii.js
// Pasul 12-P1 (17 nov. 2026): lista de profesii pentru pre-înscrierea
// partenerului (/parteneri/inscriere, „Ce faci?” → Servicii → Profesia).
//
// Sursa: competente_esco — ocupațiile (COR / ISCO) deja clasificate pe
// domenii (domeniu ≠ „ESCO - neclasificat”), legate de clasele NACE prin
// nace_code. Codul NACE e cel pe care îl cere pasul „Profesii” din activare
// (partner_coduri_nace, /api/public/nace-lista): profesia aleasă la
// pre-înscriere îl precompletează acolo.
//
// slug = denumirea fără diacritice, cu „-” (instalator, electrician,
// zugravi-si-vopsitori): adresa din reclame, /parteneri/inscriere?profesie=<slug>.
//
// GET ?lang=en → { ok, profesii: [{ slug, cod, denumire, denumire_ro, nace }] }
// denumire = în limba cerută (denumire_en, fără „(RO specific)”), cu rezervă
// pe denumirea românească. Date de referință, publice, fără date personale.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

const NECLASIFICAT = 'ESCO - neclasificat';

function slug(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
function curataEn(text) {
  const t = String(text || '').replace(/\s*\(RO specific\)\s*$/i, '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}
// NACE „F 43.22” / „43.22” → „43.22” (forma din partner_coduri_nace).
function nace(text) {
  const m = String(text || '').match(/(\d{2})\.?(\d{2})/);
  return m ? `${m[1]}.${m[2]}` : null;
}

/** Lista, ordonată după denumire; slug-urile sunt unice (primul câștigă). */
function profesii(randuri, lang) {
  const vazute = new Set();
  return (randuri || [])
    .filter((r) => r && r.denumire && r.domeniu && r.domeniu !== NECLASIFICAT)
    .map((r) => ({
      slug: slug(r.denumire),
      cod: r.cod_esco,
      denumire_ro: r.denumire,
      denumire: lang === 'en' ? (curataEn(r.denumire_en) || r.denumire) : r.denumire,
      nace: nace(r.nace_code),
    }))
    .filter((p) => p.slug && !vazute.has(p.slug) && vazute.add(p.slug))
    .sort((a, b) => a.denumire.localeCompare(b.denumire, lang === 'en' ? 'en' : 'ro'));
}

async function handler(req, res) {
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  try {
    const { data, error } = await supabaseAdmin
      .from('competente_esco')
      .select('cod_esco, denumire, denumire_en, domeniu, nace_code')
      .neq('domeniu', NECLASIFICAT);
    if (error) throw error;
    const lang = String((req.query && req.query.lang) || '').toLowerCase() === 'en' ? 'en' : 'ro';
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ ok: true, profesii: profesii(data, lang) });
  } catch (err) {
    console.error('[public/profesii]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca lista de profesii.', 'We could not load the list of trades.');
  }
}

module.exports = handler;
module.exports.profesii = profesii;
module.exports.slug = slug;
