// /api/partener/accept-comanda.js
// Alocare FIFO: mai mulți parteneri din proximitate primesc aceeași comandă
// notificată; primul care apelează acest endpoint cu succes o câștigă.
//
// Siguranță la concurență: UPDATE-ul condiționat pe `raspuns = 'in_asteptare'`
// este atomic în Postgres (row-level lock la primul commit) — două cereri
// simultane nu pot ambele reuși.
//
// Body: { comanda_id }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { comanda_id } = req.body || {};
  if (!comanda_id) return res.status(400).json({ error: 'comanda_id este obligatoriu' });

  // 1. Încearcă să câștige alocarea FIFO — condiție atomică pe status
  const { data: allocated, error: allocErr } = await supabaseAdmin
    .from('alocari_fifo')
    .update({ raspuns: 'acceptat', raspuns_at: new Date().toISOString() })
    .eq('comanda_id', comanda_id)
    .eq('partener_id', user.id)
    .eq('raspuns', 'in_asteptare')
    .select();

  if (allocErr) {
    console.error('[accept-comanda]', allocErr);
    return res.status(500).json({ error: 'Eroare la procesarea acceptării' });
  }

  if (!allocated || allocated.length === 0) {
    // Fie comanda a fost deja preluată de altcineva, fie nu a fost niciodată
    // notificată acestui partener — în ambele cazuri respingem.
    return res.status(409).json({ error: 'Comanda a fost deja preluată de alt partener sau nu îți este alocată' });
  }

  // 2. Blochează comanda pe acest partener + marchează restul alocărilor ca expirate
  const { error: updComandaErr } = await supabaseAdmin
    .from('comenzi')
    .update({ status: 'acceptata', partener_id: user.id, updated_at: new Date().toISOString() })
    .eq('id', comanda_id)
    .eq('status', 'in_cautare_partener'); // dublă protecție la concurență

  if (updComandaErr) {
    console.error('[accept-comanda] update comanda', updComandaErr);
    return res.status(500).json({ error: 'Comanda a fost preluată dar nu am putut actualiza statusul' });
  }

  await supabaseAdmin
    .from('alocari_fifo')
    .update({ raspuns: 'expirat' })
    .eq('comanda_id', comanda_id)
    .neq('partener_id', user.id)
    .eq('raspuns', 'in_asteptare');

  return res.status(200).json({ ok: true, comanda_id, status: 'acceptata' });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);
