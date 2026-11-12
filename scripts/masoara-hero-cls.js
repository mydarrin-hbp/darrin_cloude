// scripts/masoara-hero-cls.js
// Pasul 11-C12 (12 nov. 2026): măsurătorile pentru raport — titlul din hero (LCP) și
// salturile din pagina de produs (CLS).
// Pentru fiecare pagină și lățime (390 și 1366 px): mediana a N rulări (implicit 3),
// Fast 4G (CDP, ca în DevTools: 9 Mbit/s, 1,5 Mbit/s, 165 ms), fără cache (context nou
// la fiecare rulare, cache dezactivat), modul EN (prima vizită):
//   - vizibilă: momentul în care dispare clasa myd-i18n-pending;
//   - LCP și elementul LCP (ultima intrare largest-contentful-paint până la 6 s, --pana);
//   - CLS până la 6 s (--pana) și sursele fiecărei deplasări (--detalii);
//   - cadre cu română vizibilă până la 3 s (o trecere separată, cu eșantionarea din
//     test-i18n-fara-romana.js);
//   - de câte ori se cere /i18n/en.json și avertismentul „preloaded but not used”.
//
// Moduri:
//   --productie [adresa]  — site-ul public (implicit https://mydarrin.homebestpal.com),
//                           fără date simulate; analytics blocat (să nu se numere vizitele);
//   (implicit)            — local, serverul de test cu date simulate, două variante:
//                           „main” (HTML-ul și i18n-loader.js din git show main) și
//                           „ramura” (copia de lucru).
//
// Rulare: node scripts/masoara-hero-cls.js [--productie [adresa]] [--rulari 3] [--detalii]
//         [--pana 6000] [--latimi 390,1366] [--variante main,ramura] [--json fisier] [pagina ...]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright');
const { urmareste, FAST_4G } = require('./test-i18n-fara-romana');

const RADACINA = path.join(__dirname, '..');
const arg = process.argv.slice(2);
const opt = (n, d) => { const i = arg.indexOf('--' + n); if (i === -1) return d; const v = arg[i + 1]; arg.splice(i, 2); return v; };
const flag = (n) => { const i = arg.indexOf('--' + n); if (i === -1) return false; arg.splice(i, 1); return true; };
let PRODUCTIE = null;
{ const i = arg.indexOf('--productie'); if (i !== -1) { const v = arg[i + 1]; if (v && /^https?:/.test(v)) { PRODUCTIE = v.replace(/\/$/, ''); arg.splice(i, 2); } else { PRODUCTIE = 'https://mydarrin.homebestpal.com'; arg.splice(i, 1); } } }
const RULARI = Number(opt('rulari', 3));
const IESIRE = opt('json', null);
const LATIMI = opt('latimi', '390,1366').split(',').map(Number);
const NUME_VARIANTE = opt('variante', 'main,ramura').split(',');
const DETALII = flag('detalii');
const PANA = Number(opt('pana', 6000)); // fereastra pentru LCP și CLS (ms)
const PAGINI = arg.length ? arg : ['mydarrin-catalog', 'index', 'mydarrin-produs', 'cum-devii-partenerul-nostru', 'mydarrin-investitori'];
// Pagina de produs: în producție un serviciu real, cu preț (acoperis-sarpanta); local,
// serviciul simulat din datele de test (vezi date-test-produs.js).
const ADRESE_PROD = { index: '/', 'mydarrin-produs': '/mydarrin-produs?slug=acoperis-sarpanta&type=servicii' };
const ADRESE_LOCAL = { index: '/', 'mydarrin-produs': '/mydarrin-produs?slug=acoperis-sarpanta&type=servicii' };
const asteapta = (ms) => new Promise((a) => setTimeout(a, ms));

// Momentele din pagină (fără eșantionarea pe cadre).
function metrici() {
  const M = window.__m = { lcp: null, lcpEl: null, cls: 0, h1: null, toate: [], deplasari: [] };
  const sel = (el) => {
    if (!el || el.nodeType !== 1) return el && el.nodeType === 3 ? '#text' : '?';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    const p = el.parentElement;
    if (p && !el.id) s = (p.id ? '#' + p.id : p.tagName.toLowerCase() + (typeof p.className === 'string' && p.className.trim() ? '.' + p.className.trim().split(/\s+/)[0] : '')) + '>' + s;
    return s;
  };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { M.toate.push(Math.round(e.startTime) + ' ' + sel(e.element) + ' ' + e.size); M.lcp = e.startTime; M.lcpEl = sel(e.element) + ' «' + ((e.element && e.element.textContent) || e.url || '').replace(/\s+/g, ' ').trim().slice(0, 40) + '»'; } }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { M.cls += e.value; M.deplasari.push(Math.round(e.startTime) + ' ' + e.value.toFixed(4) + ' ' + (e.sources || []).map((x) => sel(x.node) + ' y' + Math.round(x.previousRect.y) + '→' + Math.round(x.currentRect.y) + ' h' + Math.round(x.previousRect.height) + '→' + Math.round(x.currentRect.height)).join(', ')); } }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  new MutationObserver(() => {
    if (M.h1 == null && document.querySelector('h1.visible')) M.h1 = performance.now();
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}

// ── Varianta locală: serverul de test și datele simulate ─────────────────
let local = null;
function pregatesteLocal() {
  const date = require('./date-test-produs');
  const { porneste } = require('./server-test');
  // Fișierele se citesc o singură dată (cache), ca ambele variante să fie servite la fel de repede.
  const cuCache = (citire) => { const c = new Map(); return (f) => { if (!c.has(f)) c.set(f, citire(f)); return c.get(f); }; };
  const VARIANTE = {
    main: { nume: 'main', fisier: cuCache((f) => { try { return execSync(`git show main:${f}`, { cwd: RADACINA, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return null; } }) },
    ramura: { nume: 'ramura', fisier: cuCache((f) => { try { return fs.readFileSync(path.join(RADACINA, f), 'utf8'); } catch (e) { return null; } }) },
  };
  return { date, porneste, VARIANTE };
}

// Întârzierea unui răspuns servit prin route (CDP nu limitează răspunsurile din route):
// un drum dus-întors + transferul la 9 Mbit/s.
const intarziere = (octeti) => FAST_4G.latency + (octeti / FAST_4G.downloadThroughput) * 1000;

async function ruleaza(browser, baza, varianta, pagina, w, esantioneaza) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 800 ? 844 : 900 }, locale: 'en-GB' });
  await ctx.addInitScript(urmareste, { lang: 'en', esantioneaza, pana: 3000 });
  if (!esantioneaza) await ctx.addInitScript(metrici);
  await ctx.route(/googletagmanager|google-analytics|clarity\.ms/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  if (!PRODUCTIE) {
    // HTML-ul paginii și scripturile proprii vin din varianta aleasă (main sau copia de lucru).
    await ctx.route((u) => u.origin === baza && (u.pathname.endsWith('.js') || u.pathname.endsWith('.css') || !/\.[a-z0-9]+$/i.test(u.pathname)) && !u.pathname.startsWith('/api/'), async (r) => {
      const u = new URL(r.request().url());
      let f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
      if (!/\.[a-z0-9]+$/i.test(f)) f += '.html';
      const corp = varianta.fisier(f);
      if (corp == null) return r.continue();
      await asteapta(intarziere(Buffer.byteLength(corp)));
      const tip = f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8';
      r.fulfill({ status: 200, contentType: tip, body: corp, headers: { 'cache-control': 'no-store, must-revalidate' } });
    });
    await local.date.instaleazaRute(ctx, { intarziere, asteapta });
  }
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', FAST_4G);
  let cereriEn = 0;
  const avertismente = [];
  cdp.on('Network.requestWillBeSent', (e) => { if (/\/i18n\/en\.json(\?|$)/.test(e.request.url)) cereriEn++; });
  p.on('console', (m) => { if (m.type() === 'warning' && /preload/i.test(m.text())) avertismente.push(m.text().slice(0, 160)); });
  const adrese = PRODUCTIE ? ADRESE_PROD : ADRESE_LOCAL;
  await p.goto(baza + (adrese[pagina] || '/' + pagina), { waitUntil: 'commit', timeout: 60000 });
  await p.waitForFunction((pana) => performance.now() > pana, esantioneaza ? 3100 : PANA, { timeout: 60000, polling: 100 });
  // avertismentul de preload apare la ~3 s după load; așteptăm puțin mai mult pe trecerea de metrici
  if (!esantioneaza) await p.waitForTimeout(500);
  const t = await p.evaluate(() => window.__t);
  const m = esantioneaza ? null : await p.evaluate(() => window.__m);
  await ctx.close();
  return { t, m, cereriEn, avertismente };
}

const mediana = (v) => { const x = v.filter((n) => n != null).sort((a, b) => a - b); return x.length ? x[Math.floor(x.length / 2)] : null; };
const ms = (v) => (v == null ? '—' : Math.round(v));

(async () => {
  let srv = null, baza = PRODUCTIE;
  let variante = [{ nume: 'productie' }];
  if (!PRODUCTIE) {
    local = pregatesteLocal();
    srv = await local.porneste(0);
    baza = 'http://localhost:' + srv.address().port;
    variante = NUME_VARIANTE.map((n) => local.VARIANTE[n]);
  }
  const browser = await chromium.launch();
  const rezultate = [];
  try {
    for (const pagina of PAGINI) {
      for (const w of LATIMI) {
        for (const v of variante) {
          const r = { pagina, w, varianta: v.nume, rulari: [] };
          for (let i = 0; i < RULARI; i++) {
            const a = await ruleaza(browser, baza, v, pagina, w, false);
            const b = await ruleaza(browser, baza, v, pagina, w, true);
            if (DETALII) console.log(`  [${v.nume} ${w} #${i + 1}] vizibilă=${ms(a.t.reveal)} DCL=${ms(a.t.dcl)} h1.visible=${ms(a.m.h1)}
    LCP: ${a.m.toate.join(' | ')}
    CLS: ${a.m.deplasari.join('\n         ')}${a.avertismente.length ? '\n    consolă: ' + a.avertismente.join(' | ') : ''}`);
            r.rulari.push({ vizibila: a.t.reveal, dcl: a.t.dcl, h1: a.m.h1, lcp: a.m.lcp, lcpEl: a.m.lcpEl, cls: a.m.cls, deplasari: a.m.deplasari, cadreRo: b.t.cadreRo, exemplu: b.t.exemple[0] || null, cereriEn: a.cereriEn, avertismente: a.avertismente });
          }
          const k = (c) => mediana(r.rulari.map((x) => x[c]));
          r.mediana = { vizibila: k('vizibila'), dcl: k('dcl'), h1: k('h1'), lcp: k('lcp'), cls: k('cls'), cadreRo: k('cadreRo') };
          const lcpMed = r.rulari.find((x) => x.lcp === r.mediana.lcp);
          r.mediana.lcpEl = lcpMed ? lcpMed.lcpEl : null;
          rezultate.push(r);
          const prel = r.rulari.some((x) => x.avertismente.length) ? ' AVERTISMENT-preload' : '';
          console.log(`${pagina.padEnd(28)} ${String(w).padEnd(5)} ${v.nume.padEnd(10)} vizibilă=${ms(r.mediana.vizibila)} DCL=${ms(r.mediana.dcl)} h1.visible=${ms(r.mediana.h1)} LCP=${ms(r.mediana.lcp)} ${r.mediana.lcpEl || ''} CLS=${r.mediana.cls == null ? '—' : r.mediana.cls.toFixed(3)} cadreRO=${r.mediana.cadreRo} [${r.rulari.map((x) => x.cadreRo).join(',')}] en.json×${r.rulari.map((x) => x.cereriEn).join(',')}${prel}`);
          if (r.rulari.some((x) => x.exemplu)) console.log('    exemplu RO: ' + r.rulari.map((x) => x.exemplu).filter(Boolean)[0]);
        }
      }
    }
  } finally { await browser.close(); if (srv) srv.close(); }
  if (IESIRE) fs.writeFileSync(IESIRE, JSON.stringify(rezultate, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
