// scripts/test-ruta-partener.js
// Pasul 11-R3g (decizia LM, 3 nov. 2026): ruta „Devino partener” — o singură
// pagină-hub (cum-devii-partenerul-nostru.html) și un șablon comun pentru cele
// 5 pagini de tip (servicii, materiale, închirieri, curier, asigurător).
// Verifică:
//   - mydarrin-devino-partener(.html) → 301 spre hub, cu parametrii păstrați
//     (vercel.json + serverul de test cu redirecturi); /partener → hub;
//     niciun link intern spre vechea pagină (în afară de activare, neatinsă);
//   - pe hub și pe cele 5 pagini: hero-ul comun (.rp-hero, insigna „GRATUIT”,
//     h1 la 700, același font și aceeași mărime) și butonul principal cu
//     data-cta-partener și tipul corect;
//   - nicio apariție de „0 LEI”, „0 Lei”, „0 lei” pe paginile rutei, în
//     cta-partener.js și în dicționarele EN ale paginilor;
//   - „Creează cont” de pe fiecare card din hub deschide fereastra de cont pe
//     „Creare cont”, cu tipul bifat (care se poate schimba); butonul principal
//     al fiecărei pagini de tip, la fel;
//   - utilizator conectat: butoanele urmează starea contului (cta-partener.js),
//     nu deschid fereastra;
//   - „Configurează profilul” nu mai există;
//   - toate linkurile din hub și din paginile de tip răspund 200;
//   - la 360, 390, 768 × 1024, 1024 × 768 și 1366 px: fără derulare orizontală,
//     fără erori JS; pe telefon bara fixă nu acoperă butonul Darrin AI, bara de
//     jos sau ultimul conținut al paginii;
//   - în engleză: „FREE” în insignă, butoanele traduse.
// Cu --capturi <dosar>: hub-ul și pagina de materiale, la 390 și 1366 px.
// Rulare: node scripts/test-ruta-partener.js [--capturi <dosar>]

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const RADACINA = path.join(__dirname, '..');
const ECRANE = [[360, 740], [390, 844], [768, 1024], [1024, 768], [1366, 900]];
const iCapturi = process.argv.indexOf('--capturi');
const dosarCapturi = iCapturi !== -1 ? process.argv[iCapturi + 1] : null;

const HUB = 'cum-devii-partenerul-nostru.html';
// [pagina, tipul din data-cta-partener, rolul din fereastra de cont]
const PAGINI_TIP = [
  ['cum-devii-furnizor-servicii.html', 'servicii', 'partener_servicii'],
  ['cum-devii-furnizor-materiale.html', 'materiale', 'partener_materiale'],
  ['cum-devii-operator-inchirieri.html', 'inchirieri', 'partener_inchirieri'],
  ['cum-devii-curier-de-cartier.html', 'curier', 'partener_curier'],
  ['ghidul-asiguratorului.html', 'asigurari', 'partener_asigurari'],
];
const RUTA = [HUB].concat(PAGINI_TIP.map((x) => x[0]));
// Pagini publice pentru parteneri care vorbeau de cost („0 lei” → „GRATUIT”).
const CU_COST = RUTA.concat(['mydarrin-marketplace.html', 'intrebari-frecvente-parteneri.html']);

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const citeste = (f) => fs.readFileSync(path.join(RADACINA, f), 'utf8');
const faraComentarii = (t) => t.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const ZGOMOT = /Failed to load resource|net::ERR_|ERR_FAILED|Failed to fetch|status of 50[0-9]|status of 40[0-9]|cdn\.tailwindcss\.com/i;

function cererePlain(baza, cale) {
  return new Promise((ok, nu) => {
    http.get(baza + cale, (r) => { r.resume(); ok({ status: r.statusCode, location: r.headers.location }); }).on('error', nu);
  });
}

function supabaseSimulat(cuSesiune) {
  const sesiune = cuSesiune ? { access_token: 'tok-test', user: { id: 'u-test', email: 'ana@example.com' } } : null;
  const fals = {
    auth: {
      getUser: async () => ({ data: { user: sesiune && sesiune.user }, error: null }),
      getSession: async () => ({ data: { session: sesiune } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }) }) }) }),
  };
  Object.defineProperty(window, 'supabaseClient', { configurable: true, get() { return fals; }, set() {} });
}
function profil(stare, rol) {
  const baza = { ok: true, email: 'ana@example.com', nume: 'Ana Popescu', tara: 'RO', roles: ['client'], roluri_dashboard: [], are_comenzi: false, rol_solicitat: 'client', partener: null, investitor: null, activare: null };
  if (stare === 'client') return { ...baza, destinatie: '/mydarrin-catalog.html', tip_destinatie: 'client_fara_comenzi' };
  const tip = rol.replace('partener_', '');
  const pasi = ['firma', 'cont_bancar', 'profesii', 'dotari', 'documente', 'contract'].map((cheie) => ({ cheie, stare: stare === 'activare' ? 'de_completat' : 'completat' }));
  return {
    ...baza, roles: ['client', rol], rol_solicitat: rol,
    partener: { rol, poate_vinde: stare === 'activ', status_verificare: stare === 'activ' ? 'approved' : 'pending_review' },
    activare: { rol, tip, mod_activare: false, verificare: stare === 'activ' ? 'approved' : 'pending_review', activ: stare === 'activ', complet: stare !== 'activare', pasi },
  };
}

async function deschide(browser, baza, pagina, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: o.w || 1366, height: o.h || 900 } });
  await ctx.addInitScript((l) => {
    try { localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 })); if (l) localStorage.setItem('myd_lang_v1', l); } catch (e) {}
  }, o.limba === undefined ? 'ro' : o.limba);
  await ctx.addInitScript(supabaseSimulat, !!o.stare && o.stare !== 'vizitator');
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  await ctx.route(/ipapi\.co\//, (r) => r.abort());
  if (o.stare && o.stare !== 'vizitator') {
    await ctx.route(/\/api\/cont\/profil/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profil(o.stare, o.rol || 'partener_servicii')) }));
  }
  const p = await ctx.newPage();
  const erori = [];
  p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
  p.on('console', (m) => { if (m.type() === 'error' && !ZGOMOT.test(m.text())) erori.push('console: ' + m.text().slice(0, 160)); });
  await p.goto(`${baza}/${pagina}`, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => erori.push('goto: ' + e.message.slice(0, 100)));
  await p.waitForFunction(() => { const l = [...document.querySelectorAll('.rp [data-cta-partener]')]; return l.length && l.every((b) => b.getAttribute('data-cta-stare') && b.getAttribute('data-cta-stare') !== 'incarca'); }, null, { timeout: 10000 }).catch(() => erori.push('butoanele nu și-au primit starea'));
  return { ctx, p, erori };
}

// Fereastra de cont: deschisă pe „Creare cont”, cu rolul bifat.
const stareFereastra = (p) => p.evaluate(() => {
  const m = document.getElementById('auth-modal');
  const r = document.querySelector('input[name="mdc-rol"]:checked');
  const tab = document.getElementById('tab-register-btn');
  return { deschisa: !!m && !m.classList.contains('hidden'), rol: r ? r.value : null, inregistrare: !!tab && tab.getAttribute('aria-selected') === 'true' };
});

(async () => {
  const srv = await porneste(0, { redirecturi: true });
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    // ── 1. Redirecționarea și linkurile spre vechea pagină ──
    {
      const v = JSON.parse(citeste('vercel.json'));
      for (const src of ['/mydarrin-devino-partener.html', '/mydarrin-devino-partener']) {
        const r = v.redirects.find((x) => x.source === src);
        verifica(r && r.destination === '/cum-devii-partenerul-nostru' && r.statusCode === 301, `vercel.json: ${src} → 301 spre hub lipsește`);
      }
      const rw = v.rewrites.find((x) => x.source === '/partener');
      verifica(rw && rw.destination === '/cum-devii-partenerul-nostru.html', 'vercel.json: /partener nu mai duce la hub');
      verifica(/'\/partener': '\/cum-devii-partenerul-nostru'/.test(citeste('middleware.js')), 'middleware.js: /partener nu duce la hub');
      for (const [cale, asteptat] of [
        ['/mydarrin-devino-partener.html?type=curier', '/cum-devii-partenerul-nostru?type=curier'],
        ['/mydarrin-devino-partener?type=servicii&utm_source=x', '/cum-devii-partenerul-nostru?type=servicii&utm_source=x'],
        ['/mydarrin-devino-partener.html', '/cum-devii-partenerul-nostru'],
      ]) {
        const r = await cererePlain(baza, cale);
        verifica(r.status === 301 && r.location === asteptat, `${cale}: ${r.status} → ${r.location} (aștept 301 → ${asteptat})`);
      }
      // Pagina veche rămâne doar o redirecționare (pentru orice altă cale de acces).
      const veche = citeste('mydarrin-devino-partener.html');
      verifica(veche.length < 3000 && /location\.replace\('\/cum-devii-partenerul-nostru' \+ location\.search \+ location\.hash\)/.test(veche), 'mydarrin-devino-partener.html nu e doar redirecționarea spre hub');
      // middleware.js păstrează vechea adresă doar în lista căilor publice (redirecționarea trece de barieră).
      const fisiere = fs.readdirSync(RADACINA).filter((f) => (f.endsWith('.html') || f.endsWith('.js')) && !['mydarrin-devino-partener.html', 'mydarrin-devino-partener-wizard.html', 'middleware.js'].includes(f))
        .concat(['lib/destinatie-rol.js']);
      const cuLink = fisiere.filter((f) => /mydarrin-devino-partener\.html|href="\/?mydarrin-devino-partener[?"#]/.test(faraComentarii(citeste(f)).replace(/<code[^>]*>[^<]*<\/code>/g, '')));
      verifica(!cuLink.length, `linkuri spre vechea pagină în: ${cuLink.join(', ')}`);
      // Browserul ajunge pe hub, cu tipul păstrat; cardul tipului e marcat.
      const { ctx, p, erori } = await deschide(browser, baza, 'mydarrin-devino-partener.html?type=curier');
      const u = new URL(p.url());
      verifica(u.pathname === '/cum-devii-partenerul-nostru' && u.searchParams.get('type') === 'curier', `redirecționarea în browser: ${p.url()}`);
      verifica(await p.evaluate(() => document.getElementById('tip-curier').classList.contains('rp-ales')), '?type=curier: cardul curierului nu e marcat');
      verifica(!erori.length, 'hub ?type=curier: ' + erori.join(' | '));
      await ctx.close();
    }

    // ── 2. Static: „0 lei”, „Configurează profilul”, hero-ul comun ──
    {
      for (const f of CU_COST.concat(['cta-partener.js'])) verifica(!/\b0 (LEI|Lei|lei)\b/.test(citeste(f)), `${f}: conține „0 lei”`);
      for (const f of CU_COST) {
        const d = path.join('i18n', 'en', f.replace('.html', '.json'));
        if (fs.existsSync(path.join(RADACINA, d))) verifica(!/\b0 (LEI|Lei|lei)\b/.test(citeste(d)), `${d}: conține „0 lei”`);
      }
      const toate = fs.readdirSync(RADACINA).filter((f) => f.endsWith('.html') || f.endsWith('.js'));
      const configureaza = toate.filter((f) => /Configurează profilul/i.test(citeste(f)));
      verifica(!configureaza.length, `„Configurează profilul” încă apare în: ${configureaza.join(', ')}`);
      verifica(!/Configurează profilul/i.test(fs.readdirSync(path.join(RADACINA, 'i18n', 'en')).map((f) => citeste(path.join('i18n', 'en', f))).join('\n')), '„Configurează profilul” încă apare în dicționare');
      const hub = citeste(HUB);
      verifica(!/id="configurare"|servicii-selector|toggleCatGroup/.test(hub), 'hub: formularul vechi de configurare a rămas');
      verifica(/data-lucide="wrench"[\s\S]*data-lucide="package"[\s\S]*data-lucide="hard-hat"[\s\S]*data-lucide="truck"[\s\S]*data-lucide="shield"/.test(hub), 'hub: cele 5 carduri nu sunt în ordinea din meniu sau fără iconiță Lucide');
      for (const f of RUTA) {
        const t = citeste(f);
        verifica(t.includes('href="ruta-partener.css"') && t.includes('src="ruta-partener.js"'), `${f}: fără componenta comună (ruta-partener.css / .js)`);
        verifica((t.match(/class="rp-hero"/g) || []).length === 1, `${f}: hero-ul comun lipsește sau e dublat`);
        verifica(!/#7C3AED|#6D28D9|#8B5CF6/i.test(t.slice(t.indexOf('class="rp"'), t.indexOf('<footer'))), `${f}: culoare mov în conținut`);
      }
      const meniu = citeste('meniu-partener.js');
      verifica(meniu.includes("href: 'cum-devii-furnizor-servicii.html', ico: 'wrench'"), 'meniu-partener.js: „Furnizor de Servicii” nu duce la pagina nouă');
    }

    // ── 3. Hero, butonul principal și fereastra cu tipul bifat (vizitator) ──
    {
      const fonturi = new Set();
      for (const f of RUTA) {
        const { ctx, p, erori } = await deschide(browser, baza, f);
        const h = await p.evaluate(() => {
          const hero = document.querySelector('.rp-hero');
          const h1 = hero && hero.querySelector('h1');
          const b = hero && hero.querySelector('[data-rp-principal]');
          const cs = h1 && getComputedStyle(h1);
          return {
            insigna: hero && (hero.querySelector('.rp-insigna') || {}).textContent,
            font: cs && cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim(), greutate: cs && cs.fontWeight, marime: cs && cs.fontSize, aliniere: cs && cs.textAlign,
            tip: b && b.getAttribute('data-cta-partener'), text: b && b.textContent.replace(/\s+/g, ' ').trim(), stare: b && b.getAttribute('data-cta-stare'),
            secundar: hero && [...hero.querySelectorAll('.rp-btn2')].map((x) => x.textContent.trim()),
            secundarTinta: hero && (hero.querySelector('.rp-btn2') || {}).getAttribute && hero.querySelector('.rp-btn2').getAttribute('href'),
          };
        });
        const asteptat = f === HUB ? '' : PAGINI_TIP.find((x) => x[0] === f)[1];
        verifica(h.insigna && h.insigna.trim() === 'GRATUIT', `${f}: insigna hero e „${h.insigna}”`);
        verifica(h.tip === asteptat, `${f}: butonul principal are data-cta-partener="${h.tip}" (aștept „${asteptat}”)`);
        verifica(h.stare === 'vizitator', `${f}: butonul principal nu e în starea vizitator (${h.stare})`);
        verifica(h.font === 'Helvetica World' && h.greutate === '700' && h.aliniere === 'center', `${f}: titlul hero ${h.font} / ${h.greutate} / ${h.aliniere}`);
        fonturi.add(h.marime);
        if (f === HUB) {
          verifica(h.text === 'Creează-ți contul de partener →', `hub: butonul principal „${h.text}”`);
          verifica(h.secundar.join() === 'Alege tipul de parteneriat ↓' && h.secundarTinta === '#tipuri', `hub: butonul secundar ${h.secundar} → ${h.secundarTinta}`);
          // Cardurile: „Creează cont” → fereastra pe „Creare cont”, tipul bifat; se poate schimba.
          for (const [pg, tip, rol] of PAGINI_TIP) {
            const card = p.locator(`#tip-${tip}`);
            verifica(await card.locator('a.rp-link').getAttribute('href') === pg, `hub, cardul ${tip}: „Află mai mult” nu duce la ${pg}`);
            await card.locator('[data-cta-card]').click();
            await p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 8000 }).catch(() => {});
            const s = await stareFereastra(p);
            verifica(s.deschisa && s.inregistrare && s.rol === rol, `hub, cardul ${tip}: fereastra ${JSON.stringify(s)} (aștept ${rol})`);
            if (tip === 'servicii') {
              await p.locator('label[data-mdc-rol="partener_curier"]').click();
              verifica((await stareFereastra(p)).rol === 'partener_curier', 'hub: tipul bifat nu se poate schimba');
            }
            await p.evaluate(() => window.MDCont && window.MDCont.inchide());
          }
        } else {
          const [, tip, rol] = PAGINI_TIP.find((x) => x[0] === f);
          verifica(/^Creează-ți cont de .+ →$/.test(h.text), `${f}: butonul principal „${h.text}”`);
          verifica(h.secundar.join() === 'Cum funcționează ↓' && h.secundarTinta === '#cum-functioneaza', `${f}: butonul secundar ${h.secundar}`);
          const sec = await p.evaluate(() => ['ce-castigi', 'ce-iti-trebuie', 'cum-functioneaza', 'intrebari'].map((id) => !!document.getElementById(id)).concat(
            document.querySelectorAll('#ce-castigi .rp-punct').length === 3, document.querySelectorAll('#intrebari .rp-faq details').length <= 5,
            !!document.querySelector('#detalii') && !document.querySelector('#detalii').open, !!document.querySelector('.rp-banda [data-cta-partener]')));
          verifica(sec.every(Boolean), `${f}: structura șablonului incompletă ${JSON.stringify(sec)}`);
          await p.locator('.rp-hero [data-rp-principal]').click();
          await p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 8000 }).catch(() => {});
          const s = await stareFereastra(p);
          verifica(s.deschisa && s.inregistrare && s.rol === rol, `${f}: fereastra ${JSON.stringify(s)} (aștept ${rol})`);
        }
        verifica(!erori.length, `${f}: ${erori.join(' | ')}`);
        await ctx.close();
      }
      verifica(fonturi.size === 1, `mărimea titlului hero diferă între pagini: ${[...fonturi].join(', ')}`);
    }

    // ── 4. Utilizator conectat: butoanele urmează starea contului ──
    {
      let { ctx, p } = await deschide(browser, baza, 'cum-devii-furnizor-materiale.html', { stare: 'activare', rol: 'partener_materiale' });
      let b = await p.evaluate(() => { const x = document.querySelector('.rp-hero [data-rp-principal]'); return { text: x.textContent.replace(/\s+/g, ' ').trim(), href: x.getAttribute('href') }; });
      verifica(b.text === 'Finalizează-ți contul ca să primești comenzi →' && /mydarrin-dashboard-furnizor\.html\?type=materiale/.test(b.href), `materiale, activare: ${JSON.stringify(b)}`);
      await ctx.close();
      ({ ctx, p } = await deschide(browser, baza, HUB, { stare: 'client' }));
      b = await p.evaluate(() => [...document.querySelectorAll('[data-cta-card]')].map((x) => x.textContent.trim()));
      verifica(b.length === 5 && b.every((t) => t === 'Alege acest tip'), `hub, client: cardurile ${b}`);
      await p.locator('#tip-inchirieri [data-cta-card]').click();
      await p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 8000 }).catch(() => {});
      const ales = await p.evaluate(() => { const r = document.querySelector('input[name="mdc-rol-cont"]:checked'); return r && r.value; });
      verifica(ales === 'partener_inchirieri', `hub, client: alegerea tipului pe cont (${ales})`);
      await ctx.close();
      ({ ctx, p } = await deschide(browser, baza, HUB, { stare: 'activ', rol: 'partener_curier' }));
      b = await p.evaluate(() => [...document.querySelectorAll('.rp [data-cta-partener]')].map((x) => [x.getAttribute('data-cta-stare'), x.getAttribute('href')]));
      verifica(b.every(([s, h]) => s === 'activ' && /mydarrin-dashboard-partener\.html\?type=curier/.test(h)), `hub, partener activ: ${JSON.stringify(b.slice(0, 2))}`);
      await ctx.close();
    }

    // ── 5. Linkurile din hub și din paginile de tip răspund 200 ──
    {
      const linkuri = new Set();
      for (const f of RUTA) {
        const { ctx, p } = await deschide(browser, baza, f);
        const l = await p.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => h.startsWith(location.origin)));
        l.forEach((h) => { const u = new URL(h); if (!u.pathname.startsWith('/api/')) linkuri.add(u.pathname + u.search); });
        await ctx.close();
      }
      const rele = [];
      for (const l of linkuri) {
        let r = await cererePlain(baza, l);
        let n = 0;
        while ([301, 302, 307, 308].includes(r.status) && n++ < 3) r = await cererePlain(baza, r.location);
        if (r.status !== 200) rele.push(`${l} (${r.status})`);
      }
      verifica(!rele.length, `linkuri care nu răspund 200: ${rele.join(', ')}`);
      console.log(`linkuri verificate: ${linkuri.size}`);
    }

    // ── 6. Ecrane: derulare orizontală, erori, bara fixă de pe telefon ──
    for (const [w, h] of ECRANE) {
      for (const f of RUTA) {
        const { ctx, p, erori } = await deschide(browser, baza, f, { w, h });
        const lat = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        verifica(lat <= 0, `${f} ${w}px: derulare orizontală ${lat}px`);
        if (w <= 768) {
          await p.evaluate(() => { const s = document.getElementById('pasi') || document.getElementById('ce-iti-trebuie'); s.scrollIntoView({ behavior: 'instant' }); });
          await p.waitForTimeout(450);
          const r = await p.evaluate(() => {
            const bara = document.querySelector('[data-rp-fix]');
            const rb = bara.querySelector('.rp-btn').getBoundingClientRect();
            const vizibil = bara.classList.contains('rp-vizibil') && rb.bottom <= innerHeight && rb.top >= 0;
            const seSuprapune = (el) => { if (!el) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const q = el.getBoundingClientRect(); return q.width > 0 && !(q.right <= rb.left || q.left >= rb.right || q.bottom <= rb.top || q.top >= rb.bottom); };
            return { vizibil, peste: ['dai-fab', 'mobile-bottom-nav', 'myd-share-fab'].filter((id) => seSuprapune(document.getElementById(id))) };
          });
          verifica(r.vizibil, `${f} ${w}px: bara fixă nu apare la derulare`);
          verifica(!r.peste.length, `${f} ${w}px: bara fixă acoperă ${r.peste.join(', ')}`);
          // La final, ultimul conținut al paginii rămâne deasupra barei fixe.
          await p.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
          await p.waitForTimeout(450);
          const jos = await p.evaluate(() => {
            const bara = document.querySelector('[data-rp-fix] .rp-btn').getBoundingClientRect();
            const vizibil = document.querySelector('[data-rp-fix]').classList.contains('rp-vizibil');
            const footer = document.querySelector('footer');
            const fr = footer.getBoundingClientRect();
            const barajos = document.getElementById('mobile-bottom-nav');
            const bj = barajos && getComputedStyle(barajos).display !== 'none' ? barajos.getBoundingClientRect().top : innerHeight;
            return { vizibil, footerJos: fr.bottom, baraSus: bara.top, bj };
          });
          verifica(!jos.vizibil || jos.footerJos <= jos.baraSus + 1, `${f} ${w}px: bara fixă acoperă sfârșitul paginii (${Math.round(jos.footerJos)} > ${Math.round(jos.baraSus)})`);
        } else {
          const vizibila = await p.evaluate(() => getComputedStyle(document.querySelector('[data-rp-fix]')).display !== 'none');
          verifica(!vizibila, `${f} ${w}px: bara fixă apare pe ecran mare`);
        }
        verifica(!erori.length, `${f} ${w}px: ${erori.join(' | ')}`);
        if (dosarCapturi && (w === 390 || w === 1366) && (f === HUB || f === 'cum-devii-furnizor-materiale.html')) {
          fs.mkdirSync(dosarCapturi, { recursive: true });
          await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
          await p.waitForTimeout(400);
          const nume = f.replace('.html', '');
          if (w === 1366) await p.screenshot({ path: path.join(dosarCapturi, `${nume}-${w}.png`), fullPage: true });
          else {
            // Pe telefon, captura „full page” ar desena elementele fixe în mijlocul imaginii:
            // ecranul de sus și ecranul de la mijloc (cu bara fixă).
            await p.screenshot({ path: path.join(dosarCapturi, `${nume}-${w}-sus.png`) });
            await p.evaluate(() => (document.getElementById('pasi') || document.getElementById('ce-iti-trebuie')).scrollIntoView({ behavior: 'instant' }));
            await p.waitForTimeout(500);
            await p.screenshot({ path: path.join(dosarCapturi, `${nume}-${w}-mijloc.png`) });
          }
        }
        await ctx.close();
      }
      console.log(`${w}px: gata`);
    }

    // ── 7. Engleză (prima vizită): „FREE”, butoanele traduse ──
    for (const f of RUTA) {
      const { ctx, p, erori } = await deschide(browser, baza, f, { limba: null });
      const e = await p.evaluate(() => ({
        lang: document.documentElement.lang,
        insigna: document.querySelector('.rp-hero .rp-insigna').textContent.trim(),
        h1: document.querySelector('.rp-hero h1').textContent.trim(),
        buton: document.querySelector('.rp-hero [data-rp-principal]').textContent.replace(/\s+/g, ' ').trim(),
        carduri: [...document.querySelectorAll('[data-cta-card]')].map((x) => x.textContent.trim()),
      }));
      verifica(e.lang === 'en' && e.insigna === 'FREE', `${f} EN: ${e.lang} / insigna „${e.insigna}”`);
      verifica(/^Become a My Darrin /.test(e.h1), `${f} EN: titlul „${e.h1}”`);
      verifica(/^Create your .+ account →$/.test(e.buton), `${f} EN: butonul „${e.buton}”`);
      if (f === HUB) verifica(e.carduri.length === 5 && e.carduri.every((t) => t === 'Create account'), `hub EN: cardurile ${e.carduri}`);
      verifica(!erori.length, `${f} EN: ${erori.join(' | ')}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} verificări trecute, ${esec} eșuate`);
  process.exit(esec ? 1 : 0);
})();
