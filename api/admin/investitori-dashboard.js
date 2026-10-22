// /api/admin/investitori-dashboard.js
// Datele panoului „Investitori Admin” (pasul 11-J, 21 oct. 2026), calculate
// pe server din rundele configurate (lib/runda-finantare.js). Înlocuiește
// RPC-ul admin_get_investitori_dashboard, care avea scrise în funcție 4000 de
// acțiuni, 1000 EUR pe acțiune, 4.000.000 și 500.000, un factor de profit de
// 0,70 și dubla investitorii cu mai multe subscrieri.
//
// Acces: superadmin sau admin cu drept pe secțiunea Investitori (citire ajunge).
// GET → { ok, kpis, runda, investitori: [...], poate_scrie }
//   poate_scrie (pasul 11-N2): panoul ascunde butoanele de scriere când e false;
//   serverul decide oricum, în fiecare endpoint de scriere.
//   kpis: investitori (rol investor), KYC în verificare, capital aprobat și
//   acțiuni aprobate (în runda deschisă), acțiuni disponibile, procentul din
//   țintă; runda: runda deschisă, cu valorile calculate (sau null);
//   investitori: câte un rând pe cont, cu subscrierile însumate (aprobate și în
//   așteptare), procentul din companie (doar din acțiunile aprobate, pe runda
//   lor) și starea KYC. Fără dividende sau profit: nu există o sursă configurată.

const { requireAuth } = require('../../lib/auth-middleware');
const { formaComuna } = require('../../lib/raspuns-eroare');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { nivelInvestitori, refuzaFaraDrept } = require('../../lib/permisiuni-investitori');
const R = require('../../lib/runda-finantare');

async function handler(req, res, user) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const nivel = await nivelInvestitori(user);
    if (!nivel) return refuzaFaraDrept(res);

    const [runda, profile, subs, kycuri, runde] = await Promise.all([
      R.rundaDeschisa(),
      supabaseAdmin.from('profiles').select('id, email, roles').contains('roles', ['investor']),
      supabaseAdmin.from('investitori_portofoliu').select('*'),
      supabaseAdmin.from('investitori_kyc').select('user_id, status'),
      supabaseAdmin.from('runde_finantare').select('*'),
    ]);
    if (profile.error) throw profile.error;
    if (subs.error) throw subs.error;
    const toateRundele = runde.error ? [] : (runde.data || []);
    const rundaDupaId = {};
    toateRundele.forEach((r) => { rundaDupaId[r.id] = r; });
    const kyc = {};
    (kycuri.data || []).forEach((k) => { kyc[k.user_id] = k.status; });

    // Acțiunile noi emise (aprobate) pe fiecare rundă — numitorul procentului.
    const emisePeRunda = {};
    (subs.data || []).forEach((s) => {
      if (s.status === 'aprobat' && s.runda_id) emisePeRunda[s.runda_id] = (emisePeRunda[s.runda_id] || 0) + (Number(s.actiuni) || 0);
    });

    const peCont = {};
    (profile.data || []).forEach((p) => { peCont[p.id] = { user_id: p.id, email: p.email, actiuni: 0, valoare_investita: 0, in_asteptare: 0, pct_companie: 0, subscrieri: 0 }; });
    (subs.data || []).forEach((s) => {
      if (!s.user_id) return;
      const c = peCont[s.user_id] || (peCont[s.user_id] = { user_id: s.user_id, email: s.email, actiuni: 0, valoare_investita: 0, in_asteptare: 0, pct_companie: 0, subscrieri: 0 });
      c.subscrieri++;
      if (s.status === 'aprobat') {
        c.actiuni += Number(s.actiuni) || 0;
        c.valoare_investita += Number(s.valoare_investita) || 0;
        const r = s.runda_id && rundaDupaId[s.runda_id];
        if (r) c.pct_companie = Math.round((c.pct_companie + R.procentInvestitor(r, Number(s.actiuni) || 0, emisePeRunda[s.runda_id])) * 10000) / 10000;
      } else if (s.status === 'in_asteptare') {
        c.in_asteptare += Number(s.valoare_investita) || 0;
      }
    });
    const investitori = Object.values(peCont).map((c) => ({ ...c, kyc_status: kyc[c.user_id] || null }))
      .sort((a, b) => b.valoare_investita - a.valoare_investita);

    let kpiRunda = null;
    if (runda) {
      const aprobate = await R.totaluriRunda(runda.id, ['aprobat']);
      const c = R.calculeaza(runda);
      kpiRunda = {
        id: runda.id, denumire_ro: runda.denumire_ro, denumire_en: runda.denumire_en, stare: runda.stare, moneda: runda.moneda,
        suma_tinta: Number(runda.suma_tinta), stranse: aprobate.suma, actiuni_aprobate: aprobate.actiuni,
        actiuni_noi: c ? c.actiuni_noi : null, actiuni_disponibile: c ? Math.max(0, c.actiuni_noi - aprobate.actiuni) : null,
        pret_actiune: c ? c.pret_actiune : null, post_money: c ? c.post_money : null, equity_oferit_pct: c ? c.equity_oferit_pct : null,
        pct_strans: runda.suma_tinta > 0 ? Math.min(100, Math.round((aprobate.suma / Number(runda.suma_tinta)) * 10000) / 100) : 0,
      };
    }

    return res.status(200).json({
      ok: true,
      kpis: {
        total_investitori: (profile.data || []).length,
        kyc_in_verificare: (kycuri.data || []).filter((k) => k.status === 'in_verificare').length,
        capital_aprobat: kpiRunda ? kpiRunda.stranse : 0,
        actiuni_aprobate: kpiRunda ? kpiRunda.actiuni_aprobate : 0,
      },
      runda: kpiRunda,
      investitori,
      poate_scrie: nivel === 'scriere',
    });
  } catch (err) {
    console.error('[admin/investitori-dashboard]', err);
    return res.status(500).json({ error: err.message || 'Eroare internă.' });
  }
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
