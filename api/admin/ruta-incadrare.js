// /api/admin/ruta-incadrare.js
// Ruta de încadrare a serviciilor (pasul 8, 15 oct. 2026, decizie LM):
//   secțiune NACE → diviziune → grupă → clasă → capitol → nod → ESCO →
//   Uniclass → rețetă → prețuri → publicare.
// Regulile: docs/regula-incadrare.md; motorul: lib/ruta-incadrare.js;
// rețeta propusă: lib/propune-reteta.js.
//
// Acces (fail-closed): superadmin, sau admin cu rând în admin_permissions
// (sectiune = 'catalog_servicii', poate_scrie = true), limitat la capitolele
// din sectiune_specializata ('*', 'F' sau 'F,N') și, opțional, la tara_cod.
// Orice scriere trece prin lib/audit-log.js.
//
// POST { action, ... } — același tipar ca api/admin/catalog.js:
//   pasi, cauta_asemanatoare, valideaza, copiaza_din, publica, retrage,
//   propune_reteta, decide_linie, aproba_reteta, respinge_reteta.
//
// Fără migrarea 2026-10-15_ruta_incadrare.sql: 409 cu „Migrarea ruta_incadrare
// nu e aplicată” / „The ruta_incadrare migration is not applied”, nu 500.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { requireAuth } = require('../../lib/auth-middleware');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { notificaParteneriEligibili } = require('../../lib/notifica-servicii-noi');
const { calculeazaCostNivel } = require('../../lib/calculeaza-cost-recipe');
const { citesteTot } = require('../../lib/citeste-tot');
const R = require('../../lib/ruta-incadrare');
const { propuneReteta, verificaAprobare, planAprobare, temePentruTitlu, INDICATORI_PE_ACTIVITATE, RESURSE_NOI_PE_TEMA } = require('../../lib/propune-reteta');

// ── Migrarea lipsă ────────────────────────────────────────────────────────
class MigrareLipsa extends Error {}
function eLipsaSchema(error) {
  if (!error) return false;
  return ['42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST200'].includes(error.code)
    || /does not exist|could not find|schema cache/i.test(error.message || '');
}
// Întoarce data sau aruncă: MigrareLipsa pentru schemă lipsă, eroarea altfel.
function date({ data, error }) {
  if (error) throw eLipsaSchema(error) ? new MigrareLipsa(error.message) : error;
  return data;
}
const MESAJ_MIGRARE = { ok: false, cod: 'MIGRARE_NEAPLICATA', error: 'Migrarea ruta_incadrare nu e aplicată.', error_en: 'The ruta_incadrare migration is not applied.' };

class EroareCerere extends Error {
  constructor(status, error, error_en, extra) { super(error); Object.assign(this, { status, error, error_en, extra }); }
}

// ── Acces ─────────────────────────────────────────────────────────────────
async function permisiune(user) {
  const { data: profil, error } = await supabaseAdmin.from('profiles').select('roles').eq('id', user.id).maybeSingle();
  if (error || !profil) return null;
  if ((profil.roles || []).includes('superadmin')) return { superadmin: true, capitole: '*', tara: null };
  const { data: rand, error: e2 } = await supabaseAdmin
    .from('admin_permissions')
    .select('sectiune_specializata, tara_cod, poate_scrie')
    .eq('admin_id', user.id).eq('sectiune', 'catalog_servicii').eq('poate_scrie', true)
    .maybeSingle();
  if (e2 || !rand || !rand.sectiune_specializata) return null;
  const s = String(rand.sectiune_specializata).trim();
  return { superadmin: false, capitole: s === '*' ? '*' : s.split(',').map((x) => x.trim()).filter(Boolean), tara: rand.tara_cod || null };
}
function capitolPermis(perm, cod) {
  return perm.capitole === '*' || (cod && perm.capitole.includes(cod));
}
function cereCapitol(perm, cod) {
  if (!capitolPermis(perm, cod)) {
    throw new EroareCerere(403,
      `Nu ai drept pe capitolul ${cod || '(necalculat)'}.`,
      `You have no rights on chapter ${cod || '(not computed)'}.`);
  }
}

// ── Date de referință ─────────────────────────────────────────────────────
async function capitole() {
  return date(await supabaseAdmin.from('meniu_capitole').select('*').order('ordine'));
}
async function naceClase() {
  const randuri = date(await citesteTot(() => supabaseAdmin.from('nace_reference').select('cod').eq('nivel', 'clasa').order('cod')));
  return new Set(randuri.map((r) => r.cod).filter((c) => /^\d{2}\.\d{2}$/.test(c)));
}
async function sectiuneDiviziune(div) {
  if (!div) return null;
  const { data } = await supabaseAdmin.from('nace_reference').select('cod_parinte').eq('nivel', 'diviziune').eq('cod', div).maybeSingle();
  return data?.cod_parinte || null;
}
const COLOANE_SERVICIU = 'id, id_serviciu, titlu, categorie, domeniu, descriere, nace, cod_esco, cod_uniclass, unitate_masura, icon, sectoare_client, categorie_id, subcategorie_id, status_public, nod_id, stare, creat_din_serviciu_id';
async function serviciu(id) {
  const s = date(await supabaseAdmin.from('catalog_servicii').select(COLOANE_SERVICIU).eq('id', id).maybeSingle());
  if (!s) throw new EroareCerere(404, 'Serviciul nu există.', 'The service does not exist.');
  // titlul în engleză: traduceri.en.titlu, după migrarea 2026-10-10 (altfel lipsește → E8)
  const { data: t, error } = await supabaseAdmin.from('catalog_servicii').select('traduceri').eq('id', id).maybeSingle();
  s.titlu_en = (!error && t?.traduceri?.en?.titlu) || null;
  return s;
}
async function nodSiCapitol(nodId, listaCapitole) {
  if (!nodId) return { nod: null, capitol: null };
  const nod = date(await supabaseAdmin.from('categorii')
    .select('id, title, title_en, nace_clasa, capitol_cod, autorizare_necesara, activ, category_type').eq('id', nodId).maybeSingle());
  return { nod, capitol: listaCapitole.find((c) => c.cod === nod?.capitol_cod) || null };
}
function lang(req) {
  const l = String(req.body?.lang || req.query?.lang || '').slice(0, 2).toLowerCase();
  return l && l !== 'ro' ? 'en' : 'ro';
}
// Eticheta în limba cerută, cu rezervă pe cealaltă (ex. codurile Uniclass
// noi n-au încă title_ro: se afișează title_en).
const eticheta = (r, l, ro = 'denumire_ro', en = 'denumire_en') => (l === 'en' ? (r[en] || r[ro]) : (r[ro] || r[en])) || null;

// ── Uniclass (pasul 8b) ───────────────────────────────────────────────────
// După importul Uniclass 2026 (19.084 de coduri), uniclass_codes are și
// inlocuit_de / retras_in; înainte de import coloanele lipsesc și se
// verifică doar existența codului.
const MAXIM_PAGINI_UNICLASS = 40;
async function randUniclass(cod) {
  const cuInlocuitor = await supabaseAdmin.from('uniclass_codes').select('code, is_active, inlocuit_de, retras_in').eq('code', cod).maybeSingle();
  if (!eLipsaSchema(cuInlocuitor.error)) return date(cuInlocuitor);
  return date(await supabaseAdmin.from('uniclass_codes').select('code, is_active').eq('code', cod).maybeSingle());
}
// Doar codurile cerute care există și sunt active.
async function coduriUniclassActive(coduri) {
  const lista = [...new Set((coduri || []).filter(Boolean))];
  if (!lista.length) return new Set();
  const randuri = date(await supabaseAdmin.from('uniclass_codes').select('code').in('code', lista).eq('is_active', true));
  return new Set(randuri.map((u) => u.code));
}

// Catalogul de servicii, cu nivelurile și articolele legate (pentru căutare).
async function catalogCuRetete() {
  const servicii = date(await supabaseAdmin.from('catalog_servicii')
    .select('id, titlu, nace, cod_esco, cod_uniclass, nod_id, categorie').eq('categorie', 'servicii'));
  const niveluri = date(await citesteTot(() => supabaseAdmin.from('catalog_niveluri').select('id, serviciu_id, nivel').order('id')));
  const articole = date(await citesteTot(() => supabaseAdmin.from('devize_articole')
    .select('articol_id, simbol, indicator_id, denumire_articol, unitate_masura, catalog_nivel_id')
    .not('catalog_nivel_id', 'is', null).order('articol_id')));
  const nivelServ = new Map(niveluri.map((n) => [n.id, n.serviciu_id]));
  return servicii.map((s) => ({
    ...s,
    niveluri: niveluri.filter((n) => n.serviciu_id === s.id),
    articole: articole.filter((a) => nivelServ.get(a.catalog_nivel_id) === s.id),
  }));
}

// ── pasi ──────────────────────────────────────────────────────────────────
async function actionPasi(req, res, user, perm) {
  const { sectiune, diviziune, grupa, clasa, tip_inregistrare = 'serviciu' } = req.body || {};
  const l = lang(req);
  const caps = await capitole(); // cere migrarea
  const raspuns = { ok: true, lang: l };

  const sect = date(await supabaseAdmin.from('nace_sectiuni').select('litera, denumire_ro, denumire_en').order('litera'));
  raspuns.sectiuni = sect.map((s) => ({ cod: s.litera, denumire: eticheta(s, l) }));
  if (sectiune) {
    const d = date(await supabaseAdmin.from('nace_reference').select('cod, denumire_ro, denumire_en')
      .eq('nivel', 'diviziune').eq('cod_parinte', sectiune).order('cod'));
    raspuns.diviziuni = d.map((x) => ({ cod: x.cod, denumire: eticheta(x, l) }));
  }
  if (diviziune) {
    const g = date(await supabaseAdmin.from('nace_reference').select('cod, denumire_ro, denumire_en')
      .eq('nivel', 'clasa').eq('cod_parinte', diviziune).order('cod'));
    raspuns.grupe = g.filter((x) => /^\d{2}\.\d$/.test(x.cod)).map((x) => ({ cod: x.cod, denumire: eticheta(x, l) }));
  }
  if (grupa) {
    const c = date(await supabaseAdmin.from('nace_reference').select('cod, denumire_ro, denumire_en')
      .eq('nivel', 'clasa').eq('cod_parinte', grupa).order('cod'));
    raspuns.clase = c.filter((x) => /^\d{2}\.\d{2}$/.test(x.cod)).map((x) => ({ cod: x.cod, denumire: eticheta(x, l) }));
  }
  const cls = R.normalizeazaNace(clasa);
  if (cls) {
    const cod = R.capitolPentruNace(cls, caps, { sectiune: sectiune || await sectiuneDiviziune(R.diviziuneNace(cls)) });
    const cap = caps.find((c) => c.cod === cod) || null;
    raspuns.capitol = cap && { cod: cap.cod, titlu: l === 'en' ? cap.titlu_en : cap.titlu_ro, tip_partener: cap.tip_partener, discount_permis: cap.discount_permis };
    raspuns.capitol_permis = capitolPermis(perm, cod);

    const noduri = date(await supabaseAdmin.from('categorii')
      .select('id, title, title_en, capitol_cod, autorizare_necesara, activ').eq('nace_clasa', cls).order('title'));
    raspuns.noduri = noduri.map((n) => ({ id: n.id, titlu: eticheta(n, l, 'title', 'title_en'), capitol_cod: n.capitol_cod, compatibil: n.capitol_cod === cod && n.activ !== false, autorizare_necesara: n.autorizare_necesara }));

    const esco = date(await citesteTot(() => supabaseAdmin.from('competente_esco')
      .select('cod_esco, denumire, denumire_en, nace_code').eq('tip_cod', 'esco').order('cod_esco')));
    const potrivire = (e) => (R.normalizeazaNace(e.nace_code) === cls ? 0 : R.diviziuneDinText(e.nace_code) === R.diviziuneNace(cls) ? 1 : 2);
    raspuns.esco = esco.map((e) => ({ cod_esco: e.cod_esco, denumire: eticheta(e, l, 'denumire', 'denumire_en'), potrivire: ['clasa', 'diviziune', null][potrivire(e)] }))
      .sort((a, b) => (a.potrivire ? (a.potrivire === 'clasa' ? 0 : 1) : 2) - (b.potrivire ? (b.potrivire === 'clasa' ? 0 : 1) : 2) || a.cod_esco.localeCompare(b.cod_esco));

    const prefix = tip_inregistrare === 'produs' ? 'Pr_' : 'Ac_';
    const uc = date(await citesteTot(() => supabaseAdmin.from('uniclass_codes').select('code, title_ro, title_en, nace_asociat, is_active')
      .like('code', `${prefix}%`).eq('is_active', true).order('code'), { maximPagini: MAXIM_PAGINI_UNICLASS }));
    raspuns.uniclass = uc.filter((u) => u.is_active !== false)
      .map((u) => ({ cod: u.code, denumire: eticheta(u, l, 'title_ro', 'title_en'), potrivire: R.normalizeazaNace(u.nace_asociat) === cls }))
      .sort((a, b) => Number(b.potrivire) - Number(a.potrivire) || a.cod.localeCompare(b.cod));

    const ind = date(await supabaseAdmin.from('devize_indicatoare').select('indicator_id, denumire_indicator, nace_cod, uniclass_ac_code'));
    raspuns.indicatori = ind.filter((i) => R.normalizeazaNace(i.nace_cod) === cls)
      .map((i) => ({ indicator_id: i.indicator_id, denumire: i.denumire_indicator, uniclass_ac_code: i.uniclass_ac_code }));
  }
  return res.status(200).json(raspuns);
}

// ── cauta_asemanatoare ────────────────────────────────────────────────────
async function actionCautaAsemanatoare(req, res) {
  const { serviciu_id, serviciu: draft } = req.body || {};
  const baza = serviciu_id ? await serviciu(serviciu_id) : (draft || {});
  if (!baza.titlu && !baza.nace) {
    throw new EroareCerere(400, 'Trimite serviciu_id sau serviciu { titlu, nace, cod_esco }.', 'Send serviciu_id or serviciu { titlu, nace, cod_esco }.');
  }
  const catalog = await catalogCuRetete();
  const rezultate = R.serviciiAsemanatoare(baza, catalog).slice(0, 20);
  return res.status(200).json({ ok: true, rezultate });
}

// ── valideaza ─────────────────────────────────────────────────────────────
async function contextValidare(s, perm, body = {}) {
  const caps = await capitole();
  const { nod, capitol } = await nodSiCapitol(s.nod_id, caps);
  const clasa = R.normalizeazaNace(s.nace);
  cereCapitol(perm, capitol?.cod || R.capitolPentruNace(clasa, caps));

  const [clase, escoRow, ucRow, catalogTitluri] = await Promise.all([
    naceClase(),
    s.cod_esco ? supabaseAdmin.from('competente_esco').select('cod_esco, nace_code, tip_cod').eq('cod_esco', s.cod_esco).maybeSingle().then(date) : null,
    s.cod_uniclass ? randUniclass(s.cod_uniclass) : null,
    supabaseAdmin.from('catalog_servicii').select('id, titlu').eq('categorie', 'servicii').then(date),
  ]);

  const niveluri = s.id ? date(await supabaseAdmin.from('catalog_niveluri').select('id, nivel').eq('serviciu_id', s.id)) : [];
  const idNiv = niveluri.map((n) => n.id);
  const articole = idNiv.length ? date(await supabaseAdmin.from('devize_articole')
    .select('articol_id, simbol, indicator_id, catalog_nivel_id').in('catalog_nivel_id', idNiv)) : [];
  const indicatori = [...new Set(articole.map((a) => a.indicator_id).filter(Boolean))];
  const naceInd = indicatori.length ? date(await supabaseAdmin.from('devize_indicatoare').select('indicator_id, nace_cod').in('indicator_id', indicatori)) : [];
  const naceIndMap = new Map(naceInd.map((i) => [i.indicator_id, i.nace_cod]));

  let preturi = [];
  if (idNiv.length) {
    let q = supabaseAdmin.from('catalog_preturi').select('nivel_id, tara_cod').in('nivel_id', idNiv).eq('activ', true);
    if (perm.tara) q = q.eq('tara_cod', perm.tara);
    const active = date(await q);
    const propuse = s.id ? date(await supabaseAdmin.from('retete_propuse').select('catalog_nivel_id').eq('catalog_serviciu_id', s.id).eq('stare', 'propusa')) : [];
    preturi = await Promise.all(niveluri.map(async (n) => {
      const areArticole = articole.some((a) => a.catalog_nivel_id === n.id);
      let calculabila = false;
      if (areArticole) {
        try {
          const cost = await calculeazaCostNivel({ nivelId: n.id, taraCod: perm.tara || 'RO' });
          calculabila = !cost.resurse_fara_pret.length && cost.cost_baza_servicii > 0;
        } catch (e) { calculabila = false; }
      }
      return {
        nivel_id: n.id, nivel: n.nivel,
        are_pret_activ: active.some((p) => p.nivel_id === n.id),
        reteta_calculabila: calculabila,
        reteta_propusa: propuse.some((p) => !p.catalog_nivel_id || p.catalog_nivel_id === n.id),
      };
    }));
  }

  return R.valideazaRuta({
    serviciu: s, nod, capitol, esco: escoRow, uniclass: ucRow,
    articole: articole.map((a) => ({ ...a, indicator_nace: naceIndMap.get(a.indicator_id) || null })),
    preturi,
    traduceri: { titlu_ro: s.titlu, titlu_en: s.titlu_en },
    tipInregistrare: body.tip_inregistrare || (s.categorie === 'materiale' ? 'produs' : 'serviciu'),
    ref: { capitole: caps, naceClase: clase, discountPct: body.discount_pct, catalog: catalogTitluri, sectiune: await sectiuneDiviziune(R.diviziuneNace(clasa)) },
  });
}

async function actionValideaza(req, res, user, perm) {
  const { serviciu_id, serviciu: draft } = req.body || {};
  if (!serviciu_id && !draft) throw new EroareCerere(400, 'Trimite serviciu_id sau serviciu (ciornă).', 'Send serviciu_id or serviciu (draft).');
  const s = serviciu_id ? await serviciu(serviciu_id) : { ...draft, id: null };
  const rezultat = await contextValidare(s, perm, req.body || {});
  if (serviciu_id) {
    date(await supabaseAdmin.from('catalog_servicii').update({ ruta_rezultat: rezultat, ruta_validata_la: new Date().toISOString() }).eq('id', serviciu_id));
    await inregistreazaAudit({ admin: user, req, actiune: 'ruta_valideaza', entitate: 'catalog_servicii', entitate_id: serviciu_id, detalii: { ok: rezultat.ok, erori: rezultat.erori.map((e) => e.cod), avertismente: rezultat.avertismente.map((a) => a.cod) } });
  }
  return res.status(200).json({ ok: true, rezultat });
}

// ── copiaza_din ───────────────────────────────────────────────────────────
const slug = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

async function copiazaArticolPeNivel(articolId, nivelNouId) {
  const a = date(await supabaseAdmin.from('devize_articole').select('*').eq('articol_id', articolId).maybeSingle());
  if (!a) return null;
  const variante = date(await supabaseAdmin.from('devize_articole').select('varianta')
    .eq('indicator_id', a.indicator_id).eq('simbol', a.simbol).order('varianta', { ascending: false }).limit(1));
  const { articol_id: _, ...rest } = a;
  const nou = date(await supabaseAdmin.from('devize_articole')
    .insert({ ...rest, varianta: (variante[0]?.varianta || 1) + 1, catalog_nivel_id: nivelNouId }).select('articol_id').single());
  const retete = date(await supabaseAdmin.from('devize_retete').select('resursa_id, consum_specific').eq('articol_id', articolId));
  if (retete.length) date(await supabaseAdmin.from('devize_retete').insert(retete.map((r) => ({ ...r, articol_id: nou.articol_id }))));
  return { sursa: articolId, nou: nou.articol_id, simbol: a.simbol };
}

async function actionCopiazaDin(req, res, user, perm) {
  const { serviciu_sursa_id, titlu, titlu_en, id_serviciu } = req.body || {};
  if (!serviciu_sursa_id || !String(titlu || '').trim()) {
    throw new EroareCerere(400, 'serviciu_sursa_id și titlu sunt obligatorii.', 'serviciu_sursa_id and titlu are required.');
  }
  const caps = await capitole();
  const sursa = await serviciu(serviciu_sursa_id);
  const { capitol } = await nodSiCapitol(sursa.nod_id, caps);
  cereCapitol(perm, capitol?.cod || R.capitolPentruNace(sursa.nace, caps));

  const nou = date(await supabaseAdmin.from('catalog_servicii').insert({
    id_serviciu: id_serviciu || `${slug(titlu)}-${Date.now().toString(36)}`,
    categorie: sursa.categorie, domeniu: sursa.domeniu, titlu: String(titlu).trim(),
    icon: sursa.icon, nace: sursa.nace, cod_esco: sursa.cod_esco, cod_uniclass: sursa.cod_uniclass,
    unitate_masura: sursa.unitate_masura, sectoare_client: sursa.sectoare_client || [],
    categorie_id: sursa.categorie_id, subcategorie_id: sursa.subcategorie_id, nod_id: sursa.nod_id,
    stare: 'ciorna', status_public: false, creat_din_serviciu_id: sursa.id,
    creat_de_tip: 'admin', creat_de: user.id,
  }).select('id, id_serviciu').single());

  let titluEnSalvat = false;
  if (String(titlu_en || '').trim()) {
    const { error } = await supabaseAdmin.from('catalog_servicii').update({ traduceri: { en: { titlu: String(titlu_en).trim() } } }).eq('id', nou.id);
    titluEnSalvat = !error;
  }

  // Nivelurile, fără prețuri; articolele de rețetă copiate ca variante noi.
  const niveluri = date(await supabaseAdmin.from('catalog_niveluri')
    .select('id, nivel, nivel_complexitate, norma_timp, materiale_baza_estimat, label, descriere, garantie_luni').eq('serviciu_id', sursa.id));
  const copiate = [];
  for (const n of niveluri) {
    const { id: idVechi, ...camp } = n;
    const nivNou = date(await supabaseAdmin.from('catalog_niveluri').insert({ ...camp, serviciu_id: nou.id }).select('id').single());
    const articole = date(await supabaseAdmin.from('devize_articole').select('articol_id').eq('catalog_nivel_id', idVechi));
    for (const a of articole) {
      const c = await copiazaArticolPeNivel(a.articol_id, nivNou.id);
      if (c) copiate.push({ ...c, nivel: n.nivel });
    }
  }

  await inregistreazaAudit({ admin: user, req, actiune: 'ruta_copiaza_din', entitate: 'catalog_servicii', entitate_id: nou.id, detalii: { sursa: sursa.id, niveluri: niveluri.length, articole: copiate } });
  return res.status(200).json({ ok: true, id: nou.id, id_serviciu: nou.id_serviciu, stare: 'ciorna', niveluri: niveluri.length, articole_copiate: copiate, titlu_en_salvat: titluEnSalvat });
}

// ── publica / retrage ─────────────────────────────────────────────────────
async function actionPublica(req, res, user, perm) {
  const { serviciu_id, confirm_avertismente } = req.body || {};
  if (!serviciu_id) throw new EroareCerere(400, 'serviciu_id obligatoriu.', 'serviciu_id is required.');
  const s = await serviciu(serviciu_id);
  const rezultat = await contextValidare(s, perm, req.body || {});
  date(await supabaseAdmin.from('catalog_servicii').update({ ruta_rezultat: rezultat, ruta_validata_la: new Date().toISOString() }).eq('id', serviciu_id));
  if (!rezultat.ok) {
    return res.status(422).json({ ok: false, cod: 'RUTA_INVALIDA', error: 'Ruta are erori: serviciul nu se poate publica.', error_en: 'The route has errors: the service cannot be published.', rezultat });
  }
  if (rezultat.avertismente.length && confirm_avertismente !== true) {
    return res.status(409).json({ ok: false, cod: 'CONFIRMARE_NECESARA', error: 'Ruta are avertismente: confirmă-le (confirm_avertismente: true) ca să publici.', error_en: 'The route has warnings: confirm them (confirm_avertismente: true) to publish.', rezultat });
  }
  date(await supabaseAdmin.from('catalog_servicii').update({ stare: 'publicat', status_public: true }).eq('id', serviciu_id));
  await inregistreazaAudit({ admin: user, req, actiune: 'ruta_publica', entitate: 'catalog_servicii', entitate_id: serviciu_id, detalii: { avertismente_confirmate: rezultat.avertismente.map((a) => a.cod) } });

  let notificare = { notificati: 0, motiv: 'fara_incercare' };
  try {
    notificare = await notificaParteneriEligibili({ catalogServiciuId: serviciu_id, nace: s.nace || null, titlu: s.titlu, categorie: s.categorie });
  } catch (e) {
    console.error('[admin/ruta-incadrare] notificare parteneri eșuată', e);
  }
  return res.status(200).json({ ok: true, stare: 'publicat', rezultat, parteneri_notificati: notificare.notificati || 0 });
}

async function actionRetrage(req, res, user, perm) {
  const { serviciu_id, motiv } = req.body || {};
  if (!serviciu_id) throw new EroareCerere(400, 'serviciu_id obligatoriu.', 'serviciu_id is required.');
  const caps = await capitole();
  const s = await serviciu(serviciu_id);
  const { capitol } = await nodSiCapitol(s.nod_id, caps);
  cereCapitol(perm, capitol?.cod || R.capitolPentruNace(s.nace, caps));
  date(await supabaseAdmin.from('catalog_servicii').update({ stare: 'retras', status_public: false }).eq('id', serviciu_id));
  await inregistreazaAudit({ admin: user, req, actiune: 'ruta_retrage', entitate: 'catalog_servicii', entitate_id: serviciu_id, detalii: { motiv: motiv || null } });
  return res.status(200).json({ ok: true, stare: 'retras' });
}

// ── Rețete propuse ────────────────────────────────────────────────────────
async function retetaCuServiciu(retetaId, perm) {
  const reteta = date(await supabaseAdmin.from('retete_propuse').select('*').eq('id', retetaId).maybeSingle());
  if (!reteta) throw new EroareCerere(404, 'Rețeta propusă nu există.', 'The proposed recipe does not exist.');
  const caps = await capitole();
  const s = await serviciu(reteta.catalog_serviciu_id);
  const { capitol } = await nodSiCapitol(s.nod_id, caps);
  cereCapitol(perm, capitol?.cod || R.capitolPentruNace(s.nace, caps));
  return { reteta, serviciu: s };
}
function ceReDeschisa(reteta) {
  if (reteta.stare !== 'propusa') {
    throw new EroareCerere(409, `Rețeta e deja ${reteta.stare}.`, `The recipe is already ${reteta.stare === 'aprobata' ? 'approved' : 'rejected'}.`);
  }
}

async function actionPropuneReteta(req, res, user, perm) {
  const { serviciu_id, catalog_nivel_id } = req.body || {};
  if (!serviciu_id) throw new EroareCerere(400, 'serviciu_id obligatoriu.', 'serviciu_id is required.');
  const caps = await capitole();
  const s = await serviciu(serviciu_id);
  const { capitol } = await nodSiCapitol(s.nod_id, caps);
  cereCapitol(perm, capitol?.cod || R.capitolPentruNace(s.nace, caps));
  date(await supabaseAdmin.from('retete_propuse').select('id').limit(1)); // cere migrarea

  const clasa = R.normalizeazaNace(s.nace);
  const catalog = await catalogCuRetete();
  const asemanatoare = R.serviciiAsemanatoare(s, catalog).slice(0, 10);
  const articoleAsemanatoare = asemanatoare
    .filter((x) => x.are_reteta)
    .flatMap((x) => (catalog.find((c) => c.id === x.serviciu.id)?.articole || []).map((a) => ({ ...a, serviciu_titlu: x.serviciu.titlu, nivel_potrivire: x.nivel_potrivire })));

  const indicatori = date(await supabaseAdmin.from('devize_indicatoare').select('indicator_id, denumire_indicator, nace_cod, uniclass_ac_code'));
  const deCitit = new Set([
    ...(INDICATORI_PE_ACTIVITATE[s.cod_uniclass] || []),
    ...indicatori.filter((i) => clasa && R.normalizeazaNace(i.nace_cod) === clasa).map((i) => i.indicator_id),
  ]);
  const articolePeIndicator = {};
  for (const ind of deCitit) {
    articolePeIndicator[ind] = date(await citesteTot(() => supabaseAdmin.from('devize_articole')
      .select('articol_id, simbol, varianta, denumire_articol, unitate_masura').eq('indicator_id', ind).order('articol_id')));
  }
  const escoRow = s.cod_esco ? date(await supabaseAdmin.from('competente_esco').select('cod_esco, isco_group').eq('cod_esco', s.cod_esco).maybeSingle()) : null;
  const grupa = escoRow?.isco_group || (s.cod_esco ? String(s.cod_esco).slice(0, 4) : null);
  const resurseManopera = grupa ? date(await supabaseAdmin.from('devize_resurse')
    .select('resursa_id, cod_resursa, denumire_resursa, unitate_masura, esco_cod').eq('tip_resursa', 'F').like('esco_cod', `${grupa}%`)) : [];
  const uniclassCoduri = await coduriUniclassActive(RESURSE_NOI_PE_TEMA.flatMap((t) => t.resurse.map((r) => r.cod_uniclass)));

  const { linii, rezumat } = propuneReteta({
    serviciu: s, ruta: { clasa, esco: escoRow }, asemanatoare,
    ref: { indicatori, articolePeIndicator, articoleAsemanatoare, resurseManopera, uniclassCoduri },
  });
  if (!linii.length) throw new EroareCerere(422, 'Nu am găsit nimic de propus pentru acest serviciu.', 'Nothing to propose for this service.');

  const { data: reteta, error } = await supabaseAdmin.from('retete_propuse').insert({
    catalog_serviciu_id: s.id, catalog_nivel_id: catalog_nivel_id || null, stare: 'propusa', sursa: 'automat', propusa_de: user.id,
  }).select('id').single();
  if (error?.code === '23505') throw new EroareCerere(409, 'Există deja o rețetă propusă deschisă pentru acest serviciu și nivel.', 'There is already an open proposed recipe for this service and level.');
  date({ data: reteta, error });
  const salvate = date(await supabaseAdmin.from('retete_propuse_linii').insert(linii.map((l) => ({ ...l, reteta_id: reteta.id }))).select('*'));

  await inregistreazaAudit({ admin: user, req, actiune: 'ruta_propune_reteta', entitate: 'retete_propuse', entitate_id: reteta.id, detalii: { serviciu: s.id, ...rezumat } });
  return res.status(200).json({ ok: true, reteta_id: reteta.id, stare: 'propusa', rezumat, linii: salvate });
}

async function actionDecideLinie(req, res, user, perm) {
  const { linie_id, decizie, consum_propus, resursa_id, articol_id, denumire_propusa, unitate_masura, tip_resursa } = req.body || {};
  if (!linie_id || !['acceptata', 'modificata', 'respinsa'].includes(decizie)) {
    throw new EroareCerere(400, 'linie_id și decizie (acceptata / modificata / respinsa) sunt obligatorii.', 'linie_id and decizie (acceptata / modificata / respinsa) are required.');
  }
  const linie = date(await supabaseAdmin.from('retete_propuse_linii').select('*').eq('id', linie_id).maybeSingle());
  if (!linie) throw new EroareCerere(404, 'Linia nu există.', 'The line does not exist.');
  const { reteta } = await retetaCuServiciu(linie.reteta_id, perm);
  ceReDeschisa(reteta);

  const update = { decizie };
  if (consum_propus !== undefined) {
    if (consum_propus !== null && !(Number(consum_propus) > 0)) throw new EroareCerere(400, 'Cantitatea trebuie să fie un număr pozitiv.', 'The quantity must be a positive number.');
    update.consum_propus = consum_propus === null ? null : Number(consum_propus);
  }
  if (decizie === 'modificata') {
    if (resursa_id !== undefined) update.resursa_id = resursa_id;
    if (articol_id !== undefined) update.articol_id = articol_id;
    if (denumire_propusa !== undefined) update.denumire_propusa = denumire_propusa;
    if (unitate_masura !== undefined) update.unitate_masura = unitate_masura;
    if (tip_resursa !== undefined) update.tip_resursa = tip_resursa;
  }
  const salvata = date(await supabaseAdmin.from('retete_propuse_linii').update(update).eq('id', linie_id).select('*').single());
  await inregistreazaAudit({ admin: user, req, actiune: 'ruta_decide_linie', entitate: 'retete_propuse_linii', entitate_id: linie_id, detalii: update });
  return res.status(200).json({ ok: true, linie: salvata });
}

async function actionAprobaReteta(req, res, user, perm) {
  const { reteta_id, catalog_nivel_id } = req.body || {};
  if (!reteta_id) throw new EroareCerere(400, 'reteta_id obligatoriu.', 'reteta_id is required.');
  const { reteta, serviciu: s } = await retetaCuServiciu(reteta_id, perm);
  ceReDeschisa(reteta);
  const nivelId = catalog_nivel_id || reteta.catalog_nivel_id;
  if (!nivelId) throw new EroareCerere(422, 'Alege nivelul (catalog_nivel_id) de care se leagă rețeta.', 'Choose the level (catalog_nivel_id) the recipe is linked to.');
  const nivel = date(await supabaseAdmin.from('catalog_niveluri').select('id, serviciu_id').eq('id', nivelId).maybeSingle());
  if (!nivel || nivel.serviciu_id !== s.id) throw new EroareCerere(422, 'Nivelul nu aparține serviciului.', 'The level does not belong to the service.');

  const linii = date(await supabaseAdmin.from('retete_propuse_linii').select('*').eq('reteta_id', reteta_id));
  const verificare = verificaAprobare(linii);
  if (!verificare.ok) {
    return res.status(422).json({ ok: false, cod: 'APROBARE_REFUZATA', error: verificare.erori.map((e) => e.mesaj_ro).join(' '), error_en: verificare.erori.map((e) => e.mesaj_en).join(' '), erori: verificare.erori });
  }

  const idArticole = linii.filter((l) => l.tip === 'articol_existent' && l.decizie !== 'respinsa').map((l) => l.articol_id);
  const reteteArt = idArticole.length ? date(await supabaseAdmin.from('devize_retete').select('articol_id, resursa_id, consum_specific').in('articol_id', idArticole)) : [];
  const reteteArticole = {};
  reteteArt.forEach((r) => { (reteteArticole[r.articol_id] = reteteArticole[r.articol_id] || []).push(r); });
  const plan = planAprobare(linii, reteteArticole);

  // Coduri cu cheie externă: se scriu pe resursă doar dacă există.
  const temaSistem = temePentruTitlu(s.titlu).find((t) => t.cod_sistem)?.cod_sistem || null;
  const coduriUc = await coduriUniclassActive([s.cod_uniclass, temaSistem, ...linii.map((l) => l.cod_uniclass)]);
  const escoNoi = [...new Set(plan.noi.map((n) => n.linie.cod_esco).filter(Boolean))];
  const escoExista = new Set(escoNoi.length ? date(await supabaseAdmin.from('competente_esco').select('cod_esco').in('cod_esco', escoNoi)).map((e) => e.cod_esco) : []);

  const create = { resurse: [], articol: null };
  try {
    // 1. Resursele noi (sursa_catalog = catalog_nou_2026, ca rețetele manuale), fără tarif.
    let k = 0;
    for (const n of plan.noi) {
      k++;
      const l = n.linie;
      const r = date(await supabaseAdmin.from('devize_resurse').insert({
        tip_resursa: l.tip_resursa, cod_resursa: `MDR-${reteta_id.slice(0, 8)}-${k}`, denumire_resursa: l.denumire_propusa,
        unitate_masura: l.unitate_masura, sursa_catalog: 'catalog_nou_2026',
        uniclass_pr_cod: l.cod_uniclass && l.cod_uniclass.startsWith('Pr_') && coduriUc.has(l.cod_uniclass) ? l.cod_uniclass : null,
        esco_cod: l.tip_resursa === 'F' && escoExista.has(l.cod_esco) ? l.cod_esco : null,
      }).select('resursa_id').single());
      create.resurse.push({ linie_id: l.id, resursa_id: r.resursa_id, consum_specific: n.consum_specific });
    }

    // 2. Articolul rețetei, sub indicatorul MDR, legat de nivel.
    const ultimul = date(await supabaseAdmin.from('devize_articole').select('simbol').eq('indicator_id', 'MDR').order('simbol', { ascending: false }).limit(1));
    const nr = (parseInt(String(ultimul[0]?.simbol || 'MDR0000').slice(3, 7), 10) || 0) + 1;
    const articol = date(await supabaseAdmin.from('devize_articole').insert({
      indicator_id: 'MDR', simbol: `MDR${String(nr).padStart(4, '0')}A1`, varianta: 1,
      denumire_articol: s.titlu, unitate_masura: s.unitate_masura || 'buc',
      uniclass_activity_code: s.cod_uniclass && s.cod_uniclass.startsWith('Ac_') && coduriUc.has(s.cod_uniclass) ? s.cod_uniclass : null,
      uniclass_system_code: temaSistem && coduriUc.has(temaSistem) ? temaSistem : null,
      catalog_nivel_id: nivelId,
    }).select('articol_id, simbol').single());
    create.articol = articol;

    // 3. Rețeta articolului.
    const randuri = [
      ...plan.existente.map((r) => ({ articol_id: articol.articol_id, resursa_id: r.resursa_id, consum_specific: r.consum_specific })),
      ...create.resurse.map((r) => ({ articol_id: articol.articol_id, resursa_id: r.resursa_id, consum_specific: r.consum_specific })),
    ];
    if (randuri.length) date(await supabaseAdmin.from('devize_retete').insert(randuri));
  } catch (e) {
    // Fără tranzacție în API: anulăm ce s-a creat, ca să nu rămână jumătăți de rețetă.
    if (create.articol) await supabaseAdmin.from('devize_articole').delete().eq('articol_id', create.articol.articol_id);
    if (create.resurse.length) await supabaseAdmin.from('devize_resurse').delete().in('resursa_id', create.resurse.map((r) => r.resursa_id));
    throw e;
  }

  for (const r of create.resurse) {
    await supabaseAdmin.from('retete_propuse_linii').update({ resursa_id: r.resursa_id }).eq('id', r.linie_id);
  }
  date(await supabaseAdmin.from('retete_propuse').update({
    stare: 'aprobata', aprobata_de: user.id, aprobata_la: new Date().toISOString(), catalog_nivel_id: nivelId, articol_creat_id: create.articol.articol_id,
  }).eq('id', reteta_id));
  await inregistreazaAudit({ admin: user, req, actiune: 'ruta_aproba_reteta', entitate: 'retete_propuse', entitate_id: reteta_id, detalii: { articol: create.articol, resurse_noi: create.resurse.length, resurse_existente: plan.existente.length } });

  return res.status(200).json({
    ok: true, stare: 'aprobata', articol: create.articol, resurse_noi: create.resurse.map((r) => r.resursa_id),
    nota: create.resurse.length ? 'Resursele noi n-au tarif: prețul rămâne „la cerere” până se completează tarifele.' : null,
    nota_en: create.resurse.length ? 'The new resources have no rate: the price stays "on request" until the rates are filled in.' : null,
  });
}

async function actionRespingeReteta(req, res, user, perm) {
  const { reteta_id, motiv } = req.body || {};
  if (!reteta_id || !String(motiv || '').trim()) throw new EroareCerere(400, 'reteta_id și motiv sunt obligatorii.', 'reteta_id and motiv are required.');
  const { reteta } = await retetaCuServiciu(reteta_id, perm);
  ceReDeschisa(reteta);
  date(await supabaseAdmin.from('retete_propuse').update({ stare: 'respinsa', motiv_respingere: String(motiv).trim() }).eq('id', reteta_id));
  await inregistreazaAudit({ admin: user, req, actiune: 'ruta_respinge_reteta', entitate: 'retete_propuse', entitate_id: reteta_id, detalii: { motiv } });
  return res.status(200).json({ ok: true, stare: 'respinsa' });
}

// ── Router ────────────────────────────────────────────────────────────────
const ACTIUNI = {
  pasi: actionPasi,
  cauta_asemanatoare: actionCautaAsemanatoare,
  valideaza: actionValideaza,
  copiaza_din: actionCopiazaDin,
  publica: actionPublica,
  retrage: actionRetrage,
  propune_reteta: actionPropuneReteta,
  decide_linie: actionDecideLinie,
  aproba_reteta: actionAprobaReteta,
  respinge_reteta: actionRespingeReteta,
};

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const perm = await permisiune(user);
  if (!perm) {
    return res.status(403).json({ ok: false, error: 'Nu ai drept pe catalogul de servicii (admin_permissions: catalog_servicii, poate_scrie).', error_en: 'You have no rights on the service catalogue (admin_permissions: catalog_servicii, poate_scrie).' });
  }
  const { action } = req.body || {};
  const fn = ACTIUNI[action];
  if (!fn) return res.status(400).json({ error: `action invalidă. Trebuie una din: ${Object.keys(ACTIUNI).join(', ')}`, error_en: `Invalid action. Must be one of: ${Object.keys(ACTIUNI).join(', ')}` });
  try {
    return await fn(req, res, user, perm);
  } catch (e) {
    if (e instanceof MigrareLipsa) return res.status(409).json(MESAJ_MIGRARE);
    if (e instanceof EroareCerere) return res.status(e.status).json({ ok: false, error: e.error, error_en: e.error_en, ...(e.extra || {}) });
    console.error(`[admin/ruta-incadrare] ${action}`, e);
    return res.status(500).json({ ok: false, error: 'Eroare internă.', error_en: 'Internal error.' });
  }
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
module.exports._intern = { permisiune, eLipsaSchema, MESAJ_MIGRARE };
