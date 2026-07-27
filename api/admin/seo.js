// /api/admin/seo.js
// G22 — CRUD pentru seo_config, folosit de panoul „SEO" din
// mydarrin-superadmin.html. Suprascrierile aplicate aici sunt citite
// client-side de seo-meta.js (api/public/seo-config.js), pe orice pagină
// publică — vezi acel fișier pentru mecanismul real de aplicare.
//
// GET              → { ok, config: [...] } — toate suprascrierile existente
// POST/PUT { page_path, meta_title, meta_description, canonical_url }
//                  → upsert după page_path
// DELETE ?page_path=/xxx → șterge suprascrierea (revine la fallback-ul
//                  static din fișierul HTML)

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { PAGINI } = require('../../lib/seo-pagini');

async function handler(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('seo_config')
      .select('*')
      .order('page_path');
    if (error) return res.status(500).json({ error: 'Nu am putut încărca configurația SEO' });

    const overrideDupa = {};
    (data || []).forEach((r) => { overrideDupa[r.page_path] = r; });

    // Fiecare pagină cunoscută (lib/seo-pagini.js), cu override-ul ei dacă
    // există — panoul afișează toate paginile, nu doar cele deja editate.
    const pagini = PAGINI.map((p) => ({
      page_path: p.cale,
      titlu_pagina: p.titlu,
      override: overrideDupa[p.cale] || null,
    }));

    return res.status(200).json({ ok: true, pagini });
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const { page_path, meta_title, meta_description, canonical_url } = req.body || {};
    if (!page_path || typeof page_path !== 'string' || !page_path.startsWith('/')) {
      return res.status(400).json({ error: 'page_path obligatoriu, trebuie să înceapă cu /' });
    }
    const { data, error } = await supabaseAdmin
      .from('seo_config')
      .upsert({
        page_path: page_path.trim(),
        meta_title: meta_title ? String(meta_title).trim().slice(0, 200) : null,
        meta_description: meta_description ? String(meta_description).trim().slice(0, 400) : null,
        canonical_url: canonical_url ? String(canonical_url).trim().slice(0, 300) : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'page_path' })
      .select()
      .single();
    if (error) return res.status(500).json({ error: 'Nu am putut salva configurația SEO' });
    return res.status(200).json({ ok: true, config: data });
  }

  if (req.method === 'DELETE') {
    const pagePath = req.query.page_path;
    if (!pagePath) return res.status(400).json({ error: 'page_path obligatoriu' });
    const { error } = await supabaseAdmin.from('seo_config').delete().eq('page_path', pagePath);
    if (error) return res.status(500).json({ error: 'Nu am putut șterge suprascrierea' });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
