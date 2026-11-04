// scripts/test-meniu-devino-partener.js
// Pasul 11-R3f (decizia LM, 3 nov. 2026): un singur meniu „Devino Partener”,
// generat din meniu-partener.js, și butonul după starea contului pe tot site-ul.
// Chromium (Playwright), Supabase simulat în pagină, profilul simulat pe rută.
//   - Static: nicio pagină nu mai are o copie a meniului (doar locul gol
//     data-meniu-partener); niciun link spre #partner-types sau mydarrin-serviciu.html.
//   - Pe toate paginile publice cu meniu în antet (1366 px): meniul se numește
//     „Devino Partener” și are exact cele 6 intrări, în ordine, cu linkurile
//     așteptate; meniul derulant nu iese din ecran.
//   - Meniul lateral (390 px): aceleași 6 intrări.
//   - Linkurile din meniu și din footer (toate paginile publice): răspund 200;
//     ancorele există pe pagina-țintă.
//   - Butonul din meniu, după stare: vizitator, client, activare
//     („Finalizează-ți contul”), verificare, partener activ.
//   - „Devino partener”: „Creează-ți contul de partener” și „Cum devii
//     partener”, care deschide lista celor 5 tipuri.
//   - EN: „Become a Partner” și intrările în engleză.
//   - 360, 390, 768 × 1024, 1024 × 768, 1366 px: meniul în ecran, fără
//     derulare orizontală, fără erori JS.
// Cu --capturi <dosar>: meniul deschis la 390 (lateral) și 1366 px (antet).
// Rulare: node scripts/test-meniu-devino-partener.js [--capturi <dosar>]

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const RADACINA = path.join(__dirname, '..');
const iCapturi = process.argv.indexOf('--capturi');
const dosarCapturi = iCapturi !== -1 ? process.argv[iCapturi + 1] : null;

// Aceeași listă ca în scripts/test-clicuri-meniu.js și scripts/detector-ro.js (PUBLICE).
const PUBLICE = ['index', 'servicii-urgente', 'despre-noi', 'afla-ce-facem', 'mydarrin-contact', 'mydarrin-app-mobile',
  // Pasul 11-C4: paginile de categorie → catalogul filtrat (redirect 301).
  'mydarrin-catalog', 'mydarrin-catalog.html?categorie=servicii&subcategorie=instalatii-electrice', 'mydarrin-catalog.html?categorie=materiale',
  'mydarrin-marketplace', 'mydarrin-marketplace-materiale.html?slug=montaj-parchet-laminat&type=servicii&nace=43.33',
  'mydarrin-produs.html?slug=inlocuire-becuri-corpuri&type=servicii', 'mydarrin-checkout', 'mydarrin-cos',
  'mydarrin-creeaza-deviz', 'confirmare-livrare', 'reset-password', 'mydarrin-cum-functioneaza', 'cum-comanzi', 'cum-platesc',
  'cum-programez-serviciu', 'cum-prestam-livram', 'intrebari-frecvente-clienti', 'intrebari-frecvente-parteneri',
  'garantii-si-asigurari', 'ghidul-asiguratorului', 'reclamatii', 'mydarrin-devino-partener',
  'cum-devii-partenerul-nostru', 'cum-devii-curier-de-cartier', 'cum-devii-furnizor-materiale', 'cum-devii-operator-inchirieri',
  'mydarrin-investitori', 'mydarrin-pitch-deck', 'acord-confidentialitate', 'acces-temporar', 'mydarrin-termeni',
  'mydarrin-politica-confidentialitate'];

const ASTEPTAT = [
  ['cum-devii-partenerul-nostru.html', 'Cum devii partener My Darrin', 'How to become a My Darrin partner'],
  ['cum-devii-partenerul-nostru.html?type=servicii', 'Furnizor de Servicii', 'Service Provider'],
  ['cum-devii-furnizor-materiale.html', 'Furnizor de Materiale', 'Materials Supplier'],
  ['cum-devii-operator-inchirieri.html', 'Furnizor de Închirieri', 'Rental Supplier'],
  ['cum-devii-curier-de-cartier.html', 'Curier de cartier', 'Neighbourhood courier'],
  ['ghidul-asiguratorului.html', 'Asigurător', 'Insurer'],
];
const TEXT = {
  vizitator: ['Creează-ți contul de partener', 'Create your partner account'],
  client: ['Devino partener pe contul tău', 'Become a partner on your account'],
  activare: ['Finalizează-ți contul', 'Finish your account'],
  verificare: ['Contul tău e în verificare', 'Your account is under review'],
  activ: ['Mergi la dashboard-ul tău', 'Go to your dashboard'],
};

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));
const ZGOMOT = /Failed to load resource|net::ERR_|ERR_FAILED|Failed to fetch|status of 50[0-9]|status of 40[0-9]|cdn\.tailwindcss\.com/i;
const ZGOMOT_PAGINA = { 'mydarrin-pitch-deck': /^\[pitch-deck\] Error: http 503(\n\s+at |$)/ };

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
function profil(stare) {
  const rol = 'partener_servicii';
  const baza = { ok: true, email: 'ana@example.com', nume: 'Ana Popescu', tara: 'RO', roles: ['client'], roluri_dashboard: [], are_comenzi: false, rol_solicitat: 'client', partener: null, investitor: null, activare: null, destinatie: '/mydarrin-catalog.html' };
  if (stare === 'client') return baza;
  const pasi = ['firma', 'cont_bancar', 'profesii', 'dotari', 'documente', 'contract'].map((cheie) => ({ cheie, stare: stare === 'activare' ? 'de_completat' : 'completat' }));
  return {
    ...baza, roles: ['client', rol], rol_solicitat: rol,
    partener: { rol, poate_vinde: stare === 'activ', status_verificare: stare === 'activ' ? 'approved' : 'pending_review' },
    activare: { rol, tip: 'servicii', mod_activare: false, verificare: stare === 'activ' ? 'approved' : 'pending_review', activ: stare === 'activ', complet: stare !== 'activare', pasi },
  };
}

(async () => {
  // 0. Static.
  const fisiere = fs.readdirSync(RADACINA).filter((f) => f.endsWith('.html')).map((f) => [f, fs.readFileSync(path.join(RADACINA, f), 'utf8')]);
  const cuCopie = fisiere.filter(([, t]) => /<div id="sb-partner"(?![^>]*data-meniu-partener)/.test(t) || /class="mega-panel"(?![^>]*data-meniu-partener)[^>]*>\s*<div class="absolute -top-2[\s\S]{0,600}Cum devii partener/.test(t)).map(([f]) => f);
  verifica(!cuCopie.length, `pagini cu o copie a meniului „Devino Partener”: ${cuCopie.join(', ')}`);
  const vechi = fisiere.filter(([, t]) => /href="[^"]*#partner-types"|href="mydarrin-serviciu\.html/.test(t)).map(([f]) => f);
  verifica(!vechi.length, `linkuri spre #partner-types / mydarrin-serviciu.html: ${vechi.join(', ')}`);
  const cuLoc = fisiere.filter(([, t]) => /data-meniu-partener="antet"/.test(t)).map(([f]) => f);
  const faraScript = fisiere.filter(([f, t]) => /data-meniu-partener=/.test(t) && !/meniu-partener\.js/.test(t) && !/ui-comun\.js/.test(t)).map(([f]) => f);
  verifica(!faraScript.length, `pagini cu locul meniului, dar fără meniu-partener.js / ui-comun.js: ${faraScript.join(', ')}`);

  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();

  async function deschide(pagina, opt) {
    const o = opt || {};
    const ctx = await browser.newContext({ viewport: { width: o.w || 1366, height: o.h || 900 } });
    await ctx.addInitScript((l) => {
      try { localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 })); if (l) localStorage.setItem('myd_lang_v1', l); } catch (e) {}
    }, o.limba === undefined ? 'ro' : o.limba);
    await ctx.addInitScript(supabaseSimulat, !!o.stare && o.stare !== 'vizitator');
    await ctx.route(/\.supabase\.co\//, (r) => r.abort());
    await ctx.route(/ipapi\.co\//, (r) => r.abort());
    if (o.stare && o.stare !== 'vizitator') await ctx.route(/\/api\/cont\/profil/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profil(o.stare)) }));
    const p = await ctx.newPage();
    const erori = [];
    const nume = pagina.split('?')[0].replace(/\.html$/, '');
    p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
    p.on('console', (m) => { if (m.type() === 'error' && !ZGOMOT.test(m.text()) && !(ZGOMOT_PAGINA[nume] && ZGOMOT_PAGINA[nume].test(m.text()))) erori.push('console: ' + m.text().slice(0, 160)); });
    const url = baza + '/' + pagina + (pagina.includes('?') || pagina.endsWith('.html') ? '' : '.html');
    await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => erori.push('goto: ' + e.message.slice(0, 100)));
    return { ctx, p, erori };
  }
  const intrari = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s + ' [data-meniu-intrare]')].map((a) => ({
    href: a.getAttribute('href'), titlu: ((a.querySelector('.mmp-t, .mmp-sb-t') || a).textContent || '').trim(),
  })), sel);
  const potriveste = (lista, en) => lista.length === 6 && lista.every((x, i) => x.href === ASTEPTAT[i][0] && x.titlu === ASTEPTAT[i][en ? 2 : 1]);
  // Deschide meniul din antet (hover pe .mega-wrap-ul lui).
  async function deschideAntet(p) {
    const wrap = await p.$('.mega-wrap:has([data-meniu-partener="antet"])');
    if (!wrap) return false;
    const vizibil = await wrap.evaluate((w) => w.getClientRects().length > 0 && getComputedStyle(w).display !== 'none');
    // Sub 769 px, antetele simple (categorii, termeni) păstrează doar linkul, fără meniul derulant.
    const panouAscuns = await wrap.evaluate((w) => getComputedStyle(w.querySelector('[data-meniu-partener="antet"]')).display === 'none');
    if (!vizibil || panouAscuns) return false;
    await wrap.hover();
    await asteapta(350);
    return true;
  }
  const panouInEcran = (p) => p.evaluate(() => {
    const pan = document.querySelector('[data-meniu-partener="antet"]');
    const r = pan.getBoundingClientRect();
    return { vizibil: getComputedStyle(pan).visibility === 'visible' && r.width > 0, stanga: r.left, dreapta: r.right, vw: document.documentElement.clientWidth };
  });

  const linkuri = new Map(); // href absolut → pagina unde apare
  try {
    // 1. Toate paginile publice, 1366 px: meniul din antet, linkurile din meniu și footer.
    let cuMeniu = 0;
    for (const pg of PUBLICE) {
      const { ctx, p, erori } = await deschide(pg);
      const nume = pg.split('?')[0].replace(/\.html$/, '');
      const are = await p.evaluate(() => !!document.querySelector('[data-meniu-partener="antet"]'));
      if (are) {
        cuMeniu++;
        const titlu = await p.evaluate(() => {
          const w = document.querySelector('[data-meniu-partener="antet"]').closest('.mega-wrap');
          return (w.querySelector('a').textContent || '').replace(/\s+/g, ' ').trim();
        });
        verifica(titlu === 'Devino Partener', `${nume}: meniul se numește „${titlu}”`);
        const l = await intrari(p, '[data-meniu-partener="antet"]');
        verifica(potriveste(l, false), `${nume}: meniul din antet are ${l.length} intrări: ${JSON.stringify(l.map((x) => x.titlu + ' → ' + x.href))}`);
        if (await deschideAntet(p)) {
          const m = await panouInEcran(p);
          verifica(m.vizibil && m.stanga >= 0 && m.dreapta <= m.vw + 0.5, `${nume} 1366: meniul derulant iese din ecran / nu se deschide ${JSON.stringify(m)}`);
        } else verifica(false, `${nume} 1366: meniul din antet nu se vede`);
      }
      // Linkurile vizibile (rândurile de contact fără valoare reală stau ascunse).
      const hrefuri = await p.evaluate(() => [...document.querySelectorAll('[data-meniu-partener] a[href], footer a[href]')].filter((a) => a.getClientRects().length && a.getAttribute('href') !== '#').map((a) => a.href));
      hrefuri.forEach((h) => { if (/^http:\/\/localhost/.test(h) && !linkuri.has(h)) linkuri.set(h, nume); });
      verifica(!erori.length, `${nume}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }
    console.log(`meniul din antet: ${cuMeniu} pagini`);
    const asteptatePublice = PUBLICE.filter((pg) => cuLoc.includes(pg.split('?')[0].replace(/\.html$/, '') + '.html')).length;
    verifica(cuMeniu === asteptatePublice && cuMeniu >= 28, `${cuMeniu} pagini publice au meniul în antet (așteptat ${asteptatePublice})`);

    // 2. Linkurile din meniu și din footer: 200 și ancore existente.
    const cereri = await browser.newContext();
    const verificate = [];
    for (const [h, pg] of linkuri) {
      const u = new URL(h);
      const r = await cereri.request.get(u.origin + u.pathname + u.search).catch(() => null);
      const cod = r ? r.status() : 0;
      let ancora = true;
      if (u.hash && u.hash.length > 1 && cod === 200) {
        const html = await r.text();
        const id = decodeURIComponent(u.hash.slice(1));
        ancora = new RegExp('id=["\']' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']').test(html);
      }
      verificate.push(`${u.pathname}${u.search}${u.hash} ${cod}${ancora ? '' : ' (ancoră lipsă)'}`);
      verifica(cod === 200 && ancora, `link ${u.pathname}${u.search}${u.hash} (din ${pg}): ${cod}${ancora ? '' : ', ancora nu există'}`);
      verifica(!/#partner-types|mydarrin-serviciu\.html/.test(h), `link spre o pagină veche: ${h} (din ${pg})`);
    }
    await cereri.close();
    if (process.argv.includes('--linkuri')) console.log(verificate.sort().join('\n'));
    console.log(`linkuri verificate: ${verificate.length}`);

    // 3. Meniul lateral, 390 px: aceleași 6 intrări (pagini cu meniul propriu și cu meniul preluat din index).
    for (const pg of ['index', 'despre-noi', 'cum-comanzi', 'mydarrin-catalog', 'servicii-urgente', 'mydarrin-checkout']) {
      const { ctx, p, erori } = await deschide(pg, { w: 390, h: 844 });
      await p.evaluate(() => window.openSidebar && window.openSidebar());
      await p.waitForSelector('#sidebar.open', { timeout: 8000 }).catch(() => {});
      await p.evaluate(() => window.toggleSbSection && window.toggleSbSection('sb-partner'));
      await asteapta(400);
      const l = await intrari(p, '#sb-partner');
      verifica(potriveste(l, false), `${pg} 390: meniul lateral are ${l.length} intrări: ${JSON.stringify(l.map((x) => x.titlu))}`);
      const vizibile = await p.evaluate(() => [...document.querySelectorAll('#sb-partner [data-meniu-intrare]')].filter((a) => a.getClientRects().length && a.getBoundingClientRect().height >= 44).length);
      verifica(vizibile === 6, `${pg} 390: ${vizibile} intrări vizibile, de cel puțin 44 px`);
      if (dosarCapturi && pg === 'index') { fs.mkdirSync(dosarCapturi, { recursive: true }); await p.screenshot({ path: path.join(dosarCapturi, 'meniu-lateral-390.png') }); }
      verifica(!erori.length, `${pg} 390: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }

    // 4. Butonul din meniu după stare (RO și EN), pe două pagini.
    for (const pg of ['despre-noi', 'mydarrin-catalog']) {
      for (const stare of Object.keys(TEXT)) {
        for (const limba of ['ro', null]) {
          const et = `${pg} ${stare} ${limba || 'en'}`;
          const { ctx, p, erori } = await deschide(pg, { stare, limba });
          await p.waitForFunction(() => { const b = document.querySelector('[data-meniu-partener="antet"] [data-cta-partener]'); return b && b.getAttribute('data-cta-stare') && b.getAttribute('data-cta-stare') !== 'incarca'; }, null, { timeout: 10000 }).catch(() => {});
          const b = await p.evaluate(() => { const x = document.querySelector('[data-meniu-partener="antet"] [data-cta-partener]'); return x ? { stare: x.getAttribute('data-cta-stare'), text: (x.querySelector('[data-cta-text]').textContent || '').trim(), href: x.getAttribute('href') } : null; });
          verifica(b && b.stare === stare && b.text === TEXT[stare][limba ? 0 : 1], `${et}: butonul din meniu ${JSON.stringify(b)}`);
          if (stare === 'activare' || stare === 'verificare' || stare === 'activ') verifica(b && /mydarrin-dashboard-partener\.html\?type=servicii/.test(b.href), `${et}: butonul nu duce în dashboard (${b && b.href})`);
          if (stare === 'vizitator' && limba === 'ro') {
            // Clic: fereastra de cont, la „Creare cont”, cu „Partener” ales.
            await p.evaluate(() => document.querySelector('[data-meniu-partener="antet"] [data-cta-partener]').click());
            await p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 8000 }).catch(() => {});
            const c = await p.evaluate(() => { const r = document.querySelector('#auth-modal input[name="mdc-cat"]:checked'); return r ? r.value : null; });
            verifica(c === 'partener', `${et}: clicul nu deschide fereastra de cont cu „Partener” (${c})`);
          }
          if (stare === 'vizitator' && !limba) {
            const l = await intrari(p, '[data-meniu-partener="antet"]');
            verifica(potriveste(l, true), `${et}: intrările nu sunt în engleză: ${JSON.stringify(l.map((x) => x.titlu))}`);
            const t = await p.evaluate(() => (document.querySelector('[data-meniu-partener="antet"]').closest('.mega-wrap').querySelector('a').textContent || '').trim());
            verifica(t === 'Become a Partner', `${et}: titlul meniului e „${t}”`);
            const ro = await p.evaluate(() => (document.querySelector('[data-meniu-partener="antet"]').innerText.match(/[ăâîșțşţ][^\n]{0,30}/gi) || []));
            verifica(!ro.length, `${et}: text românesc în meniu: ${ro.slice(0, 3).join(' | ')}`);
          }
          verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
          await ctx.close();
        }
      }
    }

    // 5. „Devino partener”: cele două butoane de sus și lista celor 5 tipuri.
    for (const [w, h] of [[390, 844], [1366, 900]]) {
      const et = `devino-partener ${w}px`;
      const { ctx, p, erori } = await deschide('mydarrin-devino-partener', { w, h });
      await p.waitForFunction(() => [...document.querySelectorAll('#hero-intro-content [data-cta-partener]')].every((b) => b.getAttribute('data-cta-stare') && b.getAttribute('data-cta-stare') !== 'incarca'), null, { timeout: 10000 }).catch(() => {});
      const s = await p.evaluate(() => {
        const prin = document.querySelector('#hero-intro-content [data-cta-partener]');
        const sec = document.getElementById('hero-cum-devii-btn');
        return { prin: prin && prin.querySelector('[data-cta-text]').textContent.trim(), fundal: prin && getComputedStyle(prin).backgroundColor, sec: sec && sec.textContent.replace(/\s+/g, ' ').trim() };
      });
      verifica(s.prin === 'Creează-ți contul de partener' && /255, 140, 0/.test(s.fundal), `${et}: butonul principal ${JSON.stringify(s)}`);
      verifica(s.sec === 'Cum devii partener', `${et}: butonul secundar e „${s.sec}”`);
      await p.click('#hero-cum-devii-btn');
      await asteapta(250);
      const lista = await p.evaluate(() => {
        const l = document.getElementById('hero-cum-devii-lista');
        const r = l.getBoundingClientRect();
        return { vizibil: !l.hidden && r.height > 0, stanga: r.left, dreapta: r.right, vw: document.documentElement.clientWidth, intrari: [...l.querySelectorAll('[data-meniu-intrare]')].map((a) => a.getAttribute('href')), extins: document.getElementById('hero-cum-devii-btn').getAttribute('aria-expanded') };
      });
      verifica(lista.vizibil && lista.extins === 'true', `${et}: lista tipurilor nu se deschide`);
      verifica(JSON.stringify(lista.intrari) === JSON.stringify(ASTEPTAT.slice(1).map((x) => x[0])), `${et}: lista tipurilor ${JSON.stringify(lista.intrari)}`);
      verifica(lista.stanga >= 0 && lista.dreapta <= lista.vw + 0.5, `${et}: lista tipurilor iese din ecran (${Math.round(lista.stanga)}–${Math.round(lista.dreapta)} / ${lista.vw})`);
      await p.keyboard.press('Escape');
      await asteapta(150);
      verifica(await p.evaluate(() => document.getElementById('hero-cum-devii-lista').hidden), `${et}: Escape nu închide lista`);
      verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }
    {
      const { ctx, p } = await deschide('mydarrin-devino-partener', { stare: 'activare' });
      await p.waitForFunction(() => { const b = document.querySelector('#hero-intro-content [data-cta-partener]'); return b && b.getAttribute('data-cta-stare') === 'activare'; }, null, { timeout: 10000 }).catch(() => {});
      const t = await p.evaluate(() => document.querySelector('#hero-intro-content [data-cta-partener] [data-cta-text]').textContent.trim());
      verifica(t === 'Finalizează-ți contul ca să primești comenzi', `devino-partener, activare: butonul principal e „${t}”`);
      await ctx.close();
    }

    // 6. Dimensiuni: meniul în ecran, fără derulare orizontală, fără erori JS.
    for (const [w, h] of [[360, 740], [390, 844], [768, 1024], [1024, 768], [1366, 900]]) {
      for (const pg of ['index', 'despre-noi', 'mydarrin-catalog', 'mydarrin-termeni', 'mydarrin-devino-partener']) {
        const et = `${pg} ${w}×${h}`;
        const { ctx, p, erori } = await deschide(pg, { w, h });
        if (await deschideAntet(p)) {
          const m = await panouInEcran(p);
          verifica(m.vizibil && m.stanga >= 0 && m.dreapta <= m.vw + 0.5, `${et}: meniul derulant iese din ecran ${JSON.stringify(m)}`);
          if (dosarCapturi && pg === 'index' && w === 1366) { fs.mkdirSync(dosarCapturi, { recursive: true }); await p.screenshot({ path: path.join(dosarCapturi, 'meniu-antet-1366.png') }); }
        }
        const d = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        verifica(d <= 1, `${et}: derulare orizontală de ${d}px`);
        verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
