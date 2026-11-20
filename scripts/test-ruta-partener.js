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
//   - „Creează cont” de pe fiecare card din hub și butonul principal al fiecărei
//     pagini de tip duc la pre-înscriere, /parteneri/inscriere?categorie=<tip>
//     (pasul 12-P1; înainte: fereastra de cont cu tipul bifat);
//   - utilizator conectat: butoanele urmează starea contului (cta-partener.js),
//     nu deschid fereastra;
//   - „Configurează profilul” nu mai există;
//   - toate linkurile din hub și din paginile de tip răspund 200;
//   - la 360, 390, 768 × 1024, 1024 × 768 și 1366 px: fără derulare orizontală,
//     fără erori JS; pe telefon bara fixă nu acoperă butonul Darrin AI, bara de
//     jos sau ultimul conținut al paginii;
//   - în engleză: „FREE” în insignă, butoanele traduse.
// Pasul 12-L1 (macheta L1, 19 nov. 2026): șablonul comun e acum landing.css / landing.js
// (lib/landing-pagini.js, scripts/genereaza-pagini-destinatie.js); primul ecran are un singur
// buton, cu destinația scrisă în HTML; cardurile hub-ului duc la paginile de categorie; insigna
// „GRATUIT”, butonul secundar, banda finală și bara fixă au fost scoase. Testul verifică
// structura nouă (detaliile primului ecran: scripts/test-pagini-destinatie.js).
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
    try { localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), marketing: false, versiune: 2 })); if (l) localStorage.setItem('myd_lang_v1', l); } catch (e) {}
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
  await p.waitForFunction(() => { const l = [...document.querySelectorAll('.lp [data-cta-partener]')]; return l.length && l.every((b) => b.getAttribute('data-cta-stare')); }, null, { timeout: 10000 }).catch(() => erori.push('butoanele nu și-au primit starea'));
  return { ctx, p, erori };
}

// Fereastra de cont: deschisă pe „Creare cont”, cu rolul bifat.
const stareFereastra = (p) => p.evaluate(() => {
  const m = document.getElementById('auth-modal');
  const r = document.querySelector('input[name="mdc-rol"]:checked');
  const tab = document.getElementById('tab-register-btn');
  return { deschisa: !!m && !m.classList.contains('hidden'), rol: r ? r.value : null, inregistrare: !!tab && tab.getAttribute('aria-selected') === 'true' };
});

// Pasul 12-U1: adresa curată a paginii (cum-devii-furnizor-servicii.html → /parteneri/servicii).
const ADRESA = (f) => require(path.join(RADACINA, 'lib/adrese-curate.js')).adresaNoua(f.replace(/\.html$/, ''));

(async () => {
  const srv = await porneste(0, { redirecturi: true });
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    // ── 1. Redirecționarea și linkurile spre vechea pagină ──
    {
      const v = JSON.parse(citeste('vercel.json'));
      // Pasul 12-U1: hub-ul are adresa curată /parteneri; vechile adrese fac 301 spre ea
      // (forma .html: întâi 308 de la Vercel, cleanUrls, apoi 301).
      for (const src of ['/mydarrin-devino-partener', '/partener', '/cum-devii-partenerul-nostru']) {
        const r = v.redirects.find((x) => x.source === src);
        verifica(r && r.destination === '/parteneri' && r.statusCode === 301, `vercel.json: ${src} → 301 spre hub lipsește`);
      }
      const rw = v.rewrites.find((x) => x.source === '/parteneri');
      verifica(rw && rw.destination === '/cum-devii-partenerul-nostru', 'vercel.json: /parteneri nu servește hub-ul');
      verifica(require(path.join(RADACINA, 'lib/adrese-curate.js')).rescriere('/parteneri').fisier === 'cum-devii-partenerul-nostru' && /adreseCurate\.rescriere\(pathname\)/.test(citeste('middleware.js')), 'middleware.js: /parteneri nu duce la hub');
      for (const [cale, asteptat] of [
        ['/mydarrin-devino-partener?type=servicii&utm_source=x', '/parteneri?type=servicii&utm_source=x'],
        ['/partener?type=curier', '/parteneri?type=curier'],
      ]) {
        const r = await cererePlain(baza, cale);
        verifica(r.status === 301 && r.location === asteptat, `${cale}: ${r.status} → ${r.location} (aștept 301 → ${asteptat})`);
      }
      {
        const r1 = await cererePlain(baza, '/mydarrin-devino-partener.html?type=curier');
        const r2 = await cererePlain(baza, r1.location);
        verifica(r1.status === 308 && r1.location === '/mydarrin-devino-partener?type=curier' && r2.status === 301 && r2.location === '/parteneri?type=curier', `/mydarrin-devino-partener.html?type=curier: ${r1.status} → ${r1.location} → ${r2.status} → ${r2.location}`);
      }
      // Pagina veche rămâne doar o redirecționare (pentru orice altă cale de acces).
      const veche = citeste('mydarrin-devino-partener.html');
      verifica(veche.length < 3000 && /location\.replace\('\/parteneri' \+ location\.search \+ location\.hash\)/.test(veche), 'mydarrin-devino-partener.html nu e doar redirecționarea spre hub');
      // middleware.js păstrează vechea adresă doar în lista căilor publice (redirecționarea trece de barieră).
      const fisiere = fs.readdirSync(RADACINA).filter((f) => (f.endsWith('.html') || f.endsWith('.js')) && !['mydarrin-devino-partener.html', 'mydarrin-devino-partener-wizard.html', 'middleware.js'].includes(f))
        .concat(['lib/destinatie-rol.js']);
      const cuLink = fisiere.filter((f) => /mydarrin-devino-partener\.html|href="\/?mydarrin-devino-partener[?"#]/.test(faraComentarii(citeste(f)).replace(/<code[^>]*>[^<]*<\/code>/g, '')));
      verifica(!cuLink.length, `linkuri spre vechea pagină în: ${cuLink.join(', ')}`);
      // Browserul ajunge pe hub, cu tipul păstrat; cardul tipului e marcat.
      const { ctx, p, erori } = await deschide(browser, baza, 'mydarrin-devino-partener.html?type=curier');
      const u = new URL(p.url());
      verifica(u.pathname === '/parteneri' && u.searchParams.get('type') === 'curier', `redirecționarea în browser: ${p.url()}`);
      verifica(await p.evaluate(() => document.getElementById('tip-curier').classList.contains('lp-ales')), '?type=curier: cardul curierului nu e marcat');
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
      const carduri = [...hub.matchAll(/<a class="lp-cat" id="tip-([a-z]+)" href="([^"]+)"/g)].map((m) => m[1] + ' ' + m[2]);
      verifica(JSON.stringify(carduri) === JSON.stringify(PAGINI_TIP.map(([f, t]) => t + ' ' + ADRESA(f))), `hub: cele 5 carduri nu sunt în ordinea din meniu: ${carduri.join(', ')}`);
      for (const f of RUTA) {
        const t = citeste(f);
        verifica(t.includes('href="/landing.css"') && t.includes('src="/landing.js"'), `${f}: fără componenta comună (landing.css / .js)`);
        verifica((t.match(/class="lp-erou"/g) || []).length === 1, `${f}: primul ecran comun lipsește sau e dublat`);
        verifica(!/#7C3AED|#6D28D9|#8B5CF6/i.test(t.slice(t.indexOf('class="lp"'), t.indexOf('<footer'))), `${f}: culoare mov în conținut`);
      }
      const meniu = citeste('meniu-partener.js');
      verifica(meniu.includes("href: '/parteneri/servicii', ico: 'wrench'"), 'meniu-partener.js: „Furnizor de Servicii” nu duce la pagina nouă');
    }

    // ── 3. Primul ecran și butonul principal (vizitator) ──
    {
      const L = require(path.join(RADACINA, 'lib/landing-pagini.js'));
      const fonturi = new Set();
      for (const f of RUTA) {
        const { ctx, p, erori } = await deschide(browser, baza, f);
        const h = await p.evaluate(() => {
          const erou = document.querySelector('.lp-erou');
          const h1 = erou && erou.querySelector('h1');
          const b = document.getElementById('lp-cta');
          const cs = h1 && getComputedStyle(h1);
          return {
            font: cs && cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim(), greutate: cs && cs.fontWeight, marime: cs && cs.fontSize,
            tip: b && b.getAttribute('data-cta-partener'), text: b && b.textContent.replace(/\s+/g, ' ').trim(), stare: b && b.getAttribute('data-cta-stare'), href: b && b.getAttribute('href'),
            butoane: erou ? erou.querySelectorAll('a, button').length : 0, h1: h1 && h1.textContent.trim(),
          };
        });
        const asteptat = f === HUB ? '' : PAGINI_TIP.find((x) => x[0] === f)[1];
        const pg = L.PAGINI.find((x) => x.fisier + '.html' === f);
        verifica(h.tip === asteptat, `${f}: butonul principal are data-cta-partener="${h.tip}" (aștept „${asteptat}”)`);
        verifica(h.stare === 'vizitator', `${f}: butonul principal nu e în starea vizitator (${h.stare})`);
        verifica(h.butoane === 1, `${f}: ${h.butoane} butoane în primul ecran (aștept unul)`);
        verifica(h.font === 'Helvetica World' && h.greutate === '700', `${f}: titlul ${h.font} / ${h.greutate}`);
        verifica(h.h1 === pg.implicit.ro.titlu && h.text === pg.implicit.ro.buton, `${f}: titlul „${h.h1}”, butonul „${h.text}”`);
        verifica(h.href === L.destinatie(pg), `${f}: butonul principal → ${h.href} (aștept ${L.destinatie(pg)})`);
        fonturi.add(h.marime);
        if (f === HUB) {
          for (const [pgf, tip] of PAGINI_TIP) {
            const href = await p.locator(`#tip-${tip}`).getAttribute('href');
            verifica(href === ADRESA(pgf), `hub, cardul ${tip}: duce la ${href} (aștept ${ADRESA(pgf)})`);
          }
          await p.locator('#lp-cta').click();
          await p.waitForURL(/parteneri\/inscriere/, { timeout: 8000 }).catch(() => {});
          verifica(/\/parteneri\/inscriere$/.test(p.url()), `hub: butonul principal duce la pre-înscriere (${p.url()})`);
        } else {
          const sec = await p.evaluate(() => [!!document.getElementById('cum-functioneaza'), document.querySelectorAll('#cum-functioneaza .lp-pasi li').length === 3,
            !!document.querySelector('#cum-functioneaza a[href^="/parteneri/intrebari"]'), !document.querySelector('.rp-banda, [data-rp-fix], .rp-insigna')]);
          verifica(sec.every(Boolean), `${f}: structura șablonului incompletă ${JSON.stringify(sec)}`);
        }
        verifica(!erori.length, `${f}: ${erori.join(' | ')}`);
        await ctx.close();
      }
      verifica(fonturi.size === 1, `mărimea titlului diferă între pagini: ${[...fonturi].join(', ')}`);
    }

    // ── 4. Utilizator conectat: doar contul de partener schimbă textul și destinația ──
    {
      let { ctx, p } = await deschide(browser, baza, 'cum-devii-furnizor-materiale.html', { stare: 'activare', rol: 'partener_materiale' });
      let b = await p.evaluate(() => { const x = document.getElementById('lp-cta'); return { text: x.textContent.replace(/\s+/g, ' ').trim(), href: x.getAttribute('href') }; });
      verifica(b.text === 'Mergi în panoul tău' && /mydarrin-dashboard-furnizor\?type=materiale/.test(b.href), `materiale, activare: ${JSON.stringify(b)}`);
      await ctx.close();
      ({ ctx, p } = await deschide(browser, baza, 'cum-devii-operator-inchirieri.html', { stare: 'client' }));
      b = await p.evaluate(() => { const x = document.getElementById('lp-cta'); return { text: x.textContent.trim(), href: x.getAttribute('href') }; });
      verifica(b.text === 'Devino partener' && b.href === '/parteneri/inscriere?categorie=inchirieri', `închirieri, client: textul și linkul rămân ${JSON.stringify(b)}`);
      await p.locator('#lp-cta').click();
      await p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 8000 }).catch(() => {});
      const ales = await p.evaluate(() => { const r = document.querySelector('input[name="mdc-rol-cont"]:checked'); return r && r.value; });
      verifica(ales === 'partener_inchirieri', `închirieri, client: clicul alege tipul pe contul existent (${ales})`);
      await ctx.close();
      ({ ctx, p } = await deschide(browser, baza, HUB, { stare: 'activ', rol: 'partener_curier' }));
      b = await p.evaluate(() => [...document.querySelectorAll('.lp [data-cta-partener]')].map((x) => [x.getAttribute('data-cta-stare'), x.getAttribute('href')]));
      verifica(b.length === 1 && b.every(([st, h]) => st === 'activ' && /\/cont\/partener\?type=curier/.test(h)), `hub, partener activ: ${JSON.stringify(b)}`);
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

    // ── 6. Ecrane: derulare orizontală, erori (pasul 12-L1: fără bara fixă) ──
    for (const [w, h] of ECRANE) {
      for (const f of RUTA) {
        const { ctx, p, erori } = await deschide(browser, baza, f, { w, h });
        const lat = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        verifica(lat <= 0, `${f} ${w}px: derulare orizontală ${lat}px`);
        verifica(!(await p.$('[data-rp-fix]')), `${f} ${w}px: bara fixă veche a rămas`);
        verifica(!erori.length, `${f} ${w}px: ${erori.join(' | ')}`);
        if (dosarCapturi && (w === 390 || w === 1366) && (f === HUB || f === 'cum-devii-furnizor-materiale.html')) {
          fs.mkdirSync(dosarCapturi, { recursive: true });
          await p.screenshot({ path: path.join(dosarCapturi, `${f.replace('.html', '')}-${w}.png`), fullPage: w === 1366 });
        }
        await ctx.close();
      }
      console.log(`${w}px: gata`);
    }

    // ── 7. Engleză (prima vizită): primul ecran și butonul traduse ──
    {
      const L = require(path.join(RADACINA, 'lib/landing-pagini.js'));
      for (const f of RUTA) {
        const { ctx, p, erori } = await deschide(browser, baza, f, { limba: null });
        const e = await p.evaluate(() => ({
          lang: document.documentElement.lang,
          h1: document.querySelector('.lp-erou h1').textContent.trim(),
          buton: document.getElementById('lp-cta').textContent.replace(/\s+/g, ' ').trim(),
        }));
        const pg = L.PAGINI.find((x) => x.fisier + '.html' === f);
        verifica(e.lang === 'en', `${f} EN: lang ${e.lang}`);
        verifica(e.h1 === pg.implicit.en.titlu, `${f} EN: titlul „${e.h1}”`);
        verifica(e.buton === pg.implicit.en.buton, `${f} EN: butonul „${e.buton}”`);
        verifica(!erori.length, `${f} EN: ${erori.join(' | ')}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} verificări trecute, ${esec} eșuate`);
  process.exit(esec ? 1 : 0);
})();
