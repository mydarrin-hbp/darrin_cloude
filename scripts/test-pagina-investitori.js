// scripts/test-pagina-investitori.js
// Pasul 11-R3h (decizia LM, 3 nov. 2026): pagina Investitori „după parcurs”
// (varianta B) și „Investitori” scos din antet. Înlocuiește testul din 11-M
// (antetul propriu al paginii, cu selectorul de limbă și „Intră în cont” spre
// index.html, nu mai există). Verifică:
//   A. static: niciun antet de pe paginile publice nu are „Investitori”; nicio
//      pagină nu mai are investor-modal, openInvestorModal, closeInvestorModal,
//      submitInvestorForm sau „Solicitare primită”; meniul se generează doar din
//      meniu-investitori.js (nicio copie #sb-inv în pagini);
//   B. meniul vertical (☰) și footer-ul au cele 5 intrări, în ordine („Panoul
//      meu” doar cu rolul `investor`), cu linkuri care răspund 200 și ancore
//      care există pe pagina Investitori;
//   C. ancorele vechi: #ghid-investitor → #cum-functioneaza; #kpis → #panou
//      pentru investitor, altfel #cum-functioneaza;
//   D. hero-ul: același font-family calculat, aceeași mărime, greutate și
//      aliniere ca hero-urile din 11-R3g; antetul standard, fără antetul propriu
//      și fără mini-footer;
//   E. butonul principal în toate stările (răspunsuri simulate): textul (RO și
//      EN), acțiunea, nota de sub buton și parcursul în 7 segmente;
//   F. fără rundă vizibilă: nicio cifră în #runda și insigna ascunsă; cu rundă:
//      insigna cu numele rundei;
//   G. intrarea directă pe fiecare ancoră: fără ecran gol;
//   H. vizitatorul nu e trimis la index.html: fereastra de cont se deschide pe
//      pagină, cu revenirea în ruta de investitor reținută;
//   I. cu sesiune, clicul dat cât starea se încarcă (API întârziat 3 s) deschide
//      ruta în sub 500 ms; dublu-clicul deschide o singură fereastră;
//   J. 360, 390, 768 × 1024, 1024 × 768, 1366 px: fără derulare orizontală,
//      fără erori JS; pe telefon bara fixă nu acoperă Darrin AI, partajarea,
//      bara de jos sau sfârșitul paginii.
// Cu --capturi <dosar>: vizitator, dosar în ciornă și investitor, la 390 și 1366 px.
// Sesiunea Supabase și API-urile sunt simulate (nimic nu ajunge la Supabase).
// Rulare: node scripts/test-pagina-investitori.js [--capturi <dosar>]

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const RADACINA = path.join(__dirname, '..');
const PAGINA = 'mydarrin-investitori.html';
const ECRANE = [[360, 740], [390, 844], [768, 1024], [1024, 768], [1366, 900]];
const iCapturi = process.argv.indexOf('--capturi');
const dosarCapturi = iCapturi !== -1 ? process.argv[iCapturi + 1] : null;
const ZGOMOT = /Failed to load resource|net::ERR_|ERR_FAILED|Failed to fetch|status of 50[0-9]|status of 40[0-9]|cdn\.tailwindcss\.com/i;
const ANCORE = ['cum-functioneaza', 'runda', 'pitch-deck', 'panou', 'contact'];

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const citeste = (f) => fs.readFileSync(path.join(RADACINA, f), 'utf8');
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));

const UTILIZATOR = { id: '40000000-0000-4000-8000-0000000000c1', email: 'ana.test@example.com', email_confirmed_at: '2026-10-01T08:00:00Z', user_metadata: { prenume: 'Ana', nume: 'Test' } };
function sesiuneSimulata(cfg) {
  if (!cfg.cuSesiune) return;
  const user = cfg.user;
  const sesiune = { access_token: 'token-simulat', user };
  const lant = (rezultat) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rezultat) : () => p), apply: () => p }); return p; };
  const client = {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getSession: async () => ({ data: { session: sesiune }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: () => lant({ data: null, error: null }),
    rpc: () => lant({ data: null, error: null }),
    storage: { from: () => ({ uploadToSignedUrl: async (p) => ({ data: { path: p }, error: null }) }) },
    channel: () => lant({}), removeChannel: () => {},
  };
  const auth = new Proxy({ getCurrentUser: async () => user, getUserRoles: async () => [], performLogout: () => {} }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (nume, val) => Object.defineProperty(window, nume, { configurable: true, get: () => val, set: () => {} });
  fix('supabaseClient', client); fix('MyDarrinAuth', auth);
}

const RUNDA_TEST = { cod: 'TEST', denumire_ro: 'Runda de test', denumire_en: 'Test round', descriere_ro: null, descriere_en: null, stare: 'deschisa', data_start: null, data_sfarsit: null, moneda: 'EUR', suma_tinta: 100000, investitie_minima: null, pret_actiune: 1, equity_oferit_pct: 5, tickete: [], progres: null };
function profil(roluri) {
  return { ok: true, email: UTILIZATOR.email, nume: 'Ana Test', prenume: 'Ana', nume_familie: 'Test', telefon: '+40700000001', tara: 'RO', roles: roluri, roluri_dashboard: ['client'], destinatie: '/mydarrin-catalog.html', tip_destinatie: 'rol', partener: null, investitor: null, activare: null };
}
// Stările din tabelul pasului 11-R3h (text RO, text EN, profilul, dosarul, runda, subscrierile).
const STARI = {
  vizitator: { ro: 'Devino investitor →', en: 'Become an investor →' },
  fara_dosar: { ro: 'Începe dosarul →', en: 'Start your application →', roluri: ['client'], kyc: null },
  ciorna: { ro: 'Continuă dosarul (pasul 3) →', en: 'Continue your application (step 3) →', roluri: ['client'], kyc: { status: 'ciorna', pas_curent: 3 } },
  // Dosar respins, apoi salvat din nou: ciornă, cu rolul `investor` rămas pe cont și rundă deschisă.
  ciorna_investitor: { ro: 'Continuă dosarul (pasul 2) →', en: 'Continue your application (step 2) →', roluri: ['client', 'investor'], kyc: { status: 'ciorna', pas_curent: 2 }, runda: true },
  respins: { ro: 'Corectează dosarul →', en: 'Fix your application →', roluri: ['client', 'investor'], kyc: { status: 'respins', pas_curent: 5, motiv_respingere: 'Actul de identitate a expirat.', motiv_respingere_en: 'The ID document has expired.' }, lipsa: ['act_valabil_pana'] },
  verificare: { ro: 'Dosarul tău e în verificare', en: 'Your application is under review', roluri: ['client', 'investor'], kyc: { status: 'in_verificare', pas_curent: 5 } },
  runda: { ro: 'Intră în rundă →', en: 'Join the round →', roluri: ['client', 'investor'], kyc: { status: 'in_verificare', pas_curent: 5 }, runda: true },
  panou: { ro: 'Mergi la panoul tău →', en: 'Go to your dashboard →', roluri: ['client', 'investor'], kyc: { status: 'aprobat', pas_curent: 5 }, subscrieri: 1 },
};

function cerere(baza, cale) {
  return new Promise((ok, nu) => { http.get(baza + cale, (r) => { r.resume(); ok(r.statusCode); }).on('error', nu); });
}

async function deschide(browser, baza, cale, o) {
  o = o || {};
  const s = o.stare ? STARI[o.stare] : null;
  const cuSesiune = !!(s && s.roluri);
  const ctx = await browser.newContext({ viewport: { width: o.w || 1366, height: o.h || 900 } });
  await ctx.addInitScript((l) => {
    try { if (l) localStorage.setItem('myd_lang_v1', l); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), marketing: false, versiune: 2 })); } catch (e) {}
  }, o.limba === undefined ? 'ro' : o.limba);
  await ctx.addInitScript(sesiuneSimulata, { user: UTILIZATOR, cuSesiune });
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  await ctx.route(/ipapi\.co\//, (r) => r.abort());
  await ctx.route(/esm\.sh\//, (r) => (cuSesiune ? r.abort() : r.continue()));
  const raspunde = (r, corp) => setTimeout(() => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corp) }).catch(() => {}), o.intarziere || 0);
  if (o.contact) await ctx.route(/\/api\/public\/contact/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, contact: { investitori_email: 'investitori@example.com' } }) }));
  await ctx.route(/\/api\/public\/runda-curenta/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, runda: (s && s.runda) || o.runda ? RUNDA_TEST : null }) }));
  await ctx.route(/\/api\/cont\/profil/, (r) => (cuSesiune ? raspunde(r, profil(s.roluri)) : r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Neautentificat"}' })));
  await ctx.route(/\/api\/investitori\/kyc(\?|$)/, (r) => raspunde(r, { ok: true, kyc: s && s.kyc, lipsa: (s && s.lipsa) || ['date_personale'], cont: { prenume: 'Ana', nume: 'Test', email: UTILIZATOR.email, telefon: '+40700000001', tara: 'RO' } }));
  await ctx.route(/\/api\/investitori\/portofoliu/, (r) => raspunde(r, { ok: true, kyc_status: s && s.kyc && s.kyc.status, actiuni: 0, valoare_investita: 0, in_asteptare: 0, pct_companie: 0,
    subscrieri: s && s.subscrieri ? [{ id: 's1', status: 'in_asteptare', actiuni: 0, valoare_investita: 0, instrument: null, creat_la: null, runda: null }] : [], runda: null, exit: { buyback_disponibil: false, discount_buyback_pct: null, lock_up_luni: null } }));
  const p = await ctx.newPage();
  const erori = [];
  const navigari = [];
  p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
  p.on('console', (m) => { if (m.type() === 'error' && !ZGOMOT.test(m.text())) erori.push('console: ' + m.text().slice(0, 160)); });
  p.on('framenavigated', (f) => { if (f === p.mainFrame()) navigari.push(f.url()); });
  await p.goto(`${baza}/${cale}`, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => erori.push('goto: ' + e.message.slice(0, 100)));
  if (!o.faraAsteptare) {
    await p.waitForFunction(() => [...document.querySelectorAll('[data-cta-investitor]')].every((b) => b.getAttribute('data-cta-stare') && !['incarca', 'provizoriu'].includes(b.getAttribute('data-cta-stare'))), null, { timeout: 15000 }).catch(() => erori.push('butoanele nu și-au primit starea'));
  }
  return { ctx, p, erori, navigari };
}

const butoane = (p) => p.evaluate(() => [...document.querySelectorAll('[data-cta-investitor]')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
const parcurs = (p) => p.evaluate(() => [...document.querySelectorAll('[data-inv-segment]')].map((li) => {
  const c = li.className.match(/inv-seg-(facut|curent|respins)/);
  const st = li.querySelector('[data-inv-seg-stare]');
  return (c ? c[1] : '-') + (li.classList.contains('inv-seg-aici') ? '*' : '') + (st && !st.hidden ? ':' + st.textContent : '');
}));

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    // ── A. Static ──
    {
      const html = fs.readdirSync(RADACINA).filter((f) => f.endsWith('.html'));
      // mydarrin-pitch-deck.html e vizualizatorul deck-ului: antetul lui are doar „← Investitori” (întoarcerea), nu meniul site-ului.
      const cuAntet = html.filter((f) => f !== 'mydarrin-pitch-deck.html').filter((f) => (citeste(f).match(/<header[\s\S]*?<\/header>/g) || []).some((h) => /Investitori|mydarrin-investitori/.test(h)));
      verifica(!cuAntet.length, `antete cu „Investitori”: ${cuAntet.join(', ')}`);
      const toate = html.concat(fs.readdirSync(RADACINA).filter((f) => f.endsWith('.js')));
      for (const [re, nume] of [[/investor-modal/, 'investor-modal'], [/submitInvestorForm/, 'submitInvestorForm'], [/openInvestorModal|closeInvestorModal/, 'openInvestorModal / closeInvestorModal'], [/Solicitare primită/, '„Solicitare primită”']]) {
        const cu = toate.filter((f) => re.test(citeste(f)));
        verifica(!cu.length, `${nume} încă apare în: ${cu.join(', ')}`);
      }
      const copii = html.filter((f) => /id="sb-inv"|toggleSbSection\('sb-inv'\)|href="mydarrin-investitori\.html#kpis"/.test(citeste(f)));
      verifica(!copii.length, `copii ale meniului „Investitori” în: ${copii.join(', ')}`);
      const cuLoc = html.filter((f) => /data-meniu-investitori=/.test(citeste(f)));
      const faraScript = cuLoc.filter((f) => !/src="\/?meniu-investitori\.js"/.test(citeste(f)));
      verifica(!faraScript.length, `pagini cu meniul fără meniu-investitori.js: ${faraScript.join(', ')}`);
      const inv = citeste(PAGINA);
      // Panoul privat (#inv-private-dashboard) rămâne neschimbat ca logică și conținut (pasul 11-I1 îl mută pe pagină proprie).
      const faraPanou = inv.replace(/<!--[\s\S]*?-->/g, '').replace(/<div id="inv-private-dashboard"[\s\S]*?id="agenda-cont-sectiune"/, '');
      verifica(!/class="inv-nav"|Investor Relations|Seed/.test(faraPanou), 'pagina Investitori: antetul propriu sau „Seed” au rămas');
      verifica((inv.match(/data-myd-copyright/g) || []).length === 1 && !/href="mydarrin-app-mobile\.html"[^>]*border-radius:99px/.test(inv), 'pagina Investitori: mini-footer-ul a rămas');
      verifica((inv.match(/<footer/g) || []).length === 1 && /<header id="hdr"/.test(inv), 'pagina Investitori: antetul standard sau footer-ul unic lipsesc');
      verifica(/id="pitch-deck"[\s\S]*id="pitch-deck-section"[\s\S]*id="panou"[\s\S]*id="inv-private-dashboard"[\s\S]*id="contact"/.test(inv), 'pagina Investitori: ordinea secțiunilor');
      verifica(/id="cum-functioneaza"[\s\S]*id="runda"[\s\S]*id="pitch-deck"/.test(inv), 'pagina Investitori: #cum-functioneaza, #runda, #pitch-deck');
      // Logica modulului e neschimbată (fișierele nu sunt atinse de acest pas).
      for (const f of ['investitori-ruta.js', 'api/public/runda-curenta.js', 'api/public/pitch-deck.js', 'lib/permisiuni-investitori.js']) verifica(fs.existsSync(path.join(RADACINA, f)), `${f} lipsește`);
    }

    // ── B. Meniul vertical și footer-ul ──
    const ASTEPTAT = ['Cum devii investitor', 'Runda curentă', 'Pitch deck', 'Panoul meu', 'Contact investitori'].map((t, i) => [t, t === 'Panoul meu' ? 'mydarrin-panou-investitor.html' : `${PAGINA}#${ANCORE[i]}`]);
    {
      const linkuri = new Set();
      for (const [pg, stare] of [['index.html', null], ['despre-noi.html', null], ['cum-comanzi.html', null], [PAGINA, null], ['index.html', 'panou']]) {
        const et = `${pg}${stare ? ' (investitor)' : ''}`;
        const { ctx, p, erori } = await deschide(browser, baza, pg, { stare, faraAsteptare: pg !== PAGINA });
        await p.evaluate(() => (typeof window.openSidebar === 'function' ? window.openSidebar() : (document.querySelector('[onclick*="openSidebar"]') || {}).click && document.querySelector('[onclick*="openSidebar"]').click()));
        await p.waitForFunction(() => document.querySelector('#sidebar [data-meniu-investitori][data-meniu-gata]'), null, { timeout: 10000 }).catch(() => {});
        await p.click('#sidebar [data-mmi-cap]').catch(() => {});
        await asteapta(stare ? 1500 : 400);
        const m = await p.evaluate(() => {
          const viz = (a) => !a.hidden && !(a.closest('li') && a.closest('li').hidden);
          const lat = [...document.querySelectorAll('#sidebar [data-meniu-investitori] a')].filter(viz).map((a) => [a.textContent.trim(), a.getAttribute('href')]);
          const ft = [...document.querySelectorAll('footer [data-meniu-investitori] a')].filter(viz).map((a) => [a.textContent.trim(), a.getAttribute('href')]);
          const titlu = (document.querySelector('footer [data-meniu-investitori] .ftr-nh') || {}).textContent;
          return { lat, ft, titlu, deschis: (document.querySelector('#sidebar [data-mmi-cap]') || {}).getAttribute && document.querySelector('#sidebar [data-mmi-cap]').getAttribute('aria-expanded') };
        });
        const asteptat = stare ? ASTEPTAT : ASTEPTAT.filter((x) => !/Panoul/.test(x[0]));
        verifica(JSON.stringify(m.lat) === JSON.stringify(asteptat), `${et}: meniul vertical ${JSON.stringify(m.lat)}`);
        verifica(m.deschis === 'true', `${et}: „Investitori” din meniul vertical nu se deschide`);
        verifica(m.titlu === 'Investitori' && JSON.stringify(m.ft) === JSON.stringify(asteptat), `${et}: footer-ul ${m.titlu} ${JSON.stringify(m.ft)}`);
        m.lat.concat(m.ft).forEach(([, h]) => linkuri.add(h.split('#')[0]));
        verifica(!erori.length, `${et}: ${erori.join(' | ')}`);
        await ctx.close();
      }
      for (const l of linkuri) verifica(await cerere(baza, '/' + l) === 200, `linkul ${l} nu răspunde 200`);
      const inv = citeste(PAGINA);
      for (const a of ANCORE) verifica(new RegExp(`id="${a}"`).test(inv), `ancora #${a} lipsește`);
    }

    // ── C. Ancorele vechi ──
    for (const [hash, stare, tinta] of [['ghid-investitor', null, 'cum-functioneaza'], ['kpis', null, 'cum-functioneaza'], ['panou', null, 'cum-functioneaza']]) {
      const et = `#${hash}${stare ? ' (investitor)' : ''}`;
      const { ctx, p, erori } = await deschide(browser, baza, `${PAGINA}#${hash}`, { stare });
      await asteapta(900);
      const r = await p.evaluate(() => {
        const h = location.hash.slice(1);
        const s = document.getElementById(h);
        return { h, sus: s ? Math.round(s.getBoundingClientRect().top) : null, vh: innerHeight };
      });
      verifica(r.h === tinta && r.sus !== null && r.sus >= -2 && r.sus < r.vh / 2, `${et}: ajunge la #${r.h} (sus ${r.sus}), aștept #${tinta}`);
      verifica(!erori.length, `${et}: ${erori.join(' | ')}`);
      await ctx.close();
    }

    // Pasul 11-I1: pentru investitor, #kpis și #panou duc la panoul de pe pagina proprie.
    for (const hash of ['kpis', 'panou']) {
      const { ctx, p, erori } = await deschide(browser, baza, `${PAGINA}#${hash}`, { stare: 'panou', faraAsteptare: true });
      await p.waitForURL(/mydarrin-panou-investitor/, { timeout: 15000 }).catch(() => {});
      verifica(/mydarrin-panou-investitor/.test(p.url()), `#${hash} (investitor): ${p.url()}`);
      verifica(!erori.length, `#${hash} (investitor): ${erori.join(' | ')}`);
      await ctx.close();
    }

    // ── D. Hero-ul comun ──
    for (const w of [390, 1366]) {
      const masoara = async (pg, opt) => {
        const { ctx, p } = await deschide(browser, baza, pg, Object.assign({ w, faraAsteptare: pg !== PAGINA }, opt || {}));
        const r = await p.evaluate(() => { const h = document.querySelector('.rp-hero h1'); const c = getComputedStyle(h); return { font: c.fontFamily, marime: c.fontSize, greutate: c.fontWeight, aliniere: c.textAlign, text: h.textContent.trim(), spatiere: c.letterSpacing }; });
        await ctx.close();
        return r;
      };
      const inv = await masoara(PAGINA);
      const hub = await masoara('cum-devii-partenerul-nostru.html');
      const tip = await masoara('cum-devii-furnizor-materiale.html');
      for (const [nume, ref] of [['hub', hub], ['materiale', tip]]) {
        verifica(inv.font === ref.font && inv.marime === ref.marime && inv.greutate === ref.greutate && inv.aliniere === ref.aliniere,
          `${w}px: hero-ul diferă de ${nume}: ${JSON.stringify(inv)} / ${JSON.stringify(ref)}`);
      }
      verifica(inv.text === 'Investește în My Darrin' && inv.greutate === '700', `${w}px: titlul hero „${inv.text}” (${inv.greutate})`);
      const en = await masoara(PAGINA, { limba: null });
      verifica(en.text === 'Invest in My Darrin', `${w}px EN: titlul hero „${en.text}”`);
    }

    // ── E. Butonul principal în toate stările ──
    for (const [stare, s] of Object.entries(STARI)) {
      for (const limba of ['ro', null]) {
        const et = `starea ${stare} ${limba || 'en'}`;
        const { ctx, p, erori } = await deschide(browser, baza, PAGINA, { stare: s.roluri ? stare : null, limba });
        const b = await butoane(p);
        verifica(b.length === 3 && b.every((t) => t === (limba ? s.ro : s.en)), `${et}: butoanele ${JSON.stringify(b)} (aștept „${limba ? s.ro : s.en}”)`);
        if (limba) {
          const nota = await p.evaluate(() => [...document.querySelectorAll('[data-cta-nota]')].filter((n) => !n.hidden).map((n) => n.textContent));
          if (stare === 'respins') verifica(nota.length && nota.every((n) => /Actul de identitate a expirat\./.test(n)), `${et}: motivul sub buton ${JSON.stringify(nota)}`);
          else if (stare === 'runda') verifica(nota.length && nota.every((n) => n === 'Subscrierea se aprobă după verificarea identității.'), `${et}: nota de sub buton ${JSON.stringify(nota)}`);
          else verifica(!nota.length, `${et}: notă neașteptată ${JSON.stringify(nota)}`);
          const seg = await parcurs(p);
          const asteptat = {
            vizitator: ['-', '-', '-', '-', '-', '-', '-'],
            fara_dosar: ['curent*:aici ai rămas', '-', '-', '-', '-', '-', '-'],
            ciorna: ['facut', 'facut', 'curent*:aici ai rămas', '-', '-', '-', '-'],
            ciorna_investitor: ['facut', 'curent*:aici ai rămas', '-', '-', '-', '-', '-'],
            respins: ['facut', 'facut', 'facut', 'facut', 'facut', 'respins*:respinsă · aici ai rămas', '-'],
            verificare: ['facut', 'facut', 'facut', 'facut', 'facut', 'curent*:în curs · aici ai rămas', '-'],
            runda: ['facut', 'facut', 'facut', 'facut', 'facut', 'curent*:în curs · aici ai rămas', '-'],
            panou: ['facut', 'facut', 'facut', 'facut', 'facut', 'facut:aprobată', 'facut'],
          }[stare];
          verifica(JSON.stringify(seg) === JSON.stringify(asteptat), `${et}: parcursul ${JSON.stringify(seg)}`);
          const panou = await p.evaluate(() => ({ sectiune: !document.getElementById('panou').hidden, meniu: !document.querySelector('.inv-sectiuni a[href="#panou"]').hidden }));
          const investitor = (s.roluri || []).includes('investor');
          verifica(panou.sectiune === investitor && panou.meniu === investitor, `${et}: #panou / „Panoul meu” ${JSON.stringify(panou)}`);
          // Acțiunea butonului din hero
          const inainte = p.url();
          await p.click('#hero-intra-runda');
          await asteapta(900);
          const a = await p.evaluate(() => ({
            ruta: !!document.getElementById('mi-fer') && document.getElementById('mi-fer').offsetParent !== null,
            subtitlu: (document.getElementById('mi-subtitlu') || {}).textContent || '',
            runda: (document.getElementById('modal-runda') || {}).style && document.getElementById('modal-runda').style.display === 'block',
            cont: !!document.getElementById('auth-modal') && !document.getElementById('auth-modal').classList.contains('hidden'),
            hash: location.hash, revenire: sessionStorage.getItem('myd_revenire_dupa_login'),
          }));
          const actiune = {
            vizitator: a.cont && a.revenire === '/mydarrin-investitori.html?ruta=investitor' && p.url() === inainte,
            fara_dosar: a.ruta && /Pasul 1 din 5/.test(a.subtitlu),
            ciorna: a.ruta && /Pasul 3 din 5/.test(a.subtitlu),
            ciorna_investitor: a.ruta && /Pasul 2 din 5/.test(a.subtitlu) && !a.runda,
            respins: a.ruta && /Pasul 2 din 5/.test(a.subtitlu),
            verificare: a.hash === '#panou' && !a.ruta && !a.runda,
            runda: a.runda,
            panou: /mydarrin-panou-investitor/.test(p.url()) && !a.ruta && !a.runda,
          }[stare];
          verifica(actiune, `${et}: acțiunea butonului ${JSON.stringify(a)}`);
        }
        verifica(!erori.length, `${et}: ${erori.join(' | ')}`);
        if (dosarCapturi && limba && ['vizitator', 'ciorna', 'panou'].includes(stare)) {
          for (const [w, h] of [[390, 844], [1366, 900]]) {
            const c = await deschide(browser, baza, PAGINA, { stare: s.roluri ? stare : null, w, h });
            fs.mkdirSync(dosarCapturi, { recursive: true });
            const nume = { vizitator: 'vizitator', ciorna: 'dosar-ciorna', panou: 'investitor' }[stare];
            if (w === 1366) await c.p.screenshot({ path: path.join(dosarCapturi, `investitori-${nume}-${w}.png`), fullPage: true });
            else {
              await c.p.screenshot({ path: path.join(dosarCapturi, `investitori-${nume}-${w}-sus.png`) });
              await c.p.evaluate(() => document.getElementById('cum-functioneaza').scrollIntoView({ behavior: 'instant' }));
              await asteapta(500);
              await c.p.screenshot({ path: path.join(dosarCapturi, `investitori-${nume}-${w}-mijloc.png`) });
            }
            await c.ctx.close();
          }
        }
        await ctx.close();
      }
    }

    // ── F. Runda ──
    {
      let { ctx, p } = await deschide(browser, baza, PAGINA);
      let r = await p.evaluate(() => ({ text: document.getElementById('runda').innerText, insigna: getComputedStyle(document.getElementById('inv-insigna-runda')).display }));
      verifica(!/\d/.test(r.text), `fără rundă: cifre în #runda: „${r.text}”`);
      verifica(r.insigna === 'none', 'fără rundă: insigna e vizibilă');
      // Emailul din back-office: fără răspuns de la /api/public/contact, fără buton gol în banda de contact.
      verifica(await p.evaluate(() => getComputedStyle(document.querySelector('#contact [data-contact-rand]')).display === 'none'), 'fără emailul de contact: butonul gol e vizibil');
      await ctx.close();
      ({ ctx, p } = await deschide(browser, baza, PAGINA, { runda: true, contact: true }));
      await asteapta(500);
      const email = await p.evaluate(() => { const a = document.querySelector('#contact [data-contact-rand]'); return { viz: getComputedStyle(a).display !== 'none', href: a.getAttribute('href'), text: a.textContent.trim() }; });
      verifica(email.viz && email.href === 'mailto:investitori@example.com' && email.text === 'investitori@example.com', `emailul de contact: ${JSON.stringify(email)}`);
      r = await p.evaluate(() => ({ insigna: document.getElementById('inv-insigna-runda').textContent.replace(/\s+/g, ' ').trim(), viz: getComputedStyle(document.getElementById('inv-insigna-runda')).display, card: !document.querySelector('[data-runda]').hidden }));
      verifica(r.viz !== 'none' && r.insigna === 'Runda curentă: Runda de test' && r.card, `cu rundă: insigna ${JSON.stringify(r)}`);
      await ctx.close();
    }

    // ── G. Intrarea directă pe ancore: fără ecran gol ──
    for (const w of [390, 1366]) {
      for (const a of ['hero', 'cum-functioneaza', 'runda', 'pitch-deck', 'contact', 'ghid-investitor', 'kpis']) {
        const et = `#${a} ${w}px`;
        const { ctx, p, erori } = await deschide(browser, baza, `${PAGINA}#${a}`, { w, h: w === 390 ? 844 : 900 });
        await asteapta(700);
        const r = await p.evaluate(() => {
          const vh = innerHeight;
          const ascunse = [...document.querySelectorAll('.reveal')].filter((el) => { const b = el.getBoundingClientRect(); return b.bottom > 0 && b.top < vh && parseFloat(getComputedStyle(el).opacity) < 0.5; }).length;
          const text = [...document.querySelectorAll('h1,h2,h3,p,a,button')].filter((el) => { const b = el.getBoundingClientRect(); return b.height && b.bottom > 60 && b.top < vh && el.textContent.trim() && parseFloat(getComputedStyle(el).opacity) > 0.5 && getComputedStyle(el).visibility !== 'hidden'; }).length;
          return { ascunse, text };
        });
        verifica(!r.ascunse && r.text >= 3, `${et}: ecran gol (${r.ascunse} ascunse, ${r.text} texte vizibile)`);
        verifica(!erori.length, `${et}: ${erori.join(' | ')}`);
        await ctx.close();
      }
    }

    // ── H. Vizitatorul nu pleacă la index.html (și cu clicul dat devreme) ──
    {
      const { ctx, p, navigari } = await deschide(browser, baza, PAGINA, { faraAsteptare: true });
      await p.click('#hero-intra-runda');
      await asteapta(5000);
      const r = await p.evaluate(() => ({ cont: !!document.getElementById('auth-modal') && !document.getElementById('auth-modal').classList.contains('hidden'), url: location.pathname }));
      verifica(r.url === '/mydarrin-investitori.html' && !navigari.some((u) => /index\.html/.test(u)) && r.cont, `vizitator (clic devreme): ${JSON.stringify(r)} ${navigari.join(' ')}`);
      await ctx.close();
    }

    // ── I. Cu sesiune: deschiderea rapidă și dublu-clicul ──
    {
      const { ctx, p, erori } = await deschide(browser, baza, PAGINA, { stare: 'ciorna', intarziere: 3000, faraAsteptare: true });
      await p.waitForFunction(() => !!window.MYD_INVESTITOR && document.getElementById('hero-intra-runda').getAttribute('data-cta-stare') === 'provizoriu', null, { timeout: 8000 }).catch(() => {});
      const t = await p.evaluate(() => new Promise((ok) => {
        const b = document.getElementById('hero-intra-runda');
        const t0 = performance.now();
        b.click(); b.click();
        (function v() {
          const f = document.getElementById('mi-fer');
          if (f && f.offsetParent !== null) return ok({ ms: Math.round(performance.now() - t0), n: document.querySelectorAll('#mi-fer').length });
          if (performance.now() - t0 > 6000) return ok({ ms: 99999, n: 0 });
          requestAnimationFrame(v);
        })();
      }));
      verifica(t.ms < 500 && t.n === 1, `cu sesiune, API întârziat: fereastra în ${t.ms} ms, ${t.n} ferestre`);
      verifica(!erori.length, `deschiderea rapidă: ${erori.join(' | ')}`);
      await ctx.close();
    }

    // ── J. Ecrane ──
    for (const [w, h] of ECRANE) {
      for (const stare of [null, 'panou']) {
        const et = `${w}px${stare ? ' investitor' : ''}`;
        const { ctx, p, erori } = await deschide(browser, baza, PAGINA, { w, h, stare });
        const lat = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        verifica(lat <= 0, `${et}: derulare orizontală ${lat}px`);
        const nav = await p.evaluate(() => { const n = document.querySelector('.inv-sectiuni'); const r = n.getBoundingClientRect(); return { stanga: r.left, dreapta: r.right, vw: document.documentElement.clientWidth }; });
        verifica(nav.stanga >= 0 && nav.dreapta <= nav.vw + 0.5, `${et}: meniul de secțiuni iese din ecran`);
        await p.evaluate(() => document.getElementById('runda').scrollIntoView({ behavior: 'instant' }));
        await asteapta(450);
        const s = await p.evaluate(() => {
          const n = document.querySelector('.inv-sectiuni').getBoundingClientRect();
          const hdr = document.getElementById('hdr').getBoundingClientRect();
          const act = document.querySelector('.inv-sectiuni a.activ');
          return { sus: Math.round(n.top), hdr: Math.round(hdr.bottom), activ: act && act.getAttribute('href') };
        });
        verifica(Math.abs(s.sus - Math.max(0, s.hdr)) <= 2 && s.activ === '#runda', `${et}: meniul de secțiuni nu e fix sub antet sau nu marchează #runda ${JSON.stringify(s)}`);
        if (w <= 768) {
          await p.evaluate(() => document.getElementById('cum-functioneaza').scrollIntoView({ behavior: 'instant' }));
          await asteapta(450);
          const r = await p.evaluate(() => {
            const bara = document.querySelector('[data-rp-fix]');
            const rb = bara.querySelector('.rp-btn').getBoundingClientRect();
            const vizibil = bara.classList.contains('rp-vizibil') && rb.bottom <= innerHeight && rb.top >= 0;
            const peste = (el) => { if (!el) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const q = el.getBoundingClientRect(); return q.width > 0 && !(q.right <= rb.left || q.left >= rb.right || q.bottom <= rb.top || q.top >= rb.bottom); };
            return { vizibil, text: bara.textContent.replace(/\s+/g, ' ').trim(), peste: ['dai-fab', 'mobile-bottom-nav', 'myd-share-fab'].filter((id) => peste(document.getElementById(id))) };
          });
          verifica(r.vizibil, `${et}: bara fixă nu apare la derulare`);
          verifica(!r.peste.length, `${et}: bara fixă acoperă ${r.peste.join(', ')}`);
          await p.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
          await asteapta(450);
          const jos = await p.evaluate(() => ({ vizibil: document.querySelector('[data-rp-fix]').classList.contains('rp-vizibil'), footer: document.querySelector('footer').getBoundingClientRect().bottom, bara: document.querySelector('[data-rp-fix] .rp-btn').getBoundingClientRect().top }));
          verifica(!jos.vizibil || jos.footer <= jos.bara + 1, `${et}: bara fixă acoperă sfârșitul paginii`);
        } else {
          verifica(await p.evaluate(() => getComputedStyle(document.querySelector('[data-rp-fix]')).display === 'none'), `${et}: bara fixă apare pe ecran mare`);
        }
        verifica(!erori.length, `${et}: ${erori.join(' | ')}`);
        await ctx.close();
      }
      console.log(`${w}px: gata`);
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} verificări trecute, ${esec} eșuate`);
  process.exit(esec ? 1 : 0);
})();
