// scripts/test-rute-catalog.js — pasul 12-U1b (21 nov. 2026): rutele spre catalog, în browser
//
// Pe serverul de test (cu redirecturile din vercel.json + middleware), în Chromium,
// la 390 și 1366 px, în RO și EN:
//   - cardurile din „Servicii complete la cerere” (servicii, materiale, închirieri)
//     duc la /servicii|/materiale|/inchirieri?subcategorie=<slug>, cu 200 (nu 404);
//   - un link din meniul „Servicii” din antet și unul din meniul lateral duc la o
//     adresă curată, cu slug real;
//   - adresele stricate de la 12-U1 (/catalogservicii&…) → 301 spre adresa corectă, apoi 200;
//   - o subcategorie inexistentă arată mesajul și scoate parametrul din adresă.
// Supabase e simulat (categorii: doar cele din răspunsul de mai jos).
// Capturi (opțional): CAPTURI=<folder> node scripts/test-rute-catalog.js
// Rulare: node scripts/test-rute-catalog.js   (iese cu 1 dacă ceva pică)

const fs = require('fs');
const path = require('path');
const { porneste } = require('./server-test');

let picate = 0; let trecute = 0;
function verifica(ok, mesaj) { if (ok) trecute++; else { picate++; console.log('  ✗ ' + mesaj); } }

const CATEGORII = [
  { id: 'a1', slug: 'instalatii-electrice', title: 'Instalații electrice', title_en: 'Electrical installations', description: 'Montaj', category_type: 'servicii', icon_name: 'zap' },
  { id: 'a2', slug: 'betoane', title: 'Betoane', title_en: 'Concrete', description: 'Beton', category_type: 'materiale', icon_name: 'box' },
  { id: 'a3', slug: 'utilaje-constructii', title: 'Utilaje construcții', title_en: 'Construction machinery', description: 'Utilaje', category_type: 'inchiriere', icon_name: 'truck' },
];

(async () => {
  let pw;
  try { pw = require('playwright'); } catch (e) { console.log('Playwright lipsește — testul de browser e sărit'); return; }
  const srv = await porneste(0, { redirecturi: true });
  const B = 'http://localhost:' + srv.address().port;
  const cere = (u) => fetch(B + u, { redirect: 'manual' });
  const CAPTURI = process.env.CAPTURI;
  if (CAPTURI) fs.mkdirSync(CAPTURI, { recursive: true });

  console.log('A. Adrese stricte, 301');
  for (const [v, nou] of [
    ['/catalogservicii&subcategorie=instalatii-electrice', '/servicii?subcategorie=instalatii-electrice'],
    ['/catalogmateriale&subcategorie=betoane', '/materiale?subcategorie=betoane'],
    ['/cataloginchirieri&subcategorie=vacanta', '/inchirieri?subcategorie=vacanta'],
  ]) {
    const r = await cere(v);
    verifica(r.status === 301 && r.headers.get('location') === nou, `${v} → ${r.status} ${r.headers.get('location')} (aștept 301 ${nou})`);
    verifica((await cere(r.headers.get('location') || '/')).status === 200, `${v}: ținta nu dă 200`);
  }

  const browser = await pw.chromium.launch();
  for (const lang of ['ro', 'en']) {
    for (const [w, h] of [[390, 844], [1366, 768]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      await ctx.addInitScript((l) => {
        try {
          localStorage.setItem('myd_lang_v1', l);
          localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, marketing: false, data: new Date().toISOString(), versiune: 2 }));
        } catch (e) {}
      }, lang);
      await ctx.route(/googletagmanager|google-analytics|connect\.facebook|analytics\.tiktok|snap\.licdn|ipapi\.co|nominatim/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
      await ctx.route(/supabase\.co\/rest\/v1\/categorii/, (r) => {
        const u = new URL(r.request().url());
        const slug = (u.searchParams.get('slug') || '').replace(/^eq\./, '');
        const tip = u.searchParams.get('category_type');
        let rows = [];
        if (slug) rows = CATEGORII.filter((c) => c.slug === slug);
        else if (u.searchParams.get('parent_id')) rows = [];
        else rows = CATEGORII.filter((c) => !tip || tip === 'eq.' + c.category_type);
        r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(rows) });
      });
      await ctx.route(/supabase\.co\//, (r) => (/\/rest\/v1\/categorii/.test(r.request().url()) ? r.fallback() : r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' })));
      const eticheta = `${lang} ${w}px`;
      console.log('B. ' + eticheta);

      // Cardurile din pagina principală: href-ul se construiește cu funcția comună.
      {
        const pg = await ctx.newPage();
        await pg.goto(B + '/', { waitUntil: 'load' });
        const hrefuri = await pg.evaluate(() => {
          if (typeof renderCatTile !== 'function') return null;
          const t = (tip, slug) => { const d = document.createElement('div'); d.innerHTML = renderCatTile({ slug, title: 'x', description: 'y', category_type: tip, icon_name: 'circle' }); return d.firstChild.getAttribute('href'); };
          return [t('servicii', 'instalatii-electrice'), t('materiale', 'betoane'), t('inchiriere', 'utilaje-constructii')];
        });
        verifica(Array.isArray(hrefuri), `${eticheta}: renderCatTile lipsește din pagina principală`);
        if (hrefuri) {
          const asteptat = ['/servicii?subcategorie=instalatii-electrice', '/materiale?subcategorie=betoane', '/inchirieri?subcategorie=utilaje-constructii'];
          asteptat.forEach((a, i) => verifica(hrefuri[i] === a, `${eticheta}: card ${hrefuri[i]} (aștept ${a})`));
          for (const a of asteptat) {
            const p2 = await ctx.newPage();
            const r = await p2.goto(B + a, { waitUntil: 'load' });
            verifica(r && r.status() === 200, `${eticheta}: ${a} → ${r && r.status()}`);
            await p2.close();
          }
        }
        if (CAPTURI) await pg.screenshot({ path: path.join(CAPTURI, `index-${lang}-${w}.png`) });
        await pg.close();
      }

      // Meniul „Servicii” din antet (o pagină cu meniul scris de mână) și meniul lateral.
      {
        const pg = await ctx.newPage();
        await pg.goto(B + '/cum-comanzi', { waitUntil: 'load' });
        const legaturi = await pg.evaluate(() => Array.from(document.querySelectorAll('a[onclick*="subcategorie="], a[href*="subcategorie="]')).map((a) => (a.getAttribute('onclick') || '') + ' ' + (a.getAttribute('href') || '')));
        const rele = legaturi.filter((l) => /subcategorie=/.test(l) && !/\/(servicii|materiale|inchirieri)\?subcategorie=[a-z0-9-]+/.test(l));
        verifica(legaturi.length > 0 && rele.length === 0, `${eticheta}: meniurile din /cum-comanzi au linkuri cu fila și slug real (${rele.slice(0, 2).join(' | ')})`);
        // click pe „Instalații electrice” din antet (link ascuns în meniul derulant: navigare directă)
        const tinta = (legaturi.find((l) => /instalatii-electrice/.test(l)) || '').match(/\/servicii\?subcategorie=instalatii-electrice/);
        verifica(!!tinta, `${eticheta}: meniul Servicii are „instalatii-electrice”`);
        if (tinta) {
          const p2 = await ctx.newPage();
          await p2.goto(B + tinta[0], { waitUntil: 'load' });
          await p2.waitForTimeout(1000);
          const a = await p2.evaluate(() => location.pathname + location.search);
          verifica(a === tinta[0], `${eticheta}: după deschidere adresa e ${a}`);
          await p2.close();
        }
        await pg.close();
      }

      // Subcategorie inexistentă: mesajul, fără parametru greșit în adresă.
      for (const [u, mesaj] of [
        ['/servicii?subcategorie=nu-exista', lang === 'ro' ? 'Categoria căutată nu mai există. Îți arătăm toate serviciile.' : 'The category you were looking for no longer exists. Here are all services.'],
        ['/materiale?subcategorie=nu-exista', lang === 'ro' ? 'Categoria căutată nu mai există. Îți arătăm toate materialele.' : 'The category you were looking for no longer exists. Here are all materials.'],
        ['/inchirieri?subcategorie=nu-exista', lang === 'ro' ? 'Categoria căutată nu mai există. Îți arătăm toate închirierile.' : 'The category you were looking for no longer exists. Here are all rentals.'],
      ]) {
        const pg = await ctx.newPage();
        const erori = [];
        pg.on('pageerror', (e) => erori.push(e.message));
        await pg.goto(B + u, { waitUntil: 'load' });
        await pg.waitForFunction(() => window.MYD_I18N && !document.documentElement.classList.contains('myd-i18n-pending'), null, { timeout: 15000 }).catch(() => {});
        await pg.waitForFunction(() => { const c = document.getElementById('filtru-subcategorie'); return c && !c.hidden && c.textContent.length > 3; }, null, { timeout: 8000 }).catch(() => {});
        const s = await pg.evaluate(() => { const c = document.getElementById('filtru-subcategorie'); return { text: c && !c.hidden ? c.textContent : '', adresa: location.pathname + location.search }; });
        verifica(s.text.includes(mesaj), `${eticheta} ${u}: mesajul „${s.text}” (aștept „${mesaj}”)`);
        verifica(!/subcategorie=/.test(s.adresa), `${eticheta} ${u}: parametrul greșit a rămas în adresă (${s.adresa})`);
        verifica(erori.length === 0, `${eticheta} ${u}: erori JS ${erori.join('; ')}`);
        if (CAPTURI) await pg.screenshot({ path: path.join(CAPTURI, `lipsa-${u.split('/')[1].split('?')[0]}-${lang}-${w}.png`) });
        await pg.close();
      }
      // Subcategorie existentă: fără mesaj.
      {
        const pg = await ctx.newPage();
        await pg.goto(B + '/servicii?subcategorie=instalatii-electrice', { waitUntil: 'load' });
        await pg.waitForTimeout(1500);
        const t = await pg.evaluate(() => { const c = document.getElementById('filtru-subcategorie'); return c && !c.hidden ? c.textContent : ''; });
        verifica(!/nu mai există|no longer exists/.test(t), `${eticheta}: subcategorie existentă arată mesajul de lipsă (${t})`);
        await pg.close();
      }
      await ctx.close();
    }
  }
  await browser.close();
  srv.close();
  console.log(`${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
