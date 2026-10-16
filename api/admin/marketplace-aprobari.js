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
//
// Pasul 10c (16 oct. 2026): un produs devine `live` doar dacă furnizorul lui
// poate vinde (regula unică din lib/eligibilitate-partener.js); altfel
// aprobarea e refuzată cu motivul, în RO (error) și EN (error_en). În listă,
// fiecare produs vine cu starea furnizorului (furnizor_stare).

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { incarcaEligibilitate, MESAJ_FURNIZOR, MOTIV, TIPURI_FURNIZOR } = require('../../lib/eligibilitate-partener');

const TABEL_PRODUS = { materiale: 'marketplace_materiale', echipamente: 'marketplace_echipamente' };
const DECIZII_VALIDE = ['aprobat', 'respins'];

function stareFurnizor(e) {
  const motiv = e ? e.motiv : MOTIV.INEXISTENT;
  return {
    nume_firma: e ? e.nume_firma || null : null,
    status_verificare: e ? e.status_verificare : null,
    contract_semnat: e ? e.contract_semnat : false,
    cont_bancar: e ? e.cont_bancar : false,
    furnizor_propriu: e ? e.furnizor_propriu : false,
    poate_vinde: !motiv,
    motiv: motiv || null,
    mesaj: motiv ? MESAJ_FURNIZOR[motiv].ro : null,
    mesaj_en: motiv ? MESAJ_FURNIZOR[motiv].en : null,
  };
}

async function handleGet(req, res) {
  const [{ data: furnizoriPending }, { data: documentePending }, { data: materialePending }, { data: echipamentePending }] = await Promise.all([
    supabaseAdmin.from('partners').select('id, nume_firma, cui, partner_type, status_verificare, creata_la')
      .in('partner_type', TIPURI_FURNIZOR).eq('status_verificare', 'pending_review'),
    supabaseAdmin.from('documente_partener').select('id, partener_id, tip_document, storage_path, status, uploaded_at')
      .eq('status', 'pending'),
    supabaseAdmin.from('marketplace_materiale').select('id, furnizor_id, denumire, pret_fara_tva, moneda, status, creat_la')
      .eq('status', 'in_asteptare'),
    supabaseAdmin.from('marketplace_echipamente').select('id, furnizor_id, denumire, tarif_zi, moneda, status, creat_la')
      .eq('status', 'in_asteptare'),
  ]);

  // Adminul trebuie să vadă numele firmei, nu doar un UUID, ca să știe ce verifică.
  const idsParteneri = [...new Set((documentePending || []).map((d) => d.partener_id))];
  const numePeId = {};
  if (idsParteneri.length) {
    const { data: parteneri } = await supabaseAdmin.from('partners').select('id, nume_firma').in('id', idsParteneri);
    (parteneri || []).forEach((p) => { numePeId[p.id] = p.nume_firma; });
  }
  const documenteCuNume = (documentePending || []).map((d) => ({ ...d, nume_firma: numePeId[d.partener_id] || null }));

  // Starea furnizorului lângă fiecare produs: poate vinde sau de ce nu.
  const produsePending = [...(materialePending || []), ...(echipamentePending || [])];
  const eligibilitate = await incarcaEligibilitate(produsePending.map((p) => p.furnizor_id));
  const cuStare = (lista) => (lista || []).map((p) => ({ ...p, furnizor_stare: stareFurnizor(eligibilitate.get(p.furnizor_id)) }));

  return res.status(200).json({
    ok: true,
    furnizori_pending: furnizoriPending || [],
    documente_pending: documenteCuNume,
    produse_pending: { materiale: cuStare(materialePending), echipamente: cuStare(echipamentePending) },
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

  const tabel = TABEL_PRODUS[produs_tip];
  const { data: produs } = await supabaseAdmin.from(tabel).select('id, furnizor_id').eq('id', id).maybeSingle();
  if (!produs) return res.status(404).json({ error: 'Produsul nu există', error_en: 'The product does not exist.' });

  if (decizie === 'aprobat') {
    const e = (await incarcaEligibilitate([produs.furnizor_id])).get(produs.furnizor_id);
    const motivFurnizor = e ? e.motiv : MOTIV.INEXISTENT;
    if (motivFurnizor) {
      return res.status(409).json({
        error: `Produsul nu poate fi aprobat: ${MESAJ_FURNIZOR[motivFurnizor].ro} Rămâne în așteptare.`,
        error_en: `The product cannot be approved: ${MESAJ_FURNIZOR[motivFurnizor].en} It stays pending.`,
        code: 'FURNIZOR_NU_POATE_VINDE',
        motiv: motivFurnizor,
      });
    }
  }

  const update = decizie === 'aprobat'
    ? { status: 'live', motiv_respingere: null }
    : { status: 'respins', motiv_respingere: motiv || null };

  const { data, error } = await supabaseAdmin
    .from(tabel)
    .update(update)
    .eq('id', id)
    .select()
    .single();
  if (error || !data) return res.status(404).json({ error: 'Produsul nu există', error_en: 'The product does not exist.' });

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
