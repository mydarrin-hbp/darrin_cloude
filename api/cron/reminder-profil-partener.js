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
//
// Pasul 11-R3 (2 nov. 2026): „complet” = lista „Activează contul” din
// dashboard (lib/activare-partener.js), nu doar cont bancar + serviciu.
// Partenerul nu mai e creat de api/public/partner-register.js (410): primesc
// reminderul și conturile care au ales un rol de partener (profiles.rol_solicitat)
// dar n-au completat încă firma (fără rând în partners). Linkul duce în
// dashboard-ul rolului, la listă.
//
// Pasul 11-R3c (3 nov. 2026): contul care n-a introdus codul de 6 cifre
// (auth.users.email_confirmed_at gol) nu primește reminderul (lib/email-confirmat.js).

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { renderEmailReminderProfilIncomplet, limbaProfilEmailComportamental } = require('../../lib/i18n');
const { incarcaContactPlatformaSigur } = require('../../lib/contact-platforma');
const { esteSuprimat } = require('../../lib/email-suppression');
const { stareActivare, ROLURI_PARTENER } = require('../../lib/activare-partener');
const { rolPentruTipPartener } = require('../../lib/roluri-partener');
const { dashboardPentruRol } = require('../../lib/destinatie-rol');
const { emailConfirmat } = require('../../lib/email-confirmat');

const SITE_URL = process.env.SITE_URL || 'https://mydarrin.homebestpal.com';

const PRAG_ORE = 48;
const TIP_EMAIL = 'profil_partener_incomplet_48h';

async function trimiteReminder(email, limba, nume, rol) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[reminder-profil-partener] RESEND_API_KEY lipsă — email netrimis către', email);
    return;
  }
  if (await esteSuprimat(email)) return;
  await incarcaContactPlatformaSigur(); // footerul de dezabonare / GDPR din back-office
  const link = rol ? SITE_URL + dashboardPentruRol(rol) : undefined;
  const { subiect, html } = renderEmailReminderProfilIncomplet(limba, { nume, link });
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

  const { data: parteneri, error: selErr } = await supabaseAdmin
    .from('partners')
    .select('id, nume_firma, status_verificare, creata_la, partner_type')
    .neq('status_verificare', 'rejected');
  if (selErr) {
    console.error('[reminder-profil-partener]', selErr);
    return res.status(500).json({ error: 'Eroare la căutarea candidaților' });
  }
  const candidati = (parteneri || []).map((p) => ({ ...p, rol: rolPentruTipPartener(p.partner_type) }));

  // Conturile care au ales un rol de partener, dar n-au completat firma.
  const { data: alesi, error: aleErr } = await supabaseAdmin
    .from('profiles')
    .select('id, nume, rol_solicitat, created_at')
    .in('rol_solicitat', ROLURI_PARTENER);
  if (aleErr) console.warn('[reminder-profil-partener] rol_solicitat:', aleErr.message || aleErr);
  const cuPartener = new Set(candidati.map((p) => p.id));
  (alesi || []).filter((p) => !cuPartener.has(p.id)).forEach((p) => {
    candidati.push({ id: p.id, nume_firma: p.nume || null, creata_la: p.created_at, rol: p.rol_solicitat });
  });

  let trimise = 0;
  let sarite = 0;
  const erori = [];
  const pragMs = PRAG_ORE * 3600000;

  for (const partener of candidati || []) {
    try {
      const stare = await stareActivare(partener.id, { roles: [], rolSolicitat: partener.rol });
      if (!stare || stare.activ || stare.complet) continue; // lista e completă — nu mai e candidat
      if (!(await emailConfirmat(partener.id))) continue; // fără codul de 6 cifre: niciun link spre dashboard

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

      await trimiteReminder(profil.email, limbaProfilEmailComportamental(profil), partener.nume_firma, partener.rol);

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
