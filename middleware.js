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

export const config = {
  runtime: 'edge',
  // Un singur matcher, catch-all: rulează pentru ORICE cale, cu excepția a
  // trei categorii — API-uri (au deja propria protecție per-endpoint, vezi
  // lib/auth-middleware.js), pagina de login /acces-temporar în sine
  // (altfel nimeni n-ar putea ajunge la ea ca să se autentifice), și
  // fișiere statice identificate după extensie (js/css/imagini/fonturi/etc,
  // necesare oricărei pagini, inclusiv paginii de login).
  matcher: [
    '/((?!api/|acces-temporar$|acces-temporar\\.html$|.*\\.(?:js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|json|map|txt|xml|pdf|mp4|webm)$).*)',
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
  '/home': '/mydarrin-v3',
  '/cos': '/mydarrin-checkout',
  '/partener': '/mydarrin-devino-partener',
  '/investitor': '/mydarrin-investitori',
  '/curier-cartier': '/cum-devii-curier-de-cartier',
  '/asigurator': '/ghidul-asiguratorului',
  '/confirmare-livrare': '/confirmare-livrare',
};

// Normalizează "inchirieri" (segment din URL, plural, cerut de business) la
// "inchiriere" (valoarea internă folosită deja de mydarrin-categorie-servicii.html).
const TIP_CATEGORIE = { servicii: 'servicii', materiale: 'materiale', inchirieri: 'inchiriere', inchiriere: 'inchiriere' };

function ruteazaPublic(pathname) {
  if (PAGINA_STATICA[pathname]) {
    return { destinatie: PAGINA_STATICA[pathname] };
  }

  let m = pathname.match(/^\/(servicii|materiale|inchiriere)\/([^/]+)$/);
  if (m) {
    return { destinatie: '/mydarrin-categorie-servicii', query: { type: TIP_CATEGORIE[m[1]], cat: m[2] } };
  }

  m = pathname.match(/^\/catalog\/(servicii|materiale|inchirieri)\/([^/]+)$/);
  if (m) {
    return { destinatie: '/mydarrin-categorie-servicii', query: { type: TIP_CATEGORIE[m[1]], cat: m[2] } };
  }

  m = pathname.match(/^\/catalog\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (m) {
    return { destinatie: '/mydarrin-produs', query: { type: m[1], cat: m[2], slug: m[3] } };
  }

  return null;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT_REF = SUPABASE_URL ? new URL(SUPABASE_URL).hostname.split('.')[0] : null;
const COOKIE_PREFIX = PROJECT_REF ? `sb-${PROJECT_REF}-auth-token` : null;

// FIX (2026-07-23): răspundea cu un simplu "403 Forbidden" în text brut —
// o fundătură reală, fără niciun link către login. Un vizitator (chiar
// superadminul, dintr-o sesiune expirată) care ajungea aici nu avea de unde
// să știe că /acces-temporar există. Acum redirecționează acolo, exact ca
// bariera generală (treceBarieraPlatforma) — un singur loc de intrare,
// peste tot pe site, indiferent de motivul exact al respingerii (logat sub
// consolă, nu în răspunsul HTTP, ca înainte).
function respinge(request, motiv) {
  console.error(`[middleware] acces respins (${motiv}) — path=${new URL(request.url).pathname} host=${request.headers.get('host')}`);
  return Response.redirect(new URL('/acces-temporar', request.url), 307);
}

// lib/supabaseClient.js salvează sesiunea în cookie-uri fragmentate
// (sb-<ref>-auth-token.0, .1, ...) pe domeniul .mydarrin.homebestpal.com —
// reasamblăm exact aceeași schemă aici, server-side. Verificat contra
// sursei reale @supabase/supabase-js (SupabaseClient.js — defaultStorageKey
// = `sb-${host.split('.')[0]}-auth-token`) și @supabase/auth-js
// (_saveSession → storage.setItem(key, JSON.stringify(session))) — cheia și
// forma JSON sunt exact cele presupuse aici.
function extrageSesiune(cookieHeader) {
  if (!cookieHeader || !COOKIE_PREFIX) return null;
  const cookies = {};
  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    cookies[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  });

  let full = '';
  let i = 0;
  while (cookies[`${COOKIE_PREFIX}.${i}`] !== undefined) {
    full += decodeURIComponent(cookies[`${COOKIE_PREFIX}.${i}`]);
    i++;
  }
  if (!full) return null;

  try {
    const session = JSON.parse(full);
    return { access_token: session?.access_token || null, refresh_token: session?.refresh_token || null };
  } catch (e) {
    return null;
  }
}

// Extrage utilizatorul autentificat din cookie (cu retry pe refresh_token
// dacă access_token-ul a expirat) — folosit atât de bariera strictă
// (superadmin/backoffice), cât și de bariera generală a platformei.
async function obtineUtilizatorAutentificat(request, supabaseAdmin) {
  const sesiune = extrageSesiune(request.headers.get('cookie'));
  if (!sesiune || !sesiune.access_token) return null;

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(sesiune.access_token);
  if (!userErr && userData?.user) return userData.user;

  if (sesiune.refresh_token) {
    const { data: refreshData, error: refreshErr } = await supabaseAdmin.auth.refreshSession({ refresh_token: sesiune.refresh_token });
    if (!refreshErr && refreshData?.user) return refreshData.user;
  }
  return null;
}

async function verificaRoluri(supabaseAdmin, userId) {
  // Sursa autoritativă e profiles.roles, nu doar metadatele din JWT — vezi
  // aceeași convenție în lib/auth-middleware.js (corectat audit 2026-07-11).
  const { data: profile } = await supabaseAdmin.from('profiles').select('roles').eq('id', userId).single();
  const roles = Array.isArray(profile?.roles) ? profile.roles : [];
  return roles.includes('admin') || roles.includes('superadmin');
}

// Marcaj special pentru "acces complet" — vezi api/admin/creeaza-acces-temporar.js.
// Valabil DOAR în bariera generală (pagini publice) — bariera STRICTĂ de mai
// jos (PAGINI_STRICTE) nu-l consultă niciodată, deci un acces temporar "*"
// nu poate ajunge în superadmin/backoffice/deviz-engine sub nicio formă.
const RUTA_ACCES_COMPLET = '*';

// Bariera generală a platformei — vezi comentariul de sus. `true` doar dacă:
// (a) e admin/superadmin (bypass necesar de bootstrap), SAU
// (b) există un rând ACTIV, neexpirat, în accese_temporare pentru emailul
//     userului curent, cu ruta_url = "*" (acces complet pe tot site-ul
//     public) sau exact egală cu pagina cerută (comparate fără extensia
//     .html, ca să nu conteze forma cu/fără .html a cererii).
async function treceBarieraPlatforma(request, supabaseAdmin, pathname) {
  const user = await obtineUtilizatorAutentificat(request, supabaseAdmin);
  if (!user) return false;

  const areRolPermis = await verificaRoluri(supabaseAdmin, user.id);
  if (areRolPermis) return true;

  if (!user.email) return false;
  const rutaCeruta = pathname.replace(/\.html$/, '') || '/';

  const { data: acces } = await supabaseAdmin
    .from('accese_temporare')
    .select('ruta_url, expira_la')
    .eq('email', user.email.toLowerCase())
    .eq('activ', true)
    .maybeSingle();
  if (!acces) return false;
  if (new Date(acces.expira_la) < new Date()) return false;

  if (acces.ruta_url === RUTA_ACCES_COMPLET) return true;

  const rutaAcces = acces.ruta_url.replace(/\.html$/, '');
  return rutaAcces === rutaCeruta;
}

const PAGINI_STRICTE = [
  '/mydarrin-superadmin', '/mydarrin-superadmin.html',
  '/mydarrin-backoffice-serviciu', '/mydarrin-backoffice-serviciu.html',
  '/mydarrin-deviz-engine', '/mydarrin-deviz-engine.html',
  '/mydarrin-auth-schema', '/mydarrin-auth-schema.html',
  '/mydarrin-sync-architecture', '/mydarrin-sync-architecture.html',
];

export default async function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Fail-closed: fără configurare validă nu putem verifica nimic — mai
    // bine blocat decât deschis din greșeală.
    return respinge(request, 'lipsesc SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY din mediu');
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Paginile interne stricte (superadmin/backoffice/etc.) rămân pe bariera
  // veche, neschimbată: DOAR admin/superadmin, niciodată acces temporar.
  if (PAGINI_STRICTE.includes(pathname)) {
    const user = await obtineUtilizatorAutentificat(request, supabaseAdmin);
    if (!user) return respinge(request, 'niciun cookie de sesiune valid');
    const areRolPermis = await verificaRoluri(supabaseAdmin, user.id);
    if (!areRolPermis) return respinge(request, `user ${user.id} autentificat dar fără rol admin/superadmin`);
    return next();
  }

  // Bariera generală a platformei — orice altă pagină din site.
  const permis = await treceBarieraPlatforma(request, supabaseAdmin, pathname);
  if (!permis) {
    console.log(`[middleware-bariera] acces blocat — path=${pathname}, redirect spre /acces-temporar`);
    return Response.redirect(new URL('/acces-temporar', request.url), 307);
  }

  const publicRoute = ruteazaPublic(pathname);
  if (publicRoute) {
    const dest = new URL(publicRoute.destinatie, request.url);
    if (publicRoute.query) {
      for (const [k, v] of Object.entries(publicRoute.query)) dest.searchParams.set(k, v);
    } else {
      for (const [k, v] of url.searchParams.entries()) dest.searchParams.set(k, v);
    }
    console.log(`[middleware-debug] dest=${dest.toString()}`);
    return rewrite(dest);
  }

  return next();
}
