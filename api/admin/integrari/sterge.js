// /api/admin/integrari/sterge.js
// Șterge o configurare de integrare. Import-urile CSV asociate se șterg
// automat (on delete cascade pe integrari_importuri_csv.integrare_id) —
// nu ating rândurile din date_stagate ale altor integrări.
//
// Body: { id }

const { requireAuth } = require('../../../lib/auth-middleware');
const { supabaseAdmin } = require('../../../lib/supabaseAdmin');

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id este obligatoriu' });

  const { error } = await supabaseAdmin.from('integrari_furnizori').delete().eq('id', id);
  if (error) {
    console.error('[admin/integrari/sterge]', error);
    return res.status(500).json({ error: 'Nu am putut șterge integrarea' });
  }

  return res.status(200).json({ ok: true });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
