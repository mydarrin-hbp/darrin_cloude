// /api/public/traduceri-catalog.js
// Endpoint PUBLIC — traducerile conținutului de catalog afișat public
// (10 oct. 2026, platforma în engleză). Citește coloana `traduceri` (jsonb)
// din catalog_servicii, catalog_niveluri și categorii și întoarce un
// dicționar „text român → traducere”, în formatul fișierelor din /i18n
// ({ _texte: { ... } }), aplicat de i18n-loader.js peste orice text din
// pagină care se potrivește (titluri, descrieri, niveluri, categorii).
//
// GET ?lang=en -> { ok, lang, _texte: { "Înlocuire becuri & corpuri de iluminat": "Light bulb & fitting replacement", ... } }
//
// Până la aplicarea migrării docs/migrations-propuse/2026-10-10_traduceri_catalog.sql
// coloana nu există: răspunsul e un dicționar gol (ok:true), nu o eroare —
// paginile rămân pe textul român al catalogului.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const LIMBI = ['en', 'de', 'fr', 'tr', 'bg', 'el'];
// tabel → [coloane text afișate public, filtru public]
const SURSE = [
  { tabel: 'catalog_servicii', campuri: ['titlu', 'domeniu', 'descriere', 'etape_lucrare', 'instructiuni_intretinere'], public: (q) => q.eq('status_public', true) },
  { tabel: 'catalog_niveluri', campuri: ['label', 'descriere'] },
  { tabel: 'categorii', campuri: ['title', 'description'] },
];

function adauga(texte, ro, tradus) {
  // listele (ex. etape_lucrare) se potrivesc element cu element
  if (Array.isArray(ro) && Array.isArray(tradus)) {
    ro.forEach((x, i) => adauga(texte, x, tradus[i]));
    return;
  }
  if (typeof ro !== 'string' || typeof tradus !== 'string') return;
  const cheie = ro.replace(/\s+/g, ' ').trim();
  const val = tradus.trim();
  if (cheie && val && cheie !== val) texte[cheie] = val;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const lang = String((req.query && req.query.lang) || '').toLowerCase().slice(0, 2);
  if (LIMBI.indexOf(lang) === -1) return res.status(400).json({ error: 'Parametrul lang lipsește sau nu e suportat' });

  const texte = {};
  for (const s of SURSE) {
    let q = supabaseAdmin.from(s.tabel).select(s.campuri.concat('traduceri').join(','));
    if (s.public) q = s.public(q);
    const { data, error } = await q.limit(5000);
    if (error) {
      // coloana `traduceri` lipsește (migrare neaplicată) sau tabelul nu
      // răspunde: sărim sursa, fără să blocăm paginile.
      console.warn('[traduceri-catalog]', s.tabel, error.message);
      continue;
    }
    for (const r of data || []) {
      const tr = r.traduceri && r.traduceri[lang];
      if (!tr || typeof tr !== 'object') continue;
      for (const c of s.campuri) adauga(texte, r[c], tr[c]);
    }
  }

  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600');
  return res.status(200).json({ ok: true, lang, _texte: texte });
};
