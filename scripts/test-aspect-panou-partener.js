// scripts/test-aspect-panou-partener.js
// Pasul 12-P1b (17 nov. 2026): aspectul după testul LM pe 12-P1.
//   A. Panoul partenerului „cont nou” (panou-cont-nou.js), pe mydarrin-dashboard-partener
//      și mydarrin-dashboard-furnizor, la 1366 și 1920 px (și cu zoom 125 %): logo-ul și
//      primul element al meniului lateral la cel puțin 16 px de marginea stângă; niciun
//      text din meniu tăiat (scrollWidth <= clientWidth, textul întreg, în ecran); stratul
//      nu se poate derula orizontal.
//   B. Logo-ul se încarcă (status 200, naturalWidth > 0) pe /parteneri/inscriere
//      (390, 1366, 1920 px) și pe panou.
//   C. Selectorul de limbă: pe telefon (390 px) codul o singură dată („RO”, fără steag),
//      pe desktop numele („Română”) — pe pagina de pre-înscriere, panoul partenerului,
//      antetul activării, „Rolurile mele”, panoul investitorului.
// Nimic nu ajunge la Supabase sau la producție (clientul Supabase e simulat în pagină).
// Rulare: node scripts/test-aspect-panou-partener.js

const path = require('path');
const { chromium } = require('playwright');
const { porneste } = require('./server-test');
const RADACINA = path.join(__dirname, '..');
const { stareContPartener } = (() => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://simulat.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'cheie-test-simulata';
  return require(path.join(RADACINA, 'lib/activare-partener.js'));
})();

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

function supabaseSimulat() {
  const user = { id: '50000000-0000-4000-8000-000000000002', email: 'ion@gmail.com', email_confirmed_at: '2026-11-17T08:00:00Z', user_metadata: { prenume: 'Ion' } };
  const ses = { access_token: 'tok-test', user };
  const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
  const client = {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getSession: async () => ({ data: { session: ses }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: () => lant({ data: null, error: null }),
    rpc: () => lant({ data: null, error: null }),
    channel: () => lant({}),
    removeChannel: () => {},
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  };
  Object.defineProperty(window, 'supabaseClient', { configurable: true, get: () => client, set: () => {} });
}

const PASI = ['firma', 'cont_bancar', 'profesii', 'dotari', 'documente', 'contract'];
function profil(rol, tip) {
  const a = { rol, tip, mod_activare: true, verificare: null, activ: false, complet: false, pasi: PASI.map((c, i) => ({ cheie: c, stare: i ? 'blocat' : 'de_completat', deschide: null })) };
  a.stare_cont = stareContPartener(a);
  return { ok: true, email: 'ion@gmail.com', nume: 'Ion Popescu', prenume: 'Ion', nume_familie: 'Popescu', telefon: '+40712345678', tara: 'RO', roles: ['client'], roluri_dashboard: [], are_comenzi: false, rol_solicitat: rol, partener: null, investitor: null, activare: a };
}
const PROFIL_INVESTITOR = { ok: true, email: 'ion@gmail.com', nume: 'Ion Popescu', prenume: 'Ion', roles: ['client'], roluri_dashboard: [], are_comenzi: false, rol_solicitat: 'investor', partener: null, investitor: null, activare: null };

async function context(br, latime, limba, prof, zoom) {
  const z = zoom || 1;
  const ctx = await br.newContext({ viewport: { width: Math.round(latime / z), height: Math.round((latime < 800 ? 844 : 900) / z) }, deviceScaleFactor: z });
  await ctx.addInitScript((l) => { try { localStorage.setItem('myd_lang_v1', l); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, marketing: false, data: new Date().toISOString(), versiune: 2 })); } catch (e) {} }, limba);
  await ctx.addInitScript(supabaseSimulat);
  await ctx.route((u) => /(\.supabase\.co|googletagmanager\.com|google-analytics\.com|ipapi\.co)$/.test(u.hostname) || /^\/_vercel\/insights/.test(u.pathname), (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await ctx.route(/\/api\//, (r) => {
    const u = new URL(r.request().url());
    const json = (b, s) => r.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/cont/profil') return json(prof);
    if (u.pathname === '/api/partener/activare-ciorna') return json({ ok: true, ciorna: { pas_curent: 1, date: { preinscriere: { profesie_ro: 'Instalator', oras: 'Iași' } } } });
    if (u.pathname === '/api/public/profesii') return json({ ok: true, profesii: [{ slug: 'instalator', cod: '712601', denumire: limba === 'ro' ? 'Instalator' : 'Plumber', denumire_ro: 'Instalator', nace: '43.22' }] });
    if (/^\/api\/public\/(runda-curenta|pitch-deck)/.test(u.pathname)) return json({ ok: true, runda: null, stare: 'in_pregatire' });
    if (/^\/api\/public\/(reguli-platforma|tari-active|forme-juridice)/.test(u.pathname)) return r.fallback();
    return json({ ok: false }, 503);
  });
  const p = await ctx.newPage();
  const logo = [];
  p.on('response', (x) => { if (/logo-my-darrin\.webp/.test(x.url())) logo.push(x.status()); });
  const erori = [];
  p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
  return { ctx, p, logo, erori };
}

// Selectorul: textul vizibil al butonului (fără SVG), o singură apariție a codului.
const textSelector = (p, sel) => p.evaluate((s) => {
  const b = document.querySelector(s + ' .lang-chip');
  if (!b || !b.getClientRects().length) return null;
  return [...b.querySelectorAll('span')].filter((x) => x.getClientRects().length && getComputedStyle(x).display !== 'none').map((x) => x.textContent.trim()).join(' ');
}, sel);

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const br = await chromium.launch();
  try {
    // ── A + B (panou) ──
    for (const [pagina, rol, tip] of [['mydarrin-dashboard-partener.html?type=servicii', 'partener_servicii', 'servicii'], ['mydarrin-dashboard-furnizor.html?type=materiale', 'partener_materiale', 'materiale']]) {
      for (const [latime, zoom] of [[1366, 1], [1920, 1], [1366, 1.25], [1920, 1.5]]) {
        const et = `${pagina.split('.')[0]} ${latime}px${zoom !== 1 ? ' zoom ' + zoom * 100 + '%' : ''}`;
        const { ctx, p, logo, erori } = await context(br, latime, 'ro', profil(rol, tip), zoom);
        await p.goto(`${baza}/${pagina}`, { waitUntil: 'load' });
        await p.waitForSelector('#myd-panou-nou .mpn-stare', { timeout: 15000 }).catch(() => {});
        // Un focus pe ultimul element (ex. tastatura) nu deplasează stratul orizontal.
        await p.evaluate(() => { const r = document.getElementById('myd-panou-nou'); if (r) { r.scrollLeft = 300; const x = [...r.querySelectorAll('button')].pop(); if (x) x.focus(); } });
        const m = await p.evaluate(() => {
          const r = document.getElementById('myd-panou-nou');
          const img = r && r.querySelector('.mpn-antet img');
          const butoane = r ? [...r.querySelectorAll('.mpn-meniu button')] : [];
          return {
            scrollLeft: r ? r.scrollLeft : -1,
            logo: img && { stanga: img.getBoundingClientRect().left, nw: img.naturalWidth, w: img.getBoundingClientRect().width },
            meniu: butoane.map((b) => {
              const t = document.createRange(); t.selectNodeContents(b);
              const rt = t.getBoundingClientRect(), rb = b.getBoundingClientRect();
              return { text: b.textContent, stanga: rb.left, textStanga: rt.left, sw: b.scrollWidth, cw: b.clientWidth, inButon: rt.left >= rb.left - 0.5 && rt.right <= rb.right + 0.5 };
            }),
          };
        });
        verifica(m.scrollLeft === 0, `${et} A: stratul nu se derulează orizontal (scrollLeft ${m.scrollLeft})`);
        verifica(m.logo && m.logo.stanga >= 16 && m.logo.w > 0, `${et} A: logo-ul la ${m.logo && Math.round(m.logo.stanga)} px de margine (≥ 16)`);
        verifica(m.meniu.length === 6 && m.meniu[0].stanga >= 16, `${et} A: primul element al meniului la ${m.meniu[0] && Math.round(m.meniu[0].stanga)} px (≥ 16)`);
        const taiate = m.meniu.filter((x) => x.sw > x.cw || !x.inButon || x.textStanga < 16);
        verifica(!taiate.length, `${et} A: texte tăiate în meniu: ${taiate.map((x) => x.text).join(', ')}`);
        verifica(m.meniu.map((x) => x.text).join(',') === 'Activitate,Comenzi,Calendar,Încasări,Profil și firmă,Ajutor', `${et} A: textele meniului întregi (${m.meniu.map((x) => x.text).join(',')})`);
        verifica(m.logo && m.logo.nw > 0 && logo.length && logo.every((s) => s === 200 || s === 304), `${et} B: logo-ul se încarcă (${logo.join(',')}, naturalWidth ${m.logo && m.logo.nw})`);
        if (zoom === 1) {
          const sel = await textSelector(p, '#mpn-limba');
          verifica(sel === 'Română', `${et} C: pe desktop, numele limbii („${sel}”)`);
        }
        verifica(!erori.length, `${et}: erori JS (${erori.slice(0, 3).join(' | ')})`);
        await ctx.close();
      }
    }

    // ── B + C (pagina de pre-înscriere) ──
    for (const latime of [390, 1366, 1920]) {
      for (const limba of ['ro', 'en']) {
        const et = `/parteneri/inscriere ${latime}px ${limba}`;
        const { ctx, p, logo } = await context(br, latime, limba, profil('partener_servicii', 'servicii'));
        await p.goto(`${baza}/parteneri/inscriere?profesie=instalator`, { waitUntil: 'load' });
        await p.waitForFunction(() => !document.documentElement.classList.contains('myd-i18n-pending') && document.querySelector('#pi-limba .lang-chip'), null, { timeout: 10000 }).catch(() => {});
        const img = await p.evaluate(() => { const i = document.querySelector('.pi-antet img'); const r = i.getBoundingClientRect(); return { nw: i.naturalWidth, w: r.width, h: r.height, stanga: r.left, alt: i.getAttribute('alt'), src: i.getAttribute('src') }; });
        verifica(img.nw > 0 && img.w === 34 && img.h === 34 && logo.length && logo.every((s) => s === 200 || s === 304), `${et} B: logo-ul se vede (${JSON.stringify(img)}, ${logo.join(',')})`);
        verifica(img.alt === 'My Darrin' && img.src === '/assets/img/logo-my-darrin.webp' && img.stanga >= 16, `${et} B: calea, alt-ul și distanța față de margine`);
        const sel = await textSelector(p, '#pi-limba');
        const cod = limba.toUpperCase(), nume = limba === 'ro' ? 'Română' : 'English';
        verifica(sel === (latime < 481 ? cod : nume), `${et} C: selectorul „${sel}” (așteptat „${latime < 481 ? cod : nume}”)`);
        await ctx.close();
      }
    }

    // ── C (paginile de cont, la 390 px): codul o singură dată ──
    for (const [et, pagina, prof, sel, pregatire] of [
      ['panoul partenerului', 'mydarrin-dashboard-partener.html?type=servicii', profil('partener_servicii', 'servicii'), '#mpn-limba'],
      ['panoul furnizorului', 'mydarrin-dashboard-furnizor.html?type=materiale', profil('partener_materiale', 'materiale'), '#mpn-limba'],
      ['antetul activării', 'mydarrin-dashboard-partener.html?type=servicii', profil('partener_servicii', 'servicii'), '#myd-activare-pagina', async (p) => { await p.waitForSelector('#mpn-continua', { timeout: 15000 }); await p.click('#mpn-continua'); await p.waitForSelector('#myd-activare-pagina [data-myd-limba]', { timeout: 10000 }); }],
      ['„Rolurile mele”', 'mydarrin-rolurile-mele.html', profil('partener_servicii', 'servicii'), '#rm-limba'],
      ['panoul investitorului', 'mydarrin-panou-investitor.html', PROFIL_INVESTITOR, '#myd-id'],
    ]) {
      for (const limba of ['ro', 'en']) {
        const { ctx, p, logo } = await context(br, 390, limba, prof);
        await p.goto(`${baza}/${pagina}`, { waitUntil: 'load' });
        await p.waitForSelector(`${sel} [data-myd-limba]`, { timeout: 15000 }).catch(() => {});
        if (pregatire) await pregatire(p).catch(() => {});
        const t = await textSelector(p, sel);
        verifica(t === limba.toUpperCase(), `${et} 390px ${limba}: selectorul „${t}” (așteptat „${limba.toUpperCase()}”, o singură dată)`);
        const steag = await p.evaluate((s) => /[\u{1F1E6}-\u{1F1FF}]/u.test((document.querySelector(s + ' [data-myd-limba]') || {}).textContent || ''), sel);
        verifica(!steag, `${et} 390px ${limba}: fără steag emoji (pe Windows apare ca literele codului)`);
        if (/panoul (partenerului|furnizorului)/.test(et)) {
          const n = await p.evaluate(() => { const i = document.querySelector('#myd-panou-nou .mpn-antet img'); return i ? i.naturalWidth : 0; });
          verifica(n > 0 && logo.length && logo.every((s) => s === 200 || s === 304), `${et} 390px ${limba}: logo-ul se încarcă (${logo.join(',')})`);
        }
        await ctx.close();
      }
    }
  } finally {
    await br.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
