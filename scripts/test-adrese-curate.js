// scripts/test-adrese-curate.js — pasul 12-U1 (19 nov. 2026): adresele curate și adresa site-ului
//
//   A. tabelul adreselor (lib/adrese-curate.js): fiecare fișier există, nicio
//      adresă nouă nu duce la o pagină internă, vercel.json e generat din tabel;
//   B. redirecționări (serverul de test, rutele ca pe Vercel): fiecare adresă
//      veche → 301 într-un singur salt spre cea nouă, cu
//      ?lang=en&utm_source=facebook&fbclid=x&profesie=instalator păstrați;
//      forma .html: 308 (cleanUrls, Vercel) + 301 — Vercel face 308 înaintea
//      oricărei reguli (verificat în producție), deci un singur salt nu e posibil;
//      adresele vechi cu parametri (catalogul, produsul) → 301 din middleware;
//   C. adresele noi → 200, fișierul corect;
//   D. middleware.js: /cont/* fără sesiune → aceeași barieră ca adresele vechi
//      (fail-closed fără configurare, rescriere spre fișier altfel); paginile
//      publice noi → rescriere; admin. → 307 spre site-ul public, ca înainte;
//   E. linkurile interne: toate paginile, toate linkurile → niciun 3xx, niciun 404;
//      în JS nu mai sunt adrese vechi; căile relative ale fișierelor statice
//      sunt de la rădăcină (paginile se deschid și pe /ajutor/cum-comand);
//   F. sitemap-ul: doar adrese noi, cu SITE_URL;
//   G. domeniul: nu apare în afara listelor din scripts/schimba-domeniu.js;
//      emailurile (lib/i18n.js) și serverul construiesc linkurile din SITE_URL;
//   H. scripts/schimba-domeniu.js pe o copie temporară: canonical, og:url,
//      hreflang, cookie-ul, fără admin.;
//   I. browser (Playwright): fiecare adresă nouă, RO și EN — dicționarul
//      paginii, limba, catalogul pe filă, produsul din cale, măsurarea și
//      butonul de partener; detectorul de română (EN) pe adresele noi = 0.
// Rulare: node scripts/test-adrese-curate.js [--fara-detector]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const RADACINA = path.join(__dirname, '..');
const A = require('../lib/adrese-curate');
const SD = require('./schimba-domeniu');
const { porneste } = require('./server-test');

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const citeste = (f) => fs.readFileSync(path.join(RADACINA, f), 'utf8');
const PARAM = 'lang=en&utm_source=facebook&fbclid=x&profesie=instalator';
const FARA_DETECTOR = process.argv.includes('--fara-detector');

const STRICTE = ['mydarrin-superadmin', 'mydarrin-backoffice-serviciu', 'mydarrin-deviz-engine', 'mydarrin-auth-schema', 'mydarrin-sync-architecture', 'mydarrin-admin-catalog'];
const PUBLICE_NOI = A.PAGINI.filter((p) => !p.nou.startsWith('/cont/')).map((p) => p.nou);
// Paginile publice rămase pe adresa lor (vezi raportul 12-U1).
const PUBLICE_VECHI = ['/', '/afla-ce-facem', '/mydarrin-marketplace', '/mydarrin-marketplace-materiale', '/mydarrin-app-mobile', '/mydarrin-cos', '/mydarrin-checkout', '/mydarrin-pitch-deck', '/confirmare-livrare', '/reset-password', '/acces-temporar', '/acord-confidentialitate'];
const PRODUSE = ['/servicii/inlocuire-calorifer', '/materiale/mat-acoperis', '/inchirieri/schela-fatada'];

(async () => {
  // ── A. Tabelul ─────────────────────────────────────────────────────────
  console.log('A. Tabelul adreselor');
  const noi = new Set();
  const vechi = new Set();
  for (const p of A.PAGINI) {
    verifica(fs.existsSync(path.join(RADACINA, p.fisier + '.html')), `${p.nou}: fișierul ${p.fisier}.html lipsește`);
    verifica(!STRICTE.includes(p.fisier), `${p.nou} duce la o pagină internă (${p.fisier})`);
    verifica(!noi.has(p.nou), `${p.nou} apare de două ori`);
    noi.add(p.nou);
    for (const v of p.vechi) { verifica(!vechi.has(v), `adresa veche ${v} apare de două ori`); vechi.add(v); }
  }
  for (const v of vechi) verifica(!noi.has(v), `${v} e și adresă nouă, și veche`);
  for (const p of A.PAGINI) {
    if (p.fisier === p.nou.slice(1)) continue; // /reclamatii: adresa de azi e deja curată
    verifica(!fs.existsSync(path.join(RADACINA, p.nou.slice(1) + '.html')), `${p.nou} are deja un fișier cu același nume (ar ocoli rescrierea)`);
  }
  const gen = require('./genereaza-adrese-vercel');
  const vj = JSON.parse(citeste('vercel.json'));
  verifica(JSON.stringify(gen.reguli()) === JSON.stringify({ rewrites: vj.rewrites, redirects: vj.redirects }), 'vercel.json nu e la zi: node scripts/genereaza-adrese-vercel.js');
  verifica(vj.redirects.filter((r) => r.statusCode === 301).every((r) => !/\.html$/.test(r.source)), 'o regulă pe /x.html (Vercel n-o folosește: cleanUrls face 308 întâi)');
  verifica(vj.redirects.some((r) => r.has && r.has[0].value === 'admin.mydarrin.homebestpal.com' && r.destination === '/mydarrin-superadmin.html'), 'regula admin. → superadmin lipsește');
  verifica(vj.cleanUrls === true && vj.trailingSlash === false, 'cleanUrls / trailingSlash schimbate');

  const srv = await porneste(0, { redirecturi: true });
  const B = 'http://localhost:' + srv.address().port;
  const cere = (u) => fetch(B + u, { redirect: 'manual' });

  // ── B. Redirecționări ──────────────────────────────────────────────────
  console.log('B. Redirecționări (parametrii păstrați)');
  const asteptatParam = new URLSearchParams(PARAM);
  const acelasiParam = (loc) => { const q = new URL(loc, B).searchParams; return [...asteptatParam].every(([k, v]) => q.get(k) === v); };
  for (const p of A.PAGINI) {
    for (const v of p.vechi) {
      const r = await cere(v + '?' + PARAM);
      const loc = r.headers.get('location') || '';
      verifica(r.status === 301 && new URL(loc, B).pathname === p.nou && acelasiParam(loc), `${v} → ${r.status} ${loc} (aștept 301 ${p.nou}?${PARAM})`);
      const t = await cere(loc);
      verifica(t.status === 200, `${v}: ținta ${loc} → ${t.status} (aștept 200, un singur salt)`);
      const h = await cere(v + '.html?' + PARAM);
      const loc1 = h.headers.get('location') || '';
      const h2 = await cere(loc1);
      const loc2 = h2.headers.get('location') || '';
      verifica(h.status === 308 && h2.status === 301 && new URL(loc2, B).pathname === p.nou && acelasiParam(loc2), `${v}.html → ${h.status} ${loc1} → ${h2.status} ${loc2}`);
    }
  }
  // Adresele vechi cu parametri (middleware).
  const CU_PARAM = [
    ['/mydarrin-catalog?' + PARAM, '/catalog'],
    ['/mydarrin-catalog?categorie=servicii&' + PARAM, '/servicii'],
    ['/mydarrin-catalog?categorie=materiale&' + PARAM, '/materiale'],
    ['/mydarrin-catalog?categorie=inchirieri&subcategorie=schele&' + PARAM, '/inchirieri', { subcategorie: 'schele' }],
    ['/mydarrin-catalog?cat=servicii&' + PARAM, '/servicii'],
    ['/mydarrin-produs?slug=inlocuire-calorifer&type=serviciu&' + PARAM, '/servicii/inlocuire-calorifer'],
    ['/mydarrin-produs?slug=inlocuire-calorifer&type=servicii&' + PARAM, '/servicii/inlocuire-calorifer'],
    ['/mydarrin-produs?slug=mat-acoperis&type=materiale&' + PARAM, '/materiale/mat-acoperis'],
    ['/mydarrin-produs?slug=schela&type=inchiriere&' + PARAM, '/inchirieri/schela'],
    ['/catalog/servicii/instalatii/inlocuire-calorifer?' + PARAM, '/servicii/inlocuire-calorifer'],
    ['/catalog/servicii/instalatii-electrice?' + PARAM, '/servicii', { subcategorie: 'instalatii-electrice' }],
    ['/inchiriere/schele?' + PARAM, '/inchirieri', { subcategorie: 'schele' }],
    ['/mydarrin-serviciu?' + PARAM, '/catalog'],
  ];
  for (const [vechiU, nou, extra] of CU_PARAM) {
    const r = await cere(vechiU);
    const loc = r.headers.get('location') || '';
    const u = new URL(loc, B);
    const extraOk = !extra || Object.entries(extra).every(([k, v]) => u.searchParams.get(k) === v);
    verifica(r.status === 301 && u.pathname === nou && acelasiParam(loc) && extraOk && !u.searchParams.has('slug') && !u.searchParams.has('categorie'), `${vechiU} → ${r.status} ${loc} (aștept 301 ${nou})`);
    const t = await cere(loc);
    verifica(t.status === 200, `${vechiU}: ținta ${loc} → ${t.status}`);
  }
  // Fără slug, pagina de produs veche rămâne (nu are o adresă nouă).
  verifica((await cere('/mydarrin-produs')).status === 200, '/mydarrin-produs fără slug → 200');

  // ── C. Adresele noi ────────────────────────────────────────────────────
  console.log('C. Adresele noi → 200, fișierul corect');
  for (const p of A.PAGINI) {
    const r = await cere(p.nou + '?' + PARAM);
    const corp = r.status === 200 ? await r.text() : '';
    verifica(r.status === 200 && corp === citeste(p.fisier + '.html'), `${p.nou} → ${r.status}, ${corp ? 'alt conținut' : 'gol'} (aștept ${p.fisier}.html)`);
  }
  for (const u of PRODUSE) {
    const r = await cere(u);
    verifica(r.status === 200 && (await r.text()) === citeste('mydarrin-produs.html'), `${u} → mydarrin-produs.html`);
  }
  verifica((await cere('/parteneri/')).status === 308, '/parteneri/ → 308 /parteneri (trailingSlash)');

  // ── D. Middleware ──────────────────────────────────────────────────────
  console.log('D. middleware.js');
  await testeMiddleware();

  // ── E. Linkurile interne ───────────────────────────────────────────────
  console.log('E. Linkurile interne');
  const PAGINI_CRAWL = [...PUBLICE_NOI, ...PUBLICE_VECHI, ...PRODUSE, ...A.PAGINI.filter((p) => p.nou.startsWith('/cont/')).map((p) => p.nou)];
  const tinte = new Map();
  const LINK = /\s(?:href|src|action)\s*=\s*(["'])([^"'\n]*)\1/g;
  for (const pg of PAGINI_CRAWL) {
    const r = await cere(pg);
    if (r.status !== 200) { verifica(false, `${pg} → ${r.status}`); continue; }
    const html = await r.text();
    let m; LINK.lastIndex = 0;
    while ((m = LINK.exec(html))) {
      let v = m[2].trim();
      if (!v || /\$\{|\{\{|' ?\+|" ?\+|^\s*$/.test(v) || /^(#|mailto:|tel:|javascript:|data:|blob:|sms:|whatsapp:)/i.test(v)) continue;
      if (v.startsWith('https://mydarrin.homebestpal.com')) v = v.slice('https://mydarrin.homebestpal.com'.length) || '/';
      if (/^(https?:)?\/\//i.test(v)) continue;
      const u = new URL(v, B + pg);
      if (u.origin !== B) continue;
      const cheie = u.pathname + u.search;
      if (!tinte.has(cheie)) tinte.set(cheie, pg);
    }
  }
  let verificate = 0;
  for (const [t, pg] of tinte) {
    const r = await cere(t);
    verificate++;
    verifica(r.status < 300 || r.status >= 400, `${pg}: linkul ${t} trece printr-o redirecționare (${r.status} → ${r.headers.get('location')})`);
    verifica(r.status !== 404, `${pg}: linkul ${t} → 404`);
  }
  console.log(`   ${PAGINI_CRAWL.length} pagini, ${verificate} linkuri interne unice`);
  verifica(verificate > 150, `prea puține linkuri găsite (${verificate})`);
  scanareJs();

  // ── F. Sitemap ─────────────────────────────────────────────────────────
  console.log('F. Sitemap');
  await testSitemap();

  // ── G. Domeniul și SITE_URL ────────────────────────────────────────────
  console.log('G. Domeniul și SITE_URL');
  testDomeniu();

  // ── H. schimba-domeniu.js pe o copie ───────────────────────────────────
  console.log('H. scripts/schimba-domeniu.js pe o copie temporară');
  testSchimbaDomeniu();

  // ── I. Browser ─────────────────────────────────────────────────────────
  let pw = null;
  try { pw = require('playwright'); } catch (e) { console.log('  (Playwright lipsește — partea I sărită)'); }
  if (pw) {
    console.log('I. Browser: adresele noi, RO și EN');
    const srvFara = await porneste(0);
    await testBrowser(pw, B, 'http://localhost:' + srvFara.address().port);
    srvFara.close();
    if (!FARA_DETECTOR) {
      console.log('I2. Detectorul de română (EN) pe adresele noi');
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'adrese-curate-'));
      const pagini = [...PUBLICE_NOI, '/servicii/inlocuire-calorifer'];
      // Asincron: serverul de test rulează în acest proces (execFileSync l-ar bloca).
      await new Promise((gata) => require('child_process').execFile(process.execPath, [path.join(__dirname, 'detector-ro.js'), '--base', B, '--out', out, '--latimi', '390,1366', ...pagini], { timeout: 1500000, maxBuffer: 64 * 1024 * 1024 }, () => gata()));
      const rez = JSON.parse(fs.readFileSync(path.join(out, 'detector-en.json'), 'utf8'));
      verifica(rez.length === pagini.length * 2, `detectorul a deschis ${rez.length} din ${pagini.length * 2}`);
      for (const r of rez) {
        const unice = [...new Set((r.gasite || []).map((g) => g.text))];
        verifica(r.randata && !unice.length, `${r.pg} ${r.w}px: ${r.randata ? unice.length + ' texte în română (ex.: ' + unice.slice(0, 3).join(' | ') + ')' : 'nerandată'}`);
      }
      console.log(`   ${rez.length} deschideri, ${rez.filter((r) => r.randata && !(r.gasite || []).length).length} fără română`);
    }
  }

  srv.close();
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// ── D ────────────────────────────────────────────────────────────────────
async function incarcaMiddleware(eticheta) {
  let src = citeste('middleware.js');
  globalThis.__adreseCurate = A;
  globalThis.__adresaSite = require('../lib/adresa-site.js');
  const inlocuiri = [
    [/import \{ createClient \} from '@supabase\/supabase-js';/, 'const { createClient } = globalThis.__stub;'],
    [/import \{ next, rewrite \} from '@vercel\/functions';/, 'const { next, rewrite } = globalThis.__stub;'],
    [/import seoOg from '\.\/lib\/seo-og\.js';/, 'const seoOg = globalThis.__stub.seoOg;'],
    [/import adreseCurate from '\.\/lib\/adrese-curate\.js';/, 'const adreseCurate = globalThis.__adreseCurate;'],
    [/import adresaSite from '\.\/lib\/adresa-site\.js';/, 'const adresaSite = globalThis.__adresaSite;'],
  ];
  inlocuiri.forEach(([re, cu]) => { if (!re.test(src)) throw new Error('importul lipsește: ' + re); src = src.replace(re, cu); });
  src += '\n// ' + eticheta;
  return (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).default;
}

async function testeMiddleware() {
  const PUBLIC = 'mydarrin.homebestpal.com';
  const ADMIN = 'admin.mydarrin.homebestpal.com';
  let rescrieriArunca = false;
  globalThis.__stub = {
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: { status: 403 } }) }, from() { const b = { select: () => b, eq: () => b, maybeSingle: () => b, then: (r) => Promise.resolve({ data: null, error: null }).then(r) }; return b; } }),
    next: () => ({ tip: 'next' }),
    rewrite: (d) => { if (rescrieriArunca) throw new Error('rewrite'); return { tip: 'rewrite', dest: d.toString() }; },
    seoOg: require('../lib/seo-og.js'),
  };
  const consoleError = console.error, consoleLog = console.log;
  const tacut = () => { console.error = () => {}; console.log = (...a) => { if (!/^\[middleware/.test(String(a[0]))) consoleLog(...a); }; };
  const vorbeste = () => { console.error = consoleError; console.log = consoleLog; };
  const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
  const cerere = (cale, host = PUBLIC, antete = {}) => new Request(`https://${host}${cale}`, { headers: new Headers(Object.assign({ 'user-agent': CHROME, host }, antete)) });
  const descrie = (r) => (r instanceof Response ? r.status + ' ' + (r.headers.get('location') || '') : JSON.stringify(r));

  // Fără configurare Supabase: fail-closed, la fel pe adresa nouă și pe cea veche.
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  tacut();
  let mw = await incarcaMiddleware('fara-config');
  const CONT = A.PAGINI.filter((p) => p.nou.startsWith('/cont/'));
  for (const p of CONT) {
    const rNou = await mw(cerere(p.nou));
    const rVechi = await mw(cerere('/' + p.fisier));
    vorbeste();
    verifica(rNou instanceof Response && rNou.status === 307 && /\/acces-temporar$/.test(rNou.headers.get('location')), `${p.nou} fără configurare → ${descrie(rNou)} (aștept 307 /acces-temporar)`);
    verifica(rVechi instanceof Response && rVechi.status === rNou.status && rVechi.headers.get('location') === rNou.headers.get('location'), `${p.nou}: altă barieră decât /${p.fisier} (${descrie(rVechi)})`);
    tacut();
  }
  vorbeste();

  // Cu configurare, fără sesiune.
  process.env.SUPABASE_URL = 'https://abcdefgh.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cheie-test-simulata';
  tacut();
  mw = await incarcaMiddleware('cu-config');
  const rezultate = [];
  for (const p of CONT) rezultate.push([p, await mw(cerere(p.nou + '?tab=comenzi&lang=en')), await mw(cerere('/' + p.fisier))]);
  rescrieriArunca = true;
  const rArunca = await mw(cerere('/cont/comenzi'));
  rescrieriArunca = false;
  const publice = [];
  for (const u of [...PUBLICE_NOI, ...PRODUSE]) publice.push([u, await mw(cerere(u + '?lang=en'))]);
  const cuParam = [];
  for (const [u, t] of [['/mydarrin-produs?slug=mat-acoperis&type=materiale&lang=en', '/materiale/mat-acoperis?lang=en'], ['/mydarrin-catalog?categorie=inchirieri&fbclid=x', '/inchirieri?fbclid=x'], ['/mydarrin-catalog', '/catalog'], ['/catalog/servicii/instalatii/inlocuire-calorifer', '/servicii/inlocuire-calorifer']]) {
    cuParam.push([u, t, await mw(cerere(u))]);
  }
  const ogIntern = await mw(cerere('/mydarrin-catalog?categorie=servicii', PUBLIC, { 'x-myd-og-intern': '1' }));
  const adminCont = await mw(cerere('/cont/comenzi?x=1', ADMIN));
  const adminVechi = await mw(cerere('/mydarrin-dashboard-client?x=1', ADMIN));
  const adminSuper = await mw(cerere('/mydarrin-superadmin', ADMIN));
  vorbeste();
  for (const [p, rNou, rVechi] of rezultate) {
    verifica(rNou && rNou.tip === 'rewrite' && rNou.dest === `https://${PUBLIC}/${p.fisier}?tab=comenzi&lang=en`, `${p.nou} fără sesiune → ${descrie(rNou)} (aștept rescriere spre /${p.fisier}, ca adresa veche)`);
    verifica(rVechi && rVechi.tip === 'next', `/${p.fisier} fără sesiune → ${descrie(rVechi)} (neschimbat: next)`);
  }
  verifica(rArunca instanceof Response && rArunca.status === 307 && /acces-temporar/.test(rArunca.headers.get('location')), `/cont/comenzi cu o eroare neprevăzută → ${descrie(rArunca)} (fail-closed)`);
  for (const [u, r] of publice) {
    const asteptat = A.rescriere(u);
    verifica(r && r.tip === 'rewrite' && new URL(r.dest).pathname === '/' + asteptat.fisier && new URL(r.dest).searchParams.get('lang') === 'en', `${u} → ${descrie(r)} (aștept rescriere spre /${asteptat.fisier})`);
  }
  for (const [u, t, r] of cuParam) verifica(r instanceof Response && r.status === 301 && r.headers.get('location') === t, `${u} → ${descrie(r)} (aștept 301 ${t})`);
  verifica(ogIntern && ogIntern.tip === 'next', 'cererea internă a robotului OG pe /mydarrin-catalog nu e redirecționată');
  verifica(adminCont instanceof Response && adminCont.status === 307 && adminCont.headers.get('location') === `https://${PUBLIC}/cont/comenzi?x=1`, `admin. /cont/comenzi → ${descrie(adminCont)} (307 spre site-ul public, ca adresele vechi)`);
  verifica(adminVechi instanceof Response && adminVechi.status === 307 && adminVechi.headers.get('location') === `https://${PUBLIC}/mydarrin-dashboard-client?x=1`, `admin. /mydarrin-dashboard-client → ${descrie(adminVechi)} (neschimbat)`);
  verifica(adminSuper instanceof Response && adminSuper.status === 307 && /acces-temporar/.test(adminSuper.headers.get('location')), `admin. /mydarrin-superadmin fără sesiune → ${descrie(adminSuper)} (bariera strictă, neschimbată)`);
}

// ── E: JS ────────────────────────────────────────────────────────────────
function scanareJs() {
  const fisiere = execSync('git ls-files', { cwd: RADACINA, encoding: 'utf8' }).split('\n')
    .filter((f) => /\.(html|js)$/.test(f) && !/^(scripts|docs|api|i18n|lib\/vendor)\//.test(f) && !['middleware.js', 'lib/adrese-curate.js', 'lib/seo-pagini.js'].includes(f));
  // Locuri unde numele vechi rămâne intenționat (nu e un link):
  const PERMISE = [
    /data-pagina="/, // fișierul paginii (dicționarul)
    /<option value="\/[a-z-]+\.html">/, // superadmin: ruta accesului temporar = fișierul
    /origin \+ '\/reset-password\.html'/, // linkul din emailul de resetare (lista Supabase)
    /'\/mydarrin-(dashboard-client|dashboard-partener|panou-investitor|rolurile-mele)': '\/cont\//, // harta fișier → adresă (destinatie-rol)
  ];
  const SIR = /(['"`])(\/?[A-Za-z0-9_-]+(?:\.html)?(?:[?#][^'"`\s<>]*)?)\1/g;
  const gasite = [];
  for (const f of fisiere) {
    const text = citeste(f);
    const linii = text.split('\n');
    linii.forEach((linie, i) => {
      if (/^\s*(\/\/|\*|<!--)/.test(linie) || PERMISE.some((re) => re.test(linie))) return;
      let m; SIR.lastIndex = 0;
      while ((m = SIR.exec(linie))) {
        const v = m[2];
        if (!/\.html/.test(v) && !v.startsWith('/')) continue;
        const inainte = linie.slice(Math.max(0, m.index - 30), m.index);
        if (/(includes|indexOf|test|match|endsWith|startsWith)\(\s*$|[!=]==?\s*$/.test(inainte)) continue;
        if (A.linkNou(v) !== null) gasite.push(`${f}:${i + 1} ${v} → ${A.linkNou(v)}`);
        else if (/^[a-z0-9-]+\.html/i.test(v) && fs.existsSync(path.join(RADACINA, v.split(/[?#]/)[0]))) gasite.push(`${f}:${i + 1} ${v} (relativ, .html)`);
      }
    });
  }
  verifica(!gasite.length, `adrese vechi în JS / HTML (${gasite.length}):\n      ` + gasite.slice(0, 15).join('\n      '));
  // Căile relative ale fișierelor statice (ar cădea pe /ajutor/…, /parteneri/…, /cont/…).
  const relative = [];
  for (const f of fisiere.filter((x) => /\.html$/.test(x))) {
    const text = citeste(f);
    let m; const re = /\s(?:src|href)\s*=\s*"([^"]*)"/g;
    while ((m = re.exec(text))) {
      const v = m[1];
      if (!v || /^([a-z][a-z0-9+.-]*:|\/|#|\?|\$\{|\{\{)/i.test(v)) continue;
      const fara = v.split(/[?#]/)[0];
      if (fs.existsSync(path.join(RADACINA, fara)) || /\.(html|js|css|png|svg|jpe?g|webp|ico|json)$/.test(fara)) relative.push(`${f}: ${v}`);
    }
  }
  verifica(!relative.length, `căi relative (${relative.length}): ${relative.slice(0, 8).join(' | ')}`);
}

// ── F ────────────────────────────────────────────────────────────────────
async function testSitemap() {
  process.env.SITE_URL = 'https://exemplu-test.ro/';
  const cale = require.resolve('../lib/supabaseAdmin');
  require.cache[cale] = { id: cale, filename: cale, loaded: true, exports: { supabaseAdmin: { from: () => ({ select: () => ({ not: async () => ({ data: [] }) }) }) } } };
  delete require.cache[require.resolve('../api/public/sitemap.xml.js')];
  const handler = require('../api/public/sitemap.xml.js');
  let corp = '';
  const res = { setHeader() {}, status() { return this; }, send(x) { corp = x; return this; } };
  await handler({ method: 'GET' }, res);
  const locuri = [...corp.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  verifica(locuri.length >= 30, `sitemap: ${locuri.length} adrese`);
  for (const l of locuri) {
    const u = new URL(l);
    verifica(u.origin === 'https://exemplu-test.ro', `sitemap: ${l} nu folosește SITE_URL`);
    verifica(A.redirect(u.pathname, u.search) === null && A.linkNou(u.pathname) === null, `sitemap: ${l} e o adresă veche`);
    verifica(!/\.html$|\?/.test(l), `sitemap: ${l} are .html sau parametri`);
  }
  for (const n of ['/parteneri', '/parteneri/inscriere', '/parteneri/servicii', '/parteneri/curieri', '/ajutor/cum-comand', '/servicii', '/catalog']) verifica(locuri.includes('https://exemplu-test.ro' + n), `sitemap: lipsește ${n}`);
  verifica(!locuri.some((l) => /\/cont\//.test(l)), 'sitemap: paginile de cont nu se indexează');
  // Panoul SEO: aceeași listă (lib/seo-pagini.js).
  const SP = require('../lib/seo-pagini');
  for (const n of ['/parteneri', '/parteneri/inscriere', '/parteneri/servicii', '/parteneri/materiale', '/parteneri/inchirieri', '/parteneri/curieri', '/parteneri/asigurari', '/parteneri/intrebari']) verifica(SP.esteCunoscuta(n), `panoul SEO: lipsește ${n}`);
  // Campaniile mutate pe adresa nouă își păstrează materialele încărcate pe cea veche.
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://abcdefgh.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'cheie-test-simulata';
  const { apartineCampaniei, prefixMedia } = require('../api/admin/seo-campanii.js').intern;
  const camp = { id: '0b7c2a10-5d3e-4f6a-9b1c-2d3e4f5a6b7c', limba: 'ro', page_path: '/parteneri' };
  verifica(apartineCampaniei(camp, `partener/ro/${camp.id}/imagine_link_1_91.jpg`), 'campania pe /parteneri: materialul încărcat pe /partener nu mai e recunoscut');
  verifica(apartineCampaniei(camp, prefixMedia(camp) + 'video_vertical.mp4') && prefixMedia(camp) === `parteneri/ro/${camp.id}/`, 'încărcările noi: segmentul adresei curente');
  verifica(!apartineCampaniei(camp, `partener/en/${camp.id}/x.jpg`) && !apartineCampaniei(camp, `partener/ro/alt-id/x.jpg`) && !apartineCampaniei(camp, `../ro/${camp.id}/x.jpg`), 'materialul altei campanii / limbi / o cale cu .. e respins');
  verifica(SP.caleSeo('/cum-devii-curier-de-cartier.html') === '/parteneri/curieri' && SP.caleSeo('/curier-cartier') === '/parteneri/curieri' && SP.caleSeo('/parteneri/curieri') === '/parteneri/curieri', 'caleSeo: fișierul și adresele vechi → adresa nouă');
  delete process.env.SITE_URL;
}

// ── G ────────────────────────────────────────────────────────────────────
function testDomeniu() {
  // Aparițiile domeniului public, în afara listelor permise.
  const nepermise = [];
  let total = 0;
  for (const rel of SD.fisiereText(RADACINA)) {
    const text = fs.readFileSync(path.join(RADACINA, rel), 'utf8');
    if (!text.includes(SD.DOMENIU_VECHI)) continue;
    for (const a of SD.aparitii(rel, text)) { total++; if (!a.permisa) nepermise.push(rel + ':' + a.linie); }
  }
  verifica(!nepermise.length, `domeniul vechi în afara listelor permise (${nepermise.length}): ${nepermise.slice(0, 10).join(', ')}`);
  console.log(`   ${total} apariții, toate în locurile de mutat cu scripts/schimba-domeniu.js`);
  // Codul nu redirecționează spre domeniul scris în fișier.
  const redir = execSync('git ls-files "*.js" "*.html"', { cwd: RADACINA, encoding: 'utf8' }).split('\n').filter((f) => f && !/^(scripts|docs)\//.test(f))
    .filter((f) => /location\.(href|replace|assign)\s*[=(]\s*['"`]https:\/\/mydarrin\.homebestpal\.com/.test(citeste(f)));
  verifica(!redir.length, 'redirecționări spre domeniul scris în cod: ' + redir.join(', '));
  // Serverul: nicio adresă absolută a site-ului în afara lib/adresa-site.js.
  const server = execSync('git ls-files "api/*.js" "api/**/*.js" "lib/*.js"', { cwd: RADACINA, encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter((f) => !['lib/adresa-site.js', 'lib/supabaseClient.js', 'lib/seo-campanii.js'].includes(f))
    .filter((f) => /(?<![A-Za-z0-9-])(?<!admin\.)(?<!api\.)mydarrin\.homebestpal\.com/.test(citeste(f).replace(/\/\/.*$/gm, '')));
  verifica(!server.length, 'adresa site-ului scrisă în codul de server: ' + server.join(', '));

  // Emailurile: linkurile din SITE_URL.
  process.env.SITE_URL = 'https://exemplu-test.ro';
  for (const k of Object.keys(require.cache)) if (/[\\/]lib[\\/](i18n|adresa-site|notificari-comanda)\.js$/.test(k)) delete require.cache[k];
  const I = require('../lib/i18n');
  const emailuri = [
    I.renderEmailBunVenitClient('ro', { nume: 'Ana' }), I.renderEmailBunVenitClient('en', { nume: 'Ana' }),
    I.renderEmailComandaConfirmata('ro', { nume: 'Ana', numarComanda: 'C1', comandaId: 'id-1', numarProforma: 'P1' }),
    I.renderEmailComandaConfirmata('en', { nume: 'Ana', numarComanda: 'C1', comandaId: 'id-1', numarProforma: 'P1' }),
    I.renderEmailInvestitorBunVenit('ro'), I.renderEmailInvestitorBunVenit('en'),
    I.renderEmailKycDecizie('ro', { nume: 'Ana', aprobat: true }), I.renderEmailKycDecizie('en', { nume: 'Ana', aprobat: false, motiv_ro: 'x', motiv_en: 'x' }),
    I.renderEmailCosAbandonat('ro'), I.renderEmailCosAbandonat('en'),
  ];
  let linkuri = 0;
  emailuri.forEach((e, i) => {
    const html = e.html || '';
    verifica(!html.includes('mydarrin.homebestpal.com'), `emailul ${i}: domeniul scris direct`);
    for (const m of html.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)) {
      linkuri++;
      const u = new URL(m[1].replace(/&amp;/g, '&'));
      verifica(u.origin === 'https://exemplu-test.ro', `emailul ${i}: ${m[1]} nu vine din SITE_URL`);
      verifica(A.redirect(u.pathname, u.search) === null && A.linkNou(u.pathname) === null, `emailul ${i}: ${m[1]} e o adresă veche`);
    }
  });
  verifica(linkuri >= 10, `emailuri: ${linkuri} linkuri verificate`);
  const html = emailuri.map((e) => e.html).join('');
  verifica(html.includes('https://exemplu-test.ro/cont/comenzi') && html.includes('https://exemplu-test.ro/catalog'), 'emailuri: /cont/comenzi și /catalog');
  verifica(require('../lib/adresa-site').siteUrl() === 'https://exemplu-test.ro', 'adresa-site citește SITE_URL');
  process.env.SITE_URL = 'nu e o adresă';
  verifica(require('../lib/adresa-site').siteUrl() === 'https://mydarrin.homebestpal.com', 'o valoare greșită în SITE_URL → adresa de azi');
  delete process.env.SITE_URL;
  verifica(require('../lib/adresa-site').siteUrl() === 'https://mydarrin.homebestpal.com', 'fără SITE_URL → adresa de azi');
}

// ── H ────────────────────────────────────────────────────────────────────
function testSchimbaDomeniu() {
  const copie = fs.mkdtempSync(path.join(os.tmpdir(), 'schimba-domeniu-'));
  const FISIERE = ['cum-comanzi.html', 'index.html', 'mydarrin-termeni.html', 'i18n/en/mydarrin-termeni.json', 'robots.txt', 'lib/supabaseClient.js', 'lib/adresa-site.js', 'mydarrin-superadmin.html', 'vercel.json', 'scripts/test-domeniu-admin.js', 'README.md', 'mydarrin-catalog.html'];
  for (const f of FISIERE) {
    fs.mkdirSync(path.join(copie, path.dirname(f)), { recursive: true });
    fs.copyFileSync(path.join(RADACINA, f), path.join(copie, f));
  }
  const r = SD.ruleaza(copie, 'mydarrin.com');
  const c = (f) => fs.readFileSync(path.join(copie, f), 'utf8');
  verifica(r.nepermise.length === 0 && r.inlocuite > 20, `copie: ${r.inlocuite} înlocuite, ${r.nepermise.length} nepermise`);
  const cum = c('cum-comanzi.html');
  verifica(cum.includes('<link rel="alternate" hreflang="en" href="https://mydarrin.com/ajutor/cum-comand?lang=en"/>') && cum.includes('hreflang="x-default" href="https://mydarrin.com/ajutor/cum-comand"'), 'hreflang pe domeniul nou');
  verifica(cum.includes('<meta property="og:url" content="https://mydarrin.com/ajutor/cum-comand"/>'), 'og:url pe domeniul nou');
  verifica(!cum.includes('homebestpal.com/') || !/mydarrin\.homebestpal\.com/.test(cum), 'cum-comanzi: domeniul vechi a rămas');
  const term = c('mydarrin-termeni.html');
  verifica(/<link rel="canonical" href="https:\/\/mydarrin\.com\/termeni"\/>/.test(term), 'canonical pe domeniul nou');
  verifica(term.includes('accesibil la mydarrin.com') && c('i18n/en/mydarrin-termeni.json').includes('accesibil la mydarrin.com') && c('i18n/en/mydarrin-termeni.json').includes('accessible at mydarrin.com'), 'textul și traducerea lui, la fel');
  verifica(c('lib/supabaseClient.js').includes("const COOKIE_DOMAIN = '.mydarrin.com';"), 'domeniul cookie-urilor');
  verifica(c('robots.txt').includes('Sitemap: https://mydarrin.com/api/public/sitemap.xml'), 'robots.txt');
  verifica(c('lib/adresa-site.js').includes("'https://mydarrin.com'"), 'adresa implicită din lib/adresa-site.js');
  verifica(c('index.html').includes('https://admin.mydarrin.homebestpal.com') && c('mydarrin-superadmin.html').includes('https://mydarrin.com/catalog'), 'admin. rămâne; superadmin trimite la site-ul public nou');
  for (const f of ['vercel.json', 'scripts/test-domeniu-admin.js', 'README.md']) verifica(c(f) === citeste(f), `${f} nu se atinge`);
  verifica(SD.ruleaza(copie, 'mydarrin.com').inlocuite === 0, 'a doua rulare nu mai găsește nimic');
  fs.rmSync(copie, { recursive: true, force: true });
  // Pe repo, scriptul în modul --verifica: nicio apariție în afara listelor.
  const v = SD.ruleaza(RADACINA, 'mydarrin.com', { verifica: true });
  verifica(v.nepermise.length === 0 && v.inlocuite > 100, `repo (--verifica): ${v.inlocuite} de înlocuit, ${v.nepermise.length} nepermise`);
}

// ── I ────────────────────────────────────────────────────────────────────
async function testBrowser(pw, B, B_FARA_REDIRECT) {
  const browser = await pw.chromium.launch();
  const context = async (lang, extra) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(([l, x]) => {
      try {
        localStorage.setItem('myd_lang_v1', l);
        localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: !!x, marketing: false, data: new Date().toISOString(), versiune: 2 }));
      } catch (e) {}
    }, [lang, !!(extra && extra.acord)]);
    await ctx.route(/supabase\.co\/|ipapi\.co|nominatim|googletagmanager|google-analytics|connect\.facebook|analytics\.tiktok|snap\.licdn/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    return ctx;
  };
  for (const lang of ['ro', 'en']) {
    const ctx = await context(lang);
    // Paginile de cont, fără sesiune, trimit la autentificare: la fel pe adresa nouă și pe cea veche.
    const deschide = async (u, baza) => {
      const pg = await ctx.newPage();
      const cereri = [];
      pg.on('request', (r) => cereri.push(new URL(r.url()).pathname));
      await pg.goto((baza || B) + u, { waitUntil: 'load' }).catch(() => null);
      await pg.waitForTimeout(2500);
      const final = await pg.evaluate(() => location.pathname + location.search).catch(() => '?');
      await pg.close();
      return { final, cereri };
    };
    for (const p of A.PAGINI.filter((x) => x.nou.startsWith('/cont/'))) {
      const nou = await deschide(p.nou);
      const vechiP = await deschide('/' + p.fisier + '.html', B_FARA_REDIRECT);
      verifica(nou.final === vechiP.final, `${lang} ${p.nou} fără sesiune → ${nou.final}; /${p.fisier}.html → ${vechiP.final}`);
      const dict = '/i18n/en/' + p.fisier + '.json';
      if (lang === 'en') verifica(nou.cereri.includes(dict) === vechiP.cereri.includes(dict), `en ${p.nou}: dicționarul ${dict} (nou: ${nou.cereri.includes(dict)}, vechi: ${vechiP.cereri.includes(dict)})`);
      verifica(!nou.cereri.some((c) => /^\/cont\/[^/]+\.(js|css|json)$/.test(c)), `${lang} ${p.nou}: un fișier static cerut relativ`);
    }
    for (const p of A.PAGINI.filter((x) => !x.nou.startsWith('/cont/'))) {
      const pg = await ctx.newPage();
      const cereri = [];
      pg.on('request', (r) => cereri.push(new URL(r.url()).pathname));
      const rasp = await pg.goto(B + p.nou, { waitUntil: 'load' }).catch(() => null);
      await pg.waitForFunction(() => window.MYD_I18N && !document.documentElement.classList.contains('myd-i18n-pending'), null, { timeout: 15000 }).catch(() => {});
      await pg.waitForTimeout(300);
      const s = await pg.evaluate(() => ({
        lang: document.documentElement.lang,
        pagina: (document.querySelector('script[src*="i18n-loader"][data-pagina]') || {}).getAttribute ? document.querySelector('script[src*="i18n-loader"][data-pagina]').getAttribute('data-pagina') : null,
        i18n: window.MYD_I18N ? window.MYD_I18N.lang : null,
      })).catch(() => ({}));
      verifica(rasp && rasp.status() === 200, `${lang} ${p.nou} → ${rasp && rasp.status()}`);
      verifica(s.pagina === p.fisier, `${lang} ${p.nou}: pagina ${s.pagina} (aștept ${p.fisier})`);
      verifica(s.i18n === lang && String(s.lang).slice(0, 2) === lang, `${lang} ${p.nou}: limba ${s.i18n} / lang=${s.lang}`);
      if (lang === 'en' && fs.existsSync(path.join(RADACINA, 'i18n/en/' + p.fisier + '.json'))) {
        verifica(cereri.includes('/i18n/en/' + p.fisier + '.json'), `en ${p.nou}: dicționarul i18n/en/${p.fisier}.json nu s-a încărcat`);
      }
      verifica(!cereri.some((c) => /^\/(ajutor|parteneri|cont|servicii|materiale|inchirieri)\/[^/]+\.(js|css|json)$/.test(c)), `${lang} ${p.nou}: un fișier static cerut relativ (${cereri.filter((c) => /^\/(ajutor|parteneri|cont)\/.+\.(js|css)$/.test(c)).join(', ')})`);
      await pg.close();
    }
    // Catalogul pe filă și produsul din cale.
    for (const [u, fila] of [['/servicii', 'servicii'], ['/materiale', 'materiale'], ['/inchirieri', 'inchiriere'], ['/catalog', 'servicii']]) {
      const pg = await ctx.newPage();
      await pg.goto(B + u, { waitUntil: 'load' });
      await pg.waitForTimeout(800);
      const t = await pg.evaluate(() => (typeof activeTab !== 'undefined' ? activeTab : null));
      verifica(t === fila, `${lang} ${u}: fila ${t} (aștept ${fila})`);
      await pg.close();
    }
    {
      const pg = await ctx.newPage();
      await pg.goto(B + '/materiale', { waitUntil: 'load' });
      await pg.waitForTimeout(600);
      await pg.evaluate(() => { if (typeof switchMainTab === 'function') switchMainTab('inchiriere'); });
      await pg.waitForTimeout(300);
      const adresa = await pg.evaluate(() => location.pathname + location.search);
      verifica(adresa === '/inchirieri', `${lang}: schimbarea filei scrie adresa curată (${adresa})`);
      await pg.close();
    }
    {
      const pg = await ctx.newPage();
      await pg.goto(B + '/servicii/inlocuire-calorifer?lang=' + lang, { waitUntil: 'load' });
      await pg.waitForTimeout(1200);
      const slug = await pg.evaluate(() => (typeof S !== 'undefined' ? S.slug : null));
      verifica(slug === 'inlocuire-calorifer', `${lang} /servicii/inlocuire-calorifer: produsul ${slug}`);
      await pg.close();
    }
    // Butonul de partener, pe /parteneri/servicii: înscrierea pentru tipul paginii.
    {
      const pg = await ctx.newPage();
      await pg.goto(B + '/parteneri/servicii', { waitUntil: 'load' });
      await pg.waitForTimeout(2500);
      const href = await pg.evaluate(() => Array.from(document.querySelectorAll('[data-cta-partener]')).map((a) => a.getAttribute('href')));
      verifica(href.length && href.some((h) => h === '/parteneri/inscriere?categorie=servicii'), `${lang} /parteneri/servicii: butonul de partener → ${href.join(', ')}`);
      const nume = await pg.evaluate(() => document.body.innerText);
      verifica(!/Devino Partener|Become a Partner\b/.test(nume), `${lang}: „Devino Partener” / „Become a Partner” cu majusculă a rămas`);
      await pg.close();
    }
    await ctx.close();
  }
  // Măsurarea: tipul paginii de partener pe adresele noi.
  const ctx = await context('en', { acord: true });
  for (const [u, tip] of [['/parteneri/curieri', 'courier'], ['/parteneri/servicii', 'services'], ['/parteneri', 'general'], ['/parteneri/asigurari', 'insurance']]) {
    const pg = await ctx.newPage();
    await pg.goto(B + u + '?utm_source=facebook', { waitUntil: 'load' });
    await pg.waitForFunction(() => !!window.MYD_MASURARE, null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(500);
    const j = await pg.evaluate(() => (window.MYD_MASURARE ? window.MYD_MASURARE.jurnal.slice() : []));
    const l = j.find((e) => e.nume === 'partner_landing_view');
    verifica(l && l.parametri.partner_type === tip && l.parametri.page === u, `${u}: partner_landing_view ${JSON.stringify(l && l.parametri)} (aștept ${tip})`);
    await pg.close();
  }
  {
    const pg = await ctx.newPage();
    await pg.goto(B + '/servicii/inlocuire-calorifer', { waitUntil: 'load' });
    await pg.waitForFunction(() => !!window.MYD_MASURARE, null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(500);
    const j = await pg.evaluate(() => (window.MYD_MASURARE ? window.MYD_MASURARE.jurnal.slice() : []));
    const v = j.find((e) => e.nume === 'service_view');
    verifica(v && v.parametri.item_type === 'service', `/servicii/<slug>: service_view ${JSON.stringify(v && v.parametri)}`);
    await pg.close();
  }
  await ctx.close();
  await browser.close();
}
