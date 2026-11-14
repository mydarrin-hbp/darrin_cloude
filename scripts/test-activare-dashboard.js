// scripts/test-activare-dashboard.js
// Pasul 11-R3 și corecția lui (decizia LM, 2 nov. 2026): după cod, partenerul
// ajunge în dashboard-ul rolului ales și activează contul pe pași
// (activare-pasi.js), pe o pagină albă, cu salvare automată.
// Chromium (Playwright), cu Supabase simulat în pagină (sesiune) și API-urile
// pașilor simulate pe rută, cu stare (firma, contul bancar, ciorna):
//   - servicii (mydarrin-dashboard-partener) și materiale (mydarrin-dashboard-furnizor):
//     pasul 1 → „Continuă” cu date lipsă nu trece și arată erorile sub câmp →
//     „Caută la ANAF” completează firma → „Continuă” salvează firma (rolul se
//     acordă) → pasul 2 → ciorna se salvează automat → „Înapoi” (datele rămân) →
//     „Continuă” → reîncărcare → reluarea la pasul 2, cu ciorna;
//     pe pasul 2, un IBAN greșit nu trece mai departe;
//   - modul activare: panourile dashboard-ului nu apar, explicația da;
//   - antetul: logo, nume, tip, „Înapoi la site” și „Deconectare” (pasul 11-R3e;
//     pe telefon „Înapoi la site” și meniul mic); meniul
//     dashboard-ului (☰) nu se suprapune peste antet;
//   - fără tabelul ciornei (503): fluxul merge, fără salvare automată;
//   - paza: un cont fără rol de partener ales nu intră în activare;
//   - în engleză, fluxul e în engleză;
//   - la 360, 390, 430, 768 × 1024, 1024 × 768, 1366 și 1920 px: conținutul de
//     cel mult ~640 px, fără derulare orizontală, butoane de cel puțin 44 px;
//   - fără erori JS.
// Cu --capturi <dosar>: pasul 1 și pasul 3 (servicii, materiale) la 390, 768, 1024 și 1366 px.
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
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));
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
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  };
  Object.defineProperty(window, 'supabaseClient', { configurable: true, get() { return fals; }, set() {} });
}

const PASI = ['firma', 'cont_bancar', 'profesii', 'dotari', 'documente', 'contract'];

// Serverul simulat, cu stare. Starea se păstrează între reîncărcări (aceeași instanță).
function serverSimulat(rol, tip, opt) {
  const o = opt || {};
  const s = { firma: o.firma || null, cont: false, nace: !!o.nace, ciorna: o.ciorna || null, puturi: [], postari: [], faraCiorna: !!o.faraCiorna, clientSimplu: !!o.clientSimplu };
  function profil() {
    const areFirma = !!s.firma;
    const stari = [
      areFirma ? 'in_verificare' : 'de_completat',
      areFirma ? (s.cont ? 'completat' : 'de_completat') : 'blocat',
      areFirma ? (s.nace ? 'completat' : 'de_completat') : 'blocat',
      areFirma ? 'de_completat' : 'blocat',
      areFirma ? 'de_completat' : 'blocat',
      areFirma ? 'dupa_verificare' : 'blocat',
    ];
    if (s.clientSimplu) {
      return { ok: true, email: 'ana@example.com', nume: 'Ana Popescu', tara: 'RO', roles: ['client'], roluri_dashboard: [], destinatie: '/mydarrin-catalog.html', tip_destinatie: 'client_fara_comenzi', are_comenzi: false, rol_solicitat: 'client', partener: null, investitor: null, activare: null };
    }
    return {
      ok: true, email: 'firma@example.com', nume: 'Ana Popescu', prenume: 'Ana', nume_familie: 'Popescu', telefon: '+40712345678', tara: 'RO',
      roles: areFirma ? ['client', rol] : ['client'], roluri_dashboard: areFirma ? [rol] : [],
      destinatie: '/mydarrin-dashboard-' + (tip === 'materiale' ? 'furnizor' : 'partener') + '.html?type=' + tip,
      tip_destinatie: areFirma ? 'rol' : 'activare_partener', are_comenzi: false, rol_solicitat: rol, furnizor_propriu: false,
      partener: areFirma ? { nume_firma: s.firma.nume_firma, partner_type: tip === 'materiale' ? 'furnizor_materiale' : 'servicii_tehnice', rol, status_verificare: 'pending_review', contract_semnat: false, cont_bancar: s.cont, poate_vinde: false, motiv_nu_poate_vinde: 'in_verificare' } : null,
      investitor: null,
      activare: { rol, tip, mod_activare: !areFirma, verificare: areFirma ? 'pending_review' : null, activ: false, complet: false, pasi: PASI.map((cheie, i) => ({ cheie, stare: stari[i] })) },
    };
  }
  async function trateaza(route) {
    const req = route.request();
    const u = new URL(req.url());
    const m = req.method();
    const corp = () => { try { return JSON.parse(req.postData() || '{}'); } catch (e) { return {}; } };
    const json = (cod, b) => route.fulfill({ status: cod, contentType: 'application/json', body: JSON.stringify(b) });
    switch (u.pathname) {
      case '/api/cont/profil': return json(200, profil());
      case '/api/partener/activare-ciorna':
        if (s.faraCiorna) return json(503, { ok: false, cod: 'CIORNA_INDISPONIBILA', mesaj: { ro: 'x', en: 'x' } });
        if (m === 'GET') return json(200, { ok: true, ciorna: s.ciorna });
        if (m === 'PUT') { const b = corp(); s.puturi.push(b); s.ciorna = { ...b, actualizat_la: new Date().toISOString() }; return json(200, { ok: true, actualizat_la: s.ciorna.actualizat_la }); }
        s.ciorna = null; return json(200, { ok: true });
      case '/api/partener/wizard-companie':
        if (m === 'GET') return json(200, { ok: true, partner: s.firma, conturi: [] });
        { const b = corp(); s.postari.push(['firma', b]); if (!b.cui || !b.tip_entitate_legala || !b.nume_firma) return json(400, { ok: false, cod: 'DATE', mesaj: { ro: 'Date lipsă.', en: 'Missing data.' }, campuri: [] }); s.firma = b; return json(200, { ok: true }); }
      case '/api/public/geo-regiuni': return json(200, { ok: true, regiuni: [{ cod: 'BC', denumire: 'Bacău' }, { cod: 'B', denumire: 'București' }] });
      case '/api/public/cui-lookup': return json(200, { ok: true, cui: '46577229', denumire: 'FIRMA SIMULATA SRL', nr_reg_com: 'J04/1234/2022', adresa: 'Str. Nordului nr. 3, Bacău' });
      case '/api/partener/conturi-bancare':
        if (m === 'GET') return json(200, { ok: true, conturi: s.cont ? [{ id: 'c1', iban_mascat: 'RO49••••0000', banca: 'Banca X' }] : [] });
        s.postari.push(['cont', corp()]); s.cont = true; return json(200, { ok: true });
      case '/api/public/nace-lista': return json(200, { ok: true, clase: [{ cod: '43.22', denumire: 'Lucrări de instalații sanitare' }, { cod: '47.52', denumire: 'Comerț cu amănuntul de materiale de construcții' }, { cod: '77.32', denumire: 'Închirierea utilajelor de construcții' }] });
      case '/api/partener/wizard-nace':
        if (m === 'GET') return json(200, { ok: true, coduri: s.nace ? [{ cod_nace: '43.22', principal: true }] : [] });
        s.nace = true; return json(200, { ok: true });
      default: return route.fallback();
    }
  }
  return { s, trateaza };
}

async function deschide(browser, baza, pagina, srv, latime, inaltime, limba) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: inaltime } });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), marketing: false, versiune: 2 }));
      if (l) localStorage.setItem('myd_lang_v1', l);
    } catch (e) {}
  }, limba);
  await ctx.addInitScript(supabaseConectat);
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  await ctx.route(/ipapi\.co\//, (r) => r.abort());
  await ctx.route(/\/api\//, srv.trateaza);
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
  await p.waitForSelector('#myd-activare-pagina #mya-continua', { timeout: 8000 }).catch(() => {});
  return { ctx, p, erori, navigari };
}
const pasul = (p) => p.evaluate(() => { const t = (document.querySelector('#myd-activare-pagina .mya-nr .mya-lung') || {}).textContent || ''; const m = t.match(/(\d)\D+6/); return m ? Number(m[1]) : null; });
const asteaptaPasul = (p, n) => p.waitForFunction((x) => { const t = (document.querySelector('#myd-activare-pagina .mya-nr .mya-lung') || {}).textContent || ''; return new RegExp('^\\D*' + x + '\\D').test(t); }, n, { timeout: 8000 }).catch(() => {});
const invalid = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getAttribute('aria-invalid') === 'true'; }, sel);

(async () => {
  const srvHttp = await porneste(0);
  const baza = 'http://localhost:' + srvHttp.address().port;
  const browser = await chromium.launch();
  const CAZURI = [
    ['servicii', 'partener_servicii', 'mydarrin-dashboard-partener.html?type=servicii', 'dp-content', 'dp-nav'],
    ['materiale', 'partener_materiale', 'mydarrin-dashboard-furnizor.html?type=materiale', 'fb-content', 'fb-nav'],
  ];
  try {
    for (const [tip, rol, pagina, continut, nav] of CAZURI) {
      const et = `${tip}: fluxul pe pași`;
      const srv = serverSimulat(rol, tip);
      let { ctx, p, erori } = await deschide(browser, baza, pagina, srv, 1366, 900, 'ro');
      verifica(await p.$('#myd-activare-pagina'), `${et}: pagina de activare nu apare`);
      verifica(await pasul(p) === 1, `${et}: nu începe la pasul 1 (${await pasul(p)})`);
      const a = await p.evaluate(([c, n]) => {
        const vizibil = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; };
        const pag = document.getElementById('myd-activare-pagina');
        return {
          logo: !!pag.querySelector('img.mya-logo[src*="logo-mydarrin-homebestpal"]'), iesi: !!pag.querySelector('#mya-site') && !!pag.querySelector('#mya-deconectare'),
          tip: (pag.querySelector('.mya-cont-txt') || {}).textContent || '', fundal: getComputedStyle(pag).backgroundColor,
          continut: vizibil(c), nav: vizibil(n), blocat: !!document.getElementById('myd-blocat'), inapoi: !!document.getElementById('mya-inapoi'),
          lista: document.querySelectorAll('.mya-pasi li').length,
        };
      }, [continut, nav]);
      verifica(a.logo && a.iesi && /Ana Popescu|Furnizor/.test(a.tip), `${et}: antetul nu are logo / nume și tip / „Înapoi la site” și „Deconectare”: ${JSON.stringify(a)}`);
      verifica(a.fundal === 'rgb(255, 255, 255)', `${et}: fundalul nu e alb (${a.fundal})`);
      verifica(!a.continut && !a.nav && a.blocat, `${et}: panourile dashboard-ului se văd în modul activare`);
      verifica(!a.inapoi, `${et}: „Înapoi” apare pe pasul 1`);
      verifica(a.lista === 6, `${et}: bara are ${a.lista} pași`);

      // Validarea: „Continuă” fără date nu trece mai departe.
      await p.click('#mya-continua');
      await asteapta(400);
      verifica(await pasul(p) === 1 && await invalid(p, '#mya-cui') && await invalid(p, '#mya-forma'), `${et}: „Continuă” fără date a trecut sau n-a marcat câmpurile`);
      verifica(!srv.s.postari.some((x) => x[0] === 'firma'), `${et}: firma s-a trimis fără date`);

      // Firma: ANAF completează, „Continuă” salvează și trece la pasul 2.
      await p.selectOption('#mya-forma', 'srl');
      await p.fill('#mya-cui', 'RO46577229');
      await p.click('#mya-anaf');
      await p.waitForFunction(() => document.getElementById('mya-firma').value === 'FIRMA SIMULATA SRL', null, { timeout: 5000 }).catch(() => {});
      verifica(await p.inputValue('#mya-reg') === 'J04/1234/2022', `${et}: ANAF nu a completat nr. Reg. Com.`);
      await p.selectOption('#mya-judet', 'BC');
      await p.click('#mya-continua');
      await asteaptaPasul(p, 2);
      verifica(await pasul(p) === 2, `${et}: după firmă nu a trecut la pasul 2 (${await pasul(p)})`);
      const trimis = (srv.s.postari.find((x) => x[0] === 'firma') || [])[1] || {};
      verifica(trimis.partner_type === tip && trimis.cui === 'RO46577229' && trimis.regiune_cod === 'BC', `${et}: firma trimisă: ${JSON.stringify(trimis)}`);

      // Pasul 2: IBAN greșit nu trece.
      await p.fill('#mya-titular', 'FIRMA SIMULATA SRL');
      await p.fill('#mya-iban', 'RO12');
      await p.fill('#mya-banca', 'Banca Transilvania');
      await p.click('#mya-continua');
      await asteapta(400);
      verifica(await pasul(p) === 2 && await invalid(p, '#mya-iban'), `${et}: IBAN-ul greșit a trecut sau nu e marcat`);
      verifica(!srv.s.cont, `${et}: contul bancar s-a salvat cu IBAN greșit`);

      // Salvarea automată a ciornei (fără IBAN).
      await p.fill('#mya-banca', 'Banca Transilvania SA');
      await p.locator('#mya-banca').blur();
      for (let i = 0; i < 60 && !srv.s.puturi.some((x) => x.date && x.date.cont_bancar && x.date.cont_bancar.banca === 'Banca Transilvania SA'); i++) await asteapta(100);
      await asteapta(200);
      const ultim = srv.s.puturi[srv.s.puturi.length - 1] || {};
      verifica(ultim.pas_curent === 2 && ultim.date && ultim.date.cont_bancar && ultim.date.cont_bancar.banca === 'Banca Transilvania SA', `${et}: ciorna nu s-a salvat automat: ${JSON.stringify(ultim)}`);
      verifica(!JSON.stringify(srv.s.puturi).includes('RO12'), `${et}: IBAN-ul a ajuns în ciornă`);
      verifica(/\d{2}:\d{2}/.test(await p.textContent('#mya-auto')), `${et}: „Salvat automat” cu ora nu apare`);

      // „Înapoi” nu pierde nimic; „Continuă” revine la pasul 2.
      await p.click('#mya-inapoi');
      await asteaptaPasul(p, 1);
      await p.waitForFunction(() => document.getElementById('mya-firma') && document.getElementById('mya-firma').value === 'FIRMA SIMULATA SRL', null, { timeout: 5000 }).catch(() => {});
      verifica(await pasul(p) === 1 && await p.inputValue('#mya-firma') === 'FIRMA SIMULATA SRL', `${et}: „Înapoi” a pierdut datele firmei`);
      await p.click('#mya-continua');
      await asteaptaPasul(p, 2);
      await p.waitForFunction(() => document.getElementById('mya-banca') && document.getElementById('mya-banca').value === 'Banca Transilvania SA', null, { timeout: 5000 }).catch(() => {});
      verifica(await pasul(p) === 2 && await p.inputValue('#mya-banca') === 'Banca Transilvania SA', `${et}: după „Înapoi” + „Continuă”, ciorna pasului 2 s-a pierdut`);
      verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);

      // Reîncărcare: reluarea la pasul 2, cu ciorna (alt dispozitiv = aceeași ciornă de pe server).
      await ctx.close();
      ({ ctx, p, erori } = await deschide(browser, baza, pagina, srv, 390, 844, 'ro'));
      await asteaptaPasul(p, 2);
      await p.waitForFunction(() => document.getElementById('mya-banca') && document.getElementById('mya-banca').value === 'Banca Transilvania SA', null, { timeout: 5000 }).catch(() => {});
      verifica(await pasul(p) === 2 && await p.inputValue('#mya-banca') === 'Banca Transilvania SA', `${et}: după reîncărcare nu reia la pasul 2 cu ciorna`);
      // Cu rolul acordat, panourile sunt sub pagina de activare, nu blocate.
      verifica(!(await p.$('#myd-blocat')), `${et}: după firmă panourile rămân blocate`);
      // Pasul 2 salvat → pasul 3.
      await p.fill('#mya-iban', 'RO49AAAA1B31007593840000');
      await p.click('#mya-continua');
      await asteaptaPasul(p, 3);
      verifica(await pasul(p) === 3 && srv.s.cont, `${et}: contul bancar valid nu a trecut la pasul 3`);
      verifica(!erori.length, `${et} (reluare): ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }

    // Fără tabelul ciornei (503): fluxul merge, fără salvare automată.
    {
      const et = 'fără tabelul ciornei';
      const srv = serverSimulat('partener_servicii', 'servicii', { faraCiorna: true });
      const { ctx, p, erori } = await deschide(browser, baza, 'mydarrin-dashboard-partener.html?type=servicii', srv, 1366, 900, 'ro');
      verifica(await pasul(p) === 1, `${et}: fluxul nu pornește`);
      await p.fill('#mya-cui', 'RO1');
      await p.locator('#mya-cui').blur();
      await asteapta(1200);
      verifica(!(await p.textContent('#mya-auto')).trim(), `${et}: „Salvat automat” apare fără tabel`);
      verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }

    // Paza: fără rol de partener ales → fără activare, trimis la destinația lui.
    {
      const et = 'paza: client fără rol de partener ales';
      const srv = serverSimulat('partener_servicii', 'servicii', { clientSimplu: true });
      const { ctx, p, navigari } = await deschide(browser, baza, 'mydarrin-dashboard-partener.html?type=servicii', srv, 1366, 900, 'ro');
      await asteapta(800);
      verifica(!(await p.$('#myd-activare-pagina')), `${et}: pagina de activare apare`);
      verifica(navigari.some((u) => /mydarrin-catalog/.test(u)), `${et}: nu e trimis la destinația lui (${navigari.join(' ') || '—'})`);
      await ctx.close();
    }

    // Engleză (prima vizită).
    {
      const et = 'EN';
      const srv = serverSimulat('partener_servicii', 'servicii');
      const { ctx, p, erori } = await deschide(browser, baza, 'mydarrin-dashboard-partener.html?type=servicii', srv, 1366, 900, null);
      await asteapta(600);
      // Fără opțiunile listelor (județele sunt nume proprii).
      const text = await p.evaluate(() => { const c = document.getElementById('myd-activare-pagina').cloneNode(true); c.querySelectorAll('select').forEach((x) => x.remove()); document.body.appendChild(c); c.style.display = 'block'; const t = c.innerText; c.remove(); return t; });
      verifica(/Activate your account/.test(text) && /Step 1 of 6/.test(text) && /Legal form/.test(text) && /Save and continue/.test(text), `${et}: fluxul nu e în engleză`);
      const ro = text.match(/[ăâîșțşţ][^\n]{0,30}/gi) || [];
      verifica(!ro.length, `${et}: text românesc: ${ro.slice(0, 3).join(' | ')}`);
      verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }

    // Dimensiunile ecranului (și capturile).
    if (dosarCapturi) fs.mkdirSync(dosarCapturi, { recursive: true });
    for (const [tip, rol, pagina] of CAZURI) {
      for (const [w, h] of ECRANE) {
        for (const pas of [1, 3]) {
          const et = `${tip} pasul ${pas} ${w}×${h}`;
          const srv = pas === 1 ? serverSimulat(rol, tip)
            : serverSimulat(rol, tip, { firma: { nume_firma: 'FIRMA SIMULATA SRL', cui: 'RO46577229', tip_entitate_legala: 'srl' }, ciorna: { pas_curent: 3, date: {} } });
          const { ctx, p, erori } = await deschide(browser, baza, pagina, srv, w, h, 'ro');
          await asteaptaPasul(p, pas);
          await asteapta(400);
          const m = await p.evaluate(() => {
            const pag = document.getElementById('myd-activare-pagina');
            const cont = pag.querySelector('.mya-continut').getBoundingClientRect();
            const butoane = [...pag.querySelectorAll('#mya-continua, #mya-site, #mya-deconectare, #mya-meniu-btn, #mya-inapoi, .mya-btn2')].filter((b) => b.getClientRects().length).map((b) => b.getBoundingClientRect().height);
            const antet = pag.querySelector('.mya-antet').getBoundingClientRect();
            const sus = document.elementFromPoint(antet.left + 30, antet.top + antet.height / 2);
            return {
              vw: window.innerWidth, sw: pag.scrollWidth, cw: pag.clientWidth, docw: document.documentElement.scrollWidth,
              latime: cont.width, minButon: Math.min(...butoane),
              antetLiber: !!sus && !!sus.closest('#myd-activare-pagina'),
              numeVizibil: getComputedStyle(pag.querySelector('.mya-cont-txt')).display !== 'none',
              pasiVizibili: getComputedStyle(pag.querySelector('.mya-pasi')).display !== 'none',
              nr: (pag.querySelector('.mya-nr .mya-scurt') || {}).textContent,
              scurt: getComputedStyle(pag.querySelector('.mya-nr .mya-scurt')).display !== 'none',
            };
          });
          verifica(m.sw <= m.cw + 1 && m.docw <= m.vw + 1, `${et}: derulare orizontală (${m.sw} / ${m.cw}, document ${m.docw} / ${m.vw})`);
          verifica(m.latime <= 641, `${et}: conținutul are ${Math.round(m.latime)} px (peste 640)`);
          verifica(m.minButon >= 44, `${et}: buton sub 44 px (${m.minButon})`);
          verifica(m.antetLiber, `${et}: ceva se suprapune peste antet (meniul ☰?)`);
          if (w <= 600) verifica(!m.numeVizibil && !m.pasiVizibili && m.scurt && m.nr === `${pas} / 6`, `${et}: pe telefon trebuie doar „Înapoi la site”, „N / 6” și bara (${JSON.stringify(m)})`);
          else verifica(m.numeVizibil && m.pasiVizibili, `${et}: numele, tipul sau numele pașilor lipsesc`);
          verifica(!erori.length, `${et}: ${erori.length} erori JS (${erori.slice(0, 3).join(' | ')})`);
          if (dosarCapturi && [390, 768, 1024, 1366].includes(w)) {
            await p.screenshot({ path: path.join(dosarCapturi, `pasi-${tip}-pas${pas}-${w}.png`), fullPage: false });
          }
          await ctx.close();
        }
      }
    }
  } finally {
    await browser.close();
    srvHttp.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
