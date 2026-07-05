// /api/public/investor-lead.js
// Endpoint PUBLIC (fără autentificare) — vizitatorii care completează
// formularul "Intră în rundă" nu au încă cont. Salvează cererea real
// în baza de date + trimite notificare email prin Resend.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prenume, nume, email, telefon, ticket_size, instrument, nda_acceptat } = req.body || {};

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

    // Notificare email prin Resend — best-effort, nu blocăm răspunsul dacă eșuează
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
            to: process.env.INVESTOR_LEAD_NOTIFY_EMAIL || 'cristianpopaban@gmail.com',
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
