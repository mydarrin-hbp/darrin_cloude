// /api/partener/discounturi.js
// Discountul negociat de partener cu Home Best Pal (decizie LM, 7 octombrie
// 2026), setat din dashboard-ul partenerului. Discountul ia locul reținerii
// fixe din escrow (lib/elibereaza-escrow.js) doar după aprobarea din
// back-office (api/admin/discounturi-parteneri.js) — un discount salvat de
// partener pleacă mereu cu aprobat_de = null.
//
// Un discount nu se editează: pentru alt procent, partenerul dezactivează
// discountul curent și adaugă unul nou (istoricul rămâne, iar facturile
// emise își păstrează discountul salvat la emitere).
//
// GET    → discounturile partenerului + limitele din panou; pentru furnizorul
//          propriu și curieri: { discounturi: [], fara_discount }, fără limite
// POST   { tip_partener, categorie, discount_pct, valabil_de?, valabil_pana? } → adaugă
// DELETE { id } → dezactivează

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const {
  PARTNER_TYPE_LA_TIP_DISCOUNT,
  TIPURI_FARA_DISCOUNT,
  EROARE_CURIER_FARA_DISCOUNT,
  EROARE_CURIER_FARA_DISCOUNT_EN,
  limiteDiscountPartener,
  valideazaDiscountNou,
  raspunsEroareDiscount,
} = require('../../lib/discount-partener');
const { esteFurnizorPropriu, EROARE_DISCOUNT_FURNIZOR_PROPRIU, EROARE_DISCOUNT_FURNIZOR_PROPRIU_EN } = require('../../lib/furnizor-propriu');
const v = require('../../lib/valideaza');
const { trimiteEroare, trimiteEroareInterna } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {};

const ROLURI = ['partener_materiale', 'partener_inchirieri', 'partener_asigurari', 'partener_curier'];

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const [{ data, error }, limite, { data: partener }, propriu] = await Promise.all([
      supabaseAdmin
        .from('parteneri_discounturi')
        .select('id, tip_partener, categorie, discount_pct, valabil_de, valabil_pana, activ, aprobat_de, created_at')
        .eq('partener_id', user.id)
        .order('created_at', { ascending: false }),
      limiteDiscountPartener(),
      supabaseAdmin.from('partners').select('partner_type').eq('id', user.id).maybeSingle(),
      esteFurnizorPropriu(user.id),
    ]);
    if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
    // Pasul 11-H1 (decizia 26): furnizorul propriu și curierii nu acordă
    // discount — fără limitele din panou, ca dashboard-ul să nu afișeze
    // „Discount comercial 5–15%” unde nu se aplică.
    const faraDiscount = propriu ? 'furnizor_propriu'
      : (TIPURI_FARA_DISCOUNT.includes(partener?.partner_type) ? 'curier' : null);
    if (faraDiscount) return res.status(200).json({ ok: true, discounturi: [], fara_discount: faraDiscount });
    const discounturi = (data || []).map(({ aprobat_de, ...d }) => ({ ...d, aprobat: aprobat_de != null }));
    return res.status(200).json({ ok: true, discounturi, limite });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'id este obligatoriu', 'id is required.', ['id']);
    const { data, error } = await supabaseAdmin
      .from('parteneri_discounturi')
      .update({ activ: false })
      .eq('id', id)
      .eq('partener_id', user.id)
      .select('id')
      .maybeSingle();
    if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
    if (!data) return trimiteEroare(res, 404, 'DISCOUNT_NU_EXISTA', 'Discountul nu există sau nu-ți aparține', 'The discount does not exist or does not belong to you.');
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const { data: partener } = await supabaseAdmin
    .from('partners')
    .select('partner_type')
    .eq('id', user.id)
    .maybeSingle();
  // Curierii nu acordă discount, indiferent de tip_partener trimis.
  if (TIPURI_FARA_DISCOUNT.includes(partener?.partner_type)) {
    return trimiteEroare(res, 400, 'CURIER_FARA_DISCOUNT', EROARE_CURIER_FARA_DISCOUNT, EROARE_CURIER_FARA_DISCOUNT_EN);
  }
  // Furnizorul propriu al platformei nu acordă discount (16 oct. 2026).
  if (await esteFurnizorPropriu(user.id)) {
    return trimiteEroare(res, 400, 'FURNIZOR_PROPRIU', EROARE_DISCOUNT_FURNIZOR_PROPRIU, EROARE_DISCOUNT_FURNIZOR_PROPRIU_EN);
  }

  if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora' })) return;
  const validare = await valideazaDiscountNou(req.body);
  if (validare.eroare) return trimiteEroare(res, 400, 'DATE_INVALIDE', validare.eroare, validare.eroare_en, [validare.camp]);

  // Partenerul poate seta discount doar pe tipul lui de activitate.
  if (PARTNER_TYPE_LA_TIP_DISCOUNT[partener?.partner_type] !== validare.rand.tip_partener) {
    return trimiteEroare(res, 403, 'FARA_DREPT', 'Poți seta discount doar pe tipul tău de partener', 'You can only set a discount for your own partner type.');
  }

  const { data, error } = await supabaseAdmin
    .from('parteneri_discounturi')
    .insert({ ...validare.rand, partener_id: user.id, creat_de: user.id, aprobat_de: null })
    .select('id, tip_partener, categorie, discount_pct, valabil_de, valabil_pana, activ')
    .single();
  if (error) return raspunsEroareDiscount(res, error, 'partener/discounturi');
  return res.status(200).json({ ok: true, discount: { ...data, aprobat: false } });
}

module.exports = requireAuth(ROLURI, handler);
