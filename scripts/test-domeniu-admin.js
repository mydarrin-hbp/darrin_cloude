// scripts/test-domeniu-admin.js
// Pasul 11-A4 (15 nov. 2026): domeniul admin.mydarrin.homebestpal.com servește
// doar backoffice-ul; orice altă pagină HTML → 307 spre site-ul public, cu
// aceeași cale și același query. middleware.js e rulat în Node cu importurile
// înlocuite (Supabase și @vercel/functions simulate) — nicio cerere nu iese din proces.
//   A. admin.: paginile publice → 307 spre https://mydarrin.homebestpal.com, fără Supabase;
//   B. admin.: „/” → superadmin; paginile interne trec prin bariera din 11-S3;
//      paginile de acces, /api/*, fișierele statice → nu sunt redirecționate;
//   C. domeniul public, *.vercel.app, localhost: nimic nu se schimbă;
//   D. paginile interne: niciun link relativ spre o pagină publică;
//      „Pagina publică investitori ↗” are domeniul public și target="_blank";
//   E. vercel.json: redirectul „/” de pe admin. rămâne.
// Rulare: node scripts/test-domeniu-admin.js

const fs = require('fs');
const path = require('path');

const RADACINA = path.join(__dirname, '..');
const citeste = (f) => fs.readFileSync(path.join(RADACINA, f), 'utf8');
let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

const REF = 'abcdefgh';
const PREFIX = `sb-${REF}-auth-token`;
const SUPER = 'cristianpopaban@gmail.com';
process.env.SUPABASE_URL = `https://${REF}.supabase.co`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'cheie-test-simulata';
delete process.env.SUPERADMIN_EMAIL;

const ADMIN = 'admin.mydarrin.homebestpal.com';
const PUBLIC = 'https://mydarrin.homebestpal.com';

// Loguri tăcute (middleware-ul scrie motivele respingerii).
const consoleError = console.error;
console.error = () => {};
const consoleLog = console.log;
console.log = (...a) => { if (!/^\[middleware/.test(String(a[0]))) consoleLog(...a); };

// ── Supabase simulat ────────────────────────────────────────────────────
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const tokenSuper = `${b64u({ alg: 'HS256' })}.${b64u({ sub: 'u-super', exp: Math.floor(Date.now() / 1000) + 3600 })}.semnatura-test`;
const cookieSuper = `${PREFIX}.0=${encodeURIComponent(JSON.stringify({ access_token: tokenSuper }))}`;
const apeluri = { createClient: 0, getUser: 0 };
const clientSimulat = {
  auth: {
    async getUser(t) {
      apeluri.getUser++;
      return t === tokenSuper ? { data: { user: { id: 'u-super', email: SUPER } }, error: null } : { data: { user: null }, error: { status: 403 } };
    },
  },
  from() {
    const b = { select: () => b, eq: () => b, maybeSingle: () => b, then: (r) => Promise.resolve({ data: { roles: ['superadmin'] }, error: null }).then(r) };
    return b;
  },
};
globalThis.__stub = {
  createClient: () => { apeluri.createClient++; return clientSimulat; },
  next: () => ({ tip: 'next' }),
  rewrite: (dest) => ({ tip: 'rewrite', dest: dest.toString() }),
  seoOg: require(path.join(RADACINA, 'lib/seo-og.js')),
};

async function incarcaMiddleware() {
  let src = citeste('middleware.js');
  globalThis.__adreseCurate = require('../lib/adrese-curate.js');
  globalThis.__adresaSite = require('../lib/adresa-site.js');
  const inlocuiri = [
    [/import \{ createClient \} from '@supabase\/supabase-js';/, 'const { createClient } = globalThis.__stub;'],
    [/import \{ next, rewrite \} from '@vercel\/functions';/, 'const { next, rewrite } = globalThis.__stub;'],
    [/import seoOg from '\.\/lib\/seo-og\.js';/, 'const seoOg = globalThis.__stub.seoOg;'],
    // Pasul 12-U1: adresele curate și adresa site-ului (module fără dependențe).
    [/import adreseCurate from '\.\/lib\/adrese-curate\.js';/, 'const adreseCurate = globalThis.__adreseCurate;'],
    [/import adresaSite from '\.\/lib\/adresa-site\.js';/, 'const adresaSite = globalThis.__adresaSite;'],
  ];
  inlocuiri.forEach(([re, cu]) => { if (!re.test(src)) throw new Error('importul lipsește: ' + re); src = src.replace(re, cu); });
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
function cerere(cale, { host = ADMIN, cookie, schema = 'https' } = {}) {
  const h = new Headers({ 'user-agent': CHROME, host });
  if (cookie) h.set('cookie', cookie);
  const hostUrl = host.toLowerCase().replace(/\.$/, '');
  return new Request(`${schema}://${hostUrl}${cale}`, { headers: h });
}
async function ruleaza(mw, req) {
  apeluri.createClient = 0; apeluri.getUser = 0;
  try { return { r: await mw(req), exceptie: null }; } catch (e) { return { r: null, exceptie: e }; }
}
const loc = (rez) => (rez.r instanceof Response ? rez.r.headers.get('location') : null);
const status = (rez) => (rez.r instanceof Response ? rez.r.status : null);
const descrie = (rez) => rez.exceptie ? 'excepție ' + rez.exceptie.message : rez.r instanceof Response ? rez.r.status + ' ' + loc(rez) : JSON.stringify(rez.r);
const sprePublic = (rez) => status(rez) !== null && /^https:\/\/mydarrin\.homebestpal\.com(\/|$)/.test(loc(rez) || '');

(async () => {
  const modul = await incarcaMiddleware();
  const mw = modul.default;
  const matcher = new RegExp('^' + modul.config.matcher[0] + '$');

  // ── A. admin.: pagini publice → 307 spre domeniul public ─────────────
  const cazuriPublice = [
    '/mydarrin-investitori', '/mydarrin-investitori?x=1', '/mydarrin-investitori.html',
    '/mydarrin-catalog?cat=X', '/mydarrin-catalog?categorie=servicii&subcategorie=zugraveli',
    '/index.html', '/index', '/home', '/cos', '/partener', '/servicii/zugraveli',
    '/mydarrin-dashboard-client', '/mydarrin-dashboard-furnizor', '/mydarrin-termeni',
    '/mydarrin-panou-investitor', '/despre-noi', '/pagina-care-nu-exista',
  ];
  for (const c of cazuriPublice) {
    const rez = await ruleaza(mw, cerere(c));
    verifica(status(rez) === 307 && loc(rez) === PUBLIC + c, `A ${c} pe admin. → 307 ${PUBLIC}${c} (${descrie(rez)})`);
    verifica(apeluri.createClient === 0, `A ${c}: fără niciun apel spre Supabase`);
  }
  {
    // Cu cookie de superadmin: tot pe domeniul public (nu „Continuă dosarul” pe admin.).
    const rez = await ruleaza(mw, cerere('/mydarrin-investitori', { cookie: cookieSuper }));
    verifica(status(rez) === 307 && loc(rez) === PUBLIC + '/mydarrin-investitori', 'A2 superadmin conectat pe /mydarrin-investitori → domeniul public (' + descrie(rez) + ')');
    // Robot de previzualizare: tot redirect, fără Supabase.
    const fb = new Request(`https://${ADMIN}/mydarrin-investitori`, { headers: { host: ADMIN, 'user-agent': 'facebookexternalhit/1.1' } });
    const rf = await ruleaza(mw, fb);
    verifica(status(rf) === 307 && loc(rf) === PUBLIC + '/mydarrin-investitori' && apeluri.createClient === 0, 'A3 robot OG pe admin. → 307 public, fără Supabase');
    // Antetul host cu majuscule, port sau punct final.
    for (const h of ['ADMIN.MyDarrin.homebestpal.com', `${ADMIN}:443`, `${ADMIN}.`]) {
      const r = await ruleaza(mw, cerere('/cos', { host: h }));
      verifica(status(r) === 307 && loc(r) === PUBLIC + '/cos', `A4 host „${h}” → 307 public (${descrie(r)})`);
    }
    // Supabase neconfigurat: redirectul nu depinde de el.
    const salvat = process.env.SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    const m2 = (await incarcaMiddleware()).default;
    process.env.SUPABASE_URL = salvat;
    const r2 = await ruleaza(m2, cerere('/mydarrin-investitori?x=1'));
    verifica(status(r2) === 307 && loc(r2) === PUBLIC + '/mydarrin-investitori?x=1', 'A5 fără configurare Supabase → tot 307 spre public (' + descrie(r2) + ')');
    const r3 = await ruleaza(m2, cerere('/mydarrin-superadmin'));
    verifica(status(r3) === 307 && new URL(loc(r3)).pathname === '/acces-temporar', 'A5 fără configurare Supabase, superadmin → /acces-temporar (fail-closed, ca azi)');
  }

  // ── B. admin.: backoffice, acces, API, statice ──────────────────────
  {
    let rez = await ruleaza(mw, cerere('/'));
    verifica(status(rez) === 307 && loc(rez) === `https://${ADMIN}/mydarrin-superadmin`, 'B1 „/” pe admin. → superadmin, ca azi (' + descrie(rez) + ')');
    verifica(apeluri.createClient === 0, 'B1 „/” fără Supabase');

    for (const p of ['/mydarrin-superadmin', '/mydarrin-superadmin.html', '/mydarrin-deviz-engine', '/mydarrin-sync-architecture', '/mydarrin-auth-schema', '/mydarrin-backoffice-serviciu', '/mydarrin-admin-catalog', '/mydarrin-admin-catalog.html']) {
      rez = await ruleaza(mw, cerere(p));
      const l = loc(rez) ? new URL(loc(rez)) : null;
      verifica(status(rez) === 307 && l && l.host === ADMIN && l.pathname === '/acces-temporar', `B2 ${p} fără sesiune → /acces-temporar pe admin. (bariera 11-S3) (${descrie(rez)})`);
    }
    rez = await ruleaza(mw, cerere('/mydarrin-superadmin', { cookie: cookieSuper }));
    verifica(rez.r && rez.r.tip === 'next', 'B3 superadminul unic pe /mydarrin-superadmin → next(), ca azi (' + descrie(rez) + ')');

    for (const p of ['/reset-password', '/reset-password.html?token=abc', '/pitch-deck-prezentator?canal=x', '/acces-temporar', '/acord-confidentialitate']) {
      rez = await ruleaza(mw, cerere(p));
      verifica(!sprePublic(rez) && !rez.exceptie, `B4 ${p} pe admin. → nu e trimis pe domeniul public (${descrie(rez)})`);
    }
    // /acces-temporar și /acord-confidentialitate nu ajung deloc în middleware.
    for (const p of ['/acces-temporar', '/acces-temporar.html', '/acord-confidentialitate']) {
      verifica(!matcher.test(p), `B5 ${p} e exclus din matcher (middleware-ul nu rulează)`);
    }

    const statice = ['/api/admin/investitori-kyc', '/api/public/destinatie-post-login?x=1', '/ui-comun.js', '/ui-feedback.js', '/lib/supabaseClient.js', '/i18n/en/mydarrin-superadmin.json', '/i18n/ro.json', '/assets/img/logo.png', '/seo-panou.css', '/favicon.ico', '/fonturi/x.woff2', '/manifest.json'];
    for (const p of statice) {
      const doarCale = p.split('?')[0];
      verifica(!matcher.test(doarCale), `B6 ${doarCale} e exclus din matcher (servit direct pe admin.)`);
      rez = await ruleaza(mw, cerere(p));
      verifica(!sprePublic(rez) && !rez.exceptie, `B6 ${p} chiar dacă ar ajunge în middleware → nu e redirecționat (${descrie(rez)})`);
    }
    // Un fișier cu extensie neacoperită de matcher (ex. .avif, .webmanifest) tot nu e redirecționat.
    for (const p of ['/assets/img/x.avif', '/site.webmanifest', '/api']) {
      rez = await ruleaza(mw, cerere(p));
      verifica(!sprePublic(rez), `B7 ${p} → nu e redirecționat (${descrie(rez)})`);
    }
  }

  // ── C. Domeniul public, *.vercel.app, localhost: nimic nu se schimbă ──
  for (const [host, schema] of [['mydarrin.homebestpal.com', 'https'], ['darrin-cloude-git-11a4-mydarrin.vercel.app', 'https'], ['localhost:3000', 'http'], ['admin.mydarrin.homebestpal.com.evil.example', 'https']]) {
    let rez = await ruleaza(mw, cerere('/mydarrin-investitori?x=1', { host, schema }));
    verifica(rez.r && rez.r.tip === 'next', `C ${host}: /mydarrin-investitori → next(), ca azi (${descrie(rez)})`);
    rez = await ruleaza(mw, cerere('/cos', { host, schema }));
    verifica(rez.r && rez.r.tip === 'rewrite' && /\/mydarrin-checkout$/.test(new URL(rez.r.dest).pathname), `C ${host}: /cos → rewrite /mydarrin-checkout, ca azi (${descrie(rez)})`);
    rez = await ruleaza(mw, cerere('/', { host, schema }));
    verifica(rez.r && rez.r.tip === 'next', `C ${host}: „/” → next(), ca azi (${descrie(rez)})`);
    rez = await ruleaza(mw, cerere('/mydarrin-superadmin', { host, schema }));
    const l = loc(rez) ? new URL(loc(rez)) : null;
    verifica(status(rez) === 307 && l && l.pathname === '/acces-temporar' && l.host === new URL(`${schema}://${host}`).host, `C ${host}: /mydarrin-superadmin fără sesiune → /acces-temporar pe același host (${descrie(rez)})`);
  }

  // ── D. Paginile interne: niciun link relativ spre o pagină publică ──
  const INTERNE = ['mydarrin-superadmin.html', 'mydarrin-deviz-engine.html', 'mydarrin-sync-architecture.html', 'mydarrin-auth-schema.html', 'mydarrin-backoffice-serviciu.html', 'mydarrin-admin-catalog.html'];
  for (const f of INTERNE) {
    const src = citeste(f);
    const tinte = [];
    for (const m of src.matchAll(/\bhref\s*=\s*["']([^"']*)["']/g)) tinte.push(['href', m[1]]);
    for (const m of src.matchAll(/window\.open\(\s*['"`]([^'"`]+)['"`]/g)) tinte.push(['window.open', m[1]]);
    for (const m of src.matchAll(/location(?:\.href)?\s*=\s*['"`]([^'"`]+)['"`]/g)) tinte.push(['location', m[1]]);
    for (const m of src.matchAll(/location\.(?:replace|assign)\(\s*['"`]([^'"`]+)['"`]/g)) tinte.push(['location', m[1]]);
    for (const m of src.matchAll(/return `([a-z][^`$]*)/g)) tinte.push(['url generat', m[1]]);
    for (const [tip, t] of tinte) {
      if (!t || /^(https?:|mailto:|tel:|#|\$\{|javascript:|data:)/i.test(t)) continue;
      const cale = new URL(t, `https://${ADMIN}/x`).pathname + new URL(t, `https://${ADMIN}/x`).search;
      const rez = await ruleaza(mw, cerere(cale, { cookie: cookieSuper }));
      verifica(!sprePublic(rez), `D ${f}: ${tip} relativ „${t}” duce la o pagină publică (pe admin. ar fi redirecționat)`);
    }
    // Linkurile absolute spre site-ul public se deschid în tab nou.
    for (const m of src.matchAll(/<a\b[^>]*href="https:\/\/mydarrin\.homebestpal\.com[^"]*"[^>]*>/g)) {
      verifica(/target="_blank"/.test(m[0]) && /rel="noopener"/.test(m[0]), `D ${f}: link public fără tab nou: ${m[0].slice(0, 120)}`);
    }
  }
  {
    const sa = citeste('mydarrin-superadmin.html');
    const m = sa.match(/<a\b([^>]*)>\s*<svg(?:(?!<\/a>)[\s\S])*?<\/svg>\s*Pagina publică investitori ↗\s*<\/a>/);
    verifica(!!m, 'D1 meniul superadmin are „Pagina publică investitori ↗”');
    verifica(m && /href="https:\/\/mydarrin\.homebestpal\.com\/investitori"/.test(m[1]) && /target="_blank"/.test(m[1]) && /rel="noopener"/.test(m[1]), 'D1 „Pagina publică investitori ↗” → domeniul public, target="_blank" rel="noopener"');
    verifica(!/>\s*Investitori\s*<\/a>/.test(sa), 'D2 nu mai există linkul de meniu „Investitori” simplu');
    verifica(/window\.open\('https:\/\/mydarrin\.homebestpal\.com\/investitori','_blank','noopener'\)">🌍 Pagina publică investitori ↗/.test(sa), 'D3 butonul „🌍 Pagina publică investitori ↗” → domeniul public, tab nou');
    verifica(/<a href="https:\/\/mydarrin\.homebestpal\.com\/investitori"[^>]*target="_blank" rel="noopener">💼 Investitori ↗<\/a>/.test(sa), 'D4 linkul din subsol „💼 Investitori ↗” → domeniul public, tab nou');
    verifica(/<option value="\/mydarrin-investitori\.html">/.test(sa), 'D5 selectorul de pagini SEO rămâne neschimbat');
    verifica(/Investitori Admin/.test(sa), 'D6 „Investitori Admin” rămâne');
  }

  // ── E. vercel.json ──────────────────────────────────────────────────
  {
    const vj = JSON.parse(citeste('vercel.json'));
    const r = (vj.redirects || []).find((x) => x.source === '/' && (x.has || []).some((h) => h.type === 'host' && h.value === ADMIN));
    verifica(r && r.destination === '/mydarrin-superadmin.html' && r.permanent === false, 'E1 vercel.json: „/” pe admin. → superadmin (307), neschimbat');
    const mwSrc = citeste('middleware.js');
    verifica((mwSrc.match(/const PAGINI_PERMISE_ADMIN\b/g) || []).length === 1, 'E2 lista paginilor permise pe admin. e definită o singură dată');
    verifica(!/admin\.mydarrin\.homebestpal\.com/.test(JSON.stringify(vj.rewrites || [])), 'E3 regula nu e duplicată în rewrites');
  }

  console.error = consoleError;
  console.log = consoleLog;
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error = consoleError; console.error(e); process.exit(1); });
