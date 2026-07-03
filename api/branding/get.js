// /api/branding/get.js
// Citește logo-urile curente din Vercel KV. Endpoint public (read-only).
const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const [headerLogo, footerLogo, robotMascot] = await Promise.all([
      kv.get('branding:header_logo'),
      kv.get('branding:footer_logo'),
      kv.get('branding:robot_mascot'),
    ]);

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return res.status(200).json({
      header_logo: headerLogo || null,
      footer_logo: footerLogo || null,
      robot_mascot: robotMascot || null,
    });
  } catch (err) {
    console.error('branding/get error:', err);
    return res.status(500).json({ error: 'Failed to read branding' });
  }
};
