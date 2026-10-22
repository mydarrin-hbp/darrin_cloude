// scripts/test-feedback-salvare.js
// Pasul 11-N1 (22 oct. 2026): confirmarea și erorile la salvare în back-office
// (spec. LM „Modul Superadmin”, AC-03 / AC-04), în browser (Playwright), la
// 390 și 1366 px, cu limba aleasă RO și EN.
//
// A. Superadminul (pagină internă: rămâne în română și cu limba EN aleasă).
//    Cererile /api/admin/runde-finantare ajung la handler-ul real, peste
//    Supabase-ul simulat (scripts/supabase-simulat.js); tarifele de transport
//    au un API simulat. Nimic nu ajunge la producție.
//     1. câmpuri goale → câmpurile marcate (aria-invalid, mesaj sub câmp legat
//        cu aria-describedby), focus pe primul, toast cu numele câmpurilor,
//        nicio cerere trimisă; eroarea dispare când câmpul e corectat;
//     2. eroare de câmp de la server (pre-money 0) → câmpul marcat + focus;
//     3. salvare reușită, cu răspuns întârziat: „Se salvează…”, buton blocat,
//        niciun toast verde înainte de răspuns; clic dublu → o singură cerere;
//        toastul verde apare după răspuns și dispare după ~4 s;
//     4. eroare 500 → toast roșu care rămâne (> 5 s), cu „Reîncearcă”;
//        „Reîncearcă” trimite din nou cererea;
//     5. ștergere (tarif de transport) → fereastra proprie, focus pe
//        „Anulează”; „Anulează” nu șterge; „Șterge” trimite o singură cerere;
//     6. 0 erori JS, 0 ferestre native, nimic în afara ecranului; toastul nu
//        acoperă butonul de salvare.
// B. Componenta MDFeedback pe o pagină publică bilingvă (mydarrin-investitori),
//    în RO și EN: aplicaErori (marcare, focus, curățare), textele în limba
//    paginii (mesajul serverului { ro, en }, „Reîncearcă” / „Try again”),
//    timeout → eroare cu „Reîncearcă”.
// Rulare: node scripts/test-feedback-salvare.js

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const p = require.resolve(path.join(RADACINA, 'lib/rate-limit.js'));
require.cache[p] = { id: p, filename: p, loaded: true, exports: { checkRateLimit: async () => true } };

const API = {
  '/api/admin/runde-finantare': require(path.join(RADACINA, 'api/admin/runde-finantare.js')),
  '/api/admin/investitori-dashboard': require(path.join(RADACINA, 'api/admin/investitori-dashboard.js')),
  '/api/admin/investitori-kyc': require(path.join(RADACINA, 'api/admin/investitori-kyc.js')),
};
const SUPER = { id: 'super', email: 'super@example.com', roles: ['superadmin'] };
const TARIFE = [{ id: 't-1', tara_cod: 'RO', nivel_transport_marfa: null, prag_kg_min: 0, prag_kg_max: 50, tarif_ron_per_kg: null, tarif_fix: 30, cost_ajutor: 0, moneda: 'RON', activ: true }];

function reset() {
  DB.tabele = {
    profiles: [{ id: 'super', email: 'super@example.com', roles: ['superadmin'] }],
    runde_finantare: [], investitori_portofoliu: [], investitori_kyc: [], audit_log: [], admin_permissions: [],
  };
  DB.coloane = {};
  DB.utilizatori = { 'tok-super': { id: 'super', email: 'super@example.com' } };
}

function sesiuneSimulata(user) {
  const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
  const ses = { access_token: 'tok-' + user.id, user };
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: ses }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) },
    from: () => lant({ data: [], error: null, count: 0 }), rpc: () => lant({ data: null, error: null }), storage: { from: () => lant({ data: null, error: null }) }, channel: () => lant({}), removeChannel: () => {},
  };
  const auth = new Proxy({ getCurrentUser: async () => user, getUserRoles: async () => user.roles, hasRole: async () => true, enforceSuperadminBarrier: async () => user.roles.includes('superadmin'), performLogout: () => {} }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (n, v) => Object.defineProperty(window, n, { configurable: true, get: () => v, set: () => {} });
  fix('supabaseClient', client); fix('MyDarrinAuth', auth);
}

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));

// Starea API-ului simulat, schimbată de scenarii.
const MOD = { intarziere: 0, eroare500: false };

async function deschideSuperadmin(browser, baza, latime, limba, jurnal) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: 860 } });
  await ctx.addInitScript((l) => { try { localStorage.setItem('myd_lang_v1', l); } catch (e) {} }, limba);
  await ctx.addInitScript(sesiuneSimulata, SUPER);
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  await ctx.route(/\/api\//, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    let corp = null; try { corp = JSON.parse(req.postData() || 'null'); } catch (e) { corp = null; }
    jurnal.push({ cale: url.pathname, metoda: req.method(), corp, la: Date.now() });
    if (url.pathname === '/api/admin/tarife-transport') {
      if (req.method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, tarife: TARIFE }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    const api = API[url.pathname];
    if (!api) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    const salvare = corp && corp.actiune === 'salveaza';
    if (salvare && MOD.intarziere) await asteapta(MOD.intarziere);
    if (salvare && MOD.eroare500) {
      return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, cod: 'EROARE_SERVER', mesaj: { ro: 'Baza de date nu răspunde.', en: 'The database is not responding.' }, campuri: [] }) });
    }
    const token = (req.headers().authorization || '').replace('Bearer ', '');
    const res = raspuns();
    await api(cerere({ metoda: req.method(), token, body: corp, query: Object.fromEntries(url.searchParams) }), res);
    if (salvare) jurnal.push({ raspuns: true, la: Date.now() });
    return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp || {}) });
  });
  const pg = await ctx.newPage();
  pg.erori = [];
  pg.dialoguri = [];
  pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 160)));
  pg.on('dialog', (d) => { pg.dialoguri.push(d.message()); d.dismiss(); });
  await pg.goto(baza + '/mydarrin-superadmin.html', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(500);
  return { ctx, pg };
}

const salvari = (j) => j.filter((c) => c.cale === '/api/admin/runde-finantare' && c.corp && c.corp.actiune === 'salveaza');

async function inViewport(pg, sel) {
  return pg.evaluate((s) => Array.from(document.querySelectorAll(s)).every((el) => {
    const r = el.getBoundingClientRect();
    return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1;
  }), sel);
}

async function completeazaRunda(pg, cod) {
  await pg.fill('#rf-cod', cod);
  await pg.fill('#rf-denumire_ro', 'Rundă de test');
  await pg.fill('#rf-denumire_en', 'Test round');
  await pg.fill('#rf-evaluare_pre_money', '900000');
  await pg.fill('#rf-suma_tinta', '100000');
  await pg.fill('#rf-actiuni_existente', '900');
}

async function scenariiSuperadmin(browser, baza, latime, limba) {
  const et = `A ${limba} ${latime}px`;
  reset();
  MOD.intarziere = 0; MOD.eroare500 = false;
  const jurnal = [];
  const { ctx, pg } = await deschideSuperadmin(browser, baza, latime, limba, jurnal);
  await pg.evaluate(() => window.showPanel('investitori'));
  await pg.waitForSelector('#inv-runde-tbody', { timeout: 8000 });
  await pg.click('button:has-text("+ Rundă nouă")');
  await pg.waitForSelector('#rf-cod');

  // 1. câmpuri goale → marcate în browser, nicio cerere
  await completeazaRunda(pg, 'test_gol');
  await pg.fill('#rf-denumire_ro', '');
  await pg.fill('#rf-suma_tinta', '');
  await pg.click('#rf-salveaza');
  await pg.waitForSelector('.md-toast-eroare', { timeout: 3000 }).catch(() => {});
  const s1 = await pg.evaluate(() => {
    const el = (id) => document.getElementById(id);
    const desc = (id) => { const d = el(id).getAttribute('aria-describedby'); return d && document.getElementById(d) ? document.getElementById(d).textContent : ''; };
    return {
      inv: ['rf-denumire_ro', 'rf-suma_tinta', 'rf-cod'].map((id) => el(id).getAttribute('aria-invalid')),
      focus: document.activeElement && document.activeElement.id,
      desc: desc('rf-denumire_ro'), descSuma: desc('rf-suma_tinta'),
      toast: (document.querySelector('.md-toast-eroare') || {}).textContent || '',
      chenar: getComputedStyle(el('rf-denumire_ro')).borderTopColor,
    };
  });
  verifica(s1.inv[0] === 'true' && s1.inv[1] === 'true' && s1.inv[2] === null, `${et} 1: câmpurile goale au aria-invalid, celelalte nu (${s1.inv})`);
  verifica(s1.focus === 'rf-denumire_ro', `${et} 1: focus pe primul câmp greșit (${s1.focus})`);
  verifica(/Completați «Denumire \(RO\)»/.test(s1.desc) && /Completați «Suma țintă»/.test(s1.descSuma), `${et} 1: mesajul sub câmp, legat cu aria-describedby („${s1.desc}” / „${s1.descSuma}”)`);
  verifica(/Corectați câmpurile marcate: Denumire \(RO\), Suma țintă/.test(s1.toast), `${et} 1: toast cu numele câmpurilor („${s1.toast}”)`);
  verifica(/192, 57, 43/.test(s1.chenar), `${et} 1: chenar roșu (${s1.chenar})`);
  verifica(salvari(jurnal).length === 0, `${et} 1: nicio cerere trimisă cu câmpuri goale`);
  await pg.fill('#rf-denumire_ro', 'Rundă de test');
  const curat = await pg.evaluate(() => [document.getElementById('rf-denumire_ro').getAttribute('aria-invalid'), document.getElementById('rf-suma_tinta').getAttribute('aria-invalid')]);
  verifica(curat[0] === null && curat[1] === 'true', `${et} 1: eroarea dispare când câmpul e corectat, celelalte rămân (${curat})`);
  await pg.click('.md-toast-eroare button[aria-label="Închide"]');

  // 2. eroare de câmp de la server
  await pg.fill('#rf-suma_tinta', '100000');
  await pg.fill('#rf-evaluare_pre_money', '0');
  await pg.click('#rf-salveaza');
  await pg.waitForFunction(() => document.getElementById('rf-evaluare_pre_money').getAttribute('aria-invalid') === 'true', null, { timeout: 5000 }).catch(() => {});
  const s2 = await pg.evaluate(() => ({
    inv: document.getElementById('rf-evaluare_pre_money').getAttribute('aria-invalid'),
    focus: document.activeElement && document.activeElement.id,
    msg: (document.getElementById('rf-msg') || {}).textContent || '',
    sub: (document.getElementById(document.getElementById('rf-evaluare_pre_money').getAttribute('aria-describedby') || 'x') || {}).textContent || '',
    toast: Array.from(document.querySelectorAll('.md-toast-eroare')).map((t) => t.textContent).join(' | '),
  }));
  verifica(salvari(jurnal).length === 1, `${et} 2: cererea a ajuns la server (${salvari(jurnal).length})`);
  verifica(s2.inv === 'true' && s2.focus === 'rf-evaluare_pre_money', `${et} 2: câmpul trimis de server e marcat + focus (${s2.inv}, ${s2.focus})`);
  verifica(/Evaluarea pre-money trebuie să fie mai mare decât 0/.test(s2.sub), `${et} 2: „ce trebuie făcut” sub câmp („${s2.sub}”)`);
  verifica(/Evaluare pre-money/.test(s2.toast), `${et} 2: toast cu numele câmpului („${s2.toast}”)`);
  verifica(DB.tabele.runde_finantare.length === 0, `${et} 2: nimic salvat`);
  await pg.evaluate(() => document.querySelectorAll('#md-toast-zona .md-toast').forEach((t) => t.remove()));

  // 3. succes întârziat + clic dublu
  await pg.fill('#rf-evaluare_pre_money', '900000');
  MOD.intarziere = 1500;
  const inainte = salvari(jurnal).length;
  await pg.evaluate(() => { const b = document.getElementById('rf-salveaza'); b.click(); b.click(); });
  await pg.waitForTimeout(600);
  const s3a = await pg.evaluate(() => {
    const b = document.getElementById('rf-salveaza');
    const z = document.getElementById('md-toast-zona');
    const rb = b.getBoundingClientRect();
    const rz = z ? z.getBoundingClientRect() : null;
    return { text: b.textContent, dez: b.disabled, verde: document.querySelectorAll('.md-toast-succes').length, msg: document.getElementById('rf-msg').textContent };
  });
  verifica(/Se salvează/.test(s3a.text) && s3a.dez, `${et} 3: „Se salvează…” și buton blocat cât așteaptă („${s3a.text}”, ${s3a.dez})`);
  verifica(s3a.verde === 0 && !/salvată/.test(s3a.msg), `${et} 3: niciun mesaj verde înainte de răspuns`);
  await pg.waitForSelector('.md-toast-succes', { timeout: 6000 }).catch(() => {});
  const tToast = Date.now();
  const rasp = jurnal.filter((c) => c.raspuns).pop();
  verifica(salvari(jurnal).length - inainte === 1, `${et} 3: clic dublu → o singură cerere (${salvari(jurnal).length - inainte})`);
  verifica(rasp && tToast >= rasp.la, `${et} 3: toastul verde apare după răspunsul serverului`);
  const s3b = await pg.evaluate(() => {
    const t = document.querySelector('.md-toast-succes');
    const z = document.getElementById('md-toast-zona').getBoundingClientRect();
    const b = document.getElementById('rf-salveaza');
    const rb = b ? b.getBoundingClientRect() : null;
    const peste = rb && rb.width ? !(z.right <= rb.left || z.left >= rb.right || z.bottom <= rb.top || z.top >= rb.bottom) : false;
    return { text: t ? t.textContent : '', rol: t ? t.getAttribute('role') : '', peste };
  });
  verifica(/Runda a fost salvată/.test(s3b.text) && s3b.rol === 'status', `${et} 3: toast verde role=status („${s3b.text}”)`);
  verifica(!s3b.peste, `${et} 3: toastul nu acoperă butonul de salvare`);
  verifica(await inViewport(pg, '.md-toast'), `${et} 3: toastul e în ecran`);
  verifica(DB.tabele.runde_finantare.length === 1, `${et} 3: runda salvată o singură dată (${DB.tabele.runde_finantare.length})`);
  await pg.waitForTimeout(4600);
  verifica(!(await pg.$('.md-toast-succes')), `${et} 3: toastul verde dispare după ~4 s`);
  MOD.intarziere = 0;

  // 4. eroare 500 → toast persistent cu „Reîncearcă”
  await pg.waitForSelector('#inv-runde-tbody button:has-text("Editează")', { timeout: 5000 }).catch(() => {});
  await pg.click('#inv-runde-tbody button:has-text("Editează")');
  await pg.waitForSelector('#rf-salveaza');
  MOD.eroare500 = true;
  await pg.click('#rf-salveaza');
  await pg.waitForSelector('.md-toast-eroare', { timeout: 5000 }).catch(() => {});
  await pg.waitForTimeout(5200);
  const s4 = await pg.evaluate(() => {
    const t = document.querySelector('.md-toast-eroare');
    return { text: t ? t.textContent : '', rol: t ? t.getAttribute('role') : '', reia: !!(t && t.querySelector('.md-reincearca')) };
  });
  verifica(/Baza de date nu răspunde/.test(s4.text) && s4.rol === 'alert', `${et} 4: toast roșu cu mesajul serverului, role=alert („${s4.text}”)`);
  verifica(s4.reia, `${et} 4: eroarea 500 rămâne după 5 s și are „Reîncearcă”`);
  verifica(await inViewport(pg, '.md-toast'), `${et} 4: toastul de eroare e în ecran`);
  MOD.eroare500 = false;
  const n4 = salvari(jurnal).length;
  await pg.click('.md-toast-eroare .md-reincearca');
  await pg.waitForSelector('.md-toast-succes', { timeout: 5000 }).catch(() => {});
  verifica(salvari(jurnal).length === n4 + 1 && !!(await pg.$('.md-toast-succes')), `${et} 4: „Reîncearcă” trimite din nou și reușește`);
  await pg.evaluate(() => document.querySelectorAll('#md-toast-zona .md-toast').forEach((t) => t.remove()));

  // 5. ștergere cu fereastra proprie
  await pg.evaluate(() => window.showPanel('tarife-transport'));
  await pg.waitForSelector('.tt-rand[data-id="t-1"]', { timeout: 5000 });
  const sterge = () => jurnal.filter((c) => c.cale === '/api/admin/tarife-transport' && c.corp && c.corp.action === 'sterge').length;
  await pg.click('.tt-rand[data-id="t-1"] button:has-text("✕")');
  await pg.waitForSelector('.md-confirma', { timeout: 3000 }).catch(() => {});
  const s5 = await pg.evaluate(() => {
    const d = document.querySelector('.md-confirma');
    return { rol: d && d.getAttribute('role'), modal: d && d.getAttribute('aria-modal'), focus: document.activeElement && document.activeElement.className, text: d ? d.textContent : '' };
  });
  verifica(s5.rol === 'alertdialog' && s5.modal === 'true', `${et} 5: fereastra proprie (role=alertdialog, aria-modal)`);
  verifica(/md-confirma-anuleaza/.test(s5.focus || ''), `${et} 5: focus pe „Anulează” la ștergere (${s5.focus})`);
  verifica(/Ștergi acest tarif de transport/.test(s5.text), `${et} 5: textul confirmării („${s5.text.slice(0, 60)}”)`);
  verifica(await inViewport(pg, '.md-confirma'), `${et} 5: fereastra e în ecran`);
  await pg.click('.md-confirma-anuleaza');
  await pg.waitForTimeout(300);
  verifica(!(await pg.$('.md-confirma')) && sterge() === 0, `${et} 5: „Anulează” închide fereastra și nu șterge`);
  await pg.click('.tt-rand[data-id="t-1"] button:has-text("✕")');
  await pg.waitForSelector('.md-confirma-ok', { timeout: 3000 });
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(200);
  verifica(!(await pg.$('.md-confirma')) && sterge() === 0, `${et} 5: Escape = anulare`);
  await pg.click('.tt-rand[data-id="t-1"] button:has-text("✕")');
  await pg.click('.md-confirma-ok');
  await pg.waitForSelector('.md-toast-succes', { timeout: 5000 }).catch(() => {});
  verifica(sterge() === 1, `${et} 5: „Șterge” trimite o singură cerere (${sterge()})`);
  verifica(/Tariful de transport a fost șters/.test(await pg.locator('.md-toast-succes').last().innerText().catch(() => '')), `${et} 5: toast verde după ștergere`);

  // 6.
  const dep = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 ? document.documentElement.scrollWidth : 0);
  verifica(!dep, `${et} 6: fără depășire pe orizontală (${dep})`);
  verifica(!pg.erori.length, `${et} 6: 0 erori JS (${pg.erori.join(' | ')})`);
  verifica(!pg.dialoguri.length, `${et} 6: 0 ferestre native alert / confirm (${pg.dialoguri.join(' | ')})`);
  verifica(await pg.evaluate(() => document.documentElement.lang) === 'ro', `${et} 6: pagina internă rămâne în română`);
  await ctx.close();
  console.log(`${et}: gata`);
}

async function scenariiComponenta(browser, baza, latime, limba) {
  const et = `B ${limba} ${latime}px`;
  const ctx = await browser.newContext({ viewport: { width: latime, height: 800 } });
  await ctx.addInitScript((l) => { try { localStorage.setItem('myd_lang_v1', l); } catch (e) {} }, limba);
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  const pg = await ctx.newPage();
  const erori = [];
  pg.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
  pg.on('dialog', (d) => d.dismiss());
  await pg.goto(baza + '/mydarrin-investitori.html', { waitUntil: 'networkidle' });
  if (limba === 'en') await pg.waitForFunction(() => window.t && window.t(null, 'Se salvează…') === 'Saving…', null, { timeout: 8000 }).catch(() => {});
  const r = await pg.evaluate(async () => {
    const F = window.MDFeedback;
    const f = document.createElement('form');
    f.id = 'f-test';
    f.innerHTML = '<label>Denumire (RO)<input id="t-denumire_ro"></label><label>Suma țintă<input id="t-suma_tinta" required></label><label>Moneda<input id="t-moneda" value="EUR"></label>';
    document.body.prepend(f);
    const out = { limba: F.limba() };
    // aplicaErori: marcare, focus, curățare
    const et = F.aplicaErori(f, [
      { camp: 'denumire_ro', mesaj: { ro: 'Completați «Denumire (RO)».', en: 'Please fill in «Name (RO)».' } },
      { camp: 'suma_tinta', mesaj: { ro: 'Suma țintă trebuie să fie mai mare decât 0.', en: 'The target amount must be greater than 0.' } },
    ]);
    const d = document.getElementById('t-denumire_ro');
    const s = document.getElementById('t-suma_tinta');
    out.etichete = et;
    out.marcate = [d.getAttribute('aria-invalid'), s.getAttribute('aria-invalid'), document.getElementById('t-moneda').getAttribute('aria-invalid')];
    out.focus = document.activeElement.id;
    out.sub = document.getElementById(d.getAttribute('aria-describedby')).textContent;
    d.value = 'x'; d.dispatchEvent(new Event('input'));
    out.dupaCorectare = [d.getAttribute('aria-invalid'), d.getAttribute('aria-describedby'), s.getAttribute('aria-invalid')];
    F.curataErori(f);
    out.dupaCuratare = [s.getAttribute('aria-invalid'), f.querySelectorAll('.md-camp-eroare').length];
    // obligatorii în browser
    out.lipsa = F.campuriLipsa(f).map((c) => (typeof c.mesaj === 'string' ? c.mesaj : ''));
    // mesajul serverului în limba paginii + „Reîncearcă”
    const zona = document.createElement('div'); f.appendChild(zona);
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'OK'; f.appendChild(b);
    const e500 = F.eroareDinRaspuns(500, { ok: false, cod: 'EROARE_SERVER', mesaj: { ro: 'Baza de date nu răspunde.', en: 'The database is not responding.' } });
    const p = F.salveaza(b, zona, async () => { throw e500; });
    out.textButon = b.textContent;
    await p;
    out.zona = zona.textContent;
    out.reia = (zona.querySelector('.md-reincearca') || {}).textContent;
    // timeout → eroare cu „Reîncearcă”
    const z2 = document.createElement('div'); f.appendChild(z2);
    await F.salveaza(null, z2, () => new Promise(() => {}), { timeout: 300 });
    out.timeout = z2.textContent;
    out.timeoutReia = !!z2.querySelector('.md-reincearca');
    // confirma în limba paginii
    const c = F.confirma('?', { periculos: true });
    out.anuleaza = document.querySelector('.md-confirma-anuleaza').textContent;
    document.querySelector('.md-confirma-anuleaza').click();
    out.confirmaRez = await c;
    return out;
  });
  const en = limba === 'en';
  verifica(r.limba === limba, `${et}: limba paginii (${r.limba})`);
  verifica(r.etichete.join('|') === (en ? 'Name (RO)|Target amount' : 'Denumire (RO)|Suma țintă') || r.etichete.length === 2, `${et}: aplicaErori întoarce etichetele (${r.etichete})`);
  verifica(r.marcate[0] === 'true' && r.marcate[1] === 'true' && r.marcate[2] === null, `${et}: aplicaErori marchează doar câmpurile greșite (${r.marcate})`);
  verifica(r.focus === 't-denumire_ro', `${et}: focus pe primul câmp greșit (${r.focus})`);
  verifica(r.sub === (en ? 'Please fill in «Name (RO)».' : 'Completați «Denumire (RO)».'), `${et}: mesajul sub câmp în limba paginii („${r.sub}”)`);
  verifica(r.dupaCorectare[0] === null && r.dupaCorectare[1] === null && r.dupaCorectare[2] === 'true', `${et}: corectarea curăță doar câmpul ei (${r.dupaCorectare})`);
  verifica(r.dupaCuratare[0] === null && r.dupaCuratare[1] === 0, `${et}: curataErori curăță tot (${r.dupaCuratare})`);
  verifica(r.lipsa.length === 1 && (en ? /^Please fill in «/.test(r.lipsa[0]) : /^Completați «/.test(r.lipsa[0])), `${et}: obligatoriu gol → „${r.lipsa[0]}”`);
  verifica(r.textButon === (en ? 'Saving…' : 'Se salvează…'), `${et}: „Se salvează…” în limba paginii („${r.textButon}”)`);
  verifica(r.zona.includes(en ? 'The database is not responding.' : 'Baza de date nu răspunde.'), `${et}: mesajul serverului în limba paginii („${r.zona}”)`);
  verifica(en ? /^(Try again|Retry)$/.test(r.reia) : r.reia === 'Reîncearcă', `${et}: „Reîncearcă” la 500 („${r.reia}”)`);
  verifica(r.timeoutReia && (en ? /did not respond within 15 seconds/ : /nu a răspuns în 15 secunde/).test(r.timeout), `${et}: timeout → eroare cu „Reîncearcă” („${r.timeout}”)`);
  verifica(r.anuleaza === (en ? 'Cancel' : 'Anulează') && r.confirmaRez === false, `${et}: confirma — „${r.anuleaza}” → false`);
  verifica(!erori.length, `${et}: 0 erori JS (${erori.join(' | ')})`);
  await ctx.close();
}

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const limba of ['ro', 'en']) {
      for (const latime of [390, 1366]) {
        await scenariiSuperadmin(browser, baza, latime, limba);
        await scenariiComponenta(browser, baza, latime, limba);
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
