// /api/partener/documente.js
// Documentele firmei/administratorului încărcate de orice tip de partener (28 sept. 2026).
// Fișierul se urcă direct din browser în bucket-ul privat `partner-certificari`, în
// folderul propriu (politica de Storage o impune); acest endpoint verifică că fișierul
// există chiar acolo și înregistrează referința în `documente_partener`, cu status
// 'pending', de unde îl preia adminul (Marketplace — Aprobări).
//
// POST   { tip_document, document_path } -> { ok, document }
// DELETE { id } -> { ok }   (doar documente proprii, încă neverificate)
// Lista documentelor vine din GET /api/partener/cont.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const BUCKET = 'partner-certificari';
const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];
// Subset din documente_partener_tip_document_check; 'contract' se semnează cu OTP, nu se încarcă.
const TIPURI = ['ci', 'certificat', 'cui', 'licenta', 'licenta_arr', 'cazier_judiciar', 'asigurare'];
const MAX_DOCUMENTE = 30;

async function handler(req, res, user) {
  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id este obligatoriu.' });
    const { data: doc } = await supabaseAdmin
      .from('documente_partener').select('id, storage_path, status').eq('id', id).eq('partener_id', user.id).maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Documentul nu există sau nu îți aparține.' });
    if (doc.status !== 'pending') return res.status(409).json({ error: 'Poți șterge doar documentele încă neverificate.' });
    const { error } = await supabaseAdmin.from('documente_partener').delete().eq('id', id).eq('partener_id', user.id);
    if (error) {
      console.error('[partener/documente] delete', error);
      return res.status(500).json({ error: 'Nu am putut șterge documentul.' });
    }
    await supabaseAdmin.storage.from(BUCKET).remove([doc.storage_path]).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tip_document, document_path } = req.body || {};
  if (!TIPURI.includes(tip_document)) {
    return res.status(400).json({ error: `tip_document trebuie să fie unul din: ${TIPURI.join(', ')}.` });
  }
  if (typeof document_path !== 'string' || document_path.length > 300 || document_path.includes('..')) {
    return res.status(400).json({ error: 'document_path invalid.' });
  }
  if (!document_path.startsWith(`${user.id}/`)) {
    return res.status(403).json({ error: 'Calea fișierului nu aparține contului tău.' });
  }

  const { count } = await supabaseAdmin
    .from('documente_partener').select('id', { count: 'exact', head: true }).eq('partener_id', user.id);
  if ((count || 0) >= MAX_DOCUMENTE) {
    return res.status(429).json({ error: `Ai atins limita de ${MAX_DOCUMENTE} documente. Șterge unul înainte să adaugi altul.` });
  }

  // Înregistrăm doar un fișier care există: altfel adminul ar primi o referință moartă.
  const { error: existaErr } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(document_path, 30);
  if (existaErr) return res.status(400).json({ error: 'Fișierul nu a fost găsit în Storage. Încarcă-l din nou.' });

  const { data, error } = await supabaseAdmin
    .from('documente_partener')
    .insert({ partener_id: user.id, tip_document, storage_path: document_path, status: 'pending' })
    .select('id, tip_document, status, uploaded_at')
    .single();
  if (error) {
    console.error('[partener/documente] insert', error);
    return res.status(500).json({ error: 'Nu am putut înregistra documentul.' });
  }
  return res.status(200).json({ ok: true, document: data });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);
