// scripts/test-ruta-investitor-cont.js
// Pasul 11-I1 (14 nov. 2026): crearea contului de investitor și panoul propriu.
//
// Fără rețea externă: serverul local (scripts/server-test.js) și Playwright.
// Clientul Supabase e simulat (nimic nu ajunge la Supabase): signUp, verifyOtp
// și signInWithPassword doar se înregistrează; account-system.js și
// cont-fereastra.js sunt cele reale.
//
// Verifică:
//   A. vizitator nou, RO și EN, telefon (390) și desktop (1280): „Devino investitor”
//      → fereastra pe „Creare cont”, cu un singur card, Investitor, ales (fără
//      Client / Partener) și mesajul persistent; „Alege alt tip de cont” arată din
//      nou Client / Partener; din nou „Devino investitor” → Investitor;
//      datele + GDPR → performRegister primește rolSolicitat 'investor'
//      (signUp interceptat), account_created are role 'investor', fără partner_*;
//      codul de 6 cifre → revenirea la ?ruta=investitor → ruta pornește singură;
//   B. browserul a avut o sesiune: fereastra pe „Intră în cont” (tot cu Investitor
//      la „Creare cont”); login → revenirea la rută; fără schimbarea rolurilor;
//   C. destinația: alegeDestinatie([], { rolSolicitat: 'investor' }) → ruta;
//      ['investor'] → panoul; ['client','investor'] (fără comenzi) → panoul;
//      emailul de bun venit pentru investitor, în RO și EN;
//   D. panoul: cont cu rolul investor → se afișează; fără rol → #cum-functioneaza;
//      „Rolurile mele” arată Investitor cu linkul spre panou;
//   E. fereastra deschisă din index / catalog / pagina partenerului și, pe pagina
//      Investitori, din antet: Client / Partener, fără Investitor;
//   0 erori JS; laLogin din investitori-ruta.js nu mai pleacă la /index.html?reason=cont.
//
// Rulare: node scripts/test-ruta-investitor-cont.js

const path = require('path');
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const R = path.join(__dirname, '..');
let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

const USER = { id: '20000000-0000-4000-8000-0000000000d1', email: 'investitor.test@example.com', email_confirmed_at: '2026-11-14T08:00:00Z', user_metadata: { prenume: 'Ana', rol_solicitat: 'investor' } };

// În pagină, înaintea scripturilor: clientul Supabase simulat. Sesiunea există
// după verifyOtp / signInWithPassword (sessionStorage, rămâne după navigare).
function supabaseSimulat(user) {
  const areSesiune = () => { try { return sessionStorage.getItem('sim_sesiune') === '1'; } catch (e) { return false; } };
  const sesiune = () => (areSesiune() ? { access_token: 'token-simulat', user } : null);
  const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
  window.__auth = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: areSesiune() ? user : null }, error: null }),
      getSession: async () => ({ data: { session: sesiune() }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      signUp: async (o) => { window.__auth.push({ tip: 'signUp', o }); return { data: { user: { id: user.id, identities: [{}] } }, error: null }; },
      verifyOtp: async (o) => { window.__auth.push({ tip: 'verifyOtp', o }); sessionStorage.setItem('sim_sesiune', '1'); return { data: { user, session: sesiune() }, error: null }; },
      signInWithPassword: async (o) => { window.__auth.push({ tip: 'login', email: o.email }); sessionStorage.setItem('sim_sesiune', '1'); return { data: { user, session: sesiune() }, error: null }; },
      resend: async () => ({ error: null }),
    },
    from: () => lant({ data: null, error: null }),
    rpc: () => lant({ data: null, error: null }),
    channel: () => lant({}),
    removeChannel: () => {},
  };
  Object.defineProperty(window, 'supabaseClient', { configurable: true, get: () => client, set: () => {} });
}

async function context(br, B, { lang, latime, roles, aAvutCont, cuSesiune, rolSolicitat }) {
  const ctx = await br.newContext({ viewport: { width: latime || 1280, height: 860 } });
  const stare = { roles: (roles || ['client']).slice(), cereri: [] };
  await ctx.addInitScript(([l, avut, ses]) => {
    try {
      localStorage.setItem('myd_lang_v1', l);
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: true, marketing: false, data: new Date().toISOString(), versiune: 2 }));
      if (avut) localStorage.setItem('myd_a_avut_cont_v1', '1');
      if (ses && !sessionStorage.getItem('sim_pornit')) { sessionStorage.setItem('sim_sesiune', '1'); sessionStorage.setItem('sim_pornit', '1'); }
    } catch (e) {}
  }, [lang || 'ro', !!aAvutCont, !!cuSesiune]);
  await ctx.addInitScript(supabaseSimulat, USER);
  await ctx.route(/esm\.sh/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function createClient() { return window.supabaseClient; }' }));
  await ctx.route(/\.supabase\.co\/|googletagmanager|google-analytics|_vercel\/insights/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const json = (r, corp, cod) => r.fulfill({ status: cod || 200, contentType: 'application/json', body: JSON.stringify(corp) });
  await ctx.route(/\/api\//, (r) => {
    const u = r.request().url();
    stare.cereri.push(r.request().method() + ' ' + u.replace(/^https?:\/\/[^/]+/, ''));
    if (/\/api\/cont\/profil/.test(u)) {
      const inv = stare.roles.includes('investor');
      return json(r, {
        ok: true, email: USER.email, nume: 'Ana Test', prenume: 'Ana', nume_familie: 'Test', telefon: '+40700000009', tara: 'RO',
        roles: stare.roles.slice(), roluri_dashboard: inv ? ['investor'] : [], are_comenzi: false,
        destinatie: inv ? '/mydarrin-panou-investitor.html' : '/mydarrin-investitori.html?ruta=investitor',
        tip_destinatie: inv ? 'rol' : 'ruta_investitor', rol_solicitat: rolSolicitat || 'investor', partener: null, investitor: null, activare: null,
      });
    }
    if (/\/api\/investitori\/kyc(\?|$)/.test(u)) return json(r, { ok: true, kyc: null, lipsa: ['date_personale'], cont: { prenume: 'Ana', nume: 'Test', email: USER.email, telefon: '+40700000009', tara: 'RO' } });
    if (/\/api\/investitori\/portofoliu/.test(u)) return json(r, { ok: true, kyc_status: 'in_verificare', actiuni: 0, valoare_investita: 0, in_asteptare: 0, pct_companie: 0, subscrieri: [], runda: null, exit: { buyback_disponibil: false } });
    if (/\/api\/investitori\//.test(u)) return json(r, { ok: true });
    if (/\/api\/public\/runda-curenta/.test(u)) return json(r, { ok: true, runda: null });
    if (/\/api\/public\/destinatie-post-login/.test(u)) return json(r, { ok: true, tip: 'ruta_investitor', destinatie: '/mydarrin-investitori.html?ruta=investitor' });
    if (/\/api\/cont\/bun-venit/.test(u)) return json(r, { ok: true, trimis: false });
    if (/\/api\/public\/(reguli-platforma|tari-active)/.test(u)) return r.continue();
    return json(r, { ok: false }, 503);
  });
  const page = await ctx.newPage();
  const erori = [];
  page.on('pageerror', (e) => erori.push(e.message));
  return { ctx, page, stare, erori };
}

const fereastraDeschisa = (p) => p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 10000 }).then(() => true, () => false);
const cardurile = (p) => p.evaluate(() => {
  const vizibil = (e) => !!e && !e.hidden && e.getClientRects().length > 0;
  const carduri = [...document.querySelectorAll('#mdc-categorii .mdc-card')].filter(vizibil);
  return {
    tab: document.querySelector('#tab-register-btn').getAttribute('aria-selected') === 'true' ? 'register' : 'login',
    vizibile: carduri.map((c) => c.getAttribute('data-mdc-cat')),
    ales: (document.querySelector('#mdc-categorii input:checked') || {}).value || null,
    texte: carduri.map((c) => c.querySelector('.mdc-card-txt').innerText.replace(/\s+/g, ' ').trim()),
    link: vizibil(document.getElementById('mdc-alt-tip')) ? document.getElementById('mdc-alt-tip').textContent.trim() : null,
    mesaj: (() => { const m = document.getElementById('auth-modal-persistent-msg'); return m && m.style.display !== 'none' ? m.textContent.trim() : null; })(),
  };
});
async function apasaCta(p) {
  await p.waitForSelector('#hero-intra-runda[data-cta-stare]:not([data-cta-stare="incarca"])', { timeout: 15000 }).catch(() => {});
  await p.focus('#hero-intra-runda');
  await p.keyboard.press('Enter');
  return fereastraDeschisa(p);
}

const T = {
  ro: { card: 'Investitor Investesc în My Darrin', link: 'Nu ești investitor? Alege alt tip de cont', mesaj: 'Intră în cont sau creează-ți unul; după aceea continui dosarul de investitor.', rolAles: 'Cont de Investitor', client: 'Client Comand servicii' },
  en: { card: 'Investor I invest in My Darrin', link: 'Not an investor? Choose another account type', mesaj: 'Sign in or create an account; then you continue your investor application.', rolAles: 'Investor account', client: 'Client I order services' },
};

async function testeBrowser() {
  const srv = await porneste(0);
  const B = 'http://localhost:' + srv.address().port;
  const br = await chromium.launch();

  // ── A. vizitator nou ────────────────────────────────────────────────
  for (const lang of ['ro', 'en']) {
    for (const latime of [390, 1280]) {
      const et = `A ${lang} ${latime}`;
      const t = T[lang];
      const { ctx, page, stare, erori } = await context(br, B, { lang, latime });
      await page.goto(B + '/mydarrin-investitori.html', { waitUntil: 'load' });
      verifica(await apasaCta(page), `${et}: „Devino investitor” nu deschide fereastra`);
      let c = await cardurile(page);
      verifica(c.tab === 'register', `${et}: fereastra nu e pe „Creare cont”: ${c.tab}`);
      verifica(JSON.stringify(c.vizibile) === '["investitor"]' && c.ales === 'investitor', `${et}: cardurile: ${JSON.stringify(c)}`);
      verifica(c.texte[0] === t.card, `${et}: textul cardului: „${c.texte[0]}”`);
      verifica(c.link === t.link, `${et}: linkul „alt tip”: „${c.link}”`);
      verifica(c.mesaj === t.mesaj, `${et}: mesajul persistent: „${c.mesaj}”`);
      verifica(await page.evaluate(() => sessionStorage.getItem('myd_revenire_dupa_login')) === '/mydarrin-investitori.html?ruta=investitor', `${et}: revenirea nu e reținută`);

      // „Alege alt tip de cont” → Client / Partener.
      await page.click('#mdc-alt-tip');
      c = await cardurile(page);
      verifica(JSON.stringify(c.vizibile) === '["client","partener"]' && !c.ales && c.link === null, `${et}: după „alt tip”: ${JSON.stringify(c)}`);
      verifica(c.texte[0] === t.client, `${et}: cardul Client: „${c.texte[0]}”`);
      // Închis și deschis din nou din „Devino investitor”: tot Investitor.
      await page.keyboard.press('Escape');
      verifica(await apasaCta(page), `${et}: a doua deschidere`);
      c = await cardurile(page);
      verifica(JSON.stringify(c.vizibile) === '["investitor"]' && c.ales === 'investitor', `${et}: a doua deschidere, cardurile: ${JSON.stringify(c)}`);

      // Datele, GDPR, crearea contului.
      await page.click('#mdc-rol-continua');
      const rolAles = await page.evaluate(() => document.getElementById('mdc-rol-ales-text').textContent.trim());
      verifica(rolAles === t.rolAles, `${et}: rolul ales: „${rolAles}”`);
      await page.fill('#reg-prenume', 'Ana');
      await page.fill('#reg-nume', 'Test');
      await page.fill('#reg-email', USER.email);
      await page.fill('#reg-tel', '+40 700 000 009');
      await page.fill('#reg-pass', 'Parola-Test-1');
      await page.check('#reg-gdpr');
      await page.click('#mdc-register-btn');
      await page.waitForFunction(() => !document.getElementById('auth-verify-cod').hidden, null, { timeout: 10000 }).catch(() => {});
      const auth = await page.evaluate(() => window.__auth);
      const su = auth.find((a) => a.tip === 'signUp');
      verifica(su && su.o.options.data.rol_solicitat === 'investor', `${et}: signUp fără rol_solicitat investor: ${JSON.stringify(su && su.o.options.data)}`);
      const jurnal = await page.evaluate(() => (window.MYD_MASURARE ? window.MYD_MASURARE.jurnal.slice() : []));
      const ac = jurnal.find((e) => e.nume === 'account_created');
      verifica(ac && ac.parametri.role === 'investor', `${et}: account_created: ${JSON.stringify(ac)}`);
      verifica(!jurnal.some((e) => /^partner_/.test(e.nume)), `${et}: evenimente partner_* pentru investitor: ${jurnal.map((e) => e.nume)}`);

      // Codul → revenirea la rută → ruta pornește singură.
      await page.fill('#verify-cod-input', '123456');
      await page.click('#mdc-cod-btn');
      await page.waitForURL(/mydarrin-investitori/, { timeout: 10000 }).catch(() => {});
      const ruta = await page.waitForSelector('#mi-fer', { timeout: 15000 }).then(() => true, () => false);
      verifica(ruta, `${et}: după cod, ruta de investitor nu pornește (${page.url()})`);
      verifica(!/reason=cont|index\.html/.test(page.url()), `${et}: a plecat de pe pagină: ${page.url()}`);
      verifica(!stare.cereri.some((x) => /rol-solicitat/.test(x)), `${et}: s-a schimbat rolul solicitat prin API`);
      verifica(!erori.length, `${et}: erori JS: ${erori.slice(0, 2)}`);
      await ctx.close();
    }
  }

  // ── B. cont existent (browserul a avut o sesiune) ───────────────────
  {
    const { ctx, page, stare, erori } = await context(br, B, { lang: 'ro', aAvutCont: true, roles: ['client', 'partener_servicii'], rolSolicitat: 'partener_servicii' });
    await page.goto(B + '/mydarrin-investitori.html', { waitUntil: 'load' });
    verifica(await apasaCta(page), 'B: fereastra nu se deschide');
    let c = await cardurile(page);
    verifica(c.tab === 'login', `B: cu o sesiune anterioară, fereastra nu e pe „Intră în cont”: ${c.tab}`);
    await page.click('#tab-register-btn');
    c = await cardurile(page);
    verifica(JSON.stringify(c.vizibile) === '["investitor"]', `B: „Creare cont” fără cardul Investitor: ${JSON.stringify(c)}`);
    await page.click('#tab-login-btn');
    await page.fill('#login-email', USER.email);
    await page.fill('#login-pass', 'Parola-Test-1');
    await page.click('#mdc-login-btn');
    await page.waitForURL(/ruta=investitor|mydarrin-investitori/, { timeout: 10000 }).catch(() => {});
    verifica(await page.waitForSelector('#mi-fer', { timeout: 15000 }).then(() => true, () => false), 'B: după login, ruta nu pornește');
    verifica(!stare.cereri.some((x) => /^POST .*\/api\/cont\//.test(x)) && JSON.stringify(stare.roles) === '["client","partener_servicii"]', `B: rolurile s-au schimbat: ${stare.cereri.filter((x) => /^POST/.test(x))}`);
    verifica(!erori.length, `B: erori JS: ${erori.slice(0, 2)}`);
    await ctx.close();
  }

  // ── laLogin din investitori-ruta.js: fereastra pe pagină, nu index.html ──
  {
    const { ctx, page } = await context(br, B, { lang: 'en' });
    await page.goto(B + '/mydarrin-investitori.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MYD_INVESTITOR, null, { timeout: 10000 });
    // O sesiune expirată: token rămas în browser, fără sesiune reală.
    await page.evaluate(() => { localStorage.setItem('sb-test-auth-token', '{}'); window.MYD_INVESTITOR.deschideRuta(null); });
    const deschisa = await fereastraDeschisa(page);
    const c = deschisa ? await cardurile(page) : {};
    verifica(deschisa && /mydarrin-investitori/.test(page.url()), `laLogin: nu deschide fereastra pe pagină (${page.url()})`);
    verifica(c.tab === 'login' && c.mesaj === T.en.mesaj, `laLogin: tab / mesaj: ${JSON.stringify(c)}`);
    await page.click('#tab-register-btn');
    verifica(JSON.stringify((await cardurile(page)).vizibile) === '["investitor"]', 'laLogin: „Creare cont” fără Investitor');
    await ctx.close();
  }

  // ── E. fereastra din alte pagini: neschimbată ───────────────────────
  for (const cale of ['/index.html', '/mydarrin-catalog.html', '/cum-devii-partenerul-nostru.html', '/mydarrin-investitori.html']) {
    const { ctx, page, erori } = await context(br, B, { lang: 'ro' });
    await page.goto(B + cale, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MDCont, null, { timeout: 15000 }).catch(() => {});
    if (cale === '/mydarrin-investitori.html') {
      // întâi contextul de investitor, apoi antetul („Cont”): fereastra obișnuită
      await page.evaluate(() => window.MDCont.deschide({ tab: 'register', rol: 'investor' }));
      await page.evaluate(() => window.MDCont.inchide());
    }
    await page.evaluate(() => window.MDCont.deschide({ tab: 'register' }));
    const c = await cardurile(page);
    verifica(JSON.stringify(c.vizibile) === '["client","partener"]' && c.link === null, `E ${cale}: ${JSON.stringify(c)}`);
    const valid = await page.evaluate(() => { window.MDCont.deschide({ tab: 'register', rol: 'client' }); return window.MDCont.rolAles(); });
    verifica(valid === 'client', `E ${cale}: rolul client: ${valid}`);
    verifica(!erori.length, `E ${cale}: erori JS: ${erori.slice(0, 2)}`);
    await ctx.close();
  }

  // ── D. panoul investitorului și „Rolurile mele” ─────────────────────
  for (const lang of ['ro', 'en']) {
    {
      const { ctx, page, erori } = await context(br, B, { lang, cuSesiune: true, roles: ['client', 'investor'] });
      await page.goto(B + '/mydarrin-panou-investitor.html', { waitUntil: 'load' });
      const vizibil = await page.waitForSelector('#pi-app:not([hidden])', { timeout: 15000 }).then(() => true, () => false);
      verifica(vizibil && /panou-investitor/.test(page.url()), `D ${lang}: panoul nu se afișează pentru rolul investor (${page.url()})`);
      verifica(!erori.length, `D ${lang}: erori JS: ${erori.slice(0, 2)}`);
      await page.goto(B + '/mydarrin-rolurile-mele.html', { waitUntil: 'load' });
      const card = await page.waitForSelector('article[data-rol="investor"] a.rm-deschide', { timeout: 15000 }).then(() => true, () => false);
      const href = card ? await page.getAttribute('article[data-rol="investor"] a.rm-deschide', 'href') : null;
      verifica(href === '/mydarrin-panou-investitor.html', `D ${lang}: „Rolurile mele” fără linkul spre panou: ${href}`);
      await ctx.close();
    }
    {
      const { ctx, page } = await context(br, B, { lang, cuSesiune: true, roles: ['client'] });
      await page.goto(B + '/mydarrin-panou-investitor.html', { waitUntil: 'load' });
      await page.waitForURL(/mydarrin-investitori\.html#cum-functioneaza/, { timeout: 15000 }).catch(() => {});
      verifica(/mydarrin-investitori\.html#cum-functioneaza$/.test(page.url()), `D ${lang}: fără rol, panoul nu trimite la #cum-functioneaza (${page.url()})`);
      await ctx.close();
    }
  }

  await br.close();
  srv.close();
}

// ── C. destinația și emailul (fără browser) ────────────────────────────
function testeServer() {
  const DR = require(path.join(R, 'lib', 'destinatie-rol'));
  const d1 = DR.alegeDestinatie([], { rolSolicitat: 'investor' });
  verifica(d1 && d1.tip === 'ruta_investitor' && d1.destinatie === '/mydarrin-investitori.html?ruta=investitor', `alegeDestinatie([], investor): ${JSON.stringify(d1)}`);
  const d1b = DR.alegeDestinatie(['client'], { rolSolicitat: 'investor', areComenzi: false });
  verifica(d1b && d1b.tip === 'ruta_investitor', `alegeDestinatie(['client'], investor): ${JSON.stringify(d1b)}`);
  const d2 = DR.alegeDestinatie(['investor']);
  verifica(d2 && d2.destinatie === '/mydarrin-panou-investitor.html', `alegeDestinatie(['investor']): ${JSON.stringify(d2)}`);
  const d3 = DR.alegeDestinatie(['client', 'investor'], { areComenzi: false });
  verifica(d3 && d3.destinatie === '/mydarrin-panou-investitor.html', `alegeDestinatie(['client','investor']): ${JSON.stringify(d3)}`);
  const d4 = DR.alegeDestinatie(['client', 'investor'], { rolSolicitat: 'investor' });
  verifica(d4 && d4.destinatie === '/mydarrin-panou-investitor.html', `investitor cu dosarul trimis, rol_solicitat investor: ${JSON.stringify(d4)}`);
  const d5 = DR.alegeDestinatie(['client'], { rolSolicitat: 'partener_servicii' });
  verifica(d5 && d5.tip === 'activare_partener', `partenerul, neschimbat: ${JSON.stringify(d5)}`);
  const d6 = DR.alegeDestinatie(['client'], { areComenzi: false });
  verifica(d6 && d6.tip === 'client_fara_comenzi', `clientul, neschimbat: ${JSON.stringify(d6)}`);
  // Copia din ui-comun.js e identică (scripts/test-destinatie-rol.js verifică textul).
  const ui = require('fs').readFileSync(path.join(R, 'ui-comun.js'), 'utf8');
  verifica(/rolSolicitat === 'investor'/.test(ui) && /PAGINA_RUTA_INVESTITOR/.test(ui), 'ui-comun.js nu are regula de investitor');

  const { renderEmailContConfirmat } = require(path.join(R, 'lib', 'i18n'));
  const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const ro = renderEmailContConfirmat('ro', { nume: 'Ana', partener: false, investitor: true, link: 'https://x/ruta' });
  const en = renderEmailContConfirmat('en', { nume: 'Ana', partener: false, investitor: true, link: 'https://x/ruta' });
  verifica(/dosarul de investitor/.test(text(ro.html)) && !/comanda|activarea/i.test(text(ro.html)), `emailul RO de investitor: ${text(ro.html).slice(0, 160)}`);
  verifica(/investor application/.test(text(en.html)) && !/[ăâîșț]/i.test(text(en.html)), `emailul EN de investitor: ${text(en.html).slice(0, 160)}`);
  verifica(!/\d+\s?(%|EUR|RON|lei)/.test(text(ro.html) + text(en.html)), 'emailul de investitor conține cifre (sume, procente)');
  const p = renderEmailContConfirmat('ro', { partener: true, investitor: true, link: null });
  verifica(/activarea/.test(text(p.html)), 'cu rol de partener, emailul rămâne de partener');

  // Fără secretul KYC în fișierele pasului.
  const fs = require('fs');
  for (const f of ['cont-fereastra.js', 'cta-investitor.js', 'investitori-ruta.js', 'lib/destinatie-rol.js', 'api/cont/bun-venit.js', 'docs/migrations-propuse/2026-11-14_rol_solicitat_investitor.sql', 'scripts/test-ruta-investitor-cont.js']) {
    verifica(!fs.readFileSync(path.join(R, f), 'utf8').includes('KYC_HMAC' + '_SECRET'), `${f} conține numele secretului KYC`);
  }
}

(async () => {
  testeServer();
  await testeBrowser();
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
