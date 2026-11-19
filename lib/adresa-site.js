// lib/adresa-site.js — adresa publică a site-ului, într-un singur loc (pasul 12-U1, 19 nov. 2026)
//
// Serverul (emailuri, sitemap, middleware, orice adresă absolută) citește
// adresa site-ului DOAR de aici, din variabila de mediu SITE_URL
// (în Vercel, pentru Production și Preview). Fără ea → adresa de azi.
// La mutarea pe mydarrin.com (pasul 12-U2) se schimbă variabila, nu codul.
//
// Fișier fără dependențe: rulează și în Edge (importat de middleware.js).

const SITE_URL_IMPLICIT = 'https://mydarrin.homebestpal.com';

// https://exemplu.ro[/] → https://exemplu.ro ; o valoare greșită → adresa implicită.
function normalizeaza(valoare) {
  try {
    const u = new URL(String(valoare || '').trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return SITE_URL_IMPLICIT;
    return u.origin;
  } catch (e) {
    return SITE_URL_IMPLICIT;
  }
}

function siteUrl() {
  const env = (typeof process !== 'undefined' && process.env) ? process.env.SITE_URL : '';
  return env ? normalizeaza(env) : SITE_URL_IMPLICIT;
}

// Domeniul fără protocol (ex. „mydarrin.homebestpal.com”).
function domeniuSite() {
  return new URL(siteUrl()).hostname;
}

// adresaAbsoluta('/catalog') → 'https://…/catalog'
function adresaAbsoluta(cale) {
  const c = String(cale || '/');
  return siteUrl() + (c.startsWith('/') ? c : '/' + c);
}

module.exports = { SITE_URL_IMPLICIT, siteUrl, domeniuSite, adresaAbsoluta, normalizeaza };
