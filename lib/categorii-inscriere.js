// lib/categorii-inscriere.js
// Pasul 12-P2 (20 nov. 2026, temporar până la macheta B2): la pre-înscrierea
// partenerului (/parteneri/inscriere) se alege categoria principală din arborele
// unic (tabelul `categorii`), nu profesia. Folosit de:
//   - /api/public/categorii       — lista pentru formular;
//   - /api/partener/activare-ciorna — verificarea pe server a datelor
//     pre-înscrierii (partener_activare_ciorna.date.preinscriere);
//   - /api/partener/portofoliu    — serviciile din categoria aleasă, primele;
//   - /api/admin/parteneri-lista  — categoria în fișa partenerului.
//
// Arborele: categorii.category_type = 'servicii' | 'materiale' | 'inchiriere'
// (în bază, la singular), parent_id gol = categorie principală, activ = true.
// Profesia din reclame (?profesie=<slug>, competente_esco) e doar un indiciu:
// preselectează categoria de servicii cu același cod NACE (categorii.nace_ref),
// dacă există una; altfel nu preselectează nimic.

const { supabaseAdmin } = require('./supabaseAdmin');

// Tipul de partener (formular) → valorile din categorii.category_type.
const TIP_IN_ARBORE = Object.freeze({
  servicii: ['servicii'],
  materiale: ['materiale'],
  inchirieri: ['inchiriere', 'inchirieri'],
});
const TIPURI_CU_CATEGORIE = Object.freeze(Object.keys(TIP_IN_ARBORE));
const TIPURI_PARTENER = Object.freeze(['servicii', 'materiale', 'inchirieri', 'curier', 'asigurari']);
const MAX_TEXT = 80;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NECLASIFICAT = 'ESCO - neclasificat';

// Tipul arborelui → tipul de partener (inchiriere → inchirieri).
function tipPartenerDinArbore(categoryType) {
  return TIPURI_CU_CATEGORIE.find((t) => TIP_IN_ARBORE[t].includes(categoryType)) || null;
}

/** Denumirea în limba cerută: title_en / traduceri.en.title, cu rezervă pe title. */
function denumire(cat, lang) {
  if (!cat) return '';
  const tr = cat.traduceri && typeof cat.traduceri === 'object' ? cat.traduceri : {};
  if (lang === 'en') return String(cat.title_en || (tr.en && tr.en.title) || cat.title || '').trim();
  return String((tr.ro && tr.ro.title) || cat.title || '').trim();
}

// NACE „F 43.22” / „43.22” / „4322” → „43.22”.
function nace(text) {
  const m = String(text || '').match(/(\d{2})\.?(\d{2})/);
  return m ? `${m[1]}.${m[2]}` : null;
}

// Slug-ul profesiei, același ca în /api/public/profesii.
function slugProfesie(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Textul scris de partener la „Altceva”: fără etichete HTML și caractere de control, cel mult 80. */
function curataText(v) {
  if (typeof v !== 'string') return '';
  return v
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT)
    .trim();
}

const COLOANE = 'id, slug, title, title_en, traduceri, category_type, parent_id, activ, display_order, nace_ref';

/** Categoriile principale active ale unui tip, în ordinea display_order. */
async function categoriiPrincipale(tip) {
  const tipuri = TIP_IN_ARBORE[tip];
  if (!tipuri) return [];
  const { data, error } = await supabaseAdmin
    .from('categorii')
    .select(COLOANE)
    .in('category_type', tipuri)
    .is('parent_id', null)
    .eq('activ', true)
    .order('display_order', { ascending: true });
  if (error) throw error;
  return (data || [])
    .filter((c) => c && c.id && c.parent_id == null && c.activ === true)
    .sort((a, b) => (a.display_order ?? 9999) - (b.display_order ?? 9999));
}

/** Forma publică: { id, slug, denumire } — fără alte câmpuri. */
function formaPublica(cat, lang) {
  return { id: cat.id, slug: cat.slug, denumire: denumire(cat, lang) };
}

/**
 * Profesia din reclamă → { slug, denumire_ro, nace } sau null (profesie necunoscută).
 * Sursa: competente_esco, ocupațiile clasificate (ca /api/public/profesii).
 */
async function gasesteProfesie(slug) {
  const s = String(slug || '').toLowerCase().trim();
  if (!s || s.length > 60 || !RE_SLUG.test(s)) return null;
  const { data, error } = await supabaseAdmin
    .from('competente_esco')
    .select('cod_esco, denumire, domeniu, nace_code')
    .neq('domeniu', NECLASIFICAT);
  if (error) throw error;
  const r = (data || []).find((x) => x && x.denumire && x.domeniu && x.domeniu !== NECLASIFICAT && slugProfesie(x.denumire) === s);
  return r ? { slug: s, denumire_ro: r.denumire, nace: nace(r.nace_code) } : null;
}

/** Categoria de servicii legată de profesie (același NACE), prima în ordine; altfel null. */
function categoriePentruProfesie(profesie, categorii) {
  if (!profesie || !profesie.nace) return null;
  return (categorii || []).find((c) => nace(c.nace_ref) === profesie.nace) || null;
}

/** Categoria după id, oricare ar fi starea ei (pentru verificare). */
async function categorieDupaId(id) {
  if (!RE_UUID.test(String(id || ''))) return null;
  const { data, error } = await supabaseAdmin.from('categorii').select(COLOANE).eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

const MESAJE = {
  tip: {
    ro: 'Alege ce faci: Servicii, Materiale, Închirieri, Curier sau Asigurări.',
    en: 'Choose what you do: Services, Materials, Rentals, Courier or Insurance.',
  },
  obligatorie: {
    ro: 'Alege categoria principală din listă sau „Altceva”.',
    en: 'Choose the main category from the list or “Something else”.',
  },
  invalida: {
    ro: 'Categoria aleasă nu mai există sau nu e activă. Alege alta din listă sau „Altceva”.',
    en: 'The chosen category no longer exists or is not active. Choose another one from the list or “Something else”.',
  },
  alt_tip: {
    ro: 'Categoria aleasă nu se potrivește cu ce faci. Alege una din lista afișată sau „Altceva”.',
    en: 'The chosen category does not match what you do. Choose one from the list shown or “Something else”.',
  },
};

function eroare(cod, mesaj, camp) {
  return { ok: false, cod, mesaj, camp };
}

/**
 * Verifică și normalizează datele pre-înscrierii (date.preinscriere).
 * Ce vine de la client se păstrează doar după verificare; denumirile și slug-ul
 * categoriei se iau din bază, nu din cerere.
 * @returns {Promise<{ok:true, pre:object} | {ok:false, cod, mesaj:{ro,en}, camp}>}
 */
async function valideazaPreinscriere(intrare) {
  const p = intrare && typeof intrare === 'object' && !Array.isArray(intrare) ? intrare : {};
  const tip = String(p.categorie || '').toLowerCase();
  if (!TIPURI_PARTENER.includes(tip)) return eroare('TIP_PARTENER_INVALID', MESAJE.tip, 'categorie');

  // Câmpurile vechi (pasul 12-P1) și cele noi, peste care se scrie rezultatul verificării.
  const pre = {};
  ['rol', 'oras', 'creat_la'].forEach((k) => { if (typeof p[k] === 'string') pre[k] = p[k].slice(0, k === 'oras' ? 80 : 40); });
  pre.categorie = tip;
  if (typeof p.oras === 'string') pre.oras = curataText(p.oras);

  // Indiciul din reclamă: slug-ul profesiei, verificat (altfel nu se păstrează).
  pre.profesie_slug = null;
  let profesie = null;
  if (typeof p.profesie_slug === 'string' && p.profesie_slug) {
    profesie = await gasesteProfesie(p.profesie_slug);
    if (profesie) pre.profesie_slug = profesie.slug;
  }

  ['categorie_id', 'categorie_slug', 'categorie_denumire', 'categorie_denumire_en', 'categorie_text', 'categorie_altceva', 'nace'].forEach((k) => { pre[k] = null; });

  if (!TIPURI_CU_CATEGORIE.includes(tip)) {
    // Curier și Asigurări: fără categorie.
    pre.categorie_altceva = false;
    return { ok: true, pre };
  }

  const altceva = p.categorie_altceva === true || (p.categorie_id == null && typeof p.categorie_text === 'string' && p.categorie_text.trim() !== '');
  if (p.categorie_id != null && p.categorie_id !== '' && !altceva) {
    const cat = await categorieDupaId(p.categorie_id);
    if (!cat || cat.activ !== true || cat.parent_id != null) return eroare('CATEGORIE_INVALIDA', MESAJE.invalida, 'categorie_id');
    if (tipPartenerDinArbore(cat.category_type) !== tip) return eroare('CATEGORIE_ALT_TIP', MESAJE.alt_tip, 'categorie_id');
    pre.categorie_id = cat.id;
    pre.categorie_slug = cat.slug;
    pre.categorie_denumire = denumire(cat, 'ro');
    pre.categorie_denumire_en = denumire(cat, 'en');
    pre.categorie_altceva = false;
    pre.nace = (profesie && profesie.nace) || nace(cat.nace_ref);
    return { ok: true, pre };
  }
  if (altceva) {
    pre.categorie_altceva = true;
    pre.categorie_text = curataText(p.categorie_text) || null;
    pre.nace = (profesie && profesie.nace) || null;
    return { ok: true, pre };
  }
  return eroare('CATEGORIE_OBLIGATORIE', MESAJE.obligatorie, 'categorie_id');
}

/** Categoria din pre-înscriere, pentru afișare: { id, denumire, denumire_en, text, altceva } sau null. */
function categorieAleasa(pre) {
  if (!pre || typeof pre !== 'object') return null;
  if (pre.categorie_id) {
    return { id: pre.categorie_id, slug: pre.categorie_slug || null, denumire: pre.categorie_denumire || null, denumire_en: pre.categorie_denumire_en || null, text: null, altceva: false };
  }
  if (pre.categorie_altceva) return { id: null, slug: null, denumire: null, denumire_en: null, text: pre.categorie_text || null, altceva: true };
  return null;
}

module.exports = {
  TIP_IN_ARBORE, TIPURI_CU_CATEGORIE, TIPURI_PARTENER, MAX_TEXT, MESAJE,
  denumire, nace, slugProfesie, curataText, tipPartenerDinArbore,
  categoriiPrincipale, formaPublica, gasesteProfesie, categoriePentruProfesie, categorieDupaId,
  valideazaPreinscriere, categorieAleasa,
};
