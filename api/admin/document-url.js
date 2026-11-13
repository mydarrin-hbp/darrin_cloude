// /api/admin/document-url.js
// Link semnat, cu durată scurtă, către un document de partener (28 sept. 2026).
// Panoul „Marketplace — Aprobări" afișa doar calea brută a fișierului, care într-un
// bucket privat nu se poate deschide, deci adminul nu putea verifica niciun document.
//
// GET ?id=<documente_partener.id> -> { ok, url, expira_in_secunde }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

const BUCKETS = ['partner-certificari', 'marketplace-media'];
const VALABIL_SECUNDE = 120;

async function handler(req, res, admin) {
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  const id = req.query?.id;
  if (!id) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'id este obligatoriu.', 'id is required.', ['id']);

  const { data: doc } = await supabaseAdmin
    .from('documente_partener').select('id, partener_id, tip_document, storage_path').eq('id', String(id)).maybeSingle();
  if (!doc) return trimiteEroare(res, 404, 'DOCUMENT_NU_EXISTA', 'Documentul nu există.', 'The document does not exist.');

  for (const bucket of BUCKETS) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(doc.storage_path, VALABIL_SECUNDE);
    if (!error && data?.signedUrl) {
      await inregistreazaAudit({
        admin, req, actiune: 'document_partener_vizualizat', entitate: 'documente_partener', entitate_id: doc.id,
        detalii: { tip_document: doc.tip_document, partener_id: doc.partener_id },
      });
      return res.status(200).json({ ok: true, url: data.signedUrl, expira_in_secunde: VALABIL_SECUNDE });
    }
  }
  return trimiteEroare(res, 404, 'FISIER_NU_EXISTA', 'Fișierul nu a fost găsit în Storage.', 'The file was not found in storage.');
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
