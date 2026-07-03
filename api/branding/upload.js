// /api/branding/upload.js
// Salvează / șterge un logo în Vercel KV.
//
// ═══ FIX SECURITATE (audit 2026-07-01) ═══════════════════════════
// Varianta veche accepta cererea dacă BRANDING_ADMIN_KEY nu era setat
// în mediu (fail-open: verificarea era complet sărită). Acum accesul
// e FAIL-CLOSED: fără JWT Supabase valid + rol admin/superadmin,
// cererea e respinsă necondiționat, indiferent de configurarea mediului.
// ═══════════════════════════════════════════════════════════════

const { kv } = require('@vercel/kv');
const { requireAuth } = require('../../lib/auth-middleware');

const VALID_SLOTS = ['header_logo', 'footer_logo', 'robot_mascot'];
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

async function handler(req, res, user) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://mydarrin.homebestpal.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slot, dataUrl } = req.body || {};

  if (!slot || !VALID_SLOTS.includes(slot)) {
    return res.status(400).json({ error: `slot invalid. Trebuie să fie unul din: ${VALID_SLOTS.join(', ')}` });
  }

  try {
    if (!dataUrl) {
      await kv.del(`branding:${slot}`);
      return res.status(200).json({ ok: true, action: 'deleted', slot, by: user.email });
    }

    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'dataUrl trebuie să fie un data:image/... base64 valid' });
    }

    const approxBytes = Math.ceil((dataUrl.length * 3) / 4);
    if (approxBytes > MAX_SIZE_BYTES) {
      return res.status(413).json({
        error: `Imagine prea mare (${(approxBytes / 1024 / 1024).toFixed(2)}MB). Limită: 2MB.`,
      });
    }

    const record = { dataUrl, updatedAt: new Date().toISOString(), updatedBy: user.email };
    await kv.set(`branding:${slot}`, record);

    return res.status(200).json({ ok: true, action: 'saved', slot, updatedAt: record.updatedAt });
  } catch (err) {
    console.error('branding/upload error:', err);
    return res.status(500).json({ error: 'Failed to save branding' });
  }
}

// Fail-closed: doar utilizatori autentificați cu rol admin sau superadmin.
module.exports = requireAuth(['admin', 'superadmin'], handler);
