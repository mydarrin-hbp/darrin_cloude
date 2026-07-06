// lib/supabaseClient.js
// Client Supabase pentru BROWSER — folosește doar cheia publică (anon key),
// niciodată service_role aici.
//
// Se încarcă în paginile HTML astfel:
//   <script type="module" src="/lib/supabaseClient.js"></script>
//
// IMPORTANT — sesiune partajată pe subdomenii:
// Implicit, supabase-js salvează sesiunea în localStorage, care e izolat
// PER DOMENIU (mydarrin.homebestpal.com și admin.mydarrin.homebestpal.com
// sunt domenii diferite din perspectiva browserului — nu partajează
// localStorage). Fără fix, un login pe site-ul public nu era "văzut" pe
// admin. sau api., și invers.
//
// Soluție: înlocuim storage-ul cu cookie-uri, setate explicit pe domeniul
// părinte ".mydarrin.homebestpal.com" — cookie-urile CU acest domeniu SUNT
// partajate automat de browser pe toate subdomeniile (mydarrin., admin., api.).

const COOKIE_DOMAIN = '.mydarrin.homebestpal.com';

function setCookie(name, value, days = 7) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  // encodeURIComponent — valoarea sesiunii poate conține caractere speciale (JSON)
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; domain=${COOKIE_DOMAIN}; SameSite=Lax; Secure`;
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[2]) : null;
}

function removeCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${COOKIE_DOMAIN}`;
}

// Adaptor de storage compatibil cu interfața cerută de supabase-js
// (getItem/setItem/removeItem), dar care scrie în cookie-uri partajate,
// nu în localStorage izolat per subdomeniu.
const cookieStorage = {
  getItem: (key) => getCookie(key),
  setItem: (key, value) => setCookie(key, value),
  removeItem: (key) => removeCookie(key),
};

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = window.__ENV__?.SUPABASE_URL || 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = window.__ENV__?.SUPABASE_ANON_KEY || 'YOUR-ANON-KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: cookieStorage,
  },
});

window.supabaseClient = supabase; // acces global pentru account-system.js
