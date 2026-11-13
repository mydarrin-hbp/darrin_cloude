// scripts/test-panou-investitor.js
// Pasul 11-I1 (8 nov. 2026): panoul investitorului pe pagină proprie.
//   A. API (handler-ele reale peste Supabase simulat): acces fără sesiune / fără
//      rol; lock-up din aprobat_la + lock_up_luni; „pot fi vândute acum” înainte și
//      după; exit (listă proprie, anulare, 409, cererea altcuiva → 404); istoricul;
//      roi_estimat / exit_estimat_luni nu ies; aprobarea completează aprobat_la.
//   B. Browser: fără sesiune / fără rol (nicio cerere de date, redirecționarea
//      corectă); datele afișate; alerta pentru act; exit și anulare cu MDFeedback;
//      legăturile; EN; 390, 768, 1024, 1366 px.
// Nimic nu ajunge la Supabase.
// Cu --capturi <dosar>: panoul la 390 și 1366 px, cu date de test.
// Rulare: node scripts/test-panou-investitor.js [--capturi <dosar>]

const fs = require('fs');
const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
const { chromium } = require('playwright');
const { porneste } = require('./server-test');

const apiExit = require(path.join(RADACINA, 'api/investitori/exit.js'));
const apiPort = require(path.join(RADACINA, 'api/investitori/portofoliu.js'));
const apiIst = require(path.join(RADACINA, 'api/investitori/istoric.js'));
const apiAprobare = require(path.join(RADACINA, 'api/admin/investitori-aprobare.js'));
const P = require(path.join(RADACINA, 'lib/investitori-panou.js'));

const iCapturi = process.argv.indexOf('--capturi');
const dosarCapturi = iCapturi !== -1 ? process.argv[iCapturi + 1] : null;
const PAGINA = 'mydarrin-panou-investitor.html';
const A = '30000000-0000-4000-8000-00000000000a';
const B = '30000000-0000-4000-8000-00000000000b';
const SUPER = '30000000-0000-4000-8000-00000000000c';
const CLIENT = '30000000-0000-4000-8000-00000000000d';
const uid = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = (d) => new Date(d).toISOString();
const luniInapoi = (n) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString(); };

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));
async function cheama(api, { token, metoda = 'GET', body = null }) { const res = raspuns(); await api(cerere({ metoda, token, body, query: {} }), res); return res; }

function reset() {
  DB.tabele = {
    profiles: [{ id: A, roles: ['client', 'investor'] }, { id: B, roles: ['investor'] }, { id: SUPER, roles: ['superadmin'] }, { id: CLIENT, roles: ['client'] }],
    investitori_kyc: [], investitori_portofoliu: [], investitori_exit: [], audit_log: [], admin_permissions: [],
    runde_finantare: [{ id: 'r1', cod: 'r1', denumire_ro: 'Runda A', denumire_en: 'Round A', stare: 'inchisa', moneda: 'EUR', evaluare_pre_money: 900000, suma_tinta: 100000, actiuni_existente: 900, lock_up_luni: 12, discount_buyback_pct: 10, instrumente: ['actiuni'] }],
  };
  DB.coloane = {};
  DB.utilizatori = { 'tok-a': { id: A, email: 'a@test' }, 'tok-b': { id: B, email: 'b@test' }, 'tok-super': { id: SUPER, email: 's@test' }, 'tok-client': { id: CLIENT, email: 'c@test' } };
}
const sub = (o) => Object.assign({ id: uid(1), user_id: A, runda_id: 'r1', actiuni: 10, valoare_investita: 10000, status: 'aprobat', created_at: luniInapoi(30), roi_estimat: 77.5, exit_estimat_luni: 36 }, o);
const cerereExit = (o) => Object.assign({ id: uid(50), user_id: A, tip: 'buyback', numar_actiuni: 2, status: 'in_procesare', created_at: iso('2026-10-01T10:00:00Z') }, o);

async function testeApi() {
  reset();
  for (const api of [apiExit, apiPort, apiIst]) {
    const fara = await cheama(api, {}); verifica(fara.statusCode === 401 && fara.corp.ok === false && fara.corp.mesaj && fara.corp.mesaj.en, `fără sesiune: ${fara.statusCode} ${JSON.stringify(fara.corp)}`);
    const client = await cheama(api, { token: 'tok-client' }); verifica(client.statusCode === 403 && !('subscrieri' in client.corp) && !('cereri' in client.corp) && !('evenimente' in client.corp), `fără rol: ${client.statusCode}`);
  }

  // Lock-up
  {
    const d = P.adunaLuni('2026-01-31T10:00:00Z', 1);
    verifica(d.toISOString() === '2026-02-28T10:00:00.000Z', `31 ian. + 1 lună: ${d.toISOString()}`);
    reset();
    const aprobat = luniInapoi(2);
    DB.tabele.investitori_portofoliu.push(sub({ aprobat_la: aprobat }));
    let r = await cheama(apiPort, { token: 'tok-a' });
    let s = r.corp.subscrieri[0];
    verifica(s.aprobat_la === aprobat && s.sfarsit_lock_up === P.adunaLuni(aprobat, 12).toISOString(), `lock-up: ${JSON.stringify(s)}`);
    verifica(s.actiuni_vandabile_acum === 0 && r.corp.exit.actiuni_vandabile_acum === 0, 'înainte de sfârșitul lock-up-ului (deși subscrierea e veche): 0 vandabile');
    DB.tabele.investitori_portofoliu[0].aprobat_la = luniInapoi(13);
    r = await cheama(apiPort, { token: 'tok-a' });
    verifica(r.corp.subscrieri[0].actiuni_vandabile_acum === 10 && r.corp.exit.actiuni_vandabile_acum === 10, `după lock-up: ${JSON.stringify(r.corp.exit)}`);
    DB.tabele.investitori_exit.push(cerereExit({ numar_actiuni: 3 }), cerereExit({ id: uid(51), numar_actiuni: 1, status: 'anulat' }), cerereExit({ id: uid(52), numar_actiuni: 1, status: 'respins' }));
    r = await cheama(apiPort, { token: 'tok-a' });
    verifica(r.corp.exit.actiuni_vandabile_acum === 7, `cererile active scad, cele anulate / respinse nu: ${r.corp.exit.actiuni_vandabile_acum}`);
    reset();
    DB.tabele.investitori_portofoliu.push(sub({ aprobat_la: null }));
    r = await cheama(apiPort, { token: 'tok-a' });
    verifica(r.corp.subscrieri[0].sfarsit_lock_up === null && r.corp.exit.actiuni_vandabile_acum === 0, 'fără aprobat_la: nu se calculează, nimic vandabil');
    reset();
    DB.tabele.runde_finantare[0].lock_up_luni = null;
    DB.tabele.investitori_portofoliu.push(sub({ aprobat_la: luniInapoi(1) }));
    r = await cheama(apiPort, { token: 'tok-a' });
    verifica(r.corp.subscrieri[0].sfarsit_lock_up === null && r.corp.exit.actiuni_vandabile_acum === 10, 'rundă fără lock-up: vandabile imediat');
    reset();
    DB.tabele.runde_finantare[0].discount_buyback_pct = null;
    DB.tabele.investitori_portofoliu.push(sub({ aprobat_la: luniInapoi(13) }));
    r = await cheama(apiPort, { token: 'tok-a' });
    verifica(r.corp.exit.actiuni_vandabile_acum === 0 && r.corp.exit.buyback_disponibil === false, 'fără buy-back configurat: nimic vandabil');
    reset();
    DB.tabele.investitori_portofoliu.push(sub({ status: 'in_asteptare', aprobat_la: null }));
    r = await cheama(apiPort, { token: 'tok-a' });
    verifica(r.corp.subscrieri[0].actiuni_vandabile_acum === 0, 'o subscriere neaprobată nu e vandabilă');
  }

  // Exit
  {
    reset();
    DB.tabele.investitori_exit.push(
      cerereExit({ id: uid(1), created_at: iso('2026-09-01T10:00:00Z') }),
      cerereExit({ id: uid(2), created_at: iso('2026-10-01T10:00:00Z'), status: 'aprobat', suma_calculata: 123.5 }),
      cerereExit({ id: uid(3), user_id: B, numar_actiuni: 99 }),
    );
    const l = await cheama(apiExit, { token: 'tok-a' });
    verifica(l.statusCode === 200 && l.corp.cereri.length === 2 && l.corp.cereri[0].id === uid(2) && l.corp.cereri[0].suma_calculata === 123.5, `lista proprie: ${JSON.stringify(l.corp)}`);
    verifica(!JSON.stringify(l.corp).includes('99') && !JSON.stringify(l.corp).includes(B), 'lista conține date străine');
    const strain = await cheama(apiExit, { token: 'tok-a', metoda: 'PATCH', body: { id: uid(3), actiune: 'anuleaza' } });
    verifica(strain.statusCode === 404 && !('cerere' in strain.corp) && DB.tabele.investitori_exit[2].status === 'in_procesare', `cererea altcuiva: ${strain.statusCode}`);
    const aprobata = await cheama(apiExit, { token: 'tok-a', metoda: 'PATCH', body: { id: uid(2), actiune: 'anuleaza' } });
    verifica(aprobata.statusCode === 409 && aprobata.corp.mesaj.ro && aprobata.corp.mesaj.en && aprobata.corp.mesaj.ro !== aprobata.corp.mesaj.en && DB.tabele.investitori_exit[1].status === 'aprobat', `cerere aprobată: ${JSON.stringify(aprobata.corp)}`);
    const anulata = await cheama(apiExit, { token: 'tok-a', metoda: 'PATCH', body: { id: uid(1), actiune: 'anuleaza' } });
    const rand = DB.tabele.investitori_exit[0];
    verifica(anulata.statusCode === 200 && anulata.corp.cerere.status === 'anulat' && rand.status === 'anulat' && rand.anulat_la && rand.actualizat_la, `anularea: ${JSON.stringify(anulata.corp)}`);
    verifica((await cheama(apiExit, { token: 'tok-a', metoda: 'PATCH', body: { id: uid(1), actiune: 'anuleaza' } })).statusCode === 409, 'a doua anulare nu dă 409');
    verifica((await cheama(apiExit, { token: 'tok-a', metoda: 'PATCH', body: { id: 'nu-e-uuid', actiune: 'anuleaza' } })).statusCode === 404, 'id invalid nu dă 404');
    verifica((await cheama(apiExit, { token: 'tok-a', metoda: 'PATCH', body: { id: uid(1), actiune: 'altceva' } })).statusCode === 400, 'acțiune necunoscută nu dă 400');
    verifica((await cheama(apiExit, { token: 'tok-a', metoda: 'DELETE' })).statusCode === 405, 'metoda nepermisă nu dă 405');
    reset();
    DB.tabele.investitori_portofoliu.push(sub({ created_at: luniInapoi(30), aprobat_la: luniInapoi(13) }));
    const nou = await cheama(apiExit, { token: 'tok-a', metoda: 'POST', body: { tip: 'buyback', numar_actiuni: 4 } });
    verifica(nou.statusCode === 200 && nou.corp.cerere.status === 'in_procesare', `POST după lock-up: ${nou.statusCode}`);

    // POST folosește regula panoului.
    const cere = (n, token) => cheama(apiExit, { token: token || 'tok-a', metoda: 'POST', body: { tip: 'buyback', numar_actiuni: n } });
    const limita = async () => (await cheama(apiPort, { token: 'tok-a' })).corp.exit.actiuni_vandabile_acum;
    reset();
    DB.tabele.investitori_portofoliu.push(sub({ created_at: luniInapoi(30), aprobat_la: luniInapoi(2) }));
    let r = await cere(1);
    verifica(r.statusCode === 409 && r.corp.cod === 'PESTE_LIMITA' && r.corp.mesaj.ro && r.corp.mesaj.en && r.corp.mesaj.ro !== r.corp.mesaj.en && r.corp.campuri[0].camp === 'numar_actiuni' && !DB.tabele.investitori_exit.length, `lock-up din aprobat_la, nu din created_at: ${JSON.stringify(r.corp)}`);
    reset();
    DB.tabele.investitori_portofoliu.push(sub({ aprobat_la: null }));
    verifica((await cere(1)).statusCode === 409 && !DB.tabele.investitori_exit.length, 'fără aprobat_la, cererea trece');
    reset();
    DB.tabele.investitori_portofoliu.push(sub({ status: 'in_asteptare', aprobat_la: luniInapoi(13) }), sub({ id: uid(2), status: 'respins', aprobat_la: luniInapoi(13) }));
    verifica((await cere(1)).statusCode === 409 && !DB.tabele.investitori_exit.length, 'subscrierile neaprobate se numără');
    reset();
    DB.tabele.investitori_portofoliu.push(sub({ aprobat_la: luniInapoi(13) }));
    DB.tabele.investitori_exit.push(cerereExit({ id: uid(60), numar_actiuni: 3 }), cerereExit({ id: uid(61), user_id: B, numar_actiuni: 9 }));
    verifica(await limita() === 7, 'cererea altcuiva scade din limita utilizatorului');
    r = await cere(8);
    verifica(r.statusCode === 409 && /cel mult 7 acțiuni/.test(r.corp.mesaj.ro) && /at most 7 shares/.test(r.corp.mesaj.en) && DB.tabele.investitori_exit.length === 2, `peste limită: ${JSON.stringify(r.corp)}`);
    verifica((await cere(7)).statusCode === 200 && await limita() === 0, 'exact limita nu trece sau limita panoului diferă');
    verifica((await cere(1)).statusCode === 409 && DB.tabele.investitori_exit.length === 3, 'a doua cerere depășește acțiunile rămase');
    verifica((await cheama(apiExit, { token: 'tok-a', metoda: 'PATCH', body: { id: uid(60), actiune: 'anuleaza' } })).statusCode === 200 && await limita() === 3, 'anularea nu eliberează acțiunile');
    verifica((await cere(3)).statusCode === 200 && await limita() === 0, 'acțiunile eliberate nu se pot cere din nou');
    // Pasul 11-I1b: se scad toate cererile, mai puțin cele anulate sau respinse.
    for (const st of ['anulat', 'respins']) {
      reset();
      DB.tabele.investitori_portofoliu.push(sub({ aprobat_la: luniInapoi(13) }));
      DB.tabele.investitori_exit.push(cerereExit({ numar_actiuni: 4, status: st }));
      verifica(await limita() === 10 && (await cere(10)).statusCode === 200, `o cerere ${st} scade din limită`);
    }
    for (const st of ['in_procesare', 'aprobat', 'platit', 'finalizat']) {
      reset();
      DB.tabele.investitori_portofoliu.push(sub({ aprobat_la: luniInapoi(13) }));
      DB.tabele.investitori_exit.push(cerereExit({ numar_actiuni: 4, status: st }));
      verifica(await limita() === 6, `o cerere ${st} nu scade din limita panoului: ${await limita()}`);
      const peste = await cere(7);
      verifica(peste.statusCode === 409 && peste.corp.cod === 'PESTE_LIMITA' && peste.corp.campuri[0].camp === 'numar_actiuni' && /cel mult 6 acțiuni/.test(peste.corp.mesaj.ro) && /at most 6 shares/.test(peste.corp.mesaj.en), `cerere ${st}, peste limită: ${JSON.stringify(peste.corp)}`);
      verifica((await cere(6)).statusCode === 200 && await limita() === 0, `cerere ${st}: POST și panoul dau limite diferite`);
    }
    {
      const sursa = (f) => fs.readFileSync(path.join(RADACINA, f), 'utf8');
      verifica(sursa('api/investitori/exit.js').includes('P.actiuniDisponibile(') && sursa('api/investitori/portofoliu.js').includes('P.actiuniDisponibile(') && !/STARI_EXIT|numar_actiuni\) \|\| 0\), 0\)/.test(sursa('api/investitori/exit.js') + sursa('api/investitori/portofoliu.js')), 'regula nu e într-un singur loc');
      verifica(sursa('panou-investitor.js').includes('ex.actiuni_vandabile_acum') && !/STARI_EXIT_ELIBERATE|in_procesare.*reduce/.test(sursa('panou-investitor.js')), 'panoul își calculează singur limita');
    }
    reset();
    DB.tabele.runde_finantare[0].lock_up_luni = null;
    DB.tabele.investitori_portofoliu.push(sub({ aprobat_la: luniInapoi(1) }));
    verifica(await limita() === 10 && (await cere(10)).statusCode === 200, 'rundă fără lock-up: limita diferă');
  }

  // Istoric
  {
    reset();
    DB.tabele.investitori_kyc.push({ user_id: A, status: 'respins', submitted_at: iso('2026-01-01T10:00:00Z'), reviewed_at: iso('2026-01-02T10:00:00Z'), motiv_respingere_ro: 'Act neclar', motiv_respingere_en: 'Unclear document' },
      { user_id: B, status: 'aprobat', submitted_at: iso('2026-08-08T10:00:00Z'), reviewed_at: iso('2026-08-09T10:00:00Z') });
    DB.tabele.investitori_portofoliu.push(
      sub({ id: uid(10), created_at: iso('2026-02-01T10:00:00Z'), aprobat_la: iso('2026-03-01T10:00:00Z') }),
      sub({ id: uid(11), status: 'respins', created_at: iso('2026-04-01T10:00:00Z'), aprobat_la: iso('2026-05-01T10:00:00Z') }),
      sub({ id: uid(12), user_id: B, created_at: iso('2026-08-20T10:00:00Z') }),
    );
    DB.tabele.investitori_exit.push(cerereExit({ id: uid(20), created_at: iso('2026-06-01T10:00:00Z'), anulat_la: iso('2026-07-01T10:00:00Z'), status: 'anulat' }), cerereExit({ id: uid(21), user_id: B, created_at: iso('2026-08-25T10:00:00Z') }));
    const r = await cheama(apiIst, { token: 'tok-a' });
    const tipuri = r.corp.evenimente.map((e) => e.tip).join();
    verifica(tipuri === 'exit_anulat,exit_trimis,subscriere_respinsa,subscriere_trimisa,subscriere_aprobata,subscriere_trimisa,dosar_respins,dosar_trimis', `ordinea: ${tipuri}`);
    const dr = r.corp.evenimente.find((e) => e.tip === 'dosar_respins');
    verifica(dr.motiv.ro === 'Act neclar' && dr.motiv.en === 'Unclear document' && dr.titlu.ro && dr.titlu.en && dr.titlu.ro !== dr.titlu.en, `motivul: ${JSON.stringify(dr)}`);
    verifica(r.corp.evenimente.every((e) => new Date(e.data) < new Date('2026-08-01')), 'istoricul conține evenimente străine');
  }

  // Câmpurile interzise
  {
    reset();
    DB.tabele.investitori_portofoliu.push(sub({ aprobat_la: luniInapoi(13) }));
    const toate = JSON.stringify([(await cheama(apiPort, { token: 'tok-a' })).corp, (await cheama(apiIst, { token: 'tok-a' })).corp, (await cheama(apiExit, { token: 'tok-a' })).corp]);
    verifica(!/roi_estimat|exit_estimat_luni|77\.5/.test(toate), 'roi_estimat / exit_estimat_luni în răspunsuri');
    for (const f of ['panou-investitor.js', PAGINA]) verifica(!/roi_estimat|exit_estimat/.test(fs.readFileSync(path.join(RADACINA, f), 'utf8')), `${f} menționează câmpurile interzise`);
  }

  // Aprobarea din back-office
  {
    reset();
    DB.tabele.investitori_kyc.push({ user_id: A, status: 'aprobat' });
    DB.tabele.investitori_portofoliu.push(sub({ id: uid(30), status: 'in_asteptare' }));
    const rand = DB.tabele.investitori_portofoliu[0];
    const r = await cheama(apiAprobare, { token: 'tok-super', metoda: 'POST', body: { id: uid(30), actiune: 'aproba' } });
    verifica(r.statusCode === 200 && rand.status === 'aprobat' && rand.aprobat_la && rand.aprobat_de === SUPER, `aprobarea: ${r.statusCode} ${JSON.stringify(rand)}`);
    const prima = rand.aprobat_la = iso('2026-01-05T10:00:00Z');
    await cheama(apiAprobare, { token: 'tok-super', metoda: 'POST', body: { id: uid(30), actiune: 'aproba' } });
    verifica(rand.aprobat_la === prima, 'a doua aprobare a mutat data (ar prelungi lock-up-ul)');
    await cheama(apiAprobare, { token: 'tok-super', metoda: 'POST', body: { id: uid(30), actiune: 'respinge' } });
    verifica(rand.status === 'respins' && rand.aprobat_la !== prima, 'respingerea nu completează data pentru istoric');
    DB.tabele.investitori_kyc[0].status = 'in_verificare';
    DB.tabele.investitori_portofoliu.push(sub({ id: uid(31), status: 'in_asteptare' }));
    verifica((await cheama(apiAprobare, { token: 'tok-super', metoda: 'POST', body: { id: uid(31), actiune: 'aproba' } })).statusCode === 409 && !DB.tabele.investitori_portofoliu[1].aprobat_la, 'fără KYC aprobat: logica de azi s-a schimbat');
  }
  console.log('API: gata');
}

// ── Browser ─────────────────────────────────────────────────────────────
function sesiuneSimulata(cuSesiune) {
  const user = { id: 'u1', email: 'ana@example.com', email_confirmed_at: '2026-10-01T08:00:00Z', user_metadata: {} };
  const sesiune = cuSesiune ? { access_token: 'tok', user } : null;
  const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
  const client = { auth: { getUser: async () => ({ data: { user: sesiune && user }, error: null }), getSession: async () => ({ data: { session: sesiune }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) }, from: () => lant({ data: null, error: null }), rpc: () => lant({ data: null, error: null }), storage: { from: () => lant({}) }, channel: () => lant({}), removeChannel: () => {} };
  Object.defineProperty(window, 'supabaseClient', { configurable: true, get: () => client, set: () => {} });
}
const zi = (n) => { const d = new Date(Date.now() + 3 * 3600000 + n * 86400000); return d.toISOString().slice(0, 10); };
const FIX = (o) => Object.assign({
  roluri: ['client', 'investor'],
  kyc: { status: 'aprobat', pas_curent: 5, iban_mascat: '•••• 1234', adresa_domiciliu: { strada: 'Str. Exemplu 1', localitate: 'Cluj-Napoca', judet: 'Cluj', cod_postal: '400001', tara: 'RO' }, rezidenta_fiscala_tara: 'RO', tip_document: 'ci', act_valabil_pana: zi(400) },
  portofoliu: { ok: true, kyc_status: 'aprobat', actiuni: 30, valoare_investita: 30000, in_asteptare: 5000, pct_companie: 1.5,
    subscrieri: [
      { id: 's1', status: 'aprobat', actiuni: 10, valoare_investita: 10000, instrument: 'actiuni', creat_la: '2025-01-05T10:00:00Z', aprobat_la: '2025-02-10T10:00:00Z', sfarsit_lock_up: '2026-02-10T10:00:00Z', actiuni_vandabile_acum: 10, runda: { denumire_ro: 'Runda A', denumire_en: 'Round A', moneda: 'EUR' } },
      { id: 's2', status: 'aprobat', actiuni: 20, valoare_investita: 20000, instrument: 'safe', creat_la: '2026-09-05T10:00:00Z', aprobat_la: '2026-10-10T10:00:00Z', sfarsit_lock_up: '2027-10-10T10:00:00Z', actiuni_vandabile_acum: 0, runda: { denumire_ro: 'Runda B', denumire_en: 'Round B', moneda: 'EUR' } },
      { id: 's3', status: 'in_asteptare', actiuni: 5, valoare_investita: 5000, instrument: null, creat_la: '2026-10-20T10:00:00Z', aprobat_la: null, sfarsit_lock_up: null, actiuni_vandabile_acum: 0, runda: { denumire_ro: 'Runda B', denumire_en: 'Round B', moneda: 'EUR' } },
    ], runda: null, exit: { buyback_disponibil: true, discount_buyback_pct: 10, lock_up_luni: 12, actiuni_vandabile_acum: 8 } },
  cereri: [
    { id: 'c1', tip: 'buyback', numar_actiuni: 2, suma_calculata: null, status: 'in_procesare', creat_la: '2026-10-01T10:00:00Z', anulat_la: null },
    { id: 'c2', tip: 'buyback', numar_actiuni: 1, suma_calculata: 900, status: 'aprobat', creat_la: '2026-09-01T10:00:00Z', anulat_la: null },
  ],
  evenimente: [
    { tip: 'exit_trimis', data: '2026-10-01T10:00:00Z', titlu: { ro: 'Cerere de exit trimisă', en: 'Exit request sent' }, motiv: null, runda: null, valoare_investita: null, moneda: null, numar_actiuni: 2 },
    { tip: 'subscriere_aprobata', data: '2025-02-10T10:00:00Z', titlu: { ro: 'Subscriere aprobată', en: 'Subscription approved' }, motiv: null, runda: { denumire_ro: 'Runda A', denumire_en: 'Round A' }, valoare_investita: 10000, moneda: 'EUR', numar_actiuni: null },
  ],
}, o || {});

async function deschide(browser, baza, cale, o) {
  o = o || {};
  const f = FIX(o.date);
  const cuSesiune = o.sesiune !== false;
  const ctx = await browser.newContext({ viewport: { width: o.w || 1366, height: o.h || 900 } });
  await ctx.addInitScript((l) => { try { if (l) localStorage.setItem('myd_lang_v1', l); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), marketing: false, versiune: 2 })); } catch (e) {} }, o.limba === undefined ? 'ro' : o.limba);
  await ctx.addInitScript(sesiuneSimulata, cuSesiune);
  await ctx.route(/\.supabase\.co\/|ipapi\.co\/|esm\.sh\//, (r) => r.abort());
  const json = (r, c, s) => r.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(c) });
  const cereriDate = [], patch = [], post = [];
  await ctx.route(/\/api\/cont\/profil/, (r) => (cuSesiune ? json(r, { ok: true, email: 'ana@example.com', nume: 'Ana Test', prenume: 'Ana', nume_familie: 'Test', tara: 'RO', roles: f.roluri, roluri_dashboard: ['investor'], partener: null, investitor: null, activare: null }) : json(r, { error: 'x' }, 401)));
  await ctx.route(/\/api\/investitori\/(portofoliu|kyc|exit|istoric|indicatori)/, (r) => {
    const u = r.request().url(), m = r.request().method();
    cereriDate.push(m + ' ' + u);
    if (/portofoliu/.test(u)) return json(r, f.portofoliu);
    if (/kyc/.test(u)) return json(r, { ok: true, kyc: f.kyc, lipsa: [] });
    if (/istoric/.test(u)) return json(r, { ok: true, evenimente: f.evenimente });
    if (/indicatori/.test(u)) return f.kyc && f.kyc.status === 'aprobat' ? json(r, { ok: true, indicatori: { comenzi_total: 5, comenzi_luna: 1, parteneri_activi: 2, gmv_total: 100, revenue_total: 10, revenue_luna: 1 }, moneda: 'EUR' }) : json(r, { error: 'x' }, 403);
    if (m === 'PATCH') { const b = JSON.parse(r.request().postData()); patch.push(b); if (o.anulare409) return json(r, { ok: false, cod: 'ANULARE_IMPOSIBILA', mesaj: { ro: 'Cererea se poate anula doar cât e în procesare.', en: 'The request can be cancelled only while it is in progress.' }, campuri: [], error: 'Cererea se poate anula doar cât e în procesare.', error_en: 'The request can be cancelled only while it is in progress.' }, 409); f.cereri = f.cereri.map((c) => (c.id === b.id ? Object.assign({}, c, { status: 'anulat' }) : c)); return json(r, { ok: true, cerere: {} }); }
    if (m === 'POST') { post.push(JSON.parse(r.request().postData())); return json(r, { ok: true, cerere: {} }); }
    return json(r, { ok: true, cereri: f.cereri });
  });
  const navigari = [];
  await ctx.route(/\/(index\.html|mydarrin-investitori\.html)(\?|#|$)/, (r) => {
    if (o.oprireNavigare && r.request().isNavigationRequest()) { navigari.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>x</title>' }); }
    return r.continue();
  });
  const p = await ctx.newPage();
  const erori = [];
  p.on('pageerror', (e) => erori.push(e.message.slice(0, 160)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load|net::ERR_|ERR_FAILED|Failed to fetch|status of [45]0[0-9]|tailwindcss/i.test(m.text())) erori.push('console: ' + m.text().slice(0, 160)); });
  await p.goto(`${baza}/${cale}`, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => erori.push('goto: ' + e.message.slice(0, 100)));
  if (o.oprireNavigare) await asteapta(1500);
  else await p.waitForFunction(() => { const a = document.getElementById('pi-app'); return a && a.getAttribute('data-pi-gata') === '1'; }, null, { timeout: 15000 }).catch(() => erori.push('panoul nu s-a încărcat'));
  return { ctx, p, erori, cereriDate, patch, post, navigari };
}
const panou = (p, id) => p.click(`.pi-nav button[data-pi-panou="${id}"]`);

async function testeBrowser(baza, browser) {
  // Acces
  {
    const { ctx, p, cereriDate, navigari } = await deschide(browser, baza, PAGINA, { sesiune: false, oprireNavigare: true });
    verifica(navigari.some((u) => /index\.html\?reason=cont/.test(u)) && !cereriDate.length, `fără sesiune: ${navigari} ${cereriDate}`);
    verifica(await p.evaluate(() => sessionStorage.getItem('myd_revenire_dupa_login')) === '/' + PAGINA, 'fără sesiune: revenirea aici nu e reținută');
    await ctx.close();
  }
  {
    const { ctx, p, cereriDate, navigari } = await deschide(browser, baza, PAGINA, { date: { roluri: ['client'] }, oprireNavigare: true });
    verifica(navigari.some((u) => /mydarrin-investitori\.html/.test(u)) && /#cum-functioneaza$/.test(p.url()) && !cereriDate.length, `fără rol: ${p.url()} ${cereriDate}`);
    await ctx.close();
  }

  // Datele afișate
  {
    const { ctx, p, erori } = await deschide(browser, baza, PAGINA);
    const pre = await p.evaluate(() => ({ suma: document.getElementById('pi-kpi-suma').textContent, act: document.getElementById('pi-kpi-actiuni').textContent, asteapta: document.getElementById('pi-kpi-asteptare').textContent, banda: document.getElementById('pi-stare-dosar').textContent, alerta: document.getElementById('pi-alerta-act').textContent }));
    verifica(/30\.000 EUR/.test(pre.suma) && pre.act === '30' && /5\.000 EUR/.test(pre.asteapta) && /verificată/.test(pre.banda) && !pre.alerta, `prezentare: ${JSON.stringify(pre)}`);
    await panou(p, 'participatii');
    const part = await p.evaluate(() => [...document.querySelectorAll('[data-pi-participatie]')].map((x) => x.textContent.replace(/\s+/g, ' ')));
    verifica(part.length === 2 && /10 februarie 2025/.test(part[0]) && /10 februarie 2026/.test(part[0]) && /10 octombrie 2027/.test(part[1]) && /safe/.test(part[1]), `participații: ${JSON.stringify(part)}`);
    verifica(!(await p.evaluate(() => /în așteptare/i.test(document.getElementById('pi-participatii').textContent))), 'o subscriere neaprobată apare la participații');
    await panou(p, 'subscrieri');
    verifica(await p.evaluate(() => document.querySelectorAll('#pi-subscrieri tr').length) === 3 && await p.getAttribute('#pi-subscriere-noua', 'href') === '/mydarrin-investitori.html?ruta=investitor', 'subscrierile sau „Subscriere nouă”');
    await panou(p, 'istoric');
    const ist = await p.evaluate(() => [...document.querySelectorAll('[data-pi-eveniment]')].map((x) => x.getAttribute('data-pi-eveniment')));
    verifica(ist.join() === 'exit_trimis,subscriere_aprobata', `istoric: ${ist}`);
    await panou(p, 'indicatori');
    verifica(await p.$('#pi-indicatori-grila') !== null && await p.getAttribute('a.pi-link', 'href') === '/mydarrin-pitch-deck', 'indicatorii sau linkul spre pitch deck');
    await panou(p, 'datele-mele');
    const dat = await p.evaluate(() => { const d = document.getElementById('datele-mele'); return { text: d.innerText, butoane: d.querySelectorAll('button, input, a').length }; });
    verifica(/•••• 1234/.test(dat.text) && /Cluj-Napoca/.test(dat.text) && /Carte de identitate/.test(dat.text) && !dat.butoane && !/în curând/i.test(dat.text), `datele mele: ${JSON.stringify(dat)}`);
    const tot = await p.evaluate(() => document.getElementById('pi-app').textContent);
    verifica(!/distribuți|dividend|notificări|în curând/i.test(tot), 'secțiuni rezervate pentru 11-I3 sau „în curând”');
    verifica(!erori.length, erori.join(' | '));
    await ctx.close();
  }
  {
    const d = FIX(); d.kyc = Object.assign({}, d.kyc, { status: 'in_verificare' });
    const { ctx, p } = await deschide(browser, baza, `${PAGINA}#indicatori`, { date: d });
    verifica(await p.isVisible('#pi-indicatori-mesaj') && !(await p.$('#pi-indicatori-grila')), 'fără verificare aprobată: indicatorii apar');
    verifica(await p.evaluate(() => document.querySelector('.pi-nav button[aria-current="page"]').getAttribute('data-pi-panou')) === 'indicatori', 'adresa cu #indicatori nu deschide secțiunea');
    await ctx.close();
  }

  // Alerta pentru act
  for (const [zile, clasa, limita] of [[61, null, 'peste 60'], [60, 'pi-banda-galben', '60'], [0, 'pi-banda-galben', 'azi'], [-1, 'pi-banda-rosu', 'expirat']]) {
    const d = FIX(); d.kyc = Object.assign({}, d.kyc, { act_valabil_pana: zi(zile) });
    const { ctx, p } = await deschide(browser, baza, PAGINA, { date: d });
    const a = await p.evaluate(() => { const b = document.querySelector('#pi-alerta-act .pi-banda'); return b ? { c: b.className, t: b.textContent, h: b.querySelector('a').getAttribute('href') } : null; });
    if (!clasa) verifica(a === null, `act ${limita}: ${JSON.stringify(a)}`);
    else verifica(a && a.c.includes(clasa) && a.h === '/mydarrin-contact.html' && (zile < 0 ? /a expirat; încarcă unul nou/ : /expiră pe/).test(a.t), `act ${limita}: ${JSON.stringify(a)}`);
    await ctx.close();
  }

  // Exit
  {
    const { ctx, p, erori, patch, post } = await deschide(browser, baza, `${PAGINA}#exit`);
    verifica((await p.textContent('#pi-vandabile')).trim() === '8', 'acțiunile vandabile');
    verifica(await p.$$eval('[data-pi-anuleaza]', (x) => x.length) === 1, 'butonul de anulare apare doar la cererea în procesare');
    await p.click('#pi-exit-trimite'); await asteapta(250);
    verifica(!post.length && await p.getAttribute('#pi-exit-n', 'aria-invalid') === 'true', 'câmpul gol nu e refuzat');
    await p.fill('#pi-exit-n', '9'); await p.click('#pi-exit-trimite'); await asteapta(300);
    verifica(!post.length && /între 1 și 8/.test(await p.textContent('#pi-exit-msg')), 'peste maximul vandabil');
    await p.fill('#pi-exit-n', '3'); await p.click('#pi-exit-trimite'); await p.waitForFunction(() => /înregistrată/.test(document.getElementById('pi-exit-msg').textContent), null, { timeout: 5000 }).catch(() => {});
    verifica(post.length === 1 && post[0].numar_actiuni === 3 && post[0].tip === 'buyback', `POST: ${JSON.stringify(post)}`);
    await p.click('[data-pi-anuleaza="c1"]');
    await p.waitForSelector('.md-confirma');
    await p.click('.md-confirma button:has-text("Renunță")');
    await asteapta(200);
    verifica(!patch.length, 'renunțarea a trimis cererea');
    await p.click('[data-pi-anuleaza="c1"]');
    await p.waitForSelector('.md-confirma');
    await p.click('.md-confirma button:has-text("Anulează cererea")');
    await p.waitForFunction(() => !document.querySelector('[data-pi-anuleaza]'), null, { timeout: 5000 }).catch(() => {});
    verifica(patch.length === 1 && patch[0].id === 'c1' && patch[0].actiune === 'anuleaza', `PATCH: ${JSON.stringify(patch)}`);
    verifica(/Anulată/.test(await p.textContent('#pi-exit-lista')) && /anulată/.test(await p.textContent('#pi-exit-msg')), 'lista sau mesajul după anulare');
    verifica(!erori.length, erori.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, p } = await deschide(browser, baza, `${PAGINA}#exit`, { anulare409: true });
    await p.click('[data-pi-anuleaza="c1"]'); await p.waitForSelector('.md-confirma'); await p.click('.md-confirma button:has-text("Anulează cererea")');
    await p.waitForFunction(() => /în procesare/.test(document.getElementById('pi-exit-msg').textContent), null, { timeout: 5000 }).catch(() => {});
    verifica(/doar cât e în procesare/.test(await p.textContent('#pi-exit-msg')), 'eroarea 409 nu apare');
    await ctx.close();
  }
  {
    const d = FIX(); d.portofoliu = Object.assign({}, d.portofoliu, { exit: { buyback_disponibil: true, discount_buyback_pct: 10, lock_up_luni: 12, actiuni_vandabile_acum: 0 } });
    const { ctx, p } = await deschide(browser, baza, `${PAGINA}#exit`, { date: d });
    verifica(!(await p.isVisible('#pi-exit-form')), 'cu 0 acțiuni vandabile, formularul e vizibil');
    await ctx.close();
  }

  // Legăturile
  {
    const c = (f) => fs.readFileSync(path.join(RADACINA, f), 'utf8');
    verifica(/noindex/.test(c(PAGINA)) && !/mydarrin-panou-investitor/.test(c('lib/seo-pagini.js') + c('api/public/sitemap.xml.js')), 'noindex sau sitemap');
    const DR = require(path.join(RADACINA, 'lib/destinatie-rol.js'));
    verifica(DR.dashboardPentruRol('investor') === '/' + PAGINA, '„Rolurile mele → Investitor”');
    verifica(!/\balert\(|\bconfirm\(|window\.prompt/.test(c('panou-investitor.js')), 'alert / confirm / prompt');
    verifica(!/window\.prompt|initiazaExitReal/.test(c('mydarrin-investitori.html')), 'exit-ul vechi a rămas în pagina Investitori');
    const { ctx, p } = await deschide(browser, baza, 'mydarrin-investitori.html#kpis', { oprireNavigare: false });
    await p.waitForURL(/mydarrin-panou-investitor/, { timeout: 15000 }).catch(() => {});
    verifica(/mydarrin-panou-investitor/.test(p.url()), `#kpis pentru investitor: ${p.url()}`);
    await ctx.close();
  }

  // Engleză: niciun panou cu text românesc
  {
    const { ctx, p, erori } = await deschide(browser, baza, PAGINA, { limba: null });
    for (const id of ['prezentare', 'participatii', 'subscrieri', 'exit', 'istoric', 'indicatori', 'datele-mele']) {
      await panou(p, id);
      const r = await p.evaluate(() => {
        const o = [];
        const w = document.createTreeWalker(document.getElementById('pi-app'), NodeFilter.SHOW_TEXT);
        while (w.nextNode()) { const n = w.currentNode, pe = n.parentElement; if (!n.data.trim() || pe.closest('[translate="no"],[hidden]') || pe.offsetParent === null) continue; if (/[ăâîșțĂÂÎȘȚ]/.test(n.data)) o.push(n.data.trim().slice(0, 70)); }
        return o;
      });
      verifica(!r.length, `EN ${id}: ${JSON.stringify(r)}`);
    }
    verifica((await p.textContent('.pi-titlu')).trim() === 'Investor dashboard', 'titlul EN');
    verifica(!erori.length, erori.join(' | '));
    await ctx.close();
  }

  // Ecrane
  for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1366, 900]]) {
    const { ctx, p, erori } = await deschide(browser, baza, PAGINA, { w, h });
    for (const id of ['prezentare', 'participatii', 'subscrieri', 'exit', 'istoric', 'indicatori', 'datele-mele']) {
      await panou(p, id); await asteapta(60);
      const r = await p.evaluate(() => { const W = document.documentElement.clientWidth; let peste = document.documentElement.scrollWidth - W; document.querySelectorAll('#pi-app *').forEach((e) => { const b = e.getBoundingClientRect(); if (b.width && b.right > W + 1 && !e.closest('.pi-nav,.pi-tabel-cutie')) peste = Math.max(peste, Math.round(b.right - W)); }); return peste; });
      verifica(r <= 0, `${w}px ${id}: depășire ${r}px`);
    }
    verifica(!erori.length, `${w}px: ${erori.join(' | ')}`);
    if (dosarCapturi && (w === 390 || w === 1366)) {
      fs.mkdirSync(dosarCapturi, { recursive: true });
      for (const id of ['prezentare', 'participatii', 'exit']) { await panou(p, id); await asteapta(250); await p.screenshot({ path: path.join(dosarCapturi, `panou-${id}-${w}.png`) }); }
    }
    await ctx.close();
    console.log(`${w}px: gata`);
  }
}

(async () => {
  await testeApi();
  const srv = await porneste(0);
  const browser = await chromium.launch();
  try { await testeBrowser('http://localhost:' + srv.address().port, browser); }
  finally { await browser.close(); srv.close(); }
  console.log(`\n${ok} verificări trecute, ${esec} eșuate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
