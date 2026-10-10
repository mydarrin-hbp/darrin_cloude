// scripts/detector-ro.js — detectorul de română pentru paginile publice (10 oct. 2026).
//
// Deschide fiecare pagină publică cu localStorage gol (prima vizită → engleză)
// și raportează, pe fiecare pagină și lățime:
//   - lang-ul paginii;
//   - textele românești vizibile (diacritice și cuvinte frecvente), inclusiv în
//     placeholder / title / aria-label / alt, titlu și meta description — cu
//     selector; numele proprii, orașele și adresele sunt excluse;
//   - chei netraduse afișate (ex. nav.contact);
//   - erori JS, depășiri pe orizontală, butoane / intrări de meniu ieșite din chenar;
//   - aceleași verificări cu meniul lateral, fereastra de cont și preferințele
//     cookie deschise.
// LIMBA=ro rulează testul inversat (selector → română: doar chei netraduse,
// erori și depășiri).
//
// Cerințe: un server local care servește site-ul cu /api (ex. `vercel dev`) și
// Playwright instalat separat (nu e dependență a proiectului):
//   npm i --no-save playwright && npx playwright install chromium
//
// Utilizare:
//   node scripts/detector-ro.js [--base http://localhost:3000] [--latimi 390,1366]
//                               [--out ./detector-out] [pagina ...]
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const PUBLICE = ['index', 'servicii-urgente', 'despre-noi', 'afla-ce-facem', 'mydarrin-contact', 'mydarrin-app-mobile',
  'mydarrin-catalog', 'mydarrin-categorie-servicii.html?type=servicii&cat=instalatii-electrice', 'mydarrin-categorie-materiale',
  'mydarrin-categorie-inchirieri', 'mydarrin-marketplace', 'mydarrin-marketplace-materiale.html?slug=montaj-parchet-laminat&type=servicii&nace=43.33',
  'mydarrin-produs.html?slug=inlocuire-becuri-corpuri&type=servicii', 'mydarrin-serviciu', 'mydarrin-checkout', 'mydarrin-cos',
  'mydarrin-creeaza-deviz', 'confirmare-livrare', 'reset-password', 'mydarrin-cum-functioneaza', 'cum-comanzi', 'cum-platesc',
  'cum-programez-serviciu', 'cum-prestam-livram', 'intrebari-frecvente-clienti', 'intrebari-frecvente-parteneri',
  'garantii-si-asigurari', 'ghidul-asiguratorului', 'reclamatii', 'mydarrin-devino-partener', 'mydarrin-devino-partener-wizard',
  'cum-devii-partenerul-nostru', 'cum-devii-curier-de-cartier', 'cum-devii-furnizor-materiale', 'cum-devii-operator-inchirieri',
  'mydarrin-investitori', 'mydarrin-pitch-deck', 'acord-confidentialitate', 'acces-temporar', 'mydarrin-termeni',
  'mydarrin-politica-confidentialitate'];

const arg = process.argv.slice(2);
const opt = (n, d) => { const i = arg.indexOf('--' + n); if (i === -1) return d; const v = arg[i + 1]; arg.splice(i, 2); return v; };
const BASE = opt('base', 'http://localhost:3000');
const latimi = opt('latimi', '390,1366').split(',').map(Number);
const OUT = opt('out', path.join(process.cwd(), 'detector-out'));
const pagini = arg.length ? arg : PUBLICE;
const LIMBA = process.env.LIMBA || 'en';
fs.mkdirSync(OUT, { recursive: true });

function detecteaza(limba) {
  const EXCEPTII = /\b(My Darrin|Darrin AI|Darrin|Home Best Pal|SRL|LTD|București|Bucureşti|Iași|Chișinău|Cluj-Napoca|Timișoara|Constanța|Brașov|Bacău|Galați|Ploiești|Pitești|Târgu(?: Mureș| Neamț| Jiu)?|Brăila|Botoșani|Buzău|Focșani|Târgoviște|Reșița|Bistrița|Călărași|Zalău|Sfântu Gheorghe|Bârlad|Mediaș|Onești|Piatra Neamț|Râmnicu Vâlcea|Neamț|România|Română|Ελληνικά|Български|Türkçe|Français|Deutsch|Magyar|Polski|Sector \d|Păcurari|Str\.|Strada|Bd\.|Calea|nr\.|jud\.|Județul \w+|Mureș)\b/g;
  // cuvinte lungi: indiferent de majuscule; scurte: doar cu literă mică (DE, LA, AL pot fi coduri)
  const RO_CUV = /(?<!\p{L})(?:(?:[Pp]entru|[Ss]erviciu|[Ss]ervicii|[Cc]omandă|[Cc]omenzi|[Pp]reț|[Pp]rețuri|[Aa]lege|[Vv]ezi|[Dd]espre|[Cc]ont|[Cc]oș|[Cc]ătre|[Uu]rmător|[Îî]napoi|[Aa]casă|[Ll]ucrare|[Ll]ucrări|[Nn]ivel|[Gg]aranție|[Pp]lată|[Nn]ostru|[Nn]oastră|[Ee]ste|[Ss]unt|[Gg]ratuit|[Gg]ratuită|[Ll]ivrare|[Cc]erere|[Ss]olicită|[Ss]olicitare|[Zz]onă|[Pp]arteneri|[Cc]lienți|[Ii]nclus|[Aa]daugă|[Oo]rice|[Mm]inim|[Tt]arif|[Ll]ună|[Zz]ile|[Oo]ră|[Oo]re|[Mm]anoperă|[Ee]chipă|[Ii]ntervenție)|(?:și|sau|ți|tău|noi|din|cu|la|de|pe|în|un|al|ale))(?!\p{L})/u;
  const DIAC = /[ăâîșțşţĂÂÎȘȚŞŢ]/;
  const H = innerHeight, W = innerWidth;
  const vizibil = (el) => { if (!el) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const sel = (el) => { const p = []; for (let e = el; e && e.nodeType === 1 && p.length < 4; e = e.parentElement) { let s = e.tagName.toLowerCase(); if (e.id) { s += '#' + e.id; p.unshift(s); break; } const c = (typeof e.className === 'string' ? e.className : '').trim().split(/\s+/).filter((x) => x && !/[:\[\]/]/.test(x))[0]; if (c) s += '.' + c; p.unshift(s); } return p.join(' > '); };
  const eRo = (t) => {
    const cur = t.replace(EXCEPTII, ' ');
    if (limba === 'ro') return false;
    return DIAC.test(cur) || RO_CUV.test(cur);
  };
  const gasite = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => { const pe = n.parentElement; if (!pe || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(pe.tagName)) return NodeFilter.FILTER_REJECT; return n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });
  while (w.nextNode()) {
    const n = w.currentNode, t = n.data.replace(/\s+/g, ' ').trim();
    if (!vizibil(n.parentElement)) continue;
    if (n.parentElement.closest('[translate="no"],.notranslate,[data-i18n-skip],code,pre,textarea')) continue;
    if (eRo(t)) gasite.push({ sel: sel(n.parentElement), text: t.slice(0, 160) });
    if (/^[a-z]+(\.[a-z_0-9]+){1,4}$/.test(t) && !/\.(com|ro|md|eu|net|org)$/.test(t)) gasite.push({ sel: sel(n.parentElement), text: 'CHEIE NETRADUSĂ: ' + t });
  }
  document.querySelectorAll('[placeholder],[title],[aria-label],img[alt]').forEach((el) => {
    if (!vizibil(el) && el.tagName !== 'IMG') return;
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) { const v = el.getAttribute(a); if (v && eRo(v)) gasite.push({ sel: sel(el) + '[' + a + ']', text: v.slice(0, 160) }); }
  });
  if (eRo(document.title)) gasite.push({ sel: 'title', text: document.title });
  const md = document.querySelector('meta[name="description"]'); if (md && eRo(md.content || '')) gasite.push({ sel: 'meta[description]', text: md.content.slice(0, 160) });
  // butoane / linkuri de meniu al căror text iese din chenar
  const rupte = [];
  document.querySelectorAll('button, a.sb-item, nav a, .nav-lnk, #mobile-bottom-nav a, #mobile-bottom-nav button').forEach((b) => {
    if (!vizibil(b)) return; const r = b.getBoundingClientRect(); if (r.width < 20) return;
    if (b.scrollWidth > b.clientWidth + 2 && getComputedStyle(b).overflow !== 'visible') rupte.push(sel(b) + ' «' + b.innerText.trim().slice(0, 30) + '»');
    if (r.right > W + 1 && r.left < W - 1 && r.left >= 0) rupte.push('iese din ecran: ' + sel(b) + ' «' + b.innerText.trim().slice(0, 30) + '»');
  });
  return { lang: document.documentElement.lang, sw: document.documentElement.scrollWidth, W, gasite, rupte: [...new Set(rupte)].slice(0, 20) };
}

(async () => {
  const b = await chromium.launch();
  const total = [];
  for (const w of latimi) {
    for (const pg of pagini) {
      const cfg = w < 800 ? { ...devices['iPhone 13'], viewport: { width: w, height: 844 } } : { viewport: { width: w, height: 900 } };
      const ctx = await b.newContext({ ...cfg, locale: 'en-GB' });
      await ctx.addInitScript((l) => { try { if (!sessionStorage.getItem('__init')) { localStorage.clear(); if (l !== 'en') localStorage.setItem('myd_lang_v1', l); sessionStorage.setItem('__init', '1'); } } catch (e) {} }, LIMBA);
      const p = await ctx.newPage();
      const erori = []; p.on('pageerror', (e) => erori.push(e.message.slice(0, 120)));
      await p.route('**/api/comenzi/**', (r) => r.fulfill({ status: 599, body: '{}' }));
      await p.goto(BASE + '/' + pg + (pg.includes('?') ? '' : '.html'), { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
      await p.waitForTimeout(2500);
      await p.waitForFunction(() => !document.documentElement.classList.contains('myd-i18n-pending'), null, { timeout: 5000 }).catch(() => {});
      await p.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); } scrollTo(0, 0); }).catch(() => {});
      await p.waitForTimeout(600);
      const r = await p.evaluate(detecteaza, LIMBA).catch((e) => ({ eroare: e.message }));
      // Stări ascunse: meniul lateral, fereastra de cont, preferințele cookie.
      for (const [nume, deschide, inchide] of [
        ['meniu', 'typeof openSidebar==="function"&&(openSidebar(),true)', 'typeof closeSidebar==="function"&&closeSidebar()'],
        ['cont', 'typeof toggleAuthModal==="function"&&(toggleAuthModal(),true)', 'typeof toggleAuthModal==="function"&&toggleAuthModal()'],
        ['cookie', '(()=>{const b=[...document.querySelectorAll("#myd-consent-bar button")].find(x=>/Customise|Personalizează/.test(x.textContent));if(b){b.click();return true}return false})()', ''],
      ]) {
        const url0 = p.url();
        const ok = await p.evaluate(deschide).catch(() => false);
        if (!ok) continue;
        await p.waitForTimeout(700);
        // butonul a dus pe altă pagină (ex. „Cont” fără fereastră → index): nu e o stare a acestei pagini
        if (p.url() !== url0) { await p.goto(url0, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1500); continue; }
        const s = await p.evaluate(detecteaza, LIMBA).catch(() => null);
        if (s && r.gasite) s.gasite.forEach((g) => r.gasite.push({ sel: '[' + nume + '] ' + g.sel, text: g.text }));
        if (inchide) await p.evaluate(inchide).catch(() => {});
        await p.waitForTimeout(300);
      }
      await p.screenshot({ path: path.join(OUT, `${LIMBA}_${pg.replace(/[?=&]/g, '_')}_${w}.png`) }).catch(() => {});
      total.push({ pg, w, ...r, erori });
      await ctx.close();
    }
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, `detector-${LIMBA}.json`), JSON.stringify(total, null, 1));
  for (const r of total) {
    const unice = [...new Map((r.gasite || []).map((g) => [g.text, g])).values()];
    console.log(`${r.pg.split('?')[0].padEnd(36)} ${String(r.w).padEnd(5)} lang=${r.lang} romana=${unice.length} depasire=${r.sw > r.W ? r.sw + '/' + r.W : 0} rupte=${(r.rupte || []).length} erori=${r.erori.length}`);
    unice.forEach((g) => console.log('    română: «' + g.text + '» ⟨' + g.sel + '⟩'));
  }
  const totalRo = total.reduce((s, r) => s + new Set((r.gasite || []).map((g) => g.text)).size, 0);
  console.log(`
TOTAL texte românești (${LIMBA}): ${totalRo} · pagini × lățimi: ${total.length}`);
  process.exitCode = totalRo ? 1 : 0;
})();
