// scripts/date-test-produs.js
// Pasul 11-C12 (12 nov. 2026): datele de test pentru pagina de produs și catalog, servite
// prin route în Playwright (fără producție). Serviciul „acoperis-sarpanta” are forma celui
// din producție: patru niveluri (Bronze, Silver, Gold, Platinum) cu descrieri pe două rânduri,
// prețul fiecărui nivel de la /api/public/calculeaza-pret-nivel, cu întârzierea răspunsurilor
// reale (măsurat: 1,2–2,4 s pe Fast 4G), deci nivelurile apar după ce pagina e vizibilă.
// Catalogul vine din api/public/catalog.js cu baza simulată (ca în masoara-traducere-timpurie.js).
//
// Utilizare: const date = require('./date-test-produs'); await date.instaleazaRute(ctx, { intarziere, asteapta });

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
const pRate = require.resolve(path.join(RADACINA, 'lib/rate-limit.js'));
require.cache[pRate] = { id: pRate, filename: pRate, loaded: true, exports: { checkRateLimit: async () => true } };
const apiCatalog = require(path.join(RADACINA, 'api/public/catalog.js'));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const SERVICIU = { id: 'srv-acoperis', id_serviciu: 'acoperis-sarpanta', titlu: 'Acoperiș & Șarpantă', categorie: 'servicii', domeniu: 'Acoperiș & Șarpantă', unitate_masura: 'm²', nace: 'F 43.91', descriere: null, etape_lucrare: null, instructiuni_intretinere: null, imagini: [], status_public: true };
const NIVELURI = [
  { id: 'nv-b', serviciu_id: 'srv-acoperis', nivel: 'Bronze', descriere: 'Echipă specializată acoperiș, scule. Materialele sunt furnizate de client.' },
  { id: 'nv-s', serviciu_id: 'srv-acoperis', nivel: 'Silver', descriere: 'Bronz + țiglă sau tablă standard, folie și șipci incluse în preț.' },
  { id: 'nv-g', serviciu_id: 'srv-acoperis', nivel: 'Gold', descriere: 'Argint + astereală, folie anticondens, jgheaburi și burlane montate.' },
  { id: 'nv-p', serviciu_id: 'srv-acoperis', nivel: 'Platinum', descriere: 'Aur + sistem complet premium, accesorii de ventilație și garanție extinsă.' },
];
const PRETURI = { 'nv-b': 150, 'nv-s': 199.98, 'nv-g': 314.25, 'nv-p': 420.5 };
const TRADUCERI = { _texte: {
  'Acoperiș & Șarpantă': 'Roof & Roof Frame',
  'Echipă specializată acoperiș, scule. Materialele sunt furnizate de client.': 'Specialised roofing team and tools. Materials are supplied by the client.',
  'Bronz + țiglă sau tablă standard, folie și șipci incluse în preț.': 'Bronze + standard tiles or sheet metal, membrane and battens included in the price.',
  'Argint + astereală, folie anticondens, jgheaburi și burlane montate.': 'Silver + sheathing, anti-condensation membrane, gutters and downpipes fitted.',
  'Aur + sistem complet premium, accesorii de ventilație și garanție extinsă.': 'Gold + complete premium system, ventilation accessories and extended warranty.',
} };

function bazaDate() {
  const produse = [];
  const adauga = (tip, n, prefix, titlu, domeniu) => {
    for (let i = 0; i < n; i++) produse.push({ id: `${prefix}${i}`, id_serviciu: `${prefix}-${i}`, titlu: `${titlu} v${i}`, categorie: tip, domeniu, imagini: [], status_public: true, unitate_masura: 'buc', descriere: 'Test', categorie_id: null, subcategorie_id: null });
  };
  adauga('servicii', 30, 'pri', 'Calorifer aluminiu', 'Bricolaj & Consumabile');
  adauga('materiale', 20, 'gar', 'Lavoar ceramic', 'Bricolaj & Consumabile');
  adauga('inchirieri', 14, 'veh', 'Iluminat LED', 'Vehicule & Transport');
  produse.push(SERVICIU);
  DB.tabele = {
    tax_configurations: [{ tara_cod: 'RO', moneda: 'RON', cota_tva: 21, prag_minim_comanda: 150, checkout_activ: true }],
    backoffice_config: [], catalog_servicii: produse, devize_articole: [], catalog_relatii: [], categorii: [], catalog_materiale_recomandate: [],
    catalog_niveluri: NIVELURI.slice(),
  };
  DB.coloane = {};
}

function rest(url) {
  const u = new URL(url);
  let rows = (DB.tabele[u.pathname.split('/').pop()] || []).slice();
  u.searchParams.forEach((v, k) => {
    if (['select', 'order', 'limit', 'offset'].includes(k)) return;
    const m = String(v).match(/^eq\.(.*)$/);
    if (m) rows = rows.filter((x) => String(x[k]) === m[1]);
  });
  return rows;
}

// Opțiuni: intarziere(octeti) → ms (transferul pe Fast 4G), asteapta(ms);
// pretMs: întârzierea răspunsului de preț (implicit 1.200 ms + 250 ms pe nivel).
async function instaleazaRute(ctx, o) {
  bazaDate();
  const { intarziere, asteapta } = o;
  const pretMs = o.pretMs == null ? 1200 : o.pretMs;
  await ctx.route(/images\.unsplash\.com/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.route(/\.supabase\.co\/rest\/v1\//, async (r) => {
    if (r.request().method() !== 'GET') return r.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    const body = JSON.stringify(rest(r.request().url()));
    await asteapta(intarziere(Buffer.byteLength(body)));
    r.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await ctx.route(/\.supabase\.co\/(?!rest\/v1\/)|esm\.sh/, (r) => r.abort());
  await ctx.route(/ipapi\.co|nominatim/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route(/\/api\/public\/calculeaza-pret-nivel(\?|$)/, async (r) => {
    let d = {};
    try { d = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    const pret = PRETURI[d.nivel_id];
    const i = Object.keys(PRETURI).indexOf(d.nivel_id);
    await asteapta(pretMs + Math.max(0, i) * 250);
    const body = JSON.stringify(pret == null ? { ok: false } : { ok: true, disponibil: true, pret_final: pret, prag_minim_comanda: 150, defalcare: { cost_baza: pret / 1.45, tva_pct: 21 }, include: null, addon_materiale: [], sursa: 'catalog', cantitate: d.cantitate || 1 });
    r.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await ctx.route(/\/api\/public\/geo-regiuni(\?|$)/, async (r) => {
    const body = JSON.stringify({ ok: true, tara: 'RO', regiuni: [{ cod: 'B', denumire: 'București', ordine: 1 }, { cod: 'CJ', denumire: 'Cluj', ordine: 2 }] });
    await asteapta(intarziere(Buffer.byteLength(body)));
    r.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await ctx.route(/\/api\/public\/(catalog|traduceri-catalog)(\?|$)/, async (r) => {
    const u = new URL(r.request().url());
    let corp;
    if (u.pathname === '/api/public/traduceri-catalog') corp = TRADUCERI;
    else { const res = raspuns(); await apiCatalog(cerere({ metoda: 'GET', query: Object.fromEntries(u.searchParams) }), res); corp = res.corp; }
    const body = JSON.stringify(corp);
    await asteapta(intarziere(Buffer.byteLength(body)));
    r.fulfill({ status: 200, contentType: 'application/json', body });
  });
}

module.exports = { instaleazaRute, SERVICIU, NIVELURI, PRETURI, TRADUCERI };
