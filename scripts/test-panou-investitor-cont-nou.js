// scripts/test-panou-investitor-cont-nou.js
// Pasul 11-I2 (decizia LM, 14 nov. 2026): contul de investitor duce direct în
// panoul propriu; datele de identitate se cer doar la „Investește”.
//
// Fără rețea externă: serverul local (scripts/server-test.js) și Playwright.
// Clientul Supabase e simulat ca în producție: signUp creează utilizatorul fără
// sesiune; verifyOtp salvează sesiunea în stocare, anunță SIGNED_IN și abia apoi
// răspunde (ca supabase-js v2). account-system.js, cont-fereastra.js,
// cta-investitor.js, investitori-ruta.js, cont-dashboard.js și
// panou-investitor.js sunt cele reale; destinația după login vine din regula
// reală (lib/destinatie-rol.js).
//
// Verifică:
//   1. cont nou de investitor, RO și EN, 390 și 1280 px: „Devino investitor” →
//      „Creare cont” → codul (verify-cod → confirmaCodEmail →
//      dupaAutentificare('cont_creat') → mergiDupaLogin) → pagina se schimbă singură
//      în panou, starea „cont nou”; ruta KYC NU se deschide; nicio cerere spre
//      API-urile requireAuth(['investor']) (portofoliu, kyc nu, exit, istoric,
//      indicatori, evolutie-lunara, subscrie) pe tot drumul;
//   2. panoul „cont nou”: antetul cu numele și insigna „Investitor”; runda din
//      /api/public/runda-curenta (Seed) și „Investește în runda Seed”; banda despre
//      dosar (Legea 129/2019); pitch deck-ul după vizibilitate; fără cifre care nu
//      vin din server; secțiunile cu rol: „Apare după prima subscriere.”;
//      „Datele mele” fără IBAN / act; mesajul despre telefon doar fără telefon;
//   3. „Investește” → ruta KYC, pasul 1 (CNP / NIF și IBAN în formular, ca azi);
//      cu dosar început → pasul salvat; după pasul 5 → rolul `investor` →
//      subscrierea (fereastra rundei) → panoul complet;
//   4. alegeDestinatie: [] + rolSolicitat investor → panou; ['investor'] → panou;
//      client / partener fără investor → neschimbat;
//   5. ?ruta=investitor: cu rol_solicitat investor sau cu rolul → panoul; clientul
//      fără alegere → ruta, ca înainte;
//   6. codul în alt tab (fără myd_revenire_dupa_login) → panoul; și când stocarea
//      nu păstrează sesiunea (cookie refuzat) pagina tot pleacă singură spre panou;
//   7. API-urile requireAuth(['investor']) sunt neschimbate; fără numele
//      secretului KYC în fișierele pasului; 0 erori JS.
//
// Rulare: node scripts/test-panou-investitor-cont-nou.js

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const R = path.join(__dirname, '..');
const DR = require(path.join(R, 'lib', 'destinatie-rol'));
let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

const USER = { id: '20000000-0000-4000-8000-0000000000e2', email: 'investitor.nou@example.com', email_confirmed_at: '2026-11-14T09:00:00Z', user_metadata: { prenume: 'Ana', nume: 'Test', rol_solicitat: 'investor' } };
const SEED = {
  cod: 'SEED', denumire_ro: 'Seed', denumire_en: 'Seed', descriere_ro: null, descriere_en: null, stare: 'deschisa',
  data_start: '2026-11-01', data_sfarsit: '2027-03-31', moneda: 'EUR', suma_tinta: 250000, investitie_minima: 1000,
  pret_actiune: 2.5, equity_oferit_pct: 10, post_money: 2500000, tickete: [1000, 5000], instrumente: ['actiuni'],
};
// API-urile cu requireAuth(['investor']) (nu se apelează în starea „cont nou”).
const API_INVESTOR = /\/api\/investitori\/(portofoliu|exit|istoric|indicatori|evolutie-lunara|subscrie)/;

// Clientul Supabase simulat ca în producție. cheieStocare: unde își ține sesiunea
// (sessionStorage, rămâne după navigare în același tab). stocareRefuzata: cookie-ul
// nu se salvează (getSession întoarce null), dar verifyOtp întoarce sesiunea.
function supabaseSimulat([user, stocareRefuzata]) {
  const K = 'sim_sesiune';
  const sesiune = () => { try { return !stocareRefuzata && sessionStorage.getItem(K) === '1' ? { access_token: 'token-simulat', user } : null; } catch (e) { return null; } };
  const ascultatori = [];
  const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
  window.__auth = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: sesiune() ? user : null }, error: null }),
      getSession: async () => ({ data: { session: sesiune() }, error: null }),
      onAuthStateChange: (cb) => { ascultatori.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => ({ error: null }),
      // Ca în producție: utilizatorul e creat, sesiunea abia după cod.
      signUp: async (o) => { window.__auth.push({ tip: 'signUp', o }); return { data: { user: { id: user.id, email: user.email, identities: [{}] }, session: null }, error: null }; },
      verifyOtp: async (o) => {
        window.__auth.push({ tip: 'verifyOtp', o });
        await new Promise((r) => setTimeout(r, 120)); // drumul până la Supabase
        try { sessionStorage.setItem(K, '1'); } catch (e) {}
        const s = { access_token: 'token-simulat', user };
        ascultatori.forEach((cb) => { try { cb('SIGNED_IN', s); } catch (e) {} });
        return { data: { user, session: s }, error: null };
      },
      signInWithPassword: async () => { try { sessionStorage.setItem(K, '1'); } catch (e) {} return { data: { user, session: sesiune() }, error: null }; },
      resend: async () => ({ error: null }),
    },
    from: () => lant({ data: null, error: null }),
    rpc: () => lant({ data: null, error: null }),
    channel: () => lant({}),
    removeChannel: () => {},
  };
  Object.defineProperty(window, 'supabaseClient', { configurable: true, get: () => client, set: () => {} });
}

async function context(br, B, o) {
  const ctx = await br.newContext({ viewport: { width: o.latime || 1280, height: o.latime && o.latime < 600 ? 844 : 860 } });
  const stare = {
    roles: (o.roles || ['client']).slice(), rolSolicitat: o.rolSolicitat || 'investor',
    telefon: o.telefon === undefined ? '+40700000010' : o.telefon,
    kyc: o.kyc || null, cereri: [], investorApi: [], pasiTrimisi: [],
  };
  await ctx.addInitScript(([l, ses]) => {
    try {
      localStorage.setItem('myd_lang_v1', l);
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: true, marketing: false, data: new Date().toISOString(), versiune: 2 }));
      if (ses && !sessionStorage.getItem('sim_pornit')) { sessionStorage.setItem('sim_sesiune', '1'); sessionStorage.setItem('sim_pornit', '1'); }
    } catch (e) {}
  }, [o.lang || 'ro', !!o.cuSesiune]);
  await ctx.addInitScript(supabaseSimulat, [USER, !!o.stocareRefuzata]);
  await ctx.route(/esm\.sh/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function createClient() { return window.supabaseClient; }' }));
  await ctx.route(/\.supabase\.co\/|googletagmanager|google-analytics|_vercel\/insights|ipapi\.co/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const json = (r, corp, cod) => r.fulfill({ status: cod || 200, contentType: 'application/json', body: JSON.stringify(corp) });
  const autentificat = (r) => /^Bearer .+/.test(r.request().headers()['authorization'] || '');
  const dest = () => DR.alegeDestinatie(stare.roles, { rolSolicitat: stare.rolSolicitat, areComenzi: false });
  const lipsa = () => (stare.kyc && stare.kyc.status !== 'ciorna' ? [] : ['date_personale']);
  await ctx.route(/\/api\//, (r) => {
    const u = r.request().url();
    const cale = u.replace(/^https?:\/\/[^/]+/, '');
    stare.cereri.push(r.request().method() + ' ' + cale);
    if (API_INVESTOR.test(u)) {
      stare.investorApi.push(r.request().method() + ' ' + cale);
      if (!stare.roles.includes('investor')) return json(r, { ok: false, cod: 'FARA_DREPT', mesaj: { ro: 'Nu ai permisiunea necesară pentru acest rol', en: 'You do not have the required permission for this role' } }, 403);
      if (/portofoliu/.test(u)) return json(r, { ok: true, kyc_status: 'in_verificare', actiuni: 0, valoare_investita: 0, in_asteptare: 0, pct_companie: 0, subscrieri: [], runda: SEED, exit: { buyback_disponibil: false } });
      if (/exit/.test(u)) return json(r, { ok: true, cereri: [] });
      if (/istoric/.test(u)) return json(r, { ok: true, evenimente: [] });
      return json(r, { ok: false }, 403);
    }
    if (/\/api\/cont\/profil/.test(u)) {
      if (!autentificat(r)) return json(r, { ok: false }, 401);
      const d = dest() || {};
      return json(r, {
        ok: true, email: USER.email, nume: 'Ana Test', prenume: 'Ana', nume_familie: 'Test', telefon: stare.telefon, tara: 'RO',
        roles: stare.roles.slice(), roluri_dashboard: DR.roluriCuDashboard(stare.roles, { areComenzi: false }), are_comenzi: false,
        destinatie: d.destinatie || null, tip_destinatie: d.tip || null, rol_solicitat: stare.rolSolicitat,
        partener: null, investitor: stare.kyc ? { status: stare.kyc.status, pas_curent: stare.kyc.pas_curent } : null, activare: null,
      });
    }
    if (/\/api\/public\/destinatie-post-login/.test(u)) {
      if (!autentificat(r)) return json(r, { ok: false }, 401);
      return json(r, { ok: true, ...dest() });
    }
    if (/\/api\/investitori\/kyc(\?|$)/.test(u)) {
      if (r.request().method() === 'POST') {
        const corp = JSON.parse(r.request().postData() || '{}');
        stare.pasiTrimisi.push(corp.pas);
        if (corp.pas === 5) {
          // api/investitori/kyc.js: dosarul în verificare, asiguraRolInvestitor.
          stare.kyc = Object.assign({}, stare.kyc, { status: 'in_verificare', pas_curent: 5 });
          if (!stare.roles.includes('investor')) stare.roles.push('investor');
          return json(r, { ok: true, kyc: stare.kyc, lipsa: [], roles: stare.roles.slice() });
        }
        stare.kyc = Object.assign({}, stare.kyc, { status: 'ciorna', pas_curent: corp.pas + 1 });
        return json(r, { ok: true, kyc: stare.kyc, lipsa: lipsa() });
      }
      return json(r, { ok: true, kyc: stare.kyc, lipsa: lipsa(), cont: { prenume: 'Ana', nume: 'Test', email: USER.email, telefon: stare.telefon, tara: 'RO' } });
    }
    if (/\/api\/investitori\//.test(u)) return json(r, { ok: true });
    if (/\/api\/public\/runda-curenta/.test(u)) return json(r, { ok: true, runda: o.faraRunda ? null : SEED });
    if (/\/api\/public\/pitch-deck/.test(u)) return json(r, { ok: true, stare: o.deckInPregatire ? 'in_pregatire' : 'disponibil', limba: o.lang === 'en' ? 'en' : 'ro', vizibilitate: o.vizibilitate || 'investitori_aprobati' });
    if (/\/api\/cont\/bun-venit/.test(u)) return json(r, { ok: true, trimis: false });
    if (/\/api\/public\/(reguli-platforma|tari-active)/.test(u)) return r.continue();
    return json(r, { ok: false }, 503);
  });
  const page = await ctx.newPage();
  const erori = [];
  page.on('pageerror', (e) => erori.push(e.message));
  stare.navigari = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) stare.navigari.push(f.url().replace(/^https?:\/\/[^/]+/, '')); });
  return { ctx, page, stare, erori };
}

const fereastraCont = (p) => p.waitForFunction(() => { const m = document.getElementById('auth-modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 10000 }).then(() => true, () => false);
const panouContNou = (p) => p.waitForSelector('#pi-app[data-pi-mod="cont-nou"][data-pi-gata="1"]:not([hidden])', { timeout: 15000 }).then(() => true, () => false);
const subtitluRuta = (p) => p.waitForFunction(() => { const s = document.getElementById('mi-subtitlu'); return s && /\d/.test(s.textContent) ? s.textContent : null; }, null, { timeout: 15000 }).then((h) => h.jsonValue(), () => null);

const T = {
  ro: {
    insigna: 'Investitor', buton: 'Investește în runda Seed', gol: 'Apare după prima subscriere.',
    banda: 'Dosarul de investitor se completează când decizi să investești. Îți vom cere atunci datele de identitate (CNP sau NIF, actul de identitate) și contul bancar, cerute de Legea 129/2019.',
    telefon: /^Telefonul nu a fost salvat pe cont/, pas1: /^Pasul 1 din 5/, pas3: /^Pasul 3 din 5/, deck: 'Acum vezi rezumatul; deck-ul complet se deschide după aprobarea verificării identității.',
  },
  en: {
    insigna: 'Investor', buton: 'Invest in the Seed round', gol: 'Appears after your first subscription.',
    banda: 'Your investor application is completed when you decide to invest. We will then ask for your identity details (CNP or tax ID, identity document) and your bank account, as required by Law 129/2019.',
    telefon: /^Your phone number was not saved on your account/, pas1: /^Step 1 of 5/, pas3: /^Step 3 of 5/, deck: 'You can see the summary now; the full deck opens once your identity check is approved.',
  },
};

async function stareaPanoului(p) {
  return p.evaluate(() => {
    const t = (id) => { const e = document.getElementById(id); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
    const vizibil = (e) => !!e && e.getClientRects().length > 0;
    const sectiuni = {};
    ['participatii', 'subscrieri', 'exit', 'istoric', 'indicatori'].forEach((id) => {
      const g = document.querySelector('[data-pi-gol="' + id + '"]');
      const altele = [...document.getElementById(id).children].filter((c) => c.tagName !== 'H2' && !c.hasAttribute('data-pi-gol') && !c.hidden);
      sectiuni[id] = { gol: g ? g.textContent.trim() : null, altele: altele.length };
    });
    const contNou = document.getElementById('pi-cont-nou').cloneNode(true);
    contNou.querySelector('#pi-runda-date').remove();
    contNou.querySelector('#pi-info-dosar').remove();
    return {
      nume: t('myd-id-nume'), insigna: t('myd-id-insigna'), banda: t('pi-info-dosar'), buton: t('pi-investeste'),
      href: document.getElementById('pi-investeste').getAttribute('href'), titluRunda: t('pi-runda-titlu'),
      date: [...document.querySelectorAll('#pi-runda-date dd')].map((d) => d.textContent.trim()),
      kpiVizibil: vizibil(document.querySelector('#prezentare .pi-kpi')), deck: t('pi-pitch-text'), deckLink: vizibil(document.getElementById('pi-pitch-link')),
      telefon: t('pi-telefon-lipsa'), sectiuni, datele: [...document.querySelectorAll('#pi-datele dt')].map((d) => d.textContent.trim()),
      cifreInafaraServerului: (contNou.textContent.match(/\d+/g) || []), ruta: !!document.getElementById('mi-fer'),
      text403: /403|FARA_DREPT|permisiunea|permission/i.test(document.getElementById('pi-app').innerText),
    };
  });
}

async function testeBrowser() {
  const srv = await porneste(0);
  const B = 'http://localhost:' + srv.address().port;
  const br = await chromium.launch();

  // ── 1 + 2. Cont nou → codul → panoul, starea „cont nou” ─────────────
  for (const lang of ['ro', 'en']) {
    for (const latime of [390, 1280]) {
      const et = `1 ${lang} ${latime}`;
      const t = T[lang];
      const { ctx, page, stare, erori } = await context(br, B, { lang, latime, telefon: null });
      await page.goto(B + '/mydarrin-investitori.html', { waitUntil: 'load' });
      await page.waitForSelector('#lp-cta[data-cta-stare]:not([data-cta-stare="incarca"])', { timeout: 15000 }).catch(() => {});
      await page.focus('#lp-cta');
      await page.keyboard.press('Enter');
      verifica(await fereastraCont(page), `${et}: „Devino investitor” nu deschide fereastra de cont`);
      await page.click('#mdc-rol-continua');
      await page.fill('#reg-prenume', 'Ana');
      await page.fill('#reg-nume', 'Test');
      await page.fill('#reg-email', USER.email);
      await page.fill('#reg-tel', '+40 700 000 010');
      await page.fill('#reg-pass', 'Parola-Test-1');
      await page.check('#reg-gdpr');
      await page.click('#mdc-register-btn');
      const laCod = await page.waitForFunction(() => !document.getElementById('auth-verify-cod').hidden, null, { timeout: 10000 }).then(() => true, () => false);
      verifica(laCod, `${et}: ecranul codului nu apare`);
      const su = (await page.evaluate(() => window.__auth)).find((a) => a.tip === 'signUp');
      verifica(su && su.o.options.data.rol_solicitat === 'investor' && !('cnp' in su.o.options.data) && !('iban' in su.o.options.data), `${et}: signUp: ${JSON.stringify(su && su.o.options.data)}`);
      verifica(!(await page.evaluate(() => sessionStorage.getItem('sim_sesiune'))), `${et}: sesiune înainte de cod`);

      // Codul: pagina se schimbă singură, fără reîncărcare manuală.
      await page.fill('#verify-cod-input', '123456');
      await page.click('#mdc-cod-btn');
      await page.waitForURL(/\/cont\/investitor/, { timeout: 15000 }).catch(() => {});
      verifica(/\/cont\/investitor/.test(page.url()), `${et}: după cod nu ajunge în panou (${page.url()})`);
      verifica(await panouContNou(page), `${et}: panoul nu e în starea „cont nou”`);
      await page.waitForTimeout(400);
      const s = await stareaPanoului(page);
      verifica(!s.ruta, `${et}: ruta KYC s-a deschis singură`);
      verifica(!stare.investorApi.length, `${et}: cereri spre API-urile requireAuth(['investor']): ${stare.investorApi}`);
      verifica(!stare.pasiTrimisi.length, `${et}: s-a trimis un pas KYC: ${stare.pasiTrimisi}`);
      verifica(s.nume === 'Ana Test' && s.insigna === t.insigna, `${et}: antetul: ${s.nume} / ${s.insigna}`);
      verifica(s.banda === t.banda, `${et}: banda: „${s.banda}”`);
      verifica(s.titluRunda === 'Seed' && s.buton === t.buton && s.href === '/investitori?ruta=investeste', `${et}: runda / butonul: ${s.titluRunda} / ${s.buton} / ${s.href}`);
      const asteptate = lang === 'ro' ? ['2,5 EUR', '1.000 EUR', '250.000 EUR', '10%'] : ['2.5 EUR', '1,000 EUR', '250,000 EUR', '10%'];
      verifica(asteptate.every((x) => s.date.includes(x)) && s.date.length === 5, `${et}: datele rundei: ${JSON.stringify(s.date)}`);
      verifica(!s.kpiVizibil, `${et}: KPI-urile de portofoliu se văd în starea „cont nou”`);
      verifica(!s.cifreInafaraServerului.length, `${et}: cifre care nu vin din server: ${s.cifreInafaraServerului}`);
      verifica(s.deck === t.deck && s.deckLink, `${et}: pitch deck-ul: „${s.deck}” / link ${s.deckLink}`);
      verifica(t.telefon.test(s.telefon || ''), `${et}: mesajul despre telefon: „${s.telefon}”`);
      verifica(Object.values(s.sectiuni).every((x) => x.gol === t.gol && x.altele === 0), `${et}: secțiunile cu rol: ${JSON.stringify(s.sectiuni)}`);
      verifica(!s.text403, `${et}: un 403 / „permisiune” vizibil în panou`);
      verifica(s.datele.length === 3, `${et}: „Datele mele” în starea „cont nou”: ${s.datele}`);
      if (lang === 'en') {
        // Detectorul EN pentru starea „cont nou”: tot textul panoului (și secțiunile
        // ascunse), fără elementele translate="no" (nume, sume), fără diacritice românești.
        const ro = await page.evaluate(() => {
          const c = document.getElementById('pi-app').cloneNode(true);
          c.querySelectorAll('[translate="no"], script, style').forEach((e) => e.remove());
          return (c.textContent.match(/[^\s.,;:()]*[ăâîșțşţĂÂÎȘȚ][^\s.,;:()]*/g) || []);
        });
        verifica(!ro.length, `${et}: text românesc în panoul EN: ${ro.slice(0, 8)}`);
      }
      // Fără derulare orizontală.
      const lat = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      verifica(lat <= 1, `${et}: derulare orizontală ${lat}px`);
      verifica(!erori.length, `${et}: erori JS: ${erori.slice(0, 2)}`);
      await ctx.close();
    }
  }

  // ── 2. Telefonul salvat → fără mesaj; fără rundă / deck în pregătire ──
  {
    const { ctx, page, erori } = await context(br, B, { lang: 'ro', cuSesiune: true, faraRunda: true, deckInPregatire: true });
    await page.goto(B + '/mydarrin-panou-investitor.html', { waitUntil: 'load' });
    verifica(await panouContNou(page), '2 fără rundă: panoul nu e în starea „cont nou”');
    const s = await stareaPanoului(page);
    verifica(!s.telefon, `2: mesaj despre telefon cu telefonul salvat: „${s.telefon}”`);
    verifica(s.titluRunda === 'Nicio rundă deschisă' && !s.date.length && s.buton === 'Completează dosarul de investitor', `2 fără rundă: ${s.titluRunda} / ${s.buton} / ${s.date}`);
    verifica(s.deck === 'Pitch deck-ul e în pregătire.' && !s.deckLink, `2: deck în pregătire: ${s.deck}`);
    verifica(!s.cifreInafaraServerului.length, `2 fără rundă: cifre ${s.cifreInafaraServerului}`);
    verifica(!erori.length, `2: erori JS: ${erori.slice(0, 2)}`);
    await ctx.close();
  }

  // ── 3. „Investește” → ruta KYC (pasul 1, apoi pasul salvat), apoi subscrierea ──
  for (const lang of ['ro', 'en']) {
    for (const latime of [390, 1280]) {
      const et = `3 ${lang} ${latime}`;
      const t = T[lang];
      const { ctx, page, stare, erori } = await context(br, B, { lang, latime, cuSesiune: true });
      await page.goto(B + '/mydarrin-panou-investitor.html', { waitUntil: 'load' });
      await panouContNou(page);
      await page.click('#pi-investeste');
      await page.waitForURL(/\/investitori/, { timeout: 15000 }).catch(() => {});
      const sub = await subtitluRuta(page);
      verifica(t.pas1.test(sub || ''), `${et}: „Investește” nu deschide pasul 1: „${sub}”`);
      const campuri = await page.evaluate(() => ['mi-id_fiscal', 'mi-iban', 'mi-data_nasterii', 'mi-cetatenie', 'mi-adresa_strada'].map((id) => !!document.getElementById(id)));
      verifica(campuri.every(Boolean), `${et}: câmpurile pasului 1 (CNP / NIF, IBAN, …): ${campuri}`);
      verifica(!/ruta=/.test(page.url()), `${et}: parametrul rămâne în adresă: ${page.url()}`);
      verifica(!erori.length, `${et}: erori JS: ${erori.slice(0, 2)}`);
      await ctx.close();
    }
  }
  {
    // Dosar început (pasul 3 salvat) → ruta continuă de la pasul 3.
    const { ctx, page } = await context(br, B, { lang: 'ro', cuSesiune: true, kyc: { status: 'ciorna', pas_curent: 3 } });
    await page.goto(B + '/mydarrin-panou-investitor.html', { waitUntil: 'load' });
    await panouContNou(page);
    await page.click('#pi-investeste');
    const sub = await subtitluRuta(page);
    verifica(T.ro.pas3.test(sub || ''), `3 dosar început: nu continuă de la pasul salvat: „${sub}”`);
    await ctx.close();
  }
  {
    // Pasul 5 → rolul `investor` (serverul) → subscrierea → panoul complet.
    const { ctx, page, stare, erori } = await context(br, B, { lang: 'ro', cuSesiune: true, kyc: { status: 'ciorna', pas_curent: 5 } });
    await page.goto(B + '/mydarrin-panou-investitor.html', { waitUntil: 'load' });
    await panouContNou(page);
    await page.click('#pi-investeste');
    const sub = await subtitluRuta(page);
    verifica(/^Pasul 5 din 5/.test(sub || ''), `3 pasul 5: „${sub}”`);
    await page.check('#mi-confirma');
    await page.click('#mi-continua');
    const runda = await page.waitForFunction(() => { const m = document.getElementById('modal-runda'); return m && m.style.display === 'block'; }, null, { timeout: 20000 }).then(() => true, () => false);
    verifica(stare.pasiTrimisi.includes(5) && stare.roles.includes('investor'), `3 pasul 5: rolul nu s-a adăugat: ${JSON.stringify(stare)}`);
    verifica(runda, `3 pasul 5: după trimitere nu se deschide subscrierea (${page.url()})`);
    await page.goto(B + '/mydarrin-panou-investitor.html', { waitUntil: 'load' });
    const complet = await page.waitForSelector('#pi-app[data-pi-gata="1"]:not([hidden])', { timeout: 15000 }).then(() => true, () => false);
    const mod = await page.getAttribute('#pi-app', 'data-pi-mod');
    verifica(complet && !mod && stare.investorApi.some((x) => /portofoliu/.test(x)), `3 pasul 5: panoul complet după rol (mod ${mod})`);
    verifica(!erori.length, `3 pasul 5: erori JS: ${erori.slice(0, 2)}`);
    await ctx.close();
  }

  // ── 5. ?ruta=investitor (linkuri vechi, emailul de bun venit) ─────────
  for (const [et, o, panou] of [
    ['5 rol_solicitat investor', { roles: ['client'] }, true],
    ['5 cu rolul investor', { roles: ['client', 'investor'], kyc: { status: 'aprobat', pas_curent: 5 } }, true],
    ['5 client fără alegere', { roles: ['client'], rolSolicitat: 'client' }, false],
  ]) {
    const { ctx, page, stare, erori } = await context(br, B, Object.assign({ lang: 'ro', cuSesiune: true }, o));
    await page.goto(B + '/mydarrin-investitori.html?ruta=investitor', { waitUntil: 'load' });
    if (panou) {
      await page.waitForURL(/\/cont\/investitor/, { timeout: 15000 }).catch(() => {});
      verifica(/\/cont\/investitor/.test(page.url()), `${et}: nu ajunge în panou (${page.url()})`);
      verifica(!(await page.$('#mi-fer')), `${et}: ruta KYC deschisă`);
    } else {
      const sub = await subtitluRuta(page);
      verifica(/mydarrin-investitori/.test(page.url()) && /^Pasul 1 din 5/.test(sub || ''), `${et}: fluxul de până acum (ruta): ${page.url()} / ${sub}`);
    }
    if (et === '5 rol_solicitat investor') verifica(!stare.investorApi.length, `${et}: cereri requireAuth(['investor']): ${stare.investorApi}`);
    verifica(!erori.length, `${et}: erori JS: ${erori.slice(0, 2)}`);
    await ctx.close();
  }

  // ── 6. Codul în alt tab (fără myd_revenire_dupa_login) ──────────────
  for (const [et, refuzata] of [['6 alt tab', false], ['6 alt tab, sesiunea nu rămâne în stocare', true]]) {
    for (const lang of ['ro', 'en']) {
      const { ctx, page, stare, erori } = await context(br, B, { lang, stocareRefuzata: refuzata });
      await page.goto(B + '/index.html', { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.MDCont && !!window.MyDarrinAuth, null, { timeout: 15000 });
      await page.evaluate((email) => { sessionStorage.setItem('myd_pending_confirm_email', email); window.MDCont.deschide({ tab: 'verify-cod' }); }, USER.email);
      verifica(!(await page.evaluate(() => sessionStorage.getItem('myd_revenire_dupa_login'))), `${et} ${lang}: revenirea există`);
      await page.waitForSelector('#verify-cod-input', { state: 'visible', timeout: 10000 });
      await page.fill('#verify-cod-input', '654321');
      await page.click('#mdc-cod-btn');
      await page.waitForURL(/\/cont\/investitor/, { timeout: 15000 }).catch(() => {});
      const plecat = stare.navigari.some((u) => /^\/cont\/investitor/.test(u));
      verifica(plecat, `${et} ${lang}: după cod pagina nu pleacă spre panou (${stare.navigari}; ${stare.cereri.filter((x) => /destinatie/.test(x))})`);
      // Cu sesiunea refuzată de stocare, panoul cere apoi login (corect: fără sesiune).
      if (!refuzata) verifica(await panouContNou(page), `${et} ${lang}: panoul nu e în starea „cont nou”`);
      verifica(!stare.investorApi.length, `${et} ${lang}: cereri requireAuth(['investor']): ${stare.investorApi}`);
      verifica(!erori.length, `${et} ${lang}: erori JS: ${erori.slice(0, 2)}`);
      await ctx.close();
    }
  }

  // ── Paza: client fără alegere → pagina Investitori; fără sesiune → login ──
  {
    const { ctx, page } = await context(br, B, { lang: 'ro', cuSesiune: true, roles: ['client'], rolSolicitat: 'client' });
    await page.goto(B + '/mydarrin-panou-investitor.html', { waitUntil: 'load' });
    await page.waitForURL(/#cum-functioneaza/, { timeout: 15000 }).catch(() => {});
    verifica(/\/investitori#cum-functioneaza$/.test(page.url()), `paza: clientul fără alegere rămâne în panou (${page.url()})`);
    await ctx.close();
  }
  {
    const { ctx, page } = await context(br, B, { lang: 'ro' });
    await page.goto(B + '/mydarrin-panou-investitor.html', { waitUntil: 'load' });
    await page.waitForURL(/reason=cont/, { timeout: 15000 }).catch(() => {});
    const rev = await page.evaluate(() => sessionStorage.getItem('myd_revenire_dupa_login'));
    verifica(/reason=cont/.test(page.url()) && rev === '/mydarrin-panou-investitor.html', `paza: fără sesiune → login, cu revenire în panou (${page.url()}, ${rev})`);
    await ctx.close();
  }

  await br.close();
  srv.close();
}

// ── 4 + 7. Fără browser ────────────────────────────────────────────────
function testeServer() {
  const PANOU = '/cont/investitor';
  const d1 = DR.alegeDestinatie([], { rolSolicitat: 'investor' });
  verifica(d1 && d1.destinatie === PANOU, `alegeDestinatie([], investor): ${JSON.stringify(d1)}`);
  const d2 = DR.alegeDestinatie(['investor']);
  verifica(d2 && d2.destinatie === PANOU, `alegeDestinatie(['investor']): ${JSON.stringify(d2)}`);
  const d3 = DR.alegeDestinatie(['client', 'investor'], { rolSolicitat: 'investor', areComenzi: false });
  verifica(d3 && d3.destinatie === PANOU, `alegeDestinatie(['client','investor'], investor): ${JSON.stringify(d3)}`);
  const d4 = DR.alegeDestinatie(['client'], { rolSolicitat: 'client', areComenzi: false });
  verifica(d4 && d4.tip === 'client_fara_comenzi', `clientul, neschimbat: ${JSON.stringify(d4)}`);
  const d5 = DR.alegeDestinatie(['client'], { rolSolicitat: 'partener_servicii' });
  verifica(d5 && d5.tip === 'activare_partener', `partenerul, neschimbat: ${JSON.stringify(d5)}`);
  const d6 = DR.alegeDestinatie(['superadmin'], { rolSolicitat: 'investor' });
  verifica(d6 && d6.tip === 'superadmin', `superadmin înaintea investitorului: ${JSON.stringify(d6)}`);
  const d7 = DR.alegeDestinatie(['admin'], { rolSolicitat: 'investor', adminCatalog: true });
  verifica(d7 && d7.tip === 'admin_catalog', `admin înaintea investitorului: ${JSON.stringify(d7)}`);
  const d8 = DR.alegeDestinatie(['client', 'partener_servicii'], { rolSolicitat: 'partener_servicii' });
  verifica(d8 && d8.destinatie === '/cont/partener?type=servicii', `partenerul cu rol, neschimbat: ${JSON.stringify(d8)}`);

  // Emailul de bun venit: butonul spre panou, RO și EN.
  const { renderEmailContConfirmat } = require(path.join(R, 'lib', 'i18n'));
  const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const [l, buton] of [['ro', 'Intră în panoul tău de investitor'], ['en', 'Go to your investor dashboard']]) {
    const e = renderEmailContConfirmat(l, { nume: 'Ana', partener: false, investitor: true, link: null });
    verifica(text(e.html).includes(buton) && /href="https:\/\/mydarrin\.homebestpal\.com\/cont\/investitor"/.test(e.html), `emailul ${l}: butonul / linkul: ${text(e.html).slice(0, 200)}`);
  }
  const bv = fs.readFileSync(path.join(R, 'api', 'cont', 'bun-venit.js'), 'utf8');
  verifica(/investitor \? SITE_URL \+ dashboardPentruRol\('investor'\)/.test(bv) && !/PAGINA_RUTA_INVESTITOR/.test(bv), 'bun-venit.js: linkul investitorului nu e panoul');

  // API-urile cu rolul investor rămân requireAuth(['investor']).
  for (const f of ['portofoliu', 'exit', 'istoric', 'indicatori', 'evolutie-lunara', 'subscrie']) {
    const s = fs.readFileSync(path.join(R, 'api', 'investitori', f + '.js'), 'utf8');
    verifica(/requireAuth\(\['investor'\]/.test(s), `api/investitori/${f}.js nu mai cere rolul investor`);
  }
  const kyc = fs.readFileSync(path.join(R, 'api', 'investitori', 'kyc.js'), 'utf8');
  verifica(/asiguraRolInvestitor\(user\.id\)/.test(kyc), 'kyc.js: asiguraRolInvestitor lipsește');

  // Fără numele secretului KYC în fișierele schimbate de pas.
  for (const f of ['panou-investitor.js', 'mydarrin-panou-investitor.html', 'cta-investitor.js', 'investitori-ruta.js', 'cont-dashboard.js', 'account-system.js',
    'lib/destinatie-rol.js', 'lib/i18n.js', 'api/cont/bun-venit.js', 'scripts/test-panou-investitor-cont-nou.js', 'scripts/test-ruta-investitor-cont.js']) {
    verifica(!fs.readFileSync(path.join(R, f), 'utf8').includes('KYC_HMAC' + '_SECRET'), `${f} conține numele secretului KYC`);
  }
}

(async () => {
  testeServer();
  await testeBrowser();
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
