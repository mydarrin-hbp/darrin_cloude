// /api/admin/integrari/listeaza.js
// Structură generică de integrări externe — listă completă. Cheia API
// criptată nu e niciodată returnată în clar, doar un boolean care confirmă
// că există (același principiu ca IBAN-ul mascat în wizard-companie.js).
//
// GET

const { requireAuth } = require('../../../lib/auth-middleware');
const { supabaseAdmin } = require('../../../lib/supabaseAdmin');
const { trimiteEroare } = require('../../../lib/raspuns-eroare');

async function handler(req, res) {
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const { data, error } = await supabaseAdmin
    .from('integrari_furnizori')
    .select('id, categorie, nume_furnizor, tip_configurare, status, tara_cod, partener_id, api_endpoint, api_key_criptat, api_config, observatii, ultima_verificare_la, ultima_verificare_status, creat_la, updated_at')
    .order('categorie', { ascending: true })
    .order('nume_furnizor', { ascending: true });
  if (error) {
    console.error('[admin/integrari/listeaza]', error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca lista de integrări', 'We could not load the list of integrations.');
  }

  const integrari = (data || []).map(({ api_key_criptat, ...rest }) => ({
    ...rest,
    are_cheie_api: !!api_key_criptat,
  }));

  return res.status(200).json({ ok: true, integrari });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
