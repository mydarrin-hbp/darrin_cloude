// /api/public/trimite-bun-venit-client.js
// Gap real găsit la audit (Secțiunea 39, 30 Iulie 2026): parteneri primesc
// deja un email de bun venit (renderEmailBunVenitPartener), clienții nu
// primeau niciun echivalent — doar emailul standard "Confirm signup" al
// Supabase Auth (nelocalizat, în afara lib/i18n.js).
//
// Endpoint PUBLIC (fără requireAuth) — apelat de account-system.js imediat
// după signUp(), înainte ca sesiunea să fie neapărat confirmată. Ca să nu
// devină o rută de spam pe orice adresă arbitrară, NU trimite un email
// "din senin": caută un profil real, recent creat, cu rolul client, și
// deduplichează prin email_comportamental_log — cel mult un singur email
// per cont, indiferent de câte ori e apelat endpoint-ul.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { renderEmailBunVenitClient, limbaProfilEmailComportamental } = require('../../lib/i18n');
const { fromHeader } = require('../../lib/email-sender');

const TIP_EMAIL = 'bun_venit_client';
const FEREASTRA_MINUTE = 15; // profilul trebuie creat foarte recent — altfel nu răspundem la acest apel

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email obligatoriu' });

  try {
    const pragRecent = new Date(Date.now() - FEREASTRA_MINUTE * 60000).toISOString();
    const { data: profil, error: selErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, tara, limba, role, created_at')
      .eq('email', email.trim().toLowerCase())
      .eq('role', 'client')
      .gt('created_at', pragRecent)
      .maybeSingle();
    if (selErr) throw selErr;
    if (!profil) return res.status(200).json({ ok: true, trimis: false });

    const { error: logErr } = await supabaseAdmin
      .from('email_comportamental_log')
      .insert({ user_id: profil.id, tip: TIP_EMAIL });
    if (logErr) {
      if (logErr.code === '23505') return res.status(200).json({ ok: true, trimis: false, motiv: 'deja_trimis' });
      throw logErr;
    }

    if (!process.env.RESEND_API_KEY) {
      console.warn('[trimite-bun-venit-client] RESEND_API_KEY lipsă — email netrimis către', profil.email);
      return res.status(200).json({ ok: true, trimis: false });
    }

    const limba = limbaProfilEmailComportamental(profil);
    const { subiect, html } = renderEmailBunVenitClient(limba, { nume: null });
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: await fromHeader(limba), to: profil.email, subject: subiect, html }),
    });

    return res.status(200).json({ ok: true, trimis: true });
  } catch (err) {
    console.error('[trimite-bun-venit-client]', err);
    return res.status(500).json({ error: 'Eroare internă' });
  }
};
