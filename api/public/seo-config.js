// /api/public/seo-config.js
// G22 — endpoint public, citit de seo-meta.js pe orice pagină publică.
// Întoarce suprascrierea de title/description/canonical pentru o pagină,
// dacă un admin a setat una din panoul „SEO" (api/admin/seo.js) — altfel
// { ok:true, config:null }, caz în care seo-meta.js nu schimbă nimic și
// title/description statice din fișierul HTML rămân cele afișate.
//
// GET ?path=/despre-noi

const { supabaseAdmin } = require('../../lib/supabaseAdmin');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const pagePath = String(req.query?.path || '').trim();
  if (!pagePath || !pagePath.startsWith('/')) {
    return res.status(400).json({ error: 'path este obligatoriu (ex: ?path=/despre-noi)' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('seo_config')
      .select('meta_title, meta_description, canonical_url')
      .eq('page_path', pagePath)
      .maybeSingle();
    if (error) throw error;

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ ok: true, config: data || null });
  } catch (err) {
    console.error('[seo-config]', err);
    return res.status(500).json({ error: 'Nu am putut încărca configurația SEO' });
  }
};
