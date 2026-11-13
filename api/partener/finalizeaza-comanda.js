// /api/partener/finalizeaza-comanda.js
// Faza 4 — prestatorul declară lucrarea finalizată. Cere cel puțin o
// fotografie "before" și una "after" deja încărcate (dovadă vizuală
// obligatorie, cf. cerinței de business) înainte să permită finalizarea.
// Valorile reale ale comenzi_imagini.tip (verificate live, 2026-07-22):
// 'before'/'after'/'in_progres'/'defect_constatat' — nu inainte/dupa.
// Generează un token de confirmare (valabil 7 zile) și trimite linkul pe
// email către client. Pagina publică de confirmare (Faza 5) nu există încă
// — linkul dă 404 până atunci, așteptat la acest pas, nu un bug.

const crypto = require('crypto');
const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const v = require('../../lib/valideaza');
const { renderEmailLucrareFinalizata, limbaProfilEmailComportamental } = require('../../lib/i18n');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  comanda_id: v.id({ eticheta: ['Comanda', 'Order'] }),
};

const TOKEN_VALABIL_ZILE = 7;

async function trimiteEmailFinalizare(email, comanda, token, limba = 'ro') {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[finalizeaza-comanda] RESEND_API_KEY lipsă — link netrimis, token:', token);
    return;
  }
  const link = `https://mydarrin.homebestpal.com/confirmare-livrare?token=${token}`;
  // Pasul 11-T1: emailul în limba clientului (ro / en), din lib/i18n.js.
  const emailFin = renderEmailLucrareFinalizata(limba, { numarComanda: comanda.nr_comanda, link });
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'noreply@homebestpal.com',
        to: email,
        subject: emailFin.subiect,
        html: emailFin.html,
      }),
    });
  } catch (err) {
    console.error('[finalizeaza-comanda] email eșuat:', err);
  }
}

// Etapa 5e (28 sept. 2026): garanția de execuție începe la finalizare, cu durata
// din catalog_niveluri.garantie_luni. Fără durată configurată (azi 0 pe toate
// nivelurile) nu se creează nicio garanție, ca să nu inventăm o perioadă.
// suma_blocata rămâne 0: nu există procesator de card care să blocheze fonduri.
async function creeazaGarantieDacaEConfigurata(comanda, imaginiAfterIds) {
  if (!comanda.nivel_id) return;
  const { data: nivel } = await supabaseAdmin
    .from('catalog_niveluri').select('garantie_luni').eq('id', comanda.nivel_id).maybeSingle();
  const luni = Number(nivel?.garantie_luni);
  if (!Number.isInteger(luni) || luni < 3 || luni > 120) return;
  const acum = new Date();
  const expira = new Date(acum);
  expira.setMonth(expira.getMonth() + luni);
  const { error } = await supabaseAdmin.from('garantii_lucrari').upsert({
    comanda_id: comanda.id,
    partener_id: comanda.partener_id,
    data_finalizare: acum.toISOString(),
    durata_luni: luni,
    data_expirare: expira.toISOString(),
    suma_blocata: 0,
    imagini_after_ids: imaginiAfterIds,
    status: 'activa',
  }, { onConflict: 'comanda_id', ignoreDuplicates: true });
  if (error) console.error('[finalizeaza-comanda] garanție:', error);
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora' })) return;
  const { comanda_id } = req.body || {};
  if (!comanda_id) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'comanda_id este obligatoriu', 'comanda_id is required.', ['comanda_id']);

  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('id, nr_comanda, client_id, partener_id, status, nivel_id')
    .eq('id', comanda_id)
    .single();
  if (comErr || !comanda) return trimiteEroare(res, 404, 'COMANDA_NU_EXISTA', 'Comanda nu există', 'The order does not exist.');
  if (comanda.partener_id !== user.id) return trimiteEroare(res, 403, 'COMANDA_NEALOCATA', 'Comanda nu îți este alocată', 'This order is not assigned to you.');
  if (comanda.status !== 'in_executie') {
    return trimiteEroare(res, 409, 'STARE_GRESITA', `Comanda trebuie să fie în execuție pentru a fi finalizată (status curent: ${comanda.status})`, `The order must be in progress to be completed (current status: ${comanda.status}).`);
  }

  const { data: imagini, error: imgErr } = await supabaseAdmin
    .from('comenzi_imagini')
    .select('id, tip')
    .eq('comanda_id', comanda_id);
  if (imgErr) return trimiteEroare(res, 500, 'EROARE_SERVER', 'Eroare la verificarea fotografiilor', 'Error while checking the photos. Please try again.');

  const areBefore = (imagini || []).some((i) => i.tip === 'before');
  const areAfter = (imagini || []).some((i) => i.tip === 'after');
  if (!areBefore || !areAfter) {
    return trimiteEroare(res, 400, 'FOTOGRAFII_LIPSA', 'Sunt necesare cel puțin o fotografie "înainte" și una "după" pentru a finaliza', 'At least one "before" photo and one "after" photo are needed to complete the order.');
  }

  const token = crypto.randomUUID();
  const expira = new Date(Date.now() + TOKEN_VALABIL_ZILE * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('comenzi')
    .update({
      status: 'finalizata',
      token_confirmare: token,
      token_expira_la: expira,
      finalizat_la: new Date().toISOString(),
    })
    .eq('id', comanda_id)
    .select()
    .single();
  if (error) {
    console.error('[finalizeaza-comanda]', error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut finaliza comanda', 'We could not complete the order. Please try again.');
  }

  try {
    await creeazaGarantieDacaEConfigurata(comanda, (imagini || []).filter((i) => i.tip === 'after').map((i) => i.id));
  } catch (garantieErr) {
    console.error('[finalizeaza-comanda] garanție eșuată:', garantieErr);
  }

  const { data: clientAuth } = await supabaseAdmin.auth.admin.getUserById(comanda.client_id);
  if (clientAuth?.user?.email) {
    const { data: profilClient } = await supabaseAdmin.from('profiles').select('limba, tara').eq('id', comanda.client_id).maybeSingle();
    await trimiteEmailFinalizare(clientAuth.user.email, comanda, token, limbaProfilEmailComportamental(profilClient));
  }

  return res.status(200).json({ ok: true, comanda: data });
}

module.exports = requireAuth([], handler);
