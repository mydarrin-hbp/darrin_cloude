// /api/financiar/comision.js
// Se apelează la finalizarea unei comenzi: calculează comisionul platformei
// (12% implicit) și trece escrow-ul comenzii din "blocat" în "eliberat".
//
// IMPORTANT: acest endpoint NU procesează bani reali — calculează și
// înregistrează sumele. Transferul efectiv de fonduri necesită integrarea
// cu un procesator real (Stripe Connect / EuPlătesc / Netopia escrow API),
// care e un proiect separat de configurare cont comerciant, nu doar cod.
//
// Body: { comanda_id }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { comanda_id } = req.body || {};
  if (!comanda_id) return res.status(400).json({ error: 'comanda_id este obligatoriu' });

  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('*')
    .eq('id', comanda_id)
    .single();
  if (comErr || !comanda) return res.status(404).json({ error: 'Comanda nu există' });

  if (comanda.status !== 'finalizata') {
    return res.status(400).json({ error: 'Comisionul se calculează doar pentru comenzi finalizate' });
  }
  if (comanda.escrow_status !== 'blocat') {
    return res.status(400).json({ error: `Escrow în stare "${comanda.escrow_status}", nu poate fi eliberat` });
  }

  const { data: comisionRow, error: comisionErr } = await supabaseAdmin
    .from('comisioane')
    .insert({
      comanda_id: comanda.id,
      partener_id: comanda.partener_id,
      valoare_comanda: comanda.valoare_totala,
      procent_comision: 12.0,
    })
    .select()
    .single();
  if (comisionErr) {
    console.error('[financiar/comision]', comisionErr);
    return res.status(500).json({ error: 'Nu am putut înregistra comisionul' });
  }

  await supabaseAdmin.from('comenzi').update({ escrow_status: 'eliberat' }).eq('id', comanda.id);

  return res.status(200).json({
    ok: true,
    comision: comisionRow,
    suma_partener: comanda.valoare_totala - comisionRow.valoare_comision,
  });
}

// Doar admin/superadmin sau un job intern de sistem ar trebui să apeleze
// eliberarea de fonduri — niciodată clientul sau partenerul direct.
module.exports = requireAuth(['admin', 'superadmin'], handler);
