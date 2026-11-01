// scripts/test-forma-juridica-dashboard.js
// Pasul 11-P3b (28 oct. 2026): în dashboard-ul partenerului (Profil → „Date
// firmă”), forma juridică apare cu eticheta din forme-juridice-public.js, în
// limba paginii, nu cu codul („srl”); la firma străină, și forma locală.
// Chromium (Playwright), RO și EN, 390 și 1366 px; /api simulat prin page.route,
// Supabase blocat — nimic nu ajunge la producție.
// Rulare: node scripts/test-forma-juridica-dashboard.js

const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const U = 'c0000000-0000-4000-8000-00000000000c';
const CAZURI = [
  { tip: 'srl', locala: null, ro: 'Societate cu răspundere limitată (SRL)', en: 'Limited liability company (SRL)' },
  { tip: 'firma_straina', locala: 'GmbH', ro: 'Firmă înregistrată în altă țară — GmbH', en: 'Company registered in another country — GmbH' },
  { tip: 'pfa', locala: null, ro: 'Persoană fizică autorizată (PFA)', en: 'Authorised self-employed person (PFA)' },
];

function sesiune(user) {
  const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
  const ses = { access_token: 'tok-p', user };
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: ses }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) },
    from: () => lant({ data: [], error: null, count: 0 }), rpc: () => lant({ data: null, error: null }), storage: { from: () => lant({ data: null, error: null }) }, channel: () => lant({}), removeChannel: () => {},
  };
  const auth = new Proxy({ getCurrentUser: async () => user, getUserRoles: async () => user.roles, hasRole: async () => true, performLogout: () => {} }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (n, v) => Object.defineProperty(window, n, { configurable: true, get: () => v, set: () => {} });
  fix('supabaseClient', client); fix('MyDarrinAuth', auth);
}

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const lang of ['ro', 'en']) {
      for (const latime of [390, 1366]) {
        for (const caz of CAZURI) {
          const et = `${lang} ${latime}px ${caz.tip}`;
          const ctx = await browser.newContext({ viewport: { width: latime, height: 900 } });
          await ctx.addInitScript((l) => {
            try {
              localStorage.setItem('myd_lang_v1', l);
              localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
            } catch (e) {}
          }, lang);
          await ctx.addInitScript(sesiune, { id: U, email: 'partener@example.com', roles: ['partener_servicii'], user_metadata: {} });
          await ctx.route(/\.supabase\.co\//, (r) => r.abort());
          const json = (r, corp) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corp) });
          await ctx.route(/\/api\//, (r) => {
            const cale = new URL(r.request().url()).pathname;
            if (cale === '/api/cont/profil') return json(r, { ok: true, email: 'partener@example.com', nume: 'Firma Test', roles: ['partener_servicii'], roluri_dashboard: ['partener_servicii'], partener: { partner_type: 'servicii' }, investitor: null });
            if (cale === '/api/partener/cont') {
              return json(r, {
                ok: true,
                partner: { id: U, partner_type: 'servicii', nume_firma: 'Firma Test', cui: 'RO123', tip_entitate_legala: caz.tip, forma_juridica_locala: caz.locala, regiune_cod: 'CJ', status_verificare: 'approved', contract_semnat: false },
                profil: { email: 'partener@example.com', phone: null, tara: 'RO' }, are_cont_bancar: false, kpi: {}, documente: [], facturi: [], garantii: [], polite: [],
              });
            }
            if (cale === '/api/cont/agenda') return json(r, { ok: true, adrese: [], profiluri: [] });
            return json(r, { ok: true });
          });
          const p = await ctx.newPage();
          const erori = []; p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
          await p.goto(baza + '/mydarrin-dashboard-partener.html', { waitUntil: 'networkidle' });
          await p.waitForFunction(() => typeof window.showPanel === 'function', null, { timeout: 8000 }).catch(() => {});
          await p.evaluate(() => window.showPanel('profil'));
          await p.waitForFunction(() => /CUI/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
          // Valoarea de sub eticheta „Formă juridică” / „Legal form”.
          const valoare = await p.evaluate(() => {
            const et = [...document.querySelectorAll('.dp-card-body > div > div')].find((d) => /^(Formă juridică|Legal form)$/.test(d.textContent.trim()));
            return et && et.nextElementSibling ? et.nextElementSibling.textContent.trim() : null;
          });
          verifica(valoare === caz[lang], `${et}: forma juridică afișată („${valoare}”, așteptat „${caz[lang]}”)`);
          verifica(valoare !== caz.tip, `${et}: nu apare codul`);
          const depasire = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
          verifica(!depasire, `${et}: fără depășire pe orizontală`);
          verifica(!erori.length, `${et}: 0 erori JS (${erori.join(' | ')})`);
          await ctx.close();
        }
        console.log(`${lang} ${latime}px: gata`);
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
