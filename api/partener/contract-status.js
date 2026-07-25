// /api/partener/contract-status.js
// G9 — starea celor 3 condiții ale hard-stop-ului, pentru UI (dashboard
// partener / viitoarea aplicație mobilă): ce anume lipsește, nu doar
// un refuz generic.
// GET → { ok, status_verificare, are_cont_bancar, contract_semnat,
//          contract_semnat_la, poate_prelua_comenzi }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];

async function handler(req, res, user) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data: partner } = await supabaseAdmin
    .from('partners')
    .select('status_verificare, contract_semnat, contract_semnat_la')
    .eq('id', user.id)
    .maybeSingle();
  if (!partner) return res.status(404).json({ error: 'Cont de partener inexistent.' });

  const { data: cont } = await supabaseAdmin
    .from('partner_conturi_bancare')
    .select('id')
    .eq('partner_id', user.id)
    .eq('activ', true)
    .maybeSingle();

  const areContBancar = !!cont;
  const aprobat = partner.status_verificare === 'approved';
  const contractSemnat = !!partner.contract_semnat;

  return res.status(200).json({
    ok: true,
    status_verificare: partner.status_verificare,
    are_cont_bancar: areContBancar,
    contract_semnat: contractSemnat,
    contract_semnat_la: partner.contract_semnat_la,
    poate_prelua_comenzi: aprobat && areContBancar && contractSemnat,
  });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);
