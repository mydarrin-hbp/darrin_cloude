// /api/marketplace/upload-document-kyc.js
// Completează o buclă deja pe jumătate construită: `documente_partener`
// (tip_document/status/verificat_de) e exact tabela citită/scrisă de
// api/admin/verifica-document.js (real, funcțional), dar nimic nu insera
// vreodată un rând în ea — KYC-ul din mydarrin-marketplace.html
// (registerFurnizor()) era 100% decorativ. Fișierul e deja urcat de
// client în bucket-ul Storage `marketplace-media` (tipar identic
// wizard-certificari.js) — acest endpoint doar înregistrează referința.
//
// GET  → documentele KYC proprii + status verificare
// POST { tip_document, storage_path }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

// FIX (testat live, 2 August 2026): valorile inventate inițial
// ('certificat_inregistrare'/'cui_cif'/'act_identitate_administrator') nu
// existau — constrângerea reală (`documente_partener_tip_document_check`,
// verificată direct din baza live) e: 'ci','licenta','licenta_arr',
// 'cazier_judiciar','asigurare','certificat','cui','contract'. Folosim
// doar subsetul relevant pentru KYC de marketplace. La fel, `status`
// inițial e 'pending' (englez), NU 'in_verificare' — constrângerea reală
// e ['pending','aprobat','respins'], verificată direct, nu presupusă.
const TIPURI_VALIDE = ['certificat', 'cui', 'ci'];
const ROLURI = ['partener_materiale', 'partener_inchirieri'];

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('documente_partener')
      .select('id, tip_document, storage_path, status, observatii, uploaded_at, verificat_la')
      .eq('partener_id', user.id)
      .order('uploaded_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, documente: data || [] });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tip_document, storage_path } = req.body || {};
  if (!TIPURI_VALIDE.includes(tip_document)) {
    return res.status(400).json({ error: `tip_document trebuie să fie una din: ${TIPURI_VALIDE.join(', ')}` });
  }
  if (!storage_path || typeof storage_path !== 'string') {
    return res.status(400).json({ error: 'storage_path (calea fișierului deja urcat) este obligatoriu' });
  }
  // Fișierul trebuie să fie chiar în folderul acestui furnizor — exact
  // verificarea din wizard-certificari.js, altfel oricine ar putea
  // înregistra calea către documentul altcuiva.
  if (!storage_path.startsWith(`${user.id}/`)) {
    return res.status(403).json({ error: 'Calea fișierului nu aparține contului tău' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('documente_partener')
      .insert({ partener_id: user.id, tip_document, storage_path, status: 'pending' })
      .select()
      .single();
    if (error) throw error;
    return res.status(200).json({ ok: true, document: data });
  } catch (err) {
    console.error('[marketplace/upload-document-kyc]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut înregistra documentul' });
  }
}

module.exports = requireAuth(ROLURI, handler);
