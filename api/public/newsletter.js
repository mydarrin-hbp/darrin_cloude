// /api/public/newsletter.js
// Endpoint public pentru abonarea la Newsletter My Darrin — folosit de
// formularul din footer, prezent pe toate paginile publice. Înlocuiește
// insertul direct din client (supabaseClient.from('newsletter_subscribers'))
// care nu putea funcționa: tabela nu exista în DB, iar chiar dacă ar fi
// existat, RLS (fără nicio policy publică, la fel ca mesaje_contact și
// parteneri_prospecti) ar fi blocat scrierea directă din anon key.
//
// Body: { email, gdpr_accepted, sursa }

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const allowed = await checkRateLimit(req, { key: 'newsletter', limit: 5, windowSeconds: 600 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.' });

  const { email, gdpr_accepted, sursa } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Adresă de email validă, obligatorie.' });
  }
  if (!gdpr_accepted) {
    return res.status(400).json({ error: 'Acordul GDPR este obligatoriu.' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('newsletter_subscribers')
      .insert({ email: email.trim().toLowerCase(), gdpr_accepted: true, sursa: sursa || null });

    if (error) {
      if (error.code === '23505') return res.status(200).json({ ok: true, deja_abonat: true });
      throw error;
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[newsletter]', err);
    return res.status(500).json({ error: 'Nu am putut înregistra abonarea. Încearcă din nou.' });
  }
};
