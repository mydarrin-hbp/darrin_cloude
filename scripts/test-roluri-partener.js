// scripts/test-roluri-partener.js
// Teste pentru pasul 10b, 2.1: rolul de partener ajunge în profiles.roles
// la înregistrare (api/public/partner-register.js) și la aprobare
// (api/admin/verifica-document.js), cu harta unică din lib/roluri-partener.js,
// aceeași ca în migrarea docs/migrations-propuse/2026-10-16_roluri_parteneri.sql.
//
// Supabase simulat în memorie (scripts/supabase-simulat.js). createUser
// imită trigger-ul handle_new_user() de azi: rândul din profiles se creează
// cu role = 'client' și status = 'pending_otp' (app_metadata nu e încă
// vizibilă la inserare). Fără rețea: fără RESEND_API_KEY, emailul nu pleacă.
//
// Rulare: node scripts/test-roluri-partener.js

const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
const { DB, supabaseAdmin, cerere, raspuns, RADACINA } = sim;
sim.instaleaza();

// @vercel/kv simulat (rate-limit): fără Vercel KV local.
const kvPath = require.resolve('@vercel/kv', { paths: [RADACINA] });
require.cache[kvPath] = { id: kvPath, filename: kvPath, loaded: true, exports: { kv: { incr: async () => 1, expire: async () => 1 } } };
delete process.env.RESEND_API_KEY;

const R = require(path.join(RADACINA, 'lib/roluri-partener.js'));

let trecute = 0;
let picate = 0;
async function test(nume, fn) {
  try { await fn(); trecute++; console.log(`  ✓ ${nume}`); } catch (e) { picate++; console.log(`  ✗ ${nume}\n      ${e.stack || e.message}`); }
}
function egal(a, b, mesaj) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${mesaj || ''} — așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(v, mesaj) { if (!v) throw new Error(mesaj || 'condiție falsă'); }

// ── Auth simulat ──────────────────────────────────────────────────────────
const conturiAuth = {};
supabaseAdmin.auth.admin = {
  async createUser({ email, app_metadata }) {
    if (Object.values(conturiAuth).some((u) => u.email === email)) return { data: null, error: { status: 422, message: 'User already registered' } };
    const id = `u-${++DB.seq}`;
    conturiAuth[id] = { id, email, app_metadata, last_sign_in_at: null };
    // handle_new_user() de azi: rolul din app_metadata nu e vizibil la inserare.
    DB.tabele.profiles.push({ id, email, role: 'client', roles: ['client'], status: 'pending_otp' });
    return { data: { user: conturiAuth[id] }, error: null };
  },
  async generateLink() { return { data: { properties: { hashed_token: 'tok' } }, error: null }; },
  async getUserById(id) { return { data: { user: conturiAuth[id] || null }, error: null }; },
  async deleteUser(id) { delete conturiAuth[id]; return { error: null }; },
};
supabaseAdmin.rpc = async () => ({ data: 'criptat', error: null });

function reset() {
  DB.tabele = { profiles: [], partners: [], partner_conturi_bancare: [], audit_log: [], backoffice_config: [], contact_platforma: [] };
  DB.coloane = { profiles: ['id', 'email', 'role', 'roles', 'status', 'tara', 'limba', 'phone'] };
  DB.utilizatori = { 'tok-admin': { id: 'admin-1', email: 'admin@x' } };
  DB.tabele.profiles.push({ id: 'admin-1', email: 'admin@x', role: 'admin', roles: ['admin'], status: 'active' });
}

const register = require(path.join(RADACINA, 'api/public/partner-register.js'));
const verifica = require(path.join(RADACINA, 'api/admin/verifica-document.js'));

async function inregistreaza(tip, email) {
  const res = raspuns();
  await register(cerere({ metoda: 'POST', body: { email, tip, nume_firma: `Firma ${tip}`, cui: 'RO1', tara: 'RO', nume: 'Ion' } }), res);
  return res;
}
const profil = (email) => DB.tabele.profiles.find((p) => p.email === email);

(async () => {
  console.log('Harta tip partener → rol');
  await test('cele cinci tipuri au rolul lor', () => {
    egal(R.rolPentruTipPartener('furnizor_materiale'), 'partener_materiale');
    egal(R.rolPentruTipPartener('inchirieri_utilaje'), 'partener_inchirieri');
    egal(R.rolPentruTipPartener('curier_utilitara'), 'partener_curier');
    egal(R.rolPentruTipPartener('asigurari'), 'partener_asigurari');
    egal(R.rolPentruTipPartener('servicii_tehnice'), 'partener_servicii');
    egal(R.rolPentruTipPartener('altceva'), null);
  });
  await test('adaugaRol păstrează rolurile existente și nu dublează', () => {
    egal(R.adaugaRol(['client'], 'partener_materiale'), ['client', 'partener_materiale']);
    egal(R.adaugaRol(['partener_materiale'], 'partener_materiale'), ['partener_materiale']);
    egal(R.adaugaRol(null, 'partener_curier'), ['partener_curier']);
  });
  await test('migrarea SQL folosește aceeași hartă', () => {
    const sql = fs.readFileSync(path.join(RADACINA, 'docs/migrations-propuse/2026-10-16_roluri_parteneri.sql'), 'utf8');
    for (const [tip, rol] of Object.entries(R.ROL_DUPA_TIP_PARTENER)) {
      adevarat(new RegExp(`\\('${tip}',\\s*'${rol}'\\)`).test(sql), `perechea ${tip} → ${rol} lipsește din migrare`);
      adevarat(new RegExp(`when '${tip}'\\s+then '${rol}'`).test(sql), `perechea ${tip} → ${rol} lipsește din verificarea migrării`);
    }
  });
  await test('partner-register și wizard-companie nu mai au hărți proprii', () => {
    for (const f of ['api/public/partner-register.js', 'api/partener/wizard-companie.js']) {
      const src = fs.readFileSync(path.join(RADACINA, f), 'utf8');
      adevarat(!/TYPE_TO_ROLE|TYPE_TO_ENUM/.test(src), `${f} are încă TYPE_TO_ROLE / TYPE_TO_ENUM`);
    }
  });

  console.log('\nÎnregistrare (partner-register)');
  for (const [tip, rol] of [['materiale', 'partener_materiale'], ['curier', 'partener_curier'], ['asigurari', 'partener_asigurari'], ['inchirieri', 'partener_inchirieri'], ['servicii', 'partener_servicii']]) {
    await test(`cont nou de ${tip} → ${rol} în profiles.roles, status active`, async () => {
      reset();
      const res = await inregistreaza(tip, `${tip}@firma.ro`);
      egal(res.statusCode, 200, JSON.stringify(res.corp));
      const p = profil(`${tip}@firma.ro`);
      adevarat(p.roles.includes(rol), `roles = ${JSON.stringify(p.roles)}`);
      egal(p.role, rol, 'profiles.role');
      egal(p.status, 'active', 'profiles.status');
      egal(DB.tabele.partners[0].partner_type, R.TIP_PARTENER_DUPA_FORMULAR[tip]);
    });
  }
  await test('tip invalid → 400, niciun cont creat', async () => {
    reset();
    const res = await inregistreaza('altceva', 'x@firma.ro');
    egal(res.statusCode, 400);
    egal(Object.keys(conturiAuth).filter((id) => conturiAuth[id].email === 'x@firma.ro').length, 0);
  });

  console.log('\nRol adăugat, nu înlocuit (asiguraRolInProfil)');
  await test('un client care devine partener le păstrează pe amândouă', async () => {
    reset();
    DB.tabele.profiles.push({ id: 'c1', email: 'c@x', role: 'client', roles: ['client'], status: 'active' });
    const r = await R.asiguraRolInProfil('c1', 'partener_materiale');
    egal(r.adaugat, true);
    egal(profil('c@x').roles, ['client', 'partener_materiale']);
    egal(profil('c@x').role, 'partener_materiale');
  });
  await test('un investitor păstrează rolul principal; rolul există deja → nicio scriere', async () => {
    reset();
    DB.tabele.profiles.push({ id: 'i1', email: 'i@x', role: 'investor', roles: ['investor', 'partener_curier'], status: 'active' });
    const r = await R.asiguraRolInProfil('i1', 'partener_curier');
    egal(r.adaugat, false);
    egal(profil('i@x').roles, ['investor', 'partener_curier']);
    egal(profil('i@x').role, 'investor');
  });
  await test('rol necunoscut → eroare (nu se scrie un rol de admin pe această cale)', async () => {
    reset();
    DB.tabele.profiles.push({ id: 'c2', email: 'c2@x', role: 'client', roles: ['client'] });
    let eroare = null;
    try { await R.asiguraRolInProfil('c2', 'superadmin'); } catch (e) { eroare = e; }
    adevarat(eroare, 'trebuia să refuze');
    egal(profil('c2@x').roles, ['client']);
  });

  console.log('\nAprobare (verifica-document)');
  await test('aprobarea adaugă rolul lipsă și scrie în audit', async () => {
    reset();
    DB.tabele.profiles.push({ id: 'hbp', email: 'contact@homebestpal.ro', role: 'client', roles: ['client'], status: 'pending_otp' });
    DB.tabele.partners.push({ id: 'hbp', partner_type: 'furnizor_materiale', nume_firma: 'Home Best Pal', cui: 'RO46577229', status_verificare: 'pending_review' });
    const res = raspuns();
    await verifica(cerere({ metoda: 'POST', token: 'tok-admin', body: { tip: 'partener', id: 'hbp', decizie: 'aprobat' } }), res);
    egal(res.statusCode, 200, JSON.stringify(res.corp));
    egal(res.corp.rol_adaugat, 'partener_materiale');
    egal(res.corp.rol_eroare, null);
    egal(profil('contact@homebestpal.ro').roles, ['client', 'partener_materiale']);
    egal(DB.tabele.partners[0].status_verificare, 'approved');
    adevarat(DB.tabele.audit_log.some((a) => a.actiune === 'rol_partener_adaugat' && a.entitate_id === 'hbp'), 'lipsește rândul de audit');
  });
  await test('aprobarea unui partener cu rolul deja corect nu scrie audit de rol', async () => {
    reset();
    DB.tabele.profiles.push({ id: 'p1', email: 'p1@x', role: 'partener_servicii', roles: ['partener_servicii'] });
    DB.tabele.partners.push({ id: 'p1', partner_type: 'servicii_tehnice', status_verificare: 'pending_review' });
    const res = raspuns();
    await verifica(cerere({ metoda: 'POST', token: 'tok-admin', body: { tip: 'partener', id: 'p1', decizie: 'aprobat' } }), res);
    egal(res.corp.rol_adaugat, null);
    adevarat(!DB.tabele.audit_log.some((a) => a.actiune === 'rol_partener_adaugat'), 'audit de rol nejustificat');
  });
  await test('respingerea nu adaugă rol', async () => {
    reset();
    DB.tabele.profiles.push({ id: 'p2', email: 'p2@x', role: 'client', roles: ['client'] });
    DB.tabele.partners.push({ id: 'p2', partner_type: 'curier_utilitara', status_verificare: 'pending_review' });
    const res = raspuns();
    await verifica(cerere({ metoda: 'POST', token: 'tok-admin', body: { tip: 'partener', id: 'p2', decizie: 'respins' } }), res);
    egal(res.statusCode, 200);
    egal(profil('p2@x').roles, ['client']);
  });

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
})();
