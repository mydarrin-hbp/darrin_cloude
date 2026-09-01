// /api/admin/parteneri-lista.js
// 1 septembrie 2026 — găsit lipsă în timp ce retrăgeam mydarrin-backoffice-serviciu.html:
// panel-parteneri din mydarrin-superadmin.html era el însuși 100% machetă ("1.842 actori"
// hardcodat, link spre pagina retrasă) — nicăieri în platformă nu exista un endpoint real
// de listare a partenerilor pentru admin (doar aprobare/respingere punctuală pe id, în
// api/admin/verifica-document.js). Construit acum, tipar identic restului de endpoint-uri
// admin din acest fișier — fără el, retragerea backoffice-serviciu ar fi lăsat o gaură
// funcțională reală, nu doar cosmetică.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data, error } = await supabaseAdmin
    .from('partners')
    .select('id, partner_type, nume_firma, cui, status_verificare, contract_semnat, tip_entitate_legala, regiune_cod, creata_la')
    .order('creata_la', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true, total: (data || []).length, parteneri: data || [] });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
