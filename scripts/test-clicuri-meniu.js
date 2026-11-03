// scripts/test-clicuri-meniu.js
// Pasul 11-R1 (2 nov. 2026): pe fiecare pagină publică, fiecare intrare
// „Devino partener” (meniul de sus și meniul lateral ≡) și fiecare buton de coș
// trebuie să facă ceva: partenerul ajunge la mydarrin-devino-partener.html?type=<tip>
// (sau se deschide fereastra partenerului de pe pagină), coșul deschide panoul
// sau duce la checkout. Fără erori JS. Chromium (Playwright), 390 și 1366 px.
// „Asigurator” (type=asigurator) trebuie să ajungă la formularul asigurari.
// Pasul 11-R3b: pe „Devino partener”, ?type=<tip> deschide fereastra de cont cu
// „Partener” și tipul deja alese (cardurile #partner-types s-au scos).
//
// Navigarea spre pagina partenerului sau spre checkout e oprită cu un răspuns
// 204 (pagina rămâne pe loc), așa că pe aceeași încărcare se încearcă toate
// intrările. Clicul se dă din DOM (element.click()), ca să ajungă și la
// intrările din meniurile închise. /api simulat de server-test, Supabase și ipapi.co blocate.
// Rulare: node scripts/test-clicuri-meniu.js [pagina ...]

const { chromium } = require('playwright');
const { porneste } = require('./server-test');

// Aceeași listă ca în scripts/detector-ro.js (PUBLICE).
const PUBLICE = ['index', 'servicii-urgente', 'despre-noi', 'afla-ce-facem', 'mydarrin-contact', 'mydarrin-app-mobile',
  'mydarrin-catalog', 'mydarrin-categorie-servicii.html?type=servicii&cat=instalatii-electrice', 'mydarrin-categorie-materiale',
  'mydarrin-categorie-inchirieri', 'mydarrin-marketplace', 'mydarrin-marketplace-materiale.html?slug=montaj-parchet-laminat&type=servicii&nace=43.33',
  'mydarrin-produs.html?slug=inlocuire-becuri-corpuri&type=servicii', 'mydarrin-serviciu', 'mydarrin-checkout', 'mydarrin-cos',
  'mydarrin-creeaza-deviz', 'confirmare-livrare', 'reset-password', 'mydarrin-cum-functioneaza', 'cum-comanzi', 'cum-platesc',
  'cum-programez-serviciu', 'cum-prestam-livram', 'intrebari-frecvente-clienti', 'intrebari-frecvente-parteneri',
  'garantii-si-asigurari', 'ghidul-asiguratorului', 'reclamatii', 'mydarrin-devino-partener',
  'cum-devii-partenerul-nostru', 'cum-devii-curier-de-cartier', 'cum-devii-furnizor-materiale', 'cum-devii-operator-inchirieri',
  'mydarrin-investitori', 'mydarrin-pitch-deck', 'acord-confidentialitate', 'acces-temporar', 'mydarrin-termeni',
  'mydarrin-politica-confidentialitate'];

const LATIMI = [390, 1366];
const pagini = process.argv.slice(2).length ? process.argv.slice(2) : PUBLICE;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));
// Linkurile „Asigurator” trimit type=asigurator; formularul e „asigurari”.
const tipFormular = (tip) => (tip === 'asigurator' ? 'asigurari' : tip);

// Erori de consolă care nu țin de cod: resurse oprite intenționat (Supabase,
// ipapi.co, fonturi/CDN fără rețea) și răspunsurile 4xx/5xx ale serverului de test.
const ZGOMOT = /Failed to load resource|net::ERR_|ERR_FAILED|Failed to fetch|status of 50[0-9]|status of 40[0-9]/i;
// Pe mydarrin-pitch-deck, /api/public/pitch-deck nu e simulat de server-test (503),
// iar pagina scrie în consolă „[pitch-deck] Error: http 503”. Doar mesajul acesta,
// doar pe pagina aceea, nu se numără (urmat doar de stiva erorii).
const ZGOMOT_PAGINA = { 'mydarrin-pitch-deck': /^\[pitch-deck\] Error: http 503(\n\s+at |$)/ };

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const pg of pagini) {
      const url = baza + '/' + pg + (pg.includes('?') ? '' : '.html');
      const numePagina = pg.split('?')[0].replace(/\.html$/, '');
      for (const latime of LATIMI) {
        const et = `${numePagina} ${latime}px`;
        const ctx = await browser.newContext({ viewport: { width: latime, height: 900 } });
        await ctx.addInitScript(() => {
          try { localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 })); } catch (e) {}
        });
        await ctx.route(/\.supabase\.co\//, (r) => r.abort());
        // Detecția locației prin IP (serviciu extern): oprită, ca rezultatul să nu depindă de rețea.
        await ctx.route(/ipapi\.co\//, (r) => r.abort());
        const p = await ctx.newPage();
        const erori = [];
        p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
        const zgomotPagina = ZGOMOT_PAGINA[numePagina];
        p.on('console', (m) => {
          if (m.type() !== 'error' || ZGOMOT.test(m.text()) || (zgomotPagina && zgomotPagina.test(m.text()))) return;
          erori.push('console: ' + m.text().slice(0, 160));
        });

        // După încărcare, navigările spre partener / checkout se rețin și se opresc.
        let armat = false;
        const navigari = [];
        await p.route(/\/(mydarrin-devino-partener(\.html)?|partener|mydarrin-checkout(\.html)?|mydarrin-cos(\.html)?)(\?|$)/, (r) => {
          if (armat && r.request().isNavigationRequest()) { navigari.push(r.request().url()); return r.fulfill({ status: 204, body: '' }); }
          return r.continue();
        });

        await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => erori.push('goto: ' + e.message.slice(0, 120)));
        // Meniul lateral: pe paginile fără el, ui-comun.js îl aduce din index.html la deschidere.
        await p.evaluate(() => { try { if (typeof window.openSidebar === 'function') window.openSidebar(); } catch (e) {} });
        await p.waitForFunction(() => !!document.getElementById('sidebar'), null, { timeout: 8000 }).catch(() => {});
        await p.evaluate(() => { try { if (typeof window.closeSidebar === 'function') window.closeSidebar(); } catch (e) {} });
        await asteapta(300);
        armat = true;

        // Intrările „Devino partener”: onclick cu tipul partenerului sau link cu ?type=.
        const intrari = await p.evaluate(() => {
          const re = /(handlePartnerNavigation|openPartnerModal|openPartnerWizard)\(\s*['"](\w+)['"]/;
          const toate = [...document.querySelectorAll('[onclick], a[href*="devino-partener"]')];
          const rez = [];
          toate.forEach((el, i) => {
            const oc = el.getAttribute('onclick') || '';
            let tip = null;
            const m = oc.match(re);
            if (m) tip = m[2];
            else if (el.tagName === 'A') { const h = el.getAttribute('href') || ''; const q = h.match(/[?&]type=(\w+)/); if (q && /devino-partener\.html/.test(h)) tip = q[1]; }
            if (!tip) return;
            el.setAttribute('data-test-intrare', String(i));
            rez.push({ id: String(i), tip, loc: el.closest('#sidebar') ? 'meniul lateral' : 'pagină', text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) });
          });
          return rez;
        });
        const peParteneri = numePagina === 'mydarrin-devino-partener';

        for (const intr of intrari) {
          navigari.length = 0;
          const asteptat = tipFormular(intr.tip);
          // Pe pagina partenerului, clicul alege formularul pe loc: se verifică tipul ales.
          if (peParteneri) await p.evaluate(() => { try { selectedPartnerType = null; } catch (e) {} });
          await p.evaluate((id) => { const el = document.querySelector(`[data-test-intrare="${id}"]`); if (el) el.click(); }, intr.id);
          await asteapta(400);
          // Altundeva: ajunge la pagina partenerului cu tipul care deschide formularul așteptat
          // (type=asigurator e acceptat acolo ca asigurari — verificat mai jos, la deschiderea din URL).
          const spreTip = navigari.some((u) => { const x = new URL(u); return /devino-partener|\/partener$/.test(x.pathname) && tipFormular(x.searchParams.get('type')) === asteptat; });
          const ales = peParteneri ? await p.evaluate(() => { try { return selectedPartnerType; } catch (e) { return null; } }) : null;
          verifica(spreTip || ales === asteptat,
            `${et}: „${intr.text}” (${intr.loc}, ${intr.tip}) nu duce la formularul ${asteptat} (navigare: ${navigari.join(' ') || '—'}, ales: ${ales})`);
          // Înapoi la starea inițială pentru următoarea intrare.
          await p.evaluate(() => {
            try { if (typeof window.closePartnerModal === 'function') window.closePartnerModal(); } catch (e) {}
            const m = document.getElementById('partner-modal'); if (m) m.classList.add('hidden');
            document.body.style.overflow = '';
          });
        }

        // Coșul: butoanele cu toggleBasket().
        const cosuri = await p.evaluate(() => {
          const rez = [];
          document.querySelectorAll('[onclick*="toggleBasket"]').forEach((el, i) => { el.setAttribute('data-test-cos', String(i)); rez.push({ id: String(i), loc: el.closest('#sidebar') ? 'meniul lateral' : 'pagină' }); });
          return rez;
        });
        for (const c of cosuri) {
          navigari.length = 0;
          await p.evaluate((id) => {
            const panou = document.getElementById('basket-panel'); if (panou) panou.classList.add('hidden');
            const el = document.querySelector(`[data-test-cos="${id}"]`); if (el) el.click();
          }, c.id);
          await asteapta(400);
          // Panoul coșului: #basket-panel (index) sau sertarul #cart-drawer (paginile de categorie).
          const deschis = await p.evaluate(() => {
            const b = document.getElementById('basket-panel');
            if (b && !b.classList.contains('hidden')) return true;
            const d = document.getElementById('cart-drawer');
            return !!d && /translateX\(0/.test(d.style.transform);
          });
          const spreCheckout = navigari.some((u) => /mydarrin-checkout|mydarrin-cos/.test(new URL(u).pathname));
          verifica(deschis || spreCheckout, `${et}: coșul (${c.loc}) nu face nimic`);
        }

        verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
        console.log(`${et}: ${intrari.length} intrări partener, ${cosuri.length} coșuri`);
        await ctx.close();
      }
    }

    // Deschiderea din URL: mydarrin-devino-partener.html?type=<tip> alege formularul tipului;
    // type=asigurator (linkurile „Asigurator” de pe celelalte pagini) → formularul asigurari.
    if (!process.argv.slice(2).length || pagini.includes('mydarrin-devino-partener')) {
      for (const latime of LATIMI) {
        for (const tip of ['servicii', 'materiale', 'inchirieri', 'curier', 'asigurari', 'asigurator']) {
          const et = `mydarrin-devino-partener?type=${tip} ${latime}px`;
          const ctx = await browser.newContext({ viewport: { width: latime, height: 900 } });
          await ctx.route(/\.supabase\.co\//, (r) => r.abort());
          await ctx.route(/ipapi\.co\//, (r) => r.abort());
          const p = await ctx.newPage();
          const erori = []; p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
          await p.goto(`${baza}/mydarrin-devino-partener.html?type=${tip}`, { waitUntil: 'networkidle', timeout: 60000 });
          await p.waitForFunction((t) => { try { return selectedPartnerType === t; } catch (e) { return false; } }, tipFormular(tip), { timeout: 5000 }).catch(() => {});
          // Pasul 11-R3b: cardurile de tip (#partner-types) s-au scos; tipul ales deschide
          // fereastra de cont cu „Partener” și tipul deja alese (vizitator).
          await p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 8000 }).catch(() => {});
          const stare = await p.evaluate(() => {
            let ales = null; try { ales = selectedPartnerType; } catch (e) {}
            const r = document.querySelector('#auth-modal input[name="mdc-rol"]:checked');
            return { ales, rol: r ? r.value : null };
          });
          verifica(stare.ales === tipFormular(tip) && stare.rol === 'partener_' + tipFormular(tip),
            `${et}: tipul ales „${stare.ales}”, rolul din fereastra de cont „${stare.rol}” (așteptat „${tipFormular(tip)}”)`);
          verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
          await ctx.close();
        }
        console.log(`mydarrin-devino-partener?type=… ${latime}px: gata`);
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
