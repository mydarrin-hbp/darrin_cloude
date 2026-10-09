// /api/partener/competente.js
// Competențele partenerului de servicii (Etapa 1, reguli flexibile, 9 oct.
// 2026): codurile ESCO pentru care primește comenzi (lib/competente-
// parteneri.js filtrează alocarea pe ele). Selectorul din dashboard vine în
// Etapa 3; endpoint-ul e gata.
//
// GET  → { ok, domenii: [{ domeniu, categorii: [{ categorie, servicii: [{ id, titlu, cod_esco, bifat }] }] }],
//          bifate: ['7411.1', ...] }
// POST { cod_esco, bifat: true|false } → bifează / debifează un cod ESCO

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const ROLURI = ['partener_servicii'];

async function serviciiLive() {
  const { data: servicii, error } = await supabaseAdmin
    .from('catalog_servicii')
    .select('id, titlu, domeniu, categorie_id, subcategorie_id, cod_esco')
    .eq('status_public', true)
    .eq('categorie', 'servicii')
    .not('cod_esco', 'is', null)
    .order('titlu');
  if (error) throw error;
  const idCat = [...new Set((servicii || []).flatMap((s) => [s.categorie_id, s.subcategorie_id]).filter(Boolean))];
  let categorii = [];
  if (idCat.length) {
    const { data } = await supabaseAdmin.from('categorii').select('id, title').in('id', idCat);
    categorii = data || [];
  }
  const numeCat = new Map(categorii.map((c) => [c.id, c.title]));
  return (servicii || []).map((s) => ({ ...s, categorie: numeCat.get(s.subcategorie_id) || numeCat.get(s.categorie_id) || 'Fără categorie' }));
}

async function handler(req, res, user) {
  if (req.method === 'GET') {
    try {
      const [servicii, { data: rows, error }] = await Promise.all([
        serviciiLive(),
        supabaseAdmin.from('partener_competente').select('cod_esco').eq('partener_id', user.id),
      ]);
      if (error) throw error;
      const bifate = [...new Set((rows || []).map((r) => r.cod_esco))];
      const domenii = new Map();
      for (const s of servicii) {
        const dom = s.domeniu || 'Alte servicii';
        if (!domenii.has(dom)) domenii.set(dom, new Map());
        const cats = domenii.get(dom);
        if (!cats.has(s.categorie)) cats.set(s.categorie, []);
        cats.get(s.categorie).push({ id: s.id, titlu: s.titlu, cod_esco: s.cod_esco, bifat: bifate.includes(s.cod_esco) });
      }
      return res.status(200).json({
        ok: true,
        bifate,
        domenii: [...domenii].map(([domeniu, cats]) => ({ domeniu, categorii: [...cats].map(([categorie, lista]) => ({ categorie, servicii: lista })) })),
      });
    } catch (e) {
      console.error('[partener/competente] GET', e);
      return res.status(500).json({ error: 'Nu am putut încărca lista de competențe.' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cod_esco, bifat } = req.body || {};
  if (!cod_esco || typeof cod_esco !== 'string' || typeof bifat !== 'boolean') {
    return res.status(400).json({ error: 'Trimite cod_esco (text) și bifat (true/false).' });
  }
  try {
    const servicii = await serviciiLive();
    if (!servicii.some((s) => s.cod_esco === cod_esco)) {
      return res.status(400).json({ error: 'Codul ESCO nu corespunde niciunui serviciu activ din catalog.' });
    }
    if (bifat) {
      const { data: exista } = await supabaseAdmin
        .from('partener_competente').select('cod_esco').eq('partener_id', user.id).eq('cod_esco', cod_esco).maybeSingle();
      if (!exista) {
        const { error } = await supabaseAdmin.from('partener_competente').insert({ partener_id: user.id, cod_esco, bifat_la: new Date().toISOString() });
        if (error) throw error;
      }
    } else {
      const { error } = await supabaseAdmin.from('partener_competente').delete().eq('partener_id', user.id).eq('cod_esco', cod_esco);
      if (error) throw error;
    }
    return res.status(200).json({ ok: true, cod_esco, bifat });
  } catch (e) {
    console.error('[partener/competente] POST', e);
    return res.status(500).json({ error: 'Nu am putut salva competența. Încearcă din nou.' });
  }
}

module.exports = requireAuth(ROLURI, handler);
