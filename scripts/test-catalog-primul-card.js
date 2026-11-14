// scripts/test-catalog-primul-card.js
// Pasul 11-C11: primul lot al catalogului fără să aștepte restul paginii.
//   A. cu un script sincron întârziat artificial (2 s) la sfârșitul paginii, primul lot
//      (12 carduri) apare înainte de DOMContentLoaded, iar restul abia după;
//   B. fără carduri duble; cardurile desenate devreme rămân aceleași noduri; o singură
//      setare a imaginii pe card; CLS ≤ 0,05 la 390 și 1366 px;
//   C. fila sau filtrul din adresă: nimic desenat devreme, setul corect la final;
//   D. scripturile trecute pe defer (lucide, dompurify, account-system, seo-meta,
//      tva-config) își fac treaba: iconițe, TVA, MyDarrinAuth, DOMPurify; fără erori JS;
//   E. indicatorul „Sincronizare catalog...” trece prin window.t (EN: „Syncing catalog...”).

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

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const citeste = (f) => fs.readFileSync(path.join(RADACINA, f), 'utf8');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const INTARZIERE = 2000;

function reset() {
  const produse = [];
  const adauga = (tip, n, prefix, titlu, domeniu) => {
    for (let i = 0; i < n; i++) produse.push({ id: `${prefix}${i}`, id_serviciu: `${prefix}-${i}`, titlu: `${titlu} v${i}`, categorie: tip, domeniu, imagini: [], status_public: true, unitate_masura: 'buc', descriere: 'Test', categorie_id: null, subcategorie_id: null });
  };
  adauga('servicii', 30, 'pri', 'Calorifer aluminiu', 'Bricolaj & Consumabile');
  adauga('materiale', 20, 'gar', 'Lavoar ceramic', 'Bricolaj & Consumabile');
  adauga('inchirieri', 14, 'veh', 'Iluminat LED', 'Vehicule & Transport');
  DB.tabele = {
    tax_configurations: [{ tara_cod: 'RO', moneda: 'RON', cota_tva: 21, prag_minim_comanda: 100, checkout_activ: true }],
    backoffice_config: [], catalog_servicii: produse, catalog_niveluri: [], devize_articole: [], catalog_relatii: [], categorii: [],
  };
  DB.coloane = {};
}

// În pagină, de la primul octet: momentul primului card, câte carduri existau la
// DOMContentLoaded, nodurile primului lot, setările de src și deplasările de aspect.
function urmareste(lang) {
  try { localStorage.setItem('myd_lang_v1', lang); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), marketing: false, versiune: 2 })); } catch (e) {}
  window.__t = { cls: 0, src: new Map() };
  window.__t.deplasari = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__t.cls += e.value;
        window.__t.deplasari.push({ t: Math.round(e.startTime), v: +e.value.toFixed(3), surse: (e.sources || []).map((x) => (x.node && x.node.nodeType === 1 ? x.node.tagName.toLowerCase() + (x.node.id ? '#' + x.node.id : '') + (typeof x.node.className === 'string' && x.node.className ? '.' + x.node.className.trim().split(/\s+/)[0] : '') : '?') + ' ' + Math.round(x.previousRect.y) + '→' + Math.round(x.currentRect.y)) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  new MutationObserver((lista) => {
    if (window.__t.card == null && document.querySelector('.db-card')) window.__t.card = performance.now();
    lista.forEach((m) => { if (m.type === 'attributes' && m.target.matches && m.target.matches('.card-media img')) window.__t.src.set(m.target, (window.__t.src.get(m.target) || 0) + 1); });
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  document.addEventListener('DOMContentLoaded', () => {
    window.__t.dcl = performance.now();
    window.__t.laDcl = [...document.querySelectorAll('.db-card')];
    window.__t.laDclGrile = ['servicii', 'materiale', 'inchiriere'].map((g) => document.querySelectorAll('#grid-' + g + ' .db-card').length);
    window.__t.indicator = (document.getElementById('db-load-ind') || {}).textContent || '';
    window.__t.revealDevreme = !!window._revealObs;
  });
}

async function deschide(browser, baza, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: o.w || 1366, height: o.h || 900 } });
  await ctx.addInitScript(urmareste, o.lang || 'ro');
  const cereri = [];
  await ctx.route(/images\.unsplash\.com/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx.route(/\.supabase\.co\/rest\/v1\//, (r) => { cereri.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); });
  await ctx.route(/\.supabase\.co\/(?!rest\/v1\/)/, (r) => r.abort());
  await ctx.route(/ipapi\.co|nominatim/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  // Scriptul sincron întârziat, pus la sfârșitul paginii: DOMContentLoaded îl așteaptă.
  await ctx.route(/\/intarziat-test\.js$/, async (r) => { await new Promise((a) => setTimeout(a, INTARZIERE)); r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.__intarziatRulat = true;' }); });
  await ctx.route(/\/mydarrin-catalog(\.html)?(\?|$)/, async (r) => {
    const raspunsPagina = await r.fetch();
    const html = (await raspunsPagina.text()).replace('</body>', '<script src="/intarziat-test.js"></script>\n</body>');
    r.fulfill({ response: raspunsPagina, body: html, headers: { ...raspunsPagina.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });
  await ctx.route(/\/api\//, async (r) => {
    const u = new URL(r.request().url());
    cereri.push(u.pathname + u.search);
    if (u.pathname === '/api/public/catalog') {
      const res = raspuns();
      await apiCatalog(cerere({ metoda: 'GET', query: Object.fromEntries(u.searchParams) }), res);
      return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp) });
    }
    if (u.pathname === '/api/public/tari-active') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, active: ['RO'], tari: [{ tara_cod: 'RO', tara_nume: 'România' }], tva: { RO: 21 } }) });
    return r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' });
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  const erori = [];
  p.on('pageerror', (e) => erori.push(e.message.slice(0, 200)));
  await p.goto(`${baza}/mydarrin-catalog${o.adresa || ''}`, { waitUntil: 'load', timeout: 60000 });
  await p.waitForFunction(() => window.__catalogDesenat === true);
  await p.waitForTimeout(300);
  return { ctx, p, erori, cereri };
}

function fisiere() {
  console.log('A0. Fișierele');
  const s = citeste('mydarrin-catalog.html');
  for (const [nume, re] of [
    ['lucide', /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/lucide@[^"]+" defer><\/script>/],
    ['dompurify', /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/dompurify@[^"]+" defer><\/script>/],
    ['account-system', /<script src="\/?account-system\.js" defer /],
    ['seo-meta', /<script src="\/?seo-meta\.js" defer><\/script>/],
    ['tva-config', /<script src="\/?tva-config\.js" defer><\/script>/],
  ]) verifica(re.test(s), `${nume}: fără defer`);
  verifica(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/.test(s), 'Tailwind trebuie să rămână neschimbat');
  verifica(!/^\s*lucide\.createIcons\(\);/m.test(s), 'lucide.createIcons() fără verificare, în timpul parsării');
  const mk = s.slice(s.indexOf('function mkIndicator('), s.indexOf('function mkIndicator(') + 900);
  verifica(/window\.t\(null, 'Sincronizare catalog\.\.\.'\)/.test(mk), 'indicatorul nu trece prin window.t');
  const en = JSON.parse(citeste('i18n/en/mydarrin-catalog.json'))._texte || JSON.parse(citeste('i18n/en/mydarrin-catalog.json'));
  verifica(en['Sincronizare catalog...'] === 'Syncing catalog...', 'cheia EN a indicatorului');
  // Pornirea nu mai stă după DOMContentLoaded.
  verifica(!/document\.addEventListener\('DOMContentLoaded', \(\) => \{\s*mkIndicator\(\);/.test(s), 'loadCatalog pornește tot din DOMContentLoaded');
  verifica(s.indexOf('id="grid-servicii"') < s.indexOf('// ── Pornirea catalogului'), 'pornirea e înaintea grilei în pagină');
}

async function testeBrowser(baza, browser) {
  console.log('A. Primul lot înainte de DOMContentLoaded');
  for (const [w, h] of [[390, 844], [1366, 900]]) {
    reset();
    const { ctx, p, erori, cereri } = await deschide(browser, baza, { w, h });
    const t = await p.evaluate(() => ({ card: window.__t.card, dcl: window.__t.dcl, laDcl: window.__t.laDcl.length, grile: window.__t.laDclGrile, intarziat: window.__intarziatRulat, reveal: window.__t.revealDevreme, cls: window.__t.cls }));
    verifica(t.intarziat === true && t.dcl >= INTARZIERE, `${w}: scriptul întârziat ținea DOMContentLoaded (${Math.round(t.dcl)} ms)`);
    verifica(t.card != null && t.card < t.dcl - 500, `${w}: primul card la ${Math.round(t.card)} ms, DOMContentLoaded la ${Math.round(t.dcl)} ms`);
    verifica(t.laDcl === 12 && JSON.stringify(t.grile) === '[12,0,0]', `${w}: la DOMContentLoaded doar primul lot: ${t.laDcl} ${JSON.stringify(t.grile)}`);
    verifica(t.reveal, `${w}: observatorul de reveal exista înainte de DOMContentLoaded`);

    console.log(`B. Fără dubluri, fără înlocuiri, CLS (${w} px)`);
    const r = await p.evaluate(() => {
      const carduri = [...document.querySelectorAll('.db-card')];
      const chei = carduri.map((c) => c.closest('[id^="grid-"]').id + '/' + c.dataset.slug);
      const setari = [...window.__t.src.values()];
      return { total: carduri.length, unice: new Set(chei).size, primeleInPagina: window.__t.laDcl.every((c) => c.isConnected), maxSetari: Math.max(0, ...setari), cls: window.__t.cls, deplasari: window.__t.deplasari };
    });
    verifica(r.total === 64 && r.unice === 64, `${w}: carduri ${r.total}, unice ${r.unice}`);
    verifica(r.primeleInPagina, `${w}: cardurile desenate devreme au fost înlocuite`);
    verifica(r.maxSetari <= 1, `${w}: o imagine și-a schimbat src de ${r.maxSetari} ori`);
    verifica(r.cls <= 0.05, `${w}: CLS ${r.cls.toFixed(3)} card=${Math.round(t.card)} dcl=${Math.round(t.dcl)} ${JSON.stringify(r.deplasari)}`);
    verifica(cereri.filter((u) => u.startsWith('/api/public/catalog?')).length === 1, `${w}: o singură cerere de catalog`);
    verifica(!cereri.some((u) => /\/rest\/v1\/catalog_/.test(u)), `${w}: cereri REST vechi`);
    // Primul card devine vizibil (reveal), iar filtrarea merge pe toate cardurile.
    await p.evaluate(() => document.querySelector('#grid-servicii .db-card').scrollIntoView({ block: 'center', behavior: 'instant' }));
    await p.waitForTimeout(200);
    verifica(await p.evaluate(() => document.querySelector('#grid-servicii .db-card').classList.contains('visible')), `${w}: primul card nu devine vizibil`);

    console.log(`D. Scripturile pe defer (${w} px)`);
    const d = await p.evaluate(() => ({
      lucideGol: document.querySelectorAll('#catalog-hero i[data-lucide]').length,
      lucideSvg: document.querySelectorAll('#catalog-hero svg.lucide').length,
      tva: window.MDTva ? true : false,
      tvaPct: [...document.querySelectorAll('.tva-pct')].map((e) => e.textContent.trim()),
      auth: !!(window.MyDarrinAuth && window.MyDarrinAuth.performLogin),
      purify: typeof window.DOMPurify !== 'undefined' && typeof safeHTML === 'function' && safeHTML('<b>x</b><img src=x onerror=alert(1)>') === '<b>x</b><img src="x">',
    }));
    verifica(d.lucideGol === 0 && d.lucideSvg > 0, `${w}: iconițele din hero: ${JSON.stringify(d)}`);
    verifica(d.tva && d.tvaPct.every((x) => /^\d+(\.\d+)?\s*%?$/.test(x) || x === ''), `${w}: TVA: ${JSON.stringify(d.tvaPct)}`);
    verifica(d.auth, `${w}: MyDarrinAuth din account-system.js`);
    verifica(d.purify, `${w}: DOMPurify / safeHTML`);
    verifica(!erori.length, `${w}: erori JS: ${erori.join(' | ')}`);
    await ctx.close();
  }

  console.log('C. Fila și filtrul din adresă');
  for (const [adresa, fila, numar] of [['?categorie=materiale', 'materiale', 20], ['?categorie=inchirieri', 'inchiriere', 14], ['?q=v1', 'servicii', null], ['?tab=consultanta', null, null]]) {
    reset();
    const { ctx, p, erori } = await deschide(browser, baza, { w: 390, h: 844, adresa });
    const r = await p.evaluate(() => ({ laDcl: window.__t.laDcl.length, activ: (document.querySelector('.tab-content.active') || {}).id, vizibile: [...document.querySelectorAll('.tab-content.active .db-card')].filter((c) => c.offsetParent).length, maxSetari: Math.max(0, ...window.__t.src.values()) }));
    verifica(r.laDcl === 0, `${adresa}: nimic desenat înainte de DOMContentLoaded (${r.laDcl})`);
    if (fila) verifica(r.activ === 'tab-' + fila, `${adresa}: fila activă ${r.activ}`);
    if (numar) verifica(r.vizibile === numar, `${adresa}: ${r.vizibile} carduri vizibile`);
    if (adresa === '?q=v1') {
      const v = await p.$$eval('.tab-content.active .db-card', (c) => c.filter((x) => x.offsetParent).map((x) => x.dataset.title || ''));
      verifica(v.length > 0 && v.length < 30, `?q=v1: căutarea din adresă (${v.length})`);
    }
    // Căutarea din adresă ascunde carduri după desenare, deci vecinii se schimbă (11-C7) și
    // unele carduri primesc altă imagine — la fel ca în main; restul: o singură setare.
    verifica(r.maxSetari <= (adresa.startsWith('?q=') ? 2 : 1), `${adresa}: src schimbat de ${r.maxSetari} ori`);
    verifica(!erori.length, `${adresa}: erori JS: ${erori.join(' | ')}`);
    await ctx.close();
  }

  console.log('E. Indicatorul în engleză');
  {
    reset();
    const { ctx, p, erori } = await deschide(browser, baza, { w: 1366, h: 900, lang: 'en' });
    await p.evaluate(() => { document.getElementById('db-load-ind').style.display = 'flex'; });
    await p.waitForTimeout(200);
    const text = (await p.textContent('#db-load-ind')).trim();
    verifica(text === 'Syncing catalog...', `indicatorul EN: „${text}”`);
    verifica(!erori.length, `EN: erori JS: ${erori.join(' | ')}`);
    await ctx.close();
  }
}

(async () => {
  fisiere();
  const srv = await porneste(0);
  const browser = await chromium.launch();
  try { await testeBrowser('http://localhost:' + srv.address().port, browser); }
  finally { await browser.close(); srv.close(); }
  console.log(`\n${ok} verificări trecute, ${esec} eșuate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
