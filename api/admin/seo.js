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
// POST { actiune:'url_incarcare_og', page_path, limba, mime, marime, latime, inaltime }
//                        → adresă semnată în bucket-ul public seo-og (imaginea 1,91:1)
// POST { actiune:'confirma_og', page_path, limba, cale, latime, inaltime }
//                        → verificarea conținutului; { url_public, latime, inaltime }
//                          (se salvează apoi cu restul câmpurilor, prin POST obișnuit)

const { requireAuth } = require('../../lib/auth-middleware');
const { formaComuna, trimiteEroare, camp } = require('../../lib/raspuns-eroare');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { nivelSeo, refuzaFaraDrept, refuzaFaraScriere } = require('../../lib/permisiuni-seo');
const { PAGINI, esteCunoscuta } = require('../../lib/seo-pagini');
const R = require('../../lib/seo-campanii');
const VF = require('../../lib/verifica-fisier');
const crypto = require('crypto');

const BUCKET_OG = 'seo-og';

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

// ── Imaginea OG: încărcare directă din browser (fișierul nu trece prin Vercel) ──
function segmentPagina(pagePath) {
  return String(pagePath || '/').replace(/^\/+/, '').replace(/[^a-z0-9._-]+/gi, '-') || 'index';
}
function refuzOg(res, ro, en, cod) {
  return trimiteEroare(res, 400, cod || 'IMAGINE_INVALIDA', ro, en, [camp('og_imagine_url', ro, en)]);
}
function verificaOg(res, mime, marime, latime, inaltime) {
  if (!R.mimePermis('og', mime)) return refuzOg(res, 'Imaginea trebuie să fie JPG, PNG sau WebP.', 'The image must be JPG, PNG or WebP.', 'TIP_FISIER');
  if (!(marime > 0) || marime > R.MARIME_IMAGINE) return refuzOg(res, 'Imaginea are mai mult de 5 MB.', 'The image is larger than 5 MB.', 'FISIER_PREA_MARE');
  if (!(Number.isInteger(latime) && Number.isInteger(inaltime) && latime > 0 && inaltime > 0)) return refuzOg(res, 'Dimensiunile imaginii lipsesc.', 'The image dimensions are missing.');
  const v = R.verificaDimensiuni('og', latime, inaltime);
  if (!v.ok) return refuzOg(res, v.ro, v.en, 'DIMENSIUNI');
  return null;
}
function paginaSiLimba(res, b) {
  if (!b.page_path || !esteCunoscuta(b.page_path)) {
    trimiteEroare(res, 400, 'PAGINA_INVALIDA', 'Pagina nu e în lista paginilor publice.', 'The page is not in the list of public pages.');
    return false;
  }
  if (!LIMBI.includes(b.limba)) {
    trimiteEroare(res, 400, 'LIMBA_INVALIDA', 'Limba trebuie să fie „ro” sau „en”.', 'The language must be “ro” or “en”.');
    return false;
  }
  return true;
}
async function urlIncarcareOg(req, res, admin) {
  const b = req.body || {};
  if (!paginaSiLimba(res, b)) return null;
  const refuz = verificaOg(res, b.mime, Number(b.marime), Number(b.latime), Number(b.inaltime));
  if (refuz) return refuz;
  // Nume nou la fiecare încărcare: rețelele țin imaginea în cache după adresă.
  const cale = `${segmentPagina(b.page_path)}/${b.limba}/og-${crypto.randomBytes(6).toString('hex')}.${R.mimePermis('og', b.mime)}`;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET_OG).createSignedUploadUrl(cale);
  if (error || !data) {
    console.error('[admin/seo url_incarcare_og]', error);
    return trimiteEroare(res, 503, 'BUCKET_INDISPONIBIL', 'Nu am putut pregăti încărcarea. Verificați că bucket-ul seo-og există (migrarea 2026-10-23).',
      'We could not prepare the upload. Check that the seo-og bucket exists (the 2026-10-23 migration).');
  }
  await inregistreazaAudit({ admin, req, actiune: 'seo_og_incarcare', entitate: 'storage', entitate_id: `${BUCKET_OG}/${cale}`, detalii: { page_path: b.page_path, limba: b.limba, mime: b.mime, marime: Number(b.marime) } });
  return res.status(200).json({ ok: true, bucket: BUCKET_OG, cale: data.path || cale, token: data.token, url_semnat: data.signedUrl });
}
async function confirmaOg(req, res, admin) {
  const b = req.body || {};
  if (!paginaSiLimba(res, b)) return null;
  const prefix = `${segmentPagina(b.page_path)}/${b.limba}/og-`;
  const cale = String(b.cale || '');
  const ext = cale.split('.').pop();
  const mime = Object.keys(R.MIME_IMAGINE).find((m) => R.MIME_IMAGINE[m] === ext);
  if (!cale.startsWith(prefix) || !/^[a-f0-9]{12}$/.test(cale.slice(prefix.length, -(ext.length + 1))) || !mime) {
    return refuzOg(res, 'Calea imaginii nu aparține acestei pagini.', 'The image path does not belong to this page.', 'CALE_INVALIDA');
  }
  const info = await VF.inspecteaza(supabaseAdmin, BUCKET_OG, cale);
  if (!info.exista) return refuzOg(res, 'Imaginea nu s-a găsit în stocare. Încărcați-o din nou.', 'The image was not found in storage. Upload it again.', 'FISIER_LIPSA');
  const latime = Number(b.latime), inaltime = Number(b.inaltime);
  const refuz = !VF.tipPotrivit(mime, info.tip)
    ? refuzOg(res, 'Conținutul fișierului nu e o imagine ' + ext.toUpperCase() + ' (verificat pe server).', 'The file content is not a ' + ext.toUpperCase() + ' image (checked on the server).', 'CONTINUT_INVALID')
    : verificaOg(res, mime, info.marime, latime, inaltime);
  if (refuz) { await supabaseAdmin.storage.from(BUCKET_OG).remove([cale]); return refuz; }
  const baza = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  await inregistreazaAudit({ admin, req, actiune: 'seo_og_confirmat', entitate: 'storage', entitate_id: `${BUCKET_OG}/${cale}`, detalii: { latime, inaltime, marime: info.marime } });
  return res.status(200).json({ ok: true, url_public: `${baza}/storage/v1/object/public/${BUCKET_OG}/${cale}`, latime, inaltime, marime_bytes: info.marime });
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
    if (req.method === 'GET') return await lista(res, poateScrie);
    if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return trimiteEroare(res, 405, 'METODA', 'Metodă nepermisă.', 'Method not allowed.');
    if (!poateScrie) return refuzaFaraScriere(res);
    if (req.method === 'DELETE') return await sterge(req, res, admin);
    const actiune = req.body && req.body.actiune;
    if (actiune === 'url_incarcare_og') return await urlIncarcareOg(req, res, admin);
    if (actiune === 'confirma_og') return await confirmaOg(req, res, admin);
    if (actiune) return trimiteEroare(res, 400, 'ACTIUNE_INVALIDA', 'Acțiune necunoscută.', 'Unknown action.');
    return await salveaza(req, res, admin);
  } catch (err) {
    console.error('[admin/seo]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Eroare internă.', 'Internal error.');
  }
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
