// scripts/test-destinatie-rol.js
// Teste pentru pasul 10b, 2.2–2.3: harta unică rol → dashboard
// (lib/destinatie-rol.js, copiată în ui-comun.js) și destinația după login
// (api/public/destinatie-post-login.js) pentru fiecare rol, roluri multiple,
// acces temporar și cont fără rol. Supabase simulat în memorie.
// Pasul 11-R2 (1 nov. 2026): clientul fără comenzi (fără destinație), rolul de
// partener ales la înscriere și încă neacordat (formularul firmei), fereastra
// comună de cont (cont-fereastra.js) în locul celor 14 copii.
//
// Rulare: node scripts/test-destinatie-rol.js

const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
const { DB, cerere, raspuns, RADACINA } = sim;
sim.instaleaza();

const DR = require(path.join(RADACINA, 'lib/destinatie-rol.js'));
const { laZi } = require('./genereaza-destinatie-rol');
const destinatie = require(path.join(RADACINA, 'api/public/destinatie-post-login.js'));

let trecute = 0;
let picate = 0;
async function test(nume, fn) {
  try { await fn(); trecute++; console.log(`  ✓ ${nume}`); } catch (e) { picate++; console.log(`  ✗ ${nume}\n      ${e.message}`); }
}
function egal(a, b, mesaj) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${mesaj || ''} — așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(v, mesaj) { if (!v) throw new Error(mesaj || 'condiție falsă'); }

const MAINE = new Date(Date.now() + 86400000).toISOString();
const IERI = new Date(Date.now() - 86400000).toISOString();

function reset() {
  DB.tabele = { profiles: [], admin_permissions: [], accese_temporare: [], comenzi: [] };
  DB.coloane = {};
  DB.utilizatori = {};
}
function cont(id, roles, extra = {}) {
  DB.tabele.profiles.push({ id, email: `${id}@test`, roles, rol_solicitat: extra.rol_solicitat || null });
  DB.utilizatori[`tok-${id}`] = { id, email: extra.email || `${id}@test`, user_metadata: extra.user_metadata || {} };
}
function comanda(clientId) { DB.tabele.comenzi.push({ id: `c-${++DB.seq}`, client_id: clientId, status: 'creata' }); }
async function dupaLogin(id) {
  const res = raspuns();
  await destinatie(cerere({ token: `tok-${id}` }), res);
  return res;
}

(async () => {
  console.log('Harta unică rol → dashboard');
  await test('cele 8 destinații cerute', () => {
    egal(DR.dashboardPentruRol('partener_servicii'), '/mydarrin-dashboard-partener.html?type=servicii');
    egal(DR.dashboardPentruRol('partener_curier'), '/mydarrin-dashboard-partener.html?type=curier');
    egal(DR.dashboardPentruRol('partener_asigurari'), '/mydarrin-dashboard-partener.html?type=asigurari');
    egal(DR.dashboardPentruRol('partener_materiale'), '/mydarrin-dashboard-furnizor.html?type=materiale');
    egal(DR.dashboardPentruRol('partener_inchirieri'), '/mydarrin-dashboard-furnizor.html?type=inchirieri');
    egal(DR.dashboardPentruRol('investor'), '/mydarrin-investitori.html');
    egal(DR.dashboardPentruRol('client'), '/mydarrin-dashboard-client.html');
    egal(DR.dashboardPentruRol('admin'), null);
  });
  await test('roluriPentruPagina: pagina + type → rolul', () => {
    egal(DR.roluriPentruPagina('/mydarrin-dashboard-furnizor.html', 'materiale'), ['partener_materiale']);
    egal(DR.roluriPentruPagina('mydarrin-dashboard-furnizor', 'inchirieri'), ['partener_inchirieri']);
    egal(DR.roluriPentruPagina('/mydarrin-dashboard-furnizor', null), ['partener_materiale', 'partener_inchirieri']);
    egal(DR.roluriPentruPagina('/mydarrin-dashboard-client.html', null), ['client']);
    egal(DR.roluriPentruPagina('/mydarrin-dashboard-partener.html', 'curier'), ['partener_curier']);
  });
  await test('„client” nu contează lângă un rol de partener', () => {
    egal(DR.roluriCuDashboard(['client', 'partener_materiale']), ['partener_materiale']);
    egal(DR.roluriCuDashboard(['client']), ['client']);
    egal(DR.roluriCuDashboard(['partener_curier', 'investor', 'client']), ['partener_curier', 'investor']);
    egal(DR.roluriCuDashboard(['admin']), []);
  });
  await test('ui-comun.js conține exact copia generată din lib/destinatie-rol.js', () => {
    adevarat(laZi(), 'rulează node scripts/genereaza-destinatie-rol.js');
  });
  await test('nicio altă hartă rol → dashboard în cod (DASHBOARD_MAP, dashLink, ?type= scris de mână)', () => {
    const fisiere = fs.readdirSync(RADACINA).filter((f) => /\.(html|js)$/.test(f)).concat(['account-system.js']);
    const gasite = [];
    for (const f of new Set(fisiere)) {
      let text = fs.readFileSync(path.join(RADACINA, f), 'utf8');
      if (f === 'ui-comun.js') text = text.replace(/\/\/ <destinatie-rol:inceput>[\s\S]*?\/\/ <destinatie-rol:sfarsit>/, '');
      if (/DASHBOARD_MAP\s*=|dashLink\s*:/.test(text)) gasite.push(`${f}: DASHBOARD_MAP / dashLink`);
      if (/['"`]\/?mydarrin-dashboard-(furnizor|partener)\.html\?type=(materiale|inchirieri|servicii|curier|asigurari)['"`]/.test(text)) gasite.push(`${f}: URL de dashboard scris de mână`);
    }
    egal(gasite, []);
  });

  console.log('\nDestinația după login (destinatie-post-login)');
  const cazuri = [
    ['superadmin', ['superadmin', 'client'], '/mydarrin-superadmin'],
    ['furnizor de materiale (HBP, cu client rămas)', ['client', 'partener_materiale'], '/mydarrin-dashboard-furnizor.html?type=materiale'],
    ['furnizor de închirieri', ['partener_inchirieri'], '/mydarrin-dashboard-furnizor.html?type=inchirieri'],
    ['partener servicii', ['partener_servicii'], '/mydarrin-dashboard-partener.html?type=servicii'],
    ['curier', ['partener_curier'], '/mydarrin-dashboard-partener.html?type=curier'],
    ['asigurător', ['partener_asigurari'], '/mydarrin-dashboard-partener.html?type=asigurari'],
    ['investitor', ['investor'], '/mydarrin-investitori.html'],
    ['client cu o comandă', ['client'], '/mydarrin-dashboard-client.html'],
  ];
  for (const [nume, roles, asteptat] of cazuri) {
    await test(`${nume} → ${asteptat}`, async () => {
      reset();
      cont('u1', roles);
      comanda('u1');
      const res = await dupaLogin('u1');
      egal(res.statusCode, 200, JSON.stringify(res.corp));
      egal(res.corp.destinatie, asteptat);
    });
  }
  await test('admin cu drept de catalog → /mydarrin-admin-catalog', async () => {
    reset();
    cont('a1', ['admin']);
    DB.tabele.admin_permissions.push({ admin_id: 'a1', sectiune: 'catalog_servicii', poate_scrie: true, sectiune_specializata: 'F,N' });
    const res = await dupaLogin('a1');
    egal(res.corp.destinatie, '/mydarrin-admin-catalog');
  });
  await test('admin fără drept de catalog și fără alt rol → /mydarrin-superadmin (ca înainte)', async () => {
    reset();
    cont('a2', ['admin']);
    DB.tabele.admin_permissions.push({ admin_id: 'a2', sectiune: 'catalog_servicii', poate_scrie: false, sectiune_specializata: 'F' });
    const res = await dupaLogin('a2');
    egal(res.corp.destinatie, '/mydarrin-superadmin');
  });
  await test('mai multe roluri → „Rolurile mele”, cu lista rolurilor', async () => {
    reset();
    cont('m1', ['client', 'partener_curier', 'investor']);
    const res = await dupaLogin('m1');
    egal(res.corp.tip, 'alegere');
    egal(res.corp.destinatie, '/mydarrin-rolurile-mele'); // pasul 11-L: alegerea rolului e pagina „Rolurile mele”
    egal(res.corp.roluri, ['partener_curier', 'investor']);
  });

  console.log('\nPasul 11-R2: clientul fără comenzi și rolul ales la înscriere');
  await test('client fără nicio comandă → 200, fără destinație (rămâne pe pagina curentă)', async () => {
    reset();
    cont('k1', ['client']);
    const res = await dupaLogin('k1');
    egal(res.statusCode, 200, JSON.stringify(res.corp));
    egal(res.corp.tip, 'client_fara_comenzi');
    egal(res.corp.destinatie, null);
  });
  await test('comenzile altui client nu contează', async () => {
    reset();
    cont('k2', ['client']);
    comanda('altcineva');
    egal((await dupaLogin('k2')).corp.destinatie, null);
  });
  await test('client cu cel puțin o comandă → dashboard-ul clientului', async () => {
    reset();
    cont('k3', ['client']);
    comanda('k3'); comanda('k3');
    egal((await dupaLogin('k3')).corp.destinatie, '/mydarrin-dashboard-client.html');
  });
  const solicitate = [
    ['partener_servicii', '/mydarrin-devino-partener.html?type=servicii'],
    ['partener_materiale', '/mydarrin-devino-partener.html?type=materiale'],
    ['partener_inchirieri', '/mydarrin-devino-partener.html?type=inchirieri'],
    ['partener_curier', '/mydarrin-devino-partener.html?type=curier'],
    ['partener_asigurari', '/mydarrin-devino-partener.html?type=asigurator'],
  ];
  for (const [rol, asteptat] of solicitate) {
    await test(`a ales ${rol} la înscriere, încă fără rol → ${asteptat} (modul „cont existent”)`, async () => {
      reset();
      cont('s1', ['client'], { rol_solicitat: rol });
      const res = await dupaLogin('s1');
      egal(res.statusCode, 200, JSON.stringify(res.corp));
      egal(res.corp.tip, 'completare_partener');
      egal(res.corp.destinatie, asteptat);
    });
  }
  await test('rolul ales nu dă niciun drept: profiles.roles rămâne neschimbat', async () => {
    reset();
    cont('s2', ['client'], { rol_solicitat: 'partener_curier' });
    await dupaLogin('s2');
    egal(DB.tabele.profiles[0].roles, ['client']);
  });
  await test('a ales un rol de partener și îl are activ → dashboard-ul rolului (ca azi)', async () => {
    reset();
    cont('s3', ['client', 'partener_servicii'], { rol_solicitat: 'partener_servicii' });
    egal((await dupaLogin('s3')).corp.destinatie, '/mydarrin-dashboard-partener.html?type=servicii');
  });
  await test('a ales alt tip de partener decât cel activ → dashboard-ul rolului activ (un singur tip pe cont)', async () => {
    reset();
    cont('s4', ['client', 'partener_materiale'], { rol_solicitat: 'partener_curier' });
    egal((await dupaLogin('s4')).corp.destinatie, '/mydarrin-dashboard-furnizor.html?type=materiale');
  });
  await test('a ales „client” la înscriere, fără comenzi → fără destinație', async () => {
    reset();
    cont('s5', ['client'], { rol_solicitat: 'client' });
    egal((await dupaLogin('s5')).corp.tip, 'client_fara_comenzi');
  });
  await test('valoare necunoscută în rol_solicitat (ex. superadmin) → ignorată', async () => {
    reset();
    cont('s6', ['client'], { rol_solicitat: 'superadmin' });
    const res = await dupaLogin('s6');
    egal(res.corp.tip, 'client_fara_comenzi');
    egal(DB.tabele.profiles[0].roles, ['client']);
  });
  await test('mai multe roluri, fără comenzi de client → „Rolurile mele” (ca azi)', async () => {
    reset();
    cont('s7', ['client', 'partener_curier', 'investor']);
    const res = await dupaLogin('s7');
    egal(res.corp.destinatie, '/mydarrin-rolurile-mele');
    egal(res.corp.roluri, ['partener_curier', 'investor']);
  });
  await test('migrarea neaplicată (fără coloana rol_solicitat) → citește doar roles, ca înainte', async () => {
    reset();
    DB.coloane.profiles = ['id', 'email', 'roles'];
    DB.tabele.profiles.push({ id: 'm2', email: 'm2@test', roles: ['client'] });
    DB.utilizatori['tok-m2'] = { id: 'm2', email: 'm2@test' };
    comanda('m2');
    const res = await dupaLogin('m2');
    egal(res.statusCode, 200, JSON.stringify(res.corp));
    egal(res.corp.destinatie, '/mydarrin-dashboard-client.html');
  });
  await test('tabela comenzi indisponibilă → clientul își păstrează dashboard-ul (ca înainte)', async () => {
    reset();
    delete DB.tabele.comenzi;
    cont('m3', ['client']);
    egal((await dupaLogin('m3')).corp.destinatie, '/mydarrin-dashboard-client.html');
  });
  await test('/api/cont/profil: clientul fără comenzi nu are dashboard (roluri_dashboard gol, are_comenzi false)', async () => {
    reset();
    ['partners', 'audit_log', 'investitori_kyc', 'partner_conturi_bancare', 'investitori', 'entitati_platforma'].forEach((t) => { DB.tabele[t] = []; });
    cont('p1', ['client'], { rol_solicitat: 'client' });
    const profil = require(path.join(RADACINA, 'api/cont/profil.js'));
    const res = raspuns();
    await profil(cerere({ token: 'tok-p1' }), res);
    egal(res.statusCode, 200, JSON.stringify(res.corp));
    egal(res.corp.roluri_dashboard, []);
    egal(res.corp.are_comenzi, false);
    egal(res.corp.destinatie, null);
    egal(res.corp.rol_solicitat, 'client');
    comanda('p1');
    const res2 = raspuns();
    await profil(cerere({ token: 'tok-p1' }), res2);
    egal(res2.corp.roluri_dashboard, ['client']);
    egal(res2.corp.are_comenzi, true);
  });

  await test('acces temporar activ, NDA acceptat → ruta alocată (ca azi)', async () => {
    reset();
    cont('t1', ['client']);
    DB.tabele.accese_temporare.push({ email: 't1@test', activ: true, expira_la: MAINE, nda_acceptat: true, ruta_url: '/mydarrin-catalog' });
    const res = await dupaLogin('t1');
    egal(res.corp.destinatie, '/mydarrin-catalog');
  });
  await test('acces temporar „*” → /home; fără NDA → /acord-confidentialitate', async () => {
    reset();
    cont('t2', []);
    DB.tabele.accese_temporare.push({ email: 't2@test', activ: true, expira_la: MAINE, nda_acceptat: true, ruta_url: '*' });
    egal((await dupaLogin('t2')).corp.destinatie, '/home');
    DB.tabele.accese_temporare[0].nda_acceptat = false;
    egal((await dupaLogin('t2')).corp.destinatie, '/acord-confidentialitate');
  });
  await test('acces temporar expirat → 403, RO + EN', async () => {
    reset();
    cont('t3', ['client']);
    DB.tabele.accese_temporare.push({ email: 't3@test', activ: true, expira_la: IERI, nda_acceptat: true, ruta_url: '*' });
    const res = await dupaLogin('t3');
    egal(res.statusCode, 403);
    adevarat(res.corp.error && res.corp.error_en, JSON.stringify(res.corp));
  });
  await test('cont fără niciun rol și fără acces temporar → 403, RO + EN', async () => {
    reset();
    cont('n1', []);
    const res = await dupaLogin('n1');
    egal(res.statusCode, 403);
    egal(res.corp.error, 'Acest cont nu are încă acces alocat pe platformă. Contactează administratorul.');
    egal(res.corp.error_en, 'This account has not been granted access to the platform yet. Contact the administrator.');
  });
  await test('fără sesiune → 401', async () => {
    reset();
    const res = raspuns();
    await destinatie(cerere({}), res);
    egal(res.statusCode, 401);
  });

  console.log('\nFereastra comună de cont (pasul 11-R2)');
  await test('nicio pagină nu mai are copia ei de #auth-modal sau funcțiile de login / înscriere', () => {
    const NUME = ['performLogin', 'performRegister', 'confirmaCod', 'retrimiteCod', 'switchAuthTab', 'toggleAuthModal', 'oauthLogin', 'cerereResetareParola', 'redirectDupaAutentificare'];
    const gresite = [];
    for (const f of fs.readdirSync(RADACINA).filter((x) => x.endsWith('.html'))) {
      const t = fs.readFileSync(path.join(RADACINA, f), 'utf8');
      if (t.includes('id="auth-modal"')) gresite.push(`${f}: #auth-modal`);
      NUME.forEach((n) => { if (new RegExp('function\\s+' + n + '\\s*\\(').test(t)) gresite.push(`${f}: ${n}`); });
      if (/function\s+checkAuth\s*\([^)]*\)\s*\{\s*alert\(/.test(t)) gresite.push(`${f}: checkAuth cu alert()`);
    }
    egal(gresite, []);
  });
  await test('paginile publice cu ui-comun.js includ cont-fereastra.js înaintea lui; checkout rămâne pe pagină', () => {
    const INTERNE = ['mydarrin-superadmin.html', 'mydarrin-deviz-engine.html', 'mydarrin-design-system.html', 'mydarrin-business-model.html', 'mydarrin-sync-architecture.html'];
    const gresite = [];
    for (const f of fs.readdirSync(RADACINA).filter((x) => x.endsWith('.html') && !INTERNE.includes(x))) {
      const t = fs.readFileSync(path.join(RADACINA, f), 'utf8');
      const uc = t.search(/<script src="\/?ui-comun\.js"/);
      if (uc < 0) continue;
      const cf = t.search(/<script src="\/?cont-fereastra\.js"/);
      if (cf < 0 || cf > uc) gresite.push(f);
    }
    egal(gresite, []);
    adevarat(/cont-fereastra\.js" data-dupa-login="ramai"/.test(fs.readFileSync(path.join(RADACINA, 'mydarrin-checkout.html'), 'utf8')), 'checkout fără data-dupa-login="ramai"');
  });
  await test('cont-fereastra.js trimite după login / cod la destinația de pe server (mergiDupaLogin), fără reload()', () => {
    const t = fs.readFileSync(path.join(RADACINA, 'cont-fereastra.js'), 'utf8');
    adevarat(t.includes('MyDarrinAuth.mergiDupaLogin('), 'fără mergiDupaLogin');
    adevarat(!/alert\(|confirm\(|prompt\(/.test(t.replace(/\/\/.*$/gm, '')), 'alert / confirm / prompt în cont-fereastra.js');
  });
  await test('reset-password.html cere destinația după setarea parolei', () => {
    const t = fs.readFileSync(path.join(RADACINA, 'reset-password.html'), 'utf8');
    adevarat(t.includes("/api/public/destinatie-post-login") && !t.includes("window.location.href='/'"), 'reset-password încă trimite la /');
  });

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
})();
