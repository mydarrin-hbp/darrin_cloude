// scripts/test-fereastra-cont.js
// Pasul 11-R2 (1 nov. 2026): o singură fereastră de cont (cont-fereastra.js),
// cu rolul ales la început. Chromium (Playwright), 390 și 1366 px, pe index,
// despre-noi, mydarrin-catalog, mydarrin-devino-partener și cum-platesc (pagină
// care înainte nu avea fereastra și trimitea la index.html?reason=cont):
//   - fereastra se deschide pe loc, fără plecare de pe pagină, și încape în ecran;
//   - butoanele Google / Facebook / Apple nu apar (OAUTH_PROVIDERS_ACTIVI e gol);
//   - „Creare cont”: întâi rolul (6 roluri), apoi datele; prenumele, numele,
//     emailul, telefonul, parola și bifa GDPR sunt obligatorii; telefonul se
//     validează în format internațional; erorile apar sub câmp (MDFeedback);
//   - din „Devino partener” → servicii (și ?type=asigurator), rolul e deja ales;
//   - ?reason=cont deschide „Intră în cont”;
//   - în engleză (prima vizită), fereastra e în engleză;
//   - fără erori JS.
// Nicio cerere nu ajunge la Supabase (blocat); validarea se face înainte.
// Rulare: node scripts/test-fereastra-cont.js [pagina ...]

const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const PAGINI = ['index', 'despre-noi', 'mydarrin-catalog', 'mydarrin-devino-partener', 'cum-platesc'];
const LATIMI = [390, 1366];
const pagini = process.argv.slice(2).length ? process.argv.slice(2) : PAGINI;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));
const ZGOMOT = /Failed to load resource|net::ERR_|ERR_FAILED|Failed to fetch|status of 50[0-9]|status of 40[0-9]/i;

async function context(browser, latime, limba) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: 900 } });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
      if (l) localStorage.setItem('myd_lang_v1', l);
    } catch (e) {}
  }, limba || null);
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  await ctx.route(/ipapi\.co\//, (r) => r.abort());
  return ctx;
}
function urmaresteErori(p, erori) {
  p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
  p.on('console', (m) => { if (m.type() === 'error' && !ZGOMOT.test(m.text())) erori.push('console: ' + m.text().slice(0, 160)); });
}
const vizibila = (p) => p.evaluate(() => {
  const m = document.getElementById('auth-modal');
  if (!m || m.getAttribute('data-mdc') !== '1' || m.classList.contains('hidden')) return false;
  const c = m.querySelector('.mdc-cutie').getBoundingClientRect();
  return { stanga: c.left, dreapta: c.right, latime: window.innerWidth };
});
const rolAles = (p) => p.evaluate(() => { const r = document.querySelector('#auth-modal input[name="mdc-rol"]:checked'); return r ? r.value : null; });
const invalid = (p, id) => p.evaluate((x) => { const el = document.getElementById(x); return !!el && el.getAttribute('aria-invalid') === 'true'; }, id);

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
        if (pg === 'mydarrin-devino-partener') {
          // Fără ?type=, pagina partenerului nu deschide fereastra singură.
          await asteapta(300);
        }

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
        await p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 8000 }).catch(() => {});
        const v = await vizibila(p);
        verifica(!!v, `${et}: fereastra de cont nu s-a deschis (buton „${apasat}”)`);
        verifica(!navigari.length && p.url() === url, `${et}: butonul de cont a plecat de pe pagină (${navigari.join(' ')})`);
        if (v) verifica(v.stanga >= 0 && v.dreapta <= v.latime + 0.5, `${et}: fereastra iese din ecran (${Math.round(v.stanga)}–${Math.round(v.dreapta)} din ${v.latime})`);
        const copii = await p.evaluate(() => document.querySelectorAll('#auth-modal').length);
        verifica(copii === 1, `${et}: ${copii} ferestre #auth-modal`);

        // 2. Fără butoane sociale.
        const sociale = await p.evaluate(() => document.querySelectorAll('#auth-modal .mdc-social, #auth-modal [onclick*="oauthLogin"]').length);
        verifica(sociale === 0, `${et}: ${sociale} butoane sociale afișate`);

        // 3. „Creare cont”: rolul, apoi datele.
        await p.click('#tab-register-btn');
        const roluri = await p.evaluate(() => [...document.querySelectorAll('#auth-modal input[name="mdc-rol"]')].map((r) => r.value));
        verifica(roluri.join() === 'client,partener_servicii,partener_materiale,partener_inchirieri,partener_curier,partener_asigurari', `${et}: rolurile din primul ecran: ${roluri.join()}`);
        verifica(await p.isVisible('#mdc-pas-rol') && !(await p.isVisible('#reg-email')), `${et}: „Creare cont” nu începe cu alegerea rolului`);
        await p.click('#mdc-rol-continua');
        verifica(await p.isVisible('#mdc-rol-msg .md-feedback-eroare'), `${et}: „Continuă” fără rol nu arată eroarea`);
        await p.click('#auth-modal label[data-mdc-rol="client"]');
        await p.click('#mdc-rol-continua');
        verifica(await p.isVisible('#reg-prenume') && await p.isVisible('#reg-nume') && await p.isVisible('#reg-tel'), `${et}: ecranul de date nu are prenume / nume / telefon`);
        const obligatorii = await p.evaluate(() => ['reg-prenume', 'reg-nume', 'reg-email', 'reg-tel', 'reg-pass', 'reg-gdpr'].filter((id) => { const el = document.getElementById(id); return !el || !el.required; }));
        verifica(!obligatorii.length, `${et}: câmpuri neobligatorii: ${obligatorii.join(', ')}`);

        await p.click('#mdc-register-btn');
        await asteapta(250);
        verifica(await invalid(p, 'reg-tel') && await invalid(p, 'reg-gdpr'), `${et}: formularul gol nu marchează telefonul și bifa GDPR`);
        verifica(await p.isVisible('#mdc-register-msg .md-feedback-eroare'), `${et}: formularul gol nu arată mesajul de eroare`);

        await p.fill('#reg-prenume', 'Ana');
        await p.fill('#reg-nume', 'Popescu');
        await p.fill('#reg-email', 'ana.popescu@example.com');
        await p.fill('#reg-pass', 'parola-lunga-1');
        await p.fill('#reg-tel', '0712 345');
        await p.check('#reg-gdpr');
        await p.click('#mdc-register-btn');
        await asteapta(250);
        verifica(await invalid(p, 'reg-tel'), `${et}: telefonul fără prefix internațional e acceptat`);
        const subTel = await p.evaluate(() => { const el = document.getElementById('reg-tel'); const id = (el.getAttribute('aria-describedby') || '').split(' ').find((x) => x.startsWith('md-err-')); return id ? document.getElementById(id).textContent : ''; });
        verifica(/\+40/.test(subTel), `${et}: eroarea telefonului nu e sub câmp („${subTel}”)`);
        verifica(!(await invalid(p, 'reg-gdpr')) && !(await invalid(p, 'reg-email')), `${et}: câmpuri corecte marcate greșit`);

        await p.fill('#reg-tel', '+40 712 345 678');
        await p.uncheck('#reg-gdpr');
        await p.click('#mdc-register-btn');
        await asteapta(250);
        verifica(await invalid(p, 'reg-gdpr') && !(await invalid(p, 'reg-tel')), `${et}: fără bifa GDPR contul ar porni (sau telefonul corect e respins)`);
        verifica(p.url() === url, `${et}: pagina s-a schimbat în timpul înscrierii`);

        // 4. Ochiul parolei și închiderea cu Escape.
        await p.click('#auth-modal [data-mdc-ochi="reg-pass"]');
        verifica(await p.getAttribute('#reg-pass', 'type') === 'text', `${et}: ochiul nu arată parola`);
        await p.keyboard.press('Escape');
        verifica(!(await vizibila(p)), `${et}: Escape nu închide fereastra`);

        // 5. „Devino partener” → servicii: rolul e deja ales (fără sesiune).
        if (pg === 'mydarrin-devino-partener') {
          await p.evaluate(() => { window.handlePartnerNavigation('servicii'); });
          await p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 8000 }).catch(() => {});
          verifica(await rolAles(p) === 'partener_servicii', `${et}: din „Devino partener” → servicii, rolul ales e „${await rolAles(p)}”`);
          verifica(await p.isVisible('#mdc-pas-rol'), `${et}: rolul ales nu se confirmă în primul ecran`);
          const formular = await p.evaluate(() => { try { return selectedPartnerType; } catch (e) { return null; } });
          verifica(formular === 'servicii', `${et}: formularul firmei nu e „servicii” (${formular})`);
        }

        verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
        console.log(`${et}: gata`);
        await ctx.close();
      }
    }

    // Deschideri din URL și din meniul altor pagini.
    for (const latime of LATIMI) {
      for (const [cale, rol] of [['mydarrin-devino-partener.html?type=servicii', 'partener_servicii'], ['mydarrin-devino-partener.html?type=asigurator', 'partener_asigurari']]) {
        const et = `${cale} ${latime}px`;
        const ctx = await context(browser, latime, 'ro');
        const p = await ctx.newPage();
        const erori = [];
        urmaresteErori(p, erori);
        await p.goto(`${baza}/${cale}`, { waitUntil: 'networkidle', timeout: 60000 });
        await p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 8000 }).catch(() => {});
        verifica(await rolAles(p) === rol, `${et}: rolul ales „${await rolAles(p)}” (așteptat „${rol}”)`);
        verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
        await ctx.close();
      }
      {
        const et = `cum-platesc?reason=cont ${latime}px`;
        const ctx = await context(browser, latime, 'ro');
        const p = await ctx.newPage();
        const erori = [];
        urmaresteErori(p, erori);
        await p.goto(`${baza}/cum-platesc.html?reason=cont`, { waitUntil: 'networkidle', timeout: 60000 });
        await p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 8000 }).catch(() => {});
        verifica(await p.isVisible('#login-email'), `${et}: ?reason=cont nu deschide „Intră în cont”`);
        verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
        await ctx.close();
      }
      {
        // Prima vizită (engleză): fereastra și ecranul rolului sunt în engleză.
        const et = `index EN ${latime}px`;
        const ctx = await context(browser, latime, null);
        const p = await ctx.newPage();
        const erori = [];
        urmaresteErori(p, erori);
        await p.goto(`${baza}/index.html`, { waitUntil: 'networkidle', timeout: 60000 });
        await p.evaluate(() => window.toggleAuthModal());
        await p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 8000 }).catch(() => {});
        await p.click('#tab-register-btn');
        await asteapta(300);
        const text = await p.evaluate(() => document.querySelector('#auth-modal .mdc-cutie').innerText);
        verifica(/Create a free account/.test(text) && /Neighbourhood courier/.test(text), `${et}: fereastra nu e în engleză`);
        const ro = text.match(/[ăâîșțşţ][^\n]{0,30}/gi) || [];
        verifica(!ro.length, `${et}: text românesc în fereastră: ${ro.slice(0, 3).join(' | ')}`);
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
