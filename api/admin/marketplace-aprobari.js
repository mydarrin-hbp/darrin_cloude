// /api/admin/marketplace-aprobari.js
// Panou nou „Marketplace — Aprobări" — pentru furnizori/documente KYC,
// reutilizează exact api/admin/verifica-document.js (deja real, deja
// funcțional, dar niciodată apelat de vreo UI — bug găsit în audit: fără
// el, parteneri rămân blocați la infinit pe „verificare în curs").
// Acest fișier adaugă DOAR ce lipsea: aprobare/respingere produse
// (marketplace_materiale/echipamente) + o listă unificată pentru panou.
//
// GET  → { furnizori_pending, documente_pending, produse_pending:{materiale,echipamente} }
// POST { tip:'produs', produs_tip:'materiale'|'echipamente', id, decizie:'aprobat'|'respins', motiv? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

const TABEL_PRODUS = { materiale: 'marketplace_materiale', echipamente: 'marketplace_echipamente' };
const DECIZII_VALIDE = ['aprobat', 'respins'];
const TIPURI_FURNIZOR = ['furnizor_materiale', 'inchirieri_utilaje'];

async function handleGet(req, res) {
  const [{ data: furnizoriPending }, { data: documentePending }, { data: materialePending }, { data: echipamentePending }] = await Promise.all([
    supabaseAdmin.from('partners').select('id, nume_firma, cui, partner_type, status_verificare, creata_la')
      .in('partner_type', TIPURI_FURNIZOR).eq('status_verificare', 'pending_review'),
    supabaseAdmin.from('documente_partener').select('id, partener_id, tip_document, storage_path, status, uploaded_at')
      .eq('status', 'in_verificare'),
    supabaseAdmin.from('marketplace_materiale').select('id, furnizor_id, denumire, pret_fara_tva, moneda, status, creat_la')
      .eq('status', 'in_asteptare'),
    supabaseAdmin.from('marketplace_echipamente').select('id, furnizor_id, denumire, tarif_zi, moneda, status, creat_la')
      .eq('status', 'in_asteptare'),
  ]);

  return res.status(200).json({
    ok: true,
    furnizori_pending: furnizoriPending || [],
    documente_pending: documentePending || [],
    produse_pending: { materiale: materialePending || [], echipamente: echipamentePending || [] },
  });
}

async function handlePost(req, res, admin) {
  const { tip, produs_tip, id, decizie, motiv } = req.body || {};
  if (tip !== 'produs') {
    return res.status(400).json({ error: "Pentru documente/parteneri, folosește /api/admin/verifica-document.js. Aici doar tip:'produs'." });
  }
  if (!TABEL_PRODUS[produs_tip] || !id || !DECIZII_VALIDE.includes(decizie)) {
    return res.status(400).json({ error: "produs_tip ('materiale'|'echipamente'), id și decizie ('aprobat'|'respins') sunt obligatorii" });
  }

  const update = decizie === 'aprobat'
    ? { status: 'live', motiv_respingere: null }
    : { status: 'respins', motiv_respingere: motiv || null };

  const { data, error } = await supabaseAdmin
    .from(TABEL_PRODUS[produs_tip])
    .update(update)
    .eq('id', id)
    .select()
    .single();
  if (error || !data) return res.status(404).json({ error: 'Produsul nu există' });

  await inregistreazaAudit({
    admin, req, actiune: `marketplace_produs_${decizie}`, entitate: TABEL_PRODUS[produs_tip], entitate_id: id, detalii: { decizie, motiv },
  });
  return res.status(200).json({ ok: true, produs: data });
}

async function handler(req, res, admin) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res, admin);
  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
