// /api/partener/contract-trimite-otp.js
// G9 (25 Iulie 2026) — hard-stop real la preluarea comenzilor: pasul 3,
// semnarea electronică a contractului prin cod OTP trimis pe email
// (Resend, deja integrat pentru emailul de bun-venit — vezi
// api/public/partner-register.js). Precondiții verificate AICI, nu doar
// la accept-comanda.js, ca partenerul să știe exact ce-i lipsește:
//   1. partners.status_verificare === 'approved'
//   2. cel puțin un cont bancar activ în partner_conturi_bancare
// Starea vine din regula unică lib/eligibilitate-partener.js (pasul 10c);
// furnizorul propriu al platformei nu semnează contract.
// Codul se hash-uiește (SHA-256) înainte de a fi scris în DB — niciodată
// stocat în clar, la fel ca parola/IBAN-ul.

const crypto = require('crypto');
const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { eligibilitatePartener, MOTIV } = require('../../lib/eligibilitate-partener');

const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];

// Textul român e sursa; traducerea EN e în i18n/en.json (_texte).
const EROARE_CONTRACT_FURNIZOR_PROPRIU = 'Contul acesta este furnizorul propriu al platformei: nu are nevoie de contract de parteneriat.';

const COD_TTL_MS = 10 * 60 * 1000; // 10 minute
const RETRIMITE_MIN_MS = 60 * 1000; // 1 minut între cereri

function hashCod(cod) {
  return crypto.createHash('sha256').update(cod).digest('hex');
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const partner = await eligibilitatePartener(user.id);
  if (!partner) return res.status(404).json({ error: 'Cont de partener inexistent.' });

  if (partner.contract_semnat) {
    return res.status(200).json({ ok: true, deja_semnat: true });
  }
  // Pasul 10c: furnizorul propriu e chiar entitatea platformei — nu semnează
  // contract cu sine (lib/eligibilitate-partener.js).
  if (partner.furnizor_propriu) {
    return res.status(400).json({ error: EROARE_CONTRACT_FURNIZOR_PROPRIU, code: 'FURNIZOR_PROPRIU' });
  }
  if (partner.motiv === MOTIV.SUSPENDAT) {
    return res.status(403).json({ error: 'Contul tău este suspendat — contractul nu poate fi semnat.', code: 'CONT_SUSPENDAT' });
  }
  if (partner.status_verificare !== 'approved') {
    return res.status(403).json({
      error: 'Profilul tău nu a fost încă aprobat de echipa My Darrin. Semnarea contractului devine disponibilă după aprobare.',
      code: 'PROFIL_NEAPROBAT',
    });
  }
  if (!partner.cont_bancar) {
    return res.status(403).json({
      error: 'Adaugă mai întâi un cont bancar activ — contractul nu poate fi semnat fără date de încasare.',
      code: 'FARA_CONT_BANCAR',
    });
  }

  // Anti-spam: refuză o cerere nouă dacă există deja un cod netrimis-de-mult.
  const { data: recent } = await supabaseAdmin
    .from('partner_contract_otp')
    .select('creat_la')
    .eq('partner_id', user.id)
    .eq('folosit', false)
    .order('creat_la', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent && Date.now() - new Date(recent.creat_la).getTime() < RETRIMITE_MIN_MS) {
    return res.status(429).json({ error: 'Ai primit deja un cod recent — verifică emailul sau așteaptă un minut înainte de a cere altul.' });
  }

  const cod = String(Math.floor(100000 + Math.random() * 900000));
  const { error: insErr } = await supabaseAdmin.from('partner_contract_otp').insert({
    partner_id: user.id,
    cod_hash: hashCod(cod),
    expira_la: new Date(Date.now() + COD_TTL_MS).toISOString(),
  });
  if (insErr) {
    console.error('[contract-trimite-otp] insert', insErr);
    return res.status(500).json({ error: 'Nu am putut genera codul de confirmare.' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('[contract-trimite-otp] RESEND_API_KEY lipsă — codul nu poate fi trimis');
    return res.status(500).json({ error: 'Trimiterea emailului nu este configurată. Contactează administratorul.' });
  }

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'noreply@homebestpal.com',
        to: user.email,
        subject: 'Codul tău pentru semnarea contractului My Darrin',
        html: `<p>Codul tău de confirmare pentru semnarea electronică a contractului de parteneriat My Darrin este:</p>
               <p style="font-size:28px;font-weight:800;letter-spacing:.1em">${cod}</p>
               <p>Codul expiră în 10 minute. Dacă nu ai solicitat această acțiune, ignoră acest email.</p>`,
      }),
    });
    if (!emailRes.ok) throw new Error('resend status ' + emailRes.status);
  } catch (emailErr) {
    console.error('[contract-trimite-otp] email eșuat:', emailErr);
    return res.status(502).json({ error: 'Nu am putut trimite emailul cu codul. Încearcă din nou.' });
  }

  return res.status(200).json({ ok: true, trimis_la: user.email });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);
