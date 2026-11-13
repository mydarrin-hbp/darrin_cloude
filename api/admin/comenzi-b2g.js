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
const { formaComuna, trimiteEroare, trimiteEroareInterna } = require('../../lib/raspuns-eroare');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { incearcaAlocarePartener } = require('../../lib/aloca-partener');
const { notificaAdminFaraPartener } = require('../../lib/notificari-comanda');

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    let query = supabaseAdmin.from('comenzi').select('*').eq('tip_client', 'b2g').order('creat_la', { ascending: false });
    if (req.query.status_plata) query = query.eq('status_plata', req.query.status_plata);
    const { data, error } = await query;
    if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
    return res.status(200).json({ ok: true, comenzi: data });
  }

  if (req.method === 'POST') {
    const { comanda_id, action, procent_avans } = req.body || {};
    if (!comanda_id || !action) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'comanda_id și action sunt obligatorii', 'comanda_id and action are required.');

    const { data: comanda, error: selErr } = await supabaseAdmin
      .from('comenzi')
      .select('id, tip_client, status_plata, catalog_serviciu_id')
      .eq('id', comanda_id)
      .maybeSingle();
    if (selErr) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, selErr);
    if (!comanda) return trimiteEroare(res, 404, 'COMANDA_NU_EXISTA', 'Comanda nu există', 'The order does not exist.');
    if (comanda.tip_client !== 'b2g') return trimiteEroare(res, 400, 'NU_SE_APLICA', 'Această acțiune se aplică doar comenzilor B2G', 'This action only applies to B2G orders.');

    if (action === 'seteaza_avans') {
      if (typeof procent_avans !== 'number' || procent_avans <= 0 || procent_avans > 100) {
        return trimiteEroare(res, 400, 'DATE_INVALIDE', 'procent_avans trebuie să fie un număr între 0 și 100', 'procent_avans must be a number between 0 and 100.', ['procent_avans']);
      }
      const { data, error } = await supabaseAdmin
        .from('comenzi')
        .update({ procent_avans })
        .eq('id', comanda_id)
        .select()
        .single();
      if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
      await inregistreazaAudit({ admin, req, actiune: 'setare_avans_b2g', entitate: 'comenzi', entitate_id: comanda_id, detalii: { procent_avans } });
      return res.status(200).json({ ok: true, comanda: data });
    }

    if (action === 'certifica_plata') {
      if (comanda.status_plata === 'confirmata') {
        return trimiteEroare(res, 409, 'DEJA_CERTIFICATA', 'Plata e deja certificată pentru această comandă', 'The payment is already certified for this order.');
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
      if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);

      await inregistreazaAudit({ admin, req, actiune: 'certificare_plata_b2g', entitate: 'comenzi', entitate_id: comanda_id });

      // Reluare flux întrerupt: alocarea către parteneri, amânată deliberat
      // la creare (api/comenzi/creeaza-b2g.js), pornește acum.
      const alocare = comanda.catalog_serviciu_id
        ? await incearcaAlocarePartener(comanda_id)
        : { alocat: false, motiv: 'fara_serviciu_specificat' };
      // Etapa 0 SLA (9 oct. 2026): comanda rămasă fără partener → email admin.
      if (!alocare.alocat) await notificaAdminFaraPartener(updated, alocare.motiv);

      return res.status(200).json({ ok: true, comanda: updated, alocare });
    }

    return trimiteEroare(res, 400, 'ACTIUNE_NECUNOSCUTA', `action necunoscută: ${action}`, `Unknown action: ${action}`, ['action']);
  }

  return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
