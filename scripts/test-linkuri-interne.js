// scripts/test-linkuri-interne.js — testul de rute pentru tot site-ul (pasul 12-U1b, 21 nov. 2026)
//
// Citește fișierele .html și .js publice (rădăcina + lib/i18n.js, emailurile) și
// extrage linkurile interne: href, location.href / replace / assign, onclick-uri
// cu adrese, apeluri MYD_ADRESE.adresaCatalog(tip, 'slug'). Pentru fiecare verifică:
//   1. calea există (fișier .html, rescriere din vercel.json sau regulă din
//      lib/adrese-curate.js);
//   2. nu conține „&” înainte de „?” (bug-ul /catalogservicii&subcategorie=…);
//   3. nu e o adresă veche, care ar trebui să fie curată (MYD_ADRESE.linkNou);
//   4. ?subcategorie= are un slug real (scripts/date-test/slug-uri-categorii.json) și
//      duce la fila lui (/servicii, /materiale, /inchirieri), nu la /catalog;
//   5. adresele catalogului nu se construiesc prin concatenare de șiruri.
// Nu se conectează la producție. Lista de slug-uri se regenerează la cerere:
//   node scripts/genereaza-slug-uri-categorii.js <adresa-site-ului>
// Utilizare: node scripts/test-linkuri-interne.js   (iese cu 1 dacă există probleme)

const fs = require('fs');
const path = require('path');
const A = require('../lib/adrese-curate');

const RADACINA = path.join(__dirname, '..');
const SLUGURI = JSON.parse(fs.readFileSync(path.join(__dirname, 'date-test', 'slug-uri-categorii.json'), 'utf8'));
const FILA_SLUG = {};
['servicii', 'materiale', 'inchirieri'].forEach((t) => SLUGURI[t].forEach((s) => { FILA_SLUG[s] = t; }));
const VERCEL = JSON.parse(fs.readFileSync(path.join(RADACINA, 'vercel.json'), 'utf8'));
const SURSE_VERCEL = new Set([...(VERCEL.rewrites || []), ...(VERCEL.redirects || [])].map((r) => r.source));

// Fișierele publice: .html și .js din rădăcină + emailurile din lib/i18n.js.
const FISIERE = fs.readdirSync(RADACINA).filter((f) => /\.(html|js)$/.test(f)).concat(['lib/i18n.js']);
const STATIC = /\.(js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|json|map|txt|xml|pdf|mp4|webm|webmanifest)$/i;
const IGNORA_CALE = /^\/(api|lib|i18n|assets|\.well-known)(\/|$)/;

const probleme = [];
function problema(fisier, text, idx, mesaj) {
  const rand = text.slice(0, idx).split('\n').length;
  probleme.push(`${fisier}:${rand}  ${mesaj}`);
}

function caleExista(cale) {
  const c = A.curata(cale);
  if (c === '/' || A.rescriere(c) || SURSE_VERCEL.has(c) || SURSE_VERCEL.has(cale)) return true;
  if (fs.existsSync(path.join(RADACINA, c.replace(/^\//, '') + '.html'))) return true;
  if (STATIC.test(c) && fs.existsSync(path.join(RADACINA, c.replace(/^\//, '')))) return true;
  return false;
}

function verificaLink(fisier, text, idx, brut) {
  let h = brut.replace(/&amp;/g, '&').trim();
  if (!h || /^(#|mailto:|tel:|javascript:|data:|blob:|https?:|\/\/)/i.test(h)) return;
  if (/\$\{|\{\{|['"`]\s*\+|\+\s*['"`]|%s|<%/.test(h)) return; // adresă dinamică: o verifică punctul 5
  if (!/^\//.test(h) && !/^[a-z0-9_-]+(\.html)?([?#]|$)/i.test(h)) return;
  if (!/^\//.test(h)) h = '/' + h;
  const [fara_ancora] = h.split('#');
  const iq = fara_ancora.indexOf('?');
  const cale = iq === -1 ? fara_ancora : fara_ancora.slice(0, iq);
  const query = iq === -1 ? '' : fara_ancora.slice(iq);
  if (IGNORA_CALE.test(cale) || (STATIC.test(cale) && !/\.html$/.test(cale))) return;

  if (cale.includes('&')) { problema(fisier, text, idx, `„${brut}”: „&” înainte de „?” (adresă stricată)`); return; }
  if (!caleExista(cale)) { problema(fisier, text, idx, `„${brut}”: calea nu există (fișier, rescriere sau regulă de adresă)`); return; }
  const nou = A.linkNou(cale + query);
  if (nou) { problema(fisier, text, idx, `„${brut}”: adresă veche, se folosește „${nou}”`); return; }

  const sub = new URLSearchParams(query).get('subcategorie');
  if (sub !== null) {
    const fila = FILA_SLUG[sub];
    if (!fila) problema(fisier, text, idx, `„${brut}”: subcategoria „${sub}” nu există în categorii`);
    else if (A.curata(cale) === '/catalog') problema(fisier, text, idx, `„${brut}”: fără fila potrivită, se folosește „/${fila}?subcategorie=${sub}”`);
    else if (A.curata(cale) !== '/' + fila) problema(fisier, text, idx, `„${brut}”: „${sub}” e din fila /${fila}, nu din ${A.curata(cale)}`);
  }
}

function scaneaza(fisier) {
  const text = fs.readFileSync(path.join(RADACINA, fisier), 'utf8');
  let m;
  // href="…", href='…' (și forma cu \" din șiruri JS)
  const reHref = /\bhref\s*=\s*\?(["'])((?:(?!\1).)*?)\?\1/g;
  while ((m = reHref.exec(text))) verificaLink(fisier, text, m.index, m[2]);
  // location.href / replace / assign = '…'
  const reLoc = /location(?:\.href\s*=|\.(?:replace|assign)\s*\()\s*(["'`])((?:(?!\1).)*)\1/g;
  while ((m = reLoc.exec(text))) verificaLink(fisier, text, m.index, m[2]);
  // MYD_ADRESE.adresaCatalog('tip', 'slug') cu valori scrise direct
  const reAd = /adresaCatalog\(\s*(["'])([^"']*)\1\s*,\s*(["'])([^"']*)\3\s*\)/g;
  while ((m = reAd.exec(text))) verificaLink(fisier, text, m.index, A.adresaCatalog(m[2], m[4]));
  // Adrese ale catalogului lipite de mână, în JS (fără funcția comună); paginile-releu
  // care doar păstrează parametrii și #ancora (mydarrin-categorie-*.html) sunt permise
  const reLipit = /(["'`])\/(?:catalog|servicii|materiale|inchirieri)\1\s*\+(?!\s*(?:(?:window\.)?location\.hash|\(p\.toString))|(["'`])\/catalog(?:servicii|materiale|inchirieri)/g;
  while ((m = reLipit.exec(text))) problema(fisier, text, m.index, 'adresa catalogului e construită prin concatenare; folosește MYD_ADRESE.adresaCatalog(tip, slug)');
  // Forma veche mydarrin-catalog.html?… scrisă într-un link
  const reVechi = /\bmydarrin-catalog(?:\.html)?\?(?:categorie|cat)=/g;
  if (!/^(lib\/adrese-curate|scripts\/)/.test(fisier)) {
    while ((m = reVechi.exec(text))) {
      // doar dacă e într-un atribut sau o atribuire de adresă (nu într-un comentariu)
      const inceput = text.lastIndexOf('\n', m.index) + 1;
      if (!/^\s*(\/\/|\*|<!--)/.test(text.slice(inceput, m.index + 1))) problema(fisier, text, m.index, 'adresă veche mydarrin-catalog?categorie=…');
    }
  }
}

FISIERE.forEach((f) => { try { scaneaza(f); } catch (e) { probleme.push(`${f}: nu am putut citi (${e.message})`); } });

if (probleme.length) {
  console.log(`Linkuri interne: ${probleme.length} probleme`);
  probleme.slice(0, 200).forEach((p) => console.log('  ✕ ' + p));
  if (probleme.length > 200) console.log(`  … și încă ${probleme.length - 200}`);
  process.exit(1);
}
console.log(`Linkuri interne: 0 probleme (${FISIERE.length} fișiere verificate)`);
