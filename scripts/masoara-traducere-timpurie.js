// scripts/masoara-traducere-timpurie.js
// Pasul 11-T0 (11 nov. 2026): măsurătorile pentru raport — main față de ramură.
// Pentru fiecare pagină, lățime și variantă a loader-ului: mediana a N rulări (implicit 3),
// Fast 4G (CDP, ca în DevTools: 9 Mbit/s, 1,5 Mbit/s, 165 ms), fără cache (context nou
// la fiecare rulare), modul EN (prima vizită):
//   - vizibilă: momentul în care dispare clasa myd-i18n-pending (pagina devine vizibilă);
//   - LCP și elementul LCP (ultima intrare largest-contentful-paint până la 6 s);
//   - primul card (doar catalog): primul .db-card din pagină, vizibil (după afișare);
//   - CLS până la 6 s;
//   - cadre cu română vizibilă până la 3 s (o trecere separată, cu eșantionarea din
//     test-i18n-fara-romana.js, ca scanarea pe fiecare cadru să nu influențeze LCP).
// Variantele: i18n-loader.js din main (git show) și din copia de lucru; amândouă servite
// la fel (prin route, cu aceeași întârziere de rețea simulată), restul fișierelor din
// serverul de test. Varianta main scoate din HTML <link rel="preload" ... /i18n/en.json>
// (adăugat în 11-T0 pe paginile măsurate); cu --fara-preload, se adaugă și varianta
// ramurii fără el.
// Datele: catalogul din api/public/catalog.js cu baza simulată (64 de produse), pagina de
// produs din Supabase REST simulat (un serviciu cu trei niveluri, traducerea lui prin
// /api/public/traduceri-catalog); restul API-urilor ca în server-test.js.
//
// Rulare: node scripts/masoara-traducere-timpurie.js [--rulari 3] [--fara-preload] [--detalii] [--json fisier] [pagina ...]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
const pRate = require.resolve(path.join(RADACINA, 'lib/rate-limit.js'));
require.cache[pRate] = { id: pRate, filename: pRate, loaded: true, exports: { checkRateLimit: async () => true } };
const { chromium } = require('playwright');
const { porneste } = require('./server-test');
const { urmareste, FAST_4G } = require('./test-i18n-fara-romana');
const apiCatalog = require(path.join(RADACINA, 'api/public/catalog.js'));

const arg = process.argv.slice(2);
const opt = (n, d) => { const i = arg.indexOf('--' + n); if (i === -1) return d; const v = arg[i + 1]; arg.splice(i, 2); return v; };
const flag = (n) => { const i = arg.indexOf('--' + n); if (i === -1) return false; arg.splice(i, 1); return true; };
const RULARI = Number(opt('rulari', 3));
const IESIRE = opt('json', null);
const FARA_PRELOAD = flag('fara-preload');
const DETALII = flag('detalii'); // toate intrările LCP și deplasările, pe rulare
const PAGINI = arg.length ? arg : ['mydarrin-catalog', 'index', 'mydarrin-produs', 'cum-devii-partenerul-nostru', 'mydarrin-investitori'];
const ADRESE = { index: '/', 'mydarrin-produs': '/mydarrin-produs?slug=inlocuire-becuri-corpuri&type=servicii' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

const VARIANTE = [
  { nume: 'main', loader: execSync('git show main:i18n-loader.js', { cwd: RADACINA, encoding: 'utf8' }), faraPreload: true },
  { nume: 'ramura', loader: fs.readFileSync(path.join(RADACINA, 'i18n-loader.js'), 'utf8') },
];
if (FARA_PRELOAD) VARIANTE.push({ nume: 'ramura-fara-preload', loader: VARIANTE[1].loader, faraPreload: true });
const PRELOAD = /<!-- Pasul 11-T0:[^\n]*\n?\s*<link rel="preload" href="\/i18n\/en\.json" as="fetch" crossorigin>\r?\n?/;

// Întârzierea unui răspuns servit prin route (CDP nu limitează răspunsurile din route):
// un drum dus-întors + transferul la 9 Mbit/s.
const intarziere = (octeti) => FAST_4G.latency + (octeti / FAST_4G.downloadThroughput) * 1000;
const asteapta = (ms) => new Promise((a) => setTimeout(a, ms));

function bazaDate() {
  const produse = [];
  const adauga = (tip, n, prefix, titlu, domeniu) => {
    for (let i = 0; i < n; i++) produse.push({ id: `${prefix}${i}`, id_serviciu: `${prefix}-${i}`, titlu: `${titlu} v${i}`, categorie: tip, domeniu, imagini: [], status_public: true, unitate_masura: 'buc', descriere: 'Test', categorie_id: null, subcategorie_id: null });
  };
  adauga('servicii', 30, 'pri', 'Calorifer aluminiu', 'Bricolaj & Consumabile');
  adauga('materiale', 20, 'gar', 'Lavoar ceramic', 'Bricolaj & Consumabile');
  adauga('inchirieri', 14, 'veh', 'Iluminat LED', 'Vehicule & Transport');
  produse.push({ id: 'bec1', id_serviciu: 'inlocuire-becuri-corpuri', titlu: 'Înlocuire becuri și corpuri de iluminat', categorie: 'servicii', domeniu: 'Instalații electrice', imagini: [], status_public: true, unitate_masura: 'buc', descriere: 'Înlocuirea becurilor și a corpurilor de iluminat existente.', nace: '43.21' });
  DB.tabele = {
    tax_configurations: [{ tara_cod: 'RO', moneda: 'RON', cota_tva: 21, prag_minim_comanda: 100, checkout_activ: true }],
    backoffice_config: [], catalog_servicii: produse, devize_articole: [], catalog_relatii: [], categorii: [], catalog_materiale_recomandate: [],
    catalog_niveluri: ['Bronze', 'Silver', 'Gold'].map((n, i) => ({ id: 'nv' + i, serviciu_id: 'bec1', nivel: n, descriere: 'Nivel ' + n, ordine: i })),
  };
  DB.coloane = {};
}
const TRADUCERI_DB = { _texte: { 'Înlocuire becuri și corpuri de iluminat': 'Replacing bulbs and light fittings', 'Înlocuirea becurilor și a corpurilor de iluminat existente.': 'Replacing existing bulbs and light fittings.', 'Instalații electrice': 'Electrical installations', 'Nivel Bronze': 'Bronze level', 'Nivel Silver': 'Silver level', 'Nivel Gold': 'Gold level' } };
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

// Momentele din pagină (fără eșantionarea pe cadre).
function metrici() {
  const M = window.__m = { lcp: null, lcpEl: null, cls: 0, card: null, toate: [], deplasari: [] };
  const sel = (el) => { if (!el || el.nodeType !== 1) return '?'; let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/)[0]; return s; };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { M.toate.push(Math.round(e.startTime) + ' ' + sel(e.element) + ' ' + e.size); M.lcp = e.startTime; M.lcpEl = sel(e.element) + ' «' + ((e.element && e.element.textContent) || e.url || '').replace(/\s+/g, ' ').trim().slice(0, 40) + '»'; } }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { M.cls += e.value; M.deplasari.push(Math.round(e.startTime) + ' ' + e.value.toFixed(3) + ' ' + (e.sources || []).map((x) => sel(x.node) + ' ' + Math.round(x.previousRect.y) + '→' + Math.round(x.currentRect.y)).join(', ')); } }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  new MutationObserver(() => {
    if (M.card == null && document.querySelector('.db-card')) M.card = performance.now();
    if (M.h1 == null && document.querySelector('h1.visible')) M.h1 = performance.now();
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  if (document.fonts) document.fonts.ready.then(() => { M.fonturi = performance.now(); });
}

async function ruleaza(browser, baza, varianta, pagina, w, esantioneaza) {
  bazaDate();
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 800 ? 844 : 900 }, locale: 'en-GB' });
  await ctx.addInitScript(urmareste, { lang: 'en', esantioneaza, pana: 3000 });
  if (!esantioneaza) await ctx.addInitScript(metrici);
  await ctx.route((u) => u.origin === baza && u.pathname === '/i18n-loader.js', async (r) => { await asteapta(intarziere(Buffer.byteLength(varianta.loader))); r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: varianta.loader }); });
  // Pagina trece prin route la toate variantele (aceeași întârziere simulată).
  await ctx.route((u) => u.origin === baza && !u.pathname.startsWith('/api/') && !/\.(js|json|css|png|svg|jpe?g|webp|ico|woff2?)$/.test(u.pathname), async (r) => {
    if (r.request().resourceType() !== 'document') return r.continue();
    const raspunsPagina = await r.fetch();
    let html = await raspunsPagina.text();
    if (varianta.faraPreload) html = html.replace(PRELOAD, '');
    await asteapta(intarziere(Buffer.byteLength(html)));
    r.fulfill({ response: raspunsPagina, body: html, headers: { ...raspunsPagina.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });
  await ctx.route(/images\.unsplash\.com/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.route(/\.supabase\.co\/rest\/v1\//, async (r) => { await asteapta(FAST_4G.latency); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rest(r.request().url())) }); });
  await ctx.route(/\.supabase\.co\/(?!rest\/v1\/)/, (r) => r.abort());
  await ctx.route(/ipapi\.co|nominatim|googletagmanager|google-analytics/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route(/\/api\/public\/(catalog|traduceri-catalog)(\?|$)/, async (r) => {
    const u = new URL(r.request().url());
    let corp;
    if (u.pathname === '/api/public/traduceri-catalog') corp = TRADUCERI_DB;
    else { const res = raspuns(); await apiCatalog(cerere({ metoda: 'GET', query: Object.fromEntries(u.searchParams) }), res); corp = res.corp; }
    const body = JSON.stringify(corp);
    await asteapta(intarziere(Buffer.byteLength(body)));
    r.fulfill({ status: 200, contentType: 'application/json', body });
  });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', FAST_4G);
  let cereriEn = 0;
  p.on('request', (q) => { if (/\/i18n\/en\.json/.test(q.url())) cereriEn++; });
  await p.goto(baza + (ADRESE[pagina] || '/' + pagina), { waitUntil: 'commit', timeout: 60000 });
  await p.waitForFunction((pana) => performance.now() > pana, esantioneaza ? 3100 : 6000, { timeout: 60000, polling: 100 });
  const t = await p.evaluate(() => window.__t);
  const m = esantioneaza ? null : await p.evaluate(() => window.__m);
  await ctx.close();
  return { t, m, cereriEn };
}

const mediana = (v) => { const x = v.filter((n) => n != null).sort((a, b) => a - b); return x.length ? x[Math.floor(x.length / 2)] : null; };
const ms = (v) => (v == null ? '—' : Math.round(v));

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  const rezultate = [];
  try {
    for (const pagina of PAGINI) {
      for (const w of [390, 1366]) {
        for (const v of VARIANTE) {
          const r = { pagina, w, varianta: v.nume, rulari: [] };
          for (let i = 0; i < RULARI; i++) {
            const a = await ruleaza(browser, baza, v, pagina, w, false);
            const b = await ruleaza(browser, baza, v, pagina, w, true);
            if (DETALII) console.log(`  [${v.nume} ${w}] vizibilă=${Math.round(a.t.reveal)} DCL=${Math.round(a.t.dcl)} h1.visible=${Math.round(a.m.h1)} fonturi=${Math.round(a.m.fonturi)}
    LCP: ${a.m.toate.join(' | ')}
    CLS: ${a.m.deplasari.join(' | ')}`);
            const card = a.m.card == null ? null : Math.max(a.m.card, a.t.reveal || 0);
            r.rulari.push({ vizibila: a.t.reveal, dcl: a.t.dcl, lcp: a.m.lcp, lcpEl: a.m.lcpEl, card, cls: a.m.cls, cadreRo: b.t.cadreRo, cadreVizibile: b.t.cadreVizibile, exemplu: b.t.exemple[0] || null, cereriEn: a.cereriEn });
          }
          const k = (c) => mediana(r.rulari.map((x) => x[c]));
          r.mediana = { vizibila: k('vizibila'), dcl: k('dcl'), lcp: k('lcp'), card: k('card'), cls: k('cls'), cadreRo: k('cadreRo') };
          // elementul LCP al rulării mediane
          const lcpMed = r.rulari.find((x) => x.lcp === r.mediana.lcp);
          r.mediana.lcpEl = lcpMed ? lcpMed.lcpEl : null;
          rezultate.push(r);
          console.log(`${pagina.padEnd(28)} ${String(w).padEnd(5)} ${v.nume.padEnd(15)} vizibilă=${ms(r.mediana.vizibila)} DCL=${ms(r.mediana.dcl)} LCP=${ms(r.mediana.lcp)} ${r.mediana.lcpEl || ''} card=${ms(r.mediana.card)} CLS=${r.mediana.cls == null ? '—' : r.mediana.cls.toFixed(3)} cadreRO=${r.mediana.cadreRo} [${r.rulari.map((x) => x.cadreRo).join(',')}] en.json×${r.rulari.map((x) => x.cereriEn).join(',')}`);
        }
      }
    }
  } finally { await browser.close(); srv.close(); }
  if (IESIRE) fs.writeFileSync(IESIRE, JSON.stringify(rezultate, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
