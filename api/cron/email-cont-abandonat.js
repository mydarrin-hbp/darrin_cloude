// /api/cron/email-cont-abandonat.js
// G24 — prima logică reală de email comportamental: cont de client creat,
// dar fără nicio comandă plasată după PRAG_ZILE zile. Construit peste
// Resend (deja folosit real, vezi lib/aloca-partener.js/lib/
// notifica-servicii-noi.js) — decizie confirmată, nu un instrument extern
// nou (Klaviyo/ActiveCampaign).
//
// Scop redus, deliberat: DOAR cont-abandonat (profil fără nicio comandă),
// NU coș-abandonat — arhitectura nu are azi un concept de "comandă
// început", doar comenzi reale, create la trimiterea finală a
// checkout-ului (comenzi_status_check nu are stare de "draft"). Coș-
// abandonat ar necesita o piesă nouă de instrumentare (endpoint care
// înregistrează intrarea în checkout), gap semnalat separat, nu construit
// aici.
//
// email_comportamental_log (user_id, tip) — unique — previne retrimiterea
// aceluiași email aceluiași cont la fiecare rulare zilnică a cron-ului.
//
// Rulează pe Vercel Cron, protejat cu CRON_SECRET, exact ca
// api/cron/auto-confirma-comenzi.js / api/cron/expira-acces-temporar.js.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const PRAG_ZILE = 3;
const TIP_EMAIL = 'cont_abandonat_3zile';

async function trimiteEmailContAbandonat(email, nume) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email-cont-abandonat] RESEND_API_KEY lipsă — email netrimis către', email);
    return;
  }
  const salut = nume ? nume : 'acolo';
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'noreply@homebestpal.com',
      to: email,
      subject: 'Ai rămas la jumătatea drumului — prima ta comandă My Darrin',
      html: `
        <p>Salut, ${salut},</p>
        <p>Am văzut că ți-ai făcut cont pe My Darrin, dar încă nu ai plasat nicio comandă.</p>
        <p>Catalogul are servicii, materiale și închirieri gata de comandat, cu deviz instant generat de Darrin AI și plată garantată prin escrow — banii ajung la partener doar după ce confirmi tu că lucrarea e făcută.</p>
        <p><a href="https://mydarrin.homebestpal.com/mydarrin-catalog" style="display:inline-block;background:#FF8C00;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700">Vezi catalogul</a></p>
        <p style="font-size:12px;color:#666">Dacă nu mai vrei să primești acest tip de email, scrie-ne la contact@homebestpal.com.</p>
      `,
    }),
  });
}

module.exports = async function handler(req, res) {
  const secretAsteptat = process.env.CRON_SECRET;
  const primit = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!secretAsteptat || primit !== secretAsteptat) {
    return res.status(401).json({ error: 'Neautorizat' });
  }

  const pragData = new Date(Date.now() - PRAG_ZILE * 86400000).toISOString();

  const { data: candidati, error: selErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, role')
    .eq('role', 'client')
    .lt('created_at', pragData);
  if (selErr) {
    console.error('[email-cont-abandonat]', selErr);
    return res.status(500).json({ error: 'Eroare la căutarea conturilor candidate' });
  }
  if (!candidati?.length) return res.status(200).json({ ok: true, trimise: 0 });

  let trimise = 0;
  const erori = [];

  for (const profil of candidati) {
    try {
      const { count } = await supabaseAdmin
        .from('comenzi')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', profil.id);
      if (count > 0) continue; // a comandat deja — nu e abandonat

      // Scriere condiționată de unicitate (user_id, tip) — dacă rândul
      // există deja, insert-ul eșuează silențios (23505) și sărim peste
      // trimitere; previne retrimiterea la fiecare rulare zilnică.
      const { error: logErr } = await supabaseAdmin
        .from('email_comportamental_log')
        .insert({ user_id: profil.id, tip: TIP_EMAIL });
      if (logErr) {
        if (logErr.code === '23505') continue; // deja trimis anterior
        throw logErr;
      }

      await trimiteEmailContAbandonat(profil.email, null);
      trimise++;
    } catch (err) {
      console.error('[email-cont-abandonat]', profil.email, err);
      erori.push({ email: profil.email, error: err.message });
    }
  }

  return res.status(200).json({ ok: true, trimise, erori });
};
