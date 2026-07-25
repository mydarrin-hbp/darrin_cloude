// /api/partener/portofoliu.js
// G10 (25 Iulie 2026) — motorul de "bifare" a portofoliului de servicii/
// materiale/închirieri, cerut în documentul de onboarding și confirmat
// absent în audit: tabela reală folosită de alocarea automată
// (lib/aloca-partener.js: partener_servicii_active) exista, dar nu avea
// niciun mecanism de populare — un singur rând, inserat manual.
//
// Catalogul e cel administrabil din backoffice (G17, api/admin/catalog.js)
// — aceleași rânduri din catalog_servicii, filtrate pe categoria
// corespunzătoare tipului de partener. Bifarea scrie direct în
// partener_servicii_active, tabela EXACTĂ citită de motorul de alocare.
//
// GET  → { ok, categorie, servicii:[{ id, titlu, domeniu, bifat }] }
// POST { action:'toggle', catalog_serviciu_id, activ } → { ok }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];

// partners.partner_type (enum) → catalog_servicii.categorie
const TIP_LA_CATEGORIE = {
  servicii_tehnice: 'servicii',
  furnizor_materiale: 'materiale',
  inchirieri_utilaje: 'inchirieri',
};

async function actionList(req, res, user) {
  const { data: partner } = await supabaseAdmin
    .from('partners')
    .select('partner_type')
    .eq('id', user.id)
    .maybeSingle();
  if (!partner) return res.status(404).json({ error: 'Cont de partener inexistent.' });

  const categorie = TIP_LA_CATEGORIE[partner.partner_type];
  if (!categorie) {
    // Curier/asigurări nu au un catalog de bifat în acest fel — alocarea
    // lor e pe rol/zonă, nu pe listă de servicii (vezi documentul, secțiunea
    // de matching engine se referă explicit la servicii/materiale/închirieri).
    return res.status(200).json({ ok: true, categorie: null, servicii: [] });
  }

  const { data: catalog, error } = await supabaseAdmin
    .from('catalog_servicii')
    .select('id, id_serviciu, titlu, domeniu, nace, cod_esco')
    .eq('categorie', categorie)
    .eq('status_public', true)
    .order('domeniu', { ascending: true })
    .order('titlu', { ascending: true });
  if (error) {
    console.error('[portofoliu] list catalog', error);
    return res.status(500).json({ error: 'Nu am putut încărca catalogul.' });
  }

  const { data: active } = await supabaseAdmin
    .from('partener_servicii_active')
    .select('catalog_serviciu_id, activ')
    .eq('partener_id', user.id);
  const activeSet = new Set((active || []).filter((a) => a.activ).map((a) => a.catalog_serviciu_id));

  const servicii = (catalog || []).map((s) => ({ ...s, bifat: activeSet.has(s.id) }));
  return res.status(200).json({ ok: true, categorie, servicii });
}

async function actionToggle(req, res, user) {
  const { catalog_serviciu_id, activ } = req.body || {};
  if (!catalog_serviciu_id || typeof activ !== 'boolean') {
    return res.status(400).json({ error: 'catalog_serviciu_id și activ (boolean) sunt obligatorii.' });
  }

  const { data: existent } = await supabaseAdmin
    .from('partener_servicii_active')
    .select('id')
    .eq('partener_id', user.id)
    .eq('catalog_serviciu_id', catalog_serviciu_id)
    .maybeSingle();

  if (existent) {
    const { error } = await supabaseAdmin
      .from('partener_servicii_active')
      .update({ activ })
      .eq('id', existent.id);
    if (error) { console.error('[portofoliu] update', error); return res.status(500).json({ error: 'Nu am putut actualiza.' }); }
  } else {
    const { error } = await supabaseAdmin
      .from('partener_servicii_active')
      .insert({ partener_id: user.id, catalog_serviciu_id, activ });
    if (error) { console.error('[portofoliu] insert', error); return res.status(500).json({ error: 'Nu am putut salva.' }); }
  }

  return res.status(200).json({ ok: true });
}

async function handler(req, res, user) {
  if (req.method === 'GET') return actionList(req, res, user);
  if (req.method === 'POST') {
    const { action } = req.body || {};
    if (action === 'toggle') return actionToggle(req, res, user);
    return res.status(400).json({ error: 'action invalidă.' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);
