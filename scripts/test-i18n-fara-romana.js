// scripts/test-i18n-fara-romana.js
// Pasul 11-T0 (11 nov. 2026): traducerea timpurie din i18n-loader.js, fără română în modul EN.
// Rulează în modul EN (prima vizită, localStorage gol) pe toate paginile publice care
// includ i18n-loader.js (lista se calculează din fișiere, vezi paginiPublice):
//   A. 0 cadre cu text în română vizibil, eșantionat la fiecare cadru (requestAnimationFrame)
//      de la început până la 3 s, cu rețeaua lentă simulată (Fast 4G) și dicționarele
//      întârziate artificial (1.200 ms); evenimentul myd:lang o singură dată, după
//      DOMContentLoaded; titlul paginii tradus; la 390 și 1366 px;
//   B. cu dicționarele la timp și DOMContentLoaded întârziat (un script sincron de 2 s la
//      sfârșitul paginii), pagina devine vizibilă înainte de DOMContentLoaded, tot fără română;
//   C. cu dicționarele indisponibile (cererea eșuează), pagina se afișează la prag
//      (3.000 ms), nu rămâne goală, iar în consolă apare avertismentul [MYD i18n];
//   D. modul RO și paginile interne: pagina nu se ascunde niciodată, nimic nu se traduce;
//   E. fișierul: pragul de 3.000 ms și comportamentul sunt descrise în antet.
//
// „Vizibil”: <body> cu opacitate (pagina nu mai e ascunsă), elementul trece de
// checkVisibility (display, visibility, opacitatea strămoșilor) și are o dimensiune,
// fără elementele aflate complet deasupra paginii sau în afara ei pe orizontală (ex.
// linkul „Sari la conținut”, la top: -100px). Textele de sub ecran se numără și ele.
// Recunoașterea românei e aceeași ca în scripts/detector-ro.js (diacritice + cuvinte
// frecvente, fără nume proprii, orașe și adrese).
//
// Rulare: node scripts/test-i18n-fara-romana.js [pagina ...]
//   PARALEL=4 (implicit) — câte pagini deodată;
//   LOADER_REF=main — servește i18n-loader.js din alt commit (testul trebuie să cadă pe main).

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const RADACINA = path.join(__dirname, '..');
const citeste = (f) => fs.readFileSync(path.join(RADACINA, f), 'utf8');
let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

const INTARZIERE_DICT = 1200;
const INTARZIERE_DCL = 2000;
const PRAG = 3000;
const PARALEL = Number(process.env.PARALEL || 4);
// LOADER_REF=main: loader-ul din alt commit (verifică dacă testul prinde problema din main).
const LOADER_ALT = process.env.LOADER_REF ? require('child_process').execSync(`git show ${process.env.LOADER_REF}:i18n-loader.js`, { cwd: RADACINA, encoding: 'utf8' }) : null;
// Fast 4G, ca în Chrome DevTools: 9 Mbit/s, 1,5 Mbit/s, 165 ms.
const FAST_4G = { offline: false, latency: 165, downloadThroughput: (9 * 1024 * 1024) / 8 * 0.9, uploadThroughput: (1.5 * 1024 * 1024) / 8 * 0.9 };

// Paginile cu cont (detector-ro --cu-cont) și cele care doar redirecționează nu sunt publice.
const CU_CONT = ['mydarrin-dashboard-client', 'mydarrin-dashboard-partener', 'mydarrin-dashboard-furnizor',
  'mydarrin-devino-partener-wizard', 'mydarrin-admin-catalog', 'mydarrin-rolurile-mele', 'mydarrin-panou-investitor'];
const INTERNE = /^mydarrin-(superadmin|backoffice-serviciu|deviz-engine|auth-schema|sync-architecture|business-model|design-system)$/;
const ADRESE = { index: '/', 'mydarrin-produs': '/mydarrin-produs?slug=inlocuire-becuri-corpuri&type=servicii' };

function paginiPublice() {
  return fs.readdirSync(RADACINA).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5)).filter((p) => {
    const s = citeste(p + '.html');
    if (!/<script src="\/?i18n-loader\.js"/.test(s)) return false;
    if (INTERNE.test(p) || CU_CONT.includes(p) || /<html[^>]*data-i18n-off/.test(s)) return false;
    // redirect: location.replace sau meta refresh
    return !/location\.replace\(|http-equiv="refresh"/.test(s);
  }).sort();
}

// ── În pagină, de la primul octet ─────────────────────────────────────────
function urmareste(o) {
  try {
    if (!sessionStorage.getItem('__init')) {
      localStorage.clear();
      if (o.lang !== 'en') localStorage.setItem('myd_lang_v1', o.lang);
      sessionStorage.setItem('__init', '1');
    }
  } catch (e) {}
  // Aceleași excepții ca în detector-ro.js, cu limite Unicode: \b nu recunoaște
  // sfârșitul cuvântului după „ă” (ex. „Română” din selectorul de limbă).
  const EXCEPTII = /(?<!\p{L})(My Darrin|Darrin AI|Darrin|Home Best Pal|SRL|LTD|București|Bucureşti|Iași|Chișinău|Cluj-Napoca|Timișoara|Constanța|Brașov|Bacău|Galați|Ploiești|Pitești|Târgu(?: Mureș| Neamț| Jiu)?|Brăila|Botoșani|Buzău|Focșani|Târgoviște|Reșița|Bistrița|Călărași|Zalău|Sfântu Gheorghe|Bârlad|Mediaș|Onești|Piatra Neamț|Râmnicu Vâlcea|Neamț|România|Română|Ελληνικά|Български|Türkçe|Français|Deutsch|Magyar|Polski|Sector \d|Păcurari|Str\.|Strada|Bd\.|Calea|nr\.|jud\.|Județul \p{L}+|Mureș)(?!\p{L})/gu;
  const RO_CUV = /(?<!\p{L})(?:(?:[Pp]entru|[Ss]erviciu|[Ss]ervicii|[Cc]omandă|[Cc]omenzi|[Pp]reț|[Pp]rețuri|[Aa]lege|[Vv]ezi|[Dd]espre|[Cc]ont|[Cc]oș|[Cc]ătre|[Uu]rmător|[Îî]napoi|[Aa]casă|[Ll]ucrare|[Ll]ucrări|[Nn]ivel|[Gg]aranție|[Pp]lată|[Nn]ostru|[Nn]oastră|[Ee]ste|[Ss]unt|[Gg]ratuit|[Gg]ratuită|[Ll]ivrare|[Cc]erere|[Ss]olicită|[Ss]olicitare|[Zz]onă|[Pp]arteneri|[Cc]lienți|[Ii]nclus|[Aa]daugă|[Oo]rice|[Mm]inim|[Tt]arif|[Ll]ună|[Zz]ile|[Oo]ră|[Oo]re|[Mm]anoperă|[Ee]chipă|[Ii]ntervenție)|(?:și|sau|ți|tău|noi|din|cu|la|de|pe|în|un|al|ale))(?!\p{L})/u;
  const DIAC = /[ăâîșțşţĂÂÎȘȚŞŢ]/;
  const eRo = (t) => { const c = t.replace(EXCEPTII, ' '); return DIAC.test(c) || RO_CUV.test(c); };
  const T = window.__t = { cadre: 0, cadreVizibile: 0, cadreRo: 0, exemple: [], ascunsLa: null, reveal: null, dcl: null, lang: [], primulCadru: null, textOriginal: null };
  // Momentul în care pagina devine vizibilă: clasa myd-i18n-pending dispare.
  // Scriptul rulează înainte să existe <html>: observatorul stă pe document.
  new MutationObserver(() => {
    const root = document.documentElement;
    if (!root) return;
    const p = root.classList.contains('myd-i18n-pending');
    if (p && T.ascunsLa == null) T.ascunsLa = performance.now();
    if (!p && T.ascunsLa != null && T.reveal == null) T.reveal = performance.now();
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('DOMContentLoaded', () => {
    T.dcl = performance.now();
    const h = document.querySelector('h1');
    T.textOriginal = h ? h.textContent.trim().slice(0, 80) : null;
  });
  window.addEventListener('myd:lang', (e) => T.lang.push({ t: performance.now(), lang: e.detail && e.detail.lang, dcl: T.dcl != null }));
  if (!o.esantioneaza) return;
  const vizibil = (el) => {
    if (!el || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.left < innerWidth;
  };
  const sari = (el) => el.closest('[translate="no"],.notranslate,[data-i18n-skip],code,pre,textarea');
  function cadru() {
    const acum = performance.now();
    T.cadre++;
    if (T.primulCadru == null) T.primulCadru = acum;
    const b = document.body;
    if (b && !document.documentElement.classList.contains('myd-i18n-pending') && getComputedStyle(b).opacity !== '0') {
      T.cadreVizibile++;
      const gasite = [];
      const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, { acceptNode: (n) => { const pe = n.parentElement; if (!pe || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(pe.tagName)) return NodeFilter.FILTER_REJECT; return /\S/.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });
      while (w.nextNode() && gasite.length < 3) {
        const n = w.currentNode, t = n.data.replace(/\s+/g, ' ').trim();
        if (eRo(t) && !sari(n.parentElement) && vizibil(n.parentElement)) gasite.push(t.slice(0, 80));
      }
      if (gasite.length < 3) {
        for (const el of b.querySelectorAll('input[placeholder],textarea[placeholder],input[type=button],input[type=submit]')) {
          const v = el.getAttribute('placeholder') || el.value || '';
          if (v && eRo(v) && vizibil(el)) { gasite.push('[' + v.slice(0, 60) + ']'); if (gasite.length >= 3) break; }
        }
      }
      if (gasite.length) { T.cadreRo++; if (T.exemple.length < 3) T.exemple.push(Math.round(acum) + ' ms: ' + gasite.join(' | ')); }
    }
    if (acum < o.pana) requestAnimationFrame(cadru);
    else T.gata = true;
  }
  requestAnimationFrame(cadru);
}

// Titlul și textul de la final (după 3 s), cu aceeași recunoaștere.
function stareFinala() {
  const b = document.body;
  return {
    titlu: document.title,
    vizibila: !document.documentElement.classList.contains('myd-i18n-pending') && !!b && getComputedStyle(b).opacity !== '0',
    text: ((b && b.innerText) || '').replace(/\s+/g, ' ').trim().length,
    h1: (document.querySelector('h1') || { textContent: '' }).textContent.trim().slice(0, 80),
  };
}
const TITLU_RO = (t) => /[ăâîșțşţĂÂÎȘȚŞŢ]/.test(t.replace(/România|Română/g, '')) || /(?<!\p{L})(pentru|și|servicii|comandă|cum|devii|despre)(?!\p{L})/iu.test(t);

async function deschide(browser, baza, pagina, o) {
  const ctx = await browser.newContext({ viewport: { width: o.w, height: o.w < 800 ? 844 : 900 }, locale: 'en-GB' });
  await ctx.addInitScript(urmareste, { lang: o.lang || 'en', esantioneaza: !!o.esantioneaza, pana: o.pana || PRAG });
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  if (LOADER_ALT) await ctx.route((u) => u.origin === baza && u.pathname === '/i18n-loader.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: LOADER_ALT }));
  if (o.proba) await ctx.route((u) => u.origin === baza && u.pathname === '/' + pagina, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: o.proba }));
  await ctx.route(/ipapi\.co|nominatim|googletagmanager|google-analytics/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  if (o.dictionare === 'intarziate') {
    await ctx.route(/\/i18n\/.+\.json(\?|$)/, async (r) => { await new Promise((a) => setTimeout(a, INTARZIERE_DICT)); r.continue().catch(() => {}); });
  } else if (o.dictionare === 'indisponibile') {
    await ctx.route(/\/i18n\/.+\.json(\?|$)/, (r) => r.abort('failed'));
  }
  if (o.dclIntarziat) {
    await ctx.route(/\/intarziat-test\.js$/, async (r) => { await new Promise((a) => setTimeout(a, INTARZIERE_DCL)); r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.__intarziatRulat = true;' }); });
    await ctx.route((u) => u.origin === baza && !/\.[a-z0-9]+$/i.test(u.pathname.replace(/\.html$/, '')) && !u.pathname.startsWith('/api/') && !u.pathname.startsWith('/i18n/'), async (r) => {
      if (r.request().resourceType() !== 'document') return r.continue();
      const raspuns = await r.fetch();
      const html = (await raspuns.text()).replace(/<\/body>(?![\s\S]*<\/body>)/, '<script src="/intarziat-test.js"></script>\n</body>');
      r.fulfill({ response: raspuns, body: html, headers: { ...raspuns.headers(), 'content-type': 'text/html; charset=utf-8' } });
    });
  }
  const p = await ctx.newPage();
  if (o.retea) { const cdp = await ctx.newCDPSession(p); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', o.retea); }
  const avertismente = [], erori = [];
  // doar ale paginii deschise (acord-confidentialitate duce fără sesiune la /acces-temporar)
  const cale = (u) => { try { return new URL(u).pathname.replace(/\.html$/, ''); } catch (e) { return ''; } };
  p.on('console', (m) => { if (m.type() === 'warning' && cale(p.url()) ===cale(baza + (ADRESE[pagina] || '/' + pagina))) avertismente.push(m.text()); });
  p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
  const adresa = baza + (ADRESE[pagina] || '/' + pagina);
  await p.goto(adresa, { waitUntil: 'commit', timeout: 60000 });
  await p.waitForFunction((pana) => window.__t && performance.now() > pana + 100, o.pana || PRAG, { timeout: 30000, polling: 100 });
  if (o.dclIntarziat) await p.waitForFunction(() => window.__t && window.__t.dcl != null, null, { timeout: 30000 });
  await p.waitForTimeout(200);
  const t = await p.evaluate(() => window.__t);
  const f = await p.evaluate(stareFinala);
  await ctx.close();
  return { t, f, avertismente, erori };
}

async function inParalel(lista, fn) {
  const rez = new Array(lista.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(PARALEL, lista.length) }, async () => {
    while (i < lista.length) { const k = i++; rez[k] = await fn(lista[k]); }
  }));
  return rez;
}

function fisier() {
  console.log('E. Fișierul i18n-loader.js');
  const s = citeste('i18n-loader.js');
  const antet = s.slice(0, s.indexOf('(function ()'));
  verifica(/MAX_ASTEPTARE = 3000/.test(s), 'pragul MAX_ASTEPTARE = 3000');
  verifica(/3000 ms/.test(antet) && /avertisment/.test(antet) && /DOMContentLoaded/.test(antet), 'pragul și comportamentul la eroare sunt descrise în antet');
  verifica(!/dupaDom\(function \(\) \{\s*gata = true;/.test(s), 'traducerea mai așteaptă DOMContentLoaded');
  verifica(/porneste\(\);\s*\n/.test(s) && !/if \(observator \|\| !document\.body\)/.test(s), 'observatorul pornește imediat, fără să aștepte <body>');
  verifica(/observe\(document\.documentElement/.test(s), 'observatorul e pe document.documentElement');
}

module.exports = { urmareste, FAST_4G, paginiPublice };
if (require.main === module) (async () => {
  fisier();
  const toate = paginiPublice();
  const pagini = process.argv.slice(2).length ? process.argv.slice(2) : toate;
  console.log(`Pagini publice cu i18n-loader.js: ${toate.length}${pagini !== toate ? ` (rulez ${pagini.length})` : ''}`);
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const w of [390, 1366]) {
      console.log(`A. Fast 4G + dicționare întârziate ${INTARZIERE_DICT} ms, ${w} px: 0 cadre cu română`);
      const rez = await inParalel(pagini, (pg) => deschide(browser, baza, pg, { w, esantioneaza: true, dictionare: 'intarziate', retea: FAST_4G }));
      rez.forEach(({ t, f, erori }, k) => {
        const pg = pagini[k];
        verifica(t.cadreRo === 0, `${pg} ${w}: ${t.cadreRo} cadre cu română din ${t.cadreVizibile} vizibile — ${t.exemple.join(' ‖ ')}`);
        verifica(t.cadre > 20 && t.cadreVizibile > 0, `${pg} ${w}: eșantionare insuficientă (${t.cadre} cadre, ${t.cadreVizibile} vizibile)`);
        verifica(t.ascunsLa != null && t.reveal != null && t.reveal >= INTARZIERE_DICT, `${pg} ${w}: afișată la ${t.reveal && Math.round(t.reveal)} ms, înainte de dicționare`);
        verifica(f.vizibila && f.text > 40, `${pg} ${w}: pagina nu e vizibilă la final (${f.text} caractere)`);
        verifica(!TITLU_RO(f.titlu), `${pg} ${w}: titlul în română: „${f.titlu}”`);
        verifica(t.lang.length === 1 && t.lang[0].lang === 'en' && t.lang[0].dcl, `${pg} ${w}: myd:lang ${JSON.stringify(t.lang)}`);
        verifica(!erori.length, `${pg} ${w}: erori JS: ${erori.join(' | ')}`);
      });
    }

    console.log(`B. Dicționare la timp, DOMContentLoaded întârziat ${INTARZIERE_DCL} ms: vizibilă înainte de DOMContentLoaded`);
    {
      const rez = await inParalel(pagini, (pg) => deschide(browser, baza, pg, { w: 1366, esantioneaza: true, dclIntarziat: true, pana: PRAG }));
      rez.forEach(({ t, erori }, k) => {
        const pg = pagini[k];
        verifica(t.dcl >= INTARZIERE_DCL, `${pg}: DOMContentLoaded nu a fost întârziat (${Math.round(t.dcl)} ms)`);
        verifica(t.reveal != null && t.reveal < t.dcl - 500, `${pg}: afișată la ${t.reveal && Math.round(t.reveal)} ms, DOMContentLoaded la ${Math.round(t.dcl)} ms`);
        verifica(t.cadreRo === 0, `${pg}: ${t.cadreRo} cadre cu română — ${t.exemple.join(' ‖ ')}`);
        verifica(t.lang.length === 1 && t.lang[0].dcl, `${pg}: myd:lang ${JSON.stringify(t.lang)}`);
        verifica(!erori.length, `${pg}: erori JS: ${erori.join(' | ')}`);
      });
    }

    console.log(`C. Dicționare indisponibile: afișată la prag (${PRAG} ms), cu avertisment`);
    {
      const rez = await inParalel(pagini, (pg) => deschide(browser, baza, pg, { w: 1366, dictionare: 'indisponibile', pana: PRAG + 600 }));
      rez.forEach(({ t, f, avertismente }, k) => {
        const pg = pagini[k];
        verifica(t.reveal != null && t.reveal >= PRAG - 50 && t.reveal < PRAG + 600, `${pg}: afișată la ${t.reveal && Math.round(t.reveal)} ms (prag ${PRAG})`);
        verifica(f.vizibila && f.text > 40, `${pg}: pagina a rămas goală (${f.text} caractere, vizibilă=${f.vizibila})`);
        verifica(avertismente.filter((a) => a.includes('[MYD i18n]')).length === 1, `${pg}: avertismentul [MYD i18n]: ${JSON.stringify(avertismente.filter((a) => a.includes('[MYD i18n]')))}`);
      });
    }

    console.log('D. Modul RO și paginile interne: fără ascundere, fără traducere');
    {
      const ro = ['index', 'mydarrin-catalog', 'mydarrin-investitori', 'cum-devii-partenerul-nostru'].filter((x) => pagini.includes(x));
      const rez = await inParalel(ro, (pg) => deschide(browser, baza, pg, { w: 1366, lang: 'ro', pana: 1500 }));
      rez.forEach(({ t, f }, k) => {
        verifica(t.ascunsLa == null, `${ro[k]} RO: pagina a fost ascunsă`);
        const titluFisier = (citeste(ro[k] + '.html').match(/<title>([^<]*)<\/title>/) || [])[1];
        // scriptul paginii poate completa titlul (catalog: „…, alocat de AI”); nu se traduce nimic
        const nrm = (x) => String(x || '').replace(/\s+/g, ' ').trim();
        verifica(nrm(f.h1).startsWith(nrm(t.textOriginal)), `${ro[k]} RO: textul s-a schimbat („${t.textOriginal}” → „${f.h1}”)`);
        verifica(!titluFisier || f.titlu === titluFisier.replace(/&amp;/g, '&').trim(), `${ro[k]} RO: titlul s-a schimbat („${titluFisier}” → „${f.titlu}”)`);
        verifica(t.lang.length === 1 && t.lang[0].lang === 'ro', `${ro[k]} RO: myd:lang ${JSON.stringify(t.lang)}`);
      });
      // Paginile interne: o cale din INTERNE și o pagină cu data-i18n-off (pagini de probă
      // servite de test; superadmin redirecționează fără cont).
      const proba = (atr) => `<!DOCTYPE html><html lang="ro"${atr}><head><meta charset="UTF-8"><script src="/i18n-loader.js"></script><title>Pagină internă de probă</title></head>`
        + '<body><h1>Servicii pentru casă</h1><p>Comandă acum un serviciu de la partenerii noștri și plătești după lucrare.</p></body></html>';
      for (const [cale, atr] of [['mydarrin-design-system', ''], ['proba-i18n-off', ' data-i18n-off']]) {
        const r = await deschide(browser, baza, cale, { w: 1366, pana: 1500, proba: proba(atr) });
        verifica(r.t.ascunsLa == null, `${cale} (intern, EN): pagina a fost ascunsă`);
        verifica(r.f.titlu === 'Pagină internă de probă' && r.f.h1 === 'Servicii pentru casă', `${cale}: textul s-a schimbat („${r.f.titlu}”, „${r.f.h1}”)`);
        verifica(r.t.lang.length === 1 && r.t.lang[0].lang === 'ro', `${cale}: myd:lang ${JSON.stringify(r.t.lang)}`);
      }
    }
  } finally { await browser.close(); srv.close(); }
  console.log(`\n${ok} verificări trecute, ${esec} eșuate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
