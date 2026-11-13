// /api/admin/discounturi-parteneri.js
// Back-office pentru discounturile partenerilor (decizie LM, 7 octombrie
// 2026). Adminul poate seta discountul la crearea contului partenerului
// (aprobat direct) și aprobă discounturile propuse de partener din
// dashboard (api/partener/discounturi.js).
//
// GET    ?partener_id=&doar_neaprobate=1 → lista
// POST   { partener_id, tip_partener, categorie, discount_pct, valabil_de?, valabil_pana? } → adaugă, aprobat
// PATCH  { id, aproba: true } | { id, activ: false } → aprobă / dezactivează
//
// Fiecare setare, aprobare și dezactivare se înregistrează în audit_log
// (inregistreazaAudit), ca în api/admin/email-gateway.js.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { valideazaDiscountNou, valideazaDiscountPctBilingv, raspunsEroareDiscount } = require('../../lib/discount-partener');
const { esteFurnizorPropriu, EROARE_DISCOUNT_FURNIZOR_PROPRIU, EROARE_DISCOUNT_FURNIZOR_PROPRIU_EN } = require('../../lib/furnizor-propriu');
const { trimiteEroare, trimiteEroareInterna } = require('../../lib/raspuns-eroare');

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    let query = supabaseAdmin
      .from('parteneri_discounturi')
      .select('*')
      .order('created_at', { ascending: false });
    if (req.query?.partener_id) query = query.eq('partener_id', req.query.partener_id);
    if (req.query?.doar_neaprobate) query = query.is('aprobat_de', null).eq('activ', true);
    const { data, error } = await query;
    if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
    return res.status(200).json({ ok: true, discounturi: data || [] });
  }

  if (req.method === 'POST') {
    const { partener_id } = req.body || {};
    if (!partener_id) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'partener_id este obligatoriu', 'partener_id is required.', ['partener_id']);
    if (await esteFurnizorPropriu(partener_id)) return trimiteEroare(res, 400, 'FURNIZOR_PROPRIU', EROARE_DISCOUNT_FURNIZOR_PROPRIU, EROARE_DISCOUNT_FURNIZOR_PROPRIU_EN);
    const validare = await valideazaDiscountNou(req.body);
    if (validare.eroare) return trimiteEroare(res, 400, 'DATE_INVALIDE', validare.eroare, validare.eroare_en, [validare.camp]);

    const { data, error } = await supabaseAdmin
      .from('parteneri_discounturi')
      .insert({ ...validare.rand, partener_id, creat_de: admin.id, aprobat_de: admin.id })
      .select()
      .single();
    if (error) return raspunsEroareDiscount(res, error, 'admin/discounturi-parteneri');
    await inregistreazaAudit({
      admin, req, actiune: 'creare_discount_partener', entitate: 'parteneri_discounturi', entitate_id: data.id,
      detalii: {
        partener_id, tip_partener: data.tip_partener, categorie: data.categorie, discount_pct: data.discount_pct,
        valabil_de: data.valabil_de, valabil_pana: data.valabil_pana,
      },
    });
    return res.status(200).json({ ok: true, discount: data });
  }

  if (req.method === 'PATCH') {
    const { id, aproba, activ } = req.body || {};
    if (!id) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'id este obligatoriu', 'id is required.', ['id']);
    let modificare;
    let actiune;
    if (aproba === true) {
      // Limitele se pot schimba între propunere și aprobare.
      const { data: existent } = await supabaseAdmin
        .from('parteneri_discounturi')
        .select('discount_pct')
        .eq('id', id)
        .maybeSingle();
      if (!existent) return trimiteEroare(res, 404, 'DISCOUNT_NU_EXISTA', 'Discountul nu există', 'The discount does not exist.');
      const eroarePct = await valideazaDiscountPctBilingv(existent.discount_pct);
      if (eroarePct) return trimiteEroare(res, 400, 'DATE_INVALIDE', eroarePct.ro, eroarePct.en, ['discount_pct']);
      modificare = { aprobat_de: admin.id };
      actiune = 'aprobare_discount_partener';
    } else if (activ === false) {
      modificare = { activ: false };
      actiune = 'dezactivare_discount_partener';
    } else {
      return trimiteEroare(res, 400, 'DATE_INVALIDE', 'Trimite aproba: true sau activ: false', 'Send aproba: true or activ: false.');
    }

    const { data, error } = await supabaseAdmin
      .from('parteneri_discounturi')
      .update(modificare)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) return raspunsEroareDiscount(res, error, 'admin/discounturi-parteneri');
    if (!data) return trimiteEroare(res, 404, 'DISCOUNT_NU_EXISTA', 'Discountul nu există', 'The discount does not exist.');
    await inregistreazaAudit({
      admin, req, actiune, entitate: 'parteneri_discounturi', entitate_id: id,
      detalii: {
        partener_id: data.partener_id, tip_partener: data.tip_partener, categorie: data.categorie,
        discount_pct: data.discount_pct, modificare,
      },
    });
    return res.status(200).json({ ok: true, discount: data });
  }

  return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
