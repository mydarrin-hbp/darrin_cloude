// /api/admin/integrari/listeaza.js
// Structură generică de integrări externe — listă completă. Cheia API
// criptată nu e niciodată returnată în clar, doar un boolean care confirmă
// că există (același principiu ca IBAN-ul mascat în wizard-companie.js).
//
// GET

const { requireAuth } = require('../../../lib/auth-middleware');
const { supabaseAdmin } = require('../../../lib/supabaseAdmin');

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data, error } = await supabaseAdmin
    .from('integrari_furnizori')
    .select('id, categorie, nume_furnizor, tip_configurare, status, tara_cod, partener_id, api_endpoint, api_key_criptat, api_config, observatii, ultima_verificare_la, ultima_verificare_status, creat_la, updated_at')
    .order('categorie', { ascending: true })
    .order('nume_furnizor', { ascending: true });
  if (error) {
    console.error('[admin/integrari/listeaza]', error);
    return res.status(500).json({ error: 'Nu am putut încărca lista de integrări' });
  }

  const integrari = (data || []).map(({ api_key_criptat, ...rest }) => ({
    ...rest,
    are_cheie_api: !!api_key_criptat,
  }));

  return res.status(200).json({ ok: true, integrari });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
