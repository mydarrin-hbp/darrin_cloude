// scripts/test-acces-cont.js
// Teste Playwright pentru pasul 10b (2.4–2.5): butonul de cont logat și paza
// dashboard-urilor. Paginile reale, servite local (server static), cu sesiune
// Supabase simulată și /api/cont/profil simulat. Nimic nu ajunge la Supabase.
//
// Scenarii (în RO și EN, la 1366 și 390 px):
//   1. logat ca furnizor (Home Best Pal) → antetul arată inițialele „HB” și
//      numele firmei, punct verde, „Conectat ca …”; click → dashboard-ul de
//      furnizor (?type=materiale); meniul are Dashboard-ul meu / Rolurile mele / Ieși;
//   2. logat ca client → click → dashboard-ul clientului;
//   3. un client deschide dashboard-ul de furnizor → redirect la dashboard-ul
//      clientului, cu mesajul „Te-am dus în contul tău de client.”;
//   4. banda de stare: pending_review (partener servicii) și contract nesemnat
//      + fără cont bancar (furnizor aprobat); antetul de identitate cu insigna rolului;
//   5. fără sesiune pe un dashboard → fereastra de login, cu revenire reținută.
// Plus: 0 erori JS, fără depășiri pe orizontală, fără text românesc în EN
// în zonele noi (antet, meniu, identitate, benzi).
//
// Cerințe (nu e dependență a proiectului):
//   npm i --no-save playwright && npx playwright install chromium
// Rulare: node scripts/test-acces-cont.js [--capturi <dosar>]

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RADACINA = path.join(__dirname, '..');
const arg = process.argv.slice(2);
const CAPTURI = arg.includes('--capturi') ? arg[arg.indexOf('--capturi') + 1] : null;
if (CAPTURI) fs.mkdirSync(CAPTURI, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function server() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = path.join(RADACINA, p === '/' ? 'index.html' : p);
      if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, () => ok(s));
  });
}

// ── Profiluri simulate (după datele reale din 16 oct. 2026) ───────────────
const PROFILURI = {
  furnizor: {
    ok: true, email: 'contact@homebestpal.ro', nume: null, roles: ['client', 'partener_materiale'],
    roluri_dashboard: ['partener_materiale'], destinatie: '/mydarrin-dashboard-furnizor.html?type=materiale', tip_destinatie: 'rol',
    partener: { nume_firma: 'Home Best Pal', partner_type: 'furnizor_materiale', rol: 'partener_materiale', status_verificare: 'approved', contract_semnat: false, cont_bancar: false, motiv_respingere: null },
  },
  client: {
    ok: true, email: 'ana.client@example.com', nume: 'Ana Popescu', roles: ['client'],
    roluri_dashboard: ['client'], destinatie: '/mydarrin-dashboard-client.html', tip_destinatie: 'rol', partener: null,
  },
  servicii_verificare: {
    ok: true, email: 'contact@aromalive.ro', nume: null, roles: ['partener_servicii'],
    roluri_dashboard: ['partener_servicii'], destinatie: '/mydarrin-dashboard-partener.html?type=servicii', tip_destinatie: 'rol',
    partener: { nume_firma: 'Aroma Live', partner_type: 'servicii_tehnice', rol: 'partener_servicii', status_verificare: 'pending_review', contract_semnat: false, cont_bancar: false, motiv_respingere: null },
  },
};

// Răspunsurile celorlalte API-uri cu cont (ca în scripts/detector-ro.js).
const RASPUNSURI = {
  '/api/partener/wizard-companie': { ok: true, partner: null, conturi: [] },
  '/api/partener/status-aplicare': { ok: true, status: 'pending_review', partner_type: 'servicii_tehnice', documente_respinse: [], darrin_ai_activ: false, darrin_ai_raport: null },
  '/api/partener/cont': { ok: true, partner: { nume_firma: 'Aroma Live', partner_type: 'servicii_tehnice', status_verificare: 'pending_review', regiune_cod: 'BC', contract_semnat: false }, profil: { email: 'contact@aromalive.ro', tara: 'RO', limba: 'en' }, are_cont_bancar: false, kpi: { moneda: 'RON', comenzi_active: 0, comenzi_luna: 0, total_activ: 0, total_eliberat: 0, castig_luna: 0, castig_azi: 0 }, documente: [], facturi: [], garantii: [], polite: [] },
  '/api/partener/escrow-tracker': { ok: true, total_activ: 0, total_eliberat: 0, moneda: 'Lei', alocari: [] },
  '/api/partener/facturi': { ok: true, facturabile: [], facturi: [] },
  '/api/partener/profil-status': { ok: true, complet: true, lipsa: [], pas: null },
  '/api/partener/contract-status': { ok: true, poate_prelua_comenzi: false, status_verificare: 'pending_review', are_cont_bancar: false, contract_semnat: false },
  '/api/partener/discounturi': { ok: true, discounturi: [] },
  '/api/partener/conturi-bancare': { ok: true, conturi: [] },
  '/api/marketplace/produse': { ok: true, produse: [], total: 0 },
  '/api/client/comenzi-tracker': { ok: true, comenzi: [] },
};

function sesiuneSimulata(cfg) {
  const lant = (rezultat) => {
    const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rezultat) : () => p), apply: () => p });
    return p;
  };
  const user = cfg.user;
  const sesiune = user ? { access_token: 'token-simulat', user } : null;
  const client = {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getSession: async () => ({ data: { session: sesiune }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: () => lant({ data: [], error: null, count: 0 }),
    rpc: () => lant({ data: null, error: null }),
    storage: { from: () => lant({ data: null, error: null }) },
    channel: () => lant({}),
    removeChannel: () => {},
  };
  const auth = new Proxy({
    getCurrentUser: async () => user,
    getUserRoles: async () => cfg.roles || [],
    hasRole: async (r) => (cfg.roles || []).includes(r),
    performLogout: () => { window.__iesit = true; },
  }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (nume, val) => Object.defineProperty(window, nume, { configurable: true, get: () => val, set: () => {} });
  fix('supabaseClient', client);
  fix('MyDarrinAuth', auth);
  try {
    if (!sessionStorage.getItem('__init')) {
      localStorage.clear();
      if (cfg.limba === 'ro') localStorage.setItem('myd_lang_v1', 'ro');
      // Bara de cookie-uri acoperă bara de jos pe mobil; consimțământul e dat dinainte.
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: '2026-10-16T08:00:00Z', versiune: 1 }));
      sessionStorage.setItem('__init', '1');
    }
  } catch (e) {}
}

// Text românesc vizibil în zonele noi (aceleași reguli ca scripts/detector-ro.js).
function romanaInZone(selectori) {
  const EXCEPTII = /\b(My Darrin|Home Best Pal|Aroma Live|Ana Popescu|SRL)\b/g;
  const RO = /[ăâîșțşţĂÂÎȘȚŞŢ]|(?<!\p{L})(?:pentru|cont|contul|către|și|sau|în|tău|ta|Ieși|Conectat|Rolurile|verificare|contractul|bancar)(?!\p{L})/iu;
  const gasite = [];
  selectori.forEach((s) => document.querySelectorAll(s).forEach((el) => {
    const texte = [el.innerText || '', el.getAttribute('aria-label') || '', el.getAttribute('title') || ''];
    el.querySelectorAll('[aria-label],[title]').forEach((x) => { texte.push(x.getAttribute('aria-label') || ''); texte.push(x.getAttribute('title') || ''); });
    texte.forEach((t) => { const c = t.replace(/\S+@\S+/g, ' ').replace(EXCEPTII, ' '); if (RO.test(c)) gasite.push(`${s}: ${t.trim().slice(0, 120)}`); });
  }));
  return gasite;
}

let trecute = 0;
let picate = 0;
function test(nume, ok, detalii) {
  if (ok) { trecute++; console.log(`  ✓ ${nume}`); } else { picate++; console.log(`  ✗ ${nume}${detalii ? `\n      ${detalii}` : ''}`); }
}

async function main() {
  const srv = await server();
  const BASE = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch();

  async function deschide({ profil, limba, latime, pagina }) {
    const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 800 ? 844 : 900 }, locale: 'en-GB', isMobile: latime < 800, hasTouch: latime < 800 });
    const p0 = profil ? PROFILURI[profil] : null;
    await ctx.addInitScript(sesiuneSimulata, { user: p0 ? { id: 'u-' + profil, email: p0.email, user_metadata: {} } : null, roles: p0 ? p0.roles : [], limba });
    await ctx.route(/supabase\.co|nominatim|googletagmanager|google-analytics/, (r) => r.abort());
    await ctx.route(/\/api\//, (r) => {
      const cale = new URL(r.request().url()).pathname.replace(/\.js$/, '');
      if (cale === '/api/cont/profil') {
        return p0 ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(p0) })
          : r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Neautentificat"}' });
      }
      const corp = r.request().method() === 'GET' ? (RASPUNSURI[cale] || { ok: true }) : { ok: true };
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corp) });
    });
    const page = await ctx.newPage();
    const erori = [];
    page.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
    await page.goto(BASE + pagina, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.documentElement.classList.contains('myd-i18n-pending'), null, { timeout: 8000 }).catch(() => {});
    return { ctx, page, erori };
  }
  const asteaptaAntet = (page) => page.waitForSelector('[data-myd-cont="1"]', { timeout: 10000, state: 'attached' }).catch(() => null);
  const depasire = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const captura = async (page, nume) => { if (CAPTURI) await page.screenshot({ path: path.join(CAPTURI, nume + '.png') }); };

  for (const limba of ['ro', 'en']) {
    for (const latime of [1366, 390]) {
      const et = `${limba.toUpperCase()} ${latime}px`;
      const mobil = latime < 640;
      console.log(`\n${et}`);

      // 1. Furnizor logat pe prima pagină
      {
        const { ctx, page, erori } = await deschide({ profil: 'furnizor', limba, latime, pagina: '/index.html' });
        await asteaptaAntet(page);
        await page.waitForTimeout(400);
        const st = await page.evaluate(() => {
          const b = document.getElementById('header-account-btn');
          const m = document.getElementById('mbn-cont');
          return {
            antet: b ? b.innerText.replace(/\s+/g, ' ').trim() : '', antetVizibil: b ? getComputedStyle(b).display !== 'none' : false,
            av: (document.querySelector('#header-account-btn .myd-cont-av') || {}).textContent || '',
            punct: !!document.querySelector('#header-account-btn .myd-cont-punct'),
            titlu: b ? b.title : '', bara: m ? m.innerText.replace(/\s+/g, ' ').trim() : '',
          };
        });
        const conectat = limba === 'ro' ? 'Conectat ca contact@homebestpal.ro' : 'Signed in as contact@homebestpal.ro';
        if (!mobil) {
          test(`${et}: antetul arată „HB”, „Home Best Pal”, punctul verde și „${conectat}”`, st.antetVizibil && st.av.startsWith('HB') && st.antet.includes('Home Best Pal') && st.punct && st.antet.includes(conectat), JSON.stringify(st));
          test(`${et}: emailul în tooltip`, st.titlu === 'contact@homebestpal.ro', st.titlu);
          await page.click('#myd-cont-sageata');
          const meniu = await page.locator('#myd-cont-meniu').innerText().catch(() => '');
          const asteptat = limba === 'ro' ? ['Dashboard-ul meu', 'Rolurile mele', 'Ieși'] : ['My dashboard', 'My roles', 'Sign out'];
          test(`${et}: meniul contului — ${asteptat.join(' / ')}`, asteptat.every((x) => meniu.includes(x)), meniu.replace(/\s+/g, ' '));
          await captura(page, `antet-furnizor-meniu-${limba}-${latime}`);
          test(`${et}: fără text românesc în antet și meniu`, limba === 'ro' || !(await page.evaluate(romanaInZone, ['#header-account-btn', '#myd-cont-meniu', '#mbn-cont'])).length,
            limba === 'en' ? JSON.stringify(await page.evaluate(romanaInZone, ['#header-account-btn', '#myd-cont-meniu', '#mbn-cont'])) : '');
          await page.keyboard.press('Escape');
          await Promise.all([page.waitForURL(/mydarrin-dashboard-furnizor\.html\?type=materiale/, { timeout: 8000 }).catch(() => {}), page.click('#header-account-btn')]);
        } else {
          test(`${et}: bara de jos arată „HB” și „${limba === 'ro' ? 'Contul meu' : 'My account'}”`, st.bara.startsWith('HB') && st.bara.includes(limba === 'ro' ? 'Contul meu' : 'My account'), JSON.stringify(st));
          await page.evaluate(() => window.openSidebar());
          await page.waitForSelector('#myd-cont-sb', { timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(500);
          const sb = await page.evaluate(() => ({
            id: (document.getElementById('myd-cont-sb') || {}).innerText || '',
            dash: (document.getElementById('myd-cont-sb-dashboard') || {}).innerText || '',
            iesi: (document.getElementById('myd-cont-sb-iesi') || {}).innerText || '',
          }));
          test(`${et}: meniul lateral — identitatea, „Dashboard-ul meu” și „Ieși”`, sb.id.includes('Home Best Pal') && sb.id.includes(conectat) && sb.dash.trim().length > 0 && sb.iesi.trim().length > 0, JSON.stringify(sb));
          await captura(page, `meniu-lateral-furnizor-${limba}-${latime}`);
          test(`${et}: fără text românesc în meniul lateral`, limba === 'ro' || !(await page.evaluate(romanaInZone, ['#myd-cont-sb', '#myd-cont-sb-dashboard', '#myd-cont-sb-iesi', '#mbn-cont'])).length,
            limba === 'en' ? JSON.stringify(await page.evaluate(romanaInZone, ['#myd-cont-sb', '#myd-cont-sb-dashboard', '#myd-cont-sb-iesi', '#mbn-cont'])) : '');
          await page.evaluate(() => window.closeSidebar());
          await Promise.all([page.waitForURL(/mydarrin-dashboard-furnizor\.html\?type=materiale/, { timeout: 8000 }).catch(() => {}), page.click('#mbn-cont')]);
        }
        test(`${et}: click pe cont → mydarrin-dashboard-furnizor.html?type=materiale`, /mydarrin-dashboard-furnizor\.html\?type=materiale$/.test(page.url()), page.url());

        // 4b. Dashboard-ul furnizorului: identitatea și benzile
        await page.waitForSelector('#myd-id', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(600);
        const d = await page.evaluate(() => ({
          nume: (document.getElementById('myd-id-nume') || {}).textContent || '',
          email: (document.getElementById('myd-id-email') || {}).textContent || '',
          insigna: (document.getElementById('myd-id-insigna') || {}).textContent || '',
          iesi: !!document.getElementById('myd-id-iesi'),
          contract: (document.getElementById('myd-banda-contract') || {}).innerText || '',
          banca: (document.getElementById('myd-banda-cont-bancar') || {}).innerText || '',
          verificare: !!document.getElementById('myd-banda-verificare'),
          overlay: !!document.getElementById('auth-gate-overlay'),
        }));
        test(`${et}: dashboard furnizor — firma, emailul, insigna „${limba === 'ro' ? 'Furnizor de materiale' : 'Materials supplier'}” și „Ieși”`,
          d.nume === 'Home Best Pal' && d.email.includes('contact@homebestpal.ro') && d.insigna === (limba === 'ro' ? 'Furnizor de materiale' : 'Materials supplier') && d.iesi && !d.overlay, JSON.stringify(d));
        test(`${et}: banda „contract nesemnat” și „fără cont bancar”, fără banda de verificare`,
          d.contract.includes(limba === 'ro' ? 'Semnează contractul ca să primești comenzi.' : 'Sign the contract to start receiving orders.')
          && d.banca.includes(limba === 'ro' ? 'Adaugă contul bancar pentru plăți.' : 'Add your bank account to receive payments.') && !d.verificare, JSON.stringify(d));
        await page.click('#myd-banda-cont-bancar button');
        const fer = await page.locator('.myd-fer').innerText().catch(() => '');
        test(`${et}: butonul din bandă deschide adăugarea contului bancar`, fer.includes('IBAN'), fer.slice(0, 120));
        test(`${et}: fără text românesc în identitate, benzi și fereastra contului bancar`, limba === 'ro' || !(await page.evaluate(romanaInZone, ['#myd-cont-antet', '.myd-fer'])).length,
          limba === 'en' ? JSON.stringify(await page.evaluate(romanaInZone, ['#myd-cont-antet', '.myd-fer'])) : '');
        await captura(page, `dashboard-furnizor-${limba}-${latime}`);
        await page.locator('#myd-cb-inchide').click().catch(() => {});
        test(`${et}: dashboard furnizor fără depășire pe orizontală`, (await depasire(page)) <= 1, String(await depasire(page)));
        test(`${et}: 0 erori JS (prima pagină + dashboard furnizor)`, erori.length === 0, erori.join(' | '));
        await ctx.close();
      }

      // 2. Client logat → click → dashboard-ul clientului
      {
        const { ctx, page, erori } = await deschide({ profil: 'client', limba, latime, pagina: '/index.html' });
        await asteaptaAntet(page);
        await page.waitForTimeout(300);
        const tinta = mobil ? '#mbn-cont' : '#header-account-btn';
        const av = await page.evaluate((s) => (document.querySelector(s + ' .myd-cont-av') || {}).textContent || '', tinta);
        test(`${et}: client — inițialele „AP” din numele profilului`, av.startsWith('AP'), av);
        await Promise.all([page.waitForURL(/mydarrin-dashboard-client\.html/, { timeout: 8000 }).catch(() => {}), page.click(tinta)]);
        test(`${et}: client — click pe cont → mydarrin-dashboard-client.html`, /mydarrin-dashboard-client\.html$/.test(page.url()), page.url());
        await page.waitForSelector('#myd-id', { timeout: 10000 }).catch(() => {});
        const ins = await page.locator('#myd-id-insigna').textContent().catch(() => '');
        test(`${et}: dashboard client — insigna „Client”, fără benzi de partener`, ins === 'Client' && !(await page.locator('.myd-banda').count()), ins);
        test(`${et}: dashboard client fără depășire`, (await depasire(page)) <= 1, String(await depasire(page)));
        test(`${et}: 0 erori JS (client)`, erori.length === 0, erori.join(' | '));
        await ctx.close();
      }

      // 3. Clientul deschide dashboard-ul de furnizor → redirect cu mesaj
      {
        const { ctx, page, erori } = await deschide({ profil: 'client', limba, latime, pagina: '/mydarrin-dashboard-furnizor.html?type=materiale' });
        await page.waitForURL(/mydarrin-dashboard-client\.html/, { timeout: 10000 }).catch(() => {});
        await page.waitForSelector('#myd-banda-redirect', { timeout: 10000 }).catch(() => {});
        const msg = await page.locator('#myd-banda-redirect').innerText().catch(() => '');
        test(`${et}: client pe dashboard-ul de furnizor → dashboard-ul clientului`, /mydarrin-dashboard-client\.html$/.test(page.url()), page.url());
        test(`${et}: mesajul „${limba === 'ro' ? 'Te-am dus în contul tău de client.' : 'We took you to your client account.'}”`,
          msg.includes(limba === 'ro' ? 'Te-am dus în contul tău de client.' : 'We took you to your client account.'), msg);
        await captura(page, `redirect-client-${limba}-${latime}`);
        test(`${et}: 0 erori JS (redirect)`, erori.length === 0, erori.join(' | '));
        await ctx.close();
      }

      // 4. Partener servicii în verificare
      {
        const { ctx, page, erori } = await deschide({ profil: 'servicii_verificare', limba, latime, pagina: '/mydarrin-dashboard-partener.html?type=servicii' });
        await page.waitForSelector('#myd-id', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(800);
        const b = await page.evaluate(() => ({
          verificare: (document.getElementById('myd-banda-verificare') || {}).innerText || '',
          contract: !!document.getElementById('myd-banda-contract'),
          banca: !!document.getElementById('myd-banda-cont-bancar'),
          insigna: (document.getElementById('myd-id-insigna') || {}).textContent || '',
        }));
        test(`${et}: pending_review → „${limba === 'ro' ? 'Contul tău e în verificare. Te anunțăm prin email.' : 'Your account is being reviewed. We will let you know by email.'}”`,
          b.verificare.includes(limba === 'ro' ? 'Contul tău e în verificare. Te anunțăm prin email.' : 'Your account is being reviewed. We will let you know by email.') && !b.contract, JSON.stringify(b));
        test(`${et}: partener servicii — insigna „${limba === 'ro' ? 'Partener servicii' : 'Service partner'}”`, b.insigna === (limba === 'ro' ? 'Partener servicii' : 'Service partner'), b.insigna);
        await page.click('#myd-banda-cont-bancar button').catch(() => {});
        await page.waitForTimeout(500);
        const titlu = await page.locator('#dp-page-title').textContent().catch(() => '');
        test(`${et}: „Adaugă contul bancar” duce la secțiunea „Cont bancar” a paginii`, /Cont bancar|Bank account/.test(titlu), titlu);
        test(`${et}: fără text românesc în identitate și benzi`, limba === 'ro' || !(await page.evaluate(romanaInZone, ['#myd-cont-antet'])).length,
          limba === 'en' ? JSON.stringify(await page.evaluate(romanaInZone, ['#myd-cont-antet'])) : '');
        await captura(page, `dashboard-partener-verificare-${limba}-${latime}`);
        test(`${et}: dashboard partener fără depășire`, (await depasire(page)) <= 1, String(await depasire(page)));
        test(`${et}: 0 erori JS (partener)`, erori.length === 0, erori.join(' | '));
        await ctx.close();
      }

      // 5. Fără sesiune → fereastra de login, cu revenire
      {
        const { ctx, page } = await deschide({ profil: null, limba, latime, pagina: '/mydarrin-dashboard-furnizor.html?type=materiale' });
        await page.waitForURL(/index\.html\?reason=cont/, { timeout: 10000 }).catch(() => {});
        const rev = await page.evaluate(() => sessionStorage.getItem('myd_revenire_dupa_login'));
        test(`${et}: fără sesiune → index.html?reason=cont, revenire la dashboard reținută`, /index\.html\?reason=cont/.test(page.url()) && rev === '/mydarrin-dashboard-furnizor.html?type=materiale', `${page.url()} · ${rev}`);
        await ctx.close();
      }
    }
  }

  await browser.close();
  srv.close();
  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
