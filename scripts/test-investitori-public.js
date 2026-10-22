// scripts/test-investitori-public.js
// Pagina publică pentru investitori (pasul 11-A, 2.6, decizia LM C1):
//   - secțiunile cu cifre, rapoarte sau realizări nu mai există (KPIs Live,
//     proiecții, structura și alocarea rundei, roadmap, exit, ROI, fereastra
//     KPIs și butoanele ei); în locul lor, mesajul rundei curente (Seed);
//   - rămân funcționale: crearea contului de investitor și achiziția. De la
//     pasul 11-L, fără sesiune, „Intră în rundă” cere autentificarea / crearea
//     contului (cu revenire la ruta de investitor); ruta, KYC-ul și subscrierea
//     cu cont se testează în scripts/test-ruta-investitor.js;
//   - 0 erori JS, în RO și EN, la 390 și 1366 px.
// Serverul local e scripts/server-test.js (API-urile publice simulate sau 503);
// nimic nu ajunge la Supabase sau la producție.
//
// Cerințe (nu e dependență a proiectului):
//   npm i --no-save playwright && npx playwright install chromium
// Rulare: node scripts/test-investitori-public.js

const { chromium } = require('playwright');
const { porneste } = require('./server-test');

// Texte care nu au voie să apară (vizibile) pe pagină, în nicio limbă.
const INTERZISE = [
  'KPIs Live', '284.000', '284,000', '40% completat', '40% complete', '200.000 EUR', '200,000 EUR',
  '12,5%', '12.5%', 'Equity oferit', 'Equity offered', '2% equity', 'Take rate', 'TAM', 'ROI 20', '20–48',
  'Impozit ANAF', 'Next distribuție', 'Next distribution', 'Lock-up', 'runway', 'Pre-Seed',
  'Platformă live în România', 'Platform live in Romania', 'Q4 2026', 'Q3 2026', '25K EUR',
];
const SECTIUNI_SCOASE = ['#kpis', '#proiectii', '#exit', '#modal-kpis', '#nav-kpis', '#nav-proiectii', '#nav-exit'];

let ok = 0, esec = 0;
function verifica(cond, mesaj) {
  if (cond) { ok++; } else { esec++; console.log('  ✗ ' + mesaj); }
}

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const lang of ['ro', 'en']) {
      for (const latime of [390, 1366]) {
        const eticheta = `${lang} ${latime}px`;
        const ctx = await browser.newContext({ viewport: { width: latime, height: 900 } });
        // Limba aleasă și consimțământul cookie deja dat (bara nu acoperă butoanele).
        await ctx.addInitScript((l) => {
          try {
            localStorage.setItem('myd_lang_v1', l);
            localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
          } catch (e) {}
        }, lang);
        const pagina = await ctx.newPage();
        const erori = [];
        pagina.on('pageerror', (e) => erori.push(e.message));
        await pagina.goto(baza + '/mydarrin-investitori', { waitUntil: 'networkidle' });
        await pagina.waitForTimeout(800);

        verifica(await pagina.evaluate(() => document.documentElement.lang) === lang, `${eticheta}: lang=${lang}`);
        for (const sel of SECTIUNI_SCOASE) {
          verifica(await pagina.$(sel) === null, `${eticheta}: ${sel} nu mai există`);
        }
        const text = await pagina.evaluate(() => document.body.innerText);
        for (const t of INTERZISE) verifica(!text.includes(t), `${eticheta}: „${t}” nu apare`);
        const html = await pagina.content();
        verifica(!html.includes('KPIs Live') && !html.includes('284.000'), `${eticheta}: „KPIs Live” / „284.000” nu sunt în HTML`);

        // Mesajul rundei curente
        const runda = await pagina.$('#runda');
        verifica(runda && await runda.isVisible(), `${eticheta}: secțiunea #runda e vizibilă`);
        const textRunda = runda ? await runda.innerText() : '';
        verifica(/Seed/.test(textRunda), `${eticheta}: #runda spune „Seed”`);

        // Crearea contului de investitor: fără sesiune, „Intră în rundă” duce la
        // autentificare / creare cont, cu revenire la ruta de investitor (11-L).
        verifica(await pagina.$('#step-2 #ticket-lista') !== null, `${eticheta}: lista de tickete a achiziției există (se umple din rundă)`);
        await pagina.focus('#runda button');
        await pagina.keyboard.press('Enter');
        await pagina.waitForURL(/reason=cont/, { timeout: 8000 }).catch(() => {});
        verifica(/reason=cont/.test(pagina.url()), `${eticheta}: „Intră în rundă” deschide autentificarea / crearea contului`);
        const revenire = await pagina.evaluate(() => sessionStorage.getItem('myd_revenire_dupa_login'));
        verifica(revenire === '/mydarrin-investitori.html?ruta=investitor', `${eticheta}: revenirea la ruta de investitor e reținută`);

        verifica(erori.length === 0, `${eticheta}: 0 erori JS (${erori.join(' | ')})`);
        console.log(`${eticheta}: ${erori.length} erori JS`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
