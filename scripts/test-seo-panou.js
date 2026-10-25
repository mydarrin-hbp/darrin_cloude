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
//   M. seo-meta.js pe o pagină publică: titlul / descrierea pe limbă, reaplicate la myd:lang;
// Rulare: node scripts/test-seo-panou.js   (DOAR=T|O|C|M, CAPTURI=<folder>)

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
      ed.querySelectorAll('input:not([type=hidden]),textarea,select,button,[role=tab],.seo-card,.seo-media-cutie,.seo-sim').forEach((e) => {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const st = getComputedStyle(e);
        if (st.visibility === 'hidden' || st.display === 'none') return;
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
    const ies = await pg.$$eval('#seo-tabel-body [data-editeaza]', (l) => l.filter((b) => { const r = b.getBoundingClientRect(); return r.right > document.documentElement.clientWidth + 1; }).length);
    verifica(ies === 0, `${w}×${h}: butoanele „Editează” încap în ecran (${ies} ies)`);
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

    if (ruleaza('C')) await testCampanii(pg, et, w);

    verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
    await ctx.close();
  }
}

// Un videoclip WebM real, 9:16 (720 × 1280), înregistrat în pagină din canvas (MediaRecorder).
let VIDEO_9_16 = null;
async function video916(pg) {
  if (VIDEO_9_16) return VIDEO_9_16;
  const b64 = await pg.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 720; c.height = 1280;
    const x = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(25), { mimeType: 'video/webm' });
    const bucati = [];
    rec.ondataavailable = (e) => { if (e.data.size) bucati.push(e.data); };
    const gata = new Promise((ok) => { rec.onstop = ok; });
    rec.start(100);
    const t0 = performance.now();
    await new Promise((ok) => { (function f() { const t = performance.now() - t0; x.fillStyle = `hsl(${t / 3 % 360},80%,50%)`; x.fillRect(0, 0, 720, 1280); x.fillStyle = '#fff'; x.fillRect(100 + t / 4, 600, 120, 120); if (t < 900) requestAnimationFrame(f); else ok(); })(); });
    rec.stop();
    await gata;
    const buf = new Uint8Array(await new Blob(bucati, { type: 'video/webm' }).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  });
  VIDEO_9_16 = Buffer.from(b64, 'base64');
  return VIDEO_9_16;
}
async function asteaptaMesaj(pg, sel, re, ms = 8000) {
  await pg.waitForFunction(([s, r]) => new RegExp(r).test((document.querySelector(s) || {}).textContent || ''), [sel, re.source], { timeout: ms }).catch(() => {});
  return pg.$eval(sel, (e) => e.textContent).catch(() => '');
}

async function testCampanii(pg, et, w) {
  await pg.click('#seo-tab-campanii');
  await pg.waitForSelector('[data-act="noua"]', { timeout: 8000 }).catch(() => {});
  verifica(/Nicio campanie/.test(await pg.textContent('#seo-panou-tab')), `${et}: C — lista goală la început`);
  await pg.click('[data-act="noua"]');
  // Formularul pornește gol (nimic completat în locul lui LM)
  const goale = await pg.$$eval('#cc-form input[type=text], #cc-form textarea, #cc-form input[type=url]', (l) => l.every((x) => x.value === ''));
  verifica(goale, `${et}: C — câmpurile campaniei noi pornesc goale`);
  verifica((await pg.$$eval('.seo-platforme input', (l) => l.map((x) => x.value))).join(',') === 'facebook,instagram,tiktok,youtube,general_patrat,vertical_mobil', `${et}: C — cele 6 platforme`);
  const cta = await pg.$$eval('#cc-cta option', (o) => o.slice(1).map((x) => x.textContent));
  verifica(JSON.stringify(cta) === JSON.stringify(['Află mai multe / Learn more', 'Înscrie-te / Sign up', 'Contactează-ne / Contact us', 'Programează / Book now', 'Cere ofertă / Get quote', 'Cumpără / Shop now', 'Descarcă / Download']), `${et}: C — CTA cu etichetele RO / EN`);
  await pg.click('[data-act="salveaza"]');
  const lipsa = await asteaptaMesaj(pg, '#cc-msg', /Completați/);
  verifica(/Numele campaniei/.test(lipsa) && DB.tabele.seo_campanii_social.length === 0, `${et}: C — fără nume: câmpul marcat, nimic salvat (${lipsa})`);

  await pg.fill('#cc-nume_campanie', 'Lansare DE TEST');
  await pg.check('.seo-platforme input[value="facebook"]');
  await pg.check('.seo-platforme input[value="tiktok"]');
  await pg.fill('#cc-titlu_reclama', 'T'.repeat(41));
  let ct = await pg.$eval('[data-cc-contor="titlu_reclama"]', (e) => [e.textContent, e.className]);
  verifica(ct[0] === 'Meta 41 / 40' && /rosu/.test(ct[1]), `${et}: C — contorul titlului roșu peste Meta 40 (${ct})`);
  await pg.fill('#cc-titlu_reclama', 'Servicii la tine acasă DE TEST');
  ct = await pg.$eval('[data-cc-contor="titlu_reclama"]', (e) => [e.textContent, e.className]);
  verifica(/verde/.test(ct[1]), `${et}: C — contorul titlului verde (${ct})`);
  await pg.fill('#cc-text_principal', 'x'.repeat(95));
  ct = await pg.$eval('[data-cc-contor="text_principal"]', (e) => [e.textContent, e.className]);
  verifica(ct[0] === 'Meta 95 / 125 · TikTok 95 / 100' && /galben/.test(ct[1]), `${et}: C — textul principal: Meta + TikTok, galben aproape de TikTok 100 (${ct})`);
  await pg.fill('#cc-text_principal', 'Text principal DE TEST pentru reclamă.');
  await pg.selectOption('#cc-cta', 'cere_oferta');
  await pg.fill('#cc-url_destinatie', 'https://mydarrin.homebestpal.com/despre-noi');
  await pg.fill('#cc-utm_source', 'facebook');
  await pg.fill('#cc-utm_campaign', 'lansare-oct');
  verifica((await pg.textContent('#cc-link-final')) === 'https://mydarrin.homebestpal.com/despre-noi?utm_source=facebook&utm_campaign=lansare-oct', `${et}: C — linkul final cu UTM`);
  const sim = await pg.evaluate(() => ({ meta: document.querySelector('.sim-meta .sim-bara-text strong').textContent, cta: document.querySelector('.sim-meta .sim-cta').textContent, v: !!document.querySelector('.sim-vertical .seo-zona-sigura'), p: !!document.querySelector('.sim-player') }));
  verifica(sim.meta === 'Servicii la tine acasă DE TEST' && sim.cta === 'Cere ofertă' && sim.v && sim.p, `${et}: C — previzualizările Meta / vertical / player, cu textele introduse (${JSON.stringify(sim)})`);
  await pg.click('[data-act="salveaza"]');
  await asteaptaMesaj(pg, '#cc-msg', /creată/);
  const c = DB.tabele.seo_campanii_social[0];
  verifica(c && c.nume_campanie === 'Lansare DE TEST' && c.limba === 'ro' && c.stare === 'ciorna' && c.cta === 'cere_oferta' && c.utm_campaign === 'lansare-oct', `${et}: C — campania creată ca ciornă RO`);
  await pg.waitForSelector('[data-zona-media="imagine_patrat"] input[type=file]', { timeout: 5000 }).catch(() => {});
  verifica((await pg.$$('[data-zona-media]')).length === 6, `${et}: C — cele 6 containere de materiale`);
  const rap = await pg.$$eval('[data-zona-media] .seo-media-cutie', (l) => l.map((e) => { const r = e.getBoundingClientRect(); return Math.round(r.width / r.height * 100) / 100; }));
  verifica(Math.abs(rap[0] - 1) < 0.03 && Math.abs(rap[1] - 0.8) < 0.03 && Math.abs(rap[2] - 1.91) < 0.04 && Math.abs(rap[3] - 0.5625) < 0.03 && Math.abs(rap[4] - 1.778) < 0.04, `${et}: C — containerele păstrează raportul (${rap})`);

  // Imagine cu raport greșit → refuzată în browser, fără încărcare
  const nInainte = INCARCATE.size;
  await pg.setInputFiles('[data-input-media="imagine_feed_4x5"]', { name: 'patrat.png', mimeType: 'image/png', buffer: await imagine(pg, 1080, 1080) });
  const m45 = await asteaptaMesaj(pg, '[data-zona-media="imagine_feed_4x5"] .seo-media-msg', /4:5/);
  verifica(/nu e 4:5/.test(m45) && INCARCATE.size === nInainte, `${et}: C — 1080 × 1080 la Feed 4:5: refuzat în browser, cu mesaj (${m45})`);
  // Pătrat corect
  await pg.setInputFiles('[data-input-media="imagine_patrat"]', { name: 'patrat.png', mimeType: 'image/png', buffer: await imagine(pg, 1080, 1080) });
  const mp = await asteaptaMesaj(pg, '[data-zona-media="imagine_patrat"] .seo-media-msg', /Încărcat/);
  verifica(/Încărcat \(1080 × 1080/.test(mp) && !!(await pg.$('[data-zona-media="imagine_patrat"] .seo-media-cutie img')), `${et}: C — pătratul 1080 × 1080 încărcat, cu previzualizare (${mp})`);
  // Video 9:16 corect → previzualizare cu zona sigură
  await pg.setInputFiles('[data-input-media="video_vertical"]', { name: 'vertical.webm', mimeType: 'video/webm', buffer: await video916(pg) });
  const mv = await asteaptaMesaj(pg, '[data-zona-media="video_vertical"] .seo-media-msg', /Încărcat|nu|Nu/, 15000);
  const zv = await pg.evaluate(() => {
    const z = document.querySelector('[data-zona-media="video_vertical"]');
    const v = z && z.querySelector('video');
    const s = z && z.querySelector('.seo-zona-sigura');
    const cut = z && z.querySelector('.seo-media-cutie').getBoundingClientRect();
    const sus = s && s.querySelector('.sus').getBoundingClientRect(), jos = s && s.querySelector('.jos').getBoundingClientRect();
    return { v: !!v, muted: v && v.muted, s: !!s, sus: sus && Math.round(sus.height / cut.height * 100), jos: jos && Math.round(jos.height / cut.height * 100) };
  });
  verifica(/Încărcat \(720 × 1280/.test(mv) && zv.v && zv.muted && zv.s && zv.sus === 14 && zv.jos === 20, `${et}: C — video 9:16: încărcat, redare fără sunet, zona sigură 14 % / 20 % (${mv} ${JSON.stringify(zv)})`);
  const media = DB.tabele.seo_campanii_social[0].media;
  verifica(media.video_vertical && media.video_vertical.mime === 'video/webm' && media.video_vertical.latime === 720 && media.imagine_patrat && media.imagine_patrat.cale === `despre-noi/ro/${c.id}/imagine_patrat.png`, `${et}: C — metadatele în media (${JSON.stringify(media)})`);
  verifica(!!(await pg.$('.sim-vertical video')) && !!(await pg.$('.sim-meta .sim-cutie img')), `${et}: C — materialele apar în previzualizările platformelor`);

  // Activare (materialele Facebook + TikTok există)
  await pg.selectOption('#cc-stare', 'activa');
  await pg.click('[data-act="salveaza"]');
  const ma = await asteaptaMesaj(pg, '#cc-msg', /salvată/);
  verifica(DB.tabele.seo_campanii_social[0].stare === 'activa' && /activă/.test(ma), `${et}: C — ciornă → activă (${ma})`);

  // Export: .zip cu texte.txt + materialele
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 15000 }), pg.click('[data-act="export"]')]);
  const zip = require('fs').readFileSync(await dl.path());
  const nume = zip.toString('latin1');
  verifica(dl.suggestedFilename() === 'campanie-despre-noi-ro-lansare-de-test.zip' && zip.readUInt32LE(0) === 0x04034B50 && nume.includes('texte.txt') && nume.includes('imagine_patrat.png') && nume.includes('video_vertical.webm')
    && zip.includes(INCARCATE.get(`campanii-media/despre-noi/ro/${c.id}/video_vertical.webm`)), `${et}: C — exportul .zip: texte.txt + materialele (${dl.suggestedFilename()}, ${zip.length} B)`);
  if (w === 1440 || w === 390) await captura(pg, `seo-tab-campanii-${w}`);
  const g = await geometrie(pg);
  verifica(!g, `${et}: C — nimic în afara ecranului (${g})`);

  // Duplică pentru EN → ciornă EN, texte goale
  await pg.click('[data-act="duplica-en"]');
  await asteaptaMesaj(pg, '#cc-msg', /creată/);
  const en = DB.tabele.seo_campanii_social.find((x) => x.limba === 'en');
  const f = await pg.evaluate(() => ({ t: document.getElementById('cc-titlu_reclama').value, n: document.getElementById('cc-nume_campanie').value, en: document.querySelector('[data-cc-limba="en"]').getAttribute('aria-pressed'), cta: document.querySelector('.sim-meta .sim-cta').textContent }));
  verifica(en && en.nume_campanie === 'Lansare DE TEST (EN)' && en.titlu_reclama === null && f.t === '' && f.n === 'Lansare DE TEST (EN)' && f.en === 'true' && f.cta === 'Get quote',
    `${et}: C — „Duplică pentru EN”: ciornă EN, textele goale, CTA în engleză în previzualizare (${JSON.stringify(f)})`);
  await pg.click('[data-act="inapoi"]');
  const lista = await pg.$$eval('.seo-tabel-campanii tbody tr', (t) => t.map((r) => r.children[1].textContent + ':' + r.children[3].textContent));
  verifica(lista.length === 2 && lista.includes('RO:Activă') && lista.includes('EN:Ciornă'), `${et}: C — lista: RO activă, EN ciornă (${lista})`);
  const g2 = await geometrie(pg);
  verifica(!g2, `${et}: C — lista: nimic în afara ecranului (${g2})`);
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

// M. seo-meta.js pe o pagină publică: titlul / descrierea pe limbă (ro → RO, altfel EN),
// reaplicate la schimbarea limbii (myd:lang); fără suprascriere → textul static.
async function testPaginaPublica(browser, baza) {
  const apiPublic = require(path.join(RADACINA, 'api/public/seo-config.js'));
  reset();
  DB.tabele.seo_config = [
    { id: 'a', page_path: '/despre-noi', limba: 'ro', meta_title: 'Titlu RO DE TEST', meta_description: 'Descriere RO DE TEST' },
    { id: 'b', page_path: '/despre-noi', limba: 'en', meta_title: 'EN TEST title' },
  ];
  for (const [lang, titlu, desc] of [['ro', 'Titlu RO DE TEST', 'Descriere RO DE TEST'], ['en', 'EN TEST title', null], ['de', 'EN TEST title', null]]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript((l) => { try { localStorage.setItem('myd_lang_v1', l); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 })); } catch (e) {} }, lang);
    await ctx.route(/\.supabase\.co\//, (r) => r.abort());
    const cereri = [];
    await ctx.route(/\/api\/public\/seo-config/, async (r) => {
      const url = new URL(r.request().url());
      cereri.push(url.searchParams.get('lang'));
      const res = raspuns();
      await apiPublic(cerere({ query: Object.fromEntries(url.searchParams) }), res);
      return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp) });
    });
    const pg = await ctx.newPage();
    const erori = [];
    pg.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
    await pg.goto(baza + '/despre-noi', { waitUntil: 'networkidle' });
    await pg.waitForFunction((t) => document.title === t, titlu, { timeout: 5000 }).catch(() => {});
    const st = await pg.evaluate(() => ({ t: document.title, d: (document.querySelector('meta[name="description"]') || {}).content }));
    verifica(st.t === titlu, `M ${lang}: titlul ${titlu} (${st.t}; cereri lang=${cereri})`);
    verifica(cereri.length && cereri.every((l) => l === (lang === 'ro' ? 'ro' : 'en')), `M ${lang}: seo-meta cere lang=${lang === 'ro' ? 'ro' : 'en'} (${cereri})`);
    if (desc) verifica(st.d === desc, `M ${lang}: descrierea suprascrisă (${st.d})`);
    else verifica(st.d && st.d !== 'Descriere RO DE TEST', `M ${lang}: fără descriere EN → descrierea statică / tradusă, nu cea RO (${st.d})`);
    if (lang === 'ro') {
      // Schimbarea limbii din antet (evenimentul myd:lang) → reaplicat pe EN.
      await pg.evaluate(() => { document.documentElement.lang = 'en'; window.dispatchEvent(new CustomEvent('myd:lang', { detail: { lang: 'en' } })); });
      await pg.waitForFunction(() => document.title === 'EN TEST title', null, { timeout: 5000 }).catch(() => {});
      const d2 = await pg.evaluate(() => ({ t: document.title, d: document.querySelector('meta[name="description"]').content }));
      verifica(d2.t === 'EN TEST title' && d2.d !== 'Descriere RO DE TEST', `M: la myd:lang en se reaplică varianta EN, descrierea RO revine la cea statică (${JSON.stringify(d2)})`);
    }
    verifica(!erori.length, `M ${lang}: 0 erori JS (${erori.join(' | ')})`);
    await ctx.close();
  }
}

module.exports.ruleaza = async function () {
  const srv = await porneste(0);
  const baza = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  try {
    if (ruleaza('T') || ruleaza('O') || ruleaza('C')) await testTaburi(browser, baza);
    if (ruleaza('T')) await testCitire(browser, baza);
    if (ruleaza('M')) await testPaginaPublica(browser, baza);
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
