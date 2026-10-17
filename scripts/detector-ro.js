// scripts/detector-ro.js — detectorul de română pentru paginile publice (10 oct. 2026)
// și, cu --cu-cont, pentru paginile cu cont (14 oct. 2026).
//
// Deschide fiecare pagină publică cu localStorage gol (prima vizită → engleză)
// și raportează, pe fiecare pagină și lățime:
//   - lang-ul paginii;
//   - textele românești vizibile (diacritice și cuvinte frecvente), inclusiv în
//     placeholder / title / aria-label / alt, titlu și meta description — cu
//     selector; numele proprii, orașele și adresele sunt excluse;
//   - chei netraduse afișate (ex. nav.contact);
//   - erori JS, depășiri pe orizontală, butoane / intrări de meniu ieșite din chenar;
//   - dacă pagina s-a încărcat și s-a randat (pasul 11-H1): o pagină care nu
//     s-a încărcat (server oprit, 404) sau a rămas albă / la „Se verifică
//     accesul...” e raportată ca NERANDATĂ și detectorul iese cu cod 1 — nu
//     mai trece drept „0 texte românești”;
//   - aceleași verificări cu meniul lateral, fereastra de cont și preferințele
//     cookie deschise.
// LIMBA=ro rulează testul inversat (selector → română: doar chei netraduse,
// erori și depășiri).
//
// --cu-cont: paginile cu cont (dashboard-uri și completarea profilului de
// partener), deschise cu un utilizator simulat. Supabase (auth + interogări)
// și /api/partener|client|comenzi răspund cu date simulate (vezi
// sesiuneSimulata și RASPUNSURI_SIMULATE) — nimic nu ajunge la producție.
//
// Cerințe: un server local care servește site-ul cu /api (ex. `vercel dev`) și
// Playwright instalat separat (nu e dependență a proiectului):
//   npm i --no-save playwright && npx playwright install chromium
//
// Depășirea pe orizontală (pasul 11-H1): pe lângă scrollWidth, se măsoară
// marginea dreaptă a fiecărui element vizibil. Paginile cu html/body
// { overflow-x: clip } ascund depășirea de scrollWidth, dar conținutul tot e
// tăiat; elementele din containere derulabile (overflow-x: auto / scroll) și
// sertarele închise (complet în afara ecranului) nu se numără.
//
// Captura se face înaintea stărilor ascunse (meniu, cont, cookie), ca să
// arate pagina, nu fereastra de preferințe.
//
// Utilizare:
//   node scripts/detector-ro.js [--base http://localhost:3000] [--latimi 390,1366]
//                               [--out ./detector-out] [--cu-cont]
//                               [--profil extern|propriu|inchirieri] [pagina ...]
// --profil (doar cu --cu-cont): contul simulat — furnizor extern în verificare
// (implicit), furnizorul propriu al platformei sau furnizor de închirieri.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const PUBLICE = ['index', 'servicii-urgente', 'despre-noi', 'afla-ce-facem', 'mydarrin-contact', 'mydarrin-app-mobile',
  'mydarrin-catalog', 'mydarrin-categorie-servicii.html?type=servicii&cat=instalatii-electrice', 'mydarrin-categorie-materiale',
  'mydarrin-categorie-inchirieri', 'mydarrin-marketplace', 'mydarrin-marketplace-materiale.html?slug=montaj-parchet-laminat&type=servicii&nace=43.33',
  'mydarrin-produs.html?slug=inlocuire-becuri-corpuri&type=servicii', 'mydarrin-serviciu', 'mydarrin-checkout', 'mydarrin-cos',
  'mydarrin-creeaza-deviz', 'confirmare-livrare', 'reset-password', 'mydarrin-cum-functioneaza', 'cum-comanzi', 'cum-platesc',
  'cum-programez-serviciu', 'cum-prestam-livram', 'intrebari-frecvente-clienti', 'intrebari-frecvente-parteneri',
  'garantii-si-asigurari', 'ghidul-asiguratorului', 'reclamatii', 'mydarrin-devino-partener',
  'cum-devii-partenerul-nostru', 'cum-devii-curier-de-cartier', 'cum-devii-furnizor-materiale', 'cum-devii-operator-inchirieri',
  'mydarrin-investitori', 'mydarrin-pitch-deck', 'acord-confidentialitate', 'acces-temporar', 'mydarrin-termeni',
  'mydarrin-politica-confidentialitate'];

// Paginile cu cont. Wizard-ul de partener e „Completare profil partener”
// (decizie LM, 14 oct. 2026): nu mai e pagină publică, se testează ca dashboard.
const CU_CONT = ['mydarrin-dashboard-client', 'mydarrin-dashboard-partener', 'mydarrin-dashboard-furnizor',
  'mydarrin-devino-partener-wizard', 'mydarrin-admin-catalog'];

const arg = process.argv.slice(2);
const opt = (n, d) => { const i = arg.indexOf('--' + n); if (i === -1) return d; const v = arg[i + 1]; arg.splice(i, 2); return v; };
const flag = (n) => { const i = arg.indexOf('--' + n); if (i === -1) return false; arg.splice(i, 1); return true; };
const BASE = opt('base', 'http://localhost:3000');
const latimi = opt('latimi', '390,1366').split(',').map(Number);
const OUT = opt('out', path.join(process.cwd(), 'detector-out'));
const CU_CONT_MOD = flag('cu-cont');
const PROFIL = opt('profil', 'extern');
const pagini = arg.length ? arg : (CU_CONT_MOD ? CU_CONT : PUBLICE);
const LIMBA = process.env.LIMBA || 'en';
fs.mkdirSync(OUT, { recursive: true });

// ── Sesiunea simulată (--cu-cont) ─────────────────────────────────────────
const UTILIZATOR_SIMULAT = {
  id: '00000000-0000-4000-8000-00000000d37e', email: 'partener.test@example.com',
  email_confirmed_at: '2026-10-01T08:00:00Z', user_metadata: { nume: 'Partener Test' },
};
// Rulează în pagină înaintea oricărui script: window.supabaseClient și
// window.MyDarrinAuth devin obiecte simulate, iar atribuirile din
// lib/supabaseClient.js / account-system.js sunt ignorate.
function sesiuneSimulata(user) {
  const lant = (rezultat) => {
    const p = new Proxy(function () {}, {
      get: (t, k) => (k === 'then' ? (ok) => ok(rezultat) : () => p),
      apply: () => p,
    });
    return p;
  };
  const sesiune = { access_token: 'token-simulat', user };
  const client = {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getSession: async () => ({ data: { session: sesiune }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: () => lant({ data: [], error: null, count: 0 }),
    rpc: () => lant({ data: null, error: null }),
    storage: { from: () => lant({ data: null, error: null }) },
    channel: () => lant({}),
    removeChannel: () => {},
  };
  const auth = new Proxy({
    getCurrentUser: async () => user,
    getUserRoles: async () => ['partener_servicii'],
    hasRole: async () => true,
    performLogout: () => {},
  }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (nume, val) => Object.defineProperty(window, nume, { configurable: true, get: () => val, set: () => {} });
  fix('supabaseClient', client);
  fix('MyDarrinAuth', auth);
}

// Răspunsurile API pentru contul simulat. Profilul are compania completă,
// dar fără coduri NACE și fără clauza de zonă.
const RASPUNSURI_SIMULATE = {
  '/api/partener/wizard-companie': { ok: true, partner: { nume_firma: 'Test Instalatii SRL', cui: 'RO12345678', partner_type: 'servicii_tehnice', status_verificare: 'pending_review', tip_entitate_legala: 'srl', is_treasury_account: false, regiune_cod: null }, conturi: [] },
  '/api/partener/wizard-nace': { ok: true, coduri: [] },
  '/api/partener/wizard-utilaje': { ok: true, utilaje: [] },
  '/api/partener/wizard-angajati': { ok: true, angajati: [], total: 0, total_disponibili: 0 },
  '/api/partener/wizard-certificari': { ok: true, certificari: [], cerinte: [], tara: 'RO' },
  '/api/partener/wizard-alocare': { ok: true, alocari: [] },
  '/api/partener/status-aplicare': { ok: true, status: 'pending_review', partner_type: 'servicii_tehnice', documente_respinse: [], darrin_ai_activ: false, darrin_ai_raport: null },
  '/api/partener/cont': { ok: true, partner: { nume_firma: 'Test Instalatii SRL', partner_type: 'servicii_tehnice', status_verificare: 'pending_review', regiune_cod: 'BC', contract_semnat: false }, profil: { email: 'partener.test@example.com', tara: 'RO', limba: 'en' }, are_cont_bancar: false, kpi: { moneda: 'RON', comenzi_active: 0, comenzi_luna: 0, total_activ: 0, total_eliberat: 0, castig_luna: 0, castig_azi: 0 }, documente: [], facturi: [], garantii: [], polite: [] },
  '/api/partener/escrow-tracker': { ok: true, total_activ: 0, total_eliberat: 0, moneda: 'Lei', alocari: [] },
  '/api/partener/facturi': { ok: true, facturabile: [], facturi: [] },
  // profil incomplet: cardul „Profil incomplet” apare și e verificat și el
  '/api/partener/profil-status': { ok: true, complet: false, lipsa: ['nace', 'clauza_zona'], pas: 3 },
};

// Profilul contului simulat (/api/cont/profil, pasul 10b): rolurile care
// deschid toate dashboard-urile verificate (client, partener, furnizor), ca
// paza din cont-dashboard.js să nu redirecționeze; partener în verificare,
// fără cont bancar — antetul de identitate și benzile de stare apar și ele;
// pasul 10c: poate_vinde / motiv_nu_poate_vinde / furnizor_propriu, ca în API.
const PROFIL_SIMULAT = {
  ok: true, email: 'partener.test@example.com', nume: 'Partener Test',
  roles: ['client', 'partener_servicii', 'partener_materiale'], roluri_dashboard: ['partener_servicii', 'partener_materiale'],
  destinatie: '/?alege_rol=1', tip_destinatie: 'alegere', furnizor_propriu: false,
  partener: { nume_firma: 'Test Instalatii SRL', partner_type: 'servicii_tehnice', rol: 'partener_servicii', status_verificare: 'pending_review', contract_semnat: false, cont_bancar: false, motiv_respingere: null,
    poate_vinde: false, motiv_nu_poate_vinde: 'in_verificare' },
};

// Variantele de cont (pasul 11-H1): furnizorul propriu al platformei (HBP) și
// un furnizor de închirieri, pe lângă contul implicit de mai sus.
const PROFILURI_SIMULATE = {
  extern: PROFIL_SIMULAT,
  propriu: {
    ok: true, email: 'contact@homebestpal.ro', nume: null, roles: ['client', 'partener_materiale'], roluri_dashboard: ['partener_materiale'],
    destinatie: '/mydarrin-dashboard-furnizor.html?type=materiale', tip_destinatie: 'rol', furnizor_propriu: true,
    partener: { nume_firma: 'Home Best Pal', partner_type: 'furnizor_materiale', rol: 'partener_materiale', status_verificare: 'approved', contract_semnat: false, cont_bancar: false, motiv_respingere: null,
      poate_vinde: true, motiv_nu_poate_vinde: null },
  },
  inchirieri: {
    ok: true, email: 'partener.test@example.com', nume: 'Partener Test', roles: ['partener_inchirieri'], roluri_dashboard: ['partener_inchirieri'],
    destinatie: '/mydarrin-dashboard-furnizor.html?type=inchirieri', tip_destinatie: 'rol', furnizor_propriu: false,
    partener: { nume_firma: 'Test Utilaje SRL', partner_type: 'inchirieri_utilaje', rol: 'partener_inchirieri', status_verificare: 'approved', contract_semnat: true, cont_bancar: true, motiv_respingere: null,
      poate_vinde: true, motiv_nu_poate_vinde: null },
  },
};
if (!PROFILURI_SIMULATE[PROFIL]) { console.error(`--profil necunoscut: ${PROFIL} (extern | propriu | inchirieri)`); process.exit(2); }

// Pagina adminului de catalog (pasul 9): răspunsuri POST pe acțiune.
// Antetul cu drepturi; listele încep goale (prima vizită).
const RASPUNSURI_ADMIN = {
  profil: { ok: true, superadmin: false, toate_capitolele: false, tara: null,
    capitole: [{ cod: 'F', titlu_ro: 'Construcții și renovări', titlu_en: 'Construction and renovation', tip_partener: 'servicii' }] },
  lista_servicii: { ok: true, servicii: [] },
  retete_propuse_lista: { ok: true, retete: [] },
};

function detecteaza(limba) {
  const EXCEPTII = /\b(My Darrin|Darrin AI|Darrin|Home Best Pal|SRL|LTD|București|Bucureşti|Iași|Chișinău|Cluj-Napoca|Timișoara|Constanța|Brașov|Bacău|Galați|Ploiești|Pitești|Târgu(?: Mureș| Neamț| Jiu)?|Brăila|Botoșani|Buzău|Focșani|Târgoviște|Reșița|Bistrița|Călărași|Zalău|Sfântu Gheorghe|Bârlad|Mediaș|Onești|Piatra Neamț|Râmnicu Vâlcea|Neamț|România|Română|Ελληνικά|Български|Türkçe|Français|Deutsch|Magyar|Polski|Sector \d|Păcurari|Str\.|Strada|Bd\.|Calea|nr\.|jud\.|Județul \w+|Mureș)\b/g;
  // cuvinte lungi: indiferent de majuscule; scurte: doar cu literă mică (DE, LA, AL pot fi coduri)
  const RO_CUV = /(?<!\p{L})(?:(?:[Pp]entru|[Ss]erviciu|[Ss]ervicii|[Cc]omandă|[Cc]omenzi|[Pp]reț|[Pp]rețuri|[Aa]lege|[Vv]ezi|[Dd]espre|[Cc]ont|[Cc]oș|[Cc]ătre|[Uu]rmător|[Îî]napoi|[Aa]casă|[Ll]ucrare|[Ll]ucrări|[Nn]ivel|[Gg]aranție|[Pp]lată|[Nn]ostru|[Nn]oastră|[Ee]ste|[Ss]unt|[Gg]ratuit|[Gg]ratuită|[Ll]ivrare|[Cc]erere|[Ss]olicită|[Ss]olicitare|[Zz]onă|[Pp]arteneri|[Cc]lienți|[Ii]nclus|[Aa]daugă|[Oo]rice|[Mm]inim|[Tt]arif|[Ll]ună|[Zz]ile|[Oo]ră|[Oo]re|[Mm]anoperă|[Ee]chipă|[Ii]ntervenție)|(?:și|sau|ți|tău|noi|din|cu|la|de|pe|în|un|al|ale))(?!\p{L})/u;
  const DIAC = /[ăâîșțşţĂÂÎȘȚŞŢ]/;
  const H = innerHeight, W = innerWidth;
  const vizibil = (el) => { if (!el) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const sel = (el) => { const p = []; for (let e = el; e && e.nodeType === 1 && p.length < 4; e = e.parentElement) { let s = e.tagName.toLowerCase(); if (e.id) { s += '#' + e.id; p.unshift(s); break; } const c = (typeof e.className === 'string' ? e.className : '').trim().split(/\s+/).filter((x) => x && !/[:\[\]/]/.test(x))[0]; if (c) s += '.' + c; p.unshift(s); } return p.join(' > '); };
  const eRo = (t) => {
    const cur = t.replace(EXCEPTII, ' ');
    if (limba === 'ro') return false;
    return DIAC.test(cur) || RO_CUV.test(cur);
  };
  const gasite = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => { const pe = n.parentElement; if (!pe || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(pe.tagName)) return NodeFilter.FILTER_REJECT; return n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });
  while (w.nextNode()) {
    const n = w.currentNode, t = n.data.replace(/\s+/g, ' ').trim();
    if (!vizibil(n.parentElement)) continue;
    if (n.parentElement.closest('[translate="no"],.notranslate,[data-i18n-skip],code,pre,textarea')) continue;
    if (eRo(t)) gasite.push({ sel: sel(n.parentElement), text: t.slice(0, 160) });
    if (/^[a-z]+(\.[a-z_0-9]+){1,4}$/.test(t) && !/\.(com|ro|md|eu|net|org)$/.test(t)) gasite.push({ sel: sel(n.parentElement), text: 'CHEIE NETRADUSĂ: ' + t });
  }
  document.querySelectorAll('[placeholder],[title],[aria-label],img[alt]').forEach((el) => {
    if (!vizibil(el) && el.tagName !== 'IMG') return;
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) { const v = el.getAttribute(a); if (v && eRo(v)) gasite.push({ sel: sel(el) + '[' + a + ']', text: v.slice(0, 160) }); }
  });
  if (eRo(document.title)) gasite.push({ sel: 'title', text: document.title });
  const md = document.querySelector('meta[name="description"]'); if (md && eRo(md.content || '')) gasite.push({ sel: 'meta[description]', text: md.content.slice(0, 160) });
  // butoane / linkuri de meniu al căror text iese din chenar
  const rupte = [];
  document.querySelectorAll('button, a.sb-item, nav a, .nav-lnk, #mobile-bottom-nav a, #mobile-bottom-nav button').forEach((b) => {
    if (!vizibil(b)) return; const r = b.getBoundingClientRect(); if (r.width < 20) return;
    if (b.scrollWidth > b.clientWidth + 2 && getComputedStyle(b).overflow !== 'visible') rupte.push(sel(b) + ' «' + b.innerText.trim().slice(0, 30) + '»');
    if (r.right > W + 1 && r.left < W - 1 && r.left >= 0) rupte.push('iese din ecran: ' + sel(b) + ' «' + b.innerText.trim().slice(0, 30) + '»');
  });
  // Elemente tăiate la dreapta ecranului (vezi antetul fișierului).
  const derulabil = (el) => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const ox = getComputedStyle(e).overflowX; if (ox === 'auto' || ox === 'scroll') return true; } return false; };
  let dreaptaMax = 0;
  const taiate = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (!vizibil(el) || /^(SCRIPT|STYLE|svg|path|OPTION)$/i.test(el.tagName)) return;
    const r = el.getBoundingClientRect();
    if (r.right <= W + 1 || r.left >= W - 1 || r.right <= 0) return;
    if (derulabil(el)) return;
    dreaptaMax = Math.max(dreaptaMax, Math.round(r.right));
    if (taiate.length < 10 && !taiate.some((t) => el.closest(t.s))) taiate.push({ s: sel(el), t: (el.innerText || '').trim().slice(0, 30) });
  });
  // Pagina s-a randat: are limbă, text vizibil și nu a rămas la bariera de acces.
  const poarta = document.getElementById('auth-gate-overlay');
  const text = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').trim();
  const randata = !!document.documentElement.lang && text.length > 40 && !(poarta && vizibil(poarta));
  return { lang: document.documentElement.lang, sw: Math.max(document.documentElement.scrollWidth, dreaptaMax), W, gasite, rupte: [...new Set(rupte)].slice(0, 20),
    taiate: taiate.map((t) => t.s + ' «' + t.t + '»'), randata, text: text.length };
}

(async () => {
  const b = await chromium.launch();
  const total = [];
  for (const w of latimi) {
    for (const pg of pagini) {
      const cfg = w < 800 ? { ...devices['iPhone 13'], viewport: { width: w, height: 844 } } : { viewport: { width: w, height: 900 } };
      const ctx = await b.newContext({ ...cfg, locale: 'en-GB' });
      await ctx.addInitScript((l) => { try { if (!sessionStorage.getItem('__init')) { localStorage.clear(); if (l !== 'en') localStorage.setItem('myd_lang_v1', l); sessionStorage.setItem('__init', '1'); } } catch (e) {} }, LIMBA);
      if (CU_CONT_MOD) {
        const profil = PROFILURI_SIMULATE[PROFIL];
        await ctx.addInitScript(sesiuneSimulata, { ...UTILIZATOR_SIMULAT, email: profil.email });
        // Contul e simulat: nicio cerere către Supabase sau către API-urile cu cont nu pleacă.
        await ctx.route(/\.supabase\.co\//, (r) => r.abort());
        await ctx.route(/\/api\/admin\/(ruta-incadrare|catalog)$/, (r) => {
          let corp = {};
          try { corp = JSON.parse(r.request().postData() || '{}'); } catch (e) { corp = {}; }
          return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RASPUNSURI_ADMIN[corp.action] || { ok: true }) });
        });
        await ctx.route(/\/api\/cont\/profil/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profil) }));
        await ctx.route(/\/api\/(partener|client)\//, (r) => {
          const cale = new URL(r.request().url()).pathname.replace(/\.js$/, '');
          const corp = r.request().method() === 'GET' ? (RASPUNSURI_SIMULATE[cale] || { ok: true }) : { ok: true };
          return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corp) });
        });
      }
      const p = await ctx.newPage();
      const erori = []; p.on('pageerror', (e) => erori.push(e.message.slice(0, 120)));
      await p.route('**/api/comenzi/**', (r) => r.fulfill({ status: 599, body: '{}' }));
      // Încărcarea paginii: o eroare (server oprit, 404) nu mai trece neobservată.
      let incarcare = null;
      const raspunsPagina = await p.goto(BASE + '/' + pg + (pg.includes('?') ? '' : '.html'), { waitUntil: 'networkidle', timeout: 60000 })
        .catch((e) => { incarcare = e.message.split('\n')[0].slice(0, 120); return null; });
      if (!incarcare && raspunsPagina && raspunsPagina.status() >= 400) incarcare = 'HTTP ' + raspunsPagina.status();
      if (!incarcare && !raspunsPagina) incarcare = 'fără răspuns';
      await p.waitForTimeout(2500);
      await p.waitForFunction(() => !document.documentElement.classList.contains('myd-i18n-pending'), null, { timeout: 5000 }).catch(() => {});
      await p.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); } scrollTo(0, 0); }).catch(() => {});
      await p.waitForTimeout(600);
      const r = await p.evaluate(detecteaza, LIMBA).catch((e) => ({ eroare: e.message }));
      if (incarcare) { r.randata = false; r.incarcare = incarcare; }
      // Captura paginii, înaintea stărilor ascunse.
      await p.screenshot({ path: path.join(OUT, `${LIMBA}${CU_CONT_MOD ? '_' + PROFIL : ''}_${pg.replace(/[?=&.]/g, '_')}_${w}.png`) }).catch(() => {});
      // Stări ascunse: meniul lateral, fereastra de cont, preferințele cookie.
      for (const [nume, deschide, inchide] of [
        ['meniu', 'typeof openSidebar==="function"&&(openSidebar(),true)', 'typeof closeSidebar==="function"&&closeSidebar()'],
        ['cont', 'typeof toggleAuthModal==="function"&&(toggleAuthModal(),true)', 'typeof toggleAuthModal==="function"&&toggleAuthModal()'],
        ['cookie', '(()=>{const b=[...document.querySelectorAll("#myd-consent-bar button")].find(x=>/Customise|Personalizează/.test(x.textContent));if(b){b.click();return true}return false})()', ''],
      ]) {
        const url0 = p.url();
        const ok = await p.evaluate(deschide).catch(() => false);
        if (!ok) continue;
        await p.waitForTimeout(700);
        // butonul a dus pe altă pagină (ex. „Cont” fără fereastră → index): nu e o stare a acestei pagini
        if (p.url() !== url0) { await p.goto(url0, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1500); continue; }
        const s = await p.evaluate(detecteaza, LIMBA).catch(() => null);
        if (s && r.gasite) s.gasite.forEach((g) => r.gasite.push({ sel: '[' + nume + '] ' + g.sel, text: g.text }));
        if (inchide) await p.evaluate(inchide).catch(() => {});
        await p.waitForTimeout(300);
      }
      total.push({ pg, w, ...r, erori });
      await ctx.close();
    }
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, `detector-${LIMBA}${CU_CONT_MOD ? '-cu-cont-' + PROFIL : ''}.json`), JSON.stringify(total, null, 1));
  for (const r of total) {
    const unice = [...new Map((r.gasite || []).map((g) => [g.text, g])).values()];
    console.log(`${r.pg.padEnd(48)} ${String(r.w).padEnd(5)} randat=${r.randata ? 'da' : 'NU'} lang=${r.lang} romana=${unice.length} depasire=${r.sw > r.W ? r.sw + '/' + r.W : 0} rupte=${(r.rupte || []).length} erori=${r.erori.length}`);
    if (!r.randata) console.log(`    NERANDATĂ: ${r.incarcare || r.eroare || 'pagina e goală sau a rămas la bariera de acces'} (text vizibil: ${r.text || 0} caractere)`);
    (r.taiate || []).forEach((t) => console.log('    tăiat la dreapta: ' + t));
    r.erori.forEach((e) => console.log('    eroare JS: ' + e));
    unice.forEach((g) => console.log('    română: «' + g.text + '» ⟨' + g.sel + '⟩'));
  }
  const totalRo = total.reduce((s, r) => s + new Set((r.gasite || []).map((g) => g.text)).size, 0);
  console.log(`
TOTAL texte românești (${LIMBA}): ${totalRo} · pagini × lățimi: ${total.length}`);
  const nerandate = total.filter((r) => !r.randata).length;
  const depasiri = total.filter((r) => r.sw > r.W).length;
  const cuErori = total.filter((r) => r.erori.length).length;
  console.log(`nerandate: ${nerandate} · cu depășire: ${depasiri} · cu erori JS: ${cuErori}`);
  // Nerandată = rezultatul nu e valid: cod 1, ca la textele românești.
  process.exitCode = totalRo || nerandate ? 1 : 0;
})();
