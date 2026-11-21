// scripts/server-test.js — server local pentru testele din browser (pasul 11-A, 17 oct. 2026)
//
// Servește fișierele site-ului (cu cleanUrls: /cum-platesc → cum-platesc.html)
// și răspunde la câteva API-uri publice cu date simulate, ca paginile să se
// poată verifica fără `vercel dev` și fără acces la producție:
//   /api/public/reguli-platforma  → REGULI_SIMULATE (sau 503 cu REGULI=off)
//   /api/public/tari-active       → aceleași țări
//   /api/public/categorii         → CATEGORII_SIMULATE (pasul 12-P2)
//   orice alt /api/...            → 503 (paginile trebuie să se randeze și așa)
//   /_vercel/insights/script.js   → script gol (Web Analytics, pasul 11-A1)
//   rescrierile fixe din vercel.json (ex. /parteneri/inscriere), pasul 12-P1
// Datele simulate urmează auditul live din 16 oct. 2026 (checkout activ în
// RO, AT, BG, GR, GB, MD) și deciziile LM din 17 oct. (24 h, 6 zile); nu sunt
// citite din baza de date.
//
// Pasul 11-R3g: cu { redirecturi: true }, serverul aplică și redirecționările
// din vercel.json cu sursă fixă (fără „has”): statusCode-ul lor (301) sau 308
// pentru permanent: true, cu parametrii adresei păstrați, ca pe Vercel.
//
// Utilizare:
//   node scripts/server-test.js [--port 3000] [--redirecturi]   (Ctrl+C oprește serverul)
//   const { porneste } = require('./server-test'); const srv = await porneste(0[, { redirecturi: true }]);

const http = require('http');
const fs = require('fs');
const path = require('path');

const RADACINA = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

const TARI = [
  ['AT', 'Austria', 'EUR', null], ['BG', 'Bulgaria', 'EUR', null], ['GB', 'Marea Britanie', 'GBP', null],
  ['GR', 'Grecia', 'EUR', null], ['MD', 'Moldova', 'MDL', null], ['RO', 'România', 'RON', 100],
];
const CATEGORII_SIMULATE = {
  servicii: [['00000000-0000-4000-8000-000000000101', 'instalatii-sanitare', 'Instalații sanitare', 'Plumbing'], ['00000000-0000-4000-8000-000000000102', 'instalatii-electrice', 'Instalații electrice', 'Electrical installations']],
  materiale: [['00000000-0000-4000-8000-000000000201', 'electrice-cabluri', 'Electrice & Cabluri', 'Electrical & Cables'], ['00000000-0000-4000-8000-000000000202', 'zidarie-beton', 'Zidărie & Beton', 'Masonry & Concrete']],
  inchirieri: [['00000000-0000-4000-8000-000000000301', 'utilaje-constructii', 'Utilaje construcții', 'Construction machinery']],
};
const REGULI_SIMULATE = {
  ok: true,
  tari: TARI.map(([tara_cod, tara_nume, moneda, prag]) => ({ tara_cod, tara_nume, moneda, prag_minim_comanda: prag, metode_plata: ['card'], termen_plata_partener_zile: 6 })),
  metode_plata: ['card'],
  confirmare_tacita_ore: 24,
  termen_plata_partener_zile: 6,
  entitati: [{ denumire: 'Home Best Pal SRL', tara_cod: 'RO' }],
};

function json(res, cod, corp) {
  res.writeHead(cod, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corp));
}

// Pasul 12-U1: rutele ca pe Vercel, în ordinea verificată în producție (19 nov. 2026):
//   1. cleanUrls / trailingSlash: /x.html → 308 /x, /x/ → 308 /x (înaintea oricărei reguli);
//   2. redirects din vercel.json (fără „has”), cu :parametri în sursă; parametrii
//      adresei se păstrează (cei din destinație au întâietate);
//   3. middleware.js: redirecționările care depind de parametri
//      (/mydarrin-catalog?categorie=…, /mydarrin-produs?slug=…) — aceeași funcție,
//      lib/adrese-curate.js → redirect();
//   4. rewrites: adresele curate (lib/adrese-curate.js → rescriere()) și cele fixe.
// Pașii 1–3 doar cu { redirecturi: true }; rescrierile (4) mereu.
const adreseCurate = require('../lib/adrese-curate');
const VERCEL = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(RADACINA, 'vercel.json'), 'utf8')); } catch (e) { return { redirects: [], rewrites: [] }; }
})();
const REDIRECTURI = (VERCEL.redirects || []).filter((r) => !r.has);
const RESCRIERI_FIXE = (VERCEL.rewrites || []).filter((r) => !r.has && !/[:(*]/.test(r.source) && !/[?:]/.test(r.destination) && r.source !== '/');

// Sursa „/catalog/servicii/:categorie” → { re, nume } (doar segmente :nume, ca în vercel.json).
function tiparSursa(sursa) {
  const nume = [];
  const re = new RegExp('^' + sursa.split('/').map((seg) => {
    if (seg.startsWith(':')) { nume.push(seg.slice(1)); return '([^/]+)'; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/') + '$');
  return { re, nume };
}

function trimiteRedirect(res, status, loc) {
  res.writeHead(status, { location: loc });
  res.end();
  return true;
}

function redirect(url, res) {
  // 1. cleanUrls + trailingSlash (Vercel, înaintea regulilor din vercel.json).
  if (/\.html$/.test(url.pathname)) {
    const curat = url.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '') || '/';
    return trimiteRedirect(res, 308, curat + url.search);
  }
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) return trimiteRedirect(res, 308, url.pathname.replace(/\/+$/, '') + url.search);
  // 2. vercel.json
  for (const r of REDIRECTURI) {
    const t = tiparSursa(r.source);
    const m = url.pathname.match(t.re);
    if (!m) continue;
    let dest = r.destination;
    t.nume.forEach((n, i) => { dest = dest.split(':' + n).join(m[i + 1]); });
    const d = new URL(dest, 'http://x');
    url.searchParams.forEach((v, k) => { if (!d.searchParams.has(k)) d.searchParams.append(k, v); });
    return trimiteRedirect(res, r.statusCode || (r.permanent ? 308 : 307), d.pathname + d.search);
  }
  // 3. middleware.js (aceeași regulă ca redirectAdresaVeche)
  if (url.pathname === '/mydarrin-catalog' || url.pathname === '/mydarrin-produs' || /^\/catalog\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname) || /^\/catalog(servicii|materiale|inchirieri)(&.*)?$/.test(url.pathname)) {
    const tinta = adreseCurate.redirect(url.pathname, url.search);
    if (tinta) return trimiteRedirect(res, 301, tinta);
  }
  return false;
}

function rescriere(pathname) {
  const fixa = RESCRIERI_FIXE.find((r) => r.source === pathname);
  if (fixa) return fixa.destination;
  const r = adreseCurate.rescriere(pathname);
  return r && pathname === adreseCurate.curata(pathname) ? '/' + r.fisier : null;
}

function cerere(req, res, opt) {
  const url = new URL(req.url, 'http://x');
  if (opt && opt.redirecturi && redirect(url, res)) return;
  const p = rescriere(url.pathname) || decodeURIComponent(url.pathname);
  // Pasul 11-A1: scriptul Vercel Web Analytics (servit de Vercel în producție):
  // aici un script gol, fără trimitere de date.
  if (p === '/_vercel/insights/script.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    return res.end('/* Vercel Web Analytics: simulat local */');
  }
  if (p.startsWith('/api/')) {
    if (p === '/api/public/reguli-platforma') {
      return process.env.REGULI === 'off' ? json(res, 503, { error: 'indisponibil' }) : json(res, 200, REGULI_SIMULATE);
    }
    if (p === '/api/public/tari-active') {
      return json(res, 200, { ok: true, active: TARI.map((t) => t[0]), tari: TARI.map(([tara_cod, tara_nume]) => ({ tara_cod, tara_nume })), tva: { RO: 21 } });
    }
    // Pasul 12-P2: câteva categorii principale (denumirile din arborele real, audit 20 nov. 2026),
    // ca detectorul să vadă lista de pe /parteneri/inscriere; date simulate, nu din bază.
    if (p === '/api/public/categorii') {
      const tip = url.searchParams.get('tip');
      const en = url.searchParams.get('lang') !== 'ro';
      const L = CATEGORII_SIMULATE[tip];
      if (!L) return json(res, 400, { ok: false, cod: 'TIP_INVALID' });
      return json(res, 200, { ok: true, tip, lang: en ? 'en' : 'ro', categorii: L.map(([id, slug, ro, eng]) => ({ id, slug, denumire: en ? eng : ro })), profesie: null });
    }
    // Mesajul e în engleză: paginile îl pot afișa ca eroare de server, iar
    // detectorul de română (modul EN) nu trebuie să-l numere ca text al paginii.
    return json(res, 503, { error: 'API unavailable on the test server' });
  }
  let f = path.join(RADACINA, p === '/' ? 'index.html' : p);
  if (!f.startsWith(RADACINA)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}

function porneste(port, opt) {
  return new Promise((ok) => { const s = http.createServer((req, res) => cerere(req, res, opt)).listen(port, () => ok(s)); });
}

module.exports = { porneste, REGULI_SIMULATE };

if (require.main === module) {
  const i = process.argv.indexOf('--port');
  const port = i !== -1 ? Number(process.argv[i + 1]) : 3000;
  porneste(port, { redirecturi: process.argv.includes('--redirecturi') }).then((s) => console.log(`server de test: http://localhost:${s.address().port}`));
}
