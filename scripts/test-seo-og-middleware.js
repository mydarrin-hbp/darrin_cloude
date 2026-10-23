// scripts/test-seo-og-middleware.js
// Pasul 11-S (23 oct. 2026): previzualizările la partajare (OG) din
// middleware.js, rulat în Node cu importurile înlocuite (Supabase simulat,
// @vercel/functions simulat, fetch simulat care întoarce fișierele HTML reale).
// Nimic nu ajunge la producție.
//   1. robotul Facebook pe o pagină publică cu suprascriere → HTML cu og: înlocuite (RO și EN);
//   2. fără suprascriere → HTML-ul original (next / rewrite, fără nicio modificare);
//   3. pagină care nu e publică → bariera existentă, neschimbată;
//   4. vizitator obișnuit → nicio cerere în plus (nici baza de date, nici fetch);
//   5. eroare la citirea seo_config / la fetch → HTML-ul original;
//   6. limba: ?lang= , Accept-Language, implicit RO; scurtăturile (/partener);
//      cache ≤ 5 minute; lib/seo-og.js (roboții, înlocuirea etichetelor).
// Rulare: node scripts/test-seo-og-middleware.js

const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
const { DB, supabaseAdmin, RADACINA } = sim;
sim.instaleaza();

const seoOg = require(path.join(RADACINA, 'lib/seo-og.js'));

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

// ── Stub-uri ──────────────────────────────────────────────────────────
let interogari = 0;
let faraDb = false;
const adminNumarat = Object.assign({}, supabaseAdmin, {
  from(t) { interogari++; if (faraDb) throw new Error('baza de date indisponibilă'); return supabaseAdmin.from(t); },
});
const cereriFetch = [];
let fetchCade = false;
globalThis.fetch = async (url, opt) => {
  cereriFetch.push({ url: String(url), headers: (opt && opt.headers) || {} });
  if (fetchCade) throw new Error('rețea');
  const u = new URL(String(url));
  let f = u.pathname === '/' ? 'index' : u.pathname.slice(1).replace(/\.html$/, '');
  const fisier = path.join(RADACINA, f + '.html');
  if (!fs.existsSync(fisier)) return new Response('nu există', { status: 404, headers: { 'content-type': 'text/plain' } });
  return new Response(fs.readFileSync(fisier, 'utf8'), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
};
globalThis.__stub = {
  createClient: () => adminNumarat,
  next: () => ({ tip: 'next' }),
  rewrite: (dest) => ({ tip: 'rewrite', dest: dest.toString() }),
  seoOg,
};

async function incarcaMiddleware() {
  process.env.SUPABASE_URL = 'https://abcdefgh.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cheie-test';
  let src = fs.readFileSync(path.join(RADACINA, 'middleware.js'), 'utf8');
  const inlocuiri = [
    [/import \{ createClient \} from '@supabase\/supabase-js';/, 'const { createClient } = globalThis.__stub;'],
    [/import \{ next, rewrite \} from '@vercel\/functions';/, 'const { next, rewrite } = globalThis.__stub;'],
    [/import seoOg from '\.\/lib\/seo-og\.js';/, 'const seoOg = globalThis.__stub.seoOg;'],
  ];
  inlocuiri.forEach(([re, cu]) => { if (!re.test(src)) throw new Error('importul lipsește: ' + re); src = src.replace(re, cu); });
  return (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).default;
}

const FB = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
function cerereHttp(cale, { ua = FB, lang = null, antete = {} } = {}) {
  const h = new Headers(Object.assign({ 'user-agent': ua }, lang ? { 'accept-language': lang } : {}, antete));
  return new Request('https://mydarrin.homebestpal.com' + cale, { headers: h });
}
function meta(html, cheie) {
  const re = new RegExp('<meta\\b[^>]*(?:property|name)="' + cheie.replace(/[.:]/g, '\\$&') + '"[^>]*content="([^"]*)"', 'gi');
  return [...html.matchAll(re)].map((m) => m[1]);
}

function reset() {
  DB.tabele = {
    profiles: [], accese_temporare: [],
    seo_config: [
      { id: 's1', page_path: '/despre-noi', limba: 'ro', meta_title: 'Despre noi RO', og_titlu: 'Titlu OG RO', og_descriere: 'Descriere OG RO',
        og_imagine_url: 'https://abcdefgh.supabase.co/storage/v1/object/public/seo-og/despre-noi/ro/og.jpg', og_imagine_alt: 'Echipa "My Darrin" <test>', og_imagine_latime: 1200, og_imagine_inaltime: 628 },
      { id: 's2', page_path: '/despre-noi', limba: 'en', og_titlu: 'OG title EN', og_descriere: 'OG description EN' },
      { id: 's3', page_path: '/partener', limba: 'ro', og_titlu: 'Devino partener — OG' },
    ],
  };
  DB.coloane = {};
  seoOg.golesteCache();
  interogari = 0; faraDb = false; fetchCade = false; cereriFetch.length = 0;
}

(async () => {
  const mw = await incarcaMiddleware();

  // 1. Robotul Facebook, RO (implicit) și EN
  reset();
  let r = await mw(cerereHttp('/despre-noi'));
  verifica(r instanceof Response && r.status === 200 && r.headers.get('x-myd-og') === 'ro', 'robot FB, fără limbă → răspuns OG în RO');
  let html = await r.text();
  verifica(meta(html, 'og:title').join('|') === 'Titlu OG RO', 'og:title înlocuit, o singură etichetă (' + meta(html, 'og:title').join('|') + ')');
  verifica(meta(html, 'og:description').join('|') === 'Descriere OG RO', 'og:description înlocuit');
  verifica(meta(html, 'og:image').join('|').endsWith('/seo-og/despre-noi/ro/og.jpg') && meta(html, 'og:image').length === 1, 'og:image înlocuit');
  verifica(meta(html, 'og:image:width')[0] === '1200' && meta(html, 'og:image:height')[0] === '628', 'og:image:width / height');
  verifica(meta(html, 'og:image:alt')[0] === 'Echipa &quot;My Darrin&quot; &lt;test&gt;', 'og:image:alt, cu ghilimelele și < > escapate');
  verifica(meta(html, 'og:locale')[0] === 'ro_RO', 'og:locale ro_RO');
  verifica(meta(html, 'og:url')[0] === 'https://mydarrin.homebestpal.com/despre-noi', 'og:url = adresa paginii');
  verifica(meta(html, 'twitter:card')[0] === 'summary_large_image' && meta(html, 'twitter:card').length === 1, 'twitter:card = summary_large_image');
  verifica(/<title>/i.test(html) && html.includes('</body>'), 'restul HTML-ului rămâne (titlul, corpul)');
  verifica(r.headers.get('cache-control') === 'public, max-age=300', 'cache ≤ 5 minute');
  verifica(cereriFetch.length === 1 && cereriFetch[0].headers[seoOg.ANTET_INTERN] === '1', 'HTML-ul original e cerut o dată, cu antetul intern');

  r = await mw(cerereHttp('/despre-noi?lang=en'));
  html = await r.text();
  verifica(r.headers.get('x-myd-og') === 'en' && meta(html, 'og:title')[0] === 'OG title EN' && meta(html, 'og:locale')[0] === 'en_GB', '?lang=en → og: în EN, en_GB');
  verifica(meta(html, 'og:url')[0] === 'https://mydarrin.homebestpal.com/despre-noi?lang=en', 'og:url EN păstrează ?lang=en');
  verifica(meta(html, 'og:image').length === 1 && !meta(html, 'og:image')[0].includes('seo-og'), 'EN fără imagine OG → imaginea originală a paginii rămâne');
  r = await mw(cerereHttp('/despre-noi', { lang: 'de-DE,de;q=0.9' }));
  verifica(r.headers.get('x-myd-og') === 'en', 'Accept-Language de → EN');
  r = await mw(cerereHttp('/despre-noi', { lang: 'ro-RO,ro;q=0.9,en;q=0.8' }));
  verifica(r.headers.get('x-myd-og') === 'ro', 'Accept-Language ro → RO');
  r = await mw(cerereHttp('/despre-noi?lang=bg'));
  verifica(r.headers.get('x-myd-og') === 'en', '?lang=bg → EN');

  for (const ua of ['LinkedInBot/1.0', 'Twitterbot/1.0', 'WhatsApp/2.23', 'Slackbot-LinkExpanding 1.0', 'TelegramBot (like TwitterBot)', 'Mozilla/5.0 (compatible; Discordbot/2.0)', 'Pinterest/0.2', 'Mozilla/5.0 (compatible; Bytespider)', 'Facebot']) {
    r = await mw(cerereHttp('/despre-noi', { ua }));
    verifica(r instanceof Response && r.status === 200 && r.headers.get('x-myd-og'), 'robotul ' + ua.split(/[ /]/)[0] + ' primește og:');
  }

  // Scurtătura /partener → fișierul mydarrin-devino-partener.html
  reset();
  r = await mw(cerereHttp('/partener'));
  html = r instanceof Response ? await r.text() : '';
  verifica(r instanceof Response && meta(html, 'og:title')[0] === 'Devino partener — OG' && cereriFetch[0].url.endsWith('/mydarrin-devino-partener'), 'scurtătura /partener: HTML-ul paginii reale, og: înlocuite');
  reset();
  r = await mw(cerereHttp('/mydarrin-devino-partener'));
  verifica(r instanceof Response && r.headers.get('x-myd-og') === 'ro', 'fișierul /mydarrin-devino-partener folosește suprascrierea scurtăturii /partener');

  // 2. Fără suprascriere → original
  reset();
  r = await mw(cerereHttp('/mydarrin-contact'));
  verifica(r && r.tip === 'next' && cereriFetch.length === 0, 'robot, pagină fără suprascriere → next() (HTML-ul original), fără fetch');
  r = await mw(cerereHttp('/despre-noi', { lang: 'en', antete: {} }));
  reset();
  DB.tabele.seo_config = [{ id: 'x', page_path: '/despre-noi', limba: 'ro', canonical_url: 'https://mydarrin.homebestpal.com/despre-noi' }];
  r = await mw(cerereHttp('/despre-noi'));
  verifica(r && r.tip === 'next', 'suprascriere doar cu URL canonic (fără titlu / descriere / imagine) → HTML-ul original');
  reset();
  r = await mw(cerereHttp('/partener?lang=en'));
  verifica(r && r.tip === 'rewrite' && r.dest.endsWith('/mydarrin-devino-partener?lang=en'), 'scurtătură fără suprascriere EN → rewrite-ul existent, neschimbat');

  // 3. Pagină care nu e publică → bariera existentă
  reset();
  r = await mw(cerereHttp('/mydarrin-superadmin'));
  verifica(r instanceof Response && r.status === 307 && /acces-temporar/.test(r.headers.get('location') || '') && interogari === 0 && cereriFetch.length === 0,
    'robot pe /mydarrin-superadmin → redirect la /acces-temporar, fără OG');
  r = await mw(cerereHttp('/mydarrin-dashboard-client'));
  verifica(r && r.tip === 'next' && cereriFetch.length === 0, 'robot pe o pagină nepublică (bariera generală dezactivată) → next(), fără OG');

  // 4. Vizitator obișnuit → nicio cerere în plus
  reset();
  r = await mw(cerereHttp('/despre-noi', { ua: CHROME }));
  verifica(r && r.tip === 'next' && interogari === 0 && cereriFetch.length === 0, 'vizitator Chrome → next(), 0 interogări, 0 fetch');
  r = await mw(cerereHttp('/partener', { ua: CHROME }));
  verifica(r && r.tip === 'rewrite' && interogari === 0 && cereriFetch.length === 0, 'vizitator Chrome pe /partener → rewrite, 0 interogări');
  r = await mw(cerereHttp('/despre-noi', { antete: { [seoOg.ANTET_INTERN]: '1' } }));
  verifica(r && r.tip === 'next' && interogari === 0, 'cererea internă (cu antetul) nu reintră în ramura OG');

  // 5. Erori → original
  reset();
  faraDb = true;
  r = await mw(cerereHttp('/despre-noi'));
  verifica(r && r.tip === 'next', 'eroare la citirea seo_config → HTML-ul original');
  reset();
  DB.tabele.seo_config = null;   // tabela lipsește → eroare PostgREST
  r = await mw(cerereHttp('/despre-noi'));
  verifica(r && r.tip === 'next', 'tabela / coloanele lipsesc (migrare neaplicată) → HTML-ul original');
  reset();
  fetchCade = true;
  r = await mw(cerereHttp('/despre-noi'));
  verifica(r && r.tip === 'next', 'fetch-ul HTML-ului original cade → HTML-ul original (next)');

  // 6. Cache ≤ 5 minute
  reset();
  await seoOg.citesteConfig(adminNumarat, '/despre-noi', 'ro', 0);
  await seoOg.citesteConfig(adminNumarat, '/despre-noi', 'ro', 299999);
  verifica(interogari === 1, 'cache: a doua citire în 5 minute nu interoghează');
  await seoOg.citesteConfig(adminNumarat, '/despre-noi', 'ro', 300001);
  verifica(interogari === 2, 'cache: după 5 minute se citește din nou');
  await seoOg.citesteConfig(adminNumarat, '/mydarrin-contact', 'ro', 0);
  await seoOg.citesteConfig(adminNumarat, '/mydarrin-contact', 'ro', 1000);
  verifica(interogari === 3, 'cache: și „fără suprascriere” se ține minte');

  // lib/seo-og.js
  verifica(!seoOg.esteRobot(CHROME) && !seoOg.esteRobot('') && !seoOg.esteRobot(null) && seoOg.esteRobot(FB), 'esteRobot');
  verifica(seoOg.limbaCerere(null, null) === 'ro' && seoOg.limbaCerere(null, '*') === 'ro' && seoOg.limbaCerere('ro', 'en') === 'ro' && seoOg.limbaCerere(null, 'fr-FR') === 'en', 'limbaCerere');
  const fara = '<html><body>x</body></html>';
  verifica(seoOg.inlocuiesteOg(fara, { og_titlu: 't' }, { limba: 'ro' }) === fara, 'HTML fără </head> → neschimbat');
  const h2 = seoOg.inlocuiesteOg('<head>\n<meta property="og:image:alt" content="a"/>\n<meta property="og:image" content="b"/>\n</head>', { og_titlu: 't' }, { limba: 'ro' });
  verifica(meta(h2, 'og:image')[0] === 'b' && meta(h2, 'og:image:alt')[0] === 'a', 'fără imagine nouă: og:image și og:image:alt originale rămân');

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
