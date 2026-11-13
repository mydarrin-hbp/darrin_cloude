// /api/admin/listeaza-acces-temporar.js
// GET → { ok, accese: [...] } — listă completă (activ/revocat/expirat),
// pentru tabelul din panoul „Acces Temporar" al superadmin.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

async function handler(req, res) {
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const { data, error } = await supabaseAdmin
    .from('accese_temporare')
    .select('id, email, ruta_url, descriere, expira_la, activ, revocat_la, ultima_autentificare, nr_autentificari, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('[listeaza-acces-temporar]', error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca accesele.', 'We could not load the access list.');
  }

  return res.status(200).json({ ok: true, accese: data || [] });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
