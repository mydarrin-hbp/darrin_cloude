// /api/public/newsletter-confirma.js
// GET ?token=... — al doilea pas al dublului opt-in (audit Secțiunea 39,
// 30 Iulie 2026). Link-ul e trimis exclusiv prin email (vezi
// api/public/newsletter.js), niciodată afișat direct utilizatorului —
// token-ul e generat de DB (gen_random_uuid()), nu poate fi ghicit.
//
// Redirect, nu JSON — link-ul e deschis direct din client-ul de email,
// deci răspunsul trebuie să fie o pagină, nu date brute.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { renderEmailNewsletterBunVenit } = require('../../lib/i18n');
const { fromHeader } = require('../../lib/email-sender');

const REDIRECT_SUCCES = 'https://mydarrin.homebestpal.com/?newsletter=confirmat';
const REDIRECT_INVALID = 'https://mydarrin.homebestpal.com/?newsletter=invalid';

function redirect(res, url) {
  res.setHeader('Location', url);
  return res.status(302).end();
}

// Email de bun venit (24 august 2026) — gap real: până acum, confirmarea
// dublului opt-in doar redirecționa, fără niciun mesaj de mulțumire.
// Best-effort, izolat: o eroare la trimitere nu trebuie să blocheze
// redirect-ul, abonatul e oricum deja activ în DB.
async function trimiteEmailBunVenit(email, limba) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[newsletter-confirma] RESEND_API_KEY lipsă — email de bun venit netrimis către', email);
    return;
  }
  try {
    const { subiect, html } = renderEmailNewsletterBunVenit(limba);
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: await fromHeader(limba), to: email, subject: subiect, html }),
    });
  } catch (err) {
    console.error('[newsletter-confirma] email bun venit', err);
  }
}

module.exports = async function handler(req, res) {
  const token = req.query?.token;
  if (!token) return redirect(res, REDIRECT_INVALID);

  try {
    const { data, error } = await supabaseAdmin
      .from('newsletter_subscribers')
      .update({ status: 'activ', confirmat_la: new Date().toISOString() })
      .eq('token_confirmare', token)
      .eq('status', 'in_asteptare_confirmare')
      .select('id, email, limba')
      .maybeSingle();

    if (error) throw error;
    if (!data) return redirect(res, REDIRECT_INVALID);

    if (data.email) await trimiteEmailBunVenit(data.email, data.limba || 'ro');

    return redirect(res, REDIRECT_SUCCES);
  } catch (err) {
    console.error('[newsletter-confirma]', err);
    return redirect(res, REDIRECT_INVALID);
  }
};
