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
const { trimiteEroare } = require('../../lib/raspuns-eroare');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const MAX_BYTES = 5 * 1024 * 1024; // acoperă limita bucket-ului comenzi-imagini
const EXT_FOR_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };

function base64Bytes(b64) {
  const padding = (b64.match(/=+$/) || [''])[0].length;
  return Math.floor((b64.length * 3) / 4) - padding;
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const { comanda_id, tip, imagine_base64, mime_type, gps_lat = null, gps_lng = null, gps_accuracy = null } = req.body || {};

  if (!comanda_id || !['before', 'after'].includes(tip)) {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'comanda_id și tip (before|after) sunt obligatorii', 'comanda_id and tip (before|after) are required.');
  }
  if (!imagine_base64 || !ALLOWED_MIME.has(mime_type)) {
    return trimiteEroare(res, 400, 'TIP_FISIER', `mime_type acceptat: ${[...ALLOWED_MIME].join(', ')}`, `Accepted mime_type: ${[...ALLOWED_MIME].join(', ')}`, ['mime_type']);
  }
  if (base64Bytes(imagine_base64) > MAX_BYTES) {
    return trimiteEroare(res, 400, 'PREA_MARE', 'Imaginea depășește 5MB', 'The image is larger than 5MB.');
  }

  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('id, partener_id, status')
    .eq('id', comanda_id)
    .single();
  if (comErr || !comanda) return trimiteEroare(res, 404, 'COMANDA_NU_EXISTA', 'Comanda nu există', 'The order does not exist.');
  if (comanda.partener_id !== user.id) return trimiteEroare(res, 403, 'COMANDA_NEALOCATA', 'Comanda nu îți este alocată', 'This order is not assigned to you.');
  if (!['acceptata', 'in_executie'].includes(comanda.status)) {
    return trimiteEroare(res, 409, 'STARE_GRESITA', `Comanda nu e într-o stare care permite încărcare foto (status curent: ${comanda.status})`, `The order is not in a state that allows photo uploads (current status: ${comanda.status}).`);
  }

  let buffer;
  try {
    buffer = Buffer.from(imagine_base64, 'base64');
  } catch (e) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', 'imagine_base64 invalid', 'imagine_base64 is not valid.', ['imagine_base64']);
  }

  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = EXT_FOR_MIME[mime_type];
  const path = `${comanda_id}/${tip}-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('comenzi-imagini')
    .upload(path, buffer, { contentType: mime_type });
  if (uploadErr) {
    console.error('[comenzi/upload-imagine] storage', uploadErr);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca imaginea', 'We could not upload the image. Please try again.');
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
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut înregistra imaginea', 'We could not save the image. Please try again.');
  }

  return res.status(200).json({ ok: true, imagine: data });
}

module.exports = requireAuth([], handler);
