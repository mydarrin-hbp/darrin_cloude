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
  // Pasul 11-S3b (15 nov. 2026): bucățile se lipesc ÎNTÂI, apoi se decodează
  // o singură dată. Înainte, fiecare bucată era decodată separat, iar o
  // tăietură la 3200 de caractere care cădea în mijlocul unei secvențe %XX
  // (ex. „%7” | „B…”) arunca „URI malformed” — la sesiunile mari (investitor),
  // în browser și în middleware. Lipirea întâi citește corect și cookie-urile
  // vechi, deja tăiate așa. La un cookie stricat întoarce null (fără sesiune).
  getItem: (key) => {
    try {
      let brut = '';
      let i = 0;
      while (i < 50) {
        const chunk = getRawCookie(`${key}.${i}`);
        if (chunk === null) break;
        brut += chunk;
        i++;
      }
      if (i === 0) {
        // Fallback: variantă veche, necăsăpată (dintr-o versiune anterioară)
        const legacy = getRawCookie(key);
        return legacy ? decodeURIComponent(legacy) : null;
      }
      return decodeURIComponent(brut);
    } catch (e) {
      return null;
    }
  },
  setItem: (key, value) => {
    const encoded = encodeURIComponent(value);
    const chunks = [];
    // Tăietura nu cade niciodată în mijlocul unei secvențe %XX.
    for (let i = 0; i < encoded.length;) {
      let sfarsit = Math.min(i + CHUNK_SIZE, encoded.length);
      if (sfarsit < encoded.length) {
        const p = encoded.lastIndexOf('%', sfarsit - 1);
        if (p > i && p > sfarsit - 3) sfarsit = p;
      }
      chunks.push(encoded.slice(i, sfarsit));
      i = sfarsit;
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

// Pasul 11-I3 (16 nov. 2026): supabase-js vine de pe domeniul propriu, într-un
// singur fișier, cu versiunea fixă din package.json (2.45.0, ca pe server).
// Înainte: https://esm.sh/@supabase/supabase-js@2 — versiune nefixată (în
// browser ajungea 2.119), alt domeniu și o cascadă de ~15 module pe trei
// niveluri, pornită abia după scripturile sincrone ale paginii. Build-ul UMD
// se execută și ca modul: își pune exporturile pe self.supabase.
import './vendor/supabase-js-2.45.0.umd.js';

const { createClient } = self.supabase;

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

// Pasul 11-I3: profilul contului, o singură cerere pe pagină (window.MYD_PROFIL,
// lib/profil-cont.js). Paginile de cont îl includ direct, mai devreme (script
// clasic); celelalte îl primesc de aici, doar dacă lipsește.
if (!window.MYD_PROFIL) await import('./profil-cont.js');

window.supabaseClient = supabase;

// Pasul 11-I3: clientul e gata — o promisiune și un eveniment, în locul
// interogării la 100 ms din fiecare script. Scripturile clasice care pornesc
// înaintea acestui modul ascultă evenimentul `myd:supabase-gata`
// (sau găsesc deja window.supabaseClient / window.MYD_SUPABASE_GATA).
window.MYD_SUPABASE_GATA = Promise.resolve(supabase);
try { window.dispatchEvent(new CustomEvent('myd:supabase-gata')); } catch (e) { /* browser foarte vechi */ }
