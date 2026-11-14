// scripts/test-fereastra-cont.js
// Pasul 11-R2 (1 nov. 2026): o singură fereastră de cont (cont-fereastra.js),
// cu rolul ales la început. Pasul 11-R3 (2 nov. 2026): ecranul rolului în
// varianta A (Client / Partener, apoi grila de 5 tipuri), destinațiile după
// cod (clientul în catalog, partenerul în dashboard-ul lui) și revenirea în
// checkout.
//
// Chromium (Playwright). Pe index, despre-noi, mydarrin-catalog,
// mydarrin-devino-partener și cum-platesc (pagină care înainte nu avea
// fereastra), la 390 și 1366 px:
//   - fereastra se deschide pe loc, fără plecare de pe pagină, și încape în ecran;
//   - butoanele Google / Facebook / Apple nu apar (OAUTH_PROVIDERS_ACTIVI e gol);
//   - „Creare cont”: Client / Partener; grila tipurilor apare doar cu „Partener”;
//     prenumele, numele, emailul, telefonul, parola și bifa GDPR sunt
//     obligatorii; telefonul se validează în format internațional;
//   - din „Devino partener” → servicii (și ?type=asigurator), „Partener” și tipul
//     sunt deja alese;
//   - fără erori JS.
// Ecranul rolului la 360, 390, 430, 768 × 1024, 1024 × 768, 1366 și 1920 px
// (plus telefon în peisaj): cercuri de 16 px, butoane de cel puțin 44 px,
// carduri de aceeași lățime, fără derulare orizontală, „Continuă” vizibil cu
// „Client” ales, margini de 16 px pe telefon, fereastra centrată pe tabletă,
// conținutul ferestrei se derulează când e mai înaltă decât ecranul.
// Fluxuri (Supabase simulat în pagină, destinația simulată pe rută):
//   - client nou → cod → catalog, cu „Contul a fost creat”;
//   - partener nou (servicii) → cod → dashboard-ul rolului;
//   - login pornit din checkout → revine în checkout, nu în catalog.
// Rulare: node scripts/test-fereastra-cont.js [pagina ...]

const { chromium } = require('playwright');
const { porneste } = require('./server-test');

// Pasul 11-R3g: „Devino partener” = hub-ul cum-devii-partenerul-nostru (vechea pagină e redirecționată).
const PAGINI = ['index', 'despre-noi', 'mydarrin-catalog', 'cum-devii-partenerul-nostru', 'cum-platesc'];
const LATIMI = [390, 1366];
const ECRANE = [[360, 740], [390, 844], [430, 932], [768, 1024], [1024, 768], [1366, 900], [1920, 1080]];
const pagini = process.argv.slice(2).length ? process.argv.slice(2) : PAGINI;
const complet = !process.argv.slice(2).length;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));
const ZGOMOT = /Failed to load resource|net::ERR_|ERR_FAILED|Failed to fetch|status of 50[0-9]|status of 40[0-9]/i;

// Supabase simulat în pagină: înscriere, cod, login și sesiune, fără rețea.
// lib/supabaseClient.js încearcă să-l înlocuiască; setter-ul îl ignoră.
function supabaseSimulat() {
  const sesiune = { access_token: 'tok-test', user: { id: 'u-test', email: 'ana@example.com' } };
  let conectat = false;
  const fals = {
    auth: {
      signUp: async () => ({ data: { user: { id: 'u-test', identities: [{ id: 'i' }] } }, error: null }),
      getUser: async () => ({ data: { user: conectat ? sesiune.user : null }, error: null }),
      verifyOtp: async () => { conectat = true; return { data: { user: sesiune.user }, error: null }; },
      signInWithPassword: async () => { conectat = true; return { data: { user: sesiune.user }, error: null }; },
      getSession: async () => ({ data: { session: conectat ? sesiune : null } }),
      resend: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }) }) }) }),
  };
  Object.defineProperty(window, 'supabaseClient', { configurable: true, get() { return fals; }, set() {} });
}

async function context(browser, latime, limba, inaltime, cuSupabase) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: inaltime || 900 } });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), marketing: false, versiune: 2 }));
      if (l) localStorage.setItem('myd_lang_v1', l);
    } catch (e) {}
  }, limba || null);
  if (cuSupabase) await ctx.addInitScript(supabaseSimulat);
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  await ctx.route(/ipapi\.co\//, (r) => r.abort());
  return ctx;
}
function urmaresteErori(p, erori) {
  p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
  p.on('console', (m) => { if (m.type() === 'error' && !ZGOMOT.test(m.text())) erori.push('console: ' + m.text().slice(0, 160)); });
}
const deschisa = (p) => p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 8000 }).catch(() => {});
const vizibila = (p) => p.evaluate(() => {
  const m = document.getElementById('auth-modal');
  if (!m || m.getAttribute('data-mdc') !== '1' || m.classList.contains('hidden')) return false;
  const c = m.querySelector('.mdc-cutie').getBoundingClientRect();
  return { stanga: c.left, dreapta: c.right, latime: window.innerWidth };
});
const ales = (p) => p.evaluate(() => {
  const c = document.querySelector('#auth-modal input[name="mdc-cat"]:checked');
  const r = document.querySelector('#auth-modal input[name="mdc-rol"]:checked');
  return { cat: c ? c.value : null, rol: r ? r.value : null, grila: !document.getElementById('mdc-tipuri').hidden };
});
const invalid = (p, id) => p.evaluate((x) => { const el = document.getElementById(x); return !!el && el.getAttribute('aria-invalid') === 'true'; }, id);

async function completeazaDate(p) {
  await p.fill('#reg-prenume', 'Ana');
  await p.fill('#reg-nume', 'Popescu');
  await p.fill('#reg-email', 'ana@example.com');
  await p.fill('#reg-pass', 'parola-lunga-1');
  await p.fill('#reg-tel', '+40 712 345 678');
  await p.check('#reg-gdpr');
}

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const pg of pagini) {
      for (const latime of LATIMI) {
        const et = `${pg} ${latime}px`;
        const ctx = await context(browser, latime, 'ro');
        const p = await ctx.newPage();
        const erori = [];
        urmaresteErori(p, erori);
        const url = `${baza}/${pg}.html`;
        await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => erori.push('goto: ' + e.message.slice(0, 120)));

        // 1. Butonul de cont din pagină (antet, bara de jos sau meniul lateral).
        const navigari = [];
        p.on('framenavigated', (f) => { if (f === p.mainFrame()) navigari.push(f.url()); });
        const apasat = await p.evaluate(() => {
          const toate = [...document.querySelectorAll('[onclick*="toggleAuthModal"]')];
          const vizibil = toate.find((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('#sidebar'));
          const el = vizibil || toate[0];
          if (!el) return null;
          el.click();
          return (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30);
        });
        verifica(apasat !== null, `${et}: pagina nu are niciun buton de cont`);
        await deschisa(p);
        const v = await vizibila(p);
        verifica(!!v, `${et}: fereastra de cont nu s-a deschis (buton „${apasat}”)`);
        verifica(!navigari.length && p.url() === url, `${et}: butonul de cont a plecat de pe pagină (${navigari.join(' ')})`);
        if (v) verifica(v.stanga >= 0 && v.dreapta <= v.latime + 0.5, `${et}: fereastra iese din ecran (${Math.round(v.stanga)}–${Math.round(v.dreapta)} din ${v.latime})`);
        verifica(await p.evaluate(() => document.querySelectorAll('#auth-modal').length) === 1, `${et}: mai multe ferestre #auth-modal`);

        // 2. Fără butoane sociale.
        const sociale = await p.evaluate(() => document.querySelectorAll('#auth-modal .mdc-social, #auth-modal [onclick*="oauthLogin"]').length);
        verifica(sociale === 0, `${et}: ${sociale} butoane sociale afișate`);

        // 3. „Creare cont”: Client / Partener; grila doar cu „Partener”.
        await p.click('#tab-register-btn');
        const categorii = await p.evaluate(() => [...document.querySelectorAll('#auth-modal .mdc-card:not([hidden]) input[name="mdc-cat"]')].map((r) => r.value));
        const tipuri = await p.evaluate(() => [...document.querySelectorAll('#auth-modal input[name="mdc-rol"]')].map((r) => r.value));
        verifica(categorii.join() === 'client,partener', `${et}: cardurile din primul ecran: ${categorii.join()}`);
        verifica(tipuri.join() === 'partener_servicii,partener_materiale,partener_inchirieri,partener_curier,partener_asigurari', `${et}: tipurile de partener: ${tipuri.join()}`);
        verifica(!(await ales(p)).grila, `${et}: grila tipurilor apare fără „Partener” ales`);
        await p.click('#mdc-rol-continua');
        verifica(await p.isVisible('#mdc-rol-msg .md-feedback-eroare'), `${et}: „Continuă” fără alegere nu arată eroarea`);
        await p.click('#auth-modal label[data-mdc-cat="partener"]');
        verifica((await ales(p)).grila, `${et}: grila tipurilor nu apare cu „Partener” ales`);
        await p.click('#mdc-rol-continua');
        verifica(await p.isVisible('#mdc-rol-msg .md-feedback-eroare') && !(await p.isVisible('#reg-email')), `${et}: „Partener” fără tip trece mai departe`);
        await p.click('#auth-modal label[data-mdc-cat="client"]');
        verifica(!(await ales(p)).grila, `${et}: grila tipurilor rămâne cu „Client” ales`);
        await p.click('#mdc-rol-continua');
        verifica(await p.isVisible('#reg-prenume') && await p.isVisible('#reg-nume') && await p.isVisible('#reg-tel'), `${et}: ecranul de date nu are prenume / nume / telefon`);
        const obligatorii = await p.evaluate(() => ['reg-prenume', 'reg-nume', 'reg-email', 'reg-tel', 'reg-pass', 'reg-gdpr'].filter((id) => { const el = document.getElementById(id); return !el || !el.required; }));
        verifica(!obligatorii.length, `${et}: câmpuri neobligatorii: ${obligatorii.join(', ')}`);

        await p.click('#mdc-register-btn');
        await asteapta(250);
        verifica(await invalid(p, 'reg-tel') && await invalid(p, 'reg-gdpr'), `${et}: formularul gol nu marchează telefonul și bifa GDPR`);
        await completeazaDate(p);
        await p.fill('#reg-tel', '0712 345');
        await p.click('#mdc-register-btn');
        await asteapta(250);
        verifica(await invalid(p, 'reg-tel'), `${et}: telefonul fără prefix internațional e acceptat`);
        await p.fill('#reg-tel', '+40 712 345 678');
        await p.uncheck('#reg-gdpr');
        await p.click('#mdc-register-btn');
        await asteapta(250);
        verifica(await invalid(p, 'reg-gdpr') && !(await invalid(p, 'reg-tel')), `${et}: fără bifa GDPR contul ar porni (sau telefonul corect e respins)`);
        verifica(p.url() === url, `${et}: pagina s-a schimbat în timpul înscrierii`);

        await p.click('#auth-modal [data-mdc-ochi="reg-pass"]');
        verifica(await p.getAttribute('#reg-pass', 'type') === 'text', `${et}: ochiul nu arată parola`);
        await p.keyboard.press('Escape');
        verifica(!(await vizibila(p)), `${et}: Escape nu închide fereastra`);

        // 4. „Devino partener” → servicii: „Partener” și „Servicii” deja alese (fără sesiune).
        if (pg === 'cum-devii-partenerul-nostru') {
          await p.click('#tip-servicii [data-cta-card]');
          await deschisa(p);
          const a = await ales(p);
          verifica(a.cat === 'partener' && a.rol === 'partener_servicii' && a.grila, `${et}: din „Devino partener” → servicii: ${JSON.stringify(a)}`);
          verifica(await p.isVisible('#mdc-pas-rol'), `${et}: rolul ales nu se confirmă în primul ecran`);
          verifica(await p.evaluate(() => !document.getElementById('partner-modal') && !document.getElementById('f-firma')), `${et}: fereastra publică cu formularul de 14 câmpuri a rămas`);
        }

        verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
        console.log(`${et}: gata`);
        await ctx.close();
      }
    }

    if (complet) {
      // 5. Ecranul rolului pe toate dispozitivele.
      // Pe index (reguli globale de 44 px pentru radio) și pe „Devino partener”.
      for (const [w, h, pagina] of ECRANE.map((e) => e.concat('cum-devii-partenerul-nostru')).concat(ECRANE.map((e) => e.concat('index')), [[740, 360, 'cum-devii-partenerul-nostru']])) {
        const et = `ecranul rolului ${pagina} ${w}×${h}`;
        const ctx = await context(browser, w, 'ro', h);
        const p = await ctx.newPage();
        const erori = [];
        urmaresteErori(p, erori);
        if (pagina === 'index') {
          await p.goto(`${baza}/index.html`, { waitUntil: 'networkidle', timeout: 60000 });
          await p.evaluate(() => window.MDCont.deschide({ tab: 'register', rol: 'partener_servicii' }));
        } else {
          // Hub-ul cu ?type=servicii: butonul principal deschide fereastra cu tipul bifat.
          await p.goto(`${baza}/cum-devii-partenerul-nostru.html?type=servicii`, { waitUntil: 'networkidle', timeout: 60000 });
          await p.waitForFunction(() => { const b = document.querySelector('.rp-hero [data-rp-principal]'); return b && b.getAttribute('data-cta-stare') === 'vizitator'; }, null, { timeout: 10000 }).catch(() => {});
          await p.click('.rp-hero [data-rp-principal]');
        }
        await deschisa(p);
        const a = await ales(p);
        verifica(a.cat === 'partener' && a.rol === 'partener_servicii' && a.grila, `${et}: din ?type=servicii: ${JSON.stringify(a)}`);
        const m = await p.evaluate(() => {
          const r = (el) => el.getBoundingClientRect();
          const cutie = document.querySelector('#auth-modal .mdc-cutie');
          const carduri = [...document.querySelectorAll('#mdc-categorii .mdc-card:not([hidden])')].map(r);
          const butoane = [...document.querySelectorAll('#mdc-roluri .mdc-tip')].map(r);
          const cercuri = [...document.querySelectorAll('#mdc-roluri input')].map(r);
          const coloane = new Set(butoane.map((b) => Math.round(b.left))).size;
          return {
            cutie: r(cutie), vw: window.innerWidth, vh: window.innerHeight,
            scroll: document.documentElement.scrollWidth, sw: cutie.scrollWidth, cw: cutie.clientWidth,
            carduri, coloane,
            minButon: Math.min(...butoane.map((b) => b.height)),
            cercuri: cercuri.map((c) => [Math.round(c.width), Math.round(c.height)]),
            corp: getComputedStyle(document.body).overflow, cutieY: getComputedStyle(cutie).overflowY,
            sh: cutie.scrollHeight, ch: cutie.clientHeight,
          };
        });
        verifica(m.scroll <= m.vw && m.sw <= m.cw + 1, `${et}: derulare orizontală (${m.scroll} / ${m.vw}, cutie ${m.sw} / ${m.cw})`);
        verifica(m.cutie.left >= 0 && m.cutie.right <= m.vw + 0.5, `${et}: fereastra iese din ecran`);
        verifica(m.cercuri.every(([cw, ch]) => cw === 16 && ch === 16), `${et}: cercurile nu au 16 px: ${JSON.stringify(m.cercuri)}`);
        verifica(m.minButon >= 44, `${et}: buton de tip sub 44 px (${m.minButon})`);
        verifica(m.coloane === 2, `${et}: grila are ${m.coloane} coloane`);
        verifica(m.carduri.length === 2 && Math.abs(m.carduri[0].width - m.carduri[1].width) < 1 && Math.abs(m.carduri[0].top - m.carduri[1].top) < 1, `${et}: cardurile Client / Partener nu sunt alăturate, de aceeași lățime`);
        if (w <= 430) verifica(Math.abs(m.cutie.left - 16) < 1 && Math.abs(m.vw - m.cutie.right - 16) < 1, `${et}: pe telefon fereastra nu are margini de 16 px (${m.cutie.left}, ${m.vw - m.cutie.right})`);
        if (w >= 768) verifica(Math.abs(m.cutie.width - 448) < 1 && Math.abs(m.cutie.left - (m.vw - m.cutie.right)) < 1, `${et}: fereastra nu e centrată la 448 px (${m.cutie.width})`);
        verifica(m.corp === 'hidden' && m.cutieY === 'auto', `${et}: pagina din spate se derulează (body ${m.corp}, fereastră ${m.cutieY})`);
        if (h < 500) verifica(m.sh > m.ch, `${et}: în peisaj, conținutul ferestrei nu se derulează`);
        // „Client” ales: grila dispare, „Continuă” e vizibil fără derulare (pe telefon, în portret).
        await p.click('#auth-modal label[data-mdc-cat="client"]');
        const c = await p.evaluate(() => {
          const b = document.getElementById('mdc-rol-continua').getBoundingClientRect();
          return { jos: b.bottom, vh: window.innerHeight, grila: !document.getElementById('mdc-tipuri').hidden };
        });
        verifica(!c.grila, `${et}: grila rămâne cu „Client” ales`);
        if (h >= 600) verifica(c.jos <= c.vh, `${et}: „Continuă” nu e vizibil fără derulare (${Math.round(c.jos)} / ${c.vh})`);
        verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
        await ctx.close();
      }
      console.log('ecranul rolului: gata');

      // 6. Deschideri din URL.
      for (const latime of LATIMI) {
        for (const [cale, rol] of [['mydarrin-devino-partener.html?type=asigurator', 'partener_asigurari']]) {
          const et = `${cale} ${latime}px`;
          const ctx = await context(browser, latime, 'ro');
          const p = await ctx.newPage();
          const erori = [];
          urmaresteErori(p, erori);
          await p.goto(`${baza}/${cale}`, { waitUntil: 'networkidle', timeout: 60000 });
          // Pasul 11-R3g: adresa veche duce la hub, cu ?type= păstrat; butonul principal are tipul.
          await p.waitForFunction(() => { const b = document.querySelector('.rp-hero [data-rp-principal]'); return b && b.getAttribute('data-cta-stare') === 'vizitator'; }, null, { timeout: 10000 }).catch(() => {});
          await p.click('.rp-hero [data-rp-principal]');
          await deschisa(p);
          const a = await ales(p);
          verifica(a.cat === 'partener' && a.rol === rol, `${et}: ${JSON.stringify(a)} (așteptat ${rol})`);
          verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
          await ctx.close();
        }
        {
          const et = `cum-platesc?reason=cont ${latime}px`;
          const ctx = await context(browser, latime, 'ro');
          const p = await ctx.newPage();
          await p.goto(`${baza}/cum-platesc.html?reason=cont`, { waitUntil: 'networkidle', timeout: 60000 });
          await deschisa(p);
          verifica(await p.isVisible('#login-email'), `${et}: ?reason=cont nu deschide „Intră în cont”`);
          await ctx.close();
        }
        {
          const et = `index EN ${latime}px`;
          const ctx = await context(browser, latime, null);
          const p = await ctx.newPage();
          const erori = [];
          urmaresteErori(p, erori);
          await p.goto(`${baza}/index.html`, { waitUntil: 'networkidle', timeout: 60000 });
          await p.evaluate(() => window.toggleAuthModal());
          await deschisa(p);
          await p.click('#tab-register-btn');
          await p.click('#auth-modal label[data-mdc-cat="partener"]');
          await asteapta(300);
          const text = await p.evaluate(() => document.querySelector('#auth-modal .mdc-cutie').innerText);
          verifica(/Create a free account/.test(text) && /Partner type/i.test(text) && /Neighbourhood courier/.test(text), `${et}: fereastra nu e în engleză`);
          const ro = text.match(/[ăâîșțşţ][^\n]{0,30}/gi) || [];
          verifica(!ro.length, `${et}: text românesc în fereastră: ${ro.slice(0, 3).join(' | ')}`);
          verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
          await ctx.close();
        }
      }

      // 7. Fluxurile după cod și după login (Supabase simulat, destinația simulată).
      async function flux(et, pagina, destinatieServer, pasi, asteptat, mesaj) {
        const ctx = await context(browser, 390, 'ro', 844, true);
        await ctx.route(/\/api\/public\/destinatie-post-login/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(destinatieServer) }));
        const p = await ctx.newPage();
        const erori = [];
        urmaresteErori(p, erori);
        await p.goto(`${baza}/${pagina}`, { waitUntil: 'networkidle', timeout: 60000 });
        const navigari = [];
        p.on('framenavigated', (f) => { if (f === p.mainFrame()) navigari.push(new URL(f.url()).pathname); });
        await pasi(p);
        // Destinația poate fi chiar pagina de pornire (checkout): se așteaptă navigarea.
        for (let i = 0; i < 100 && !navigari.includes(asteptat); i++) await asteapta(100);
        verifica(navigari.includes(asteptat), `${et}: a ajuns la ${navigari.join(' → ') || 'nicăieri'} (așteptat ${asteptat})`);
        if (mesaj) {
          await p.waitForLoadState('networkidle').catch(() => {});
          await p.waitForFunction((t) => [...document.querySelectorAll('.md-toast-text')].some((e) => e.textContent.includes(t)), mesaj, { timeout: 8000 }).catch(() => {});
          verifica(await p.evaluate((t) => [...document.querySelectorAll('.md-toast-text')].some((e) => e.textContent.includes(t)), mesaj), `${et}: mesajul „${mesaj}” nu apare pe pagina de destinație`);
        }
        verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
        await ctx.close();
      }
      const inscriere = (cat, tip) => async (p) => {
        await p.evaluate(() => window.toggleAuthModal());
        await deschisa(p);
        await p.click('#tab-register-btn');
        await p.click(`#auth-modal label[data-mdc-cat="${cat}"]`);
        if (tip) await p.click(`#auth-modal label[data-mdc-rol="${tip}"]`);
        await p.click('#mdc-rol-continua');
        await completeazaDate(p);
        await p.click('#mdc-register-btn');
        await p.waitForSelector('#verify-cod-input', { state: 'visible', timeout: 8000 });
        await p.fill('#verify-cod-input', '123456');
        await p.click('#mdc-cod-btn');
      };
      await flux('client nou → cod → catalog', 'index.html',
        { ok: true, tip: 'client_fara_comenzi', destinatie: '/mydarrin-catalog.html' },
        inscriere('client'), '/mydarrin-catalog.html', 'Contul a fost creat');
      await flux('partener nou (servicii) → cod → dashboard-ul rolului', 'despre-noi.html',
        { ok: true, tip: 'activare_partener', rol: 'partener_servicii', destinatie: '/mydarrin-dashboard-partener.html?type=servicii' },
        inscriere('partener', 'partener_servicii'), '/mydarrin-dashboard-partener.html');
      await flux('login pornit din checkout → revine în checkout', 'mydarrin-checkout.html',
        { ok: true, tip: 'client_fara_comenzi', destinatie: '/mydarrin-catalog.html' },
        async (p) => {
          await p.evaluate(() => window.switchAuthTab('login'));
          await deschisa(p);
          await p.fill('#login-email', 'ana@example.com');
          await p.fill('#login-pass', 'parola-lunga-1');
          await p.click('#mdc-login-btn');
        }, '/mydarrin-checkout.html');
      console.log('fluxuri: gata');
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
