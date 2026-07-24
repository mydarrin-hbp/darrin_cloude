// /api/admin/catalog.js
// CRUD real pentru catalogul public de servicii/materiale/închirieri —
// scrie direct în aceleași tabele (catalog_servicii/catalog_niveluri/
// catalog_preturi) pe care mydarrin-catalog.html le citește public
// (categorie=eq.servicii|materiale|inchirieri & status_public=eq.true).
// Fără asta, orice serviciu/material/echipament nou ajungea în platformă
// doar printr-un INSERT SQL manual — niciun panou de admin nu-l putea crea.
//
// Ierarhie: catalog_servicii (1) → catalog_niveluri (N, ex. Bronz/Argint/
// Aur/Platinum) → catalog_preturi (N, per țară/regiune).
//
// Un singur endpoint, acțiuni prin `action` în body (POST) — același tipar
// ca api/accountancy.js. Doar admin/superadmin (fail-closed).

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { requireAuth } = require('../../lib/auth-middleware');
const { inregistreazaAudit } = require('../../lib/audit-log');

const CATEGORII_VALIDE = ['servicii', 'materiale', 'inchirieri'];

async function actionList(req, res) {
  const { categorie } = req.body || {};
  if (categorie && !CATEGORII_VALIDE.includes(categorie)) {
    return res.status(400).json({ error: `categorie invalidă. Trebuie: ${CATEGORII_VALIDE.join(', ')}` });
  }

  let q = supabaseAdmin
    .from('catalog_servicii')
    .select('id, id_serviciu, categorie, domeniu, titlu, icon, nace, cod_esco, cod_uniclass, unitate_masura, rating, status_public, sectoare_client, creat_la')
    .order('domeniu', { ascending: true })
    .order('titlu', { ascending: true });
  if (categorie) q = q.eq('categorie', categorie);

  const { data: servicii, error } = await q;
  if (error) return res.status(500).json({ error: 'Nu am putut încărca catalogul.' });
  if (!servicii.length) return res.status(200).json({ ok: true, servicii: [] });

  const idsServicii = servicii.map((s) => s.id);
  const { data: niveluri } = await supabaseAdmin
    .from('catalog_niveluri')
    .select('id, serviciu_id, nivel, nivel_complexitate, norma_timp, materiale_baza_estimat, label, descriere, garantie_luni')
    .in('serviciu_id', idsServicii)
    .order('nivel_complexitate', { ascending: true });

  const idsNiveluri = (niveluri || []).map((n) => n.id);
  const { data: preturi } = idsNiveluri.length
    ? await supabaseAdmin
        .from('catalog_preturi')
        .select('id, nivel_id, tara_cod, regiune, localitate, moneda, pret, pret_urgenta, pret_noapte, pret_sarbatori, comanda_minima, activ')
        .in('nivel_id', idsNiveluri)
    : { data: [] };

  const preturiPeNivel = {};
  (preturi || []).forEach((p) => {
    if (!preturiPeNivel[p.nivel_id]) preturiPeNivel[p.nivel_id] = [];
    preturiPeNivel[p.nivel_id].push(p);
  });
  const niveluriPeServiciu = {};
  (niveluri || []).forEach((n) => {
    n.preturi = preturiPeNivel[n.id] || [];
    if (!niveluriPeServiciu[n.serviciu_id]) niveluriPeServiciu[n.serviciu_id] = [];
    niveluriPeServiciu[n.serviciu_id].push(n);
  });
  servicii.forEach((s) => { s.niveluri = niveluriPeServiciu[s.id] || []; });

  return res.status(200).json({ ok: true, servicii });
}

async function actionCreeazaServiciu(req, res, user) {
  const { id_serviciu, categorie, domeniu, titlu, icon, nace, cod_esco, cod_uniclass, unitate_masura, sectoare_client } = req.body || {};
  if (!id_serviciu || !categorie || !domeniu || !titlu) {
    return res.status(400).json({ error: 'id_serviciu, categorie, domeniu și titlu sunt obligatorii.' });
  }
  if (!CATEGORII_VALIDE.includes(categorie)) {
    return res.status(400).json({ error: `categorie invalidă. Trebuie: ${CATEGORII_VALIDE.join(', ')}` });
  }

  const { data, error } = await supabaseAdmin
    .from('catalog_servicii')
    .insert({
      id_serviciu, categorie, domeniu, titlu,
      icon: icon || null, nace: nace || null, cod_esco: cod_esco || null, cod_uniclass: cod_uniclass || null,
      unitate_masura: unitate_masura || null,
      sectoare_client: Array.isArray(sectoare_client) ? sectoare_client : [],
      status_public: true, creat_de_tip: 'admin', creat_de: user.id,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: `id_serviciu "${id_serviciu}" există deja.` });
    console.error('[admin/catalog] creeaza_serviciu', error);
    return res.status(500).json({ error: 'Nu am putut crea serviciul.' });
  }

  await inregistreazaAudit({ admin: user, req, actiune: 'catalog_creeaza_serviciu', entitate: 'catalog_servicii', entitate_id: data.id, detalii: { id_serviciu, categorie, titlu } });
  return res.status(200).json({ ok: true, id: data.id });
}

async function actionActualizeazaServiciu(req, res, user) {
  const { id, ...campuri } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu.' });
  const permise = ['domeniu', 'titlu', 'icon', 'nace', 'cod_esco', 'cod_uniclass', 'unitate_masura', 'sectoare_client', 'status_public'];
  const update = {};
  permise.forEach((c) => { if (campuri[c] !== undefined) update[c] = campuri[c]; });
  if (!Object.keys(update).length) return res.status(400).json({ error: 'Niciun câmp de actualizat.' });

  const { error } = await supabaseAdmin.from('catalog_servicii').update(update).eq('id', id);
  if (error) { console.error('[admin/catalog] actualizeaza_serviciu', error); return res.status(500).json({ error: 'Nu am putut actualiza serviciul.' }); }

  await inregistreazaAudit({ admin: user, req, actiune: 'catalog_actualizeaza_serviciu', entitate: 'catalog_servicii', entitate_id: id, detalii: update });
  return res.status(200).json({ ok: true });
}

// Șterge complet un serviciu + tot ce depinde de el (niveluri, prețuri,
// relații) — cascadă explicită, indiferent dacă FK-urile au ON DELETE
// CASCADE configurat sau nu, ca să nu pice pe constraint violation.
async function actionStergeServiciu(req, res, user) {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu.' });

  const { data: niveluri } = await supabaseAdmin.from('catalog_niveluri').select('id').eq('serviciu_id', id);
  const idsNiveluri = (niveluri || []).map((n) => n.id);
  if (idsNiveluri.length) {
    await supabaseAdmin.from('catalog_preturi').delete().in('nivel_id', idsNiveluri);
    await supabaseAdmin.from('catalog_niveluri').delete().eq('serviciu_id', id);
  }
  await supabaseAdmin.from('catalog_relatii').delete().or(`catalog_serviciu_id.eq.${id},catalog_relatie_id.eq.${id}`);

  const { error } = await supabaseAdmin.from('catalog_servicii').delete().eq('id', id);
  if (error) { console.error('[admin/catalog] sterge_serviciu', error); return res.status(500).json({ error: 'Nu am putut șterge serviciul.' }); }

  await inregistreazaAudit({ admin: user, req, actiune: 'catalog_sterge_serviciu', entitate: 'catalog_servicii', entitate_id: id });
  return res.status(200).json({ ok: true });
}

async function actionCreeazaNivel(req, res, user) {
  const { serviciu_id, nivel, nivel_complexitate, norma_timp, materiale_baza_estimat, label, descriere, garantie_luni } = req.body || {};
  if (!serviciu_id || !nivel || nivel_complexitate == null || norma_timp == null) {
    return res.status(400).json({ error: 'serviciu_id, nivel, nivel_complexitate și norma_timp sunt obligatorii.' });
  }
  const { data, error } = await supabaseAdmin
    .from('catalog_niveluri')
    .insert({
      serviciu_id, nivel, nivel_complexitate, norma_timp,
      materiale_baza_estimat: materiale_baza_estimat || 0,
      label: label || null, descriere: descriere || null, garantie_luni: garantie_luni || 0,
    })
    .select('id')
    .single();
  if (error) { console.error('[admin/catalog] creeaza_nivel', error); return res.status(500).json({ error: 'Nu am putut crea nivelul.' }); }

  await inregistreazaAudit({ admin: user, req, actiune: 'catalog_creeaza_nivel', entitate: 'catalog_niveluri', entitate_id: data.id, detalii: { serviciu_id, nivel } });
  return res.status(200).json({ ok: true, id: data.id });
}

async function actionActualizeazaNivel(req, res, user) {
  const { id, ...campuri } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu.' });
  const permise = ['nivel', 'nivel_complexitate', 'norma_timp', 'materiale_baza_estimat', 'label', 'descriere', 'garantie_luni'];
  const update = {};
  permise.forEach((c) => { if (campuri[c] !== undefined) update[c] = campuri[c]; });
  if (!Object.keys(update).length) return res.status(400).json({ error: 'Niciun câmp de actualizat.' });

  const { error } = await supabaseAdmin.from('catalog_niveluri').update(update).eq('id', id);
  if (error) { console.error('[admin/catalog] actualizeaza_nivel', error); return res.status(500).json({ error: 'Nu am putut actualiza nivelul.' }); }

  await inregistreazaAudit({ admin: user, req, actiune: 'catalog_actualizeaza_nivel', entitate: 'catalog_niveluri', entitate_id: id, detalii: update });
  return res.status(200).json({ ok: true });
}

async function actionStergeNivel(req, res, user) {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu.' });
  await supabaseAdmin.from('catalog_preturi').delete().eq('nivel_id', id);
  const { error } = await supabaseAdmin.from('catalog_niveluri').delete().eq('id', id);
  if (error) { console.error('[admin/catalog] sterge_nivel', error); return res.status(500).json({ error: 'Nu am putut șterge nivelul.' }); }

  await inregistreazaAudit({ admin: user, req, actiune: 'catalog_sterge_nivel', entitate: 'catalog_niveluri', entitate_id: id });
  return res.status(200).json({ ok: true });
}

async function actionCreeazaPret(req, res, user) {
  const { nivel_id, tara_cod, regiune, localitate, moneda, pret, pret_urgenta, pret_noapte, pret_sarbatori, comanda_minima } = req.body || {};
  if (!nivel_id || !tara_cod || !moneda || pret == null) {
    return res.status(400).json({ error: 'nivel_id, tara_cod, moneda și pret sunt obligatorii.' });
  }
  const { data, error } = await supabaseAdmin
    .from('catalog_preturi')
    .insert({
      nivel_id, tara_cod, regiune: regiune || null, localitate: localitate || null, moneda, pret,
      pret_urgenta: pret_urgenta ?? null, pret_noapte: pret_noapte ?? null, pret_sarbatori: pret_sarbatori ?? null,
      comanda_minima: comanda_minima ?? null, activ: true, updated_by: user.id,
    })
    .select('id')
    .single();
  if (error) { console.error('[admin/catalog] creeaza_pret', error); return res.status(500).json({ error: 'Nu am putut crea prețul.' }); }

  await inregistreazaAudit({ admin: user, req, actiune: 'catalog_creeaza_pret', entitate: 'catalog_preturi', entitate_id: data.id, detalii: { nivel_id, tara_cod, pret } });
  return res.status(200).json({ ok: true, id: data.id });
}

async function actionActualizeazaPret(req, res, user) {
  const { id, ...campuri } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu.' });
  const permise = ['tara_cod', 'regiune', 'localitate', 'moneda', 'pret', 'pret_urgenta', 'pret_noapte', 'pret_sarbatori', 'comanda_minima', 'activ'];
  const update = {};
  permise.forEach((c) => { if (campuri[c] !== undefined) update[c] = campuri[c]; });
  if (!Object.keys(update).length) return res.status(400).json({ error: 'Niciun câmp de actualizat.' });
  update.updated_at = new Date().toISOString();
  update.updated_by = user.id;

  const { error } = await supabaseAdmin.from('catalog_preturi').update(update).eq('id', id);
  if (error) { console.error('[admin/catalog] actualizeaza_pret', error); return res.status(500).json({ error: 'Nu am putut actualiza prețul.' }); }

  await inregistreazaAudit({ admin: user, req, actiune: 'catalog_actualizeaza_pret', entitate: 'catalog_preturi', entitate_id: id, detalii: update });
  return res.status(200).json({ ok: true });
}

async function actionStergePret(req, res, user) {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu.' });
  const { error } = await supabaseAdmin.from('catalog_preturi').delete().eq('id', id);
  if (error) { console.error('[admin/catalog] sterge_pret', error); return res.status(500).json({ error: 'Nu am putut șterge prețul.' }); }

  await inregistreazaAudit({ admin: user, req, actiune: 'catalog_sterge_pret', entitate: 'catalog_preturi', entitate_id: id });
  return res.status(200).json({ ok: true });
}

const ACTIUNI = {
  list: actionList,
  creeaza_serviciu: actionCreeazaServiciu,
  actualizeaza_serviciu: actionActualizeazaServiciu,
  sterge_serviciu: actionStergeServiciu,
  creeaza_nivel: actionCreeazaNivel,
  actualizeaza_nivel: actionActualizeazaNivel,
  sterge_nivel: actionStergeNivel,
  creeaza_pret: actionCreeazaPret,
  actualizeaza_pret: actionActualizeazaPret,
  sterge_pret: actionStergePret,
};

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { action } = req.body || {};
  const fn = ACTIUNI[action];
  if (!fn) return res.status(400).json({ error: `action invalidă. Trebuie una din: ${Object.keys(ACTIUNI).join(', ')}` });
  return fn(req, res, user);
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
