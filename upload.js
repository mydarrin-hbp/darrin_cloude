// /api/branding/upload.js
// Salvează un logo nou (sau îl șterge) în Vercel KV.
// Body JSON: { slot: 'header_logo'|'footer_logo'|'robot_mascot', dataUrl: 'data:image/...;base64,...' | null, adminKey: '...' }

const { kv } = require('@vercel/kv');

const VALID_SLOTS = ['header_logo', 'footer_logo', 'robot_mascot'];
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB — suficient pentru logo-uri optimizate

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Protecție simplă cu cheie admin (setată ca variabilă de mediu pe Vercel) ──
  const ADMIN_KEY = process.env.BRANDING_ADMIN_KEY;
  if (ADMIN_KEY) {
    const provided = req.body && req.body.adminKey;
    if (provided !== ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized — cheie admin invalidă' });
    }
  }

  const { slot, dataUrl } = req.body || {};

  if (!slot || !VALID_SLOTS.includes(slot)) {
    return res.status(400).json({ error: `slot invalid. Trebuie să fie unul din: ${VALID_SLOTS.join(', ')}` });
  }

  try {
    // ── ȘTERGERE — dataUrl null sau gol → revine la fallback-ul implicit ──
    if (!dataUrl) {
      await kv.del(`branding:${slot}`);
      return res.status(200).json({ ok: true, action: 'deleted', slot });
    }

    // ── VALIDARE format ──
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'dataUrl trebuie să fie un data:image/... base64 valid' });
    }

    // ── VALIDARE dimensiune (aproximativ, din lungimea stringului base64) ──
    const approxBytes = Math.ceil((dataUrl.length * 3) / 4);
    if (approxBytes > MAX_SIZE_BYTES) {
      return res.status(413).json({
        error: `Imagine prea mare (${(approxBytes / 1024 / 1024).toFixed(2)}MB). Limită: 2MB. Optimizează imaginea înainte de upload.`,
      });
    }

    const record = { dataUrl, updatedAt: new Date().toISOString() };
    await kv.set(`branding:${slot}`, record);

    return res.status(200).json({ ok: true, action: 'saved', slot, updatedAt: record.updatedAt });
  } catch (err) {
    console.error('branding/upload error:', err);
    return res.status(500).json({ error: 'Failed to save branding', detail: String(err) });
  }
};
