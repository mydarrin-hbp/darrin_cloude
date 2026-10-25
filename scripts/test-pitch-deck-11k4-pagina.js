// scripts/test-pitch-deck-11k4-pagina.js
// Pasul 11-K4 (24 oct. 2026), în browser (Playwright), la 1440 și 390 px, cu
// handler-ele reale peste Supabase-ul simulat (nimic nu ajunge la producție):
//   A. back-office: „Aprobă · 21 de rezolvat” (v1.1) deschide lista „Ce mai
//      lipsește pentru aprobare” fără cerere; lista e grupată pe slide;
//      „Deschide slide-ul →” pornește editorul pe slide, cu „Sursa cifrelor”
//      sau nota focalizate; refuzul serverului → aceeași listă, fără
//      „✕ Nu s-a salvat”; „Șterge ciorna” cu confirmare (focus pe „Anulează”);
//      versiunea completă → „Aprobă” simplu;
//   B. pagina Investitori „în pregătire”: linkul „Vezi ciorna (doar
//      administratori)” pentru adminul simulat; absent pentru vizitator (nicio
//      cerere admin), investitor (403 pe server) și fără ciornă în limbă;
//   C. mydarrin-pitch-deck?ciorna=1: banda „CIORNĂ — nepublicată” / „DRAFT —
//      not published” și deck-ul ciornei pentru admin; mesaj fără conținut
//      pentru investitor / vizitator; legenda slide-ului 17 din v1.2.
//   0 erori JS, nimic în afara ecranului.
// Capturi (opțional): CAPTURI=<folder> node scripts/test-pitch-deck-11k4-pagina.js
// Rulare: node scripts/test-pitch-deck-11k4-pagina.js

const fs = require('fs');
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

const apiAdmin = require(path.join(RADACINA, 'api/admin/pitch-deck.js'));
const apiPublic = require(path.join(RADACINA, 'api/public/pitch-deck.js'));
const API = {
  '/api/admin/runde-finantare': require(path.join(RADACINA, 'api/admin/runde-finantare.js')),
  '/api/admin/investitori-dashboard': require(path.join(RADACINA, 'api/admin/investitori-dashboard.js')),
  '/api/admin/investitori-kyc': require(path.join(RADACINA, 'api/admin/investitori-kyc.js')),
  '/api/admin/investitori-aprobare': require(path.join(RADACINA, 'api/admin/investitori-aprobare.js')),
  '/api/admin/pitch-deck': apiAdmin,
  '/api/public/pitch-deck': apiPublic,
};
const RO11 = require(path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1.1-ro.json'));
const RO12 = require(path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1.2-ro.json'));
const EN12 = require(path.join(RADACINA, 'docs/pitch-deck/pitch-deck-v1.2-en.json'));
const copie = (o) => JSON.parse(JSON.stringify(o));
const CAPTURI = process.env.CAPTURI ? path.resolve(process.env.CAPTURI) : null;
if (CAPTURI) fs.mkdirSync(CAPTURI, { recursive: true });

const USERI = {
  sup: { id: 'sup', email: 'super@example.com', roles: ['superadmin'] },
  cit: { id: 'cit', email: 'citire@example.com', roles: ['admin'] },
  inv: { id: 'inv', email: 'inv@example.com', roles: ['client', 'investor'] },
};

const sp = (t) => String(t || '').replace(/\s/g, ' ').replace(/ +/g, ' ').trim();
let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

function reset() {
  DB.tabele = {
    profiles: Object.values(USERI).map((u) => ({ ...u })),
    admin_permissions: [{ admin_id: 'cit', sectiune: 'investitori', poate_scrie: false }],
    investitori_kyc: [{ user_id: 'inv', status: 'aprobat' }],
    runde_finantare: [], investitori_portofoliu: [], audit_log: [], pitch_deck_versiuni: [], comenzi: [],
    backoffice_config: [
      { cheie: 'investitori_email', valoare: 'investor@example.com', sectiune: 'contact', tara_cod: 'ALL' },
      { cheie: 'pitch_deck_vizibilitate', valoare: 'investitori_aprobati', sectiune: 'investitori', tara_cod: 'ALL' },
    ],
  };
  DB.coloane = {};
  DB.implicite = { pitch_deck_versiuni: { aprobat: false, note_verificare: [], creat_la: new Date().toISOString() } };
  DB.utilizatori = {};
  Object.values(USERI).forEach((u) => { DB.utilizatori['tok-' + u.id] = { id: u.id, email: u.email }; });
  delete require.cache[require.resolve(path.join(RADACINA, 'lib/contact-platforma.js'))];
}
async function apel(body, id = 'sup') {
  const res = raspuns();
  await apiAdmin(cerere({ metoda: body ? 'POST' : 'GET', token: 'tok-' + id, body }), res);
  return res;
}
async function importa(f) { const r = await apel({ actiune: 'importa', fisier: copie(f) }); return r.corp.versiune; }
async function completeaza(v) {
  const slide_uri = v.slide_uri.map((s) => (s.prognoza ? { ...s, sursa: 'Sursă DE TEST' } : s));
  return (await apel({ actiune: 'salveaza', id: v.id, titlu: v.titlu, sursa: v.sursa, disclaimer: v.disclaimer, slide_uri, note_verificare: v.note_verificare.map((n) => ({ id: n.id, rezolvat: true })) })).corp.versiune;
}

// Elemente care ies din ecran pe orizontală (cele din containere derulabile se măsoară prin container).
async function inAfaraEcranului(p, selector) {
  return p.evaluate((sel) => {
    const W = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > W + 1) return 'pagina: ' + document.documentElement.scrollWidth;
    const rau = [];
    document.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).visibility === 'hidden') return;
      for (let e = el.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if (o !== 'visible') return; }
      if (r.left < -1 || r.right > W + 1) rau.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.left) + '…' + Math.round(r.right));
    });
    return rau.slice(0, 3).join(', ');
  }, selector);
}
// Un element anume în lățimea ecranului (și pentru cele din tabelul derulabil).
async function inLatime(p, selector) {
  return p.evaluate((sel) => {
    const W = document.documentElement.clientWidth;
    return [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().width)
      .map((el) => { const r = el.getBoundingClientRect(); return r.left >= -1 && r.right <= W + 1 ? '' : (el.id || el.className) + ' ' + Math.round(r.left) + '…' + Math.round(r.right); })
      .filter(Boolean).slice(0, 3).join(', ');
  }, selector);
}

function sesiune(user) {
  const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
  const ses = user ? { access_token: 'tok-' + user.id, user } : null;
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: ses }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) },
    from: () => lant({ data: [], error: null, count: 0 }), rpc: () => lant({ data: null, error: null }), storage: { from: () => lant({ data: null, error: null }) }, channel: () => lant({}), removeChannel: () => {},
  };
  const auth = new Proxy({ getCurrentUser: async () => user, getUserRoles: async () => (user ? user.roles : []), hasRole: async () => !!user, enforceSuperadminBarrier: async () => true, performLogout: () => {} }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (n, v) => Object.defineProperty(window, n, { configurable: true, get: () => v, set: () => {} });
  fix('supabaseClient', client); fix('MyDarrinAuth', auth);
}

async function context(browser, latime, { user = null, lang = 'ro' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 720 ? 844 : 900 }, hasTouch: latime < 720 });
  await ctx.addInitScript((l) => { try { localStorage.setItem('myd_lang_v1', l); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 })); } catch (e) {} }, lang);
  await ctx.addInitScript(sesiune, user);
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  const cereri = [];
  await ctx.route(/\/api\//, async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const api = API[url.pathname];
    let corp = null; try { corp = JSON.parse(req.postData() || 'null'); } catch (e) { corp = null; }
    cereri.push({ cale: url.pathname, metoda: req.method(), corp, auth: !!req.headers().authorization });
    if (!api) return r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' });
    const res = raspuns();
    await api(cerere({ metoda: req.method(), token: (req.headers().authorization || '').replace('Bearer ', '') || null, body: corp, query: Object.fromEntries(url.searchParams) }), res);
    return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp || {}) });
  });
  const pg = await ctx.newPage();
  pg.erori = [];
  pg.cereri = cereri;
  pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 200)));
  return { ctx, pg };
}

async function confirma(pg) {
  await pg.waitForSelector('[role="alertdialog"], [role="dialog"]', { timeout: 4000 }).catch(() => {});
  return pg.evaluate(() => {
    const d = [...document.querySelectorAll('[role="alertdialog"], [role="dialog"]')].pop();
    const focus = document.activeElement ? document.activeElement.textContent.trim() : '';
    const b = d && [...d.querySelectorAll('button')].find((x) => !/Anulează/.test(x.textContent));
    if (b) b.click();
    return { text: d ? d.textContent : '', focus };
  });
}
const captura = async (pg, nume, el) => { if (!CAPTURI) return; const t = el ? await pg.$(el) : null; await (t || pg).screenshot({ path: path.join(CAPTURI, nume + '.png') }).catch(() => {}); };

// ═══ A. Back-office ═════════════════════════════════════════════════
async function testBackoffice(browser, baza) {
  for (const latime of [1440, 390]) {
    const et = `A ${latime}px`;
    reset();
    const v1 = await importa(RO11);
    const v2 = await importa(RO11); // importată de două ori, ca la LM
    const { ctx, pg } = await context(browser, latime, { user: USERI.sup });
    await pg.goto(baza + '/mydarrin-superadmin.html', { waitUntil: 'networkidle' });
    await pg.waitForTimeout(400);
    await pg.evaluate(() => window.showPanel('investitori'));
    await pg.waitForFunction(() => document.querySelectorAll('#pd-tbody [data-pd-act="aproba"]').length === 2, null, { timeout: 8000 }).catch(() => {});
    const rand = (id) => `tr[data-pd-id="${id}"]`;

    // Butonul „Aprobă · N de rezolvat”
    const btn = sp(await pg.innerText(`${rand(v1.id)} [data-pd-act="aproba"]`));
    verifica(btn === 'Aprobă · 21 de rezolvat', `${et}: butonul („${btn}”)`);
    verifica(await pg.$eval(`${rand(v1.id)} [data-pd-act="aproba"]`, (b) => b.dataset.pdBlocat === '1' && b.getAttribute('aria-expanded') === 'false' && Number(getComputedStyle(b).opacity) < 0.8), `${et}: butonul e estompat, cu aria-expanded=false`);
    verifica(!(await pg.isVisible(`#pd-lipsuri-${v1.id} ul`)), `${et}: lista e pliată la început`);
    const cereriInainte = pg.cereri.length;
    await pg.click(`${rand(v1.id)} [data-pd-act="aproba"]`);
    await pg.waitForTimeout(300);
    verifica(await pg.$eval(`#pd-lipsuri-${v1.id}`, (d) => d.open), `${et}: clicul deschide lista „Ce mai lipsește”`);
    verifica(await pg.$eval(`${rand(v1.id)} [data-pd-act="aproba"]`, (b) => b.getAttribute('aria-expanded') === 'true'), `${et}: aria-expanded=true`);
    verifica(!(await pg.$('[role="alertdialog"], [role="dialog"]')) && !pg.cereri.slice(cereriInainte).some((c) => c.corp && c.corp.actiune === 'aproba'), `${et}: fără confirmare, fără cerere de aprobare`);

    // Lista grupată pe slide
    const grupe = await pg.$$eval(`#pd-lipsuri-${v1.id} li.pd-lipsa`, (l) => l.map((x) => [x.dataset.pdLipsaSlide, x.querySelector('span').textContent.replace(/\s+/g, ' ').trim()]));
    verifica(JSON.stringify(grupe.map((g) => g[0])) === JSON.stringify(['4', '9', '10', '12', '14', '15', '16', '17', '19', '20']), `${et}: grupele pe slide (${grupe.map((g) => g[0]).join(', ')})`);
    const g = Object.fromEntries(grupe);
    verifica(g['4'] === 'Slide 4 — Lipsește sursa cifrelor · 1 notă nerezolvată', `${et}: slide 4 („${g['4']}”)`);
    verifica(g['9'] === 'Slide 9 — Lipsește sursa cifrelor · 2 note nerezolvate', `${et}: slide 9 („${g['9']}”)`);
    verifica(g['14'] === 'Slide 14 — 2 note nerezolvate' && g['20'] === 'Slide 20 — 3 note nerezolvate', `${et}: slide 14 / 20 („${g['14']}” · „${g['20']}”)`);
    const sumar = sp(await pg.innerText(`#pd-lipsuri-${v1.id} summary`));
    verifica(sumar === 'Ce mai lipsește pentru aprobare (21 de rezolvat)', `${et}: titlul listei („${sumar}”)`);
    { const d = await inLatime(pg, `#pd-lipsuri-${v1.id}, #pd-lipsuri-${v1.id} li, #pd-lipsuri-${v1.id} button`); verifica(!d, `${et}: lista în lățimea ecranului (${d})`); }
    await captura(pg, `11k4-lista-ce-mai-lipseste-${latime}`, `#pd-lipsuri-${v1.id}`);

    // „Deschide slide-ul →” pe slide-ul 4 → editorul, cu „Sursa cifrelor” focalizată
    await pg.click(`#pd-lipsuri-${v1.id} li[data-pd-lipsa-slide="4"] [data-pd-deschide-slide]`);
    await pg.waitForFunction(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.cale === 'slide_uri.3.sursa', null, { timeout: 6000 }).catch(() => {});
    const f4 = await pg.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { cale: a.dataset.cale, deschis: a.closest('details') && a.closest('details').open, slide: a.closest('details') && a.closest('details').dataset.pdSlide, eticheta: a.closest('label') && a.closest('label').firstChild.textContent.trim(), vizibil: r.top >= 0 && r.bottom <= innerHeight }; });
    verifica(f4.cale === 'slide_uri.3.sursa' && f4.deschis && f4.slide === '3' && f4.eticheta === 'Sursa cifrelor', `${et}: „Deschide slide-ul” (slide 4) → „Sursa cifrelor” focalizată (${JSON.stringify(f4)})`);
    await pg.waitForTimeout(700);
    verifica(await pg.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), `${et}: câmpul focalizat e pe ecran`);
    // Slide-ul 14 are doar note → nota focalizată, în slide-ul ei
    await pg.click(`#pd-lipsuri-${v1.id} li[data-pd-lipsa-slide="14"] [data-pd-deschide-slide]`);
    await pg.waitForFunction(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.pdNota, null, { timeout: 6000 }).catch(() => {});
    const f14 = await pg.evaluate(() => { const a = document.activeElement; const d = a.closest('details'); return { nota: a.dataset.pdNota, slide: d && d.dataset.pdSlide, deschis: d && d.open }; });
    verifica(/^s14-/.test(f14.nota || '') && f14.slide === '13' && f14.deschis, `${et}: „Deschide slide-ul” (slide 14) → nota focalizată în slide (${JSON.stringify(f14)})`);
    // Bifa din slide și cea din lista de sus rămân sincronizate
    await pg.evaluate(() => { const a = document.activeElement; a.checked = true; a.dispatchEvent(new Event('change', { bubbles: true })); });
    verifica(await pg.evaluate((id) => [...document.querySelectorAll(`#pd-editor [data-pd-nota="${id}"]`)].every((x) => x.checked) && document.querySelectorAll(`#pd-editor [data-pd-nota="${id}"]`).length === 2, f14.nota), `${et}: bifa notei e sincronizată (slide + lista de sus)`);
    { const d = await inAfaraEcranului(pg, '#pd-editor, #pd-editor *'); verifica(!d, `${et}: editorul în ecran (${d})`); }
    await pg.evaluate(() => window.inchideEditorPitchDeck());

    // Refuzul serverului (lista din browser veche) → aceeași listă, fără „✕ Nu s-a salvat”
    await pg.evaluate((id) => { PD.versiuni.find((x) => x.id === id).lipsuri = []; PD_LIPSURI_DESCHISE.clear(); renderPitchDeck(); }, v1.id);
    verifica(sp(await pg.innerText(`${rand(v1.id)} [data-pd-act="aproba"]`)) === 'Aprobă', `${et}: (simulat) lista veche → „Aprobă”`);
    await pg.click(`${rand(v1.id)} [data-pd-act="aproba"]`);
    await confirma(pg);
    await pg.waitForFunction((id) => { const d = document.getElementById('pd-lipsuri-' + id); return d && d.open; }, v1.id, { timeout: 6000 }).catch(() => {});
    const dupaRefuz = await pg.evaluate((id) => ({
      lista: !!document.getElementById('pd-lipsuri-' + id) && document.getElementById('pd-lipsuri-' + id).open,
      grupe: document.querySelectorAll(`#pd-lipsuri-${id} li.pd-lipsa`).length,
      buton: document.querySelector(`tr[data-pd-id="${id}"] [data-pd-act="aproba"]`).textContent.trim(),
      alerta: !!document.querySelector('#pd-import-msg [role="alert"]'),
      mesaj: document.getElementById('pd-import-msg').textContent.trim(),
    }), v1.id);
    verifica(dupaRefuz.lista && dupaRefuz.grupe === 10, `${et}: refuzul serverului → lista „Ce mai lipsește” (${JSON.stringify(dupaRefuz)})`);
    verifica(dupaRefuz.buton === 'Aprobă · 21 de rezolvat' && !/Nu s-a salvat/.test(dupaRefuz.buton), `${et}: butonul nu rămâne „✕ Nu s-a salvat” („${dupaRefuz.buton}”)`);
    verifica(!dupaRefuz.alerta && /nu s-a aprobat: mai sunt 21 de rezolvat/.test(dupaRefuz.mesaj) && !/Slide \d+: nota/.test(dupaRefuz.mesaj), `${et}: mesaj scurt, nu bloc roșu („${dupaRefuz.mesaj.slice(0, 140)}”)`);
    verifica(DB.tabele.pitch_deck_versiuni.every((x) => !x.aprobat), `${et}: nimic aprobat`);
    await captura(pg, `11k4-refuz-ca-lista-${latime}`, '#pd-card');

    // „Șterge ciorna” (dublura), cu confirmare periculoasă
    const butoane = await pg.$$eval(`${rand(v2.id)} .pd-actiuni button`, (b) => b.map((x) => x.textContent.trim()));
    verifica(JSON.stringify(butoane) === JSON.stringify(['Editează', 'Previzualizează', 'Aprobă · 21 de rezolvat', 'Duplică ca ciornă nouă', 'Șterge ciorna']), `${et}: acțiunile ciornei (${butoane.join(', ')})`);
    await pg.click(`${rand(v2.id)} [data-pd-act="sterge"]`);
    const dlg = await confirma(pg);
    verifica(/Ștergi ciorna „Pitch deck v1\.1 · RO” \(RO, 20 slide-uri\)/.test(dlg.text) && dlg.focus === 'Anulează', `${et}: confirmarea ștergerii (focus „${dlg.focus}”)`);
    await pg.waitForFunction(() => /a fost ștearsă/.test(document.getElementById('pd-import-msg').textContent), null, { timeout: 6000 }).catch(() => {});
    await pg.waitForFunction(() => document.querySelectorAll('#pd-tbody tr[data-pd-id]').length === 1, null, { timeout: 6000 }).catch(() => {});
    verifica(DB.tabele.pitch_deck_versiuni.length === 1 && DB.tabele.pitch_deck_versiuni[0].id === v1.id, `${et}: ciorna dublă ștearsă, cealaltă rămâne`);
    verifica((await pg.$$('#pd-tbody tr[data-pd-id]')).length === 1, `${et}: lista are un singur rând`);
    verifica(DB.tabele.audit_log.some((x) => x.actiune === 'pitch_deck_ciorna_stearsa' && x.entitate_id === v2.id), `${et}: ștergerea e auditată`);

    // Versiunea completă → „Aprobă” simplu, fără listă
    await completeaza(DB.tabele.pitch_deck_versiuni[0]);
    await pg.evaluate(() => loadPitchDeck());
    await pg.waitForFunction((id) => !document.getElementById('pd-lipsuri-' + id), v1.id, { timeout: 6000 }).catch(() => {});
    const simplu = await pg.$eval(`${rand(v1.id)} [data-pd-act="aproba"]`, (b) => [b.textContent.trim(), b.dataset.pdBlocat || '']);
    verifica(simplu[0] === 'Aprobă' && !simplu[1] && !(await pg.$(`#pd-lipsuri-${v1.id}`)), `${et}: versiunea completă → „Aprobă” activ, fără listă (${simplu.join('|')})`);

    { const d = await inAfaraEcranului(pg, '#pd-card, #pd-card *'); verifica(!d, `${et}: cardul în ecran (${d})`); }
    verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
    await ctx.close();
    console.log(`${et}: gata`);
  }
}

// ═══ B. Pagina Investitori: linkul spre ciornă ══════════════════════
const LINK = { ro: 'Vezi ciorna (doar administratori)', en: 'See the draft (administrators only)' };
async function testInvestitori(browser, baza) {
  for (const latime of [1440, 390]) {
    for (const lang of ['ro', 'en']) {
      for (const [caz, user, cuCiorna, asteptat] of [['admin', USERI.sup, true, true], ['admin cu citire', USERI.cit, true, true], ['vizitator', null, true, false], ['investitor', USERI.inv, true, false], ['admin fără ciornă în limbă', USERI.sup, false, false]]) {
        const et = `B ${latime}px ${lang} ${caz}`;
        reset();
        if (cuCiorna) await importa(lang === 'ro' ? RO12 : EN12);
        else await importa(lang === 'ro' ? EN12 : RO12);
        const { ctx, pg } = await context(browser, latime, { user, lang });
        await pg.goto(baza + '/mydarrin-investitori', { waitUntil: 'domcontentloaded' });
        await pg.waitForFunction(() => document.getElementById('pd-cta-sub') && document.getElementById('pd-cta-sub').hasAttribute('data-stare-pitch'), null, { timeout: 8000 }).catch(() => {});
        if (user) await pg.waitForFunction(() => window.__ciornaVerificata || !document.getElementById('pd-cta-ciorna-zona').hidden, null, { timeout: 2500 }).catch(() => {});
        await pg.waitForTimeout(user ? 600 : 1200);
        verifica(await pg.isVisible('#pd-cta-pregatire'), `${et}: „Pitch deck în pregătire” rămâne`);
        const vizibil = await pg.isVisible('#pd-cta-ciorna');
        verifica(vizibil === asteptat, `${et}: linkul ${asteptat ? 'apare' : 'lipsește'}`);
        const admin = pg.cereri.filter((c) => c.cale === '/api/admin/pitch-deck');
        if (!user) verifica(!admin.length, `${et}: nicio cerere spre endpoint-ul admin (${admin.length})`);
        else verifica(admin.length >= 1 && admin.every((c) => c.corp && c.corp.actiune === 'ciorna' && c.corp.doar_stare === true && c.auth), `${et}: o singură verificare, pe server (doar_stare)`);
        if (asteptat) {
          verifica(sp(await pg.innerText('#pd-cta-ciorna')) === LINK[lang] && (await pg.getAttribute('#pd-cta-ciorna', 'href')) === '/mydarrin-pitch-deck?ciorna=1', `${et}: textul și adresa („${sp(await pg.innerText('#pd-cta-ciorna'))}”)`);
          if (lang === 'ro') await captura(pg, `11k4-link-admin-investitori-${latime}`, '#pitch-deck-section');
        }
        const d = await inAfaraEcranului(pg, '#pitch-deck-section, #pitch-deck-section *'); verifica(!d, `${et}: secțiunea în ecran (${d})`);
        verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
        await ctx.close();
      }
    }
    console.log(`B ${latime}px: gata`);
  }
}

// ═══ C. mydarrin-pitch-deck?ciorna=1 ═══════════════════════════════
const BANDA = { ro: 'CIORNĂ — nepublicată', en: 'DRAFT — not published' };
const INDISPONIBIL = { ro: 'Ciorna nu e disponibilă', en: 'The draft is not available' };
const LEGENDA = { ro: ['Valoarea proiectelor', 'Profit net'], en: ['Project value', 'Net profit'] };
async function testPaginaCiorna(browser, baza) {
  for (const latime of [1440, 390]) {
    for (const lang of ['ro', 'en']) {
      for (const [caz, user] of [['admin', USERI.cit], ['investitor', USERI.inv], ['vizitator', null]]) {
        const et = `C ${latime}px ${lang} ${caz}`;
        reset();
        await importa(RO12); await importa(EN12);
        const { ctx, pg } = await context(browser, latime, { user, lang });
        await pg.goto(baza + '/mydarrin-pitch-deck?ciorna=1#slide-17', { waitUntil: 'domcontentloaded' });
        await pg.waitForFunction(() => document.querySelector('.mdpd-slide.mdpd-activ') || document.querySelector('[data-ciorna-indisponibila]'), null, { timeout: 10000 }).catch(() => {});
        await pg.waitForTimeout(500);
        const st = await pg.evaluate(() => ({
          banda: !document.getElementById('pd-ciorna-banda').hidden ? document.querySelector('#pd-ciorna-banda strong').textContent : null,
          slideuri: document.querySelectorAll('.mdpd-slide').length,
          legenda: [...document.querySelectorAll('.mdpd-slide.mdpd-activ .mdpd-legenda span')].map((x) => x.textContent),
          indisponibil: (document.querySelector('[data-ciorna-indisponibila]') || {}).textContent || null,
          text: document.getElementById('pd-main').innerText,
          robots: (document.querySelector('meta[name="robots"]') || {}).content || '',
        }));
        if (caz === 'admin') {
          verifica(st.banda === BANDA[lang], `${et}: banda („${st.banda}”)`);
          verifica(st.slideuri === 20 && JSON.stringify(st.legenda) === JSON.stringify(LEGENDA[lang]), `${et}: deck-ul ciornei, slide 17 cu etichetele v1.2 (${st.slideuri}, ${st.legenda.join(' / ')})`);
          const c = pg.cereri.filter((x) => x.cale === '/api/admin/pitch-deck' && x.corp && x.corp.actiune === 'ciorna');
          verifica(c.length >= 1 && !pg.cereri.some((x) => x.cale === '/api/public/pitch-deck'), `${et}: conținutul vine din endpoint-ul admin, nu din cel public`);
          const rb = await pg.evaluate(() => { const r = document.getElementById('pd-ciorna-banda').getBoundingClientRect(); return { w: r.width, top: Math.round(r.top), bottom: Math.round(r.bottom), h: innerHeight, sy: scrollY, hdr: Math.round(document.querySelector('.pd-top').getBoundingClientRect().bottom) }; });
          verifica(rb.w > 0 && rb.top >= 0 && rb.bottom <= rb.h, `${et}: banda e pe ecran (${JSON.stringify(rb)})`);
          if (lang === 'ro') await captura(pg, `11k4-banda-ciorna-${latime}`);
        } else {
          verifica(st.indisponibil === INDISPONIBIL[lang] && st.slideuri === 0 && !st.banda, `${et}: fără drept → mesaj, fără conținut („${st.indisponibil}”, ${st.slideuri} slide-uri)`);
          verifica(!/Proiecții|Financial Projections|Valoarea proiectelor|Project value/.test(st.text), `${et}: niciun text din ciornă`);
        }
        if (lang === 'en') verifica(!/[ăâîșțĂÂÎȘŢȚ]/.test(st.text.replace(/Română/g, '')), `${et}: fără română în EN („${(st.text.match(/.{0,20}[ăâîșțĂÂÎȘȚ].{0,20}/) || [''])[0]}”)`);
        verifica(/noindex/.test(st.robots), `${et}: noindex pe pagina ciornei`);
        const d = await inAfaraEcranului(pg, '#pd-app, #pd-app *'); verifica(!d, `${et}: pagina în ecran (${d})`);
        verifica(!pg.erori.length, `${et}: 0 erori JS (${pg.erori.join(' | ')})`);
        await ctx.close();
      }
    }
    console.log(`C ${latime}px: gata`);
  }
}

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    if (!process.env.DOAR || process.env.DOAR === 'A') await testBackoffice(browser, baza);
    if (!process.env.DOAR || process.env.DOAR === 'B') await testInvestitori(browser, baza);
    if (!process.env.DOAR || process.env.DOAR === 'C') await testPaginaCiorna(browser, baza);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
