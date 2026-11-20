// scripts/genereaza-tailwind-destinatie.js — CSS-ul Tailwind precompilat al paginilor de destinație (pasul 12-L1)
//
// De ce: cele 7 pagini de destinație (lib/landing-pagini.js) foloseau Tailwind de
// pe CDN (cdn.tailwindcss.com), care descarcă ~100 KB de JavaScript și compilează
// CSS-ul în browser. Pe un telefon Android simulat (Slow 4G, procesor × 4) asta
// împingea afișarea titlului (LCP) la 2,6–3,1 s. Acum paginile primesc același CSS,
// gata compilat: /landing-tailwind.css.
//
// Cum: clasele folosite pe aceste pagini — din HTML (atributele class, inclusiv
// cele scrise în scripturile paginii) și din scripturile locale încărcate de ele
// (className, classList, class="…") — se pun într-o pagină de lucru, cu Tailwind de
// pe CDN și aceeași configurație ca înainte (culorile primary / accent / ai /
// surface); CSS-ul generat de Tailwind se scrie în landing-tailwind.css.
// Antetul fișierului păstrează amprenta listei de clase: testul
// (scripts/test-pagini-destinatie.js) pică dacă paginile folosesc clase noi și
// fișierul nu a fost regenerat.
//
// Rulare (are nevoie de rețea, pentru cdn.tailwindcss.com):
//   node scripts/genereaza-tailwind-destinatie.js
//   node scripts/genereaza-tailwind-destinatie.js --amprenta   (doar amprenta, fără rețea)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('../lib/landing-pagini');

const RADACINA = path.join(__dirname, '..');
const IESIRE = path.join(RADACINA, 'landing-tailwind.css');
const CONFIG = { theme: { extend: { colors: { primary: { DEFAULT: '#003366' }, accent: { DEFAULT: '#FF8C00' }, ai: { DEFAULT: '#0E9E99' }, surface: { DEFAULT: '#F4F7F9' } } } } };

function claseDin(text) {
  const out = new Set();
  const adauga = (s) => String(s).split(/\s+/).forEach((t) => {
    t = t.trim();
    if (!t || t.length > 80 || /[${}'"`<>\\]/.test(t) || !/^[!-~]+$/.test(t)) return;
    out.add(t);
  });
  let m;
  const tipare = [
    /\bclass\s*=\s*"([^"]*)"/g, /\bclass\s*=\s*'([^']*)'/g, /\bclass=\\"([^"\\]*)\\"/g,
    /\bclassName\s*=\s*'([^']*)'/g, /\bclassName\s*=\s*"([^"]*)"/g,
  ];
  tipare.forEach((re) => { while ((m = re.exec(text))) adauga(m[1]); });
  const lista = /classList\.(?:add|remove|toggle)\(([^)]*)\)/g;
  while ((m = lista.exec(text))) {
    const sir = /'([^']*)'|"([^"]*)"/g;
    let x;
    while ((x = sir.exec(m[1]))) adauga(x[1] || x[2]);
  }
  return out;
}

// Clasele celor 7 pagini și ale scripturilor locale pe care le încarcă (ordonate, pentru amprentă).
function clase() {
  const tot = new Set();
  const scripturi = new Set();
  L.PAGINI.forEach((p) => {
    const html = fs.readFileSync(path.join(RADACINA, p.fisier + '.html'), 'utf8');
    claseDin(html).forEach((c) => tot.add(c));
    const re = /<script[^>]+src="\/([^"?#]+\.js)"/g;
    let m;
    while ((m = re.exec(html))) scripturi.add(m[1]);
  });
  Array.from(scripturi).sort().forEach((s) => {
    const f = path.join(RADACINA, s);
    if (fs.existsSync(f)) claseDin(fs.readFileSync(f, 'utf8')).forEach((c) => tot.add(c));
  });
  return Array.from(tot).sort();
}
function amprenta(lista) { return crypto.createHash('sha256').update(lista.join('\n')).digest('hex').slice(0, 16); }

async function genereaza() {
  const lista = clase();
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const corp = [];
    for (let i = 0; i < lista.length; i += 40) corp.push(`<div class="${lista.slice(i, i + 40).join(' ')}"></div>`);
    await page.setContent(`<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script><script>tailwind.config=${JSON.stringify(CONFIG)}</script></head><body>${corp.join('\n')}</body></html>`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('style')).some((s) => /tailwindcss v\d/.test(s.textContent)), null, { timeout: 30000 });
    await page.waitForTimeout(500);
    const css = await page.evaluate(() => Array.from(document.querySelectorAll('style')).filter((s) => /tailwindcss v\d/.test(s.textContent)).map((s) => s.textContent).join('\n'));
    const versiune = (/tailwindcss (v[\d.]+)/.exec(css) || [])[1] || 'v3';
    const antet = `/* landing-tailwind.css — generat de scripts/genereaza-tailwind-destinatie.js (pasul 12-L1), nu se editează de mână.\n` +
      `   Tailwind ${versiune}, aceeași configurație ca pe CDN; ${lista.length} clase; amprenta: ${amprenta(lista)} */\n`;
    fs.writeFileSync(IESIRE, antet + css.trim() + '\n');
    console.log(`✓ landing-tailwind.css: ${lista.length} clase, ${Math.round(Buffer.byteLength(css) / 1024)} KB, Tailwind ${versiune}`);
  } finally {
    await browser.close();
  }
}

module.exports = { clase, amprenta, claseDin, IESIRE };

if (require.main === module) {
  if (process.argv.includes('--amprenta')) { const l = clase(); console.log(l.length + ' clase, amprenta ' + amprenta(l)); }
  else genereaza().catch((e) => { console.error(e); process.exit(1); });
}
