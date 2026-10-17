// /api/partener/profil-status.js
// Cardul „Profil incomplet” din dashboard-urile de partener (decizie LM,
// 14 oct. 2026): profilul e incomplet cât timp lipsesc codurile NACE sau
// clauza de zonă acceptată — singurele date strânse doar de „Completare
// profil partener” (mydarrin-devino-partener-wizard.html, pașii 3 și 7).
//
// Starea se citește din tabele, nu din user_metadata: partner_coduri_nace
// (scris de wizard-nace) și partner_alocari_sarcini.zona_livrare_acceptata
// (scris de wizard-alocare, cu IP și oră). Felul în care se salvează nu se
// schimbă; contractul (lib/contract-partener-date.js) și notificările
// (lib/notifica-servicii-noi.js) le citesc ca înainte.
//
// Pasul 11-H1 (16 oct. 2026):
//   - furnizorii de materiale și închirieri nu mai sunt întrebați de codurile
//     NACE la nivel de cont: NACE vine pe fiecare produs, din ruta de
//     încadrare, validat la salvare și la import
//     (lib/valideaza-produs-marketplace.js, câmpul nace_cod obligatoriu);
//   - furnizorul propriu al platformei (decizia 26) nu are clauză de zonă
//     contractuală (nu semnează contract cu sine).
// Celelalte lipsuri reale rămân.
//
// GET → { ok, complet, lipsa: ['nace' | 'clauza_zona'], pas }
//       pas = primul pas din wizard de completat (3 = NACE, 7 = clauza), null dacă e complet

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { esteFurnizorPropriu } = require('../../lib/furnizor-propriu');

const ROLURI_PARTENER = ['partener_servicii', 'partener_materiale', 'partener_inchirieri', 'partener_curier', 'partener_asigurari'];
// partners.partner_type cu NACE pe produs, nu pe cont.
const TIPURI_NACE_PE_PRODUS = ['furnizor_materiale', 'inchirieri_utilaje'];

async function handler(req, res, user) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [nace, clauza, partener, propriu] = await Promise.all([
      supabaseAdmin
        .from('partner_coduri_nace')
        .select('cod_nace', { count: 'exact', head: true })
        .eq('partner_id', user.id),
      supabaseAdmin
        .from('partner_alocari_sarcini')
        .select('id', { count: 'exact', head: true })
        .eq('partner_id', user.id)
        .eq('zona_livrare_acceptata', true),
      supabaseAdmin.from('partners').select('partner_type').eq('id', user.id).maybeSingle(),
      esteFurnizorPropriu(user.id),
    ]);
    if (nace.error) throw nace.error;
    if (clauza.error) throw clauza.error;
    if (partener.error) throw partener.error;

    const nacePeProdus = TIPURI_NACE_PE_PRODUS.includes(partener.data?.partner_type);
    const lipsa = [];
    if (!nacePeProdus && !(nace.count > 0)) lipsa.push('nace');
    if (!propriu && !(clauza.count > 0)) lipsa.push('clauza_zona');
    const pas = lipsa.includes('nace') ? 3 : (lipsa.includes('clauza_zona') ? 7 : null);

    return res.status(200).json({ ok: true, complet: lipsa.length === 0, lipsa, pas });
  } catch (err) {
    console.error('[profil-status]', err);
    return res.status(500).json({ error: 'Nu am putut verifica profilul de partener' });
  }
}

module.exports = requireAuth(ROLURI_PARTENER, handler);
