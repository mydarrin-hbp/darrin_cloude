// /api/public/newsletter.js
// Endpoint public pentru abonarea la Newsletter My Darrin — folosit de
// formularul din footer, prezent pe toate paginile publice. Înlocuiește
// insertul direct din client (supabaseClient.from('newsletter_subscribers'))
// care nu putea funcționa: tabela nu exista în DB, iar chiar dacă ar fi
// existat, RLS (fără nicio policy publică, la fel ca mesaje_contact și
// parteneri_prospecti) ar fi blocat scrierea directă din anon key.
//
// DUBLU OPT-IN (audit Secțiunea 39, 30 Iulie 2026, cerință explicită):
// înainte scria direct status='activ' (default coloană), fără nicio
// confirmare — acum rândul e creat cu status='in_asteptare_confirmare',
// iar activarea reală se face doar la click pe link-ul din emailul
// trimis mai jos (vezi api/public/newsletter-confirma.js).
//
// Body: { email, gdpr_accepted, sursa }

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');
const { renderEmailNewsletterConfirmare, limbaDinTara } = require('../../lib/i18n');
const { fromHeader } = require('../../lib/email-sender');

async function trimiteEmailConfirmare(email, token, limba) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[newsletter] RESEND_API_KEY lipsă — email de confirmare netrimis către', email);
    return;
  }
  const link = `https://mydarrin.homebestpal.com/api/public/newsletter-confirma?token=${token}`;
  const { subiect, html } = renderEmailNewsletterConfirmare(limba, link);
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: await fromHeader(limba), to: email, subject: subiect, html }),
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const allowed = await checkRateLimit(req, { key: 'newsletter', limit: 5, windowSeconds: 600 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.' });

  const { email, gdpr_accepted, sursa, tara, limba } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Adresă de email validă, obligatorie.' });
  }
  if (!gdpr_accepted) {
    return res.status(400).json({ error: 'Acordul GDPR este obligatoriu.' });
  }

  // Limbă: formularul de newsletter (footer, toate paginile publice) nu
  // transportă azi nicio limbă/țară detectată — spre deosebire de fluxurile
  // de cont, unde myd-geo.js e legat explicit. Cât timp rămâne așa, RO e
  // implicit corect (paginile publice sunt scrise în română), NU EN — dacă
  // vreo pagină trimite explicit `limba`/`tara` (viitor, neconstruit acum),
  // se respectă acea valoare.
  const limbaEfectiva = limba || (tara ? limbaDinTara(tara) : 'ro');

  try {
    const emailNormalizat = email.trim().toLowerCase();
    const { data, error } = await supabaseAdmin
      .from('newsletter_subscribers')
      .insert({ email: emailNormalizat, gdpr_accepted: true, sursa: sursa || null, status: 'in_asteptare_confirmare' })
      .select('token_confirmare')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(200).json({ ok: true, deja_abonat: true });
      throw error;
    }

    await trimiteEmailConfirmare(emailNormalizat, data.token_confirmare, limbaEfectiva);
    return res.status(200).json({ ok: true, necesita_confirmare: true });
  } catch (err) {
    console.error('[newsletter]', err);
    return res.status(500).json({ error: 'Nu am putut înregistra abonarea. Încearcă din nou.' });
  }
};
