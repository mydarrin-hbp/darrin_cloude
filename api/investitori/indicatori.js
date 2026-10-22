// /api/investitori/indicatori.js
// Indicatorii platformei pentru investitori (pasul 11-J, 21 oct. 2026).
//
// RPC-ul get_live_investor_kpis nu mai e executabil din browser (migrarea
// 2026-10-21_runde_finantare.sql îl revocă de la anon / authenticated); îl
// apelează doar serverul, cu service role, și doar pentru un investitor cu
// verificarea identității APROBATĂ (investitori_kyc.status = 'aprobat').
// Altfel: 403 cu mesaj RO + EN, fără nicio cifră.
//
// Se trimit doar câmpurile calculate din comenzi reale. Nu se trimit:
//   - tari_active (scris de mână în funcție);
//   - take_rate_pct când nu există comenzi (funcția pune atunci 10.0);
//   - nimic, dacă funcția a căzut pe ramura de eroare (care întoarce zerouri
//     și aceleași valori scrise de mână) → 503.
// Moneda se trimite doar dacă toate comenzile finalizate sunt în aceeași monedă.
//
// GET (rol investor) → { ok, indicatori: { comenzi_total, comenzi_luna,
//   parteneri_activi, gmv_total, revenue_total, revenue_luna, take_rate_pct? },
//   moneda: string | null, actualizat_la }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const CAMPURI = ['comenzi_total', 'comenzi_luna', 'parteneri_activi', 'gmv_total', 'revenue_total', 'revenue_luna'];

async function handler(req, res, user) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data: kyc, error: kycErr } = await supabaseAdmin
    .from('investitori_kyc').select('status').eq('user_id', user.id).maybeSingle();
  if (kycErr) return res.status(500).json({ error: 'Nu am putut verifica starea verificării identității.', error_en: 'We could not check your identity verification status.' });
  if (!kyc || kyc.status !== 'aprobat') {
    return res.status(403).json({
      cod: 'KYC_NEAPROBAT',
      error: 'Indicatorii financiari sunt disponibili după aprobarea verificării identității tale.',
      error_en: 'The financial indicators are available after your identity verification is approved.',
    });
  }

  const { data, error } = await supabaseAdmin.rpc('get_live_investor_kpis', {});
  const k = data && data.kpis;
  if (error || !k || data.error) {
    if (error) console.error('[investitori/indicatori]', error);
    return res.status(503).json({ error: 'Indicatorii nu sunt disponibili acum.', error_en: 'The indicators are not available right now.' });
  }

  const indicatori = {};
  for (const c of CAMPURI) indicatori[c] = Number(k[c]) || 0;
  if (indicatori.gmv_total > 0 && k.take_rate_pct != null) indicatori.take_rate_pct = Number(k.take_rate_pct);

  const monede = [...new Set((Array.isArray(data.per_tara) ? data.per_tara : [])
    .filter((t) => Number(t.comenzi) > 0).map((t) => t.moneda).filter(Boolean))];

  return res.status(200).json({
    ok: true,
    indicatori,
    moneda: monede.length === 1 ? monede[0] : null,
    actualizat_la: data.timestamp || null,
  });
}

module.exports = requireAuth(['investor'], handler);
