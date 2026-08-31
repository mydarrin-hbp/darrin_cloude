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
    if (!id_serviciu) return res.status(400).json({ error: 'id_serviciu este obligatoriu' });
    if (!imagine_base64 || !ALLOWED_MIME.has(mime_type)) {
      return res.status(400).json({ error: `mime_type acceptat: ${[...ALLOWED_MIME].join(', ')}` });
    }
    if (base64Bytes(imagine_base64) > MAX_BYTES) {
      return res.status(400).json({ error: 'Imaginea depășește 5MB' });
    }

    const { data: rand, error: cautaErr } = await supabaseAdmin
      .from('catalog_servicii').select('id, imagini').eq('id', id_serviciu).maybeSingle();
    if (cautaErr) return res.status(500).json({ error: cautaErr.message });
    if (!rand) return res.status(404).json({ error: 'Serviciul/materialul nu există' });
    const imaginiExistente = Array.isArray(rand.imagini) ? rand.imagini : [];
    if (imaginiExistente.length >= MAX_IMAGINI) {
      return res.status(400).json({ error: `Deja are maximul de ${MAX_IMAGINI} imagini — elimină una înainte de a adăuga alta.` });
    }

    let buffer;
    try {
      buffer = Buffer.from(imagine_base64, 'base64');
    } catch (e) {
      return res.status(400).json({ error: 'imagine_base64 invalid' });
    }

    const ext = EXT_FOR_MIME[mime_type];
    const path = `catalog/${id_serviciu}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, { contentType: mime_type });
    if (uploadErr) {
      console.error('[admin/catalog-imagini] storage', uploadErr);
      return res.status(500).json({ error: 'Nu am putut încărca imaginea' });
    }
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    const urlPublic = pub.publicUrl;

    const imaginiNoi = [...imaginiExistente, urlPublic];
    const { data: actualizat, error: updErr } = await supabaseAdmin
      .from('catalog_servicii').update({ imagini: imaginiNoi }).eq('id', id_serviciu).select('id, imagini').single();
    if (updErr) return res.status(500).json({ error: updErr.message });

    await inregistreazaAudit({ admin, req, actiune: 'adaugare_imagine_catalog', entitate: 'catalog_servicii', entitate_id: id_serviciu, detalii: { url: urlPublic } });
    return res.status(200).json({ ok: true, imagini: actualizat.imagini });
  }

  if (req.method === 'DELETE') {
    const { id_serviciu, url } = req.body || {};
    if (!id_serviciu || !url) return res.status(400).json({ error: 'id_serviciu și url sunt obligatorii' });

    const { data: rand, error: cautaErr } = await supabaseAdmin
      .from('catalog_servicii').select('id, imagini').eq('id', id_serviciu).maybeSingle();
    if (cautaErr) return res.status(500).json({ error: cautaErr.message });
    if (!rand) return res.status(404).json({ error: 'Serviciul/materialul nu există' });

    const imaginiNoi = (Array.isArray(rand.imagini) ? rand.imagini : []).filter((u) => u !== url);
    const { data: actualizat, error: updErr } = await supabaseAdmin
      .from('catalog_servicii').update({ imagini: imaginiNoi }).eq('id', id_serviciu).select('id, imagini').single();
    if (updErr) return res.status(500).json({ error: updErr.message });

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

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
