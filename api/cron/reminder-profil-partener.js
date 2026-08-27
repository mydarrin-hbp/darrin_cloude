// /api/cron/reminder-profil-partener.js
// Etapa 2i (confirmat de fondator, 26 august 2026) — "reminder la fiecare
// 48h dacă profilul nu e 100% complet". Complet ≠ aprobat — se aplică
// oricărui partener, indiferent de status_verificare, cu excepția celor
// respinși (rejected — n-are sens să insiști pe un cont respins).
//
// Repetitiv, nu o singură dată (spre deosebire de email-cont-abandonat.js):
// reutilizează exact tabela email_comportamental_log, dar prin UPSERT pe
// (user_id, tip), nu INSERT — se citește trimis_la existent înainte de
// scriere, ca să se decidă dacă au trecut 48h, apoi se actualizează.
//
// Rulează pe Vercel Cron, protejat cu CRON_SECRET, exact ca celelalte
// cron-uri din acest proiect.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { renderEmailReminderProfilIncomplet, limbaProfilEmailComportamental } = require('../../lib/i18n');
const { esteSuprimat } = require('../../lib/email-suppression');
const { esteProfilComplet } = require('../../lib/verifica-profil-complet-partener');

const PRAG_ORE = 48;
const TIP_EMAIL = 'profil_partener_incomplet_48h';

async function trimiteReminder(email, limba, nume) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[reminder-profil-partener] RESEND_API_KEY lipsă — email netrimis către', email);
    return;
  }
  if (await esteSuprimat(email)) return;
  const { subiect, html } = renderEmailReminderProfilIncomplet(limba, { nume });
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'noreply@homebestpal.com', to: email, subject: subiect, html }),
  });
}

module.exports = async function handler(req, res) {
  const secretAsteptat = process.env.CRON_SECRET;
  const primit = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!secretAsteptat || primit !== secretAsteptat) {
    return res.status(401).json({ error: 'Neautorizat' });
  }

  const { data: candidati, error: selErr } = await supabaseAdmin
    .from('partners')
    .select('id, nume_firma, status_verificare, creata_la')
    .neq('status_verificare', 'rejected');
  if (selErr) {
    console.error('[reminder-profil-partener]', selErr);
    return res.status(500).json({ error: 'Eroare la căutarea candidaților' });
  }

  let trimise = 0;
  let sarite = 0;
  const erori = [];
  const pragMs = PRAG_ORE * 3600000;

  for (const partener of candidati || []) {
    try {
      const complet = await esteProfilComplet(partener.id);
      if (complet) continue; // deja complet — nu mai e candidat, indiferent de istoric

      const { data: logExistent } = await supabaseAdmin
        .from('email_comportamental_log')
        .select('id, trimis_la')
        .eq('user_id', partener.id)
        .eq('tip', TIP_EMAIL)
        .maybeSingle();

      const ultimaTrimitere = logExistent ? new Date(logExistent.trimis_la).getTime() : new Date(partener.creata_la).getTime();
      if (Date.now() - ultimaTrimitere < pragMs) { sarite++; continue; }

      const { data: profil } = await supabaseAdmin
        .from('profiles')
        .select('email, tara, limba')
        .eq('id', partener.id)
        .maybeSingle();
      if (!profil?.email) continue;

      await trimiteReminder(profil.email, limbaProfilEmailComportamental(profil), partener.nume_firma);

      if (logExistent) {
        await supabaseAdmin.from('email_comportamental_log').update({ trimis_la: new Date().toISOString() }).eq('id', logExistent.id);
      } else {
        await supabaseAdmin.from('email_comportamental_log').insert({ user_id: partener.id, tip: TIP_EMAIL });
      }
      trimise++;
    } catch (err) {
      console.error('[reminder-profil-partener]', partener.id, err);
      erori.push({ partner_id: partener.id, error: err.message });
    }
  }

  return res.status(200).json({ ok: true, trimise, sarite, erori });
};
