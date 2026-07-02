// lib/supabaseAdmin.js
// Client Supabase pentru SERVER (funcții /api). Folosește service_role key
// — are drepturi depline, ocolește RLS. NU importa acest fișier niciodată
// în cod care rulează în browser.
//
// Variabile de mediu necesare în Vercel (Project Settings → Environment Variables):
//   SUPABASE_URL              = https://xxxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY = ey... (secret, doar server-side)

const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[supabaseAdmin] Lipsesc variabilele de mediu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

module.exports = { supabaseAdmin };
