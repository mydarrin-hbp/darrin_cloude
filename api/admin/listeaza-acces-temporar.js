// /api/admin/listeaza-acces-temporar.js
// GET → { ok, accese: [...] } — listă completă (activ/revocat/expirat),
// pentru tabelul din panoul „Acces Temporar" al superadmin.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data, error } = await supabaseAdmin
    .from('accese_temporare')
    .select('id, email, ruta_url, descriere, expira_la, activ, revocat_la, ultima_autentificare, nr_autentificari, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('[listeaza-acces-temporar]', error);
    return res.status(500).json({ error: 'Nu am putut încărca accesele.' });
  }

  return res.status(200).json({ ok: true, accese: data || [] });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
