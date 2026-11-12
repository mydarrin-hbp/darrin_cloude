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
const { limiteazaCererea } = require('../../lib/rate-limit');
const v = require('../../lib/valideaza');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: câmpurile acceptate; orice alt câmp e refuzat.
const SCHEMA = {
  email: v.email({ obligatoriu: true, eticheta: ['Email', 'Email'] }),
  gdpr_accepted: v.boolean({ obligatoriu: true, adevarat: true, eticheta: ['Acordul GDPR', 'GDPR consent'] }),
  sursa: v.text({ max: 50, eticheta: ['Sursa', 'Source'] }),
  tara: v.text({ max: 8, eticheta: ['Țară', 'Country'] }),
  limba: v.text({ max: 5, model: /^[a-z]{2}$/, eticheta: ['Limbă', 'Language'] }),
};
const { renderEmailNewsletterConfirmare, limbaDinTara } = require('../../lib/i18n');
const { incarcaContactPlatformaSigur } = require('../../lib/contact-platforma');
const { fromHeader } = require('../../lib/email-sender');

async function trimiteEmailConfirmare(email, token, limba) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[newsletter] RESEND_API_KEY lipsă — email de confirmare netrimis către', email);
    return;
  }
  const link = `https://mydarrin.homebestpal.com/api/public/newsletter-confirma?token=${token}`;
  await incarcaContactPlatformaSigur(); // footerul de dezabonare / GDPR din back-office
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

  const date = v.valideazaSauTrimite(req, res, SCHEMA);
  if (!date) return;
  const { email, sursa, tara, limba } = date;

  // Cel mult 5 cereri în 10 minute, pe IP și pe email (pasul 11-S1: și pe email).
  if (!(await limiteazaCererea(req, res, { key: 'newsletter', limit: 5, windowSeconds: 600, email }))) return;

  // Limbă: formularul de newsletter (footer, toate paginile publice) nu
  // transportă azi nicio limbă/țară detectată — spre deosebire de fluxurile
  // de cont, unde myd-geo.js e legat explicit. Cât timp rămâne așa, RO e
  // implicit corect (paginile publice sunt scrise în română), NU EN — dacă
  // vreo pagină trimite explicit `limba`/`tara` (viitor, neconstruit acum),
  // se respectă acea valoare.
  const limbaEfectiva = limba || (tara ? limbaDinTara(tara) : 'ro');

  try {
    const emailNormalizat = email;
    const { data, error } = await supabaseAdmin
      .from('newsletter_subscribers')
      .insert({ email: emailNormalizat, gdpr_accepted: true, sursa: sursa || null, status: 'in_asteptare_confirmare', limba: limbaEfectiva })
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
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut înregistra abonarea. Încercați din nou.', 'We could not register your subscription. Please try again.');
  }
};
