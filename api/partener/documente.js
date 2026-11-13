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
const v = require('../../lib/valideaza');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  tip_document: v.text({ max: 60, eticheta: ['Tipul documentului', 'Document type'] }),
  document_path: v.text({ max: 300, eticheta: ['Fișierul', 'File'] }),
};

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
    if (!id || typeof id !== 'string') return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'id este obligatoriu.', 'id is required.', ['id']);
    const { data: doc } = await supabaseAdmin
      .from('documente_partener').select('id, storage_path, status').eq('id', id).eq('partener_id', user.id).maybeSingle();
    if (!doc) return trimiteEroare(res, 404, 'DOCUMENT_NU_EXISTA', 'Documentul nu există sau nu îți aparține.', 'The document does not exist or does not belong to you.');
    if (doc.status !== 'pending') return trimiteEroare(res, 409, 'STARE_GRESITA', 'Poți șterge doar documentele încă neverificate.', 'You can only delete documents that have not been checked yet.');
    const { error } = await supabaseAdmin.from('documente_partener').delete().eq('id', id).eq('partener_id', user.id);
    if (error) {
      console.error('[partener/documente] delete', error);
      return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut șterge documentul.', 'We could not delete the document. Please try again.');
    }
    await supabaseAdmin.storage.from(BUCKET).remove([doc.storage_path]).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora' })) return;
  const { tip_document, document_path } = req.body || {};
  if (!TIPURI.includes(tip_document)) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', `tip_document trebuie să fie unul din: ${TIPURI.join(', ')}.`, `tip_document must be one of: ${TIPURI.join(', ')}.`, ['tip_document']);
  }
  if (typeof document_path !== 'string' || document_path.length > 300 || document_path.includes('..')) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', 'document_path invalid.', 'document_path is not valid.', ['document_path']);
  }
  if (!document_path.startsWith(`${user.id}/`)) {
    return trimiteEroare(res, 403, 'FARA_DREPT', 'Calea fișierului nu aparține contului tău.', 'The file path does not belong to your account.');
  }

  const { count } = await supabaseAdmin
    .from('documente_partener').select('id', { count: 'exact', head: true }).eq('partener_id', user.id);
  if ((count || 0) >= MAX_DOCUMENTE) {
    return trimiteEroare(res, 429, 'LIMITA_ATINSA', `Ai atins limita de ${MAX_DOCUMENTE} documente. Șterge unul înainte să adaugi altul.`, `You have reached the limit of ${MAX_DOCUMENTE} documents. Delete one before adding another.`);
  }

  // Înregistrăm doar un fișier care există: altfel adminul ar primi o referință moartă.
  const { error: existaErr } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(document_path, 30);
  if (existaErr) return trimiteEroare(res, 400, 'FISIER_NU_EXISTA', 'Fișierul nu a fost găsit în Storage. Încarcă-l din nou.', 'The file was not found in storage. Please upload it again.');

  const { data, error } = await supabaseAdmin
    .from('documente_partener')
    .insert({ partener_id: user.id, tip_document, storage_path: document_path, status: 'pending' })
    .select('id, tip_document, status, uploaded_at')
    .single();
  if (error) {
    console.error('[partener/documente] insert', error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut înregistra documentul.', 'We could not save the document. Please try again.');
  }
  return res.status(200).json({ ok: true, document: data });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);
