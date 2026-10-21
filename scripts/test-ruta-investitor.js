// scripts/test-ruta-investitor.js
// Ruta de investitor și „Rolurile mele” în browser (pasul 11-L, 17 oct. 2026),
// în RO și EN, la 390 și 1366 px:
//   A. fără sesiune: „Devino investitor” → autentificare (index.html?reason=cont),
//      cu revenirea reținută; după autentificare, revenirea redeschide ruta;
//   B. fereastra rutei se închide cu X, Esc și „Înapoi” (pasul 1), iar după
//      închidere pagina se derulează din nou și focusul revine pe buton;
//   C. pașii 1 → 5 cu datele salvate pe server (API simulat cu stare): la pasul 2,
//      încărcarea unui JPEG și a unui PDF (simulată) arată previzualizarea; un
//      fișier de alt tip e refuzat cu mesaj; la final, rolul de investitor e
//      adăugat și pagina arată banda „verificarea identității e în curs”;
//   C2. subscrierea, cu rolul de investitor: „Intră în rundă” deschide achiziția
//      (ticket, instrument, NDA) și o trimite la api/investitori/subscrie (simulat);
//   D. „Rolurile mele”: rolurile active, un rol de adăugat, comutarea rolului →
//      dashboard-ul corect;
//   E. 0 erori JS și nimic nu iese din ecran.
// Sesiunea Supabase și API-urile cu cont sunt simulate (nimic nu ajunge la
// Supabase sau la producție). Serverul local: scripts/server-test.js.
//
// Cerințe (nu e dependență a proiectului):
//   npm i --no-save playwright && npx playwright install chromium
// Rulare: node scripts/test-ruta-investitor.js

const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const UTILIZATOR = { id: '20000000-0000-4000-8000-0000000000c1', email: 'client.test@example.com', email_confirmed_at: '2026-10-01T08:00:00Z', user_metadata: { prenume: 'Ana', nume: 'Test' } };

// Rulează în pagină înaintea scripturilor: clientul Supabase simulat (ca în
// scripts/detector-ro.js), cu sau fără sesiune; încărcările în storage se
// înregistrează în window.__incarcari.
function sesiuneSimulata(cfg) {
  const user = cfg.user;
  const sesiune = cfg.cuSesiune ? { access_token: 'token-simulat', user } : null;
  const lant = (rezultat) => {
    const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rezultat) : () => p), apply: () => p });
    return p;
  };
  window.__incarcari = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: sesiune ? user : null }, error: null }),
      getSession: async () => ({ data: { session: sesiune }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: () => lant({ data: null, error: null }),
    rpc: () => lant({ data: { error: 'simulat' }, error: null }),
    storage: {
      from: (bucket) => ({
        uploadToSignedUrl: async (path, token, fisier, opt) => {
          window.__incarcari.push({ bucket, path, token, tip: (opt && opt.contentType) || fisier.type, marime: fisier.size });
          return { data: { path }, error: null };
        },
      }),
    },
    channel: () => lant({}),
    removeChannel: () => {},
  };
  const auth = new Proxy({
    getCurrentUser: async () => (sesiune ? user : null),
    getUserRoles: async () => [],
    performLogout: () => {},
  }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (nume, val) => Object.defineProperty(window, nume, { configurable: true, get: () => val, set: () => {} });
  fix('supabaseClient', client);
  fix('MyDarrinAuth', auth);
}

// API-ul simulat, cu stare, pentru un client care devine investitor.
function serverSimulat() {
  const stare = { roles: ['client'], kyc: null, subscrieri: [] };
  const lipsa = () => {
    const k = stare.kyc || {};
    const l = [];
    if (!k.date_personale) l.push('date_personale');
    if (!k.iban_mascat) l.push('cont_bancar');
    if (!k.tip_document) l.push('tip_document');
    if (!k.document_fata_path) l.push('document_fata');
    if (k.tip_document && k.tip_document !== 'pasaport' && !k.document_verso_path) l.push('document_verso');
    if (!k.mifid_raspunsuri) l.push('mifid');
    if (!k.pep_declaratie) l.push('pep');
    if (!k.sanctiuni_declarat) l.push('sanctiuni');
    if (!k.rezidenta_fiscala_tara) l.push('rezidenta_fiscala');
    return l;
  };
  const profil = () => ({
    ok: true, email: UTILIZATOR.email, nume: 'Ana Test', prenume: 'Ana', nume_familie: 'Test', telefon: '+40700000001', tara: 'RO',
    roles: stare.roles.slice(), roluri_dashboard: stare.roles.filter((r) => r !== 'client').length ? stare.roles.filter((r) => r !== 'client') : ['client'],
    destinatie: null, tip_destinatie: null, furnizor_propriu: false, partener: null,
    investitor: stare.kyc ? { status: stare.kyc.status, pas_curent: stare.kyc.pas_curent, trimis_la: null, motiv_respingere: null, motiv_respingere_en: null } : null,
  });
  function kyc(metoda, corp) {
    if (metoda === 'GET') return [200, { ok: true, kyc: stare.kyc, lipsa: lipsa(), cont: { prenume: 'Ana', nume: 'Test', email: UTILIZATOR.email, telefon: '+40700000001', tara: 'RO' } }];
    const k = stare.kyc || (stare.kyc = { status: 'ciorna', pas_curent: 1 });
    const d = corp.date || {};
    if (corp.pas === 1) {
      if (!d.prenume || !d.nume || !d.telefon || !d.tara) return [400, { error: 'Completează prenumele, numele, telefonul și țara.', error_en: 'Fill in your first name, last name, phone and country.' }];
      if (!d.iban && !k.iban_mascat) return [400, { error: 'Contul bancar (IBAN) e obligatoriu.', error_en: 'The bank account (IBAN) is required.' }];
      k.date_personale = { prenume: d.prenume, nume: d.nume, telefon: d.telefon, tara: d.tara };
      if (d.iban) k.iban_mascat = '•••• ' + d.iban.slice(-4);
    } else if (corp.pas === 2) {
      if (!d.tip_document || !d.document_fata_path || (d.tip_document !== 'pasaport' && !d.document_verso_path)) return [400, { error: 'Încarcă documentele.', error_en: 'Upload the documents.' }];
      Object.assign(k, { tip_document: d.tip_document, document_fata_path: d.document_fata_path, document_verso_path: d.document_verso_path, document_fata: true, document_verso: !!d.document_verso_path });
    } else if (corp.pas === 3) {
      Object.assign(k, { mifid_raspunsuri: d.mifid, pep_declaratie: { este_pep: d.este_pep }, sanctiuni_declarat: d.sanctiuni_declarat });
    } else if (corp.pas === 4) {
      k.rezidenta_fiscala_tara = d.rezidenta_fiscala_tara;
    } else if (corp.pas === 5) {
      if (!d.confirma) return [400, { error: 'Bifează confirmarea datelor.', error_en: 'Tick the confirmation of your details.' }];
      if (lipsa().length) return [400, { error: 'Dosarul nu e complet.', error_en: 'Your file is not complete.', lipsa: lipsa() }];
      k.status = 'in_verificare';
      if (!stare.roles.includes('investor')) stare.roles.push('investor');
      return [200, { ok: true, kyc: k, lipsa: [], roles: stare.roles }];
    }
    k.pas_curent = Math.min(5, corp.pas + 1);
    return [200, { ok: true, kyc: k, lipsa: lipsa() }];
  }
  return { stare, profil, kyc };
}

let ok = 0, esec = 0;
function verifica(cond, mesaj) { if (cond) ok++; else { esec++; console.log('  ✗ ' + mesaj); } }

async function context(browser, baza, { lang, latime, cuSesiune, server }) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: 860 } });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('myd_lang_v1', l);
      localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), versiune: 1 }));
    } catch (e) {}
  }, lang);
  await ctx.addInitScript(sesiuneSimulata, { user: UTILIZATOR, cuSesiune });
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  if (server) {
    const raspunde = (r, [cod, corp]) => r.fulfill({ status: cod, contentType: 'application/json', body: JSON.stringify(corp) });
    await ctx.route(/\/api\/cont\/profil/, (r) => raspunde(r, [200, server.profil()]));
    await ctx.route(/\/api\/investitori\/kyc(\?|$)/, (r) => {
      const req = r.request();
      return raspunde(r, server.kyc(req.method(), req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null));
    });
    await ctx.route(/\/api\/investitori\/subscrie/, (r) => {
      const c = JSON.parse(r.request().postData() || '{}');
      server.stare.subscrieri.push(c);
      return raspunde(r, [200, { ok: true, portofoliu: { id: 'sub-1', status: 'in_asteptare' }, actiuni: 1000, moneda: 'EUR', procent_estimat: 1, kyc_status: 'in_verificare' }]);
    });
    // 11-J: runda deschisă vine din api/investitori/portofoliu (valori de test, nu reale)
    await ctx.route(/\/api\/investitori\/portofoliu/, (r) => raspunde(r, [200, {
      ok: true, kyc_status: 'in_verificare', actiuni: 0, valoare_investita: 0, in_asteptare: 0, pct_companie: 0, subscrieri: [],
      runda: { id: 'r1', denumire_ro: 'Runda de test', denumire_en: 'Test round', moneda: 'EUR', suma_tinta: 100000, investitie_minima: 5000,
        pret_actiune: 10, equity_oferit_pct: 10, tickete: [5000, 10000], instrumente: ['actiuni', 'safe'] },
      exit: { buyback_disponibil: false, discount_buyback_pct: null, lock_up_luni: null },
    }]));
    await ctx.route(/\/api\/public\/runda-curenta/, (r) => raspunde(r, [200, { ok: true, runda: null }]));
    // 2.5: fără verificarea identității aprobată, indicatorii nu se trimit
    await ctx.route(/\/api\/investitori\/indicatori/, (r) => raspunde(r, [403, { cod: 'KYC_NEAPROBAT',
      error: 'Indicatorii financiari sunt disponibili după aprobarea verificării identității tale.',
      error_en: 'The financial indicators are available after your identity verification is approved.' }]));
    await ctx.route(/\/api\/investitori\/kyc-document/, (r) => {
      const req = r.request();
      if (req.method() === 'POST') {
        const c = JSON.parse(req.postData() || '{}');
        const ext = { 'image/jpeg': 'jpg', 'application/pdf': 'pdf' }[c.mime] || 'bin';
        return raspunde(r, [200, { ok: true, path: `${UTILIZATOR.id}/${c.latura}-1-abc.${ext}`, token: 'tok', signed_url: null }]);
      }
      return raspunde(r, [200, { ok: true, url: 'about:blank' }]);
    });
  }
  return ctx;
}

// Deschide ruta de la tastatură (focus + Enter): butonul flotant Darrin AI
// sau o notificare pot acoperi butonul la unele lățimi.
async function deschide(p, sel) {
  await p.focus(sel);
  await p.keyboard.press('Enter');
}

// În EN, textul vizibil al ferestrei nu are diacritice românești (detectorul simplu;
// numele proprii, ex. Home Best Pal, nu au diacritice).
async function romanaInEn(p, lang, sel) {
  if (lang !== 'en') return '';
  const t = await p.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);
  const m = t.match(/[^\n]*[ăâîșțşţĂÂÎȘȚ][^\n]*/);
  return m ? m[0].slice(0, 120) : '';
}

async function depaseste(p) {
  return p.evaluate(() => {
    const W = innerWidth;
    let max = document.documentElement.scrollWidth;
    document.querySelectorAll('#mi-fond *, main *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > max && getComputedStyle(el).visibility !== 'hidden') max = r.right;
    });
    return max > W + 1 ? Math.round(max) : 0;
  });
}

(async () => {
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const lang of ['ro', 'en']) {
      for (const latime of [390, 1366]) {
        const et = `${lang} ${latime}px`;

        // ── A. Fără sesiune → autentificare, cu revenire la rută ─────────
        {
          const ctx = await context(browser, baza, { lang, latime, cuSesiune: false, server: serviciuGol() });
          const p = await ctx.newPage();
          const erori = []; p.on('pageerror', (e) => erori.push(e.message));
          await p.goto(baza + '/mydarrin-investitori', { waitUntil: 'networkidle' });
          await p.click('#ghid-investitor button.btn-p');
          await p.waitForURL(/index\.html\?reason=cont/, { timeout: 8000 }).catch(() => {});
          verifica(/reason=cont/.test(p.url()), `${et} A: fără sesiune, „Devino investitor” duce la autentificare`);
          const revenire = await p.evaluate(() => sessionStorage.getItem('myd_revenire_dupa_login'));
          verifica(revenire === '/mydarrin-investitori.html?ruta=investitor', `${et} A: revenirea după login e reținută (${revenire})`);
          verifica(erori.length === 0, `${et} A: 0 erori JS (${erori.join(' | ')})`);
          await ctx.close();
        }

        // ── B–C. Cu sesiune: revenirea deschide ruta; închidere; pașii 1–5 ──
        const server = serverSimulat();
        const ctx = await context(browser, baza, { lang, latime, cuSesiune: true, server });
        const p = await ctx.newPage();
        const erori = []; p.on('pageerror', (e) => erori.push(e.message));
        p.on('dialog', (d) => d.accept());
        await p.goto(baza + '/mydarrin-investitori.html?ruta=investitor', { waitUntil: 'networkidle' });
        await p.waitForSelector('#mi-fer', { timeout: 8000 }).catch(() => {});
        verifica(await p.isVisible('#mi-fer'), `${et} B: după autentificare, revenirea deschide ruta de investitor`);
        verifica(await p.inputValue('#mi-email') === UTILIZATOR.email, `${et} B: emailul contului e precompletat`);
        verifica(await p.inputValue('#mi-prenume') === 'Ana', `${et} B: prenumele e precompletat`);

        // închidere cu X
        await p.click('#mi-x');
        verifica(!(await p.$('#mi-fond')), `${et} B: X închide fereastra`);
        verifica(await p.evaluate(() => document.body.style.overflow === ''), `${et} B: după X, pagina se derulează din nou`);
        // redeschidere din buton, apoi Esc; focusul revine pe buton
        const buton = '#ghid-investitor button.btn-p';
        await deschide(p, buton);
        await p.waitForSelector('#mi-fer');
        await p.keyboard.press('Escape');
        verifica(!(await p.$('#mi-fond')), `${et} B: Esc închide fereastra`);
        verifica(await p.evaluate((s) => document.activeElement === document.querySelector(s), buton), `${et} B: focusul revine pe butonul care a deschis fereastra`);
        // „Înapoi” la pasul 1 închide
        await deschide(p, buton);
        await p.waitForSelector('#mi-fer');
        await p.click('#mi-inapoi');
        verifica(!(await p.$('#mi-fond')) && await p.evaluate(() => document.body.style.overflow === ''), `${et} B: „Înapoi” (pasul 1) închide fereastra, pagina se derulează`);

        // pașii
        await deschide(p, buton);
        await p.waitForSelector('#mi-fer');
        verifica(await depaseste(p) === 0, `${et} C: fereastra nu iese din ecran (pasul 1)`);
        { const r = await romanaInEn(p, lang, '#mi-fer'); verifica(!r, `${et} C: pasul 1 fără text românesc în EN (${r})`); }
        await p.fill('#mi-iban', 'RO49AAAA1B31007593840000');
        await p.selectOption('#mi-tara', 'RO');
        await p.click('#mi-continua');
        await p.waitForSelector('input[name="mi-tip"]', { timeout: 5000 });
        verifica(server.stare.kyc && server.stare.kyc.date_personale && server.stare.kyc.pas_curent === 2, `${et} C: pasul 1 salvat pe server`);
        // pasul 2: tip, fișier refuzat, JPEG (previzualizare), PDF
        await p.check('input[name="mi-tip"][value="ci"]');
        await p.setInputFiles('#mi-fisier-fata', { name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
        verifica(await p.isVisible('.mi-slot[data-latura="fata"] .mi-err'), `${et} C: un fișier .txt e refuzat, cu mesaj`);
        await p.setInputFiles('#mi-fisier-fata', { name: 'buletin.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]) });
        await p.waitForSelector('.mi-slot[data-latura="fata"] .mi-previz img', { timeout: 5000 }).catch(() => {});
        verifica(!!(await p.$('.mi-slot[data-latura="fata"] .mi-previz img')), `${et} C: JPEG încărcat → previzualizare`);
        await p.setInputFiles('#mi-fisier-verso', { name: 'verso.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') });
        await p.waitForSelector('.mi-slot[data-latura="verso"] .mi-pdf', { timeout: 5000 }).catch(() => {});
        verifica(!!(await p.$('.mi-slot[data-latura="verso"] .mi-pdf')), `${et} C: PDF încărcat → previzualizare PDF`);
        const incarcari = await p.evaluate(() => window.__incarcari);
        verifica(incarcari.length === 2 && incarcari.every((x) => x.bucket === 'investitori-kyc' && x.path.startsWith(UTILIZATOR_ID())), `${et} C: fișierele merg în bucket-ul privat, pe calea contului`);
        verifica(!!(await p.$('[data-sterge="fata"]')) && !!(await p.$('label[for="mi-fisier-fata"]')), `${et} C: butoanele „Șterge” și „Înlocuiește”`);
        verifica(await depaseste(p) === 0, `${et} C: fereastra nu iese din ecran (pasul 2)`);
        { const r = await romanaInEn(p, lang, '#mi-fer'); verifica(!r, `${et} C: pasul 2 fără text românesc în EN (${r})`); }
        await p.click('#mi-continua');
        await p.waitForSelector('input[name="mi-experienta"]', { timeout: 5000 });
        // pasul 3
        { const r = await romanaInEn(p, lang, '#mi-fer'); verifica(!r, `${et} C: pasul 3 fără text românesc în EN (${r})`); }
        await p.check('input[name="mi-experienta"][value="1"]');
        await p.check('input[name="mi-toleranta"][value="0"]');
        await p.check('input[name="mi-scop"][value="1"]');
        await p.check('input[name="mi-pep"][value="nu"]');
        await p.check('#mi-sanctiuni');
        await p.click('#mi-continua');
        await p.waitForSelector('#mi-rezidenta', { timeout: 5000 });
        // pasul 4 → „Continuă mai târziu” salvează și închide; redeschiderea continuă de unde a rămas
        await p.selectOption('#mi-rezidenta', 'RO');
        await p.click('#mi-mai-tarziu');
        await p.waitForSelector('#mi-fond', { state: 'detached', timeout: 5000 }).catch(() => {});
        verifica(!(await p.$('#mi-fond')) && server.stare.kyc.rezidenta_fiscala_tara === 'RO', `${et} C: „Continuă mai târziu” salvează pe server și închide`);
        await deschide(p, buton);
        await p.waitForSelector('#mi-confirma', { timeout: 5000 }).catch(() => {});
        verifica(!!(await p.$('#mi-confirma')), `${et} C: la redeschidere, ruta continuă de la pasul salvat (5)`);
        { const r = await romanaInEn(p, lang, '#mi-fer'); verifica(!r, `${et} C: pasul 5 fără text românesc în EN (${r})`); }
        await p.check('#mi-confirma');
        await p.click('#mi-continua');
        await p.waitForURL(/bun_venit=1|mydarrin-investitori/, { timeout: 8000 }).catch(() => {});
        await p.waitForSelector('#inv-kyc-stare', { timeout: 8000 }).catch(() => {});
        verifica(server.stare.roles.includes('client') && server.stare.roles.includes('investor'), `${et} C: rolul investor e adăugat lângă client`);
        verifica(await p.isVisible('#inv-kyc-stare'), `${et} C: dashboard-ul arată banda verificării identității`);
        { const r = await romanaInEn(p, lang, '#inv-kyc-stare'); verifica(!r, `${et} C: banda fără text românesc în EN (${r})`); }
        await p.waitForSelector('#inv-indicatori-mesaj', { timeout: 5000 }).catch(() => {});
        verifica(/verific|verification/i.test(await p.textContent('#inv-indicatori-mesaj').catch(() => '')), `${et} C: fără KYC aprobat, indicatorii arată mesajul de verificare`);
        verifica(!(await p.$('#inv-indicatori-grila')), `${et} C: fără KYC aprobat, nicio cifră a platformei`);
        { const r = await romanaInEn(p, lang, '#inv-private-dashboard'); verifica(!r, `${et} C: dashboard-ul fără text românesc în EN (${r})`); }
        // C2. subscrierea, pe cont
        await deschide(p, '#runda button');
        await p.waitForSelector('#modal-runda', { state: 'visible', timeout: 5000 }).catch(() => {});
        verifica(await p.isVisible('#step-2'), `${et} C2: cu rolul de investitor, „Intră în rundă” deschide achiziția`);
        await p.waitForSelector('#step-2 .ticket-opt', { timeout: 5000 }).catch(() => {});
        await p.click('#step-2 .ticket-opt >> nth=1');
        await p.click('[onclick*="selectInstrument(this,\'safe\')"]');
        await p.click('#step-2 button[onclick="goStep(3)"]');
        await p.check('#nda-check');
        await p.click('#submit-invest-btn');
        await p.waitForSelector('#step-4', { state: 'visible', timeout: 6000 }).catch(() => {});
        const sub = server.stare.subscrieri[0] || {};
        verifica(sub.suma === 10000 && sub.actiuni === undefined && sub.instrument === 'safe', `${et} C2: subscrierea trimite suma și instrumentul din rundă, fără acțiuni calculate în browser (${JSON.stringify(sub)})`);
        verifica((await p.textContent('#confirm-actiuni')).replace(/\D/g, '') === '1000', `${et} C2: acțiunile din confirmare vin de la server`);
        verifica(await p.isVisible('#step-4'), `${et} C2: confirmarea subscrierii`);
        await p.keyboard.press('Escape');
        verifica(await p.evaluate(() => document.body.style.overflow === ''), `${et} C2: după închidere, pagina se derulează`);
        verifica(erori.length === 0, `${et} B–C: 0 erori JS (${erori.join(' | ')})`);
        await ctx.close();

        // ── D. „Rolurile mele” ──────────────────────────────────────────
        {
          const srvR = serverSimulat();
          srvR.stare.roles = ['client', 'investor', 'partener_servicii'];
          srvR.stare.kyc = { status: 'in_verificare', pas_curent: 5 };
          const ctxR = await context(browser, baza, { lang, latime, cuSesiune: true, server: srvR });
          const pr = await ctxR.newPage();
          const erR = []; pr.on('pageerror', (e) => erR.push(e.message));
          await pr.goto(baza + '/mydarrin-rolurile-mele', { waitUntil: 'networkidle' });
          await pr.waitForSelector('#rm-active .card', { timeout: 8000 }).catch(() => {});
          const active = await pr.$$eval('#rm-active .card', (c) => c.map((x) => x.getAttribute('data-rol')));
          verifica(['client', 'partener_servicii', 'investor'].every((r) => active.includes(r)), `${et} D: rolurile active (${active.join(',')})`);
          const deAdaugat = await pr.$$eval('#rm-adauga .card', (c) => c.map((x) => x.getAttribute('data-rol')));
          verifica(deAdaugat.includes('partener_materiale'), `${et} D: un rol de adăugat (${deAdaugat.join(',')})`);
          verifica(await pr.isVisible('#rm-comuta'), `${et} D: comutatorul de rol apare (mai multe roluri)`);
          { const r = await romanaInEn(pr, lang, 'main'); verifica(!r, `${et} D: „Rolurile mele” fără text românesc în EN (${r})`); }
          verifica(await depaseste(pr) === 0, `${et} D: nimic nu iese din ecran`);
          await pr.selectOption('#rm-comuta', 'investor');
          await Promise.all([pr.waitForURL(/mydarrin-investitori/, { timeout: 8000 }).catch(() => {}), pr.click('#rm-comuta-mergi')]);
          verifica(/mydarrin-investitori/.test(pr.url()), `${et} D: comutarea pe investitor → dashboard-ul investitorului`);
          verifica(await pr.evaluate(() => localStorage.getItem('myd_rol_activ_v1')) === 'investor', `${et} D: rolul activ reținut`);
          verifica(erR.length === 0, `${et} D: 0 erori JS (${erR.join(' | ')})`);
          await ctxR.close();
        }
        console.log(`${et}: gata`);
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

function serviciuGol() { return serverSimulat(); }
function UTILIZATOR_ID() { return UTILIZATOR.id + '/'; }
