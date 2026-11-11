// scripts/test-catalog-o-cerere.js
// Pasul 11-C10: catalogul dintr-o singură cerere, pornită devreme, desenat
// treptat; filtrele de pe telefon sub un buton.
//   A. /api/public/catalog: produsele publice ale celor trei categorii, prețurile
//      (aceleași ca în catalog-categorie), relațiile, fără câmpuri interzise,
//      antetul de cache doar la succes, traducerile doar la lang=en;
//   B. pe datele reale (citite cu cheia publică, doar citire): același rezultat ca
//      sursele vechi (fără rețea: partea B e sărită, cu mesaj);
//   C. în browser: o singură cerere de date pentru catalog, pornită din <head>;
//      primul lot desenat imediat; eroare → „Reîncearcă” → o cerere nouă;
//   D. telefon: grila în primii ~900 px, panoul „Filtre” se deschide, aplică,
//      resetează; desktop: filtrele rămân în coloană; regula vecinilor pe fiecare filă;
//   E. 360 / 390 / 768 / 1024 / 1366 px: fără derulare orizontală și fără erori JS.

const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
const pRate = require.resolve(path.join(RADACINA, 'lib/rate-limit.js'));
require.cache[pRate] = { id: pRate, filename: pRate, loaded: true, exports: { checkRateLimit: async () => true } };
const { chromium } = require('playwright');
const { porneste } = require('./server-test');
const apiCatalog = require(path.join(RADACINA, 'api/public/catalog.js'));
const apiCat = require(path.join(RADACINA, 'api/public/catalog-categorie.js'));

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const citeste = (f) => fs.readFileSync(path.join(RADACINA, f), 'utf8');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const INTERZISE = /discount|partner_id|partener_id|creat_de|cost_intern|comision|status_public/i;
const CONFIG = [
  { sectiune: 'pricing', cheie: 'cost_marketing_pct', valoare: '3', tara_cod: 'ALL' },
  { sectiune: 'pricing', cheie: 'cost_mentenanta_pct', valoare: '2', tara_cod: 'ALL' },
  { sectiune: 'pricing', cheie: 'comision_platforma_default_pct', valoare: '12', tara_cod: 'ALL' },
  { sectiune: 'asigurari', cheie: 'cost_asigurare_pct', valoare: '1', tara_cod: 'ALL' },
];

// Câmpurile private există în baza simulată: răspunsul nu trebuie să le lase să treacă.
function reset() {
  const produse = [];
  const adauga = (tip, n, prefix, titlu, domeniu) => {
    for (let i = 0; i < n; i++) {
      produse.push({
        id: `${prefix}${i}`, id_serviciu: `${prefix}-${i}`, titlu: `${titlu} v${i}`, categorie: tip, domeniu, imagini: [], status_public: true,
        unitate_masura: 'buc', descriere: 'Test', categorie_id: null, subcategorie_id: null,
        discount_partener: 11, partner_id: 'p-secret', creat_de: 'autor-secret', cost_intern: 7,
        traduceri: i === 0 ? { en: { titlu: `EN ${titlu}` }, de: { titlu: 'Nur Deutsch' } } : {},
      });
    }
  };
  adauga('servicii', 30, 'pri', 'Calorifer aluminiu', 'Bricolaj & Consumabile');
  adauga('materiale', 20, 'gar', 'Lavoar ceramic', 'Bricolaj & Consumabile');
  adauga('inchirieri', 14, 'veh', 'Iluminat LED', 'Vehicule & Transport');
  produse.push({ id: 'cal1', id_serviciu: 'cal-montaj', titlu: 'Montaj calorifer', categorie: 'servicii', domeniu: 'Instalații', imagini: [], status_public: true });
  produse.push({ id: 'ascuns', id_serviciu: 'ascuns-1', titlu: 'Produs nepublic', categorie: 'servicii', domeniu: 'Instalații', imagini: [], status_public: false });
  produse.push({ id: 'cal2', id_serviciu: 'cal-ascuns', titlu: 'Calorifer nepublic', categorie: 'servicii', domeniu: 'Instalații', imagini: [], status_public: false });
  DB.tabele = {
    tax_configurations: [{ tara_cod: 'RO', moneda: 'RON', cota_tva: 21, prag_minim_comanda: 100, checkout_activ: true }, { tara_cod: 'MD', moneda: 'MDL', cota_tva: 20, prag_minim_comanda: 100, checkout_activ: true }],
    backoffice_config: JSON.parse(JSON.stringify(CONFIG)),
    catalog_servicii: produse,
    catalog_niveluri: [
      { id: 'n1', serviciu_id: 'pri0', catalog_preturi: [{ pret: 100, tara_cod: 'RO' }, { pret: 90, tara_cod: 'MD' }] },
      { id: 'n2', serviciu_id: 'pri0', catalog_preturi: [{ pret: 200, tara_cod: 'RO' }] },
      { id: 'n3', serviciu_id: 'pri1', catalog_preturi: [] },
      { id: 'n4', serviciu_id: 'gar0', catalog_preturi: [{ pret: 50, tara_cod: 'RO' }] },
      { id: 'n5', serviciu_id: 'veh0', catalog_preturi: [{ pret: 70, tara_cod: 'RO' }] },
      { id: 'n6', serviciu_id: 'ascuns', catalog_preturi: [{ pret: 5000, tara_cod: 'RO' }] },
    ],
    devize_articole: [{ articol_id: 1, catalog_nivel_id: 'n3' }],
    catalog_relatii: [
      { catalog_serviciu_id: 'gar0', catalog_relatie_id: 'cal1', tip_relatie: 'obiect_asociat' },
      { catalog_serviciu_id: 'gar1', catalog_relatie_id: 'cal2', tip_relatie: 'obiect_asociat' },
      { catalog_serviciu_id: 'gar2', catalog_relatie_id: 'cal1', tip_relatie: 'alta' },
    ],
    categorii: [],
  };
  DB.coloane = {};
}
async function cheama(api, query) { const r = raspuns(); await api(cerere({ metoda: 'GET', query }), r); return r; }

async function testeApi() {
  console.log('A. /api/public/catalog');
  reset();
  const r = await cheama(apiCatalog, { tara: 'RO', lang: 'ro' });
  verifica(r.statusCode === 200 && r.corp.ok === true, `răspuns: ${r.statusCode}`);
  verifica(r.corp.servicii.length === 31 && r.corp.materiale.length === 20 && r.corp.inchirieri.length === 14, 'numărul de produse pe categorii');
  const toate = [...r.corp.servicii, ...r.corp.materiale, ...r.corp.inchirieri];
  verifica(!toate.some((p) => p.id === 'ascuns' || p.id === 'cal2'), 'produs nepublic în răspuns');
  const CHEI = ['id', 'id_serviciu', 'titlu', 'domeniu', 'unitate_masura', 'descriere', 'imagini', 'categorie_id', 'subcategorie_id', 'pret_de_la', 'are_pret'];
  verifica(toate.every((p) => CHEI.every((k) => k in p) && Object.keys(p).every((k) => CHEI.includes(k))), 'câmpurile produsului');
  const chei = new Set();
  (function colecteaza(x) { if (x && typeof x === 'object') Object.entries(x).forEach(([k, v]) => { chei.add(k); colecteaza(v); }); })(r.corp);
  verifica(![...chei].some((k) => INTERZISE.test(k)), `chei interzise: ${[...chei].filter((k) => INTERZISE.test(k))}`);
  verifica(!/secret/.test(JSON.stringify(r.corp)), 'valori private în răspuns');
  verifica(r.headere['Cache-Control'] === 'public, s-maxage=300, stale-while-revalidate=600', `cache: ${r.headere['Cache-Control']}`);
  verifica(JSON.stringify(r.corp.servicii_asociate.map((s) => s.id)) === '["cal1"]', `servicii asociate: ${JSON.stringify(r.corp.servicii_asociate)}`);
  verifica(JSON.stringify(r.corp.relatii) === '[{"catalog_serviciu_id":"gar0","catalog_relatie_id":"cal1"}]', `relații: ${JSON.stringify(r.corp.relatii)}`);

  // Același preț ca în catalog-categorie, țară cu țară.
  for (const tara of ['RO', 'MD']) {
    const a = await cheama(apiCatalog, { tara, lang: 'ro' });
    const lista = [...a.corp.servicii, ...a.corp.materiale, ...a.corp.inchirieri];
    for (const tip of ['servicii', 'materiale', 'inchirieri']) {
      const c = await cheama(apiCat, { toate: '1', tip, tara });
      c.corp.produse.forEach((p) => {
        const x = lista.find((y) => y.id === p.id);
        verifica(x && x.pret_de_la === p.pret_de_la && x.are_pret === p.are_pret, `${tara} ${p.id}: ${x && x.pret_de_la} ≠ ${p.pret_de_la}`);
      });
    }
  }
  const pret = (id) => toate.find((p) => p.id === id);
  verifica(pret('pri0').pret_de_la > 100 && pret('pri0').are_pret === true, 'prețul „de la”, cu taxe');
  verifica(pret('pri1').pret_de_la === null && pret('pri1').are_pret === true, 'rețeta: are_pret fără cifră');
  verifica(pret('pri2').pret_de_la === null && pret('pri2').are_pret === false, 'fără preț: null');
  const sursaA = citeste('api/public/catalog.js'), sursaB = citeste('api/public/catalog-categorie.js');
  verifica(!/aplicaFormulaPret|catalog_preturi\(/.test(sursaA.replace(/^\s*\/\/.*$/gm, '')) && !/aplicaFormulaPret|catalog_preturi\(/.test(sursaB.replace(/^\s*\/\/.*$/gm, '')), 'calcul de preț duplicat');
  verifica(/preturiDeLa/.test(sursaA) && /preturiDeLa/.test(sursaB), 'funcția comună de preț');

  // lang=en: doar traducerea engleză, iar lang=ro fără traduceri.
  const en = await cheama(apiCatalog, { tara: 'RO', lang: 'en' });
  const tr = en.corp.servicii.find((p) => p.id === 'pri0').traduceri;
  verifica(tr && tr.en && tr.en.titlu === 'EN Calorifer aluminiu' && !tr.de, `traduceri: ${JSON.stringify(tr)}`);
  verifica(!r.corp.servicii.some((p) => p.traduceri), 'traduceri la lang=ro');
  verifica((await cheama(apiCatalog, { tara: 'ROO', lang: 'xx' })).corp.tara === 'RO', 'țara invalidă devine RO');
  verifica((await cheama(apiCatalog, { lang: 'de' })).corp.lang === 'en', 'altă limbă devine en');

  // Fără coloana traduceri (migrare neaplicată): catalogul merge.
  reset();
  DB.coloane.catalog_servicii = ['id', 'id_serviciu', 'titlu', 'domeniu', 'unitate_masura', 'descriere', 'imagini', 'categorie', 'categorie_id', 'subcategorie_id', 'status_public'];
  const faraColoana = await cheama(apiCatalog, { tara: 'RO', lang: 'en' });
  verifica(faraColoana.statusCode === 200 && faraColoana.corp.servicii.length === 31, `fără coloana traduceri: ${faraColoana.statusCode}`);

  // La eroare, nimic în cache.
  reset();
  const original = DB.tabele;
  DB.coloane.catalog_servicii = ['inexistent'];
  const er = await cheama(apiCatalog, { tara: 'RO', lang: 'ro' });
  verifica(er.statusCode === 500 && !er.headere['Cache-Control'], `eroare: ${er.statusCode} ${er.headere['Cache-Control']}`);
  verifica(er.corp.error && er.corp.error_en, 'mesajul de eroare RO + EN');
  DB.tabele = original; DB.coloane = {};

  // Doar GET.
  const post = raspuns(); await apiCatalog(cerere({ metoda: 'POST', query: {} }), post);
  verifica(post.statusCode === 405, 'POST respins');
}

// B. Datele reale: endpoint-ul rulează pe rândurile citite cu cheia publică, iar
// rezultatul se compară cu interogările vechi ale paginii și cu catalog-categorie.
async function testeLive() {
  console.log('B. Pe datele reale (doar citire)');
  const H = citeste('mydarrin-catalog.html');
  const url = (H.match(/SUPABASE_URL\s*=[^\n]*\|\|\s*'([^']+)'/) || [])[1];
  const k = (H.match(/SUPABASE_ANON_KEY\s*=[^\n]*\|\|\s*'([^']+)'/) || [])[1];
  const PROD = 'https://mydarrin.homebestpal.com';
  const rest = async (t, q) => {
    const r = await fetch(`${url}/rest/v1/${t}?${q}`, { headers: { apikey: k, Authorization: 'Bearer ' + k, Range: '0-999' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`${t}: HTTP ${r.status}`);
    return r.json();
  };
  let vechi;
  try {
    const SEL = 'select=id,id_serviciu,titlu,domeniu,unitate_masura,descriere,imagini,categorie_id,subcategorie_id&order=domeniu,titlu';
    const preturi = async (tip) => (await (await fetch(`${PROD}/api/public/catalog-categorie?toate=1&tip=${tip}&tara=RO`, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) })).json()).produse;
    const [servicii, materiale, inchirieri, relatii, asociate, ps, pm, pi] = await Promise.all([
      rest('catalog_servicii', 'categorie=eq.servicii&status_public=eq.true&' + SEL),
      rest('catalog_servicii', 'categorie=eq.materiale&status_public=eq.true&' + SEL),
      rest('catalog_servicii', 'categorie=eq.inchirieri&status_public=eq.true&' + SEL),
      rest('catalog_relatii', 'tip_relatie=eq.obiect_asociat&select=catalog_serviciu_id,catalog_relatie_id,tip_relatie'),
      rest('catalog_servicii', 'categorie=eq.servicii&id_serviciu=like.cal-*&select=id,id_serviciu,titlu'),
      preturi('servicii'), preturi('materiale'), preturi('inchirieri'),
    ]);
    const niveluri = await rest('catalog_niveluri', 'select=id,serviciu_id,catalog_preturi(pret,tara_cod)');
    const config = await rest('backoffice_config', 'sectiune=in.(pricing,asigurari)&select=sectiune,cheie,valoare,tara_cod');
    // tax_configurations nu e citibil public: cota de TVA vine din tari-active.
    const tari = await (await fetch(`${PROD}/api/public/tari-active`, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) })).json();
    const tax = [{ tara_cod: 'RO', moneda: 'RON', cota_tva: tari.tva.RO, prag_minim_comanda: 0, checkout_activ: true }];
    vechi = { servicii, materiale, inchirieri, relatii, asociate, preturi: [...ps, ...pm, ...pi], niveluri, config, tax };
  } catch (e) {
    console.log('    (fără rețea sau fără acces: partea B sărită — ' + e.message + ')');
    return;
  }
  const rand = (categorie) => (p) => ({ ...p, categorie, status_public: true });
  DB.tabele = {
    catalog_servicii: [...vechi.servicii.map(rand('servicii')), ...vechi.materiale.map(rand('materiale')), ...vechi.inchirieri.map(rand('inchirieri'))],
    catalog_relatii: vechi.relatii, catalog_niveluri: vechi.niveluri, devize_articole: [], backoffice_config: vechi.config, tax_configurations: vechi.tax, categorii: [],
  };
  // devize_articole nu e citibil cu cheia publică: rețetele cunoscute sunt doar cele
  // deduse din răspunsul public (are_pret fără cifră). Un nivel cu rețetă ascuns face
  // ca prețul reconstruit aici să fie MAI MIC decât cel real: acele produse se
  // numără separat, nu se consideră egale; un preț mai mare e o eroare.
  const dePret = new Map(vechi.preturi.map((p) => [p.id, p]));
  const faraCifra = vechi.niveluri.filter((n) => dePret.get(n.serviciu_id)?.are_pret && dePret.get(n.serviciu_id)?.pret_de_la == null);
  DB.tabele.devize_articole = faraCifra.map((n, i) => ({ articol_id: i, catalog_nivel_id: n.id }));
  DB.coloane = {};
  const r = await cheama(apiCatalog, { tara: 'RO', lang: 'ro' });
  verifica(r.statusCode === 200, `live: ${r.statusCode}`);
  const neverificabile = [];
  for (const t of ['servicii', 'materiale', 'inchirieri']) {
    const a = r.corp[t].map((p) => p.id).sort(), b = vechi[t].map((p) => p.id).sort();
    verifica(JSON.stringify(a) === JSON.stringify(b), `live ${t}: ${a.length} ≠ ${b.length}`);
    r.corp[t].forEach((p) => {
      const v = vechi[t].find((x) => x.id === p.id);
      ['id_serviciu', 'titlu', 'domeniu', 'unitate_masura', 'descriere', 'categorie_id', 'subcategorie_id'].forEach((c) => verifica(p[c] === v[c], `live ${p.id_serviciu}.${c}`));
      verifica(JSON.stringify(p.imagini) === JSON.stringify(v.imagini), `live ${p.id_serviciu}: imagini`);
      const pv = dePret.get(p.id);
      if (pv && p.are_pret === pv.are_pret && p.pret_de_la != null && pv.pret_de_la != null && p.pret_de_la < pv.pret_de_la) { neverificabile.push(p.id_serviciu); return; }
      verifica(pv && p.are_pret === pv.are_pret && p.pret_de_la === pv.pret_de_la, `live ${p.id_serviciu}: preț ${p.pret_de_la}/${p.are_pret} ≠ ${pv && pv.pret_de_la}/${pv && pv.are_pret}`);
    });
  }
  verifica(JSON.stringify(r.corp.servicii_asociate.map((x) => x.id).sort()) === JSON.stringify(vechi.asociate.map((x) => x.id).sort()), 'live: serviciile asociate');
  const mat = new Set(vechi.materiale.map((p) => p.id)), asc = new Set(vechi.asociate.map((p) => p.id));
  const cheie = (x) => x.catalog_serviciu_id + '>' + x.catalog_relatie_id;
  const asteptate = vechi.relatii.filter((x) => mat.has(x.catalog_serviciu_id) && asc.has(x.catalog_relatie_id)).map(cheie).sort();
  verifica(JSON.stringify(r.corp.relatii.map(cheie).sort()) === JSON.stringify(asteptate), `live: relațiile afișabile ${r.corp.relatii.length} ≠ ${asteptate.length}`);
  verifica(![...JSON.stringify(r.corp).matchAll(/"([a-z_]+)":/g)].some((m) => INTERZISE.test(m[1])), 'live: chei interzise');
  console.log(`    ${r.corp.servicii.length + r.corp.materiale.length + r.corp.inchirieri.length} produse reale comparate; preț neverificabil cu datele publice (rețetă ascunsă): ${neverificabile.length ? neverificabile.join(', ') : 'niciunul'}`);
}

// În pagină: repetările între vecini (stânga / dreapta / deasupra).
function repetari() {
  const viz = [...document.querySelectorAll('.tab-content.active .db-card')].filter((c) => c.offsetParent);
  const rd = [];
  viz.forEach((c) => { const t = Math.round(c.getBoundingClientRect().top + scrollY); let r = rd.find((x) => Math.abs(x.t - t) < 5); if (!r) rd.push(r = { t, c: [] }); r.c.push(c); });
  rd.sort((a, b) => a.t - b.t);
  const src = (c) => c.querySelector('.card-media img').getAttribute('src');
  const nv = (c) => (c.dataset.imgVariante || '').split(' ').filter(Boolean).length;
  let n = 0;
  rd.forEach((r, i) => r.c.forEach((c, j) => { if (nv(c) < 2) return; if (j && src(r.c[j - 1]) === src(c)) n++; const s = i ? rd[i - 1].c[j] : null; if (s && src(s) === src(c)) n++; }));
  return { n, carduri: viz.length };
}
const CTRL = { cade: false, intarziere: 0 };
async function deschide(browser, baza, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: o.w || 1366, height: o.h || 900 }, hasTouch: (o.w || 1366) < 720 });
  await ctx.addInitScript((lang) => {
    try { localStorage.setItem('myd_lang_v1', lang); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 })); } catch (e) {}
    window.__loturi = [];
    new MutationObserver((l) => {
      const n = l.reduce((s, m) => s + [...m.addedNodes].filter((x) => x.classList && x.classList.contains('db-card')).length, 0);
      if (n) window.__loturi.push(n);
    }).observe(document, { childList: true, subtree: true });
  }, o.lang || 'ro');
  const cereri = [];
  await ctx.route(/images\.unsplash\.com/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.route(/\.supabase\.co\/rest\/v1\//, (r) => { cereri.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); });
  await ctx.route(/\.supabase\.co\/(?!rest\/v1\/)/, (r) => r.abort());
  await ctx.route(/ipapi\.co|nominatim/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route(/\/api\//, async (r) => {
    const u = new URL(r.request().url());
    cereri.push(u.pathname + u.search);
    if (u.pathname === '/api/public/catalog') {
      if (CTRL.intarziere) await new Promise((a) => setTimeout(a, CTRL.intarziere));
      if (CTRL.cade) return r.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      const res = raspuns();
      await apiCatalog(cerere({ metoda: 'GET', query: Object.fromEntries(u.searchParams) }), res);
      return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp) });
    }
    if (u.pathname === '/api/public/tari-active') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, active: ['RO', 'MD', 'BG', 'DE', 'FR', 'GB'], tari: [{ tara_cod: 'RO', tara_nume: 'România' }], tva: { RO: 21 } }) });
    return r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' });
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(12000);
  const erori = [];
  p.on('pageerror', (e) => erori.push(e.message.slice(0, 200)));
  await p.goto(`${baza}/mydarrin-catalog.html`, { waitUntil: 'load', timeout: 60000 });
  if (!o.faraAsteptare) await p.waitForFunction(() => window.__catalogDesenat === true);
  return { ctx, p, erori, cereri };
}
const depasire = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const susGrila = (p) => p.evaluate(() => Math.round(document.querySelector('#grid-servicii').getBoundingClientRect().top + scrollY));
const vizibile = (p) => p.$$eval('.tab-content.active .db-card', (c) => c.filter((x) => x.offsetParent).length);

async function testeBrowser(baza, browser) {
  console.log('C. O singură cerere, pornită devreme, desenare treptată');
  {
    reset();
    const { ctx, p, erori, cereri } = await deschide(browser, baza);
    const catalog = cereri.filter((u) => u.startsWith('/api/public/catalog?'));
    verifica(catalog.length === 1, `cereri /api/public/catalog: ${catalog.length}`);
    verifica(/tara=RO/.test(catalog[0]) && /lang=ro/.test(catalog[0]), `adresa: ${catalog[0]}`);
    verifica(!cereri.some((u) => /\/rest\/v1\/catalog_/.test(u)), `cereri vechi: ${cereri.filter((u) => /\/rest\/v1\/catalog_/.test(u))}`);
    verifica(!cereri.some((u) => /catalog-categorie/.test(u)), 'cerere spre catalog-categorie');
    verifica(await p.evaluate(() => document.querySelectorAll('.db-card').length) === 65, 'toate cardurile desenate');
    const loturi = await p.evaluate(() => window.__loturi);
    verifica(loturi[0] === 12 && loturi.length > 3 && loturi.every((n) => n <= 12), `loturi: ${loturi}`);
    verifica(await p.textContent('[data-stat="catalog-public"]') === '65', `contorul din hero: ${await p.textContent('[data-stat="catalog-public"]')}`);
    verifica(!erori.length, 'erori JS: ' + erori.join(' | '));
    await ctx.close();
  }
  {
    const s = citeste('mydarrin-catalog.html');
    const loader = s.indexOf('/i18n-loader.js');
    const cerere1 = s.indexOf('window.__catalogPromis = window.__catalogCere()');
    verifica(loader > 0 && cerere1 > loader && cerere1 - loader < 900 && cerere1 < s.indexOf('</head>'), 'cererea pornește în <head>, după i18n-loader');
    verifica(!/async function sg\(|preturiCatalog\(/.test(s), 'sg / preturiCatalog au rămas');
    verifica(!/\/rest\/v1\/\$\{table\}/.test(s), 'citire directă din catalog');
  }
  {
    // Eroare → mesajul cu „Reîncearcă”, apoi o cerere nouă reușită.
    reset();
    CTRL.cade = true;
    const { ctx, p, erori, cereri } = await deschide(browser, baza, { faraAsteptare: true });
    await p.waitForSelector('#grid-servicii .cat-stare button');
    verifica(/nu s-a putut încărca/.test(await p.textContent('#grid-servicii .cat-stare')), 'mesajul de eroare');
    CTRL.cade = false;
    await p.click('#grid-servicii .cat-stare button');
    await p.waitForFunction(() => window.__catalogDesenat === true);
    verifica(await p.evaluate(() => document.querySelectorAll('.db-card').length) === 65, 'după reîncercare');
    verifica(cereri.filter((u) => u.startsWith('/api/public/catalog?')).length === 2, 'reîncercarea face o cerere nouă');
    verifica(!erori.length, 'erori JS la eroare: ' + erori.join(' | '));
    await ctx.close();
  }
  {
    // Engleza: adresa cu lang=en; textele noi în engleză.
    reset();
    const { ctx, p, cereri } = await deschide(browser, baza, { w: 390, h: 844, lang: 'en' });
    verifica(cereri.some((u) => /^\/api\/public\/catalog\?.*lang=en/.test(u)), 'lang=en');
    await p.waitForTimeout(400);
    verifica((await p.textContent('#mobile-filter-btn')).trim() === 'Filters', `butonul EN: ${await p.textContent('#mobile-filter-btn')}`);
    await p.click('#mobile-filter-btn');
    verifica((await p.textContent('#filtre-aplica')).trim() === 'Apply' && (await p.textContent('#filtre-reseteaza')).trim() === 'Reset', 'butoanele panoului EN');
    await p.check('#filter-urgent');
    await p.click('#filtre-aplica');
    await p.waitForTimeout(100);
    verifica(await p.getAttribute('#filtre-numar', 'aria-label') === '1 active filters', `aria-label: ${await p.getAttribute('#filtre-numar', 'aria-label')}`);
    verifica(await susGrila(p) <= 900, `EN 390: grila la ${await susGrila(p)}`);
    await ctx.close();
  }

  console.log('D. Telefon și desktop');
  {
    reset();
    const { ctx, p, erori } = await deschide(browser, baza, { w: 390, h: 844 });
    await p.waitForTimeout(300);
    const sus = await susGrila(p);
    verifica(sus <= 900, `390: grila începe la ${sus}px`);
    console.log(`    390 px: grila la ${sus} px`);
    verifica(await p.isHidden('#cat-aside'), 'filtrele nu stau în pagină');
    verifica(await p.isVisible('#mobile-filter-btn') && (await p.textContent('#mobile-filter-btn')).trim() === 'Filtre', 'butonul Filtre');
    verifica(await p.isHidden('#filtre-numar'), 'fără număr când nu sunt filtre');
    const totale = await vizibile(p);
    verifica(totale === 31, `carduri vizibile: ${totale}`);

    await p.click('#mobile-filter-btn');
    verifica(await p.isVisible('#cat-aside') && await p.getAttribute('#mobile-filter-btn', 'aria-expanded') === 'true', 'panoul se deschide');
    const r = await p.evaluate(() => { const b = document.getElementById('cat-aside').getBoundingClientRect(); return { jos: b.bottom, sus: b.top, h: innerHeight }; });
    verifica(r.jos <= r.h && r.sus > r.h * 0.2, `panoul de jos: ${JSON.stringify(r)}`);
    verifica(await p.isVisible('#filtre-aplica') && await p.isVisible('#filtre-reseteaza'), 'Aplică / Resetează vizibile');
    verifica((await p.textContent('#filtre-aplica')).trim() === 'Aplică' && (await p.textContent('#filtre-reseteaza')).trim() === 'Resetează', 'textele RO');

    // Aplică: filtrul de tip + cel de preț (doar la „Aplică”).
    await p.click('#tip-mentenanta');
    await p.waitForTimeout(50);
    verifica(await p.textContent('#filtre-numar') === '1', 'numărul după tip');
    await p.click('#tip-all');
    await p.evaluate(() => { const r = document.getElementById('price-range'); r.value = Math.floor(window.PRET_MAXIM_CATALOG / 2); r.dispatchEvent(new Event('input')); });
    await p.check('#filter-ai');
    await p.click('#filtre-aplica');
    await p.waitForTimeout(100);
    verifica(await p.isHidden('#cat-aside') && await p.getAttribute('#mobile-filter-btn', 'aria-expanded') === 'false', '„Aplică” închide panoul');
    verifica(await p.textContent('#filtre-numar') === '2', `număr filtre active: ${await p.textContent('#filtre-numar')}`);
    const filtrate = await vizibile(p);
    verifica(filtrate < totale, `filtrele se aplică: ${filtrate} din ${totale}`);

    // Resetează: totul revine.
    await p.click('#mobile-filter-btn');
    await p.click('#tip-reparatie');
    await p.click('#filtre-reseteaza');
    await p.waitForTimeout(100);
    verifica(await p.isHidden('#filtre-numar'), 'numărul dispare la reset');
    verifica(await vizibile(p) === totale, `după reset: ${await vizibile(p)}`);
    verifica(await p.isChecked('#filter-ai') === false, 'bifa resetată');
    verifica(await p.evaluate(() => activeTip) === 'all', 'tipul resetat');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(50);
    verifica(await p.isHidden('#cat-aside'), 'Esc închide panoul');
    verifica(await p.evaluate(() => getComputedStyle(document.querySelector('.hcar-wrap')).overflowX) === 'auto', 'caruselul derulabil');
    verifica(await p.$$eval('.hcar-card', (c) => c.filter((x) => x.offsetParent).length) === 15, 'caruselul fără copii');
    const carusel = await p.evaluate(() => Math.round(document.querySelector('.hcar-wrap').getBoundingClientRect().height));
    verifica(carusel <= 80, `înălțimea caruselului: ${carusel}`);
    verifica(!erori.length, 'erori JS 390: ' + erori.join(' | '));
    await ctx.close();
  }
  {
    reset();
    const { ctx, p } = await deschide(browser, baza, { w: 1366, h: 900 });
    verifica(await p.isVisible('#cat-aside') && await p.isHidden('#mobile-filter-btn') && await p.isHidden('#filtre-mobil-actiuni'), '1366: filtrele în coloană');
    const c = await p.evaluate(() => ({ aside: document.getElementById('cat-aside').getBoundingClientRect().width, col: getComputedStyle(document.getElementById('main-grid')).gridTemplateColumns, carusel: getComputedStyle(document.querySelector('.hcar-track')).animationName, hero: Math.round(document.getElementById('catalog-hero').getBoundingClientRect().height) }));
    verifica(c.aside === 220 && /^220px /.test(c.col), `coloana: ${JSON.stringify(c)}`);
    verifica(c.carusel !== 'none', 'caruselul animat pe desktop');
    for (const [fila, id] of [['servicii', 'main-tab-servicii'], ['materiale', 'main-tab-materiale'], ['inchiriere', 'main-tab-inchiriere']]) {
      await p.click('#' + id);
      await p.waitForTimeout(150);
      const r = await p.evaluate(repetari);
      verifica(r.carduri > 0 && r.n === 0, `1366 ${fila}: ${JSON.stringify(r)}`);
    }
    await ctx.close();
  }
  {
    // Vecinii și pe telefon, schimbând fila din panou.
    reset();
    const { ctx, p } = await deschide(browser, baza, { w: 390, h: 844 });
    for (const [fila, id] of [['materiale', 'main-tab-materiale'], ['inchiriere', 'main-tab-inchiriere'], ['servicii', 'main-tab-servicii']]) {
      await p.click('#mobile-filter-btn');
      await p.click('#' + id);
      await p.click('#filtre-aplica');
      await p.waitForTimeout(150);
      const r = await p.evaluate(repetari);
      verifica(r.carduri > 0 && r.n === 0, `390 ${fila}: ${JSON.stringify(r)}`);
    }
    await ctx.close();
  }

  console.log('E. Lățimi');
  for (const [w, h] of [[360, 780], [390, 844], [768, 1024], [1024, 768], [1366, 900]]) {
    for (const lang of ['ro', 'en']) {
      reset();
      const { ctx, p, erori } = await deschide(browser, baza, { w, h, lang });
      await p.waitForTimeout(300);
      const l = await depasire(p);
      verifica(l <= 0, `${w}px ${lang}: derulare orizontală ${l}px`);
      verifica((await p.evaluate(repetari)).n === 0, `${w}px ${lang}: repetări`);
      verifica(!erori.length, `${w}px ${lang}: ${erori.join(' | ')}`);
      if (w <= 390) verifica(await susGrila(p) <= 900, `${w}px ${lang}: grila la ${await susGrila(p)}`);
      if (w === 768) verifica(await p.isVisible('#mobile-filter-btn') && await p.isHidden('#cat-aside'), `768px: butonul Filtre`);
      if (w === 1024) verifica(await p.isHidden('#mobile-filter-btn') && await p.isVisible('#cat-aside'), `1024px: coloana`);
      await ctx.close();
    }
  }
}

(async () => {
  await testeApi();
  await testeLive();
  const srv = await porneste(0);
  const browser = await chromium.launch();
  try { await testeBrowser('http://localhost:' + srv.address().port, browser); }
  finally { await browser.close(); srv.close(); }
  console.log(`\n${ok} verificări trecute, ${esec} eșuate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
