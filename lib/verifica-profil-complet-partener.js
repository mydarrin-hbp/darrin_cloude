// lib/verifica-profil-complet-partener.js
// "Profil 100% complet" (Etapa 2i, confirmat explicit de fondator, 26 august
// 2026): cont bancar activ (partner_conturi_bancare) + cel puțin un serviciu
// activ în portofoliu (partener_servicii_active). Folosit de 2 locuri —
// reminder-ul de 48h (api/cron/reminder-profil-partener.js, pentru profile
// ÎNCĂ incomplete) și emailul de finalizare (trimis o singură dată, la
// momentul exact în care profilul devine complet — apelat din
// api/partener/conturi-bancare.js și api/partener/portofoliu.js, cele 2
// singure locuri care pot completa ultima piesă lipsă).

const { supabaseAdmin } = require('./supabaseAdmin');
const { renderEmailProfilPartenerComplet, limbaProfilEmailComportamental } = require('./i18n');

const TIP_EMAIL_PROFIL_COMPLET = 'profil_partener_100_complet';

async function areContBancarActiv(partnerId) {
  const { count } = await supabaseAdmin
    .from('partner_conturi_bancare')
    .select('id', { count: 'exact', head: true })
    .eq('partner_id', partnerId)
    .eq('activ', true);
  return count > 0;
}

async function areServiciuActiv(partnerId) {
  const { count } = await supabaseAdmin
    .from('partener_servicii_active')
    .select('id', { count: 'exact', head: true })
    .eq('partener_id', partnerId)
    .eq('activ', true);
  return count > 0;
}

async function esteProfilComplet(partnerId) {
  const [bancar, serviciu] = await Promise.all([areContBancarActiv(partnerId), areServiciuActiv(partnerId)]);
  return bancar && serviciu;
}

// Apelat DUPĂ o scriere reușită (cont bancar adăugat SAU serviciu activat) —
// verifică dacă profilul a devenit complet ACUM și, dacă da, trimite emailul
// de finalizare exact o singură dată (unique constraint pe email_comportamental_log
// previne retrimiterea, nu o verificare separată de stare).
async function verificaSiNotificaProfilComplet(partnerId) {
  try {
    const complet = await esteProfilComplet(partnerId);
    if (!complet) return;

    const { error: logErr } = await supabaseAdmin
      .from('email_comportamental_log')
      .insert({ user_id: partnerId, tip: TIP_EMAIL_PROFIL_COMPLET });
    if (logErr) {
      if (logErr.code === '23505') return; // deja trimis
      throw logErr;
    }

    const [{ data: profil }, { data: partner }] = await Promise.all([
      supabaseAdmin.from('profiles').select('email, tara, limba').eq('id', partnerId).maybeSingle(),
      supabaseAdmin.from('partners').select('nume_firma').eq('id', partnerId).maybeSingle(),
    ]);
    if (!profil?.email || !process.env.RESEND_API_KEY) return;

    const limba = limbaProfilEmailComportamental(profil);
    const { subiect, html } = renderEmailProfilPartenerComplet(limba, { nume: partner?.nume_firma || null });
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'noreply@homebestpal.com', to: profil.email, subject: subiect, html }),
    });
  } catch (err) {
    // Best-effort — nu trebuie să blocheze niciodată scrierea reușită
    // (adăugarea contului/activarea serviciului) care a declanșat verificarea.
    console.error('[verifica-profil-complet-partener]', err);
  }
}

module.exports = { esteProfilComplet, verificaSiNotificaProfilComplet, TIP_EMAIL_PROFIL_COMPLET };
