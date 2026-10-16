// scripts/test-dashboard-furnizor.js
// Teste pentru pasul 11-H1 (16 oct. 2026): dashboard-ul furnizorului, corecții rapide.
//   A. API-urile, pe Supabase simulat (scripts/supabase-simulat.js):
//      - GET /api/partener/discounturi: fără limite la furnizorul propriu și la
//        curier; furnizorul extern le primește ca azi;
//      - GET /api/partener/profil-status: furnizorul propriu fără clauza de zonă;
//        furnizorii de materiale / închirieri fără NACE la nivel de cont;
//        partenerul de servicii e întrebat de NACE ca azi;
//      - lib/verifica-profil-complet-partener.js: furnizorul propriu are
//        profilul complet (fără reminderul cu contul bancar).
//   B. Playwright, RO și EN, 1366 și 390 px (/api/cont/profil și API-urile
//      partenerului simulate, nimic nu pleacă spre Supabase):
//      - niciun meniu de partener (furnizor: materiale, închirieri; partener:
//        servicii, curier, asigurări) nu are legături spre pagini de admin;
//      - furnizorul propriu: fără discount în bara de sus, fără benzile de
//        contract / cont bancar / clauză de zonă, cu insigna „Furnizor propriu
//        al platformei” / „Platform’s own supplier”;
//      - furnizorul extern: discountul și benzile rămân ca azi;
//      - furnizorul de închirieri: fără „Calendar disponibilitate” și „Alerte
//        siguranță” (nici prin showPanel);
//      - fără „Live · sync activ”; „Prezentare generală” în RO, „Overview” în EN;
//      - la 390 px: nimic nu iese din ecran (măsurat pe elemente, nu doar pe
//        scrollWidth) și tabelul de produse se derulează în containerul lui;
//      - 0 erori JS.
//
// Cerințe pentru B (nu e dependență a proiectului):
//   npm i --no-save playwright && npx playwright install chromium
// Rulare: node scripts/test-dashboard-furnizor.js [--capturi <dosar>]

const http = require('http');
const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

const apiDiscounturi = require(path.join(RADACINA, 'api/partener/discounturi.js'));
const apiProfilStatus = require(path.join(RADACINA, 'api/partener/profil-status.js'));
const { esteProfilComplet } = require(path.join(RADACINA, 'lib/verifica-profil-complet-partener.js'));

const arg = process.argv.slice(2);
const CAPTURI = arg.includes('--capturi') ? arg[arg.indexOf('--capturi') + 1] : null;
if (CAPTURI) fs.mkdirSync(CAPTURI, { recursive: true });

let trecute = 0;
let picate = 0;
async function test(nume, fn) {
  try { await fn(); trecute++; console.log(`  ✓ ${nume}`); } catch (e) { picate++; console.log(`  ✗ ${nume}\n      ${e.message}`); }
}
function egal(a, b, mesaj) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${mesaj || ''} — așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }

// ── A. Date simulate (structura reală; id-urile sunt de test) ─────────────
const HBP = 'p-hbp';
const EXTERN = 'p-extern';
const UTILAJE = 'p-utilaje';
const CURIER = 'p-curier';
const SERVICII = 'p-servicii';

function reseteaza() {
  DB.tabele = {
    partners: [
      { id: HBP, partner_type: 'furnizor_materiale', nume_firma: 'Home Best Pal', status_verificare: 'approved', entitate_platforma_id: 'ent-ro' },
      { id: EXTERN, partner_type: 'furnizor_materiale', nume_firma: 'Furnizor Extern SRL', status_verificare: 'approved', entitate_platforma_id: null },
      { id: UTILAJE, partner_type: 'inchirieri_utilaje', nume_firma: 'Utilaje SRL', status_verificare: 'approved', entitate_platforma_id: null },
      { id: CURIER, partner_type: 'curier', nume_firma: 'Curier PFA', status_verificare: 'approved', entitate_platforma_id: null },
      { id: SERVICII, partner_type: 'servicii_tehnice', nume_firma: 'Instalatii SRL', status_verificare: 'approved', entitate_platforma_id: null },
    ],
    profiles: [
      { id: HBP, roles: ['partener_materiale'] },
      { id: EXTERN, roles: ['partener_materiale'] },
      { id: UTILAJE, roles: ['partener_inchirieri'] },
      { id: CURIER, roles: ['partener_curier'] },
      { id: SERVICII, roles: ['partener_servicii'] },
    ],
    backoffice_config: [
      { sectiune: 'pricing', cheie: 'discount_partener_min_pct', valoare: '5', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'discount_partener_max_pct', valoare: '15', tara_cod: 'ALL' },
    ],
    parteneri_discounturi: [],
    partner_coduri_nace: [],
    partner_alocari_sarcini: [],
    partner_conturi_bancare: [],
    partener_servicii_active: [],
  };
  DB.coloane = {};
  DB.utilizatori = { 'tok-hbp': { id: HBP }, 'tok-ext': { id: EXTERN }, 'tok-utl': { id: UTILAJE }, 'tok-cur': { id: CURIER }, 'tok-svc': { id: SERVICII } };
}

async function get(api, token) {
  const res = raspuns();
  await api(cerere({ token }), res);
  return res;
}

async function parteaA() {
  console.log('A. API-urile');
  await test('discounturi: furnizorul propriu → fără limite, fara_discount = furnizor_propriu', async () => {
    reseteaza();
    const r = await get(apiDiscounturi, 'tok-hbp');
    egal([r.statusCode, r.corp.limite, r.corp.fara_discount, r.corp.discounturi], [200, undefined, 'furnizor_propriu', []]);
  });
  await test('discounturi: curier → fără limite, fara_discount = curier', async () => {
    reseteaza();
    DB.tabele.profiles.find((p) => p.id === CURIER).roles = ['partener_curier'];
    const r = await get(apiDiscounturi, 'tok-cur');
    egal([r.statusCode, r.corp.limite, r.corp.fara_discount], [200, undefined, 'curier']);
  });
  await test('discounturi: furnizor extern → limitele din panou (5–15), ca azi', async () => {
    reseteaza();
    const r = await get(apiDiscounturi, 'tok-ext');
    egal([r.statusCode, r.corp.limite && r.corp.limite.min, r.corp.limite && r.corp.limite.max, r.corp.fara_discount], [200, 5, 15, undefined]);
  });
  await test('profil-status: furnizorul propriu fără NACE de cont și fără clauză → complet', async () => {
    reseteaza();
    const r = await get(apiProfilStatus, 'tok-hbp');
    egal([r.statusCode, r.corp.complet, r.corp.lipsa, r.corp.pas], [200, true, [], null]);
  });
  await test('profil-status: furnizor extern de materiale → doar clauza de zonă (NACE e pe produse)', async () => {
    reseteaza();
    const r = await get(apiProfilStatus, 'tok-ext');
    egal([r.corp.complet, r.corp.lipsa, r.corp.pas], [false, ['clauza_zona'], 7]);
  });
  await test('profil-status: furnizor de închirieri cu clauza acceptată → complet', async () => {
    reseteaza();
    DB.tabele.partner_alocari_sarcini.push({ id: 'a1', partner_id: UTILAJE, zona_livrare_acceptata: true });
    const r = await get(apiProfilStatus, 'tok-utl');
    egal([r.corp.complet, r.corp.lipsa], [true, []]);
  });
  await test('profil-status: partener de servicii → NACE și clauza, ca azi', async () => {
    reseteaza();
    const r = await get(apiProfilStatus, 'tok-svc');
    egal([r.corp.complet, r.corp.lipsa, r.corp.pas], [false, ['nace', 'clauza_zona'], 3]);
  });
  await test('profil complet (reminder 48h): furnizorul propriu → complet; furnizorul extern fără cont bancar → incomplet', async () => {
    reseteaza();
    egal([await esteProfilComplet(HBP), await esteProfilComplet(EXTERN)], [true, false]);
  });
}

// ── B. Playwright ─────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
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

// Profilurile simulate, în forma reală a /api/cont/profil (pasul 10c).
const partener = (x) => ({ contract_semnat: false, cont_bancar: false, motiv_respingere: null, poate_vinde: false, motiv_nu_poate_vinde: 'fara_cont_bancar', ...x });
const CONTURI = {
  propriu: {
    pagina: '/mydarrin-dashboard-furnizor.html?type=materiale',
    profil: { ok: true, email: 'contact@homebestpal.ro', nume: null, roles: ['client', 'partener_materiale'], furnizor_propriu: true, roluri_dashboard: ['partener_materiale'], destinatie: '/mydarrin-dashboard-furnizor.html?type=materiale', tip_destinatie: 'rol',
      partener: partener({ nume_firma: 'Home Best Pal', partner_type: 'furnizor_materiale', rol: 'partener_materiale', status_verificare: 'approved', poate_vinde: true, motiv_nu_poate_vinde: null }) },
    discounturi: { ok: true, discounturi: [], fara_discount: 'furnizor_propriu' },
    profilStatus: { ok: true, complet: true, lipsa: [], pas: null },
  },
  extern: {
    pagina: '/mydarrin-dashboard-furnizor.html?type=materiale',
    profil: { ok: true, email: 'vanzari@instal-extern.ro', nume: null, roles: ['partener_materiale'], furnizor_propriu: false, roluri_dashboard: ['partener_materiale'], destinatie: '/mydarrin-dashboard-furnizor.html?type=materiale', tip_destinatie: 'rol',
      partener: partener({ nume_firma: 'Instal Extern', partner_type: 'furnizor_materiale', rol: 'partener_materiale', status_verificare: 'approved' }) },
    discounturi: { ok: true, discounturi: [], limite: { min: 5, max: 15 } },
    profilStatus: { ok: true, complet: false, lipsa: ['clauza_zona'], pas: 7 },
  },
  inchirieri: {
    pagina: '/mydarrin-dashboard-furnizor.html?type=inchirieri',
    profil: { ok: true, email: 'contact@utilaje-test.ro', nume: null, roles: ['partener_inchirieri'], furnizor_propriu: false, roluri_dashboard: ['partener_inchirieri'], destinatie: '/mydarrin-dashboard-furnizor.html?type=inchirieri', tip_destinatie: 'rol',
      partener: partener({ nume_firma: 'Utilaje Test', partner_type: 'inchirieri_utilaje', rol: 'partener_inchirieri', status_verificare: 'approved', contract_semnat: true, cont_bancar: true, poate_vinde: true, motiv_nu_poate_vinde: null }) },
    discounturi: { ok: true, discounturi: [], limite: { min: 5, max: 15 } },
    profilStatus: { ok: true, complet: true, lipsa: [], pas: null },
  },
  servicii: {
    pagina: '/mydarrin-dashboard-partener.html?type=servicii',
    profil: { ok: true, email: 'contact@instalatii-test.ro', nume: null, roles: ['partener_servicii', 'partener_curier', 'partener_asigurari'], furnizor_propriu: false, roluri_dashboard: ['partener_servicii', 'partener_curier', 'partener_asigurari'], destinatie: '/?alege_rol=1', tip_destinatie: 'alegere',
      partener: partener({ nume_firma: 'Instalatii Test', partner_type: 'servicii_tehnice', rol: 'partener_servicii', status_verificare: 'approved' }) },
    discounturi: { ok: true, discounturi: [], fara_discount: 'curier' },
    profilStatus: { ok: true, complet: false, lipsa: ['nace', 'clauza_zona'], pas: 3 },
  },
};
// Produse cu nume lungi: tabelul e mai lat decât ecranul de 390 px.
const PRODUSE = [1, 2, 3].map((i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, denumire: `Calorifer din oțel de test, model lung numărul ${i}, 600 × 1200 mm`, cod_produs_furnizor: `COD-TEST-LUNG-000${i}`, pret_fara_tva: 245.5, moneda: 'RON', unitate_masura: 'buc', stoc_disponibil: 12, tarif_zi: 80, buc_disponibile: 2, status: 'live', activ: true }));

function sesiuneSimulata(cfg) {
  const lant = (rezultat) => {
    const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rezultat) : () => p), apply: () => p });
    return p;
  };
  const user = cfg.user;
  const sesiune = { access_token: 'token-simulat', user };
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
    performLogout: () => {},
  }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (nume, val) => Object.defineProperty(window, nume, { configurable: true, get: () => val, set: () => {} });
  fix('supabaseClient', client);
  fix('MyDarrinAuth', auth);
  try {
    if (!sessionStorage.getItem('__init')) {
      localStorage.clear();
      if (cfg.limba === 'ro') localStorage.setItem('myd_lang_v1', 'ro');
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: '2026-10-16T08:00:00Z', versiune: 1 }));
      sessionStorage.setItem('__init', '1');
    }
  } catch (e) {}
}

// În pagină: elementele vizibile tăiate la dreapta ecranului, în afara
// containerelor derulabile (aceeași regulă ca în scripts/detector-ro.js).
function masoaraDepasire() {
  const W = window.innerWidth;
  const vizibil = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const derulabil = (el) => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const ox = getComputedStyle(e).overflowX; if (ox === 'auto' || ox === 'scroll') return true; } return false; };
  const taiate = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (!vizibil(el) || /^(SCRIPT|STYLE|svg|path|OPTION)$/i.test(el.tagName)) return;
    const r = el.getBoundingClientRect();
    if (r.right <= W + 1 || r.left >= W - 1 || r.right <= 0 || derulabil(el)) return;
    if (taiate.length < 5) taiate.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className || '').split(' ')[0]} → ${Math.round(r.right)}px`);
  });
  return taiate;
}

async function parteaB() {
  console.log('B. Dashboard-urile (Playwright)');
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) {
    console.log('  – Playwright lipsește (npm i --no-save playwright): partea B sărită.');
    return;
  }
  const srv = await server();
  const BASE = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch();
  const t = (nume, ok, detalii) => { if (ok) { trecute++; console.log(`  ✓ ${nume}`); } else { picate++; console.log(`  ✗ ${nume}${detalii ? `\n      ${detalii}` : ''}`); } };
  const ADMIN = /superadmin|admin-catalog|mydarrin-admin|back-?office|\/admin/i;
  try {
    for (const limba of ['ro', 'en']) {
      for (const latime of [1366, 390]) {
        for (const cont of Object.keys(CONTURI)) {
          const c = CONTURI[cont];
          const et = `${limba.toUpperCase()} ${latime}px ${cont}`;
          const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 800 ? 844 : 900 }, locale: 'en-GB', isMobile: latime < 800, hasTouch: latime < 800 });
          await ctx.addInitScript(sesiuneSimulata, { user: { id: 'u-' + cont, email: c.profil.email, user_metadata: {} }, roles: c.profil.roles, limba });
          await ctx.route(/supabase\.co|nominatim|googletagmanager|google-analytics/, (r) => r.abort());
          await ctx.route(/\/api\//, (r) => {
            const cale = new URL(r.request().url()).pathname.replace(/\.js$/, '');
            const corp = {
              '/api/cont/profil': c.profil,
              '/api/partener/discounturi': c.discounturi,
              '/api/partener/profil-status': c.profilStatus,
              '/api/partener/cont': { ok: true, partner: { nume_firma: c.profil.partener.nume_firma, partner_type: c.profil.partener.partner_type, status_verificare: c.profil.partener.status_verificare, regiune_cod: 'BC', contract_semnat: c.profil.partener.contract_semnat },
                profil: { email: c.profil.email, tara: 'RO', limba: limba }, are_cont_bancar: c.profil.partener.cont_bancar,
                kpi: { moneda: 'RON', comenzi_active: 0, comenzi_luna: 0, total_activ: 0, total_eliberat: 0, castig_luna: 0, castig_azi: 0 }, documente: [], facturi: [], garantii: [], polite: [] },
              '/api/partener/facturi': { ok: true, facturabile: [], facturi: [] },
              '/api/partener/escrow-tracker': { ok: true, total_activ: 0, total_eliberat: 0, moneda: 'RON', alocari: [] },
              '/api/marketplace/produse': { ok: true, produse: PRODUSE },
            }[cale] || { ok: true };
            return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corp) });
          });
          const page = await ctx.newPage();
          const erori = [];
          page.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
          await page.goto(BASE + c.pagina, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('#myd-id', { timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(1200);

          // Meniurile: definițiile (toate tipurile din pagină) și meniul afișat.
          const meniu = await page.evaluate(() => {
            const defs = typeof FTYPES !== 'undefined' ? FTYPES : (typeof TYPES !== 'undefined' ? TYPES : {});
            const hrefDef = Object.values(defs).flatMap((x) => (x.nav || []).map((i) => i.href).filter(Boolean));
            const nav = document.getElementById('fb-nav') || document.getElementById('dp-nav');
            const hrefDom = [...(nav ? nav.querySelectorAll('a[href]') : [])].map((a) => a.getAttribute('href'));
            const etichete = nav ? nav.innerText : '';
            return { hrefDef, hrefDom, etichete, idDef: Object.values(defs).flatMap((x) => (x.nav || []).map((i) => i.id).filter(Boolean)) };
          });
          t(`${et}: meniul nu are legături spre pagini de admin`, ![...meniu.hrefDef, ...meniu.hrefDom].some((h) => ADMIN.test(h)), JSON.stringify(meniu.hrefDef));
          const prezentare = limba === 'ro' ? 'Prezentare generală' : 'Overview';
          t(`${et}: meniul are „${prezentare}”`, meniu.etichete.includes(prezentare) && (limba === 'en' || !/\bOverview\b/.test(meniu.etichete)), meniu.etichete.slice(0, 120));

          const d = await page.evaluate(() => {
            const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
            const promo = document.getElementById('fb-promo-wrap');
            return {
              discountVizibil: vis(promo),
              discount: promo ? promo.innerText.replace(/\s+/g, ' ').trim() : '',
              live: /sync activ|sync active/i.test(document.body.innerText),
              insigna: (document.getElementById('myd-id-furnizor-propriu') || {}).textContent || '',
              contract: !!document.getElementById('myd-banda-contract'),
              banca: !!document.getElementById('myd-banda-cont-bancar'),
              profilIncomplet: vis(document.getElementById('profil-incomplet-card')),
              profilText: (document.getElementById('profil-incomplet-card') || {}).innerText || '',
            };
          });
          t(`${et}: fără „Live · sync activ”`, !d.live);
          if (cont === 'propriu') {
            t(`${et}: furnizorul propriu — fără discount în bara de sus`, !d.discountVizibil, JSON.stringify(d));
            t(`${et}: furnizorul propriu — fără benzile de contract, cont bancar și clauză de zonă`, !d.contract && !d.banca && !d.profilIncomplet, JSON.stringify(d));
            const insigna = limba === 'ro' ? 'Furnizor propriu al platformei' : 'Platform’s own supplier';
            t(`${et}: furnizorul propriu — insigna „${insigna}”`, d.insigna === insigna, JSON.stringify(d));
          }
          if (cont === 'extern') {
            t(`${et}: furnizorul extern — discountul 5–15% în bara de sus, ca azi`, d.discountVizibil && d.discount.includes('5–15%'), JSON.stringify(d));
            t(`${et}: furnizorul extern — banda de cont bancar și clauza de zonă rămân`, d.banca && d.profilIncomplet, JSON.stringify(d));
          }
          if (cont === 'inchirieri') {
            const ascunse = limba === 'ro' ? ['Calendar disponibilitate', 'Alerte siguranță'] : ['Availability calendar', 'Safety alerts'];
            t(`${et}: închirieri — meniul fără „${ascunse.join('” și „')}”`, !ascunse.some((x) => meniu.etichete.includes(x)) && !meniu.idDef.includes('calendar') && !meniu.idDef.includes('alerte'), meniu.etichete);
            const panou = await page.evaluate(() => { showPanel('calendar'); const a = currentPanel; showPanel('alerte'); return [a, currentPanel, document.getElementById('fb-page-title').innerText]; });
            t(`${et}: închirieri — showPanel('calendar' / 'alerte') duce la prezentarea generală`, panou[0] === 'overview' && panou[1] === 'overview', JSON.stringify(panou));
          }

          // Panoul de produse (furnizori): tabelul se derulează în containerul lui.
          if (c.pagina.includes('furnizor')) {
            await page.evaluate(() => showPanel('produse'));
            await page.waitForFunction(() => /COD-TEST/.test((document.getElementById('produse-live-tbody') || {}).innerText || ''), null, { timeout: 8000 }).catch(() => {});
            const tabel = await page.evaluate(() => {
              const tb = document.getElementById('produse-live-tbody');
              const cont = tb && tb.closest('.f-card');
              if (!cont) return null;
              const r = cont.getBoundingClientRect();
              return { ox: getComputedStyle(cont).overflowX, sw: cont.scrollWidth, cw: cont.clientWidth, dreapta: Math.round(r.right), W: innerWidth };
            });
            t(`${et}: tabelul de produse în containerul lui, în ecran`, tabel && tabel.ox === 'auto' && tabel.dreapta <= tabel.W, JSON.stringify(tabel));
            if (latime === 390) t(`${et}: tabelul de produse se derulează pe orizontală (mai lat decât ecranul)`, tabel && tabel.sw > tabel.cw, JSON.stringify(tabel));
          }
          const taiate = await page.evaluate(masoaraDepasire);
          t(`${et}: nimic nu iese din ecran`, !taiate.length, taiate.join(' | '));
          t(`${et}: 0 erori JS`, erori.length === 0, erori.join(' | '));
          if (CAPTURI) await page.screenshot({ path: path.join(CAPTURI, `${cont}-${limba}-${latime}.png`) });
          await ctx.close();
        }
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

(async () => {
  await parteaA();
  await parteaB();
  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exitCode = picate ? 1 : 0;
})();
