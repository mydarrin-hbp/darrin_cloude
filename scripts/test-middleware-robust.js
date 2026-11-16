// scripts/test-middleware-robust.js
// Pasul 11-S3 (15 nov. 2026): bariera de acces din middleware.js nu mai cade cu
// 500 (MIDDLEWARE_INVOCATION_FAILED). middleware.js e rulat în Node cu importurile
// înlocuite (Supabase simulat sau clientul real @supabase/supabase-js cu fetch
// simulat, @vercel/functions simulat) — nicio cerere nu iese din proces.
//   A. cookie-uri stricate: codare greșită (%E0%A4%A), bucăți ne-consecutive
//      (.0 și .2 fără .1), JSON trunchiat, cookie nefragmentat plus bucăți,
//      nume repetat → 307 /acces-temporar, fără excepție, fără amestec de forme;
//   B. Supabase: getUser care aruncă / nu răspunde (≤ 6 s), profiles cu eroare
//      → 307 (fail-closed);
//   C. reguli neschimbate: superadminul unic → next(); admin care nu e contul
//      unic → 307; investitor → 307 cu ?motiv=alt_cont; catalogul: admin → next();
//   D. pagini publice: robot OG cu Supabase care aruncă / nu răspunde → HTML-ul
//      original (next / rewrite), niciodată 500; cookie stricat → next();
//   E. fără refresh în middleware: token expirat → 307 cu motiv=sesiune_expirata
//      și revenire; clientul real nu trimite niciodată refresh_token la Supabase;
//   F. loguri: motivul și calea, fără token-uri, cookie-uri sau email complet;
//   G. pagina /acces-temporar (Playwright, dacă e instalat): mesajul „alt cont”
//      RO + EN, „Ieși din cont” șterge toate cookie-urile de sesiune, revenirea
//      după reîmprospătare doar spre căi interne.
// Rulare: node scripts/test-middleware-robust.js

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

// ── Loguri capturate ─────────────────────────────────────────────────────
const loguri = [];
const consoleError = console.error, consoleLog = console.log;
console.error = (...a) => { loguri.push(a.join(' ')); };
console.log = (...a) => { if (/^\[middleware/.test(String(a[0]))) loguri.push(a.join(' ')); else consoleLog(...a); };

// ── Token-uri și cookie-uri ─────────────────────────────────────────────
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(sub, expPeste) { return `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub, exp: Math.floor(Date.now() / 1000) + expPeste, role: 'authenticated' })}.semnatura-test`; }
function sesiune(sub, expPeste = 3600) {
  return { access_token: jwt(sub, expPeste), refresh_token: 'rt-' + sub + '-secret', expires_at: Math.floor(Date.now() / 1000) + expPeste, user: { id: sub, email: 'x@y.z', user_metadata: { umplutura: 'x'.repeat(4000) } } };
}
// Ca lib/supabaseClient.js: encodeURIComponent(JSON), bucăți de 3200.
function bucati(obj, marime = 3200) {
  const enc = encodeURIComponent(JSON.stringify(obj));
  const out = [];
  for (let i = 0; i < enc.length; i += marime) out.push(enc.slice(i, i + marime));
  return out;
}
// O sesiune a cărei tăietură la 3200 cade în mijlocul unei secvențe %XX
// (decodarea fiecărei bucăți separat ar arunca „URI malformed”).
function sesiuneTaiataInEscape(id) {
  for (let k = 0; k < 400; k++) {
    const s = sesiune(id);
    s.user.user_metadata = { nume: 'Popa Cristian', adresa: 'Târgu Neamț, județul Neamț', note: '"{}:,'.repeat(150) + 'a'.repeat(k) };
    const b = bucati(s);
    if (b.length < 2) continue;
    try { b.forEach(decodeURIComponent); } catch (e) {
      tokenLaUser.set(s.access_token, id);
      return { s, b, cookie: b.map((c, i) => `${PREFIX}.${i}=${c}`).join('; ') };
    }
  }
  return {};
}
const fragmentat = (obj) => bucati(obj).map((c, i) => `${PREFIX}.${i}=${c}`).join('; ');
const nefragmentat = (obj) => `${PREFIX}=${encodeURIComponent(JSON.stringify(obj))}`;

// ── Utilizatori și Supabase simulat ─────────────────────────────────────
const UTIL = {
  'u-super': { id: 'u-super', email: SUPER, roles: ['superadmin'] },
  'u-admin': { id: 'u-admin', email: 'alt.admin@firma-test.ro', roles: ['admin'] },
  'u-inv': { id: 'u-inv', email: 'investitor.test@exemplu.com', roles: ['investor'] },
};
const tokenLaUser = new Map();
function cookiePentru(id, expPeste) { const s = sesiune(id, expPeste); tokenLaUser.set(s.access_token, id); return { cookie: fragmentat(s), s }; }

let mod = {};
const apeluri = { getUser: 0, refresh: 0, profiles: 0, createClient: 0 };
function resetSim(o) { mod = o || {}; Object.keys(apeluri).forEach((k) => { apeluri[k] = 0; }); loguri.length = 0; }

const clientSimulat = {
  auth: {
    async getUser(token) {
      apeluri.getUser++;
      if (mod.getUser === 'arunca') throw new TypeError('fetch failed');
      if (mod.getUser === 'blocat') return new Promise(() => {});
      if (mod.getUser === 'eroare500') return { data: { user: null }, error: { status: 500, message: 'eroare internă' } };
      const id = tokenLaUser.get(token);
      if (!id) return { data: { user: null }, error: { status: 403, message: 'invalid JWT' } };
      const u = UTIL[id];
      return { data: { user: { id: u.id, email: u.email } }, error: null };
    },
    async refreshSession() { apeluri.refresh++; return { data: {}, error: { status: 400 } }; },
  },
  from(tabel) {
    if (tabel === 'profiles') apeluri.profiles++;
    if (mod.from === 'arunca') throw new Error('baza de date indisponibilă');
    const st = { tabel, filtre: {} };
    const rezultat = () => {
      if (mod.from === 'blocat') return new Promise(() => {});
      if (tabel === 'profiles') {
        if (mod.profiles === 'eroare') return { data: null, error: { code: 'PGRST116', message: 'eroare' } };
        const u = UTIL[st.filtre.id];
        return { data: u ? { roles: u.roles } : null, error: null };
      }
      return { data: null, error: null };
    };
    const b = {
      select() { return b; }, eq(k, v) { st.filtre[k] = v; return b; },
      single() { return b; }, maybeSingle() { return b; }, limit() { return b; },
      then(res, rej) { return Promise.resolve().then(rezultat).then(res, rej); },
    };
    return b;
  },
};

const seoOg = require(path.join(RADACINA, 'lib/seo-og.js'));
globalThis.__stub = {
  createClient: (...a) => { apeluri.createClient++; if (mod.createClient === 'arunca') throw new Error('client'); return (mod.clientReal ? mod.clientReal(...a) : clientSimulat); },
  next: () => ({ tip: 'next' }),
  rewrite: (dest) => ({ tip: 'rewrite', dest: dest.toString() }),
  seoOg,
};

async function incarcaMiddleware() {
  let src = citeste('middleware.js');
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
function cerere(cale, cookie, { ua = CHROME, host = 'admin.mydarrin.homebestpal.com' } = {}) {
  const h = new Headers({ 'user-agent': ua, host });
  if (cookie) h.set('cookie', cookie);
  return new Request(`https://${host}${cale}`, { headers: h });
}

// Rulează middleware-ul; o excepție (ar fi un 500 pe Vercel) e raportată, nu propagată.
async function ruleaza(mw, req) {
  const t0 = Date.now();
  try { return { r: await mw(req), ms: Date.now() - t0, exceptie: null }; } catch (e) { return { r: null, ms: Date.now() - t0, exceptie: e }; }
}
function e307(rez, motivPagina) {
  if (rez.exceptie || !(rez.r instanceof Response) || rez.r.status !== 307) return false;
  const loc = new URL(rez.r.headers.get('location'));
  if (loc.pathname !== '/acces-temporar') return false;
  return motivPagina === undefined ? true : (loc.searchParams.get('motiv') || null) === motivPagina;
}
const eNext = (rez) => !rez.exceptie && rez.r && rez.r.tip === 'next';
const descrie = (rez) => rez.exceptie ? 'excepție ' + rez.exceptie.message : rez.r instanceof Response ? rez.r.status + ' ' + rez.r.headers.get('location') : JSON.stringify(rez.r);

(async () => {
  const mw = await incarcaMiddleware();
  const SA = '/mydarrin-superadmin';

  // ── A. Cookie-uri stricate ──────────────────────────────────────────
  resetSim();
  let rez = await ruleaza(mw, cerere(SA, `${PREFIX}.0=%E0%A4%A`));
  verifica(e307(rez, 'sesiune_invalida'), 'A1 %E0%A4%A pe /mydarrin-superadmin → 307 /acces-temporar (' + descrie(rez) + ')');
  verifica(apeluri.getUser === 0, 'A1 codarea stricată nu ajunge la Supabase');
  verifica(loguri.some((l) => /motiv=cookie_invalid path=\/mydarrin-superadmin/.test(l)), 'A1 log: motiv=cookie_invalid și calea');

  resetSim();
  rez = await ruleaza(mw, cerere(SA, `${PREFIX}=%E0%A4%A`));
  verifica(e307(rez, 'sesiune_invalida'), 'A1b cookie nefragmentat cu codare stricată → 307');

  {
    const { s } = cookiePentru('u-super');
    const b = bucati(s, 1500);
    verifica(b.length >= 3, 'A2 sesiunea de test are cel puțin 3 bucăți');
    resetSim();
    rez = await ruleaza(mw, cerere(SA, `${PREFIX}.0=${b[0]}; ${PREFIX}.2=${b[2]}`));
    verifica(e307(rez, 'sesiune_invalida'), 'A2 bucățile .0 și .2 fără .1 → 307 (' + descrie(rez) + ')');
    verifica(apeluri.getUser === 0, 'A2 bucata de după gol e ignorată (ca în browser), nu se lipește');

    resetSim();
    rez = await ruleaza(mw, cerere(SA, `${PREFIX}=${encodeURIComponent(JSON.stringify(s)).slice(0, 300)}`));
    verifica(e307(rez, 'sesiune_invalida'), 'A3 JSON trunchiat → 307');

    resetSim();
    rez = await ruleaza(mw, cerere(SA, `${PREFIX}.0=${encodeURIComponent('{"access_token":"abc"')}`));
    verifica(e307(rez, 'sesiune_invalida'), 'A3b JSON trunchiat în bucăți → 307');

    // Nefragmentat valid + bucăți stricate: bucățile au întâietate (ca în browser), fără amestec.
    resetSim();
    rez = await ruleaza(mw, cerere(SA, `${nefragmentat(s)}; ${PREFIX}.0=${b[0]}`));
    verifica(e307(rez, 'sesiune_invalida'), 'A4 cookie nefragmentat + bucăți stricate → 307, fără amestec (' + descrie(rez) + ')');
    verifica(apeluri.getUser === 0, 'A4 nefragmentatul nu „repară” bucățile (browserul nu l-ar citi nici el)');

    // Nefragmentat stricat + bucăți valide → bucățile (forma pe care o citește browserul).
    resetSim();
    rez = await ruleaza(mw, cerere(SA, `${PREFIX}=%E0%A4%A; ${b.map((c, i) => `${PREFIX}.${i}=${c}`).join('; ')}`));
    verifica(eNext(rez), 'A5 nefragmentat stricat + bucăți valide → se folosesc bucățile (' + descrie(rez) + ')');

    // Doar nefragmentat valid → acceptat (varianta veche a lib/supabaseClient.js).
    resetSim();
    rez = await ruleaza(mw, cerere(SA, nefragmentat(s)));
    verifica(eNext(rez), 'A6 doar cookie-ul nefragmentat, valid → next()');

    // Nume repetat (subdomeniu + domeniul comun): prima valoare, ca getRawCookie din browser.
    const inv = cookiePentru('u-inv').s;
    const bi = bucati(inv, 1500);
    resetSim();
    rez = await ruleaza(mw, cerere(SA, `${b.map((c, i) => `${PREFIX}.${i}=${c}`).join('; ')}; ${bi.map((c, i) => `${PREFIX}.${i}=${c}`).join('; ')}`));
    verifica(eNext(rez), 'A7 două sesiuni cu aceleași nume → prima, întreagă, nu bucăți amestecate (' + descrie(rez) + ')');

    resetSim();
    rez = await ruleaza(mw, cerere(SA, `${PREFIX}.0=${encodeURIComponent(JSON.stringify({ refresh_token: 'x' }))}`));
    verifica(e307(rez, 'sesiune_invalida'), 'A8 sesiune fără access_token → 307');
  }

  // Pasul 11-S3b: sesiune mare, tăiată la 3200 în mijlocul unei secvențe %XX
  // (cum scria lib/supabaseClient.js înainte) → validă, nu „cookie_invalid”.
  {
    const { s, cookie } = sesiuneTaiataInEscape('u-super');
    verifica(!!cookie, 'A11 s-a construit o sesiune tăiată în mijlocul unei secvențe %XX');
    resetSim();
    rez = await ruleaza(mw, cerere(SA, cookie));
    verifica(eNext(rez), 'A11 bucăți tăiate în mijlocul lui %XX → se lipesc, apoi se decodează: next() (' + descrie(rez) + ')');
    verifica(s && apeluri.getUser === 1, 'A11 sesiunea ajunge la verificarea Supabase');
  }

  resetSim();
  rez = await ruleaza(mw, cerere(SA, null));
  verifica(e307(rez, null), 'A9 fără cookie → 307 /acces-temporar simplu');
  verifica(loguri.some((l) => /motiv=fara_sesiune/.test(l)), 'A9 log: motiv=fara_sesiune');

  resetSim();
  rez = await ruleaza(mw, cerere(SA, 'gunoi;;=;%%%; =x; a'));
  verifica(e307(rez), 'A10 antet cookie fără sens → 307, fără excepție');

  // ── B. Supabase care cade ───────────────────────────────────────────
  const superCookie = cookiePentru('u-super').cookie;
  resetSim({ getUser: 'arunca' });
  rez = await ruleaza(mw, cerere(SA, superCookie));
  verifica(e307(rez), 'B1 getUser aruncă → 307 (' + descrie(rez) + ')');
  verifica(loguri.some((l) => /motiv=supabase_eroare/.test(l)), 'B1 log: motiv=supabase_eroare');

  resetSim({ getUser: 'blocat' });
  rez = await ruleaza(mw, cerere(SA, superCookie));
  verifica(e307(rez) && rez.ms <= 6000, `B2 getUser nu răspunde → 307 în ≤ 6 s (${rez.ms} ms, ${descrie(rez)})`);
  verifica(loguri.some((l) => /motiv=supabase_timeout/.test(l)), 'B2 log: motiv=supabase_timeout');

  resetSim({ getUser: 'eroare500' });
  rez = await ruleaza(mw, cerere(SA, superCookie));
  verifica(e307(rez), 'B3 getUser cu eroare 500 → 307');

  resetSim({ profiles: 'eroare' });
  rez = await ruleaza(mw, cerere(SA, superCookie));
  verifica(e307(rez), 'B4 profiles cu eroare → 307 (' + descrie(rez) + ')');
  verifica(loguri.some((l) => /motiv=supabase_eroare/.test(l)), 'B4 log: motiv=supabase_eroare');

  resetSim({ from: 'arunca' });
  rez = await ruleaza(mw, cerere(SA, superCookie));
  verifica(e307(rez), 'B5 interogarea profiles aruncă → 307');

  resetSim({ from: 'blocat' });
  rez = await ruleaza(mw, cerere(SA, superCookie));
  verifica(e307(rez) && rez.ms <= 6000, `B6 profiles nu răspunde → 307 în ≤ 6 s (${rez.ms} ms)`);

  resetSim({ createClient: 'arunca' });
  rez = await ruleaza(mw, cerere(SA, superCookie));
  verifica(e307(rez), 'B7 createClient aruncă → 307');

  resetSim();
  rez = await ruleaza(mw, cerere(SA, 'a'.repeat(10) + '%'));
  verifica(e307(rez), 'B8 cookie fără nume de sesiune → 307');

  // ── C. Regulile de acces, neschimbate ───────────────────────────────
  for (const p of ['/mydarrin-superadmin', '/mydarrin-superadmin.html', '/mydarrin-backoffice-serviciu', '/mydarrin-deviz-engine', '/mydarrin-auth-schema', '/mydarrin-sync-architecture.html']) {
    resetSim();
    rez = await ruleaza(mw, cerere(p, superCookie));
    verifica(eNext(rez), `C1 superadminul unic pe ${p} → next() (${descrie(rez)})`);
  }
  const adminCookie = cookiePentru('u-admin').cookie;
  resetSim();
  rez = await ruleaza(mw, cerere(SA, adminCookie));
  verifica(e307(rez, 'alt_cont'), 'C2 admin care nu e contul unic → 307 cu motiv=alt_cont (' + descrie(rez) + ')');
  verifica(loguri.some((l) => /motiv=cont_neautorizat/.test(l) && /user=u-admin/.test(l) && /domeniu=firma-test\.ro/.test(l)), 'C2 log: cont_neautorizat, id-ul și doar domeniul emailului');

  const invCookie = cookiePentru('u-inv').cookie;
  resetSim();
  rez = await ruleaza(mw, cerere(SA, invCookie));
  verifica(e307(rez, 'alt_cont'), 'C3 investitor pe /mydarrin-superadmin → 307 cu motiv=alt_cont (' + descrie(rez) + ')');
  verifica(loguri.some((l) => /motiv=fara_rol/.test(l) && /user=u-inv/.test(l)), 'C3 log: motiv=fara_rol');

  resetSim();
  rez = await ruleaza(mw, cerere('/mydarrin-admin-catalog', adminCookie));
  verifica(eNext(rez), 'C4 catalog: admin → next()');
  resetSim();
  rez = await ruleaza(mw, cerere('/mydarrin-admin-catalog.html', superCookie));
  verifica(eNext(rez), 'C5 catalog: superadmin → next()');
  resetSim();
  rez = await ruleaza(mw, cerere('/mydarrin-admin-catalog', invCookie));
  verifica(e307(rez, 'alt_cont'), 'C6 catalog: investitor → 307 cu motiv=alt_cont');
  resetSim({ getUser: 'arunca' });
  rez = await ruleaza(mw, cerere('/mydarrin-admin-catalog', adminCookie));
  verifica(e307(rez), 'C7 catalog: getUser aruncă → 307');
  resetSim({ getUser: 'blocat' });
  rez = await ruleaza(mw, cerere('/mydarrin-admin-catalog', adminCookie));
  verifica(e307(rez) && rez.ms <= 6000, 'C8 catalog: getUser nu răspunde → 307 în ≤ 6 s');
  resetSim();
  rez = await ruleaza(mw, cerere(SA, fragmentat({ access_token: jwt('necunoscut', 3600) })));
  verifica(e307(rez, 'sesiune_invalida'), 'C9 token respins de Supabase (403) → 307 cu motiv=sesiune_invalida');

  // Bariera generală rămâne dezactivată: o pagină neenumerată trece fără Supabase.
  resetSim({ getUser: 'arunca' });
  // Pasul 11-A4: pe admin. pagina publică e trimisă pe domeniul public, deci verificarea se face acolo.
  rez = await ruleaza(mw, cerere('/mydarrin-dashboard-client', `${PREFIX}.0=%E0%A4%A`, { host: 'mydarrin.homebestpal.com' }));
  verifica(eNext(rez) && apeluri.getUser === 0, 'C10 bariera generală dezactivată, ca azi → next()');
  const src = citeste('middleware.js');
  verifica(/const BARIERA_GENERALA_ACTIVA = false;/.test(src), 'C11 BARIERA_GENERALA_ACTIVA rămâne false');
  verifica(/process\.env\.SUPERADMIN_EMAIL/.test(src), 'C12 contul unic tot din SUPERADMIN_EMAIL');

  // ── D. Pagini publice ───────────────────────────────────────────────
  resetSim({ from: 'arunca', getUser: 'arunca' });
  rez = await ruleaza(mw, cerere('/despre-noi', null, { ua: FB, host: 'mydarrin.homebestpal.com' }));
  verifica(eNext(rez), 'D1 robot OG, Supabase aruncă → next() (HTML-ul original), nu 500 (' + descrie(rez) + ')');
  resetSim({ from: 'blocat' });
  rez = await ruleaza(mw, cerere('/despre-noi', null, { ua: FB, host: 'mydarrin.homebestpal.com' }));
  verifica(eNext(rez) && rez.ms <= 6000, `D2 robot OG, Supabase nu răspunde → next() în ≤ 6 s (${rez.ms} ms)`);
  resetSim({ from: 'arunca' });
  rez = await ruleaza(mw, cerere('/partener', null, { ua: FB, host: 'mydarrin.homebestpal.com' }));
  verifica(!rez.exceptie && rez.r && rez.r.tip === 'rewrite', 'D3 scurtătură publică, robot, Supabase aruncă → rewrite-ul obișnuit');
  resetSim({ createClient: 'arunca' });
  rez = await ruleaza(mw, cerere('/', null, { host: 'mydarrin.homebestpal.com' }));
  verifica(eNext(rez), 'D4 pagină publică, createClient aruncă → next() (fail-open doar pe public)');
  resetSim({ getUser: 'arunca' });
  rez = await ruleaza(mw, cerere('/mydarrin-catalog', `${PREFIX}.0=%E0%A4%A`, { host: 'mydarrin.homebestpal.com' }));
  verifica(eNext(rez), 'D5 vizitator cu cookie stricat pe o pagină publică → next()');
  resetSim();
  rez = await ruleaza(mw, cerere('/%E0%A4%A', null, { host: 'mydarrin.homebestpal.com' }));
  verifica(!rez.exceptie && rez.r, 'D6 cale cu codare stricată → răspuns, fără excepție');

  // ── E. Fără refresh în middleware ──────────────────────────────────
  const expirat = cookiePentru('u-super', -120);
  resetSim();
  rez = await ruleaza(mw, cerere(SA + '?tab=parteneri', expirat.cookie));
  verifica(e307(rez, 'sesiune_expirata'), 'E1 token expirat → 307 cu motiv=sesiune_expirata (' + descrie(rez) + ')');
  const locE = rez.r ? new URL(rez.r.headers.get('location')) : null;
  verifica(locE && locE.searchParams.get('revenire') === '/mydarrin-superadmin?tab=parteneri', 'E1 revenire = calea cerută, internă');
  verifica(locE && locE.origin === 'https://admin.mydarrin.homebestpal.com', 'E1 redirect pe același domeniu');
  verifica(apeluri.refresh === 0 && apeluri.getUser === 0, 'E2 nici refreshSession, nici getUser pentru un token expirat');
  verifica(!/refreshSession\s*\(/.test(src) && !/\.refresh_token\b/.test(src.replace(/\/\/.*$/gm, '')), 'E3 middleware.js nu mai apelează refreshSession și nu citește refresh_token');

  // Clientul real @supabase/supabase-js, cu fetch simulat: ce pleacă spre Supabase.
  const { createClient: createClientReal } = require('@supabase/supabase-js');
  const cereriSupabase = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (resursa, opt) => {
    const u = String(resursa && resursa.url ? resursa.url : resursa);
    const corp = opt && typeof opt.body === 'string' ? opt.body : '';
    const antete = new Headers((opt && opt.headers) || {});
    cereriSupabase.push({ u, corp, auth: antete.get('authorization') || '' });
    if (/\/auth\/v1\/user/.test(u)) {
      const tok = (antete.get('authorization') || '').replace(/^Bearer /, '');
      const id = tokenLaUser.get(tok);
      if (!id) return new Response(JSON.stringify({ code: 403, msg: 'invalid JWT' }), { status: 403, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ id, email: UTIL[id].email, aud: 'authenticated' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (/\/rest\/v1\/profiles/.test(u)) {
      const id = (u.match(/id=eq\.([^&]+)/) || [])[1];
      const p = UTIL[decodeURIComponent(id || '')];
      return new Response(JSON.stringify(p ? { roles: p.roles } : null), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };
  const toateCererile = () => cereriSupabase.map((c) => c.u + ' ' + c.corp + ' ' + c.auth).join('\n');
  resetSim({ clientReal: createClientReal });
  rez = await ruleaza(mw, cerere(SA, superCookie));
  verifica(eNext(rez), 'E4 client real, superadmin valid → next() (' + descrie(rez) + ')');
  verifica(cereriSupabase.some((c) => /\/auth\/v1\/user/.test(c.u)) && cereriSupabase.some((c) => /\/rest\/v1\/profiles/.test(c.u)), 'E4 client real: doar /auth/v1/user și /rest/v1/profiles');
  cereriSupabase.length = 0;
  resetSim({ clientReal: createClientReal });
  rez = await ruleaza(mw, cerere(SA, expirat.cookie));
  verifica(e307(rez, 'sesiune_expirata') && cereriSupabase.length === 0, 'E5 client real, token expirat → 307, nicio cerere spre Supabase');
  cereriSupabase.length = 0;
  resetSim({ clientReal: createClientReal });
  rez = await ruleaza(mw, cerere(SA, fragmentat({ ...sesiune('necunoscut'), access_token: jwt('necunoscut', 3600) })));
  verifica(e307(rez, 'sesiune_invalida'), 'E6 client real, token respins → 307');
  const trimise = toateCererile();
  verifica(!/refresh_token|grant_type=refresh/.test(trimise) && !trimise.includes('rt-'), 'E7 refresh_token-ul browserului nu e trimis niciodată la Supabase');
  globalThis.fetch = fetchOriginal;

  // ── F. Loguri curate ────────────────────────────────────────────────
  const toate = [];
  const salvat = loguri.slice();
  resetSim();
  for (const [p, c] of [[SA, adminCookie], [SA, invCookie], [SA, superCookie], [SA, expirat.cookie], [SA, `${PREFIX}.0=%E0%A4%A`]]) {
    await ruleaza(mw, cerere(p, c));
  }
  toate.push(...salvat, ...loguri);
  const textLog = toate.join('\n');
  verifica(toate.length > 0 && toate.every((l) => !/^\[middleware\] acces respins/.test(l) || /motiv=\S+ path=\//.test(l)), 'F1 fiecare respingere are motiv= și path=');
  verifica(!/eyJ[A-Za-z0-9_-]{8,}/.test(textLog) && !/rt-u-/.test(textLog) && !textLog.includes(PREFIX + '.0='), 'F2 fără token-uri și fără conținutul cookie-urilor');
  verifica(!Object.values(UTIL).some((u) => textLog.includes(u.email)), 'F3 fără adrese de email complete');
  verifica(!textLog.includes('cheie-test-simulata'), 'F4 cheia de serviciu nu apare în loguri');

  // ── G. Fișierele: texte RO + EN, fără secrete ────────────────────────
  const pagina = citeste('acces-temporar.html');
  const dict = JSON.parse(citeste('i18n/en/acces-temporar.json'))._texte;
  const RO_ALT = 'Ești conectat cu alt cont decât cel de administrare. Ieși din cont și intră cu contul autorizat.';
  const EN_ALT = 'You are signed in with an account other than the administration account. Sign out and sign in with the authorised account.';
  verifica(pagina.includes(RO_ALT) && dict[RO_ALT] === EN_ALT, 'G1 mesajul „alt cont”, RO în pagină și EN în dicționar');
  const textePagina = [...pagina.matchAll(/tx\('([^']+)'\)/g)].map((m) => m[1]);
  verifica(textePagina.length >= 8 && textePagina.every((t) => dict[t]), 'G2 fiecare text nou din pagină are traducere EN (' + textePagina.filter((t) => !dict[t]).join(' | ') + ')');
  verifica(!pagina.includes(SUPER) && !/SUPERADMIN_EMAIL/.test(pagina), 'G3 pagina nu spune ce cont e autorizat');
  verifica(!/service_role|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhY29qeXZ1amh5d2FuYXVsdnV1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZS/.test(src + pagina), 'G4 nicio cheie de serviciu scrisă în middleware sau în pagină');
  verifica(!/\balert\(|\bconfirm\(/.test(pagina.split('<script>').slice(-1)[0].split('// ── Pasul 11-S3')[1] || ''), 'G5 codul nou din pagină nu folosește alert/confirm');

  // Regula căii de revenire, aceeași în middleware și în pagină.
  const fnPagina = pagina.match(/function caleRevenireValida\(cale\) \{[\s\S]*?\n\}/)[0];
  const valida = new Function('location', fnPagina + '; return caleRevenireValida;')({ origin: 'https://admin.mydarrin.homebestpal.com' });
  const fnMw = src.match(/function caleRevenireValida\(cale\) \{[\s\S]*?\n\}/)[0];
  const validaMw = new Function(fnMw + '; return caleRevenireValida;')();
  const cazuri = [['/mydarrin-superadmin', true], ['/mydarrin-superadmin?tab=x', true], ['//evil.example', false], ['/\\evil.example', false],
    ['https://evil.example/', false], ['javascript:alert(1)', false], ['/acces-temporar', false], ['/acces-temporar?motiv=x', false], ['', false], ['/a\nb', false]];
  verifica(cazuri.every(([c, e]) => valida(c) === e && validaMw(c) === e), 'G6 revenire: doar căi interne (pagină și middleware) — ' + cazuri.filter(([c, e]) => valida(c) !== e || validaMw(c) !== e).map(([c]) => JSON.stringify(c)).join(', '));

  // ── I. Stocarea sesiunii din browser (lib/supabaseClient.js) ─────────
  {
    const sursa = citeste('lib/supabaseClient.js');
    const cod = sursa.slice(sursa.indexOf('const COOKIE_DOMAIN'), sursa.indexOf("import { createClient }"));
    const borcan = new Map();
    const documentSim = {
      get cookie() { return [...borcan].map(([n, v]) => `${n}=${v}`).join('; '); },
      set cookie(linie) {
        const [nv, ...atr] = linie.split(';');
        const i = nv.indexOf('=');
        const n = nv.slice(0, i).trim(), v = nv.slice(i + 1);
        if (atr.some((a) => /expires=Thu, 01 Jan 1970/i.test(a))) borcan.delete(n); else borcan.set(n, v);
      },
    };
    const st = new Function('document', cod + '; return chunkedCookieStorage;')(documentSim);
    const { s, b } = sesiuneTaiataInEscape('u-super');
    const json = JSON.stringify(s);
    // Cookie-uri vechi, tăiate în mijlocul lui %XX: citite corect acum.
    b.forEach((c, i) => borcan.set(`${PREFIX}.${i}`, c));
    let citit = null, exc = null;
    try { citit = st.getItem(PREFIX); } catch (e) { exc = e; }
    verifica(!exc && citit === json, 'I1 browser: bucăți vechi tăiate în mijlocul lui %XX → sesiunea întreagă, fără „URI malformed”' + (exc ? ' (' + exc.message + ')' : ''));
    // Scrierea nouă nu mai taie o secvență %XX: fiecare bucată se decodează singură.
    borcan.clear();
    st.setItem(PREFIX, json);
    const scrise = [...borcan].filter(([n]) => n.startsWith(PREFIX + '.')).map(([, v]) => v);
    let fiecare = true;
    try { scrise.forEach(decodeURIComponent); } catch (e) { fiecare = false; }
    verifica(scrise.length >= 2 && fiecare && scrise.every((c) => c.length <= 3200), `I2 browser: setItem nu mai taie în mijlocul lui %XX (${scrise.length} bucăți, ≤ 3200)`);
    verifica(st.getItem(PREFIX) === json, 'I3 browser: scriere + citire → aceeași sesiune');
    resetSim();
    rez = await ruleaza(mw, cerere(SA, documentSim.cookie));
    verifica(eNext(rez), 'I4 cookie-urile scrise de browser trec de middleware (superadmin)');
    // Cookie stricat → null, nu excepție.
    borcan.clear();
    borcan.set(`${PREFIX}.0`, '%E0%A4%A');
    exc = null; citit = 'x';
    try { citit = st.getItem(PREFIX); } catch (e) { exc = e; }
    verifica(!exc && citit === null, 'I5 browser: cookie stricat → null (fără sesiune), fără excepție');
    borcan.clear();
    borcan.set(PREFIX, '%E0%A4%A');
    exc = null;
    try { citit = st.getItem(PREFIX); } catch (e) { exc = e; }
    verifica(!exc && citit === null, 'I6 browser: cookie nefragmentat stricat → null');
  }

  // ── H. Pagina în browser ────────────────────────────────────────────
  let pw = null;
  try { pw = require('playwright'); } catch (e) { console.log('  (Playwright lipsește — partea H sărită)'); }
  if (pw) await testPagina(pw);

  console.error = consoleError; console.log = consoleLog;
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error = consoleError; console.error(e); process.exit(1); });

async function testPagina(pw) {
  const { porneste } = require('./server-test');
  const srv = await porneste(0);
  const baza = `http://localhost:${srv.address().port}`;
  const br = await pw.chromium.launch();
  // Clientul Supabase din browser: lib/supabaseClient.js real (cookie-urile în bucăți),
  // cu createClient de la esm.sh înlocuit — nicio cerere spre Supabase.
  const SIM = `export function createClient(url, key, opt) {
    const st = opt.auth.storage, cheie = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    return { auth: {
      async signOut() { window.__iesiri = (window.__iesiri || 0) + 1; st.removeItem(cheie); return { error: null }; },
      async getSession() { window.__getSession = (window.__getSession || 0) + 1; return { data: { session: window.__sesiuneNoua || null }, error: null }; },
      async signInWithPassword() { return { data: null, error: { message: 'x' } }; },
    } };
  }`;
  async function deschide(lang, cale, o = {}) {
    const ctx = await br.newContext();
    await ctx.addInitScript(([l, s]) => {
      try { localStorage.setItem('myd_lang_v1', l); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, marketing: false, data: new Date().toISOString(), versiune: 2 })); } catch (e) {}
      if (s) window.__sesiuneNoua = { access_token: 'nou', expires_at: Math.floor(Date.now() / 1000) + 3600 };
    }, [lang, !!o.sesiuneNoua]);
    await ctx.route(/esm\.sh/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: SIM }));
    await ctx.route(/\.supabase\.co\/|googletagmanager|google-analytics|_vercel\/insights|ipapi\.co/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    if (o.cookies) await ctx.addCookies(o.cookies.map(([name, value]) => ({ name, value, url: baza })));
    const page = await ctx.newPage();
    const erori = [];
    page.on('pageerror', (e) => erori.push(e.message));
    await page.goto(baza + cale);
    await page.waitForTimeout(600);
    return { ctx, page, erori };
  }
  try {
    const REFB = 'aacojyvujhywanaulvuu';
    const cookieuri = [[`sb-${REFB}-auth-token.0`, '%7B%22access_token%22%3A%22abc'], [`sb-${REFB}-auth-token.2`, 'rest'], [`sb-${REFB}-auth-token`, '%E0%A4%A'], ['myd_alt', 'pastrat']];
    for (const lang of ['en', 'ro']) {
      const { ctx, page, erori } = await deschide(lang, '/acces-temporar?motiv=alt_cont', { cookies: cookieuri });
      const text = (await page.locator('#aviz-text').textContent()) || '';
      const asteptat = lang === 'en'
        ? 'You are signed in with an account other than the administration account. Sign out and sign in with the authorised account.'
        : 'Ești conectat cu alt cont decât cel de administrare. Ieși din cont și intră cu contul autorizat.';
      verifica(text.trim() === asteptat, `H1 ${lang}: mesajul „alt cont” (${text.trim()})`);
      const buton = page.locator('#btn-iesi');
      verifica(await buton.isVisible() && (await buton.textContent()).trim() === (lang === 'en' ? 'Sign out' : 'Ieși din cont'), `H2 ${lang}: butonul „${lang === 'en' ? 'Sign out' : 'Ieși din cont'}”`);
      verifica(!(await page.locator('#acces-form').isVisible()), `H3 ${lang}: formularul așteaptă ieșirea din cont`);
      await buton.click();
      await page.waitForFunction(() => /✓/.test(document.getElementById('btn-iesi').textContent) || document.getElementById('btn-iesi').hidden || /Ai ieșit|signed out/i.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(300);
      const ramase = (await ctx.cookies(baza)).map((c) => c.name);
      verifica(!ramase.some((n) => /^sb-.*-auth-token/.test(n)), `H4 ${lang}: toate cookie-urile de sesiune șterse, și bucata .2 (rămase: ${ramase.join(',')})`);
      verifica(ramase.includes('myd_alt'), `H5 ${lang}: celelalte cookie-uri rămân`);
      const corp = await page.locator('body').innerText();
      verifica(lang === 'en' ? /You have signed out\. Now sign in with the authorised account\./.test(corp) : /Ai ieșit din cont\. Intră acum cu contul autorizat\./.test(corp), `H6 ${lang}: mesajul verde după ieșire`);
      verifica(await page.locator('#acces-form').isVisible(), `H7 ${lang}: formularul de intrare apare după ieșire`);
      verifica(await page.evaluate(() => window.__iesiri === 1), `H8 ${lang}: clientul Supabase a închis sesiunea locală`);
      verifica(!corp.includes(SUPER), `H9 ${lang}: pagina nu numește contul autorizat`);
      verifica(erori.length === 0, `H10 ${lang}: fără erori JS (${erori.join(' | ')})`);
      await ctx.close();
    }
    // Sesiune expirată: reîmprospătare în browser, apoi revenire la calea internă.
    {
      const { ctx, page } = await deschide('en', '/acces-temporar?motiv=sesiune_expirata&revenire=' + encodeURIComponent('/despre-noi?x=1'), { sesiuneNoua: true });
      await page.waitForURL(/\/despre-noi\?x=1$/, { timeout: 8000 }).catch(() => {});
      verifica(/\/despre-noi\?x=1$/.test(page.url()), 'H11 sesiune reîmprospătată → revine la calea cerută (' + page.url() + ')');
      await ctx.close();
    }
    {
      const { ctx, page } = await deschide('en', '/acces-temporar?motiv=sesiune_expirata&revenire=' + encodeURIComponent('//evil.example/x'), { sesiuneNoua: true });
      await page.waitForTimeout(800);
      verifica(new URL(page.url()).host === new URL(baza).host && /acces-temporar/.test(page.url()), 'H12 revenire spre alt domeniu → ignorată, rămâne pe pagină');
      await ctx.close();
    }
    {
      const { ctx, page } = await deschide('en', '/acces-temporar?motiv=sesiune_expirata&revenire=%2Fdespre-noi');
      await page.waitForTimeout(800);
      const t = (await page.locator('#aviz-text').textContent()) || '';
      verifica(/acces-temporar/.test(page.url()) && t.trim() === 'Your session has expired. Sign in again.' && await page.locator('#acces-form').isVisible(), 'H13 reîmprospătare eșuată → mesaj EN și formularul de intrare, fără buclă');
      await ctx.close();
    }
    {
      const { ctx, page } = await deschide('en', '/acces-temporar');
      verifica(await page.locator('#aviz').isHidden() && await page.locator('#acces-form').isVisible(), 'H14 fără motiv → pagina de intrare obișnuită');
      await ctx.close();
    }
  } finally {
    await br.close();
    srv.close();
  }
}
