// scripts/test-supabase-vendor.js
// Pasul 11-I3 (16 nov. 2026): autentificarea cu supabase-js 2.45.0 din
// lib/vendor/ (înainte: esm.sh, nefixat — în browser ajungea 2.119).
//   A. login cu parolă (MyDarrinAuth.performLogin): sesiunea în cookie-uri pe
//      .mydarrin.homebestpal.com, păstrată după reîncărcare; parolă greșită → eroare;
//   B. cont nou cu cod din email (performRegister → confirmaCodEmail): fără
//      sesiune până la cod; cod greșit → eroare; codul corect → sesiune;
//   C. sesiune creată cu versiunea veche (lib/supabaseClient.js din ac9dcd0, cu
//      supabase-js de pe esm.sh): citită de 2.45.0 fără cerere; după expirarea
//      access_token-ului, reîmprospătată o singură dată, cu refresh token-ul
//      vechi, iar cookie-urile se rescriu; cookie-ul rămâne citibil de
//      middleware.js și de lib/profil-cont.js;
//   D. ieșirea din cont (performLogout): /auth/v1/logout, toate cookie-urile de
//      sesiune șterse, redirecționare spre site;
//   E. pasul 11-I3b (17 nov. 2026): superadminul autentificat rămâne pe
//      admin.…/mydarrin-superadmin (pagina reală). Bariera din pagină e un
//      <script type="module"> inline, după lib/supabaseClient.js: un `await` la
//      nivelul modulului clientului o lăsa să ruleze fără client → homepage.
// Paginile se servesc pe https://www.mydarrin.homebestpal.com prin interceptare
// (cookie-urile Secure pe domeniul părinte funcționează ca în producție);
// serverul Supabase Auth e simulat — nicio cerere nu ajunge la Supabase.
// Partea C are nevoie de esm.sh (versiunea veche, reală); fără rețea e sărită.
// Rulare: node scripts/test-supabase-vendor.js

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const RADACINA = path.join(__dirname, '..');
const SITE = 'https://www.mydarrin.homebestpal.com';
const REF = 'aacojyvujhywanaulvuu';
const CHEIE = `sb-${REF}-auth-token`;
let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

// ── Serverul Supabase Auth simulat (rotește refresh token-urile, ca GoTrue) ──
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function serverAuth() {
  const s = { utilizatori: {}, refresh: new Map(), apeluri: [], nr: 0 };
  function utilizator(email) {
    if (!s.utilizatori[email]) {
      const id = `30000000-0000-4000-8000-${String(Object.keys(s.utilizatori).length + 1).padStart(12, '0')}`;
      s.utilizatori[email] = { id, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: null, phone: '', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [{ id, provider: 'email' }], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    }
    return s.utilizatori[email];
  }
  function sesiune(u, durata = 3600) {
    s.nr++;
    const exp = Math.floor(Date.now() / 1000) + durata;
    const rt = `rt-${s.nr}-${u.id.slice(-4)}`;
    s.refresh.set(rt, u.email);
    return { access_token: `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: u.id, email: u.email, exp, role: 'authenticated', aud: 'authenticated', session_id: 's' + s.nr })}.semnatura-${s.nr}`, token_type: 'bearer', expires_in: durata, expires_at: exp, refresh_token: rt, user: u };
  }
  async function trateaza(route) {
    const req = route.request();
    const u = new URL(req.url());
    const corp = (() => { try { return JSON.parse(req.postData() || '{}'); } catch (e) { return {}; } })();
    // CORS ca Supabase: originea cererii (www. și admin.)
    const origine = req.headers().origin || SITE;
    const json = (cod, b) => route.fulfill({ status: cod, contentType: 'application/json', headers: { 'access-control-allow-origin': origine, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*' }, body: b === undefined ? '' : JSON.stringify(b) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origine, 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': '*' } });
    const p = u.pathname.replace(/^\/auth\/v1/, '');
    const grant = u.searchParams.get('grant_type');
    s.apeluri.push({ m: req.method(), p, grant, corp, auth: req.headers().authorization || '' });
    if (p === '/signup') {
      const us = utilizator(corp.email);
      us.parola = corp.password;
      us.user_metadata = Object.assign({}, corp.data || {});
      return json(200, us); // confirmarea emailului e cerută: utilizatorul, fără sesiune
    }
    if (p === '/verify') {
      const us = s.utilizatori[corp.email];
      if (!us || corp.token !== '123456' || corp.type !== 'signup') return json(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
      us.email_confirmed_at = new Date().toISOString();
      return json(200, sesiune(us));
    }
    if (p === '/token' && grant === 'password') {
      const us = s.utilizatori[corp.email];
      if (!us || us.parola !== corp.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      return json(200, sesiune(us, s.durataUrmatoare || 3600));
    }
    if (p === '/token' && grant === 'refresh_token') {
      const email = s.refresh.get(corp.refresh_token);
      if (!email) return json(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' });
      s.refresh.delete(corp.refresh_token); // rotire: refresh token-ul vechi nu mai merge
      return json(200, sesiune(s.utilizatori[email]));
    }
    if (p === '/user') {
      const t = (req.headers().authorization || '').slice(7);
      const sub = (() => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).sub; } catch (e) { return null; } })();
      const us = Object.values(s.utilizatori).find((x) => x.id === sub);
      return us ? json(200, us) : json(401, { msg: 'invalid JWT' });
    }
    if (p === '/logout') return json(204);
    return json(404, { msg: 'necunoscut ' + p });
  }
  return { s, trateaza, utilizator };
}

// ── Paginile de test: codul real al site-ului, într-o pagină minimă ──────
const ENV = fs.readFileSync(path.join(RADACINA, 'mydarrin-rolurile-mele.html'), 'utf8').match(/window\.__ENV__ = \{[\s\S]*?\};/)[0];
function pagina(clientJs) {
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>test</title>
<script>${ENV}</script>
<script type="module" src="${clientJs}"></script>
<script src="/account-system.js"></script>
</head><body><p>test autentificare</p></body></html>`;
}
// Versiunea veche = lib/supabaseClient.js de dinaintea pasului 11-I3 (ac9dcd0, PR #73): supabase-js de pe esm.sh.
const SURSA_VECHE = (() => { try { return execSync('git show ac9dcd0:lib/supabaseClient.js', { cwd: RADACINA, encoding: 'utf8' }); } catch (e) { return null; } })();

async function context(br, auth) {
  const ctx = await br.newContext();
  await ctx.route(/\.supabase\.co\//, (r) => {
    const url = r.request().url();
    if (/\/auth\/v1\//.test(url)) return auth.trateaza(r);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    // profiles.roles (getUserRoles, .single()): rolurile din serverul simulat
    if (/\/rest\/v1\/profiles/.test(url)) {
      const id = (url.match(/id=eq\.([0-9a-f-]+)/) || [])[1];
      const us = Object.values(auth.s.utilizatori).find((x) => x.id === id);
      return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ roles: (us && us.roluri) || [] }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '[]' });
  });
  await ctx.route((u) => u.hostname.endsWith('mydarrin.homebestpal.com'), async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/test-nou') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pagina('/lib/supabaseClient.js') });
    if (u.pathname === '/test-vechi') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pagina('/lib/supabaseClient-vechi.js') });
    if (u.pathname === '/lib/supabaseClient-vechi.js') return r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: SURSA_VECHE });
    if (u.pathname === '/' || u.pathname === '') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>site</title><p>site</p>' });
    if (u.pathname.startsWith('/api/')) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    let f = path.join(RADACINA, decodeURIComponent(u.pathname));
    if (!path.extname(f) && fs.existsSync(f + '.html')) f += '.html'; // cleanUrls, ca pe Vercel
    if (!f.startsWith(RADACINA) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: '' });
    const tip = /\.js$/.test(f) ? 'application/javascript; charset=utf-8' : /\.json$/.test(f) ? 'application/json' : /\.html$/.test(f) ? 'text/html; charset=utf-8' : /\.css$/.test(f) ? 'text/css' : /\.png$/.test(f) ? 'image/png' : /\.svg$/.test(f) ? 'image/svg+xml' : 'text/plain';
    return r.fulfill({ status: 200, contentType: tip, body: fs.readFileSync(f) });
  });
  const page = await ctx.newPage();
  const erori = [];
  page.on('pageerror', (e) => erori.push(e.message.slice(0, 200)));
  return { ctx, page, erori };
}
const gata = (p) => p.waitForFunction(() => !!window.supabaseClient && !!window.MyDarrinAuth, null, { timeout: 30000 });
async function cookieuriSesiune(ctx) { return (await ctx.cookies(SITE)).filter((c) => c.name === CHEIE || c.name.startsWith(CHEIE + '.')); }
function sesiuneDinCookieuri(lista) {
  const bucati = lista.filter((c) => /\.\d+$/.test(c.name)).sort((a, b) => Number(a.name.split('.').pop()) - Number(b.name.split('.').pop()));
  const brut = bucati.length ? bucati.map((c) => c.value).join('') : (lista.find((c) => c.name === CHEIE) || {}).value;
  try { return JSON.parse(decodeURIComponent(brut)); } catch (e) { return null; }
}

(async () => {
  const br = await chromium.launch();
  try {
    // ── A. Login cu parolă (2.45.0) ──
    {
      const auth = serverAuth();
      const u = auth.utilizator('ana.parola@example.com'); u.parola = 'Parola-Test-1'; u.email_confirmed_at = new Date().toISOString();
      const { ctx, page, erori } = await context(br, auth);
      await page.goto(SITE + '/test-nou'); await gata(page);
      const versiune = await page.evaluate(() => (self.supabase && self.supabase.SupabaseClient && 'umd') || '?');
      verifica(versiune === 'umd', 'A: clientul vine din lib/vendor/ (build-ul UMD)');
      const gresit = await page.evaluate(() => window.MyDarrinAuth.performLogin('ana.parola@example.com', 'gresit').then(() => 'ok', (e) => e.message));
      verifica(/Invalid login credentials/.test(gresit), `A: parolă greșită → eroare (${gresit})`);
      verifica(!(await cookieuriSesiune(ctx)).length, 'A: fără sesiune după parola greșită');
      const user = await page.evaluate(() => window.MyDarrinAuth.performLogin('ana.parola@example.com', 'Parola-Test-1').then((u) => u && u.email, (e) => 'eroare: ' + e.message));
      verifica(user === 'ana.parola@example.com', `A: login cu parolă → utilizatorul (${user})`);
      const ck = await cookieuriSesiune(ctx);
      verifica(ck.length >= 1 && ck.every((c) => c.domain === '.mydarrin.homebestpal.com' && c.secure && c.sameSite === 'Lax'), `A: sesiunea în cookie-uri pe .mydarrin.homebestpal.com, Secure, SameSite=Lax (${ck.map((c) => c.name + '@' + c.domain).join(', ')})`);
      const s = sesiuneDinCookieuri(ck);
      verifica(s && s.access_token && s.refresh_token && s.user && s.user.email === 'ana.parola@example.com', 'A: cookie-ul conține sesiunea completă');
      await page.reload(); await gata(page);
      const dupa = await page.evaluate(() => window.supabaseClient.auth.getSession().then((r) => r.data.session && r.data.session.access_token));
      verifica(dupa === s.access_token, 'A: după reîncărcare, aceeași sesiune (din cookie)');
      const profil = await page.evaluate(() => !!(window.MYD_PROFIL && window.MYD_PROFIL.devreme && window.MYD_PROFIL.devreme()));
      verifica(profil, 'A: lib/profil-cont.js citește tokenul din cookie');
      verifica(auth.s.apeluri.filter((x) => x.grant === 'refresh_token').length === 0, 'A: nicio reîmprospătare inutilă');
      verifica(!erori.length, `A: fără erori JS (${erori.join(' | ')})`);
      await ctx.close();
    }

    // ── B. Cont nou cu cod din email (2.45.0) ──
    {
      const auth = serverAuth();
      const { ctx, page, erori } = await context(br, auth);
      await page.goto(SITE + '/test-nou'); await gata(page);
      const inreg = await page.evaluate(() => window.MyDarrinAuth.performRegister('ion.nou@example.com', 'Parola-Test-2', 'Ion Nou', true, { prenume: 'Ion', rolSolicitat: 'investor' }).then((u) => u && u.email, (e) => 'eroare: ' + e.message));
      const su = auth.s.apeluri.find((x) => x.p === '/signup');
      verifica(inreg === 'ion.nou@example.com' && su && su.corp.data && su.corp.data.rol_solicitat === 'investor' && su.corp.data.gdpr_acceptat === true, `B: înregistrarea trimite datele contului (${inreg})`);
      verifica(!(await cookieuriSesiune(ctx)).length, 'B: fără sesiune până la cod');
      const gresit = await page.evaluate(() => window.MyDarrinAuth.confirmaCodEmail('ion.nou@example.com', '000000').then(() => 'ok', (e) => e.message));
      verifica(/invalid|expired/i.test(gresit), `B: cod greșit → eroare (${gresit})`);
      verifica(!(await cookieuriSesiune(ctx)).length, 'B: fără sesiune după codul greșit');
      const bun = await page.evaluate(() => window.MyDarrinAuth.confirmaCodEmail('ion.nou@example.com', '123456').then((u) => u && u.email, (e) => 'eroare: ' + e.message));
      const v = auth.s.apeluri.filter((x) => x.p === '/verify').pop();
      verifica(bun === 'ion.nou@example.com' && v && v.corp.type === 'signup' && v.corp.token === '123456', `B: codul corect → contul confirmat (${bun})`);
      const s = sesiuneDinCookieuri(await cookieuriSesiune(ctx));
      verifica(s && s.user && s.user.email === 'ion.nou@example.com', 'B: după cod, sesiunea e în cookie-uri');
      await page.reload(); await gata(page);
      const dupa = await page.evaluate(() => window.supabaseClient.auth.getSession().then((r) => r.data.session && r.data.session.user.email));
      verifica(dupa === 'ion.nou@example.com', 'B: sesiunea rămâne după reîncărcare');
      verifica(!erori.length, `B: fără erori JS (${erori.join(' | ')})`);
      await ctx.close();
    }

    // ── C. Sesiune creată cu versiunea veche → reîmprospătată de 2.45.0; D. ieșirea ──
    {
      const auth = serverAuth();
      const u = auth.utilizator('vechi@example.com'); u.parola = 'Parola-Veche-1'; u.email_confirmed_at = new Date().toISOString();
      const { ctx, page, erori } = await context(br, auth);
      let veche = null;
      if (SURSA_VECHE && /esm\.sh/.test(SURSA_VECHE)) {
        await page.goto(SITE + '/test-vechi');
        veche = await gata(page).then(() => true, () => false);
      }
      if (!veche) {
        console.log('  (C sărit: versiunea veche nu se poate încărca de pe esm.sh — fără rețea?)');
      } else {
        const vers = await page.evaluate(() => [...document.querySelectorAll('script')].length && performance.getEntriesByType('resource').map((r) => r.name).find((n) => /esm\.sh\/@supabase\/supabase-js@[\d.]+\//.test(n)) || '');
        const vVeche = (vers.match(/supabase-js@([\d.]+)/) || [])[1] || '?';
        verifica(/^\d+\.\d+\.\d+$/.test(vVeche) && vVeche !== '2.45.0', `C: sesiunea se creează cu versiunea veche, de pe esm.sh (${vVeche})`);
        console.log(`  C: sesiunea veche creată cu supabase-js ${vVeche} (esm.sh), citită și reîmprospătată de 2.45.0 (lib/vendor/)`);
        const user = await page.evaluate(() => window.MyDarrinAuth.performLogin('vechi@example.com', 'Parola-Veche-1').then((x) => x && x.email, (e) => 'eroare: ' + e.message));
        verifica(user === 'vechi@example.com', `C: login cu versiunea veche (${user})`);
        const ckVechi = await cookieuriSesiune(ctx);
        const sVeche = sesiuneDinCookieuri(ckVechi);
        verifica(sVeche && sVeche.refresh_token, `C: cookie-urile scrise de versiunea veche (${ckVechi.map((c) => c.name).join(', ')})`);

        // 1) 2.45.0 citește sesiunea veche fără nicio cerere
        const nApel = auth.s.apeluri.length;
        await page.goto(SITE + '/test-nou'); await gata(page);
        const citit = await page.evaluate(() => window.supabaseClient.auth.getSession().then((r) => r.data.session && r.data.session.access_token));
        verifica(citit === sVeche.access_token, 'C: 2.45.0 citește sesiunea scrisă de versiunea veche');
        verifica(!auth.s.apeluri.slice(nApel).some((x) => x.grant === 'refresh_token'), 'C: fără reîmprospătare cât timp tokenul e valabil');
        const mw = (() => { // aceeași citire ca middleware.js (extrageSesiune)
          const harta = {}; ckVechi.forEach((c) => { harta[c.name] = c.value; });
          let lipit = ''; for (let i = 0; harta[`${CHEIE}.${i}`] !== undefined; i++) lipit += harta[`${CHEIE}.${i}`];
          try { return JSON.parse(decodeURIComponent(lipit || harta[CHEIE] || '')).access_token; } catch (e) { return null; }
        })();
        verifica(mw === sVeche.access_token, 'C: cookie-ul vechi rămâne citibil de middleware.js');

        // 2) access_token-ul expiră → reîmprospătare cu refresh token-ul vechi, o singură dată
        const expirata = Object.assign({}, sVeche, { expires_at: Math.floor(Date.now() / 1000) - 60 });
        const enc = encodeURIComponent(JSON.stringify(expirata));
        await ctx.clearCookies();
        const bucati = []; for (let i = 0; i < enc.length; i += 3200) bucati.push(enc.slice(i, i + 3200));
        await ctx.addCookies(bucati.map((v, i) => ({ name: `${CHEIE}.${i}`, value: v, domain: '.mydarrin.homebestpal.com', path: '/', secure: true, sameSite: 'Lax' })));
        const nRefresh = auth.s.apeluri.length;
        await page.goto(SITE + '/test-nou'); await gata(page);
        const nou = await page.evaluate(() => window.supabaseClient.auth.getSession().then((r) => r.data.session));
        const refreshuri = auth.s.apeluri.slice(nRefresh).filter((x) => x.grant === 'refresh_token');
        verifica(refreshuri.length === 1 && refreshuri[0].corp.refresh_token === sVeche.refresh_token, `C: o singură reîmprospătare, cu refresh token-ul vechi (${refreshuri.length})`);
        verifica(nou && nou.access_token && nou.access_token !== sVeche.access_token && nou.user.email === 'vechi@example.com' && nou.expires_at > Date.now() / 1000, 'C: sesiune nouă, același utilizator');
        const sCookie = sesiuneDinCookieuri(await cookieuriSesiune(ctx));
        verifica(sCookie && sCookie.access_token === nou.access_token && sCookie.refresh_token !== sVeche.refresh_token, 'C: cookie-urile rescrise cu sesiunea nouă (refresh token rotit)');
        await page.reload(); await gata(page);
        const dupaRel = await page.evaluate(() => window.supabaseClient.auth.getSession().then((r) => r.data.session && r.data.session.access_token));
        verifica(dupaRel === nou.access_token, 'C: după reîncărcare, sesiunea nouă, fără altă reîmprospătare');
        verifica(await page.evaluate(() => !!window.MYD_PROFIL.devreme()), 'C: lib/profil-cont.js citește tokenul nou din cookie');

        // ── D. Ieșirea din cont ──
        await page.evaluate(() => { window.MyDarrinAuth.performLogout(); });
        await page.waitForURL((x) => x.hostname === 'mydarrin.homebestpal.com' && (x.pathname === '/' || x.pathname === ''), { timeout: 10000 }).catch(() => {});
        const logout = auth.s.apeluri.filter((x) => x.p === '/logout');
        verifica(logout.length === 1 && logout[0].auth === 'Bearer ' + nou.access_token, `D: /auth/v1/logout cu tokenul curent (${logout.length})`);
        verifica(!(await cookieuriSesiune(ctx)).length, `D: toate cookie-urile de sesiune șterse (${(await cookieuriSesiune(ctx)).map((c) => c.name).join(', ')})`);
        verifica(new URL(page.url()).hostname === 'mydarrin.homebestpal.com', `D: după ieșire, pagina principală (${page.url()})`);
        await page.goto(SITE + '/test-nou'); await gata(page);
        verifica(await page.evaluate(() => window.supabaseClient.auth.getSession().then((r) => !r.data.session)), 'D: după ieșire, nicio sesiune');
      }
      verifica(!erori.length, `C/D: fără erori JS (${erori.join(' | ')})`);
      await ctx.close();
    }

    // ── E. Superadminul rămâne pe admin.…/mydarrin-superadmin ──
    {
      const auth = serverAuth();
      const u = auth.utilizator('super@example.com'); u.parola = 'Parola-Super-1'; u.email_confirmed_at = new Date().toISOString(); u.roluri = ['superadmin'];
      const { ctx, page } = await context(br, auth);
      await ctx.route(/cdn\.tailwindcss\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com|googletagmanager/, (r) => r.fulfill({ status: 200, contentType: /css/.test(r.request().url()) ? 'text/css' : 'application/javascript', body: '' }));
      await page.goto(SITE + '/test-nou'); await gata(page);
      const user = await page.evaluate(() => window.MyDarrinAuth.performLogin('super@example.com', 'Parola-Super-1').then((x) => x && x.email, (e) => 'eroare: ' + e.message));
      verifica(user === 'super@example.com', `E: login superadmin (${user})`);
      const ADMIN = 'https://admin.mydarrin.homebestpal.com';
      if (process.env.DEPANARE) {
        page.on('console', (m) => console.log('   [consola]', m.type(), m.text().slice(0, 200)));
        page.on('request', (r) => { if (/supabase\.co|\/api\//.test(r.url())) console.log('   [cerere]', r.method(), r.url().slice(0, 140)); });
        page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('   [navigare]', f.url()); });
      }
      for (const incercare of [1, 2, 3]) {
        await page.goto(ADMIN + '/mydarrin-superadmin', { waitUntil: 'load' });
        await page.waitForTimeout(2500);
        const st = await page.evaluate(() => ({ url: location.href, poarta: !!document.getElementById('auth-gate-overlay') }));
        verifica(new URL(st.url).hostname === 'admin.mydarrin.homebestpal.com' && /mydarrin-superadmin/.test(st.url), `E${incercare}: superadminul rămâne pe admin.…/mydarrin-superadmin (${st.url})`);
        verifica(!st.poarta, `E${incercare}: bariera din pagină trece („Se verifică accesul…” dispare)`);
      }
      // Un cont fără rolul superadmin e trimis tot pe site (regula neschimbată).
      u.roluri = ['client'];
      await page.goto(ADMIN + '/mydarrin-superadmin', { waitUntil: 'load' });
      await page.waitForURL((x) => x.hostname === 'mydarrin.homebestpal.com', { timeout: 10000 }).catch(() => {});
      verifica(new URL(page.url()).hostname === 'mydarrin.homebestpal.com', `E: fără rolul superadmin → site-ul public, ca înainte (${page.url()})`);
      await ctx.close();
    }
  } finally {
    await br.close();
  }
  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
