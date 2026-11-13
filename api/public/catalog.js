// /api/public/catalog.js
// Pasul 11-C10: tot ce are nevoie mydarrin-catalog.html, într-o singură cerere
// (înainte: șapte cereri spre Supabase și spre catalog-categorie).
//
// GET ?tara=RO&lang=ro|en
// -> { ok, tara, lang,
//      servicii: [produs], materiale: [produs], inchirieri: [produs],
//      relatii: [{ catalog_serviciu_id, catalog_relatie_id }],
//      servicii_asociate: [{ id, id_serviciu, titlu }] }
// produs = { id, id_serviciu, titlu, domeniu, unitate_masura, descriere, imagini,
//            categorie_id, subcategorie_id, pret_de_la, are_pret, traduceri? }
//
// Doar produse publice și doar câmpurile de mai sus, alese unul câte unul:
// fără discounturi de partener, costuri interne sau autori. `traduceri.en`
// apare numai la lang=en. Prețul: aceeași funcție ca în catalog-categorie.
// Răspunsul depinde doar de `tara` și `lang`, deci poate sta în cache-ul CDN.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');
const { citesteTot } = require('../../lib/citeste-tot');
const { preturiDeLa } = require('../../lib/catalog-preturi');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

const TIPURI = ['servicii', 'materiale', 'inchirieri'];
const COLOANE = 'id, id_serviciu, titlu, domeniu, unitate_masura, descriere, imagini, categorie, categorie_id, subcategorie_id';

function citesteProduse(coloane) {
  return citesteTot(() => supabaseAdmin
    .from('catalog_servicii').select(coloane).eq('status_public', true).in('categorie', TIPURI)
    .order('domeniu').order('titlu').order('id'));
}

// Cu lang=en se cer și traducerile; dacă lipsește coloana (migrare neaplicată),
// catalogul se servește fără ele, ca în traduceri-catalog.
async function produsePublice(lang) {
  if (lang === 'en') {
    const cuTraduceri = await citesteProduse(COLOANE + ', traduceri');
    if (!cuTraduceri.error) return cuTraduceri;
    console.warn('[public/catalog] fără traduceri:', cuTraduceri.error.message);
  }
  return citesteProduse(COLOANE);
}

function formaPublica(p, pret, lang) {
  const produs = {
    id: p.id,
    id_serviciu: p.id_serviciu,
    titlu: p.titlu,
    domeniu: p.domeniu,
    unitate_masura: p.unitate_masura,
    descriere: p.descriere,
    imagini: p.imagini,
    categorie_id: p.categorie_id,
    subcategorie_id: p.subcategorie_id,
    pret_de_la: pret.pret_de_la,
    are_pret: pret.are_pret,
  };
  const en = lang === 'en' && p.traduceri && p.traduceri.en;
  if (en && Object.keys(en).length) produs.traduceri = { en };
  return produs;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  const allowed = await checkRateLimit(req, { key: 'catalog', limit: 120, windowSeconds: 60 });
  if (!allowed) return trimiteEroare(res, 429, 'PREA_MULTE_CERERI', 'Prea multe cereri. Încearcă din nou mai târziu.', 'Too many requests. Please try again later.');

  const taraCeruta = String(req.query?.tara || '').trim().toUpperCase();
  const tara = /^[A-Z]{2}$/.test(taraCeruta) ? taraCeruta : 'RO';
  const lang = req.query?.lang === 'ro' ? 'ro' : 'en';

  try {
    const [rezProduse, rezRelatii] = await Promise.all([
      produsePublice(lang),
      citesteTot(() => supabaseAdmin
        .from('catalog_relatii').select('catalog_serviciu_id, catalog_relatie_id').eq('tip_relatie', 'obiect_asociat')
        .order('catalog_serviciu_id').order('catalog_relatie_id')),
    ]);
    if (rezProduse.error) throw new Error(rezProduse.error.message);
    if (rezRelatii.error) throw new Error(rezRelatii.error.message);

    const produse = rezProduse.data || [];
    const preturi = await preturiDeLa(produse, tara);
    const peTip = (tip) => produse.filter((p) => p.categorie === tip).map((p) => formaPublica(p, preturi[p.id], lang));

    // Serviciile de calorifere afișate ca butoane pe cardurile de materiale.
    const asociate = produse.filter((p) => p.categorie === 'servicii' && String(p.id_serviciu || '').startsWith('cal-'))
      .map((p) => ({ id: p.id, id_serviciu: p.id_serviciu, titlu: p.titlu }));
    // Doar legăturile dintre produse pe care pagina le poate afișa.
    const materiale = new Set(produse.filter((p) => p.categorie === 'materiale').map((p) => p.id));
    const iduriAsociate = new Set(asociate.map((p) => p.id));
    const relatii = (rezRelatii.data || [])
      .filter((r) => materiale.has(r.catalog_serviciu_id) && iduriAsociate.has(r.catalog_relatie_id))
      .map((r) => ({ catalog_serviciu_id: r.catalog_serviciu_id, catalog_relatie_id: r.catalog_relatie_id }));

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      ok: true, tara, lang,
      servicii: peTip('servicii'), materiale: peTip('materiale'), inchirieri: peTip('inchirieri'),
      relatii, servicii_asociate: asociate,
    });
  } catch (err) {
    console.error('[public/catalog]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca catalogul.', 'We could not load the catalogue.');
  }
};
