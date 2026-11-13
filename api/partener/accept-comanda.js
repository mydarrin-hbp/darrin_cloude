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
const v = require('../../lib/valideaza');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  comanda_id: v.id({ eticheta: ['Comanda', 'Order'] }),
};

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
  [MOTIV.INEXISTENT]: { code: 'PARTENER_INEXISTENT', error: 'Cont de partener inexistent.', error_en: 'The partner account does not exist.' },
  [MOTIV.SUSPENDAT]: { code: 'CONT_SUSPENDAT', error: 'Contul tău este suspendat — nu poți prelua comenzi.', error_en: 'Your account is suspended, so you cannot take orders.' },
  [MOTIV.RESPINS]: { code: 'PROFIL_NEAPROBAT', error: 'Profilul tău nu a fost încă aprobat de echipa My Darrin — nu poți prelua comenzi.', error_en: 'Your profile has not been approved by the My Darrin team yet, so you cannot take orders.' },
  [MOTIV.IN_VERIFICARE]: { code: 'PROFIL_NEAPROBAT', error: 'Profilul tău nu a fost încă aprobat de echipa My Darrin — nu poți prelua comenzi.', error_en: 'Your profile has not been approved by the My Darrin team yet, so you cannot take orders.' },
  [MOTIV.FARA_CONT_BANCAR]: { code: 'FARA_CONT_BANCAR', error: 'Adaugă mai întâi un cont bancar activ — nu poți prelua comenzi fără date de încasare.', error_en: 'First add an active bank account: you cannot take orders without payment details.' },
  [MOTIV.FARA_CONTRACT]: { code: 'CONTRACT_NESEMNAT', error: 'Trebuie să semnezi electronic contractul de parteneriat (cod OTP) înainte de a prelua comenzi.', error_en: 'You must sign the partnership contract electronically (with the code) before taking orders.' },
};

async function verificaHardStop(user) {
  const partener = await eligibilitatePartener(user.id);
  if (poatePrimiComenzi(partener)) return { ok: true };
  return { ok: false, ...MESAJ_HARD_STOP[motivNuPoateVinde(partener)] };
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const gate = await verificaHardStop(user);
  if (!gate.ok) return trimiteEroare(res, 403, gate.code, gate.error, gate.error_en, null, { code: gate.code });

  if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora' })) return;
  const { comanda_id } = req.body || {};
  if (!comanda_id) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'comanda_id este obligatoriu', 'comanda_id is required.', ['comanda_id']);

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
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Eroare la procesarea acceptării', 'Error while processing the acceptance. Please try again.');
  }

  if (!allocated || allocated.length === 0) {
    // Fie comanda a fost deja preluată de altcineva, fie nu a fost niciodată
    // notificată acestui partener — în ambele cazuri respingem.
    return trimiteEroare(res, 409, 'COMANDA_PRELUATA', 'Comanda a fost deja preluată de alt partener sau nu îți este alocată', 'The order has already been taken by another partner or is not assigned to you.');
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
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Comanda a fost preluată dar nu am putut actualiza statusul', 'The order was taken, but we could not update its status. Please refresh the page.');
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
