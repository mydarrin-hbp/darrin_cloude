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
const { valideazaDiscountNou, valideazaDiscountPct, raspunsEroareDiscount } = require('../../lib/discount-partener');

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    let query = supabaseAdmin
      .from('parteneri_discounturi')
      .select('*')
      .order('created_at', { ascending: false });
    if (req.query?.partener_id) query = query.eq('partener_id', req.query.partener_id);
    if (req.query?.doar_neaprobate) query = query.is('aprobat_de', null).eq('activ', true);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, discounturi: data || [] });
  }

  if (req.method === 'POST') {
    const { partener_id } = req.body || {};
    if (!partener_id) return res.status(400).json({ error: 'partener_id este obligatoriu' });
    const validare = await valideazaDiscountNou(req.body);
    if (validare.eroare) return res.status(400).json({ error: validare.eroare });

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
    if (!id) return res.status(400).json({ error: 'id este obligatoriu' });
    let modificare;
    let actiune;
    if (aproba === true) {
      // Limitele se pot schimba între propunere și aprobare.
      const { data: existent } = await supabaseAdmin
        .from('parteneri_discounturi')
        .select('discount_pct')
        .eq('id', id)
        .maybeSingle();
      if (!existent) return res.status(404).json({ error: 'Discountul nu există' });
      const eroarePct = await valideazaDiscountPct(existent.discount_pct);
      if (eroarePct) return res.status(400).json({ error: eroarePct });
      modificare = { aprobat_de: admin.id };
      actiune = 'aprobare_discount_partener';
    } else if (activ === false) {
      modificare = { activ: false };
      actiune = 'dezactivare_discount_partener';
    } else {
      return res.status(400).json({ error: 'Trimite aproba: true sau activ: false' });
    }

    const { data, error } = await supabaseAdmin
      .from('parteneri_discounturi')
      .update(modificare)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) return raspunsEroareDiscount(res, error, 'admin/discounturi-parteneri');
    if (!data) return res.status(404).json({ error: 'Discountul nu există' });
    await inregistreazaAudit({
      admin, req, actiune, entitate: 'parteneri_discounturi', entitate_id: id,
      detalii: {
        partener_id: data.partener_id, tip_partener: data.tip_partener, categorie: data.categorie,
        discount_pct: data.discount_pct, modificare,
      },
    });
    return res.status(200).json({ ok: true, discount: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
