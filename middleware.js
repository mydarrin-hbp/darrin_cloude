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
// Cerință explicită: panoul de backoffice trebuie "complet invizibil
// publicului" — de aceea răspunsul pentru orice caz neautorizat e 404, nu un
// redirect (un redirect tot confirmă că ruta există; 404 nu distinge "nu
// exiști" de "exiști, dar nu ai acces").

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

function raspunsInvizibil() {
  return new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// lib/supabaseClient.js salvează sesiunea în cookie-uri fragmentate
// (sb-<ref>-auth-token.0, .1, ...) pe domeniul .mydarrin.homebestpal.com —
// reasamblăm exact aceeași schemă aici, server-side.
function extrageAccessToken(cookieHeader) {
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
    return JSON.parse(full)?.access_token || null;
  } catch (e) {
    return null;
  }
}

export default async function middleware(request) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Fail-closed: fără configurare validă nu putem verifica nimic — mai
    // bine blocat decât deschis din greșeală.
    console.error('[middleware] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY lipsă din mediu');
    return raspunsInvizibil();
  }

  const accessToken = extrageAccessToken(request.headers.get('cookie'));
  if (!accessToken) return raspunsInvizibil();

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return raspunsInvizibil();

  // Sursa autoritativă e profiles.roles, nu doar metadatele din JWT — vezi
  // aceeași convenție în lib/auth-middleware.js (corectat audit 2026-07-11).
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('roles')
    .eq('id', userData.user.id)
    .single();

  const roles = Array.isArray(profile?.roles) ? profile.roles : [];
  if (!roles.includes('admin') && !roles.includes('superadmin')) {
    return raspunsInvizibil();
  }

  return next();
}
