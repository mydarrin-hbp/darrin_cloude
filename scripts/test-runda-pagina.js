// scripts/test-runda-pagina.js
// Pasul 11-J (21 oct. 2026): runda de finanțare pe pagina Investitori, în
// browser (Playwright), RO + EN, la 390 și 1366 px.
//   A. fără rundă publică (răspuns { runda: null }, eroare 500 sau migrarea
//      neaplicată): rămâne textul fără rundă, [data-runda] ascuns, 0 erori JS;
//   B. investitor, fără rundă deschisă: fereastra de subscriere spune că nu e
//      nicio rundă deschisă, „Continuă” e blocat, fără tickete;
//   C. rundă publică (cifre DE TEST, nu cele reale): secțiunea Seed arată
//      numele, ținta, prețul, procentul, ticketele, progresul doar cu
//      afiseaza_progres; textul fără rundă dispare; fără depășiri pe orizontală;
//   D. investitor, cu rundă deschisă: ticketele, minimul și instrumentele vin
//      din rundă; suma sub minim e refuzată de server și mesajul apare roșu,
//      valoarea rămâne; o sumă validă trimite { suma, instrument }.
// Supabase e blocat; /api e simulat prin page.route. Nimic nu ajunge în producție.
// Rulare: node scripts/test-runda-pagina.js

const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const UTILIZATOR = { id: '40000000-0000-4000-8000-0000000000d1', email: 'ion.test@example.com', email_confirmed_at: '2026-10-01T08:00:00Z', user_metadata: { prenume: 'Ion', nume: 'Test' } };

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
  ok: true, email: UTILIZATOR.email, nume: 'Ion Test', prenume: 'Ion', nume_familie: 'Test', telefon: '+40700000002', tara: 'RO',
  roles: ['client', 'investor'], roluri_dashboard: ['client'], destinatie: '/mydarrin-dashboard-client.html', tip_destinatie: 'rol', furnizor_propriu: false, partener: null,
  investitor: { status: 'in_verificare' },
};
const KYC = { ok: true, kyc: { status: 'in_verificare', submitted_at: '2026-10-20T10:00:00Z' }, lipsa: [], cont: { prenume: 'Ion', nume: 'Test', email: UTILIZATOR.email, telefon: '+40700000002', tara: 'RO' } };

// Rundă DE TEST — cifrele nu sunt ale rundei reale (LM le introduce din back-office).
const RUNDA_PUBLICA = {
  cod: 'test', denumire_ro: 'Runda de test', denumire_en: 'Test round', descriere_ro: 'Descriere de test.', descriere_en: 'Test description.',
  stare: 'deschisa', data_start: '2026-11-01', data_sfarsit: '2026-12-31', moneda: 'EUR', suma_tinta: 100000, investitie_minima: 5000,
  pret_actiune: 10, equity_oferit_pct: 10, post_money: 1000000, tickete: [5000, 10000], instrumente: ['actiuni', 'safe'],
};
const RUNDA_CONT = { id: 'r1', denumire_ro: 'Runda de test', denumire_en: 'Test round', moneda: 'EUR', suma_tinta: 100000, investitie_minima: 5000,
  pret_actiune: 10, equity_oferit_pct: 10, tickete: [5000, 10000], instrumente: ['actiuni', 'safe'] };
const portofoliu = (runda) => ({ ok: true, kyc_status: 'in_verificare', actiuni: 0, valoare_investita: 0, in_asteptare: 0, pct_companie: 0, subscrieri: [], runda,
  exit: { buyback_disponibil: false, discount_buyback_pct: null, lock_up_luni: null } });

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

async function context(browser, { lang, latime, cuSesiune = false, rundaCurenta, rundaCont = null, subscrieri = null }) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: 860 } });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('myd_lang_v1', l);
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
    } catch (e) {}
  }, lang);
  await ctx.addInitScript(sesiuneSimulata, { user: UTILIZATOR, cuSesiune });
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  const raspunde = (r, cod, corp) => r.fulfill({ status: cod, contentType: 'application/json', body: JSON.stringify(corp) });
  await ctx.route(/\/api\/public\/runda-curenta/, (r) => (rundaCurenta === 500 ? raspunde(r, 500, { error: 'x' }) : raspunde(r, 200, { ok: true, runda: rundaCurenta })));
  await ctx.route(/\/api\/cont\/profil/, (r) => raspunde(r, cuSesiune ? 200 : 401, cuSesiune ? PROFIL : { error: 'Neautentificat' }));
  await ctx.route(/\/api\/investitori\/kyc(\?|$)/, (r) => raspunde(r, 200, KYC));
  await ctx.route(/\/api\/investitori\/portofoliu/, (r) => raspunde(r, 200, portofoliu(rundaCont)));
  await ctx.route(/\/api\/investitori\/indicatori/, (r) => raspunde(r, 403, { cod: 'KYC_NEAPROBAT', error: 'Indicatorii financiari sunt disponibili după aprobarea verificării identității tale.', error_en: 'The financial indicators are available after your identity verification is approved.' }));
  await ctx.route(/\/api\/investitori\/subscrie/, (r) => {
    const c = JSON.parse(r.request().postData() || '{}');
    if (subscrieri) subscrieri.push(c);
    if (c.suma < 5000) return raspunde(r, 400, { cod: 'SUMA_SUB_MINIM', error: 'Suma e sub investiția minimă a rundei (5.000 EUR).', error_en: 'The amount is below the round minimum (5,000 EUR).' });
    return raspunde(r, 200, { ok: true, portofoliu: { id: 's1', status: 'in_asteptare' }, actiuni: Math.floor(c.suma / 10), moneda: 'EUR', procent_estimat: 1, kyc_status: 'in_verificare' });
  });
  return ctx;
}

async function depaseste(p) {
  return p.evaluate(() => {
    const W = document.documentElement.clientWidth;
    let max = document.documentElement.scrollWidth;
    document.querySelectorAll('#runda *, #modal-runda *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > max && getComputedStyle(el).visibility !== 'hidden') max = r.right;
    });
    return max > W + 1 ? Math.round(max) : 0;
  });
}

async function romanaInEn(p, lang, sel) {
  if (lang !== 'en') return '';
  const t = await p.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);
  const m = t.match(/[^\n]*[ăâîșțşţĂÂÎȘȚ][^\n]*/);
  return m ? m[0].slice(0, 120) : '';
}

async function deschidePagina(ctx, baza) {
  const p = await ctx.newPage();
  const erori = []; p.on('pageerror', (e) => erori.push(e.message));
  await p.goto(baza + '/mydarrin-investitori', { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(300);
  return { p, erori };
}

async function deschideSubscrierea(p) {
  await p.waitForFunction(() => !!window.MYD_INVESTITOR, null, { timeout: 8000 }).catch(() => {});
  await p.focus('#runda button');
  await p.keyboard.press('Enter');
  await p.waitForSelector('#step-2', { state: 'visible', timeout: 6000 }).catch(() => {});
  await p.waitForFunction(() => !/…|\.\.\./.test((document.getElementById('ticket-lista') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
}

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const lang of ['ro', 'en']) {
      for (const latime of [390, 1366]) {
        const et = `${lang} ${latime}px`;

        // ── A. fără rundă publică ──
        for (const varianta of [null, 500]) {
          const ctx = await context(browser, { lang, latime, rundaCurenta: varianta });
          const { p, erori } = await deschidePagina(ctx, baza);
          const n = varianta === 500 ? 'eroare 500' : 'runda null';
          verifica(await p.isVisible('#runda-fara-date'), `${et} A (${n}): textul fără rundă e vizibil`);
          verifica(await p.$eval('[data-runda]', (e) => e.hidden), `${et} A (${n}): [data-runda] rămâne ascuns`);
          verifica(!erori.length, `${et} A (${n}): 0 erori JS (${erori.join(' | ')})`);
          await ctx.close();
        }

        // ── B. investitor, fără rundă deschisă ──
        {
          const ctx = await context(browser, { lang, latime, cuSesiune: true, rundaCurenta: null, rundaCont: null });
          const { p, erori } = await deschidePagina(ctx, baza);
          await deschideSubscrierea(p);
          const info = await p.textContent('#runda-subscriere-info').catch(() => '');
          verifica(lang === 'ro' ? /nicio rundă de finanțare deschisă/.test(info) : /no open funding round/.test(info), `${et} B: fereastra spune că nu e nicio rundă deschisă („${info}”)`);
          verifica(await p.$eval('#step-2 button[onclick="goStep(3)"]', (b) => b.disabled), `${et} B: „Continuă” e blocat`);
          verifica((await p.$$('#step-2 .ticket-opt')).length === 0, `${et} B: fără tickete`);
          verifica(!erori.length, `${et} B: 0 erori JS (${erori.join(' | ')})`);
          await ctx.close();
        }

        // ── C. rundă publică (secțiunea Seed) ──
        for (const progres of [false, true]) {
          const runda = Object.assign({}, RUNDA_PUBLICA, progres ? { progres: { stranse: 25000, pct: 25 } } : {});
          const ctx = await context(browser, { lang, latime, rundaCurenta: runda });
          const { p, erori } = await deschidePagina(ctx, baza);
          const n = progres ? 'cu progres' : 'fără progres';
          verifica(await p.isVisible('[data-runda]'), `${et} C (${n}): [data-runda] e vizibil`);
          verifica(!(await p.isVisible('#runda-fara-date')), `${et} C (${n}): textul fără rundă dispare`);
          const t = (await p.innerText('[data-runda]')).replace(/\s+/g, ' ');
          verifica(t.includes(lang === 'ro' ? 'Runda de test' : 'Test round'), `${et} C (${n}): numele rundei în limba paginii`);
          verifica(/100[.,\s]?000/.test(t) && /\b10 EUR\b/.test(t) && /10%/.test(t), `${et} C (${n}): ținta, prețul și procentul („${t.slice(0, 200)}”)`);
          verifica(/5[.,\s]?000 EUR · 10[.,\s]?000 EUR/.test(t), `${et} C (${n}): ticketele sugerate`);
          verifica(progres === /25%/.test(t), `${et} C (${n}): progresul apare doar cu afiseaza_progres`);
          { const r = await romanaInEn(p, lang, '#runda'); verifica(!r, `${et} C (${n}): fără text românesc în EN (${r})`); }
          const d = await depaseste(p); verifica(!d, `${et} C (${n}): fără depășire pe orizontală (${d})`);
          verifica(!erori.length, `${et} C (${n}): 0 erori JS (${erori.join(' | ')})`);
          await ctx.close();
        }

        // ── D. investitor, cu rundă deschisă: fereastra de subscriere ──
        {
          const subscrieri = [];
          const ctx = await context(browser, { lang, latime, cuSesiune: true, rundaCurenta: RUNDA_PUBLICA, rundaCont: RUNDA_CONT, subscrieri });
          const { p, erori } = await deschidePagina(ctx, baza);
          await deschideSubscrierea(p);
          const sume = await p.$$eval('#step-2 .ticket-opt[data-suma]', (els) => els.map((e) => e.getAttribute('data-suma')));
          verifica(JSON.stringify(sume) === JSON.stringify(['5000', '10000', 'custom']), `${et} D: ticketele din rundă (${sume})`);
          const instr = await p.$$eval('#instrument-lista .instrument-opt', (els) => els.map((e) => e.textContent.trim()));
          verifica(JSON.stringify(instr) === JSON.stringify(lang === 'ro' ? ['Acțiuni', 'SAFE'] : ['Shares', 'SAFE']), `${et} D: instrumentele din rundă (${instr})`);
          const ph = await p.getAttribute('#custom-ticket', 'placeholder');
          verifica(/5[.,\s]?000 EUR/.test(ph) && !/25/.test(ph), `${et} D: minimul din rundă în câmpul de sumă („${ph}”)`);
          const info = await p.textContent('#runda-subscriere-info');
          verifica(/10 EUR/.test(info), `${et} D: prețul pe acțiune din rundă („${info}”)`);
          { const r = await romanaInEn(p, lang, '#step-2'); verifica(!r, `${et} D: fereastra fără text românesc în EN (${r})`); }
          { const d = await depaseste(p); verifica(!d, `${et} D: fără depășire pe orizontală (${d})`); }
          // sumă sub minim: refuzată de server, mesaj roșu, valoarea rămâne
          await p.click('#custom-ticket');
          await p.fill('#custom-ticket', '1000');
          await p.click('[onclick*="selectInstrument(this,\'safe\')"]');
          await p.click('#step-2 button[onclick="goStep(3)"]');
          await p.check('#nda-check');
          await p.click('#submit-invest-btn');
          await p.waitForFunction(() => /✕|minim/i.test(document.getElementById('submit-invest-msg').textContent), null, { timeout: 5000 }).catch(() => {});
          const msg = await p.textContent('#submit-invest-msg');
          verifica(lang === 'ro' ? /investiția minimă/.test(msg) : /round minimum/.test(msg), `${et} D: suma sub minim → mesajul serverului („${msg.trim()}”)`);
          verifica(!(await p.isVisible('#step-4')), `${et} D: fără confirmare falsă`);
          // sumă validă
          await p.evaluate(() => goStep(2));
          await p.click('#step-2 .ticket-opt >> nth=1');
          await p.evaluate(() => goStep(3));
          await p.click('#submit-invest-btn');
          await p.waitForSelector('#step-4', { state: 'visible', timeout: 6000 }).catch(() => {});
          const ultima = subscrieri[subscrieri.length - 1] || {};
          verifica(subscrieri[0] && subscrieri[0].suma === 1000, `${et} D: prima cerere a trimis suma introdusă`);
          verifica(ultima.suma === 10000 && ultima.instrument === 'safe' && !('actiuni' in ultima), `${et} D: se trimit doar suma și instrumentul (${JSON.stringify(ultima)})`);
          verifica((await p.textContent('#confirm-actiuni')).replace(/\D/g, '') === '1000', `${et} D: acțiunile din confirmare vin de la server`);
          verifica(!erori.length, `${et} D: 0 erori JS (${erori.join(' | ')})`);
          await ctx.close();
        }
        console.log(`${et}: gata`);
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
