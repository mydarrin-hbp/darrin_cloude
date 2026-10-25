// scripts/test-forme-juridice.js
// Teste pentru pasul 11-P1 (25 oct. 2026): partener poate fi doar o entitate
// cu statut juridic.
//   1. lib/forme-juridice.js: lista, cifra de control a CUI-ului, valideazaDateFirma;
//   2. lista din forme-juridice-public.js e identică cu cea din lib/ și cu migrarea;
//   3. api/public/partner-register.js și api/partener/wizard-companie.js:
//      fără formă juridică → 400 cu `camp`; persoana_fizica → 400 RO + EN;
//      SRL cu CUI valid → trece; firmă inactivă la ANAF → refuz; ANAF nu
//      răspunde → trece, cu marcaj pentru verificarea manuală;
//   4. api/admin/verifica-document.js refuză aprobarea fără formă juridică validă;
//   5. api/admin/parteneri-lista.js întoarce eticheta formei juridice;
//   6. api/public/cui-lookup.js semnalează firma inactivă;
//   7. paginile publice nu mai oferă „Persoană fizică”.
// Supabase simulat (scripts/supabase-simulat.js), `fetch` simulat — fără rețea.
//
// Rulare: node scripts/test-forme-juridice.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sim = require('./supabase-simulat');
const { DB, supabaseAdmin, cerere, raspuns, RADACINA } = sim;
sim.instaleaza();

// Limitarea de rată folosește Vercel KV; aici o lăsăm să treacă.
require.cache[require.resolve(path.join(RADACINA, 'lib/rate-limit.js'))] = {
  exports: { checkRateLimit: async () => true, getClientIp: () => '127.0.0.1' },
};
delete process.env.RESEND_API_KEY;

const F = require(path.join(RADACINA, 'lib/forme-juridice.js'));
const register = require(path.join(RADACINA, 'api/public/partner-register.js'));
const wizard = require(path.join(RADACINA, 'api/partener/wizard-companie.js'));
const verifica = require(path.join(RADACINA, 'api/admin/verifica-document.js'));
const lista = require(path.join(RADACINA, 'api/admin/parteneri-lista.js'));
const cuiLookup = require(path.join(RADACINA, 'api/public/cui-lookup.js'));

let trecute = 0;
let picate = 0;
async function test(nume, fn) {
  try { await fn(); trecute++; console.log(`  ✓ ${nume}`); } catch (e) { picate++; console.log(`  ✗ ${nume}\n      ${e.stack || e.message}`); }
}
function egal(a, b, mesaj) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${mesaj || ''} — așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(v, mesaj) { if (!v) throw new Error(mesaj || 'condiție falsă'); }
const tacut = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

// ── ANAF simulat ──────────────────────────────────────────────────────────
// stareAnaf: 'activa' | 'inactiva' | 'radiata' | 'indisponibil'
let stareAnaf = 'activa';
let apeluriAnaf = 0;
global.fetch = async (url) => {
  if (!String(url).includes('anaf.ro')) throw new Error(`rețea neașteptată: ${url}`);
  apeluriAnaf++;
  if (stareAnaf === 'indisponibil') throw new Error('ECONNRESET');
  const dg = { cui: 46577229, denumire: 'FIRMA SIMULATA SRL', adresa: 'ADRESA SIMULATA', nrRegCom: 'J00/0000/2000' };
  if (stareAnaf === 'radiata') dg.stare_inregistrare = 'RADIERE din data 01.01.2024';
  const item = { date_generale: dg, inregistrare_scop_Tva: { scpTVA: true }, stare_inactiv: { statusInactivi: stareAnaf === 'inactiva', dataRadiere: '' } };
  return { ok: true, status: 200, json: async () => ({ found: [item], notFound: [] }) };
};

// ── Auth simulat ──────────────────────────────────────────────────────────
const conturiAuth = {};
supabaseAdmin.auth.admin = {
  async createUser({ email, app_metadata }) {
    const id = `u-${++DB.seq}`;
    conturiAuth[id] = { id, email, app_metadata, last_sign_in_at: null };
    DB.tabele.profiles.push({ id, email, role: 'client', roles: ['client'], status: 'pending_otp' });
    return { data: { user: conturiAuth[id] }, error: null };
  },
  async generateLink() { return { data: { properties: { hashed_token: 'tok' } }, error: null }; },
  async getUserById(id) { return { data: { user: conturiAuth[id] || null }, error: null }; },
  async deleteUser(id) { delete conturiAuth[id]; return { error: null }; },
};
supabaseAdmin.rpc = async () => ({ data: 'criptat', error: null });

function reset() {
  stareAnaf = 'activa';
  apeluriAnaf = 0;
  Object.keys(conturiAuth).forEach((k) => delete conturiAuth[k]);
  DB.tabele = { profiles: [], partners: [], partner_conturi_bancare: [], audit_log: [], backoffice_config: [], contact_platforma: [] };
  DB.coloane = {};
  DB.utilizatori = {
    'tok-admin': { id: 'admin-1', email: 'admin@x' },
    'tok-ro': { id: 'cont-ro', email: 'ro@x' },
    'tok-de': { id: 'cont-de', email: 'de@x' },
  };
  DB.tabele.profiles.push(
    { id: 'admin-1', email: 'admin@x', role: 'admin', roles: ['admin'], status: 'active' },
    { id: 'cont-ro', email: 'ro@x', role: 'client', roles: ['client'], status: 'active', tara: 'RO' },
    { id: 'cont-de', email: 'de@x', role: 'client', roles: ['client'], status: 'active', tara: 'DE' },
  );
}

async function cheama(handler, opt) {
  const res = raspuns();
  await tacut(() => handler(cerere(opt), res));
  return res;
}
const BAZA_REG = { email: 'firma@test.ro', tip: 'materiale', nume_firma: 'Firma Test SRL', cui: 'RO46577229', tara: 'RO', nume: 'Ion' };
const BAZA_WIZ = { nume_firma: 'Firma Test SRL', cui: 'RO46577229', partner_type: 'materiale' };
const MESAJ_PF = F.MESAJE.persoana_fizica;

function verificaEroare(res, status, campAsteptat) {
  egal(res.statusCode, status, JSON.stringify(res.corp));
  egal(res.corp.ok, false);
  adevarat(res.corp.mesaj && res.corp.mesaj.ro && res.corp.mesaj.en, 'mesajul RO + EN lipsește');
  adevarat(res.corp.error && res.corp.error_en, 'error / error_en lipsesc');
  if (campAsteptat) egal(res.corp.campuri.map((c) => c.camp), [campAsteptat], 'câmpul vizat');
}

(async () => {
  console.log('1. lib/forme-juridice.js');
  await test('lista are exact cele 12 coduri, fără persoana_fizica', () => {
    egal(F.CODURI, ['pfa', 'ii', 'if', 'srl', 'srl_d', 'sa', 'snc', 'scs', 'sca', 'cooperativa', 'institutie_publica', 'firma_straina']);
    adevarat(!F.esteFormaValida('persoana_fizica'));
    adevarat(F.FORME_JURIDICE.every((f) => f.ro && f.en), 'fiecare formă are etichetă RO și EN');
    egal(F.eticheta('ii', 'ro'), 'Întreprindere individuală (II)');
    egal(F.eticheta('ii', 'en'), 'Sole proprietorship (II)');
    egal(F.eticheta('firma_straina', 'ro'), 'Firmă înregistrată în altă țară');
    egal(F.eticheta('firma_straina', 'en'), 'Company registered in another country');
  });
  await test('CUI valid: RO46577229, cu sau fără RO, cu spații', () => {
    adevarat(F.valideazaCuiRo('RO46577229'));
    adevarat(F.valideazaCuiRo('46577229'));
    adevarat(F.valideazaCuiRo(' RO 4657 7229 '));
    adevarat(F.valideazaCuiRo('ro46577229'));
  });
  await test('CUI invalid: cifră de control greșită, prea scurt, litere, gol', () => {
    adevarat(!F.valideazaCuiRo('RO46577228'));
    adevarat(!F.valideazaCuiRo('RO1'));
    adevarat(!F.valideazaCuiRo('RO4657A229'));
    adevarat(!F.valideazaCuiRo(''));
    adevarat(!F.valideazaCuiRo(null));
    adevarat(!F.valideazaCuiRo('12345678901'), 'peste 10 cifre');
  });
  await test('persoana_fizica e refuzată, cu mesajul explicit RO + EN', () => {
    const r = F.valideazaDateFirma({ tip_entitate_legala: 'persoana_fizica', cui: 'RO46577229', nume_firma: 'X', tara: 'RO' });
    egal(r.ok, false); egal(r.camp, 'tip_entitate_legala');
    egal(r.error, 'Contul de partener e doar pentru firme, PFA sau II. Ca persoană fizică poți fi client sau investitor.');
    egal(r.error_en, 'Partner accounts are for registered businesses only (company, PFA or II). As a private individual you can be a client or an investor.');
  });
  await test('fără formă juridică / formă necunoscută → refuz pe tip_entitate_legala', () => {
    for (const v of [undefined, null, '', '  ', 'gmbh', 'SRL']) {
      const r = F.valideazaDateFirma({ tip_entitate_legala: v, cui: 'RO46577229', nume_firma: 'X', tara: 'RO' });
      egal(r.ok, false, `valoarea ${JSON.stringify(v)}`); egal(r.camp, 'tip_entitate_legala');
    }
  });
  await test('denumirea și CUI-ul sunt obligatorii (fără CNP)', () => {
    const r1 = F.valideazaDateFirma({ tip_entitate_legala: 'srl', cui: 'RO46577229', nume_firma: ' ', tara: 'RO' });
    egal([r1.ok, r1.camp, r1.error, r1.error_en], [false, 'nume_firma', 'Denumirea firmei și CUI-ul sunt obligatorii.', 'The company name and the tax ID (CUI) are required.']);
    const r2 = F.valideazaDateFirma({ tip_entitate_legala: 'pfa', cui: '', nume_firma: 'Ion Pop PFA', tara: 'RO' });
    egal([r2.ok, r2.camp], [false, 'cui']);
    const r3 = F.valideazaDateFirma({ tip_entitate_legala: 'pfa', cui: '1800101123456', nume_firma: 'Ion Pop PFA', tara: 'RO' });
    egal([r3.ok, r3.camp], [false, 'cui'], 'un CNP nu e CUI');
  });
  await test('pentru RO: CUI cu cifră de control greșită → refuz pe cui', () => {
    const r = F.valideazaDateFirma({ tip_entitate_legala: 'srl', cui: 'RO46577228', nume_firma: 'X SRL', tara: 'RO' });
    egal([r.ok, r.camp], [false, 'cui']);
    adevarat(/cifra de control/.test(r.error) && /check digit/.test(r.error_en));
  });
  await test('firma_straina fără formă locală → refuz pe forma_juridica_locala', () => {
    const r = F.valideazaDateFirma({ tip_entitate_legala: 'firma_straina', cui: 'HRB 12345', nume_firma: 'Muster GmbH', tara: 'DE', forma_juridica_locala: '  ' });
    egal([r.ok, r.camp], [false, 'forma_juridica_locala']);
  });
  await test('firma_straina cu tara = RO → refuz', () => {
    const r = F.valideazaDateFirma({ tip_entitate_legala: 'firma_straina', cui: 'RO46577229', nume_firma: 'X', tara: 'RO', forma_juridica_locala: 'GmbH' });
    egal([r.ok, r.camp], [false, 'tip_entitate_legala']);
    const r2 = F.valideazaDateFirma({ tip_entitate_legala: 'firma_straina', cui: 'RO46577229', nume_firma: 'X', forma_juridica_locala: 'GmbH' });
    egal(r2.ok, false, 'fără țară se consideră România');
  });
  await test('firma_straina din DE cu GmbH → trece; numărul de înregistrare nu trece prin cifra RO', () => {
    const r = F.valideazaDateFirma({ tip_entitate_legala: 'firma_straina', cui: 'HRB 12345', nume_firma: 'Muster GmbH', tara: 'de', forma_juridica_locala: ' GmbH ' });
    egal(r, { ok: true, date: { tip_entitate_legala: 'firma_straina', nume_firma: 'Muster GmbH', cui: 'HRB 12345', tara: 'DE', forma_juridica_locala: 'GmbH' } });
  });
  await test('SRL din RO cu CUI valid → trece; forma locală se ignoră', () => {
    const r = F.valideazaDateFirma({ tip_entitate_legala: 'srl', cui: ' RO46577229 ', nume_firma: ' Firma SRL ', tara: 'RO', forma_juridica_locala: 'GmbH' });
    egal(r, { ok: true, date: { tip_entitate_legala: 'srl', nume_firma: 'Firma SRL', cui: 'RO46577229', tara: 'RO', forma_juridica_locala: null } });
  });

  console.log('\n2. O singură listă: lib/, front-end, migrare');
  await test('forme-juridice-public.js are aceeași listă ca lib/forme-juridice.js', () => {
    const cod = fs.readFileSync(path.join(RADACINA, 'forme-juridice-public.js'), 'utf8');
    const context = { window: {}, document: {} };
    vm.runInNewContext(cod, context);
    egal(JSON.parse(JSON.stringify(context.window.MDFormeJuridice.FORME_JURIDICE)), F.FORME_JURIDICE);
  });
  await test('completeazaSelect pune „Alege forma juridică” (goală) prima și etichetele în limba paginii', () => {
    const cod = fs.readFileSync(path.join(RADACINA, 'forme-juridice-public.js'), 'utf8');
    for (const [lang, prima, eticheta] of [['ro', 'Alege forma juridică', 'Întreprindere individuală (II)'], ['en', 'Choose the legal form', 'Sole proprietorship (II)']]) {
      const sel = { innerHTML: 'x', optiuni: [], appendChild(o) { this.optiuni.push(o); }, value: '' };
      const context = { window: { MYD_I18N: { lang } }, document: { createElement: () => ({}) } };
      vm.runInNewContext(cod, context);
      context.window.MDFormeJuridice.completeazaSelect(sel, 'persoana_fizica');
      egal(sel.optiuni[0].value, ''); egal(sel.optiuni[0].textContent, prima);
      egal(sel.optiuni.length, 13);
      egal(sel.optiuni.find((o) => o.value === 'ii').textContent, eticheta);
      egal(sel.required, true);
      egal(sel.value, '', 'o valoare veche (persoana_fizica) nu se păstrează');
    }
  });
  await test('migrarea 11-P1 are exact aceleași coduri', () => {
    const sql = fs.readFileSync(path.join(RADACINA, 'docs/migrations-propuse/2026-10-25_parteneri_doar_persoane_juridice.sql'), 'utf8');
    const bloc = sql.slice(sql.indexOf('check (tip_entitate_legala in ('), sql.indexOf('));', sql.indexOf('check (tip_entitate_legala in (')));
    egal([...bloc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), F.CODURI);
    adevarat(/set not null/.test(sql) && /forma_juridica_locala text/.test(sql) && /begin;[\s\S]*commit;/.test(sql));
  });
  await test('nicio rută din api/ nu mai are o listă locală TIPURI_ENTITATE', () => {
    const fisiere = [];
    (function parcurge(d) {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) parcurge(p); else if (f.name.endsWith('.js')) fisiere.push(p);
      }
    })(path.join(RADACINA, 'api'));
    const cuLista = fisiere.filter((p) => /TIPURI_ENTITATE|'persoana_fizica'\s*,/.test(fs.readFileSync(p, 'utf8')));
    egal(cuLista.map((p) => path.relative(RADACINA, p)), []);
  });

  console.log('\n3a. partner-register');
  await test('fără formă juridică → 400 cu camp tip_entitate_legala, fără cont creat', async () => {
    reset();
    const r = await cheama(register, { metoda: 'POST', body: { ...BAZA_REG } });
    verificaEroare(r, 400, 'tip_entitate_legala');
    egal(Object.keys(conturiAuth).length, 0); egal(DB.tabele.partners.length, 0);
  });
  await test('persoana_fizica → 400 cu mesajul RO + EN', async () => {
    reset();
    const r = await cheama(register, { metoda: 'POST', body: { ...BAZA_REG, tip_entitate_legala: 'persoana_fizica' } });
    verificaEroare(r, 400, 'tip_entitate_legala');
    egal(r.corp.mesaj, { ro: MESAJ_PF.ro, en: MESAJ_PF.en });
    egal([r.corp.error, r.corp.error_en], [MESAJ_PF.ro, MESAJ_PF.en]);
    egal(Object.keys(conturiAuth).length, 0);
  });
  await test('CUI fără cifra de control corectă → 400 pe cui', async () => {
    reset();
    const r = await cheama(register, { metoda: 'POST', body: { ...BAZA_REG, tip_entitate_legala: 'srl', cui: 'RO1' } });
    verificaEroare(r, 400, 'cui');
  });
  await test('SRL cu CUI valid → 200, rândul din partners are forma juridică', async () => {
    reset();
    const r = await cheama(register, { metoda: 'POST', body: { ...BAZA_REG, tip_entitate_legala: 'srl' } });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    egal(DB.tabele.partners.length, 1);
    egal([DB.tabele.partners[0].tip_entitate_legala, DB.tabele.partners[0].cui, DB.tabele.partners[0].nume_firma], ['srl', 'RO46577229', 'Firma Test SRL']);
    adevarat(!('forma_juridica_locala' in DB.tabele.partners[0]), 'forma locală doar pentru firma_straina');
    egal(apeluriAnaf, 1, 'starea firmei se verifică la ANAF');
    adevarat(!DB.tabele.audit_log.some((a) => a.actiune === 'partener_verificare_anaf_manuala'), 'fără marcaj când ANAF a confirmat');
  });
  await test('firmă inactivă la ANAF → 400 FIRMA_INACTIVA, fără cont creat', async () => {
    reset(); stareAnaf = 'inactiva';
    const r = await cheama(register, { metoda: 'POST', body: { ...BAZA_REG, tip_entitate_legala: 'srl' } });
    verificaEroare(r, 400, 'cui');
    egal(r.corp.cod, 'FIRMA_INACTIVA');
    egal(r.corp.mesaj, { ro: 'Firma apare ca inactivă sau radiată la ANAF.', en: 'The company is listed as inactive or deregistered with ANAF.' });
    egal(Object.keys(conturiAuth).length, 0);
  });
  await test('firmă radiată la ANAF → 400 FIRMA_INACTIVA', async () => {
    reset(); stareAnaf = 'radiata';
    const r = await cheama(register, { metoda: 'POST', body: { ...BAZA_REG, tip_entitate_legala: 'pfa' } });
    egal([r.statusCode, r.corp.cod], [400, 'FIRMA_INACTIVA']);
  });
  await test('ANAF nu răspunde → înregistrarea trece și e marcată pentru verificare manuală', async () => {
    reset(); stareAnaf = 'indisponibil';
    const r = await cheama(register, { metoda: 'POST', body: { ...BAZA_REG, tip_entitate_legala: 'srl' } });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    const marcaj = DB.tabele.audit_log.find((a) => a.actiune === 'partener_verificare_anaf_manuala');
    adevarat(marcaj, 'lipsește marcajul din audit_log');
    egal([marcaj.entitate, marcaj.entitate_id, marcaj.admin_id, marcaj.detalii.motiv], ['partners', r.corp.user_id, null, 'anaf_indisponibil']);
  });
  await test('firma_straina din DE cu forma locală → 200, fără ANAF', async () => {
    reset();
    const r = await cheama(register, { metoda: 'POST', body: { ...BAZA_REG, tara: 'DE', cui: 'HRB 12345', nume_firma: 'Muster GmbH', tip_entitate_legala: 'firma_straina', forma_juridica_locala: 'GmbH' } });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    egal([DB.tabele.partners[0].tip_entitate_legala, DB.tabele.partners[0].forma_juridica_locala], ['firma_straina', 'GmbH']);
    egal(apeluriAnaf, 0);
  });

  console.log('\n3b. wizard-companie');
  await test('fără formă juridică → 400 cu camp tip_entitate_legala', async () => {
    reset();
    const r = await cheama(wizard, { metoda: 'POST', token: 'tok-ro', body: { ...BAZA_WIZ } });
    verificaEroare(r, 400, 'tip_entitate_legala');
    egal(DB.tabele.partners.length, 0);
  });
  await test('persoana_fizica → 400 cu mesajul RO + EN', async () => {
    reset();
    const r = await cheama(wizard, { metoda: 'POST', token: 'tok-ro', body: { ...BAZA_WIZ, tip_entitate_legala: 'persoana_fizica' } });
    verificaEroare(r, 400, 'tip_entitate_legala');
    egal(r.corp.mesaj, { ro: MESAJ_PF.ro, en: MESAJ_PF.en });
  });
  await test('SRL cu CUI valid → 200, rândul are forma juridică și rolul de partener', async () => {
    reset();
    const r = await cheama(wizard, { metoda: 'POST', token: 'tok-ro', body: { ...BAZA_WIZ, tip_entitate_legala: 'srl' } });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    egal(DB.tabele.partners[0].tip_entitate_legala, 'srl');
    adevarat(DB.tabele.profiles.find((p) => p.id === 'cont-ro').roles.includes('partener_materiale'));
  });
  await test('actualizarea unui partener existent nu poate șterge forma juridică', async () => {
    reset();
    DB.tabele.partners.push({ id: 'cont-ro', partner_type: 'furnizor_materiale', nume_firma: 'Firma Test SRL', cui: 'RO46577229', tip_entitate_legala: 'srl', status_verificare: 'pending_review' });
    const r = await cheama(wizard, { metoda: 'POST', token: 'tok-ro', body: { ...BAZA_WIZ, tip_entitate_legala: null } });
    verificaEroare(r, 400, 'tip_entitate_legala');
    egal(DB.tabele.partners[0].tip_entitate_legala, 'srl');
  });
  await test('firma_straina: țara vine din profil — contul din RO e refuzat, cel din DE trece', async () => {
    reset();
    const corp = { ...BAZA_WIZ, cui: 'HRB 12345', nume_firma: 'Muster GmbH', tip_entitate_legala: 'firma_straina', forma_juridica_locala: 'GmbH', tara: 'DE' };
    const ro = await cheama(wizard, { metoda: 'POST', token: 'tok-ro', body: corp });
    verificaEroare(ro, 400, 'tip_entitate_legala');
    const de = await cheama(wizard, { metoda: 'POST', token: 'tok-de', body: corp });
    egal(de.statusCode, 200, JSON.stringify(de.corp));
    egal(DB.tabele.partners[0].forma_juridica_locala, 'GmbH');
  });
  await test('firmă inactivă la ANAF → 400 FIRMA_INACTIVA', async () => {
    reset(); stareAnaf = 'inactiva';
    const r = await cheama(wizard, { metoda: 'POST', token: 'tok-ro', body: { ...BAZA_WIZ, tip_entitate_legala: 'srl' } });
    egal([r.statusCode, r.corp.cod], [400, 'FIRMA_INACTIVA']);
    egal(DB.tabele.partners.length, 0);
  });

  console.log('\n4. Aprobarea (verifica-document)');
  for (const [descriere, rand] of [
    ['fără formă juridică', {}],
    ['persoana_fizica', { tip_entitate_legala: 'persoana_fizica' }],
    ['firma_straina fără formă locală', { tip_entitate_legala: 'firma_straina', forma_juridica_locala: '' }],
  ]) {
    await test(`aprobarea unui partener ${descriere} e refuzată pe server`, async () => {
      reset();
      DB.tabele.partners.push({ id: 'p1', partner_type: 'servicii_tehnice', nume_firma: 'X', cui: 'RO46577229', status_verificare: 'pending_review', ...rand });
      const r = await cheama(verifica, { metoda: 'POST', token: 'tok-admin', body: { tip: 'partener', id: 'p1', decizie: 'aprobat' } });
      verificaEroare(r, 409);
      egal(r.corp.cod, 'FORMA_JURIDICA_INVALIDA');
      egal(DB.tabele.partners[0].status_verificare, 'pending_review');
    });
  }
  await test('aprobarea unui SRL trece; respingerea nu cere formă juridică', async () => {
    reset();
    DB.tabele.partners.push(
      { id: 'p1', partner_type: 'servicii_tehnice', nume_firma: 'X', cui: 'RO46577229', tip_entitate_legala: 'srl', status_verificare: 'pending_review' },
      { id: 'p2', partner_type: 'servicii_tehnice', nume_firma: 'Y', cui: 'RO46577229', status_verificare: 'pending_review' },
    );
    const a = await cheama(verifica, { metoda: 'POST', token: 'tok-admin', body: { tip: 'partener', id: 'p1', decizie: 'aprobat' } });
    egal(a.statusCode, 200, JSON.stringify(a.corp));
    const b = await cheama(verifica, { metoda: 'POST', token: 'tok-admin', body: { tip: 'partener', id: 'p2', decizie: 'respins' } });
    egal(b.statusCode, 200, JSON.stringify(b.corp));
    egal(DB.tabele.partners.map((p) => p.status_verificare), ['approved', 'rejected']);
  });

  console.log('\n5. Lista de parteneri (admin)');
  await test('fiecare partener are CUI-ul, eticheta formei juridice RO / EN și marcajul ANAF', async () => {
    reset();
    DB.tabele.partners.push(
      { id: 'p1', partner_type: 'servicii_tehnice', nume_firma: 'X', cui: 'RO46577229', tip_entitate_legala: 'ii', creata_la: '2026-10-02' },
      { id: 'p2', partner_type: 'furnizor_materiale', nume_firma: 'Muster GmbH', cui: 'HRB 1', tip_entitate_legala: 'firma_straina', forma_juridica_locala: 'GmbH', creata_la: '2026-10-01' },
    );
    DB.tabele.audit_log.push({ actiune: 'partener_verificare_anaf_manuala', entitate: 'partners', entitate_id: 'p1' });
    const r = await cheama(lista, { metoda: 'GET', token: 'tok-admin' });
    egal(r.statusCode, 200, JSON.stringify(r.corp));
    const [p1, p2] = r.corp.parteneri;
    egal([p1.cui, p1.forma_juridica, p1.verificare_anaf_manuala], ['RO46577229', { ro: 'Întreprindere individuală (II)', en: 'Sole proprietorship (II)' }, true]);
    egal([p2.forma_juridica.ro, p2.forma_juridica_locala, p2.verificare_anaf_manuala], ['Firmă înregistrată în altă țară', 'GmbH', false]);
  });
  await test('superadmin: tabelul de parteneri are coloana „Formă juridică”', () => {
    const html = fs.readFileSync(path.join(RADACINA, 'mydarrin-superadmin.html'), 'utf8');
    adevarat(/<th>CUI<\/th><th>Formă juridică<\/th>/.test(html));
    adevarat(html.includes('p.forma_juridica.ro'));
  });

  console.log('\n6. cui-lookup');
  await test('firma inactivă → ok:true cu cod firma_inactiva și mesajul RO + EN', async () => {
    reset(); stareAnaf = 'inactiva';
    const r = await cheama(cuiLookup, { metoda: 'POST', body: { tara: 'RO', cui: 'RO46577229' } });
    egal([r.corp.ok, r.corp.cod, r.corp.inactiva, r.corp.motiv, r.corp.motiv_en],
      [true, 'firma_inactiva', true, 'Firma apare ca inactivă sau radiată la ANAF.', 'The company is listed as inactive or deregistered with ANAF.']);
  });
  await test('firma activă → răspunsul de dinainte, fără câmpuri noi', async () => {
    reset();
    const r = await cheama(cuiLookup, { metoda: 'POST', body: { tara: 'RO', cui: 'RO46577229' } });
    egal(r.corp, { ok: true, cui: '46577229', denumire: 'FIRMA SIMULATA SRL', adresa: 'ADRESA SIMULATA', nr_reg_com: 'J00/0000/2000', tva_activ: true });
  });

  console.log('\n7. Paginile publice');
  await test('wizard-ul și „Devino partener” nu mai oferă „Persoană fizică” și folosesc lista comună', () => {
    for (const [fisier, idSelect, idLocala] of [['mydarrin-devino-partener-wizard.html', 's2-entitate', 's2-forma-locala'], ['mydarrin-devino-partener.html', 'f-entitate', 'f-forma-locala']]) {
      const html = fs.readFileSync(path.join(RADACINA, fisier), 'utf8');
      adevarat(!/value="persoana_fizica"/.test(html), `${fisier}: opțiunea persoana_fizica a rămas`);
      adevarat(/forme-juridice-public\.js/.test(html), `${fisier}: nu încarcă forme-juridice-public.js`);
      adevarat(new RegExp(`id="${idSelect}"[^>]*required`).test(html), `${fisier}: select-ul nu e obligatoriu`);
      adevarat(new RegExp(`<select id="${idSelect}"[^>]*>\\s*<option value="">Alege forma juridică</option>\\s*</select>`).test(html), `${fisier}: prima opțiune trebuie să fie „Alege forma juridică”`);
      adevarat(html.includes(`id="${idLocala}"`), `${fisier}: lipsește „Forma juridică locală”`);
      adevarat(!/CUI \/ CNP/.test(html), `${fisier}: eticheta „CUI / CNP” a rămas`);
    }
  });
  await test('propoziția despre cine se poate înscrie apare pe cele trei pagini, RO + EN', () => {
    const ro = 'Înscrierea e pentru firme, PFA și întreprinderi individuale.';
    const en = 'Registration is open to companies, PFAs and sole proprietorships.';
    for (const pagina of ['mydarrin-devino-partener', 'cum-devii-partenerul-nostru', 'intrebari-frecvente-parteneri']) {
      const html = fs.readFileSync(path.join(RADACINA, `${pagina}.html`), 'utf8');
      adevarat(html.includes(ro), `${pagina}: lipsește propoziția RO`);
      const dict = JSON.parse(fs.readFileSync(path.join(RADACINA, `i18n/en/${pagina}.json`), 'utf8'));
      egal(dict._texte[ro], en, `${pagina}: traducerea EN`);
    }
  });
  await test('FAQ: documentele (CUI, certificat de înregistrare, IBAN-ul firmei), cu traducere EN', () => {
    const html = fs.readFileSync(path.join(RADACINA, 'intrebari-frecvente-parteneri.html'), 'utf8');
    const dict = JSON.parse(fs.readFileSync(path.join(RADACINA, 'i18n/en/intrebari-frecvente-parteneri.json'), 'utf8'))._texte;
    const raspunsDoc = Object.keys(dict).find((k) => k.startsWith('CUI-ul firmei, certificatul de înregistrare, IBAN-ul firmei'));
    adevarat(raspunsDoc && html.includes(raspunsDoc), 'răspunsul despre documente');
    adevarat(/registration certificate/.test(dict[raspunsDoc]) && /IBAN/.test(dict[raspunsDoc]));
  });
  await test('textele noi din wizard au traducere EN', () => {
    const dict = JSON.parse(fs.readFileSync(path.join(RADACINA, 'i18n/en/mydarrin-devino-partener-wizard.json'), 'utf8'))._texte;
    for (const k of ['Formă juridică', 'Alege forma juridică', 'Forma juridică locală', 'CUI / nr. de înregistrare', 'Alege forma juridică a firmei.', 'Scrie forma juridică din țara firmei (de exemplu GmbH, Ltd, EOOD).']) {
      adevarat(dict[k], `lipsește traducerea pentru „${k}”`);
    }
  });

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
})();
