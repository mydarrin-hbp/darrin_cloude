// /api/admin/seo.js
// G22 — CRUD pentru seo_config, folosit de panoul „SEO" din
// mydarrin-superadmin.html. Suprascrierile aplicate aici sunt citite
// client-side de seo-meta.js (api/public/seo-config.js) și, pentru roboții
// de previzualizare (Facebook, LinkedIn, WhatsApp…), de middleware.js.
//
// Pasul 11-S (23 oct. 2026): fiecare suprascriere e pe pagină ȘI pe limbă
// (page_path, limba) — înainte, titlul RO se aplica și vizitatorilor EN; plus
// câmpurile de partajare (OG). Acces (lib/permisiuni-seo.js): citire —
// superadmin sau admin cu rând pe secțiunea `seo`; scriere — superadmin sau
// admin cu poate_scrie. Fiecare scriere se auditează; erorile au forma comună.
//
// GET                    → { ok, pagini:[{ page_path, titlu_pagina, override:{ ro, en } }], poate_scrie }
// POST/PUT { page_path, limba, meta_title, meta_description, canonical_url,
//            og_titlu, og_descriere, og_imagine_url, og_imagine_alt,
//            og_imagine_latime, og_imagine_inaltime }
//                        → upsert după (page_path, limba)
// DELETE ?page_path=/xxx&limba=ro → șterge suprascrierea acelei limbi (revine
//                        la fallback-ul static din fișierul HTML)

const { requireAuth } = require('../../lib/auth-middleware');
const { formaComuna, trimiteEroare, camp } = require('../../lib/raspuns-eroare');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { nivelSeo, refuzaFaraDrept, refuzaFaraScriere } = require('../../lib/permisiuni-seo');
const { PAGINI, esteCunoscuta } = require('../../lib/seo-pagini');

const LIMBI = ['ro', 'en'];

function migrareLipsa(err) {
  return !!err && (err.code === '42703' || err.code === 'PGRST204' || err.code === '42P10' || /limba|og_/.test(err.message || ''));
}
function refuzMigrare(res) {
  return trimiteEroare(res, 409, 'MIGRARE_LIPSA',
    'Tabela SEO nu are încă limbile: aplicați migrarea docs/migrations-propuse/2026-10-23_seo_social_campanii.sql.',
    'The SEO table does not have languages yet: apply the migration docs/migrations-propuse/2026-10-23_seo_social_campanii.sql.');
}

function text(v, max) { return v == null ? null : (String(v).trim().slice(0, max) || null); }
function urlHttps(v) {
  try { const u = new URL(String(v)); return u.protocol === 'https:'; } catch (e) { return false; }
}
function intreg(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 20000 ? n : NaN;
}

async function lista(res, poateScrie) {
  const { data, error } = await supabaseAdmin.from('seo_config').select('*').order('page_path');
  if (error) {
    if (migrareLipsa(error)) return refuzMigrare(res);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca configurația SEO.', 'We could not load the SEO configuration.');
  }
  const dupa = {};
  (data || []).forEach((r) => {
    if (r.limba == null) return;
    (dupa[r.page_path] = dupa[r.page_path] || {})[r.limba] = r;
  });
  // Fiecare pagină cunoscută (lib/seo-pagini.js), cu suprascrierile ei pe
  // limbă — panoul afișează toate paginile, nu doar cele deja editate.
  const pagini = PAGINI.map((p) => ({
    page_path: p.cale,
    titlu_pagina: p.titlu,
    override: { ro: (dupa[p.cale] && dupa[p.cale].ro) || null, en: (dupa[p.cale] && dupa[p.cale].en) || null },
  }));
  return res.status(200).json({ ok: true, pagini, poate_scrie: poateScrie });
}

async function salveaza(req, res, admin) {
  const b = req.body || {};
  const pagePath = typeof b.page_path === 'string' ? b.page_path.trim() : '';
  if (!pagePath.startsWith('/') || !esteCunoscuta(pagePath)) {
    return trimiteEroare(res, 400, 'PAGINA_INVALIDA', 'Pagina nu e în lista paginilor publice.', 'The page is not in the list of public pages.',
      [camp('page_path', 'Alegeți o pagină din listă.', 'Choose a page from the list.')]);
  }
  if (!LIMBI.includes(b.limba)) {
    return trimiteEroare(res, 400, 'LIMBA_INVALIDA', 'Limba trebuie să fie „ro” sau „en”.', 'The language must be “ro” or “en”.',
      [camp('limba', 'Alegeți RO sau EN.', 'Choose RO or EN.')]);
  }
  const erori = [];
  const canonical = text(b.canonical_url, 300);
  if (canonical && !urlHttps(canonical)) erori.push(camp('canonical_url', 'URL-ul canonic trebuie să înceapă cu https://.', 'The canonical URL must start with https://.'));
  const ogImg = text(b.og_imagine_url, 500);
  if (ogImg && !urlHttps(ogImg)) erori.push(camp('og_imagine_url', 'Adresa imaginii trebuie să înceapă cu https://.', 'The image address must start with https://.'));
  const latime = intreg(b.og_imagine_latime);
  const inaltime = intreg(b.og_imagine_inaltime);
  if (Number.isNaN(latime) || Number.isNaN(inaltime)) erori.push(camp('og_imagine_url', 'Dimensiunile imaginii nu sunt valide; încărcați imaginea din nou.', 'The image dimensions are not valid; upload the image again.'));
  if (erori.length) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', 'Corectați câmpurile marcate.', 'Correct the marked fields.', erori);
  }

  const rand = {
    page_path: pagePath,
    limba: b.limba,
    meta_title: text(b.meta_title, 200),
    meta_description: text(b.meta_description, 400),
    canonical_url: canonical,
    og_titlu: text(b.og_titlu, 200),
    og_descriere: text(b.og_descriere, 400),
    og_imagine_url: ogImg,
    og_imagine_alt: text(b.og_imagine_alt, 300),
    og_imagine_latime: ogImg ? latime : null,
    og_imagine_inaltime: ogImg ? inaltime : null,
    updated_at: new Date().toISOString(),
    updated_by: admin.id,
  };
  const { data, error } = await supabaseAdmin.from('seo_config').upsert(rand, { onConflict: 'page_path,limba' }).select().single();
  if (error) {
    if (migrareLipsa(error)) return refuzMigrare(res);
    console.error('[admin/seo salveaza]', error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut salva configurația SEO.', 'We could not save the SEO configuration.');
  }
  await inregistreazaAudit({ admin, req, actiune: 'seo_salvat', entitate: 'seo_config', entitate_id: `${pagePath}:${b.limba}`,
    detalii: { page_path: pagePath, limba: b.limba, og: !!(rand.og_titlu || rand.og_descriere || rand.og_imagine_url) } });
  return res.status(200).json({ ok: true, config: data });
}

async function sterge(req, res, admin) {
  const pagePath = req.query && req.query.page_path;
  const limba = req.query && req.query.limba;
  if (!pagePath) return trimiteEroare(res, 400, 'DATE_INVALIDE', 'page_path este obligatoriu.', 'page_path is required.');
  if (!LIMBI.includes(limba)) return trimiteEroare(res, 400, 'LIMBA_INVALIDA', 'Limba trebuie să fie „ro” sau „en”.', 'The language must be “ro” or “en”.');
  const { error } = await supabaseAdmin.from('seo_config').delete().eq('page_path', pagePath).eq('limba', limba);
  if (error) {
    if (migrareLipsa(error)) return refuzMigrare(res);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut șterge suprascrierea.', 'We could not delete the override.');
  }
  await inregistreazaAudit({ admin, req, actiune: 'seo_sters', entitate: 'seo_config', entitate_id: `${pagePath}:${limba}`, detalii: { page_path: pagePath, limba } });
  return res.status(200).json({ ok: true });
}

async function handler(req, res, admin) {
  res.setHeader('Cache-Control', 'private, no-store');
  const nivel = await nivelSeo(admin);
  if (!nivel) return refuzaFaraDrept(res);
  const poateScrie = nivel === 'scriere';
  try {
    if (req.method === 'GET') return lista(res, poateScrie);
    if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return trimiteEroare(res, 405, 'METODA', 'Metodă nepermisă.', 'Method not allowed.');
    if (!poateScrie) return refuzaFaraScriere(res);
    if (req.method === 'DELETE') return sterge(req, res, admin);
    return salveaza(req, res, admin);
  } catch (err) {
    console.error('[admin/seo]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Eroare internă.', 'Internal error.');
  }
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
