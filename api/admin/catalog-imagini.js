// /api/admin/catalog-imagini.js
// Faza 4 marketplace extensie (31 august 2026, cerere fondator): imagini
// reale per produs/serviciu — până la 5, încărcate manual de admin (fondator
// urcă poze reale, niciodată generate/fabricate). Reutilizează exact
// tiparul deja stabilit în api/comenzi/upload-imagine.js (base64 → buffer →
// supabaseAdmin.storage.upload) — doar bucket-ul diferă: marketplace-media
// (deja existent, public — creat pentru marketplace_materiale, nefolosit
// până acum, reutilizat aici, nu un bucket nou).
//
// POST   { id_serviciu (catalog_servicii.id), imagine_base64, mime_type } → adaugă o imagine (max 5)
// DELETE { id_serviciu, url } → elimină o imagine din listă (fișierul rămâne în storage, orfan minor — consistent cu alte cazuri din proiect)

const { requireAuth } = require('../../lib/auth-middleware');
const { formaComuna, trimiteEroare, trimiteEroareInterna } = require('../../lib/raspuns-eroare');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_IMAGINI = 5;
const EXT_FOR_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const BUCKET = 'marketplace-media';

function base64Bytes(b64) {
  const padding = (b64.match(/=+$/) || [''])[0].length;
  return Math.floor((b64.length * 3) / 4) - padding;
}

async function handler(req, res, admin) {
  if (req.method === 'POST') {
    const { id_serviciu, imagine_base64, mime_type } = req.body || {};
    if (!id_serviciu) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'id_serviciu este obligatoriu', 'id_serviciu is required.', ['id_serviciu']);
    if (!imagine_base64 || !ALLOWED_MIME.has(mime_type)) {
      return trimiteEroare(res, 400, 'TIP_FISIER', `mime_type acceptat: ${[...ALLOWED_MIME].join(', ')}`, `Accepted mime_type: ${[...ALLOWED_MIME].join(', ')}`, ['mime_type']);
    }
    if (base64Bytes(imagine_base64) > MAX_BYTES) {
      return trimiteEroare(res, 400, 'PREA_MARE', 'Imaginea depășește 5MB', 'The image is larger than 5MB.');
    }

    const { data: rand, error: cautaErr } = await supabaseAdmin
      .from('catalog_servicii').select('id, imagini').eq('id', id_serviciu).maybeSingle();
    if (cautaErr) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, cautaErr);
    if (!rand) return trimiteEroare(res, 404, 'NU_EXISTA', 'Serviciul/materialul nu există', 'The service or material does not exist.');
    const imaginiExistente = Array.isArray(rand.imagini) ? rand.imagini : [];
    if (imaginiExistente.length >= MAX_IMAGINI) {
      return trimiteEroare(res, 400, 'LIMITA_ATINSA', `Deja are maximul de ${MAX_IMAGINI} imagini — elimină una înainte de a adăuga alta.`, `It already has the maximum of ${MAX_IMAGINI} images. Remove one before adding another.`);
    }

    let buffer;
    try {
      buffer = Buffer.from(imagine_base64, 'base64');
    } catch (e) {
      return trimiteEroare(res, 400, 'DATE_INVALIDE', 'imagine_base64 invalid', 'imagine_base64 is not valid.', ['imagine_base64']);
    }

    const ext = EXT_FOR_MIME[mime_type];
    const path = `catalog/${id_serviciu}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, { contentType: mime_type });
    if (uploadErr) {
      console.error('[admin/catalog-imagini] storage', uploadErr);
      return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca imaginea', 'We could not upload the image. Please try again.');
    }
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    const urlPublic = pub.publicUrl;

    const imaginiNoi = [...imaginiExistente, urlPublic];
    const { data: actualizat, error: updErr } = await supabaseAdmin
      .from('catalog_servicii').update({ imagini: imaginiNoi }).eq('id', id_serviciu).select('id, imagini').single();
    if (updErr) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, updErr);

    await inregistreazaAudit({ admin, req, actiune: 'adaugare_imagine_catalog', entitate: 'catalog_servicii', entitate_id: id_serviciu, detalii: { url: urlPublic } });
    return res.status(200).json({ ok: true, imagini: actualizat.imagini });
  }

  if (req.method === 'DELETE') {
    const { id_serviciu, url } = req.body || {};
    if (!id_serviciu || !url) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'id_serviciu și url sunt obligatorii', 'id_serviciu and url are required.');

    const { data: rand, error: cautaErr } = await supabaseAdmin
      .from('catalog_servicii').select('id, imagini').eq('id', id_serviciu).maybeSingle();
    if (cautaErr) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, cautaErr);
    if (!rand) return trimiteEroare(res, 404, 'NU_EXISTA', 'Serviciul/materialul nu există', 'The service or material does not exist.');

    const imaginiNoi = (Array.isArray(rand.imagini) ? rand.imagini : []).filter((u) => u !== url);
    const { data: actualizat, error: updErr } = await supabaseAdmin
      .from('catalog_servicii').update({ imagini: imaginiNoi }).eq('id', id_serviciu).select('id, imagini').single();
    if (updErr) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, updErr);

    // Șterge și fișierul din storage (nu doar referința din DB) — evită
    // acumularea de fișiere orfane la fiecare ștergere reală de imagine.
    const prefix = `/storage/v1/object/public/${BUCKET}/`;
    const idxPrefix = url.indexOf(prefix);
    if (idxPrefix !== -1) {
      const path = url.slice(idxPrefix + prefix.length);
      const { error: rmErr } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
      if (rmErr) console.warn('[admin/catalog-imagini] fișier storage neșters (referința tot a fost eliminată din DB):', rmErr.message);
    }

    await inregistreazaAudit({ admin, req, actiune: 'stergere_imagine_catalog', entitate: 'catalog_servicii', entitate_id: id_serviciu, detalii: { url } });
    return res.status(200).json({ ok: true, imagini: actualizat.imagini });
  }

  return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
