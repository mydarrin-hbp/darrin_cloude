// scripts/test-imagini-catalog.js
// Teste pentru pașii 11-C5, 11-C6 (4 nov. 2026) și 11-C7 (5 nov. 2026): imaginile de
// prezentare pe cardurile din catalog. Ordinea imaginii:
//   1. imaginea reală (catalog_servicii.imagini, din back-office; la marketplace,
//      imaginea încărcată de partener);
//   2. (11-C7) imaginea subiectului din titlu (SUBIECTE, cuvinte-cheie în ordine
//      explicită: cel mai specific subiect câștigă), cu 2–4 variante la subiectele mari;
//   3. altfel, imaginea de prezentare a domeniului (harta DOM din catalog; la
//      domeniile din VARIANTE, una dintre variante, aleasă stabil după id_serviciu);
//   4. altfel, IMG_DEF.
// 11-C7: cardurile vecine (stânga / dreapta / deasupra) nu au aceeași fotografie, cât
// timp subiectul are variante (distribuieImagini, după încărcare, filtru și căutare).
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
// Pasul 11-C7: logica completă din pagină (SUBIECTE, subiectDin, imaginiPrezentare).
const L = require('./raport-imagini-catalog').incarcaLogica(CATALOG);
const SUBIECTE = L.SUBIECTE;
// Imaginile permise pe card: cea reală, altfel una dintre variantele subiectului /
// domeniului (distribuieImagini o alege pe cea care nu se repetă cu vecinii).
const imgPermise = (item) => (item.imagini && item.imagini[0]) ? [item.imagini[0]]
  : L.imaginiPrezentare(item, DOM[item.domeniu] || { cat: 'Instalații', sub: 'General', img: IMG_DEF }).ids.map(urlFoto);
// Caruselul de categorii din hero.
const CARUSEL = [...CATALOG.matchAll(/<img src="https:\/\/images\.unsplash\.com\/photo-([0-9a-f-]+)\?w=600&q=80" alt="([^"]+)" loading="lazy">/g)].map((m) => ({ id: m[1], alt: m[2] }));
const SURSE = (() => { try { return citeste('docs/SURSE.md'); } catch (e) { return ''; } })();
const toateIdurile = () => [...new Set([IMG_DEF, ...Object.values(DOM).map((v) => v.img), ...Object.values(VARIANTE).flat(), ...SUBIECTE.flatMap((s) => s.img), ...CARUSEL.map((c) => c.id)])];
// Fotografiile nepotrivite din raportul 11-C5 (căști, autoturism, plajă, cort pe alte
// domenii, unelte de grădină la lemn, termostat, depozit, interior gol, camion, mașină
// de găurit cu marcă, baie la HVAC) — nu mai apar în catalog.
const NEPOTRIVITE = ['1585771724684-38269d6639fd', '1620891549027-942fdc95d3f5', '1473116763249-2faaef81ccda', '1416879595882-3373a0480b5b', '1545259741-2ea3ebf61fa3', '1587293852726-70cdb56c2866', '1581858726788-75bc0f6a952d', '1601584115197-04ecc0da31d7', '1572981779307-38b8cabb2407', '1558618666-fcd25c85cd64', '1615529328331-f8917597711f',
  // 11-C7: excavatorul din 11-C6 la „Demolări” avea text de marcă pe braț (la mărime întreagă).
  '1616551569669-b60598758c4f'];

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
  await test('11-C6: variante (3–4 fotografii diferite) la Bricolaj & Consumabile, Instalații sanitare și termice, Instalații electrice (11-C7: + Vehicule & Transport, 2)', async () => {
    egal(Object.keys(VARIANTE).sort(), ['Bricolaj & Consumabile', 'Instalații electrice', 'Instalații sanitare și termice', 'Vehicule & Transport'].sort());
    for (const [d, v] of Object.entries(VARIANTE)) {
      adevarat(DOM[d], d + ' lipsește din hartă');
      const min = d === 'Vehicule & Transport' ? 2 : 3;
      adevarat(v.length >= min && v.length <= 4 && new Set(v).size === v.length, d + ': ' + JSON.stringify(v));
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
  await test('11-C7: cazurile fixe — subiectul din titlu', async () => {
    const CAZURI = {
      'Înlocuire vas WC': 'vas-wc', 'Înlocuire cadă de baie': 'cada', 'Mașină spălat frontală 8 kg': 'masina-spalat',
      'Priza dubla ceramica Schneider v2': 'priza', 'Teava cupru 15mm v34': 'teava-cupru',
      'Plintă PVC pentru parchet laminat (montaj inclus)': 'plinta', 'Mentenanță tablou electric — verificare anuală': 'tablou-electric',
      'Proiectare HVAC & Climatizare': 'proiectare-hvac',
      // ordinea: cel mai specific subiect câștigă
      'Plintă PVC pentru parchet': 'plinta', 'Mentenanță tablou electric': 'tablou-electric',
      'Reparație garnituri & probă presiune calorifer': 'calorifer', 'Dezafectare instalații înainte de demolare': 'dezafectare',
      'Evacuare moloz și deșeuri din construcții': 'moloz', 'Consultanță și proiectare plan de demolare': 'proiectare-structurala',
      'Reparație lavoar / baterie / sifon': 'lavoar', 'Schimb ulei și filtre auto': 'ulei-auto', 'Diagnoză computerizată auto': 'diagnoza-auto',
      'Spălare geamuri și fațade': 'spalare-geamuri', 'Adeziv gresie/faianta sac 25kg v18': 'adeziv', 'Filtru Y pentru impuritati 3/4 v6': 'filtru-y',
      'Siguranta automata diferentiala 16A v3': 'tablou-electric', 'Mutare mobilă și electrocasnice apartament': 'mobilier',
      'Livrare beton la comandă cu autobetonieră': 'beton', 'Consultanță & proiectare instalație electrică': 'proiectare-electrica',
      // fără subiect: titlul e chiar domeniul → imaginea domeniului
      'Acces & Siguranță': null, 'Pavaje & Alei': null, 'Instalații electrice': null,
    };
    const gresite = Object.entries(CAZURI).map(([t, s]) => [t, s, (L.subiectDin(t) || {}).id || null]).filter(([, s, g]) => s !== g);
    egal(gresite, [], 'titlu → subiect');
  });
  await test('11-C7: ordinea subiectelor e scrisă explicit; fiecare subiect are 1–4 fotografii, ID-uri valide, fără Unsplash+', async () => {
    adevarat(Array.isArray(SUBIECTE) && SUBIECTE.length >= 40, 'SUBIECTE: ' + SUBIECTE.length);
    egal(new Set(SUBIECTE.map((s) => s.id)).size, SUBIECTE.length, 'id-uri unice');
    for (const s of SUBIECTE) {
      adevarat(s.cuvinte.length && s.cuvinte.every((k) => k === L.normTitlu(k).trim()), s.id + ': cuvinte nenormalizate ' + JSON.stringify(s.cuvinte));
      adevarat(s.img.length >= 1 && s.img.length <= 4 && new Set(s.img).size === s.img.length, s.id + ': ' + s.img.length + ' fotografii');
      adevarat(s.img.every((id) => /^\d{9,13}-[0-9a-f]{12}$/.test(id)), s.id + ': ID greșit');
    }
    adevarat(!/premium_photo|plus\.unsplash\.com/.test(CATALOG), 'Unsplash+ în catalog');
  });
  await test('11-C7: imaginea reală are în continuare prioritate; fără subiect → domeniu → IMG_DEF', async () => {
    const real = 'https://exemplu.test/real.png';
    const mk = CATALOG.slice(CATALOG.indexOf('function mkCard('), CATALOG.indexOf('function inject('));
    adevarat(/const img = imgReal \|\| imgPrezentare/.test(mk) && /imaginiPrezentare\(item, d\)/.test(mk), 'ordinea în mkCard');
    egal(imgPermise({ titlu: 'Înlocuire vas WC', domeniu: 'Instalații sanitare și termice', imagini: [real] }), [real]);
    egal(L.imaginiPrezentare({ id_serviciu: 'x', titlu: 'Pavaje & Alei', domeniu: 'Pavaje & Alei' }, DOM['Pavaje & Alei']).sursa, 'domeniu');
    egal(L.imaginiPrezentare({ id_serviciu: 'x', titlu: 'Ceva nou', domeniu: 'Domeniu nou' }, { img: IMG_DEF }), { ids: [IMG_DEF], sursa: 'implicit' });
    // stabil: același produs → aceeași ordine a variantelor
    const p = { id_serviciu: 'mat-teava-cupru-15mm-v34', titlu: 'Teava cupru 15mm v34', domeniu: 'Bricolaj & Consumabile' };
    egal(L.imaginiPrezentare(p, DOM[p.domeniu]), L.imaginiPrezentare(Object.assign({}, p), DOM[p.domeniu]));
  });
  if (!process.env.FARA_RETEA) {
    await test('11-C7: acoperirea pe produsele publice (live) — niciun implicit; pe domeniu doar titlurile-domeniu și închirierile; ≥ 3 produse → ≥ 2 fotografii', async () => {
      const R = require('./raport-imagini-catalog');
      let produse;
      try { produse = await R.produsePublice(); } catch (e) { console.log('    (fără rețea: verificarea live sărită — ' + e.message + ')'); return; }
      const randuri = R.alege(L, produse);
      adevarat(randuri.length >= 200, 'produse: ' + randuri.length);
      egal(randuri.filter((r) => r.motiv === 'implicit').map((r) => r.titlu), [], 'pe imaginea implicită');
      // Rămân pe domeniu doar produsele al căror titlu e chiar domeniul (sau aproape), închirierile
      // și cele două excepții de mai jos, unde subiectul titlului e chiar domeniul.
      const EXCEPTII = ['Consultanță Darrin', 'Înlocuire instalație electrică debara/cămară'];
      const peDomeniu = randuri.filter((r) => r.motiv === 'domeniu' && r.categorie !== 'inchirieri' && r.titlu !== r.domeniu && !EXCEPTII.includes(r.titlu));
      egal(peDomeniu.map((r) => r.titlu), [], 'servicii / materiale cu subiect clar căzute pe domeniu');
      const pe = R.rezumat(randuri);
      const putine = Object.entries(pe).filter(([k, rs]) => k !== 'real' && rs.length >= 3 && new Set(rs.flatMap((r) => r.variante)).size < 2).map(([k]) => k);
      egal(putine, [], 'subiecte / domenii cu ≥ 3 produse și o singură fotografie');
    });
  }
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
  // 11-C7: titluri reale, cu șiruri lungi din același subiect (ca grupurile „v1”…„v10”).
  ['wc-inlocuire', 'Înlocuire vas WC', 'servicii', 'Instalații sanitare și termice', []],
  ['cada-inlocuire', 'Înlocuire cadă de baie', 'servicii', 'Instalații sanitare și termice', []],
  ['tel-mentenanta', 'Mentenanță tablou electric — verificare anuală', 'servicii', 'Instalații electrice', []],
  ['proiectare-hvac', 'Proiectare HVAC & Climatizare', 'servicii', 'Proiectare Tehnică', []],
  ['mas-8kg', 'Mașină spălat frontală 8 kg', 'materiale', 'Electrocasnice', []],
  ['mat-plinta-pvc-parchet-laminat', 'Plintă PVC pentru parchet laminat (montaj inclus)', 'materiale', 'Parchet & Pardoseli', []],
  ...[14, 24, 34, 44, 54, 64, 74, 84].map((v) => [`mat-teava-cupru-15mm-v${v}`, `Teava cupru 15mm v${v}`, 'materiale', 'Bricolaj & Consumabile', []]),
  ...[17, 27, 37, 47, 57, 67].map((v) => [`mat-garnitura-siliconica-set-10-buc-v${v}`, `Garnitura siliconica set 10 buc v${v}`, 'materiale', 'Bricolaj & Consumabile', []]),
  ...[12, 22, 32, 42, 52].map((v) => [`mat-priza-dubla-ceramica-schneider-v${v}`, `Priza dubla ceramica Schneider v${v}`, 'materiale', 'Bricolaj & Consumabile', []]),
  ...[18, 28, 38, 48, 58].map((v) => [`mat-adeziv-gresiefaianta-sac-25kg-v${v}`, `Adeziv gresie/faianta sac 25kg v${v}`, 'materiale', 'Bricolaj & Consumabile', []]),
  ['inchiriere-vehicule-utilitare-si-transport', 'Închiriere vehicule utilitare și transport', 'inchirieri', 'Vehicule & Transport', []],
];
// Imaginile permise pe fiecare card (reală, altfel variantele subiectului / domeniului).
const PERMISE = Object.fromEntries(PRODUSE.map(([slug, titlu, , domeniu, imagini]) => [slug, imgPermise({ id_serviciu: slug, titlu, domeniu, imagini })]));
const SUBIECT_ASTEPTAT = { 'wc-inlocuire': 'vas-wc', 'cada-inlocuire': 'cada', 'tel-mentenanta': 'tablou-electric', 'proiectare-hvac': 'proiectare-hvac', 'mas-8kg': 'masina-spalat', 'mat-plinta-pvc-parchet-laminat': 'plinta', 'mat-teava-cupru-15mm-v34': 'teava-cupru', 'mat-priza-dubla-ceramica-schneider-v12': 'priza' };
// În pagină: repetările între vecini (stânga / dreapta / deasupra), pe rândurile reale ale
// grilei, doar pentru cardurile care au cel puțin 2 variante.
function repetariVecini() {
  const vizibile = Array.from(document.querySelectorAll('.tab-content.active .db-card')).filter((c) => c.offsetParent !== null);
  const randuri = [];
  vizibile.forEach((c) => { const top = Math.round(c.getBoundingClientRect().top + window.scrollY); let r = randuri.find((x) => Math.abs(x.top - top) < 5); if (!r) randuri.push(r = { top, carduri: [] }); r.carduri.push(c); });
  randuri.sort((a, b) => a.top - b.top);
  const src = (c) => c.querySelector('.card-media img').getAttribute('src');
  const variante = (c) => (c.dataset.imgVariante || '').split(' ').filter(Boolean).length;
  const rep = [];
  randuri.forEach((r, i) => r.carduri.forEach((c, j) => {
    if (variante(c) < 2) return;
    if (j > 0 && src(r.carduri[j - 1]) === src(c)) rep.push('stânga: ' + c.dataset.slug);
    const sus = i > 0 ? randuri[i - 1].carduri[j] : null;
    if (sus && src(sus) === src(c)) rep.push('deasupra: ' + c.dataset.slug);
  }));
  return { rep, coloane: Math.max(...randuri.map((r) => r.carduri.length), 0), carduri: vizibile.length };
}
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
        egal(carduri.map((c) => c.slug).sort(), Object.keys(PERMISE).sort(), 'carduri');
        for (const c of carduri) {
          egal(c.icoana, false, c.slug + ': iconiță');
          adevarat(PERMISE[c.slug].includes(c.src), c.slug + ': ' + c.src + ' nu e printre ' + JSON.stringify(PERMISE[c.slug]));
        }
        egal(PERMISE['parchet-montaj'], [IMG_BO], 'produsul cu imagine din back-office');
        egal(PERMISE['serviciu-domeniu-nou'], [urlFoto(IMG_DEF)], 'domeniu necunoscut → IMG_DEF');
        // 11-C7: motivul imaginii pe card (subiectul din titlu).
        const surse = await pg.$$eval('.db-card', (c) => Object.fromEntries(c.map((k) => [k.dataset.slug, k.dataset.imgSursa])));
        for (const [slug, s] of Object.entries(SUBIECT_ASTEPTAT)) egal(surse[slug], 'subiect:' + s, slug);
        egal(surse['parchet-montaj'], 'real');
        // 11-C6: pe ecran, cardurile vecine din același domeniu cu variante nu au toate
        // aceeași imagine (în ordinea din pagină, pe fiecare domeniu).
        const ordine = await pg.$$eval('.db-card', (c) => c.map((k) => ({ slug: k.dataset.slug, src: k.querySelector('.card-media img').getAttribute('src') })));
        for (const d of Object.keys(VARIANTE)) {
          const slugs = new Set(PRODUSE.filter((p) => p[3] === d).map((p) => p[0]));
          const surse = ordine.filter((c) => slugs.has(c.slug)).map((c) => c.src);
          if (surse.length < 4) continue;
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
          // 11-C7: niciun card nu are aceeași fotografie cu vecinul din stânga / dreapta /
          // de deasupra (pentru subiectele cu variante). Verificat la 390 și 1366 px.
          const vecini = await pg.evaluate(repetariVecini);
          if (latime === 390 || latime === 1366) egal(vecini.rep, [], `${fila} (${vecini.coloane} coloane): repetări între vecini`);
          else if (vecini.rep.length) console.log(`    (${latime}px, ${vecini.coloane} coloane: ${vecini.rep.length} repetări între vecini)`);
          if (CAPTURI && (latime === 390 || latime === 1366)) {
            await pg.evaluate(() => document.getElementById('catalog-grid-section').scrollIntoView({ block: 'start' }));
            await pg.waitForTimeout(300);
            await pg.screenshot({ path: path.join(CAPTURI, `catalog-${fila}-${latime}.png`) });
          }
          egal(pg.erori, [], 'erori JS');
          await pg.close();
        });
      }
      if (latime === 1366) {
        await test('1366: 11-C7 — alegerea e stabilă la reîncărcare și fără repetări între vecini după căutare și filtru', async () => {
          const imagini = (pg) => pg.$$eval('.db-card', (c) => c.map((k) => k.dataset.slug + ' ' + k.querySelector('.card-media img').getAttribute('src')));
          const pg = await pagina(ctx, '/mydarrin-catalog.html');
          await pg.waitForSelector('#grid-materiale .db-card', { state: 'attached' });
          await pg.waitForTimeout(400);
          const prima = await imagini(pg);
          await pg.reload({ waitUntil: 'load' });
          await pg.waitForSelector('#grid-materiale .db-card', { state: 'attached' });
          await pg.waitForTimeout(400);
          egal(await imagini(pg), prima, 'aceeași listă → aceleași imagini');
          await pg.evaluate(() => window.switchMainTab && window.switchMainTab('materiale'));
          await pg.waitForTimeout(300);
          for (const cautare of ['cupru', 'garnitura', 'v2', '']) {
            await pg.fill('#search-input', cautare);
            await pg.evaluate(() => window.applyFilters && window.applyFilters());
            await pg.waitForTimeout(200);
            const v = await pg.evaluate(repetariVecini);
            adevarat(cautare === '' || v.carduri > 0, 'căutarea „' + cautare + '” nu a găsit nimic');
            egal(v.rep, [], `căutare „${cautare}”: repetări între vecini`);
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
