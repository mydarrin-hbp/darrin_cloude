// middleware.js
// Route Guard real pentru paginile de backoffice (Etapa 4, audit 2026-07-12).
//
// Până acum "protecția" era doar client-side (enforceSuperadminBarrier /
// enforceAdminBarrier din account-system.js, apelate din interiorul
// mydarrin-superadmin.html / mydarrin-backoffice-serviciu.html) — HTML-ul
// complet și tot JS-ul paginii se descărcau înainte ca vreo verificare să
// ruleze; un vizitator neautorizat vedea pagina complet randată timp de o
// fracțiune de secundă, iar sursa era oricum descărcabilă direct (view-source,
// curl). Vercel Routing Middleware rulează înaintea servirii fișierului
// static, deci un vizitator neautorizat nu primește niciodată conținutul.
//
// NOTĂ: acest fișier folosește sintaxă ESM (import/export), spre deosebire
// de restul proiectului (CommonJS, require/module.exports) — Routing
// Middleware e un entrypoint separat, compilat independent de Vercel; toată
// documentația oficială (inclusiv exemplele cu runtime:'nodejs') folosește
// exclusiv export/import, niciodată module.exports. Nu schimbă module
// system-ul restului proiectului (package.json rămâne fără "type":"module").
//
// FIX (audit 2026-07-14): directivă explicită — răspunsul pentru un
// vizitator neautorizat e acum 403 Forbidden (nu 404). De asemenea,
// verificarea folosea DOAR access_token-ul din cookie — dacă acesta
// expirase (sesiune veche, tab lăsat deschis ore întregi) și nimic nu-l
// reîmprospătase, un superadmin real primea 403 nemeritat. Acum încercăm și
// refresh_token-ul înainte să respingem. Fiecare respingere e logată cu un
// motiv exact (fără să apară în răspunsul HTTP) — dacă accesul tot pare
// blocat pentru un cont real, motivul e vizibil direct în Vercel Function
// Logs, nu trebuie ghicit din nou.

import { createClient } from '@supabase/supabase-js';
import { next, rewrite } from '@vercel/functions';

export const config = {
  runtime: 'nodejs',
  matcher: [
    '/mydarrin-superadmin',
    '/mydarrin-superadmin.html',
    '/mydarrin-backoffice-serviciu',
    '/mydarrin-backoffice-serviciu.html',
    // FIX (audit 2026-07-19): mydarrin-deviz-engine.html — pagina de concept
    // de business intern (formula de preț, comisioane, editor de tarife) —
    // era servită ca fișier static public, fără nicio verificare, alături de
    // auth-schema.html și sync-architecture.html (aceeași categorie: doc de
    // arhitectură internă, zero barieră, nici măcar client-side). Adăugate
    // aici pe același tipar deja funcțional pentru superadmin/backoffice.
    '/mydarrin-deviz-engine',
    '/mydarrin-deviz-engine.html',
    '/mydarrin-auth-schema',
    '/mydarrin-auth-schema.html',
    '/mydarrin-sync-architecture',
    '/mydarrin-sync-architecture.html',
    // FIX (audit 2026-07-21): rutele curate publice de mai jos erau declarate
    // în vercel.json → rewrites, dar acel mecanism nu e efectiv folosit când
    // proiectul are Routing Middleware (cazul de față — fără framework
    // detectat) — documentația Vercel spune explicit că rescrierea pentru
    // "alte framework-uri" (non-Next.js) trebuie făcută din middleware, cu
    // rewrite() din @vercel/functions, nu din vercel.json. De-asta toate
    // rutele curate (vechi și noi deopotrivă) dădeau 404 în producție,
    // confirmat printr-un test live. Mutate aici.
    '/home',
    '/servicii/:slug',
    '/materiale/:slug',
    '/inchiriere/:slug',
    '/catalog/servicii/:categorie',
    '/catalog/materiale/:categorie',
    '/catalog/inchirieri/:categorie',
    '/catalog/:tip/:categorie/:slug',
    '/cos',
    '/partener',
    '/investitor',
    '/curier-cartier',
    '/asigurator',
  ],
};

// ── Rescrieri publice (fără autentificare) ──
const PAGINA_STATICA = {
  '/home': '/mydarrin-v3.html',
  '/cos': '/mydarrin-checkout.html',
  '/partener': '/mydarrin-devino-partener.html',
  '/investitor': '/mydarrin-investitori.html',
  '/curier-cartier': '/cum-devii-curier-de-cartier.html',
  '/asigurator': '/ghidul-asiguratorului.html',
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
    return { destinatie: '/mydarrin-categorie-servicii.html', query: { type: TIP_CATEGORIE[m[1]], cat: m[2] } };
  }

  m = pathname.match(/^\/catalog\/(servicii|materiale|inchirieri)\/([^/]+)$/);
  if (m) {
    return { destinatie: '/mydarrin-categorie-servicii.html', query: { type: TIP_CATEGORIE[m[1]], cat: m[2] } };
  }

  m = pathname.match(/^\/catalog\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (m) {
    return { destinatie: '/mydarrin-produs.html', query: { type: m[1], cat: m[2], slug: m[3] } };
  }

  return null;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT_REF = SUPABASE_URL ? new URL(SUPABASE_URL).hostname.split('.')[0] : null;
const COOKIE_PREFIX = PROJECT_REF ? `sb-${PROJECT_REF}-auth-token` : null;

function respinge(request, motiv) {
  console.error(`[middleware] acces respins (${motiv}) — path=${new URL(request.url).pathname} host=${request.headers.get('host')}`);
  return new Response('403 Forbidden', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
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

async function verificaRoluri(supabaseAdmin, userId) {
  // Sursa autoritativă e profiles.roles, nu doar metadatele din JWT — vezi
  // aceeași convenție în lib/auth-middleware.js (corectat audit 2026-07-11).
  const { data: profile } = await supabaseAdmin.from('profiles').select('roles').eq('id', userId).single();
  const roles = Array.isArray(profile?.roles) ? profile.roles : [];
  return roles.includes('admin') || roles.includes('superadmin');
}

export default async function middleware(request) {
  // Rutele publice de mai jos nu au nevoie de nicio autentificare — le
  // rezolvăm imediat, înainte de orice verificare Supabase, exact ca un
  // rewrite obișnuit (URL-ul din bara browserului rămâne neschimbat).
  const url = new URL(request.url);
  const publicRoute = ruteazaPublic(url.pathname);
  console.log(`[middleware-debug] pathname=${url.pathname} publicRoute=${JSON.stringify(publicRoute)}`);
  if (publicRoute) {
    const dest = new URL(publicRoute.destinatie, request.url);
    if (publicRoute.query) {
      for (const [k, v] of Object.entries(publicRoute.query)) dest.searchParams.set(k, v);
    }
    console.log(`[middleware-debug] dest=${dest.toString()}`);
    return rewrite(dest);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Fail-closed: fără configurare validă nu putem verifica nimic — mai
    // bine blocat decât deschis din greșeală.
    return respinge(request, 'lipsesc SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY din mediu');
  }

  const sesiune = extrageSesiune(request.headers.get('cookie'));
  if (!sesiune || !sesiune.access_token) return respinge(request, 'niciun cookie de sesiune găsit');

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let userId = null;
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(sesiune.access_token);
  if (!userErr && userData?.user) {
    userId = userData.user.id;
  } else if (sesiune.refresh_token) {
    // access_token expirat/invalid — încercăm o singură dată cu refresh_token
    // înainte să respingem (browserul reînnoiește automat sesiunea în uz
    // normal, dar cookie-ul poate fi stale dacă tab-ul stă deschis mult timp).
    const { data: refreshData, error: refreshErr } = await supabaseAdmin.auth.refreshSession({ refresh_token: sesiune.refresh_token });
    if (refreshErr || !refreshData?.user) return respinge(request, `access_token invalid și refresh eșuat: ${refreshErr?.message || 'necunoscut'}`);
    userId = refreshData.user.id;
  } else {
    return respinge(request, `access_token invalid, fără refresh_token: ${userErr?.message || 'necunoscut'}`);
  }

  const areRolPermis = await verificaRoluri(supabaseAdmin, userId);
  if (!areRolPermis) return respinge(request, `user ${userId} autentificat dar fără rol admin/superadmin`);

  return next();
}
