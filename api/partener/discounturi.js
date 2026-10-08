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
// GET    → discounturile partenerului + limitele din panou
// POST   { tip_partener, categorie, discount_pct, valabil_de?, valabil_pana? } → adaugă
// DELETE { id } → dezactivează

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const {
  PARTNER_TYPE_LA_TIP_DISCOUNT,
  limiteDiscountPartener,
  valideazaDiscountNou,
  raspunsEroareDiscount,
} = require('../../lib/discount-partener');

const ROLURI = ['partener_materiale', 'partener_inchirieri', 'partener_asigurari', 'partener_curier'];

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const [{ data, error }, limite] = await Promise.all([
      supabaseAdmin
        .from('parteneri_discounturi')
        .select('id, tip_partener, categorie, discount_pct, valabil_de, valabil_pana, activ, aprobat_de, created_at')
        .eq('partener_id', user.id)
        .order('created_at', { ascending: false }),
      limiteDiscountPartener(),
    ]);
    if (error) return res.status(500).json({ error: error.message });
    const discounturi = (data || []).map(({ aprobat_de, ...d }) => ({ ...d, aprobat: aprobat_de != null }));
    return res.status(200).json({ ok: true, discounturi, limite });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id este obligatoriu' });
    const { data, error } = await supabaseAdmin
      .from('parteneri_discounturi')
      .update({ activ: false })
      .eq('id', id)
      .eq('partener_id', user.id)
      .select('id')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Discountul nu există sau nu-ți aparține' });
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const validare = await valideazaDiscountNou(req.body);
  if (validare.eroare) return res.status(400).json({ error: validare.eroare });

  // Partenerul poate seta discount doar pe tipul lui de activitate.
  const { data: partener } = await supabaseAdmin
    .from('partners')
    .select('partner_type')
    .eq('id', user.id)
    .maybeSingle();
  if (PARTNER_TYPE_LA_TIP_DISCOUNT[partener?.partner_type] !== validare.rand.tip_partener) {
    return res.status(403).json({ error: 'Poți seta discount doar pe tipul tău de partener' });
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
