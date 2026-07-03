// /api/auth/verify-otp.js
//
// IMPORTANT: trimiterea + verificarea efectivă a codului SMS se face prin
// mecanismul NATIV Supabase Auth (Phone OTP), care necesită un provider SMS
// configurat în Dashboard → Authentication → Providers → Phone (Twilio /
// MessageBird / Vonage). Fluxul din browser e:
//
//   1. await supabase.auth.updateUser({ phone: '+407xxxxxxxx' })
//   2. Supabase trimite automat SMS cu cod
//   3. await supabase.auth.verifyOtp({ phone, token: cod, type: 'phone_change' })
//
// Acest endpoint rulează DUPĂ pasul 3, doar ca să marcheze telefonul ca
// verificat în tabelul `profiles` (folosit de restul aplicației) și să
// activeze contul (roles rămâne [] — clientul alege rolul ulterior).

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // La acest punct, dacă requireAuth a trecut, JWT-ul e valid — iar dacă
  // pasul 3 (verifyOtp client-side) a reușit, user.phone_confirmed_at va fi setat.
  if (!user.phone_confirmed_at) {
    return res.status(400).json({ error: 'Telefonul nu a fost încă verificat prin OTP (pas anterior lipsă)' });
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ telefon: user.phone, telefon_verificat: true })
    .eq('id', user.id);

  if (error) {
    console.error('[verify-otp]', error);
    return res.status(500).json({ error: 'Nu am putut actualiza profilul' });
  }

  return res.status(200).json({ ok: true, telefon_verificat: true });
}

// Necesită doar sesiune validă, nu un rol anume (orice user autentificat își
// poate finaliza propria verificare de telefon).
module.exports = requireAuth([], handler);
