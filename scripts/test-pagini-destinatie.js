// scripts/test-pagini-destinatie.js — paginile de destinație (pasul 12-L1, 19 nov. 2026; macheta L1)
//
// Chromium (Playwright), serverul local (scripts/server-test.js) și
// /api/public/landing REAL (api/public/landing.js) peste Supabase-ul simulat,
// cu o variantă publicată („instalatori”) și una doar în ciornă („iarna”).
// Nimic nu ajunge la producție.
//   G. paginile generate sunt la zi (genereaza-pagini-destinatie.js --verifica) și
//      CSS-ul Tailwind precompilat corespunde claselor paginilor (amprenta);
//   A. primul ecran: la 360 × 640 și 390 × 844, RO și EN, pe toate cele 7 pagini —
//      eticheta, titlul, cele 3 beneficii, butonul și textul de sub el se văd fără
//      derulare; un singur buton portocaliu în primul ecran; fără derulare
//      laterală, fără erori JS; în EN, nicio română în primul ecran;
//   B. destinația butonului e corectă LA DOMContentLoaded, înaintea oricărui cod de
//      sesiune, și păstrează profesie, lang și UTM-urile (nu și fbclid); după
//      sesiune: vizitatorul păstrează linkul, contul de partener → „Mergi în
//      panoul tău” și dashboard-ul;
//   C. variantele: utm_campaign publicat → textele variantei (RO / EN), aplicate
//      în cel mult 300 ms; nepublicat → implicita; fără parametru → implicita;
//      partner_landing_view primește varianta;
//   V. viteza: Android simulat, „Slow 4G” (RTT 150 ms, 1,6 Mbit/s), procesor × 4 —
//      LCP < 2,5 s și CLS < 0,1 pe toate cele 7 pagini (mediana din 3);
//   F. butoanele plutitoare (distribuire, Darrin AI) nu acoperă butonul principal,
//      la 360–1920 px, sus și cu butonul la marginea de jos a ecranului;
//   R. runda de investiții: fără rundă activă secțiunea lipsește (și linkul din
//      meniu); cu rundă, doar valorile din date.
//
// Rulare:
//   node scripts/test-pagini-destinatie.js                 testul (DOAR=G|A|B|C|V|F|R)
//   node scripts/test-pagini-destinatie.js --masoara [--pagini /a,/b] [--json f]   doar viteza (tabel)
//   node scripts/test-pagini-destinatie.js --capturi <dosar> [--eticheta dupa]      capturile 390 / 1366, RO / EN

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns } = sim;
const { chromium } = require('playwright');
const { porneste } = require('./server-test');
const RM = require('./retea-modelata');
const L = require('../lib/landing-pagini');
const apiLanding = require('../api/public/landing.js');
const { eRo } = require('./recunoaste-ro');

const RADACINA = path.join(__dirname, '..');
const arg = process.argv.slice(2);
const opt = (n, d) => { const i = arg.indexOf('--' + n); return i === -1 ? d : arg[i + 1]; };
const DOAR = process.env.DOAR || '';
const ruleaza = (s) => !DOAR || DOAR.includes(s);

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

const PAGINI = L.PAGINI.map((p) => p.cale);
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const ZGOMOT = /Failed to load resource|net::ERR_|Failed to fetch|status of 50[0-9]|status of 40[0-9]/i;

// ── Conținutul simulat: „instalatori” publicată, „iarna” doar ciornă ─────────
const VAR = {
  ro: { eticheta: 'Parteneri de servicii · Instalatori', titlu: 'Instalator? Primește comenzi în zona ta.', subtitlu: 'Clienții comandă și plătesc în platformă. Tu vezi suma ta înainte să accepți.',
    beneficiu_1: 'Comenzi alocate automat în orașul tău', beneficiu_2: 'Plata e păstrată ca garanție până termini lucrarea', beneficiu_3: '100% din manoperă rămâne la tine', buton: 'Devino partener', sub_buton: 'Gratuit · contul în 60 de secunde', imagine_alt: null },
  en: { eticheta: 'Service partners · Plumbers', titlu: 'Plumber? Get jobs in your area.', subtitlu: 'Clients order and pay on the platform. You see your amount before you accept.',
    beneficiu_1: 'Jobs assigned automatically in your city', beneficiu_2: 'Payment held as a guarantee until the job is done', beneficiu_3: '100% of the labour stays with you', buton: 'Become a partner', sub_buton: 'Free · account in 60 seconds', imagine_alt: null },
};
function bazaDate() {
  const r = [];
  ['ro', 'en'].forEach((l) => {
    r.push(Object.assign({ id: 'p-' + l, pagina: '/parteneri/servicii', varianta: 'instalatori', limba: l, stare: 'publicat', versiune: 1, imagine_variante: [] }, VAR[l]));
    r.push(Object.assign({ id: 'c-' + l, pagina: '/parteneri/servicii', varianta: 'iarna', limba: l, stare: 'ciorna', versiune: 0, imagine_variante: [] }, VAR[l], { titlu: 'Iarna aceasta: comenzi de instalații' }));
  });
  DB.tabele = { landing_continut: r, landing_continut_istoric: [] };
  apiLanding._golesteCache();
}

let RUNDA = null; // răspunsul simulat al /api/public/runda-curenta
const RUNDA_ACTIVA = { cod: 'seed', denumire_ro: 'Runda Seed', denumire_en: 'Seed round', descriere_ro: null, descriere_en: null, stare: 'deschisa', data_start: '2026-11-01', data_sfarsit: '2027-03-31',
  moneda: 'EUR', suma_tinta: 200000, investitie_minima: 1000, pret_actiune: 100, equity_oferit_pct: 10, post_money: 2000000, tickete: null, instrumente: [] };

async function apiSimulat(u, req) {
  if (u.pathname === '/api/public/landing') {
    const res = raspuns();
    await apiLanding(cerere({ metoda: req.method(), query: Object.fromEntries(u.searchParams) }), res);
    return { status: res.statusCode, body: res.corp };
  }
  if (u.pathname === '/api/public/runda-curenta') return { status: 200, body: { ok: true, runda: RUNDA } };
  if (/^\/api\/public\/(traduceri-catalog)/.test(u.pathname)) return { status: 200, body: { _texte: {} } };
  return undefined;
}

async function context(browser, o) {
  const mobil = o.latime < 800;
  const ctx = await browser.newContext({
    viewport: { width: o.latime, height: o.inaltime }, isMobile: mobil, hasTouch: mobil, deviceScaleFactor: mobil ? 2 : 1,
    userAgent: mobil ? UA_ANDROID : undefined,
  });
  await ctx.addInitScript(([lang, analitice]) => {
    try {
      if (!sessionStorage.getItem('__lp_limba')) { localStorage.setItem('myd_lang_v1', lang); sessionStorage.setItem('__lp_limba', '1'); }
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: !!analitice, marketing: false, data: new Date().toISOString(), versiune: 2 }));
    } catch (e) {}
  }, [o.lang || 'en', !!o.analitice]);
  await ctx.addInitScript(RM.scriptMasurare);
  if (o.initiere) await ctx.addInitScript(o.initiere, o.initiereArg);
  await RM.instaleaza(ctx, { retea: o.retea || 'normala', api: o.api || apiSimulat });
  const page = await ctx.newPage();
  page.erori = [];
  page.on('pageerror', (e) => page.erori.push(e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !ZGOMOT.test(m.text())) page.erori.push('console: ' + m.text().slice(0, 160)); });
  return { ctx, page };
}

// ── G. Paginile generate, la zi ──────────────────────────────────────────
function testG() {
  console.log('G. Paginile generate și CSS-ul precompilat');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'genereaza-pagini-destinatie.js'), '--verifica'], { encoding: 'utf8' });
  verifica(r.status === 0, 'genereaza-pagini-destinatie.js --verifica: ' + (r.stdout + r.stderr).trim().split('\n').slice(-2).join(' | '));
  const TW = require('./genereaza-tailwind-destinatie');
  const css = fs.readFileSync(TW.IESIRE, 'utf8');
  const amp = TW.amprenta(TW.clase());
  verifica(css.includes('amprenta: ' + amp), `landing-tailwind.css corespunde claselor paginilor (amprenta ${amp}); altfel: node scripts/genereaza-tailwind-destinatie.js`);
  L.PAGINI.forEach((p) => {
    const html = fs.readFileSync(path.join(RADACINA, p.fisier + '.html'), 'utf8');
    verifica(!/cdn\.tailwindcss\.com/.test(html), `${p.cale}: fără Tailwind de pe CDN`);
    verifica(/<link rel="stylesheet" href="\/landing-tailwind\.css">/.test(html), `${p.cale}: landing-tailwind.css`);
    verifica(!/fonts\.googleapis\.com\/css2\?family=Syne/.test(html), `${p.cale}: fără fonturile Google nefolosite`);
    verifica(/lucide\.min\.js" defer><\/script>/.test(html), `${p.cale}: Lucide cu defer`);
    verifica((html.match(/data-cta="principal"/g) || []).length === 1, `${p.cale}: un singur buton principal (data-cta="principal")`);
    const dest = (/<a class="lp-buton" id="lp-cta" href="([^"]+)"/.exec(html) || [])[1];
    verifica(dest === L.destinatie(p), `${p.cale}: destinația scrisă în HTML: ${dest}`);
    if (p.tip === 'hub') verifica((html.match(/data-cta="categorie-/g) || []).length === 5, '/parteneri: 5 carduri de categorie cu data-cta');
    if (p.tip === 'investitori') {
      const runda = (/<section class="lp-sec lp-runda" id="runda"[\s\S]*?<\/section>/.exec(html) || [''])[0];
      verifica(runda && / hidden>/.test(runda) && !/\d/.test(runda.replace(/<[^>]*>/g, '')), '/investitori: secțiunea rundei pornește ascunsă și nu are nicio cifră scrisă în cod (valorile vin doar din /api/public/runda-curenta)');
    }
  });
}

// ── A. Primul ecran ─────────────────────────────────────────────────────
async function primulEcran(page) {
  return page.evaluate(() => {
    const H = innerHeight, W = document.documentElement.clientWidth;
    const vizibil = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect(), st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= H + 0.5 && r.left >= 0 && r.right <= W + 0.5 && st.visibility !== 'hidden' && Number(st.opacity) > 0.5;
    };
    const ben = Array.from(document.querySelectorAll('.lp-beneficii li'));
    const cta = document.getElementById('lp-cta');
    // Butoanele portocalii din primul ecran (fundal #FF8C00), vizibile.
    const portocalii = Array.from(document.querySelectorAll('a, button')).filter((el) => {
      const st = getComputedStyle(el), r = el.getBoundingClientRect();
      return st.backgroundColor === 'rgb(255, 140, 0)' && r.width > 40 && r.height > 30 && r.top < H && r.bottom > 0 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.5;
    });
    const erou = document.querySelector('.lp-erou');
    return {
      eticheta: vizibil(document.querySelector('.lp-eticheta')), titlu: vizibil(document.getElementById('lp-titlu')),
      beneficii: ben.length === 3 && ben.every(vizibil), buton: vizibil(cta), sub: vizibil(document.querySelector('.lp-sub-buton')),
      jos: Math.round(Math.max(cta ? cta.getBoundingClientRect().bottom : 0, document.querySelector('.lp-sub-buton').getBoundingClientRect().bottom)), H,
      portocalii: portocalii.map((x) => (x.id || x.className || x.tagName) + ':' + x.textContent.trim().slice(0, 30)),
      lateral: document.documentElement.scrollWidth - W,
      text: erou ? erou.innerText : '',
    };
  });
}
async function testA(browser, baza) {
  console.log('A. Primul ecran (360 × 640, 390 × 844; RO, EN; 7 pagini)');
  for (const cale of PAGINI) for (const lang of ['ro', 'en']) for (const [w, h] of [[360, 640], [390, 844]]) {
    const { ctx, page } = await context(browser, { latime: w, inaltime: h, lang });
    await page.goto(baza + cale, { waitUntil: 'load', timeout: 60000 });
    await RM.asteapta(500);
    const r = await primulEcran(page);
    const id = `${cale} ${lang} ${w}×${h}`;
    verifica(r.eticheta && r.titlu && r.beneficii && r.buton && r.sub, `${id}: eticheta ${r.eticheta}, titlul ${r.titlu}, beneficiile ${r.beneficii}, butonul ${r.buton}, textul de sub buton ${r.sub} (jos la ${r.jos} / ${r.H} px)`);
    verifica(r.portocalii.length === 1, `${id}: un singur buton portocaliu în primul ecran (${r.portocalii.join(' | ')})`);
    verifica(r.lateral <= 1, `${id}: fără derulare laterală (${r.lateral} px)`);
    verifica(!page.erori.length, `${id}: fără erori JS (${page.erori.join(' | ')})`);
    if (lang === 'en') {
      const ro = r.text.split('\n').map((s) => s.trim()).filter((s) => s && eRo(s));
      verifica(!ro.length, `${id}: nicio română în primul ecran (${ro.join(' | ')})`);
    }
    await ctx.close();
  }
}

// ── B. Destinația butonului la DOMContentLoaded ──────────────────────────
// Momentul „interactive” vine după parsarea HTML-ului și ÎNAINTEA scripturilor defer (cta-partener.js,
// cta-investitor.js, clientul Supabase); DOMContentLoaded vine după ele.
function laDcl() {
  const citeste = () => {
    const a = document.getElementById('lp-cta');
    return {
      href: a && a.getAttribute('href'), stare: a && a.getAttribute('data-cta-stare'),
      supabase: typeof window.supabaseClient !== 'undefined', ctaPartener: typeof window.MYD_CTA_PARTENER !== 'undefined',
      ctaInvestitor: typeof window.MYD_CTA_INVESTITOR !== 'undefined',
    };
  };
  document.addEventListener('readystatechange', () => { if (document.readyState === 'interactive' && !window.__interactiv) window.__interactiv = citeste(); });
  document.addEventListener('DOMContentLoaded', () => { window.__dcl = citeste(); }, { once: true, capture: true });
}
function sesiunePartener(profil) {
  const ses = { access_token: 'tok-test', user: { id: 'u-test', email: 'ana@example.com' } };
  const fals = {
    auth: { getUser: async () => ({ data: { user: ses.user }, error: null }), getSession: async () => ({ data: { session: ses } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }) }) }) }),
  };
  // Clientul apare abia după DOMContentLoaded (ca lib/supabaseClient.js, modul).
  document.addEventListener('DOMContentLoaded', () => { setTimeout(() => { window.supabaseClient = fals; window.dispatchEvent(new Event('myd:supabase-gata')); }, 50); });
  window.__profil = profil;
}
async function testB(browser, baza) {
  console.log('B. Destinația butonului (la DOMContentLoaded, înainte de sesiune)');
  const Q = 'profesie=instalator&lang=ro&utm_source=facebook&utm_medium=paid_social&utm_campaign=instalatori&utm_content=video1&utm_term=t&fbclid=IwAR0abc';
  const TRANSMIS = 'profesie=instalator&lang=ro&utm_source=facebook&utm_medium=paid_social&utm_campaign=instalatori&utm_content=video1&utm_term=t';
  for (const p of L.PAGINI) {
    const { ctx, page } = await context(browser, { latime: 390, inaltime: 844, lang: 'ro', initiere: laDcl });
    await page.goto(baza + p.cale + '?' + Q, { waitUntil: 'load', timeout: 60000 });
    const { d, i } = await page.evaluate(() => ({ d: window.__dcl, i: window.__interactiv }));
    const asteptat = L.destinatie(p) + (L.destinatie(p).includes('?') ? '&' : '?') + TRANSMIS;
    verifica(d && d.href === asteptat, `${p.cale}: la DOMContentLoaded href = ${d && d.href} (așteptat ${asteptat})`);
    verifica(i && i.href === asteptat && !i.supabase && !i.ctaPartener && !i.ctaInvestitor && !i.stare,
      `${p.cale}: destinația e deja corectă înaintea oricărui cod de sesiune (readyState interactive, fără Supabase / cta-*.js): ${JSON.stringify(i)}`);
    await RM.asteapta(1500);
    const dupa = await page.evaluate(() => ({ href: document.getElementById('lp-cta').getAttribute('href'), text: document.getElementById('lp-cta').textContent.trim(), stil: getComputedStyle(document.getElementById('lp-cta')).visibility }));
    verifica(dupa.href === asteptat && dupa.stil === 'visible', `${p.cale}: vizitator, după încărcarea scripturilor: linkul rămâne (${dupa.href}), butonul vizibil`);
    verifica(dupa.text === L.pagina(p.cale).implicit.ro.buton, `${p.cale}: textul butonului rămâne „${dupa.text}”`);
    await ctx.close();
  }
  // Fără JavaScript: linkul din HTML duce la înscriere.
  const ctxFara = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const pf = await ctxFara.newPage();
  await pf.goto(baza + '/parteneri/curieri', { waitUntil: 'load' });
  verifica(await pf.getAttribute('#lp-cta', 'href') === '/parteneri/inscriere?categorie=curier', 'fără JavaScript: /parteneri/curieri → /parteneri/inscriere?categorie=curier');
  await ctxFara.close();
  // Cont de partener activ: după sesiune → „Mergi în panoul tău”, dashboard-ul.
  const profilActiv = { ok: true, email: 'ana@example.com', roles: ['client', 'partener_servicii'], roluri_dashboard: ['partener_servicii'], destinatie: '/cont/partener?type=servicii', partener: { poate_vinde: true },
    activare: { rol: 'partener_servicii', tip: 'servicii', activ: true, complet: true } };
  const { ctx, page } = await context(browser, { latime: 390, inaltime: 844, lang: 'ro', initiere: sesiunePartener, initiereArg: profilActiv, api: async (u, req) => {
    if (u.pathname === '/api/cont/profil') return { status: 200, body: profilActiv };
    return apiSimulat(u, req);
  } });
  await page.goto(baza + '/parteneri/servicii?utm_campaign=x', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('lp-cta').getAttribute('data-cta-stare') === 'activ', null, { timeout: 10000 }).catch(() => {});
  const a = await page.evaluate(() => ({ href: document.getElementById('lp-cta').getAttribute('href'), text: document.getElementById('lp-cta').textContent.trim() }));
  verifica(a.text === 'Mergi în panoul tău' && /^\/(cont\/partener|mydarrin-dashboard-partener)/.test(a.href), `cont de partener: „${a.text}” → ${a.href}`);
  await ctx.close();
}

// ── C. Variantele ───────────────────────────────────────────────────────
function urmaresteVarianta() {
  const m = window.__var = { adaugat: null, scos: null, titlu: null };
  new MutationObserver(() => {
    const h = document.documentElement;
    if (!h) return;
    const are = h.classList.contains('lp-asteapta');
    if (are && m.adaugat == null) m.adaugat = performance.now();
    if (!are && m.adaugat != null && m.scos == null) { m.scos = performance.now(); const t = document.getElementById('lp-titlu'); m.titlu = t && t.textContent; }
  }).observe(document, { attributes: true, subtree: true, childList: true, attributeFilter: ['class'] });
}
async function testC(browser, baza) {
  console.log('C. Variantele');
  const imp = L.pagina('/parteneri/servicii').implicit;
  const cazuri = [
    ['?utm_campaign=instalatori', 'ro', VAR.ro, 'instalatori'], ['?utm_campaign=instalatori', 'en', VAR.en, 'instalatori'],
    ['?utm_campaign=INSTALATORI&utm_source=facebook', 'ro', VAR.ro, 'instalatori'],
    ['?utm_campaign=iarna', 'ro', imp.ro, 'default'], ['?utm_campaign=iarna', 'en', imp.en, 'default'],
    ['', 'ro', imp.ro, 'default'], ['', 'en', imp.en, 'default'],
  ];
  for (const retea of ['normala', 'slow4g']) for (const [q, lang, asteptat, varianta] of cazuri) {
    if (retea === 'slow4g' && lang === 'en' && !q) continue;
    const { ctx, page } = await context(browser, { latime: 390, inaltime: 844, lang, retea, analitice: true, initiere: urmaresteVarianta });
    await page.goto(baza + '/parteneri/servicii' + q, { waitUntil: 'load', timeout: 60000 });
    await RM.asteapta(600);
    const r = await page.evaluate(() => ({
      campuri: Object.fromEntries(Array.from(document.querySelectorAll('[data-lp-camp]')).map((e) => [e.getAttribute('data-lp-camp'), e.textContent.trim()])),
      var: window.__var, aplicat: window.__MYD_LP && window.__MYD_LP.aplicat,
      vedere: (window.MYD_MASURARE && window.MYD_MASURARE.jurnal || []).filter((e) => e.nume === 'partner_landing_view').map((e) => e.parametri),
      asteapta: document.documentElement.classList.contains('lp-asteapta'),
    }));
    const id = `${retea} /parteneri/servicii${q || ' (fără parametru)'} ${lang}`;
    const dif = Object.keys(asteptat).filter((k) => asteptat[k] && r.campuri[k] !== asteptat[k]);
    verifica(!dif.length, `${id}: textele ${varianta === 'default' ? 'implicite' : 'variantei'} (diferă: ${dif.map((k) => k + '=' + r.campuri[k]).join(' | ')})`);
    verifica(!r.asteapta, `${id}: textele nu rămân ascunse`);
    if (q) {
      const durata = r.var.scos != null && r.var.adaugat != null ? Math.round(r.var.scos - r.var.adaugat) : null;
      verifica(durata != null && durata <= 320, `${id}: textele primului ecran ascunse cel mult 300 ms (${durata} ms)`);
      if (varianta !== 'default') verifica(r.var.titlu === asteptat.titlu, `${id}: varianta aplicată înainte de afișare (titlul la afișare: ${r.var.titlu})`);
    } else {
      verifica(r.var.adaugat == null, `${id}: fără utm_campaign, nimic ascuns`);
    }
    verifica(r.vedere.length === 1 && r.vedere[0].variant === varianta, `${id}: partner_landing_view cu variant=${varianta} (${JSON.stringify(r.vedere)})`);
    verifica(!page.erori.length, `${id}: fără erori JS (${page.erori.join(' | ')})`);
    await ctx.close();
  }
}

// ── V. Viteza ───────────────────────────────────────────────────────────
async function masoara(browser, baza, cale, lang) {
  const { ctx, page } = await context(browser, { latime: 390, inaltime: 844, lang, retea: 'slow4g' });
  await RM.cpu(page, 4);
  await page.goto(baza + cale, { waitUntil: 'load', timeout: 90000 });
  await RM.asteapta(1500);
  const m = await page.evaluate(() => ({ lcp: Math.round(window.__lp.lcp), lcpEl: window.__lp.lcpEl, cls: Math.round(window.__lp.cls * 1000) / 1000, dcl: Math.round(window.__lp.dcl) }));
  await ctx.close();
  return m;
}
async function mediana(browser, baza, cale, lang) {
  const r = [];
  for (let i = 0; i < 3; i++) r.push(await masoara(browser, baza, cale, lang));
  r.sort((a, b) => a.lcp - b.lcp);
  return Object.assign({}, r[1], { lcpToate: r.map((x) => x.lcp), clsMax: Math.max(...r.map((x) => x.cls)) });
}
async function testV(browser, baza) {
  console.log('V. Viteza (Android, Slow 4G, procesor × 4)');
  await masoara(browser, baza, '/parteneri', 'en'); // încălzirea CDN-urilor externe
  const lista = PAGINI.map((c) => [c, 'en']).concat([['/parteneri', 'ro'], ['/parteneri/servicii?utm_campaign=instalatori', 'ro']]);
  for (const [cale, lang] of lista) {
    const m = await mediana(browser, baza, cale, lang);
    console.log(`  ${cale} ${lang}: LCP ${m.lcp} ms (${m.lcpToate.join(' / ')}, ${m.lcpEl}), CLS ${m.cls} (max ${m.clsMax}), DCL ${m.dcl} ms`);
    verifica(m.lcp < 2500, `${cale} ${lang}: LCP ${m.lcp} ms < 2500`);
    verifica(m.clsMax < 0.1, `${cale} ${lang}: CLS ${m.clsMax} < 0,1`);
    verifica(/lp-|H1|P\./.test(m.lcpEl || ''), `${cale} ${lang}: elementul LCP e în primul ecran (${m.lcpEl})`);
  }
}

// ── F. Butoanele plutitoare ─────────────────────────────────────────────
async function suprapuneri(page) {
  return page.evaluate(() => {
    const cta = document.getElementById('lp-cta').getBoundingClientRect();
    return ['myd-share-fab', 'dai-fab', 'chat-toggle', 'myd-share-panel'].map((id) => document.getElementById(id)).filter(Boolean).filter((el) => {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && !(r.right <= cta.left || cta.right <= r.left || r.bottom <= cta.top || cta.bottom <= r.top);
    }).map((el) => el.id);
  });
}
async function testF(browser, baza) {
  console.log('F. Butoanele plutitoare (360–1920 px)');
  for (const cale of PAGINI) for (const [w, h] of [[360, 640], [390, 844], [430, 932], [768, 1024], [1024, 768], [1366, 900], [1920, 1080]]) {
    const { ctx, page } = await context(browser, { latime: w, inaltime: h, lang: 'en' });
    await page.goto(baza + cale, { waitUntil: 'load', timeout: 60000 });
    await RM.asteapta(1800);
    const sus = await suprapuneri(page);
    await page.evaluate(() => document.getElementById('lp-cta').scrollIntoView({ block: 'end' }));
    await RM.asteapta(300);
    const jos = await suprapuneri(page);
    if (w >= 1024) {
      const exista = await page.evaluate(() => ['myd-share-fab', 'dai-fab', 'chat-toggle'].filter((id) => document.getElementById(id)).length);
      verifica(exista > 0, `${cale} ${w}×${h}: butoanele plutitoare există pe pagină (verificarea nu e goală)`);
    }
    verifica(!sus.length && !jos.length, `${cale} ${w}×${h}: nimic peste butonul principal (sus: ${sus.join(',') || '—'}, la marginea de jos: ${jos.join(',') || '—'})`);
    await ctx.close();
  }
}

// ── R. Runda de investiții ──────────────────────────────────────────────
async function testR(browser, baza) {
  console.log('R. Runda de investiții');
  for (const lang of ['ro', 'en']) {
    RUNDA = null;
    let { ctx, page } = await context(browser, { latime: 390, inaltime: 844, lang });
    await page.goto(baza + '/investitori', { waitUntil: 'load', timeout: 60000 });
    await RM.asteapta(1200);
    let r = await page.evaluate(() => {
      const s = document.getElementById('runda');
      return { ascunsa: !!s && s.hidden && s.getBoundingClientRect().height === 0, link: document.querySelector('[data-lp-runda-link]').hidden, continut: document.querySelector('[data-runda]').textContent.trim(),
        cifre: (document.querySelector('.lp-erou').innerText.match(/\d/g) || []).length };
    });
    verifica(r.ascunsa && r.link && r.continut === '', `${lang}: fără rundă activă — secțiunea lipsește, linkul „Runda” din meniu e ascuns (${JSON.stringify(r)})`);
    verifica(r.cifre === 0, `${lang}: nicio cifră în primul ecran al investitorilor (${r.cifre})`);
    await ctx.close();
    RUNDA = RUNDA_ACTIVA;
    ({ ctx, page } = await context(browser, { latime: 390, inaltime: 844, lang }));
    await page.goto(baza + '/investitori', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById('runda').hidden, null, { timeout: 8000 }).catch(() => {});
    r = await page.evaluate(() => ({ vizibila: !document.getElementById('runda').hidden, link: !document.querySelector('[data-lp-runda-link]').hidden, text: document.getElementById('runda').innerText }));
    verifica(r.vizibila && r.link, `${lang}: cu rundă activă — secțiunea și linkul apar`);
    verifica(/200[.,\s]?000/.test(r.text) && /1[.,\s]?000/.test(r.text) && (lang === 'ro' ? /Runda Seed/ : /Seed round/).test(r.text), `${lang}: valorile din date (ținta, investiția minimă, numele): ${r.text.replace(/\s+/g, ' ').slice(0, 160)}`);
    await ctx.close();
  }
  RUNDA = null;
}

// ── Capturile ───────────────────────────────────────────────────────────
async function capturi(browser, baza, dosar, et) {
  fs.mkdirSync(dosar, { recursive: true });
  const lista = PAGINI.map((c) => [c, c]).concat([['/parteneri/servicii?utm_campaign=instalatori&profesie=instalator', '/parteneri/servicii-instalatori']]);
  for (const [cale, nume] of lista) for (const lang of ['ro', 'en']) for (const [w, h] of [[390, 844], [1366, 900]]) {
    const { ctx, page } = await context(browser, { latime: w, inaltime: h, lang });
    await page.goto(baza + cale, { waitUntil: 'load', timeout: 60000 });
    await page.addStyleTag({ content: "@font-face{font-family:'Helvetica World';src:local('Arial')}" }).catch(() => {});
    await RM.asteapta(1200);
    const fis = `${et}-${nume.replace(/^\//, '').replace(/\//g, '-')}-${lang}-${w}.png`;
    await page.screenshot({ path: path.join(dosar, fis) });
    await ctx.close();
  }
}

(async () => {
  bazaDate();
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    if (arg.includes('--masoara')) {
      const pagini = opt('pagini') ? opt('pagini').split(',') : PAGINI;
      const rez = {};
      await masoara(browser, baza, pagini[0], 'en');
      for (const cale of pagini) for (const lang of ['en', 'ro']) {
        rez[cale + ' ' + lang] = await mediana(browser, baza, cale, lang);
        console.log(cale, lang, JSON.stringify(rez[cale + ' ' + lang]));
      }
      if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify(rez, null, 2));
      return;
    }
    if (opt('capturi')) { await capturi(browser, baza, opt('capturi'), opt('eticheta', 'dupa')); return; }
    if (ruleaza('G')) testG();
    if (ruleaza('A')) await testA(browser, baza);
    if (ruleaza('B')) await testB(browser, baza);
    if (ruleaza('C')) await testC(browser, baza);
    if (ruleaza('F')) await testF(browser, baza);
    if (ruleaza('R')) await testR(browser, baza);
    if (ruleaza('V')) await testV(browser, baza);
  } finally {
    await browser.close();
    srv.close();
  }
  if (arg.includes('--masoara') || opt('capturi')) return;
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
