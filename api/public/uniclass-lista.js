// /api/public/uniclass-lista.js
// Endpoint PUBLIC — codurile Uniclass reale (uniclass_codes), pentru
// selectorul opțional de pe formularul de produs marketplace (Faza 1,
// 29 sept. 2026, punctul 3 din decizii). Date de referință, nesensibile —
// nu necesită autentificare.
//
// Pasul 8b (15 oct. 2026): după importul Uniclass 2015, ediția NBS ianuarie
// 2026 (19.084 de coduri), lista se citește pe pagini (Supabase întoarce
// altfel doar primele 1.000) și doar codurile active. Codurile noi n-au încă
// titlu în română: `titlu` = title_ro, cu rezervă pe title_en (pentru
// ?lang=en invers). `title_ro` rămâne în răspuns, pentru apelanții vechi.
//
// GET ?prefix=Pr[,Ss] (opțional: doar tabelele cerute) &lang=ro|en

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { citesteTot } = require('../../lib/citeste-tot');
const { limbaNomenclator } = require('../../lib/limba-nomenclator');

const TABELE = ['Ac', 'Co', 'EF', 'En', 'FI', 'Ma', 'PC', 'PM', 'Pr', 'Ro', 'RK', 'SL', 'Ss', 'TE', 'Zz'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const lang = limbaNomenclator(req);
  const prefixe = String(req.query?.prefix || '').split(',').map((p) => p.trim()).filter((p) => TABELE.includes(p));

  try {
    const { data, error } = await citesteTot(() => {
      let q = supabaseAdmin.from('uniclass_codes').select('code, table_prefix, title_ro, title_en').eq('is_active', true);
      // „Pr_%”: `_` din LIKE se potrivește și cu underscore-ul din cod; niciun
      // prefix de tabel nu e începutul altuia (TABELE), deci filtrul e exact.
      if (prefixe.length) q = q.or(prefixe.map((p) => `code.like.${p}_%`).join(','));
      return q.order('code');
    }, { maximPagini: 40 });
    if (error) throw error;

    const coduri = (data || []).map((c) => ({
      code: c.code,
      table_prefix: c.table_prefix,
      title_ro: c.title_ro,
      titlu: (lang === 'en' ? (c.title_en || c.title_ro) : (c.title_ro || c.title_en)) || c.code,
    }));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ ok: true, coduri });
  } catch (err) {
    console.error('[uniclass-lista]', err);
    return res.status(500).json({ error: 'Nu am putut încărca lista Uniclass', error_en: 'Could not load the Uniclass list' });
  }
};
