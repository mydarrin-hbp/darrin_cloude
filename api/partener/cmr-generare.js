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

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { comanda_id, furnizor_id, continut_document } = req.body || {};
  if (!comanda_id || !furnizor_id || !continut_document) {
    return res.status(400).json({ error: 'comanda_id, furnizor_id și continut_document sunt obligatorii' });
  }

  // Verifică documentele obligatorii ale curierului (CUI, licență ARR, cazier)
  const { data: docs, error: docErr } = await supabaseAdmin
    .from('documente_partener')
    .select('tip_document, status')
    .eq('partener_id', user.id)
    .in('tip_document', ['cui', 'licenta_arr', 'cazier_judiciar']);

  if (docErr) return res.status(500).json({ error: 'Eroare la verificarea documentelor' });

  // FIX SECURITATE (audit 2026-07-10): verifică că comanda aparține acestui curier
  const { data: comanda, error: cmdErr } = await supabaseAdmin
    .from('comenzi')
    .select('partener_id, status')
    .eq('id', comanda_id)
    .single();
  if (cmdErr || !comanda) {
    return res.status(404).json({ error: 'Comanda nu există' });
  }
  if (comanda.partener_id !== user.id) {
    return res.status(403).json({ error: 'Comanda nu îți este alocată' });
  }
  if (!['acceptata','in_desfasurare','finalizata'].includes(comanda.status)) {
    return res.status(409).json({ error: 'Comanda nu se află în starea corectă pentru CMR' });
  }

  const obligatorii = ['cui', 'licenta_arr', 'cazier_judiciar'];
  const aprobate = new Set((docs || []).filter(d => d.status === 'aprobat').map(d => d.tip_document));
  const lipsa = obligatorii.filter(t => !aprobate.has(t));
  if (lipsa.length > 0) {
    return res.status(403).json({ error: `Documente lipsă sau neaprobate: ${lipsa.join(', ')}` });
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
    return res.status(500).json({ error: 'Nu am putut genera CMR-ul' });
  }

  return res.status(200).json({ ok: true, cmr: data });
}

module.exports = requireAuth(['partener_curier'], handler);
