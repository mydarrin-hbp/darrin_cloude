// /api/investitori/exit.js
// Cererea de exit a investitorului (buy-back), înregistrată pentru procesare.
//
// Pasul 11-J (21 oct. 2026): fără valori scrise în cod. Buy-back-ul există
// doar dacă runda subscrierilor aprobate are discount_buyback_pct configurat
// în back-office (runde_finantare); lock-up-ul vine din lock_up_luni al
// aceleiași runde: acțiunile din subscrieri mai noi decât lock-up-ul nu se
// pot vinde încă. Piața secundară nu se configurează nicăieri azi, deci nu e
// disponibilă. Se numără doar subscrierile aprobate (corecția 11-L).
// Suma buy-back-ului nu se calculează aici: o stabilește echipa, la procesare.
// Fără migrarea rundelor (fără coloana runda_id / tabela runde_finantare):
// buy-back-ul nu e configurat → 409, nu eroare.
//
// Body: { tip: 'buyback', numar_actiuni }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const R = require('../../lib/runda-finantare');

function luniDela(data, luni) {
  const d = new Date(data);
  d.setMonth(d.getMonth() + luni);
  return d;
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tip, numar_actiuni } = req.body || {};
  if (tip === 'piata_secundara') {
    return res.status(409).json({ error: 'Piața secundară nu e disponibilă.', error_en: 'The secondary market is not available.', cod: 'INDISPONIBIL' });
  }
  if (tip !== 'buyback' || !(numar_actiuni > 0)) {
    return res.status(400).json({ error: 'tip (buyback) și numar_actiuni (>0) sunt obligatorii' });
  }

  const { data: portofoliu, error: portErr } = await supabaseAdmin
    .from('investitori_portofoliu')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'aprobat');
  if (portErr) return res.status(500).json({ error: 'Eroare la citirea portofoliului' });

  const idRunde = [...new Set((portofoliu || []).map((p) => p.runda_id).filter(Boolean))];
  const runde = {};
  if (idRunde.length) {
    const { data, error } = await supabaseAdmin.from('runde_finantare').select('id, discount_buyback_pct, lock_up_luni').in('id', idRunde);
    if (error && !R.tabelaLipsa(error)) return res.status(500).json({ error: 'Eroare la citirea rundelor' });
    (data || []).forEach((r) => { runde[r.id] = r; });
  }

  // Acțiunile vandabile: subscrieri aprobate, în runde cu buy-back configurat, după lock-up.
  const acum = new Date();
  let disponibile = 0;
  let configurat = false;
  for (const p of portofoliu || []) {
    const r = p.runda_id && runde[p.runda_id];
    if (!r || R.num(r.discount_buyback_pct) == null) continue;
    configurat = true;
    const lock = R.num(r.lock_up_luni);
    if (lock != null && p.created_at && luniDela(p.created_at, lock) > acum) continue;
    disponibile += Number(p.actiuni) || 0;
  }
  if (!configurat) {
    return res.status(409).json({ error: 'Buy-back-ul nu e configurat pentru runda ta.', error_en: 'Buy-back is not configured for your round.', cod: 'INDISPONIBIL' });
  }
  if (numar_actiuni > disponibile) {
    return res.status(400).json({
      error: `Poți cere buy-back pentru cel mult ${disponibile} acțiuni (acțiunile aprobate, după lock-up).`,
      error_en: `You can request a buy-back for at most ${disponibile} shares (approved shares, after the lock-up).`,
    });
  }

  const { data, error } = await supabaseAdmin
    .from('investitori_exit')
    .insert({ user_id: user.id, tip, numar_actiuni, status: 'in_procesare' })
    .select()
    .single();
  if (error) {
    console.error('[investitori/exit]', error);
    return res.status(500).json({ error: 'Nu am putut înregistra cererea de exit' });
  }
  return res.status(200).json({ ok: true, cerere: data });
}

module.exports = requireAuth(['investor'], handler);
