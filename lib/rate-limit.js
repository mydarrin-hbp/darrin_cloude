// lib/rate-limit.js
// Limitare simplă, pe fereastră fixă, folosind Vercel KV (deja o dependență
// a proiectului, folosită și de branding). Suficientă pentru a opri spam-ul
// basic pe endpointuri publice fără autentificare; nu e o soluție anti-DDoS.
//
// FIX (audit 2026-07-12): fișierul lipsea din repo (pierdut la un reset
// anterior), deși api/public/partner-register.js și api/public/contact.js
// îl importă de la commit-uri anterioare — ambele endpointuri crăpau cu
// "Cannot find module" la fiecare cerere, silențios, până la acest fix.

const { kv } = require('@vercel/kv');

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * @returns {Promise<boolean>} true dacă cererea e permisă, false dacă a depășit limita
 */
async function checkRateLimit(req, { key, limit, windowSeconds }) {
  const ip = getClientIp(req);
  const bucket = `ratelimit:${key}:${ip}`;
  try {
    const count = await kv.incr(bucket);
    if (count === 1) {
      await kv.expire(bucket, windowSeconds);
    }
    return count <= limit;
  } catch (e) {
    // Fail-open pe eroare de infra (nu blocăm utilizatori legitimi dacă KV pică),
    // dar logăm ca să fie vizibil în Function Logs.
    console.error('[rate-limit] eroare KV, permit cererea:', e);
    return true;
  }
}

module.exports = { checkRateLimit, getClientIp };
