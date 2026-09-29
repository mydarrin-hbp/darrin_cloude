// lib/valideaza-produs-marketplace.js
// Motor de validare unic pentru Marketplace (materiale + echipamente) —
// folosit IDENTIC de salvarea individuală (api/marketplace/produse.js) și
// de importul CSV (api/marketplace/importa-csv.js). Un produs care nu
// trece cumulativ toate regulile NU se salvează deloc — respins complet,
// nu doar "ascuns" (cerință explicită, 2 August 2026).

const { supabaseAdmin } = require('./supabaseAdmin');

const VIDEO_WHITELIST = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\//i;
const CSV_INJECTION_PREFIX = /^[=+\-@]/;

function sanitizeazaCampText(v) {
  if (typeof v !== 'string') return v;
  return CSV_INJECTION_PREFIX.test(v) ? `'${v}` : v;
}

// Ambele formate NACE coexistă în platformă ("F 43.22" pe catalog_servicii/
// partner_coduri_nace/CSV-ul de import, "43.22" fără literă pe
// nace_reference — vezi api/admin/catalog.js, funcția faraSectiune, aceeași
// inconsecvență cunoscută). Comparăm fără prefixul de secțiune, nu forțăm
// un format la scriere — o migrare separată ar normaliza retroactiv toate
// sursele, în afara scopului acestui fix.
function faraSectiuneNace(cod) {
  return String(cod || '').trim().toUpperCase().replace(/^[A-Z]\s+/, '');
}

// Faza 1 (29 sept. 2026, punctul 3 din decizii): taxonomie controlată,
// nu text liber — nace_cod obligatoriu, validat contra nace_reference
// (1048 coduri reale); cod_uniclass opțional (doar 27 coduri populate azi,
// nivel de produs, ex. Pr_70_60_36_73 „Calorifer/Radiator" — insuficient
// pentru a fi obligatoriu; servicii simple, precum tunsul gazonului, nu au
// echivalent Uniclass și nu trebuie să aibă unul).
async function incarcaContextValidare(furnizorProfileTara) {
  const [{ data: categorii }, { data: taxConfigs }, { data: taxFurnizor }, { data: naceRows }, { data: uniclassRows }] = await Promise.all([
    supabaseAdmin.from('categorii').select('id, category_type'),
    supabaseAdmin.from('tax_configurations').select('moneda'),
    supabaseAdmin.from('tax_configurations').select('cota_tva').eq('tara_cod', furnizorProfileTara || 'RO').maybeSingle(),
    supabaseAdmin.from('nace_reference').select('cod').eq('nivel', 'clasa'),
    supabaseAdmin.from('uniclass_codes').select('code').eq('is_active', true),
  ]);
  const monedeActive = [...new Set((taxConfigs || []).map((r) => r.moneda))];
  return {
    categoriiValide: new Set((categorii || []).map((c) => c.id)),
    monedeActive,
    cotaTva: taxFurnizor?.cota_tva != null ? Number(taxFurnizor.cota_tva) : 21,
    naceValide: new Set((naceRows || []).map((r) => faraSectiuneNace(r.cod))),
    uniclassValide: new Set((uniclassRows || []).map((r) => r.code)),
  };
}

function valideazaCampuriComune(rand, ctx, erori) {
  const denumire = (rand.denumire || '').trim();
  if (denumire.length < 3 || denumire.length > 200) {
    erori.push({ camp: 'denumire', mesaj: `Denumirea trebuie să aibă între 3 și 200 de caractere (are ${denumire.length}).` });
  }

  const descriere = rand.descriere || '';
  if (descriere.length < 100 || descriere.length > 1000) {
    erori.push({ camp: 'descriere', mesaj: `Descrierea trebuie să aibă între 100 și 1000 de caractere (are ${descriere.length}).` });
  }

  if (!rand.descriere_pret || !String(rand.descriere_pret).trim()) {
    erori.push({ camp: 'descriere_pret', mesaj: 'Descrierea prețului este obligatorie (ex: „Preț per bucată").' });
  }

  const moneda = String(rand.moneda || '').toUpperCase();
  if (!ctx.monedeActive.includes(moneda)) {
    erori.push({ camp: 'moneda', mesaj: `Moneda „${rand.moneda || ''}" nu e printre monedele active în platformă (${ctx.monedeActive.join(', ')}).` });
  }

  if (rand.categorie_id && !ctx.categoriiValide.has(rand.categorie_id)) {
    erori.push({ camp: 'categorie_id', mesaj: 'Categoria specificată nu există.' });
  }

  const naceCod = rand.nace_cod ? String(rand.nace_cod).trim() : '';
  if (!naceCod) {
    erori.push({ camp: 'nace_cod', mesaj: 'Codul CAEN/NACE este obligatoriu — alege din listă, nu se acceptă text liber.' });
  } else if (!ctx.naceValide.has(faraSectiuneNace(naceCod))) {
    erori.push({ camp: 'nace_cod', mesaj: `Codul CAEN/NACE „${naceCod}" nu există în nomenclatorul platformei.` });
  }

  const codUniclass = rand.cod_uniclass ? String(rand.cod_uniclass).trim() : '';
  if (codUniclass && !ctx.uniclassValide.has(codUniclass)) {
    erori.push({ camp: 'cod_uniclass', mesaj: `Codul Uniclass „${codUniclass}" nu există în nomenclator.` });
  }

  const imagini = Array.isArray(rand.imagini) ? rand.imagini : [];
  if (imagini.length < 1) {
    erori.push({ camp: 'imagini', mesaj: 'Este obligatorie cel puțin o imagine principală (Imagine 1).' });
  } else if (imagini.length > 6) {
    erori.push({ camp: 'imagini', mesaj: `Maximum 6 imagini permise (primite: ${imagini.length}).` });
  } else if (imagini.some((img) => !img?.url || !img.url.includes('marketplace-media'))) {
    erori.push({ camp: 'imagini', mesaj: 'Toate imaginile trebuie urcate în platformă (marketplace-media) înainte de salvare.' });
  }

  if (rand.video_url && !VIDEO_WHITELIST.test(rand.video_url)) {
    erori.push({ camp: 'video_url', mesaj: 'Videoclipul trebuie să fie un link YouTube sau Vimeo valid.' });
  }

  return { denumire, descriere, moneda, imagini: imagini.slice(0, 6), naceCod, codUniclass };
}

/**
 * @param {object} rand - rândul brut (din formular sau dintr-un rând CSV parsat)
 * @param {{categoriiValide:Set, monedeActive:string[], cotaTva:number}} ctx
 * @returns {{valid:boolean, erori:{camp:string,mesaj:string}[], normalizat:object|null}}
 */
function valideazaMaterial(rand, ctx) {
  const erori = [];
  const { denumire, descriere, moneda, imagini, naceCod, codUniclass } = valideazaCampuriComune(rand, ctx, erori);

  const pret = Number(rand.pret_fara_tva);
  if (!Number.isFinite(pret) || pret <= 0) {
    erori.push({ camp: 'pret_fara_tva', mesaj: 'Preț fără TVA obligatoriu, număr strict pozitiv.' });
  }
  if (!rand.unitate_masura || !String(rand.unitate_masura).trim()) {
    erori.push({ camp: 'unitate_masura', mesaj: 'Unitatea de măsură este obligatorie.' });
  }

  if (erori.length) return { valid: false, erori, normalizat: null };

  const cotaTva = ctx.cotaTva;
  const pretCuTva = Math.round(pret * (1 + cotaTva / 100) * 100) / 100;

  return {
    valid: true,
    erori: [],
    normalizat: {
      denumire: sanitizeazaCampText(denumire),
      descriere: sanitizeazaCampText(descriere),
      descriere_pret: sanitizeazaCampText(String(rand.descriere_pret).trim()),
      ambalaj: rand.ambalaj ? sanitizeazaCampText(String(rand.ambalaj).trim()) : null,
      categorie_id: rand.categorie_id || null,
      nace_cod: naceCod,
      cod_uniclass: codUniclass || null,
      pret_fara_tva: pret,
      moneda,
      cota_tva: cotaTva,
      pret_cu_tva: pretCuTva,
      unitate_masura: String(rand.unitate_masura).trim(),
      stoc_disponibil: Number.isFinite(Number(rand.stoc_disponibil)) ? Number(rand.stoc_disponibil) : 0,
      lead_time_zile: Number.isFinite(Number(rand.lead_time_zile)) ? Number(rand.lead_time_zile) : 0,
      furnizor_comercial: rand.furnizor_comercial ? sanitizeazaCampText(String(rand.furnizor_comercial).trim()) : null,
      cui_furnizor: rand.cui_furnizor || null,
      specificatii_tehnice: rand.specificatii_tehnice ? sanitizeazaCampText(String(rand.specificatii_tehnice)) : null,
      imagini,
      video_url: rand.video_url || null,
      fisa_tehnica_url: rand.fisa_tehnica_url || null,
      cod_produs_furnizor: rand.cod_produs_furnizor || null,
    },
  };
}

function valideazaEchipament(rand, ctx) {
  const erori = [];
  const { denumire, descriere, moneda, imagini, naceCod, codUniclass } = valideazaCampuriComune(rand, ctx, erori);

  const tarifZi = Number(rand.tarif_zi);
  if (!Number.isFinite(tarifZi) || tarifZi <= 0) {
    erori.push({ camp: 'tarif_zi', mesaj: 'Tarif/zi obligatoriu, număr strict pozitiv.' });
  }
  const operatorValid = ['fara_operator', 'cu_operator_optional', 'operator_obligatoriu'];
  const operatorInclus = rand.operator_inclus || 'fara_operator';
  if (!operatorValid.includes(operatorInclus)) {
    erori.push({ camp: 'operator_inclus', mesaj: `operator_inclus trebuie să fie una din: ${operatorValid.join(', ')}.` });
  }

  if (erori.length) return { valid: false, erori, normalizat: null };

  return {
    valid: true,
    erori: [],
    normalizat: {
      denumire: sanitizeazaCampText(denumire),
      descriere: sanitizeazaCampText(descriere),
      descriere_pret: sanitizeazaCampText(String(rand.descriere_pret).trim()),
      ambalaj: rand.ambalaj ? sanitizeazaCampText(String(rand.ambalaj).trim()) : null,
      categorie_id: rand.categorie_id || null,
      nace_cod: naceCod,
      cod_uniclass: codUniclass || null,
      operator_inclus: operatorInclus,
      tarif_ora: rand.tarif_ora != null && rand.tarif_ora !== '' ? Number(rand.tarif_ora) : null,
      tarif_zi: tarifZi,
      // FIX (testat live, 2 August 2026): TVA se calcula doar pentru
      // materiale — echipamentele salvau tarif_zi fără TVA calculată deloc,
      // deși cerința se aplică uniform pe toate produsele marketplace.
      cota_tva: ctx.cotaTva,
      tarif_zi_cu_tva: Math.round(tarifZi * (1 + ctx.cotaTva / 100) * 100) / 100,
      tarif_saptamana: rand.tarif_saptamana != null && rand.tarif_saptamana !== '' ? Number(rand.tarif_saptamana) : null,
      moneda,
      buc_disponibile: Number.isFinite(Number(rand.buc_disponibile)) ? Number(rand.buc_disponibile) : 0,
      specificatii_tehnice: rand.specificatii_tehnice ? sanitizeazaCampText(String(rand.specificatii_tehnice)) : null,
      imagini,
      video_url: rand.video_url || null,
      fisa_tehnica_url: rand.fisa_tehnica_url || null,
      cod_produs_furnizor: rand.cod_produs_furnizor || null,
    },
  };
}

module.exports = { valideazaMaterial, valideazaEchipament, incarcaContextValidare, sanitizeazaCampText, VIDEO_WHITELIST };
