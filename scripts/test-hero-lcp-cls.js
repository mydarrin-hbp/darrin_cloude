// scripts/test-hero-lcp-cls.js
// Pasul 11-C12 (12 nov. 2026): titlul din hero fără întârziere și pagina de produs fără
// salturi pe telefon.
//   A. fișierele: data-erou pe hero, pornirea de la opacitatea 0,01, scriptul mic imediat
//      după hero (catalog și pagina principală); rezervarea locului nivelurilor pe pagina de
//      produs și scoaterea ei după loadFromURL();
//   B. hero (catalog și pagina principală, modul EN, 390 și 1366 px), cu DOMContentLoaded
//      întârziat (un script sincron de 2 s la sfârșitul paginii):
//      - elementele .reveal din hero aflate în primul ecran au clasa visible înainte de
//        DOMContentLoaded;
//      - elementele .reveal de sub primul ecran nu o au până la derulare, apoi o primesc;
//      - animația rămâne: cât pagina e ascunsă (myd-i18n-pending) titlul stă la starea de
//        start (0,01), apoi trece prin valori intermediare până la 1, fără transform la final;
//      - la 1366 px, titlul intră în LCP la cel mult 250 ms după ce pagina devine vizibilă
//        (pe main: după toată animația, ~0,6–0,7 s);
//   C. pagina de produs pe datele de test (date-test-produs.js: 4 niveluri, prețurile după
//      1,5 s): CLS ≤ 0,1 la 390 și 1366 px; la final, 4 carduri / tabelul cu descrieri, fără
//      rezervare rămasă; un produs care nu e în catalog ascunde secțiunea și scoate rezervarea.
//
// Rulare: node scripts/test-hero-lcp-cls.js
//   PAGINI_REF=main — servește HTML-ul paginilor din alt commit (testul trebuie să cadă pe main).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright');
const { porneste } = require('./server-test');
const date = require('./date-test-produs');

const RADACINA = path.join(__dirname, '..');
const citeste = (f) => fs.readFileSync(path.join(RADACINA, f), 'utf8');
let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const REF = process.env.PAGINI_REF || null;
const sursa = (f) => (REF ? execSync(`git show ${REF}:${f}`, { cwd: RADACINA, encoding: 'utf8', maxBuffer: 64 << 20 }) : citeste(f));
const ADRESE = { index: '/', 'mydarrin-catalog': '/mydarrin-catalog', produs: '/mydarrin-produs?slug=acoperis-sarpanta&type=servicii', necunoscut: '/mydarrin-produs?slug=produs-inexistent-test&type=servicii' };
const FISIER = { index: 'index.html', 'mydarrin-catalog': 'mydarrin-catalog.html', produs: 'mydarrin-produs.html', necunoscut: 'mydarrin-produs.html' };
const asteapta = (ms) => new Promise((a) => setTimeout(a, ms));

function fisiere() {
  console.log('A. Fișierele');
  for (const f of ['mydarrin-catalog.html', 'index.html']) {
    const s = citeste(f);
    verifica(/<section[^>]*\sdata-erou[\s>]/.test(s), `${f}: hero-ul are data-erou`);
    verifica(/\[data-erou\] \.reveal:not\(\.visible\)\{opacity:\.01\}/.test(s), `${f}: hero-ul pornește de la opacitatea 0,01`);
    verifica(/html\.myd-i18n-pending \[data-erou\] \.reveal\.visible\{opacity:\.01;transform:translateY\(\d+px\)\}/.test(s), `${f}: starea de start se păstrează cât pagina e ascunsă`);
    const i = s.indexOf('data-erou'), j = s.indexOf('</section>', i);
    verifica(/^\s*<script>\s*\/\/ Pasul 11-C12/.test(s.slice(j + 10, j + 200)), `${f}: scriptul mic e imediat după hero`);
    verifica(/IntersectionObserver[\s\S]{0,200}querySelectorAll\('\.reveal'\)/.test(s), `${f}: IntersectionObserver-ul rămâne pentru restul elementelor .reveal`);
  }
  const p = citeste('mydarrin-produs.html');
  verifica(/id="tier-section" class="niveluri-se-incarca"/.test(p), 'produs: secțiunea de niveluri pornește cu rezervarea');
  verifica(/#tier-section\.niveluri-se-incarca #tier-cards\{min-height:270px\}/.test(p), 'produs: locul cardurilor rezervat pe telefon');
  verifica(/<tr class="tier-rezerva" aria-hidden="true">/.test(p), 'produs: rândul rezervat din tabel');
  verifica(/finally \{\s*document\.getElementById\('tier-section'\)\?\.classList\.remove\('niveluri-se-incarca'\);/.test(p), 'produs: rezervarea se scoate după loadFromURL(), oricum s-ar termina');
}

// ── În pagină, de la primul octet ─────────────────────────────────────────
function urmareste() {
  try { if (!sessionStorage.getItem('__init')) { localStorage.clear(); sessionStorage.setItem('__init', '1'); } } catch (e) {}
  const T = window.__h = { reveal: null, dcl: null, laDcl: null, mostre: [], lcp: [], cls: 0, deplasari: [], h1Visible: null };
  const root = () => document.documentElement;
  new MutationObserver(() => {
    const r = root();
    if (r && T.reveal == null && T.ascuns && !r.classList.contains('myd-i18n-pending')) T.reveal = performance.now();
    if (r && r.classList.contains('myd-i18n-pending')) T.ascuns = true;
    if (T.h1Visible == null && document.querySelector('[data-erou] h1.visible')) T.h1Visible = performance.now();
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  // Primul ascultător DOMContentLoaded (scriptul de inițializare rulează înaintea paginii).
  document.addEventListener('DOMContentLoaded', () => {
    T.dcl = performance.now();
    const h = innerHeight;
    const erou = document.querySelector('[data-erou]') || document.querySelector('section');
    const sus = [], jos = [];
    document.querySelectorAll('.reveal').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.height) return;
      const info = { cls: el.className.slice(0, 40), visible: el.classList.contains('visible'), inErou: !!(erou && erou.contains(el)) };
      if (r.top < h && r.bottom > 0) sus.push(info);
      else if (r.top > h + 200) jos.push(info);
    });
    T.laDcl = { sus, jos };
  });
  // Opacitatea titlului pe fiecare cadru (animația rămâne).
  const cadru = () => {
    const h1 = document.querySelector('[data-erou] h1') || document.querySelector('h1.reveal');
    if (h1) {
      const cs = getComputedStyle(h1);
      const r = root();
      T.mostre.push([Math.round(performance.now()), +cs.opacity, r && r.classList.contains('myd-i18n-pending') ? 1 : 0, cs.transform]);
    }
    if (performance.now() < 6000) requestAnimationFrame(cadru);
  };
  requestAnimationFrame(cadru);
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) T.lcp.push({ t: e.startTime, tag: e.element ? e.element.tagName : '?' }); }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { T.cls += e.value; T.deplasari.push(Math.round(e.startTime) + ' ' + e.value.toFixed(4) + ' ' + (e.sources || []).map((x) => (x.node && x.node.id) || (x.node && x.node.className) || '?').join(',')); } }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
}

async function deschide(browser, baza, pagina, o) {
  const ctx = await browser.newContext({ viewport: { width: o.w, height: o.w < 800 ? 844 : 900 }, locale: 'en-GB' });
  await ctx.addInitScript(urmareste);
  await ctx.route(/googletagmanager|google-analytics/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await date.instaleazaRute(ctx, { intarziere: () => 20, asteapta, pretMs: 1500 });
  if (o.dclIntarziat) await ctx.route(/\/intarziat-test\.js$/, async (r) => { await asteapta(2000); r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.__intarziat = 1;' }); });
  if (o.dictionareMs) await ctx.route(/\/i18n\/.+\.json(\?|$)/, async (r) => { await asteapta(o.dictionareMs); r.continue().catch(() => {}); });
  await ctx.route((u) => u.origin === baza && (u.pathname === '/' || u.pathname === '/mydarrin-catalog' || u.pathname === '/mydarrin-produs'), (r) => {
    if (r.request().resourceType() !== 'document') return r.continue();
    let html = sursa(FISIER[pagina]);
    if (o.dclIntarziat) html = html.replace(/<\/body>(?![\s\S]*<\/body>)/, '<script src="/intarziat-test.js"></script>\n</body>');
    r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
  const p = await ctx.newPage();
  const erori = [];
  p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
  await p.goto(baza + ADRESE[pagina], { waitUntil: 'commit', timeout: 60000 });
  return { ctx, p, erori };
}

async function hero(browser, baza) {
  console.log('B. Hero: visible înainte de DOMContentLoaded, restul la derulare, animația păstrată');
  for (const pagina of ['mydarrin-catalog', 'index']) {
    for (const w of [390, 1366]) {
      const et = `${pagina} ${w}px`;
      // DOMContentLoaded întârziat 2 s; dicționarele întârziate 400 ms (pagina stă ascunsă puțin).
      const { ctx, p, erori } = await deschide(browser, baza, pagina, { w, dclIntarziat: true, dictionareMs: 400 });
      await p.waitForFunction(() => window.__h && window.__h.dcl != null && performance.now() > window.__h.dcl + 1500, null, { timeout: 30000 });
      const T = await p.evaluate(() => window.__h);
      const sus = T.laDcl.sus.filter((x) => x.inErou);
      verifica(sus.length > 0, `${et}: există elemente .reveal din hero în primul ecran`);
      verifica(sus.length && sus.every((x) => x.visible), `${et}: hero-ul din primul ecran are visible înainte de DOMContentLoaded: ${JSON.stringify(sus.filter((x) => !x.visible).map((x) => x.cls))}`);
      verifica(T.h1Visible != null && T.h1Visible < T.dcl - 500, `${et}: h1 primește visible cu mult înainte de DOMContentLoaded (h1 ${Math.round(T.h1Visible)} ms, DCL ${Math.round(T.dcl)} ms)`);
      verifica(T.laDcl.jos.length > 0 && T.laDcl.jos.every((x) => !x.visible), `${et}: elementele de sub primul ecran nu au visible la DOMContentLoaded`);
      // nici după încă 1,5 s fără derulare
      const josFaraDerulare = await p.evaluate(() => [...document.querySelectorAll('.reveal')].filter((el) => { const r = el.getBoundingClientRect(); return r.height && r.top > innerHeight + 200; }).filter((el) => el.classList.contains('visible')).length);
      verifica(josFaraDerulare === 0, `${et}: ${josFaraDerulare} elemente de sub primul ecran au visible fără derulare`);
      // animația: ținută la 0,01 cât e ascunsă, apoi valori intermediare, la final 1 fără transform
      const ascunse = T.mostre.filter((m) => m[2] === 1 && T.h1Visible != null && m[0] > T.h1Visible + 50);
      verifica(ascunse.length === 0 || ascunse.every((m) => Math.abs(m[1] - 0.01) < 0.001), `${et}: cât pagina e ascunsă, titlul rămâne la starea de start (${JSON.stringify(ascunse.slice(0, 3))})`);
      const vizibile = T.mostre.filter((m) => m[2] === 0);
      verifica(vizibile.some((m) => m[1] > 0.05 && m[1] < 0.95), `${et}: titlul trece prin opacități intermediare (animația rulează)`);
      const ultima = T.mostre[T.mostre.length - 1];
      verifica(ultima && ultima[1] === 1 && ultima[3] === 'none', `${et}: la final opacitate 1 și fără transform (${JSON.stringify(ultima)})`);
      if (w === 1366) {
        const start = Math.max(T.reveal || 0, T.h1Visible || 0);
        const h1 = T.lcp.find((e) => e.tag === 'H1');
        verifica(h1 && h1.t <= start + 250, `${et}: titlul intră în LCP la cel mult 250 ms după afișare (LCP h1 ${h1 ? Math.round(h1.t) : '—'} ms, afișare ${Math.round(start)} ms)`);
      }
      // derulare: elementele de jos primesc visible
      const primit = await p.evaluate(async () => {
        const el = [...document.querySelectorAll('.reveal')].find((x) => { const r = x.getBoundingClientRect(); return r.height && r.top > innerHeight + 200 && !x.classList.contains('visible'); });
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        await new Promise((a) => setTimeout(a, 600));
        return el.classList.contains('visible');
      });
      verifica(primit === true, `${et}: un element de sub primul ecran primește visible după derulare (${primit})`);
      verifica(!erori.length, `${et}: erori JS: ${erori.join(' | ')}`);
      await ctx.close();
    }
  }
}

async function produs(browser, baza) {
  console.log('C. Pagina de produs: CLS ≤ 0,1 pe datele de test');
  for (const w of [390, 1366]) {
    const et = `produs ${w}px`;
    const { ctx, p, erori } = await deschide(browser, baza, 'produs', { w });
    await p.waitForFunction(() => document.querySelectorAll('#tier-cards .tier-card').length > 0, null, { timeout: 30000 });
    await p.waitForTimeout(2500);
    const T = await p.evaluate(() => window.__h);
    verifica(T.reveal != null, `${et}: pagina devine vizibilă`);
    verifica(T.cls <= 0.1, `${et}: CLS ${T.cls.toFixed(4)} > 0,1 — ${T.deplasari.join(' | ')}`);
    const fin = await p.evaluate(() => ({
      carduri: document.querySelectorAll('#tier-cards .tier-card').length,
      randuri: document.querySelectorAll('#tier-tbody tr').length,
      rezerva: document.querySelectorAll('.tier-rezerva').length,
      clasa: document.getElementById('tier-section').className,
      minH: getComputedStyle(document.getElementById('tier-cards')).minHeight,
      desc: (document.querySelector('#tier-tbody td:nth-child(2)') || {}).textContent || '',
    }));
    verifica(fin.carduri === 4, `${et}: 4 carduri de nivel (${fin.carduri})`);
    verifica(fin.randuri === 1 && fin.rezerva === 0 && /Specialised roofing/.test(fin.desc), `${et}: tabelul are rândul de descrieri, fără rândul rezervat (${JSON.stringify(fin)})`);
    verifica(!/niveluri-se-incarca/.test(fin.clasa) && fin.minH === '0px', `${et}: rezervarea s-a scos (${fin.clasa}, min-height ${fin.minH})`);
    verifica(!erori.length, `${et}: erori JS: ${erori.join(' | ')}`);
    await ctx.close();
  }
  {
    const { ctx, p, erori } = await deschide(browser, baza, 'necunoscut', { w: 390 });
    await p.waitForFunction(() => { const t = document.getElementById('tier-section'); return document.readyState !== 'loading' && t && !t.classList.contains('niveluri-se-incarca'); }, null, { timeout: 30000 }).catch(() => {});
    const fin = await p.evaluate(() => ({ clasa: document.getElementById('tier-section').className, display: getComputedStyle(document.getElementById('tier-section')).display, rezerva: document.querySelectorAll('.tier-rezerva').length }));
    verifica(!/niveluri-se-incarca/.test(fin.clasa) && fin.display === 'none' && fin.rezerva === 0, `produs necunoscut: secțiunea ascunsă, fără rezervare (${JSON.stringify(fin)})`);
    verifica(!erori.length, `produs necunoscut: erori JS: ${erori.join(' | ')}`);
    await ctx.close();
  }
}

(async () => {
  if (!REF) fisiere();
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try { await hero(browser, baza); await produs(browser, baza); }
  finally { await browser.close(); srv.close(); }
  console.log(`\n${ok} verificări trecute, ${esec} eșuate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
