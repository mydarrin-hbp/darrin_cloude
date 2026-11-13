// /api/public/marketplace-produse.js
// Marketplace-ul public (pasul 10a, 16 oct. 2026): produsele reale din
// marketplace_materiale / marketplace_echipamente, doar `status = 'live'` și
// active, prin service role — pagina nu mai citește REST direct cu cheia anon.
//
// GET ?tip=materiale|echipamente&nod=<slug>&q=<text>&pagina=1&pe_pagina=24&lang=ro|en&tara_cod=RO
//   → { ok, tip, moneda, noduri: [{ slug, title, title_en, numar }], produse, total, pagina, pe_pagina }
//     Nodurile sunt cele din capitolele G (materiale) / O77 (închirieri) cu
//     cel puțin un produs live; un nod fără produse live nu apare.
// GET ?id=mp:<tip>:<uuid>&lang=…&tara_cod=… → { ok, produs } (revenirea în configurator)
// POST { produse: [{ id: 'mp:<tip>:<uuid>', qty }], tara_cod } → prețul real al
//   comenzii (aceeași formulă ca api/comenzi/creeaza.js):
//   { ok, disponibil, pret_final, tva_suma, tva_pct, moneda, prag_minim_comanda, itemi }
//
// Prețul afișat al unui produs = prețul public unitar, cu formula platformei
// (lib/calculeaza-pret.js): costul furnizorului (fără TVA) + asigurare +
// comision + marketing + mentenanță + TVA, fără pragul minim de comandă (care
// se aplică întregii comenzi). Discountul furnizorului nu apare nicăieri aici.
// Furnizorul propriu al platformei apare ca „Home Best Pal”.
//
// Pasul 10c (16 oct. 2026): apar doar produsele furnizorilor care pot vinde
// (regula unică din lib/eligibilitate-partener.js). Un furnizor respins sau
// care pierde dreptul (ex. contract reziliat) dispare din marketplace, fără
// ca produsele lui să fie șterse.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');
const v = require('../../lib/valideaza');
const { incarcaConfigPret, aplicaFormulaPret, calculeazaPret } = require('../../lib/calculeaza-pret');
const { rezolvaAddonMateriale, parseazaIdMarketplace } = require('../../lib/rezolva-addon-materiale');
const { furnizoriProprii } = require('../../lib/furnizor-propriu');
const { citesteTot } = require('../../lib/citeste-tot');
const { parteneriCarePotVinde } = require('../../lib/eligibilitate-partener');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

const NUME_FURNIZOR_PROPRIU = 'Home Best Pal';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPURI = {
  materiale: { tabel: 'marketplace_materiale', capitol: 'G', tipNod: 'materiale', cost: 'pret_fara_tva', componenta: 'cost_materiale' },
  echipamente: { tabel: 'marketplace_echipamente', capitol: 'O77', tipNod: 'inchirieri', cost: 'tarif_zi', componenta: 'cost_chirie_scule' },
};
const PE_PAGINA_IMPLICIT = 24;
const PE_PAGINA_MAXIM = 48;

function tara(req) {
  const t = String(req.query?.tara_cod || req.body?.tara_cod || 'RO').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? t : 'RO';
}

async function monedaTarii(taraCod) {
  const { data } = await supabaseAdmin.from('tax_configurations').select('moneda').eq('tara_cod', taraCod).maybeSingle();
  return data?.moneda || null;
}

// Nodurile de meniu ale capitolului; până la pasul 10, nodurile de tipul
// potrivit fără capitol_cod sunt considerate ale capitolului (aceeași
// tranziție ca la import, lib/ruta-incadrare.js).
async function noduriCapitol(cfg) {
  const { data } = await supabaseAdmin
    .from('categorii')
    .select('id, slug, title, title_en, capitol_cod, category_type, display_order, activ')
    .eq('activ', true);
  return (data || []).filter((n) => n.capitol_cod === cfg.capitol || (!n.capitol_cod && n.category_type === cfg.tipNod));
}

function imaginiPublice(imagini) {
  return (Array.isArray(imagini) ? imagini : [])
    .map((img) => (typeof img === 'string' ? img : img?.url))
    .filter((u) => typeof u === 'string' && /^https:\/\//.test(u))
    .slice(0, 6);
}

function produsPublic(r, tip, { cfgPret, numeFurnizor, nod, lang }) {
  const cfg = TIPURI[tip];
  const en = lang === 'en' ? (r.traduceri && r.traduceri.en) || {} : {};
  const cost = Number(r[cfg.cost]);
  const pret = aplicaFormulaPret({ [cfg.componenta]: cost }, cfgPret, undefined, { cuPragMinim: false });
  return {
    id: `mp:${tip}:${r.id}`,
    tip,
    denumire: en.denumire || r.denumire,
    descriere: en.descriere || r.descriere,
    descriere_pret: en.descriere_pret || r.descriere_pret,
    // Textul românesc al produsului, fără traducere EN (marcat pe pagină cu lang="ro").
    limba_text: lang === 'en' && !en.denumire ? 'ro' : lang,
    unitate: tip === 'materiale' ? r.unitate_masura : 'zi',
    pret_cu_tva: pret.pret_final,
    stoc: tip === 'materiale' ? Number(r.stoc_disponibil) || 0 : Number(r.buc_disponibile) || 0,
    lead_time_zile: tip === 'materiale' ? Number(r.lead_time_zile) || 0 : null,
    operator_inclus: tip === 'echipamente' ? r.operator_inclus : null,
    imagini: imaginiPublice(r.imagini),
    furnizor: numeFurnizor,
    nod: nod ? { slug: nod.slug, title: nod.title, title_en: nod.title_en } : null,
  };
}

async function numeFurnizori(randuri) {
  const ids = [...new Set(randuri.map((r) => r.furnizor_id))];
  const [proprii, { data: parteneri }] = await Promise.all([
    furnizoriProprii(ids),
    ids.length ? supabaseAdmin.from('partners').select('id, nume_firma').in('id', ids) : Promise.resolve({ data: [] }),
  ]);
  const nume = {};
  (parteneri || []).forEach((p) => { nume[p.id] = p.nume_firma || null; });
  ids.forEach((id) => { if (proprii.has(id)) nume[id] = NUME_FURNIZOR_PROPRIU; });
  return nume;
}

async function handleProdus(req, res) {
  const parsat = parseazaIdMarketplace(req.query.id);
  if (!parsat) return trimiteEroare(res, 400, 'DATE_INVALIDE', 'Id de produs invalid.', 'Invalid product id.', ['id']);
  const cfg = TIPURI[parsat.tip];
  const taraCod = tara(req);
  const lang = req.query.lang === 'ro' ? 'ro' : 'en';
  const [{ data: r }, moneda, cfgPret] = await Promise.all([
    supabaseAdmin.from(cfg.tabel).select('*').eq('id', parsat.id).eq('status', 'live').eq('activ', true).maybeSingle(),
    monedaTarii(taraCod),
    incarcaConfigPret(taraCod),
  ]);
  if (!r || (moneda && r.moneda !== moneda)) return trimiteEroare(res, 404, 'PRODUS_NU_EXISTA', 'Produsul nu mai este disponibil.', 'The product is no longer available.');
  if (!(await parteneriCarePotVinde([r.furnizor_id])).has(r.furnizor_id)) return trimiteEroare(res, 404, 'PRODUS_NU_EXISTA', 'Produsul nu mai este disponibil.', 'The product is no longer available.');
  const noduri = await noduriCapitol(cfg);
  const nume = await numeFurnizori([r]);
  const produs = produsPublic(r, parsat.tip, { cfgPret, numeFurnizor: nume[r.furnizor_id] || null, nod: noduri.find((n) => n.id === r.categorie_id), lang });
  return res.status(200).json({ ok: true, moneda, produs });
}

async function handleLista(req, res) {
  const tip = req.query.tip === 'echipamente' ? 'echipamente' : 'materiale';
  const cfg = TIPURI[tip];
  const taraCod = tara(req);
  const lang = req.query.lang === 'ro' ? 'ro' : 'en';
  const peP = Math.min(Math.max(parseInt(req.query.pe_pagina, 10) || PE_PAGINA_IMPLICIT, 1), PE_PAGINA_MAXIM);
  const pagina = Math.max(parseInt(req.query.pagina, 10) || 1, 1);

  const [moneda, cfgPret, noduri] = await Promise.all([monedaTarii(taraCod), incarcaConfigPret(taraCod), noduriCapitol(cfg)]);
  const goala = { ok: true, tip, moneda, noduri: [], produse: [], total: 0, pagina, pe_pagina: peP };
  if (!moneda) return res.status(200).json(goala);

  // Nodurile cu produse live (numărul pe nod), din toată lista, nu din pagină,
  // doar ale furnizorilor care pot vinde.
  const { data: toateLive, error: eroareToate } = await citesteTot(() => supabaseAdmin
    .from(cfg.tabel).select('id, categorie_id, furnizor_id').eq('status', 'live').eq('activ', true).eq('moneda', moneda).order('id'));
  if (eroareToate) return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca produsele.', 'We could not load the products.');
  const furnizoriActivi = await parteneriCarePotVinde((toateLive || []).map((p) => p.furnizor_id));
  if (!furnizoriActivi.size) return res.status(200).json(goala);
  const toate = (toateLive || []).filter((p) => furnizoriActivi.has(p.furnizor_id));
  const nodPeId = new Map(noduri.map((n) => [n.id, n]));
  const numar = new Map();
  (toate || []).forEach((p) => { if (nodPeId.has(p.categorie_id)) numar.set(p.categorie_id, (numar.get(p.categorie_id) || 0) + 1); });
  const noduriCuProduse = noduri
    .filter((n) => numar.has(n.id))
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || String(a.title).localeCompare(String(b.title), 'ro'))
    .map((n) => ({ slug: n.slug, title: n.title, title_en: n.title_en, numar: numar.get(n.id) }));
  if (!noduriCuProduse.length) return res.status(200).json(goala);

  const nodCerut = req.query.nod ? noduri.find((n) => n.slug === String(req.query.nod)) : null;
  const iduriNod = nodCerut ? [nodCerut.id] : noduri.filter((n) => numar.has(n.id)).map((n) => n.id);

  let query = supabaseAdmin
    .from(cfg.tabel)
    .select('*', { count: 'exact' })
    .eq('status', 'live')
    .eq('activ', true)
    .eq('moneda', moneda)
    .in('furnizor_id', [...furnizoriActivi])
    .in('categorie_id', iduriNod)
    .order('denumire', { ascending: true })
    .order('id', { ascending: true });
  const q = String(req.query.q || '').trim().slice(0, 80).replace(/[%_\\,()]/g, ' ').trim();
  if (q) query = query.ilike('denumire', `%${q}%`);
  const deLa = (pagina - 1) * peP;
  const { data: randuri, count, error } = await query.range(deLa, deLa + peP - 1);
  if (error) return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca produsele.', 'We could not load the products.');

  const nume = await numeFurnizori(randuri || []);
  const produse = (randuri || []).map((r) => produsPublic(r, tip, { cfgPret, numeFurnizor: nume[r.furnizor_id] || null, nod: nodPeId.get(r.categorie_id), lang }));
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.status(200).json({ ok: true, tip, moneda, noduri: noduriCuProduse, produse, total: count ?? produse.length, pagina, pe_pagina: peP });
}

// Pasul 11-S1: tipuri, lungimi și câmpurile acceptate la calculul prețului.
const SCHEMA_PRET = {
  produse: v.lista(v.ITEM_PRODUS, { max: 50, eticheta: ['Produse', 'Products'] }),
  tara_cod: v.text({ max: 8, eticheta: ['Țară', 'Country'] }),
};

async function handlePret(req, res) {
  if (!v.valideazaSauTrimite(req, res, SCHEMA_PRET)) return;
  const { produse } = req.body || {};
  if (!Array.isArray(produse) || !produse.length || produse.length > 50) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', 'produse trebuie să fie o listă de 1–50 de produse {id, qty}.', 'produse must be a list of 1–50 products {id, qty}.', ['produse']);
  }
  // Pasul 11-C1: și materialele din catalog, din coș — {id: catalog_servicii.id, qty, nivel}.
  const esteValid = (p) => !!p && (!!parseazaIdMarketplace(p.id) || (typeof p.id === 'string' && UUID.test(p.id) && typeof p.nivel === 'string' && p.nivel.length > 0));
  if (!produse.every(esteValid)) return trimiteEroare(res, 400, 'DATE_INVALIDE', 'Id de produs invalid.', 'Invalid product id.', ['id']);
  const taraCod = tara(req);
  let rez;
  try {
    rez = await rezolvaAddonMateriale(produse, null, taraCod);
  } catch (e) {
    if (e.code === 'ADDON_FARA_PRET' || e.code === 'ADDON_INVALID') return res.status(200).json({ ok: true, disponibil: false, mesaj: e.message });
    throw e;
  }
  const calc = await calculeazaPret({ cost_materiale: rez.cost_materiale, cost_chirie_scule: rez.cost_utilaj, tara: taraCod });
  return res.status(200).json({
    ok: true, disponibil: true, moneda: await monedaTarii(taraCod),
    pret_final: calc.pret_final, tva_suma: calc.tva_suma, tva_pct: calc.tva_pct, prag_minim_comanda: calc.prag_minim_comanda,
    itemi: rez.itemi.map((i) => ({ id: i.produs_marketplace_id ? `mp:${i.tip_marketplace}:${i.produs_marketplace_id}` : i.catalog_serviciu_id, titlu: i.titlu, qty: i.qty, unitate_masura: i.unitate_masura })),
  });
}

module.exports = async function handler(req, res) {
  const allowed = await checkRateLimit(req, { key: 'marketplace-produse', limit: 120, windowSeconds: 60 });
  if (!allowed) return trimiteEroare(res, 429, 'PREA_MULTE_CERERI', 'Prea multe cereri. Încearcă din nou mai târziu.', 'Too many requests. Please try again later.');
  try {
    if (req.method === 'GET') return req.query?.id ? await handleProdus(req, res) : await handleLista(req, res);
    if (req.method === 'POST') return await handlePret(req, res);
    return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  } catch (e) {
    console.error('[public/marketplace-produse]', e);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca produsele.', 'We could not load the products.');
  }
};
