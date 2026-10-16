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
const { notificaParteneriEligibili } = require('../../lib/notifica-servicii-noi');
const { calculeazaCostNivel } = require('../../lib/calculeaza-cost-recipe');
const { calculeazaPret } = require('../../lib/calculeaza-pret');

const CATEGORII_VALIDE = ['servicii', 'materiale', 'inchirieri'];

// Ruta de încadrare (pasul 8, 15 oct. 2026): după migrarea
// 2026-10-15_ruta_incadrare.sql, un serviciu nou se creează ca ciornă
// (stare = 'ciorna', status_public = false) și se publică doar prin
// api/admin/ruta-incadrare.js → publica. Fără coloana `stare`, comportamentul
// de azi rămâne: serviciul e public imediat.
function lipsesteColoanaStare(error) {
  return !!error && (error.code === 'PGRST204' || error.code === '42703') && /stare/.test(error.message || '');
}
async function insereazaServiciu(rand) {
  const ciorna = await supabaseAdmin.from('catalog_servicii')
    .insert({ ...rand, stare: 'ciorna', status_public: false }).select('id').single();
  if (!lipsesteColoanaStare(ciorna.error)) return { ...ciorna, ciorna: true };
  const public_ = await supabaseAdmin.from('catalog_servicii')
    .insert({ ...rand, status_public: true }).select('id').single();
  return { ...public_, ciorna: false };
}
const MESAJ_CIORNA = 'Creat ca ciornă: se publică din ruta de încadrare, după validare.';
const MESAJ_CIORNA_EN = 'Created as a draft: it is published from the classification route, after validation.';

async function actionList(req, res) {
  const { categorie } = req.body || {};
  if (categorie && !CATEGORII_VALIDE.includes(categorie)) {
    return res.status(400).json({ error: `categorie invalidă. Trebuie: ${CATEGORII_VALIDE.join(', ')}` });
  }

  let q = supabaseAdmin
    .from('catalog_servicii')
    .select('id, id_serviciu, categorie, domeniu, titlu, icon, nace, cod_esco, cod_uniclass, unitate_masura, rating, status_public, sectoare_client, creat_la, descriere, imagini')
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

  const { data, error, ciorna } = await insereazaServiciu({
    id_serviciu, categorie, domeniu, titlu,
    icon: icon || null, nace: nace || null, cod_esco: cod_esco || null, cod_uniclass: cod_uniclass || null,
    unitate_masura: unitate_masura || null,
    sectoare_client: Array.isArray(sectoare_client) ? sectoare_client : [],
    creat_de_tip: 'admin', creat_de: user.id,
  });
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: `id_serviciu "${id_serviciu}" există deja.` });
    console.error('[admin/catalog] creeaza_serviciu', error);
    return res.status(500).json({ error: 'Nu am putut crea serviciul.' });
  }

  await inregistreazaAudit({ admin: user, req, actiune: 'catalog_creeaza_serviciu', entitate: 'catalog_servicii', entitate_id: data.id, detalii: { id_serviciu, categorie, titlu, ciorna } });

  // Ciorna nu se notifică: partenerii află la publicare (ruta-incadrare → publica).
  if (ciorna) {
    return res.status(200).json({ ok: true, id: data.id, stare: 'ciorna', parteneri_notificati: 0, mesaj: MESAJ_CIORNA, mesaj_en: MESAJ_CIORNA_EN });
  }

  // G12: notifică automat partenerii eligibili (profil NACE potrivit) —
  // best-effort, nu blochează crearea serviciului dacă eșuează.
  let notificareRezultat = { notificati: 0, motiv: 'fara_incercare' };
  try {
    notificareRezultat = await notificaParteneriEligibili({ catalogServiciuId: data.id, nace: nace || null, titlu, categorie });
  } catch (notifErr) {
    console.error('[admin/catalog] notificare parteneri eșuată', notifErr);
  }

  return res.status(200).json({ ok: true, id: data.id, parteneri_notificati: notificareRezultat.notificati });
}

async function actionActualizeazaServiciu(req, res, user) {
  const { id, ...campuri } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu.' });
  // 31 august 2026: 'descriere' lipsea din lista de câmpuri editabile —
  // fondatorul n-avea cum să salveze/editeze descrierea unui material din
  // panou (descrierile de azi au fost scrise direct în DB, prin SQL).
  const permise = ['domeniu', 'titlu', 'icon', 'nace', 'cod_esco', 'cod_uniclass', 'unitate_masura', 'sectoare_client', 'status_public', 'descriere'];
  const update = {};
  permise.forEach((c) => { if (campuri[c] !== undefined) update[c] = campuri[c]; });
  if (!Object.keys(update).length) return res.status(400).json({ error: 'Niciun câmp de actualizat.' });

  // După migrarea ruta_incadrare, publicarea trece doar prin ruta de încadrare;
  // ascunderea unui serviciu publicat îl retrage (stare = 'retras').
  if (update.status_public !== undefined) {
    const { data: actual, error: errStare } = await supabaseAdmin.from('catalog_servicii').select('stare').eq('id', id).maybeSingle();
    if (!lipsesteColoanaStare(errStare) && actual) {
      if (update.status_public === true && actual.stare !== 'publicat') {
        return res.status(409).json({ error: 'Serviciul e ciornă: se publică din ruta de încadrare, după validare.', error_en: 'The service is a draft: it is published from the classification route, after validation.' });
      }
      if (update.status_public === false) update.stare = 'retras';
    }
  }

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

// Motor real cost→preț (19 August 2026) — leagă catalogul tehnic de deviz
// (devize_articole/devize_retete/devize_resurse, via catalog_nivel_id) de
// catalog_preturi, prin lib/calculeaza-cost-recipe.js (manoperă+materiale+
// utilaje) + lib/calculeaza-pret.js (%-le platformei + TVA, funcție deja
// folosită live la crearea comenzilor — nemodificată aici). Regulă fermă:
// nu se scrie NICIODATĂ un preț calculat pe resurse incomplete (fără tarif)
// ca și cum ar fi real — dacă există resurse_fara_pret, endpoint-ul refuză
// scrierea, exceptând cazul explicit forteaza:true.
async function actionRecalculeazaPret(req, res, user) {
  const { nivel_id, tara_cod, forteaza = false } = req.body || {};
  if (!nivel_id || !tara_cod) {
    return res.status(400).json({ error: 'nivel_id și tara_cod sunt obligatorii.' });
  }

  let cost;
  try {
    cost = await calculeazaCostNivel({ nivelId: nivel_id, taraCod: tara_cod });
  } catch (err) {
    console.error('[admin/catalog] recalculeaza_pret cost', err);
    return res.status(500).json({ error: 'Nu am putut calcula costul din rețeta tehnică.' });
  }

  if (cost.resurse_fara_pret.length && !forteaza) {
    return res.status(200).json({
      ok: true, scris: false, motiv: 'resurse_fara_pret',
      cost, resurse_fara_pret: cost.resurse_fara_pret,
    });
  }

  const { data: taraCfg } = await supabaseAdmin
    .from('tax_configurations').select('moneda').eq('tara_cod', tara_cod).maybeSingle();
  const moneda = taraCfg?.moneda || 'RON';

  const calc = await calculeazaPret({
    cost_baza_servicii: cost.cost_baza_servicii,
    cost_materiale: cost.cost_materiale,
    cost_chirie_scule: cost.cost_utilaj, // slot existent reutilizat pentru costul de utilaje din devize
    tara: tara_cod,
  });

  const { data: existing } = await supabaseAdmin
    .from('catalog_preturi').select('id')
    .eq('nivel_id', nivel_id).eq('tara_cod', tara_cod)
    .is('regiune', null).is('localitate', null).maybeSingle();

  let id;
  if (existing) {
    const { error } = await supabaseAdmin
      .from('catalog_preturi')
      .update({ moneda, pret: calc.pret_final, activ: true, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq('id', existing.id);
    if (error) { console.error('[admin/catalog] recalculeaza_pret update', error); return res.status(500).json({ error: 'Nu am putut actualiza prețul.' }); }
    id = existing.id;
  } else {
    const { data, error } = await supabaseAdmin
      .from('catalog_preturi')
      .insert({ nivel_id, tara_cod, regiune: null, localitate: null, moneda, pret: calc.pret_final, activ: true, updated_by: user.id })
      .select('id').single();
    if (error) { console.error('[admin/catalog] recalculeaza_pret insert', error); return res.status(500).json({ error: 'Nu am putut crea prețul.' }); }
    id = data.id;
  }

  await inregistreazaAudit({
    admin: user, req, actiune: 'catalog_recalculeaza_pret', entitate: 'catalog_preturi', entitate_id: id,
    detalii: { nivel_id, tara_cod, pret_final: calc.pret_final, forteaza, resurse_fara_pret_count: cost.resurse_fara_pret.length },
  });

  return res.status(200).json({ ok: true, scris: true, id, pret: calc, cost, resurse_fara_pret: cost.resurse_fara_pret });
}

// Vertical A (pilot construcții/instalații) — generare automată de servicii
// (Montaj/Înlocuire/Reparație/Mentenanță) dintr-un material de referință
// (materiale_referinta_ai), pe baza șabloanelor definite o singură dată per
// categorie (catalog_servicii_template), nu per produs. Declanșată EXPLICIT
// de admin (buton dedicat) — niciodată automat la crearea unui material.
const NIVELURI_STANDARD = [
  { nivel: 'Bronze', nivel_complexitate: 1 },
  { nivel: 'Silver', nivel_complexitate: 2 },
  { nivel: 'Gold', nivel_complexitate: 3 },
  { nivel: 'Platinum', nivel_complexitate: 4 },
];

async function actionGenereazaServiciiDinMaterial(req, res, user) {
  const { material_id } = req.body || {};
  if (!material_id) return res.status(400).json({ error: 'material_id obligatoriu.' });

  const { data: material, error: errMaterial } = await supabaseAdmin
    .from('materiale_referinta_ai')
    .select('id, categorie, denumire')
    .eq('id', material_id)
    .maybeSingle();
  if (errMaterial) { console.error('[admin/catalog] genereaza_servicii_din_material', errMaterial); return res.status(500).json({ error: 'Nu am putut încărca materialul.' }); }
  if (!material) return res.status(404).json({ error: 'Materialul nu există.' });

  const { data: sabloane, error: errSabloane } = await supabaseAdmin
    .from('catalog_servicii_template')
    .select('id, categorie, tip_serviciu, titlu_pattern, domeniu, cod_esco, nace, cod_uniclass, indicator_id, activ')
    .eq('categorie', material.categorie)
    .eq('activ', true);
  if (errSabloane) { console.error('[admin/catalog] genereaza_servicii_din_material', errSabloane); return res.status(500).json({ error: 'Nu am putut încărca șabloanele.' }); }
  if (!sabloane || !sabloane.length) {
    return res.status(400).json({ error: `Nu există șabloane active pentru categoria "${material.categorie}".` });
  }

  const { data: existente } = await supabaseAdmin
    .from('materiale_referinta_ai_servicii')
    .select('tip_serviciu')
    .eq('material_id', material_id);
  const tipuriExistente = new Set((existente || []).map((r) => r.tip_serviciu));

  const rezultate = [];
  let parteneriNotificatiTotal = 0;

  for (const sablon of sabloane) {
    if (tipuriExistente.has(sablon.tip_serviciu)) {
      rezultate.push({ tip_serviciu: sablon.tip_serviciu, status: 'deja_generat' });
      continue;
    }

    const idServiciu = `mat-${material.id.slice(0, 8)}-${sablon.tip_serviciu}`;
    const titlu = sablon.titlu_pattern.includes('{denumire}')
      ? sablon.titlu_pattern.replace('{denumire}', material.denumire)
      : `${sablon.titlu_pattern} ${material.denumire}`;

    // Ca la creeaza_serviciu: ciornă după migrarea ruta_incadrare, publicat azi.
    const { data: serviciuNou, error: errServiciu, ciorna } = await insereazaServiciu({
      id_serviciu: idServiciu, categorie: 'servicii', domeniu: sablon.domeniu, titlu,
      nace: sablon.nace || null, cod_esco: sablon.cod_esco || null, cod_uniclass: sablon.cod_uniclass || null,
      creat_de_tip: 'admin', creat_de: user.id,
    });
    if (errServiciu) {
      console.error('[admin/catalog] genereaza_servicii_din_material — creare serviciu', errServiciu);
      rezultate.push({ tip_serviciu: sablon.tip_serviciu, status: 'eroare', detaliu: errServiciu.message });
      continue;
    }

    for (const niv of NIVELURI_STANDARD) {
      await supabaseAdmin.from('catalog_niveluri').insert({
        serviciu_id: serviciuNou.id, nivel: niv.nivel, nivel_complexitate: niv.nivel_complexitate,
        norma_timp: 1, // placeholder — de confirmat de admin, schema nu permite NULL
        descriere: 'Normă de timp generată automat, placeholder — de confirmat de admin înainte de publicare tarif.',
      });
    }

    await supabaseAdmin.from('materiale_referinta_ai_servicii').insert({
      material_id, catalog_serviciu_id: serviciuNou.id, tip_serviciu: sablon.tip_serviciu,
    });

    let notificati = 0;
    if (!ciorna) {
      try {
        const r = await notificaParteneriEligibili({ catalogServiciuId: serviciuNou.id, nace: sablon.nace || null, titlu, categorie: 'servicii' });
        notificati = r.notificati || 0;
      } catch (notifErr) {
        console.error('[admin/catalog] genereaza_servicii_din_material — notificare eșuată', notifErr);
      }
    }
    parteneriNotificatiTotal += notificati;

    rezultate.push({ tip_serviciu: sablon.tip_serviciu, status: ciorna ? 'creat_ciorna' : 'creat', catalog_serviciu_id: serviciuNou.id, id_serviciu: idServiciu });
  }

  await inregistreazaAudit({
    admin: user, req, actiune: 'catalog_genereaza_servicii_material', entitate: 'materiale_referinta_ai', entitate_id: material_id,
    detalii: { categorie: material.categorie, denumire: material.denumire, rezultate },
  });

  return res.status(200).json({ ok: true, material_id, rezultate, parteneri_notificati: parteneriNotificatiTotal });
}

// D2a, gaură tehnică decizie-agnostică (audit 21 August 2026) — devize_articole.
// catalog_nivel_id nu avea niciun endpoint de scriere, doar citire (confirmat
// „gol genuin" în lib/calculeaza-cost-recipe.js) — orice serviciu nou rămânea
// definitiv fără cost-normă tehnică reală, indiferent câte se creau.
// Relație N:1 (articole→nivel), nu 1:1 — FK-ul nu are unicitate, iar
// calculeazaCostNivel() era deja proiectată pentru mai multe articole per
// nivel (azi mereu 1 în practică). Un articol e legat de UN SINGUR nivel
// simultan (coloană scalară, nu tabelă-punte) — reutilizarea aceleiași linii
// tehnice pe mai multe servicii nu e posibilă azi, semnalat, nu rezolvat aici.
async function actionLeagaArticolNivel(req, res, user) {
  const { articol_id, catalog_nivel_id, forteaza = false } = req.body || {};
  if (!articol_id || !catalog_nivel_id) {
    return res.status(400).json({ error: 'articol_id și catalog_nivel_id sunt obligatorii.' });
  }

  const { data: articol, error: errArticol } = await supabaseAdmin
    .from('devize_articole')
    .select('articol_id, indicator_id, catalog_nivel_id')
    .eq('articol_id', articol_id)
    .maybeSingle();
  if (errArticol) { console.error('[admin/catalog] leaga_articol_nivel articol', errArticol); return res.status(500).json({ error: 'Nu am putut încărca articolul.' }); }
  if (!articol) return res.status(404).json({ error: 'Articolul nu există.' });
  if (articol.catalog_nivel_id && articol.catalog_nivel_id !== catalog_nivel_id && !forteaza) {
    return res.status(409).json({
      error: 'Articolul e deja legat de alt nivel — retrimite cu forteaza:true ca să-l muți.',
      catalog_nivel_id_curent: articol.catalog_nivel_id,
    });
  }

  const { data: nivel, error: errNivel } = await supabaseAdmin
    .from('catalog_niveluri')
    .select('id, nivel, serviciu_id')
    .eq('id', catalog_nivel_id)
    .maybeSingle();
  if (errNivel) { console.error('[admin/catalog] leaga_articol_nivel nivel', errNivel); return res.status(500).json({ error: 'Nu am putut încărca nivelul.' }); }
  if (!nivel) return res.status(404).json({ error: 'Nivelul nu există.' });

  // Avertisment neblocant — nicio regulă DB reală de potrivire domeniu azi,
  // doar un tipar semantic observat (cod NACE indicator vs. cod NACE
  // serviciu). Nu blocăm legarea, doar semnalăm admin-ului.
  let avertisment = null;
  const [{ data: indicator }, { data: serviciu }] = await Promise.all([
    supabaseAdmin.from('devize_indicatoare').select('nace_cod').eq('indicator_id', articol.indicator_id).maybeSingle(),
    supabaseAdmin.from('catalog_servicii').select('nace, titlu').eq('id', nivel.serviciu_id).maybeSingle(),
  ]);
  // Ambele formate coexistă în DB ("F 43.33" pe servicii, "43.33" sau "F 43.22" pe indicatoare):
  // compar fără litera de secțiune, altfel avertismentul iese fals-pozitiv la potrivire perfectă.
  const faraSectiune = (c) => String(c).trim().replace(/^[A-Za-z]\s+/, '');
  if (indicator?.nace_cod && serviciu?.nace && faraSectiune(indicator.nace_cod) !== faraSectiune(serviciu.nace)) {
    avertisment = `Cod NACE al articolului (${indicator.nace_cod}) diferă de cel al serviciului „${serviciu.titlu}" (${serviciu.nace}) — verifică dacă legarea e corectă.`;
  }

  const { error: errUpdate } = await supabaseAdmin
    .from('devize_articole')
    .update({ catalog_nivel_id })
    .eq('articol_id', articol_id);
  if (errUpdate) { console.error('[admin/catalog] leaga_articol_nivel update', errUpdate); return res.status(500).json({ error: 'Nu am putut lega articolul.' }); }

  await inregistreazaAudit({
    admin: user, req, actiune: 'catalog_leaga_articol_nivel', entitate: 'devize_articole', entitate_id: String(articol_id),
    detalii: { catalog_nivel_id, nivel: nivel.nivel, serviciu_id: nivel.serviciu_id, avertisment },
  });

  return res.status(200).json({ ok: true, avertisment });
}

async function actionDezleagaArticolNivel(req, res, user) {
  const { articol_id } = req.body || {};
  if (!articol_id) return res.status(400).json({ error: 'articol_id obligatoriu.' });

  const { error } = await supabaseAdmin
    .from('devize_articole')
    .update({ catalog_nivel_id: null })
    .eq('articol_id', articol_id);
  if (error) { console.error('[admin/catalog] dezleaga_articol_nivel', error); return res.status(500).json({ error: 'Nu am putut dezlega articolul.' }); }

  await inregistreazaAudit({ admin: user, req, actiune: 'catalog_dezleaga_articol_nivel', entitate: 'devize_articole', entitate_id: String(articol_id) });
  return res.status(200).json({ ok: true });
}

async function actionListeazaArticoleNivel(req, res) {
  const { catalog_nivel_id } = req.body || {};
  if (!catalog_nivel_id) return res.status(400).json({ error: 'catalog_nivel_id obligatoriu.' });
  const { data, error } = await supabaseAdmin
    .from('devize_articole')
    .select('articol_id, indicator_id, denumire_articol, unitate_masura')
    .eq('catalog_nivel_id', catalog_nivel_id)
    .order('articol_id');
  if (error) { console.error('[admin/catalog] listeaza_articole_nivel', error); return res.status(500).json({ error: 'Nu am putut încărca articolele legate.' }); }
  return res.status(200).json({ ok: true, articole: data || [] });
}

async function actionCautaArticole(req, res) {
  const { termen = '' } = req.body || {};
  let q = supabaseAdmin
    .from('devize_articole')
    .select('articol_id, indicator_id, denumire_articol, unitate_masura, catalog_nivel_id')
    .limit(30)
    .order('articol_id');
  if (termen) q = q.or(`denumire_articol.ilike.%${termen}%,indicator_id.ilike.%${termen}%`);
  const { data, error } = await q;
  if (error) { console.error('[admin/catalog] cauta_articole', error); return res.status(500).json({ error: 'Nu am putut căuta articolele.' }); }
  return res.status(200).json({ ok: true, articole: data || [] });
}


// Un serviciu cu nivelurile și prețurile lui (editorul de niveluri din
// catalog-niveluri.js, folosit și de pagina adminului de catalog).
async function actionServiciuCuNiveluri(req, res) {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu.', error_en: 'id is required.' });
  const { data: s, error } = await supabaseAdmin.from('catalog_servicii')
    .select('id, id_serviciu, categorie, domeniu, titlu, nace, cod_esco, cod_uniclass, status_public').eq('id', id).maybeSingle();
  if (error) return res.status(500).json({ error: 'Nu am putut încărca serviciul.', error_en: 'Could not load the service.' });
  if (!s) return res.status(404).json({ error: 'Serviciul nu există.', error_en: 'The service does not exist.' });
  const { data: niveluri } = await supabaseAdmin.from('catalog_niveluri')
    .select('id, serviciu_id, nivel, nivel_complexitate, norma_timp, materiale_baza_estimat, label, descriere, garantie_luni')
    .eq('serviciu_id', id).order('nivel_complexitate', { ascending: true });
  const ids = (niveluri || []).map((n) => n.id);
  const { data: preturi } = ids.length
    ? await supabaseAdmin.from('catalog_preturi').select('id, nivel_id, tara_cod, regiune, localitate, moneda, pret, activ').in('nivel_id', ids)
    : { data: [] };
  s.niveluri = (niveluri || []).map((n) => ({ ...n, preturi: (preturi || []).filter((p) => p.nivel_id === n.id) }));
  return res.status(200).json({ ok: true, serviciu: s });
}

const ACTIUNI = {
  serviciu_cu_niveluri: actionServiciuCuNiveluri,
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
  recalculeaza_pret: actionRecalculeazaPret,
  genereaza_servicii_din_material: actionGenereazaServiciiDinMaterial,
  leaga_articol_nivel: actionLeagaArticolNivel,
  dezleaga_articol_nivel: actionDezleagaArticolNivel,
  listeaza_articole_nivel: actionListeazaArticoleNivel,
  cauta_articole: actionCautaArticole,
};

// Adminii de catalog (pasul 9, 15 oct. 2026): superadminul are acces la tot,
// ca înainte. Un admin are acces doar la editorul de niveluri / prețuri /
// rețetă, doar pe serviciile din capitolele lui (admin_permissions,
// sectiune = 'catalog_servicii') și, dacă e limitat, doar în țara lui.
// Fail-closed: fără drept sau fără migrarea ruta_incadrare → refuz.
const ACTIUNI_ADMIN_CATALOG = new Set([
  'serviciu_cu_niveluri', 'creeaza_nivel', 'actualizeaza_nivel', 'sterge_nivel', 'creeaza_pret', 'actualizeaza_pret',
  'sterge_pret', 'recalculeaza_pret', 'leaga_articol_nivel', 'dezleaga_articol_nivel', 'listeaza_articole_nivel', 'cauta_articole',
]);
async function serviciuDinNivel(nivelId) {
  if (!nivelId) return null;
  const { data } = await supabaseAdmin.from('catalog_niveluri').select('serviciu_id').eq('id', nivelId).maybeSingle();
  return data?.serviciu_id || null;
}
// Serviciul atins de acțiune (null = acțiune fără serviciu, ex. căutare).
async function serviciuAtins(action, b) {
  switch (action) {
    case 'serviciu_cu_niveluri': return b.id || null;
    case 'creeaza_nivel': return b.serviciu_id || null;
    case 'actualizeaza_nivel': case 'sterge_nivel': return serviciuDinNivel(b.id);
    case 'creeaza_pret': case 'recalculeaza_pret': return serviciuDinNivel(b.nivel_id);
    case 'leaga_articol_nivel': case 'listeaza_articole_nivel': return serviciuDinNivel(b.catalog_nivel_id);
    case 'actualizeaza_pret': case 'sterge_pret': {
      const { data } = await supabaseAdmin.from('catalog_preturi').select('nivel_id').eq('id', b.id).maybeSingle();
      return serviciuDinNivel(data?.nivel_id);
    }
    case 'dezleaga_articol_nivel': {
      const { data } = await supabaseAdmin.from('devize_articole').select('catalog_nivel_id').eq('articol_id', b.articol_id).maybeSingle();
      return serviciuDinNivel(data?.catalog_nivel_id);
    }
    default: return null;
  }
}
async function cereDreptAdmin(req, res, user, action) {
  const ruta = require('./ruta-incadrare')._intern;
  const perm = await ruta.permisiune(user);
  const refuz = (status, error, error_en) => { res.status(status).json({ error, error_en }); return false; };
  if (!perm) return refuz(403, 'Nu ai drept pe catalogul de servicii.', 'You have no rights on the service catalogue.');
  if (perm.superadmin) return true;
  if (!ACTIUNI_ADMIN_CATALOG.has(action)) return refuz(403, 'Acțiune rezervată superadminului.', 'Action reserved for the superadmin.');
  const b = req.body || {};
  const tara = b.tara_cod ? String(b.tara_cod).toUpperCase() : null;
  if (perm.tara && tara && tara !== perm.tara) return refuz(403, `Ai drept doar pentru țara ${perm.tara}.`, `You only have rights for country ${perm.tara}.`);
  const sid = await serviciuAtins(action, b);
  if (sid === null && action !== 'cauta_articole') return refuz(404, 'Serviciul nu există.', 'The service does not exist.');
  if (sid) {
    try { await ruta.cereDreptServiciu(perm, sid); } catch (e) {
      if (e instanceof ruta.MigrareLipsa) return refuz(409, ruta.MESAJ_MIGRARE.error, ruta.MESAJ_MIGRARE.error_en);
      if (e instanceof ruta.EroareCerere) return refuz(e.status, e.error, e.error_en);
      throw e;
    }
  }
  return true;
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { action } = req.body || {};
  const fn = ACTIUNI[action];
  if (!fn) return res.status(400).json({ error: `action invalidă. Trebuie una din: ${Object.keys(ACTIUNI).join(', ')}` });
  if (!(await cereDreptAdmin(req, res, user, action))) return undefined;
  return fn(req, res, user);
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
