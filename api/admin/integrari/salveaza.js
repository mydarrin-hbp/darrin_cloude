// /api/admin/integrari/salveaza.js
// Creează sau actualizează o configurare de integrare (API și/sau CSV).
// Cheia API, dacă e trimisă, se criptează înainte de scriere — exact
// tiparul IBAN din api/partener/wizard-companie.js (RPC cripteaza_camp).
// Câmpul api_key nu se suprascrie cu gol dacă nu e trimis la un update
// (altfel orice editare fără să reintroduci cheia ar șterge-o).
//
// Body: { id?, categorie, nume_furnizor, tip_configurare, status?, tara_cod?,
//         partener_id?, api_endpoint?, api_key?, api_config?, observatii? }

const { requireAuth } = require('../../../lib/auth-middleware');
const { supabaseAdmin } = require('../../../lib/supabaseAdmin');

const CATEGORII_VALIDE = [
  'asigurari', 'marketplace_bricolaj', 'marketplace_general',
  'procesatori_carduri', 'curieri', 'inchirieri', 'date_companii_ro',
  'date_companii_eu', 'vat', 'geolocalizare', 'contabilitate', 'altele',
];
const TIPURI_CONFIGURARE = ['api', 'csv', 'ambele'];
const STATUSURI = ['activ', 'inactiv', 'in_asteptare_test'];

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    id, categorie, nume_furnizor, tip_configurare, status = 'inactiv',
    tara_cod = null, partener_id = null, api_endpoint = null, api_key,
    api_config = {}, observatii = null,
  } = req.body || {};

  if (!CATEGORII_VALIDE.includes(categorie)) {
    return res.status(400).json({ error: `categorie invalidă. Valori acceptate: ${CATEGORII_VALIDE.join(', ')}` });
  }
  if (!nume_furnizor || typeof nume_furnizor !== 'string') {
    return res.status(400).json({ error: 'nume_furnizor este obligatoriu' });
  }
  if (!TIPURI_CONFIGURARE.includes(tip_configurare)) {
    return res.status(400).json({ error: `tip_configurare invalid. Valori acceptate: ${TIPURI_CONFIGURARE.join(', ')}` });
  }
  if (!STATUSURI.includes(status)) {
    return res.status(400).json({ error: `status invalid. Valori acceptate: ${STATUSURI.join(', ')}` });
  }

  const camp = {
    categorie, nume_furnizor, tip_configurare, status, tara_cod, partener_id,
    api_endpoint, api_config, observatii, updated_at: new Date().toISOString(),
  };

  if (typeof api_key === 'string' && api_key.trim()) {
    const { data: cripted, error: cryptErr } = await supabaseAdmin.rpc('cripteaza_camp', { valoare: api_key.trim() });
    if (cryptErr) {
      console.error('[admin/integrari/salveaza] criptare', cryptErr);
      return res.status(500).json({ error: 'Nu am putut cripta cheia API' });
    }
    camp.api_key_criptat = cripted;
  }

  try {
    let result;
    if (id) {
      result = await supabaseAdmin.from('integrari_furnizori').update(camp).eq('id', id).select('id').single();
    } else {
      result = await supabaseAdmin.from('integrari_furnizori').insert({ ...camp, creat_de: user.id }).select('id').single();
    }
    if (result.error) throw result.error;
    return res.status(200).json({ ok: true, id: result.data.id });
  } catch (err) {
    console.error('[admin/integrari/salveaza]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut salva integrarea' });
  }
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
