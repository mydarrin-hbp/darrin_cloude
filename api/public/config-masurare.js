// /api/public/config-masurare.js
// Pasul 11-A1 (13 nov. 2026): ID-urile pixelilor de rețea, din variabilele de
// mediu Vercel. Niciun ID nu e scris în cod.
//   META_PIXEL_ID        — Meta (Facebook / Instagram), doar cifre
//   TIKTOK_PIXEL_ID      — TikTok, litere mari și cifre
//   LINKEDIN_PARTNER_ID  — LinkedIn Insight Tag, doar cifre
// O variabilă lipsă sau cu format greșit = pixelul nu se încarcă.
//
// masurare.js cere acest endpoint DOAR după acordul pentru cookie-uri de
// marketing; fără acord, nu pleacă nicio cerere. ID-urile pixelilor sunt
// publice prin natura lor (apar în pagina oricărui site care le folosește).

const { trimiteEroare } = require('../../lib/raspuns-eroare');

const FORMAT = Object.freeze({
  meta: { env: 'META_PIXEL_ID', re: /^\d{6,20}$/ },
  tiktok: { env: 'TIKTOK_PIXEL_ID', re: /^[A-Z0-9]{10,30}$/ },
  linkedin: { env: 'LINKEDIN_PARTNER_ID', re: /^\d{3,12}$/ },
});

/** Doar ID-urile setate și valide. */
function pixeliActivi(env) {
  const rez = {};
  for (const [cheie, f] of Object.entries(FORMAT)) {
    const v = String((env || {})[f.env] || '').trim();
    if (f.re.test(v)) rez[cheie] = v;
  }
  return rez;
}

function handler(req, res) {
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({ ok: true, pixeli: pixeliActivi(process.env) });
}

module.exports = handler;
module.exports.pixeliActivi = pixeliActivi;
module.exports.FORMAT = FORMAT;
