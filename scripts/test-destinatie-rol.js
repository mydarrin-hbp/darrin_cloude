// scripts/test-destinatie-rol.js
// Teste pentru pasul 10b, 2.2–2.3: harta unică rol → dashboard
// (lib/destinatie-rol.js, copiată în ui-comun.js) și destinația după login
// (api/public/destinatie-post-login.js) pentru fiecare rol, roluri multiple,
// acces temporar și cont fără rol. Supabase simulat în memorie.
// Pasul 11-R2 (1 nov. 2026): clientul fără comenzi (fără destinație), rolul de
// partener ales la înscriere și încă neacordat (formularul firmei), fereastra
// comună de cont (cont-fereastra.js) în locul celor 14 copii.
// Pasul 11-R3 (2 nov. 2026): clientul fără comenzi → catalogul; rolul de
// partener ales → dashboard-ul lui, în modul activare (lista „Activează
// contul”); fluxul complet al partenerului (servicii și materiale), paza
// endpoint-urilor și alegerea rolului (/api/cont/rol-solicitat).
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
const profilApi = require(path.join(RADACINA, 'api/cont/profil.js'));
const wizardApi = require(path.join(RADACINA, 'api/partener/wizard-companie.js'));
const rolApi = require(path.join(RADACINA, 'api/cont/rol-solicitat.js'));
const documenteApi = require(path.join(RADACINA, 'api/partener/documente.js'));

// Pasul 11-P1: pasul „Firma” verifică firma la ANAF; aici ANAF e simulat (firmă activă).
const fetchOriginal = global.fetch;
global.fetch = async (url, opt) => {
  if (!String(url).includes('anaf.ro')) return fetchOriginal(url, opt);
  const item = { date_generale: { cui: 46577229, denumire: 'FIRMA SIMULATA SRL' }, inregistrare_scop_Tva: { scpTVA: true }, stare_inactiv: { statusInactivi: false } };
  return { ok: true, status: 200, json: async () => ({ found: [item], notFound: [] }) };
};

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
  ['partners', 'audit_log', 'investitori_kyc', 'partner_conturi_bancare', 'investitori', 'entitati_platforma', 'documente_partener',
    'partner_coduri_nace', 'partner_alocari_sarcini', 'partner_zona_curier', 'partner_utilaje', 'partner_angajati', 'partner_tipuri_polita',
    'marketplace_materiale', 'marketplace_echipamente', 'backoffice_config', 'contact_platforma'].forEach((t) => { DB.tabele[t] = []; });
  DB.coloane = {};
  DB.utilizatori = {};
}
function cont(id, roles, extra = {}) {
  DB.tabele.profiles.push({ id, email: `${id}@test`, role: roles[0] || null, roles, rol_solicitat: extra.rol_solicitat || null, tara: 'RO' });
  DB.utilizatori[`tok-${id}`] = { id, email: extra.email || `${id}@test`, user_metadata: extra.user_metadata || {} };
}
function comanda(clientId) { DB.tabele.comenzi.push({ id: `c-${++DB.seq}`, client_id: clientId, status: 'creata' }); }
async function cheama(handler, opt) {
  const res = raspuns();
  const e = console.error; console.error = () => {};
  try { await handler(cerere(opt), res); } finally { console.error = e; }
  return res;
}
const profilul = (id) => cheama(profilApi, { token: `tok-${id}` }).then((r) => r.corp);
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

  console.log('\nPasul 11-R3: clientul fără comenzi și rolul de partener ales');
  await test('client fără nicio comandă → catalogul', async () => {
    reset();
    cont('k1', ['client']);
    const res = await dupaLogin('k1');
    egal(res.statusCode, 200, JSON.stringify(res.corp));
    egal(res.corp.tip, 'client_fara_comenzi');
    egal(res.corp.destinatie, '/mydarrin-catalog.html');
  });
  await test('comenzile altui client nu contează', async () => {
    reset();
    cont('k2', ['client']);
    comanda('altcineva');
    egal((await dupaLogin('k2')).corp.destinatie, '/mydarrin-catalog.html');
  });
  await test('excepția coș / checkout: revenirea o face browserul, înaintea destinației de pe server', () => {
    const as = fs.readFileSync(path.join(RADACINA, 'account-system.js'), 'utf8');
    const corp = as.slice(as.indexOf('async function mergiDupaLogin('));
    adevarat(corp.indexOf("myd_revenire_dupa_login") !== -1 && corp.indexOf('myd_revenire_dupa_login') < corp.indexOf('raspunsDestinatie()'), 'revenirea nu e verificată înaintea destinației');
    const cf = fs.readFileSync(path.join(RADACINA, 'cont-fereastra.js'), 'utf8');
    adevarat(/mydarrin-\(checkout\|cos\)/.test(cf) && cf.includes("ss(CHEIE_REVENIRE, location.pathname + location.search)"), 'cont-fereastra.js nu reține coșul / checkout-ul');
  });
  await test('client cu cel puțin o comandă → dashboard-ul clientului', async () => {
    reset();
    cont('k3', ['client']);
    comanda('k3'); comanda('k3');
    egal((await dupaLogin('k3')).corp.destinatie, '/mydarrin-dashboard-client.html');
  });
  const solicitate = [
    ['partener_servicii', '/mydarrin-dashboard-partener.html?type=servicii'],
    ['partener_materiale', '/mydarrin-dashboard-furnizor.html?type=materiale'],
    ['partener_inchirieri', '/mydarrin-dashboard-furnizor.html?type=inchirieri'],
    ['partener_curier', '/mydarrin-dashboard-partener.html?type=curier'],
    ['partener_asigurari', '/mydarrin-dashboard-partener.html?type=asigurari'],
  ];
  for (const [rol, asteptat] of solicitate) {
    await test(`a ales ${rol}, încă fără rol → ${asteptat} (modul activare)`, async () => {
      reset();
      cont('s1', ['client'], { rol_solicitat: rol });
      const res = await dupaLogin('s1');
      egal(res.statusCode, 200, JSON.stringify(res.corp));
      egal(res.corp.tip, 'activare_partener');
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
  await test('a ales „client” la înscriere, fără comenzi → catalogul', async () => {
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
  console.log('\nFluxul complet al partenerului (Supabase simulat)');
  for (const [tip, dashboard] of [['servicii', '/mydarrin-dashboard-partener.html?type=servicii'], ['materiale', '/mydarrin-dashboard-furnizor.html?type=materiale']]) {
    await test(`${tip}: cont nou → cod → dashboard în modul activare → Firma (rolul se adaugă) → lista actualizată`, async () => {
      reset();
      const rol = 'partener_' + tip;
      // Contul creat în fereastra comună: handle_new_user() pune „client” și rol_solicitat.
      cont('f1', ['client'], { rol_solicitat: rol });
      // După cod: destinația e dashboard-ul rolului, în modul activare.
      const d1 = await dupaLogin('f1');
      egal([d1.corp.tip, d1.corp.destinatie], ['activare_partener', dashboard]);
      const p1 = await profilul('f1');
      egal(p1.activare.mod_activare, true);
      egal(p1.activare.rol, rol);
      egal(p1.activare.pasi.map((x) => x.cheie), ['firma', 'cont_bancar', 'profesii', 'dotari', 'documente', 'contract']);
      egal(p1.activare.pasi.map((x) => x.stare), ['de_completat', 'blocat', 'blocat', 'blocat', 'blocat', 'blocat']);
      egal(p1.activare.pasi[0].deschide, { tip: 'wizard', pas: 2 });
      // Pasul „Firma”: serverul creează partenerul și adaugă rolul.
      const w = await cheama(wizardApi, { metoda: 'POST', token: 'tok-f1', body: { nume_firma: 'Firma Test SRL', cui: 'RO46577229', tip_entitate_legala: 'srl', partner_type: tip } });
      egal(w.statusCode, 200, JSON.stringify(w.corp));
      egal(DB.tabele.profiles[0].roles, ['client', rol]);
      // Lista actualizată: firma în verificare, restul deschise.
      const p2 = await profilul('f1');
      egal(p2.activare.mod_activare, false);
      egal(p2.activare.pasi.map((x) => x.stare), ['in_verificare', 'de_completat', 'de_completat', 'de_completat', 'de_completat', 'de_completat']);
      egal(p2.activare.verificare, 'pending_review');
      egal(p2.activare.activ, false);
      egal(p2.activare.pasi[3].deschide, tip === 'materiale' ? { tip: 'panou', id: 'produse' } : { tip: 'wizard', pas: 4 });
      // Login ulterior: dashboard-ul rolului, ca orice partener.
      egal((await dupaLogin('f1')).corp.destinatie, dashboard);
      // Datele completate schimbă starea punctelor.
      DB.tabele.partner_conturi_bancare.push({ id: 'cb1', partner_id: 'f1', activ: true });
      DB.tabele.documente_partener.push({ id: 'd1', partener_id: 'f1', status: 'pending' });
      if (tip === 'materiale') DB.tabele.marketplace_materiale.push({ id: 'm1', furnizor_id: 'f1' });
      else { DB.tabele.partner_coduri_nace.push({ id: 'n1', partner_id: 'f1', cod_nace: '43.22' }); DB.tabele.partner_utilaje.push({ id: 'u1', partner_id: 'f1' }); }
      DB.tabele.partner_alocari_sarcini.push({ id: 'a1', partner_id: 'f1', zona_livrare_acceptata: true });
      const p3 = await profilul('f1');
      egal(p3.activare.pasi.map((x) => x.stare), ['in_verificare', 'completat', 'completat', 'completat', 'in_verificare', 'de_completat']);
    });
  }

  console.log('\nPaza: modul activare și endpoint-urile de partener');
  await test('fără rol de partener ales → nu există modul activare (activare null)', async () => {
    reset();
    cont('g1', ['client'], { rol_solicitat: 'client' });
    egal((await profilul('g1')).activare, null);
  });
  await test('un endpoint de partener care nu ține de activare (documente) refuză contul fără rol → 403', async () => {
    reset();
    cont('g2', ['client'], { rol_solicitat: 'partener_servicii' });
    const r = await cheama(documenteApi, { token: 'tok-g2' });
    egal(r.statusCode, 403);
  });
  await test('pasul „Firma” refuză contul fără rol de partener ales → 403 FARA_ROL_ALES', async () => {
    reset();
    cont('g3', ['client']);
    const r = await cheama(wizardApi, { metoda: 'POST', token: 'tok-g3', body: { nume_firma: 'X SRL', cui: 'RO46577229', tip_entitate_legala: 'srl', partner_type: 'servicii' } });
    egal([r.statusCode, r.corp.cod], [403, 'FARA_ROL_ALES']);
    egal(DB.tabele.partners.length, 0);
  });
  await test('/api/cont/rol-solicitat: rol valid → salvat + dashboard; invalid → 400; alt tip decât partenerul existent → 409; fără sesiune → 401', async () => {
    reset();
    cont('r1', ['client']);
    const ok = await cheama(rolApi, { metoda: 'POST', token: 'tok-r1', body: { rol: 'partener_curier' } });
    egal([ok.statusCode, ok.corp.destinatie], [200, '/mydarrin-dashboard-partener.html?type=curier']);
    egal(DB.tabele.profiles[0].rol_solicitat, 'partener_curier');
    egal(DB.tabele.profiles[0].roles, ['client'], 'alegerea nu adaugă rolul');
    const rau = await cheama(rolApi, { metoda: 'POST', token: 'tok-r1', body: { rol: 'superadmin' } });
    egal([rau.statusCode, rau.corp.cod], [400, 'ROL_INVALID']);
    adevarat(rau.corp.mesaj.ro && rau.corp.mesaj.en, 'mesajul RO + EN');
    DB.tabele.partners.push({ id: 'r1', partner_type: 'furnizor_materiale', status_verificare: 'pending_review' });
    const alt = await cheama(rolApi, { metoda: 'POST', token: 'tok-r1', body: { rol: 'partener_curier' } });
    egal([alt.statusCode, alt.corp.cod], [409, 'ALT_TIP_PARTENER']);
    const anon = await cheama(rolApi, { metoda: 'POST', body: { rol: 'partener_curier' } });
    egal(anon.statusCode, 401);
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
    egal(res.corp.destinatie, '/mydarrin-catalog.html');
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
