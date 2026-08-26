// /api/auth/verify-otp.js
//
// FIX (Bug #27, audit 25-26 august 2026) — 3 defecte independente reparate:
// (1) endpoint-ul scria în profiles.telefon/telefon_verificat, coloane care
//     nu au existat NICIODATĂ (schema reală are doar `phone`) — orice apel
//     eșua cu eroare Postgres reală.
// (2) account-system.js::verifyPhoneOtp(telefon, cod) trimitea codul SMS
//     direct la acest endpoint, așteptând validare server-side — dar acest
//     fișier nu citea deloc acele câmpuri, presupunea că verificarea s-a
//     făcut deja client-side prin fluxul nativ Supabase. Protocol incompatibil,
//     reparat acum pe ambele părți (vezi account-system.js).
// (3) funcția client nu era apelată de nicio pagină — 2 conturi reale rămase
//     permanent la status='pending_otp'. UI nou adăugat: tab Profilul meu,
//     dashboard client, opțional (nu blochează accesul).
//
// Fluxul corect, nativ Supabase Auth (Phone OTP — necesită provider SMS
// configurat în Dashboard → Authentication → Providers → Phone, Twilio/
// MessageBird/Vonage; asta rămâne o dependință externă, neverificabilă din cod):
//
//   1. await supabase.auth.updateUser({ phone: '+407xxxxxxxx' })
//   2. Supabase trimite automat SMS cu cod
//   3. await supabase.auth.verifyOtp({ phone, token: cod, type: 'phone_change' })
//
// Acest endpoint rulează DUPĂ pasul 3, doar ca să marcheze telefonul ca
// verificat în tabelul `profiles` (folosit de restul aplicației).

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
    .update({ phone: user.phone, phone_verificat: true })
    .eq('id', user.id);

  if (error) {
    console.error('[verify-otp]', error);
    return res.status(500).json({ error: 'Nu am putut actualiza profilul' });
  }

  return res.status(200).json({ ok: true, phone_verificat: true });
}

// Necesită doar sesiune validă, nu un rol anume (orice user autentificat își
// poate finaliza propria verificare de telefon).
module.exports = requireAuth([], handler);
