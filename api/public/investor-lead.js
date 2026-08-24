// /api/public/investor-lead.js
// Endpoint PUBLIC (fără autentificare) — vizitatorii care completează
// formularul "Intră în rundă" nu au încă cont. Salvează cererea real
// în baza de date + trimite notificare email prin Resend.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { renderEmailInvestitorBunVenit, limbaDinTara } = require('../../lib/i18n');
const { fromHeader } = require('../../lib/email-sender');

// Email de bun venit (24 august 2026) — gap real: acest endpoint trimitea
// doar o notificare INTERNĂ către admin; investitorul care completa
// formularul nu primea niciodată vreun răspuns. Best-effort, izolat.
async function trimiteEmailBunVenitInvestitor(email, limba) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[investor-lead] RESEND_API_KEY lipsă — email de bun venit netrimis către', email);
    return;
  }
  try {
    const { subiect, html } = renderEmailInvestitorBunVenit(limba);
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: await fromHeader(limba), to: email, subject: subiect, html }),
    });
  } catch (err) {
    console.error('[investor-lead] email bun venit', err);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prenume, nume, email, telefon, ticket_size, instrument, nda_acceptat, tara, limba } = req.body || {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Adresă de email validă, obligatorie.' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('investitori_leads')
      .insert({
        prenume: prenume || null,
        nume: nume || null,
        email,
        telefon: telefon || null,
        ticket_size: ticket_size || null,
        instrument: instrument || null,
        nda_acceptat: !!nda_acceptat,
      })
      .select()
      .single();

    if (error) throw error;

    const limbaEfectiva = limba || (tara ? limbaDinTara(tara) : 'ro');
    await trimiteEmailBunVenitInvestitor(email, limbaEfectiva);

    // Notificare email prin Resend — best-effort, nu blocăm răspunsul dacă eșuează.
    // FIX (audit 31 Iulie 2026): fallback-ul anterior cădea pe o adresă personală
    // hardcodată în cod — singurul loc din tot proiectul care făcea asta (restul
    // fișierelor Resend sar peste trimitere, cu console.warn, dacă lipsește
    // configurarea — vezi email-cont-abandonat.js/newsletter.js). Lead-ul e oricum
    // salvat mai sus în investitori_leads indiferent de emailul de notificare —
    // niciun risc de pierdere de date dacă INVESTOR_LEAD_NOTIFY_EMAIL nu e setat,
    // doar lipsă de notificare imediată (vezi Secțiunea 38/40 din documentul de
    // lucru pentru gap-ul aferent: nicio pagină de admin nu listează încă
    // investitori_leads — email-ul rămâne azi singurul semnal în timp real).
    if (!process.env.INVESTOR_LEAD_NOTIFY_EMAIL) {
      console.warn('[investor-lead] INVESTOR_LEAD_NOTIFY_EMAIL lipsă — notificare netrimisă (lead-ul e salvat, doar fără alertă imediată)');
    } else if (process.env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'noreply@homebestpal.com',
            to: process.env.INVESTOR_LEAD_NOTIFY_EMAIL,
            subject: `🚀 Cerere nouă investitor: ${prenume || ''} ${nume || ''}`.trim(),
            html: `
              <h3>Cerere nouă de investiție — My Darrin</h3>
              <p><strong>Nume:</strong> ${prenume || '-'} ${nume || ''}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Telefon:</strong> ${telefon || '-'}</p>
              <p><strong>Ticket estimat:</strong> ${ticket_size || '-'}</p>
              <p><strong>Instrument:</strong> ${instrument || '-'}</p>
              <p><strong>NDA acceptat:</strong> ${nda_acceptat ? 'Da' : 'Nu'}</p>
            `,
          }),
        });
      } catch (emailErr) {
        console.error('[investor-lead] email notify failed:', emailErr);
      }
    }

    return res.status(200).json({ ok: true, lead_id: data.id });
  } catch (err) {
    console.error('[investor-lead]', err);
    return res.status(500).json({ error: 'Nu am putut salva cererea. Încearcă din nou.' });
  }
};
