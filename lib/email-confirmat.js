// lib/email-confirmat.js
// Pasul 11-R3c (3 nov. 2026): emailurile automate (cron-urile de cont
// abandonat și de activare) nu pleacă spre conturi care n-au introdus încă
// codul de 6 cifre: un email cu link spre dashboard ar contrazice codul.
// Sursa: auth.users.email_confirmed_at, citit cu service role. La orice
// eroare de citire: „neconfirmat” (nu trimitem).

const { supabaseAdmin } = require('./supabaseAdmin');

async function emailConfirmat(userId) {
  if (!userId) return false;
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error) {
      console.warn('[email-confirmat]', userId, error.message || error);
      return false;
    }
    return !!(data && data.user && data.user.email_confirmed_at);
  } catch (e) {
    console.warn('[email-confirmat]', userId, e.message || e);
    return false;
  }
}

module.exports = { emailConfirmat };
