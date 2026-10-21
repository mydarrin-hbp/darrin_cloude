// scripts/test-pagina-investitori.js
// Pagina Investitori (pasul 11-M, 21 oct. 2026), în RO și EN, la 390 și 1366 px:
//   A. selectorul de limbă există, e accesibil de la tastatură și schimbă
//      textele paginii și ale ferestrei rutei;
//   B. butonul comun de cont: nelogat → „Intră în cont”; logat (simulat) →
//      inițialele și meniul cu „Rolurile mele”;
//   C. „Intră în rundă” din hero și din secțiunea Seed deschid fereastra în
//      sub 500 ms de la clic, chiar cu API-urile întârziate 3 s (starea
//      „Se încarcă…” / „Loading…”), apoi datele se completează;
//   D. dublu-clic → o singură fereastră; butonul e blocat cât se deschide;
//   E. nelogat → trimiterea la autentificare fără așteptare;
//   F. fără răspuns în 10 s → mesaj și „Reîncearcă” (o dată, EN 1366);
//   G. secțiunea Seed: pașii și containerul [data-runda] ascuns, fără cifre;
//   H. 0 erori JS (inclusiv nicio eroare de regex), nimic în afara ecranului.
// Sesiunea Supabase și API-urile sunt simulate (nimic nu ajunge la Supabase).
//
// Cerințe: npm i --no-save playwright && npx playwright install chromium
// Rulare: node scripts/test-pagina-investitori.js

const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const UTILIZATOR = { id: '40000000-0000-4000-8000-0000000000c1', email: 'ana.test@example.com', email_confirmed_at: '2026-10-01T08:00:00Z', user_metadata: { prenume: 'Ana', nume: 'Test' } };
const INTARZIERE = 3000;

function sesiuneSimulata(cfg) {
  const user = cfg.user;
  const sesiune = cfg.cuSesiune ? { access_token: 'token-simulat', user } : null;
  const lant = (rezultat) => {
    const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rezultat) : () => p), apply: () => p });
    return p;
  };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: sesiune ? user : null }, error: null }),
      getSession: async () => ({ data: { session: sesiune }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: () => lant({ data: null, error: null }),
    rpc: () => lant({ data: { error: 'simulat' }, error: null }),
    storage: { from: () => ({ uploadToSignedUrl: async (path) => ({ data: { path }, error: null }) }) },
    channel: () => lant({}),
    removeChannel: () => {},
  };
  const auth = new Proxy({
    getCurrentUser: async () => (sesiune ? user : null),
    getUserRoles: async () => [],
    performLogout: () => {},
  }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (nume, val) => Object.defineProperty(window, nume, { configurable: true, get: () => val, set: () => {} });
  if (cfg.cuSesiune) { fix('supabaseClient', client); fix('MyDarrinAuth', auth); }
}

const PROFIL = {
  ok: true, email: UTILIZATOR.email, nume: 'Ana Test', prenume: 'Ana', nume_familie: 'Test', telefon: '+40700000001', tara: 'RO',
  roles: ['client'], roluri_dashboard: ['client'], destinatie: '/mydarrin-dashboard-client.html', tip_destinatie: 'rol', furnizor_propriu: false, partener: null, investitor: null,
};
const KYC = { ok: true, kyc: null, lipsa: ['date_personale'], cont: { prenume: 'Ana', nume: 'Test', email: UTILIZATOR.email, telefon: '+40700000001', tara: 'RO' } };

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

async function context(browser, { lang, latime, cuSesiune, intarziere = 0, faraRaspuns = false }) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: 860 } });
  await ctx.addInitScript((l) => {
    try {
      if (!sessionStorage.getItem('__l')) { localStorage.setItem('myd_lang_v1', l); sessionStorage.setItem('__l', '1'); }
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
    } catch (e) {}
  }, lang);
  await ctx.addInitScript(sesiuneSimulata, { user: UTILIZATOR, cuSesiune });
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  const raspunde = (r, corp) => {
    if (faraRaspuns) return; // serverul nu răspunde
    setTimeout(() => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corp) }).catch(() => {}), intarziere);
  };
  await ctx.route(/\/api\/cont\/profil/, (r) => raspunde(r, cuSesiune ? PROFIL : { error: 'Neautentificat' }));
  await ctx.route(/\/api\/investitori\/kyc(\?|$)/, (r) => raspunde(r, KYC));
  return ctx;
}

async function depaseste(p) {
  return p.evaluate(() => {
    const W = innerWidth;
    let max = document.documentElement.scrollWidth;
    document.querySelectorAll('nav.inv-nav *, #mi-fond *, #runda *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > max && getComputedStyle(el).visibility !== 'hidden') max = r.right;
    });
    return max > W + 1 ? Math.round(max) : 0;
  });
}

// Timpul de la clic până la apariția ferestrei (#mi-fer vizibil).
async function timpDeschidere(p, sel) {
  await p.waitForFunction(() => !!window.MYD_INVESTITOR, null, { timeout: 8000 });
  await p.waitForTimeout(200);
  return p.evaluate((s) => new Promise((ok) => {
    const b = document.querySelector(s);
    const t0 = performance.now();
    b.scrollIntoView({ block: 'center' });
    b.click();
    (function v() {
      const f = document.getElementById('mi-fer');
      if (f && f.offsetParent !== null) return ok(Math.round(performance.now() - t0));
      if (performance.now() - t0 > 6000) return ok(99999);
      requestAnimationFrame(v);
    })();
  }), sel);
}

const masurari = [];

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const lang of ['ro', 'en']) {
      for (const latime of [390, 1366]) {
        const et = `${lang} ${latime}px`;

        // ── Logat, API-uri întârziate 3 s ────────────────────────────────
        {
          const ctx = await context(browser, { lang, latime, cuSesiune: true, intarziere: INTARZIERE });
          const p = await ctx.newPage();
          const erori = []; p.on('pageerror', (e) => erori.push(e.message));
          await p.goto(baza + '/mydarrin-investitori', { waitUntil: 'domcontentloaded' });
          await p.waitForLoadState('networkidle').catch(() => {});

          // A. selectorul de limbă
          const sel = await p.$('#lang-switcher');
          verifica(!!sel && await sel.isVisible(), `${et} A: selectorul de limbă e vizibil`);
          verifica(await p.inputValue('#lang-switcher') === lang, `${et} A: selectorul arată limba activă`);
          await p.focus('#lang-switcher');
          verifica(await p.evaluate(() => document.activeElement && document.activeElement.id === 'lang-switcher'), `${et} A: selectorul primește focus de la tastatură`);
          verifica(!!(await p.$('label[for="lang-switcher"]')), `${et} A: selectorul are etichetă`);

          // B. contul (logat): inițialele și meniul
          await p.waitForSelector('#header-account-btn[data-myd-cont="1"]', { timeout: 8000 }).catch(() => {});
          verifica(await p.getAttribute('#header-account-btn', 'data-myd-cont') === '1', `${et} B: butonul de cont arată contul logat`);
          verifica(/AT/.test(await p.innerText('#header-account-btn')), `${et} B: inițialele contului`);
          if (await p.isVisible('#myd-cont-sageata')) {
            await p.click('#myd-cont-sageata');
            const meniu = await p.innerText('#myd-cont-meniu').catch(() => '');
            verifica(/Rolurile mele|My roles/.test(meniu) && /dashboard/i.test(meniu), `${et} B: meniul contului are „Rolurile mele” și „Dashboard-ul meu”`);
            await p.keyboard.press('Escape');
          }

          // C. hero: fereastra în < 500 ms, cu starea de încărcare
          const tHero = await timpDeschidere(p, '#hero-intra-runda');
          masurari.push({ et, buton: 'hero', ms: tHero });
          verifica(tHero < 500, `${et} C: hero → fereastra în ${tHero} ms (< 500)`);
          const incarcare = await p.innerText('#mi-corp');
          verifica(lang === 'ro' ? /Se încarcă/.test(incarcare) : /Loading/.test(incarcare), `${et} C: starea de încărcare tradusă („${incarcare.trim()}”)`);
          verifica(await p.isEnabled('#mi-x'), `${et} C: X e activ în timpul încărcării`);
          verifica(await p.isDisabled('#hero-intra-runda'), `${et} D: butonul apăsat e blocat cât se deschide`);
          // D. dublu-clic: a doua apăsare nu deschide altă fereastră
          await p.evaluate(() => { window.pornesteInvestitor(document.querySelector('#runda button')); window.pornesteInvestitor(document.querySelector('#runda button')); });
          verifica(await p.$$eval('#mi-fond', (x) => x.length) === 1, `${et} D: dublu-clic → o singură fereastră`);
          // datele sosesc → pasul 1
          await p.waitForSelector('#mi-prenume', { timeout: 6000 }).catch(() => {});
          verifica(await p.isVisible('#mi-prenume'), `${et} C: datele se completează (pasul 1)`);
          const textFer = await p.innerText('#mi-fer');
          verifica(lang === 'ro' ? /Pasul 1 din 5/.test(textFer) : /Step 1 of 5/.test(textFer), `${et} A: fereastra rutei e în limba aleasă`);
          verifica(await depaseste(p) === 0, `${et} H: fereastra nu iese din ecran`);
          await p.click('#mi-x');
          verifica(await p.isEnabled('#hero-intra-runda'), `${et} D: după închidere, butonul hero se deblochează`);

          // C. butonul din Seed
          const tSeed = await timpDeschidere(p, '#runda button');
          masurari.push({ et, buton: 'seed', ms: tSeed });
          verifica(tSeed < 500, `${et} C: Seed → fereastra în ${tSeed} ms (< 500)`);
          await p.click('#mi-x');

          // G. secțiunea Seed
          const runda = await p.innerText('#runda');
          verifica(await p.$$eval('#runda ol li', (x) => x.length) === 4, `${et} G: Seed arată cei 4 pași`);
          verifica(await p.$eval('[data-runda]', (x) => x.hidden), `${et} G: containerul [data-runda] e ascuns (fără date)`);
          verifica(!/\d[\d.,]*\s?(EUR|€|%)/.test(runda), `${et} G: fără cifre în secțiunea Seed`);
          verifica(await depaseste(p) === 0, `${et} H: antetul și pagina nu ies din ecran`);

          // A. schimbarea limbii: pagina și fereastra în cealaltă limbă
          const alta = lang === 'ro' ? 'en' : 'ro';
          await Promise.all([p.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), p.selectOption('#lang-switcher', alta)]);
          await p.waitForLoadState('networkidle').catch(() => {});
          const titlu = await p.innerText('#runda h2');
          verifica(alta === 'en' ? /Seed round/.test(titlu) : /Runda Seed/.test(titlu), `${et} A: după schimbarea limbii, pagina e în ${alta} („${titlu}”)`);
          await timpDeschidere(p, '#runda button');
          const inc2 = await p.innerText('#mi-corp');
          verifica(alta === 'en' ? /Loading/.test(inc2) : /Se încarcă/.test(inc2), `${et} A: după schimbarea limbii, fereastra e în ${alta}`);

          verifica(!erori.length, `${et} H: 0 erori JS (${erori.join(' | ')})`);
          verifica(!erori.some((e) => /regular expression/i.test(e)), `${et} H: nicio eroare de regex`);
          await ctx.close();
        }

        // ── Nelogat: butonul de cont și trimiterea imediată la autentificare ──
        {
          const ctx = await context(browser, { lang, latime, cuSesiune: false });
          const p = await ctx.newPage();
          const erori = []; p.on('pageerror', (e) => erori.push(e.message));
          await p.goto(baza + '/mydarrin-investitori', { waitUntil: 'domcontentloaded' });
          await p.waitForLoadState('networkidle').catch(() => {});
          const cont = await p.innerText('#header-account-btn');
          verifica(latime < 640 || (lang === 'ro' ? /Intră în cont/.test(cont) : /Sign in/.test(cont)), `${et} B: nelogat → „Intră în cont” („${cont.trim()}”)`);
          verifica(await p.getAttribute('#header-account-btn', 'data-myd-cont') !== '1', `${et} B: nelogat → fără identitate în antet`);
          await p.waitForFunction(() => !!window.MYD_INVESTITOR, null, { timeout: 8000 });
          const t0 = Date.now();
          await Promise.all([p.waitForURL(/reason=cont/, { timeout: 4000 }).catch(() => {}), p.click('#hero-intra-runda')]);
          const tRed = Date.now() - t0;
          masurari.push({ et, buton: 'nelogat → login', ms: tRed });
          verifica(/reason=cont/.test(p.url()) && tRed < 1500, `${et} E: nelogat → autentificare în ${tRed} ms, fără așteptare`);
          verifica(await p.evaluate(() => sessionStorage.getItem('myd_revenire_dupa_login')) === '/mydarrin-investitori.html?ruta=investitor', `${et} E: revenirea la rută e reținută`);
          verifica(!erori.length, `${et} H: nelogat, 0 erori JS (${erori.join(' | ')})`);
          await ctx.close();
        }
      }
    }

    // ── F. serverul nu răspunde → după 10 s, mesaj și „Reîncearcă” ──────
    {
      const ctx = await context(browser, { lang: 'en', latime: 1366, cuSesiune: true, faraRaspuns: true });
      const p = await ctx.newPage();
      const erori = []; p.on('pageerror', (e) => erori.push(e.message));
      await p.goto(baza + '/mydarrin-investitori', { waitUntil: 'domcontentloaded' });
      await timpDeschidere(p, '#runda button');
      await p.waitForSelector('#mi-reincearca', { timeout: 13000 }).catch(() => {});
      const t = await p.innerText('#mi-corp').catch(() => '');
      verifica(/not responding/.test(t) && await p.isVisible('#mi-reincearca'), `F: fără răspuns în 10 s → mesaj și „Retry” („${t.trim().replace(/\s+/g, ' ')}”)`);
      verifica(!erori.length, `F: 0 erori JS (${erori.join(' | ')})`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('\nTimpii măsurați (clic → fereastră / redirect):');
  masurari.forEach((m) => console.log(`  ${m.et} · ${m.buton}: ${m.ms} ms`));
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
