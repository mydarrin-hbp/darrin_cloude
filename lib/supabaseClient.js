// lib/supabaseClient.js
// Client Supabase pentru BROWSER — folosește doar cheia publică (anon key).
//
// Sesiune partajată pe subdomenii, prin cookie-uri pe domeniul părinte
// ".mydarrin.homebestpal.com" (vizibile automat pe mydarrin./admin./api.).
//
// IMPORTANT: un cookie individual are o limită de ~4KB în browser. Sesiunea
// Supabase completă (access_token + refresh_token + user metadata) o poate
// depăși — dacă o punem într-un singur cookie, browserul o refuză silențios,
// iar la reload sesiunea pare "pierdută". Soluție: împărțim valoarea în mai
// multe cookie-uri mici (key.0, key.1, ...), exact ca în @supabase/ssr oficial.

const COOKIE_DOMAIN = '.mydarrin.homebestpal.com';
const CHUNK_SIZE = 3200; // sub limita de 4096, cu marjă pentru nume+atribute

function setRawCookie(name, value, days = 7) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; domain=${COOKIE_DOMAIN}; SameSite=Lax; Secure`;
}
function getRawCookie(name) {
  const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return match ? match[2] : null;
}
function removeRawCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${COOKIE_DOMAIN}`;
}

const chunkedCookieStorage = {
  getItem: (key) => {
    // Citește toate bucățile (key.0, key.1, ...) și le reasamblează
    let full = '';
    let i = 0;
    while (true) {
      const chunk = getRawCookie(`${key}.${i}`);
      if (chunk === null) break;
      full += decodeURIComponent(chunk);
      i++;
    }
    if (i === 0) {
      // Fallback: variantă veche, necăsăpată (dintr-o versiune anterioară)
      const legacy = getRawCookie(key);
      return legacy ? decodeURIComponent(legacy) : null;
    }
    return full;
  },
  setItem: (key, value) => {
    const encoded = encodeURIComponent(value);
    const chunks = [];
    for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
      chunks.push(encoded.slice(i, i + CHUNK_SIZE));
    }
    chunks.forEach((chunk, i) => setRawCookie(`${key}.${i}`, chunk));
    // Curăță bucăți vechi, mai multe decât cele scrise acum
    for (let i = chunks.length; i < chunks.length + 10; i++) {
      if (getRawCookie(`${key}.${i}`) === null) break;
      removeRawCookie(`${key}.${i}`);
    }
    removeRawCookie(key); // curăță și eventuala variantă veche, necăsăpată
  },
  removeItem: (key) => {
    for (let i = 0; i < 20; i++) {
      if (getRawCookie(`${key}.${i}`) === null) break;
      removeRawCookie(`${key}.${i}`);
    }
    removeRawCookie(key);
  },
};

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = window.__ENV__?.SUPABASE_URL || 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = window.__ENV__?.SUPABASE_ANON_KEY || 'YOUR-ANON-KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: chunkedCookieStorage,
  },
});

window.supabaseClient = supabase;
