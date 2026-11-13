// /api/admin/integrari/sterge.js
// Șterge o configurare de integrare. Import-urile CSV asociate se șterg
// automat (on delete cascade pe integrari_importuri_csv.integrare_id) —
// nu ating rândurile din date_stagate ale altor integrări.
//
// Body: { id }

const { requireAuth } = require('../../../lib/auth-middleware');
const { formaComuna, trimiteEroare } = require('../../../lib/raspuns-eroare');
const { supabaseAdmin } = require('../../../lib/supabaseAdmin');

async function handler(req, res) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const { id } = req.body || {};
  if (!id) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'id este obligatoriu', 'id is required.', ['id']);

  const { error } = await supabaseAdmin.from('integrari_furnizori').delete().eq('id', id);
  if (error) {
    console.error('[admin/integrari/sterge]', error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut șterge integrarea', 'We could not delete the integration.');
  }

  return res.status(200).json({ ok: true });
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
