// /api/cron/email-cont-abandonat.js
// G24 — prima logică reală de email comportamental: cont creat, dar fără
// nicio activitate reală (client fără nicio comandă / partener aprobat
// fără nicio comandă alocată) după PRAG_ZILE zile. Construit peste Resend
// (deja folosit real, vezi lib/aloca-partener.js/lib/notifica-servicii-
// noi.js) — decizie confirmată, nu un instrument extern nou.
//
// EXTINDERE (audit Secțiunea 38, 30 Iulie 2026):
// 1. Text diferențiat client/partener (lib/i18n.js → renderEmailContAbandonat),
//    nu un singur text generic pentru toată lumea.
// 2. Limbă reală, nu RO hardcodat — profiles.limba/tara (capturate acum la
//    înregistrare, vezi account-system.js + api/public/partner-register.js
//    + migrarea SQL a trigger-ului handle_new_user()). Cont vechi, creat
//    înainte de această captură, nu are niciun semnal — cade pe RO (piața
//    de bază istorică), NU pe EN — regula "necunoscut → EN" se aplică doar
//    când țara e efectiv detectată și e în afara limbilor dedicate, nu când
//    lipsește complet informația.
// 3. Verificare listă de dezabonare reală (lib/email-suppression.js)
//    înainte de trimitere — respectă opțiunea de opt-out.
//
// Scop redus, deliberat, păstrat: DOAR cont-abandonat (profil fără nicio
// comandă/alocare), NU coș-abandonat — vezi email-cos-abandonat.js pentru
// acel caz distinct.
//
// email_comportamental_log (user_id, tip) — unique — previne retrimiterea
// aceluiași email aceluiași cont la fiecare rulare zilnică a cron-ului.
//
// Rulează pe Vercel Cron, protejat cu CRON_SECRET, exact ca
// api/cron/auto-confirma-comenzi.js / api/cron/expira-acces-temporar.js.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { renderEmailContAbandonat, limbaProfilEmailComportamental } = require('../../lib/i18n');
const { esteSuprimat } = require('../../lib/email-suppression');

const PRAG_ZILE = 3;
const TIP_EMAIL_CLIENT = 'cont_abandonat_3zile';
const TIP_EMAIL_PARTENER = 'cont_abandonat_partener_3zile';

async function trimiteEmail(email, rol, limba, nume) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email-cont-abandonat] RESEND_API_KEY lipsă — email netrimis către', email);
    return;
  }
  if (await esteSuprimat(email)) {
    console.log('[email-cont-abandonat] adresă dezabonată, sărim peste:', email);
    return;
  }
  const { subiect, html } = renderEmailContAbandonat(limba, rol, { nume });
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: 'noreply@homebestpal.com', to: email, subject: subiect, html }),
  });
}

module.exports = async function handler(req, res) {
  const secretAsteptat = process.env.CRON_SECRET;
  const primit = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!secretAsteptat || primit !== secretAsteptat) {
    return res.status(401).json({ error: 'Neautorizat' });
  }

  const pragData = new Date(Date.now() - PRAG_ZILE * 86400000).toISOString();
  let trimise = 0;
  const erori = [];

  // ── 1. Clienți — cont creat, nicio comandă plasată ──────────────────
  const { data: clienti, error: selErrC } = await supabaseAdmin
    .from('profiles')
    .select('id, email, tara, limba')
    .eq('role', 'client')
    .lt('created_at', pragData);
  if (selErrC) {
    console.error('[email-cont-abandonat]', selErrC);
    return res.status(500).json({ error: 'Eroare la căutarea clienților candidați' });
  }

  for (const profil of clienti || []) {
    try {
      const { count } = await supabaseAdmin
        .from('comenzi')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', profil.id);
      if (count > 0) continue; // a comandat deja — nu e abandonat

      const { error: logErr } = await supabaseAdmin
        .from('email_comportamental_log')
        .insert({ user_id: profil.id, tip: TIP_EMAIL_CLIENT });
      if (logErr) {
        if (logErr.code === '23505') continue; // deja trimis anterior
        throw logErr;
      }

      await trimiteEmail(profil.email, 'client', limbaProfilEmailComportamental(profil), null);
      trimise++;
    } catch (err) {
      console.error('[email-cont-abandonat][client]', profil.email, err);
      erori.push({ email: profil.email, error: err.message });
    }
  }

  // ── 2. Parteneri — aprobați, nicio comandă alocată vreodată ─────────
  const { data: parteneri, error: selErrP } = await supabaseAdmin
    .from('partners')
    .select('id, nume_firma, creata_la, status_verificare')
    .eq('status_verificare', 'approved')
    .lt('creata_la', pragData);
  if (selErrP) {
    console.error('[email-cont-abandonat]', selErrP);
    return res.status(200).json({ ok: true, trimise, erori: erori.concat([{ error: 'Eroare la căutarea partenerilor candidați: ' + selErrP.message }]) });
  }

  if (parteneri?.length) {
    const idPartneri = parteneri.map((p) => p.id);
    const { data: profilePartneri } = await supabaseAdmin
      .from('profiles')
      .select('id, email, tara, limba')
      .in('id', idPartneri);
    const profilById = new Map((profilePartneri || []).map((p) => [p.id, p]));

    for (const partener of parteneri) {
      const profil = profilById.get(partener.id);
      if (!profil?.email) continue;
      try {
        const { count } = await supabaseAdmin
          .from('comanda_subcontractori')
          .select('id', { count: 'exact', head: true })
          .eq('actor_id', partener.id);
        if (count > 0) continue; // a primit deja cel puțin o comandă alocată

        const { error: logErr } = await supabaseAdmin
          .from('email_comportamental_log')
          .insert({ user_id: partener.id, tip: TIP_EMAIL_PARTENER });
        if (logErr) {
          if (logErr.code === '23505') continue;
          throw logErr;
        }

        await trimiteEmail(profil.email, 'partener', limbaProfilEmailComportamental(profil), partener.nume_firma);
        trimise++;
      } catch (err) {
        console.error('[email-cont-abandonat][partener]', profil.email, err);
        erori.push({ email: profil.email, error: err.message });
      }
    }
  }

  return res.status(200).json({ ok: true, trimise, erori });
};
