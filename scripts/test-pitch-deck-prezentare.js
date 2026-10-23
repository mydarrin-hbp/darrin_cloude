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

async function pagina(browser, baza, { lang, w, h, tok = null, reducere = false, hash = '', init = null, atingere = w < 1024 || h > w, ceas = false, ctxExistent = null }) {
  let ctx = ctxExistent;
  if (!ctx) {
    ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: atingere, reducedMotion: reducere ? 'reduce' : 'no-preference' });
    await ctx.addInitScript((l) => {
      try {
        if (!localStorage.getItem('myd_lang_v1')) localStorage.setItem('myd_lang_v1', l);
        localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
      } catch (e) {}
    }, lang);
    await ctx.addInitScript(sesiune, tok);
    if (init) await ctx.addInitScript(init);
    await ruteaza(ctx);
  }
  const pg = await ctx.newPage();
  pg.erori = [];
  pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 200)));
  if (ceas) await pg.clock.install({ time: new Date('2026-10-23T10:00:00Z') });
  await pg.goto(baza + '/mydarrin-pitch-deck' + hash, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => document.querySelector('#pd-deck .mdpd-slide.mdpd-activ'), null, { timeout: 10000, polling: 100 }).catch(() => {});
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

// ═══ E. Ecran complet ══════════════════════════════════════════════
// Browser fără Fullscreen API (ca pe iPhone).
function faraFullscreen() {
  delete Element.prototype.requestFullscreen; delete Element.prototype.webkitRequestFullscreen;
  Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => false });
}
async function stareEcran(pg) {
  return pg.evaluate(() => {
    const sc = document.getElementById('pd-deck'), c = sc.querySelector('.pdp-cadru').getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    const jos = sc.querySelector('.pdp-fs-jos'), x = sc.querySelector('[data-fs="iesire"]');
    return {
      activ: sc.classList.contains('pdp-ecran'), simulat: sc.classList.contains('pdp-simulat'), real: document.fullscreenElement === sc,
      bare: [Math.round(c.left), Math.round(W - c.right), Math.round(c.top), Math.round(H - c.bottom)], raport: c.width / c.height,
      controale: getComputedStyle(jos).opacity === '1' && !!jos.getBoundingClientRect().width, iesire: !!x.getBoundingClientRect().width && getComputedStyle(x.parentElement).opacity === '1',
      contor: sc.querySelector('.pdp-fs-contor').textContent, slide: document.querySelector('#pd-deck .mdpd-activ').dataset.nr,
      bara: getComputedStyle(document.querySelector('.pd-top')).display, roteste: !sc.querySelector('.pdp-roteste').hidden,
    };
  });
}
async function alegeMod(pg, mod) {
  await pg.click('#pd-prezinta');
  await pg.click(`.pdp-meniu [data-mod="${mod}"]`);
  await pg.waitForTimeout(250);
}

async function testEcran(browser, baza) {
  for (const lang of ['ro', 'en']) {
    for (const [w, h] of LATIMI) {
      for (const fara of [false, true]) {
        const et = `E ${lang} ${w}×${h}${fara ? ' fără Fullscreen API' : ''}`;
        reset();
        const { ctx, pg } = await pagina(browser, baza, { lang, w, h, hash: '#slide-3', init: fara ? faraFullscreen : null });
        await alegeMod(pg, 'ecran');
        let s = await stareEcran(pg);
        verifica(s.activ && (fara ? s.simulat && !s.real : s.real), `${et}: intră în ecran complet ${fara ? 'simulat' : 'real'} (${JSON.stringify(s)})`);
        verifica(s.contor === '3 / 20' && s.slide === '3' && s.controale && s.iesire, `${et}: controalele vizibile, „3 / 20” (${s.contor})`);
        if (w > 720) verifica(Math.abs(s.bare[0] - s.bare[1]) <= 1 && Math.abs(s.bare[2] - s.bare[3]) <= 1 && Math.abs(s.raport - 16 / 9) < 0.01, `${et}: slide-ul 16:9 centrat, bare egale (${s.bare}, ${s.raport.toFixed(3)})`);
        if (fara) verifica(s.bara === 'none', `${et}: bara de sus ascunsă în modul simulat`);
        verifica(s.roteste === (w < 768 && h > w), `${et}: mesajul „Rotește telefonul” ${w < 768 && h > w ? 'afișat' : 'absent'}`);
        const g = await geometrie(pg, '.pdp-fs-btn:not([hidden]), .pdp-fs-contor, .pdp-roteste:not([hidden])');
        verifica(!g, `${et}: controalele în ecran, fără suprapuneri (${g})`);
        if (lang === 'ro' && [1440, 390, 844].includes(w)) await captura(pg, `ecran-${w}x${h}${fara ? '-simulat' : ''}`);
        if (s.roteste) {
          await pg.click('[data-fs="roteste"]');
          verifica(!(await stareEcran(pg)).roteste, `${et}: mesajul de rotire se închide`);
        }
        // Navigarea în ecran complet, apoi controalele dispar după 2,5 s și revin la mișcare.
        await pg.keyboard.press('ArrowRight');
        await pg.waitForTimeout(2800);
        s = await stareEcran(pg);
        verifica(s.slide === '4' && s.contor === '4 / 20' && !s.controale, `${et}: → slide 4; controalele ascunse după 2,5 s (${s.contor}, ${s.controale})`);
        await pg.mouse.move(w / 2, h / 2); await pg.mouse.move(w / 2 + 20, h / 2 + 10);
        await pg.waitForTimeout(350);
        verifica((await stareEcran(pg)).controale, `${et}: controalele revin la mișcare`);
        // Ieșirea: X (și Escape în modul simulat), slide-ul rămâne.
        if (fara) await pg.keyboard.press('Escape'); else await pg.click('[data-fs="iesire"]');
        await pg.waitForTimeout(300);
        s = await stareEcran(pg);
        verifica(!s.activ && !s.real && s.slide === '4' && s.bara !== 'none', `${et}: ieșire cu ${fara ? 'Escape' : 'X'}, slide-ul 4 păstrat (${JSON.stringify({ a: s.activ, s: s.slide })})`);
        if (fara) {
          await alegeMod(pg, 'ecran');
          await pg.click('[data-fs="iesire"]');
          await pg.waitForTimeout(200);
          s = await stareEcran(pg);
          verifica(!s.activ && s.slide === '4', `${et}: ieșire cu X din modul simulat`);
        }
        verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
        await ctx.close();
      }
    }
    console.log(`E ${lang}: gata`);
  }
}

// ═══ P. Vederea prezentatorului ════════════════════════════════════
const NOTA = { ro: NOTE_TEST.ro[2], en: NOTE_TEST.en[2] };
const FARA_NOTE = { ro: 'Fără note pentru acest slide', en: 'No notes for this slide' };
const MOTIV = { ro: { admin: 'Disponibilă pentru administratori', ecran: 'Necesită un ecran mai mare sau orientare orizontală' }, en: { admin: 'Available to administrators', ecran: 'Requires a larger screen or landscape orientation' } };
const titluSlide = (lang, nr) => (lang === 'ro' ? RO : EN).slide_uri[nr - 1].titlu.replace(/\s*\{denumire\}/, '');

async function optiunePrezentator(pg) {
  await pg.waitForFunction(() => !/Se verifică|Checking/.test(document.querySelector('.pdp-meniu') ? document.querySelector('.pdp-meniu').textContent : ''), null, { timeout: 6000 }).catch(() => {});
  await pg.click('#pd-prezinta');
  await pg.waitForFunction(() => !/Se verifică|Checking/.test(document.querySelector('.pdp-meniu').textContent), null, { timeout: 6000 }).catch(() => {});
  return pg.evaluate(() => {
    const o = document.querySelector('.pdp-meniu [data-mod="prezentator"]');
    return { dezactivata: o.getAttribute('aria-disabled') === 'true', motiv: (o.querySelector('.pdp-motiv') || {}).textContent || '' };
  });
}
// Starea vederii prezentatorului (în fereastra ei sau pe același ecran).
async function stareVedere(p) {
  return p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? [b.left, b.top, b.right, b.bottom].map(Math.round) : null; };
    const pv = document.querySelector('.pdp-pv');
    if (!pv) return null;
    return {
      curent: Number((pv.querySelector('.pdp-pv-deck .mdpd-activ') || {}).dataset?.nr || 0),
      urmator: (pv.querySelector('.pdp-pv-urm-deck .mdpd-slide') || {}).getAttribute?.('aria-label') || '',
      final: !pv.querySelector('.pdp-pv-final').hidden,
      note: pv.querySelector('.pdp-pv-note-text').textContent, contor: pv.querySelector('.pdp-pv-contor').textContent,
      timp: pv.querySelector('.pdp-pv-timp').textContent, ora: pv.querySelector('.pdp-pv-ora').textContent,
      mini: pv.querySelectorAll('.pdp-pv-mini-btn').length, miniVizibile: !!r('.pdp-pv-mini'),
      zone: { cap: r('.pdp-pv-cap'), cur: r('.pdp-pv-curent'), urm: r('.pdp-pv-urm'), note: r('.pdp-pv-note'), nav: r('.pdp-pv-nav'), mini: r('.pdp-pv-mini') },
      latDeck: pv.querySelector('.pdp-pv-deck').getBoundingClientRect().width, latCurent: pv.querySelector('.pdp-pv-curent').getBoundingClientRect().width,
      W: window.innerWidth, H: window.innerHeight, scrollW: document.documentElement.scrollWidth,
    };
  });
}
function zoneSuprapuse(z) {
  const k = Object.keys(z).filter((x) => z[x]);
  const rau = [];
  for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) {
    const a = z[k[i]], b = z[k[j]];
    if (Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1) rau.push(k[i] + '/' + k[j]);
  }
  return rau.join(', ');
}
const slideMain = (pg) => pg.evaluate(() => Number(document.querySelector('#pd-deck .mdpd-activ').dataset.nr));
function faraBroadcast() { try { delete window.BroadcastChannel; } catch (e) { window.BroadcastChannel = undefined; } }

async function testPrezentator(browser, baza) {
  // Fereastra separată (desktop / laptop), cu BroadcastChannel și cu revenire pe postMessage.
  for (const lang of ['ro', 'en']) {
    for (const [w, h, faraBC] of [[1440, 900, false], [1280, 800, false], [1440, 900, true]]) {
      const et = `P ${lang} ${w}×${h}${faraBC ? ' fără BroadcastChannel' : ''}`;
      reset();
      const { ctx, pg } = await pagina(browser, baza, { lang, w, h, tok: 'tok-sup', hash: '#slide-1', init: faraBC ? faraBroadcast : null });
      const o = await optiunePrezentator(pg);
      verifica(!o.dezactivata && !o.motiv, `${et}: opțiunea activă pentru superadmin (${o.motiv})`);
      const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }), pg.click('.pdp-meniu [data-mod="prezentator"]')]);
      pop.erori = [];
      pop.on('pageerror', (e) => pop.erori.push(e.message.slice(0, 200)));
      await pop.setViewportSize({ width: w, height: h });
      await pop.waitForSelector('.pdp-pv', { timeout: 8000 }).catch(() => {});
      await pop.waitForTimeout(400);
      let v = await stareVedere(pop);
      verifica(!!v, `${et}: fereastra prezentatorului se deschide (${pop.url()})`);
      if (!v) { await ctx.close(); continue; }
      const aud = await stareEcran(pg);
      verifica(aud.activ, `${et}: fereastra publicului trece în ecran complet (${aud.real ? 'real' : 'simulat'})`);
      verifica(v.curent === 1 && v.contor === '1 / 20' && v.urmator.includes(titluSlide(lang, 2)), `${et}: slide-ul curent 1, următorul 2 (${v.contor}, „${v.urmator.slice(0, 60)}”)`);
      verifica(v.note === FARA_NOTE[lang], `${et}: „${FARA_NOTE[lang]}” pe slide-ul fără note („${v.note}”)`);
      verifica(v.mini === 20 && v.miniVizibile, `${et}: banda cu cele 20 de miniaturi`);
      verifica(v.ora && /^\d{2}:\d{2}$/.test(v.ora) && /^\d{2}:\d{2}$/.test(v.timp), `${et}: ora curentă și cronometrul (${v.ora}, ${v.timp})`);
      // Layout: două coloane (curent | următor + note), fără suprapuneri.
      const z = v.zone;
      verifica(z.cur && z.urm && z.note && z.cur[2] <= z.urm[0] && z.cur[2] <= z.note[0] && z.urm[3] <= z.note[1], `${et}: două coloane — curent | următor + note (${JSON.stringify(z)})`);
      verifica(v.latDeck / v.W > 0.5, `${et}: slide-ul curent ~60 % din lățime (${Math.round(v.latDeck / v.W * 100)} %)`);
      const s = zoneSuprapuse(z); verifica(!s && v.scrollW <= v.W, `${et}: zonele nu se suprapun, fără derulare laterală (${s})`);
      if (lang === 'ro' && w === 1440 && !faraBC) await captura(pop, 'prezentator-1440x900');
      // Prezentatorul → publicul.
      await pop.keyboard.press('ArrowRight');
      await pop.waitForTimeout(300);
      v = await stareVedere(pop);
      verifica(await slideMain(pg) === 2 && v.curent === 2 && v.note === NOTA[lang], `${et}: → în prezentator: publicul pe slide-ul 2; nota slide-ului 2 („${v.note}”)`);
      // Publicul → prezentatorul.
      await pg.keyboard.press('ArrowRight');
      await pg.waitForTimeout(300);
      v = await stareVedere(pop);
      verifica(v.curent === 3 && v.contor === '3 / 20' && v.urmator.includes(titluSlide(lang, 4)), `${et}: → în fereastra publicului: prezentatorul pe 3, următorul 4 (${v.contor})`);
      // Miniatura 7, Home / End, Space.
      await pop.click('.pdp-pv-mini-btn[data-mergi="6"]');
      await pop.waitForTimeout(250);
      verifica(await slideMain(pg) === 7 && (await stareVedere(pop)).curent === 7, `${et}: clic pe miniatura 7 → ambele pe 7`);
      await pop.keyboard.press('End'); await pop.waitForTimeout(250);
      v = await stareVedere(pop);
      verifica(await slideMain(pg) === 20 && v.final, `${et}: End → 20, „${lang === 'ro' ? 'Sfârșitul prezentării' : 'End of the presentation'}”`);
      await pop.keyboard.press('Home'); await pop.keyboard.press(' '); await pop.waitForTimeout(250);
      verifica(await slideMain(pg) === 2, `${et}: Home, apoi Space → 2`);
      // B: ecran negru pe fereastra publicului.
      await pop.keyboard.press('b'); await pop.waitForTimeout(200);
      const negru = await pg.evaluate(() => { const n = document.querySelector('#pd-deck .pdp-negru'); const r = n.getBoundingClientRect(); return !n.hidden && r.width >= window.innerWidth - 1 && getComputedStyle(n).backgroundColor; });
      verifica(negru === 'rgb(0, 0, 0)' && !(await pop.isHidden('.pdp-pv-negru')), `${et}: B → ecranul publicului negru (${negru})`);
      await pop.keyboard.press('B'); await pop.waitForTimeout(200);
      verifica(await pg.evaluate(() => document.querySelector('#pd-deck .pdp-negru').hidden), `${et}: B din nou → slide-ul revine`);
      // Cronometrul: pauză / resetare.
      await pop.click('[data-pv="cron"]'); const t1 = (await stareVedere(pop)).timp; await pop.waitForTimeout(1200);
      verifica((await stareVedere(pop)).timp === t1, `${et}: cronometrul pe pauză (${t1})`);
      await pop.click('[data-pv="reset"]');
      verifica((await stareVedere(pop)).timp === '00:00', `${et}: cronometrul resetat`);
      // A− / A+
      const f0 = await pop.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pdp-pv-note-text')).fontSize));
      await pop.click('[data-pv="mare"]'); await pop.click('[data-pv="mare"]');
      const f1 = await pop.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pdp-pv-note-text')).fontSize));
      verifica(f1 > f0, `${et}: A+ mărește textul notelor (${f0} → ${f1})`);
      verifica(!pg.erori.length && !pop.erori.length, `${et}: 0 erori JS (${pg.erori.concat(pop.erori).join(' | ')})`);
      // Escape în prezentator: se închide, publicul rămâne pe slide.
      await Promise.all([pop.waitForEvent('close', { timeout: 4000 }).catch(() => {}), pop.keyboard.press('Escape').catch(() => {})]);
      verifica(pop.isClosed() && await slideMain(pg) === 2, `${et}: Escape închide fereastra prezentatorului, publicul rămâne pe 2`);
      await ctx.close();
    }
  }

  // Fereastra blocată de browser → mesaj clar și varianta pe un singur ecran.
  for (const lang of ['ro', 'en']) {
    const et = `P ${lang} 1440×900 fereastră blocată`;
    reset();
    const { ctx, pg } = await pagina(browser, baza, { lang, w: 1440, h: 900, tok: 'tok-cit', init: () => { window.open = () => null; } });
    const o = await optiunePrezentator(pg);
    verifica(!o.dezactivata, `${et}: opțiunea activă pentru adminul cu drept de citire pe Investitori`);
    await pg.click('.pdp-meniu [data-mod="prezentator"]');
    await pg.waitForTimeout(200);
    const d = await pg.evaluate(() => { const e = document.querySelector('.pdp-dialog'); return e ? e.textContent : ''; });
    verifica(/blocat|blocked/.test(d), `${et}: mesajul „fereastra a fost blocată” („${d.slice(0, 70)}”)`);
    await pg.click('.pdp-dialog .pdp-pv-primar');
    await pg.waitForTimeout(300);
    const v = await stareVedere(pg);
    verifica(v && v.curent === 1 && v.miniVizibile, `${et}: varianta pe un singur ecran, cu miniaturi pe desktop`);
    await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(200);
    verifica(await slideMain(pg) === 2 && (await stareVedere(pg)).curent === 2, `${et}: → mută și deck-ul din spate`);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
    verifica(!(await pg.$('.pdp-pv-ecran')) && (await pg.evaluate(() => document.activeElement.id)) === 'pd-prezinta', `${et}: Escape închide vederea, focusul revine pe buton`);
    verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
    await ctx.close();
  }

  // Tabletă landscape (atingere): pe același ecran; fără suprapuneri.
  for (const lang of ['ro', 'en']) {
    for (const [w, h] of [[1024, 768], [900, 600], [768, 560]]) {
      const et = `P ${lang} ${w}×${h} tabletă`;
      reset();
      const { ctx, pg } = await pagina(browser, baza, { lang, w, h, tok: 'tok-sup', atingere: true, hash: '#slide-2' });
      const o = await optiunePrezentator(pg);
      verifica(!o.dezactivata, `${et}: opțiunea activă (${o.motiv})`);
      await pg.click('.pdp-meniu [data-mod="prezentator"]');
      await pg.waitForTimeout(400);
      const v = await stareVedere(pg);
      verifica(v && !(await pg.$('.pdp-dialog')), `${et}: vederea pe același ecran, fără fereastră nouă`);
      if (!v) { await ctx.close(); continue; }
      const z = v.zone;
      verifica(v.curent === 2 && v.note === NOTA[lang] && v.urmator.includes(titluSlide(lang, 3)), `${et}: slide 2, nota lui, următorul 3`);
      verifica(z.cur[2] <= z.urm[0] && z.cur[3] <= z.note[1] && z.urm[3] <= z.note[1] && !v.miniVizibile, `${et}: curent sus-stânga, următor sus-dreapta, note jos (${JSON.stringify(z)})`);
      const s = zoneSuprapuse(z); verifica(!s && v.scrollW <= v.W, `${et}: fără suprapuneri (${s})`);
      const g = await geometrie(pg, '.pdp-pv-cap > *:not([hidden]):not(.pdp-pv-spatiu), .pdp-pv-nav .pdp-pv-btn');
      verifica(!g, `${et}: butoanele în ecran, fără suprapuneri (${g})`);
      const mici = await pg.evaluate(() => [...document.querySelectorAll('.pdp-pv .pdp-pv-btn:not([hidden])')].filter((b) => { const r = b.getBoundingClientRect(); return r.width && (r.width < 44 || r.height < 44); }).length);
      verifica(!mici, `${et}: ținte de atingere ≥ 44 px (${mici} mai mici)`);
      if (lang === 'ro' && w === 1024) await captura(pg, 'prezentator-1024x768');
      verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
      await ctx.close();
    }
  }

  // Cine NU are opțiunea: vizitator, admin fără drept, client (orice ecran); admin pe telefon / portrait.
  for (const lang of ['ro', 'en']) {
    for (const [w, h] of LATIMI) {
      for (const [cine, tok] of [['vizitator', null], ['admin fără drept', 'tok-adm'], ['client', 'tok-cli'], ['superadmin', 'tok-sup']]) {
        if (cine === 'superadmin' && ecranMareTest(w, h)) continue;
        if (cine !== 'vizitator' && cine !== 'superadmin' && w !== 1440) continue;
        const et = `P ${lang} ${w}×${h} ${cine}`;
        reset();
        const { ctx, pg } = await pagina(browser, baza, { lang, w, h, tok });
        const o = await optiunePrezentator(pg);
        const asteptat = cine === 'superadmin' ? MOTIV[lang].ecran : MOTIV[lang].admin;
        verifica(o.dezactivata && o.motiv === asteptat, `${et}: opțiunea dezactivată, „${asteptat}” (${o.motiv})`);
        await pg.$eval('.pdp-meniu [data-mod="prezentator"]', (e) => e.click());
        await pg.waitForTimeout(150);
        verifica(!(await pg.$('.pdp-pv')) && !(await pg.isHidden('.pdp-meniu')), `${et}: clicul nu deschide nimic, meniul rămâne`);
        verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
        await ctx.close();
      }
    }
  }

  // Vizibilitate restrânsă: superadminul (fără KYC) vede rezumatul; la prezentare publicul primește deck-ul complet.
  {
    const et = 'P en 1440×900 rezumat → complet';
    reset({ vizibilitate: 'investitori_aprobati' });
    const { ctx, pg } = await pagina(browser, baza, { lang: 'en', w: 1440, h: 900, tok: 'tok-sup', init: () => { window.open = () => null; } });
    const inainte = await pg.evaluate(() => document.querySelectorAll('#pd-deck .mdpd-slide').length);
    await optiunePrezentator(pg);
    await pg.click('.pdp-meniu [data-mod="prezentator"]');
    await pg.click('.pdp-dialog .pdp-pv-primar');
    await pg.waitForTimeout(300);
    const dupa = await pg.evaluate(() => document.querySelectorAll('#pd-deck .mdpd-slide').length);
    verifica(inainte === 4 && dupa === 20 && (await stareVedere(pg)).contor === '1 / 20', `${et}: ${inainte} → ${dupa} slide-uri`);
    verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
    await ctx.close();
  }
  console.log('P: gata');
}
function ecranMareTest(w, h) { return w >= 768 && w >= h && h >= 500; }

// ═══ R. Redarea automată (ceasul simulat) ══════════════════════════
const PANOU = { ro: { viteza: 'Viteza (pe slide)', bucla: 'Reia de la început la final', porneste: 'Pornește', pauza: 'Pauză', continua: 'Continuă' }, en: { viteza: 'Speed (per slide)', bucla: 'Start over at the end', porneste: 'Start', pauza: 'Pause', continua: 'Resume' } };
async function stareAuto(pg) {
  return pg.evaluate(() => {
    const g = document.querySelector('#pd-nav .pdp-auto'), p = document.querySelector('#pd-deck .pdp-progres');
    const b = g && g.querySelector('[data-auto="comuta"]');
    return { slide: Number(document.querySelector('#pd-deck .mdpd-activ').dataset.nr), vizibil: !!g && !g.hidden && !!g.getBoundingClientRect().width,
      buton: b ? b.getAttribute('aria-label') : '', viteza: g ? g.querySelector('.pdp-auto-viteza').textContent : '', progres: !!p && !p.hidden && !!p.getBoundingClientRect().width };
  });
}
async function deschidePanou(pg) {
  await pg.click('#pd-prezinta');
  await pg.click('.pdp-meniu [data-mod="auto"]');
  return pg.evaluate(() => {
    const p = document.querySelector('.pdp-meniu .pdp-panou');
    return { vizibil: !!p && !p.hidden, text: p ? p.textContent : '', viteze: [...p.querySelectorAll('[data-viteza]')].map((b) => [b.textContent, b.getAttribute('aria-checked')]),
      bucla: p.querySelector('[data-bucla]').checked, exp: document.querySelector('.pdp-meniu [data-mod="auto"]').getAttribute('aria-expanded') };
  });
}
// Avansează ceasul simulat în pași de 100 ms până la slide-ul `nr`; întoarce timpul (ms) sau -1.
async function panaLa(pg, nr, max) {
  for (let t = 0; t <= max; t += 100) {
    if ((await stareAuto(pg)).slide === nr) return t;
    await pg.clock.runFor(100);
  }
  return -1;
}
async function pornesteAuto(pg, sec, bucla) {
  await deschidePanou(pg);
  await pg.click(`.pdp-panou [data-viteza="${sec}"]`);
  if (bucla) await pg.check('.pdp-panou [data-bucla]');
  await pg.click('.pdp-panou [data-porneste]');
}

async function testAuto(browser, baza) {
  for (const lang of ['ro', 'en']) {
    const A = PANOU[lang];
    for (const [w, h] of LATIMI) {
      const et = `R ${lang} ${w}×${h}`;
      reset();
      const { ctx, pg } = await pagina(browser, baza, { lang, w, h, hash: '#slide-1', ceas: true });
      await pg.clock.runFor(1500);
      // Panoul: vitezele 5 / 10 / 15 / 30 / 60 s (implicit 10 s), bifa oprită, „Pornește”.
      const p = await deschidePanou(pg);
      verifica(p.vizibil && p.exp === 'true' && JSON.stringify(p.viteze) === JSON.stringify([['5 s', 'false'], ['10 s', 'true'], ['15 s', 'false'], ['30 s', 'false'], ['60 s', 'false']]) && !p.bucla && p.text.includes(A.viteza) && p.text.includes(A.bucla) && p.text.includes(A.porneste),
        `${et}: panoul (${JSON.stringify(p.viteze)}, bifa ${p.bucla})`);
      const g = await geometrie(pg, '.pdp-meniu, .pdp-opt, .pdp-panou [data-viteza], .pdp-bifa, .pdp-porneste');
      verifica(!g, `${et}: panoul complet în ecran, fără suprapuneri (${g})`);
      if (lang === 'ro' && [1440, 390].includes(w)) await captura(pg, `auto-panou-${w}x${h}`);
      if (TELEFON(w, h) || w < 1024 || h > w) {
        const mici = await pg.evaluate(() => [...document.querySelectorAll('.pdp-panou [data-viteza], .pdp-panou .pdp-bifa, .pdp-panou [data-porneste]')].filter((b) => b.getBoundingClientRect().height < 40).length);
        verifica(!mici, `${et}: ținte de atingere în panou (${mici} prea mici)`);
      }
      await pg.click('.pdp-panou [data-viteza="5"]');
      await pg.click('.pdp-panou [data-porneste]');
      let s = await stareAuto(pg);
      verifica(s.vizibil && s.progres && s.viteza === '5 s' && s.buton === A.pauza && (await pg.isHidden('.pdp-meniu')), `${et}: pornește — bara de progres, „5 s”, butonul „${A.pauza}” (${JSON.stringify(s)})`);
      const ga = await geometrie(pg, '#pd-nav > *:not([hidden]), #pd-nav .pdp-auto > *');
      verifica(!ga, `${et}: controalele redării în bară, fără suprapuneri (${ga})`);
      if (TELEFON(w, h) || w < 1024) {
        const mici = await pg.evaluate(() => [...document.querySelectorAll('#pd-nav .pdp-auto button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length);
        verifica(!mici, `${et}: butoanele redării ≥ 44 × 44 px`);
      }
      // Timpul pe slide pornește după animații: la 5,1 s încă pe 1; apoi avansează.
      let t = await panaLa(pg, 2, 12000);
      verifica(t > 5100 && t <= 11100, `${et}: avansează la slide-ul 2 după 5 s + animațiile (${t} ms)`);
      t = await panaLa(pg, 3, 12000);
      verifica(t >= 5000 && t <= 11100, `${et}: avansează la slide-ul 3 (${t} ms)`);
      // Navigarea manuală → pauză.
      await pg.keyboard.press('ArrowRight');
      s = await stareAuto(pg);
      verifica(s.slide === 4 && s.buton === A.continua && s.vizibil, `${et}: navigarea manuală pune pe pauză (${s.buton})`);
      await pg.clock.runFor(30000);
      verifica((await stareAuto(pg)).slide === 4, `${et}: pe pauză nu mai avansează`);
      // Space: continuă / pauză.
      await pg.keyboard.press(' ');
      verifica((await stareAuto(pg)).buton === A.pauza, `${et}: Space → continuă`);
      t = await panaLa(pg, 5, 12000);
      verifica(t >= 5000, `${et}: după continuare avansează la 5 (${t} ms)`);
      await pg.keyboard.press(' ');
      verifica((await stareAuto(pg)).buton === A.continua, `${et}: Space → pauză`);
      // Deschiderea meniului → pauză; fila ascunsă → pauză.
      await pg.click('#pd-nav [data-auto="comuta"]');
      verifica((await stareAuto(pg)).buton === A.pauza, `${et}: butonul „${A.continua}” → rulează`);
      await pg.click('#pd-prezinta'); await pg.keyboard.press('Escape');
      verifica((await stareAuto(pg)).buton === A.continua, `${et}: deschiderea meniului pune pe pauză`);
      await pg.click('#pd-nav [data-auto="comuta"]');
      await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      verifica((await stareAuto(pg)).buton === A.continua, `${et}: fila ascunsă (visibilitychange) pune pe pauză`);
      await pg.evaluate(() => { delete document.hidden; });
      // Ultimul slide: se oprește (fără bifă).
      await pg.keyboard.press('End');
      await pg.click('#pd-nav [data-auto="comuta"]');
      await pg.clock.runFor(12000);
      s = await stareAuto(pg);
      verifica(s.slide === 20 && !s.vizibil && !s.progres, `${et}: la ultimul slide se oprește (${JSON.stringify(s)})`);
      // Cu „Reia de la început la final”: de la 20 la 1.
      await pornesteAuto(pg, 5, true);
      t = await panaLa(pg, 1, 12000);
      s = await stareAuto(pg);
      verifica(t >= 5000 && s.vizibil && s.buton === A.pauza, `${et}: cu bifa, de la 20 reia de la 1 (${t} ms)`);
      // Oprirea (X).
      await pg.click('#pd-nav [data-auto="opreste"]');
      verifica(!(await stareAuto(pg)).vizibil, `${et}: X oprește redarea`);
      verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
      // Viteza aleasă se ține minte pe dispozitiv.
      const { pg: pg2 } = await pagina(browser, baza, { lang, w, h, ctxExistent: ctx });
      const p2 = await deschidePanou(pg2);
      verifica(JSON.stringify(p2.viteze.find((x) => x[1] === 'true')) === JSON.stringify(['5 s', 'true']), `${et}: viteza 5 s ținută minte (${JSON.stringify(p2.viteze)})`);
      await ctx.close();
    }
    console.log(`R ${lang}: gata`);
  }

  // În ecran complet: controalele redării apar lângă „3 / 20”.
  for (const lang of ['ro', 'en']) {
    const et = `R ${lang} 1440×900 ecran complet`;
    reset();
    const { ctx, pg } = await pagina(browser, baza, { lang, w: 1440, h: 900, hash: '#slide-1', ceas: true });
    await pornesteAuto(pg, 10);
    await alegeMod(pg, 'ecran');
    // Deschiderea meniului (pentru ecranul complet) a pus redarea pe pauză: „▶ 10 s”, apoi continuă de aici.
    const r = await pg.evaluate(() => { const g = document.querySelector('.pdp-fs .pdp-auto'); return !!g && !g.hidden && g.textContent; });
    verifica(r === '▶10 s', `${et}: pauza / viteza „10 s” în controalele ecranului complet (${r})`);
    await pg.click('.pdp-fs [data-auto="comuta"]');
    const t = await panaLa(pg, 2, 17000);
    verifica(t >= 10000, `${et}: avansează în ecran complet (${t} ms)`);
    verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
    await ctx.close();
  }

  // prefers-reduced-motion: fără animații de tranziție, redarea merge (timpul pornește imediat).
  for (const lang of ['ro', 'en']) {
    const et = `R ${lang} 1280×800 mișcare redusă`;
    reset();
    const { ctx, pg } = await pagina(browser, baza, { lang, w: 1280, h: 800, hash: '#slide-1', ceas: true, reducere: true });
    await pornesteAuto(pg, 5);
    await pg.clock.runFor(4900);
    verifica((await stareAuto(pg)).slide === 1, `${et}: la 4,9 s încă pe 1`);
    await pg.clock.runFor(200);
    const r = await pg.evaluate(() => ({ slide: Number(document.querySelector('#pd-deck .mdpd-activ').dataset.nr), tranzitii: [...document.querySelectorAll('#pd-deck .mdpd-activ .mdpd-a')].every((e) => getComputedStyle(e).transitionDuration === '0s' && getComputedStyle(e).opacity === '1') }));
    verifica(r.slide === 2 && r.tranzitii, `${et}: la 5,1 s pe slide-ul 2, fără tranziții (${JSON.stringify(r)})`);
    verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
    await ctx.close();
  }
  console.log('R: gata');
}

// ═══ V. Responsive și aliniere (2.6) ═══════════════════════════════
async function testResponsive(browser, baza) {
  const fs = require('fs');
  const css = fs.readFileSync(path.join(RADACINA, 'pitch-deck.css'), 'utf8'), html = fs.readFileSync(path.join(RADACINA, 'mydarrin-pitch-deck.html'), 'utf8');
  verifica(/viewport-fit=cover/.test(html) && ['top', 'right', 'bottom', 'left'].every((k) => css.includes('safe-area-inset-' + k) || html.includes('safe-area-inset-' + k)), 'V: zonele sigure (viewport-fit=cover, env(safe-area-inset-*))');
  for (const lang of ['ro', 'en']) {
    for (const [w, h] of LATIMI) {
      const et = `V ${lang} ${w}×${h}`;
      reset();
      const { ctx, pg } = await pagina(browser, baza, { lang, w, h, ceas: true });
      await pornesteAuto(pg, 10);
      await pg.keyboard.press(' '); // pe pauză: controalele rămân, nimic nu se mișcă
      const r = await pg.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const tinte = [...document.querySelectorAll('.pd-top a, .pd-top button:not([hidden]), .pd-top select, #pd-nav button')].filter((e) => e.getBoundingClientRect().width && !e.closest('[hidden]'));
        const texte = [...document.querySelectorAll('.pd-top a, .pd-top button, .pd-top select, #pd-nav button, #pd-contor, .pdp-auto-viteza')].filter((e) => e.getBoundingClientRect().width && !e.closest('[hidden]'));
        const top = document.querySelector('.pd-top').getBoundingClientRect(), nav = document.getElementById('pd-nav').getBoundingClientRect();
        return {
          scroll: document.documentElement.scrollWidth - W,
          mici: tinte.filter((e) => { const b = e.getBoundingClientRect(); return b.width < 44 || b.height < 44; }).map((e) => (e.id || e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + '×' + Math.round(e.getBoundingClientRect().height)),
          font: texte.map((e) => [(e.id || e.className || e.tagName), parseFloat(getComputedStyle(e).fontSize)]).filter((x) => x[1] < 14),
          inaltimi: [...document.querySelectorAll('.pd-top > :not([hidden]):not(.pd-spatiu):not(.pd-titlu)')].filter((e) => e.tagName !== 'A' || window.innerWidth < 1024 || window.innerHeight < 500).map((e) => Math.round(e.getBoundingClientRect().height)),
          navCentru: [...document.querySelectorAll('#pd-nav > :not([hidden]):not(.pd-bara)')].map((e) => { const b = e.getBoundingClientRect(); return Math.round(b.top + b.height / 2); }),
          top: [top.left, top.right], nav: [nav.left, nav.right],
          prez: (() => { const b = document.getElementById('pd-prezinta').getBoundingClientRect(); return b.width && b.right <= W + 0.5 && b.left >= 0; })(),
        };
      });
      verifica(r.scroll <= 0, `${et}: fără bară orizontală (${r.scroll} px în plus)`);
      verifica(r.prez, `${et}: butonul „Prezintă” vizibil, în ecran`);
      if (w < 1024 || h > w || h < 500) verifica(!r.mici.length, `${et}: ținte de atingere ≥ 44 × 44 px (${r.mici.join(', ')})`);
      if (TELEFON(w, h)) verifica(!r.font.length, `${et}: text ≥ 14 px pe telefon (${JSON.stringify(r.font)})`);
      verifica(new Set(r.inaltimi).size === 1, `${et}: controalele din bara de sus au aceeași înălțime (${r.inaltimi})`);
      verifica(Math.max(...r.navCentru) - Math.min(...r.navCentru) <= 1, `${et}: bara de jos aliniată pe mijloc (${r.navCentru})`);
      const g1 = await geometrie(pg, '.pd-top > :not([hidden]):not(.pd-spatiu)');
      const g2 = await geometrie(pg, '#pd-nav > :not([hidden]), #pd-nav .pdp-auto > *');
      verifica(!g1 && !g2, `${et}: nimic suprapus sau în afara ecranului (${g1} ${g2})`);
      if (lang === 'ro' && [390, 360, 768].includes(w)) await captura(pg, `bara-${w}x${h}`);
      verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
      await ctx.close();
    }
    console.log(`V ${lang}: gata`);
  }
}

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    if (!process.env.DOAR || process.env.DOAR === 'M') await testMeniu(browser, baza);
    if (!process.env.DOAR || process.env.DOAR === 'E') await testEcran(browser, baza);
    if (!process.env.DOAR || process.env.DOAR === 'P') await testPrezentator(browser, baza);
    if (!process.env.DOAR || process.env.DOAR === 'R') await testAuto(browser, baza);
    if (!process.env.DOAR || process.env.DOAR === 'V') await testResponsive(browser, baza);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
