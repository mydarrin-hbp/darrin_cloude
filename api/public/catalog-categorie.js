// /api/public/catalog-categorie.js
// Pasul 11-C4 (4 nov. 2026): paginile de categorie trimit acum spre catalog;
// endpoint-ul dă prețurile „de la” ale catalogului (mydarrin-catalog.html),
// cu `toate=1` (toate produsele publice ale tipului) sau pe o categorie.
//
// Pasul 11-C2 (3 nov. 2026, regula LM): produsele unei pagini de categorie
// (mydarrin-categorie-servicii / -materiale / -inchirieri.html), din catalogul
// real — același ca mydarrin-catalog.html (catalog_servicii cu status_public),
// în locul listelor scrise de mână, cu prețuri și imagini inventate.
//
// Prețul „de la” vine doar din catalog_preturi: cel mai mic preț al unui nivel
// fără rețetă, pentru țară, trecut prin formula publică (lib/calculeaza-pret.js:
// asigurare, comision, marketing, mentenanță, TVA), pe unitate — fără pragul
// minim de comandă, care se aplică totalului comenzii. Fără preț: null (pagina
// nu afișează nicio cifră). Imaginile: doar cele din catalog. Fără discounturi
// de partener sau costuri interne.
//
// GET ?cat=<slug din categorii> | toate=1, &tip=servicii|materiale|inchirieri&tara=RO
// -> { ok, categorie: { slug, title, title_en, description, icon_name } | null,
//      produse: [{ id, slug, titlu, descriere, unitate, imagine, tip, pret_de_la, are_pret }],
//      are_pret: produsul are un preț real (rețetă sau catalog_preturi) — fără el, „Cere un deviz”.
//      pret_maxim, moneda }

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');
const { incarcaConfigPret, aplicaFormulaPret } = require('../../lib/calculeaza-pret');

const TIPURI = { servicii: 'servicii', materiale: 'materiale', inchirieri: 'inchirieri', inchiriere: 'inchirieri' };

function text(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const allowed = await checkRateLimit(req, { key: 'catalog-categorie', limit: 120, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.' });

  const slug = text(req.query?.cat, 120);
  const tip = TIPURI[text(req.query?.tip, 20)] || 'servicii';
  const tara = (text(req.query?.tara, 2) || 'RO').toUpperCase();
  const toate = String(req.query?.toate || '') === '1';

  try {
    // Categoria și subcategoriile ei.
    let categorie = null;
    let iduri = [];
    if (slug) {
      const { data: cat } = await supabaseAdmin
        .from('categorii').select('id, slug, title, title_en, description, icon_name, traduceri').eq('slug', slug).maybeSingle();
      if (cat) {
        const { data: copii } = await supabaseAdmin.from('categorii').select('id').eq('parent_id', cat.id);
        iduri = [cat.id, ...(copii || []).map((c) => c.id)];
        const en = cat.traduceri && cat.traduceri.en ? cat.traduceri.en : {};
        categorie = {
          slug: cat.slug, title: cat.title, title_en: cat.title_en || en.title || null,
          description: cat.description || null, description_en: en.description || null, icon_name: cat.icon_name || null,
        };
      }
    }

    const coloane = 'id, id_serviciu, titlu, descriere, unitate_masura, imagini, categorie, categorie_id, subcategorie_id';
    let produse = [];
    if (iduri.length) {
      const [a, b] = await Promise.all([
        supabaseAdmin.from('catalog_servicii').select(coloane).eq('status_public', true).eq('categorie', tip).in('categorie_id', iduri),
        supabaseAdmin.from('catalog_servicii').select(coloane).eq('status_public', true).eq('categorie', tip).in('subcategorie_id', iduri),
      ]);
      const vazute = new Set();
      [...(a.data || []), ...(b.data || [])].forEach((p) => { if (!vazute.has(p.id)) { vazute.add(p.id); produse.push(p); } });
    } else if (toate) {
      const { data } = await supabaseAdmin.from('catalog_servicii').select(coloane).eq('status_public', true).eq('categorie', tip);
      produse = data || [];
    }

    // Prețul „de la”: doar niveluri fără rețetă, cu preț în catalog_preturi.
    const pretMinim = {};
    const cuPretReal = new Set();
    if (produse.length) {
      // Nivelurile cu prețurile lor (o singură cerere, fără liste lungi de id-uri
      // în adresă) și nivelurile cu rețetă (puține, citite toate).
      const [{ data: niveluri }, { data: articole }] = await Promise.all([
        supabaseAdmin.from('catalog_niveluri').select('id, serviciu_id, catalog_preturi(pret, tara_cod)').in('serviciu_id', produse.map((p) => p.id)),
        supabaseAdmin.from('devize_articole').select('catalog_nivel_id').not('catalog_nivel_id', 'is', null),
      ]);
      const cuReteta = new Set((articole || []).map((x) => x.catalog_nivel_id));
      (niveluri || []).forEach((n) => {
        if (cuReteta.has(n.id)) { cuPretReal.add(n.serviciu_id); return; }
        (n.catalog_preturi || []).forEach((p) => {
          const v = Number(p.pret);
          if (p.tara_cod !== tara || !(v > 0)) return;
          cuPretReal.add(n.serviciu_id);
          if (pretMinim[n.serviciu_id] == null || v < pretMinim[n.serviciu_id]) pretMinim[n.serviciu_id] = v;
        });
      });
    }

    let cfg = null;
    if (Object.keys(pretMinim).length) cfg = await incarcaConfigPret(tara);
    const pretPublic = (baza, categ) => {
      const input = categ === 'inchirieri' ? { cost_chirie_scule: baza } : categ === 'materiale' ? { cost_materiale: baza } : { cost_baza_servicii: baza };
      return aplicaFormulaPret(input, cfg, undefined, { cuPragMinim: false }).pret_final;
    };

    const lista = produse
      .map((p) => ({
        id: p.id, slug: p.id_serviciu, titlu: p.titlu, descriere: p.descriere || null,
        unitate: p.unitate_masura || null,
        imagine: Array.isArray(p.imagini) && p.imagini.length ? p.imagini[0] : null,
        tip: p.categorie,
        pret_de_la: pretMinim[p.id] != null ? pretPublic(pretMinim[p.id], p.categorie) : null,
        are_pret: cuPretReal.has(p.id),
      }))
      .sort((x, y) => String(x.titlu).localeCompare(String(y.titlu), 'ro'));

    const { data: taraCfg } = await supabaseAdmin.from('tax_configurations').select('moneda').eq('tara_cod', tara).maybeSingle();
    const cuPret = lista.map((p) => p.pret_de_la).filter((v) => v != null);
    res.setHeader('Cache-Control', 'public, max-age=120');
    return res.status(200).json({
      ok: true, categorie, tip, produse: lista,
      pret_maxim: cuPret.length ? Math.ceil(Math.max(...cuPret)) : null,
      moneda: taraCfg?.moneda || 'RON',
    });
  } catch (err) {
    console.error('[public/catalog-categorie]', err);
    return res.status(500).json({ error: 'Nu am putut încărca produsele categoriei.', error_en: 'We could not load the products of this category.' });
  }
};
