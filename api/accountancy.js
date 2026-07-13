// /api/accountancy.js
// Endpoint unic pentru modulul Accountancy — acțiuni multiple prin `action`,
// protejat: doar superadmin, sau admin cu permisiunea 'accountancy'
// (opțional restrânsă la o singură țară prin admin_permissions.tara_cod).

const { supabaseAdmin } = require('../lib/supabaseAdmin');
const { getAuthenticatedUser } = require('../lib/auth-middleware');
const { inregistreazaAudit } = require('../lib/audit-log');

async function checkAccountancyAccess(user, tara_cod) {
  // Coloana din profiles e `roles` (array) — vezi schema.sql (corectat 2026-07-11).
  const { data: profile } = await supabaseAdmin.from('profiles').select('roles').eq('id', user.id).single();
  if (Array.isArray(profile?.roles) && profile.roles.includes('superadmin')) return true;
  if (user.user_metadata?.role === 'superadmin') return true;
  if (Array.isArray(user.user_metadata?.roles) && user.user_metadata.roles.includes('superadmin')) return true;

  const { data } = await supabaseAdmin
    .from('admin_permissions')
    .select('poate_scrie, tara_cod')
    .eq('admin_id', user.id)
    .eq('sectiune', 'accountancy');

  if (!data || !data.length) return false;
  return data.some(p => p.poate_scrie && (p.tara_cod === null || p.tara_cod === tara_cod));
}

async function actionConfirmIncasare(req, res, user) {
  const { invoice_id } = req.body;
  const { data: inv, error } = await supabaseAdmin.from('invoices').select('*').eq('id', invoice_id).single();
  if (error || !inv) return res.status(404).json({ error: 'Factura nu există' });

  await supabaseAdmin.from('invoices').update({ incasare_confirmata: true }).eq('id', invoice_id);
  await inregistreazaAudit({ admin: user, req, actiune: 'confirmare_incasare', entitate: 'invoices', entitate_id: invoice_id });
  return maybeConvert(res, invoice_id);
}

async function actionConfirmLivrare(req, res, user) {
  const { invoice_id } = req.body;
  const { data: inv, error } = await supabaseAdmin.from('invoices').select('*').eq('id', invoice_id).single();
  if (error || !inv) return res.status(404).json({ error: 'Factura nu există' });

  await supabaseAdmin.from('invoices').update({ livrare_confirmata: true }).eq('id', invoice_id);
  await inregistreazaAudit({ admin: user, req, actiune: 'confirmare_livrare', entitate: 'invoices', entitate_id: invoice_id });
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

async function actionUpdateTaxConfig(req, res, user) {
  const { tara_cod, cota_tva, cota_impozit_venit, cota_impozit_salarii } = req.body;
  const { data, error } = await supabaseAdmin
    .from('tax_configurations')
    .update({ cota_tva, cota_impozit_venit, cota_impozit_salarii, updated_at: new Date().toISOString() })
    .eq('tara_cod', tara_cod)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Eroare la actualizare' });
  await inregistreazaAudit({
    admin: user, req, actiune: 'actualizare_cote_fiscale', entitate: 'tax_configurations', entitate_id: tara_cod,
    detalii: { cota_tva, cota_impozit_venit, cota_impozit_salarii },
  });
  return res.status(200).json({ ok: true, config: data });
}

async function actionAddBankAccount(req, res, user) {
  const { nume_afisat, banca, iban, swift, moneda, tara_cod, tip } = req.body;
  if (!nume_afisat || !iban || !moneda) return res.status(400).json({ error: 'Câmpuri obligatorii lipsă' });
  const { data, error } = await supabaseAdmin
    .from('bank_accounts')
    .insert({ nume_afisat, banca, iban, swift, moneda, tara_cod, tip: tip || 'incasari' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  await inregistreazaAudit({
    admin: user, req, actiune: 'adaugare_cont_bancar', entitate: 'bank_accounts', entitate_id: data.id,
    detalii: { nume_afisat, banca, moneda, tara_cod },
  });
  return res.status(200).json({ ok: true, account: data });
}

// FIX (Etapa 2, audit 2026-07-12): agregarea se făcea în JS, aducând TOATE
// rândurile din financial_records în memorie — corect azi (tabelul e gol),
// dar nesustenabil pe măsură ce contabilitatea reală crește. Mutată în SQL
// (SUM/COUNT), via funcția accountancy_totals (migrație
// accountancy_sql_aggregation_functions) — care aplică și cota de impozit pe
// venit din tax_configurations, absentă complet înainte (nimic din cod nu
// calcula vreodată impozitul, doar TVA).
async function actionGetSummary(req, res) {
  const tara_cod = req.query.tara_cod || null;
  const { data, error } = await supabaseAdmin.rpc('accountancy_totals', { p_tara_cod: tara_cod });
  if (error) return res.status(500).json({ error: error.message });
  const r = (data && data[0]) || {};
  const summary = {
    venituri: Number(r.venituri || 0),
    cheltuieli: Number(r.cheltuieli || 0),
    salarii: Number(r.salarii || 0),
    tva_incasat: Number(r.tva_incasat || 0),
    tva_dedus: Number(r.tva_dedus || 0),
    tva_de_plata: Number(r.tva_de_plata || 0),
    profit_net: Number(r.profit_net || 0),
    cota_impozit_venit: Number(r.cota_impozit_venit || 0),
    impozit_venit: Number(r.impozit_venit || 0),
  };
  return res.status(200).json({ ok: true, summary });
}

// Axa geografică (Etapa 2): Global -> Țară -> Regiune -> Localitate.
// Nivelul de drill e determinat de câți parametri sunt trimiși: fără
// tara_cod -> grupare pe țară; cu tara_cod, fără regiune -> grupare pe
// regiune; cu ambele -> grupare pe localitate.
async function actionGeoBreakdown(req, res) {
  const tara_cod = req.query.tara_cod || null;
  const regiune = req.query.regiune || null;
  const { data, error } = await supabaseAdmin.rpc('accountancy_geo_breakdown', { p_tara_cod: tara_cod, p_regiune: regiune });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, breakdown: data || [] });
}

// Axa operațională (Etapa 2): segmentare pe vertical — Servicii, Materiale,
// Închirieri, Curieri, Asigurări (partners.partner_type), opțional filtrată
// pe o singură țară.
async function actionVerticalBreakdown(req, res) {
  const tara_cod = req.query.tara_cod || null;
  const { data, error } = await supabaseAdmin.rpc('accountancy_vertical_breakdown', { p_tara_cod: tara_cod });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, breakdown: data || [] });
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
    if (action === 'geo_breakdown') return actionGeoBreakdown(req, res);
    if (action === 'vertical_breakdown') return actionVerticalBreakdown(req, res);
    return res.status(400).json({ error: 'Acțiune GET necunoscută' });
  }

  const action = req.body?.action;
  if (action === 'confirm_incasare') return actionConfirmIncasare(req, res, user);
  if (action === 'confirm_livrare') return actionConfirmLivrare(req, res, user);
  if (action === 'update_tax_config') return actionUpdateTaxConfig(req, res, user);
  if (action === 'add_bank_account') return actionAddBankAccount(req, res, user);

  return res.status(400).json({ error: 'Acțiune necunoscută' });
};
