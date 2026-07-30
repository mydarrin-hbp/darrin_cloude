// lib/email-suppression.js
// Listă reală de dezabonare pentru email-uri comportamentale/marketing
// (cont abandonat, coș abandonat) — NU pentru email-uri tranzacționale
// (confirmare comandă, cod OTP, escrow), care rămân obligatorii pentru
// funcționarea contului.
//
// Populată de api/email/webhook-primire.js (Resend Inbound → email.received,
// contact@homebestpal.com) — un mesaj primit acolo cu adresa de dezabonat e
// preluat automat, fără intervenție manuală (audit Secțiunea 38, 30 Iulie 2026).

const { supabaseAdmin } = require('./supabaseAdmin');

async function esteSuprimat(email) {
  if (!email) return false;
  const { data, error } = await supabaseAdmin
    .from('email_suppression_list')
    .select('email')
    .eq('email', String(email).toLowerCase().trim())
    .maybeSingle();
  if (error) {
    console.error('[email-suppression] eroare la verificare', error);
    return false; // fail-open pe eroare de citire — nu blocăm trimiterea din cauza unei erori tehnice
  }
  return !!data;
}

async function adaugaSuprimare(email, motiv) {
  const emailNormalizat = String(email || '').toLowerCase().trim();
  if (!emailNormalizat) return;
  const { error } = await supabaseAdmin
    .from('email_suppression_list')
    .upsert({ email: emailNormalizat, motiv: motiv || null }, { onConflict: 'email' });
  if (error) console.error('[email-suppression] eroare la adăugare', error);
}

module.exports = { esteSuprimat, adaugaSuprimare };
