// /api/cont/bun-venit.js
// Pasul 11-R3c (decizia LM, 3 nov. 2026): emailul de bun venit pleacă doar
// după ce utilizatorul a introdus codul de 6 cifre. Înainte, account-system.js
// chema /api/public/trimite-bun-venit-client imediat după signUp, iar emailul
// (cu link spre dashboard) ajungea înaintea codului.
//
// POST, cu sesiune (Authorization: Bearer). Emailul se ia din sesiune, nu din
// cerere, și se trimite doar dacă auth.users.email_confirmed_at e completat.
// Un singur email per cont (email_comportamental_log, unique(user_id, tip)),
// client sau partener; partenerul (profiles.rol_solicitat sau un rol de
// partener în profiles.roles) primește linkul spre dashboard-ul lui.
//   → { ok, trimis, motiv? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare } = require('../../lib/raspuns-eroare');
const { renderEmailContConfirmat, limbaProfilEmailComportamental } = require('../../lib/i18n');
const { incarcaContactPlatformaSigur } = require('../../lib/contact-platforma');
const { fromHeader } = require('../../lib/email-sender');
const { esteSuprimat } = require('../../lib/email-suppression');
const { esteRolPartener } = require('../../lib/activare-partener');
const { dashboardPentruRol } = require('../../lib/destinatie-rol');
const { inregistreazaEmailConfirmat } = require('../../lib/palnie');

const SITE_URL = process.env.SITE_URL || 'https://mydarrin.homebestpal.com';
const TIP_EMAIL = 'bun_venit_cont_confirmat';
// Emailul vechi de bun venit (trimis înainte de 11-R3c): cine l-a primit nu-l mai primește o dată.
const TIPURI_VECHI = ['bun_venit_client'];

async function handler(req, res, user) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA', 'Metodă nepermisă.', 'Method not allowed.');
  if (!user.email_confirmed_at) return res.status(200).json({ ok: true, trimis: false, motiv: 'neconfirmat' });
  // Pasul 11-A1: emailul confirmat, în pâlnia pentru raportul intern.
  await inregistreazaEmailConfirmat(user);

  try {
    const { data: profil, error: prErr } = await supabaseAdmin
      .from('profiles').select('email, tara, limba, roles, rol_solicitat').eq('id', user.id).maybeSingle();
    if (prErr) throw prErr;

    const { data: vechi, error: vErr } = await supabaseAdmin
      .from('email_comportamental_log').select('id').eq('user_id', user.id).in('tip', TIPURI_VECHI);
    if (vErr) throw vErr;
    if (vechi && vechi.length) return res.status(200).json({ ok: true, trimis: false, motiv: 'deja_trimis' });

    const { error: logErr } = await supabaseAdmin
      .from('email_comportamental_log').insert({ user_id: user.id, tip: TIP_EMAIL });
    if (logErr) {
      if (logErr.code === '23505') return res.status(200).json({ ok: true, trimis: false, motiv: 'deja_trimis' });
      throw logErr;
    }

    const email = user.email;
    if (!process.env.RESEND_API_KEY) {
      console.warn('[cont/bun-venit] RESEND_API_KEY lipsă — email netrimis către', email);
      return res.status(200).json({ ok: true, trimis: false });
    }
    if (await esteSuprimat(email)) return res.status(200).json({ ok: true, trimis: false, motiv: 'dezabonat' });

    const roluri = Array.isArray(profil?.roles) ? profil.roles : [];
    const rolPartener = roluri.find(esteRolPartener) || (esteRolPartener(profil?.rol_solicitat) ? profil.rol_solicitat : null);
    const limba = limbaProfilEmailComportamental(profil || {});
    await incarcaContactPlatformaSigur(); // footerul de dezabonare din back-office
    const { subiect, html } = renderEmailContConfirmat(limba, {
      nume: (user.user_metadata && user.user_metadata.prenume) || null,
      partener: !!rolPartener,
      link: rolPartener ? SITE_URL + dashboardPentruRol(rolPartener) : null,
    });
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: await fromHeader(limba), to: email, subject: subiect, html }),
    });
    if (!r.ok) console.error('[cont/bun-venit] Resend', r.status);
    return res.status(200).json({ ok: true, trimis: r.ok });
  } catch (err) {
    console.error('[cont/bun-venit]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER',
      'Nu am putut trimite emailul de bun venit. Contul tău e confirmat și funcționează normal.',
      'We could not send the welcome email. Your account is confirmed and works normally.');
  }
}

module.exports = requireAuth([], handler);
