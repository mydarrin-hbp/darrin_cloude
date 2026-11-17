// scripts/test-preinscriere-partener.js
// Pasul 12-P1 (17 nov. 2026): pre-înscrierea partenerului în 60 de secunde și
// panoul „cont nou” (machetele B1.1–B1.5).
//   A. Server, fără browser:
//      - stareContPartener (lib/activare-partener.js): cont nou (1/6), profil
//        incomplet, în verificare, necesită completări (firmă / document respins,
//        cu motiv), activ;
//      - /api/public/profesii: ocupațiile clasificate din competente_esco, slug,
//        NACE, denumirea în engleză;
//      - regulile din server neschimbate: accept-comanda refuză partenerul
//        neaprobat, fără IBAN sau fără contract;
//      - rutele: vercel.json și middleware.js, /parteneri/inscriere.
//   B. Browser (Playwright), 390 și 1366 px, RO și EN:
//      - pagina: câmpurile obligatorii (MDFeedback.aplicaErori), profesia
//        preselectată din ?profesie=instalator, ascunsă la Materiale, ?lang=ro,
//        UTM-ul ajuns la înregistrare;
//      - înregistrarea trimite rol_solicitat corect pentru cele 5 categorii;
//      - ecranul de cod: lipirea, temporizatorul, „Deschide Gmail” doar la @gmail.com;
//      - după cod: panoul „cont nou”, nu pasul „Firma”; datele pre-înscrierii în
//        ciorna activării și precompletate la „Profesii”;
//      - stările în panou; rândurile deschid pașii în orice ordine și revin în panou;
//      - butoanele „Devino partener” (vizitator) și „Partener” din fereastră → /parteneri/inscriere;
//      - un singur buton portocaliu pe ecran; fără depășiri; 0 erori JS.
// Nimic nu ajunge la Supabase sau la producție (clientul Supabase e simulat în pagină).
// Cu --capturi <dosar>: B1.1–B1.5, RO și EN, telefon și desktop.
// Rulare: node scripts/test-preinscriere-partener.js [--capturi <dosar>]

const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
const { stareContPartener } = require(path.join(RADACINA, 'lib/activare-partener.js'));
const apiProfesii = require(path.join(RADACINA, 'api/public/profesii.js'));
const apiAccept = require(path.join(RADACINA, 'api/partener/accept-comanda.js'));

const arg = process.argv.slice(2);
const iCap = arg.indexOf('--capturi');
const CAPTURI = iCap !== -1 ? arg[iCap + 1] : null;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A. Server ─────────────────────────────────────────────────────────────
const PASI = ['firma', 'cont_bancar', 'profesii', 'dotari', 'documente', 'contract'];
const act = (o, extra) => ({ rol: 'partener_servicii', tip: 'servicii', mod_activare: !extra || !extra.rol, verificare: (extra && extra.verificare) || null, activ: !!(extra && extra.activ), complet: false, pasi: PASI.map((c) => ({ cheie: c, stare: o[c] })) });
const NOU = { firma: 'de_completat', cont_bancar: 'blocat', profesii: 'blocat', dotari: 'blocat', documente: 'blocat', contract: 'blocat' };
const INCOMPLET = { firma: 'in_verificare', cont_bancar: 'de_completat', profesii: 'de_completat', dotari: 'de_completat', documente: 'de_completat', contract: 'dupa_verificare' };
const VERIFICARE = { firma: 'in_verificare', cont_bancar: 'completat', profesii: 'completat', dotari: 'completat', documente: 'in_verificare', contract: 'dupa_verificare' };
const RESPINS = { firma: 'de_completat', cont_bancar: 'completat', profesii: 'completat', dotari: 'completat', documente: 'completat', contract: 'dupa_verificare' };
const ACTIV = { firma: 'completat', cont_bancar: 'completat', profesii: 'completat', dotari: 'completat', documente: 'completat', contract: 'completat' };

async function testeServer() {
  let s = stareContPartener(act(NOU));
  verifica(s.stare === 'profil_incomplet' && s.pasi_facuti === 1 && s.urmatorul === 'firma' && s.randuri.length === 6 && s.randuri[0].stare === 'facut', `A1 cont nou: ${JSON.stringify(s)}`);
  verifica(s.randuri.filter((r) => r.stare === 'blocat').length === 4, 'A1 cont nou: pașii de după firmă așteaptă firma');
  s = stareContPartener(act(INCOMPLET, { verificare: 'pending_review', rol: 1 }));
  verifica(s.stare === 'profil_incomplet' && s.pasi_facuti === 2 && s.urmatorul === 'cont_bancar', `A2 profil incomplet: ${s.stare} ${s.pasi_facuti} ${s.urmatorul}`);
  s = stareContPartener(act(VERIFICARE, { verificare: 'pending_review', rol: 1 }));
  verifica(s.stare === 'in_verificare' && s.pasi_facuti === 5 && s.urmatorul === null, `A3 în verificare: ${s.stare} ${s.pasi_facuti} ${s.urmatorul}`);
  s = stareContPartener(act(RESPINS, { verificare: 'rejected', rol: 1 }), { motivFirma: 'CUI-ul nu corespunde firmei.' });
  verifica(s.stare === 'necesita_completari' && s.motiv === 'CUI-ul nu corespunde firmei.' && s.urmatorul === 'firma' && s.randuri[1].stare === 'respins', `A4 firmă respinsă: ${JSON.stringify(s)}`);
  s = stareContPartener(act({ ...ACTIV, documente: 'de_completat', contract: 'de_completat' }, { verificare: 'approved', rol: 1 }), { documenteRespinse: true, motivDocumente: 'Poza e neclară.' });
  verifica(s.stare === 'necesita_completari' && s.motiv === 'Poza e neclară.' && s.urmatorul === 'documente', `A5 document respins: ${JSON.stringify(s)}`);
  s = stareContPartener(act(ACTIV, { verificare: 'approved', activ: true, rol: 1 }));
  verifica(s.stare === 'activ' && s.pasi_facuti === 6, `A6 activ: ${s.stare} ${s.pasi_facuti}`);
  verifica(stareContPartener(null) === null, 'A7 fără activare → null');

  // Profesiile
  const randuri = [
    { cod_esco: '712601', denumire: 'Instalator', denumire_en: 'Plumber (RO specific)', domeniu: 'Construcții & Renovări', nace_code: 'F 43.22' },
    { cod_esco: '7132', denumire: 'Zugravi și vopsitori', denumire_en: 'Painters and related workers', domeniu: 'Construcții & Renovări', nace_code: 'F 43.30' },
    { cod_esco: 'COR-712902', denumire: 'Pavator', denumire_en: null, domeniu: 'Construcții & Renovări', nace_code: null },
    { cod_esco: '7126.8', denumire: 'instalator/instalatoare', denumire_en: 'plumber', domeniu: 'ESCO - neclasificat', nace_code: '4322' },
  ];
  const ro = apiProfesii.profesii(randuri, 'ro');
  const en = apiProfesii.profesii(randuri, 'en');
  verifica(ro.length === 3 && !ro.some((p) => p.cod === '7126.8'), `A8 doar ocupațiile clasificate (${ro.length})`);
  const inst = ro.find((p) => p.slug === 'instalator');
  verifica(inst && inst.nace === '43.22' && inst.cod === '712601', `A9 instalator: slug, cod ESCO, NACE 43.22 (${JSON.stringify(inst)})`);
  verifica(ro.some((p) => p.slug === 'zugravi-si-vopsitori'), 'A10 slug fără diacritice');
  verifica(en.find((p) => p.slug === 'instalator').denumire === 'Plumber', 'A11 EN: „Plumber”, fără „(RO specific)”');
  verifica(en.find((p) => p.slug === 'pavator').denumire === 'Pavator', 'A12 fără EN în bază: rezerva românească (tradusă în pagină din dicționar)');
  const dict = JSON.parse(fs.readFileSync(path.join(RADACINA, 'i18n/en/mydarrin-inscriere-partener.json'), 'utf8'));
  verifica(dict._texte.Pavator === 'Paver', 'A12 „Pavator” are traducere în dicționarul paginii');
  DB.tabele = { competente_esco: randuri };
  const res = raspuns();
  await apiProfesii(cerere({ metoda: 'GET', query: { lang: 'en' } }), res);
  verifica(res.statusCode === 200 && res.corp.ok && res.corp.profesii.length === 3, `A13 GET /api/public/profesii: ${res.statusCode}`);

  // Regulile din server, neschimbate: accept-comanda refuză fără aprobare / IBAN / contract.
  const PART = (id, o) => Object.assign({ id, partner_type: 'servicii', status_verificare: 'approved', contract_semnat: true, entitate_platforma_id: null, nume_firma: 'Test SRL' }, o);
  DB.tabele = {
    partners: [PART('p-neaprobat', { status_verificare: 'pending_review' }), PART('p-fara-iban'), PART('p-fara-contract', { contract_semnat: false })],
    partner_conturi_bancare: [{ partner_id: 'p-neaprobat', activ: true }, { partner_id: 'p-fara-contract', activ: true }],
    profiles: [{ id: 'p-neaprobat', status: 'activ' }, { id: 'p-fara-iban', status: 'activ' }, { id: 'p-fara-contract', status: 'activ' }],
    comenzi: [],
  };
  DB.utilizatori = { 't-1': { id: 'p-neaprobat' }, 't-2': { id: 'p-fara-iban' }, 't-3': { id: 'p-fara-contract' } };
  for (const [tok, et] of [['t-1', 'neaprobat'], ['t-2', 'fără IBAN'], ['t-3', 'fără contract']]) {
    const r = raspuns();
    await apiAccept(cerere({ metoda: 'POST', token: tok, body: { comanda_id: 'c-1' } }), r);
    verifica(r.statusCode === 403, `A14 accept-comanda, partener ${et}: refuzat (${r.statusCode} ${r.corp && r.corp.cod})`);
  }

  // Rutele
  const vj = JSON.parse(fs.readFileSync(path.join(RADACINA, 'vercel.json'), 'utf8'));
  verifica(vj.rewrites.some((r) => r.source === '/parteneri/inscriere' && r.destination === '/mydarrin-inscriere-partener.html'), 'A15 vercel.json: /parteneri/inscriere');
  const mw = fs.readFileSync(path.join(RADACINA, 'middleware.js'), 'utf8');
  verifica(/'\/parteneri\/inscriere': '\/mydarrin-inscriere-partener'/.test(mw), 'A15 middleware.js: /parteneri/inscriere');
}

// ── B. Browser ────────────────────────────────────────────────────────────
const PROFESII = [
  { slug: 'electrician', cod: '741101', denumire_ro: 'Electrician', nace: '43.21' },
  { slug: 'instalator', cod: '712601', denumire_ro: 'Instalator', nace: '43.22' },
  { slug: 'zugravi-si-vopsitori', cod: '7132', denumire_ro: 'Zugravi și vopsitori', nace: '43.30' },
];
const PROFESII_EN = { electrician: 'Electrician', instalator: 'Plumber', 'zugravi-si-vopsitori': 'Painters and related workers' };

// Clientul Supabase simulat (în pagină): înregistrarea, codul, sesiunea.
function supabaseSimulat() {
  const areSes = () => { try { return sessionStorage.getItem('sim_ses') === '1'; } catch (e) { return false; } };
  const user = () => ({ id: '50000000-0000-4000-8000-000000000001', email: (sessionStorage.getItem('sim_email') || 'ion@gmail.com'), email_confirmed_at: '2026-11-17T08:00:00Z', user_metadata: { prenume: 'Ion' } });
  const ses = () => (areSes() ? { access_token: 'tok-test', user: user() } : null);
  const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
  window.__auth = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: areSes() ? user() : null }, error: null }),
      getSession: async () => ({ data: { session: ses() }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { sessionStorage.removeItem('sim_ses'); return { error: null }; },
      signUp: async (o) => { window.__auth.push({ tip: 'signUp', o }); sessionStorage.setItem('sim_email', o.email); localStorage.setItem('__signup', JSON.stringify(o)); return { data: { user: { id: 'u', identities: [{}] } }, error: null }; },
      verifyOtp: async (o) => {
        window.__auth.push({ tip: 'verifyOtp', o });
        if (o.token !== '123456') return { data: {}, error: { message: 'Token has expired or is invalid', status: 403 } };
        sessionStorage.setItem('sim_ses', '1');
        return { data: { user: user(), session: ses() }, error: null };
      },
      resend: async () => ({ error: null }),
    },
    from: () => lant({ data: null, error: null }),
    rpc: () => lant({ data: null, error: null }),
    channel: () => lant({}),
    removeChannel: () => {},
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  };
  Object.defineProperty(window, 'supabaseClient', { configurable: true, get: () => client, set: () => {} });
}

// Serverul simulat: profilul (starea calculată cu stareContPartener reală), ciorna, profesiile.
function serverSimulat(opt) {
  const s = { ciorna: null, puturi: [], stare: (opt && opt.stare) || 'nou', categorie: (opt && opt.categorie) || 'servicii', motiv: (opt && opt.motiv) || null, profilCereri: 0 };
  const ROL = { servicii: 'partener_servicii', materiale: 'partener_materiale', inchirieri: 'partener_inchirieri', curier: 'partener_curier', asigurari: 'partener_asigurari' };
  function profil() {
    const pasi = { nou: NOU, incomplet: INCOMPLET, verificare: VERIFICARE, respins: RESPINS, activ: ACTIV }[s.stare];
    const extra = { nou: {}, incomplet: { verificare: 'pending_review', rol: 1 }, verificare: { verificare: 'pending_review', rol: 1 }, respins: { verificare: 'rejected', rol: 1 }, activ: { verificare: 'approved', activ: true, rol: 1 } }[s.stare];
    const a = act(pasi, extra);
    a.rol = ROL[s.categorie]; a.tip = s.categorie;
    a.pasi = a.pasi.map((x) => Object.assign(x, { deschide: null }));
    a.stare_cont = stareContPartener(a, { motivFirma: s.motiv });
    const areRol = s.stare !== 'nou';
    return {
      ok: true, email: 'ion@gmail.com', nume: 'Ion Popescu', prenume: 'Ion', nume_familie: 'Popescu', telefon: '+40712345678', tara: 'RO', limba: null,
      roles: areRol ? ['client', a.rol] : ['client'], roluri_dashboard: areRol ? [a.rol] : [], are_comenzi: false,
      destinatie: '/mydarrin-dashboard-partener.html?type=' + s.categorie, tip_destinatie: 'activare_partener', rol_solicitat: a.rol,
      partener: areRol ? { nume_firma: 'Ion SRL', partner_type: s.categorie, rol: a.rol, status_verificare: extra.verificare, contract_semnat: s.stare === 'activ', cont_bancar: s.stare !== 'incomplet', motiv_respingere: s.motiv, poate_vinde: s.stare === 'activ' } : null,
      investitor: null, activare: a, furnizor_propriu: false,
    };
  }
  async function trateaza(route) {
    const req = route.request();
    const u = new URL(req.url());
    const m = req.method();
    const corp = () => { try { return JSON.parse(req.postData() || '{}'); } catch (e) { return {}; } };
    const json = (cod, b) => route.fulfill({ status: cod, contentType: 'application/json', body: JSON.stringify(b) });
    switch (u.pathname) {
      case '/api/public/profesii': {
        const en = u.searchParams.get('lang') === 'en';
        return json(200, { ok: true, profesii: PROFESII.map((p) => Object.assign({}, p, { denumire: en ? PROFESII_EN[p.slug] : p.denumire_ro })) });
      }
      case '/api/cont/profil': s.profilCereri++; return json(200, profil());
      case '/api/partener/activare-ciorna':
        if (m === 'GET') return json(200, { ok: true, ciorna: s.ciorna });
        if (m === 'PUT') { const b = corp(); s.puturi.push(b); s.ciorna = Object.assign({}, b, { actualizat_la: new Date().toISOString() }); return json(200, { ok: true, actualizat_la: s.ciorna.actualizat_la }); }
        s.ciorna = null; return json(200, { ok: true });
      case '/api/public/destinatie-post-login': return json(200, { ok: true, destinatie: '/mydarrin-dashboard-partener.html?type=' + s.categorie, tip: 'activare_partener' });
      case '/api/cont/bun-venit': return json(200, { ok: true, trimis: false });
      case '/api/public/nace-lista': return json(200, { ok: true, clase: [{ cod: '43.21', denumire: 'Lucrări de instalații electrice' }, { cod: '43.22', denumire: 'Lucrări de instalații sanitare, de încălzire și de aer condiționat' }] });
      case '/api/partener/wizard-nace': return json(200, { ok: true, coduri: [] });
      case '/api/public/geo-regiuni': return json(200, { ok: true, regiuni: [{ cod: 'IS', denumire: 'Iași' }] });
      case '/api/public/forme-juridice': return route.fallback();
      default:
        if (/^\/api\/public\/(reguli-platforma|tari-active)/.test(u.pathname)) return route.fallback();
        return json(503, { ok: false });
    }
  }
  return { s, trateaza };
}

async function testeBrowser() {
  const { chromium } = require('playwright');
  const { porneste } = require('./server-test');
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  const ZGOMOT = /Failed to load resource|net::ERR_|status of 50[0-9]|status of 40[0-9]|cdn\.tailwindcss\.com|favicon/i;

  async function context(latime, limba, server, o) {
    const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 800 ? 844 : 900 } });
    await ctx.addInitScript(([l, ses]) => {
      try {
        if (!sessionStorage.getItem('__init')) {
          if (l) localStorage.setItem('myd_lang_v1', l);
          localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: true, marketing: false, data: new Date().toISOString(), versiune: 2 }));
          if (ses) sessionStorage.setItem('sim_ses', '1');
          sessionStorage.setItem('__init', '1');
        }
      } catch (e) {}
    }, [limba, !!(o && o.sesiune)]);
    await ctx.addInitScript(supabaseSimulat);
    // Trackerele și Supabase: după domeniu (adresa paginii poate conține utm_source=facebook).
    await ctx.route((u) => /(\.supabase\.co|googletagmanager\.com|google-analytics\.com|ipapi\.co|facebook\.(net|com)|tiktok\.com|licdn\.com)$/.test(u.hostname) || /^\/_vercel\/insights/.test(u.pathname), (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await ctx.route(/\/api\//, server.trateaza);
    // Pagina principală (după ieșire): o oprim aici.
    await ctx.route(/mydarrin\.homebestpal\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>site</body></html>' }));
    const p = await ctx.newPage();
    const erori = [];
    p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
    p.on('console', (m) => { if (m.type() === 'error' && !ZGOMOT.test(m.text())) erori.push('console: ' + m.text().slice(0, 160)); });
    return { ctx, p, erori };
  }
  const PAGINA = '/mydarrin-inscriere-partener.html';
  const depaseste = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const portocalii = (p, rad) => p.evaluate((sel) => {
    const r = sel ? document.querySelector(sel) : document;
    if (!r) return -1;
    // Butoanele (și ce e în ele) cu fundal portocaliu; punctele decorative nu contează.
    return [...r.querySelectorAll('*')].filter((b) => {
      if (!b.closest('button, a')) return false;
      if (!b.getClientRects().length) return false;
      const cs = getComputedStyle(b);
      return cs.visibility !== 'hidden' && /255, 140, 0/.test(cs.backgroundColor);
    }).length;
  }, rad || null);

  try {
    for (const lang of ['ro', 'en']) {
      for (const latime of [390, 1366]) {
        const et = `${lang} ${latime}`;
        // ── B1. Pagina: obligatorii, profesia din reclamă, lang, UTM ──
        {
          const server = serverSimulat();
          const { ctx, p, erori } = await context(latime, null, server);
          await p.goto(`${baza}${PAGINA}?profesie=instalator&lang=${lang}&utm_source=facebook&utm_campaign=instalatori-iasi`, { waitUntil: 'load' });
          await p.waitForFunction(() => document.querySelectorAll('#pi-profesie option').length > 1, null, { timeout: 10000 });
          verifica(await p.evaluate(() => document.documentElement.lang) === lang, `${et} B1: ?lang=${lang} aplicat`);
          verifica(await p.inputValue('#pi-profesie') === 'instalator', `${et} B1: profesia preselectată din ?profesie=instalator`);
          verifica(await p.isVisible('#pi-profesie-ajutor'), `${et} B1: „Aleasă deja din reclamă” vizibil`);
          verifica(await p.isChecked('input[name="pi-categorie"][value="servicii"]'), `${et} B1: Servicii ales implicit`);
          verifica(await portocalii(p) === 1, `${et} B1: un singur buton portocaliu (${await portocalii(p)})`);
          verifica(await depaseste(p) <= 0, `${et} B1: pagina nu iese din ecran (${await depaseste(p)} px)`);
          // Obligatorii: trimitere goală → erorile sub câmpuri.
          await p.click('#pi-trimite');
          await p.waitForSelector('#pi-oras[aria-invalid="true"]', { timeout: 5000 }).catch(() => {});
          const invalide = await p.evaluate(() => [...document.querySelectorAll('#pi-form [aria-invalid="true"]')].map((e) => e.id));
          verifica(['pi-oras', 'pi-prenume', 'pi-nume', 'pi-tel', 'pi-email', 'pi-parola', 'pi-gdpr'].every((id) => invalide.includes(id)), `${et} B1: câmpurile obligatorii marcate (${invalide.join(',')})`);
          // Materiale: profesia dispare și nu mai e obligatorie.
          await p.click('label.pi-cip:has(input[value="materiale"])');
          verifica(!(await p.isVisible('#pi-profesie')), `${et} B1: profesia ascunsă la Materiale`);
          const nota = await p.textContent('#pi-nota');
          verifica(!/0%/.test(nota), `${et} B1: „0% comision din manoperă” doar la servicii și curieri (${nota.trim()})`);
          await p.click('label.pi-cip:has(input[value="servicii"])');
          // Româna nu apare în EN (textul vizibil).
          if (lang === 'en') {
            const text = await p.evaluate(() => document.body.innerText);
            const { eRo } = require('./recunoaste-ro');
            const ro = text.split('\n').map((x) => x.trim()).filter((x) => x && eRo(x));
            verifica(!ro.length, `${et} B1: text românesc în EN: ${ro.slice(0, 4).join(' | ')}`);
          }
          // Înregistrarea completă (Servicii), cu UTM-ul păstrat.
          await p.fill('#pi-oras', 'Iași');
          await p.fill('#pi-prenume', 'Ion');
          await p.fill('#pi-nume', 'Popescu');
          await p.fill('#pi-tel', '+40 712 345 678');
          await p.fill('#pi-email', 'ion@gmail.com');
          await p.fill('#pi-parola', 'Parola-Test-1');
          await p.check('#pi-gdpr');
          await p.click('#pi-trimite');
          await p.waitForSelector('#auth-verify-cod:not([hidden])', { timeout: 10000 }).catch(() => {});
          const su = await p.evaluate(() => JSON.parse(localStorage.getItem('__signup') || 'null'));
          verifica(su && su.options.data.rol_solicitat === 'partener_servicii' && su.options.data.telefon === '+40712345678' && su.options.data.gdpr_acceptat === true, `${et} B1: înregistrarea (${su && JSON.stringify(su.options.data).slice(0, 160)})`);
          verifica(su && su.options.data.sursa && su.options.data.sursa.utm_source === 'facebook', `${et} B1: UTM-ul ajunge la cont (sursa: ${su && JSON.stringify(su.options.data.sursa)})`);
          verifica(su && su.options.data.limba === lang || su && su.options.data.limba, `${et} B1: limba trimisă la înregistrare`);
          const pre = await p.evaluate(() => JSON.parse(sessionStorage.getItem('myd_preinscriere_v1') || 'null'));
          verifica(pre && pre.categorie === 'servicii' && pre.profesie_slug === 'instalator' && pre.nace === '43.22' && pre.oras === 'Iași', `${et} B1: datele pre-înscrierii păstrate (${JSON.stringify(pre)})`);

          // ── B2. Ecranul de cod ──
          verifica(await p.isVisible('#auth-verify-cod'), `${et} B2: ecranul de cod`);
          verifica(await p.isVisible('#mdc-gmail'), `${et} B2: „Deschide Gmail” la @gmail.com`);
          verifica(await p.getAttribute('#mdc-gmail', 'href') === 'https://mail.google.com/', `${et} B2: linkul Gmail`);
          const ret = await p.evaluate(() => ({ t: document.getElementById('mdc-retrimite').textContent, d: document.getElementById('mdc-retrimite').disabled }));
          verifica(ret.d && /0:4\d/.test(ret.t), `${et} B2: „Retrimite (0:4x)”, dezactivat (${ret.t})`);
          const sfat = await p.textContent('#mdc-cod-indiciu');
          verifica(/noreply@homebestpal\.com/.test(sfat) && (lang === 'ro' ? /Promoții și Spam/.test(sfat) : /Promotions and Spam/.test(sfat)), `${et} B2: sfatul cu expeditorul (${sfat.trim()})`);
          verifica(await portocalii(p, '#auth-modal') === 1, `${et} B2: un singur buton portocaliu`);
          // Lipirea: „12 34 56” → 123456, în cele 6 căsuțe.
          await p.fill('#verify-cod-input', 'Cod: 65 43 21');
          const cutii = await p.evaluate(() => [...document.querySelectorAll('#mdc-cutii span')].map((s) => s.textContent).join(''));
          verifica(cutii === '654321' && await p.inputValue('#verify-cod-input') === '654321', `${et} B2: codul lipit în căsuțe (${cutii})`);
          // Cod greșit → eroare, rămâne pe ecran.
          await p.click('#mdc-cod-btn');
          await p.waitForSelector('#verify-cod-msg .md-feedback-eroare', { timeout: 5000 }).catch(() => {});
          verifica(await p.isVisible('#auth-verify-cod'), `${et} B2: codul greșit lasă ecranul de cod`);
          // Codul corect → panoul „cont nou”.
          await p.fill('#verify-cod-input', '123456');
          await p.click('#mdc-cod-btn');
          await p.waitForURL(/mydarrin-dashboard-partener/, { timeout: 15000 }).catch(() => {});
          await p.waitForSelector('#myd-panou-nou .mpn-stare', { timeout: 15000 }).catch(() => {});
          verifica(/mydarrin-dashboard-partener\.html\?type=servicii/.test(p.url()), `${et} B3: după cod, panoul partenerului (${p.url()})`);
          verifica(await p.isVisible('#myd-panou-nou'), `${et} B3: panoul „cont nou” deschis`);
          verifica(!(await p.$('#myd-activare-pagina')), `${et} B3: nu se deschide pasul „Firma”`);
          const put = server.s.puturi.find((x) => x.date && x.date.preinscriere);
          verifica(put && put.date.preinscriere.nace === '43.22' && put.date.preinscriere.oras === 'Iași', `${et} B3: datele pre-înscrierii în ciornă (${put && JSON.stringify(put.date.preinscriere)})`);
          const salut = await p.textContent('.mpn-salut');
          verifica(salut.includes(lang === 'ro' ? 'Bun venit, Ion' : 'Welcome, Ion') && salut.includes(lang === 'ro' ? 'Instalator' : 'Plumber') && salut.includes('Iași'), `${et} B3: salutul și profesia (${salut.replace(/\s+/g, ' ').trim()})`);
          const info = await p.textContent('.mpn-info b');
          verifica(lang === 'ro' ? /Comenzi de instalator în Iași/.test(info) : /Plumber orders in Iași/.test(info), `${et} B3: cardul turcoaz (${info})`);
          verifica(await p.textContent('.mpn-stare .mpn-insigna') === (lang === 'ro' ? 'Profil incomplet' : 'Profile incomplete'), `${et} B3: starea „Profil incomplet”`);
          const port = await p.evaluate(() => [...document.querySelectorAll('#myd-panou-nou *')].filter((b) => b.closest('button, a') && b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden' && /255, 140, 0/.test(getComputedStyle(b).backgroundColor)).map((b) => b.tagName + '.' + b.className + ' ' + b.textContent.trim().slice(0, 30)));
          verifica(port.length === 1, `${et} B3: un singur buton portocaliu în panou (${port.join(' | ')})`);
          verifica(await p.evaluate(() => document.getElementById('myd-panou-nou').scrollWidth <= window.innerWidth), `${et} B3: panoul nu iese din ecran`);
          verifica(latime < 1024 ? await p.isVisible('.mpn-jos') : await p.isVisible('.mpn-meniu'), `${et} B3: ${latime < 1024 ? 'bara de jos' : 'meniul lateral'}`);
          // EN: niciun text românesc vizibil în panou (B1.4) și pe ecranul de cod de dinainte.
          if (lang === 'en') {
            const { eRo } = require('./recunoaste-ro');
            const text = await p.evaluate(() => document.getElementById('myd-panou-nou').innerText);
            const ro = text.split('\n').map((x) => x.trim()).filter((x) => x && eRo(x));
            verifica(!ro.length, `${et} B3: text românesc în panoul EN: ${ro.slice(0, 4).join(' | ')}`);
          }
          // Secțiunile fără date: stări goale, fără cifre.
          await p.click(`${latime < 1024 ? '.mpn-jos' : '.mpn-meniu'} [data-mpn-sec="comenzi"]`);
          const gol = await p.textContent('[data-mpn-gol="comenzi"]');
          verifica(!/\d/.test(gol), `${et} B3: „Comenzi” fără cifre (${gol.trim().slice(0, 80)})`);
          await p.click(`${latime < 1024 ? '.mpn-jos' : '.mpn-meniu'} [data-mpn-sec="activitate"]`);
          // „Continuă cu firma” → pasul Firma, „Înapoi la panou” → panoul.
          // Telefon: butonul „Continuă cu firma”; desktop (B1.5): „Completează” din rândul Firma.
          await p.click(latime < 1024 ? '#mpn-continua' : '.mpn-rand[data-mpn-rand="firma"]');
          await p.waitForSelector('#myd-activare-pagina #mya-corp', { timeout: 10000 });
          verifica(await p.isVisible('#myd-activare-pagina #mya-cui'), `${et} B4: „Continuă cu firma” / „Completează” deschide pasul Firma`);
          await p.click('#mya-inapoi');
          await p.waitForSelector('#myd-activare-pagina', { state: 'detached', timeout: 10000 }).catch(() => {});
          verifica(!(await p.$('#myd-activare-pagina')) && await p.isVisible('#myd-panou-nou .mpn-stare'), `${et} B4: „Înapoi la panou” revine în panou`);
          // Documente (încă după firmă): explicația, fără formular; înapoi în panou.
          await p.click('.mpn-rand[data-mpn-rand="documente"]');
          await p.waitForSelector('#myd-activare-pagina #mya-corp', { timeout: 10000 });
          const expl = await p.textContent('#myd-activare-pagina #mya-corp');
          verifica(lang === 'ro' ? /după ce salvezi firma/.test(expl) : /after you save your company/.test(expl), `${et} B4: pasul care așteaptă firma explică de ce (${expl.trim().slice(0, 80)})`);
          await p.click('#mya-inapoi');
          await p.waitForSelector('#myd-activare-pagina', { state: 'detached', timeout: 10000 }).catch(() => {});
          verifica(await p.isVisible('#myd-panou-nou .mpn-stare'), `${et} B4: înapoi în panou din „Documente”`);
          verifica(!erori.length, `${et} B: erori JS (${erori.slice(0, 3).join(' | ')})`);
          await ctx.close();
        }
      }
    }

    // ── B5. Cele 5 categorii → rol_solicitat ──
    for (const cat of ['servicii', 'materiale', 'inchirieri', 'curier', 'asigurari']) {
      const server = serverSimulat({ categorie: cat });
      const { ctx, p } = await context(390, 'ro', server);
      await p.goto(`${baza}${PAGINA}?categorie=${cat}`, { waitUntil: 'load' });
      await p.waitForFunction(() => window.MDFeedback && window.MDCont, null, { timeout: 10000 });
      verifica(await p.isChecked(`input[name="pi-categorie"][value="${cat}"]`), `B5 ${cat}: categoria din ?categorie=`);
      if (cat === 'servicii') await p.selectOption('#pi-profesie', 'electrician');
      await p.fill('#pi-oras', 'Cluj-Napoca');
      await p.fill('#pi-prenume', 'Ana');
      await p.fill('#pi-nume', 'Test');
      await p.fill('#pi-tel', '+40712345679');
      await p.fill('#pi-email', 'ana@example.com');
      await p.fill('#pi-parola', 'Parola-Test-2');
      await p.check('#pi-gdpr');
      await p.click('#pi-trimite');
      await p.waitForSelector('#auth-verify-cod:not([hidden])', { timeout: 10000 }).catch(() => {});
      const su = await p.evaluate(() => JSON.parse(localStorage.getItem('__signup') || 'null'));
      verifica(su && su.options.data.rol_solicitat === 'partener_' + cat, `B5 ${cat}: rol_solicitat ${su && su.options.data.rol_solicitat}`);
      verifica(!(await p.isVisible('#mdc-gmail')), `B5 ${cat}: fără „Deschide Gmail” la o adresă care nu e Gmail`);
      await ctx.close();
    }

    // ── B5b. Fără lista de profesii (API indisponibil): câmpul dispare, contul se creează ──
    {
      const server = serverSimulat();
      const trateaza = server.trateaza;
      server.trateaza = (r) => (/\/api\/public\/profesii/.test(r.request().url()) ? r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }) : trateaza(r));
      const { ctx, p } = await context(390, 'ro', server);
      await p.goto(`${baza}${PAGINA}?profesie=instalator`, { waitUntil: 'load' });
      await p.waitForFunction(() => window.MDCont && document.getElementById('pi-profesie-camp').hidden, null, { timeout: 10000 }).catch(() => {});
      verifica(!(await p.isVisible('#pi-profesie')), 'B5b: fără lista de profesii, câmpul nu apare');
      await p.fill('#pi-oras', 'Iași'); await p.fill('#pi-prenume', 'Ion'); await p.fill('#pi-nume', 'Pop');
      await p.fill('#pi-tel', '+40712345678'); await p.fill('#pi-email', 'ion@example.com'); await p.fill('#pi-parola', 'Parola-Test-3'); await p.check('#pi-gdpr');
      await p.click('#pi-trimite');
      verifica(await p.waitForSelector('#auth-verify-cod:not([hidden])', { timeout: 10000 }).then(() => true, () => false), 'B5b: contul se creează și fără profesie (o alege la activare)');
      await ctx.close();
    }

    // ── B6. Stările în panou și precompletarea „Profesii” ──
    for (const [stare, insigna, motiv] of [['incomplet', 'Profil incomplet'], ['verificare', 'În verificare'], ['respins', 'Necesită completări', 'CUI-ul nu corespunde firmei.']]) {
      const server = serverSimulat({ stare, motiv });
      server.s.ciorna = { pas_curent: 1, date: { preinscriere: { categorie: 'servicii', profesie_slug: 'instalator', profesie_cod: '712601', profesie_ro: 'Instalator', nace: '43.22', oras: 'Iași' } } };
      const { ctx, p, erori } = await context(1366, 'ro', server, { sesiune: true });
      await p.goto(`${baza}/mydarrin-dashboard-partener.html?type=servicii`, { waitUntil: 'load' });
      await p.waitForSelector('#myd-panou-nou .mpn-stare', { timeout: 15000 }).catch(() => {});
      const ins = await p.textContent('.mpn-salut .mpn-insigna').catch(() => '');
      verifica(ins === insigna, `B6 ${stare}: insigna „${ins}”`);
      if (motiv) verifica((await p.textContent('#mpn-motiv')).includes(motiv), 'B6 respins: motivul verificării apare');
      if (stare === 'verificare') verifica(!(await p.$('#mpn-continua')), 'B6 în verificare: niciun buton „Continuă” (nimic de făcut acum)');
      verifica(!!(await p.$('#mpn-complet')), `B6 ${stare}: partenerul cu rol poate deschide panoul complet`);
      if (stare === 'incomplet') {
        // Profesii și dotări: NACE-ul profesiei precompletat.
        await p.click('.mpn-rand[data-mpn-rand="profesii_dotari"]');
        await p.waitForSelector('#mya-nace input[type=radio]', { timeout: 10000 }).catch(() => {});
        const principal = await p.evaluate(() => (document.querySelector('#mya-nace input[name="mya-principal"]:checked') || {}).value);
        verifica(principal === '43.22', `B6: „Profesii” precompletat cu NACE-ul profesiei (${principal})`);
        await p.click('#mya-inapoi');
        await p.waitForSelector('#myd-activare-pagina', { state: 'detached', timeout: 10000 }).catch(() => {});
        verifica(await p.isVisible('#myd-panou-nou'), 'B6: înapoi în panou din „Profesii”');
      }
      verifica(!erori.length, `B6 ${stare}: erori JS (${erori.slice(0, 3).join(' | ')})`);
      await ctx.close();
    }
    {
      const server = serverSimulat({ stare: 'activ' });
      const { ctx, p } = await context(1366, 'ro', server, { sesiune: true });
      await p.goto(`${baza}/mydarrin-dashboard-partener.html?type=servicii`, { waitUntil: 'load' });
      await asteapta(2500);
      verifica(!(await p.$('#myd-panou-nou')), 'B6 activ: dashboard-ul obișnuit, fără panoul „cont nou”');
      await ctx.close();
    }

    // ── B7. „Devino partener” (vizitator) și „Partener” din fereastră → /parteneri/inscriere ──
    {
      const server = serverSimulat();
      const { ctx, p } = await context(1366, 'ro', server);
      await p.goto(`${baza}/cum-devii-furnizor-servicii.html`, { waitUntil: 'load' });
      await p.waitForSelector('[data-cta-partener][data-cta-stare="vizitator"]', { timeout: 10000 }).catch(() => {});
      const hrefuri = await p.evaluate(() => [...document.querySelectorAll('[data-cta-partener][data-cta-stare="vizitator"]')].map((a) => a.getAttribute('href')));
      verifica(hrefuri.length && hrefuri.every((h) => /^\/parteneri\/inscriere(\?categorie=[a-z]+)?$/.test(h)), `B7: butoanele „Devino partener” → /parteneri/inscriere (${hrefuri.join(', ')})`);
      await p.evaluate(() => window.MDCont.deschide({ tab: 'register', rol: 'partener_curier' }));
      await p.waitForURL(/mydarrin-inscriere-partener|parteneri\/inscriere/, { timeout: 8000 }).catch(() => {});
      verifica(/categorie=curier/.test(p.url()), `B7: „Partener” din fereastra de cont → pre-înscriere (${p.url()})`);
      await ctx.close();
    }

    if (CAPTURI) await capturi(baza);
  } finally {
    await browser.close();
    srv.close();
  }

  // ── Capturile pentru aprobarea LM ──
  async function capturi(bazaUrl) {
    fs.mkdirSync(CAPTURI, { recursive: true });
    const br = await require('playwright').chromium.launch();
    try {
      for (const lang of ['ro', 'en']) {
        for (const latime of [390, 1366]) {
          const server = serverSimulat();
          const ctx = await br.newContext({ viewport: { width: latime, height: latime < 800 ? 844 : 900 } });
          await ctx.addInitScript(([l]) => { try { if (!sessionStorage.getItem('__init')) { localStorage.setItem('myd_lang_v1', l); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, marketing: false, data: new Date().toISOString(), versiune: 2 })); sessionStorage.setItem('__init', '1'); } } catch (e) {} }, [lang]);
          await ctx.addInitScript(supabaseSimulat);
          await ctx.route(/\.supabase\.co\/|googletagmanager|google-analytics|_vercel\/insights|ipapi\.co/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
          await ctx.route(/\/api\//, server.trateaza);
          const p = await ctx.newPage();
          await p.goto(`${bazaUrl}${PAGINA}?profesie=instalator`, { waitUntil: 'load' });
          await p.waitForFunction(() => document.querySelectorAll('#pi-profesie option').length > 1, null, { timeout: 10000 }).catch(() => {});
          await p.fill('#pi-oras', 'Iași'); await p.fill('#pi-prenume', 'Ion'); await p.fill('#pi-nume', 'Popescu');
          await p.fill('#pi-tel', '+40 712 345 678'); await p.fill('#pi-email', 'ion@gmail.com'); await p.fill('#pi-parola', 'Parola-Test-1'); await p.check('#pi-gdpr');
          await asteapta(400);
          await p.screenshot({ path: path.join(CAPTURI, `B1.1-preinscriere-${lang}-${latime}.png`), fullPage: true });
          await p.click('#pi-trimite');
          await p.waitForSelector('#auth-verify-cod:not([hidden])', { timeout: 10000 }).catch(() => {});
          await p.fill('#verify-cod-input', '482');
          await asteapta(400);
          await p.screenshot({ path: path.join(CAPTURI, `B1.2-cod-${lang}-${latime}.png`) });
          await p.fill('#verify-cod-input', '123456');
          await p.click('#mdc-cod-btn');
          await p.waitForSelector('#myd-panou-nou .mpn-stare', { timeout: 15000 }).catch(() => {});
          // Mesajul „Contul a fost creat.” dispare după ~4 s; captura, după el.
          await asteapta(5000);
          const h = await p.evaluate(() => document.getElementById('myd-panou-nou').scrollHeight + 70);
          await p.setViewportSize({ width: latime, height: Math.max(latime < 800 ? 844 : 900, Math.min(h, 2200)) });
          await asteapta(300);
          await p.screenshot({ path: path.join(CAPTURI, `B1.${latime < 800 ? (lang === 'ro' ? '3' : '4') : '5'}-panou-${lang}-${latime}.png`) });
          await ctx.close();
        }
      }
    } finally { await br.close(); }
  }
}

(async () => {
  await testeServer();
  let pw = null;
  try { pw = require('playwright'); } catch (e) { console.log('  (Playwright lipsește — partea B sărită)'); }
  if (pw) await testeBrowser();
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
