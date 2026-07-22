// /api/comenzi/upload-imagine.js
// Faza 4 — partenerul încarcă fotografii înainte/după pentru o comandă în
// execuție. Hash SHA256 calculat server-side din octeții reali ai fișierului
// (dovadă de integritate — orice modificare ulterioară a imaginii schimbă
// hash-ul). GPS-ul vine din navigator.geolocation al partenerului, raportat
// de client la momentul încărcării — nu e extras din EXIF (acest proiect nu
// are nicio dependință de parsare de imagini instalată în package.json);
// același nivel de încredere ca restul aplicației — vezi api/partener/gps.js,
// care folosește exact aceeași convenție pentru poziția partenerului.
//
// Body: { comanda_id, tip: 'before'|'after', imagine_base64, mime_type, gps_lat?, gps_lng?, gps_accuracy? }
//
// FIX (testat live, 2026-07-22): valorile inițiale (inainte/dupa) nu treceau
// de comenzi_imagini_tip_check — constraint-ul real (tabelă construită
// într-o sesiune anterioară) folosește 'before'/'after' (engleză), plus
// 'in_progres'/'defect_constatat', nefolosite aici.

const crypto = require('crypto');
const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const MAX_BYTES = 5 * 1024 * 1024; // acoperă limita bucket-ului comenzi-imagini
const EXT_FOR_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };

function base64Bytes(b64) {
  const padding = (b64.match(/=+$/) || [''])[0].length;
  return Math.floor((b64.length * 3) / 4) - padding;
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { comanda_id, tip, imagine_base64, mime_type, gps_lat = null, gps_lng = null, gps_accuracy = null } = req.body || {};

  if (!comanda_id || !['before', 'after'].includes(tip)) {
    return res.status(400).json({ error: 'comanda_id și tip (before|after) sunt obligatorii' });
  }
  if (!imagine_base64 || !ALLOWED_MIME.has(mime_type)) {
    return res.status(400).json({ error: `mime_type acceptat: ${[...ALLOWED_MIME].join(', ')}` });
  }
  if (base64Bytes(imagine_base64) > MAX_BYTES) {
    return res.status(400).json({ error: 'Imaginea depășește 5MB' });
  }

  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('id, partener_id, status')
    .eq('id', comanda_id)
    .single();
  if (comErr || !comanda) return res.status(404).json({ error: 'Comanda nu există' });
  if (comanda.partener_id !== user.id) return res.status(403).json({ error: 'Comanda nu îți este alocată' });
  if (!['acceptata', 'in_executie'].includes(comanda.status)) {
    return res.status(409).json({ error: `Comanda nu e într-o stare care permite încărcare foto (status curent: ${comanda.status})` });
  }

  let buffer;
  try {
    buffer = Buffer.from(imagine_base64, 'base64');
  } catch (e) {
    return res.status(400).json({ error: 'imagine_base64 invalid' });
  }

  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = EXT_FOR_MIME[mime_type];
  const path = `${comanda_id}/${tip}-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('comenzi-imagini')
    .upload(path, buffer, { contentType: mime_type });
  if (uploadErr) {
    console.error('[comenzi/upload-imagine] storage', uploadErr);
    return res.status(500).json({ error: 'Nu am putut încărca imaginea' });
  }

  const { data, error } = await supabaseAdmin
    .from('comenzi_imagini')
    .insert({
      comanda_id,
      partener_id: user.id,
      tip,
      url: path,
      gps_lat,
      gps_lng,
      gps_accuracy,
      hash_sha256: hash,
    })
    .select()
    .single();
  if (error) {
    console.error('[comenzi/upload-imagine] db', error);
    return res.status(500).json({ error: 'Nu am putut înregistra imaginea' });
  }

  return res.status(200).json({ ok: true, imagine: data });
}

module.exports = requireAuth([], handler);
