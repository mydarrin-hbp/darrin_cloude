// /api/investitori/subscrie.js
// Subscrierea (achiziția de acțiuni / cote), legată de cont (pasul 11-L) și
// de runda deschisă (pasul 11-J, 21 oct. 2026; deciziile LM C1, C2).
//
// Doar pentru conturi cu rolul `investor` (profiles.roles). Suma o alege
// investitorul; restul se calculează aici, din runda deschisă
// (lib/runda-finantare.js): numărul de acțiuni = floor(sumă / prețul pe
// acțiune), validarea față de investiția minimă și de ce a rămas din țintă
// (subscrierile aprobate și cele în așteptare), instrumentul din cele
// configurate în rundă. Subscrierea se salvează cu runda_id. Fără rundă
// deschisă → RUNDA_INCHISA. O aprobă adminul (api/admin/investitori-aprobare.js)
// doar dacă verificarea identității e aprobată.
//
// POST { suma, instrument? } → { ok, portofoliu, actiuni, procent_estimat, kyc_status }
// (`suma_eur` e acceptat pentru compatibilitate; acțiunile trimise de client se ignoră.)

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');
const { citesteKyc } = require('../../lib/investitori-kyc');
const R = require('../../lib/runda-finantare');

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const permis = await checkRateLimit(req, { key: 'investitori-subscrie', limit: 10, windowSeconds: 600 });
  if (!permis) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.', error_en: 'Too many requests. Please try again later.' });

  const corp = req.body || {};
  const suma = R.num(corp.suma != null ? corp.suma : corp.suma_eur);
  const instrument = corp.instrument == null || corp.instrument === '' ? null : String(corp.instrument);

  try {
    const runda = await R.rundaDeschisaSauEroare();
    const instrumente = Array.isArray(runda.instrumente) ? runda.instrumente : [];
    const instrumentFinal = instrument || (instrumente.length === 1 ? instrumente[0] : null);
    if (!instrumentFinal || !instrumente.includes(instrumentFinal)) throw new R.EroareRunda('INSTRUMENT_INVALID');

    const ocupate = await R.totaluriRunda(runda.id, ['aprobat', 'in_asteptare']);
    const { actiuni } = R.valideazaSuma(runda, suma, ocupate.suma);
    const emise = await R.totaluriRunda(runda.id, ['aprobat']);

    const kyc = await citesteKyc(user.id);
    const { data, error } = await supabaseAdmin.from('investitori_portofoliu').insert({
      user_id: user.id,
      email: user.email ? String(user.email).trim().toLowerCase() : null,
      runda_id: runda.id,
      valoare_investita: suma,
      actiuni,
      instrument: instrumentFinal,
      consimtamant_public: false,
      status: 'in_asteptare',
    }).select().single();
    if (error) throw error;
    return res.status(200).json({
      ok: true, portofoliu: data, actiuni, moneda: runda.moneda,
      // estimat: procentul după aprobare, dacă și celelalte subscrieri aprobate rămân aceleași
      procent_estimat: R.procentInvestitor(runda, actiuni, emise.actiuni + actiuni),
      kyc_status: (kyc && kyc.status) || null,
    });
  } catch (err) {
    if (err instanceof R.EroareRunda) return R.raspunsEroare(res, err);
    console.error('[investitori/subscrie]', err);
    return res.status(500).json({ error: 'Nu am putut înregistra subscrierea.', error_en: 'We could not record the subscription.' });
  }
}

module.exports = requireAuth(['investor'], handler);
