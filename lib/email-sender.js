// lib/email-sender.js
// Expeditor configurabil (audit Secțiunea 39, 30 Iulie 2026, cerință
// "Configurare Dinamică a Expeditorului"). Adresa efectivă rămâne
// noreply@homebestpal.com — SINGURUL domeniu verificat azi în Resend
// (SPF/DKIM/DMARC configurate doar pentru homebestpal.com). Un alias pe
// alt domeniu per regiune (ex. noreply@platforma.ro) ar necesita
// verificarea acelui domeniu în Resend Dashboard — decizie/acțiune de
// superadmin, semnalată în Secțiunea 38, NU construită aici ca să nu
// trimitem email-uri care pică la SPF/DKIM de pe un domeniu neverificat.
//
// Ce e real, configurabil azi: NUMELE afișat al expeditorului, per limbă,
// citit din backoffice_config (secțiune 'email', cheie 'nume_expeditor_<limba>'),
// cu fallback la un nume implicit dacă nu există rând configurat.

const { supabaseAdmin } = require('./supabaseAdmin');

const NUME_IMPLICIT = 'My Darrin';
const ADRESA_NOREPLY = 'noreply@homebestpal.com';

async function fromHeader(limba) {
  let nume = NUME_IMPLICIT;
  try {
    const { data } = await supabaseAdmin
      .from('backoffice_config')
      .select('valoare')
      .eq('cheie', `nume_expeditor_${limba || 'ro'}`)
      .eq('sectiune', 'email')
      .maybeSingle();
    if (data?.valoare) nume = data.valoare;
  } catch (e) {
    console.error('[email-sender] eroare la citirea numelui expeditorului configurat', e);
  }
  return `${nume} <${ADRESA_NOREPLY}>`;
}

module.exports = { fromHeader, ADRESA_NOREPLY };
