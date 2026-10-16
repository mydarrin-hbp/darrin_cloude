// scripts/test-cauta-firma.js
// Teste pentru căutarea firmei la ANAF (pasul 10d, 16 oct. 2026): adresa
// nouă v9, citirea câmpurilor, erorile spuse adevărat (indisponibil vs.
// eroare de configurare) și CUI negăsit. `fetch` simulat — fără rețea.
// Secțiunea 8 deschide „Devino partener” în Chromium (RO și EN) cu
// /api/public/cui-lookup simulat; se sare dacă Playwright nu e instalat:
//   npm i --no-save playwright && npx playwright install chromium
//
// Rulare: node scripts/test-cauta-firma.js

const fs = require('fs');
const http = require('http');
const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { cerere, raspuns, RADACINA } = sim;

// Limitarea de rată folosește Vercel KV; aici o lăsăm să treacă.
require.cache[require.resolve(path.join(RADACINA, 'lib/rate-limit.js'))] = {
  exports: { checkRateLimit: async () => true, getClientIp: () => '127.0.0.1' },
};

const { ANAF_URL, MESAJE_ANAF, cautaANAF } = require(path.join(RADACINA, 'lib/cauta-firma.js'));
const cuiLookup = require(path.join(RADACINA, 'api/public/cui-lookup.js'));

let trecute = 0;
let picate = 0;
async function test(nume, fn) {
  try { await fn(); trecute++; console.log(`  ✓ ${nume}`); } catch (e) { picate++; console.log(`  ✗ ${nume}\n      ${e.message}`); }
}
function egal(a, b, mesaj) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${mesaj || ''} — așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(v, mesaj) { if (!v) throw new Error(mesaj || 'condiție falsă'); }
async function aruncaCod(fn, cod) {
  try { await fn(); } catch (e) { egal(e.cod, cod, 'codul erorii'); return e; }
  throw new Error(`trebuia să arunce ${cod}`);
}

// Structura răspunsului v9, așa cum a venit de la ANAF; datele firmei sunt
// simulate (testul verifică doar că se citesc câmpurile corecte).
const ANAF_GASIT = {
  found: [{
    date_generale: { cui: 46577229, denumire: 'FIRMA SIMULATA SRL', adresa: 'ADRESA SIMULATA', nrRegCom: 'J00/0000/2000', cod_CAEN: '0000' },
    inregistrare_scop_Tva: { scpTVA: true, perioade_TVA: [] },
  }],
  notFound: [],
};

let cerut = null;
let simulare = null;
global.fetch = async (url, opt) => {
  cerut = { url, metoda: opt.method, corp: JSON.parse(opt.body) };
  return simulare(url, opt);
};
const jsonRaspuns = (status, corp) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => corp });
const textRaspuns = (status, text) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => { throw new SyntaxError(`Unexpected token in ${text}`); } });
const tacut = (fn) => async () => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

(async () => {
  console.log('1. Adresa ANAF');
  await test('se apelează adresa nouă v9, cu POST și corpul [{cui, data}]', async () => {
    simulare = jsonRaspuns(200, ANAF_GASIT);
    await cautaANAF('46577229');
    egal(ANAF_URL, 'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva');
    egal(cerut.url, ANAF_URL);
    egal(cerut.metoda, 'POST');
    egal(cerut.corp[0].cui, 46577229);
    adevarat(/^\d{4}-\d{2}-\d{2}$/.test(cerut.corp[0].data), 'data în format YYYY-MM-DD');
  });
  await test('adresa e scrisă o singură dată (testeaza.js o importă)', async () => {
    const surse = ['lib/cauta-firma.js', 'api/admin/integrari/testeaza.js', 'api/public/cui-lookup.js', 'api/admin/entitati-juridice.js']
      .map((f) => fs.readFileSync(path.join(RADACINA, f), 'utf8'));
    egal(surse.join('\n').split('webservicesp.anaf.ro').length - 1, 1, 'apariții ale adresei');
    adevarat(surse[1].includes('ANAF_URL'), 'testeaza.js nu folosește ANAF_URL');
  });

  console.log('2. Răspuns valid');
  await test('câmpurile corecte: cui, denumire, adresa, nr_reg_com, tva_activ', async () => {
    simulare = jsonRaspuns(200, ANAF_GASIT);
    egal(await cautaANAF('46577229'), {
      cui: '46577229', denumire: 'FIRMA SIMULATA SRL', adresa: 'ADRESA SIMULATA', nr_reg_com: 'J00/0000/2000', tva_activ: true,
    });
  });

  console.log('3. CUI negăsit');
  await test('404 cu {"found":[],"notFound":[1]} (cum răspunde v9) → null', async () => {
    simulare = jsonRaspuns(404, { found: [], notFound: [1] });
    egal(await cautaANAF('1'), null);
  });
  await test('200 cu found gol → null', async () => {
    simulare = jsonRaspuns(200, { found: [], notFound: [1] });
    egal(await cautaANAF('1'), null);
  });

  console.log('4. Eroare de configurare');
  await test('404 fără corp ANAF (adresă greșită) → anaf_configurare, cu codul HTTP și adresa în log', async () => {
    simulare = textRaspuns(404, '<html>Not Found</html>');
    const loguri = [];
    const e0 = console.error; console.error = (...a) => loguri.push(a.join(' '));
    let err;
    try { err = await aruncaCod(() => cautaANAF('46577229'), 'anaf_configurare'); } finally { console.error = e0; }
    adevarat(err.message.includes('404') && err.message.includes(ANAF_URL), 'mesajul erorii fără cod/adresă');
    adevarat(loguri.some((l) => l.includes('HTTP 404') && l.includes(ANAF_URL)), 'logul fără cod/adresă');
  });
  await test('400 → anaf_configurare', tacut(async () => {
    simulare = jsonRaspuns(400, { message: 'Bad Request' });
    await aruncaCod(() => cautaANAF('46577229'), 'anaf_configurare');
  }));
  await test('200 în format neașteptat → anaf_configurare', tacut(async () => {
    simulare = jsonRaspuns(200, { cod: 200, mesaj: 'altceva' });
    await aruncaCod(() => cautaANAF('46577229'), 'anaf_configurare');
  }));

  console.log('5. ANAF nu răspunde');
  await test('timeout (AbortError) → anaf_indisponibil', async () => {
    simulare = async () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e; };
    const err = await aruncaCod(() => cautaANAF('46577229'), 'anaf_indisponibil');
    adevarat(err.message.includes('timeout'), 'mesajul nu spune timeout');
  });
  await test('eroare de rețea → anaf_indisponibil', async () => {
    simulare = async () => { throw new TypeError('fetch failed'); };
    await aruncaCod(() => cautaANAF('46577229'), 'anaf_indisponibil');
  });
  await test('503 → anaf_indisponibil', async () => {
    simulare = jsonRaspuns(503, null);
    await aruncaCod(() => cautaANAF('46577229'), 'anaf_indisponibil');
  });

  console.log('6. /api/public/cui-lookup („Devino partener”)');
  async function lookup(cui) {
    const res = raspuns();
    await cuiLookup(cerere({ metoda: 'POST', body: { tara: 'RO', cui } }), res);
    return res;
  }
  await test('găsit → ok:true cu datele', async () => {
    simulare = jsonRaspuns(200, ANAF_GASIT);
    const res = await lookup('RO46577229');
    egal(res.corp.ok, true);
    egal(res.corp.denumire, 'FIRMA SIMULATA SRL');
  });
  await test('negăsit → mesajul existent, completare manuală', async () => {
    simulare = jsonRaspuns(404, { found: [], notFound: [1] });
    const res = await lookup('1');
    egal(res.corp, { ok: false, manual: true, motiv: 'CUI negăsit în registrul ANAF' });
  });
  await test('eroare de configurare → mesajul adevărat RO + EN, completare manuală', tacut(async () => {
    simulare = textRaspuns(404, 'Not Found');
    const res = await lookup('RO46577229');
    egal(res.corp, { ok: false, manual: true, cod: 'anaf_configurare', motiv: MESAJE_ANAF.anaf_configurare.ro, motiv_en: MESAJE_ANAF.anaf_configurare.en });
    adevarat(res.corp.motiv_en.startsWith('The ANAF lookup is not working (configuration error).'), 'textul EN');
  }));
  await test('timeout → „ANAF nu răspunde acum”, RO + EN, completare manuală', tacut(async () => {
    simulare = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
    const res = await lookup('RO46577229');
    egal(res.corp.cod, 'anaf_indisponibil');
    egal(res.corp.manual, true);
    egal(res.corp.motiv_en, 'ANAF is not responding right now. Try again in a few minutes; nothing was changed.');
  }));

  console.log('7. Dicționarele EN ale formularelor');
  await test('mesajele noi au traducere în ambele pagini „Devino partener”', async () => {
    for (const pagina of ['mydarrin-devino-partener', 'mydarrin-devino-partener-wizard']) {
      const dict = require(path.join(RADACINA, `i18n/en/${pagina}.json`))._texte;
      for (const m of Object.values(MESAJE_ANAF)) egal(dict[m.ro], m.en, `${pagina}: ${m.ro}`);
    }
  });

  await testeBrowser();

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
})();

// ── 8. Browser: mesajul apare în limba activă, câmpurile rămân libere ──────
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

async function testeBrowser() {
  console.log('8. Browser: „Devino partener” cu ANAF căzut');
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) {
    console.log('  – Playwright nu e instalat; secțiunea se sare.');
    return;
  }
  const srv = await server();
  const baza = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const limba of ['ro', 'en']) {
      for (const cod of ['anaf_configurare', 'anaf_indisponibil']) {
        await test(`${limba.toUpperCase()}: ${cod} → mesajul adevărat, câmpurile editabile, 0 erori JS`, async () => {
          const ctx = await browser.newContext();
          await ctx.addInitScript((l) => {
            localStorage.clear();
            if (l === 'ro') localStorage.setItem('myd_lang_v1', 'ro');
            localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: '2026-10-16T08:00:00Z', versiune: 1 }));
          }, limba);
          await ctx.route(/supabase\.co|nominatim|googletagmanager|google-analytics|ipapi/, (r) => r.abort());
          await ctx.route(/\/api\//, (r) => {
            if (r.request().url().includes('/api/public/cui-lookup')) {
              const m = MESAJE_ANAF[cod];
              return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, manual: true, cod, motiv: m.ro, motiv_en: m.en }) });
            }
            return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
          });
          const page = await ctx.newPage();
          const erori = [];
          page.on('pageerror', (e) => erori.push(e.message));
          await page.goto(`${baza}/mydarrin-devino-partener.html`, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => !document.documentElement.classList.contains('myd-i18n-pending'));
          const inainte = await page.evaluate(() => ['f-firma', 'f-nrregcom', 'f-sediu'].map((id) => { const el = document.getElementById(id); return [el.disabled, el.readOnly]; }));
          await page.evaluate(() => { const el = document.getElementById('f-cui'); el.value = 'RO46577229'; return validateCUI(el); });
          const asteptat = MESAJE_ANAF[cod][limba];
          await page.waitForFunction((t) => (document.getElementById('cui-status').textContent || '').trim() === t, asteptat, { timeout: 3000 })
            .catch(async () => { throw new Error(`mesaj afișat: ${JSON.stringify(await page.textContent('#cui-status'))}`); });
          const dupa = await page.evaluate(() => ['f-firma', 'f-nrregcom', 'f-sediu'].map((id) => { const el = document.getElementById(id); return [el.disabled, el.readOnly]; }));
          egal(dupa, inainte, 'starea câmpurilor după eroarea ANAF');
          egal(dupa.some(([, ro]) => ro), false, 'câmp readonly');
          egal(erori, [], 'erori JS');
          await ctx.close();
        });
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
}
