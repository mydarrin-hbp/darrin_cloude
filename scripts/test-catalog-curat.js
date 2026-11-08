// scripts/test-catalog-curat.js
// Teste pentru pasul 11-C4 (4 nov. 2026): un singur catalog — paginile de
// categorie redirecționate spre mydarrin-catalog cu filtrul lor, iar cardurile
// cu prețuri scrise de mână șterse. Peste un Supabase simulat.
//   A. fișierele: catalogul fără data-ron, fără carduri statice și fără prețuri
//      scrise în cod (inclusiv consultanța și conversia cu cursuri inventate);
//      redirect-urile 301 din vercel.json; paginile vechi doar cu redirecționare;
//      niciun link intern spre mydarrin-categorie-*; sitemap / lista SEO;
//      rutele /servicii/<slug>, /catalog/materiale/<slug> din middleware.js;
//   B. /api/public/catalog-categorie?toate=1: prețurile „de la” ale catalogului;
//   C. catalogul în Chromium: fiecare card = un rând public din catalog_servicii;
//      fiecare preț = cel de pe server (din catalog_preturi); fără preț → „Preț
//      prin deviz”; scheletul cât se încarcă (fără cifre); eroare → mesaj cu
//      „Reîncearcă”; filtrul din adresă (?categorie= / ?subcategorie= / ?cat=
//      de la vechile adrese) aplicat la încărcare, vizibil și modificabil, cu
//      adresa actualizată fără reîncărcare; vechile pagini → catalogul filtrat;
//      390 / 768 / 1024 / 1366 px fără derulare orizontală și fără erori JS;
//      textele noi în engleză.
// Capturi (opțional): CAPTURI=<folder> node scripts/test-catalog-curat.js
// Rulare: node scripts/test-catalog-curat.js   (FARA_BROWSER=1: doar A–B)

const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

function stub(fisier, exp) {
  const p = require.resolve(path.join(RADACINA, fisier));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };
}
stub('lib/rate-limit.js', { checkRateLimit: async () => true });

const apiCat = require(path.join(RADACINA, 'api/public/catalog-categorie.js'));
const apiSitemap = require(path.join(RADACINA, 'api/public/sitemap.xml.js'));
const REGIUNE = require(path.join(RADACINA, 'lib/regiune.js'));
const citeste = (f) => fs.readFileSync(path.join(RADACINA, f), 'utf8');

const CAT_EL = 'f0000000-0000-4000-8000-000000000001';
const CAT_PRIZE = 'f0000000-0000-4000-8000-000000000002';
const CAT_SAN = 'f0000000-0000-4000-8000-000000000003';
const ID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NV = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// [id, slug, titlu, categorie, categorie_id, subcategorie_id, status_public, niveluri [[id, pret|null]], reteta?]
const PRODUSE = [
  [ID(1), 'montaj-tablou-electric', 'Montaj tablou electric', 'servicii', CAT_EL, null, true, [[NV(11), 450], [NV(12), 900]]],
  [ID(2), 'montaj-priza', 'Montaj priză', 'servicii', CAT_EL, CAT_PRIZE, true, [[NV(21), 80]]],
  [ID(3), 'testare-instalatie', 'Testare instalație electrică', 'servicii', CAT_EL, null, true, [[NV(31), null]]],
  [ID(4), 'montaj-parchet-laminat', 'Montaj parchet laminat', 'servicii', CAT_SAN, null, true, [[NV(41), null]], true],
  [ID(5), 'reparatie-baterie', 'Reparație baterie', 'servicii', CAT_SAN, null, true, [[NV(51), 120]]],
  [ID(6), 'serviciu-ascuns', 'Serviciu nepublic', 'servicii', CAT_EL, null, false, [[NV(61), 300]]],
  [ID(7), 'mat-parchet', 'Parchet laminat 8 mm', 'materiale', null, null, true, [[NV(71), 35], [NV(72), 70]]],
  [ID(8), 'inch-scule', 'Închiriere scule', 'inchirieri', null, null, true, [[NV(81), 60]]],
];
function reset() {
  DB.tabele = {
    tax_configurations: [{ tara_cod: 'RO', moneda: 'RON', cota_tva: 21, prag_minim_comanda: 100, checkout_activ: true }],
    backoffice_config: [
      { sectiune: 'pricing', cheie: 'cost_marketing_pct', valoare: '3', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'cost_mentenanta_pct', valoare: '2', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'comision_platforma_default_pct', valoare: '12', tara_cod: 'ALL' },
      { sectiune: 'asigurari', cheie: 'cost_asigurare_pct', valoare: '1', tara_cod: 'ALL' },
    ],
    categorii: [
      { id: CAT_EL, slug: 'instalatii-electrice', title: 'Instalații electrice', title_en: 'Electrical installations', category_type: 'servicii', parent_id: null },
      { id: CAT_PRIZE, slug: 'prize-intrerupatoare', title: 'Prize și întrerupătoare', title_en: 'Sockets and switches', category_type: 'servicii', parent_id: CAT_EL },
      { id: CAT_SAN, slug: 'instalatii-sanitare', title: 'Instalații sanitare', title_en: 'Plumbing', category_type: 'servicii', parent_id: null },
    ],
    catalog_servicii: PRODUSE.map(([id, slug, titlu, categorie, cid, sid, pub]) => ({
      id, id_serviciu: slug, titlu, categorie, categorie_id: cid, subcategorie_id: sid, status_public: pub,
      domeniu: categorie === 'servicii' ? 'Instalații' : 'Diverse', unitate_masura: 'buc', descriere: 'Descriere din catalog', imagini: [],
    })),
    catalog_niveluri: PRODUSE.flatMap(([id, , , , , , , niv]) => niv.map(([nid, pret]) => ({ id: nid, serviciu_id: id, nivel: 'Gold', catalog_preturi: pret == null ? [] : [{ pret, tara_cod: 'RO' }] }))),
    devize_articole: PRODUSE.filter((p) => p[8]).map((p) => ({ articol_id: 'a-' + p[0], catalog_nivel_id: p[7][0][0] })),
    catalog_relatii: [], seo_config: [],
  };
  DB.coloane = {};
  REGIUNE._golesteCache();
}

let ok = 0, esec = 0;
async function test(nume, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + nume); }
  catch (e) { esec++; console.log('  ✗ ' + nume + ' — ' + e.message); }
}
function egal(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(c, m) { if (!c) throw new Error(m || 'condiție falsă'); }
const faraComentarii = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

async function preturiServer(tip) {
  const r = raspuns();
  await apiCat(cerere({ metoda: 'GET', query: { toate: '1', tip, tara: 'RO' } }), r);
  return r;
}

async function testeFisiere() {
  console.log('A. Fișierele');
  await test('catalogul: fără data-ron, fără carduri statice, fără prețuri scrise în cod', async () => {
    const s = citeste('mydarrin-catalog.html');
    egal((s.match(/data-ron/g) || []).length, 0, 'data-ron');
    egal((s.match(/class="rich-card/g) || []).length, 1, 'doar șablonul din cod pentru cardurile din baza de date');
    const html = faraComentarii(s.replace(/<script[\s\S]*?<\/script>/g, ''));
    adevarat(!/>\s*\d[\d.,]*\s*(<\/span>\s*)?(<span[^>]*>\s*)?Lei/.test(html), 'sumă în Lei scrisă în HTML: ' + (html.match(/>\s*\d[\d.,]*\s*(<\/span>\s*)?(<span[^>]*>\s*)?Lei/) || [''])[0]);
    adevarat(!/\|\|\s*'\d+'/.test(s), 'preț de rezervă scris în cod (|| \'50\')');
    adevarat(!/>\s*(<strong>)?\d+(<\/strong>)?\s*(produse|rezultate)/.test(html), 'număr de produse scris în pagină');
    adevarat(!/rates\s*=\s*\{RON:1/.test(s), 'cursuri de schimb scrise în cod');
    adevarat(!/materiale_baza_estimat/.test(s), 'prețul „de la” din estimare');
    const mk = s.slice(s.indexOf('function mkCard('), s.indexOf('function inject('));
    // Pasul 11-C5 (decizia LM): imaginea reală din back-office, altfel imaginea de
    // prezentare a domeniului, altfel IMG_DEF — fără iconiță în locul imaginii.
    // Pasul 11-C6: imaginea domeniului vine din imgDomeniu() (variante la domeniile mari).
    // Pasul 11-C7: înaintea domeniului, subiectul din titlu — imaginiPrezentare().
    const imgDom = s.slice(s.indexOf('function imgDomeniu('), s.indexOf('function mkCard('));
    adevarat(mk.length > 100 && mk.includes('${imgReal ? `src="${imgReal}"') && /imaginiPrezentare\(item, d\)/.test(mk) && /d\.img \|\| IMG_DEF/.test(imgDom) && !/card-icoana/.test(mk), 'ordinea imaginilor pe cardurile de produs');
  });
  await test('vercel.json: 301 pentru cele 3 pagini (cu și fără .html) spre catalogul filtrat; rutele /servicii/<slug> spre catalog', async () => {
    const v = JSON.parse(citeste('vercel.json'));
    for (const [pag, cat] of [['servicii', 'servicii'], ['materiale', 'materiale'], ['inchirieri', 'inchirieri']]) {
      for (const ext of ['', '.html']) {
        const r = v.redirects.find((x) => x.source === `/mydarrin-categorie-${pag}${ext}`);
        adevarat(r && r.permanent === true && r.destination === `/mydarrin-catalog?categorie=${cat}`, pag + ext);
      }
    }
    adevarat(!JSON.stringify(v.rewrites).includes('mydarrin-categorie'), 'rewrite spre pagina veche');
    egal(v.rewrites.find((x) => x.source === '/materiale/:slug').destination, '/mydarrin-catalog.html?categorie=materiale&subcategorie=:slug');
  });
  await test('paginile vechi: doar redirecționarea spre catalog, cu filtrul și parametrii păstrați', async () => {
    for (const [pag, cat] of [['servicii', 'servicii'], ['materiale', 'materiale'], ['inchirieri', 'inchirieri']]) {
      const s = citeste(`mydarrin-categorie-${pag}.html`);
      adevarat(s.length < 3000 && s.includes(`p.set('categorie', '${cat}')`) && s.includes("location.replace('/mydarrin-catalog?'"), pag);
      adevarat(!/price|data-ron|unsplash|SUBCATEGORY_DB/i.test(s), pag + ': conținut vechi');
    }
    adevarat(!fs.existsSync(path.join(RADACINA, 'categorie-catalog.js')), 'categorie-catalog.js șters');
  });
  await test('niciun link intern spre mydarrin-categorie-* (pagini, scripturi publice, API)', async () => {
    const fisiere = fs.readdirSync(RADACINA).filter((f) => (f.endsWith('.html') || f.endsWith('.js')) && !/^mydarrin-categorie-/.test(f) && f !== 'middleware.js')
      .concat(fs.readdirSync(path.join(RADACINA, 'api/public')).map((f) => 'api/public/' + f));
    const cu = fisiere.filter((f) => /mydarrin-categorie-(servicii|materiale|inchirieri)/.test(faraComentarii(citeste(f))));
    egal(cu, [], 'fișiere cu legături vechi');
    const seo = require(path.join(RADACINA, 'lib/seo-pagini.js'));
    egal(seo.PAGINI.filter((p) => /categorie/.test(p.cale)), [], 'lista SEO');
  });
  await test('sitemap: catalogul filtrat pe cele 3 tipuri, fără paginile vechi', async () => {
    reset();
    const r = raspuns();
    r.send = (x) => { r.corp = x; return r; };
    await apiSitemap(cerere({ metoda: 'GET' }), r);
    const xml = String(r.corp);
    for (const c of ['servicii', 'materiale', 'inchirieri']) adevarat(xml.includes(`/mydarrin-catalog?categorie=${c}</loc>`), c);
    adevarat(!xml.includes('mydarrin-categorie-'), 'pagini vechi în sitemap');
  });
  await test('middleware.js: /servicii/<slug> și /catalog/materiale/<slug> → mydarrin-catalog cu categorie + subcategorie', async () => {
    const s = citeste('middleware.js');
    const bucata = s.slice(s.indexOf('const PAGINA_STATICA'), s.indexOf('const SUPABASE_URL'));
    const ruteaza = new Function(bucata + '\nreturn ruteazaPublic;')();
    egal(ruteaza('/servicii/instalatii-electrice'), { destinatie: '/mydarrin-catalog', query: { categorie: 'servicii', subcategorie: 'instalatii-electrice' } });
    egal(ruteaza('/inchiriere/scule'), { destinatie: '/mydarrin-catalog', query: { categorie: 'inchirieri', subcategorie: 'scule' } });
    egal(ruteaza('/catalog/materiale/lemn').query, { categorie: 'materiale', subcategorie: 'lemn' });
  });

  console.log('B. Prețurile catalogului (/api/public/catalog-categorie?toate=1)');
  await test('toate produsele publice ale tipului; „de la” doar din catalog_preturi; rețeta → are_pret fără cifră; fără preț → null', async () => {
    reset();
    const r = await preturiServer('servicii');
    egal(r.statusCode, 200);
    const p = Object.fromEntries(r.corp.produse.map((x) => [x.slug, x]));
    egal(Object.keys(p).sort(), ['montaj-parchet-laminat', 'montaj-priza', 'montaj-tablou-electric', 'reparatie-baterie', 'testare-instalatie'], 'fără produsul nepublic');
    adevarat(p['montaj-tablou-electric'].pret_de_la > 450, 'cu taxe și TVA, nivelul cel mai ieftin');
    egal([p['testare-instalatie'].pret_de_la, p['testare-instalatie'].are_pret], [null, false]);
    egal([p['montaj-parchet-laminat'].pret_de_la, p['montaj-parchet-laminat'].are_pret], [null, true]);
    adevarat(!/discount/i.test(JSON.stringify(r.corp)), 'fără discounturi');
  });
}

// ── C. Catalogul în Chromium ─────────────────────────────────────────────
async function testeBrowser() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { esec++; console.log('  ✗ Playwright lipsește'); return; }
  const { porneste } = require('./server-test');
  const CAPTURI = process.env.CAPTURI ? path.resolve(process.env.CAPTURI) : null;
  if (CAPTURI) fs.mkdirSync(CAPTURI, { recursive: true });
  const CONTROL = { restCade: false, intarziere: 0 };
  function rest(url) {
    const u = new URL(url);
    let rows = (DB.tabele[u.pathname.split('/').pop()] || []).slice();
    u.searchParams.forEach((v, k) => {
      if (['select', 'order', 'limit', 'offset'].includes(k)) return;
      const m = String(v).match(/^eq\.(.*)$/);
      if (m) rows = rows.filter((x) => String(x[k]) === m[1]);
      const like = String(v).match(/^like\.(.*)$/);
      if (like) rows = rows.filter((x) => new RegExp('^' + like[1].replace(/\*/g, '.*') + '$').test(String(x[k])));
    });
    return rows.map((x) => { const c = Object.assign({}, x); delete c.catalog_niveluri; return c; });
  }
  async function context(browser, latime, lang = 'ro') {
    const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 720 ? 844 : 900 }, hasTouch: latime < 720 });
    await ctx.addInitScript((l) => { try { localStorage.setItem('myd_lang_v1', l); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 })); } catch (e) {} }, lang);
    await ctx.route(/\.supabase\.co\/rest\/v1\//, async (r) => {
      if (CONTROL.intarziere) await new Promise((ok) => setTimeout(ok, CONTROL.intarziere));
      if (CONTROL.restCade && /catalog_servicii/.test(r.request().url())) return r.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rest(r.request().url())) });
    });
    await ctx.route(/\.supabase\.co\/(?!rest\/v1\/)/, (r) => r.abort());
    await ctx.route(/ipapi\.co|nominatim/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await ctx.route(/\/api\//, async (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/api/public/catalog-categorie') {
        const res = raspuns();
        await apiCat(cerere({ metoda: 'GET', query: Object.fromEntries(u.searchParams) }), res);
        return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp) });
      }
      if (u.pathname === '/api/public/tari-active') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, active: ['RO'], tari: [{ tara_cod: 'RO', tara_nume: 'România' }], tva: { RO: 21 } }) });
      return r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"API unavailable on the test server"}' });
    });
    return ctx;
  }
  async function pagina(ctx, adresa) {
    const pg = await ctx.newPage();
    pg.setDefaultTimeout(8000);
    pg.erori = [];
    pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 200)));
    await pg.goto(baza + adresa, { waitUntil: 'load' });
    return pg;
  }
  const depasire = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const carduriVizibile = (pg) => pg.$$eval('.tab-content.active .db-card', (c) => c.filter((x) => x.offsetParent !== null).map((x) => x.dataset.slug).sort());
  const adresa = (pg) => pg.evaluate(() => location.pathname + location.search);

  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    reset();
    const pretServ = Object.fromEntries((await preturiServer('servicii')).corp.produse.map((x) => [x.slug, x]));
    for (const latime of [390, 768, 1024, 1366]) {
      console.log(`C. Catalogul (${latime}px)`);
      CONTROL.restCade = false; CONTROL.intarziere = 0;
      const ctx = await context(browser, latime);
      await test(`${latime}: ?categorie=servicii&subcategorie=instalatii-electrice → fila și filtrul aplicate la încărcare, vizibile; doar produse publice, cu prețul de pe server`, async () => {
        const pg = await pagina(ctx, '/mydarrin-catalog.html?categorie=servicii&subcategorie=instalatii-electrice');
        await pg.waitForSelector('#grid-servicii .db-card', { state: 'attached' });
        await pg.waitForFunction(() => window.FILTRU_SUBCATEGORIE && !document.getElementById('filtru-subcategorie').hidden);
        await pg.waitForTimeout(300);
        egal(await carduriVizibile(pg), ['montaj-priza', 'montaj-tablou-electric', 'testare-instalatie'], 'categoria + subcategoria ei');
        egal(await pg.$eval('#main-tab-servicii', (b) => b.classList.contains('active')), true, 'fila selectată');
        egal((await pg.textContent('#breadcrumb-count')).trim(), PRODUSE.filter((p) => p[6]).length + ' produse', 'numărul real de produse');
        adevarat((await pg.textContent('#filtru-subcategorie')).includes('Instalații electrice'), 'eticheta filtrului');
        const toate = await pg.$$eval('.db-card', (c) => c.map((x) => x.dataset.slug));
        const publice = PRODUSE.filter((p) => p[6]).map((p) => p[1]);
        adevarat(toate.every((s) => publice.includes(s)) && !toate.includes('serviciu-ascuns'), 'card fără rând public: ' + toate.join(','));
        const preturi = await pg.$$eval('#grid-servicii .db-card', (c) => c.map((x) => [x.dataset.slug, x.querySelector('.price-val') ? x.querySelector('.price-val').textContent.trim() : null, x.querySelector('.card-price').textContent.replace(/\s+/g, ' ').trim()]));
        for (const [slug, val, text] of preturi) {
          const sv = pretServ[slug];
          if (sv.pret_de_la != null) {
            const asteptat = await pg.evaluate((v) => (typeof window.formatCurrency === 'function' ? window.formatCurrency(v) : Math.round(v).toLocaleString('ro-RO') + ' Lei'), sv.pret_de_la);
            egal(val, asteptat, slug);
          } else {
            egal(val, null, slug + ': fără cifră');
            adevarat(sv.are_pret ? /configurare/.test(text) : /deviz/.test(text), slug + ': ' + text);
          }
        }
        egal(await depasire(pg), 0, 'derulare orizontală');
        if (CAPTURI) { await pg.evaluate(() => document.getElementById('catalog-grid-section').scrollIntoView({ block: 'start' })); await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(CAPTURI, `catalog-filtrat-${latime}.png`) }); }
        egal(pg.erori, [], 'erori JS');
        await pg.close();
      });
      await test(`${latime}: filtrul se schimbă fără reîncărcare: eticheta „×” scoate subcategoria, altă filă → ?categorie=materiale`, async () => {
        const pg = await pagina(ctx, '/mydarrin-catalog.html?categorie=servicii&subcategorie=prize-intrerupatoare');
        await pg.waitForFunction(() => window.FILTRU_SUBCATEGORIE && document.querySelectorAll('#grid-servicii .db-card').length > 0);
        await pg.waitForTimeout(300);
        egal(await carduriVizibile(pg), ['montaj-priza']);
        await pg.evaluate(() => { window.__faraReincarcare = true; });
        await pg.click('#filtru-subcategorie button');
        egal(await adresa(pg), '/mydarrin-catalog.html?categorie=servicii');
        egal((await carduriVizibile(pg)).length, 5, 'toate serviciile publice');
        // Pe telefon, bara laterală e ascunsă: filele se schimbă din butoanele din capul paginii.
        await pg.locator('button[onclick^="switchMainTab(\'materiale\'"]:visible').first().click();
        egal(await adresa(pg), '/mydarrin-catalog.html?categorie=materiale');
        egal(await carduriVizibile(pg), ['mat-parchet']);
        egal(await pg.evaluate(() => window.__faraReincarcare), true, 'fără reîncărcare');
        egal(pg.erori, [], 'erori JS');
        await pg.close();
      });
      await ctx.close();
    }

    console.log('C2. Vechile adrese, încărcarea și eroarea');
    const ctx = await context(browser, 1366);
    await test('vechea pagină (adresa cu ?cat=) → catalogul cu filtrul corect, aplicat la încărcare', async () => {
      for (const [vechi, cat, fila] of [['/mydarrin-categorie-servicii.html?type=servicii&cat=instalatii-sanitare', 'servicii', 'servicii'], ['/mydarrin-categorie-materiale', 'materiale', 'materiale'], ['/mydarrin-categorie-inchirieri.html', 'inchirieri', 'inchiriere']]) {
        const pg = await pagina(ctx, vechi);
        await pg.waitForURL(/\/mydarrin-catalog/);
        await pg.waitForSelector('#grid-' + fila + ' .db-card', { state: 'attached' });
        await pg.waitForTimeout(400);
        adevarat((await adresa(pg)).includes('categorie=' + cat), vechi + ' → ' + await adresa(pg));
        egal(await pg.$eval('#main-tab-' + fila, (b) => b.classList.contains('active')), true, vechi + ': fila');
        if (cat === 'servicii') egal(await carduriVizibile(pg), ['montaj-parchet-laminat', 'reparatie-baterie'], 'subcategoria din ?cat=');
        await pg.close();
      }
    });
    await test('cât se încarcă: scheletul, fără cifre în grile', async () => {
      CONTROL.intarziere = 1500;
      const pg = await pagina(ctx, '/mydarrin-catalog.html');
      await pg.waitForSelector('#grid-servicii [data-schelet]');
      adevarat(!/\d/.test(await pg.textContent('#grid-servicii')), 'cifre în schelet');
      await pg.waitForSelector('#grid-servicii .db-card', { state: 'attached', timeout: 10000 });
      egal(await pg.$$eval('#grid-servicii [data-schelet]', (x) => x.length), 0, 'scheletul scos');
      CONTROL.intarziere = 0;
      await pg.close();
    });
    await test('eroare la încărcare → mesaj clar cu „Reîncearcă”; după reîncercare, produsele', async () => {
      CONTROL.restCade = true;
      const pg = await pagina(ctx, '/mydarrin-catalog.html');
      await pg.waitForSelector('#grid-servicii .cat-stare button');
      adevarat(/nu s-a putut încărca/.test(await pg.textContent('#grid-servicii .cat-stare')), 'mesajul');
      CONTROL.restCade = false;
      await pg.click('#grid-servicii .cat-stare button');
      await pg.waitForSelector('#grid-servicii .db-card', { state: 'attached' });
      egal(await pg.$$eval('.cat-stare', (x) => x.length), 0, 'mesajul scos');
      await pg.close();
    });
    await test('butoanele (11-C1): serviciu → configurarea; fără preț → „Cere un deviz”', async () => {
      const pg = await pagina(ctx, '/mydarrin-catalog.html?categorie=servicii');
      await pg.waitForSelector('#grid-servicii .db-card', { state: 'attached' });
      egal(await pg.$eval('[data-slug="testare-instalatie"] .card-cta', (b) => b.textContent.trim()), 'Cere un deviz');
      egal(await pg.$eval('[data-slug="montaj-priza"] .card-cta', (b) => b.textContent.trim()), 'Adaugă în coș');
      await Promise.all([pg.waitForURL(/mydarrin-produs\.html\?slug=montaj-priza/), pg.$eval('[data-slug="montaj-priza"] .card-cta', (b) => b.click())]);
      await pg.close();
    });
    await ctx.close();

    console.log('C3. Engleză');
    for (const latime of [390, 1366]) {
      const ce = await context(browser, latime, 'en');
      await test(`${latime}: EN — eticheta filtrului, prețurile fără sursă și mesajul de eroare fără română`, async () => {
        const pg = await pagina(ce, '/mydarrin-catalog.html?categorie=servicii&subcategorie=instalatii-electrice');
        await pg.waitForFunction(() => window.FILTRU_SUBCATEGORIE && !document.getElementById('filtru-subcategorie').hidden);
        await pg.waitForTimeout(500);
        const t = await pg.textContent('#filtru-subcategorie');
        adevarat(/Category/.test(t) && /Electrical installations/.test(t), t);
        const p = await pg.$eval('[data-slug="testare-instalatie"] .card-footer', (x) => x.textContent.replace(/\s+/g, ' '));
        adevarat(/Price by quote/.test(p) && /Ask for a quote/.test(p), p);
        if (CAPTURI) await pg.screenshot({ path: path.join(CAPTURI, `catalog-filtrat-en-${latime}.png`) });
        await pg.close();
        CONTROL.restCade = true;
        const pe = await pagina(ce, '/mydarrin-catalog.html');
        await pe.waitForSelector('#grid-servicii .cat-stare button');
        await pe.waitForTimeout(300);
        const m = await pe.textContent('#grid-servicii .cat-stare');
        adevarat(/could not be loaded/.test(m) && /Try again/.test(m) && !/[ăâîșț]/.test(m), m);
        CONTROL.restCade = false;
        await pe.close();
      });
      await ce.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

(async () => {
  await testeFisiere();
  if (!process.env.FARA_BROWSER) await testeBrowser();
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})();
