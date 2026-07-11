// /api/health.js
// Adăugat în audit 2026-07-11 — servit la rădăcina subdomeniului
// api.mydarrin.homebestpal.com (vezi rewrite-ul host-based din vercel.json),
// ca să existe un răspuns informativ acolo în loc de homepage-ul public.
// Public, GET, fără date sensibile.
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    service: 'My Darrin API',
    status: 'ok',
    info: 'Acest subdomeniu servește exclusiv endpoint-uri /api/*. Nu există pagini HTML aici.',
  });
};
