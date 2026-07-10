// /api/public/partner-register.js
// RATE LIMITING (audit 2026-07-10): sliding window via Vercel KV
// - Max 3 cereri per IP la 60 secunde
// - Max 2 cereri per email la 300 secunde
// - Honeypot field: câmpul "website" trebuie să rămână gol

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { kv } = require('@vercel/kv');

const RATE_IP_MAX   = 3;    // cereri per IP
const RATE_IP_TTL   = 60;   // secunde
const RATE_EMAIL_MAX = 2;   // cereri per email
const RATE_EMAIL_TTL = 300; // secunde (5 minute)

async function checkRateLimit(key, max, ttl) {
  try {
    const current = await kv.incr(key);
    if (current === 1) await kv.expire(key, ttl);
    return current <= max;
  } catch (e) {
    console.warn('[rate-limit] KV error, allowing request:', e.message);
    return true; // fail-open pe rate limit (nu blocăm dacă KV e down)
  }
}

const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const TYPE_TO_ROLE = {
  servicii: 'partener_servicii',
  materiale: 'partener_materiale',
  inchirieri: 'partener_inchirieri',
  curier: 'partener_curier',
  asigurari: 'partener_asigurari',
};
const TYPE_TO_ENUM = {
  servicii: 'servicii_tehnice',
  materiale: 'furnizor_materiale',
  inchirieri: 'inchirieri_utilaje',
  curier: 'curier_utilitara',
  asigurari: 'asigurari',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { nume, email, tip, nume_firma, cui } = req.body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email valid obligatoriu.' });
  }
  const role = TYPE_TO_ROLE[tip];
  const enumType = TYPE_TO_ENUM[tip];
  if (!role) {
    return res.status(400).json({ error: 'Tip de partener invalid.' });
  }

  // ── HONEYPOT: câmpul "website" trebuie să rămână gol (bot trap) ──
  if (req.body.website) {
    // Bot detectat — răspundem 200 fals pentru a nu dezvălui filtrarea
    return res.status(200).json({ ok: true });
  }

  // ── RATE LIMIT per IP ──────────────────────────────────────────
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || req.headers['x-real-ip']
            || 'unknown';
  const ipKey   = `rl:partner:ip:${ip}`;
  const emailKey = `rl:partner:email:${email.toLowerCase()}`;

  const [ipOk, emailOk] = await Promise.all([
    checkRateLimit(ipKey, RATE_IP_MAX, RATE_IP_TTL),
    checkRateLimit(emailKey, RATE_EMAIL_MAX, RATE_EMAIL_TTL),
  ]);

  if (!ipOk) {
    return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou în 60 de secunde.' });
  }
  if (!emailOk) {
    return res.status(429).json({ error: 'Această adresă a fost deja înregistrată recent.' });
  }


  try {
    // 1. Invitație reală — creează contul Supabase Auth cu rolul corect în metadate
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { role, nume: nume || '' },
    });
    if (inviteErr) throw inviteErr;

    // 2. Înregistrare în tabelul partners (documente/CUI se completează ulterior, la aprobare)
    const { error: partnerErr } = await supabaseAdmin.from('partners').insert({
      id: invited.user.id,
      partner_type: enumType,
      nume_firma: nume_firma || null,
      cui: cui || null,
      status_verificare: 'in_asteptare',
    });
    if (partnerErr) throw partnerErr;

    return res.status(200).json({ ok: true, user_id: invited.user.id });
  } catch (err) {
    console.error('[partner-register]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut înregistra partenerul.' });
  }
};

