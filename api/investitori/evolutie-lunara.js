// /api/investitori/evolutie-lunara.js
// Evoluția lunară a platformei, pentru varianta „Live” a pitch deck-ului
// (pasul 11-K, 22 oct. 2026). Doar pentru un investitor cu verificarea
// identității APROBATĂ (investitori_kyc.status = 'aprobat'), ca
// /api/investitori/indicatori; altfel 403 KYC_NEAPROBAT, fără nicio cifră.
//
// Se calculează doar din comenzi finalizate reale (status finalizata /
// confirmata_client — aceleași stări ca get_live_investor_kpis), pe ultimele
// 12 luni calendaristice, după luna creării comenzii (creat_la, ca indicatorii).
//   - comenzi: numărul comenzilor;
//   - gmv: suma plătită (suma_totala_platita), doar dacă toate comenzile din
//     perioadă sunt în aceeași monedă (altfel null: nu adunăm monede diferite);
//   - venit: comisionul platformei — suma_comision_platforma pentru comenzile
//     itemizate; pentru cele vechi, (total − asigurare) × comision_pct, doar
//     dacă comision_pct e completat. Spre deosebire de funcția SQL, nu se
//     presupune niciun procent implicit (10%): comenzile fără comision cunoscut
//     nu intră în venit, iar `venit_complet` devine false.
// Fără comenzi finalizate → total_comenzi = 0 (pagina arată „Încă nu sunt
// date suficiente”), nu valori de rezervă.
//
// GET (rol investor, KYC aprobat) → { ok, luni: [{ luna: 'YYYY-MM', comenzi, gmv, venit }],
//   total_comenzi, moneda, venit_complet, actualizat_la }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { citesteTot } = require('../../lib/citeste-tot');

const STARI_FINALIZATE = ['finalizata', 'confirmata_client'];
const LUNI = 12;
const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));

// Comisionul platformei pentru o comandă; null dacă nu se cunoaște.
function venitComanda(c) {
  const componente = n(c.suma_manopera) + n(c.suma_materiale) + n(c.suma_chirie_scule) + n(c.suma_transport);
  if (componente > 0) return c.suma_comision_platforma == null ? null : n(c.suma_comision_platforma);
  if (c.comision_pct == null || c.comision_pct === '') return null;
  return ((n(c.suma_totala_platita) - n(c.suma_asigurare)) * Number(c.comision_pct)) / 100;
}

// Cele 12 luni (YYYY-MM), de la cea mai veche la luna curentă (UTC).
function ultimeleLuni(acum = new Date()) {
  const luni = [];
  for (let i = LUNI - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(acum.getUTCFullYear(), acum.getUTCMonth() - i, 1));
    luni.push(d.toISOString().slice(0, 7));
  }
  return luni;
}

async function handler(req, res, user) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data: kyc, error: kycErr } = await supabaseAdmin
    .from('investitori_kyc').select('status').eq('user_id', user.id).maybeSingle();
  if (kycErr) return res.status(500).json({ error: 'Nu am putut verifica starea verificării identității.', error_en: 'We could not check your identity verification status.' });
  if (!kyc || kyc.status !== 'aprobat') {
    return res.status(403).json({
      cod: 'KYC_NEAPROBAT',
      error: 'Evoluția lunară e disponibilă după aprobarea verificării identității tale.',
      error_en: 'The monthly trend is available after your identity verification is approved.',
    });
  }

  const luni = ultimeleLuni();
  const { data, error } = await citesteTot(() => supabaseAdmin.from('comenzi')
    .select('id, creat_la, moneda, suma_totala_platita, suma_asigurare, suma_comision_platforma, comision_pct, suma_manopera, suma_materiale, suma_chirie_scule, suma_transport')
    .in('status', STARI_FINALIZATE).gte('creat_la', luni[0] + '-01T00:00:00Z').order('creat_la').order('id'));
  if (error) {
    console.error('[investitori/evolutie-lunara]', error);
    return res.status(503).json({ error: 'Evoluția lunară nu e disponibilă acum.', error_en: 'The monthly trend is not available right now.' });
  }

  const comenzi = data || [];
  const monede = [...new Set(comenzi.map((c) => c.moneda).filter(Boolean))];
  const oMoneda = monede.length <= 1 && comenzi.every((c) => c.moneda);
  const pe = Object.fromEntries(luni.map((l) => [l, { luna: l, comenzi: 0, gmv: 0, venit: 0 }]));
  let venitComplet = true;
  for (const c of comenzi) {
    const l = String(c.creat_la || '').slice(0, 7);
    if (!pe[l]) continue;
    pe[l].comenzi += 1;
    pe[l].gmv += n(c.suma_totala_platita);
    const v = venitComanda(c);
    if (v == null) venitComplet = false; else pe[l].venit += v;
  }
  const rot = (x) => Math.round(x * 100) / 100;
  return res.status(200).json({
    ok: true,
    luni: luni.map((l) => ({ luna: l, comenzi: pe[l].comenzi, gmv: oMoneda ? rot(pe[l].gmv) : null, venit: oMoneda ? rot(pe[l].venit) : null })),
    total_comenzi: comenzi.length,
    moneda: oMoneda && monede.length ? monede[0] : null,
    venit_complet: venitComplet,
    actualizat_la: new Date().toISOString(),
  });
}

module.exports = requireAuth(['investor'], handler);
module.exports.venitComanda = venitComanda;
module.exports.ultimeleLuni = ultimeleLuni;
