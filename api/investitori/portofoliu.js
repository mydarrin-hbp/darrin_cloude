// /api/investitori/portofoliu.js
// Portofoliul investitorului autentificat (pasul 11-J, 21 oct. 2026), calculat
// pe server din subscrierile lui și din rundele lor (lib/runda-finantare.js).
// Înlocuiește RPC-ul get_investor_portofoliu, care calcula procentul cu
// 10.000.000 de acțiuni scrise în funcție și citea o singură subscriere.
//
// GET (rol investor) → { ok, kyc_status, actiuni, valoare_investita,
//   in_asteptare, pct_companie, subscrieri: [...], runda: null | {...},
//   exit: { buyback_disponibil, discount_buyback_pct, lock_up_luni } }
//   - actiuni / valoare / procent: doar din subscrierile APROBATE;
//   - runda: runda deschisă, cu ce îi trebuie ferestrei de subscriere
//     (tickete, investiția minimă, prețul, instrumentele), chiar dacă nu e
//     vizibilă public;
//   - exit: buy-back doar dacă runda unei subscrieri aprobate are discountul
//     de buy-back configurat; lock-up-ul din aceeași rundă.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const R = require('../../lib/runda-finantare');

function publicRunda(r) {
  if (!r) return null;
  const c = R.calculeaza(r);
  if (!c) return null;
  return {
    id: r.id, denumire_ro: r.denumire_ro, denumire_en: r.denumire_en, moneda: r.moneda,
    stare: r.stare, data_start: r.data_start || null, data_sfarsit: r.data_sfarsit || null,
    suma_tinta: Number(r.suma_tinta), investitie_minima: R.num(r.investitie_minima),
    pret_actiune: c.pret_actiune, equity_oferit_pct: c.equity_oferit_pct,
    tickete: Array.isArray(r.tickete) && r.tickete.length ? r.tickete.map(Number) : null,
    instrumente: Array.isArray(r.instrumente) ? r.instrumente : [],
  };
}

async function handler(req, res, user) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const [subs, kyc, deschisa] = await Promise.all([
      supabaseAdmin.from('investitori_portofoliu').select('*').eq('user_id', user.id),
      supabaseAdmin.from('investitori_kyc').select('status').eq('user_id', user.id).maybeSingle(),
      R.rundaDeschisa(),
    ]);
    if (subs.error) throw subs.error;
    const randuri = subs.data || [];

    const idRunde = [...new Set(randuri.map((s) => s.runda_id).filter(Boolean))];
    const runde = {};
    if (idRunde.length) {
      const { data, error } = await supabaseAdmin.from('runde_finantare').select('*').in('id', idRunde);
      if (error && !R.tabelaLipsa(error)) throw error;
      (data || []).forEach((r) => { runde[r.id] = r; });
    }

    let actiuni = 0, valoare = 0, inAsteptare = 0, pct = 0;
    let buyback = null, lockUp = null;
    for (const s of randuri) {
      if (s.status === 'aprobat') {
        actiuni += Number(s.actiuni) || 0;
        valoare += Number(s.valoare_investita) || 0;
        const r = s.runda_id && runde[s.runda_id];
        if (r) {
          const emise = await R.totaluriRunda(r.id, ['aprobat']);
          pct += R.procentInvestitor(r, Number(s.actiuni) || 0, emise.actiuni);
          if (R.num(r.discount_buyback_pct) != null) buyback = R.num(r.discount_buyback_pct);
          if (R.num(r.lock_up_luni) != null) lockUp = R.num(r.lock_up_luni);
        }
      } else if (s.status === 'in_asteptare') {
        inAsteptare += Number(s.valoare_investita) || 0;
      }
    }

    return res.status(200).json({
      ok: true,
      kyc_status: (kyc.data && kyc.data.status) || null,
      actiuni, valoare_investita: valoare, in_asteptare: inAsteptare,
      pct_companie: Math.round(pct * 10000) / 10000,
      subscrieri: randuri
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .map((s) => ({
          id: s.id, status: s.status, actiuni: Number(s.actiuni) || 0, valoare_investita: Number(s.valoare_investita) || 0,
          instrument: s.instrument || null, creat_la: s.created_at || null,
          runda: s.runda_id && runde[s.runda_id] ? { denumire_ro: runde[s.runda_id].denumire_ro, denumire_en: runde[s.runda_id].denumire_en, moneda: runde[s.runda_id].moneda } : null,
        })),
      runda: publicRunda(deschisa),
      exit: { buyback_disponibil: buyback != null && actiuni > 0, discount_buyback_pct: buyback, lock_up_luni: lockUp },
    });
  } catch (err) {
    console.error('[investitori/portofoliu]', err);
    return res.status(500).json({ error: 'Nu am putut încărca portofoliul.', error_en: 'We could not load your portfolio.' });
  }
}

module.exports = requireAuth(['investor'], handler);
