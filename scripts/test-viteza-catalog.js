// scripts/test-viteza-catalog.js
// Pasul 11-C9 (8 nov. 2026): imaginile din catalog se încarcă mai repede.
//   A. fișierele: preconnect / dns-prefetch; adresele vechi și imaginile base64 nu mai
//      sunt în pagină; caruselul în formatul nou; datele vin dintr-o singură cerere (11-C10);
//      fișierele din assets/img au cache;
//   B. /api/public/catalog-categorie: antetul de cache doar la succes, același
//      răspuns indiferent de utilizator;
//   C. în browser: auto=format, srcset, sizes, decoding, dimensiuni; fără schimbare
//      de src după prima setare; o singură cerere pe card; prioritate pentru primele
//      8; regula vecinilor pe fiecare filă; la redimensionare se schimbă doar
//      cardurile a căror variantă se schimbă; înlocuitorul și erorile;
//   D. 390, 768, 1024, 1366 px: fără derulare orizontală, erori JS, imagini rupte.
// Rulare: node scripts/test-viteza-catalog.js

const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
const pRate = require.resolve(path.join(RADACINA, 'lib/rate-limit.js'));
require.cache[pRate] = { id: pRate, filename: pRate, loaded: true, exports: { checkRateLimit: async () => true } };
const { chromium } = require('playwright');
const { porneste } = require('./server-test');
const apiCat = require(path.join(RADACINA, 'api/public/catalog-categorie.js'));

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const citeste = (f) => fs.readFileSync(path.join(RADACINA, f), 'utf8');
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const REAL = 'https://x.supabase.co/storage/v1/object/public/poze/real.jpg';
const STRICAT = 'https://x.supabase.co/storage/v1/object/public/poze/stricat.jpg';

function produse() {
  const l = [];
  const adauga = (tip, n, prefix, titlu, domeniu) => { for (let i = 0; i < n; i++) l.push({ id: prefix + i, id_serviciu: `${prefix}-${i}`, titlu: `${titlu} v${i}`, categorie: tip, domeniu, imagini: [], status_public: true, unitate_masura: 'buc', descriere: 'Test' }); };
  adauga('servicii', 24, 'pri', 'Calorifer aluminiu', 'Bricolaj & Consumabile');
  adauga('materiale', 16, 'gar', 'Lavoar ceramic', 'Bricolaj & Consumabile');
  adauga('inchirieri', 10, 'veh', 'Iluminat LED', 'Vehicule & Transport');
  l[2].imagini = [REAL];
  l[23].imagini = [STRICAT];
  return l;
}
function rest(url) {
  const u = new URL(url);
  if (u.pathname.split('/').pop() !== 'catalog_servicii') return [];
  if (/like\./.test(u.search)) return [];
  const cat = (u.searchParams.get('categorie') || '').replace('eq.', '');
  return produse().filter((x) => x.categorie === cat);
}
function urmareste() {
  window.__src = new Map();
  window.__ordine = [];
  new MutationObserver((l) => l.forEach((m) => {
    if (m.type === 'attributes' && m.target.matches && m.target.matches('.card-media img')) window.__src.set(m.target, (window.__src.get(m.target) || 0) + 1);
  })).observe(document, { subtree: true, attributes: true, attributeFilter: ['src'] });
  try { localStorage.setItem('myd_lang_v1', 'ro'); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 })); } catch (e) {}
}
async function deschide(browser, baza, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: o.w || 1366, height: o.h || 900 } });
  await ctx.addInitScript(urmareste);
  const cereri = [], esuate = [];
  await ctx.route(/images\.unsplash\.com/, async (r) => { cereri.push(r.request().url()); if (o.intarziere) await asteapta(o.intarziere); return r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
  await ctx.route(/\.supabase\.co\/storage\//, (r) => (r.request().url() === STRICAT ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ status: 200, contentType: 'image/png', body: PNG })));
  await ctx.route(/\.supabase\.co\/rest\/v1\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rest(r.request().url())) }));
  await ctx.route(/\.supabase\.co\/(?!rest\/v1\/|storage\/)/, (r) => r.abort());
  await ctx.route(/ipapi\.co|nominatim/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route(/\/api\/public\/catalog\?/, (r) => { const tip = (c) => produse().filter((x) => x.categorie === c).map((x) => ({ ...x, pret_de_la: null, are_pret: false })); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, servicii: tip('servicii'), materiale: tip('materiale'), inchirieri: tip('inchirieri'), relatii: [], servicii_asociate: [] }) }); });
  const p = await ctx.newPage();
  p.setDefaultTimeout(12000);
  const erori = [];
  p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
  p.on('requestfailed', (r) => { if (/images\.unsplash\.com/.test(r.url())) esuate.push(r.url()); });
  // Cu imagini întârziate nu se așteaptă „load”: cardurile apar acum înainte de el (11-C10).
  await p.goto(`${baza}/mydarrin-catalog.html`, { waitUntil: o.intarziere ? 'domcontentloaded' : 'load', timeout: 60000 });
  await p.waitForSelector('#grid-servicii .db-card');
  await p.waitForFunction(() => window.__catalogDesenat);
  return { ctx, p, erori, cereri, esuate };
}
function repetari() {
  const viz = [...document.querySelectorAll('.tab-content.active .db-card')].filter((c) => c.offsetParent);
  const rd = [];
  viz.forEach((c) => { const t = Math.round(c.getBoundingClientRect().top + scrollY); let r = rd.find((x) => Math.abs(x.t - t) < 5); if (!r) rd.push(r = { t, c: [] }); r.c.push(c); });
  rd.sort((a, b) => a.t - b.t);
  const src = (c) => c.querySelector('.card-media img').getAttribute('src');
  const nv = (c) => (c.dataset.imgVariante || '').split(' ').filter(Boolean).length;
  let n = 0;
  rd.forEach((r, i) => r.c.forEach((c, j) => { if (nv(c) < 2) return; if (j && src(r.c[j - 1]) === src(c)) n++; const s = i ? rd[i - 1].c[j] : null; if (s && src(s) === src(c)) n++; }));
  return { n, carduri: viz.length, coloane: Math.max(...rd.map((r) => r.c.length)) };
}

function testeFisiere() {
  const s = citeste('mydarrin-catalog.html');
  verifica(/<link rel="preconnect" href="https:\/\/images\.unsplash\.com">/.test(s) && /<link rel="dns-prefetch" href="https:\/\/images\.unsplash\.com">/.test(s), 'preconnect / dns-prefetch');
  verifica(!/data:image\/(png|jpeg);base64/.test(s), 'imagini base64 în pagină');
  for (const f of ['assets/img/logo-my-darrin.webp', 'assets/img/darrin-ai.webp']) verifica(fs.existsSync(path.join(RADACINA, f)) && s.includes(f), `${f} lipsește`);
  verifica((s.match(/\?w=600&q=80/g) || []).length === 0, 'adrese vechi ?w=600&q=80 în pagină');
  const carusel = [...s.matchAll(/class="hcar-card">\s*<img ([^>]*)>/g)].map((m) => m[1]);
  verifica(carusel.length === 30 && carusel.every((a) => /auto=format/.test(a) && /srcset="/.test(a) && /sizes="/.test(a) && /decoding="async"/.test(a) && /loading="lazy"/.test(a)), `caruselul: ${carusel.length} imagini`);
  verifica(/await window\.__catalogPromis;/.test(s) && !/Promise\.all\(\[\s*\/\/ 31 august/.test(s), 'datele nu vin din cererea unică');
  verifica(/@media \(prefers-reduced-motion:reduce\)\{\.card-media\.img-asteapta\{animation:none\}/.test(s), 'prefers-reduced-motion');
  const v = JSON.parse(citeste('vercel.json'));
  const reg = v.headers.find((h) => h.source === '/assets/img/(.*)');
  const idx = (x) => v.headers.indexOf(x);
  verifica(reg && /max-age=86400/.test(reg.headers[0].value) && idx(reg) > idx(v.headers.find((h) => h.source === '/(.*)')), 'cache pentru assets/img');
}

async function testeApi() {
  const baza = { tax_configurations: [{ tara_cod: 'RO', moneda: 'RON' }], catalog_servicii: [{ id: 'p1', id_serviciu: 'x', titlu: 'X', categorie: 'servicii', status_public: true, imagini: [] }], catalog_niveluri: [], devize_articole: [], categorii: [] };
  DB.tabele = JSON.parse(JSON.stringify(baza)); DB.coloane = {};
  const cu = raspuns(), alt = raspuns();
  await apiCat(cerere({ metoda: 'GET', query: { toate: '1', tip: 'servicii', tara: 'RO' } }), cu);
  await apiCat(cerere({ metoda: 'GET', token: 'tok-cineva', query: { toate: '1', tip: 'servicii', tara: 'RO' } }), alt);
  verifica(cu.statusCode === 200 && cu.headere['Cache-Control'] === 'public, s-maxage=300, stale-while-revalidate=600', `antetul de cache: ${JSON.stringify(cu.headere)}`);
  verifica(JSON.stringify(cu.corp) === JSON.stringify(alt.corp), 'răspunsul depinde de utilizator');
  verifica(!/discount|comision/i.test(JSON.stringify(cu.corp)), 'răspunsul conține discounturi sau comisioane');
  const sursa = citeste('api/public/catalog-categorie.js');
  verifica(!/req\.headers|cookie|authorization/i.test(sursa.replace(/^\s*\/\/.*$/gm, '')), 'endpoint-ul citește antete de utilizator');
  const rez = sursa.indexOf("res.setHeader('Cache-Control'"), er = sursa.indexOf('res.status(500)');
  verifica(rez > 0 && rez < er && (sursa.match(/Cache-Control/g) || []).length === 1, 'antetul de cache se pune și pe erori');
}

async function testeBrowser(baza, browser) {
  {
    const { ctx, p, erori, cereri, esuate } = await deschide(browser, baza);
    await asteapta(700);
    const a = await p.evaluate(() => [...document.querySelectorAll('#grid-servicii .db-card')].map((c) => {
      const i = c.querySelector('.card-media img');
      return { real: c.dataset.imgSursa === 'real', src: i.getAttribute('src'), srcset: i.getAttribute('srcset'), sizes: i.getAttribute('sizes'), dec: i.getAttribute('decoding'), w: i.getAttribute('width'), h: i.getAttribute('height'), load: i.getAttribute('loading'), prio: i.getAttribute('fetchpriority'), foto: i.dataset.foto, sch: window.__src.get(i) || 0, cuTipSrc: i.hasAttribute('src') };
    }));
    const prez = a.filter((x) => !x.real), real = a.filter((x) => x.real);
    verifica(a.length === 24 && prez.length === 22 && real.length === 2, `carduri: ${a.length}/${prez.length}/${real.length}`);
    verifica(prez.every((x) => /auto=format&fit=crop&w=600&q=70$/.test(x.src) && x.srcset.split(', ').length === 3 && [400, 600, 800].every((w) => x.srcset.includes(`w=${w}&q=70 ${w}w`)) && /211px/.test(x.sizes)), 'format / srcset / sizes');
    verifica(a.every((x) => x.dec === 'async' && x.w === '600' && x.h === '400'), 'decoding sau dimensiuni');
    verifica(real.every((x) => !x.srcset && !x.sizes && !x.foto) && real[0].src === REAL, `imaginea reală: ${JSON.stringify(real)}`);
    verifica(prez.every((x) => x.sch === 1), `src schimbat după prima setare: ${JSON.stringify(prez.filter((x) => x.sch !== 1).map((x) => x.sch))}`);
    verifica(!esuate.length, `cereri abandonate: ${esuate.length}`);
    verifica(a.slice(0, 8).every((x) => x.load === 'eager' && x.prio === 'high') && a.slice(8).every((x) => x.load === 'lazy' && !x.prio), `prioritate: ${JSON.stringify(a.map((x) => [x.load, x.prio]))}`);
    const oCerere = a.slice(0, 8).filter((x) => !x.real).every((x) => cereri.filter((u) => u.includes(`photo-${x.foto}?`) && /w=(400|600|800)/.test(u)).length >= 1);
    verifica(oCerere, 'primele carduri nu și-au cerut imaginea');
    const fotoVechi = a.slice(0, 8).filter((x) => !x.real).map((x) => x.foto);
    const cereriCarduri = cereri.filter((u) => fotoVechi.some((f) => u.includes(`photo-${f}?`)));
    verifica(new Set(cereriCarduri).size === cereriCarduri.length, `aceeași imagine cerută de două ori: ${cereriCarduri.length}`);
    verifica(await p.evaluate(() => [...document.querySelectorAll('#tab-materiale .card-media img, #tab-inchiriere .card-media img')].every((i) => i.getAttribute('loading') === 'lazy' && !i.hasAttribute('fetchpriority'))), 'prioritate pe filele ascunse');
    verifica((await p.evaluate(repetari)).n === 0, 'repetări pe Servicii');
    for (const f of ['materiale', 'inchiriere']) {
      await p.evaluate((t) => window.switchMainTab(t, document.getElementById('main-tab-' + t)), f);
      await asteapta(350);
      const r = await p.evaluate(repetari);
      verifica(r.n === 0 && r.carduri > 0, `repetări pe ${f}: ${JSON.stringify(r)}`);
    }
    verifica(!erori.length, erori.join(' | '));
    await ctx.close();
  }
  // Redimensionare: doar cardurile a căror variantă se schimbă.
  {
    const { ctx, p } = await deschide(browser, baza);
    await asteapta(500);
    await p.evaluate(() => { window.__inainte = new Map([...document.querySelectorAll('#grid-servicii .card-media img')].map((i) => [i, i.dataset.foto])); window.__src.clear(); });
    await p.setViewportSize({ width: 1024, height: 768 });
    await asteapta(700);
    const r = await p.evaluate(() => { let schimbate = 0, gresit = 0; window.__inainte.forEach((f, i) => { const s = window.__src.get(i) || 0; if (i.dataset.foto !== f) { schimbate++; if (s !== 1) gresit++; } else if (s) gresit++; }); return { schimbate, gresit }; });
    verifica(r.gresit === 0, `redimensionare: ${JSON.stringify(r)}`);
    await ctx.close();
  }
  // Înlocuitorul
  {
    const { ctx, p } = await deschide(browser, baza, { intarziere: 1500 });
    const inainte = await p.evaluate(() => { const m = document.querySelector('#grid-servicii .db-card .card-media'); return { cl: m.classList.contains('img-asteapta'), op: getComputedStyle(m.querySelector('img')).opacity }; });
    verifica(inainte.cl && inainte.op === '0', `înlocuitorul: ${JSON.stringify(inainte)}`);
    await p.waitForFunction(() => !document.querySelector('#grid-servicii .db-card .card-media').classList.contains('img-asteapta'), null, { timeout: 8000 }).catch(() => {});
    await asteapta(260);
    const dupa = await p.evaluate(() => { const m = document.querySelector('#grid-servicii .db-card .card-media'); return { cl: m.classList.contains('img-asteapta'), op: getComputedStyle(m.querySelector('img')).opacity, t: getComputedStyle(m.querySelector('img')).transitionDuration }; });
    verifica(!dupa.cl && dupa.op === '1' && dupa.t.includes('0.18s'), `după încărcare: ${JSON.stringify(dupa)}`);
    await ctx.close();
  }
  // Eroare la imaginea reală: rezerva, apoi fără înlocuitor rămas.
  {
    const { ctx, p } = await deschide(browser, baza);
    await p.evaluate(() => document.querySelector('[data-slug="pri-23"]').scrollIntoView({ behavior: 'instant' }));
    await asteapta(900);
    const r = await p.evaluate(() => { const m = document.querySelector('[data-slug="pri-23"] .card-media'); const i = m.querySelector('img'); return { src: i.getAttribute('src'), cl: m.classList.contains('img-asteapta') }; });
    verifica(/auto=format/.test(r.src) && !r.cl, `rezerva imaginii reale: ${JSON.stringify(r)}`);
    await ctx.close();
  }
  // Ecrane
  for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1366, 900]]) {
    const { ctx, p, erori } = await deschide(browser, baza, { w, h });
    await asteapta(500);
    const l = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    verifica(l <= 0, `${w}px: derulare orizontală ${l}px`);
    const rupte = await p.$$eval('#grid-servicii .card-media img', (x) => Promise.all(x.map((i) => { i.loading = 'eager'; return i.decode().then(() => null).catch(() => i.getAttribute('src')); })));
    const reale = rupte.filter((u) => u && u !== STRICAT); // STRICAT e imaginea care eșuează intenționat (rezerva e testată mai sus).
    verifica(!reale.length, `${w}px: imagini rupte ${reale.slice(0, 3)}`);
    verifica((await p.evaluate(repetari)).n === 0, `${w}px: repetări`);
    verifica(!erori.length, `${w}px: ${erori.join(' | ')}`);
    await ctx.close();
  }
}

(async () => {
  testeFisiere();
  await testeApi();
  const srv = await porneste(0);
  const browser = await chromium.launch();
  try { await testeBrowser('http://localhost:' + srv.address().port, browser); }
  finally { await browser.close(); srv.close(); }
  console.log(`\n${ok} verificări trecute, ${esec} eșuate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
