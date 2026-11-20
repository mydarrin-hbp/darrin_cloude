// scripts/retea-modelata.js — rețeaua modelată pentru testele de viteză din Playwright
// (pasul 12-L1, 19 nov. 2026; același model ca scripts/test-viteza-investitor.js).
//
// Fiecare cerere trece prin ctx.route:
//   - întârziere = RTT + octeți comprimați / lățime de bandă; prima cerere spre un
//     domeniu extern mai adaugă 2 RTT (DNS + TLS);
//   - „normala”: RTT 40 ms, 20 Mbit/s; „slow4g” (ca Lighthouse): RTT 150 ms, 1,6 Mbit/s;
//   - fișierele site-ului vin de la serverul local (scripts/server-test.js); CDN-urile
//     externe (Tailwind, Lucide, DOMPurify…) se descarcă o singură dată, real, și se
//     servesc apoi din memorie, cu aceeași întârziere modelată;
//   - API-urile le răspunde testul (`api(url, req)` → { status, body }), după RTT.
// Concurența dintre cereri pentru aceeași bandă nu e modelată (estimare optimistă).
// Procesorul se încetinește separat, prin CDP (Emulation.setCPUThrottlingRate).

const zlib = require('zlib');

const RETELE = {
  normala: { rtt: 40, octetiPeMs: 20e6 / 8 / 1000 },
  slow4g: { rtt: 150, octetiPeMs: 1.6e6 / 8 / 1000 },
};

const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));
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

// opt: { retea: 'normala' | 'slow4g', api: async (url, req) => { status, body, contentType } sau undefined (→ 503) }
async function instaleaza(ctx, opt) {
  const retea = RETELE[opt.retea || 'normala'];
  const gazde = new Set();
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (local && u.pathname.startsWith('/api/')) {
      await asteapta(retea.rtt);
      // opt.api întoarce { status, body, contentType? } sau undefined (→ 503).
      const r = opt.api ? await opt.api(u, req) : undefined;
      if (!r) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' });
      return route.fulfill({ status: r.status || 200, contentType: r.contentType || 'application/json', body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) });
    }
    if (/\.supabase\.co$/.test(u.hostname)) {
      if (opt.supabase) { const r = await opt.supabase(route, u, req); if (r !== undefined) return r; }
      await asteapta(retea.rtt);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    // Analitica și pixelii (după domeniu și cale, nu după parametri: ?utm_source=facebook e o pagină a site-ului).
    if (/googletagmanager|google-analytics|ipapi\.co|facebook|tiktok|licdn|_vercel\/insights/.test(u.hostname + u.pathname)) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    }
    // Fonturile Google: direct (servite din cache-ul modelat ieșeau stricate).
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
}

// LCP, CLS și momentele titlului, culese în pagină (addInitScript).
function scriptMasurare() {
  const m = window.__lp = { lcp: null, lcpEl: null, cls: 0, dcl: null, titlu: null };
  try {
    new PerformanceObserver((l) => {
      l.getEntries().forEach((e) => {
        m.lcp = e.startTime;
        const el = e.element;
        m.lcpEl = el ? (el.tagName + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')) : null;
      });
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((l) => { l.getEntries().forEach((e) => { if (!e.hadRecentInput) m.cls += e.value; }); })
      .observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  document.addEventListener('DOMContentLoaded', () => { m.dcl = performance.now(); });
}

async function cpu(page, rata) {
  const s = await page.context().newCDPSession(page);
  await s.send('Emulation.setCPUThrottlingRate', { rate: rata });
  return s;
}

module.exports = { RETELE, instaleaza, scriptMasurare, cpu, asteapta };
