// /api/partener/accept-comanda.js
// Alocare FIFO: mai mulți parteneri din proximitate primesc aceeași comandă
// notificată; primul care apelează acest endpoint cu succes o câștigă.
//
// Siguranță la concurență: UPDATE-ul condiționat pe `raspuns = 'in_asteptare'`
// este atomic în Postgres (row-level lock la primul commit) — două cereri
// simultane nu pot ambele reuși.
//
// Body: { comanda_id }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { eligibilitatePartener, poatePrimiComenzi, motivNuPoateVinde, MOTIV } = require('../../lib/eligibilitate-partener');

const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];

// G9 (25 Iulie 2026) — hard-stop real: niciun partener nu poate prelua
// comenzi fără (1) aprobare Backoffice, (2) cont bancar activ, (3)
// contract semnat electronic prin OTP (vezi api/partener/contract-*-otp.js).
// Verificat AICI, server-side, nu doar sugerat în UI.
// Pasul 10c (16 oct. 2026): regula vine din lib/eligibilitate-partener.js
// (poatePrimiComenzi); furnizorul propriu al platformei, aprobat, nu are
// nevoie de contract și nici de cont bancar de partener.
const MESAJ_HARD_STOP = {
  [MOTIV.INEXISTENT]: { code: 'PARTENER_INEXISTENT', error: 'Cont de partener inexistent.' },
  [MOTIV.SUSPENDAT]: { code: 'CONT_SUSPENDAT', error: 'Contul tău este suspendat — nu poți prelua comenzi.' },
  [MOTIV.RESPINS]: { code: 'PROFIL_NEAPROBAT', error: 'Profilul tău nu a fost încă aprobat de echipa My Darrin — nu poți prelua comenzi.' },
  [MOTIV.IN_VERIFICARE]: { code: 'PROFIL_NEAPROBAT', error: 'Profilul tău nu a fost încă aprobat de echipa My Darrin — nu poți prelua comenzi.' },
  [MOTIV.FARA_CONT_BANCAR]: { code: 'FARA_CONT_BANCAR', error: 'Adaugă mai întâi un cont bancar activ — nu poți prelua comenzi fără date de încasare.' },
  [MOTIV.FARA_CONTRACT]: { code: 'CONTRACT_NESEMNAT', error: 'Trebuie să semnezi electronic contractul de parteneriat (cod OTP) înainte de a prelua comenzi.' },
};

async function verificaHardStop(user) {
  const partener = await eligibilitatePartener(user.id);
  if (poatePrimiComenzi(partener)) return { ok: true };
  return { ok: false, ...MESAJ_HARD_STOP[motivNuPoateVinde(partener)] };
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const gate = await verificaHardStop(user);
  if (!gate.ok) return res.status(403).json({ error: gate.error, code: gate.code });

  const { comanda_id } = req.body || {};
  if (!comanda_id) return res.status(400).json({ error: 'comanda_id este obligatoriu' });

  // 1. Încearcă să câștige alocarea FIFO — condiție atomică pe status
  const { data: allocated, error: allocErr } = await supabaseAdmin
    .from('alocari_fifo')
    .update({ raspuns: 'acceptat', raspuns_at: new Date().toISOString() })
    .eq('comanda_id', comanda_id)
    .eq('partener_id', user.id)
    .eq('raspuns', 'in_asteptare')
    .select();

  if (allocErr) {
    console.error('[accept-comanda]', allocErr);
    return res.status(500).json({ error: 'Eroare la procesarea acceptării' });
  }

  if (!allocated || allocated.length === 0) {
    // Fie comanda a fost deja preluată de altcineva, fie nu a fost niciodată
    // notificată acestui partener — în ambele cazuri respingem.
    return res.status(409).json({ error: 'Comanda a fost deja preluată de alt partener sau nu îți este alocată' });
  }

  // 2. Blochează comanda pe acest partener + marchează restul alocărilor ca expirate
  // FIX (bug real găsit la testare live, 26 Iulie 2026): update-ul scria o
  // coloană `updated_at` care nu există pe `comenzi` (verificat direct în
  // information_schema) — UPDATE-ul eșua mereu aici, DUPĂ ce alocari_fifo
  // era deja marcat 'acceptat', lăsând comanda blocată etern în
  // in_cautare_partener, fără partener_id, cu FIFO-ul arătând fals acceptat.
  const { error: updComandaErr } = await supabaseAdmin
    .from('comenzi')
    .update({ status: 'acceptata', partener_id: user.id })
    .eq('id', comanda_id)
    .eq('status', 'in_cautare_partener'); // dublă protecție la concurență

  if (updComandaErr) {
    console.error('[accept-comanda] update comanda', updComandaErr);
    return res.status(500).json({ error: 'Comanda a fost preluată dar nu am putut actualiza statusul' });
  }

  await supabaseAdmin
    .from('alocari_fifo')
    .update({ raspuns: 'expirat' })
    .eq('comanda_id', comanda_id)
    .neq('partener_id', user.id)
    .eq('raspuns', 'in_asteptare');

  return res.status(200).json({ ok: true, comanda_id, status: 'acceptata' });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);
