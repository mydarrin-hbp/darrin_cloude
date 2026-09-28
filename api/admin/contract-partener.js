// /api/admin/contract-partener.js
// Vizualizare admin a contractului unui partener (instantaneul acceptat sau, dacă nu
// e acceptat încă, varianta generată din datele curente).
//
// GET ?partener_id=<uuid> -> { ok, semnat, versiune, numar, html, sha256?, semnat_la? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { genereazaContractPartener } = require('../../lib/contract-partener-date');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const id = String(req.query?.partener_id || '');
  if (!UUID.test(id)) return res.status(400).json({ error: 'partener_id invalid.' });

  const { data: snap } = await supabaseAdmin
    .from('partner_contracte_semnate')
    .select('versiune, numar, html, sha256, semnat_la, ip')
    .eq('partner_id', id)
    .order('semnat_la', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (snap) return res.status(200).json({ ok: true, semnat: true, ...snap });

  const c = await genereazaContractPartener(id);
  if (!c) return res.status(404).json({ error: 'Partener inexistent.' });
  return res.status(200).json({ ok: true, semnat: false, versiune: c.versiune, numar: c.numar, html: c.html });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
