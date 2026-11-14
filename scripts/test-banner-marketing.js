// scripts/test-banner-marketing.js
// Pasul 11-A3 (13 nov. 2026): bannerul de cookie-uri cu categoria „Marketing”
// și pornirea pixelilor (macheta aprobată de LM).
//
// Fără rețea externă: serverul local (scripts/server-test.js) și Playwright, cu
// cererile spre Google / Meta / TikTok / LinkedIn interceptate (numărate, nu trimise).
//
// Verifică:
//   1. implicit, marketing e oprit (fără acord: banner, comutatorul oprit, nimic încărcat);
//   2. „Acceptă toate” pornește analitice + marketing (GA4 și pixelul Meta);
//   3. „Doar esențiale” le oprește pe amândouă (nimic încărcat);
//   4. comutatorul Marketing din panou pornește pixelul (PageView) și, oprit,
//      îl oprește pe loc (consent revoke, fără alte evenimente, cookie-urile
//      _fbp / _fbc șterse), iar la pagina următoare scriptul nu se mai încarcă;
//   5. acordul vechi (versiune 1) aduce bannerul o singură dată: până la alegere,
//      analiticele rămân; după alegere (versiune 2), bannerul nu mai apare;
//   6. linkul „Setări cookie-uri” din subsol redeschide panoul (subsolul comun
//      și rândul adăugat pe paginile fără subsol); Escape închide panoul;
//   7. ordinea butoanelor: pe telefon Acceptă toate, Personalizează, Doar esențiale
//      (pe verticală, textul scurt); pe desktop, ordinea de azi (textul lung);
//   8. textele aprobate, în RO și EN (bara, panoul, linkul din subsol), eticheta
//      „NOU” / „NEW”; politica de confidențialitate are paragrafele noi în RO și EN;
//   9. fără ID setat, nimic nu se încarcă nici cu marketing acceptat.
//
// Rulare: node scripts/test-banner-marketing.js

const fs = require('fs');
const path = require('path');
const { porneste } = require('./server-test');

const R = path.join(__dirname, '..');
let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

const ID_META = '123456789012345';
const CHEIE = 'myd_cookie_consent_v1';

const TEXTE = {
  ro: {
    bara: 'Folosim cookie-uri esențiale ca platforma să funcționeze. Cu acordul tău, folosim și cookie-uri analitice (cum e folosită platforma) și de marketing (cât de utile sunt reclamele noastre pe Facebook, Instagram, TikTok și LinkedIn). Politica de confidențialitate',
    scurt: 'Folosim cookie-uri esențiale ca platforma să funcționeze. Cu acordul tău, folosim și cookie-uri analitice și de marketing. Politica de confidențialitate',
    butoane: ['Doar esențiale', 'Personalizează', 'Acceptă toate'],
    titlu: 'Setări cookie-uri',
    intro: 'Alegi ce cookie-uri permiți. Poți schimba oricând din subsolul paginii.',
    randuri: [
      'Esențiale Necesare pentru cont, coș și securitate. Mereu active.',
      'Analitice Statistici anonime de navigare (Google Analytics), ca să îmbunătățim platforma.',
      'Marketing NOU Ne arată ce reclame (Facebook, Instagram, TikTok, LinkedIn) te-au adus aici și ne ajută să le arătăm celor interesați. Nu trimitem numele, emailul sau telefonul tău.',
    ],
    panouButoane: ['Salvează alegerea', 'Acceptă toate'],
    link: 'Setări cookie-uri',
  },
  en: {
    bara: 'We use essential cookies to make the platform work. With your consent, we also use analytics cookies (how the platform is used) and marketing cookies (how useful our ads on Facebook, Instagram, TikTok and LinkedIn are). Privacy policy',
    scurt: 'We use essential cookies to make the platform work. With your consent, we also use analytics and marketing cookies. Privacy policy',
    butoane: ['Essential only', 'Customise', 'Accept all'],
    titlu: 'Cookie settings',
    intro: 'Choose which cookies you allow. You can change this any time from the page footer.',
    randuri: [
      'Essential Needed for your account, cart and security. Always on.',
      'Analytics Anonymous browsing statistics (Google Analytics), to improve the platform.',
      'Marketing NEW Shows which ads (Facebook, Instagram, TikTok, LinkedIn) brought you here and helps us show them to interested people. We never send your name, email or phone.',
    ],
    panouButoane: ['Save my choice', 'Accept all'],
    link: 'Cookie settings',
  },
};
const NOU_ACTIV = Date.now() < Date.UTC(2027, 0, 12);

// ── static: subsolurile și politica de confidențialitate ────────────
function testeStatice() {
  const pagini = fs.readdirSync(R).filter((f) => f.endsWith('.html'));
  let cuSubsol = 0;
  for (const f of pagini) {
    const s = fs.readFileSync(path.join(R, f), 'utf8');
    if (!s.includes('src="/cookie-consent.js"')) continue;
    if (/Confidențialitate &amp; GDPR<\/a><\/li>/.test(s)) {
      cuSubsol++;
      verifica(/<li><a href="#" data-myd-cookie-setari>Setări cookie-uri<\/a><\/li>/.test(s), `${f}: subsolul nu are linkul „Setări cookie-uri”`);
    }
  }
  verifica(cuSubsol >= 30, `prea puține subsoluri verificate: ${cuSubsol}`);
  const en = JSON.parse(fs.readFileSync(path.join(R, 'i18n', 'en.json'), 'utf8'));
  verifica(en._texte['Setări cookie-uri'] === 'Cookie settings', 'en.json: lipsește traducerea linkului „Setări cookie-uri”');

  // Politica: paragrafele noi (pasul 11-A3), fiecare cu traducerea în engleză.
  const pol = fs.readFileSync(path.join(R, 'mydarrin-politica-confidentialitate.html'), 'utf8');
  const polEn = JSON.parse(fs.readFileSync(path.join(R, 'i18n', 'en', 'mydarrin-politica-confidentialitate.json'), 'utf8'))._texte;
  const noi = [
    'Cookie-uri de marketing (cu consimțământ)',
    'Cookie-uri de marketing, doar cu acordul dumneavoastră (detalii în Art. 7).',
    'Măsurarea reclamelor (cookie-uri de marketing)',
    'între 7 zile și 13 luni, după furnizor (detalii în Art. 7).',
    '(Facebook, Instagram) — cookie-urile _fbp și _fbc, păstrate până la 90 de zile.',
    '— cookie-urile _ttp, ttclid și ttcsid, păstrate 13 luni de la ultima folosire.',
  ];
  for (const t of noi) {
    verifica(pol.includes(t), `politica nu conține: ${t}`);
    verifica(typeof polEn[t] === 'string' && polEn[t].length > 0, `politica, fără traducere EN: ${t}`);
  }
  for (const f of ['Meta Platforms Ireland Ltd.', 'TikTok Technology Limited', 'LinkedIn Ireland Unlimited Company', 'Setări cookie-uri']) {
    verifica(pol.includes(f), `politica nu numește: ${f}`);
  }
}

// ── în browser ──────────────────────────────────────────────────────
async function testeBrowser() {
  const { chromium } = require('playwright');
  const srv = await porneste(0);
  const B = 'http://localhost:' + srv.address().port;
  const br = await chromium.launch();

  async function context({ acord, pixeli, viewport, lang } = {}) {
    const ctx = await br.newContext({ viewport: viewport || { width: 1280, height: 800 } });
    const cereri = [];
    await ctx.route(/googletagmanager\.com|google-analytics\.com|connect\.facebook\.net|analytics\.tiktok\.com|snap\.licdn\.com/, (rt) => {
      cereri.push(rt.request().url());
      return rt.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    });
    await ctx.route('**/api/public/config-masurare', (rt) => {
      cereri.push(rt.request().url());
      return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, pixeli: pixeli === undefined ? { meta: ID_META } : pixeli }) });
    });
    await ctx.route('**/_vercel/insights/**', (rt) => rt.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await ctx.addInitScript(([a, l]) => {
      try {
        if (l) localStorage.setItem('myd_lang_v1', l);
        // Doar la prima încărcare: reîncărcările păstrează alegerea din banner.
        if (a && !sessionStorage.getItem('acord_pus')) { localStorage.setItem('myd_cookie_consent_v1', a); sessionStorage.setItem('acord_pus', '1'); }
      } catch (e) {}
    }, [acord ? JSON.stringify(acord) : null, lang || 'ro']);
    const page = await ctx.newPage();
    const erori = [];
    page.on('pageerror', (e) => erori.push(e.message));
    return { ctx, page, cereri, erori };
  }
  async function mergi(page, cale) {
    await page.goto(B + cale, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MYD_CONSENT && !!window.MYD_MASURARE, null, { timeout: 15000 });
    await page.waitForTimeout(400);
  }
  const acordul = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), CHEIE);
  const banner = (page) => page.evaluate(() => !!document.getElementById('myd-consent-bar'));
  const coadaFbq = (page) => page.evaluate(() => (window.fbq && window.fbq.queue ? window.fbq.queue.map((a) => Array.from(a)) : null));
  const PAGINA = '/cum-devii-curier-de-cartier.html';

  // 1. implicit, marketing e oprit.
  {
    const { ctx, page, cereri, erori } = await context();
    await mergi(page, PAGINA);
    verifica(await banner(page), 'fără acord: bannerul nu apare');
    verifica(await page.evaluate(() => window.MYD_CONSENT.marketingAllowed() === false && window.MYD_CONSENT.analyticsAllowed() === false), 'fără acord: o categorie e pornită');
    await page.click('[data-myd-act="personalizeaza"]');
    const st = await page.evaluate(() => ({
      a: document.getElementById('myd-consent-toggle-analitice').getAttribute('aria-checked'),
      m: document.getElementById('myd-consent-toggle-marketing').getAttribute('aria-checked'),
      mOn: document.getElementById('myd-consent-toggle-marketing').classList.contains('on'),
    }));
    verifica(st.m === 'false' && !st.mOn && st.a === 'false', `panoul, implicit: ${JSON.stringify(st)}`);
    verifica(!cereri.length, `fără acord s-a încărcat ceva: ${cereri}`);
    verifica(!erori.length, `erori JS: ${erori}`);
    await ctx.close();
  }

  // 2. „Acceptă toate” pornește ambele categorii.
  {
    const { ctx, page, cereri } = await context();
    await mergi(page, PAGINA);
    await page.click('#myd-consent-bar [data-myd-act="accepta-toate"]');
    await page.waitForTimeout(500);
    const a = await acordul(page);
    verifica(a && a.analitice === true && a.marketing === true && a.versiune === 2, `Acceptă toate: ${JSON.stringify(a)}`);
    verifica(!(await banner(page)), 'Acceptă toate: bannerul rămâne');
    verifica(cereri.some((u) => /googletagmanager/.test(u)), 'Acceptă toate: GA4 nu pornește');
    verifica(cereri.some((u) => /connect\.facebook\.net/.test(u)), 'Acceptă toate: pixelul Meta nu pornește');
    const q = await coadaFbq(page);
    verifica(q && q.some((x) => x[0] === 'track' && x[1] === 'PageView'), `Acceptă toate: fără PageView: ${JSON.stringify(q)}`);
    // Din panou, „Acceptă toate” face același lucru.
    await page.evaluate(() => { localStorage.removeItem('myd_cookie_consent_v1'); window.MYD_CONSENT.openPreferences(); });
    await page.click('#myd-consent-panel [data-myd-act="accepta-toate"]');
    const b = await acordul(page);
    verifica(b && b.analitice && b.marketing && !(await page.evaluate(() => !!document.getElementById('myd-consent-panel'))), `panoul, Acceptă toate: ${JSON.stringify(b)}`);
    await ctx.close();
  }

  // 3. „Doar esențiale” le oprește pe amândouă.
  {
    const { ctx, page, cereri } = await context();
    await mergi(page, PAGINA);
    const inainte = cereri.length;
    await page.click('#myd-consent-bar [data-myd-act="doar-esentiale"]');
    await page.waitForTimeout(300);
    const a = await acordul(page);
    verifica(a && a.analitice === false && a.marketing === false && a.versiune === 2, `Doar esențiale: ${JSON.stringify(a)}`);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    verifica(!(await banner(page)), 'Doar esențiale: bannerul reapare');
    verifica(cereri.length === inainte, `Doar esențiale: s-a încărcat ceva: ${cereri.slice(inainte)}`);
    await ctx.close();
  }

  // 4. comutatorul Marketing pornește și oprește pixelii.
  {
    const { ctx, page, cereri, erori } = await context({ acord: { analitice: true, marketing: false, versiune: 2, data: new Date().toISOString() } });
    await mergi(page, PAGINA);
    verifica(!cereri.some((u) => /config-masurare|facebook/.test(u)), 'doar analitice: pixelul se încarcă');
    await page.click('a[data-myd-cookie-setari]');
    await page.click('#myd-consent-toggle-marketing');
    await page.click('[data-myd-act="salveaza"]');
    await page.waitForTimeout(500);
    let a = await acordul(page);
    verifica(a.marketing === true && a.analitice === true, `comutatorul pornit: ${JSON.stringify(a)}`);
    verifica(cereri.some((u) => /connect\.facebook\.net/.test(u)), 'comutatorul pornit: pixelul Meta nu se încarcă');
    let q = await coadaFbq(page);
    verifica(q && q.some((x) => x[1] === 'PageView'), 'comutatorul pornit: fără PageView');
    verifica(q && q.some((x) => x[0] === 'track' && x[1] === 'ViewContent'), `comutatorul pornit: partner_landing_view nu ajunge la pixel: ${JSON.stringify(q)}`);

    // Cookie-urile pixelului, apoi oprirea din panou.
    await page.evaluate(() => { document.cookie = '_fbp=fb.1.123.456; path=/'; document.cookie = '_fbc=fb.1.123.abc; path=/'; document.cookie = 'myd_altceva=1; path=/'; });
    await page.click('a[data-myd-cookie-setari]');
    verifica(await page.evaluate(() => document.getElementById('myd-consent-toggle-marketing').getAttribute('aria-checked')) === 'true', 'panoul nu arată marketingul pornit');
    await page.click('#myd-consent-toggle-marketing');
    await page.click('[data-myd-act="salveaza"]');
    await page.waitForTimeout(200);
    a = await acordul(page);
    verifica(a.marketing === false && a.analitice === true, `comutatorul oprit: ${JSON.stringify(a)}`);
    q = await coadaFbq(page);
    verifica(q && q.some((x) => x[0] === 'consent' && x[1] === 'revoke'), `oprire: fără fbq consent revoke: ${JSON.stringify(q)}`);
    const cookie = await page.evaluate(() => document.cookie);
    verifica(!/_fbp|_fbc/.test(cookie) && /myd_altceva/.test(cookie), `oprire: cookie-urile pixelului rămân (sau s-au șters altele): ${cookie}`);
    const lung = q.length;
    await page.evaluate(() => window.MYD_MASURARE.eveniment('add_to_cart', { item_type: 'service' }));
    q = await coadaFbq(page);
    verifica(q.length === lung, 'oprire: pixelul primește evenimente după retragere');
    verifica(await page.evaluate(() => window.MYD_MASURARE.jurnal.some((e) => e.nume === 'add_to_cart')), 'oprire: GA4 (analitice păstrate) nu mai primește evenimente');
    // Pornit din nou pe aceeași pagină: consent grant.
    await page.click('a[data-myd-cookie-setari]');
    await page.click('#myd-consent-toggle-marketing');
    await page.click('[data-myd-act="salveaza"]');
    await page.waitForTimeout(200);
    q = await coadaFbq(page);
    verifica(q.some((x) => x[0] === 'consent' && x[1] === 'grant'), 'repornire: fără fbq consent grant');
    // Oprit și pagina următoare: scriptul nu se mai încarcă.
    await page.click('a[data-myd-cookie-setari]');
    await page.click('#myd-consent-toggle-marketing');
    await page.click('[data-myd-act="salveaza"]');
    const fb = cereri.filter((u) => /facebook|config-masurare/.test(u)).length;
    await mergi(page, '/index.html');
    verifica(cereri.filter((u) => /facebook|config-masurare/.test(u)).length === fb && (await page.evaluate(() => typeof window.fbq)) === 'undefined', 'după retragere, pagina următoare încarcă pixelul');
    verifica(!erori.length, `erori JS: ${erori}`);
    await ctx.close();
  }

  // 5. acordul vechi (versiune 1): bannerul o singură dată, analiticele rămân.
  {
    const { ctx, page, cereri } = await context({ acord: { analitice: true, data: '2026-10-01T00:00:00Z', versiune: 1 } });
    await mergi(page, PAGINA);
    verifica(await banner(page), 'versiune 1: bannerul nu reapare');
    verifica(cereri.some((u) => /googletagmanager/.test(u)), 'versiune 1: analiticele nu mai pornesc până la alegere');
    verifica(!cereri.some((u) => /config-masurare|facebook/.test(u)), 'versiune 1: pixelii pornesc fără acord nou');
    await page.click('[data-myd-act="personalizeaza"]');
    const st = await page.evaluate(() => [document.getElementById('myd-consent-toggle-analitice').getAttribute('aria-checked'), document.getElementById('myd-consent-toggle-marketing').getAttribute('aria-checked')]);
    verifica(st[0] === 'true' && st[1] === 'false', `versiune 1, panoul: analitice / marketing = ${st}`);
    await page.click('[data-myd-act="salveaza"]');
    const a = await acordul(page);
    verifica(a.versiune === 2 && a.analitice === true && a.marketing === false, `versiune 1 → alegere: ${JSON.stringify(a)}`);
    await mergi(page, '/index.html');
    verifica(!(await banner(page)), 'versiune 1: bannerul apare și după alegere');
    await ctx.close();
  }

  // 6. linkul din subsol redeschide panoul; Escape; paginile fără subsol.
  {
    const { ctx, page } = await context({ acord: { analitice: false, marketing: false, versiune: 2, data: new Date().toISOString() } });
    await mergi(page, '/index.html');
    verifica(await page.evaluate(() => !!document.querySelector('footer a[data-myd-cookie-setari]')), 'index: linkul nu e în subsol');
    verifica(await page.evaluate(() => !document.querySelector('.myd-cookie-setari-rand')), 'index: rândul de rezervă apare deși există subsol');
    await page.click('footer a[data-myd-cookie-setari]');
    verifica(await page.evaluate(() => !!document.getElementById('myd-consent-panel') && location.hash === ''), 'linkul din subsol nu deschide panoul');
    await page.keyboard.press('Escape');
    verifica(await page.evaluate(() => !document.getElementById('myd-consent-panel') && !document.getElementById('myd-consent-bar')), 'Escape: panoul rămâne (sau apare bannerul deși există alegere)');
    for (const p of ['/mydarrin-cos.html', '/mydarrin-devino-partener-wizard.html', '/mydarrin-dashboard-partener.html']) {
      await mergi(page, p);
      const n = await page.evaluate(() => document.querySelectorAll('[data-myd-cookie-setari]').length);
      verifica(n === 1, `${p}: linkul „Setări cookie-uri” apare de ${n} ori`);
      await page.evaluate(() => document.querySelector('[data-myd-cookie-setari]').click()); // fără cont, fereastra de autentificare acoperă pagina
      verifica(await page.evaluate(() => !!document.getElementById('myd-consent-panel')), `${p}: linkul nu deschide panoul`);
    }
    await ctx.close();
  }

  // 7 + 8. ordinea butoanelor și textele, în RO și EN, pe telefon și desktop.
  for (const lang of ['ro', 'en']) {
    const t = TEXTE[lang];
    for (const [disp, vp] of [['desktop', { width: 1280, height: 800 }], ['telefon', { width: 390, height: 844 }]]) {
      const { ctx, page, erori } = await context({ viewport: vp, lang });
      await mergi(page, '/index.html?lang=' + lang);
      const r = await page.evaluate(() => {
        const vizibil = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
        const p = document.querySelector('#myd-consent-bar p');
        const text = [...p.childNodes].filter((n) => n.nodeType === 3 || vizibil(n)).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
        const b = [...document.querySelectorAll('#myd-consent-actions button')].map((x) => { const r = x.getBoundingClientRect(); return { t: x.textContent, x: r.left, y: r.top, h: r.height }; });
        const link = document.querySelector('footer a[data-myd-cookie-setari]');
        return { text, b, link: link && link.textContent.trim(), strong: [...p.querySelectorAll('strong')].filter(vizibil).map((s) => s.textContent) };
      });
      verifica(r.text === (disp === 'telefon' ? t.scurt : t.bara), `${lang} ${disp}: textul barei: „${r.text}”`);
      verifica(r.strong.join() === (lang === 'ro' ? 'analitice,marketing' : 'analytics,marketing'), `${lang} ${disp}: cuvintele îngroșate: ${r.strong}`);
      verifica(JSON.stringify(r.b.map((x) => x.t)) === JSON.stringify(t.butoane), `${lang} ${disp}: butoanele: ${r.b.map((x) => x.t)}`);
      if (disp === 'telefon') {
        const ordine = [...r.b].sort((x, y) => x.y - y.y).map((x) => x.t);
        verifica(JSON.stringify(ordine) === JSON.stringify([t.butoane[2], t.butoane[1], t.butoane[0]]), `${lang} telefon: ordinea de sus în jos: ${ordine}`);
        verifica(r.b.every((x) => x.h >= 44) && new Set(r.b.map((x) => Math.round(x.x))).size === 1, `${lang} telefon: butoanele nu sunt pe verticală, de 44px: ${JSON.stringify(r.b)}`);
      } else {
        const ordine = [...r.b].sort((x, y) => x.x - y.x).map((x) => x.t);
        verifica(JSON.stringify(ordine) === JSON.stringify(t.butoane) && new Set(r.b.map((x) => Math.round(x.y))).size === 1, `${lang} desktop: ordinea de la stânga la dreapta: ${ordine}`);
      }
      verifica(r.link === t.link, `${lang} ${disp}: linkul din subsol: „${r.link}”`);
      await page.click('[data-myd-act="personalizeaza"]');
      const p = await page.evaluate(() => {
        const el = document.getElementById('myd-consent-panel');
        const n = (s) => s.replace(/\s+/g, ' ').trim();
        return {
          titlu: n(el.querySelector('h3').textContent),
          intro: n(el.querySelector('.myd-consent-intro').textContent),
          randuri: [...el.querySelectorAll('.myd-consent-row')].map((r) => n([...r.querySelector('div').childNodes].map((c) => c.textContent).join(' '))),
          butoane: [...el.querySelectorAll('#myd-consent-panel-actions button')].map((b) => b.textContent),
          blocat: el.querySelector('.myd-consent-toggle.locked').disabled,
        };
      });
      const randuri = NOU_ACTIV ? t.randuri : t.randuri.map((x) => x.replace(/ (NOU|NEW) /, ' '));
      verifica(p.titlu === t.titlu && p.intro === t.intro, `${lang} ${disp}: titlul / introducerea panoului: ${p.titlu} / ${p.intro}`);
      verifica(JSON.stringify(p.randuri) === JSON.stringify(randuri), `${lang} ${disp}: rândurile panoului: ${JSON.stringify(p.randuri)}`);
      verifica(JSON.stringify(p.butoane) === JSON.stringify(t.panouButoane), `${lang} ${disp}: butoanele panoului: ${p.butoane}`);
      verifica(p.blocat, `${lang} ${disp}: comutatorul „Esențiale” nu e blocat`);
      verifica(!erori.length, `${lang} ${disp}: erori JS: ${erori}`);
      await ctx.close();
    }
  }

  // 9. fără ID setat: nimic, nici cu marketing acceptat.
  {
    const { ctx, page, cereri } = await context({ pixeli: {} });
    await mergi(page, PAGINA);
    await page.click('#myd-consent-bar [data-myd-act="accepta-toate"]');
    await page.waitForTimeout(400);
    verifica(cereri.some((u) => /config-masurare/.test(u)), 'fără ID: configurația nu e cerută');
    verifica(!cereri.some((u) => /facebook|tiktok|licdn/.test(u)) && (await page.evaluate(() => typeof window.fbq + typeof window.ttq + typeof window._linkedin_partner_id)) === 'undefinedundefinedundefined', 'fără ID: un pixel se încarcă');
    await ctx.close();
  }

  await br.close();
  srv.close();
}

(async () => {
  testeStatice();
  await testeBrowser();
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
