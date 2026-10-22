// scripts/test-raspuns-eroare.js
// Pasul 11-N1 (22 oct. 2026): forma comună a erorilor din api/admin/*
// (lib/raspuns-eroare.js), fără browser și fără Supabase:
//   1. trimiteEroare → { ok:false, cod, mesaj:{ro,en}, campuri:[{camp, mesaj:{ro,en}}] },
//      plus error / error_en pentru paginile care le citesc încă;
//   2. formaComuna: răspunsurile vechi { error } cu status ≥ 400 ies în forma
//      comună (traducerea EN din i18n/en.json, unde există); succesul nu se schimbă;
//   3. runde-finantare (handler-ul real, peste Supabase-ul simulat): date
//      greșite → 400 cu toate câmpurile greșite, fiecare cu RO + EN;
//   4. metode-plata-config, niveluri-pret, tarife-*, investitori-kyc,
//      integrari/salveaza: câmpul greșit e numit în `campuri`;
//   5. toate endpoint-urile de salvare folosite de superadmin sunt învelite în formaComuna.
// Rulare: node scripts/test-raspuns-eroare.js

const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
const { trimiteEroare, camp, formaComuna, normalizeaza } = require('../lib/raspuns-eroare');

const p = require.resolve(path.join(RADACINA, 'lib/rate-limit.js'));
require.cache[p] = { id: p, filename: p, loaded: true, exports: { checkRateLimit: async () => true } };

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const bilingv = (m) => m && typeof m.ro === 'string' && m.ro && typeof m.en === 'string' && m.en;

function formaCorecta(corp, et) {
  verifica(corp && corp.ok === false, `${et}: ok:false`);
  verifica(typeof corp.cod === 'string' && corp.cod, `${et}: cod (${corp && corp.cod})`);
  verifica(bilingv(corp.mesaj), `${et}: mesaj { ro, en } (${JSON.stringify(corp && corp.mesaj)})`);
  verifica(Array.isArray(corp.campuri), `${et}: campuri e o listă`);
  (corp.campuri || []).forEach((c) => verifica(typeof c.camp === 'string' && bilingv(c.mesaj), `${et}: câmpul ${JSON.stringify(c)}`));
  verifica(corp.error === (corp.mesaj && corp.mesaj.ro), `${et}: error = mesaj.ro (compatibilitate)`);
}

(async () => {
  // 1. trimiteEroare
  {
    const res = raspuns();
    trimiteEroare(res, 400, 'DATE_INVALIDE', 'Completați «Denumire (RO)».', 'Please fill in «Name (RO)».',
      [camp('denumire_ro', 'Completați «Denumire (RO)».', 'Please fill in «Name (RO)».')]);
    verifica(res.statusCode === 400, '1: status 400');
    formaCorecta(res.corp, '1');
    verifica(res.corp.campuri.length === 1 && res.corp.campuri[0].camp === 'denumire_ro', '1: câmpul denumire_ro');
    verifica(res.corp.mesaj.en === 'Please fill in «Name (RO)».' && res.corp.error_en === res.corp.mesaj.en, '1: mesajul EN');
    const fara = raspuns();
    trimiteEroare(fara, 409, 'CONFLICT', 'Există deja.', 'Already exists.');
    verifica(Array.isArray(fara.corp.campuri) && fara.corp.campuri.length === 0, '1: fără câmpuri → campuri: []');
    const extra = raspuns();
    trimiteEroare(extra, 409, 'ALTA_DESCHISA', 'a', 'b', [], { deschisa: { id: 'x' } });
    verifica(extra.corp.deschisa && extra.corp.deschisa.id === 'x', '1: câmpurile suplimentare se păstrează');
  }

  // 2. formaComuna
  {
    const h = formaComuna(async (req, res) => {
      if (req.query.c === 'vechi') return res.status(400).json({ error: 'Id de produs invalid.' });
      if (req.query.c === 'text') return res.status(500).json('ceva nu a mers');
      if (req.query.c === '405') return res.status(405).json({ error: 'Method not allowed' });
      return res.status(200).json({ ok: true, date: [1, 2] });
    });
    const r1 = raspuns(); await h(cerere({ query: { c: 'vechi' } }), r1);
    formaCorecta(r1.corp, '2 vechi');
    verifica(r1.corp.mesaj.en === 'Invalid product id.', `2: EN din i18n/en.json (${r1.corp.mesaj.en})`);
    verifica(r1.corp.cod === 'DATE_INVALIDE', '2: cod din status 400');
    const r2 = raspuns(); await h(cerere({ query: { c: 'text' } }), r2);
    formaCorecta(r2.corp, '2 text');
    verifica(r2.corp.cod === 'EROARE_SERVER', '2: cod din status 500');
    const r3 = raspuns(); await h(cerere({ query: { c: '405' } }), r3);
    formaCorecta(r3.corp, '2 405');
    const r4 = raspuns(); await h(cerere({ query: {} }), r4);
    verifica(JSON.stringify(r4.corp) === JSON.stringify({ ok: true, date: [1, 2] }), '2: succesul rămâne neschimbat');
    const deja = normalizeaza({ ok: false, cod: 'X', mesaj: { ro: 'a', en: 'b' }, campuri: [] }, 400);
    verifica(deja.cod === 'X' && deja.mesaj.en === 'b', '2: un corp deja în forma comună nu se schimbă');
  }

  // 3. runde-finantare, prin handler-ul real
  {
    DB.tabele = { profiles: [{ id: 'super', email: 's@example.com', roles: ['superadmin'] }], runde_finantare: [], investitori_portofoliu: [], audit_log: [], admin_permissions: [] };
    DB.coloane = {};
    DB.utilizatori = { 'tok-super': { id: 'super', email: 's@example.com' } };
    const api = require('../api/admin/runde-finantare.js');
    const res = raspuns();
    await api(cerere({ metoda: 'POST', token: 'tok-super', body: { actiune: 'salveaza', runda: { cod: 'seed', denumire_ro: '', denumire_en: 'Seed', moneda: 'EUR', evaluare_pre_money: 0, suma_tinta: null, actiuni_existente: 10, instrumente: ['actiuni'] } } }), res);
    verifica(res.statusCode === 400, `3: date greșite → 400 (${res.statusCode})`);
    formaCorecta(res.corp, '3');
    const nume = (res.corp.campuri || []).map((c) => c.camp).sort().join(',');
    verifica(nume === 'denumire_ro,evaluare_pre_money,suma_tinta', `3: toate câmpurile greșite (${nume})`);
    const c = (res.corp.campuri || []).find((x) => x.camp === 'evaluare_pre_money');
    verifica(c && /pre-money trebuie să fie mai mare decât 0/.test(c.mesaj.ro) && /greater than 0/.test(c.mesaj.en), '3: „Evaluarea pre-money trebuie să fie mai mare decât 0”');
    verifica(DB.tabele.runde_finantare.length === 0, '3: nimic scris la date greșite');
    const neaut = raspuns();
    await api(cerere({ metoda: 'GET' }), neaut);
    verifica(neaut.statusCode === 401, '3: fără token → 401');
    formaCorecta(neaut.corp, '3 401');
    const bun = raspuns();
    await api(cerere({ metoda: 'POST', token: 'tok-super', body: { actiune: 'salveaza', runda: { cod: 'seed', denumire_ro: 'Seed', denumire_en: 'Seed', moneda: 'EUR', evaluare_pre_money: 900, suma_tinta: 100, actiuni_existente: 90, instrumente: ['actiuni'] } } }), bun);
    verifica(bun.statusCode === 200 && bun.corp.ok === true && bun.corp.runda, '3: salvarea corectă → { ok:true, runda } ca înainte');
    const dublu = raspuns();
    await api(cerere({ metoda: 'POST', token: 'tok-super', body: { actiune: 'salveaza', runda: { cod: 'seed', denumire_ro: 'Seed', denumire_en: 'Seed', moneda: 'EUR', evaluare_pre_money: 900, suma_tinta: 100, actiuni_existente: 90, instrumente: ['actiuni'] } } }), dublu);
    verifica(dublu.statusCode === 409 && dublu.corp.campuri[0] && dublu.corp.campuri[0].camp === 'cod', '3: cod existent → 409 pe câmpul „cod”');
  }

  // 4. câmpul greșit e numit în celelalte endpoint-uri
  DB.tabele = { profiles: [{ id: 'super', email: 's@example.com', roles: ['superadmin'] }], investitori_kyc: [], admin_permissions: [], audit_log: [] };
  const cazuri = [
    ['metode-plata-config', { action: 'salveaza', metode_acceptate: [] }, 'metode_acceptate'],
    ['niveluri-pret', { action: 'creeaza_nivel', cheie: '', nume: 'Nivel' }, 'cheie'],
    ['niveluri-pret', { action: 'salveaza_pret', nivel_id: 'n', tara_cod: 'RO', moneda: 'RON', pret: -1 }, 'pret'],
    ['tarife-transport', { action: 'salveaza', prag_kg_min: 5, prag_kg_max: 2, tarif_fix: 10 }, 'prag_kg_max'],
    ['tarife-transport', { action: 'salveaza', prag_kg_min: 0, prag_kg_max: null, tarif_ron_per_kg: null, tarif_fix: null }, 'tarif_ron_per_kg'],
    ['tarife-manopera', { action: 'salveaza', cod_esco: '', tara_cod: 'RO', cost_ora: 10 }, 'cod_esco'],
    ['tarife-manopera', { action: 'salveaza', cod_esco: '7126', tara_cod: 'RO', cost_ora: 0 }, 'cost_ora'],
    ['tarife-resurse-fizice', { action: 'salveaza', tip: 'M', resursa_id: 3, tara_cod: 'RO', pret_unitar: 0 }, 'pret_unitar'],
    ['investitori-kyc', { user_id: 'u1', actiune: 'respinge', motiv_ro: 'Act ilizibil', motiv_en: '' }, 'motiv_en'],
    ['integrari/salveaza', { categorie: 'curieri', nume_furnizor: '', tip_configurare: 'api' }, 'nume_furnizor'],
  ];
  for (const [ep, corp, campAsteptat] of cazuri) {
    const api = require('../api/admin/' + ep + '.js');
    const res = raspuns();
    await api(cerere({ metoda: 'POST', token: 'tok-super', body: corp }), res);
    const et = `4 ${ep} (${campAsteptat})`;
    verifica(res.statusCode === 400, `${et}: 400 (${res.statusCode} ${JSON.stringify(res.corp).slice(0, 160)})`);
    formaCorecta(res.corp || {}, et);
    verifica((res.corp.campuri || []).some((c) => c.camp === campAsteptat), `${et}: câmpul în campuri (${JSON.stringify(res.corp.campuri)})`);
  }

  // 5. endpoint-urile de salvare folosite de superadmin sunt învelite
  const html = fs.readFileSync(path.join(RADACINA, 'mydarrin-superadmin.html'), 'utf8');
  const folosite = [...new Set(html.match(/\/api\/admin\/[a-z0-9/_-]+/g))].map((u) => u.replace('/api/admin/', ''));
  const doarCitire = ['audit-log', 'comenzi-globale', 'dashboard-stats', 'document-url', 'investitori-dashboard', 'listeaza-acces-temporar', 'parteneri-lista', 'integrari/listeaza', 'exemplu-pret'];
  for (const ep of folosite) {
    if (doarCitire.includes(ep)) continue;
    const src = fs.readFileSync(path.join(RADACINA, 'api/admin', ep + '.js'), 'utf8');
    verifica(/module\.exports = formaComuna\(/.test(src), `5: api/admin/${ep}.js folosește formaComuna`);
  }

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
