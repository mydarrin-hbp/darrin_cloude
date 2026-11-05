// scripts/test-emailuri-cod.js
// Pasul 11-R3c (3 nov. 2026): emailul de bun venit după cod, contul
// neconfirmat la login, fila goală din „Devino partener”.
//
// Server (Supabase simulat, scripts/supabase-simulat.js; Resend simulat):
//   - api/cont/bun-venit.js: fără sesiune → 401; email neconfirmat → nu trimite;
//     confirmat → un singur email („Contul tău e confirmat”), al doilea apel nu
//     mai trimite; partenerul primește linkul spre dashboard-ul lui; cine a primit
//     vechiul email de bun venit nu-l mai primește; emailul vine din sesiune;
//   - api/public/trimite-bun-venit-client.js → 410, fără email;
//   - cron-urile email-cont-abandonat și reminder-profil-partener nu scriu
//     conturilor neconfirmate.
// Browser (Chromium, Supabase simulat în pagină):
//   - înscriere → niciun email de bun venit înainte de cod → cod → un singur apel;
//   - login cu cont neconfirmat → ecranul de cod, cod nou trimis, mesaj albastru,
//     fără roșu → cod → destinația (clientul în catalog, partenerul în dashboard);
//     limita de coduri → mesajul spune să aștepte un minut; în engleză;
//   - „Creare cont” cu un email neconfirmat → ecranul de cod;
//   - indiciul „Spam sau Promoții” sub câmpul codului;
//   - „Devino partener” (11-R3g: hub-ul) se deschide cu hero, tipuri și pași, fără file goale;
//   - 390, 768, 1024, 1366 px: fără derulare orizontală, fără erori JS.
// Rulare: node scripts/test-emailuri-cod.js

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns } = sim;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));

// Resend simulat: fiecare email trimis ajunge în `emailuri`.
const emailuri = [];
const fetchReal = global.fetch;
global.fetch = async (url, opt) => {
  if (String(url).includes('api.resend.com')) {
    emailuri.push(JSON.parse(opt.body));
    return { ok: true, status: 200, json: async () => ({ id: 'e' + emailuri.length }) };
  }
  return fetchReal(url, opt);
};

function bazaDate() {
  emailuri.length = 0;
  DB.utilizatori = {
    'tok-confirmat': { id: 'u1', email: 'ana@example.com', email_confirmed_at: '2026-11-03T10:00:00Z', user_metadata: { prenume: 'Ana' } },
    'tok-neconfirmat': { id: 'u2', email: 'ion@example.com', email_confirmed_at: null, user_metadata: {} },
    'tok-partener': { id: 'u3', email: 'firma@example.com', email_confirmed_at: '2026-11-03T10:00:00Z', user_metadata: { prenume: 'Dan' } },
    'tok-vechi': { id: 'u4', email: 'vechi@example.com', email_confirmed_at: '2026-10-01T10:00:00Z', user_metadata: {} },
  };
  const vechi = new Date(Date.now() - 10 * 86400000).toISOString();
  DB.tabele = {
    profiles: [
      { id: 'u1', email: 'ana@example.com', role: 'client', roles: ['client'], rol_solicitat: 'client', limba: 'ro', created_at: vechi },
      { id: 'u2', email: 'ion@example.com', role: 'client', roles: ['client'], rol_solicitat: 'client', limba: 'en', created_at: vechi },
      { id: 'u3', email: 'firma@example.com', role: 'client', roles: ['client'], rol_solicitat: 'partener_servicii', limba: 'en', created_at: vechi, nume: 'Dan' },
      { id: 'u4', email: 'vechi@example.com', role: 'client', roles: ['client'], rol_solicitat: null, limba: 'ro', created_at: vechi },
      { id: 'u5', email: 'nec-partener@example.com', role: 'client', roles: ['client'], rol_solicitat: 'partener_materiale', limba: 'ro', created_at: vechi },
    ],
    email_comportamental_log: [{ id: 'l0', user_id: 'u4', tip: 'bun_venit_client', trimis_la: vechi }],
    comenzi: [], comanda_subcontractori: [], partners: [], partner_conturi_bancare: [], documente_partener: [], partner_activare_ciorna: [], backoffice_config: [], email_suppression_list: [],
  };
  // Al cincilea cont: partener ales, neconfirmat (doar pentru cron-uri).
  DB.utilizatori['tok-nec-partener'] = { id: 'u5', email: 'nec-partener@example.com', email_confirmed_at: null };
}

async function apel(handler, token, metoda = 'POST', body = {}) {
  const res = raspuns();
  await handler(cerere({ metoda, token, body }), res);
  return res;
}

async function testeServer() {
  process.env.RESEND_API_KEY = 'test';
  process.env.CRON_SECRET = 'cron';
  const bunVenit = require(path.join(sim.RADACINA, 'api/cont/bun-venit.js'));
  const vechi = require(path.join(sim.RADACINA, 'api/public/trimite-bun-venit-client.js'));

  // Logul are unique(user_id, tip), ca în baza reală: duplicatul dă 23505.
  const insertReal = sim.supabaseAdmin.from;
  sim.supabaseAdmin.from = (tabel) => {
    const q = insertReal(tabel);
    if (tabel !== 'email_comportamental_log') return q;
    const ins = q.insert;
    q.insert = (d) => {
      const r = Array.isArray(d) ? d[0] : d;
      if (DB.tabele.email_comportamental_log.some((x) => x.user_id === r.user_id && x.tip === r.tip)) {
        return { then: (ok) => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }).then(ok) };
      }
      return ins(d);
    };
    return q;
  };

  bazaDate();
  let r = await apel(bunVenit, null);
  verifica(r.statusCode === 401, `bun-venit fără sesiune: ${r.statusCode} (așteptat 401)`);
  verifica(emailuri.length === 0, 'bun-venit fără sesiune: a trimis un email');

  r = await apel(bunVenit, 'tok-neconfirmat');
  verifica(r.statusCode === 200 && r.corp.trimis === false, `bun-venit, email neconfirmat: ${JSON.stringify(r.corp)}`);
  verifica(emailuri.length === 0, 'bun-venit, email neconfirmat: a trimis un email');

  // Emailul vine din sesiune, nu din cerere.
  r = await apel(bunVenit, 'tok-confirmat', 'POST', { email: 'altcineva@example.com' });
  verifica(r.statusCode === 200 && r.corp.trimis === true, `bun-venit, confirmat: ${JSON.stringify(r.corp)}`);
  verifica(emailuri.length === 1 && emailuri[0].to === 'ana@example.com', `bun-venit: destinatar ${emailuri[0] && emailuri[0].to} (așteptat ana@example.com)`);
  verifica(emailuri[0] && /e confirmat/.test(emailuri[0].subject) && !/a fost creat/.test(emailuri[0].subject + emailuri[0].html), `bun-venit RO: subiect „${emailuri[0] && emailuri[0].subject}”`);
  verifica(emailuri[0] && /Contul tău e confirmat/.test(emailuri[0].html) && /mydarrin-dashboard-client/.test(emailuri[0].html), 'bun-venit RO: corpul nu spune „Contul tău e confirmat” sau nu are linkul contului');

  r = await apel(bunVenit, 'tok-confirmat');
  verifica(r.corp.trimis === false && r.corp.motiv === 'deja_trimis' && emailuri.length === 1, `bun-venit, al doilea apel: ${JSON.stringify(r.corp)}, ${emailuri.length} emailuri`);

  r = await apel(bunVenit, 'tok-partener');
  const ep = emailuri[1];
  verifica(r.corp.trimis === true && ep && ep.to === 'firma@example.com', `bun-venit partener: ${JSON.stringify(r.corp)}`);
  verifica(ep && /is confirmed/.test(ep.subject) && /Your account is confirmed/.test(ep.html) && !/has been created/.test(ep.html), `bun-venit partener EN: subiect „${ep && ep.subject}”`);
  verifica(ep && /mydarrin-dashboard-partener\.html\?type=servicii/.test(ep.html) && /Go to your dashboard/.test(ep.html), 'bun-venit partener: lipsește linkul spre dashboard-ul lui');

  r = await apel(bunVenit, 'tok-vechi');
  verifica(r.corp.trimis === false && emailuri.length === 2, `bun-venit, cont cu vechiul email de bun venit: ${JSON.stringify(r.corp)}`);

  r = await apel(bunVenit, 'tok-confirmat', 'GET');
  verifica(r.statusCode === 405, `bun-venit GET: ${r.statusCode}`);

  r = await apel(vechi, null, 'POST', { email: 'ana@example.com' });
  verifica(r.statusCode === 410 && r.corp.ok === false && r.corp.mesaj && r.corp.mesaj.ro && r.corp.mesaj.en, `endpoint-ul public vechi: ${r.statusCode} ${JSON.stringify(r.corp)}`);
  verifica(emailuri.length === 2, 'endpoint-ul public vechi a trimis un email');

  // Cron-urile: niciun email spre conturi neconfirmate.
  const cronAbandon = require(path.join(sim.RADACINA, 'api/cron/email-cont-abandonat.js'));
  const cronReminder = require(path.join(sim.RADACINA, 'api/cron/reminder-profil-partener.js'));
  bazaDate();
  const cronReq = () => ({ method: 'GET', headers: { authorization: 'Bearer cron' }, query: {} });
  r = raspuns(); await cronAbandon(cronReq(), r);
  const catre = emailuri.map((e) => e.to);
  verifica(r.statusCode === 200, `cron cont abandonat: ${r.statusCode} ${JSON.stringify(r.corp)}`);
  verifica(!catre.includes('ion@example.com'), 'cron cont abandonat: a scris contului neconfirmat');
  verifica(catre.includes('ana@example.com'), `cron cont abandonat: contul confirmat nu a primit emailul (${catre.join(', ')})`);

  bazaDate();
  r = raspuns(); await cronReminder(cronReq(), r);
  const catre2 = emailuri.map((e) => e.to);
  verifica(r.statusCode === 200, `cron reminder partener: ${r.statusCode} ${JSON.stringify(r.corp)}`);
  verifica(!catre2.includes('nec-partener@example.com'), 'cron reminder partener: a scris contului neconfirmat');
  verifica(catre2.includes('firma@example.com'), `cron reminder partener: contul confirmat nu a primit reminderul (${catre2.join(', ')}; ${JSON.stringify(r.corp)})`);
  console.log('server: gata');
}

// ── Browser ──
const ZGOMOT = /Failed to load resource|net::ERR_|ERR_FAILED|Failed to fetch|status of 50[0-9]|status of 40[0-9]/i;

// opt: { login: 'ok' | 'neconfirmat', resend: 'ok' | 'limita', signUp: 'ok' | 'limita' }
function supabaseSimulat(opt) {
  const sesiune = { access_token: 'tok-test', user: { id: 'u-test', email: 'ana@example.com' } };
  let conectat = false;
  window.__retrimiteri = 0;
  const limita = { code: 'over_email_send_rate_limit', status: 429, message: 'For security purposes, you can only request this after 47 seconds.' };
  const fals = {
    auth: {
      signUp: async () => (opt.signUp === 'limita'
        ? { data: { user: null }, error: limita }
        : { data: { user: { id: 'u-test', identities: [{ id: 'i' }] } }, error: null }),
      getUser: async () => ({ data: { user: conectat ? sesiune.user : null }, error: null }),
      verifyOtp: async () => { conectat = true; return { data: { user: sesiune.user, session: sesiune }, error: null }; },
      signInWithPassword: async () => {
        if (opt.login === 'neconfirmat') return { data: { user: null }, error: { code: 'email_not_confirmed', status: 400, message: 'Email not confirmed' } };
        conectat = true; return { data: { user: sesiune.user, session: sesiune }, error: null };
      },
      getSession: async () => ({ data: { session: conectat ? sesiune : null } }),
      resend: async () => { window.__retrimiteri++; return opt.resend === 'limita' ? { error: limita } : { error: null }; },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }) }) }) }),
  };
  Object.defineProperty(window, 'supabaseClient', { configurable: true, get() { return fals; }, set() {} });
}

async function testeBrowser() {
  const { chromium } = require('playwright');
  const { porneste } = require('./server-test');
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();

  async function context(latime, limba, opt, destinatie) {
    const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 800 ? 844 : 900 } });
    await ctx.addInitScript((l) => {
      try {
        localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
        if (l) localStorage.setItem('myd_lang_v1', l);
      } catch (e) {}
    }, limba || null);
    if (opt) await ctx.addInitScript(supabaseSimulat, opt);
    await ctx.route(/\.supabase\.co\//, (r) => r.abort());
    await ctx.route(/ipapi\.co\//, (r) => r.abort());
    const apeluri = { bunVenit: [], vechi: 0 };
    await ctx.route(/\/api\/cont\/bun-venit/, (r) => {
      apeluri.bunVenit.push(r.request().headers()['authorization'] || '');
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"trimis":true}' });
    });
    await ctx.route(/\/api\/public\/trimite-bun-venit-client/, (r) => { apeluri.vechi++; r.fulfill({ status: 410, body: '{}' }); });
    if (destinatie) await ctx.route(/\/api\/public\/destinatie-post-login/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(destinatie) }));
    return { ctx, apeluri };
  }
  function urmaresteErori(p, erori) {
    p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
    p.on('console', (m) => { if (m.type() === 'error' && !ZGOMOT.test(m.text())) erori.push('console: ' + m.text().slice(0, 160)); });
  }
  const deschisa = (p) => p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 8000 }).catch(() => {});
  const navigariSpre = (p) => { const n = []; p.on('framenavigated', (f) => { if (f === p.mainFrame()) n.push(new URL(f.url()).pathname); }); return n; };
  async function asteaptaNavigare(n, cale) { for (let i = 0; i < 80 && !n.includes(cale); i++) await asteapta(100); return n.includes(cale); }
  async function completeazaDate(p) {
    await p.fill('#reg-prenume', 'Ana');
    await p.fill('#reg-nume', 'Popescu');
    await p.fill('#reg-email', 'ana@example.com');
    await p.fill('#reg-pass', 'parola-lunga-1');
    await p.fill('#reg-tel', '+40 712 345 678');
    await p.check('#reg-gdpr');
  }
  async function pornesteInscriere(p, cat, tip) {
    await p.evaluate(() => window.toggleAuthModal());
    await deschisa(p);
    await p.click('#tab-register-btn');
    await p.click(`#auth-modal label[data-mdc-cat="${cat}"]`);
    if (tip) await p.click(`#auth-modal label[data-mdc-rol="${tip}"]`);
    await p.click('#mdc-rol-continua');
    await completeazaDate(p);
    await p.click('#mdc-register-btn');
    await p.waitForSelector('#verify-cod-input', { state: 'visible', timeout: 8000 });
  }
  async function login(p) {
    await p.evaluate(() => window.switchAuthTab('login'));
    await deschisa(p);
    await p.fill('#login-email', 'ana@example.com');
    await p.fill('#login-pass', 'parola-lunga-1');
    await p.click('#mdc-login-btn');
  }
  const stareCod = (p) => p.evaluate(() => {
    const m = document.getElementById('auth-modal');
    const zona = document.getElementById('verify-cod-msg');
    const info = zona.querySelector('.md-feedback-info');
    const rosii = [...m.querySelectorAll('.md-feedback-eroare')].filter((e) => e.getClientRects().length);
    const btn = document.getElementById('mdc-login-btn');
    return {
      ecranCod: !document.getElementById('auth-verify-cod').hidden,
      info: info ? info.textContent : '',
      culoareInfo: info ? getComputedStyle(info).color : '',
      rosii: rosii.map((e) => e.textContent),
      btnRosu: /192, 57, 43/.test(getComputedStyle(btn).backgroundColor) || /Nu s-a salvat|wasn't saved/i.test(btn.textContent),
      retrimiteri: window.__retrimiteri,
      email: document.getElementById('verify-cod-email').textContent,
      indiciu: (document.getElementById('mdc-cod-indiciu') || {}).textContent || '',
      indiciuVizibil: !!(document.getElementById('mdc-cod-indiciu') && document.getElementById('mdc-cod-indiciu').getClientRects().length),
    };
  });

  try {
    // 1. Înscriere → niciun bun venit înainte de cod → cod → un singur apel, cu sesiunea.
    for (const [cat, tip, dest] of [['client', null, '/mydarrin-catalog.html'], ['partener', 'partener_servicii', '/mydarrin-dashboard-partener.html']]) {
      const et = `înscriere ${tip || cat}`;
      const { ctx, apeluri } = await context(390, 'ro', {}, { ok: true, destinatie: dest + (tip ? '?type=servicii' : '') });
      const p = await ctx.newPage();
      const erori = []; urmaresteErori(p, erori);
      await p.goto(`${baza}/index.html`, { waitUntil: 'networkidle', timeout: 60000 });
      const nav = navigariSpre(p);
      await pornesteInscriere(p, cat, tip);
      await asteapta(1200);
      verifica(apeluri.bunVenit.length === 0 && apeluri.vechi === 0, `${et}: email de bun venit cerut înainte de cod (${apeluri.bunVenit.length} / vechi ${apeluri.vechi})`);
      const s = await stareCod(p);
      verifica(s.indiciuVizibil && /Spam sau Promoții/.test(s.indiciu), `${et}: lipsește indiciul „Spam sau Promoții” sub cod („${s.indiciu}”)`);
      await p.fill('#verify-cod-input', '123456');
      await p.click('#mdc-cod-btn');
      verifica(await asteaptaNavigare(nav, dest), `${et}: după cod a ajuns la ${nav.join(' → ') || 'nicăieri'} (așteptat ${dest})`);
      verifica(apeluri.bunVenit.length === 1 && apeluri.bunVenit[0] === 'Bearer tok-test', `${et}: ${apeluri.bunVenit.length} apeluri de bun venit după cod (${apeluri.bunVenit.join(',')})`);
      verifica(apeluri.vechi === 0, `${et}: endpoint-ul public vechi a fost chemat`);
      verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }

    // 2. Login cu cont neconfirmat → ecranul de cod, cod nou, albastru, fără roșu → cod → destinația.
    for (const [et, opt, limba, asteptat, dest] of [
      ['login neconfirmat (client)', { login: 'neconfirmat' }, 'ro', /Contul tău nu e confirmat încă\. Ți-am trimis un cod nou la ana@example\.com\./, '/mydarrin-catalog.html'],
      ['login neconfirmat (partener)', { login: 'neconfirmat' }, 'ro', /cod nou/, '/mydarrin-dashboard-partener.html'],
      ['login neconfirmat, limita de coduri', { login: 'neconfirmat', resend: 'limita' }, 'ro', /așteaptă un minut/, null],
      ['login neconfirmat EN', { login: 'neconfirmat' }, null, /Your account is not confirmed yet\. We sent a new code to ana@example\.com\./, null],
    ]) {
      const { ctx, apeluri } = await context(390, limba, opt, dest ? { ok: true, destinatie: dest } : null);
      const p = await ctx.newPage();
      const erori = []; urmaresteErori(p, erori);
      await p.goto(`${baza}/despre-noi.html`, { waitUntil: 'networkidle', timeout: 60000 });
      const nav = navigariSpre(p);
      await login(p);
      await p.waitForFunction(() => !document.getElementById('auth-verify-cod').hidden && document.querySelector('#verify-cod-msg .md-feedback'), null, { timeout: 8000 }).catch(() => {});
      // Fără roșu nici o clipă după (fostul cod arăta eroarea, apoi schimba ecranul după 1,2 s).
      await asteapta(1500);
      const s = await stareCod(p);
      verifica(s.ecranCod, `${et}: nu a trecut la ecranul de cod`);
      verifica(asteptat.test(s.info), `${et}: mesajul informativ e „${s.info}”`);
      verifica(/29, 95, 168/.test(s.culoareInfo), `${et}: mesajul nu e albastru (${s.culoareInfo})`);
      verifica(!s.rosii.length && !s.btnRosu, `${et}: eroare roșie afișată (${s.rosii.join(' | ')}${s.btnRosu ? ' + buton roșu' : ''})`);
      verifica(s.retrimiteri === 1, `${et}: ${s.retrimiteri} coduri noi trimise (așteptat 1)`);
      verifica(s.email === 'ana@example.com', `${et}: emailul de pe ecranul de cod e „${s.email}”`);
      if (!limba) {
        const text = await p.evaluate(() => document.getElementById('auth-verify-cod').innerText);
        verifica(/Check your Spam or Promotions folder too/.test(text), `${et}: indiciul Spam nu e în engleză`);
        const ro = text.match(/[ăâîșțşţ][^\n]{0,30}/gi) || [];
        verifica(!ro.length, `${et}: text românesc pe ecranul de cod: ${ro.slice(0, 3).join(' | ')}`);
      }
      if (dest) {
        await p.fill('#verify-cod-input', '123456');
        await p.click('#mdc-cod-btn');
        verifica(await asteaptaNavigare(nav, dest), `${et}: după cod a ajuns la ${nav.join(' → ') || 'nicăieri'} (așteptat ${dest})`);
        verifica(apeluri.bunVenit.length === 1, `${et}: ${apeluri.bunVenit.length} apeluri de bun venit după cod`);
      }
      verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }

    // 3. „Creare cont” cu un email deja înregistrat, neconfirmat → ecranul de cod.
    for (const [et, opt, mesaj] of [
      ['creare cont, email neconfirmat (Supabase retrimite codul)', {}, null],
      ['creare cont, email neconfirmat, cod cerut adineauri', { signUp: 'limita' }, /Ai deja un cont neconfirmat cu ana@example\.com/],
    ]) {
      const { ctx, apeluri } = await context(390, 'ro', opt, null);
      const p = await ctx.newPage();
      const erori = []; urmaresteErori(p, erori);
      await p.goto(`${baza}/index.html`, { waitUntil: 'networkidle', timeout: 60000 });
      await pornesteInscriere(p, 'client', null).catch(() => {});
      await asteapta(900);
      const s = await stareCod(p);
      const exista = await p.evaluate(() => /are deja un cont/.test(document.getElementById('auth-modal').innerText));
      verifica(s.ecranCod, `${et}: nu a trecut la ecranul de cod`);
      verifica(!exista && !s.rosii.length, `${et}: arată eroarea „emailul există deja” sau alt mesaj roșu (${s.rosii.join(' | ')})`);
      if (mesaj) verifica(mesaj.test(s.info), `${et}: mesajul informativ e „${s.info}”`);
      verifica(apeluri.bunVenit.length === 0, `${et}: bun venit cerut înainte de cod`);
      verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }
    console.log('fereastra de cont: gata');

    // 4. „Devino partener” (pasul 11-R3g): vechea pagină duce la hub, care se deschide
    // cu partea de sus (hero), tipurile și pașii — fără file goale; 4 lățimi.
    for (const latime of [390, 768, 1024, 1366]) {
      for (const limba of ['ro', null]) {
        const et = `devino-partener ${latime}px ${limba || 'en'}`;
        const { ctx } = await context(latime, limba, null, null);
        const p = await ctx.newPage();
        const erori = []; urmaresteErori(p, erori);
        await p.goto(`${baza}/mydarrin-devino-partener.html`, { waitUntil: 'networkidle', timeout: 60000 });
        await asteapta(400);
        const s = await p.evaluate(() => {
          const viz = (sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().height > 100; };
          return {
            cale: location.pathname, hero: viz('.rp-hero'), tipuri: document.querySelectorAll('#tipuri .rp-tip').length, pasi: document.querySelectorAll('#pasi .rp-pas').length,
            file: document.querySelectorAll('#hero-tabs-bar button').length,
            derulare: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
        verifica(s.cale === '/cum-devii-partenerul-nostru', `${et}: nu ajunge la hub (${s.cale})`);
        verifica(s.hero && s.tipuri === 5 && s.pasi === 4 && !s.file, `${et}: hub incomplet ${JSON.stringify(s)}`);
        verifica(s.derulare <= 1, `${et}: derulare orizontală de ${s.derulare}px`);
        verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
        await ctx.close();
      }
    }

    // 5. Fereastra de cont (ecranul de cod) la cele 4 lățimi: fără derulare orizontală, fără erori.
    for (const latime of [390, 768, 1024, 1366]) {
      const et = `ecranul de cod ${latime}px`;
      const { ctx } = await context(latime, 'ro', { login: 'neconfirmat' }, null);
      const p = await ctx.newPage();
      const erori = []; urmaresteErori(p, erori);
      await p.goto(`${baza}/index.html`, { waitUntil: 'networkidle', timeout: 60000 });
      await login(p);
      await p.waitForFunction(() => !document.getElementById('auth-verify-cod').hidden, null, { timeout: 8000 }).catch(() => {});
      const s = await p.evaluate(() => {
        const c = document.querySelector('#auth-modal .mdc-cutie').getBoundingClientRect();
        return { stanga: c.left, dreapta: c.right, vw: window.innerWidth, derulare: document.documentElement.scrollWidth - window.innerWidth };
      });
      verifica(s.stanga >= 0 && s.dreapta <= s.vw + 0.5 && s.derulare <= 1, `${et}: fereastra iese din ecran (${Math.round(s.stanga)}–${Math.round(s.dreapta)} / ${s.vw}, derulare ${s.derulare})`);
      verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }
    console.log('pagini: gata');
  } finally {
    await browser.close();
    srv.close();
  }
}

(async () => {
  await testeServer();
  if (!process.argv.includes('--doar-server')) await testeBrowser();
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
