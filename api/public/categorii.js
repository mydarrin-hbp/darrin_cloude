// /api/public/categorii.js
// Pasul 12-P2 (20 nov. 2026, temporar până la macheta B2): categoriile
// principale din arborele unic, pentru pre-înscrierea partenerului
// (/parteneri/inscriere → „Categoria principală”).
//
// GET ?tip=servicii|materiale|inchirieri&lang=ro|en[&profesie=<slug>]
// → { ok, tip, lang, categorii: [{ id, slug, denumire }],
//     profesie: null | { slug, categorie_id } }
//   - doar categoriile principale active (parent_id gol, activ = true), în
//     ordinea display_order; denumirea în limba cerută (title_en / traduceri,
//     cu rezervă pe title) — lib/categorii-inscriere.js;
//   - profesie (doar la tip=servicii): indiciul din reclame (?profesie=instalator);
//     categorie_id = categoria cu același cod NACE ca profesia, sau null;
//     profesie = null dacă profesia nu e cunoscută.
// Date de referință, publice, fără date personale; cache scurt (5 min).

const { trimiteEroare, trimiteEroareInterna } = require('../../lib/raspuns-eroare');
const { checkRateLimit } = require('../../lib/rate-limit');
const C = require('../../lib/categorii-inscriere');

const TIP_INVALID = {
  ro: 'Tipul trebuie să fie servicii, materiale sau inchirieri.',
  en: 'The type must be servicii, materiale or inchirieri.',
};

async function handler(req, res) {
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  const q = req.query || {};
  const tip = String(q.tip || '').toLowerCase().trim();
  if (!C.TIPURI_CU_CATEGORIE.includes(tip)) {
    return trimiteEroare(res, 400, 'TIP_INVALID', TIP_INVALID.ro, TIP_INVALID.en, [{ camp: 'tip', mesaj: TIP_INVALID }]);
  }
  const lang = String(q.lang || '').toLowerCase() === 'ro' ? 'ro' : 'en';

  const permis = await checkRateLimit(req, { key: 'public-categorii', limit: 120, windowSeconds: 60 });
  if (!permis) return trimiteEroare(res, 429, 'PREA_MULTE_CERERI', 'Prea multe cereri. Încearcă din nou peste un minut.', 'Too many requests. Please try again in a minute.');

  try {
    const randuri = await C.categoriiPrincipale(tip);
    let profesie = null;
    if (tip === 'servicii' && q.profesie) {
      const p = await C.gasesteProfesie(q.profesie);
      if (p) {
        const cat = C.categoriePentruProfesie(p, randuri);
        profesie = { slug: p.slug, categorie_id: cat ? cat.id : null };
      }
    }
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).json({ ok: true, tip, lang, categorii: randuri.map((c) => C.formaPublica(c, lang)), profesie });
  } catch (err) {
    return trimiteEroareInterna(res, 500, 'EROARE_SERVER', 'Nu am putut încărca lista de categorii. Încearcă din nou.', 'We could not load the list of categories. Please try again.', err);
  }
}

module.exports = handler;
