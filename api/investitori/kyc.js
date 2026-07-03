// /api/investitori/kyc.js
// Creează/actualizează dosarul KYC al investitorului. Documentele de identitate
// se încarcă separat în Supabase Storage (bucket privat `kyc-documents`) și doar
// URL-ul semnat se salvează aici — nu trimite fișierul direct în acest endpoint.
//
// Body: { profil_risc: {...}, document_identitate_url, pep: boolean }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { profil_risc, document_identitate_url, pep = false } = req.body || {};
  if (!profil_risc || !document_identitate_url) {
    return res.status(400).json({ error: 'profil_risc și document_identitate_url sunt obligatorii' });
  }

  const { data, error } = await supabaseAdmin
    .from('investitori_kyc')
    .upsert(
      {
        investitor_id: user.id,
        profil_risc,
        document_identitate_url,
        pep,
        status: 'in_verificare',
      },
      { onConflict: 'investitor_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('[investitori/kyc]', error);
    return res.status(500).json({ error: 'Nu am putut salva dosarul KYC' });
  }

  // TODO: notifică echipa de compliance (email/Slack) pentru revizuire manuală,
  // în special dacă pep === true (verificare sporită conform reglementărilor AML).

  return res.status(200).json({ ok: true, kyc: data });
}

module.exports = requireAuth([], handler);
