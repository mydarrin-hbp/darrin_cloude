// lib/rate-limit.js
// Limitare simplă, pe fereastră fixă, folosind Vercel KV (deja o dependență
// a proiectului, folosită și de branding). Suficientă pentru a opri spam-ul
// basic pe endpointuri publice fără autentificare; nu e o soluție anti-DDoS.
//
// FIX (audit 2026-07-12): fișierul lipsea din repo (pierdut la un reset
// anterior), deși api/public/partner-register.js și api/public/contact.js
// îl importă de la commit-uri anterioare — ambele endpointuri crăpau cu
// "Cannot find module" la fiecare cerere, silențios, până la acest fix.
//
// Pasul 11-S1 (13 nov. 2026):
// - IP-ul nu mai apare în clar în cheile din KV: se păstrează doar un hash
//   SHA-256 (primele 32 de caractere hex) al IP-ului;
// - limiteazaCererea() verifică și o limită pe email (tot hash-uit), pentru
//   formularele care trimit emailuri, și răspunde 429 în forma comună
//   (lib/raspuns-eroare.js), cu mesaj RO + EN și antetul Retry-After;
// - la o eroare KV cererea trece (fail-open), cu log, ca înainte.
//
// Pasul 12-D2 (18 nov. 2026):
// - opțiunea `cont` (ID-ul contului autentificat): limita se numără pe cont,
//   nu pe IP (de exemplu Darrin AI: 20 / 10 min pe cont, 60 pentru superadmin);
// - mesajul 429 spune câte minute mai sunt din fereastră (TTL-ul din KV),
//   nu toată fereastra; opțiunea `mesaj(minute)` dă textul propriu al endpoint-ului.

const crypto = require('crypto');
const { trimiteEroare } = require('./raspuns-eroare');

// Clientul KV se încarcă la prima folosire; testele îl pot înlocui.
let kvClient = null;
function kv() {
  if (!kvClient) kvClient = require('@vercel/kv').kv;
  return kvClient;
}
function _seteazaKv(client) { kvClient = client; }

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function hash(valoare) {
  return crypto.createHash('sha256').update(String(valoare)).digest('hex').slice(0, 32);
}

async function numara(bucket, windowSeconds) {
  const count = await kv().incr(bucket);
  if (count === 1) await kv().expire(bucket, windowSeconds);
  return count;
}

/**
 * @returns {Promise<boolean>} true dacă cererea e permisă, false dacă a depășit limita
 */
async function checkRateLimit(req, { key, limit, windowSeconds }) {
  const bucket = `ratelimit:${key}:ip:${hash(getClientIp(req))}`;
  try {
    const count = await numara(bucket, windowSeconds);
    return count <= limit;
  } catch (e) {
    // Fail-open pe eroare de infra (nu blocăm utilizatori legitimi dacă KV pică),
    // dar logăm ca să fie vizibil în Function Logs.
    console.error('[rate-limit] eroare KV, permit cererea:', e);
    return true;
  }
}

function mesajPreaMulte(windowSeconds) {
  const minute = Math.max(1, Math.ceil(windowSeconds / 60));
  return {
    ro: `Prea multe cereri într-un timp scurt. Încercați din nou peste ${minute} ${minute === 1 ? 'minut' : 'minute'}.`,
    en: `Too many requests in a short time. Please try again in ${minute} ${minute === 1 ? 'minute' : 'minutes'}.`,
  };
}

/**
 * Limită pe IP și, opțional, pe email. La depășire trimite 429 și întoarce false.
 * @param {object} o { key, limit = 5, windowSeconds = 600, email }
 * @returns {Promise<boolean>} true = cererea poate continua
 */
async function limiteazaCererea(req, res, o) {
  const { key, limit = 5, windowSeconds = 600, email, cont, mesaj } = o || {};
  const chei = [cont ? `ratelimit:${key}:cont:${hash(cont)}` : `ratelimit:${key}:ip:${hash(getClientIp(req))}`];
  if (email && typeof email === 'string' && email.trim()) {
    chei.push(`ratelimit:${key}:email:${hash(email.trim().toLowerCase())}`);
  }
  let depasit = false;
  let ramas = 0;
  for (const bucket of chei) {
    try {
      const count = await numara(bucket, windowSeconds);
      if (count > limit) {
        depasit = true;
        // Câte secunde mai are fereastra (fără TTL citibil: toată fereastra).
        let ttl = null;
        try { ttl = typeof kv().ttl === 'function' ? await kv().ttl(bucket) : null; } catch (e) { ttl = null; }
        ramas = Math.max(ramas, Number(ttl) > 0 ? Math.min(Number(ttl), windowSeconds) : windowSeconds);
      }
    } catch (e) {
      console.error('[rate-limit] eroare KV, permit cererea:', e);
    }
  }
  if (!depasit) return true;
  const secunde = ramas || windowSeconds;
  // `mesaj(minute)` (opțional): textul propriu al endpoint-ului, { ro, en }.
  const minuteRamase = Math.max(1, Math.ceil(secunde / 60));
  const m = typeof mesaj === 'function' ? mesaj(minuteRamase) : mesajPreaMulte(secunde);
  if (typeof res.setHeader === 'function') res.setHeader('Retry-After', String(secunde));
  trimiteEroare(res, 429, 'PREA_MULTE_CERERI', m.ro, m.en);
  return false;
}

module.exports = { checkRateLimit, limiteazaCererea, getClientIp, mesajPreaMulte, _seteazaKv, _hash: hash };
