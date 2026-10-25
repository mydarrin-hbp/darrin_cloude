// /api/admin/parteneri-lista.js
// 1 septembrie 2026 — găsit lipsă în timp ce retrăgeam mydarrin-backoffice-serviciu.html:
// panel-parteneri din mydarrin-superadmin.html era el însuși 100% machetă ("1.842 actori"
// hardcodat, link spre pagina retrasă) — nicăieri în platformă nu exista un endpoint real
// de listare a partenerilor pentru admin (doar aprobare/respingere punctuală pe id, în
// api/admin/verifica-document.js). Construit acum, tipar identic restului de endpoint-uri
// admin din acest fișier — fără el, retragerea backoffice-serviciu ar fi lăsat o gaură
// funcțională reală, nu doar cosmetică.
//
// Pasul 11-P1 (25 oct. 2026): fiecare partener vine cu forma juridică (etichetele
// RO și EN din lib/forme-juridice.js, plus forma locală la firma_straina) și cu
// marcajul „de verificat manual la ANAF” (audit_log, pus la înregistrare când
// ANAF nu a răspuns sau nu a găsit CUI-ul).

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { eticheta } = require('../../lib/forme-juridice');
const { ACTIUNE_VERIFICARE_MANUALA } = require('../../lib/verifica-firma-partener');

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data, error } = await supabaseAdmin
    .from('partners')
    .select('id, partner_type, nume_firma, cui, status_verificare, contract_semnat, tip_entitate_legala, forma_juridica_locala, regiune_cod, creata_la')
    .order('creata_la', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const ids = (data || []).map((p) => String(p.id));
  const deVerificat = new Set();
  if (ids.length) {
    const { data: marcaje } = await supabaseAdmin
      .from('audit_log').select('entitate_id')
      .eq('actiune', ACTIUNE_VERIFICARE_MANUALA).in('entitate_id', ids);
    (marcaje || []).forEach((m) => deVerificat.add(String(m.entitate_id)));
  }

  const parteneri = (data || []).map((p) => ({
    ...p,
    forma_juridica: p.tip_entitate_legala
      ? { ro: eticheta(p.tip_entitate_legala, 'ro'), en: eticheta(p.tip_entitate_legala, 'en') }
      : null,
    verificare_anaf_manuala: deVerificat.has(String(p.id)),
  }));
  return res.status(200).json({ ok: true, total: parteneri.length, parteneri });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
