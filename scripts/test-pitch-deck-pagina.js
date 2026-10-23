// scripts/test-pitch-deck-pagina.js
// Pasul 11-K (22 oct. 2026), în browser (Playwright):
//   A. back-office („Investitori Admin” → „Pitch deck”), la 390 și 1366 px,
//      cu handler-ele reale peste Supabase-ul simulat: importul celor două
//      JSON-uri reale → câte o ciornă pe limbă, cu notele de verificare;
//      adminul doar cu citire nu vede butoanele de scriere;
//   (secțiunile următoare se adaugă la punctele 2.4–2.7)
//   0 erori JS, nimic în afara ecranului.
// Rulare: node scripts/test-pitch-deck-pagina.js

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

const FISIER_RO = path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1-ro.json');
const FISIER_EN = path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1-en.json');
const RO = require(FISIER_RO);
const EN = require(FISIER_EN);
const notePe = (j) => j.slide_uri.reduce((n, s) => n + (s.de_verificat || []).length, 0);

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

// Elemente care ies din ecran pe orizontală (sau pagina care se derulează lateral).
async function inAfaraEcranului(p, selector) {
  return p.evaluate((sel) => {
    const W = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > W + 1) return 'pagina: ' + document.documentElement.scrollWidth;
    const rau = [];
    document.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).visibility === 'hidden') return;
      // Elementele din containere derulabile (tabele) sau care își taie conținutul
      // (imaginea cu zoom lent) nu se numără: se măsoară containerul.
      for (let e = el.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if (o !== 'visible') return; }
      if (r.left < -1 || r.right > W + 1) rau.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.left) + '…' + Math.round(r.right));
    });
    return rau.slice(0, 3).join(', ');
  }, selector);
}

// ═══ A. Back-office ════════════════════════════════════════════════
const API = {
  '/api/admin/runde-finantare': require(path.join(RADACINA, 'api/admin/runde-finantare.js')),
  '/api/admin/investitori-dashboard': require(path.join(RADACINA, 'api/admin/investitori-dashboard.js')),
  '/api/admin/investitori-kyc': require(path.join(RADACINA, 'api/admin/investitori-kyc.js')),
  '/api/admin/investitori-aprobare': require(path.join(RADACINA, 'api/admin/investitori-aprobare.js')),
  '/api/admin/pitch-deck': require(path.join(RADACINA, 'api/admin/pitch-deck.js')),
};

function resetAdmin() {
  DB.tabele = {
    profiles: [
      { id: 'sup', email: 'super@example.com', roles: ['superadmin'] },
      { id: 'cit', email: 'citire@example.com', roles: ['admin'] },
    ],
    admin_permissions: [{ admin_id: 'cit', sectiune: 'investitori', poate_scrie: false }],
    runde_finantare: [], investitori_kyc: [], investitori_portofoliu: [], audit_log: [], pitch_deck_versiuni: [],
    backoffice_config: [
      { cheie: 'investitori_email', valoare: 'investor@example.com', sectiune: 'contact', tara_cod: 'ALL' },
      { cheie: 'pitch_deck_vizibilitate', valoare: 'investitori_aprobati', sectiune: 'investitori', tara_cod: 'ALL' },
    ],
  };
  DB.coloane = {};
  DB.implicite = { pitch_deck_versiuni: { aprobat: false, note_verificare: [], creat_la: '2026-10-22T10:00:00Z' } };
  DB.utilizatori = { 'tok-sup': { id: 'sup', email: 'super@example.com' }, 'tok-cit': { id: 'cit', email: 'citire@example.com' } };
}

function sesiuneAdmin(user) {
  const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
  const ses = { access_token: 'tok-' + user.id, user };
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: ses }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) },
    from: () => lant({ data: [], error: null, count: 0 }), rpc: () => lant({ data: null, error: null }), storage: { from: () => lant({ data: null, error: null }) }, channel: () => lant({}), removeChannel: () => {},
  };
  const auth = new Proxy({ getCurrentUser: async () => user, getUserRoles: async () => user.roles, hasRole: async () => true, enforceSuperadminBarrier: async () => true, performLogout: () => {} }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (n, v) => Object.defineProperty(window, n, { configurable: true, get: () => v, set: () => {} });
  fix('supabaseClient', client); fix('MyDarrinAuth', auth);
}

async function panouAdmin(browser, baza, latime, user) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: 900 } });
  await ctx.addInitScript(sesiuneAdmin, user);
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  await ctx.route(/\/api\//, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const api = API[url.pathname];
    if (!api) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    let corp = null; try { corp = JSON.parse(req.postData() || 'null'); } catch (e) { corp = null; }
    const res = raspuns();
    await api(cerere({ metoda: req.method(), token: (req.headers().authorization || '').replace('Bearer ', ''), body: corp, query: Object.fromEntries(url.searchParams) }), res);
    return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp || {}) });
  });
  const pg = await ctx.newPage();
  pg.erori = [];
  pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 200)));
  await pg.goto(baza + '/mydarrin-superadmin.html', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(500);
  await pg.evaluate(() => window.showPanel('investitori'));
  await pg.waitForFunction(() => !/Se încarcă/.test((document.getElementById('pd-tbody') || {}).textContent || 'Se încarcă'), null, { timeout: 8000 }).catch(() => {});
  return { ctx, pg };
}

// Fereastra de confirmare MDFeedback.confirma: butonul de confirmare e ultimul din dialog.
async function confirmaDialog(pg) {
  await pg.waitForSelector('[role="alertdialog"], [role="dialog"]', { timeout: 4000 }).catch(() => {});
  await pg.evaluate(() => {
    const d = [...document.querySelectorAll('[role="alertdialog"], [role="dialog"]')].pop();
    const b = d && [...d.querySelectorAll('button')].find((x) => !/Anulează/.test(x.textContent));
    if (b) b.click();
  });
}

async function testAdmin(browser, baza) {
  for (const latime of [390, 1366]) {
    const et = `A ${latime}px`;
    resetAdmin();
    {
      const { ctx, pg } = await panouAdmin(browser, baza, latime, { id: 'sup', email: 'super@example.com', roles: ['superadmin'] });
      verifica(await pg.isVisible('#pd-importa'), `${et}: butonul „Importă din fișier” e vizibil`);
      verifica(/Nicio versiune RO/.test(await pg.innerText('#pd-tbody')), `${et}: lista goală spune ce e de făcut`);
      await pg.setInputFiles('#pd-fisier', [FISIER_RO, FISIER_EN]);
      await pg.waitForFunction(() => /Ciornă creată/.test(document.getElementById('pd-import-msg').textContent), null, { timeout: 8000 }).catch(() => {});
      const msg = await pg.innerText('#pd-import-msg');
      verifica(msg.includes(`RO (${notePe(RO)} note de verificat)`) && msg.includes(`EN (${notePe(EN)} note de verificat)`), `${et}: mesajul importului („${msg}”)`);
      verifica(DB.tabele.pitch_deck_versiuni.length === 2 && DB.tabele.pitch_deck_versiuni.every((v) => v.aprobat === false), `${et}: două ciorne, niciuna aprobată`);
      await pg.waitForFunction(() => /Ciornă/.test(document.getElementById('pd-tbody').textContent), null, { timeout: 5000 }).catch(() => {});
      const ro = await pg.innerText('#pd-tbody');
      verifica(/Pitch deck v1 · RO/.test(ro) && new RegExp(`${notePe(RO)} nerezolvate`).test(ro) && /20 slide-uri/.test(ro), `${et}: rândul RO („${ro.replace(/\s+/g, ' ').slice(0, 200)}”)`);
      await pg.click('.pd-tab[data-limba="en"]');
      const en = await pg.innerText('#pd-tbody');
      verifica(/Pitch deck v1 · EN/.test(en) && !/· RO/.test(en), `${et}: fila EN arată doar versiunea EN`);
      verifica(await pg.isVisible('#pd-viz-select'), `${et}: superadminul vede selectorul de vizibilitate`);

      // ── Editorul (2.4) ──
      await pg.click('.pd-tab[data-limba="ro"]');
      const idRo = DB.tabele.pitch_deck_versiuni.find((v) => v.limba === 'ro').id;
      const idEn = DB.tabele.pitch_deck_versiuni.find((v) => v.limba === 'en').id;
      const rand = `[data-pd-id="${idRo}"]`;
      const butoaneRo = await pg.$$eval(`${rand} .pd-actiuni button`, (b) => b.map((x) => x.textContent));
      verifica(JSON.stringify(butoaneRo) === JSON.stringify(['Editează', 'Previzualizează', 'Aprobă', 'Duplică ca ciornă nouă']), `${et}: acțiunile ciornei (${butoaneRo.join(', ')})`);
      // Aprobarea cu note nerezolvate → refuzată, cu mesajul cerut
      await pg.click(`${rand} [data-pd-act="aproba"]`);
      await confirmaDialog(pg);
      await pg.waitForFunction(() => /Rezolvați notele de verificare înainte de aprobare/.test(document.getElementById('pd-import-msg').textContent), null, { timeout: 6000 }).catch(() => {});
      verifica(/Rezolvați notele de verificare înainte de aprobare/.test(await pg.innerText('#pd-import-msg')), `${et}: aprobarea cu note nerezolvate e refuzată („${(await pg.innerText('#pd-import-msg')).slice(0, 120)}”)`);
      verifica(DB.tabele.pitch_deck_versiuni.every((v) => !v.aprobat), `${et}: nimic aprobat`);
      // Editorul: câmpurile tipurilor, notele
      await pg.click(`${rand} [data-pd-act="editeaza"]`);
      await pg.waitForSelector('#pd-ed-slideuri details', { timeout: 6000 }).catch(() => {});
      verifica(await pg.evaluate(() => document.querySelectorAll('#pd-ed-slideuri details').length) === 20, `${et}: editorul arată cele 20 de slide-uri`);
      verifica(await pg.evaluate(() => document.querySelectorAll('[data-pd-nota]').length) === notePe(RO), `${et}: editorul arată notele de verificare`);
      // Un câmp greșit → marcat de server, slide-ul lui deschis
      await pg.evaluate(() => { const el = document.querySelector('[data-cale="slide_uri.8.nivele.0.eticheta"]'); el.removeAttribute('required'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await pg.click('#pd-ed-salveaza');
      await pg.waitForFunction(() => document.querySelector('[data-cale="slide_uri.8.nivele.0.eticheta"]').getAttribute('aria-invalid') === 'true', null, { timeout: 6000 }).catch(() => {});
      verifica(await pg.evaluate(() => { const el = document.querySelector('[data-cale="slide_uri.8.nivele.0.eticheta"]'); return el.getAttribute('aria-invalid') === 'true' && el.closest('details').open; }), `${et}: câmpul greșit e marcat de server, slide-ul lui se deschide`);
      await pg.evaluate(() => document.querySelectorAll('#pd-ed-slideuri details').forEach((d) => { d.open = true; }));
      await pg.fill('[data-cale="slide_uri.8.nivele.0.eticheta"]', 'TAM GLOBAL');
      // Modificări: o cifră, sursele slide-urilor de prognoză, toate notele rezolvate
      { const d = await inAfaraEcranului(pg, '#pd-editor, #pd-editor *'); verifica(!d, `${et}: editorul (toate slide-urile deschise) în ecran (${d})`); }
      await pg.fill('[data-cale="slide_uri.3.cifre.0.valoare"]', '12');
      for (const n of [4, 9, 10, 12, 15, 17, 19]) await pg.fill(`[data-cale="slide_uri.${n - 1}.sursa"]`, 'Sursă DE TEST ' + n);
      for (const c of await pg.$$('[data-pd-nota]')) await c.check();
      await pg.waitForTimeout(2700); // butonul revine după eroare
      await pg.click('#pd-ed-salveaza');
      await pg.waitForFunction(() => /Ciorna a fost salvată/.test(document.getElementById('pd-ed-msg').textContent), null, { timeout: 6000 }).catch(() => {});
      verifica(/Ciorna a fost salvată\. Se poate aproba/.test(await pg.innerText('#pd-ed-msg')), `${et}: salvarea („${await pg.innerText('#pd-ed-msg')}”)`);
      const vRo = DB.tabele.pitch_deck_versiuni.find((v) => v.id === idRo);
      verifica(vRo.slide_uri[3].cifre[0].valoare === 12 && vRo.slide_uri[8].sursa === 'Sursă DE TEST 9' && vRo.slide_uri[8].nivele[0].eticheta === 'TAM GLOBAL' && vRo.note_verificare.every((n) => n.rezolvat), `${et}: serverul a primit cifra, sursele și notele`);
      // Previzualizarea folosește renderul public
      await pg.click('#pd-ed-previzualizeaza');
      await pg.waitForSelector('#pd-prev .mdpd-slide.mdpd-activ', { timeout: 6000 }).catch(() => {});
      verifica(await pg.evaluate(() => document.querySelectorAll('#pd-prev .mdpd-slide').length) === 20 && (await pg.innerText('#pd-prev-contor')) === '1 / 20', `${et}: previzualizarea — 20 de slide-uri, „1 / 20”`);
      await pg.keyboard.press('ArrowRight');
      verifica((await pg.innerText('#pd-prev-contor')) === '2 / 20', `${et}: previzualizarea — săgeata → 2 / 20`);
      { const d = await inAfaraEcranului(pg, '#pd-prev, #pd-prev *'); verifica(!d, `${et}: previzualizarea în ecran (${d})`); }
      await pg.keyboard.press('Escape');
      verifica(!(await pg.$('#pd-prev')), `${et}: Escape închide previzualizarea`);
      // Aprobarea RO; EN rămâne ciornă
      await pg.click(`${rand} [data-pd-act="aproba"]`);
      await confirmaDialog(pg);
      await pg.waitForFunction(() => /e aprobată și publică/.test(document.getElementById('pd-import-msg').textContent), null, { timeout: 6000 }).catch(() => {});
      verifica(DB.tabele.pitch_deck_versiuni.find((v) => v.id === idRo).aprobat === true && DB.tabele.pitch_deck_versiuni.find((v) => v.id === idEn).aprobat === false, `${et}: RO aprobată, EN neatinsă`);
      await pg.waitForFunction((r) => /Aprobată/.test((document.querySelector(r) || {}).textContent || ''), rand, { timeout: 5000 }).catch(() => {});
      const butoaneAprobata = await pg.$$eval(`${rand} .pd-actiuni button`, (b) => b.map((x) => x.textContent));
      verifica(JSON.stringify(butoaneAprobata) === JSON.stringify(['Previzualizează', 'Retrage aprobarea', 'Duplică ca ciornă nouă']), `${et}: acțiunile versiunii aprobate (${butoaneAprobata.join(', ')})`);
      // Duplicare → ciornă nouă deschisă în editor; apoi retragerea aprobării
      await pg.click(`${rand} [data-pd-act="duplica"]`);
      await pg.waitForFunction(() => /\(copie\)/.test((document.getElementById('pd-editor') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
      verifica(DB.tabele.pitch_deck_versiuni.filter((v) => v.limba === 'ro').length === 2 && /\(copie\)/.test(await pg.innerText('#pd-editor')), `${et}: duplicarea creează o ciornă și o deschide în editor`);
      await pg.click(`${rand} [data-pd-act="retrage"]`);
      await confirmaDialog(pg);
      await pg.waitForFunction(() => /a fost retrasă/.test(document.getElementById('pd-import-msg').textContent), null, { timeout: 6000 }).catch(() => {});
      verifica(DB.tabele.pitch_deck_versiuni.every((v) => !v.aprobat), `${et}: aprobarea retrasă`);
      const audit = DB.tabele.audit_log.map((x) => x.actiune);
      verifica(['pitch_deck_importat', 'pitch_deck_ciorna_salvata', 'pitch_deck_aprobat', 'pitch_deck_duplicat', 'pitch_deck_aprobare_retrasa'].every((x) => audit.includes(x)), `${et}: fiecare acțiune e auditată (${[...new Set(audit)].join(', ')})`);
      const d = await inAfaraEcranului(pg, '#pd-card, #pd-card *'); verifica(!d, `${et}: cardul în ecran (${d})`);
      verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
      await ctx.close();
    }
    {
      const { ctx, pg } = await panouAdmin(browser, baza, latime, { id: 'cit', email: 'citire@example.com', roles: ['admin'] });
      verifica(!(await pg.isVisible('#pd-importa')), `${et} doar citire: fără „Importă din fișier”`);
      verifica(!(await pg.isVisible('#pd-viz-select')) && /o schimbă superadminul/.test(await pg.innerText('#pd-viz')), `${et} doar citire: vizibilitatea doar afișată`);
      verifica(/Pitch deck v1 · RO/.test(await pg.innerText('#pd-tbody')), `${et} doar citire: versiunile se văd`);
      const butoane = await pg.$$eval('#pd-tbody .pd-actiuni button', (b) => [...new Set(b.map((x) => x.textContent))]);
      verifica(JSON.stringify(butoane) === JSON.stringify(['Previzualizează']), `${et} doar citire: doar „Previzualizează” (${butoane.join(', ')})`);
      verifica(!pg.erori.length, `${et} doar citire: 0 erori JS (${pg.erori.join(' | ')})`);
      await ctx.close();
    }
    console.log(`${et}: gata`);
  }
}

// ═══ B. Pagina publică ═════════════════════════════════════════════
// API-ul simulat = handler-ele reale peste Supabase-ul simulat: versiunile v1
// importate și aprobate (cu surse DE TEST), runda DE TEST.
const apiPublic = require(path.join(RADACINA, 'api/public/pitch-deck.js'));
const P = require(path.join(RADACINA, 'lib/pitch-deck.js'));
const RUNDA_TEST = { id: 'r-test', cod: 'test', denumire_ro: 'Seed (test)', denumire_en: 'Seed (test)', stare: 'deschisa', vizibila_public: true, moneda: 'EUR',
  evaluare_pre_money: 900000, suma_tinta: 100000, actiuni_existente: 900, investitie_minima: 1000, tickete: [5000, 10000], data_start: '2099-11-01', data_sfarsit: '2100-06-30', afiseaza_progres: false };

function versiuneAprobata(j, id) {
  const { slide_uri, note } = P.extrageNote(JSON.parse(JSON.stringify(j.slide_uri)));
  return { id, limba: j.meta.limba, titlu: 'Pitch deck v1 · ' + j.meta.limba.toUpperCase(), sursa: j.meta.sursa, disclaimer: j.meta.disclaimer,
    slide_uri: slide_uri.map((s) => (s.prognoza ? { ...s, sursa: 'Sursă DE TEST' } : s)), note_verificare: note.map((n) => ({ ...n, rezolvat: true })),
    aprobat: true, aprobat_la: '2026-10-22T10:00:00Z', creat_la: '2026-10-22T09:00:00Z' };
}
function resetPublic({ versiuni = true, vizibilitate = 'public', runda = true } = {}) {
  DB.tabele = {
    profiles: [{ id: 'inv', email: 'inv@example.com', roles: ['client', 'investor'] }],
    investitori_kyc: [{ user_id: 'inv', status: 'aprobat' }],
    backoffice_config: [
      { cheie: 'investitori_email', valoare: 'investor@example.com', sectiune: 'contact', tara_cod: 'ALL' },
      { cheie: 'pitch_deck_vizibilitate', valoare: vizibilitate, sectiune: 'investitori', tara_cod: 'ALL' },
    ],
    runde_finantare: runda ? [{ ...RUNDA_TEST }] : [], investitori_portofoliu: [],
    pitch_deck_versiuni: versiuni ? [versiuneAprobata(RO, 'v-ro'), versiuneAprobata(EN, 'v-en')] : [],
  };
  DB.coloane = {};
  DB.utilizatori = { 'tok-inv': { id: 'inv', email: 'inv@example.com' } };
  delete require.cache[require.resolve(path.join(RADACINA, 'lib/contact-platforma.js'))];
}

async function paginaPublica(browser, baza, { lang, latime, reducere = false, hash = '' }) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 720 ? 844 : 860 }, reducedMotion: reducere ? 'reduce' : 'no-preference', hasTouch: latime < 720 });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('myd_lang_v1', l);
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
    } catch (e) {}
  }, lang);
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  const cereri = [];
  await ctx.route(/\/api\/public\/pitch-deck/, async (r) => {
    const url = new URL(r.request().url());
    cereri.push(url.search);
    const res = raspuns();
    await apiPublic(cerere({ metoda: 'GET', token: (r.request().headers().authorization || '').replace('Bearer ', '') || null, query: Object.fromEntries(url.searchParams) }), res);
    return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp || {}) });
  });
  const pg = await ctx.newPage();
  pg.erori = [];
  pg.cereri = cereri;
  pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 200)));
  await pg.goto(baza + '/mydarrin-pitch-deck' + hash, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => document.querySelector('.mdpd-slide.mdpd-activ') || document.querySelector('[data-in-pregatire]'), null, { timeout: 10000 }).catch(() => {});
  return { ctx, pg };
}

// Textul tăiat: elemente cu text care depășesc slide-ul sau propria cutie.
async function textTaiat(pg) {
  return pg.evaluate((depanare) => {
    const s = document.querySelector('.mdpd-slide.mdpd-activ');
    if (!s) return 'fără slide activ';
    const rs = s.getBoundingClientRect();
    const W = document.documentElement.clientWidth;
    const rau = [];
    if (getComputedStyle(s).position === 'absolute' && s.scrollHeight > s.clientHeight + 2) rau.push(`slide-ul are conținut în afara cadrului (${s.scrollHeight} > ${s.clientHeight})`);
    s.querySelectorAll('h1,h2,h3,p,li,span,div,td,th,a,button').forEach((el) => {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim())) return;
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).visibility === 'hidden') return;
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') rau.push('tăiat pe orizontală: ' + el.textContent.trim().slice(0, 40));
      if (r.right > Math.min(W, rs.right) + 2 || r.left < Math.max(0, rs.left) - 2) rau.push('în afara slide-ului: ' + el.textContent.trim().slice(0, 40) + ` (${Math.round(r.left)}…${Math.round(r.right)})`);
      if (getComputedStyle(s).position === 'absolute' && r.bottom > rs.bottom + 2) rau.push('sub marginea slide-ului: ' + el.textContent.trim().slice(0, 40));
    });
    // Texte suprapuse: două elemente cu text (fără relație părinte–copil) care se intersectează.
    const cuText = [...s.querySelectorAll('h1,h2,h3,p,li,span,div,td,th,a,button')].filter((el) =>
      [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim()) && el.getBoundingClientRect().width && !el.closest('svg'));
    for (let i = 0; i < cuText.length; i++) {
      for (let j = i + 1; j < cuText.length; j++) {
        const x = cuText[i], y = cuText[j];
        if (x.contains(y) || y.contains(x)) continue;
        const a = x.getBoundingClientRect(), b = y.getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 3 && oy > 3) rau.push(`suprapuse: „${x.textContent.trim().slice(0, 25)}” / „${y.textContent.trim().slice(0, 25)}”` + (depanare ? ` [${[a.left, a.top, a.right, a.bottom].map(Math.round)}] [${[b.left, b.top, b.right, b.bottom].map(Math.round)}]` : ''));
      }
    }
    return rau.slice(0, 4).join(' | ');
  }, !!process.env.DEPANARE);
}

const CAPTURI = process.env.CAPTURI || '';
async function captura(pg, nume) { if (CAPTURI) await pg.screenshot({ path: path.join(CAPTURI, nume + '.png') }); }

const ASTEPTAT = {
  ro: { pregatire: 'Pitch deck în pregătire', anunt: 'Termenii rundei vor fi anunțați', live: 'Vezi cifrele reale →', piata: '500 mld. €', tractiune: '200.000+', exitSeed: '1 mil. €', eticheta: RO.meta.disclaimer, perioada: '1 noiembrie 2099 – 30 iunie 2100' },
  en: { pregatire: 'Pitch deck in preparation', anunt: 'The round terms will be announced', live: 'See the real figures →', piata: '€500bn', tractiune: '200,000+', exitSeed: '€1M', eticheta: EN.meta.disclaimer, perioada: '1 November 2099 – 30 June 2100' },
};

async function testPublic(browser, baza) {
  for (const lang of (process.env.LIMBI || 'ro,en,de').split(',')) {
    const l = lang === 'ro' ? 'ro' : 'en';
    const A = ASTEPTAT[l];
    const J = l === 'ro' ? RO : EN;
    for (const latime of [390, 1366]) {
      const et = `B ${lang} ${latime}px`;
      resetPublic();
      const { ctx, pg } = await paginaPublica(browser, baza, { lang, latime });
      verifica(pg.cereri.some((q) => q.includes('limba=' + lang)), `${et}: cererea poartă limba (${pg.cereri.join(' ')})`);
      verifica(await pg.evaluate(() => document.querySelectorAll('.mdpd-slide').length) === 20, `${et}: 20 de slide-uri`);
      verifica((await pg.getAttribute('.mdpd', 'lang')) === l, `${et}: deck-ul ${l.toUpperCase()}`);
      // Toate cele 20 de slide-uri, unul câte unul, cu tastatura
      for (let i = 0; i < 20; i++) {
        if (i) await pg.keyboard.press('ArrowRight');
        await pg.waitForTimeout(i ? 140 : 300);
        const nr = await pg.evaluate(() => Number(document.querySelector('.mdpd-slide.mdpd-activ').dataset.nr));
        verifica(nr === i + 1, `${et}: săgeata → slide-ul ${i + 1} (e ${nr})`);
        const s = J.slide_uri[i];
        await pg.waitForTimeout(1300); // animațiile se termină
        const t = await textTaiat(pg); verifica(!t, `${et} slide ${i + 1} (${s.tip}): fără text tăiat (${t})`);
        const d = await inAfaraEcranului(pg, '.mdpd-slide.mdpd-activ, .mdpd-slide.mdpd-activ *'); verifica(!d, `${et} slide ${i + 1}: nimic în afara ecranului (${d})`);
        const prog = await pg.evaluate(() => { const e = document.querySelector('.mdpd-slide.mdpd-activ [data-prognoza]'); return e ? e.textContent : null; });
        verifica(s.prognoza ? prog === A.eticheta : prog === null, `${et} slide ${i + 1}: eticheta de prognoză ${s.prognoza ? 'prezentă' : 'absentă'} („${prog}”)`);
        if (process.env.CAPTURI_TOATE || (latime === 1366 && [9, 10, 17].includes(i + 1)) || (latime === 390 && [9, 17].includes(i + 1))) await captura(pg, `${lang}-${latime}-slide-${i + 1}`);
      }
      const contor = await pg.innerText('#pd-contor');
      verifica(contor === '20 / 20', `${et}: indicatorul „20 / 20” („${contor}”)`);
      verifica((await pg.evaluate(() => location.hash)) === '#slide-20', `${et}: adresa #slide-20`);
      verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
      await ctx.close();
      console.log(`${et}: gata`);
    }
  }
}

// ═══ C. Animații, navigare, limbă, stări ═══════════════════════════
// Intl pune spații neseparabile (22 mil. €): comparăm cu spații obișnuite.
const sp = (t) => String(t || '').replace(/\s/g, ' ');
const slideActiv = (pg) => pg.evaluate(() => Number((document.querySelector('.mdpd-slide.mdpd-activ') || {}).dataset?.nr || 0));
async function swipe(pg, dx) {
  await pg.evaluate((dx) => {
    const st = document.querySelector('.mdpd-stage');
    const r = st.getBoundingClientRect();
    const t = (x) => new Touch({ identifier: 1, target: st, clientX: x, clientY: r.top + 200 });
    const x0 = r.left + r.width / 2;
    st.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [t(x0)], touches: [t(x0)], bubbles: true }));
    st.dispatchEvent(new TouchEvent('touchend', { changedTouches: [t(x0 + dx)], touches: [], bubbles: true }));
  }, dx);
  await pg.waitForTimeout(150);
}

async function testStari(browser, baza) {
  // Animațiile pornesc: cifra crește de la 0, la final e exactă; elementele intră pe rând.
  for (const [lang, latime] of [['ro', 1366], ['en', 390]]) {
    const et = `C ${lang} ${latime}px`;
    const A = ASTEPTAT[lang];
    resetPublic();
    const { ctx, pg } = await paginaPublica(browser, baza, { lang, latime, hash: '#slide-10' });
    verifica(await slideActiv(pg) === 10, `${et}: #slide-10 deschide direct slide-ul 10`);
    const inceput = await pg.evaluate(() => {
      const n = document.querySelector('.mdpd-slide.mdpd-activ [data-tinta]');
      const a = document.querySelectorAll('.mdpd-slide.mdpd-activ .mdpd-a');
      return { text: n.textContent, op: getComputedStyle(a[a.length - 1]).opacity };
    });
    await pg.waitForTimeout(1800);
    const final = await pg.evaluate(() => ({ text: document.querySelector('.mdpd-slide.mdpd-activ [data-tinta]').textContent, op: [...document.querySelectorAll('.mdpd-slide.mdpd-activ .mdpd-a')].every((e) => getComputedStyle(e).opacity === '1') }));
    verifica(inceput.text !== A.tractiune && Number(inceput.op) < 1, `${et}: animația pornește (cifra „${inceput.text}”, opacitate ${inceput.op})`);
    verifica(final.text === A.tractiune && final.op, `${et}: după animație cifra e exactă („${final.text}”) și toate elementele sunt vizibile`);
    // Graficul (slide 17): barele cresc, cifra finală exactă
    await pg.evaluate(() => { location.hash = '#slide-17'; });
    await pg.waitForTimeout(2200);
    const gr = await pg.evaluate(() => ({ n: document.querySelector('.mdpd-slide.mdpd-activ [data-tinta]').textContent, bare: document.querySelectorAll('.mdpd-slide.mdpd-activ .mdpd-bara').length, anim: getComputedStyle(document.querySelector('.mdpd-slide.mdpd-activ .mdpd-bara')).animationName }));
    verifica(sp(gr.n) === (lang === 'ro' ? '22 mil. €' : '€22M') && gr.bare === 5 && gr.anim === 'mdpd-creste', `${et}: graficul — 5 bare animate, cifra „${gr.n}”`);
    // Swipe pe telefon / săgețile din bară pe desktop
    if (latime === 390) {
      await swipe(pg, -120); verifica(await slideActiv(pg) === 18, `${et}: swipe la stânga → slide 18`);
      await swipe(pg, 120); verifica(await slideActiv(pg) === 17, `${et}: swipe la dreapta → slide 17`);
      await swipe(pg, -20); verifica(await slideActiv(pg) === 17, `${et}: o atingere scurtă nu schimbă slide-ul`);
    } else {
      await pg.click('#pd-inainte-slide'); verifica(await slideActiv(pg) === 18, `${et}: butonul → slide 18`);
      await pg.keyboard.press('Home'); verifica(await slideActiv(pg) === 1, `${et}: Home → slide 1`);
      await pg.keyboard.press('End'); verifica(await slideActiv(pg) === 20, `${et}: End → slide 20`);
    }
    verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
    await ctx.close();
  }

  // prefers-reduced-motion: totul afișat direct
  {
    resetPublic();
    const { ctx, pg } = await paginaPublica(browser, baza, { lang: 'ro', latime: 1366, reducere: true, hash: '#slide-10' });
    const imediat = await pg.evaluate(() => ({ text: document.querySelector('.mdpd-slide.mdpd-activ [data-tinta]').textContent, op: [...document.querySelectorAll('.mdpd-slide.mdpd-activ .mdpd-a')].every((e) => getComputedStyle(e).opacity === '1'), anim: getComputedStyle(document.querySelector('.mdpd-slide.mdpd-activ')).animationName }));
    verifica(imediat.text === '200.000+' && imediat.op && imediat.anim === 'none', `C reduced-motion: cifra exactă și elementele vizibile imediat (${JSON.stringify(imediat)})`);
    await ctx.close();
  }

  // Schimbarea limbii din antet: fără reîncărcare
  {
    resetPublic();
    const { ctx, pg } = await paginaPublica(browser, baza, { lang: 'ro', latime: 1366 });
    await pg.evaluate(() => { window.__faraReincarcare = 1; });
    const titluRo = await pg.innerText('.mdpd-slide.mdpd-activ h1');
    await pg.selectOption('#pd-limba', 'en');
    await pg.waitForFunction(() => document.querySelector('.mdpd') && document.querySelector('.mdpd').lang === 'en', null, { timeout: 5000 }).catch(() => {});
    verifica(await pg.evaluate(() => window.__faraReincarcare === 1), 'C limbă: pagina nu s-a reîncărcat');
    verifica(titluRo === RO.slide_uri[0].titlu && (await pg.innerText('.mdpd-slide.mdpd-activ .mdpd-sub')) === EN.slide_uri[0].subtitlu, 'C limbă: RO → EN schimbă deck-ul');
    verifica((await pg.innerText('.pd-inapoi')) === '← Investors' && (await pg.evaluate(() => localStorage.getItem('myd_lang_v1'))) === 'en', 'C limbă: antetul în EN, alegerea salvată');
    const cereriInainte = pg.cereri.length;
    await pg.selectOption('#pd-limba', 'de');
    await pg.waitForTimeout(400);
    verifica(pg.cereri.length === cereriInainte && (await pg.getAttribute('.mdpd', 'lang')) === 'en', 'C limbă: EN → de păstrează deck-ul EN, fără o cerere nouă');
    verifica((await pg.evaluate(() => localStorage.getItem('myd_lang_v1'))) === 'de', 'C limbă: „de” salvat în myd_lang_v1');
    await pg.selectOption('#pd-limba', 'ro');
    await pg.waitForFunction(() => document.querySelector('.mdpd') && document.querySelector('.mdpd').lang === 'ro', null, { timeout: 5000 }).catch(() => {});
    verifica((await pg.getAttribute('.mdpd', 'lang')) === 'ro' && (await pg.evaluate(() => window.__faraReincarcare === 1)), 'C limbă: înapoi la RO, tot fără reîncărcare');
    verifica(!pg.erori.length, `C limbă: 0 erori JS (${pg.erori.join(' | ')})`);
    await ctx.close();
  }

  // Fără versiune aprobată → „Pitch deck în pregătire”; fără conținut de rezervă
  for (const [lang, latime] of [['ro', 390], ['en', 1366], ['de', 390]]) {
    resetPublic({ versiuni: false });
    const { ctx, pg } = await paginaPublica(browser, baza, { lang, latime });
    const t = await pg.innerText('#pd-mesaj').catch(() => '');
    const A = ASTEPTAT[lang === 'ro' ? 'ro' : 'en'];
    verifica(t.includes(A.pregatire) && !(await pg.isVisible('#pd-deck')) && !(await pg.isVisible('#pd-nav')), `C ${lang} ${latime}px: „${A.pregatire}”, fără deck (${t.slice(0, 80)})`);
    const html = await pg.content();
    verifica(!/Runda Pre-Seed|40 Mld|Runda I · 2026/.test(html), `C ${lang}: niciun conținut de rezervă în pagină`);
    const d = await inAfaraEcranului(pg, '#pd-app, #pd-app *'); verifica(!d, `C ${lang} ${latime}px: în pregătire, nimic în afara ecranului (${d})`);
    verifica(!pg.erori.length, `C ${lang} în pregătire: 0 erori JS (${pg.erori.join(' | ')})`);
    await ctx.close();
  }

  // Vizibilitate restrânsă, fără sesiune → rezumatul: slide-urile 1–3 + „Intră în rundă”
  for (const [lang, latime] of [['ro', 1366], ['en', 390]]) {
    resetPublic({ vizibilitate: 'investitori_aprobati' });
    const { ctx, pg } = await paginaPublica(browser, baza, { lang, latime });
    const n = await pg.evaluate(() => document.querySelectorAll('.mdpd-slide').length);
    verifica(n === 4, `C ${lang} rezumat: 3 slide-uri + invitația (${n})`);
    await pg.keyboard.press('End');
    await pg.waitForTimeout(700);
    const btn = await pg.$('.mdpd-slide.mdpd-activ [data-intra-runda]');
    verifica(btn && (await btn.getAttribute('href')) === '/mydarrin-investitori#runda' && (await btn.innerText()) === (lang === 'ro' ? 'Intră în rundă' : 'Join the round'), `C ${lang} rezumat: butonul „Intră în rundă”`);
    verifica((await pg.innerText('#pd-contor')) === '4 / 4', `C ${lang} rezumat: indicatorul 4 / 4`);
    const t = await textTaiat(pg); verifica(!t, `C ${lang} ${latime}px rezumat: fără text tăiat (${t})`);
    await ctx.close();
  }

  // Runda live pe slide-ul 18 și punctul din_runda de pe slide-ul 19
  for (const lang of ['ro', 'en']) {
    const A = ASTEPTAT[lang];
    resetPublic();
    let { ctx, pg } = await paginaPublica(browser, baza, { lang, latime: 1366, hash: '#slide-18' });
    await pg.waitForTimeout(1600);
    const r = (await pg.innerText('.mdpd-slide.mdpd-activ')).replace(/\s+/g, ' ');
    verifica(r.includes('Seed (test)') && r.includes(A.perioada) && r.includes(lang === 'ro' ? '900.000 €' : '€900,000') && r.includes(lang === 'ro' ? '10%' : '10%'), `C ${lang}: slide-ul 18 cu cifrele rundei (${r.slice(0, 220)})`);
    await pg.keyboard.press('ArrowRight');
    await pg.waitForTimeout(300);
    const seed = await pg.innerText('.mdpd-slide.mdpd-activ [data-din-runda]');
    verifica(sp(seed) === A.exitSeed, `C ${lang}: exit — SEED din post-money-ul rundei („${seed}”), nu din JSON`);
    verifica(await pg.isVisible('.mdpd-slide.mdpd-activ .mdpd-avert'), `C ${lang}: avertismentul de pe exit e vizibil`);
    await ctx.close();
    resetPublic({ runda: false });
    ({ ctx, pg } = await paginaPublica(browser, baza, { lang, latime: 390, hash: '#slide-18' }));
    verifica((await pg.innerText('.mdpd-slide.mdpd-activ [data-runda-anunt]').catch(() => '')) === A.anunt, `C ${lang}: fără rundă publică → „${A.anunt}”`);
    await ctx.close();
  }
  console.log('C: gata');
}

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    if (!process.env.DOAR || process.env.DOAR === 'A') await testAdmin(browser, baza);
    if (!process.env.DOAR || process.env.DOAR === 'B') await testPublic(browser, baza);
    if (!process.env.DOAR || process.env.DOAR === 'C') await testStari(browser, baza);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
