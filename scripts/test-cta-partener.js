// scripts/test-cta-partener.js
// Pasul 11-R3b (decizia LM, 2 nov. 2026): pe „Devino partener” și pe paginile
// informative, butoanele de înscriere arată textul și fac acțiunea potrivite
// stării contului (cta-partener.js), din /api/cont/profil. Chromium
// (Playwright), Supabase simulat în pagină (cu sau fără sesiune), profilul
// simulat pe rută:
//   - cele 5 stări (vizitator, client, activare, verificare, activ): textul,
//     destinația, „0 LEI” doar cât înscrierea e de făcut; clic: fereastra de cont
//     (Partener ales), alegerea tipului (salvată prin /api/cont/rol-solicitat →
//     dashboard), sau dashboard-ul;
//   - cât se încarcă starea, butonul nu se vede (fără text greșit);
//   - ancora #cum-functioneaza există și duce la secțiune; #partner-types nu
//     mai există și niciun link nu mai duce la ea;
//   - la 360, 390, 430, 768 × 1024, 1024 × 768, 1366 și 1920 px: fără derulare
//     orizontală și fără erori JS.
// Pasul 11-R3g: vechea pagină „Devino partener” e redirecționată spre hub
// (cum-devii-partenerul-nostru.html); testul rulează pe hub și pe pagina de
// materiale. Butoanele „Creează cont” de pe cardurile hub-ului (data-cta-card,
// texte scurte) și insigna „GRATUIT” sunt verificate în test-ruta-partener.js.
// Cu --capturi <dosar>: secțiunea de sus, vizitator și activare, la 390 și 1366 px.
// Rulare: node scripts/test-cta-partener.js [--capturi <dosar>]

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const RADACINA = path.join(__dirname, '..');
const ECRANE = [[360, 740], [390, 844], [430, 932], [768, 1024], [1024, 768], [1366, 900], [1920, 1080]];
const iCapturi = process.argv.indexOf('--capturi');
const dosarCapturi = iCapturi !== -1 ? process.argv[iCapturi + 1] : null;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));
const ZGOMOT = /Failed to load resource|net::ERR_|ERR_FAILED|Failed to fetch|status of 50[0-9]|status of 40[0-9]|cdn\.tailwindcss\.com/i;

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

const TEXT = {
  vizitator: 'Creează-ți contul de partener',
  client: 'Devino partener pe contul tău',
  activare: 'Finalizează-ți contul ca să primești comenzi',
  verificare: 'Contul tău e în verificare',
  activ: 'Mergi la dashboard-ul tău',
};
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
const dashboard = (rol) => (/materiale|inchirieri/.test(rol) ? '/mydarrin-dashboard-furnizor.html?type=' : '/mydarrin-dashboard-partener.html?type=') + rol.replace('partener_', '');

async function deschide(browser, baza, pagina, stare, rol, opt) {
  const o = opt || {};
  const ctx = await browser.newContext({ viewport: { width: o.w || 1366, height: o.h || 900 } });
  await ctx.addInitScript((l) => {
    try { localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 })); if (l) localStorage.setItem('myd_lang_v1', l); } catch (e) {}
  }, o.limba === undefined ? 'ro' : o.limba);
  await ctx.addInitScript(supabaseSimulat, stare !== 'vizitator');
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  await ctx.route(/ipapi\.co\//, (r) => r.abort());
  const postari = [];
  await ctx.route(/\/api\/cont\/profil/, async (r) => {
    if (o.intarziere) await asteapta(o.intarziere);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profil(stare, rol)) });
  });
  await ctx.route(/\/api\/cont\/rol-solicitat/, (r) => {
    const b = JSON.parse(r.request().postData() || '{}');
    postari.push(b);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, rol: b.rol, destinatie: dashboard(b.rol) }) });
  });
  const navigari = [];
  await ctx.route(/\/mydarrin-dashboard-(partener|furnizor)(\.html)?/, (r) => {
    if (r.request().isNavigationRequest()) { navigari.push(r.request().url()); return r.fulfill({ status: 204, body: '' }); }
    return r.continue();
  });
  const p = await ctx.newPage();
  const erori = [];
  p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
  p.on('console', (m) => { if (m.type() === 'error' && !ZGOMOT.test(m.text())) erori.push('console: ' + m.text().slice(0, 160)); });
  await p.goto(`${baza}/${pagina}`, { waitUntil: o.fara_asteptare ? 'domcontentloaded' : 'networkidle', timeout: 60000 }).catch((e) => erori.push('goto: ' + e.message.slice(0, 100)));
  return { ctx, p, erori, navigari, postari };
}
// Butoanele paginii; cel din meniul „Devino Partener” (pasul 11-R3f) e testat de test-meniu-devino-partener.js.
const butoane = (p) => p.evaluate(() => [...document.querySelectorAll('[data-cta-partener]')].filter((b) => !b.closest('[data-meniu-partener]') && !b.hasAttribute('data-cta-card')).map((b) => ({
  text: ((b.querySelector('[data-cta-text]') || b).textContent || '').replace(/\s+/g, ' ').replace(/\s*→\s*$/, '').trim(),
  stare: b.getAttribute('data-cta-stare'), href: b.getAttribute('href'),
  badge: [...b.querySelectorAll('[data-cta-badge]')].map((x) => getComputedStyle(x).display !== 'none'),
})));
const asteaptaStare = (p) => p.waitForFunction(() => { const l = [...document.querySelectorAll('[data-cta-partener]')]; return l.length && l.every((b) => b.getAttribute('data-cta-stare') && b.getAttribute('data-cta-stare') !== 'incarca'); }, null, { timeout: 10000 }).catch(() => {});

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  const PAGINI = [
    ['cum-devii-partenerul-nostru.html', 'partener_servicii', 3, null],
    ['cum-devii-furnizor-materiale.html', 'partener_materiale', 3, 'partener_materiale'],
  ];
  // Pasul 11-R3g: pe paginile de tip, vizitatorul vede „Creează-ți cont de <tip>”.
  const textAsteptat = (pagina, stare) => (stare === 'vizitator' && pagina === 'cum-devii-furnizor-materiale.html' ? 'Creează-ți cont de furnizor de materiale' : TEXT[stare]);
  try {
    // 0. Static: #partner-types a dispărut; #cum-functioneaza există.
    {
      const html = fs.readdirSync(RADACINA).filter((f) => f.endsWith('.html')).map((f) => [f, fs.readFileSync(path.join(RADACINA, f), 'utf8')]);
      const legaturi = html.filter(([, t]) => /href="[^"]*#partner-types"|getElementById\('partner-types'\)|id="partner-types"/.test(t)).map(([f]) => f);
      verifica(!legaturi.length, `#partner-types încă apare în: ${legaturi.join(', ')}`);
      for (const f of ['cum-devii-furnizor-servicii.html', 'cum-devii-furnizor-materiale.html', 'cum-devii-operator-inchirieri.html', 'cum-devii-curier-de-cartier.html', 'ghidul-asiguratorului.html']) {
        const t = html.find(([x]) => x === f)[1];
        verifica((t.match(/id="cum-functioneaza"/g) || []).length === 1, `${f}: id="cum-functioneaza" lipsește sau e dublat`);
      }
      verifica(!/5 pași/.test(html.find(([f]) => f === 'cum-devii-partenerul-nostru.html')[1]), 'hub: „5 pași” (fluxul vechi) a rămas');
      for (const f of ['cum-devii-furnizor-servicii.html', 'cum-devii-partenerul-nostru.html', 'cum-devii-furnizor-materiale.html', 'cum-devii-operator-inchirieri.html', 'cum-devii-curier-de-cartier.html', 'ghidul-asiguratorului.html']) {
        const t = html.find(([x]) => x === f)[1];
        verifica(/data-cta-partener/.test(t) && /<script src="cta-partener\.js"/.test(t), `${f}: lipsește data-cta-partener sau cta-partener.js`);
      }
    }

    // 1. Cele 5 stări × 2 pagini.
    for (const [pagina, rol, nrButoane, rolPagina] of PAGINI) {
      for (const stare of ['vizitator', 'client', 'activare', 'verificare', 'activ']) {
        const et = `${pagina} · ${stare}`;
        const { ctx, p, erori, navigari, postari } = await deschide(browser, baza, pagina, stare, rol);
        await asteaptaStare(p);
        const b = await butoane(p);
        verifica(b.length === nrButoane, `${et}: ${b.length} butoane (așteptat ${nrButoane})`);
        verifica(b.every((x) => x.text === textAsteptat(pagina, stare) && x.stare === stare), `${et}: textele ${JSON.stringify(b.map((x) => [x.text, x.stare]))}`);
        const cuBadge = stare === 'vizitator' || stare === 'client';
        verifica(b.every((x) => x.badge.every((v) => v === cuBadge)), `${et}: insigna ${cuBadge ? 'lipsește' : 'apare'}`);
        if (['activare', 'verificare', 'activ'].includes(stare)) {
          verifica(b.every((x) => x.href === dashboard(rol)), `${et}: destinația ${JSON.stringify(b.map((x) => x.href))} (așteptat ${dashboard(rol)})`);
          await p.click('[data-cta-partener]:visible');
          await asteapta(400);
          verifica(navigari.some((u) => u.endsWith(dashboard(rol))), `${et}: clicul nu duce la dashboard (${navigari.join(' ') || '—'})`);
        } else if (stare === 'vizitator') {
          await p.click('[data-cta-partener]:visible');
          await p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 8000 }).catch(() => {});
          const a = await p.evaluate(() => {
            const c = document.querySelector('#auth-modal input[name="mdc-cat"]:checked');
            const r = document.querySelector('#auth-modal input[name="mdc-rol"]:checked');
            return { cat: c && c.value, rol: r && r.value, grila: !document.getElementById('mdc-tipuri').hidden, inregistrare: !document.getElementById('auth-register').hidden };
          });
          verifica(a.inregistrare && a.cat === 'partener' && a.grila && a.rol === rolPagina, `${et}: fereastra de cont ${JSON.stringify(a)} (rol așteptat ${rolPagina})`);
        } else {
          await p.click('[data-cta-partener]:visible');
          await p.waitForFunction(() => { const f = document.getElementById('mdc-tip-cont'); return f && !f.hidden; }, null, { timeout: 8000 }).catch(() => {});
          const a = await p.evaluate(() => ({ vizibil: !document.getElementById('mdc-tip-cont').hidden, taburi: getComputedStyle(document.getElementById('mdc-taburi')).display, ales: (document.querySelector('#mdc-roluri-cont input:checked') || {}).value || null }));
          verifica(a.vizibil && a.taburi === 'none' && a.ales === rolPagina, `${et}: alegerea tipului ${JSON.stringify(a)} (rol așteptat ${rolPagina})`);
          if (!rolPagina) await p.click('#auth-modal label[data-mdc-rol-cont="partener_curier"]');
          await p.click('#mdc-tip-cont-btn');
          for (let i = 0; i < 40 && !navigari.length; i++) await asteapta(100);
          const ales = rolPagina || 'partener_curier';
          verifica(postari.length === 1 && postari[0].rol === ales, `${et}: alegerea salvată ${JSON.stringify(postari)}`);
          verifica(navigari.some((u) => u.endsWith(dashboard(ales))), `${et}: după alegere nu duce la dashboard (${navigari.join(' ') || '—'})`);
        }
        verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
        await ctx.close();
      }
    }

    // 1b. Vizitatorul rămâne pe pagină (fosta barieră îl trimitea la „/” după 3 s).
    for (const stare of ['vizitator', 'client']) {
      const et = `fără barieră (${stare})`;
      const { ctx, p } = await deschide(browser, baza, 'cum-devii-partenerul-nostru.html', stare, 'partener_servicii');
      const url = p.url();
      await asteapta(4000);
      verifica(p.url() === url && !(await p.$('#partner-gate-banner')), `${et}: pagina a redirecționat sau arată bariera (${p.url()})`);
      await ctx.close();
    }

    // 2. Cât se încarcă starea, butonul nu arată textul greșit.
    {
      const et = 'încărcarea stării';
      const { ctx, p } = await deschide(browser, baza, 'cum-devii-partenerul-nostru.html', 'activ', 'partener_servicii', { intarziere: 2500, fara_asteptare: true });
      await asteapta(600);
      const inainte = await p.evaluate(() => [...document.querySelectorAll('[data-cta-partener]')].map((b) => getComputedStyle(b).visibility));
      verifica(inainte.length && inainte.every((v) => v === 'hidden'), `${et}: butoanele se văd înainte de stare (${inainte.join(',')})`);
      await asteaptaStare(p);
      const dupa = await p.evaluate(() => [...document.querySelectorAll('[data-cta-partener]')].filter((b) => !b.closest('[data-meniu-partener]')).map((b) => getComputedStyle(b).visibility));
      verifica(dupa.every((v) => v === 'visible'), `${et}: butoanele nu apar după stare (${dupa.join(',')})`);
      await ctx.close();
    }

    // 3. Ancora #cum-functioneaza: butonul și deschiderea directă.
    // Pasul 11-R3g: pe paginile de tip, butonul secundar „Cum funcționează ↓” din hero.
    for (const [cum, url] of [['butonul „Cum funcționează ↓”', 'cum-devii-furnizor-materiale.html'], ['deschiderea cu #cum-functioneaza', 'cum-devii-furnizor-materiale.html#cum-functioneaza']]) {
      const et = `ancora: ${cum}`;
      const { ctx, p, erori } = await deschide(browser, baza, url, 'vizitator', 'partener_servicii');
      if (!url.includes('#')) await p.click('.rp-hero .rp-btn2');
      await p.waitForFunction(() => { const s = document.getElementById('cum-functioneaza'); return s && s.getClientRects().length && s.getBoundingClientRect().top < window.innerHeight; }, null, { timeout: 6000 }).catch(() => {});
      const r = await p.evaluate(() => { const s = document.getElementById('cum-functioneaza'); const b = s.getBoundingClientRect(); return { vizibil: s.getClientRects().length > 0, sus: Math.round(b.top), vh: window.innerHeight, pasi: s.querySelectorAll('.rp-pas').length }; });
      verifica(r.vizibil && r.sus < r.vh && r.pasi > 0, `${et}: secțiunea nu e afișată ${JSON.stringify(r)}`);
      verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }

    // 4. Engleză.
    {
      const et = 'EN';
      const { ctx, p, erori } = await deschide(browser, baza, 'cum-devii-partenerul-nostru.html', 'activare', 'partener_servicii', { limba: null });
      await asteaptaStare(p);
      const b = await butoane(p);
      verifica(b.every((x) => x.text === 'Finish your account so you can receive orders'), `${et}: ${JSON.stringify(b.map((x) => x.text))}`);
      verifica(!erori.length, `${et}: ${erori.length} erori JS`);
      await ctx.close();
    }

    // 5. Dimensiunile ecranului (și capturile).
    if (dosarCapturi) fs.mkdirSync(dosarCapturi, { recursive: true });
    for (const [pagina, rol] of PAGINI) {
      for (const [w, h] of ECRANE) {
        for (const stare of ['vizitator', 'activare']) {
          const et = `${pagina} ${stare} ${w}×${h}`;
          const { ctx, p, erori } = await deschide(browser, baza, pagina, stare, rol, { w, h });
          await asteaptaStare(p);
          const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
          verifica(m.sw <= m.vw + 1, `${et}: derulare orizontală (${m.sw} / ${m.vw})`);
          verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
          if (dosarCapturi && pagina.startsWith('cum-devii-partenerul') && [390, 1366].includes(w)) {
            await p.screenshot({ path: path.join(dosarCapturi, `cta-${stare}-${w}.png`) });
          }
          await ctx.close();
        }
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
