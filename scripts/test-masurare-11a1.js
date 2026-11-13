// scripts/test-masurare-11a1.js
// Pasul 11-A1 (13 nov. 2026): măsurarea campaniilor și a pâlniei „Devino partener”.
//
// Fără rețea externă: serverul local (scripts/server-test.js) și Playwright, cu
// cererile spre Google / Meta / TikTok / LinkedIn interceptate (numărate, nu trimise).
//
// Verifică:
//   A. fără consimțământ (fără alegere sau „Doar esențiale”): GA4 nu se încarcă,
//      nu se trimite niciun eveniment, nu se salvează nicio sursă UTM și nu se
//      cere configurația pixelilor;
//   B. cu consimțământ: sursa UTM se păstrează (30 de zile), fără valorile care
//      seamănă cu un email; apare în partner_landing_view, în account_created
//      (prin performRegister, cu Supabase simulat) și în metadatele contului nou;
//      partner_cta_click are locul butonului; zone_unavailable_view apare când se
//      deschide fereastra „nu suntem încă în zona ta”;
//   C. evenimentele nu conțin email, telefon, nume sau CUI, nici când codul
//      paginii le-ar trimite din greșeală;
//   D. pixelii (pasul 11-A3: acordul real de marketing, versiune 2): fără acord
//      de marketing nu se cere nimic; cu acord, dar fără ID, nu se încarcă niciun
//      pixel; cu un ID, se încarcă doar pixelul acela; doar marketing (fără
//      analitice): pixelul primește evenimentele, GA4 nu; acordul vechi
//      (versiune 1) nu pornește pixelii;
//   E. serverul: /api/public/config-masurare citește doar variabilele de mediu,
//      cu format verificat; niciun ID în cod; pașii pâlniei (lib/palnie.js) și
//      agregarea raportului intern (api/admin/palnie-parteneri.js);
//   F. paginile: scriptul de măsurare și Vercel Web Analytics pe paginile publice
//      și cu cont, nu pe cele interne; CSP-ul are domeniile GA4 și exact domeniile
//      pixelilor din docs/audit-masurare-11a1.md (pasul 11-A3); catalogul și produsul cer fișierele cu cale absolută
//      (rutele /servicii/:slug și /catalog/... nu mai pierd scripturile).
//
// Rulare: node scripts/test-masurare-11a1.js

const fs = require('fs');
const path = require('path');
const { porneste } = require('./server-test');

const R = path.join(__dirname, '..');
let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

const RE_PERSONAL = /@|%40|\+?\d[\d\s().\-/]{6,}\d|\b(ro)?\d{6,10}\b|"(email|telefon|phone|nume|name|cui)"/i;

// ── E. serverul ─────────────────────────────────────────────────────
async function testeServer() {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://exemplu.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'cheie-test';

  const cfg = require(path.join(R, 'api/public/config-masurare.js'));
  verifica(JSON.stringify(cfg.pixeliActivi({})) === '{}', 'fără variabile de mediu apar pixeli');
  verifica(JSON.stringify(cfg.pixeliActivi({ META_PIXEL_ID: 'abc', TIKTOK_PIXEL_ID: 'mic', LINKEDIN_PARTNER_ID: '12a' })) === '{}', 'ID-urile cu format greșit sunt acceptate');
  const activi = cfg.pixeliActivi({ META_PIXEL_ID: ' 123456789012345 ', TIKTOK_PIXEL_ID: 'C1ABCDEF2GHIJK3LMNO0', LINKEDIN_PARTNER_ID: '1234567' });
  verifica(activi.meta === '123456789012345' && activi.tiktok === 'C1ABCDEF2GHIJK3LMNO0' && activi.linkedin === '1234567', `ID-urile valide: ${JSON.stringify(activi)}`);
  const r = await apel(cfg, { method: 'GET' });
  verifica(r.status === 200 && r.body.ok === true && typeof r.body.pixeli === 'object', `GET config-masurare: ${JSON.stringify(r)}`);
  const r405 = await apel(cfg, { method: 'POST' });
  verifica(r405.status === 405 && r405.body.mesaj && r405.body.mesaj.en, 'config-masurare: 405 fără forma comună');

  // Niciun ID de pixel scris în cod.
  for (const f of ['masurare.js', 'api/public/config-masurare.js', 'vercel.json']) {
    const s = fs.readFileSync(path.join(R, f), 'utf8');
    verifica(!/fbq\(\s*['"]init['"]\s*,\s*['"]\d/.test(s) && !/sdkid=[A-Z0-9]{10}/.test(s) && !/_linkedin_partner_id\s*=\s*['"]?\d/.test(s), `${f}: un ID de pixel e scris în cod`);
  }

  // Pașii pâlniei.
  const palnie = require(path.join(R, 'lib/palnie.js'));
  const act = { complet: true, pasi: [
    { cheie: 'firma', stare: 'in_verificare' }, { cheie: 'cont_bancar', stare: 'completat' },
    { cheie: 'profesii', stare: 'de_completat' }, { cheie: 'dotari', stare: 'blocat' },
    { cheie: 'documente', stare: 'completat' }, { cheie: 'contract', stare: 'dupa_verificare' },
  ] };
  const rd = palnie.randuriDinActivare(act).map((x) => x.eveniment + ':' + x.pas).join(',');
  verifica(rd === 'partner_step_completed:company_details,partner_step_completed:bank_account,partner_step_completed:documents,partner_activation_completed:', `pașii din activare: ${rd}`);
  verifica(palnie.randuriDinActivare(null).length === 0, 'fără activare apar pași');

  palnie._reseteaza();
  const scrise = [];
  const client = (eroare) => ({ from: (t) => ({ upsert: async (rows, o) => { scrise.push({ t, rows, o }); return { error: eroare || null }; } }) });
  let n = await palnie.inregistreazaActivare('u1', act, { client: client() });
  verifica(n === 4 && scrise[0].t === 'palnie_evenimente' && scrise[0].o.ignoreDuplicates === true && scrise[0].o.onConflict === 'user_id,eveniment,pas', 'scrierea pașilor');
  verifica(scrise[0].rows.every((x) => Object.keys(x).sort().join() === 'eveniment,pas,user_id'), `rândurile au alte câmpuri: ${JSON.stringify(scrise[0].rows[0])}`);
  n = await palnie.inregistreazaActivare('u1', act, { client: client() });
  verifica(n === 0 && scrise.length === 1, 'aceiași pași sunt trimiși din nou');
  n = await palnie.inregistreazaEmailConfirmat({ id: 'u2', email: 'x@y.ro', email_confirmed_at: '2026-11-10T10:00:00Z' }, { client: client() });
  verifica(n === 1 && scrise[1].rows[0].creat_la === '2026-11-10T10:00:00Z' && !JSON.stringify(scrise[1].rows).includes('x@y.ro'), 'emailul confirmat: data reală, fără adresa de email');
  verifica(await palnie.inregistreazaEmailConfirmat({ id: 'u3' }, { client: client() }) === 0, 'email neconfirmat înregistrat');
  palnie._reseteaza();
  const lipsa = { code: '42P01', message: 'relation "public.palnie_evenimente" does not exist' };
  verifica(await palnie.inregistreazaActivare('u4', act, { client: client(lipsa) }) === 0, 'fără tabel: eroare în loc de 0');
  const inainte = scrise.length;
  await palnie.inregistreazaActivare('u5', act, { client: client() });
  verifica(scrise.length === inainte, 'fără tabel: se încearcă din nou la fiecare cerere');
  palnie._reseteaza();

  // Agregarea raportului intern.
  const raport = require(path.join(R, 'api/admin/palnie-parteneri.js'));
  const profiluri = [
    { id: 'a', created_at: '2026-11-10T08:00:00Z', rol_solicitat: 'partener_curier', roles: [], sursa_utm: { utm_source: 'facebook', utm_campaign: 'nov' } },
    { id: 'b', created_at: '2026-11-10T09:00:00Z', rol_solicitat: 'client', roles: [], sursa_utm: null },
    { id: 'c', created_at: '2026-11-11T09:00:00Z', rol_solicitat: null, roles: ['partener_servicii'], sursa_utm: { utm_source: 'facebook', utm_campaign: 'nov' } },
  ];
  const ev = [
    { user_id: 'a', eveniment: 'email_confirmed', pas: '', creat_la: '2026-11-10T08:05:00Z' },
    { user_id: 'a', eveniment: 'partner_step_completed', pas: 'company_details', creat_la: '2026-11-11T10:00:00Z' },
    { user_id: 'z', eveniment: 'partner_step_completed', pas: 'contract', creat_la: '2026-11-11T11:00:00Z' },
    { user_id: 'a', eveniment: 'partner_activation_completed', pas: '', creat_la: '2026-11-12T10:00:00Z' },
    { user_id: 'a', eveniment: 'partner_step_completed', pas: 'necunoscut', creat_la: '2026-11-12T10:00:00Z' },
  ];
  const harta = new Map(profiluri.map((p) => [p.id, p]));
  harta.set('z', { id: 'z', sursa_utm: { utm_source: 'tiktok' } });
  const a = raport.agrega(profiluri, ev, harta);
  verifica(a.total.conturi === 3 && a.total.conturi_partener === 2 && a.total.email_confirmed === 1 && a.total.activari === 1, `totalul: ${JSON.stringify(a.total)}`);
  verifica(a.total.pasi.company_details === 1 && a.total.pasi.contract === 1 && Object.keys(a.total.pasi).length === 6, `pașii: ${JSON.stringify(a.total.pasi)}`);
  const fb = a.pe_sursa.find((x) => x.utm_source === 'facebook');
  verifica(fb && fb.utm_campaign === 'nov' && fb.conturi === 2 && fb.activari === 1, `sursa facebook: ${JSON.stringify(fb)}`);
  verifica(a.pe_sursa.some((x) => x.utm_source === '(fara_sursa)' && x.conturi === 1), 'contul fără sursă lipsește');
  verifica(a.pe_sursa.some((x) => x.utm_source === 'tiktok' && x.pasi.contract === 1), 'pasul unui cont mai vechi nu ia sursa contului');
  const z10 = a.pe_zi.filter((x) => x.zi === '2026-11-10');
  verifica(z10.length === 2 && z10.find((x) => x.utm_source === 'facebook').email_confirmed === 1, `ziua 10: ${JSON.stringify(z10)}`);
  verifica(a.pe_zi.map((x) => x.zi).join() === [...a.pe_zi.map((x) => x.zi)].sort().join(), 'zilele nu sunt în ordine');
  verifica(!RE_PERSONAL.test(JSON.stringify(a).replace(/"(utm_source|utm_campaign|zi)":"[^"]*"/g, '')), 'raportul conține date personale');

  // Parametrul zile și autentificarea (fără token: 401 în forma comună).
  const neautentificat = await apel(raport, { method: 'GET', query: { zile: '30' }, headers: {} });
  verifica(neautentificat.status === 401 && neautentificat.body.mesaj && neautentificat.body.mesaj.en, `fără autentificare: ${neautentificat.status}`);
  const sursaRaport = fs.readFileSync(path.join(R, 'api/admin/palnie-parteneri.js'), 'utf8');
  verifica(/requireAuth\(\['admin', 'superadmin'\]/.test(sursaRaport), 'raportul nu cere rol de admin');
  verifica(/ZILE_INVALIDE/.test(sursaRaport) && /zile < 1 \|\| zile > 365/.test(sursaRaport), 'parametrul zile nu e verificat');
}

function apel(handler, req) {
  return new Promise((rezolva) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(s) { this.statusCode = s; return this; },
      json(b) { rezolva({ status: this.statusCode, body: b }); return this; },
      end(b) { rezolva({ status: this.statusCode, body: b }); return this; },
    };
    Promise.resolve(handler(Object.assign({ headers: {}, query: {}, url: '/' }, req), res)).catch((e) => rezolva({ status: 'excepție', body: e.message }));
  });
}

// ── F. paginile ─────────────────────────────────────────────────────
const INTERNE = ['mydarrin-superadmin.html', 'mydarrin-admin-catalog.html', 'mydarrin-backoffice-serviciu.html', 'mydarrin-deviz-engine.html',
  'mydarrin-auth-schema.html', 'mydarrin-sync-architecture.html', 'mydarrin-design-system.html', 'mydarrin-business-model.html',
  'mydarrin-pitch-deck.html', 'pitch-deck-prezentator.html'];
// Redirecționate din vercel.json (nu se mai servesc).
const REDIRECTIONATE = ['mydarrin-devino-partener.html', 'mydarrin-categorie-servicii.html', 'mydarrin-categorie-materiale.html',
  'mydarrin-categorie-inchirieri.html', 'mydarrin-serviciu.html'];

function testePagini() {
  const pagini = fs.readdirSync(R).filter((f) => f.endsWith('.html'));
  let publice = 0;
  for (const f of pagini) {
    const s = fs.readFileSync(path.join(R, f), 'utf8');
    if (INTERNE.includes(f)) {
      verifica(!/_vercel\/insights|masurare\.js/.test(s), `${f} (internă) are scripturi de măsurare`);
      continue;
    }
    if (REDIRECTIONATE.includes(f)) continue;
    publice++;
    const iConsimt = s.indexOf('src="/cookie-consent.js"');
    const iGa = s.indexOf('src="/analytics-loader.js"');
    const iMas = s.indexOf('src="/masurare.js"');
    const iVa = s.indexOf('<script src="/_vercel/insights/script.js" defer></script>');
    verifica(iConsimt > -1 && iGa > iConsimt && iMas > iGa && iVa > -1, `${f}: lipsește consimțământul, GA4, masurare.js sau Web Analytics (ori ordinea e greșită)`);
  }
  verifica(publice >= 41, `prea puține pagini publice verificate: ${publice}`);

  const v = JSON.parse(fs.readFileSync(path.join(R, 'vercel.json'), 'utf8'));
  const csp = v.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  const dir = (n) => (csp.split(';').map((x) => x.trim()).find((x) => x.startsWith(n + ' ')) || '');
  verifica(/https:\/\/www\.googletagmanager\.com/.test(dir('script-src')), 'CSP: script-src fără googletagmanager (GA4 blocat)');
  verifica(/google-analytics\.com/.test(dir('connect-src')) && /analytics\.google\.com/.test(dir('connect-src')), 'CSP: connect-src fără domeniile de colectare GA4');
  // Pasul 11-A3: doar domeniile din docs/audit-masurare-11a1.md, nimic în plus.
  const pixeliIn = (d) => dir(d).split(/\s+/).filter((x) => /facebook|tiktok|licdn|linkedin/.test(x)).sort().join(' ');
  verifica(pixeliIn('script-src') === 'https://analytics.tiktok.com https://connect.facebook.net https://snap.licdn.com', `CSP script-src, pixelii: ${pixeliIn('script-src')}`);
  verifica(pixeliIn('connect-src') === 'https://analytics.tiktok.com https://connect.facebook.net https://px.ads.linkedin.com https://www.facebook.com', `CSP connect-src, pixelii: ${pixeliIn('connect-src')}`);
  const altele = csp.split(';').map((x) => x.trim()).filter((x) => !/^(script-src|connect-src|img-src) /.test(x));
  verifica(!altele.some((x) => /facebook|tiktok|licdn|linkedin/.test(x)), 'CSP: domeniile pixelilor apar și în alte directive');

  for (const f of ['mydarrin-catalog.html', 'mydarrin-produs.html']) {
    const s = fs.readFileSync(path.join(R, f), 'utf8');
    const relative = s.match(/\b(?:src|href)="(?![a-zA-Z][a-zA-Z0-9+.-]*:|\/|#|\?|\{|\$|'|\+)[A-Za-z0-9_][^"\s]*"/g) || [];
    verifica(relative.length === 0, `${f}: căi relative (se pierd pe rutele /servicii/:slug, /catalog/...): ${relative.slice(0, 5)}`);
  }
}

// ── A–D. în browser ─────────────────────────────────────────────────
const UTM = '?utm_source=facebook&utm_medium=paid_social&utm_campaign=parteneri_nov&fbclid=IwAR_test-1&utm_term=ion.popescu@exemplu.ro&utm_content=0722%20123%20456';

async function testeBrowser() {
  const { chromium } = require('playwright');
  const srv = await porneste(0);
  const B = 'http://localhost:' + srv.address().port;
  const br = await chromium.launch();

  async function deschide(cale, { acord, marketing, pixeli, versiune } = {}) {
    const ctx = await br.newContext();
    const cereri = [];
    await ctx.route(/googletagmanager\.com|google-analytics\.com|connect\.facebook\.net|analytics\.tiktok\.com|snap\.licdn\.com/, (rt) => {
      cereri.push(rt.request().url());
      return rt.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    });
    await ctx.route('**/api/public/config-masurare', (rt) => {
      cereri.push(rt.request().url());
      return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, pixeli: pixeli || {} }) });
    });
    await ctx.route('**/_vercel/insights/**', (rt) => rt.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    if (acord !== undefined) {
      // Acordul real din cookie-consent.js (pasul 11-A3: versiune 2, cu „marketing”).
      const d = { analitice: acord, marketing: !!marketing, data: new Date().toISOString(), versiune: versiune || 2 };
      if (d.versiune === 1) delete d.marketing;
      await ctx.addInitScript((x) => { try { localStorage.setItem('myd_cookie_consent_v1', x); } catch (e) {} }, JSON.stringify(d));
    }
    const page = await ctx.newPage();
    const erori = [];
    page.on('pageerror', (e) => erori.push(e.message));
    await page.goto(B + cale, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MYD_MASURARE, null, { timeout: 15000 });
    await page.waitForTimeout(400);
    return { ctx, page, cereri, erori };
  }
  const stare = (page) => page.evaluate(() => ({
    utm: localStorage.getItem('myd_utm_v1'),
    jurnal: window.MYD_MASURARE.jurnal.slice(),
    dl: (window.dataLayer || []).map((a) => Array.from(a).map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('|')),
    fbq: typeof window.fbq, ttq: typeof window.ttq, li: typeof window._linkedin_partner_id,
  }));
  const PAGINA = '/cum-devii-curier-de-cartier.html' + UTM;

  // A. fără consimțământ: fără alegere, apoi „Doar esențiale”.
  for (const acord of [undefined, false]) {
    const eticheta = acord === undefined ? 'fără alegere' : 'refuzat';
    const { ctx, page, cereri, erori } = await deschide(PAGINA, { acord });
    await page.evaluate(() => window.MYD_MASURARE.eveniment('account_created', { role: 'client' }));
    const s = await stare(page);
    verifica(s.utm === null, `${eticheta}: sursa UTM a fost salvată`);
    verifica(s.jurnal.length === 0, `${eticheta}: evenimente trimise: ${JSON.stringify(s.jurnal)}`);
    verifica(s.dl.length === 0 && !cereri.some((u) => /googletagmanager|google-analytics/.test(u)), `${eticheta}: GA4 s-a încărcat`);
    verifica(!cereri.some((u) => /config-masurare|facebook|tiktok|licdn/.test(u)), `${eticheta}: pixelii sau configurația lor au fost cerute`);
    verifica(JSON.stringify(await page.evaluate(() => window.MYD_MASURARE.sursaPentruCont())) === 'null', `${eticheta}: sursa ar ajunge pe cont`);
    verifica(erori.length === 0, `${eticheta}: erori JS: ${erori.slice(0, 2)}`);
    await ctx.close();
  }

  // A2. acordul dat din banner, pe pagina de campanie: sursa se salvează atunci.
  {
    const { ctx, page } = await deschide(PAGINA);
    const inainte = await stare(page);
    await page.click('[data-myd-act="accepta-toate"]');
    await page.waitForTimeout(200);
    const dupa = await stare(page);
    verifica(inainte.utm === null && dupa.utm && JSON.parse(dupa.utm).v.utm_source === 'facebook', 'acordul din banner: sursa nu se salvează');
    verifica(dupa.jurnal.some((e) => e.nume === 'partner_landing_view'), 'acordul din banner: partner_landing_view lipsește');
    verifica(dupa.dl.some((x) => /^config\|G-/.test(x)), 'acordul din banner: GA4 nu pornește');
    await ctx.close();
  }

  // B. cu consimțământ.
  {
    const { ctx, page, cereri, erori } = await deschide(PAGINA, { acord: true });
    let s = await stare(page);
    const salvat = s.utm && JSON.parse(s.utm);
    verifica(salvat && salvat.v.utm_source === 'facebook' && salvat.v.utm_campaign === 'parteneri_nov' && salvat.v.fbclid === 'IwAR_test-1', `sursa salvată: ${s.utm}`);
    verifica(salvat && !('utm_term' in salvat.v) && !('utm_content' in salvat.v), 'un email / telefon din UTM a fost salvat');
    const zile = salvat ? (salvat.expira - Date.parse(salvat.salvat_la)) / 86400000 : 0;
    verifica(Math.round(zile) === 30, `durata sursei: ${zile} zile`);
    verifica(cereri.some((u) => /googletagmanager\.com\/gtag\/js/.test(u)), 'GA4 nu s-a încărcat cu acord');
    const landing = s.jurnal.find((e) => e.nume === 'partner_landing_view');
    verifica(landing && landing.parametri.partner_type === 'courier' && landing.parametri.utm_source === 'facebook', `partner_landing_view: ${JSON.stringify(landing)}`);
    verifica(s.dl.some((x) => /^event\|partner_landing_view\|/.test(x)), 'partner_landing_view nu ajunge la gtag');
    verifica(!cereri.some((u) => /config-masurare/.test(u)), 'configurația pixelilor e cerută fără acord de marketing');

    // account_created prin fluxul real de creare a contului (Supabase simulat).
    const creare = await page.evaluate(async () => {
      let optiuni = null;
      window.sb = () => ({ auth: { signUp: async (o) => { optiuni = o.options; return { data: { user: { id: 'u-test' } }, error: null }; } } });
      await window.performRegister('ion.popescu@exemplu.ro', 'Parola-Test-1', 'Ion Popescu', true, { prenume: 'Ion', telefon: '+40722123456', rolSolicitat: 'partener_curier' });
      return optiuni;
    });
    verifica(creare && creare.data && creare.data.sursa && creare.data.sursa.utm_source === 'facebook' && creare.data.sursa.salvat_la, `metadatele contului fără sursă: ${JSON.stringify(creare && creare.data)}`);
    s = await stare(page);
    const cont = s.jurnal.find((e) => e.nume === 'account_created');
    verifica(cont && cont.parametri.role === 'partner_courier' && cont.parametri.utm_source === 'facebook' && cont.parametri.utm_campaign === 'parteneri_nov', `account_created: ${JSON.stringify(cont)}`);
    verifica(s.dl.some((x) => /^event\|account_created\|.*"utm_source":"facebook"/.test(x)), 'account_created nu ajunge la gtag cu sursa');

    // C. codul paginii trimite din greșeală date personale: nu pleacă.
    await page.evaluate(() => window.MYD_MASURARE.eveniment('partner_step_completed', {
      step: 'company_details', email: 'ion@exemplu.ro', telefon: '0722 123 456', nume: 'Ion Popescu', cui: 'RO12345678',
      position: 'ion@exemplu.ro', page: '+40 722 123 456', item_slug: 'RO12345678', role: '12345678',
    }));
    verifica(await page.evaluate(() => window.MYD_MASURARE.eveniment('eveniment_inventat', {})) === false, 'un eveniment necunoscut e trimis');

    // partner_cta_click, cu locul butonului.
    await page.evaluate(() => {
      window.addEventListener('click', (e) => e.preventDefault(), true);
      document.querySelector('[data-cta-partener][data-cta-scurt]').click();
      document.querySelector('[data-cta-partener="curier"][data-rp-principal]').click();
    });
    s = await stare(page);
    const clicuri = s.jurnal.filter((e) => e.nume === 'partner_cta_click');
    verifica(clicuri.length === 2 && clicuri.every((c) => c.parametri.partner_type === 'courier'), `partner_cta_click, tipul: ${JSON.stringify(clicuri)}`);
    verifica(clicuri.length === 2 && clicuri[0].parametri.position === 'menu' && clicuri[1].parametri.position && clicuri[1].parametri.position !== 'menu', `partner_cta_click, locul: ${JSON.stringify(clicuri.map((c) => c.parametri.position))}`);
    const pas = s.jurnal.find((e) => e.nume === 'partner_step_completed');
    verifica(pas && Object.keys(pas.parametri).sort().join() === 'fbclid,language,step,utm_campaign,utm_medium,utm_source', `datele personale au trecut de filtru: ${JSON.stringify(pas)}`);
    for (const e of s.jurnal) {
      const fara = JSON.stringify(e.parametri).replace(/"fbclid":"[^"]*"/, '');
      verifica(!RE_PERSONAL.test(fara), `${e.nume} conține date personale: ${fara}`);
    }
    for (const x of s.dl.filter((d) => d.startsWith('event|'))) {
      verifica(!RE_PERSONAL.test(x.replace(/"fbclid":"[^"]*"/, '')), `gtag primește date personale: ${x}`);
    }
    verifica(erori.length === 0, `cu acord: erori JS: ${erori.slice(0, 2)}`);
    await ctx.close();
  }

  // B2. sursa rămâne pe altă pagină, fără UTM în adresă; zona indisponibilă.
  {
    const { ctx, page } = await deschide('/index.html', { acord: true });
    await page.evaluate((u) => localStorage.setItem('myd_utm_v1', u), JSON.stringify({ v: { utm_source: 'tiktok', utm_campaign: 'c1' }, salvat_la: new Date().toISOString(), expira: Date.now() + 86400000 }));
    await page.evaluate(() => document.getElementById('zone-unavailable').classList.remove('hidden'));
    await page.waitForTimeout(100);
    const s = await stare(page);
    const z = s.jurnal.find((e) => e.nume === 'zone_unavailable_view');
    verifica(z && z.parametri.utm_source === 'tiktok', `zone_unavailable_view: ${JSON.stringify(z)}`);
    // Sursa expirată se șterge.
    await page.evaluate(() => localStorage.setItem('myd_utm_v1', JSON.stringify({ v: { utm_source: 'vechi' }, salvat_la: '2026-01-01T00:00:00Z', expira: Date.now() - 1 })));
    verifica(JSON.stringify(await page.evaluate(() => window.MYD_MASURARE.sursa())) === '{}', 'sursa expirată e folosită');
    await ctx.close();
  }

  // D. pixelii.
  {
    const ID_META = '123456789012345';
    const fara = await deschide(PAGINA, { acord: true, marketing: true, pixeli: {} });
    let s = await stare(fara.page);
    verifica(fara.cereri.some((u) => /config-masurare/.test(u)), 'cu acord de marketing, configurația nu e cerută');
    verifica(!fara.cereri.some((u) => /facebook|tiktok|licdn/.test(u)) && s.fbq === 'undefined' && s.ttq === 'undefined' && s.li === 'undefined', 'pixelii se încarcă fără ID');
    await fara.ctx.close();

    const cu = await deschide(PAGINA, { acord: true, marketing: true, pixeli: { meta: ID_META } });
    await cu.page.waitForTimeout(300);
    s = await stare(cu.page);
    verifica(cu.cereri.some((u) => /connect\.facebook\.net/.test(u)) && s.fbq === 'function', 'cu ID Meta, pixelul Meta nu se încarcă');
    verifica(!cu.cereri.some((u) => /tiktok|licdn/.test(u)) && s.ttq === 'undefined' && s.li === 'undefined', 'fără ID, TikTok / LinkedIn se încarcă');
    await cu.ctx.close();

    const faraMarketing = await deschide(PAGINA, { acord: true, pixeli: { meta: ID_META } });
    s = await stare(faraMarketing.page);
    verifica(!faraMarketing.cereri.some((u) => /config-masurare|facebook/.test(u)) && s.fbq === 'undefined', 'fără acord de marketing (doar analitice), pixelul Meta se încarcă');
    await faraMarketing.ctx.close();

    // Acordul vechi (versiune 1, cu analitice): analiticele rămân, pixelii nu pornesc.
    const vechi = await deschide(PAGINA, { acord: true, versiune: 1, pixeli: { meta: ID_META } });
    s = await stare(vechi.page);
    verifica(vechi.cereri.some((u) => /googletagmanager/.test(u)), 'acordul vechi (versiune 1): GA4 nu mai pornește');
    verifica(!vechi.cereri.some((u) => /config-masurare|facebook/.test(u)) && s.fbq === 'undefined', 'acordul vechi (versiune 1): pixelul Meta se încarcă');
    await vechi.ctx.close();

    // Doar marketing: pixelul primește evenimentele (cu categoria), GA4 nu se încarcă.
    const doarMk = await deschide(PAGINA, { acord: false, marketing: true, pixeli: { meta: ID_META } });
    await doarMk.page.waitForTimeout(300);
    const apeluri = await doarMk.page.evaluate(() => (window.fbq && window.fbq.queue ? window.fbq.queue.map((a) => Array.from(a)) : []));
    verifica(!doarMk.cereri.some((u) => /googletagmanager|google-analytics/.test(u)), 'doar marketing: GA4 se încarcă');
    verifica(apeluri.some((a) => a[0] === 'track' && a[1] === 'PageView'), `doar marketing: fără PageView: ${JSON.stringify(apeluri)}`);
    const vc = apeluri.find((a) => a[0] === 'track' && a[1] === 'ViewContent');
    verifica(vc && JSON.stringify(vc[2]) === '{"content_category":"courier"}', `doar marketing: ViewContent (partner_landing_view) lipsă sau cu alte date: ${JSON.stringify(vc)}`);
    verifica(!apeluri.some((a) => RE_PERSONAL.test(JSON.stringify(a.slice(2)))), `pixelul primește date personale: ${JSON.stringify(apeluri)}`);
    verifica(JSON.stringify(await doarMk.page.evaluate(() => window.MYD_MASURARE.sursaPentruCont())) === 'null', 'doar marketing: sursa ar ajunge pe cont fără acord analitic');
    await doarMk.ctx.close();
  }

  await br.close();
  srv.close();
}

(async () => {
  await testeServer();
  testePagini();
  await testeBrowser();
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
