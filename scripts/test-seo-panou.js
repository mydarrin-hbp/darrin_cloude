// scripts/test-seo-panou.js
// Pasul 11-S (23 oct. 2026): panoul „SEO — Titluri & Descrieri” din
// mydarrin-superadmin.html, în browser (Playwright), cu handler-ele reale
// (api/admin/seo.js, api/admin/seo-campanii.js) peste Supabase-ul simulat și
// stocarea simulată (încărcarea pe adresa semnată e interceptată).
// Nimic nu ajunge la producție.
//   T. cele trei taburi; RO / EN; contoarele; salvarea pe limbă (MDFeedback);
//   O. „Partajare (OG)”: previzualizarea cardului, linkurile spre instrumentele oficiale;
//      imaginea cu raport greșit → refuzată în browser, cu mesaj;
//   C. „Social media & campanii”: lista, formularul, contoarele pe platforme,
//      video 9:16 corect → previzualizare cu zona sigură, „Duplică pentru EN”,
//      previzualizările platformelor, exportul;
//   0 erori JS, nimic în afara ecranului, fără derulare laterală.
// Lățimi: 1440, 1024, 768, 390.
// Rulare: node scripts/test-seo-panou.js   (DOAR=T|O|C, CAPTURI=<folder>)

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const API = { '/api/admin/seo': require(path.join(RADACINA, 'api/admin/seo.js')) };
try { API['/api/admin/seo-campanii'] = require(path.join(RADACINA, 'api/admin/seo-campanii.js')); } catch (e) { /* punctul 2.4 */ }

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const DOAR = process.env.DOAR || '';
const ruleaza = (s) => !DOAR || DOAR.includes(s);
const CAPTURI = process.env.CAPTURI || '';
async function captura(pg, nume) { if (CAPTURI) await pg.screenshot({ path: path.join(CAPTURI, nume + '.png'), fullPage: false }); }
const LATIMI = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];

function reset() {
  DB.tabele = {
    profiles: [{ id: 'sup', email: 'super@example.com', roles: ['superadmin'] }, { id: 'cit', email: 'cit@example.com', roles: ['admin'] }],
    admin_permissions: [{ admin_id: 'cit', sectiune: 'seo', poate_scrie: false }],
    audit_log: [], seo_config: [], seo_campanii_social: [], backoffice_config: [],
  };
  DB.coloane = {};
  DB.storage = {};
  DB.utilizatori = { 'tok-sup': { id: 'sup', email: 'super@example.com' }, 'tok-cit': { id: 'cit', email: 'cit@example.com' } };
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

// Fișierele „încărcate” pe adresa semnată: conținutul real, ca serverul să-l poată verifica.
const INCARCATE = new Map();
process.env.SUPABASE_URL = 'https://abcdefgh.supabase.co';
// fetch-ul serverului (lib/verifica-fisier.js) citește primii octeți de pe adresa semnată simulată.
globalThis.fetch = async (url, opt) => {
  const m = /^https:\/\/sim\.supabase\/sign\/(.+?)\?/.exec(String(url));
  const b = m && INCARCATE.get(decodeURIComponent(m[1]));
  if (!b) return new Response('nu', { status: 404 });
  return new Response(b.subarray(0, 64), { status: 206, headers: { 'content-range': `bytes 0-63/${b.length}` } });
};

async function deschide(browser, baza, w, h, user = { id: 'sup', email: 'super@example.com', roles: ['superadmin'] }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1024 });
  await ctx.addInitScript(sesiuneAdmin, user);
  // Imaginile publice din seo-og: servite din fișierele încărcate.
  await ctx.route(/\.supabase\.co\//, (r) => {
    const m = /\/storage\/v1\/object\/public\/(.+)$/.exec(new URL(r.request().url()).pathname);
    const b = m && INCARCATE.get(decodeURIComponent(m[1]));
    return b ? r.fulfill({ status: 200, contentType: 'image/png', body: b }) : r.abort();
  });
  await ctx.route(/^https:\/\/sim\.supabase\//, async (r) => {
    const req = r.request();
    if (req.method() === 'PUT' || req.method() === 'POST') {
      const u = new URL(req.url());
      const cheie = decodeURIComponent(u.pathname.replace(/^\/upload\//, ''));
      INCARCATE.set(cheie, req.postDataBuffer());
      const [bucket, ...rest] = cheie.split('/');
      (DB.storage[bucket] = DB.storage[bucket] || new Set()).add(rest.join('/'));
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"ok"}' });
    }
    const m = /^\/sign\/(.+)$/.exec(new URL(req.url()).pathname);
    const b = m && INCARCATE.get(decodeURIComponent(m[1]));
    if (!b) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ status: 200, contentType: /\.webm$/.test(m[1]) ? 'video/webm' : (/\.mp4$/.test(m[1]) ? 'video/mp4' : 'image/png'), body: b });
  });
  await ctx.route(/\/api\//, async (r) => {
    const req = r.request(), url = new URL(req.url()), api = API[url.pathname];
    if (!api) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    let corp = null; try { corp = JSON.parse(req.postData() || 'null'); } catch (e) { corp = null; }
    const res = raspuns();
    await api(cerere({ metoda: req.method(), token: (req.headers().authorization || '').replace('Bearer ', ''), body: corp, query: Object.fromEntries(url.searchParams) }), res);
    const hdr = res.headere['Content-Type'] || 'application/json';
    return r.fulfill({ status: res.statusCode, contentType: hdr, body: Buffer.isBuffer(res.corp) ? res.corp : JSON.stringify(res.corp || {}) });
  });
  const pg = await ctx.newPage();
  pg.erori = [];
  pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 200)));
  await pg.goto(baza + '/mydarrin-superadmin.html', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(300);
  await pg.evaluate(() => window.showPanel('seo'));
  await pg.waitForSelector('#seo-tabel-body [data-editeaza]', { timeout: 8000 }).catch(() => {});
  return { ctx, pg };
}

// Elementele vizibile din panou care ies din ecran pe orizontală / derularea laterală.
async function geometrie(pg) {
  return pg.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const rau = [];
    if (document.documentElement.scrollWidth > W + 1) rau.push('pagina se derulează lateral: ' + document.documentElement.scrollWidth + ' > ' + W);
    const ed = document.getElementById('seo-editor');
    if (ed && !ed.hidden) {
      ed.querySelectorAll('input:not([type=hidden]),textarea,select,button,.seo-card,.seo-media-cutie,.seo-sim').forEach((e) => {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const st = getComputedStyle(e);
        if (st.visibility === 'hidden' || st.display === 'none') return;
        if (e.closest('.seo-taburi')) return;  // bara de taburi se derulează singură
        if (r.left < -1 || r.right > W + 1) rau.push('în afara ecranului: ' + (e.id || e.className || e.tagName) + ' [' + Math.round(r.left) + ',' + Math.round(r.right) + ']');
      });
    }
    return rau.slice(0, 5).join(' | ');
  });
}

// O imagine PNG generată în pagină (canvas), cu dimensiunile cerute.
async function imagine(pg, w, h, tip = 'image/png') {
  const b64 = await pg.evaluate(async ([w, h, tip]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#FF8C00'; x.fillRect(0, 0, w, h); x.fillStyle = '#0F1923'; x.fillRect(w / 4, h / 4, w / 2, h / 2);
    const blob = await new Promise((ok) => c.toBlob(ok, tip, 0.9));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  }, [w, h, tip]);
  return Buffer.from(b64, 'base64');
}

async function testTaburi(browser, baza) {
  for (const [w, h] of LATIMI) {
    const et = `T ${w}×${h}`;
    reset();
    INCARCATE.clear();
    const { ctx, pg } = await deschide(browser, baza, w, h);
    const randuri = await pg.$$eval('#seo-tabel-body tr', (t) => t.length);
    verifica(randuri >= 25, `${et}: tabelul paginilor (${randuri})`);
    await pg.click('#seo-tabel-body [data-editeaza="/despre-noi"]');
    const taburi = await pg.$$eval('#seo-taburi [role="tab"]', (t) => t.map((x) => x.textContent));
    verifica(JSON.stringify(taburi) === JSON.stringify(['SEO', 'Partajare (OG)', 'Social media & campanii']), `${et}: cele trei taburi (${JSON.stringify(taburi)})`);

    // SEO: RO, apoi EN, salvate separat
    await pg.fill('#seo-input-title', 'Despre My Darrin — titlu RO DE TEST');
    const contor = await pg.$eval('[data-contor="meta_title"]', (e) => [e.textContent, e.className]);
    verifica(contor[0] === '35 / 60' && /verde/.test(contor[1]), `${et}: contorul titlului (${contor})`);
    await pg.fill('#seo-input-description', 'x'.repeat(150));
    verifica(/galben/.test(await pg.$eval('[data-contor="meta_description"]', (e) => e.className)), `${et}: contorul descrierii galben la 150 / 160`);
    await pg.fill('#seo-input-description', 'y'.repeat(170));
    verifica(/rosu/.test(await pg.$eval('[data-contor="meta_description"]', (e) => e.className)), `${et}: contorul descrierii roșu peste 160`);
    await pg.fill('#seo-input-description', 'Descriere RO DE TEST');
    await pg.click('#seo-panou-tab [data-act="salveaza"]');
    await pg.waitForFunction(() => /Salvat/.test((document.getElementById('seo-editor-msg') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    verifica(DB.tabele.seo_config.length === 1 && DB.tabele.seo_config[0].limba === 'ro' && DB.tabele.seo_config[0].meta_title === 'Despre My Darrin — titlu RO DE TEST', `${et}: salvat RO`);
    await pg.click('#seo-panou-tab [data-limba="en"]');
    verifica((await pg.inputValue('#seo-input-title')) === '', `${et}: EN pornește gol`);
    await pg.fill('#seo-input-title', 'About My Darrin — EN TEST title');
    await pg.click('#seo-panou-tab [data-limba="ro"]');
    verifica((await pg.inputValue('#seo-input-title')) === 'Despre My Darrin — titlu RO DE TEST', `${et}: comutarea RO / EN păstrează valorile`);
    await pg.click('#seo-panou-tab [data-limba="en"]');
    await pg.click('#seo-panou-tab [data-act="salveaza"]');
    await pg.waitForFunction(() => /Salvat/.test((document.getElementById('seo-editor-msg') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    const en = DB.tabele.seo_config.find((x) => x.limba === 'en');
    verifica(DB.tabele.seo_config.length === 2 && en && en.meta_title === 'About My Darrin — EN TEST title', `${et}: salvat EN, rând separat`);
    const stare = await pg.$eval('#seo-tabel-body [data-editeaza="/despre-noi"]', (b) => b.closest('tr').children[2].textContent);
    verifica(/RO: Suprascris/.test(stare) && /EN: Suprascris/.test(stare), `${et}: tabelul arată starea pe limbă (${stare})`);
    if (w === 1440 || w === 390) await captura(pg, `seo-tab-seo-${w}`);
    const g = await geometrie(pg);
    verifica(!g, `${et}: SEO — nimic în afara ecranului (${g})`);

    // OG
    if (ruleaza('O')) {
      await pg.click('#seo-tab-og');
      await pg.click('#seo-panou-tab [data-limba="ro"]');
      await pg.fill('#seo-og-titlu', 'Titlu partajare DE TEST');
      const card = await pg.$$eval('.seo-card .seo-card-titlu', (t) => t.map((x) => x.textContent));
      verifica(card.length === 3 && card.every((t) => t === 'Titlu partajare DE TEST'), `${et}: previzualizarea Facebook / LinkedIn / WhatsApp din câmp (${card})`);
      const linkuri = await pg.$$eval('#seo-panou-tab a[target="_blank"]', (a) => a.map((x) => [x.href, x.rel]));
      verifica(linkuri.length === 2 && linkuri[0][0].startsWith('https://developers.facebook.com/tools/debug/?q=https%3A%2F%2Fmydarrin.homebestpal.com%2Fdespre-noi')
        && linkuri[1][0].startsWith('https://www.linkedin.com/post-inspector/inspect/') && linkuri.every((l) => /noopener/.test(l[1])), `${et}: linkurile spre instrumentele oficiale, în filă nouă (${JSON.stringify(linkuri)})`);
      if (await pg.$('#seo-og-media input[type=file]')) {
        await pg.setInputFiles('#seo-og-media input[type=file]', { name: 'patrat.png', mimeType: 'image/png', buffer: await imagine(pg, 1000, 1000) });
        await pg.waitForFunction(() => /1,91:1/.test((document.querySelector('#seo-og-media .seo-media-msg') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
        const msg = await pg.$eval('#seo-og-media .seo-media-msg', (e) => e.textContent).catch(() => '');
        verifica(/1,91:1/.test(msg) && !INCARCATE.size, `${et}: imaginea 1:1 refuzată în browser, fără încărcare (${msg})`);
        await pg.setInputFiles('#seo-og-media input[type=file]', { name: 'og.png', mimeType: 'image/png', buffer: await imagine(pg, 1200, 630) });
        await pg.waitForFunction(() => !!document.querySelector('.seo-card-facebook .seo-card-img img'), null, { timeout: 8000 }).catch(() => {});
        verifica(!!(await pg.$('.seo-card-facebook .seo-card-img img')) && INCARCATE.size === 1, `${et}: imaginea 1200 × 630 se încarcă și apare în card`);
        await pg.click('#seo-panou-tab [data-act="salveaza"]');
        await pg.waitForFunction(() => /salvat/i.test((document.getElementById('seo-og-msg') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
        const ro = DB.tabele.seo_config.find((x) => x.limba === 'ro');
        verifica(ro && ro.og_titlu === 'Titlu partajare DE TEST' && /\/seo-og\/despre-noi\/ro\//.test(ro.og_imagine_url || '') && ro.og_imagine_latime === 1200 && ro.og_imagine_inaltime === 630
          && ro.meta_title === 'Despre My Darrin — titlu RO DE TEST', `${et}: OG salvat pe rândul RO, fără să șteargă titlul SEO (${ro && ro.og_imagine_url})`);
      }
      if (w === 1440 || w === 390) await captura(pg, `seo-tab-og-${w}`);
      const g2 = await geometrie(pg);
      verifica(!g2, `${et}: OG — nimic în afara ecranului (${g2})`);
    }

    if (ruleaza('C') && module.exports.testCampanii) await module.exports.testCampanii({ pg, ctx, et, w, h, verifica, geometrie, imagine, captura, INCARCATE });

    verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
    await ctx.close();
  }
}

async function testCitire(browser, baza) {
  reset();
  const { ctx, pg } = await deschide(browser, baza, 1440, 900, { id: 'cit', email: 'cit@example.com', roles: ['admin'] });
  await pg.click('#seo-tabel-body [data-editeaza="/"]');
  const dez = await pg.$eval('#seo-panou-tab [data-act="salveaza"]', (b) => b.disabled);
  const status = await pg.textContent('#seo-status');
  verifica(dez && /doar de citire/.test(status), `citire: butoanele dezactivate, „doar de citire” (${status})`);
  verifica(!pg.erori.length, `citire: 0 erori JS (${pg.erori.join(' | ')})`);
  await ctx.close();
}

module.exports.ruleaza = async function () {
  const srv = await porneste(0);
  const baza = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  try {
    if (ruleaza('T') || ruleaza('O') || ruleaza('C')) await testTaburi(browser, baza);
    if (ruleaza('T')) await testCitire(browser, baza);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
};

if (require.main === module) {
  setTimeout(() => module.exports.ruleaza().catch((e) => { console.error(e); process.exit(1); }), 0);
}
