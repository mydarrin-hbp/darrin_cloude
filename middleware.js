// middleware.js
// Route Guard real pentru paginile de backoffice (Etapa 4, audit 2026-07-12).
//
// FIX MAJOR (2026-07-23) — Barieră de acces pe TOATĂ platforma:
// până acum acest fișier proteja doar câteva pagini interne (superadmin,
// backoffice) și REZOLVA public restul site-ului (homepage, catalog etc.),
// exact opusul cerinței reale — platforma nu e încă lansată public, deci
// NIMIC din conținut nu trebuie văzut de nimeni fără acces aprobat explicit.
// Cerință confirmată explicit: TOT site-ul e blocat implicit, FĂRĂ excepții
// de conținut (nici homepage, nici catalog) — inclusiv conturile reale
// (client/partener/furnizor etc.) rămân blocate până nu au un rând ACTIV în
// `accese_temporare` pentru exact pagina cerută (vezi Punct 11, 2026-07-23).
//
// NECESITATE LOGICĂ DE BOOTSTRAP (decizie explicită, nu presupunere tăcută):
// admin/superadmin trebuie să ocolească bariera — altfel NIMENI nu ar mai
// putea intra vreodată în mydarrin-superadmin.html ca să acorde acces cuiva,
// platforma s-ar bloca singură ireversibil. Doar admin/superadmin trec liber;
// orice alt rol real (client, partener, furnizor, curier, asigurator) e
// tratat identic cu un vizitator anonim — blocat fără un acces temporar activ.
//
// Excepții stricte, tehnice, NU de conținut (altfel nimeni n-ar putea nici
// măcar ajunge la pagina de login): calea /acces-temporar în sine și
// fișierele statice (js/css/imagini/fonturi) — vezi `config.matcher`.
//
// NOTĂ: acest fișier folosește sintaxă ESM (import/export), spre deosebire
// de restul proiectului (CommonJS, require/module.exports) — Routing
// Middleware e un entrypoint separat, compilat independent de Vercel; toată
// documentația oficială (inclusiv exemplele cu runtime:'nodejs') folosește
// exclusiv export/import, niciodată module.exports. Nu schimbă module
// system-ul restului proiectului (package.json rămâne fără "type":"module").

import { createClient } from '@supabase/supabase-js';
import { next, rewrite } from '@vercel/functions';
import seoOg from './lib/seo-og.js';

export const config = {
  runtime: 'edge',
  // Un singur matcher, catch-all: rulează pentru ORICE cale, cu excepția a
  // trei categorii — API-uri (au deja propria protecție per-endpoint, vezi
  // lib/auth-middleware.js), pagina de login /acces-temporar în sine
  // (altfel nimeni n-ar putea ajunge la ea ca să se autentifice), și
  // fișiere statice identificate după extensie (js/css/imagini/fonturi/etc,
  // necesare oricărei pagini, inclusiv paginii de login).
  matcher: [
    '/((?!api/|acces-temporar$|acces-temporar\\.html$|acord-confidentialitate$|acord-confidentialitate\\.html$|.*\\.(?:js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|json|map|txt|xml|pdf|mp4|webm)$).*)',
  ],
};

// ── Rescrieri publice (fără autentificare suplimentară — DAR tot supuse
// barierei generale de mai jos, cu excepția rutelor din PAGINA_STATICA care
// mapează chiar spre pagina de login) ──
//
// TEST (2026-07-23): destinațiile NU mai au extensia .html. Ipoteză
// confirmată live: cu `cleanUrls: true` (vercel.json), un rewrite() către o
// cale terminată în `.html` era tratat de Vercel ca o cerere ce ar trebui
// ea însăși "curățată" — de unde rezultatul rămânea 404 (X-Vercel-Error:
// NOT_FOUND) deși log-urile confirmau destinația corect calculată.
const PAGINA_STATICA = {
  '/home': '/index',
  '/cos': '/mydarrin-checkout',
  // Pasul 11-R3g: scurtătura duce la singura pagină „Devino partener” (hub-ul).
  '/partener': '/cum-devii-partenerul-nostru',
  '/investitor': '/mydarrin-investitori',
  '/curier-cartier': '/cum-devii-curier-de-cartier',
  '/asigurator': '/ghidul-asiguratorului',
  '/confirmare-livrare': '/confirmare-livrare',
};

// Pasul 11-C4: un singur catalog — /servicii/<slug>, /catalog/materiale/<slug> etc.
// duc la mydarrin-catalog cu filtrul (categorie = servicii | materiale | inchirieri,
// subcategorie = slug-ul din categorii).
const TIP_CATEGORIE = { servicii: 'servicii', materiale: 'materiale', inchirieri: 'inchirieri', inchiriere: 'inchirieri' };

function ruteazaPublic(pathname) {
  if (PAGINA_STATICA[pathname]) {
    return { destinatie: PAGINA_STATICA[pathname] };
  }

  let m = pathname.match(/^\/(servicii|materiale|inchiriere)\/([^/]+)$/);
  if (m) {
    return { destinatie: '/mydarrin-catalog', query: { categorie: TIP_CATEGORIE[m[1]], subcategorie: m[2] } };
  }

  m = pathname.match(/^\/catalog\/(servicii|materiale|inchirieri)\/([^/]+)$/);
  if (m) {
    return { destinatie: '/mydarrin-catalog', query: { categorie: TIP_CATEGORIE[m[1]], subcategorie: m[2] } };
  }

  m = pathname.match(/^\/catalog\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (m) {
    return { destinatie: '/mydarrin-produs', query: { type: m[1], cat: m[2], slug: m[3] } };
  }

  return null;
}

// Pasul 11-S3 (15 nov. 2026): adresa proiectului se citește într-un try — o
// valoare greșită în mediu nu mai oprește încărcarea middleware-ului (care ar
// da 500 pe orice cale); fără ea, bariera rămâne fail-closed (vezi mai jos).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let PROJECT_REF = null;
try { PROJECT_REF = SUPABASE_URL ? new URL(SUPABASE_URL).hostname.split('.')[0] : null; } catch (e) { PROJECT_REF = null; }
const COOKIE_PREFIX = PROJECT_REF ? `sb-${PROJECT_REF}-auth-token` : null;

// Pasul 11-S3: limita unui apel spre Supabase din middleware. Peste ea:
// fail-closed pe paginile stricte / de catalog, next() pe cele publice.
const TIMEOUT_SUPABASE_MS = 5000;

// Motivele respingerii, scrise în log (fără token-uri, fără conținutul
// cookie-urilor, fără email complet).
const MOTIV = {
  CONFIG: 'config_lipsa',
  FARA_SESIUNE: 'fara_sesiune',
  COOKIE: 'cookie_invalid',
  EXPIRATA: 'sesiune_expirata',
  INVALIDA: 'sesiune_invalida',
  TIMEOUT: 'supabase_timeout',
  EROARE: 'supabase_eroare',
  FARA_ROL: 'fara_rol',
  NEAUTORIZAT: 'cont_neautorizat',
  EXCEPTIE: 'exceptie',
};

class EroareBariera extends Error {
  constructor(motiv, detaliu) { super(motiv); this.motiv = motiv; this.detaliu = detaliu || ''; }
}

// Cel mult domeniul emailului (ex. „gmail.com”), niciodată adresa întreagă.
function domeniuEmail(email) {
  const s = String(email || '');
  const i = s.lastIndexOf('@');
  return i === -1 ? 'fara-email' : s.slice(i + 1).toLowerCase();
}

function scrieLog(motiv, request, detaliu) {
  let cale = '?', host = '?';
  try { cale = new URL(request.url).pathname; host = request.headers.get('host') || '?'; } catch (e) { /* cerere fără URL valid */ }
  console.error(`[middleware] acces respins — motiv=${motiv} path=${cale} host=${host}${detaliu ? ' ' + detaliu : ''}`);
}

// Calea de revenire după reîmprospătarea sesiunii: doar căi interne
// („/…”, nu „//…”, nu „/\…”, fără caractere de control), niciodată
// /acces-temporar însuși. Aceeași regulă e aplicată și în acces-temporar.html.
function caleRevenireValida(cale) {
  if (typeof cale !== 'string' || !cale || cale.length > 512) return false;
  if (cale[0] !== '/' || cale[1] === '/' || cale[1] === '\\') return false;
  if (/[\u0000-\u001f\u007f\\]/.test(cale)) return false;
  if (/^\/acces-temporar(\.html)?(?:[?#]|$)/.test(cale)) return false;
  return true;
}

// FIX (2026-07-23): răspundea cu un simplu "403 Forbidden" în text brut —
// o fundătură reală, fără niciun link către login. Acum redirecționează la
// /acces-temporar, un singur loc de intrare, indiferent de motivul exact al
// respingerii (logat în consolă, nu în răspunsul HTTP).
// Pasul 11-S3: `optiuni.motivPagina` = ce îi arată pagina utilizatorului
// („alt_cont” — e conectat cu alt cont; „sesiune_expirata” — sesiunea se
// reîmprospătează în browser și revine la `optiuni.revenire`).
function respinge(request, motiv, detaliu, optiuni) {
  scrieLog(motiv, request, detaliu);
  let tinta;
  try {
    const u = new URL('/acces-temporar', request.url);
    const o = optiuni || {};
    if (o.motivPagina) u.searchParams.set('motiv', o.motivPagina);
    if (o.revenire && caleRevenireValida(o.revenire)) u.searchParams.set('revenire', o.revenire);
    tinta = u.toString();
  } catch (e) {
    tinta = 'https://mydarrin.homebestpal.com/acces-temporar';
  }
  return Response.redirect(tinta, 307);
}

// Un apel spre Supabase cu limită de timp: la depășire → EroareBariera
// (supabase_timeout); la excepție → EroareBariera (supabase_eroare).
async function cuTimeout(apel, ce) {
  let ceas;
  const limita = new Promise((_, respins) => {
    ceas = setTimeout(() => respins(new EroareBariera(MOTIV.TIMEOUT, ce)), TIMEOUT_SUPABASE_MS);
  });
  try {
    return await Promise.race([Promise.resolve().then(apel), limita]);
  } catch (e) {
    if (e instanceof EroareBariera) throw e;
    throw new EroareBariera(MOTIV.EROARE, `${ce}: ${(e && e.name) || 'Error'}`);
  } finally {
    clearTimeout(ceas);
  }
}

// Cookie-urile din antet. La un nume repetat (ex. același cookie scris și pe
// subdomeniu, și pe .mydarrin.homebestpal.com) se păstrează PRIMA valoare —
// exact ce citește browserul în lib/supabaseClient.js (getRawCookie, prima
// potrivire). Înainte se păstra ultima, deci serverul putea combina bucăți
// din sesiuni diferite.
function citesteCookieuri(cookieHeader) {
  const cookies = Object.create(null);
  String(cookieHeader).split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const nume = part.slice(0, idx).trim();
    if (nume && !(nume in cookies)) cookies[nume] = part.slice(idx + 1).trim();
  });
  return cookies;
}

// lib/supabaseClient.js salvează sesiunea în cookie-uri fragmentate
// (sb-<ref>-auth-token.0, .1, ...) pe domeniul .mydarrin.homebestpal.com, sau
// (varianta veche) într-un singur cookie sb-<ref>-auth-token. Aceeași regulă
// ca în browser (chunkedCookieStorage.getItem), fără amestec între forme:
//   - dacă există .0 → doar bucățile consecutive .0, .1, … (o bucată rămasă
//     după un gol, ex. .2 fără .1, e ignorată, ca în browser);
//   - altfel → cookie-ul nefragmentat.
// Pasul 11-S3: totul e în try — o codare stricată (URIError) sau un JSON
// invalid întoarce { stare: 'invalid' }, nu o excepție.
// Rezultat: { stare: 'lipsa' } | { stare: 'invalid' } | { stare: 'ok', access_token }.
// refresh_token-ul nu mai e citit deloc (vezi obtineUtilizatorAutentificat).
function extrageSesiune(cookieHeader) {
  try {
    if (!cookieHeader || !COOKIE_PREFIX) return { stare: 'lipsa' };
    const cookies = citesteCookieuri(cookieHeader);
    let brut;
    if (cookies[`${COOKIE_PREFIX}.0`] !== undefined) {
      // Pasul 11-S3b: bucățile se lipesc întâi, apoi se decodează o dată —
      // tăietura la 3200 de caractere poate cădea în mijlocul unei secvențe
      // %XX, iar decodarea fiecărei bucăți separat respingea sesiuni valide.
      let lipit = '';
      for (let i = 0; i < 50 && cookies[`${COOKIE_PREFIX}.${i}`] !== undefined; i++) {
        lipit += cookies[`${COOKIE_PREFIX}.${i}`];
      }
      brut = decodeURIComponent(lipit);
    } else if (cookies[COOKIE_PREFIX] !== undefined) {
      brut = decodeURIComponent(cookies[COOKIE_PREFIX]);
    } else {
      return { stare: 'lipsa' };
    }
    if (!brut) return { stare: 'invalid' };
    const session = JSON.parse(brut);
    const token = session && typeof session.access_token === 'string' ? session.access_token : null;
    if (!token) return { stare: 'invalid' };
    return { stare: 'ok', access_token: token };
  } catch (e) {
    return { stare: 'invalid' };
  }
}

// Momentul expirării din JWT (câmpul exp), fără verificarea semnăturii —
// folosit DOAR ca să știm că sesiunea trebuie reîmprospătată în browser.
// Accesul îl dă exclusiv auth.getUser (verificare la Supabase).
function expiraLa(token) {
  try {
    const parte = String(token).split('.')[1];
    if (!parte) return null;
    let b64 = parte.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const exp = JSON.parse(atob(b64)).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch (e) {
    return null;
  }
}

// Utilizatorul autentificat din cookie — folosit de bariera strictă
// (superadmin/backoffice), de pagina de catalog și de bariera generală.
// Întoarce utilizatorul sau aruncă EroareBariera cu motivul.
//
// Pasul 11-S3 — FĂRĂ refreshSession în middleware: Supabase rotește
// refresh token-urile (fiecare folosire emite unul nou și îl revocă pe cel
// vechi). Middleware-ul folosea refresh_token-ul browserului fără să scrie
// înapoi cookie-urile noi; după intervalul de reutilizare, browserul rămânea
// cu un token revocat, iar reutilizarea lui putea revoca toată sesiunea
// (delogare). Acum, la access_token expirat, middleware-ul trimite la
// /acces-temporar?motiv=sesiune_expirata&revenire=<calea>, unde clientul
// Supabase din browser reîmprospătează sesiunea și revine la pagina cerută.
async function obtineUtilizatorAutentificat(request, supabaseAdmin) {
  const sesiune = extrageSesiune(request.headers.get('cookie'));
  if (sesiune.stare === 'lipsa') throw new EroareBariera(MOTIV.FARA_SESIUNE);
  if (sesiune.stare !== 'ok') throw new EroareBariera(MOTIV.COOKIE);

  const exp = expiraLa(sesiune.access_token);
  if (exp !== null && exp <= Date.now()) throw new EroareBariera(MOTIV.EXPIRATA);

  const rezultat = await cuTimeout(() => supabaseAdmin.auth.getUser(sesiune.access_token), 'auth.getUser');
  const { data, error } = rezultat || {};
  if (error) {
    const status = Number(error.status) || 0;
    if (status >= 400 && status < 500) throw new EroareBariera(MOTIV.INVALIDA, `status=${status}`);
    throw new EroareBariera(MOTIV.EROARE, `auth.getUser status=${status || '?'}`);
  }
  if (!data || !data.user || !data.user.id) throw new EroareBariera(MOTIV.INVALIDA);
  return data.user;
}

// Sursa autoritativă e profiles.roles, nu doar metadatele din JWT — vezi
// aceeași convenție în lib/auth-middleware.js (corectat audit 2026-07-11).
// Pasul 11-S3: eroarea de la interogare → EroareBariera (supabase_eroare),
// nu „fără roluri” tăcut și nici excepție netratată.
async function obtineRoluri(supabaseAdmin, userId) {
  const rezultat = await cuTimeout(() => supabaseAdmin.from('profiles').select('roles').eq('id', userId).maybeSingle(), 'profiles');
  const { data: profile, error } = rezultat || {};
  if (error) throw new EroareBariera(MOTIV.EROARE, `profiles ${error.code || ''}`.trim());
  return Array.isArray(profile?.roles) ? profile.roles : [];
}

async function verificaRoluri(supabaseAdmin, userId) {
  const roles = await obtineRoluri(supabaseAdmin, userId);
  return roles.includes('admin') || roles.includes('superadmin');
}

// Marcaj special pentru "acces complet" — vezi api/admin/creeaza-acces-temporar.js.
// Valabil DOAR în bariera generală (pagini publice) — bariera STRICTĂ de mai
// jos (PAGINI_STRICTE) nu-l consultă niciodată, deci un acces temporar "*"
// nu poate ajunge în superadmin/backoffice/deviz-engine sub nicio formă.
const RUTA_ACCES_COMPLET = '*';

// Bariera generală a platformei — vezi comentariul de sus. Returnează:
//  - true          → acces permis, continuă normal.
//  - false         → blocat complet, fără niciun acces valid → /acces-temporar.
//  - 'nda_pending' → acces temporar valid, dar acordul de confidențialitate
//                    NU e încă acceptat → /acord-confidentialitate (nu la
//                    login din nou, userul e deja autentificat corect).
// Permis (true) doar dacă: (a) e admin/superadmin, SAU (a2) e autentificat
// cu un cont real de business — verificat prin ABSENȚA unui rând în
// accese_temporare (vezi FIX 27 august 2026 de mai sus: un cont creat prin
// api/public/partner-register.js sau account-system.js::signUp() nu are
// niciodată un rând acolo — acel tabel e populat exclusiv de
// api/admin/creeaza-acces-temporar.js, pentru testeri fără cont propriu),
// SAU (b) are un rând ACTIV, neexpirat, cu NDA acceptat, în accese_temporare
// pentru emailul curent, cu ruta_url = "*" (acces complet) sau exact egală
// cu pagina cerută (fără extensia .html) — ramâne scopat la ruta acordată,
// exact ca înainte, pentru conturile de tip tester/demo.
// Pasul 11-S3: orice eroare (sesiune, timeout, interogare) → false
// (fail-closed); o eroare la accese_temporare nu mai e confundată cu
// „niciun rând” (care ar fi deschis accesul).
async function treceBarieraPlatforma(request, supabaseAdmin, pathname) {
  let user;
  try {
    user = await obtineUtilizatorAutentificat(request, supabaseAdmin);
  } catch (e) {
    if (e instanceof EroareBariera) return false;
    throw e;
  }
  if (!user) return false;

  const roluri = await obtineRoluri(supabaseAdmin, user.id);
  if (roluri.includes('admin') || roluri.includes('superadmin')) return true;

  if (!user.email) return false;
  const rutaCeruta = pathname.replace(/\.html$/, '') || '/';

  const rezAcces = await cuTimeout(() => supabaseAdmin
    .from('accese_temporare')
    .select('ruta_url, expira_la, nda_acceptat')
    .eq('email', user.email.toLowerCase())
    .eq('activ', true)
    .maybeSingle(), 'accese_temporare');
  if (rezAcces && rezAcces.error) throw new EroareBariera(MOTIV.EROARE, 'accese_temporare');
  const acces = rezAcces ? rezAcces.data : null;

  // Niciun rând în accese_temporare = cont real de business (client/partener/
  // investitor, creat prin fluxul propriu de înregistrare, nu prin
  // api/admin/creeaza-acces-temporar.js) — trece liber, indiferent de
  // roles[] (poate fi gol, ex. client simplu — vezi FIX de mai sus).
  if (!acces) return true;

  if (new Date(acces.expira_la) < new Date()) return false;
  if (!acces.nda_acceptat) return 'nda_pending';

  if (acces.ruta_url === RUTA_ACCES_COMPLET) return true;

  const rutaAcces = acces.ruta_url.replace(/\.html$/, '');
  return rutaAcces === rutaCeruta;
}

// FIX (29 septembrie 2026, Etapa LANSARE, ridicare generală — cerere
// fondator): bariera generală (dashboard-uri client/partener/furnizor +
// orice pagină neenumerată) e acum deschisă necondiționat. NU afectează
// PAGINI_STRICTE (superadmin/backoffice/deviz-engine/auth-schema/
// sync-architecture) — acelea rămân, mai jos, pe gate-ul lor propriu,
// separat, doar admin/superadmin, contul unic autorizat.
const BARIERA_GENERALA_ACTIVA = false;

const PAGINI_STRICTE = [
  '/mydarrin-superadmin', '/mydarrin-superadmin.html',
  '/mydarrin-backoffice-serviciu', '/mydarrin-backoffice-serviciu.html',
  '/mydarrin-deviz-engine', '/mydarrin-deviz-engine.html',
  '/mydarrin-auth-schema', '/mydarrin-auth-schema.html',
  '/mydarrin-sync-architecture', '/mydarrin-sync-architecture.html',
];

// Pasul 9: pagina adminilor de catalog — admin sau superadmin (vezi mai jos).
const PAGINI_ADMIN_CATALOG = ['/mydarrin-admin-catalog', '/mydarrin-admin-catalog.html'];

// FIX (27 august 2026, Etapa LANSARE, Faza A) — cerere explicită a
// fondatorului: prima ridicare, scopită, a barierei globale de pre-lansare
// (activă din 23 iulie 2026, vezi comentariul de sus). Provizoriu — vezi
// notă de memorie „Etapa LANSARE provizorie": varianta finală, cu totul
// activat, urmează după ce un număr de parteneri au conturi aprobate și au
// descărcat aplicația mobilă dedicată. Listă construită prin audit direct al
// întregului arbore de linkuri pornite din index.html (27 august 2026) —
// exclude deliberat cele 3 dashboard-uri (client/partener/furnizor — rămân
// gatate de treceBarieraPlatforma(), dar acum reachable de orice cont real
// autentificat, vezi FIX-ul de mai jos din acea funcție), toate cele 5 din
// PAGINI_STRICTE, și
// mydarrin-app-mobile.html (rămâne mockup static, de revizuit la Faza H).
// mydarrin-v3(.html) rămân incluse deliberat — fișierul fizic a fost șters
// definitiv (29 septembrie 2026, cerere fondator: nu trebuia să mai existe
// nicio urmă a variantei vechi în repo); redirectul spre index.html pentru
// orice link extern/bookmark vechi se face acum exclusiv din vercel.json
// (rewrites), fără niciun fișier HTML propriu.
const PAGINI_PUBLICE = new Set([
  '/', '/index', '/index.html',
  '/mydarrin-catalog', '/mydarrin-catalog.html',
  '/mydarrin-produs', '/mydarrin-produs.html',
  '/mydarrin-categorie-servicii', '/mydarrin-categorie-servicii.html',
  // FIX (29 septembrie 2026) — omise din auditul inițial (27 august): cele
  // 12 linkuri de pe homepage către aceste două pagini (carusel materiale +
  // carusel închirieri) duceau la /acces-temporar în loc de pagina de
  // categorie. mydarrin-categorie-servicii era deja publică; acestea, la fel
  // link-ate din index.html, nu erau — inconsecvență, nu decizie deliberată.
  '/mydarrin-categorie-materiale', '/mydarrin-categorie-materiale.html',
  '/mydarrin-categorie-inchirieri', '/mydarrin-categorie-inchirieri.html',
  '/mydarrin-checkout', '/mydarrin-checkout.html',
  '/mydarrin-cos', '/mydarrin-cos.html',
  '/mydarrin-marketplace-materiale', '/mydarrin-marketplace-materiale.html',
  '/mydarrin-devino-partener', '/mydarrin-devino-partener.html',
  '/mydarrin-investitori', '/mydarrin-investitori.html',
  '/mydarrin-pitch-deck', '/mydarrin-pitch-deck.html',
  '/mydarrin-creeaza-deviz', '/mydarrin-creeaza-deviz.html',
  '/mydarrin-contact', '/mydarrin-contact.html',
  '/despre-noi', '/despre-noi.html',
  '/mydarrin-cum-functioneaza', '/mydarrin-cum-functioneaza.html',
  '/mydarrin-marketplace', '/mydarrin-marketplace.html',
  '/mydarrin-termeni', '/mydarrin-termeni.html',
  '/mydarrin-politica-confidentialitate', '/mydarrin-politica-confidentialitate.html',
  '/cum-devii-partenerul-nostru', '/cum-devii-partenerul-nostru.html',
  '/cum-devii-furnizor-servicii', '/cum-devii-furnizor-servicii.html',
  '/cum-devii-furnizor-materiale', '/cum-devii-furnizor-materiale.html',
  '/cum-devii-operator-inchirieri', '/cum-devii-operator-inchirieri.html',
  '/cum-devii-curier-de-cartier', '/cum-devii-curier-de-cartier.html',
  '/cum-programez-serviciu', '/cum-programez-serviciu.html',
  '/servicii-urgente', '/servicii-urgente.html',
  '/ghidul-asiguratorului', '/ghidul-asiguratorului.html',
  '/reclamatii', '/reclamatii.html',
  '/intrebari-frecvente-clienti', '/intrebari-frecvente-clienti.html',
  '/intrebari-frecvente-parteneri', '/intrebari-frecvente-parteneri.html',
  '/cum-comanzi', '/cum-comanzi.html',
  '/cum-platesc', '/cum-platesc.html',
  '/cum-prestam-livram', '/cum-prestam-livram.html',
  '/garantii-si-asigurari', '/garantii-si-asigurari.html',
  '/confirmare-livrare', '/confirmare-livrare.html',
  // Setarea/resetarea parolei (28 sept. 2026): linkurile din emailuri se deschid
  // fără sesiune, deci pagina trebuie să treacă de barieră. Conține doar un
  // formular care cere un token valid; fără token arată „link invalid".
  '/reset-password', '/reset-password.html',
  '/mydarrin-v3', '/mydarrin-v3.html',
]);

// FIX (27 august 2026) — Etapa LANSARE: cerere explicită a fondatorului de a
// restricționa backoffice-ul (indiferent de domeniu — vezi și
// vercel.json:"admin.mydarrin.homebestpal.com") la UN SINGUR cont, nu la
// oricine are rolul admin/superadmin. Configurabil prin variabilă de mediu
// (rotabil fără redeploy de cod), cu fallback la emailul confirmat explicit
// de fondator — funcțional corect chiar dacă variabila nu e setată în Vercel.
const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || 'cristianpopaban@gmail.com').toLowerCase();

// Pasul 11-S (23 oct. 2026): previzualizarea la partajare pentru roboții care
// nu rulează JavaScript (Facebook, LinkedIn, WhatsApp, X, TikTok…) — doar pe
// paginile publice. Ia HTML-ul original (cerere internă, marcată cu
// seoOg.ANTET_INTERN, ca să nu reintre aici) și scrie etichetele og: din
// seo_config, pe limbă. Întoarce null (→ HTML-ul original, neschimbat) când nu
// există suprascriere sau la orice eroare.
async function raspunsOg(request, url, destinatie, supabaseAdmin) {
  try {
    const limba = seoOg.limbaCerere(url.searchParams.get('lang'), request.headers.get('accept-language'));
    const cfg = await seoOg.citesteConfig(supabaseAdmin, seoOg.caleSeo(url.pathname), limba);
    if (!seoOg.areOg(cfg)) return null;
    const sursa = await fetch(destinatie.toString(), { headers: { [seoOg.ANTET_INTERN]: '1', accept: 'text/html' } });
    if (!sursa.ok || !/text\/html/i.test(sursa.headers.get('content-type') || '')) return null;
    const html = await sursa.text();
    const nou = seoOg.inlocuiesteOg(html, cfg, { limba, url: seoOg.urlOg(cfg, url, limba) });
    return new Response(nou, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-myd-og': limba },
    });
  } catch (e) {
    console.error(`[middleware-og] HTML original — ${e && e.message} path=${url.pathname}`);
    return null;
  }
}

// Pasul 11-S3: bariera paginilor stricte (contul unic SUPERADMIN_EMAIL) și a
// paginii de catalog (admin sau superadmin). Regulile de acces sunt aceleași
// ca înainte; se schimbă doar tratarea erorilor — fiecare cale de eșec duce
// la respinge() (307 → /acces-temporar), niciodată la next().
async function barieraAdmin(request, supabaseAdmin, url, pathname, doarContulUnic) {
  let user;
  try {
    user = await obtineUtilizatorAutentificat(request, supabaseAdmin);
  } catch (e) {
    if (!(e instanceof EroareBariera)) throw e;
    if (e.motiv === MOTIV.EXPIRATA) {
      // Sesiunea se reîmprospătează în browser, apoi revine aici.
      return respinge(request, e.motiv, e.detaliu, { motivPagina: 'sesiune_expirata', revenire: pathname + url.search });
    }
    if (e.motiv === MOTIV.COOKIE || e.motiv === MOTIV.INVALIDA) {
      // Cookie stricat sau sesiune revocată: pagina oferă „Ieși din cont”.
      return respinge(request, e.motiv, e.detaliu, { motivPagina: 'sesiune_invalida' });
    }
    return respinge(request, e.motiv, e.detaliu);
  }

  const idUser = `user=${user.id}`;
  if (!(await verificaRoluri(supabaseAdmin, user.id))) {
    return respinge(request, MOTIV.FARA_ROL, `${idUser}${doarContulUnic ? '' : ' (pagina de catalog)'}`, { motivPagina: 'alt_cont' });
  }
  if (doarContulUnic && (!user.email || String(user.email).toLowerCase() !== SUPERADMIN_EMAIL)) {
    return respinge(request, MOTIV.NEAUTORIZAT, `${idUser} domeniu=${domeniuEmail(user.email)}`, { motivPagina: 'alt_cont' });
  }
  return next();
}

function creeazaClientAdmin() {
  // Fiecare cerere HTTP a clientului e oprită după TIMEOUT_SUPABASE_MS
  // (AbortSignal); cuTimeout() de mai sus e limita sigură, peste orice client.
  const cuAbort = (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
    ? (resursa, opt) => fetch(resursa, Object.assign({}, opt, { signal: (opt && opt.signal) || AbortSignal.timeout(TIMEOUT_SUPABASE_MS) }))
    : undefined;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, Object.assign(
    { auth: { autoRefreshToken: false, persistSession: false } },
    cuAbort ? { global: { fetch: cuAbort } } : {},
  ));
}

// Pasul 11-S3: niciun drum din middleware nu mai produce un 500
// (MIDDLEWARE_INVOCATION_FAILED). Orice excepție neprevăzută:
//   - pagini stricte, de catalog sau sub bariera generală → respinge()
//     (fail-closed: o eroare nu deschide niciodată accesul);
//   - pagini publice → next() (vizitatorii nu sunt blocați).
export default async function middleware(request) {
  let zona = 'stricta';
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const publicRoute = ruteazaPublic(pathname);
    zona = PAGINI_STRICTE.includes(pathname) ? 'stricta'
      : PAGINI_ADMIN_CATALOG.includes(pathname) ? 'catalog'
      : (PAGINI_PUBLICE.has(pathname) || publicRoute) ? 'publica'
      : 'generala';
    return await ruleaza(request, url, pathname, publicRoute);
  } catch (e) {
    const motiv = e instanceof EroareBariera ? e.motiv : MOTIV.EXCEPTIE;
    const detaliu = e instanceof EroareBariera ? e.detaliu : ((e && e.name) || 'Error');
    if (zona === 'publica') {
      scrieLog(`${motiv} (pagină publică, next)`, request, detaliu);
      try { return next(); } catch (e2) { return new Response(null, { status: 204 }); }
    }
    return respinge(request, motiv, detaliu);
  }
}

async function ruleaza(request, url, pathname, publicRoute) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !COOKIE_PREFIX) {
    // Fail-closed: fără configurare validă nu putem verifica nimic — mai
    // bine blocat decât deschis din greșeală.
    return respinge(request, MOTIV.CONFIG, 'lipsesc SUPABASE_URL/cheia de serviciu din mediu');
  }

  const supabaseAdmin = creeazaClientAdmin();

  // Paginile interne stricte (superadmin/backoffice/etc.): DOAR contul unic
  // autorizat, cu rol admin/superadmin, niciodată acces temporar.
  if (PAGINI_STRICTE.includes(pathname)) {
    return barieraAdmin(request, supabaseAdmin, url, pathname, true);
  }

  // Pagina adminilor de catalog (pasul 9, 15 oct. 2026): admin sau superadmin,
  // fără restricția de cont unic a paginilor stricte (adminii de catalog sunt
  // numiți de superadmin). Dreptul pe catalog (admin_permissions, capitole,
  // țară) îl verifică din nou API-ul, la fiecare cerere.
  if (PAGINI_ADMIN_CATALOG.includes(pathname)) {
    return barieraAdmin(request, supabaseAdmin, url, pathname, false);
  }

  // Pagini publice (Etapa LANSARE, Faza A) — ocolesc complet bariera
  // generală, indiferent de autentificare. ruteazaPublic() e verificat aici
  // (nu doar PAGINI_PUBLICE) pentru că scurtăturile ("/home", "/partener" —
  // vezi PAGINA_STATICA) și rutele de categorie/produs ("/servicii/:slug"
  // etc.) trebuie rezolvate ÎNAINTE de bariera generală — toate destinațiile
  // lui ruteazaPublic() sunt, prin construcție, pagini din PAGINI_PUBLICE.
  if (PAGINI_PUBLICE.has(pathname) || publicRoute) {
    let dest = null;
    if (publicRoute) {
      dest = new URL(publicRoute.destinatie, request.url);
      if (publicRoute.query) {
        for (const [k, v] of Object.entries(publicRoute.query)) dest.searchParams.set(k, v);
      } else {
        for (const [k, v] of url.searchParams.entries()) dest.searchParams.set(k, v);
      }
    }
    // Roboții de previzualizare (pasul 11-S). Vizitatorii obișnuiți nu ajung
    // aici: doar o verificare a User-Agent-ului, fără cereri în plus.
    if (seoOg.esteRobot(request.headers.get('user-agent')) && !request.headers.get(seoOg.ANTET_INTERN)) {
      // Pasul 11-S3: cu limită de timp — un Supabase lent nu ține pagina.
      const og = await cuTimeout(() => raspunsOg(request, url, dest || url, supabaseAdmin), 'og').catch((e) => {
        scrieLog(`${e.motiv || MOTIV.EXCEPTIE} (og, HTML original)`, request, e.detaliu || '');
        return null;
      });
      if (og) return og;
    }
    if (dest) {
      console.log(`[middleware-debug] dest=${dest.toString()}`);
      return rewrite(dest);
    }
    return next();
  }

  // Bariera generală a platformei — orice altă pagină din site (dashboard-uri
  // client/partener/furnizor, orice rută neenumerată explicit mai sus).
  // DEZACTIVATĂ (29 septembrie 2026, cerere fondator, scopită explicit la
  // "doar bariera generală" — PAGINI_STRICTE de mai sus rămâne neatinsă,
  // tot admin/superadmin unic autorizat). Mecanismul (treceBarieraPlatforma,
  // accese_temporare, NDA) rămâne intact în cod — gating reversibil, conform
  // notei „Etapa LANSARE provizorie": un singur `if` de reactivat, nu o
  // rescriere, dacă se decide revenirea la acces condiționat.
  if (!BARIERA_GENERALA_ACTIVA) return next();
  const permis = await treceBarieraPlatforma(request, supabaseAdmin, pathname);
  if (permis === 'nda_pending') {
    console.log(`[middleware-bariera] NDA neacceptat — path=${pathname}, redirect spre /acord-confidentialitate`);
    return Response.redirect(new URL('/acord-confidentialitate', request.url), 307);
  }
  if (!permis) {
    console.log(`[middleware-bariera] acces blocat — path=${pathname}, redirect spre /acces-temporar`);
    return Response.redirect(new URL('/acces-temporar', request.url), 307);
  }

  return next();
}
