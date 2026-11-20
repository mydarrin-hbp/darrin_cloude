// scripts/test-pagini-destinatie-backoffice.js
// Pasul 12-L1 (19 nov. 2026): tabul „Pagini de destinație” din
// mydarrin-superadmin.html → SEO (seo-panou-landing.js; macheta L1.5), în
// browser (Playwright), cu handler-ul real (api/admin/seo-landing.js) peste
// Supabase-ul simulat și stocarea simulată (încărcarea pe adresa semnată e
// interceptată, conținutul real e verificat de server). Nimic nu ajunge la producție.
//   1. lista celor 7 pagini; „Implicită” pornește de la textele din pagină;
//   2. varianta nouă „instalatori” (utm_campaign), RO + EN, contoarele;
//   3. salvarea ciornei: „Se salvează…” → „✓ Salvat” + mesaj verde (MDFeedback);
//      limita depășită → refuz, mesaj roșu, câmpul marcat, valorile rămân;
//   4. publicarea fără EN → refuzată cu mesaj clar și tabul „English” deschis;
//      cu RO + EN → publicată (v1); a doua publicare (v2); istoricul; revenirea
//      la v1 (fereastra proprie MDFeedback.confirma, nu confirm()) → v3;
//   5. previzualizarea telefon / desktop (textele ciornei, stilul real);
//      linkul pentru reclamă /parteneri/servicii?utm_campaign=instalatori&profesie=instalator, copiat;
//   6. imaginea: un PNG 2400 × 1350 → WebP în browser (≤ 1600 px, ≤ 300 KB, 3 mărimi),
//      încărcat, verificat de server, afișat;
//   7. doar citire: butoanele dezactivate; 0 erori JS; fără alert( / confirm( în cod;
//      la 1440 și 390 px nimic în afara ecranului.
// Rulare: node scripts/test-pagini-destinatie-backoffice.js   (CAPTURI=<dosar> → capturile „dupa-backoffice-*”)

const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
require('./landing-rpc-simulat').instaleaza(DB);
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

process.env.SUPABASE_URL = 'https://abcdefgh.supabase.co';
process.env.SITE_URL = 'https://mydarrin.homebestpal.com';
const API = { '/api/admin/seo-landing': require(path.join(RADACINA, 'api/admin/seo-landing.js')), '/api/admin/seo': require(path.join(RADACINA, 'api/admin/seo.js')) };

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const CAPTURI = process.env.CAPTURI || '';
async function captura(pg, nume) { if (CAPTURI) { fs.mkdirSync(CAPTURI, { recursive: true }); await pg.screenshot({ path: path.join(CAPTURI, nume + '.png'), fullPage: false }); } }

function reset() {
  DB.tabele = {
    profiles: [{ id: 'sup', email: 'super@example.com', roles: ['superadmin'] }, { id: 'cit', email: 'cit@example.com', roles: ['admin'] }],
    admin_permissions: [{ admin_id: 'cit', sectiune: 'seo', poate_scrie: false }],
    audit_log: [], seo_config: [], seo_campanii_social: [], backoffice_config: [], landing_continut: [], landing_continut_istoric: [],
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
  // Clipboard simulat (Chromium headless fără permisiune).
  window.__copiat = null;
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copiat = t; } } }); } catch (e) {}
  // Fără ferestrele native ale browserului: orice apel ar fi o eroare.
  window.alert = () => { throw new Error('alert() folosit'); };
  window.confirm = () => { throw new Error('confirm() folosit'); };
}

const INCARCATE = new Map();
globalThis.fetch = async (url) => {
  const m = /^https:\/\/sim\.supabase\/sign\/(.+?)\?/.exec(String(url));
  const b = m && INCARCATE.get(decodeURIComponent(m[1]));
  if (!b) return new Response('nu', { status: 404 });
  return new Response(b.subarray(0, 64), { status: 206, headers: { 'content-range': `bytes 0-63/${b.length}` } });
};

async function deschide(browser, baza, w, h, user = { id: 'sup', email: 'super@example.com', roles: ['superadmin'] }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1024 });
  await ctx.addInitScript(sesiuneAdmin, user);
  await ctx.route(/\.supabase\.co\//, (r) => {
    const m = /\/storage\/v1\/object\/public\/(.+)$/.exec(new URL(r.request().url()).pathname);
    const b = m && INCARCATE.get(decodeURIComponent(m[1]));
    return b ? r.fulfill({ status: 200, contentType: 'image/webp', body: b }) : r.abort();
  });
  await ctx.route(/^https:\/\/sim\.supabase\//, async (r) => {
    const req = r.request();
    if (req.method() === 'PUT' || req.method() === 'POST') {
      const cheie = decodeURIComponent(new URL(req.url()).pathname.replace(/^\/upload\//, ''));
      INCARCATE.set(cheie, req.postDataBuffer());
      const [bucket, ...rest] = cheie.split('/');
      (DB.storage[bucket] = DB.storage[bucket] || new Set()).add(rest.join('/'));
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"ok"}' });
    }
    return r.fulfill({ status: 404, body: '' });
  });
  await ctx.route(/\/api\//, async (r) => {
    const req = r.request(), url = new URL(req.url()), api = API[url.pathname];
    if (url.pathname === '/api/public/profesii') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, profesii: [{ slug: 'instalator', denumire_ro: 'Instalator' }, { slug: 'electrician', denumire_ro: 'Electrician' }] }) });
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
  await pg.waitForTimeout(300);
  await pg.evaluate(() => window.showPanel('seo'));
  await pg.click('#seo-sec-landing');
  await pg.waitForSelector('#lp-bo-form', { timeout: 10000 });
  return { ctx, pg };
}

const RO = { eticheta: 'Parteneri de servicii · Instalatori', titlu: 'Instalator? Primește comenzi în zona ta.', subtitlu: 'Clienții comandă și plătesc în platformă. Tu vezi suma ta înainte să accepți.',
  beneficiu_1: 'Comenzi alocate automat în orașul tău', beneficiu_2: 'Plata e păstrată ca garanție până termini lucrarea', beneficiu_3: '100% din manoperă rămâne la tine', buton: 'Devino partener', sub_buton: 'Gratuit · contul în 60 de secunde' };
const EN = { eticheta: 'Service partners · Plumbers', titlu: 'Plumber? Get jobs in your area.', subtitlu: 'Clients order and pay on the platform. You see your amount before you accept.',
  beneficiu_1: 'Jobs assigned automatically in your city', beneficiu_2: 'Payment held as a guarantee until the job is done', beneficiu_3: '100% of the labour stays with you', buton: 'Become a partner', sub_buton: 'Free · account in 60 seconds' };

async function completeaza(pg, limba, t) {
  for (const [k, v] of Object.entries(t)) await pg.fill(`#lp-bo-${limba}-${k}`, v);
}
async function rezultat(pg, buton) {
  await pg.waitForFunction((b) => { const el = document.querySelector(b); return el && !/Se (salvează|publică|încarcă|revine|creează|șterge|copiază)/.test(el.textContent); }, buton, { timeout: 15000 }).catch(() => {});
  return pg.evaluate(() => { const m = document.getElementById('lp-bo-msg'); return { text: m ? m.innerText.trim() : '', clasa: m ? m.innerHTML : '' }; });
}

(async () => {
  reset();
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    const { ctx, pg } = await deschide(browser, baza, 1440, 900);
    // 1. Lista
    const pagini = await pg.$$eval('.lp-bo-pagina', (b) => b.map((x) => x.getAttribute('data-pagina')));
    verifica(pagini.length === 7 && pagini.includes('/investitori') && pagini.includes('/parteneri/asigurari'), '1. lista celor 7 pagini: ' + pagini.join(', '));
    await pg.click('[data-pagina="/parteneri/servicii"]');
    await pg.waitForSelector('#lp-bo-ro-titlu');
    verifica(await pg.inputValue('#lp-bo-ro-titlu') === 'Meseriaș? Primește comenzi în zona ta.', '1. „Implicită” pornește de la titlul din pagină');
    await pg.waitForFunction(() => { const f = document.getElementById('lp-bo-iframe'); return f && f.contentDocument && f.contentDocument.querySelector('.lp-titlu'); }, null, { timeout: 5000 }).catch(() => {});
    await pg.waitForTimeout(300);
    await captura(pg, 'dupa-backoffice-lista');
    // 2. Varianta nouă
    await pg.click('[data-act="varianta-noua"]');
    await pg.fill('#lp-bo-nou-nume', 'Instalatori');
    await pg.click('[data-act="creeaza-varianta"]');
    await pg.waitForSelector('[data-varianta="instalatori"][aria-pressed="true"]', { timeout: 10000 }).catch(() => {});
    verifica(await pg.$('[data-varianta="instalatori"][aria-pressed="true"]') !== null, '2. varianta „instalatori” creată (numele cu litere mici) și deschisă');
    await completeaza(pg, 'ro', RO);
    await pg.fill('#lp-bo-profesie', 'instalator');
    const contor = await pg.textContent('#lp-bo-form [data-contor="titlu"]');
    verifica(/^40 \/ 60$/.test(contor.trim()), '2. contorul titlului: ' + contor);
    // 3. Limita depășită → refuz, valorile rămân
    await pg.fill('#lp-bo-ro-buton', 'Devino partener chiar acum, gratuit');
    await pg.click('[data-act="salveaza"]');
    let r = await rezultat(pg, '[data-act="salveaza"]');
    const subCamp = await pg.evaluate(() => { const el = document.getElementById('lp-bo-ro-buton'); const id = el.getAttribute('aria-describedby'); const m = id && document.getElementById(id); return m ? m.textContent : ''; });
    verifica(/Textul butonului \(RO\)/.test(r.text) && /nu s-a|corectați|✕/i.test(r.text), '3. textul butonului peste 24: refuzat, mesaj roșu cu câmpul: ' + r.text.replace(/\s+/g, ' ').slice(0, 120));
    verifica(await pg.getAttribute('#lp-bo-ro-buton', 'aria-invalid') === 'true' && /maximum 24/.test(subCamp), '3. câmpul marcat (aria-invalid), sub el: ' + subCamp);
    verifica(await pg.inputValue('#lp-bo-ro-titlu') === RO.titlu, '3. valorile introduse rămân');
    await pg.fill('#lp-bo-ro-buton', RO.buton);
    await pg.click('[data-act="salveaza"]');
    r = await rezultat(pg, '[data-act="salveaza"]');
    verifica(/salvată/.test(r.text), '3. ciorna salvată, mesaj verde: ' + r.text.slice(0, 100));
    verifica(DB.tabele.landing_continut.filter((x) => x.varianta === 'instalatori' && x.stare === 'ciorna').length === 2, '3. ciorna RO + EN în bază');
    // 4. Publicarea fără EN (EN e copia implicitei; se golește un câmp EN obligatoriu)
    await pg.click('#lp-bo-tab-en');
    await pg.fill('#lp-bo-en-buton', '');
    await pg.click('#lp-bo-tab-ro');
    await pg.click('[data-act="publica"]');
    r = await rezultat(pg, '[data-act="publica"]');
    verifica(/RO și EN complete/.test(r.text) && /English/.test(r.text), '4. publicarea fără EN: refuzată, mesaj clar: ' + r.text.slice(0, 160));
    verifica(await pg.getAttribute('#lp-bo-tab-en', 'aria-selected') === 'true' && await pg.getAttribute('#lp-bo-en-buton', 'aria-invalid') === 'true', '4. tabul „English” deschis, câmpul gol marcat');
    verifica(!DB.tabele.landing_continut.some((x) => x.stare === 'publicat'), '4. nimic publicat');
    await completeaza(pg, 'en', EN);
    await pg.click('[data-act="publica"]');
    r = await rezultat(pg, '[data-act="publica"]');
    verifica(/Publicată: v1/.test(r.text), '4. publicată v1: ' + r.text.slice(0, 100));
    await captura(pg, 'dupa-backoffice-editor');
    await pg.click('#lp-bo-tab-ro');
    await pg.fill('#lp-bo-ro-titlu', 'Instalator? Comenzi noi în orașul tău.');
    await pg.click('[data-act="publica"]');
    r = await rezultat(pg, '[data-act="publica"]');
    verifica(/Publicată: v2/.test(r.text), '4. a doua publicare: v2');
    await pg.click('[data-act="istoric"]');
    const ist = await pg.$$eval('[data-revino]', (b) => b.map((x) => x.getAttribute('data-revino')));
    verifica(ist.join(',') === '1', '4. istoricul: v1 (' + ist.join(',') + ')');
    await captura(pg, 'dupa-backoffice-istoric');
    await pg.click('[data-revino="1"]');
    await pg.waitForSelector('.md-confirma, [role="alertdialog"], [role="dialog"]', { timeout: 5000 }).catch(() => {});
    const dialog = await pg.$('[role="alertdialog"], [role="dialog"]');
    verifica(!!dialog, '4. revenirea cere confirmarea în fereastra proprie (MDFeedback.confirma)');
    if (dialog) await dialog.$$eval('button', (b) => { const x = b.find((y) => /Revino la v1/.test(y.textContent)); if (x) x.click(); });
    await pg.waitForFunction(() => /v3/.test((document.querySelector('.lp-bo-cap') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    verifica(await pg.inputValue('#lp-bo-ro-titlu') === RO.titlu && /v3/.test(await pg.textContent('.lp-bo-cap')), '4. revenirea la v1: publicată ca v3, ciorna are textele v1');
    // 5. Previzualizarea și linkul
    const previzTitlu = await pg.frameLocator('#lp-bo-iframe').locator('.lp-titlu').textContent();
    verifica(previzTitlu === RO.titlu, '5. previzualizarea (telefon) arată titlul ciornei: ' + previzTitlu);
    const latTel = await pg.$eval('#lp-bo-iframe', (f) => f.style.width);
    await pg.click('[data-previz="desktop"]');
    await pg.waitForTimeout(400);
    const latDesk = await pg.$eval('#lp-bo-iframe', (f) => f.style.width);
    verifica(latTel === '390px' && latDesk === '1280px', `5. telefon ${latTel} / desktop ${latDesk}`);
    await captura(pg, 'dupa-backoffice-previzualizare');
    const link = await pg.inputValue('#lp-bo-link');
    verifica(link === 'https://mydarrin.homebestpal.com/parteneri/servicii?utm_campaign=instalatori&profesie=instalator', '5. linkul pentru reclamă: ' + link);
    await pg.click('[data-act="copiaza-link"]');
    await pg.waitForTimeout(500);
    verifica(await pg.evaluate(() => window.__copiat) === link, '5. linkul copiat');
    // 6. Imaginea
    const png = await pg.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 2400; c.height = 1350;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 2400, 1350); g.addColorStop(0, '#003366'); g.addColorStop(1, '#FF8C00');
      x.fillStyle = g; x.fillRect(0, 0, 2400, 1350);
      for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${i * 7 % 360},60%,60%)`; x.fillRect((i * 97) % 2400, (i * 53) % 1350, 60, 40); }
      const b = await new Promise((ok) => c.toBlob(ok, 'image/png'));
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    });
    const fis = path.join(require('os').tmpdir(), 'lp-test-' + process.pid + '.png');
    fs.writeFileSync(fis, Buffer.from(png));
    await pg.setInputFiles('#lp-bo-fisier', fis);
    await pg.waitForFunction(() => /Încărcat|Nu s-a/.test((document.querySelector('[data-act="alege-imagine"]') || {}).textContent || '') || !!document.querySelector('.lp-bo-miniatura[src]'), null, { timeout: 30000 }).catch(() => {});
    await pg.waitForTimeout(500);
    fs.unlinkSync(fis);
    const mesajImagine = await pg.evaluate(() => [(document.getElementById('lp-bo-imagine-msg') || {}).textContent, Array.from(document.querySelectorAll('[class*="toast"], [role="alert"]')).map((x) => x.textContent.trim()).join(' | ')].join(' || '));
    const im = DB.tabele.landing_continut.find((x) => x.varianta === 'instalatori' && x.stare === 'ciorna' && x.limba === 'ro');
    const fisiere = Array.from((DB.storage['seo-og'] || new Set()));
    verifica(im && im.imagine_latime === 1600 && im.imagine_inaltime === 900 && Array.isArray(im.imagine_variante) && im.imagine_variante.length === 3,
      `6. imaginea 2400 × 1350 → WebP 1600 × 900, 3 mărimi (${im && im.imagine_latime} × ${im && im.imagine_inaltime}, ${im && JSON.stringify((im.imagine_variante || []).map((v) => v.w))}; mesaj: ${mesajImagine.slice(0, 200)})`);
    const marimi = fisiere.map((c) => INCARCATE.get('seo-og/' + c)).filter(Boolean).map((b) => b.length);
    verifica(marimi.length === 3 && marimi.every((n) => n <= 300 * 1024) && fisiere.every((c) => /^landing\/parteneri-servicii\/instalatori\/[a-f0-9]{12}-(480|800|1600)\.webp$/.test(c)),
      `6. fișierele în seo-og/landing/…, fiecare ≤ 300 KB (${marimi.join(', ')} B)`);
    verifica(fisiere.every((c) => { const b = INCARCATE.get('seo-og/' + c); return b && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'; }), '6. conținutul e WebP');
    verifica(await pg.$('.lp-bo-miniatura[src]') !== null, '6. miniatura apare în editor');
    verifica(!pg.erori.length, '0 erori JS: ' + pg.erori.join(' | '));
    const geom = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    verifica(geom <= 1, '1440 px: fără derulare laterală (' + geom + ')');
    await ctx.close();
    // 7. 390 px și doar citire
    const mobil = await deschide(browser, baza, 390, 844);
    await mobil.pg.click('[data-pagina="/parteneri/servicii"]');
    await mobil.pg.waitForSelector('[data-varianta="instalatori"]');
    await mobil.pg.click('[data-varianta="instalatori"]');
    await mobil.pg.waitForTimeout(500);
    const lat = await mobil.pg.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const afara = Array.from(document.querySelectorAll('#seo-landing *')).filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > W + 1) && !e.closest('.lp-bo-pagini, .lp-bo-ecran, .seo-tabel-cutie'); }).map((e) => e.tagName + '.' + e.className).slice(0, 5);
      return { lateral: document.documentElement.scrollWidth - W, afara };
    });
    verifica(lat.lateral <= 1 && !lat.afara.length, '7. 390 px: nimic în afara ecranului (' + JSON.stringify(lat) + ')');
    await captura(mobil.pg, 'dupa-backoffice-editor-390');
    verifica(!mobil.pg.erori.length, '7. 390 px: 0 erori JS: ' + mobil.pg.erori.join(' | '));
    await mobil.ctx.close();
    const cit = await deschide(browser, baza, 1440, 900, { id: 'cit', email: 'cit@example.com', roles: ['admin'] });
    const dez = await cit.pg.$$eval('[data-act="salveaza"], [data-act="publica"], [data-act="varianta-noua"], [data-act="alege-imagine"]', (b) => b.map((x) => x.disabled));
    verifica(dez.length === 4 && dez.every(Boolean), '7. doar citire: salvarea, publicarea, varianta nouă și imaginea dezactivate');
    await cit.ctx.close();
    // Codul nou nu folosește ferestrele native.
    const cod = fs.readFileSync(path.join(RADACINA, 'seo-panou-landing.js'), 'utf8');
    verifica(!/\balert\(|\bconfirm\(/.test(cod), '7. seo-panou-landing.js: fără alert( / confirm(');
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
