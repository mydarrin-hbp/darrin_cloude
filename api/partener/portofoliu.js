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
//
// Pasul 12-P2 (20 nov. 2026, temporar până la macheta B2): „Ce lucrări faci”
// din panoul contului nou (panou-cont-nou.js) folosește acest portofoliu.
// - accesul: rolul de partener acordat (profiles.roles) SAU ales la înscriere
//   (profiles.rol_solicitat) — contul nou nu are încă rând în partners; bifarea
//   nu dă comenzi: alocarea cere și disponibilitate, aprobare, contract și IBAN;
// - tipul catalogului: partners.partner_type, altfel din rol_solicitat;
// - serviciile din categoria principală aleasă la înscriere (ciorna activării,
//   date.preinscriere.categorie_id, cu subcategoriile ei) vin primele, marcate
//   din_categoria_aleasa; răspunsul are și categoria_aleasa { id, denumire, denumire_en, text }.
//   Doar catalogul de servicii are azi categorie_id / subcategorie_id completate.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { verificaSiNotificaProfilComplet } = require('../../lib/verifica-profil-complet-partener');
const v = require('../../lib/valideaza');
const { trimiteEroare } = require('../../lib/raspuns-eroare');
const { categorieAleasa } = require('../../lib/categorii-inscriere');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  catalog_serviciu_id: v.id({ eticheta: ['Serviciu', 'Service'] }),
  activ: v.boolean({ eticheta: ['Activ', 'Active'] }),
};

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

// rolul de partener → catalog_servicii.categorie (contul fără rând în partners)
const ROL_LA_CATEGORIE = {
  partener_servicii: 'servicii',
  partener_materiale: 'materiale',
  partener_inchirieri: 'inchirieri',
};

// Profilul: rolurile acordate și rolul ales la înscriere (citite cu service_role).
async function profilRoluri(userId) {
  let { data, error } = await supabaseAdmin.from('profiles').select('roles, rol_solicitat').eq('id', userId).maybeSingle();
  if (error) ({ data, error } = await supabaseAdmin.from('profiles').select('roles').eq('id', userId).maybeSingle());
  if (error) throw error;
  return { roles: Array.isArray(data && data.roles) ? data.roles : [], rol_solicitat: (data && data.rol_solicitat) || null };
}
function arePartener(p) {
  return p.roles.some((r) => ROLURI_PARTENER.includes(r)) || ROLURI_PARTENER.includes(p.rol_solicitat);
}

// Categoria aleasă la înscriere (ciorna activării), sau null.
async function categorieDinInscriere(userId) {
  const { data, error } = await supabaseAdmin.from('partener_activare_ciorna').select('date').eq('user_id', userId).maybeSingle();
  if (error || !data) return null;
  return categorieAleasa(data.date && data.date.preinscriere);
}

async function actionList(req, res, user, profil) {
  const { data: partner } = await supabaseAdmin
    .from('partners')
    .select('partner_type')
    .eq('id', user.id)
    .maybeSingle();

  const categorie = partner
    ? TIP_LA_CATEGORIE[partner.partner_type]
    : ROL_LA_CATEGORIE[profil.rol_solicitat] || ROL_LA_CATEGORIE[profil.roles.find((r) => ROL_LA_CATEGORIE[r])];
  if (!categorie) {
    // Curier/asigurări nu au un catalog de bifat în acest fel — alocarea
    // lor e pe rol/zonă, nu pe listă de servicii (vezi documentul, secțiunea
    // de matching engine se referă explicit la servicii/materiale/închirieri).
    return res.status(200).json({ ok: true, categorie: null, servicii: [] });
  }

  const { data: catalog, error } = await supabaseAdmin
    .from('catalog_servicii')
    .select('id, id_serviciu, titlu, domeniu, nace, cod_esco, categorie_id, subcategorie_id, traduceri')
    .eq('categorie', categorie)
    .eq('status_public', true)
    .order('domeniu', { ascending: true })
    .order('titlu', { ascending: true });
  if (error) {
    console.error('[portofoliu] list catalog', error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca catalogul.', 'We could not load the catalogue.');
  }

  const { data: active } = await supabaseAdmin
    .from('partener_servicii_active')
    .select('catalog_serviciu_id, activ')
    .eq('partener_id', user.id);
  const activeSet = new Set((active || []).filter((a) => a.activ).map((a) => a.catalog_serviciu_id));

  // Pasul 12-P2: serviciile din categoria aleasă la înscriere (și subcategoriile ei), primele.
  const aleasa = await categorieDinInscriere(user.id);
  const iduri = new Set();
  if (aleasa && aleasa.id) {
    iduri.add(aleasa.id);
    const { data: copii } = await supabaseAdmin.from('categorii').select('id').eq('parent_id', aleasa.id);
    (copii || []).forEach((c) => iduri.add(c.id));
  }
  const servicii = (catalog || []).map((s) => {
    const { categorie_id, subcategorie_id, traduceri, ...rest } = s;
    const en = traduceri && traduceri.en ? traduceri.en : {};
    return { ...rest, titlu_en: en.titlu || null, bifat: activeSet.has(s.id), din_categoria_aleasa: iduri.has(categorie_id) || iduri.has(subcategorie_id) };
  });
  // Sortare stabilă: întâi categoria aleasă, apoi ordinea de mai sus (domeniu, titlu).
  const ordonate = servicii.filter((s) => s.din_categoria_aleasa).concat(servicii.filter((s) => !s.din_categoria_aleasa));
  return res.status(200).json({ ok: true, categorie, servicii: ordonate, categoria_aleasa: aleasa });
}

async function actionToggle(req, res, user) {
  if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora' })) return;
  const { catalog_serviciu_id, activ } = req.body || {};
  if (!catalog_serviciu_id || typeof activ !== 'boolean') {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'catalog_serviciu_id și activ (boolean) sunt obligatorii.', 'catalog_serviciu_id and activ (boolean) are required.');
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
    if (error) { console.error('[portofoliu] update', error); return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut actualiza.', 'We could not save the update. Please try again.'); }
  } else {
    const { error } = await supabaseAdmin
      .from('partener_servicii_active')
      .insert({ partener_id: user.id, catalog_serviciu_id, activ });
    if (error) { console.error('[portofoliu] insert', error); return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut salva.', 'We could not save. Please try again.'); }
  }

  // Doar la activare (nu la dezactivare) — vezi lib/verifica-profil-complet-partener.js.
  // Așteptat (nu fire-and-forget), din același motiv ca în conturi-bancare.js.
  if (activ) await verificaSiNotificaProfilComplet(user.id);

  return res.status(200).json({ ok: true });
}

async function handler(req, res, user) {
  const profil = await profilRoluri(user.id).catch(() => null);
  // Fail-closed: fără profil citit sau fără rol de partener (acordat sau ales), refuz.
  if (!profil || !arePartener(profil)) return trimiteEroare(res, 403, 'FARA_DREPT', 'Nu ai permisiunea necesară pentru acest rol', 'You do not have the required permission for this role');
  if (req.method === 'GET') return actionList(req, res, user, profil);
  if (req.method === 'POST') {
    const { action } = req.body || {};
    if (action === 'toggle') return actionToggle(req, res, user);
    return trimiteEroare(res, 400, 'ACTIUNE_NECUNOSCUTA', 'action invalidă.', 'Invalid action.', ['action']);
  }
  return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
}

// Rolul se verifică în handler (acordat sau ales la înscriere), tot din profiles, cu service_role.
module.exports = requireAuth([], handler);
