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
import { next } from '@vercel/functions';

export const config = {
  runtime: 'nodejs',
  matcher: [
    '/mydarrin-superadmin',
    '/mydarrin-superadmin.html',
    '/mydarrin-backoffice-serviciu',
    '/mydarrin-backoffice-serviciu.html',
  ],
};

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
