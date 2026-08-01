// /api/admin/comenzi-b2g.js
// Administrare comenzi B2G (audit Secțiunea 43/44, 31 Iulie 2026).
//
// GET                                        → listă comenzi B2G (implicit: doar cele în așteptare de plată)
// POST { comanda_id, action:'seteaza_avans', procent_avans }  → admin dedicat stabilește procentul, de la caz la caz
// POST { comanda_id, action:'certifica_plata' }               → admin certifică plata reală (transfer/OP confirmat pe extras)
//   → status_plata devine 'confirmata' și SISTEMUL REIA AUTOMAT fluxul întrerupt:
//     declanșează alocarea către parteneri (exact ca la comanda B2C normală),
//     lucru care NU s-a întâmplat la creare pentru comenzile B2G.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { incearcaAlocarePartener } = require('../../lib/aloca-partener');

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    let query = supabaseAdmin.from('comenzi').select('*').eq('tip_client', 'b2g').order('creat_la', { ascending: false });
    if (req.query.status_plata) query = query.eq('status_plata', req.query.status_plata);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, comenzi: data });
  }

  if (req.method === 'POST') {
    const { comanda_id, action, procent_avans } = req.body || {};
    if (!comanda_id || !action) return res.status(400).json({ error: 'comanda_id și action sunt obligatorii' });

    const { data: comanda, error: selErr } = await supabaseAdmin
      .from('comenzi')
      .select('id, tip_client, status_plata, catalog_serviciu_id')
      .eq('id', comanda_id)
      .maybeSingle();
    if (selErr) return res.status(500).json({ error: selErr.message });
    if (!comanda) return res.status(404).json({ error: 'Comanda nu există' });
    if (comanda.tip_client !== 'b2g') return res.status(400).json({ error: 'Această acțiune se aplică doar comenzilor B2G' });

    if (action === 'seteaza_avans') {
      if (typeof procent_avans !== 'number' || procent_avans <= 0 || procent_avans > 100) {
        return res.status(400).json({ error: 'procent_avans trebuie să fie un număr între 0 și 100' });
      }
      const { data, error } = await supabaseAdmin
        .from('comenzi')
        .update({ procent_avans })
        .eq('id', comanda_id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      await inregistreazaAudit({ admin, req, actiune: 'setare_avans_b2g', entitate: 'comenzi', entitate_id: comanda_id, detalii: { procent_avans } });
      return res.status(200).json({ ok: true, comanda: data });
    }

    if (action === 'certifica_plata') {
      if (comanda.status_plata === 'confirmata') {
        return res.status(409).json({ error: 'Plata e deja certificată pentru această comandă' });
      }
      const { data: updated, error } = await supabaseAdmin
        .from('comenzi')
        .update({
          status_plata: 'confirmata',
          avans_confirmat: true,
          plata_certificata_de: admin.id,
          plata_certificata_la: new Date().toISOString(),
        })
        .eq('id', comanda_id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });

      await inregistreazaAudit({ admin, req, actiune: 'certificare_plata_b2g', entitate: 'comenzi', entitate_id: comanda_id });

      // Reluare flux întrerupt: alocarea către parteneri, amânată deliberat
      // la creare (api/comenzi/creeaza-b2g.js), pornește acum.
      const alocare = comanda.catalog_serviciu_id
        ? await incearcaAlocarePartener(comanda_id)
        : { alocat: false, motiv: 'fara_serviciu_specificat' };

      return res.status(200).json({ ok: true, comanda: updated, alocare });
    }

    return res.status(400).json({ error: `action necunoscută: ${action}` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
