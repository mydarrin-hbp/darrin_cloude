// scripts/test-viteza-investitor.js
// Pasul 11-I3 (16 nov. 2026): viteza paginilor (homepage, catalog, paginile de
// partener, activarea, panoul de partener, „Rolurile mele”, panoul
// investitorului, ruta KYC) — măsurată în Playwright, cu un model de rețea.
//
// Modelul de rețea (fiecare cerere trece prin ctx.route):
//   - întârziere = RTT + octeți comprimați / lățime de bandă; prima cerere spre
//     un domeniu extern mai adaugă 2 RTT (DNS + TLS);
//   - rețea „normală”: RTT 40 ms, 20 Mbit/s; „Slow 4G” (ca Lighthouse): RTT
//     150 ms, 1,6 Mbit/s;
//   - fișierele site-ului vin de la serverul local (scripts/server-test.js);
//     CDN-urile externe (Tailwind, Lucide, esm.sh…) se descarcă o singură dată,
//     real, și se servesc apoi din memorie, cu aceeași întârziere modelată;
//   - API-urile sunt simulate, cu întârzieri realiste de 150–300 ms.
//   Concurența dintre cereri pentru aceeași bandă nu e modelată (estimare
//   optimistă pentru paginile cu multe resurse în paralel).
// Clientul Supabase e cel real (lib/supabaseClient.js), cu o sesiune validă
// în cookie; nicio cerere nu ajunge la Supabase sau la producție.
//
// Rulare:
//   node scripts/test-viteza-investitor.js                 testul (praguri)
//   node scripts/test-viteza-investitor.js --masoara [--retea normala|slow4g] [--json fisier]
//                                                          doar măsurătorile (tabel)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const RADACINA = path.join(__dirname, '..');
const arg = process.argv.slice(2);
const opt = (n, d) => { const i = arg.indexOf('--' + n); return i === -1 ? d : arg[i + 1]; };
const MASOARA = arg.includes('--masoara');
// Diagnostic: --fara <regex> înlocuiește resursele potrivite cu un răspuns gol
// (ex. --fara tailwind), ca să se vadă cât costă fiecare.
const FARA = opt('fara') ? new RegExp(opt('fara')) : null;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));

const RETELE = {
  normala: { rtt: 40, octetiPeMs: 20e6 / 8 / 1000 },
  slow4g: { rtt: 150, octetiPeMs: 1.6e6 / 8 / 1000 },
};

// API-urile simulate: întârzierea serverului (fără RTT).
const INTARZIERI_API = {
  '/api/cont/profil': 300,
  '/api/public/runda-curenta': 200,
  '/api/public/pitch-deck': 200,
  '/api/investitori/kyc': 250,
  '/api/partener/activare-ciorna': 200,
  implicit: 150,
};

const REF = 'aacojyvujhywanaulvuu';
const USER = { id: '20000000-0000-4000-8000-0000000000e1', aud: 'authenticated', role: 'authenticated', email: 'viteza.test@example.com', email_confirmed_at: '2026-11-14T08:00:00Z', user_metadata: { prenume: 'Ana', rol_solicitat: 'investor' }, app_metadata: { provider: 'email' } };
function b64u(o) { return Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function sesiune() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: USER.id, exp, role: 'authenticated', email: USER.email })}.semnatura-test`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'rt-test', user: USER };
}

// ── Profilurile simulate (/api/cont/profil) ──────────────────────────────
const PASI_ACTIVARE = ['firma', 'cont_bancar', 'profesii', 'dotari', 'documente', 'contract'];
const PROFIL = {
  investitor_nou: () => ({ ok: true, email: USER.email, nume: 'Ana Test', prenume: 'Ana', nume_familie: 'Test', telefon: '+40700000009', tara: 'RO', roles: ['client'], roluri_dashboard: [], are_comenzi: false, destinatie: '/mydarrin-panou-investitor.html', tip_destinatie: 'investitor', rol_solicitat: 'investor', partener: null, investitor: { status: 'ciorna', pas_curent: 2 }, activare: null }),
  activare: () => ({ ok: true, email: USER.email, nume: 'Ana Test', tara: 'RO', roles: ['client'], roluri_dashboard: [], are_comenzi: false, destinatie: '/mydarrin-dashboard-partener.html?type=servicii', tip_destinatie: 'activare_partener', rol_solicitat: 'partener_servicii', partener: null, investitor: null,
    activare: { rol: 'partener_servicii', tip: 'servicii', mod_activare: true, verificare: null, activ: false, complet: false, pasi: PASI_ACTIVARE.map((cheie, i) => ({ cheie, stare: i === 0 ? 'de_completat' : 'blocat' })) } }),
  partener: () => ({ ok: true, email: USER.email, nume: 'Ana Test', tara: 'RO', roles: ['client', 'partener_servicii'], roluri_dashboard: ['partener_servicii'], are_comenzi: false, destinatie: '/mydarrin-dashboard-partener.html?type=servicii', tip_destinatie: 'dashboard', rol_solicitat: 'partener_servicii', investitor: null,
    partener: { nume_firma: 'Firma Test SRL', partner_type: 'servicii', rol: 'partener_servicii', status_verificare: 'approved', contract_semnat: true, cont_bancar: true, poate_vinde: true },
    activare: { rol: 'partener_servicii', tip: 'servicii', mod_activare: false, verificare: 'approved', activ: true, complet: true, pasi: PASI_ACTIVARE.map((cheie) => ({ cheie, stare: 'completat' })) } }),
};
const RUNDA = { ok: true, runda: { id: 'r-seed', cod: 'seed', denumire_ro: 'Runda Seed', denumire_en: 'Seed round', descriere_ro: 'Prima rundă.', descriere_en: 'The first round.', moneda: 'EUR', pret_actiune: 100, investitie_minima: 1000, suma_tinta: 200000, equity_oferit_pct: 10, data_sfarsit: '2027-03-31', progres: { stranse: 20000, pct: 10 } } };

function kycLaPas(pas) {
  return { status: 'ciorna', pas_curent: pas, date_personale: { prenume: 'Ana', nume: 'Test', telefon: '+40700000009', tara: 'RO' }, iban_mascat: 'RO49 **** 0000', data_nasterii: '1985-03-14', cetatenie: 'RO', id_fiscal_tip: 'cnp', id_fiscal_mascat: '***239',
    adresa_domiciliu: { strada: 'Str. Exemplu 1', localitate: 'Cluj-Napoca', judet: 'Cluj', cod_postal: '400001', tara: 'RO' }, tip_document: 'ci', document_fata_path: USER.id + '/fata.jpg', document_verso_path: USER.id + '/verso.jpg', act_serie_mascat: '***456', act_valabil_pana: '2030-12-31' };
}

// ── Rețeaua modelată ─────────────────────────────────────────────────────
const cacheExtern = new Map();
const comprimat = new Map();
function marimeComprimata(url, body, tip) {
  if (comprimat.has(url)) return comprimat.get(url);
  const n = /text|javascript|json|css|svg|xml/.test(tip || '') ? zlib.gzipSync(body).length : body.length;
  comprimat.set(url, n);
  return n;
}
function antetCurat(h) {
  const o = {};
  for (const [k, v] of Object.entries(h)) if (!/^(content-encoding|content-length|transfer-encoding|connection)$/i.test(k)) o[k] = v;
  return o;
}

async function context(browser, baza, sc) {
  const retea = RETELE[sc.retea || 'normala'];
  const ctx = await browser.newContext({ viewport: sc.viewport || { width: 1366, height: 900 } });
  const gazde = new Set();
  const stare = { cereri: [], kycPas: sc.kycPas || 1, puturi: 0 };
  await ctx.addInitScript(([lang]) => {
    try {
      // O singură dată pe context: după o schimbare din selector, limba aleasă rămâne.
      if (!sessionStorage.getItem('__mv_limba')) { localStorage.setItem('myd_lang_v1', lang); sessionStorage.setItem('__mv_limba', '1'); }
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, marketing: false, data: new Date().toISOString(), versiune: 2 }));
    } catch (e) {}
    // Momentele măsurate, în ms de la începutul navigării (performance.now()).
    const m = window.__mv = { ascuns: false };
    const acum = () => performance.now();
    new MutationObserver(() => {
      const h = document.documentElement;
      if (!h) return;
      const p = h.classList.contains('myd-i18n-pending');
      if (p) m.ascuns = true;
      else if (m.ascuns && m.vizibil == null) m.vizibil = acum();
    }).observe(document, { attributes: true, subtree: true, childList: true, attributeFilter: ['class'] });
    let client;
    Object.defineProperty(window, 'supabaseClient', { configurable: true, get() { return client; }, set(v) { client = v; if (m.supabase == null) m.supabase = acum(); } });
    try { new PerformanceObserver((l) => { l.getEntries().forEach((e) => { if (e.name === 'first-contentful-paint') m.fcp = e.startTime; }); }).observe({ type: 'paint', buffered: true }); } catch (e) {}
    document.addEventListener('DOMContentLoaded', () => { m.dcl = acum(); });
    // Ruta KYC: clicurile pe „Continuă” și plecarea spre pagina următoare (ms, ceas absolut).
    m.clicuri = [];
    document.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('#mi-continua, #mya-site')) m.clicuri.push(acum()); }, true);
    window.addEventListener('pagehide', () => { try { sessionStorage.setItem('__mv_plecare', String(performance.timeOrigin + performance.now())); sessionStorage.setItem('__mv_clic', String(performance.timeOrigin + (m.clicuri[m.clicuri.length - 1] || 0))); } catch (e) {} });
    // Momentele elementelor urmărite, verificate la fiecare cadru.
    (function cadru() {
      const t = document.getElementById('pi-runda-titlu');
      if (m.runda == null && t && t.textContent.trim() && document.getElementById('pi-app') && document.getElementById('pi-app').getAttribute('data-pi-gata') === '1') m.runda = acum();
      const app = document.getElementById('pi-app');
      if (m.panou == null && app && !app.hidden && app.getClientRects().length) m.panou = acum();
      if (m.pas4 == null && document.getElementById('mi-rezidenta')) m.pas4 = acum();
      if (m.pas5 == null && document.getElementById('mi-confirma')) m.pas5 = acum();
      const ant = document.getElementById('myd-id');
      if (m.antet == null && ant) m.antet = acum();
      requestAnimationFrame(cadru);
    })();
  }, [sc.lang || 'en']);
  if (sc.cuSesiune) {
    const s = sesiune();
    await ctx.addCookies([{ name: `sb-${REF}-auth-token.0`, value: encodeURIComponent(JSON.stringify(s)), domain: 'localhost', path: '/' }]);
  }
  const json = (r, corp, cod) => r.fulfill({ status: cod || 200, contentType: 'application/json', body: JSON.stringify(corp) });
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const local = u.hostname === 'localhost';
    if (local && u.pathname.startsWith('/api/')) {
      stare.cereri.push({ t: Date.now(), m: req.method(), p: u.pathname + u.search });
      if (u.pathname === '/api/cont/profil' && req.method() === 'PATCH') { try { stare.limbaSalvata = JSON.parse(req.postData() || '{}').limba; } catch (e) {} }
      const extra = INTARZIERI_API[u.pathname] != null ? INTARZIERI_API[u.pathname] : INTARZIERI_API.implicit;
      await asteapta(retea.rtt + extra);
      const p = u.pathname;
      if (p === '/api/cont/profil') {
        if (req.method() === 'PATCH' || req.method() === 'POST') { stare.limbaSalvata = (JSON.parse(req.postData() || '{}') || {}).limba; return json(route, { ok: true, limba: stare.limbaSalvata }); }
        return json(route, PROFIL[sc.profil || 'investitor_nou']());
      }
      if (p === '/api/public/runda-curenta') return json(route, RUNDA);
      if (p === '/api/public/pitch-deck') return json(route, { ok: true, stare: 'disponibil', vizibilitate: 'public' });
      if (p === '/api/investitori/kyc') {
        if (req.method() === 'POST') { const b = JSON.parse(req.postData() || '{}'); stare.kycPas = Math.max(stare.kycPas, (b.pas || 0) + 1); return json(route, { ok: true, kyc: kycLaPas(stare.kycPas), lipsa: [] }); }
        return json(route, { ok: true, kyc: kycLaPas(stare.kycPas), lipsa: [], cont: { prenume: 'Ana', nume: 'Test', email: USER.email, telefon: '+40700000009', tara: 'RO' } });
      }
      if (p === '/api/partener/activare-ciorna') { if (req.method() === 'PUT') stare.puturi++; return json(route, { ok: true, ciorna: null, actualizat_la: new Date().toISOString() }); }
      if (/^\/api\/public\/(reguli-platforma|tari-active)/.test(p)) return route.continue();
      if (/^\/api\/public\/traduceri-catalog/.test(p)) return json(route, { _texte: {} });
      return json(route, { ok: false }, 503);
    }
    if (FARA && FARA.test(req.url())) return route.fulfill({ status: 200, contentType: /\.css/.test(u.pathname) ? 'text/css' : 'application/javascript', body: '' });
    if (/\.supabase\.co$/.test(u.hostname)) { stare.cereri.push({ t: Date.now(), m: req.method(), p: 'supabase:' + u.pathname }); await asteapta(retea.rtt); return json(route, {}); }
    if (/googletagmanager|google-analytics|ipapi\.co|facebook|tiktok|licdn|_vercel\/insights/.test(req.url())) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    // Fonturile Google: direct (nu prin modelul de rețea) — servite din cache-ul modelat ieșeau stricate.
    if (/fonts\.(gstatic|googleapis)\.com/.test(u.hostname)) return route.continue();
    try {
      let raspuns;
      let conexiuneNoua = false;
      if (local) {
        const r = await route.fetch();
        raspuns = { status: r.status(), headers: r.headers(), body: await r.body() };
      } else {
        if (!gazde.has(u.host)) { gazde.add(u.host); conexiuneNoua = true; }
        if (!cacheExtern.has(req.url())) {
          const r = await route.fetch({ timeout: 20000 });
          cacheExtern.set(req.url(), { status: r.status(), headers: r.headers(), body: await r.body(), redirect: r.url() !== req.url() });
        }
        raspuns = cacheExtern.get(req.url());
      }
      const tip = raspuns.headers['content-type'] || '';
      const octeti = marimeComprimata(req.url(), raspuns.body, tip);
      const rtt = retea.rtt * (1 + (conexiuneNoua ? 2 : 0) + (raspuns.redirect ? 1 : 0));
      await asteapta(rtt + octeti / retea.octetiPeMs);
      return route.fulfill({ status: raspuns.status, headers: antetCurat(raspuns.headers), body: raspuns.body });
    } catch (e) {
      return route.abort();
    }
  });
  const page = await ctx.newPage();
  const erori = [];
  page.on('pageerror', (e) => erori.push(e.message.slice(0, 200)));
  return { ctx, page, stare, erori, baza };
}

// Momentele unei pagini, raportate la sfârșitul HTML-ului (responseEnd).
async function momente(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const m = window.__mv || {};
    const rel = (x) => (x == null ? null : Math.round(x));
    const res = performance.getEntriesByType('resource').map((r) => ({ n: r.name.replace(location.origin, ''), s: Math.round(r.startTime), e: Math.round(r.responseEnd), tip: r.initiatorType }));
    return { html: rel(nav.responseEnd), dcl: rel(m.dcl), fcp: rel(m.fcp), vizibil: rel(m.vizibil), ascuns: !!m.ascuns, supabase: rel(m.supabase), antet: rel(m.antet), panou: rel(m.panou), runda: rel(m.runda), resurse: res };
  });
}

async function deschide(browser, baza, sc, cale, asteptare) {
  const c = await context(browser, baza, sc);
  await c.page.goto(baza + cale, { waitUntil: 'load', timeout: 60000 });
  if (asteptare) await asteptare(c.page).catch(() => {});
  await asteapta(300);
  const m = await momente(c.page);
  await c.ctx.close();
  return Object.assign(m, { cereri: c.stare.cereri, erori: c.erori });
}

const PAGINI = [
  { id: 'homepage', cale: '/', sc: {} },
  { id: 'catalog', cale: '/mydarrin-catalog', sc: {} },
  { id: 'partener (public)', cale: '/cum-devii-partenerul-nostru', sc: {} },
  { id: 'activare partener', cale: '/mydarrin-dashboard-partener.html?type=servicii', sc: { cuSesiune: true, profil: 'activare' }, asteapta: (p) => p.waitForSelector('#myd-activare-pagina #mya-site', { timeout: 15000 }) },
  { id: 'panou partener', cale: '/mydarrin-dashboard-partener.html?type=servicii', sc: { cuSesiune: true, profil: 'partener' }, asteapta: (p) => p.waitForSelector('#myd-id', { timeout: 15000 }) },
  { id: 'rolurile mele', cale: '/mydarrin-rolurile-mele', sc: { cuSesiune: true, profil: 'partener' }, asteapta: (p) => p.waitForSelector('#myd-id, .rm-card, [data-rol]', { timeout: 15000 }) },
  { id: 'panou investitor', cale: '/mydarrin-panou-investitor', sc: { cuSesiune: true, profil: 'investitor_nou' }, asteapta: (p) => p.waitForFunction(() => window.__mv && window.__mv.runda != null, null, { timeout: 15000 }) },
];

// „Înapoi la site” din activare → homepage vizibil.
async function inapoiLaSite(browser, baza, sc) {
  const c = await context(browser, baza, Object.assign({ cuSesiune: true, profil: 'activare' }, sc));
  await c.page.goto(baza + '/mydarrin-dashboard-partener.html?type=servicii', { waitUntil: 'load', timeout: 60000 });
  await c.page.waitForSelector('#mya-site', { timeout: 15000 });
  await asteapta(500);
  const puturiInainte = c.stare.puturi;
  await c.page.click('#mya-site');
  await c.page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });
  await c.page.waitForFunction(() => window.__mv && window.__mv.fcp != null, null, { timeout: 15000 }).catch(() => {});
  const m = await momente(c.page);
  const f = await c.page.evaluate(() => ({ pl: Number(sessionStorage.getItem('__mv_plecare')), cl: Number(sessionStorage.getItem('__mv_clic')), start: performance.timeOrigin }));
  await asteapta(800);
  await c.ctx.close();
  // plecare = clic → părăsirea paginii de activare; total = clic → homepage vizibil (FCP)
  return { plecare: Math.round(f.pl - f.cl), total: Math.round(f.start + (m.fcp || 0) - f.cl), fcpHomepage: m.fcp, puturi: c.stare.puturi - puturiInainte };
}

// Ruta KYC: „Continuă” → pasul următor vizibil (pașii 3 → 4 → 5), plus finalul.
// Momentele se iau în pagină (clicul și apariția pasului), fără întârzierea
// dintre Playwright și browser.
async function rutaKyc(browser, baza, sc) {
  const c = await context(browser, baza, Object.assign({ cuSesiune: true, profil: 'investitor_nou', kycPas: 3 }, sc));
  const p = c.page;
  await p.goto(baza + '/mydarrin-investitori.html?ruta=investeste', { waitUntil: 'load', timeout: 60000 });
  await p.waitForSelector('input[name="mi-experienta"]', { timeout: 20000 });
  await asteapta(300);
  const r = {};
  await p.check('input[name="mi-experienta"][value="1"]');
  await p.check('input[name="mi-toleranta"][value="0"]');
  await p.check('input[name="mi-scop"][value="1"]');
  await p.check('input[name="mi-pep"][value="nu"]');
  await p.check('#mi-sanctiuni');
  await p.click('#mi-continua');
  await p.waitForSelector('#mi-rezidenta', { timeout: 15000 });
  await p.selectOption('#mi-rezidenta', 'RO');
  // Clicul pe pasul 4 vine imediat ce butonul e din nou activ (un utilizator rapid).
  const tGata = Date.now();
  await p.click('#mi-continua');
  r.butonBlocat = Date.now() - tGata;
  await p.waitForSelector('#mi-confirma', { timeout: 15000 });
  const m = await p.evaluate(() => ({ c: window.__mv.clicuri.slice(), p4: window.__mv.pas4, p5: window.__mv.pas5, et: (document.getElementById('mi-continua') || {}).textContent }));
  r.pas3la4 = Math.round(m.p4 - m.c[0]);
  r.pas4la5 = Math.round(m.p5 - m.c[1]);
  await asteapta(2000);
  r.eticheta5 = await p.evaluate(() => (document.getElementById('mi-continua') || {}).textContent);
  await p.check('#mi-confirma');
  await p.click('#mi-continua');
  await p.waitForURL(/ruta=investeste/, { timeout: 15000, waitUntil: 'commit' }).catch(() => {});
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  const f = await p.evaluate(() => ({ pl: Number(sessionStorage.getItem('__mv_plecare')), cl: Number(sessionStorage.getItem('__mv_clic')) })).catch(() => ({}));
  r.final = f.pl && f.cl ? Math.round(f.pl - f.cl) : null;
  r.server = INTARZIERI_API['/api/investitori/kyc'] + RETELE[sc.retea || 'normala'].rtt;
  r.erori = c.erori;
  await c.ctx.close();
  return r;
}

function rand(cols, lat) { return cols.map((c, i) => String(c == null ? '—' : c).padEnd(lat[i])).join(' '); }

async function masuratori(browser, baza, retea) {
  const out = { retea, pagini: {}, inapoi: {}, ruta: {} };
  for (const lang of ['en', 'ro']) {
    for (const pg of PAGINI) {
      const m = await deschide(browser, baza, Object.assign({ lang, retea }, pg.sc), pg.cale, pg.asteapta);
      out.pagini[pg.id + ' ' + lang] = m;
    }
    out.inapoi[lang] = await inapoiLaSite(browser, baza, { lang, retea });
    out.ruta[lang] = await rutaKyc(browser, baza, { lang, retea });
  }
  return out;
}

function tipareste(rez) {
  console.log(`\n=== Rețea: ${rez.retea} (ms de la începutul navigării; „după HTML” = față de sfârșitul HTML-ului) ===`);
  const lat = [26, 6, 6, 7, 7, 9, 7, 7, 8];
  console.log(rand(['pagina', 'HTML', 'DCL', 'FCP', 'ascuns', 'supabase', 'antet', 'runda', 'runda-HTML'], lat));
  for (const [id, m] of Object.entries(rez.pagini)) {
    console.log(rand([id, m.html, m.dcl, m.fcp, m.ascuns ? 'da' : 'nu', m.supabase, m.antet, m.runda, m.runda != null ? m.runda - m.html : null], lat));
  }
  for (const [lang, m] of Object.entries(rez.inapoi)) console.log(`„Înapoi la site” ${lang}: clic → plecare ${m.plecare} ms, clic → homepage vizibil ${m.total} ms (FCP homepage ${m.fcpHomepage}), ciorna trimisă la plecare: ${m.puturi}`);
  for (const [lang, m] of Object.entries(rez.ruta)) console.log(`Ruta KYC ${lang}: 3→4 ${m.pas3la4} ms, 4→5 ${m.pas4la5} ms, final (clic → plecare) ${m.final} ms, butonul pasului 4 blocat ${m.butonBlocat} ms, eticheta pasului 5: „${m.eticheta5}” (serverul simulat: ${m.server} ms)${m.erori.length ? ' erori: ' + m.erori.join(' | ') : ''}`);
}

// Componentele panoului investitorului: fiecare cerere, cu începutul și sfârșitul.
function componente(m) {
  const interes = m.resurse.filter((r) => /\/api\/|i18n|supabase|esm\.sh|tailwind|lucide|supabaseClient/.test(r.n));
  return interes.map((r) => `${String(r.s).padStart(5)}–${String(r.e).padEnd(5)} ${r.n.slice(0, 90)}`).join('\n');
}

// --capturi <dosar>: paginile de cont (activare, panou partener, „Rolurile mele”,
// panou investitor), la 390 și 1366 px, în EN, cu selectorul de limbă deschis
// pe a doua captură — pentru aprobarea LM.
const PAGINI_CONT = [
  ['activare', '/mydarrin-dashboard-partener.html?type=servicii', 'activare', '#myd-activare-pagina [data-myd-limba]'],
  ['panou-partener', '/mydarrin-dashboard-partener.html?type=servicii', 'partener', '#myd-id [data-myd-limba]'],
  ['rolurile-mele', '/mydarrin-rolurile-mele', 'partener', '#rm-limba [data-myd-limba]'],
  ['panou-investitor', '/mydarrin-panou-investitor', 'investitor_nou', '#myd-id [data-myd-limba]'],
];
async function capturi(browser, baza, dosar) {
  fs.mkdirSync(dosar, { recursive: true });
  for (const [nume, cale, profil, sel] of PAGINI_CONT) {
    for (const latime of [390, 1366]) {
      const c = await context(browser, baza, { cuSesiune: true, profil, lang: 'en', viewport: { width: latime, height: latime < 800 ? 844 : 900 } });
      await c.page.goto(baza + cale, { waitUntil: 'load', timeout: 60000 });
      // Doar pentru capturi: pe unele mașini Windows, local('Helvetica Neue') din
      // @font-face 'Helvetica World' se rezolvă la un font fără glife (text în casete).
      await c.page.addStyleTag({ content: "@font-face{font-family:'Helvetica World';src:local('Arial')}" }).catch(() => {});
      await c.page.waitForSelector(sel, { timeout: 8000 }).catch(() => {});
      await asteapta(800);
      await c.page.screenshot({ path: path.join(dosar, `${nume}-${latime}.png`) });
      const are = await c.page.$(sel + ' .lang-chip');
      if (are) {
        await are.click();
        await asteapta(200);
        await c.page.screenshot({ path: path.join(dosar, `${nume}-${latime}-selector.png`) });
      }
      await c.ctx.close();
    }
  }
}

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    if (opt('capturi')) { await capturi(browser, baza, opt('capturi')); return; }
    if (MASOARA) {
      const retele = opt('retea') ? [opt('retea')] : ['normala', 'slow4g'];
      const tot = {};
      for (const r of retele) {
        tot[r] = await masuratori(browser, baza, r);
        tipareste(tot[r]);
        console.log('\nPanou investitor EN — cererile (start–sfârșit, ms):\n' + componente(tot[r].pagini['panou investitor en']));
      }
      if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify(tot, null, 2));
      return;
    }
    await teste(browser, baza);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// ── Testul (praguri pe rețeaua „normală”) ────────────────────────────────
const { eRo } = require('./recunoaste-ro');
async function teste(browser, baza) {
  // A. Panoul investitorului: runda ≤ 800 ms după HTML; nicio cerere API dublă.
  // Încălzire: CDN-urile externe se descarcă o dată, real, apoi vin din memorie (modelul de rețea).
  await deschide(browser, baza, { lang: 'en', cuSesiune: true, profil: 'investitor_nou' }, '/mydarrin-panou-investitor',
    (p) => p.waitForFunction(() => window.__mv && window.__mv.runda != null, null, { timeout: 15000 }));
  for (const lang of ['en', 'ro']) {
    const m = await deschide(browser, baza, { lang, cuSesiune: true, profil: 'investitor_nou' }, '/mydarrin-panou-investitor',
      (p) => p.waitForFunction(() => window.__mv && window.__mv.runda != null, null, { timeout: 15000 }));
    verifica(m.runda != null && m.runda - m.html <= 800, `A ${lang}: runda la ${m.runda - m.html} ms după HTML (prag 800)`);
    const api = m.cereri.filter((x) => /^\/api\//.test(x.p)).map((x) => x.m + ' ' + x.p);
    const duble = api.filter((x, i) => api.indexOf(x) !== i);
    verifica(!duble.length, `A ${lang}: cereri API făcute de două ori la deschiderea panoului: ${[...new Set(duble)].join(', ')}`);
    verifica(api.filter((x) => x === 'GET /api/cont/profil').length === 1, `A ${lang}: /api/cont/profil o singură dată (${api.filter((x) => /cont\/profil/.test(x)).length})`);
    verifica(!m.resurse.some((r) => /esm\.sh/.test(r.n)), `A ${lang}: supabase-js nu mai vine de pe esm.sh`);
    verifica(m.resurse.some((r) => /\/lib\/vendor\/supabase-js-2\.45\.0\.umd\.js/.test(r.n)), `A ${lang}: supabase-js 2.45.0 de pe domeniul propriu`);
    verifica(m.supabase != null, `A ${lang}: clientul Supabase pornește`);
    verifica(!m.erori.length, `A ${lang}: fără erori JS (${m.erori.join(' | ')})`);
  }

  // B. EN: niciun text românesc în primele cadre vizibile ale panoului.
  {
    const c = await context(browser, baza, { lang: 'en', cuSesiune: true, profil: 'investitor_nou' });
    await c.ctx.addInitScript(() => {
      window.__cadre = [];
      (function cadru() {
        const h = document.documentElement;
        if (h && document.body && !h.classList.contains('myd-i18n-pending') && window.__cadre.length < 40) {
          // Doar textul care se vede: în ecran, nu ascuns (ex. legătura „Sari la conținut” stă la top:-100px).
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const vazut = [];
          while (w.nextNode()) {
            const n = w.currentNode, el = n.parentElement;
            if (!el || !n.data.trim() || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
            vazut.push(n.data.trim());
          }
          window.__cadre.push(vazut.join('\n'));
        }
        if (window.__cadre.length < 40) requestAnimationFrame(cadru);
      })();
    });
    await c.page.goto(baza + '/mydarrin-panou-investitor', { waitUntil: 'load' });
    await c.page.waitForFunction(() => window.__mv && window.__mv.runda != null, null, { timeout: 15000 }).catch(() => {});
    const cadre = await c.page.evaluate(() => window.__cadre);
    const ro = new Set();
    cadre.forEach((t) => t.split('\n').map((x) => x.trim()).filter(Boolean).forEach((r) => { if (eRo(r)) ro.add(r); }));
    verifica(cadre.length > 5, `B: cadre capturate după afișare: ${cadre.length}`);
    verifica(ro.size === 0, `B: text românesc în primele cadre EN: ${[...ro].slice(0, 6).join(' | ')}`);
    await c.ctx.close();
  }

  // C. Traducerea lentă: după 600 ms, indicatorul de încărcare (fără text), pagina tot ascunsă; apoi tradusă.
  {
    const c = await context(browser, baza, { lang: 'en' });
    await c.ctx.route(/\/i18n\/en\.json/, async (r) => { await asteapta(1800); return r.fallback(); });
    await c.page.goto(baza + '/despre-noi', { waitUntil: 'commit' });
    await asteapta(1000);
    const st = await c.page.evaluate(() => ({ lent: document.documentElement.classList.contains('myd-i18n-lent'), ascuns: document.documentElement.classList.contains('myd-i18n-pending') }));
    verifica(st.lent && st.ascuns, `C: la 1 s cu dicționarul întârziat: indicator ${st.lent}, pagina ascunsă ${st.ascuns}`);
    await c.page.waitForFunction(() => !document.documentElement.classList.contains('myd-i18n-pending'), null, { timeout: 8000 }).catch(() => {});
    const dupa = await c.page.evaluate(() => ({ lent: document.documentElement.classList.contains('myd-i18n-lent'), lang: document.documentElement.lang }));
    verifica(!dupa.lent && dupa.lang === 'en', `C: după sosire, indicatorul dispare (${JSON.stringify(dupa)})`);
    await c.ctx.close();
  }

  // D. Ruta KYC: trecerea între pași ≤ 600 ms + timpul serverului; finalul ≤ 400 ms + server (+ marjă);
  //    eticheta pasului 5 rămâne „Trimite pentru verificare”; butonul nu rămâne blocat.
  for (const lang of ['en', 'ro']) {
    const r = await rutaKyc(browser, baza, { lang });
    verifica(r.pas3la4 <= 600 + r.server && r.pas4la5 <= 600 + r.server, `D ${lang}: 3→4 ${r.pas3la4} ms, 4→5 ${r.pas4la5} ms (prag ${600 + r.server})`);
    verifica(r.pas3la4 >= r.server, `D ${lang}: pasul următor apare doar după răspunsul serverului (${r.pas3la4} ≥ ${r.server})`);
    verifica(r.final != null && r.final <= 400 + r.server + 250, `D ${lang}: final ${r.final} ms (prag ${400 + r.server + 250})`);
    verifica(r.eticheta5 === (lang === 'en' ? 'Submit for review' : 'Trimite pentru verificare'), `D ${lang}: eticheta pasului 5: „${r.eticheta5}”`);
    verifica(r.butonBlocat < 400, `D ${lang}: butonul pasului 4 nu rămâne blocat (${r.butonBlocat} ms)`);
    verifica(!r.erori.length, `D ${lang}: fără erori JS (${r.erori.join(' | ')})`);
  }

  // E. „Înapoi la site”: pleacă fără să aștepte serverul; ciorna (schimbată) pleacă totuși.
  for (const lang of ['en', 'ro']) {
    const r = await inapoiLaSite(browser, baza, { lang });
    verifica(r.plecare <= 300, `E ${lang}: clic → plecare ${r.plecare} ms (prag 300)`);
    verifica(r.puturi === 1, `E ${lang}: ciorna trimisă o dată la plecare (keepalive): ${r.puturi}`);
  }

  // F. Selectorul de limbă pe paginile de cont: prezent, RO + EN, schimbarea salvează profiles.limba și reîncarcă.
  for (const [nume, cale, profil, sel] of PAGINI_CONT) {
    for (const latime of [390, 1366]) {
      const c = await context(browser, baza, { lang: 'en', cuSesiune: true, profil, viewport: { width: latime, height: latime < 800 ? 844 : 900 } });
      await c.page.goto(baza + cale, { waitUntil: 'load' });
      const are = await c.page.waitForSelector(sel, { timeout: 10000 }).then(() => true, () => false);
      verifica(are, `F ${nume} ${latime}: selectorul de limbă e în antet`);
      if (!are) { await c.ctx.close(); continue; }
      const vizibil = await c.page.isVisible(sel + ' .lang-chip');
      verifica(vizibil, `F ${nume} ${latime}: selectorul e vizibil`);
      const opt = await c.page.$$eval(sel + ' .lang-opt', (l) => l.map((o) => o.getAttribute('data-limba')));
      verifica(opt.join(',') === 'ro,en', `F ${nume} ${latime}: limbile ${opt.join(',')}`);
      const iese = await c.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      verifica(!iese, `F ${nume} ${latime}: pagina nu iese din ecran`);
      if (latime === 390) {
        await c.page.click(sel + ' .lang-chip');
        await c.page.click(sel + ' .lang-opt[data-limba="ro"]');
        await c.page.waitForFunction(() => document.documentElement.lang === 'ro', null, { timeout: 10000 }).catch(() => {});
        verifica(await c.page.evaluate(() => document.documentElement.lang) === 'ro', `F ${nume}: după „Română”, pagina e în română`);
        verifica(await c.page.evaluate(() => localStorage.getItem('myd_lang_v1')) === 'ro', `F ${nume}: myd_lang_v1 = ro`);
        verifica(c.stare.limbaSalvata === 'ro', `F ${nume}: limba salvată pe cont (PATCH /api/cont/profil): ${c.stare.limbaSalvata}`);
      }
      await c.ctx.close();
    }
  }

  // H. API: PATCH /api/cont/profil { limba } — doar ro / en, doar pe contul propriu; GET întoarce limba.
  {
    const sim = require('./supabase-simulat');
    sim.instaleaza();
    const api = require(path.join(RADACINA, 'api/cont/profil.js'));
    const U = '20000000-0000-4000-8000-0000000000f1';
    sim.DB.tabele = { profiles: [{ id: U, roles: ['client'], limba: 'en' }, { id: 'alt', roles: ['client'], limba: 'en' }], investitori_kyc: [], partners: [], partner_conturi_bancare: [], comenzi: [], accese_temporare: [], audit_log: [], palnie_evenimente: [] };
    sim.DB.utilizatori = { 'tok-u': { id: U, email: 'u@test', user_metadata: {} } };
    const cheama = async (metoda, body, token = 'tok-u') => { const res = sim.raspuns(); await api(sim.cerere({ metoda, token, body }), res); return res; };
    let r = await cheama('PATCH', { limba: 'ro' });
    verifica(r.statusCode === 200 && r.corp.limba === 'ro' && sim.DB.tabele.profiles[0].limba === 'ro', `H: PATCH ro → 200, salvat (${r.statusCode} ${JSON.stringify(r.corp)})`);
    verifica(sim.DB.tabele.profiles[1].limba === 'en', 'H: alt cont neatins');
    r = await cheama('PATCH', { limba: 'de' });
    verifica(r.statusCode === 400 && r.corp.ok === false && r.corp.mesaj && r.corp.mesaj.ro && r.corp.mesaj.en && (r.corp.campuri || []).some((x) => x.camp === 'limba'), `H: PATCH de → 400, forma comună cu câmpul limba (${JSON.stringify(r.corp)})`);
    verifica(sim.DB.tabele.profiles[0].limba === 'ro', 'H: o limbă invalidă nu schimbă nimic');
    r = await cheama('PATCH', { limba: 'en' }, null);
    verifica(r.statusCode === 401, `H: fără sesiune → 401 (${r.statusCode})`);
    r = await cheama('GET');
    verifica(r.statusCode === 200 && r.corp.limba === 'ro' && Array.isArray(r.corp.roles), `H: GET întoarce limba (${r.statusCode} ${r.corp && r.corp.limba})`);
    r = await cheama('DELETE');
    verifica(r.statusCode === 405, `H: altă metodă → 405 (${r.statusCode})`);
  }

  // G. Codul: fără interogare la 100 ms după clientul Supabase; o singură definiție a promisiunii.
  {
    const citeste = (f) => fs.readFileSync(path.join(RADACINA, f), 'utf8');
    const sb = citeste('lib/supabaseClient.js');
    verifica(/window\.MYD_SUPABASE_GATA = /.test(sb) && /myd:supabase-gata/.test(sb) && !/esm\.sh/.test(sb.replace(/\/\/.*$/gm, '')), 'G: lib/supabaseClient.js: MYD_SUPABASE_GATA + evenimentul, fără esm.sh');
    for (const f of ['investitori-ruta.js', 'cont-dashboard.js', 'ui-comun.js', 'cta-partener.js', 'cta-investitor.js', 'cont-fereastra.js', 'panou-investitor.js']) {
      const src = citeste(f);
      verifica(!/window\.supabaseClient\s*(\|\||&&)[^;]{0,60}setTimeout\(\w+,\s*100\)/.test(src) && !/if \(window\.MyDarrinAuth && window\.supabaseClient\) return ok\(true\)/.test(src), `G: ${f} nu mai interoghează clientul la 100 ms`);
    }
    verifica((citeste('lib/supabaseClient.js').match(/MYD_SUPABASE_GATA = /g) || []).length === 1, 'G: MYD_SUPABASE_GATA definit o singură dată');
    const vj = JSON.parse(citeste('vercel.json'));
    verifica(Array.isArray(vj.regions) && vj.regions[0] === 'fra1', 'G: funcțiile în fra1, lângă Supabase (eu-central-1)');
    const ruta = citeste('investitori-ruta.js');
    verifica(/DUPA_SALVARE_MS = 150;/.test(ruta) && /DUPA_TRIMITERE_MS = 400;/.test(ruta) && !/, 450\)/.test(ruta) && !/, 900\)/.test(ruta), 'G: întârzierile rutei: 150 / 400 ms');
    verifica(/optiuni\.durataOk != null \? optiuni\.durataOk : 1800/.test(citeste('ui-feedback.js')), 'G: MDFeedback: durataOk, implicit 1800 ms (neschimbat pentru restul paginilor)');
  }
}
