// /api/accountancy.js
// Endpoint unic pentru modulul Accountancy — acțiuni multiple prin `action`,
// protejat: doar superadmin, sau admin cu permisiunea 'accountancy'
// (opțional restrânsă la o singură țară prin admin_permissions.tara_cod).

const { supabaseAdmin } = require('../lib/supabaseAdmin');
const { getAuthenticatedUser } = require('../lib/auth-middleware');

async function checkAccountancyAccess(user, tara_cod) {
  const role = user.user_metadata?.role;
  if (role === 'superadmin') return true;

  const { data } = await supabaseAdmin
    .from('admin_permissions')
    .select('poate_scrie, tara_cod')
    .eq('admin_id', user.id)
    .eq('sectiune', 'accountancy');

  if (!data || !data.length) return false;
  return data.some(p => p.poate_scrie && (p.tara_cod === null || p.tara_cod === tara_cod));
}

// ── Convertește o proformă în factură fiscală DOAR dacă ambele confirmări sunt true ──
async function actionConfirmIncasare(req, res, user) {
  const { invoice_id } = req.body;
  const { data: inv, error } = await supabaseAdmin.from('invoices').select('*').eq('id', invoice_id).single();
  if (error || !inv) return res.status(404).json({ error: 'Factura nu există' });

  await supabaseAdmin.from('invoices').update({ incasare_confirmata: true }).eq('id', invoice_id);
  return maybeConvert(res, invoice_id);
}

async function actionConfirmLivrare(req, res, user) {
  const { invoice_id } = req.body;
  const { data: inv, error } = await supabaseAdmin.from('invoices').select('*').eq('id', invoice_id).single();
  if (error || !inv) return res.status(404).json({ error: 'Factura nu există' });

  await supabaseAdmin.from('invoices').update({ livrare_confirmata: true }).eq('id', invoice_id);
  return maybeConvert(res, invoice_id);
}

async function maybeConvert(res, invoice_id) {
  const { data: inv } = await supabaseAdmin.from('invoices').select('*').eq('id', invoice_id).single();

  if (inv.incasare_confirmata && inv.livrare_confirmata && inv.tip === 'proforma') {
    const year = new Date().getFullYear();
    const { count } = await supabaseAdmin
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('tip', 'fiscala')
      .gte('convertita_la', `${year}-01-01`);

    const numar_document = `FV-${year}-${String((count || 0) + 1).padStart(6, '0')}`;

    const { data: updated, error } = await supabaseAdmin
      .from('invoices')
      .update({ tip: 'fiscala', status: 'convertita', numar_document, convertita_la: new Date().toISOString() })
      .eq('id', invoice_id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: 'Eroare la conversia facturii' });

    // Înregistrare automată în financial_records
    await supabaseAdmin.from('financial_records').insert({
      tip: 'venit',
      suma: updated.suma_totala,
      moneda: updated.moneda,
      tva_aferent: updated.tva,
      document_ref: numar_document,
      status: 'validat',
    });

    return res.status(200).json({ ok: true, converted: true, invoice: updated });
  }

  return res.status(200).json({ ok: true, converted: false, invoice: inv });
}

async function actionUpdateTaxConfig(req, res) {
  const { tara_cod, cota_tva, cota_impozit_venit, cota_impozit_salarii } = req.body;
  const { data, error } = await supabaseAdmin
    .from('tax_configurations')
    .update({ cota_tva, cota_impozit_venit, cota_impozit_salarii, updated_at: new Date().toISOString() })
    .eq('tara_cod', tara_cod)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Eroare la actualizare' });
  return res.status(200).json({ ok: true, config: data });
}

async function actionAddBankAccount(req, res) {
  const { nume_afisat, banca, iban, swift, moneda, tara_cod, tip } = req.body;
  if (!nume_afisat || !iban || !moneda) return res.status(400).json({ error: 'Câmpuri obligatorii lipsă' });
  const { data, error } = await supabaseAdmin
    .from('bank_accounts')
    .insert({ nume_afisat, banca, iban, swift, moneda, tara_cod, tip: tip || 'incasari' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, account: data });
}

async function actionGetSummary(req, res) {
  const { tara_cod } = req.query;
  let query = supabaseAdmin.from('financial_records').select('tip, suma, moneda, tva_aferent');
  if (tara_cod) query = query.eq('tara_cod', tara_cod);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const summary = { venituri: 0, cheltuieli: 0, tva_incasat: 0, tva_dedus: 0, salarii: 0 };
  (data || []).forEach(r => {
    if (r.tip === 'venit') summary.venituri += Number(r.suma);
    if (r.tip === 'cheltuiala') summary.cheltuieli += Number(r.suma);
    if (r.tip === 'salariu') summary.salarii += Number(r.suma);
    if (r.tip === 'tva_incasat') summary.tva_incasat += Number(r.suma);
    if (r.tip === 'tva_dedus') summary.tva_dedus += Number(r.suma);
  });
  summary.tva_de_plata = summary.tva_incasat - summary.tva_dedus;
  summary.profit_net = summary.venituri - summary.cheltuieli - summary.salarii;

  return res.status(200).json({ ok: true, summary });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Neautentificat' });

  const tara_cod = req.body?.tara_cod || req.query?.tara_cod || null;
  const hasAccess = await checkAccountancyAccess(user, tara_cod);
  if (!hasAccess) return res.status(403).json({ error: 'Nu ai acces la modulul Accountancy' });

  if (req.method === 'GET') {
    const action = req.query.action;
    if (action === 'summary') return actionGetSummary(req, res);
    return res.status(400).json({ error: 'Acțiune GET necunoscută' });
  }

  const action = req.body?.action;
  if (action === 'confirm_incasare') return actionConfirmIncasare(req, res, user);
  if (action === 'confirm_livrare') return actionConfirmLivrare(req, res, user);
  if (action === 'update_tax_config') return actionUpdateTaxConfig(req, res);
  if (action === 'add_bank_account') return actionAddBankAccount(req, res);

  return res.status(400).json({ error: 'Acțiune necunoscută' });
};
