// /api/cron/email-cos-abandonat.js
// G24b — a doua logică de email comportamental, peste Resend (aceeași
// decizie de scop ca G24: cont abandonat). Foloseste noua instrumentare
// checkout_inceput_log (api/client/checkout-inceput.js) — singurul semnal
// server-side pentru „a ajuns pe checkout", pentru că o comandă reală se
// creează abia la trimiterea finală (comenzi_status_check nu are stare de
// „draft").
//
// Logică: pentru fiecare utilizator, ia ULTIMA vizită de checkout mai
// veche de PRAG_ORE ore; dacă nu are nicio comandă creată DUPĂ acea
// vizită, a abandonat coșul — trimite email, o singură dată (
// email_comportamental_log, tip='cos_abandonat', unique(user_id,tip) —
// la fel ca G24, previne retrimiterea la fiecare rulare).
//
// Rulează pe Vercel Cron, protejat cu CRON_SECRET, același tipar ca
// api/cron/email-cont-abandonat.js.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { esteSuprimat } = require('../../lib/email-suppression');

const PRAG_ORE = 4;
const TIP_EMAIL = 'cos_abandonat';

async function trimiteEmailCosAbandonat(email) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email-cos-abandonat] RESEND_API_KEY lipsă — email netrimis către', email);
    return;
  }
  // Aceeași listă de dezabonare reală ca email-cont-abandonat.js (audit
  // Secțiunea 38) — footer-ul de mai jos promite exact asta, deci trebuie
  // respectată și aici, nu doar la celălalt email comportamental.
  if (await esteSuprimat(email)) {
    console.log('[email-cos-abandonat] adresă dezabonată, sărim peste:', email);
    return;
  }
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'noreply@homebestpal.com',
      to: email,
      subject: 'Ai rămas la un pas de finalizarea comenzii',
      html: `
        <p>Salut,</p>
        <p>Am văzut că ai ajuns pe pagina de finalizare a comenzii pe My Darrin, dar n-ai apucat să o trimiți.</p>
        <p>Devizul tău rămâne calculat de Darrin AI, iar plata e protejată prin escrow — banii ajung la partener doar după ce confirmi tu că lucrarea e făcută.</p>
        <p><a href="https://mydarrin.homebestpal.com/mydarrin-catalog" style="display:inline-block;background:#FF8C00;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700">Reia comanda</a></p>
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

  const pragData = new Date(Date.now() - PRAG_ORE * 3600000).toISOString();

  const { data: vizite, error: selErr } = await supabaseAdmin
    .from('checkout_inceput_log')
    .select('user_id, creat_la')
    .lt('creat_la', pragData)
    .order('creat_la', { ascending: false });
  if (selErr) {
    console.error('[email-cos-abandonat]', selErr);
    return res.status(500).json({ error: 'Eroare la căutarea vizitelor de checkout' });
  }
  if (!vizite?.length) return res.status(200).json({ ok: true, trimise: 0 });

  // Păstrăm doar ULTIMA vizită per utilizator (rândurile sunt deja
  // ordonate descrescător după creat_la, deci primul întâlnit per user_id
  // e cel mai recent).
  const ultimaVizitaPerUser = new Map();
  for (const v of vizite) {
    if (!ultimaVizitaPerUser.has(v.user_id)) ultimaVizitaPerUser.set(v.user_id, v.creat_la);
  }

  let trimise = 0;
  const erori = [];

  for (const [userId, ultimaVizita] of ultimaVizitaPerUser) {
    try {
      const { count } = await supabaseAdmin
        .from('comenzi')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', userId)
        .gt('creat_la', ultimaVizita);
      if (count > 0) continue; // a comandat după acea vizită — nu e abandonat

      const { error: logErr } = await supabaseAdmin
        .from('email_comportamental_log')
        .insert({ user_id: userId, tip: TIP_EMAIL });
      if (logErr) {
        if (logErr.code === '23505') continue; // deja trimis anterior
        throw logErr;
      }

      const { data: profil } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .eq('id', userId)
        .maybeSingle();
      if (!profil?.email) continue;

      await trimiteEmailCosAbandonat(profil.email);
      trimise++;
    } catch (err) {
      console.error('[email-cos-abandonat]', userId, err);
      erori.push({ user_id: userId, error: err.message });
    }
  }

  return res.status(200).json({ ok: true, trimise, erori });
};
