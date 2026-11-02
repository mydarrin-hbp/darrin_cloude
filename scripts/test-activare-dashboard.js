// scripts/test-activare-dashboard.js
// Pasul 11-R3 (decizia LM, 2 nov. 2026): după cod, partenerul ajunge în
// dashboard-ul rolului ales, în modul activare. Chromium (Playwright), cu
// Supabase simulat în pagină (sesiune) și /api/cont/profil simulat pe rută:
//   - servicii (mydarrin-dashboard-partener) și materiale (mydarrin-dashboard-furnizor),
//     înainte de firmă: doar lista „Activează contul” (6 pași, doar „Firma”
//     deschis); panourile și meniul nu apar, cu explicația „disponibil după
//     activarea contului”; „Firma” duce la pasul 2 din wizard;
//   - după firmă (rolul adăugat): lista actualizată deasupra dashboard-ului,
//     panourile vizibile;
//   - paza: un cont fără rol de partener ales nu intră în modul activare
//     (e trimis la destinația lui);
//   - în engleză, lista e în engleză;
//   - la 360, 390, 430, 768 × 1024, 1024 × 768, 1366 și 1920 px: fără derulare
//     orizontală, butoane de cel puțin 44 px; fără erori JS.
// Cu --capturi <dosar>: capturile listei la 390, 768, 1024 și 1366 px.
// Rulare: node scripts/test-activare-dashboard.js [--capturi <dosar>]

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const ECRANE = [[360, 740], [390, 844], [430, 932], [768, 1024], [1024, 768], [1366, 900], [1920, 1080]];
const iCapturi = process.argv.indexOf('--capturi');
const dosarCapturi = iCapturi !== -1 ? process.argv[iCapturi + 1] : null;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const ZGOMOT = /Failed to load resource|net::ERR_|ERR_FAILED|Failed to fetch|status of 50[0-9]|status of 40[0-9]|cdn\.tailwindcss\.com/i;

function supabaseConectat() {
  const sesiune = { access_token: 'tok-test', user: { id: 'u-test', email: 'firma@example.com', email_confirmed_at: '2026-11-02T08:00:00Z', user_metadata: {} } };
  const fals = {
    auth: {
      getUser: async () => ({ data: { user: sesiune.user }, error: null }),
      getSession: async () => ({ data: { session: sesiune } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }) }) }) }),
  };
  Object.defineProperty(window, 'supabaseClient', { configurable: true, get() { return fals; }, set() {} });
}

const PASI = ['firma', 'cont_bancar', 'profesii', 'dotari', 'documente', 'contract'];
function profil(rol, tip, faza) {
  const inainte = faza === 'inainte';
  const deschide = {
    firma: { tip: 'wizard', pas: 2 }, cont_bancar: { tip: 'actiune', cheie: 'cont_bancar' },
    profesii: tip === 'servicii' ? { tip: 'wizard', pas: 3 } : { tip: 'wizard', pas: 7 },
    dotari: tip === 'materiale' ? { tip: 'panou', id: 'produse' } : { tip: 'wizard', pas: 4 },
    documente: { tip: 'panou', id: 'documente' }, contract: { tip: 'actiune', cheie: 'contract' },
  };
  const stari = inainte
    ? ['de_completat', 'blocat', 'blocat', 'blocat', 'blocat', 'blocat']
    : ['in_verificare', 'completat', 'de_completat', 'de_completat', 'in_verificare', 'de_completat'];
  return {
    ok: true, email: 'firma@example.com', nume: 'Ana Popescu', prenume: 'Ana', nume_familie: 'Popescu', telefon: '+40712345678', tara: 'RO',
    roles: inainte ? ['client'] : ['client', rol],
    roluri_dashboard: inainte ? [] : [rol],
    destinatie: '/mydarrin-dashboard-' + (tip === 'materiale' ? 'furnizor' : 'partener') + '.html?type=' + tip,
    tip_destinatie: inainte ? 'activare_partener' : 'rol',
    are_comenzi: false, rol_solicitat: rol, furnizor_propriu: false,
    partener: inainte ? null : { nume_firma: 'Firma Test SRL', partner_type: tip === 'materiale' ? 'furnizor_materiale' : 'servicii_tehnice', rol, status_verificare: 'pending_review', contract_semnat: false, cont_bancar: true, motiv_respingere: null, poate_vinde: false, motiv_nu_poate_vinde: 'in_verificare' },
    investitor: null,
    activare: { rol, tip, mod_activare: inainte, verificare: inainte ? null : 'pending_review', activ: false, complet: false, pasi: PASI.map((cheie, i) => ({ cheie, stare: stari[i], deschide: deschide[cheie] })) },
  };
}

async function deschide(browser, baza, pagina, corpProfil, latime, inaltime, limba) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: inaltime } });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
      if (l) localStorage.setItem('myd_lang_v1', l);
    } catch (e) {}
  }, limba);
  await ctx.addInitScript(supabaseConectat);
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  await ctx.route(/ipapi\.co\//, (r) => r.abort());
  await ctx.route(/\/api\/cont\/profil/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpProfil) }));
  // Navigările spre wizard și spre alte pagini se rețin și se opresc.
  const navigari = [];
  await ctx.route(/\/(mydarrin-devino-partener-wizard|mydarrin-catalog|mydarrin-rolurile-mele)(\.html)?/, (r) => {
    if (r.request().isNavigationRequest()) { navigari.push(r.request().url()); return r.fulfill({ status: 204, body: '' }); }
    return r.continue();
  });
  const p = await ctx.newPage();
  const erori = [];
  p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
  p.on('console', (m) => { if (m.type() === 'error' && !ZGOMOT.test(m.text())) erori.push('console: ' + m.text().slice(0, 160)); });
  await p.goto(`${baza}/${pagina}`, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => erori.push('goto: ' + e.message.slice(0, 100)));
  await p.waitForSelector('#myd-activare', { timeout: 8000 }).catch(() => {});
  return { ctx, p, erori, navigari };
}

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  const CAZURI = [
    ['servicii', 'partener_servicii', 'mydarrin-dashboard-partener.html?type=servicii', 'dp-content', 'dp-nav'],
    ['materiale', 'partener_materiale', 'mydarrin-dashboard-furnizor.html?type=materiale', 'fb-content', 'fb-nav'],
  ];
  try {
    for (const [tip, rol, pagina, continut, nav] of CAZURI) {
      // 1. Înainte de firmă: modul activare.
      {
        const et = `${tip}: modul activare`;
        const { ctx, p, erori, navigari } = await deschide(browser, baza, pagina, profil(rol, tip, 'inainte'), 1366, 900, 'ro');
        const s = await p.evaluate(([c, n]) => {
          const lista = document.getElementById('myd-activare');
          const vizibil = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; };
          return {
            lista: !!lista && lista.getClientRects().length > 0,
            pasi: lista ? [...lista.querySelectorAll('.myd-act-pas')].map((li) => [li.getAttribute('data-pas'), li.querySelector('button').disabled]) : [],
            continut: vizibil(c), nav: vizibil(n),
            blocat: (document.getElementById('myd-blocat') || {}).textContent || '',
            antet: !!document.getElementById('myd-id'),
            overlay: !!document.getElementById('auth-gate-overlay'),
          };
        }, [continut, nav]);
        verifica(s.lista, `${et}: lista „Activează contul” nu apare`);
        verifica(JSON.stringify(s.pasi) === JSON.stringify(PASI.map((k, i) => [k, i > 0])), `${et}: pașii / butoanele: ${JSON.stringify(s.pasi)}`);
        verifica(!s.continut && !s.nav, `${et}: panourile sau meniul se văd în modul activare`);
        verifica(/disponibil după activarea contului/i.test(s.blocat), `${et}: lipsește explicația „disponibil după activarea contului”`);
        verifica(s.antet && !s.overlay, `${et}: antetul contului lipsește sau pagina a rămas la „Se verifică accesul”`);
        await p.click('#myd-activare [data-pas="firma"] button');
        await p.waitForTimeout(400);
        verifica(navigari.some((u) => /mydarrin-devino-partener-wizard(\.html)?\?pas=2/.test(u)), `${et}: „Firma” nu duce la pasul 2 din wizard (${navigari.join(' ') || '—'})`);
        verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
        await ctx.close();
      }
      // 2. După firmă: lista actualizată, deasupra dashboard-ului.
      {
        const et = `${tip}: după firmă`;
        const { ctx, p, erori } = await deschide(browser, baza, pagina, profil(rol, tip, 'dupa'), 1366, 900, 'ro');
        const s = await p.evaluate((c) => ({
          stari: [...document.querySelectorAll('#myd-activare .myd-act-pas')].map((li) => li.className.replace('myd-act-pas', '').trim()),
          continut: getComputedStyle(document.getElementById(c)).display !== 'none',
          blocat: !!document.getElementById('myd-blocat'),
          progres: (document.querySelector('#myd-activare .myd-act-progres') || {}).textContent,
        }), continut);
        verifica(JSON.stringify(s.stari) === JSON.stringify(['in_verificare', 'completat', 'de_completat', 'de_completat', 'in_verificare', 'de_completat']), `${et}: stările: ${JSON.stringify(s.stari)}`);
        verifica(s.continut && !s.blocat, `${et}: panourile sunt blocate după ce rolul a fost adăugat`);
        verifica(/1 din 6/.test(s.progres || ''), `${et}: progresul „${s.progres}”`);
        verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
        await ctx.close();
      }
    }

    // 3. Paza: fără rol de partener ales → fără modul activare.
    {
      const et = 'paza: client fără rol de partener ales';
      const corp = { ...profil('partener_servicii', 'servicii', 'inainte'), rol_solicitat: 'client', activare: null, destinatie: '/mydarrin-catalog.html', tip_destinatie: 'client_fara_comenzi' };
      const { ctx, p, navigari } = await deschide(browser, baza, 'mydarrin-dashboard-partener.html?type=servicii', corp, 1366, 900, 'ro');
      await p.waitForTimeout(800);
      verifica(!(await p.$('#myd-activare')), `${et}: lista de activare apare`);
      verifica(navigari.some((u) => /mydarrin-catalog/.test(u)), `${et}: nu e trimis la destinația lui (${navigari.join(' ') || '—'})`);
      await ctx.close();
    }

    // 4. Engleză (prima vizită).
    {
      const et = 'EN: lista „Activate your account”';
      const { ctx, p, erori } = await deschide(browser, baza, 'mydarrin-dashboard-partener.html?type=servicii', profil('partener_servicii', 'servicii', 'inainte'), 1366, 900, null);
      await p.waitForTimeout(600);
      const text = await p.evaluate(() => (document.getElementById('myd-activare') || {}).innerText + '\n' + (document.getElementById('myd-blocat') || {}).innerText);
      verifica(/Activate your account/.test(text) && /Company/.test(text) && /available after your account is activated/i.test(text), `${et}: lista nu e în engleză`);
      const ro = text.match(/[ăâîșțşţ][^\n]{0,30}/gi) || [];
      verifica(!ro.length, `${et}: text românesc: ${ro.slice(0, 3).join(' | ')}`);
      verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }

    // 5. Dimensiunile ecranului (și capturile).
    if (dosarCapturi) fs.mkdirSync(dosarCapturi, { recursive: true });
    for (const [tip, rol, pagina] of CAZURI) {
      for (const [w, h] of ECRANE) {
        const et = `${tip} ${w}×${h}`;
        const { ctx, p, erori } = await deschide(browser, baza, pagina, profil(rol, tip, 'inainte'), w, h, 'ro');
        const m = await p.evaluate(() => {
          const l = document.getElementById('myd-activare');
          if (!l) return null;
          const r = l.getBoundingClientRect();
          return {
            stanga: r.left, dreapta: r.right, vw: window.innerWidth, scroll: document.documentElement.scrollWidth,
            minButon: Math.min(...[...l.querySelectorAll('button')].map((b) => b.getBoundingClientRect().height)),
          };
        });
        verifica(!!m, `${et}: lista nu apare`);
        if (m) {
          verifica(m.stanga >= 0 && m.dreapta <= m.vw + 0.5, `${et}: lista iese din ecran (${Math.round(m.stanga)}–${Math.round(m.dreapta)} din ${m.vw})`);
          verifica(m.minButon >= 44, `${et}: buton sub 44 px (${m.minButon})`);
        }
        verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
        if (dosarCapturi && [390, 768, 1024, 1366].includes(w)) {
          const el = await p.$('#myd-cont-antet');
          if (el) await el.screenshot({ path: path.join(dosarCapturi, `activare-${tip}-${w}.png`) });
        }
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
