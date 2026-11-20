// scripts/genereaza-pagini-destinatie.js — paginile de destinație (pasul 12-L1, 19 nov. 2026)
//
// Scrie în cele 7 pagini (lib/landing-pagini.js → PAGINI), între comentariile
//   <!-- lp:cap:inceput --> … <!-- lp:cap:sfarsit -->     în <head>, după i18n-loader.js
//   <!-- lp:erou:inceput --> … <!-- lp:erou:sfarsit -->   primul ecran (macheta L1)
//   <!-- lp:sub:inceput --> … <!-- lp:sub:sfarsit -->     sub primul ecran
// conținutul implicit din lib/landing-pagini.js, plus traducerile EN ale
// textelor (i18n/en/<fișier>.json → _texte). Rulat din nou, rescrie doar ce e
// între comentarii (idempotent).
//
// Tot aici, în <head>-ul celor 7 pagini (o singură dată, idempotent):
//   - Tailwind de pe CDN (compilat în browser, ~1 s de procesor pe telefon)
//     → /landing-tailwind.css, aceleași reguli, precompilate
//     (scripts/genereaza-tailwind-destinatie.js);
//   - Lucide și DOMPurify → defer (nu mai blochează afișarea);
//   - fonturile Google (Syne, Inter, nefolosite pe aceste pagini) → scoase;
//   - ruta-partener.css / .js → scoase de pe paginile de partener (șablonul nou
//     nu le mai folosește; pe /investitori rămân, pentru secțiunile de dedesubt).
//
// Rulare: node scripts/genereaza-pagini-destinatie.js [--verifica]
//   --verifica: nu scrie nimic; iese cu 1 dacă vreo pagină nu e la zi.

const fs = require('fs');
const path = require('path');
const L = require('../lib/landing-pagini');

const RADACINA = path.join(__dirname, '..');
const VERIFICA = process.argv.includes('--verifica');

// Textele fixe ale șablonului (nu se editează din back-office).
const FIXE = {
  'Cum funcționează': 'How it works',
  'Întrebări frecvente pentru parteneri →': 'Partner FAQ →',
  'Alege tipul tău de partener': 'Choose your partner type',
  'Runda curentă': 'Current round',
  'Cum devii investitor': 'How to become an investor',
  // Decizia LM (25 oct. 2026): doar persoane juridice; propoziția rămâne pe paginile de partener.
  'Înscrierea e pentru firme, PFA și întreprinderi individuale.': 'Registration is open to companies, PFAs and sole proprietorships.',
};
const ELIGIBILITATE = 'Înscrierea e pentru firme, PFA și întreprinderi individuale.';
const ANCORA_FAQ = { servicii: 'servicii', materiale: 'materiale', inchirieri: 'inchirieri', curier: 'curieri', asigurari: 'asigurari' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const BIFA = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="#0E9E99" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
const ICO = {
  servicii: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  materiale: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  inchirieri: '<rect x="3" y="11" width="13" height="7" rx="1"/><path d="M16 14h3l2 2v2h-5"/><circle cx="7" cy="19" r="1.5"/><circle cx="18" cy="19" r="1.5"/>',
  curier: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l4-8h5l3 8M10 9l-1-3H7"/>',
  asigurari: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
};
function ico(k) {
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO[k]}</svg>`;
}

// ── Scripturile mici din pagină (vezi landing.js, antetul) ───────────────
function scriptCap(cale) {
  return `<script>/* 12-L1: varianta din utm_campaign (cel mult 300 ms; landing.js) */(function(){var h=document.documentElement,P=${JSON.stringify(cale)},lp=window.__MYD_LP={pagina:P,varianta:null,aplicat:null,date:null,erou:false},c="",ok,inchis=false,rez=null;` +
    `try{c=(new URLSearchParams(location.search).get("utm_campaign")||"").trim().toLowerCase()}catch(e){}if(!/^[a-z0-9][a-z0-9._-]{0,59}$/.test(c)||c===${JSON.stringify(L.IMPLICITA)})c="";lp.varianta=c||null;` +
    `lp.gata=new Promise(function(r){ok=r});function gata(v){if(inchis)return;inchis=true;h.classList.remove("lp-asteapta");ok(v)}if(c)h.classList.add("lp-asteapta");setTimeout(function(){gata(lp.aplicat||"default")},300);` +
    `lp.aplica=function(){if(inchis||!rez||!lp.erou)return;var L=window.MYD_I18N&&window.MYD_I18N.lang==="ro"?"ro":"en",d=rez.continut&&rez.continut[L];if(d){var b=document.getElementById("lp-cta"),st=b&&b.getAttribute("data-cta-stare");` +
    `Array.prototype.forEach.call(document.querySelectorAll("[data-lp-camp]"),function(el){var k=el.getAttribute("data-lp-camp"),v=d[k];if(!v||el.textContent===v)return;if(k==="buton"&&st&&st!=="vizitator"&&st!=="client"&&st!=="incarca")return;el.textContent=v})}` +
    `lp.date=rez;lp.aplicat=c&&rez.varianta===c?c:"default";gata(lp.aplicat)};` +
    `fetch("/api/public/landing?pagina="+encodeURIComponent(P)+(c?"&varianta="+encodeURIComponent(c):""),{headers:{Accept:"application/json"}}).then(function(r){return r.ok?r.json():null}).then(function(j){if(j&&j.ok&&j.continut){rez=j;lp.aplica()}else gata("default")}).catch(function(){gata("default")})})();</script>`;
}
function scriptDupaErou() {
  return `<script>/* 12-L1: destinația butonului primește profesie, lang și UTM-urile din adresă, iar ?type= (adresele vechi) devine categoria (înainte de DOMContentLoaded) */(function(){var a=document.getElementById("lp-cta"),lp=window.__MYD_LP;if(a){try{var q=new URLSearchParams(location.search),u=new URL(a.getAttribute("href"),location.href);` +
    `${JSON.stringify(L.PARAMETRI_TRANSMISI)}.forEach(function(k){var v=q.get(k);if(v&&!u.searchParams.has(k))u.searchParams.set(k,String(v).slice(0,100))});var t=String(q.get("type")||"").toLowerCase().replace("asigurator","asigurari");if(!u.searchParams.has("categorie")&&u.pathname==="/parteneri/inscriere"&&/^(servicii|materiale|inchirieri|curier|asigurari)$/.test(t))u.searchParams.set("categorie",t);a.setAttribute("href",u.pathname+u.search+u.hash)}catch(e){}}if(lp){lp.erou=true;if(lp.aplica)lp.aplica()}})();</script>`;
}

// ── Markup-ul ────────────────────────────────────────────────────────────
function erou(p) {
  const d = p.implicit.ro;
  const cta = p.tip === 'investitori'
    ? 'data-cta-investitor data-cta-lp data-rp-principal data-cta-loc="hero"'
    : `data-cta-partener="${esc(p.categorie || '')}" data-cta-panou data-cta-loc="hero"`;
  return [
    `<main class="lp" id="main-content" data-lp-pagina="${esc(p.cale)}" data-lp-tip="${esc(p.tip)}">`,
    '<section class="lp-erou" id="lp-erou" aria-labelledby="lp-titlu">',
    '<div class="lp-erou-in">',
    `<p class="lp-eticheta" data-lp-camp="eticheta">${esc(d.eticheta)}</p>`,
    `<h1 class="lp-titlu" id="lp-titlu" data-lp-camp="titlu">${esc(d.titlu)}</h1>`,
    `<p class="lp-sub" data-lp-camp="subtitlu">${esc(d.subtitlu)}</p>`,
    '<ul class="lp-beneficii">',
    ...[1, 2, 3].map((i) => `<li>${BIFA}<span data-lp-camp="beneficiu_${i}">${esc(d['beneficiu_' + i])}</span></li>`),
    '</ul>',
    `<a class="lp-buton" id="lp-cta" href="${esc(L.destinatie(p))}" data-cta="principal" ${cta}><span data-cta-text data-lp-camp="buton">${esc(d.buton)}</span></a>`,
    `<p class="lp-sub-buton" data-lp-camp="sub_buton">${esc(d.sub_buton)}</p>`,
    '</div>',
    '</section>',
    scriptDupaErou(),
  ].join('\n');
}

function pasi(lista) {
  return '<ol class="lp-pasi lp-card">\n' + lista.map((t, i) => `<li><span class="lp-nr" aria-hidden="true">${i + 1}</span><span>${esc(t)}</span></li>`).join('\n') + '\n</ol>';
}
const IMAGINE = '<figure class="lp-imagine" data-lp-imagine hidden><img alt="" loading="lazy" decoding="async" fetchpriority="low"></figure>';

function sub(p) {
  if (p.tip === 'hub') {
    return [
      '<section class="lp-sec" id="tipuri" aria-labelledby="lp-tipuri-titlu">',
      '<h2 class="lp-h2" id="lp-tipuri-titlu">Alege tipul tău de partener</h2>',
      '<div class="lp-categorii">',
      ...L.CATEGORII.map((c) => `<a class="lp-cat" id="tip-${esc(c.categorie)}" href="${esc(c.cale)}" data-cta="categorie-${esc(c.categorie)}" data-ico="${esc(c.ico)}" data-lp-transmite>` +
        `<span class="lp-cat-ico" aria-hidden="true">${ico(c.ico)}</span><span class="lp-cat-text"><span class="lp-cat-titlu">${esc(c.ro[0])}</span><span class="lp-cat-desc">${esc(c.ro[1])}</span></span>` +
        '<span class="lp-cat-sageata" aria-hidden="true">›</span></a>'),
      '</div>',
      `<p class="lp-nota">${ELIGIBILITATE}</p>`,
      '<a class="lp-link" href="/parteneri/intrebari" data-lp-transmite>Întrebări frecvente pentru parteneri →</a>',
      '</section>',
      '</main>',
    ].join('\n');
  }
  if (p.tip === 'investitori') {
    return [
      '<section class="lp-sec lp-runda" id="runda" aria-labelledby="runda-titlu" hidden>',
      '<div class="lp-card"><h2 class="lp-runda-titlu" id="runda-titlu">Runda curentă</h2><div class="inv-runda-card" data-runda hidden></div></div>',
      '</section>',
      '<section class="lp-sec" id="cum-functioneaza" aria-labelledby="cum-titlu">',
      '<h2 class="lp-h2" id="cum-titlu">Cum devii investitor</h2>',
      pasi(p.pasi.ro),
      '</section>',
    ].join('\n');
  }
  return [
    '<section class="lp-sec" id="cum-functioneaza" aria-labelledby="lp-cum-titlu">',
    IMAGINE,
    '<h2 class="lp-h2" id="lp-cum-titlu">Cum funcționează</h2>',
    pasi(p.pasi.ro),
    `<p class="lp-nota">${ELIGIBILITATE}</p>`,
    `<a class="lp-link" href="/parteneri/intrebari#${ANCORA_FAQ[p.categorie]}" data-lp-transmite>Întrebări frecvente pentru parteneri →</a>`,
    '</section>',
    '</main>',
  ].join('\n');
}

function cap(p) {
  return [scriptCap(p.cale), '<link rel="stylesheet" href="/landing.css">', '<script src="/landing.js" defer></script>'].join('\n');
}

// ── Traducerile EN ale textelor generate ─────────────────────────────────
function traduceri(p) {
  const t = {};
  L.CAMPURI_TEXT.forEach((k) => { if (p.implicit.ro[k]) t[p.implicit.ro[k]] = p.implicit.en[k]; });
  if (p.pasi) p.pasi.ro.forEach((ro, i) => { t[ro] = p.pasi.en[i]; });
  if (p.tip === 'hub') L.CATEGORII.forEach((c) => { t[c.ro[0]] = c.en[0]; t[c.ro[1]] = c.en[1]; });
  const tot = Object.assign({}, FIXE);
  Object.keys(tot).forEach((k) => {
    const unde = { [ELIGIBILITATE]: p.tip !== 'investitori', 'Cum funcționează': p.tip === 'categorie', 'Întrebări frecvente pentru parteneri →': p.tip !== 'investitori', 'Alege tipul tău de partener': p.tip === 'hub', 'Runda curentă': p.tip === 'investitori', 'Cum devii investitor': p.tip === 'investitori' };
    if (!unde[k]) delete tot[k];
  });
  return Object.assign(tot, t);
}

// ── Înlocuirile ─────────────────────────────────────────────────────────
function inlocuiesteZona(html, nume, continut, laPrimaRulare) {
  const ini = `<!-- lp:${nume}:inceput -->`, sf = `<!-- lp:${nume}:sfarsit -->`;
  const bloc = `${ini}\n${continut}\n${sf}`;
  const a = html.indexOf(ini), b = html.indexOf(sf);
  if (a !== -1 && b > a) return html.slice(0, a) + bloc + html.slice(b + sf.length);
  if (!laPrimaRulare) throw new Error(`zona lp:${nume} lipsește`);
  return laPrimaRulare(html, bloc);
}

// Prima rulare pe paginile de partener: blocul vechi <div class="rp">…</div> (11-R3g) → zonele noi.
function blocVechiPartener(html, bloc) {
  const start = html.indexOf('<div class="rp">');
  const footer = html.indexOf('<footer');
  if (start === -1 || footer === -1 || footer < start) throw new Error('blocul .rp nu s-a găsit');
  const inchidere = html.lastIndexOf('</div>', footer);
  let inceput = start;
  // Comentariul 11-R3g de deasupra blocului (descria șablonul vechi).
  const com = html.lastIndexOf('<!-- ════ Pasul 11-R3g', start);
  if (com !== -1 && html.slice(com, start).indexOf('-->') !== -1 && !/<(section|div|main)\b/.test(html.slice(html.indexOf('-->', com) + 3, start))) inceput = com;
  return html.slice(0, inceput) + bloc + html.slice(inchidere + '</div>'.length);
}

function capVechi(html, bloc) {
  const m = /<script src="\/i18n-loader\.js"[^>]*><\/script>/.exec(html);
  if (!m) throw new Error('i18n-loader.js lipsește din <head>');
  return html.slice(0, m.index + m[0].length) + '\n' + bloc + html.slice(m.index + m[0].length);
}

function curataCap(html, p) {
  let h = html;
  h = h.replace('<script src="https://cdn.tailwindcss.com"></script>', '<link rel="stylesheet" href="/landing-tailwind.css">');
  h = h.replace(/<script>(?:if\(typeof tailwind!=="undefined"\)\{)?tailwind\.config=[\s\S]*?<\/script>\r?\n?/, '');
  h = h.replace('<script src="https://cdn.jsdelivr.net/npm/lucide@0.263.0/dist/umd/lucide.min.js"></script>', '<script src="https://cdn.jsdelivr.net/npm/lucide@0.263.0/dist/umd/lucide.min.js" defer></script>');
  h = h.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/dompurify@3\.1\.6\/dist\/purify\.min\.js"><\/script>/, '<script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js" defer></script>');
  h = h.replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Syne[^"]*" rel="stylesheet">\n?/, '');
  // Apelurile directe din scripturile paginii: Lucide e acum defer (landing.js desenează iconițele).
  h = h.replace(/^lucide\.createIcons\(\);$/m, 'if (window.lucide) lucide.createIcons();');
  if (p.tip !== 'investitori') {
    h = h.replace(/<link rel="stylesheet" href="\/ruta-partener\.css">\n?/, '');
    h = h.replace(/<script src="\/ruta-partener\.js" defer><\/script>\n?/, '');
  }
  return h;
}

function genereaza(p) {
  const fis = path.join(RADACINA, p.fisier + '.html');
  const vechi = fs.readFileSync(fis, 'utf8');
  let h = curataCap(vechi, p);
  h = inlocuiesteZona(h, 'cap', cap(p), capVechi);
  if (p.tip === 'investitori') {
    // Pe /investitori zonele se pun o dată, de mână (restul paginii rămâne).
    h = inlocuiesteZona(h, 'erou', erou(p));
    h = inlocuiesteZona(h, 'sub', sub(p));
  } else {
    const ambele = (html, bloc) => blocVechiPartener(html, bloc + '\n<!-- lp:sub:inceput -->\n<!-- lp:sub:sfarsit -->');
    h = inlocuiesteZona(h, 'erou', erou(p), ambele);
    h = inlocuiesteZona(h, 'sub', sub(p));
  }
  // Dicționarul EN al paginii.
  const fd = path.join(RADACINA, 'i18n', 'en', p.fisier + '.json');
  const dict = JSON.parse(fs.readFileSync(fd, 'utf8'));
  dict._texte = dict._texte || {};
  const noi = traduceri(p);
  let dictSchimbat = false;
  Object.entries(noi).forEach(([ro, en]) => { if (dict._texte[ro] !== en) { dict._texte[ro] = en; dictSchimbat = true; } });
  return { fis, vechi, nou: h, fd, dict, dictSchimbat };
}

function ruleaza() {
  let deScris = 0;
  for (const p of L.PAGINI) {
    const r = genereaza(p);
    const schimbat = r.vechi !== r.nou || r.dictSchimbat;
    if (!schimbat) continue;
    deScris++;
    if (VERIFICA) { console.log(`✗ ${p.cale}: ${r.vechi !== r.nou ? p.fisier + '.html' : 'i18n/en/' + p.fisier + '.json'} nu e la zi — rulați node scripts/genereaza-pagini-destinatie.js`); continue; }
    if (r.vechi !== r.nou) fs.writeFileSync(r.fis, r.nou);
    if (r.dictSchimbat) fs.writeFileSync(r.fd, JSON.stringify(r.dict, null, 1) + '\n');
    console.log(`✓ ${p.cale} → ${p.fisier}.html`);
  }
  if (VERIFICA) { if (deScris) process.exit(1); console.log('Paginile de destinație sunt la zi.'); }
  else if (!deScris) console.log('Nimic de schimbat.');
}

if (require.main === module) ruleaza();

module.exports = { scriptCap, scriptDupaErou, traduceri, erou, sub, genereaza };
