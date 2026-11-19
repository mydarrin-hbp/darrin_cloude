// scripts/schimba-domeniu.js — mută adresele absolute ale site-ului pe un domeniu nou (pasul 12-U1, pentru 12-U2)
//
// Serverul citește adresa site-ului din SITE_URL (lib/adresa-site.js), iar
// linkurile interne sunt relative. Rămân câteva locuri unde adresa trebuie să
// fie absolută și scrisă în fișier — etichetele SEO din <head> (canonical,
// hreflang, og:url, og:image, twitter:*), textele care numesc site-ul,
// domeniul cookie-urilor de sesiune, paginile de back-office (care stau pe
// admin.<domeniu> și trimit la site-ul public). Acest script le înlocuiește
// pe toate, dintr-o dată, la mutarea pe domeniul nou.
//
// Nu atinge: admin.<domeniu> și api.<domeniu> (back-office-ul rămâne unde e),
// scripts/ (testele), docs/, fișierele .md, vercel.json (redirecționările).
// Testul scripts/test-adrese-curate.js pică dacă domeniul apare în altă parte.
//
// Utilizare:
//   node scripts/schimba-domeniu.js mydarrin.com               (scrie)
//   node scripts/schimba-domeniu.js mydarrin.com --verifica    (doar numără)
//   node scripts/schimba-domeniu.js mydarrin.com --radacina <dosar>   (altă copie)
// După rulare: SITE_URL=https://<domeniu-nou> în Vercel (Production și Preview).

const fs = require('fs');
const path = require('path');

const DOMENIU_VECHI = 'mydarrin.homebestpal.com';
// Domeniul public, nu și admin.<…> / api.<…>; cu sau fără punct în față (cookie: .<domeniu>).
const POTRIVIRE = /(?<![A-Za-z0-9-])(?<!admin\.)(?<!api\.)mydarrin\.homebestpal\.com/g;

// Fișierele în care domeniul public poate apărea oriunde, și de ce.
const LOCURI_PERMISE = {
  'lib/adresa-site.js': 'adresa implicită, când SITE_URL lipsește',
  'lib/supabaseClient.js': 'domeniul cookie-urilor de sesiune (comun cu admin. și api.)',
  'acces-temporar.html': 'domeniul cookie-urilor la ieșire; textul acordului',
  'acord-confidentialitate.html': 'textul acordului',
  'intrebari-frecvente-clienti.html': 'text: adresa site-ului',
  'mydarrin-termeni.html': 'text: adresa site-ului',
  'i18n/en/acces-temporar.json': 'traducerea textului acordului',
  'i18n/en/acord-confidentialitate.json': 'traducerea textului acordului',
  'i18n/en/intrebari-frecvente-clienti.json': 'traducerea textului',
  'i18n/en/mydarrin-termeni.json': 'traducerea textului',
  'robots.txt': 'adresa sitemap-ului (absolută)',
  'lib/seo-campanii.js': 'back-office: domeniul permis în linkurile campaniilor',
  'seo-panou.js': 'back-office: exemplu de adresă canonică',
  'seo-panou-og.js': 'back-office: previzualizarea cardului',
  'seo-panou-campanii.js': 'back-office: previzualizarea reclamei',
  'mydarrin-superadmin.html': 'back-office (admin.): linkuri spre site-ul public',
  'mydarrin-deviz-engine.html': 'pagină internă: linkuri spre site-ul public',
  'mydarrin-sync-architecture.html': 'pagină internă: linkuri spre site-ul public',
  'mydarrin-auth-schema.html': 'pagină internă: linkuri spre site-ul public',
  'middleware.js': 'comentarii (domeniul cookie-urilor)',
  'index.html': 'comentariu (domeniul cookie-urilor)',
};

// În orice pagină HTML: etichetele SEO din <head>, unde adresa trebuie să fie absolută.
const ETICHETA_SEO = /<link\s+rel="(?:canonical|alternate)"[^>]*>|<meta\s+(?:property|name)="(?:og|twitter):[^"]*"[^>]*>/g;

// Ce nu se atinge niciodată.
function exclus(rel) {
  return /^(scripts|docs|node_modules|continut|detector-out|\.tmp\.driveupload|\.git)\//.test(rel) || /\.md$/i.test(rel) || rel === 'vercel.json' || rel === 'package-lock.json';
}

function fisiereText(radacina) {
  const out = [];
  (function umbla(dir) {
    for (const nume of fs.readdirSync(dir)) {
      const abs = path.join(dir, nume);
      const rel = path.relative(radacina, abs).split(path.sep).join('/');
      if (exclus(rel + (fs.statSync(abs).isDirectory() ? '/' : ''))) continue;
      if (fs.statSync(abs).isDirectory()) umbla(abs);
      else if (/\.(html|js|json|txt|xml|css)$/i.test(nume)) out.push(rel);
    }
  })(radacina);
  return out;
}

// Aparițiile domeniului public dintr-un text, fiecare cu poziția și dacă e permisă.
function aparitii(rel, text) {
  const permisToata = Object.prototype.hasOwnProperty.call(LOCURI_PERMISE, rel);
  const zoneSeo = [];
  if (/\.html$/i.test(rel)) {
    let m; ETICHETA_SEO.lastIndex = 0;
    while ((m = ETICHETA_SEO.exec(text))) zoneSeo.push([m.index, m.index + m[0].length]);
  }
  const lista = [];
  let m; POTRIVIRE.lastIndex = 0;
  while ((m = POTRIVIRE.exec(text))) {
    const inSeo = zoneSeo.some(([a, z]) => m.index >= a && m.index < z);
    lista.push({ index: m.index, linie: text.slice(0, m.index).split('\n').length, permisa: permisToata || inSeo });
  }
  return lista;
}

// Înlocuiește domeniul în aparițiile permise; cele nepermise rămân (și sunt raportate).
function inlocuieste(rel, text, domeniuNou) {
  const lista = aparitii(rel, text);
  let out = '', ultim = 0, inlocuite = 0;
  const nepermise = [];
  for (const a of lista) {
    if (!a.permisa) { nepermise.push(a.linie); continue; }
    out += text.slice(ultim, a.index) + domeniuNou;
    ultim = a.index + DOMENIU_VECHI.length;
    inlocuite++;
  }
  return { text: out + text.slice(ultim), inlocuite, nepermise };
}

function ruleaza(radacina, domeniuNou, optiuni) {
  const o = optiuni || {};
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domeniuNou)) throw new Error('Domeniu invalid: ' + domeniuNou);
  const rezultat = { fisiere: 0, inlocuite: 0, nepermise: [] };
  for (const rel of fisiereText(radacina)) {
    const abs = path.join(radacina, rel);
    const text = fs.readFileSync(abs, 'utf8');
    if (!text.includes(DOMENIU_VECHI)) continue;
    const r = inlocuieste(rel, text, domeniuNou);
    r.nepermise.forEach((l) => rezultat.nepermise.push(rel + ':' + l));
    if (r.inlocuite) {
      rezultat.fisiere++;
      rezultat.inlocuite += r.inlocuite;
      if (!o.verifica) fs.writeFileSync(abs, r.text);
    }
  }
  return rezultat;
}

module.exports = { DOMENIU_VECHI, LOCURI_PERMISE, aparitii, inlocuieste, ruleaza, fisiereText };

if (require.main === module) {
  const arg = process.argv.slice(2);
  const domeniu = arg.find((a) => !a.startsWith('--') && arg[arg.indexOf(a) - 1] !== '--radacina');
  const i = arg.indexOf('--radacina');
  const radacina = path.resolve(i !== -1 ? arg[i + 1] : path.join(__dirname, '..'));
  if (!domeniu) { console.error('Utilizare: node scripts/schimba-domeniu.js <domeniu-nou> [--verifica] [--radacina <dosar>]'); process.exit(2); }
  const r = ruleaza(radacina, domeniu, { verifica: arg.includes('--verifica') });
  console.log(`${arg.includes('--verifica') ? 'De înlocuit' : 'Înlocuite'}: ${r.inlocuite} apariții în ${r.fisiere} fișiere.`);
  if (r.nepermise.length) {
    console.log('Apariții în afara listelor permise (de trecut pe SITE_URL sau pe adrese relative):');
    r.nepermise.forEach((x) => console.log('  ' + x));
    process.exit(1);
  }
  if (!arg.includes('--verifica')) console.log('Setează SITE_URL=https://' + domeniu + ' în Vercel (Production și Preview).');
}
