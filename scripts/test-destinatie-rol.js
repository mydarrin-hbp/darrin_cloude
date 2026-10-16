// scripts/test-destinatie-rol.js
// Teste pentru pasul 10b, 2.2–2.3: harta unică rol → dashboard
// (lib/destinatie-rol.js, copiată în ui-comun.js) și destinația după login
// (api/public/destinatie-post-login.js) pentru fiecare rol, roluri multiple,
// acces temporar și cont fără rol. Supabase simulat în memorie.
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
  DB.tabele = { profiles: [], admin_permissions: [], accese_temporare: [] };
  DB.coloane = {};
  DB.utilizatori = {};
}
function cont(id, roles, extra = {}) {
  DB.tabele.profiles.push({ id, email: `${id}@test`, roles });
  DB.utilizatori[`tok-${id}`] = { id, email: extra.email || `${id}@test` };
}
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
    ['client', ['client'], '/mydarrin-dashboard-client.html'],
  ];
  for (const [nume, roles, asteptat] of cazuri) {
    await test(`${nume} → ${asteptat}`, async () => {
      reset();
      cont('u1', roles);
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
  await test('mai multe roluri → alegerea rolului, cu lista rolurilor', async () => {
    reset();
    cont('m1', ['client', 'partener_curier', 'investor']);
    const res = await dupaLogin('m1');
    egal(res.corp.tip, 'alegere');
    egal(res.corp.destinatie, '/?alege_rol=1');
    egal(res.corp.roluri, ['partener_curier', 'investor']);
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

  console.log('\nPaginile de login trimit la destinație, nu la reload()');
  await test('performLogin din cele 13 pagini → MyDarrinAuth.mergiDupaLogin; checkout rămâne pe pagină', () => {
    const cuLogin = fs.readdirSync(RADACINA).filter((f) => f.endsWith('.html') && fs.readFileSync(path.join(RADACINA, f), 'utf8').includes('async function performLogin('));
    const gresite = [];
    for (const f of cuLogin) {
      const t = fs.readFileSync(path.join(RADACINA, f), 'utf8');
      const corp = t.slice(t.indexOf('async function performLogin('), t.indexOf('\n}\n', t.indexOf('async function performLogin(')));
      const merge = corp.includes('MyDarrinAuth.mergiDupaLogin()');
      if (f === 'mydarrin-checkout.html' ? merge : !merge) gresite.push(f);
    }
    egal(gresite, []);
    adevarat(cuLogin.length === 14, `${cuLogin.length} pagini cu performLogin`);
  });
  await test('reset-password.html cere destinația după setarea parolei', () => {
    const t = fs.readFileSync(path.join(RADACINA, 'reset-password.html'), 'utf8');
    adevarat(t.includes("/api/public/destinatie-post-login") && !t.includes("window.location.href='/'"), 'reset-password încă trimite la /');
  });

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
})();
