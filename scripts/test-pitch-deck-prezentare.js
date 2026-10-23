// scripts/test-pitch-deck-prezentare.js
// Pasul 11-K3 (23 oct. 2026): modurile de prezentare ale pitch deck-ului, în
// browser (Playwright), RO + EN, cu handler-ele reale peste Supabase-ul
// simulat (scripts/supabase-simulat.js). Nimic nu ajunge la producție.
//   M. meniul „▶ Prezintă”: exact 3 opțiuni (fără „Prezintă și înregistrează”),
//      textele RO / EN, dropdown (desktop, tabletă landscape) sau foaie de jos
//      (tabletă portrait, telefon), tastatura și Escape, în ecran, fără suprapuneri;
//   (secțiunile următoare se adaugă la punctele 2.2–2.6)
// Lățimi: 1440×900, 1280×800, 1024×768, 768×1024, 390×844, 360×740, 844×390.
// Rulare: node scripts/test-pitch-deck-prezentare.js   (DOAR=M, CAPTURI=<folder>)

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

function stub(fisier, exp) {
  const p = require.resolve(path.join(RADACINA, fisier));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };
}
stub('lib/rate-limit.js', { checkRateLimit: async () => true });

const P = require(path.join(RADACINA, 'lib/pitch-deck.js'));
const apiPublic = require(path.join(RADACINA, 'api/public/pitch-deck.js'));
const apiAdmin = require(path.join(RADACINA, 'api/admin/pitch-deck.js'));
const RO = require(path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1.1-ro.json'));
const EN = require(path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1.1-en.json'));

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const CAPTURI = process.env.CAPTURI || '';
async function captura(pg, nume) { if (CAPTURI) await pg.screenshot({ path: path.join(CAPTURI, nume + '.png') }); }

const LATIMI = [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844], [360, 740], [844, 390]];
const TELEFON = (w, h) => w < 768 || h < 500;
const FOAIE = (w, h) => w < 768 || (h > w && w < 1024);

// ── Date: versiunile v1.1 aprobate (surse DE TEST), runda DE TEST ───
const RUNDA_TEST = { id: 'r-test', cod: 'test', denumire_ro: 'Seed (test)', denumire_en: 'Seed (test)', stare: 'deschisa', vizibila_public: true, moneda: 'EUR',
  evaluare_pre_money: 900000, suma_tinta: 100000, actiuni_existente: 900, investitie_minima: 1000, tickete: [5000, 10000], data_start: '2099-11-01', data_sfarsit: '2100-06-30', afiseaza_progres: false };
function versiuneAprobata(j, id, note) {
  const { slide_uri } = P.extrageNote(JSON.parse(JSON.stringify(j.slide_uri)));
  return { id, limba: j.meta.limba, titlu: 'Pitch deck ' + j.meta.versiune + ' · ' + j.meta.limba.toUpperCase(), sursa: j.meta.sursa, disclaimer: j.meta.disclaimer,
    slide_uri: slide_uri.map((s) => ({ ...(s.prognoza ? { ...s, sursa: 'Sursă DE TEST' } : s), ...(note && note[s.nr] ? { note_prezentator: note[s.nr] } : {}) })),
    note_verificare: [], aprobat: true, aprobat_la: '2026-10-22T10:00:00Z', creat_la: '2026-10-22T09:00:00Z' };
}
// Notele DE TEST (doar în teste; versiunile reale nu au note).
const NOTE_TEST = { ro: { 2: 'NOTĂ DE TEST · slide 2' }, en: { 2: 'TEST NOTE · slide 2' } };
function reset({ vizibilitate = 'public', note = true } = {}) {
  DB.tabele = {
    profiles: [
      { id: 'sup', email: 'super@example.com', roles: ['superadmin'] },
      { id: 'cit', email: 'citire@example.com', roles: ['admin'] },
      { id: 'adm', email: 'fara-drept@example.com', roles: ['admin'] },
      { id: 'cli', email: 'client@example.com', roles: ['client'] },
    ],
    admin_permissions: [{ admin_id: 'cit', sectiune: 'investitori', poate_scrie: false }],
    investitori_kyc: [], investitori_portofoliu: [], audit_log: [],
    backoffice_config: [
      { cheie: 'investitori_email', valoare: 'investor@example.com', sectiune: 'contact', tara_cod: 'ALL' },
      { cheie: 'pitch_deck_vizibilitate', valoare: vizibilitate, sectiune: 'investitori', tara_cod: 'ALL' },
    ],
    runde_finantare: [{ ...RUNDA_TEST }],
    pitch_deck_versiuni: [versiuneAprobata(RO, 'v-ro', note && NOTE_TEST.ro), versiuneAprobata(EN, 'v-en', note && NOTE_TEST.en)],
  };
  DB.coloane = {};
  DB.utilizatori = { 'tok-sup': { id: 'sup', email: 'super@example.com' }, 'tok-cit': { id: 'cit', email: 'citire@example.com' }, 'tok-adm': { id: 'adm', email: 'fara-drept@example.com' }, 'tok-cli': { id: 'cli', email: 'client@example.com' } };
  delete require.cache[require.resolve(path.join(RADACINA, 'lib/contact-platforma.js'))];
}

// Sesiunea simulată (Supabase): doar tokenul; drepturile le decide serverul simulat.
function sesiune(tok) {
  const fix = (n, v) => Object.defineProperty(window, n, { configurable: true, get: () => v, set: () => {} });
  fix('supabaseClient', { auth: { getSession: async () => ({ data: { session: tok ? { access_token: tok } : null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } });
}

async function ruteaza(ctx) {
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  await ctx.route(/\/lib\/supabaseClient\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await ctx.route(/\/api\/(public|admin)\/pitch-deck/, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    let corp = null; try { corp = JSON.parse(req.postData() || 'null'); } catch (e) { corp = null; }
    const res = raspuns();
    const api = url.pathname.includes('/admin/') ? apiAdmin : apiPublic;
    await api(cerere({ metoda: req.method(), token: (req.headers().authorization || '').replace('Bearer ', '') || null, body: corp, query: Object.fromEntries(url.searchParams) }), res);
    return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp || {}) });
  });
}

async function pagina(browser, baza, { lang, w, h, tok = null, reducere = false, hash = '', init = null }) {
  const atingere = w < 1024 || h > w;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: atingere, reducedMotion: reducere ? 'reduce' : 'no-preference' });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('myd_lang_v1', l);
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
    } catch (e) {}
  }, lang);
  await ctx.addInitScript(sesiune, tok);
  if (init) await ctx.addInitScript(init);
  await ruteaza(ctx);
  const pg = await ctx.newPage();
  pg.erori = [];
  pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 200)));
  await pg.goto(baza + '/mydarrin-pitch-deck' + hash, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => document.querySelector('#pd-deck .mdpd-slide.mdpd-activ'), null, { timeout: 10000 }).catch(() => {});
  return { ctx, pg };
}

// Elementele vizibile în afara ecranului, pagina derulată lateral, suprapuneri.
async function geometrie(pg, selector) {
  return pg.evaluate((sel) => {
    const W = document.documentElement.clientWidth, H = window.innerHeight;
    const rau = [];
    if (document.documentElement.scrollWidth > W + 1) rau.push('pagina se derulează lateral: ' + document.documentElement.scrollWidth);
    const vizibile = [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && getComputedStyle(e).visibility !== 'hidden'; });
    vizibile.forEach((e) => {
      const r = e.getBoundingClientRect();
      if (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > H + 1) rau.push('în afara ecranului: ' + (e.id || e.className || e.tagName) + ` [${[r.left, r.top, r.right, r.bottom].map(Math.round)}]`);
    });
    for (let i = 0; i < vizibile.length; i++) for (let j = i + 1; j < vizibile.length; j++) {
      const x = vizibile[i], y = vizibile[j];
      if (x.contains(y) || y.contains(x)) continue;
      const a = x.getBoundingClientRect(), b = y.getBoundingClientRect();
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 1 && oy > 1) rau.push(`suprapuse: ${x.className || x.id || x.tagName} / ${y.className || y.id || y.tagName}`);
    }
    return rau.slice(0, 4).join(' | ');
  }, selector);
}

const ASTEPTAT = {
  ro: { buton: '▶Prezintă', opt: [['Ecran complet', 'Prezintă pe tot ecranul'], ['Vedere prezentator', 'Vezi notele și slide-urile următoare'], ['Redare automată', 'Setează viteza de derulare automată']] },
  en: { buton: '▶Present', opt: [['Full screen', 'Present in full screen'], ['Presenter view', 'View notes and upcoming slides'], ['Autoplay', 'Set speed to automatically play']] },
};

// ═══ M. Meniul „▶ Prezintă” ════════════════════════════════════════
async function testMeniu(browser, baza) {
  for (const lang of ['ro', 'en']) {
    const A = ASTEPTAT[lang];
    for (const [w, h] of LATIMI) {
      const et = `M ${lang} ${w}×${h}`;
      reset();
      const { ctx, pg } = await pagina(browser, baza, { lang, w, h });
      const b = await pg.evaluate(() => {
        const e = document.getElementById('pd-prezinta');
        const r = e.getBoundingClientRect(), s = document.getElementById('pd-limba').getBoundingClientRect();
        return { text: e.textContent.replace(/\s/g, ''), vizibil: !!r.width, w: r.width, h: r.height, cy: r.top + r.height / 2, cyLimba: s.top + s.height / 2, hLimba: s.height,
          popup: e.getAttribute('aria-haspopup'), exp: e.getAttribute('aria-expanded'), font: parseFloat(getComputedStyle(e).fontSize) };
      });
      verifica(b.vizibil && b.text === A.buton, `${et}: butonul „${A.buton}” vizibil (${b.text})`);
      verifica(b.popup === 'menu' && b.exp === 'false', `${et}: aria-haspopup="menu", aria-expanded="false"`);
      if (w < 1024 || h > w) verifica(b.w >= 44 && b.h >= 44, `${et}: butonul ≥ 44 × 44 px (${Math.round(b.w)}×${Math.round(b.h)})`);
      if (TELEFON(w, h)) verifica(b.font >= 14, `${et}: textul butonului ≥ 14 px (${b.font})`);
      if (w > 560) verifica(Math.abs(b.cy - b.cyLimba) <= 1 && Math.abs(b.h - b.hLimba) <= 1, `${et}: butonul aliniat cu selectorul de limbă (centru ${b.cy} / ${b.cyLimba}, înălțime ${b.h} / ${b.hLimba})`);
      const g0 = await geometrie(pg, '.pd-top > *:not([hidden]):not(.pd-spatiu)');
      verifica(!g0, `${et}: bara de sus fără suprapuneri / ieșiri (${g0})`);

      await pg.click('#pd-prezinta');
      await pg.waitForTimeout(120);
      const m = await pg.evaluate(() => {
        const e = document.querySelector('.pdp-meniu');
        const r = e.getBoundingClientRect(), br = document.getElementById('pd-prezinta').getBoundingClientRect();
        const opt = [...e.querySelectorAll('[role="menuitem"]')];
        return { vizibil: !e.hidden && !!r.width, foaie: e.classList.contains('pdp-foaie'), r: [r.left, r.top, r.right, r.bottom], br: [br.left, br.top, br.right, br.bottom],
          w: r.width, exp: document.getElementById('pd-prezinta').getAttribute('aria-expanded'), text: e.textContent,
          opt: opt.map((o) => [o.querySelector('.pdp-titlu').textContent, o.querySelector('.pdp-desc').textContent, o.getBoundingClientRect().height, parseFloat(getComputedStyle(o.querySelector('.pdp-desc')).fontSize), o.querySelector('.pdp-ico svg').getBoundingClientRect().width]),
          focus: document.activeElement === opt[0], fundal: getComputedStyle(document.querySelector('.pdp-fundal')).backgroundColor, maner: !!document.querySelector('.pdp-maner').getBoundingClientRect().height };
      });
      verifica(m.vizibil && m.exp === 'true', `${et}: meniul se deschide (aria-expanded="true")`);
      verifica(m.opt.length === 3 && JSON.stringify(m.opt.map((o) => [o[0], o[1]])) === JSON.stringify(A.opt), `${et}: exact cele 3 opțiuni, în ordine (${m.opt.map((o) => o[0]).join(' · ')})`);
      verifica(!/înregistr|record/i.test(m.text), `${et}: fără „Prezintă și înregistrează” / „Present and record”`);
      verifica(m.focus, `${et}: focusul pe prima opțiune`);
      if (FOAIE(w, h)) {
        verifica(m.foaie && Math.round(m.r[0]) === 0 && Math.round(m.r[2]) === w && Math.round(m.r[3]) === h && m.maner, `${et}: foaie de jos pe toată lățimea, cu mâner (${m.r.map(Math.round)})`);
        verifica(m.fundal !== 'rgba(0, 0, 0, 0)', `${et}: fundalul estompat (${m.fundal})`);
        verifica(m.opt.every((o) => o[2] >= 48 && o[3] >= 15 && o[4] === 24), `${et}: rânduri ≥ 48 px, text ≥ 15 px, iconițe 24 px (${JSON.stringify(m.opt.map((o) => o.slice(2)))})`);
      } else {
        verifica(!m.foaie && m.r[1] >= m.br[3] && m.r[1] - m.br[3] <= 12 && Math.abs(m.r[2] - m.br[2]) <= 1, `${et}: dropdown ancorat sub buton, aliniat la dreapta (${m.r.map(Math.round)} / buton ${m.br.map(Math.round)})`);
        verifica(w >= 1024 ? Math.round(m.w) === 320 : m.w <= 320, `${et}: lățimea dropdown-ului (${Math.round(m.w)} px)`);
        verifica(m.opt.every((o) => o[2] >= 48), `${et}: rânduri ≥ 48 px`);
      }
      const g = await geometrie(pg, '.pdp-meniu, .pdp-opt');
      verifica(!g, `${et}: meniul complet în ecran, fără suprapuneri (${g})`);
      await captura(pg, `meniu-${lang}-${w}x${h}`);

      // Tastatura: ↓ / ↑ între opțiuni, Escape închide și întoarce focusul pe buton.
      await pg.keyboard.press('ArrowDown');
      const f1 = await pg.evaluate(() => document.activeElement.getAttribute('data-mod'));
      await pg.keyboard.press('ArrowUp'); await pg.keyboard.press('ArrowUp');
      const f2 = await pg.evaluate(() => document.activeElement.getAttribute('data-mod'));
      verifica(f1 === 'prezentator' && f2 === 'auto', `${et}: săgețile ↓ / ↑ mută focusul (${f1}, ${f2})`);
      const slideInainte = await pg.evaluate(() => document.querySelector('#pd-deck .mdpd-activ').dataset.nr);
      await pg.keyboard.press('Escape');
      const e = await pg.evaluate(() => ({ ascuns: document.querySelector('.pdp-meniu').hidden, focus: document.activeElement.id, exp: document.getElementById('pd-prezinta').getAttribute('aria-expanded'), slide: document.querySelector('#pd-deck .mdpd-activ').dataset.nr }));
      verifica(e.ascuns && e.focus === 'pd-prezinta' && e.exp === 'false' && e.slide === slideInainte, `${et}: Escape închide meniul și întoarce focusul pe buton (${JSON.stringify(e)})`);
      // Clic în afară închide.
      await pg.click('#pd-prezinta');
      await pg.mouse.click(4, Math.round(h / 2));
      verifica(await pg.evaluate(() => document.querySelector('.pdp-meniu').hidden), `${et}: clic în afară închide meniul`);
      verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
      await ctx.close();
    }
    console.log(`M ${lang}: gata`);
  }
}

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    if (!process.env.DOAR || process.env.DOAR === 'M') await testMeniu(browser, baza);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
