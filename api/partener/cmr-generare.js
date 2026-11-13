// /api/partener/cmr-generare.js
// Generează documentul CMR digital în momentul preluării mărfii de către
// curier de la depozitul furnizorului. Hash-ul SHA-256 al conținutului
// documentului joacă rolul unei "semnături" simplificate — pentru o
// semnătură eIDAS calificată reală e nevoie de un furnizor extern
// (ex. certSIGN, DocuSign eIDAS), integrare care nu poate fi simulată în cod.
//
// Body: { comanda_id, furnizor_id, continut_document }
//
// FIX (audit 2026-07-10): verificare IDOR — comanda trebuie să aparțină curierului apelant

const crypto = require('crypto');
const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const v = require('../../lib/valideaza');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  comanda_id: v.id({ eticheta: ['Comanda', 'Order'] }),
  furnizor_id: v.id({ eticheta: ['Furnizor', 'Supplier'] }),
  continut_document: v.oricare({ maxOcteti: 300000, eticheta: ['Conținutul documentului', 'Document content'] }),
};

async function handler(req, res, user) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora', limite: { maxOcteti: 300000, maxText: 100000 } })) return;
  const { comanda_id, furnizor_id, continut_document } = req.body || {};
  if (!comanda_id || !furnizor_id || !continut_document) {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'comanda_id, furnizor_id și continut_document sunt obligatorii', 'comanda_id, furnizor_id and continut_document are required.');
  }

  // Verifică documentele obligatorii ale curierului (CUI, licență ARR, cazier)
  const { data: docs, error: docErr } = await supabaseAdmin
    .from('documente_partener')
    .select('tip_document, status')
    .eq('partener_id', user.id)
    .in('tip_document', ['cui', 'licenta_arr', 'cazier_judiciar']);

  if (docErr) return trimiteEroare(res, 500, 'EROARE_SERVER', 'Eroare la verificarea documentelor', 'Error while checking the documents. Please try again.');

  // FIX SECURITATE (audit 2026-07-10): verifică că comanda aparține acestui curier
  const { data: comanda, error: cmdErr } = await supabaseAdmin
    .from('comenzi')
    .select('partener_id, status')
    .eq('id', comanda_id)
    .single();
  if (cmdErr || !comanda) {
    return trimiteEroare(res, 404, 'COMANDA_NU_EXISTA', 'Comanda nu există', 'The order does not exist.');
  }
  if (comanda.partener_id !== user.id) {
    return trimiteEroare(res, 403, 'COMANDA_NEALOCATA', 'Comanda nu îți este alocată', 'This order is not assigned to you.');
  }
  // FIX (audit Secțiunea 24/36, 28 Iulie 2026): 'in_desfasurare' nu există
  // în comenzi_status_check (vezi api/partener/gps.js, același bug).
  if (!['acceptata', 'in_executie', 'finalizata'].includes(comanda.status)) {
    return trimiteEroare(res, 409, 'STARE_GRESITA', 'Comanda nu se află în starea corectă pentru CMR', 'The order is not in the right state for a CMR.');
  }

  const obligatorii = ['cui', 'licenta_arr', 'cazier_judiciar'];
  const aprobate = new Set((docs || []).filter(d => d.status === 'aprobat').map(d => d.tip_document));
  const lipsa = obligatorii.filter(t => !aprobate.has(t));
  if (lipsa.length > 0) {
    return trimiteEroare(res, 403, 'DOCUMENTE_LIPSA', `Documente lipsă sau neaprobate: ${lipsa.join(', ')}`, `Missing or unapproved documents: ${lipsa.join(', ')}`);
  }

  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ comanda_id, furnizor_id, curier_id: user.id, continut_document, ts: Date.now() }))
    .digest('hex');

  const { data, error } = await supabaseAdmin
    .from('cmr_digital')
    .insert({ comanda_id, curier_id: user.id, furnizor_id, hash_document: hash })
    .select()
    .single();

  if (error) {
    console.error('[cmr-generare]', error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut genera CMR-ul', 'We could not generate the CMR. Please try again.');
  }

  return res.status(200).json({ ok: true, cmr: data });
}

module.exports = requireAuth(['partener_curier'], handler);
