// /api/cron/expira-acces-temporar.js
// Curăță accesele temporare expirate: marchează activ=false ȘI invalidează
// parola în Supabase Auth (o suprascrie cu una aleatoare, necunoscută
// nimănui).
//
// FIX (testat live, 2026-07-23): fără acest pas, expirarea `expira_la` e
// enforsată DOAR de propria poartă (/api/public/verifica-acces-temporar,
// pe care pagina de login o consultă înainte de signInWithPassword) — dar
// contul Supabase Auth în sine rămâne cu parola veche validă la nesfârșit.
// Cineva care reține parola dintr-un acces expirat de mult ar putea încă
// să se autentifice direct cu Supabase, ocolind complet poarta. Exact
// aceeași scurgere confirmată la revocarea manuală (vezi
// api/admin/revoca-acces-temporar.js) — aici e varianta ei pentru expirare
// naturală, nu doar pentru revocare explicită de admin.
//
// Nu apelăm auth.admin.signOut(user_id) — API-ul cere un JWT, nu un user
// ID (confirmat din documentația Supabase); nu există nicio metodă de a
// invalida forțat un access-token deja emis, doar parola (blochează login
// NOU) și refresh-token-urile viitoare, vezi comentariul din
// api/admin/revoca-acces-temporar.js.
//
// Rulează pe Vercel Cron (vezi vercel.json → crons), protejat cu
// CRON_SECRET, exact ca api/cron/auto-confirma-comenzi.js.

const crypto = require('crypto');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

module.exports = async function handler(req, res) {
  const secretAsteptat = process.env.CRON_SECRET;
  const primit = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!secretAsteptat || primit !== secretAsteptat) {
    return res.status(401).json({ error: 'Neautorizat' });
  }

  const { data: expirate, error: selErr } = await supabaseAdmin
    .from('accese_temporare')
    .select('id, user_id, email')
    .eq('activ', true)
    .lt('expira_la', new Date().toISOString());
  if (selErr) {
    console.error('[cron/expira-acces-temporar]', selErr);
    return res.status(500).json({ error: 'Eroare la căutarea acceselor expirate' });
  }
  if (!expirate?.length) return res.status(200).json({ ok: true, procesate: 0 });

  let procesate = 0;
  const erori = [];

  for (const acces of expirate) {
    try {
      if (acces.user_id) {
        const parolaAleatoare = crypto.randomBytes(24).toString('base64url');
        await supabaseAdmin.auth.admin.updateUserById(acces.user_id, { password: parolaAleatoare });
      }
      await supabaseAdmin
        .from('accese_temporare')
        .update({ activ: false, motiv_revocare: 'Expirat automat' })
        .eq('id', acces.id);
      procesate++;
    } catch (err) {
      console.error('[cron/expira-acces-temporar]', acces.email, err);
      erori.push({ email: acces.email, error: err.message });
    }
  }

  return res.status(200).json({ ok: true, procesate, erori });
};
