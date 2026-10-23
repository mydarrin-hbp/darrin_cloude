// lib/seo-og.js
// Previzualizările la partajare (OG) pe server (pasul 11-S, 23 oct. 2026).
//
// Facebook, LinkedIn, WhatsApp, TikTok, X etc. NU rulează JavaScript când
// citesc un link: văd doar etichetele og: scrise în fișier. seo-meta.js (care
// lucrează în browser) nu ajunge la ei. De aceea middleware.js, DOAR pentru
// roboții de previzualizare și DOAR pe paginile publice, ia HTML-ul paginii și
// înlocuiește etichetele og: / twitter: cu cele din seo_config (limba din
// ?lang= sau Accept-Language, implicit RO). Fără suprascriere sau la orice
// eroare → HTML-ul original, neschimbat. Vizitatorii obișnuiți nu trec pe aici.
//
// Fișier fără dependențe (rulează în Edge, importat de middleware.js).

const { limbaSeo, caleSeo } = require('./seo-pagini');

// Roboții care citesc un link ca să-i deseneze previzualizarea.
const ROBOTI = /facebookexternalhit|Facebot|LinkedInBot|Twitterbot|WhatsApp|Slackbot|TelegramBot|Discordbot|Pinterest|Bytespider/i;
// Antetul cererii interne prin care middleware-ul își ia HTML-ul original
// (fără el, cererea ar reintra în ramura OG).
const ANTET_INTERN = 'x-myd-og-intern';
const CACHE_MS = 5 * 60 * 1000;
const LOCALE = { ro: 'ro_RO', en: 'en_GB' };

function esteRobot(ua) {
  return !!ua && ROBOTI.test(String(ua));
}

// ?lang= are prioritate; altfel prima limbă din Accept-Language; altfel RO.
function limbaCerere(langParam, acceptLanguage) {
  if (langParam) return limbaSeo(langParam);
  const prima = String(acceptLanguage || '').split(',')[0].trim().split(';')[0].trim();
  if (!prima || prima === '*') return 'ro';
  return limbaSeo(prima);
}

// ── Cache în memorie (≤ 5 minute), inclusiv pentru „fără suprascriere” ──
const cache = new Map();
async function citesteConfig(supabaseAdmin, pagePath, limba, acum) {
  const t = acum == null ? Date.now() : acum;
  const cheie = pagePath + '|' + limba;
  const c = cache.get(cheie);
  if (c && t - c.t < CACHE_MS) return c.cfg;
  const { data, error } = await supabaseAdmin
    .from('seo_config')
    .select('page_path, limba, meta_title, meta_description, canonical_url, og_titlu, og_descriere, og_imagine_url, og_imagine_alt, og_imagine_latime, og_imagine_inaltime')
    .eq('page_path', pagePath)
    .eq('limba', limba)
    .maybeSingle();
  if (error) throw new Error('seo_config: ' + (error.message || error.code));
  cache.set(cheie, { t, cfg: data || null });
  return data || null;
}
function golesteCache() { cache.clear(); }

function areOg(cfg) {
  return !!cfg && !!(cfg.og_titlu || cfg.og_descriere || cfg.og_imagine_url || cfg.meta_title || cfg.meta_description);
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Etichetele de scris, în ordine: [atribut, cheie, valoare].
function etichete(cfg, { limba, url }) {
  const titlu = cfg.og_titlu || cfg.meta_title;
  const descriere = cfg.og_descriere || cfg.meta_description;
  const e = [];
  if (titlu) e.push(['property', 'og:title', titlu]);
  if (descriere) e.push(['property', 'og:description', descriere]);
  if (cfg.og_imagine_url) {
    e.push(['property', 'og:image', cfg.og_imagine_url]);
    if (cfg.og_imagine_latime) e.push(['property', 'og:image:width', String(cfg.og_imagine_latime)]);
    if (cfg.og_imagine_inaltime) e.push(['property', 'og:image:height', String(cfg.og_imagine_inaltime)]);
    const alt = cfg.og_imagine_alt || titlu;
    if (alt) e.push(['property', 'og:image:alt', alt]);
  }
  e.push(['property', 'og:locale', LOCALE[limba] || LOCALE.ro]);
  if (url) e.push(['property', 'og:url', url]);
  e.push(['name', 'twitter:card', 'summary_large_image']);
  if (titlu) e.push(['name', 'twitter:title', titlu]);
  if (descriere) e.push(['name', 'twitter:description', descriere]);
  if (cfg.og_imagine_url) {
    e.push(['name', 'twitter:image', cfg.og_imagine_url]);
    const alt = cfg.og_imagine_alt || titlu;
    if (alt) e.push(['name', 'twitter:image:alt', alt]);
  }
  return e;
}

// HTML-ul original → același HTML, cu etichetele de mai sus înlocuite (cele
// vechi cu aceeași cheie se scot; cele noi se pun înainte de </head>).
function inlocuiesteOg(html, cfg, optiuni) {
  if (typeof html !== 'string' || !/<\/head>/i.test(html)) return html;
  const lista = etichete(cfg, optiuni || {});
  let rezultat = html;
  lista.forEach(([, cheie]) => {
    const re = new RegExp('<meta\\b[^>]*\\b(?:property|name)\\s*=\\s*["\']' + escRe(cheie) + '["\'][^>]*>[ \\t]*\\r?\\n?', 'gi');
    rezultat = rezultat.replace(re, '');
  });
  const bloc = lista.map(([attr, cheie, valoare]) => '<meta ' + attr + '="' + cheie + '" content="' + escAttr(valoare) + '"/>').join('\n');
  return rezultat.replace(/<\/head>/i, '<!-- og: din seo_config (middleware.js, pasul 11-S) -->\n' + bloc + '\n</head>');
}

// og:url: URL-ul canonic al limbii, altfel adresa paginii (cu ?lang=en pentru
// EN, ca robotul să recitească aceeași variantă).
function urlOg(cfg, url, limba) {
  if (cfg && cfg.canonical_url) return cfg.canonical_url;
  const u = new URL(url.pathname, url.origin);
  if (limba === 'en' || url.searchParams.get('lang')) u.searchParams.set('lang', limba);
  return u.toString();
}

module.exports = { ROBOTI, ANTET_INTERN, CACHE_MS, esteRobot, limbaCerere, citesteConfig, golesteCache, areOg, etichete, inlocuiesteOg, urlOg, caleSeo };
