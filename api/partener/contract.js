// /api/partener/contract.js
// Contractul-cadru de colaborare și subcontractare (28 sept. 2026), pentru dashboardul
// partenerului. Dacă a fost acceptat, întoarce instantaneul păstrat la acceptare
// (partner_contracte_semnate); altfel îl generează din datele reale curente
// (portofoliu, cod CAEN, competențe).
//
// GET -> { ok, semnat, versiune, versiune_curenta, numar, titlu, html, sha256? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { genereazaContractPartener } = require('../../lib/contract-partener-date');
const { CONTRACT_VERSIUNE } = require('../../lib/contract-partener');

const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];

async function handler(req, res, user) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data: snap } = await supabaseAdmin
    .from('partner_contracte_semnate')
    .select('versiune, numar, html, sha256, semnat_la')
    .eq('partner_id', user.id)
    .order('semnat_la', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (snap) {
    return res.status(200).json({
      ok: true, semnat: true, versiune: snap.versiune, versiune_curenta: CONTRACT_VERSIUNE,
      numar: snap.numar, titlu: 'Contract-cadru de colaborare și subcontractare',
      html: snap.html, sha256: snap.sha256, semnat_la: snap.semnat_la,
    });
  }

  const c = await genereazaContractPartener(user.id);
  if (!c) return res.status(404).json({ error: 'Cont de partener inexistent.' });
  return res.status(200).json({
    ok: true, semnat: false, versiune: c.versiune, versiune_curenta: CONTRACT_VERSIUNE,
    numar: c.numar, titlu: c.titlu, html: c.html,
  });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);
