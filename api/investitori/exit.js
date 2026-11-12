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
// POST { tip: 'buyback', numar_actiuni }
//
// Pasul 11-I1 (8 nov. 2026):
// GET → { ok, cereri: [{ id, tip, numar_actiuni, suma_calculata, status, creat_la, anulat_la }] },
//   doar cererile utilizatorului autentificat, cele mai noi primele.
// PATCH { id, actiune: 'anuleaza' } → { ok, cerere }: doar propria cerere și doar cât
//   e in_procesare; altfel 409. Cererea altcuiva sau inexistentă → 404, fără date.
// POST folosește regula panoului: lock-up din aprobat_la, doar subscrieri aprobate,
//   minus acțiunile din cererile care nu sunt anulate sau respinse (pasul 11-I1b);
//   peste limită → 409 PESTE_LIMITA.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const R = require('../../lib/runda-finantare');
const P = require('../../lib/investitori-panou');
const { formaComuna, trimiteEroare, camp } = require('../../lib/raspuns-eroare');
const v = require('../../lib/valideaza');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA_CERERE = {
  tip: v.text({ max: 30, eticheta: ['Tipul ieșirii', 'Exit type'] }),
  numar_actiuni: v.numar({ min: 0, max: 1000000000, eticheta: ['Numărul de acțiuni', 'Number of shares'] }),
};

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA_ANULARE = {
  id: v.text({ max: 64, eticheta: ['Cererea', 'Request'] }),
  actiune: v.text({ max: 30, eticheta: ['Acțiune', 'Action'] }),
};

const ID_VALID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function publicCerere(c) {
  return {
    id: c.id, tip: c.tip, numar_actiuni: Number(c.numar_actiuni) || 0,
    suma_calculata: c.suma_calculata == null ? null : Number(c.suma_calculata),
    status: c.status, creat_la: c.created_at || null, anulat_la: c.anulat_la || null,
  };
}

async function listeaza(res, user) {
  const { data, error } = await supabaseAdmin
    .from('investitori_exit').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) {
    console.error('[investitori/exit] listă', error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca cererile de exit.', 'We could not load your exit requests.');
  }
  return res.status(200).json({ ok: true, cereri: (data || []).map(publicCerere) });
}

async function anuleaza(req, res, user) {
  if (!v.valideazaSauTrimite(req, res, SCHEMA_ANULARE, { necunoscute: 'ignora' })) return;
  const { id, actiune } = req.body || {};
  if (actiune !== 'anuleaza') return trimiteEroare(res, 400, 'DATE_INVALIDE', 'Acțiune necunoscută.', 'Unknown action.');
  const inexistenta = () => trimiteEroare(res, 404, 'NU_EXISTA', 'Cererea nu există.', 'The request does not exist.');
  const blocata = () => trimiteEroare(res, 409, 'ANULARE_IMPOSIBILA',
    'Cererea se poate anula doar cât e în procesare.', 'The request can be cancelled only while it is in progress.');
  if (typeof id !== 'string' || !ID_VALID.test(id)) return inexistenta();

  const { data: cerere, error } = await supabaseAdmin
    .from('investitori_exit').select('id, status').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (error) {
    console.error('[investitori/exit] citire', error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut anula cererea.', 'We could not cancel the request.');
  }
  if (!cerere) return inexistenta();
  if (cerere.status !== 'in_procesare') return blocata();

  const acum = new Date().toISOString();
  const { data, error: errAnulare } = await supabaseAdmin
    .from('investitori_exit')
    .update({ status: 'anulat', anulat_la: acum, actualizat_la: acum })
    .eq('id', id).eq('user_id', user.id).eq('status', 'in_procesare')
    .select().maybeSingle();
  if (errAnulare) {
    console.error('[investitori/exit] anulare', errAnulare);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut anula cererea.', 'We could not cancel the request.');
  }
  if (!data) return blocata();
  return res.status(200).json({ ok: true, cerere: publicCerere(data) });
}

async function handler(req, res, user) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'GET') return listeaza(res, user);
  if (req.method === 'PATCH') return anuleaza(req, res, user);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!v.valideazaSauTrimite(req, res, SCHEMA_CERERE, { necunoscute: 'ignora' })) return;
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

  const configurat = (portofoliu || []).some((p) => p.runda_id && runde[p.runda_id] && R.num(runde[p.runda_id].discount_buyback_pct) != null);
  if (!configurat) {
    return res.status(409).json({ error: 'Buy-back-ul nu e configurat pentru runda ta.', error_en: 'Buy-back is not configured for your round.', cod: 'INDISPONIBIL' });
  }
  const { data: cereri, error: cereriErr } = await supabaseAdmin
    .from('investitori_exit').select('numar_actiuni, status').eq('user_id', user.id);
  if (cereriErr) {
    console.error('[investitori/exit] cereri active', cereriErr);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut verifica cererile de exit.', 'We could not check your exit requests.');
  }
  // Aceeași funcție ca în portofoliu și în panou.
  const disponibile = P.actiuniDisponibile(portofoliu, runde, cereri, new Date());
  if (numar_actiuni > disponibile) {
    const ro = `Poți cere buy-back pentru cel mult ${disponibile} acțiuni (acțiunile aprobate, după lock-up, minus cele din cererile tale de exit care nu sunt anulate sau respinse).`;
    const en = `You can request a buy-back for at most ${disponibile} shares (approved shares, after the lock-up, minus those in your exit requests that are not cancelled or rejected).`;
    return trimiteEroare(res, 409, 'PESTE_LIMITA', ro, en, [camp('numar_actiuni', ro, en)], { disponibile });
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

module.exports = formaComuna(requireAuth(['investor'], handler));
