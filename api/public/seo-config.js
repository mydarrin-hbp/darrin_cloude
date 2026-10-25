// /api/public/seo-config.js
// G22 — endpoint public, citit de seo-meta.js pe orice pagină publică.
// Întoarce suprascrierea de title/description/canonical pentru o pagină,
// dacă un admin a setat una din panoul „SEO" (api/admin/seo.js) — altfel
// { ok:true, config:null }, caz în care seo-meta.js nu schimbă nimic și
// title/description statice din fișierul HTML rămân cele afișate.
//
// Pasul 11-S (23 oct. 2026): suprascrierea e pe limbă — ?lang=ro → RO; orice
// altă limbă (en, bg, de, el, fr, tr) → EN; fără lang → RO. Fără migrare
// (coloana limba lipsește) → config:null, ca să nu apară titlul RO pe EN.
//
// GET ?path=/despre-noi&lang=en

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { limbaSeo, caleSeo } = require('../../lib/seo-pagini');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const brut = String(req.query?.path || '').trim();
  if (!brut || !brut.startsWith('/')) {
    return res.status(400).json({ error: 'path este obligatoriu (ex: ?path=/despre-noi)', error_en: 'path is required (e.g. ?path=/despre-noi)' });
  }
  const pagePath = caleSeo(brut);
  const limba = req.query?.lang ? limbaSeo(req.query.lang) : 'ro';

  try {
    const { data, error } = await supabaseAdmin
      .from('seo_config')
      .select('limba, meta_title, meta_description, canonical_url')
      .eq('page_path', pagePath)
      .eq('limba', limba)
      .maybeSingle();
    if (error) {
      if (error.code === '42703') {
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.status(200).json({ ok: true, limba, config: null });
      }
      throw error;
    }

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ ok: true, limba, config: data || null });
  } catch (err) {
    console.error('[seo-config]', err);
    return res.status(500).json({ error: 'Nu am putut încărca configurația SEO', error_en: 'We could not load the SEO configuration' });
  }
};
