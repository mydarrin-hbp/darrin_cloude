// scripts/test-statistici-publice.js
// Pasul 11-J, punctul 2.5 (21 oct. 2026): blocul de indicatori din paginile
// publice ([data-kpi-bloc], statistici-publice.js) folosește doar cifrele
// publice din /api/public/statistici-homepage, nu RPC-ul get_live_investor_kpis.
// Pe fiecare pagină cu bloc, RO și EN:
//   - nicio cerere către rpc/get_live_investor_kpis;
//   - cifrele > 0 apar, cele egale cu 0 rămân ascunse; grila are atâtea coloane
//     câte cifre se văd;
//   - toate cifrele 0 → blocul rămâne ascuns;
//   - etichetele sunt traduse în EN.
// statistici-homepage e simulat (cifre de test); Supabase e blocat.
// Rulare: node scripts/test-statistici-publice.js

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const RADACINA = path.join(__dirname, '..');
const PAGINI = fs.readdirSync(RADACINA).filter((f) => f.endsWith('.html') && fs.readFileSync(path.join(RADACINA, f), 'utf8').includes('data-kpi-bloc'));

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

async function deschide(browser, baza, pagina, lang, cifre) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('myd_lang_v1', l);
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
    } catch (e) {}
  }, lang);
  const rpc = [];
  ctx.on('request', (r) => { if (/get_live_investor_kpis/.test(r.url())) rpc.push(r.url()); });
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  await ctx.route(/\/api\/public\/statistici-homepage/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign({ ok: true }, cifre)) }));
  const p = await ctx.newPage();
  const erori = []; p.on('pageerror', (e) => erori.push(e.message));
  await p.goto(baza + '/' + pagina, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(300);
  const bloc = await p.evaluate(() => {
    const b = document.querySelector('[data-kpi-bloc]');
    if (!b) return { lipsa: location.pathname, celule: [] };
    return {
      afisat: b.style.display !== 'none',
      coloane: b.style.gridTemplateColumns,
      celule: [...b.querySelectorAll('[data-kpi]')].map((c) => ({
        cheie: c.getAttribute('data-kpi'), vizibil: c.style.display !== 'none',
        valoare: (c.querySelector('[data-kpi-valoare]') || {}).textContent || '', text: c.textContent.replace(/\s+/g, ' ').trim(),
      })),
    };
  });
  await ctx.close();
  return { bloc, rpc, erori };
}

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    verifica(PAGINI.length >= 12, `paginile cu bloc de indicatori: ${PAGINI.length}`);
    // Toate paginile: aceleași chei, din statistici-homepage, și statistici-publice.js.
    for (const pagina of PAGINI) {
      const h = fs.readFileSync(path.join(RADACINA, pagina), 'utf8');
      const chei = (h.match(/data-kpi="[a-z_]+"/g) || []).join(',');
      verifica(chei === 'data-kpi="clienti_activi",data-kpi="parteneri_verificati",data-kpi="devize_ai_luna"' && h.includes('statistici-publice.js'), `${pagina}: cheile din statistici-homepage (${chei})`);
    }
    // În browser: paginile publice (dashboard-ul clientului cere cont și redirecționează).
    for (const pagina of PAGINI.filter((f) => f !== 'mydarrin-dashboard-client.html')) {
      for (const lang of ['ro', 'en']) {
        const et = `${pagina} ${lang}`;
        const { bloc, rpc, erori } = await deschide(browser, baza, pagina, lang, { clienti_activi: 3, parteneri_verificati: 0, devize_ai_luna: 7 });
        if (bloc.lipsa) { verifica(false, `${et}: blocul lipsește după încărcare (${bloc.lipsa})`); continue; }
        verifica(rpc.length === 0, `${et}: nicio cerere către get_live_investor_kpis (${rpc.join(', ')})`);
        verifica(JSON.stringify(bloc.celule.map((c) => c.cheie)) === JSON.stringify(['clienti_activi', 'parteneri_verificati', 'devize_ai_luna']), `${et}: cheile blocului (${bloc.celule.map((c) => c.cheie)})`);
        const [cl, pa, de] = bloc.celule;
        verifica(bloc.afisat && /repeat\(2,/.test(bloc.coloane), `${et}: blocul apare cu 2 coloane (${bloc.coloane})`);
        verifica(cl.vizibil && cl.valoare === '3' && de.vizibil && de.valoare === '7', `${et}: cifrele > 0 apar (${cl.valoare}, ${de.valoare})`);
        verifica(!pa.vizibil, `${et}: cifra 0 rămâne ascunsă`);
        if (lang === 'en') {
          verifica(/Active customers/.test(cl.text) && /Verified partners/.test(pa.text) && /AI quotes \/ month/.test(de.text), `${et}: etichete în EN (${bloc.celule.map((c) => c.text).join(' | ')})`);
        } else {
          verifica(/Clienți activi/.test(cl.text) && /Parteneri verificați/.test(pa.text) && /Devize AI \/ lună/.test(de.text), `${et}: etichete în RO`);
        }
        verifica(!erori.length, `${et}: 0 erori JS (${erori.join(' | ')})`);
      }
      const zero = await deschide(browser, baza, pagina, 'ro', { clienti_activi: 0, parteneri_verificati: 0, devize_ai_luna: 0 });
      verifica(!zero.bloc.afisat, `${pagina}: toate cifrele 0 → blocul rămâne ascuns`);
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
