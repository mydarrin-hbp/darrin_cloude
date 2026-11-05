// scripts/test-imagini-catalog.js
// Teste pentru pașii 11-C5 și 11-C6 (decizii LM, 4 nov. 2026): imaginile de prezentare
// pe cardurile din catalog, potrivite fiecărui domeniu (11-C6), cu variante stabile
// după id_serviciu la domeniile mari. Ordinea imaginii (din 11-C5, neschimbată):
//   1. imaginea reală (catalog_servicii.imagini, din back-office; la marketplace,
//      imaginea încărcată de partener);
//   2. altfel, imaginea de prezentare a domeniului (harta DOM din catalog; la
//      domeniile din VARIANTE, una dintre variante, aleasă stabil după id_serviciu);
//   3. altfel, IMG_DEF.
//   A. fișierele: fiecare domeniu public din baza de date are imagine în hartă
//      (lista citită live cu cheia publică, ca în catalog; fără rețea, lista din
//      4 nov. 2026); IMG_DEF; nicio iconiță în locul imaginii; niciun preț scris
//      în cod (regula din 11-C4 rămâne);
//   B. în Chromium: fiecare card din Servicii / Materiale / Închirieri are o
//      imagine (reală, a domeniului sau IMG_DEF), fără iconiță; produsul cu
//      imagine din back-office o arată pe ea; marketplace-ul: imaginea
//      partenerului, altfel IMG_DEF; 390 / 768 / 1024 / 1366 px fără derulare
//      orizontală, fără erori JS, fără imagini lipsă.
// Fiecare ID de fotografie folosit apare în docs/SURSE.md (autor, link spre Unsplash).
// Verificarea că pozele Unsplash folosite răspund 200: ONLINE=1.
// Rulare: node scripts/test-imagini-catalog.js   (FARA_BROWSER=1: doar A)

const fs = require('fs');
const path = require('path');
const https = require('https');

const RADACINA = path.join(__dirname, '..');
const citeste = (f) => fs.readFileSync(path.join(RADACINA, f), 'utf8');
const CATALOG = citeste('mydarrin-catalog.html');

// Harta DOM și IMG_DEF, așa cum sunt în pagină.
const inceput = CATALOG.indexOf('const DOM = {');
const DOM = new Function('return ' + CATALOG.slice(inceput + 12, CATALOG.indexOf('};', inceput) + 1))();
const IMG_DEF = (CATALOG.match(/const IMG_DEF = '([0-9a-f-]+)';/) || [])[1];
const urlFoto = (id) => `https://images.unsplash.com/photo-${id}?w=600&q=80`;
// VARIANTE și imgDomeniu(), așa cum sunt în pagină (pasul 11-C6).
const { VARIANTE, imgDomeniu } = (() => {
  const v0 = CATALOG.indexOf('const VARIANTE = {');
  const f0 = CATALOG.indexOf('function imgDomeniu(');
  const f1 = CATALOG.indexOf('\n}', f0) + 2;
  if (v0 < 0 || f0 < 0) return { VARIANTE: {}, imgDomeniu: (item, d) => d.img || IMG_DEF };
  const varSrc = CATALOG.slice(v0, CATALOG.indexOf('};', v0) + 2);
  return new Function('IMG_DEF', varSrc + '\n' + CATALOG.slice(f0, f1) + '\nreturn { VARIANTE, imgDomeniu };')(IMG_DEF);
})();
const imgAsteptat = (item) => (item.imagini && item.imagini[0]) || urlFoto(imgDomeniu(item, DOM[item.domeniu] || { img: IMG_DEF }));
// Caruselul de categorii din hero.
const CARUSEL = [...CATALOG.matchAll(/<img src="https:\/\/images\.unsplash\.com\/photo-([0-9a-f-]+)\?w=600&q=80" alt="([^"]+)" loading="lazy">/g)].map((m) => ({ id: m[1], alt: m[2] }));
const SURSE = (() => { try { return citeste('docs/SURSE.md'); } catch (e) { return ''; } })();
const toateIdurile = () => [...new Set([IMG_DEF, ...Object.values(DOM).map((v) => v.img), ...Object.values(VARIANTE).flat(), ...CARUSEL.map((c) => c.id)])];
// Fotografiile nepotrivite din raportul 11-C5 (căști, autoturism, plajă, cort pe alte
// domenii, unelte de grădină la lemn, termostat, depozit, interior gol, camion, mașină
// de găurit cu marcă, baie la HVAC) — nu mai apar în catalog.
const NEPOTRIVITE = ['1585771724684-38269d6639fd', '1620891549027-942fdc95d3f5', '1473116763249-2faaef81ccda', '1416879595882-3373a0480b5b', '1545259741-2ea3ebf61fa3', '1587293852726-70cdb56c2866', '1581858726788-75bc0f6a952d', '1601584115197-04ecc0da31d7', '1572981779307-38b8cabb2407', '1558618666-fcd25c85cd64', '1615529328331-f8917597711f'];

// Domeniile publice din catalog_servicii (status_public), 4 nov. 2026 — folosite
// doar dacă baza de date nu se poate citi.
const DOMENII_4_NOV = ['Acces & Siguranță', 'Echipamente grădinărit', 'Închiriere Echipamente Vacanță & Outdoor', 'Personal calificat zilnic', 'Scule & Echipamente Mici', 'Scule & Echipamente profesionale', 'Utilaje & Echipamente Grele', 'Utilaje construcții', 'Vehicule & Transport', 'Acoperiș & Izolații', 'Bricolaj & Consumabile', 'Electrice & Cabluri', 'Electrice & Iluminat', 'Electrice & Tablouri', 'Electrocasnice', 'Lemn & Cherestea', 'Metalurgie & Profile', 'Parchet & Pardoseli', 'Sanitare & Obiecte', 'Sanitare & Termo', 'Vopsele & Finisaje', 'Zidărie & Beton', 'Acoperiș & Șarpantă', 'Construcții — Betoane', 'Construcții & Renovări', 'Consultanță & Design Amenajare Interioară', 'Consultanță & Evaluare', 'Consultanță & proiectare instalație electrică', 'Curățenie profesională', 'Curierat & Livrări', 'Demolări', 'Grădinărit & Agri', 'HVAC & Climatizare', 'Înlocuire becuri & corpuri de iluminat', 'Înlocuire calorifer', 'Înlocuire instalație electrică debara/cămară', 'Instalații electrice', 'Instalații sanitare', 'Instalații sanitare și termice', 'Livrare și Turnare Betoane', 'Montaj gresie & faianță', 'Montaj tablou electric nou', 'Mutări & Logistică', 'Pardoseli & Parchet', 'Pavaje & Alei', 'Proiectare Tehnică', 'Reparație cuptor electric', 'Reparație garnituri & probă presiune calorifer', 'Reparații Utilaje și Echipamente Agricole', 'Service Auto', 'Service Auto la domiciliu', 'Service Moto la domiciliu', 'Servicii de Mutări', 'Tâmplărie & Geamuri', 'Testare & verificare instalație electrică', 'Zugrăveli & Finisaje'];

let ok = 0, esec = 0;
async function test(nume, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + nume); }
  catch (e) { esec++; console.log('  ✗ ' + nume + ' — ' + e.message); }
}
function egal(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(c, m) { if (!c) throw new Error(m || 'condiție falsă'); }
const faraComentarii = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function cere(url, optiuni = {}) {
  return new Promise((rez, resp) => {
    const r = https.request(url, Object.assign({ timeout: 10000 }, optiuni), (res) => {
      let corp = ''; res.on('data', (d) => { corp += d; }); res.on('end', () => rez({ status: res.statusCode, corp }));
    });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', resp); r.end();
  });
}
async function domeniiPublice() {
  const url = (CATALOG.match(/SUPABASE_URL\s*=[^\n]*\|\|\s*'([^']+)'/) || [])[1];
  const cheie = (CATALOG.match(/SUPABASE_ANON_KEY\s*=[^\n]*\|\|\s*'([^']+)'/) || [])[1];
  if (url && cheie && !process.env.FARA_RETEA) {
    try {
      const r = await cere(`${url}/rest/v1/catalog_servicii?status_public=eq.true&select=domeniu`, { headers: { apikey: cheie, Authorization: 'Bearer ' + cheie, Range: '0-4999' } });
      if (r.status === 200 || r.status === 206) return { sursa: 'baza de date (live)', lista: [...new Set(JSON.parse(r.corp).map((x) => x.domeniu).filter(Boolean))] };
    } catch (e) { /* fără rețea: lista din 4 nov. */ }
  }
  return { sursa: 'lista din 4 nov. 2026', lista: DOMENII_4_NOV };
}

async function testeFisiere() {
  console.log('A. Fișierele');
  await test('harta DOM: fiecare domeniu are imagine; IMG_DEF neutru (unelte de lucru, 11-C6)', async () => {
    egal(IMG_DEF, '1581783898377-1c85bf937427');
    adevarat(Object.keys(DOM).length >= 62, 'domenii în hartă: ' + Object.keys(DOM).length);
    const fara = Object.entries(DOM).filter(([, v]) => !/^\d{9,13}-[0-9a-f]{12}$/.test(v.img || '')).map(([k]) => k);
    egal(fara, [], 'domenii fără imagine');
  });
  await test('11-C6: fotografiile nepotrivite din raportul 11-C5 nu mai apar în catalog (hartă, carusel)', async () => {
    egal(NEPOTRIVITE.filter((id) => CATALOG.includes(id)), [], 'încă folosite');
  });
  await test('11-C6: variante (3–4 fotografii diferite) la Bricolaj & Consumabile, Instalații sanitare și termice, Instalații electrice', async () => {
    egal(Object.keys(VARIANTE).sort(), ['Bricolaj & Consumabile', 'Instalații electrice', 'Instalații sanitare și termice'].sort());
    for (const [d, v] of Object.entries(VARIANTE)) {
      adevarat(DOM[d], d + ' lipsește din hartă');
      adevarat(v.length >= 3 && v.length <= 4 && new Set(v).size === v.length, d + ': ' + JSON.stringify(v));
      adevarat(v.every((id) => /^\d{9,13}-[0-9a-f]{12}$/.test(id)), d + ': ID greșit');
    }
  });
  await test('11-C6: varianta se alege stabil (același id_serviciu → aceeași imagine) și se folosesc toate', async () => {
    // ID-urile reale din baza de date (4 nov. 2026).
    const REALE = {
      'Instalații sanitare și termice': ['cada-inlocuire', 'cal-inlocuire', 'conducta-inlocuire', 'mat-4b000a20-inlocuire', 'lav-inlocuire', 'wc-inlocuire', 'cal-mentenanta', 'mat-4b000a20-mentenanta', 'lav-mentenanta', 'cal-montaj-nou', 'conducta-montaj-nou', 'mat-4b000a20-montaj', 'lav-montaj-nou', 'cal-reparatie', 'mat-4b000a20-reparatie', 'lav-reparatie'],
      'Instalații electrice': ['ilu-inlocuire', 'tel-inlocuire', 'instalatii-electrice', 'ilu-mentenanta', 'tel-mentenanta', 'ilu-montaj-nou', 'tel-montaj-nou', 'tel-reparatie', 'ilu-reparatie'],
      'Bricolaj & Consumabile': ['robinet-trecere-sferic-12', 'priza-dubla-ceramica-schneider', 'siguranta-automata-diferentiala-16a', 'teava-cupru-15mm', 'cot-cupru-90-grade-15mm', 'filtru-y-pentru-impuritati-34', 'garnitura-siliconica-set-10-buc', 'adeziv-gresiefaianta-sac-25kg', 'vopsea-lavabila-alba-15l', 'cablu-electric-cyy-f-3x25-m'].flatMap((p, i) => Array.from({ length: 10 }, (_, j) => `mat-${p}-v${i + 1 + 10 * j}`)),
    };
    for (const [d, ids] of Object.entries(REALE)) {
      const alese = ids.map((id) => imgDomeniu({ id_serviciu: id, domeniu: d }, DOM[d]));
      egal(ids.map((id) => imgDomeniu({ id_serviciu: id, domeniu: d, titlu: 'alt titlu' }, DOM[d])), alese, d + ': nestabil');
      alese.forEach((id) => adevarat(VARIANTE[d].includes(id), d + ': în afara variantelor ' + id));
      egal([...new Set(alese)].sort(), [...VARIANTE[d]].sort(), d + ': variante nefolosite');
    }
    // Domeniile fără variante: imaginea din hartă.
    egal(imgDomeniu({ id_serviciu: 'x', domeniu: 'Demolări' }, DOM['Demolări']), DOM['Demolări'].img);
  });
  await test('11-C6: fiecare ID de fotografie (hartă, variante, IMG_DEF, carusel) apare în docs/SURSE.md, cu autor și link', async () => {
    adevarat(SURSE.length > 0, 'docs/SURSE.md lipsește');
    egal(toateIdurile().filter((id) => !SURSE.includes('`' + id + '`')), [], 'lipsesc din SURSE.md');
    const randuri = SURSE.split('\n').filter((l) => /^\| .*`\d{9,13}-[0-9a-f]{12}`/.test(l));
    egal(randuri.filter((l) => !/\| [^|]*@[^|]+ \| https:\/\/unsplash\.com\/photos\/[A-Za-z0-9_-]+ \|$/.test(l.trim())), [], 'rânduri fără autor / link');
  });
  await test('11-C6: caruselul din hero are 15 categorii (×2), toate cu fotografii din SURSE.md', async () => {
    egal(CARUSEL.length, 30, 'imagini în carusel');
    egal(new Set(CARUSEL.map((c) => c.alt)).size, 15, 'categorii');
  });
  const { sursa, lista } = await domeniiPublice();
  await test(`fiecare domeniu public din baza de date are imagine în hartă (${lista.length} domenii, sursa: ${sursa})`, async () => {
    adevarat(lista.length >= 50, 'prea puține domenii: ' + lista.length);
    egal(lista.filter((d) => !DOM[d]), [], 'domenii fără imagine');
  });
  await test('mkCard: imaginea reală, altfel a domeniului, altfel IMG_DEF; același <img> pe card, fără iconiță', async () => {
    const mk = CATALOG.slice(CATALOG.indexOf('function mkCard('), CATALOG.indexOf('function inject('));
    adevarat(/const d\s+= DOM\[item\.domeniu\] \|\| \{cat:'Instalații', sub:'General', img:IMG_DEF\}/.test(mk), 'domeniul necunoscut → IMG_DEF');
    adevarat(/const img = imgReal \|\| imgPrezentare/.test(mk), 'ordinea');
    adevarat(/<div class="card-media">\s*<img src="\$\{img\}" alt="\$\{tit\}" loading="lazy"/.test(mk), '<img> pe card');
    adevarat(!/card-icoana|data-lucide="\$\{iconita/.test(CATALOG), 'iconiță în locul imaginii');
  });
  await test('niciun preț scris în cod în catalog (regula din 11-C4)', async () => {
    egal((CATALOG.match(/data-ron/g) || []).length, 0, 'data-ron');
    const html = faraComentarii(CATALOG.replace(/<script[\s\S]*?<\/script>/g, ''));
    adevarat(!/>\s*\d[\d.,]*\s*(<\/span>\s*)?(<span[^>]*>\s*)?Lei/.test(html), 'sumă în Lei scrisă în HTML');
    adevarat(!/\|\|\s*'\d+'/.test(CATALOG), 'preț de rezervă scris în cod');
    adevarat(!/rates\s*=\s*\{RON:1/.test(CATALOG) && !/materiale_baza_estimat/.test(CATALOG), 'cursuri / estimări');
    egal((CATALOG.match(/class="rich-card/g) || []).length, 1, 'doar șablonul cardului din baza de date');
  });
  await test('marketplace: imaginea partenerului are prioritate, altfel IMG_DEF', async () => {
    const s = citeste('mydarrin-marketplace-materiale.html');
    adevarat(s.includes(`const IMG_PREZENTARE = '${urlFoto(IMG_DEF)}';`) && /p\.imagini\[0\] \|\| IMG_PREZENTARE/.test(s), 'regula');
  });
  if (process.env.ONLINE) {
    await test('ONLINE: fiecare fotografie (hartă, variante, IMG_DEF, carusel) răspunde 200 pe Unsplash', async () => {
      const iduri = toateIdurile();
      const rupte = [];
      for (const id of iduri) { const r = await cere(urlFoto(id), { method: 'HEAD' }); if (r.status !== 200) rupte.push(r.status + ' ' + id); }
      egal(rupte, [], 'poze rupte');
    });
  }
}

// ── B. În Chromium ─────────────────────────────────────────────────────
const IMG_BO = 'https://aacojyvujhywanaulvuu.supabase.co/storage/v1/object/public/catalog/parchet-real.png';
const PRODUSE = [
  // [slug, titlu, categorie, domeniu, imagini]
  ['montaj-priza', 'Montaj priză', 'servicii', 'Instalații electrice', []],
  ['demolare-perete', 'Demolare perete', 'servicii', 'Demolări', []],
  ['service-auto-revizie', 'Revizie auto', 'servicii', 'Service Auto', []],
  ['parchet-montaj', 'Montaj parchet', 'servicii', 'Pardoseli & Parchet', [IMG_BO]],
  ['serviciu-domeniu-nou', 'Serviciu dintr-un domeniu nou', 'servicii', 'Domeniu adăugat ieri', []],
  ['mat-parchet', 'Parchet laminat', 'materiale', 'Parchet & Pardoseli', []],
  ['mat-surub', 'Șuruburi', 'materiale', 'Bricolaj & Consumabile', []],
  ['inch-excavator', 'Miniexcavator', 'inchirieri', 'Utilaje construcții', []],
  ['inch-duba', 'Dubă', 'inchirieri', 'Vehicule & Transport', []],
  // 11-C6: domeniile cu variante — carduri vecine, cu ID-uri ca în baza de date.
  ...['robinet-trecere-sferic-12', 'priza-dubla-ceramica-schneider', 'siguranta-automata-diferentiala-16a', 'teava-cupru-15mm', 'cot-cupru-90-grade-15mm', 'filtru-y-pentru-impuritati-34', 'garnitura-siliconica-set-10-buc', 'adeziv-gresiefaianta-sac-25kg']
    .map((p, i) => [`mat-${p}-v${i + 1}`, 'Bricolaj ' + (i + 1), 'materiale', 'Bricolaj & Consumabile', []]),
  ...['cal-inlocuire', 'cal-mentenanta', 'cal-montaj-nou', 'cal-reparatie'].map((id) => [id, 'Calorifer ' + id, 'servicii', 'Instalații sanitare și termice', []]),
  ...['ilu-inlocuire', 'ilu-mentenanta', 'ilu-montaj-nou', 'ilu-reparatie'].map((id) => [id, 'Iluminat ' + id, 'servicii', 'Instalații electrice', []]),
];
const ASTEPTAT = Object.fromEntries(PRODUSE.map(([slug, , , domeniu, imagini]) => [slug, imgAsteptat({ id_serviciu: slug, domeniu, imagini })]));
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function testeBrowser() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { esec++; console.log('  ✗ Playwright lipsește'); return; }
  const { porneste } = require('./server-test');
  const CAPTURI = process.env.CAPTURI ? path.resolve(process.env.CAPTURI) : null;
  if (CAPTURI) fs.mkdirSync(CAPTURI, { recursive: true });
  const TABELE = {
    catalog_servicii: PRODUSE.map(([id_serviciu, titlu, categorie, domeniu, imagini], i) => ({ id: 'p' + i, id_serviciu, titlu, categorie, domeniu, imagini, status_public: true, unitate_masura: 'buc', descriere: 'Din catalog', categorie_id: null, subcategorie_id: null })),
  };
  function rest(url) {
    const u = new URL(url);
    let rows = (TABELE[u.pathname.split('/').pop()] || []).slice();
    u.searchParams.forEach((v, k) => {
      const m = String(v).match(/^eq\.(.*)$/);
      if (m && k !== 'select') rows = rows.filter((x) => String(x[k]) === m[1]);
      if (/^like\./.test(String(v))) rows = [];
    });
    return rows;
  }
  async function context(browser, latime) {
    const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 720 ? 844 : 900 }, hasTouch: latime < 720 });
    ctx.imaginiCerute = [];
    ctx.imaginiRupte = [];
    await ctx.addInitScript(() => { try { localStorage.setItem('myd_lang_v1', 'ro'); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 })); } catch (e) {} });
    // Pozele (Unsplash, back-office) servite local: testul nu depinde de rețea.
    await ctx.route(/images\.unsplash\.com|\.supabase\.co\/storage\/v1\/object\/public\//, (r) => { ctx.imaginiCerute.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }); });
    await ctx.route(/\.supabase\.co\/rest\/v1\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rest(r.request().url())) }));
    await ctx.route(/\.supabase\.co\/(?!rest\/v1\/|storage\/)/, (r) => r.abort());
    await ctx.route(/ipapi\.co|nominatim/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await ctx.route(/\/api\/public\/catalog-categorie/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, produse: [], pret_maxim: null, moneda: 'RON' }) }));
    await ctx.route(/\/api\/public\/marketplace-produse/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, tip: 'materiale', moneda: 'RON', noduri: [{ slug: 'lemn', title: 'Lemn', title_en: 'Wood', numar: 2 }], total: 2, pagina: 1, pe_pagina: 24,
      produse: [
        { id: 'm1', tip: 'materiale', denumire: 'Scândură brad', descriere: 'De la partener', unitate: 'buc', pret_cu_tva: 25, stoc: 10, imagini: [IMG_BO], furnizor: 'Furnizor test' },
        { id: 'm2', tip: 'materiale', denumire: 'Grindă', descriere: 'De la partener', unitate: 'buc', pret_cu_tva: 90, stoc: 4, imagini: [], furnizor: 'Furnizor test' },
      ] }) }));
    ctx.on('response', (res) => { if (res.request().resourceType() === 'image' && res.status() >= 400) ctx.imaginiRupte.push(res.status() + ' ' + res.url()); });
    return ctx;
  }
  async function pagina(ctx, adresa) {
    const pg = await ctx.newPage();
    pg.setDefaultTimeout(10000);
    pg.erori = [];
    pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 200)));
    await pg.goto(baza + adresa, { waitUntil: 'load' });
    return pg;
  }
  const depasire = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const latime of [390, 768, 1024, 1366]) {
      console.log(`B. Catalogul (${latime}px)`);
      const ctx = await context(browser, latime);
      await test(`${latime}: fiecare card are imagine (reală, a domeniului sau IMG_DEF), fără iconiță; imaginea din back-office are prioritate`, async () => {
        const pg = await pagina(ctx, '/mydarrin-catalog.html');
        await pg.waitForSelector('#grid-servicii .db-card', { state: 'attached' });
        await pg.waitForTimeout(400);
        const carduri = await pg.$$eval('.db-card', (c) => c.map((k) => ({ slug: k.dataset.slug, src: k.querySelector('.card-media img') ? k.querySelector('.card-media img').getAttribute('src') : null, icoana: !!k.querySelector('.card-icoana, .card-media [data-lucide]') })));
        egal(carduri.map((c) => c.slug).sort(), Object.keys(ASTEPTAT).sort(), 'carduri');
        for (const c of carduri) {
          egal(c.icoana, false, c.slug + ': iconiță');
          egal(c.src, ASTEPTAT[c.slug], c.slug);
        }
        egal(ASTEPTAT['parchet-montaj'], IMG_BO, 'produsul cu imagine din back-office');
        egal(ASTEPTAT['serviciu-domeniu-nou'], urlFoto(IMG_DEF), 'domeniu necunoscut → IMG_DEF');
        // 11-C6: pe ecran, cardurile vecine din același domeniu cu variante nu au toate
        // aceeași imagine (în ordinea din pagină, pe fiecare domeniu).
        const ordine = await pg.$$eval('.db-card', (c) => c.map((k) => ({ slug: k.dataset.slug, src: k.querySelector('.card-media img').getAttribute('src') })));
        for (const d of Object.keys(VARIANTE)) {
          const slugs = new Set(PRODUSE.filter((p) => p[3] === d).map((p) => p[0]));
          const surse = ordine.filter((c) => slugs.has(c.slug)).map((c) => c.src);
          adevarat(surse.length >= 4, d + ': prea puține carduri ' + surse.length);
          adevarat(new Set(surse).size >= 2, d + ': toate cardurile vecine au aceeași imagine');
          for (let i = 0; i + 3 < surse.length; i++) adevarat(new Set(surse.slice(i, i + 4)).size >= 2, d + ': 4 carduri vecine identice de la ' + i);
        }
        // Toate imaginile cardurilor se încarcă (inclusiv cele lazy, cerute explicit).
        const neincarcate = await pg.$$eval('.db-card .card-media img', (x) => Promise.all(x.map((i) => { i.loading = 'eager'; return i.decode().then(() => null).catch(() => i.getAttribute('src')); })).then((r) => r.filter(Boolean)));
        egal(neincarcate, [], 'imagini lipsă');
        egal(await depasire(pg), 0, 'derulare orizontală');
        egal(pg.erori, [], 'erori JS');
        await pg.close();
      });
      for (const [fila, buton] of [['servicii', 'servicii'], ['materiale', 'materiale'], ['inchiriere', 'inchiriere']]) {
        await test(`${latime}: fila ${fila} — cardurile vizibile au imagine, fără derulare orizontală`, async () => {
          const pg = await pagina(ctx, '/mydarrin-catalog.html');
          await pg.waitForSelector('#grid-' + fila + ' .db-card', { state: 'attached' });
          await pg.evaluate((b) => window.switchMainTab && window.switchMainTab(b), buton);
          await pg.waitForTimeout(400);
          const vizibile = await pg.$$eval('.tab-content.active .db-card', (c) => c.filter((x) => x.offsetParent !== null).map((k) => !!k.querySelector('.card-media img')));
          adevarat(vizibile.length > 0 && vizibile.every(Boolean), fila + ': ' + JSON.stringify(vizibile));
          egal(await depasire(pg), 0, 'derulare orizontală');
          if (CAPTURI && (latime === 390 || latime === 1366)) {
            await pg.evaluate(() => document.getElementById('catalog-grid-section').scrollIntoView({ block: 'start' }));
            await pg.waitForTimeout(300);
            await pg.screenshot({ path: path.join(CAPTURI, `catalog-${fila}-${latime}.png`) });
          }
          egal(pg.erori, [], 'erori JS');
          await pg.close();
        });
      }
      await test(`${latime}: marketplace — imaginea partenerului, altfel IMG_DEF`, async () => {
        const pg = await pagina(ctx, '/mydarrin-marketplace-materiale.html');
        await pg.waitForSelector('.card .card-img');
        const surse = await pg.$$eval('.card', (c) => c.map((k) => (k.querySelector('.card-img') ? k.querySelector('.card-img').getAttribute('src') : null)));
        egal(surse, [IMG_BO, urlFoto(IMG_DEF)]);
        egal(await depasire(pg), 0, 'derulare orizontală');
        egal(pg.erori, [], 'erori JS');
        await pg.close();
      });
      await test(`${latime}: nicio imagine cu răspuns 4xx / 5xx`, async () => {
        egal(ctx.imaginiRupte, []);
        adevarat(ctx.imaginiCerute.some((u) => u.includes('images.unsplash.com')), 'imaginile de prezentare nu s-au cerut');
      });
      await ctx.close();
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
