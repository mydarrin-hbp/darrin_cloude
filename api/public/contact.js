// /api/public/contact.js
// Adăugat 2026-07-12 — endpoint public pentru formularul de contact
// (înlocuiește link-urile mailto: statice). Stochează mesajul (vizibil în
// backoffice) și trimite o notificare prin Resend către contact@homebestpal.com.
//
// `predestinatie` există ca să nu fie nevoie de o schimbare de schemă mai
// târziu, dacă se decide rutarea pe mai multe adrese — azi toate merg la
// aceeași adresă unică, așa cum s-a confirmat explicit.
//
// Body: { nume, email, predestinatie, mesaj }

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');

const DESTINATIE_UNICA = 'contact@homebestpal.com';
const PREDESTINATII_VALIDE = ['general', 'parteneri', 'investitori', 'suport'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const allowed = await checkRateLimit(req, { key: 'contact', limit: 5, windowSeconds: 600 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.' });

  const { nume, email, mesaj } = req.body || {};
  const predestinatie = PREDESTINATII_VALIDE.includes(req.body?.predestinatie) ? req.body.predestinatie : 'general';

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Adresă de email validă, obligatorie.' });
  }
  if (!mesaj || !mesaj.trim()) {
    return res.status(400).json({ error: 'Mesajul este obligatoriu.' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('mesaje_contact')
      .insert({ nume: nume || null, email, predestinatie, mesaj })
      .select()
      .single();
    if (error) throw error;

    if (process.env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'noreply@homebestpal.com',
            to: DESTINATIE_UNICA,
            reply_to: email,
            subject: `📨 Mesaj contact (${predestinatie}): ${nume || email}`,
            html: `
              <p><strong>Nume:</strong> ${nume || '-'}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Predestinație:</strong> ${predestinatie}</p>
              <p><strong>Mesaj:</strong></p>
              <p>${mesaj.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>
            `,
          }),
        });
      } catch (emailErr) {
        console.error('[contact] notificare email eșuată:', emailErr);
      }
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('[contact]', err);
    return res.status(500).json({ error: 'Nu am putut trimite mesajul. Încearcă din nou.' });
  }
};
