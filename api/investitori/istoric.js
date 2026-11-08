// /api/investitori/istoric.js
// Istoricul investitorului (pasul 11-I1, 8 nov. 2026), construit din datele
// existente, fără tabel nou: dosarul, subscrierile și cererile de exit, doar
// ale utilizatorului autentificat, cele mai noi primele.
//
// GET (rol investor) → { ok, evenimente: [{ tip, data, titlu: {ro,en},
//   motiv: {ro,en} | null, runda: {denumire_ro,denumire_en} | null,
//   valoare_investita, moneda, numar_actiuni }] }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { formaComuna, trimiteEroare } = require('../../lib/raspuns-eroare');
const R = require('../../lib/runda-finantare');

const TITLURI = {
  dosar_trimis: ['Dosar trimis pentru verificare', 'Application submitted for review'],
  dosar_aprobat: ['Verificarea identității a fost aprobată', 'Identity check approved'],
  dosar_respins: ['Verificarea identității a fost respinsă', 'Identity check rejected'],
  subscriere_trimisa: ['Subscriere trimisă', 'Subscription sent'],
  subscriere_aprobata: ['Subscriere aprobată', 'Subscription approved'],
  subscriere_respinsa: ['Subscriere respinsă', 'Subscription rejected'],
  exit_trimis: ['Cerere de exit trimisă', 'Exit request sent'],
  exit_anulat: ['Cerere de exit anulată', 'Exit request cancelled'],
};

function eveniment(tip, data, extra) {
  return Object.assign({
    tip, data, titlu: { ro: TITLURI[tip][0], en: TITLURI[tip][1] },
    motiv: null, runda: null, valoare_investita: null, moneda: null, numar_actiuni: null,
  }, extra || {});
}

async function handler(req, res, user) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  try {
    const [kyc, subs, cereri] = await Promise.all([
      supabaseAdmin.from('investitori_kyc').select('status, submitted_at, reviewed_at, motiv_respingere_ro, motiv_respingere_en').eq('user_id', user.id).maybeSingle(),
      supabaseAdmin.from('investitori_portofoliu').select('id, status, runda_id, actiuni, valoare_investita, created_at, aprobat_la').eq('user_id', user.id),
      supabaseAdmin.from('investitori_exit').select('id, numar_actiuni, created_at, anulat_la').eq('user_id', user.id),
    ]);
    if (kyc.error) throw kyc.error;
    if (subs.error) throw subs.error;
    if (cereri.error) throw cereri.error;

    const evenimente = [];
    const k = kyc.data;
    if (k && k.submitted_at) evenimente.push(eveniment('dosar_trimis', k.submitted_at));
    if (k && k.reviewed_at && (k.status === 'aprobat' || k.status === 'respins')) {
      evenimente.push(eveniment(k.status === 'aprobat' ? 'dosar_aprobat' : 'dosar_respins', k.reviewed_at, {
        motiv: k.status === 'respins' && (k.motiv_respingere_ro || k.motiv_respingere_en)
          ? { ro: k.motiv_respingere_ro || k.motiv_respingere_en, en: k.motiv_respingere_en || k.motiv_respingere_ro } : null,
      }));
    }

    const randuri = subs.data || [];
    const idRunde = [...new Set(randuri.map((s) => s.runda_id).filter(Boolean))];
    const runde = {};
    if (idRunde.length) {
      const { data, error } = await supabaseAdmin.from('runde_finantare').select('id, denumire_ro, denumire_en, moneda').in('id', idRunde);
      if (error && !R.tabelaLipsa(error)) throw error;
      (data || []).forEach((r) => { runde[r.id] = r; });
    }
    for (const s of randuri) {
      const r = s.runda_id && runde[s.runda_id];
      const extra = {
        runda: r ? { denumire_ro: r.denumire_ro, denumire_en: r.denumire_en } : null,
        moneda: r ? r.moneda : null,
        valoare_investita: Number(s.valoare_investita) || 0,
      };
      if (s.created_at) evenimente.push(eveniment('subscriere_trimisa', s.created_at, extra));
      if (s.aprobat_la && s.status === 'aprobat') evenimente.push(eveniment('subscriere_aprobata', s.aprobat_la, extra));
      if (s.aprobat_la && s.status === 'respins') evenimente.push(eveniment('subscriere_respinsa', s.aprobat_la, extra));
    }

    for (const c of cereri.data || []) {
      const extra = { numar_actiuni: Number(c.numar_actiuni) || 0 };
      if (c.created_at) evenimente.push(eveniment('exit_trimis', c.created_at, extra));
      if (c.anulat_la) evenimente.push(eveniment('exit_anulat', c.anulat_la, extra));
    }

    evenimente.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
    return res.status(200).json({ ok: true, evenimente });
  } catch (err) {
    console.error('[investitori/istoric]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca istoricul.', 'We could not load your history.');
  }
}

module.exports = formaComuna(requireAuth(['investor'], handler));
