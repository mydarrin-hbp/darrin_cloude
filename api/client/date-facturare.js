// /api/client/date-facturare.js
// Pasul 11-P2b (25 oct. 2026): datele de facturare din ultima comandă a
// clientului autentificat, ca checkout-ul (și coșul cu mai multe servicii)
// să le precompleteze. CNP-ul nu se întoarce niciodată: doar cnp_furnizat și
// cnp_ultimele3, cum stau pe comandă (comenzi.date_facturare).
//
// GET -> { ok:true, date_facturare: {...} | null }   (null = nicio comandă cu date de facturare)

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const CHEI_ADRESA = ['strada', 'localitate', 'judet', 'cod_postal', 'tara'];
const CHEI = {
  pf: ['tip', 'prenume', 'nume', 'cnp_furnizat', 'cnp_ultimele3'],
  pj: ['tip', 'denumire', 'cui', 'nr_reg_com', 'tva_activ', 'sursa'],
};

// Doar cheile cunoscute, ca nimic în plus de pe comandă să nu ajungă în pagină.
function curata(df) {
  if (!df || typeof df !== 'object' || !CHEI[df.tip]) return null;
  const rez = {};
  CHEI[df.tip].forEach((k) => { if (df[k] !== undefined) rez[k] = df[k]; });
  if (df.adresa && typeof df.adresa === 'object') {
    rez.adresa = {};
    CHEI_ADRESA.forEach((k) => { rez.adresa[k] = df.adresa[k] ?? null; });
  }
  return rez;
}

async function handler(req, res, user) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { data, error } = await supabaseAdmin
      .from('comenzi')
      .select('date_facturare, creat_la')
      .eq('client_id', user.id)
      .not('date_facturare', 'is', null)
      .order('creat_la', { ascending: false })
      .limit(1);
    if (error) throw error;
    return res.status(200).json({ ok: true, date_facturare: curata(data && data[0] && data[0].date_facturare) });
  } catch (err) {
    console.error('[client/date-facturare]', err);
    return res.status(500).json({
      error: 'Nu am putut citi datele de facturare.',
      error_en: 'We could not read the billing details.',
    });
  }
}

module.exports = requireAuth([], handler);
