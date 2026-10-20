// scripts/test-reguli-platforma.js
// Teste pentru sursa unică a regulilor afișate pe paginile publice (pasul
// 11-A, 17 oct. 2026): api/public/reguli-platforma.js și reguli-platforma.js
// (browser). Supabase simulat — fără rețea, nimic nu ajunge la producție.
//
// Verifică:
//   - răspunsul API: țările cu checkout activ, pragul minim în moneda țării,
//     metodele de plată, confirmarea tacită (aceeași constantă ca cron-ul),
//     termenul de plată către partener, entitățile active;
//   - fără valori de rezervă: ce lipsește vine null / gol, în API și în pagină;
//   - cache-ul: ≤ 5 minute, un răspuns incomplet nu se păstrează.
//
// Rulare: node scripts/test-reguli-platforma.js

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, supabaseAdmin, cerere, raspuns, RADACINA } = sim;

const handler = require(path.join(RADACINA, 'api/public/reguli-platforma.js'));
const { FEREASTRA_TACITA_ORE } = require(path.join(RADACINA, 'lib/reguli-comenzi.js'));

let trecute = 0;
let picate = 0;
async function test(nume, fn) {
  try { await fn(); trecute++; console.log(`  ✓ ${nume}`); } catch (e) { picate++; console.log(`  ✗ ${nume}\n      ${e.message}`); }
}
function egal(a, b, mesaj) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${mesaj || ''} — așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(v, mesaj) { if (!v) throw new Error(mesaj || 'condiție falsă'); }

// Câte interogări ajung la baza de date (pentru cache).
let interogari = 0;
const fromOriginal = supabaseAdmin.from;
supabaseAdmin.from = (t) => { interogari++; return fromOriginal(t); };

function dateComplete() {
  DB.tabele.tax_configurations = [
    { tara_cod: 'RO', tara_nume: 'România', moneda: 'RON', prag_minim_comanda: 100, checkout_activ: true, activ: true },
    { tara_cod: 'MD', tara_nume: 'Moldova', moneda: 'MDL', prag_minim_comanda: null, checkout_activ: true, activ: true },
    { tara_cod: 'DE', tara_nume: 'Germania', moneda: 'EUR', prag_minim_comanda: 25, checkout_activ: false, activ: true },
    { tara_cod: 'FR', tara_nume: 'Franța', moneda: 'EUR', prag_minim_comanda: 25, checkout_activ: true, activ: false },
  ];
  DB.tabele.metode_plata_config = [
    { tara_cod: null, regiune: null, categorie_serviciu_slug: null, metode_acceptate: ['card'], activ: true },
    { tara_cod: 'MD', regiune: null, categorie_serviciu_slug: null, metode_acceptate: ['card', 'ordin_plata'], activ: true },
    { tara_cod: null, regiune: 'Bacău', categorie_serviciu_slug: null, metode_acceptate: ['ordin_plata'], activ: true },
    { tara_cod: 'RO', regiune: null, categorie_serviciu_slug: null, metode_acceptate: ['ordin_plata'], activ: false },
  ];
  DB.tabele.backoffice_config = [
    { cheie: 'termen_plata_partener_zile', valoare: '6', tara_cod: 'ALL', sectiune: 'plati' },
    { cheie: 'comision_platforma_default_pct', valoare: '12', tara_cod: 'ALL', sectiune: 'pricing' },
  ];
  DB.tabele.entitati_juridice_platforma = [
    { tara_cod: 'RO', denumire: 'Home Best Pal SRL', cui: '46577229', iban: 'RO00SECRET', activa: true },
    { tara_cod: 'GB', denumire: 'Home Best Pal LTD', cui: null, iban: null, activa: true },
    { tara_cod: 'RO', denumire: 'ENTITATE FICTIVĂ', cui: '1', iban: 'X', activa: false },
  ];
}

async function apel() {
  const res = raspuns();
  await handler(cerere({ metoda: 'GET' }), res);
  return res;
}

(async () => {
  console.log('\nAPI /api/public/reguli-platforma');

  await test('răspunsul complet, din sursele reale', async () => {
    dateComplete(); handler._golesteCache();
    const res = await apel();
    egal(res.statusCode, 200);
    const c = res.corp;
    egal(c.ok, true);
    egal(c.tari.map((t) => t.tara_cod), ['MD', 'RO'], 'doar țările active cu checkout, ordonate');
    egal(c.tari.find((t) => t.tara_cod === 'RO').prag_minim_comanda, 100);
    egal(c.tari.find((t) => t.tara_cod === 'RO').moneda, 'RON');
    egal(c.metode_plata, ['card'], 'rândul global din metode_plata_config');
    egal(c.tari.find((t) => t.tara_cod === 'MD').metode_plata, ['card', 'ordin_plata'], 'rândul țării are prioritate');
    egal(c.tari.find((t) => t.tara_cod === 'RO').metode_plata, ['card'], 'rândul RO inactiv e ignorat');
    egal(c.confirmare_tacita_ore, 24);
    egal(c.confirmare_tacita_ore, FEREASTRA_TACITA_ORE, 'aceeași constantă ca cron-ul');
    egal(c.termen_plata_partener_zile, 6);
    egal(c.entitati, [{ denumire: 'Home Best Pal LTD', tara_cod: 'GB' }, { denumire: 'Home Best Pal SRL', tara_cod: 'RO' }]);
  });

  await test('fără date personale și fără IBAN / CUI în răspuns', async () => {
    dateComplete(); handler._golesteCache();
    const text = JSON.stringify((await apel()).corp);
    adevarat(!/iban|SECRET|46577229|cui/i.test(text), text);
  });

  await test('cron-ul folosește aceeași constantă (nu o copie)', async () => {
    const cron = fs.readFileSync(path.join(RADACINA, 'api/cron/auto-confirma-comenzi.js'), 'utf8');
    adevarat(/require\('\.\.\/\.\.\/lib\/reguli-comenzi'\)/.test(cron), 'cron-ul nu importă lib/reguli-comenzi');
    adevarat(!/FEREASTRA_TACITA_ORE\s*=\s*\d/.test(cron), 'cron-ul încă are constanta proprie');
  });

  await test('fără valori de rezervă: cheia termen_plata_partener_zile lipsește → null', async () => {
    dateComplete(); handler._golesteCache();
    DB.tabele.backoffice_config = DB.tabele.backoffice_config.filter((r) => r.cheie !== 'termen_plata_partener_zile');
    const c = (await apel()).corp;
    egal(c.termen_plata_partener_zile, null);
    egal(c.tari.map((t) => t.termen_plata_partener_zile), [null, null]);
  });

  await test('fără valori de rezervă: niciun rând de metode → null (nu „card”)', async () => {
    dateComplete(); handler._golesteCache();
    DB.tabele.metode_plata_config = [];
    const c = (await apel()).corp;
    egal(c.metode_plata, null);
    egal(c.tari.map((t) => t.metode_plata), [null, null]);
  });

  await test('fără valori de rezervă: prag lipsă → null (nu 100)', async () => {
    dateComplete(); handler._golesteCache();
    const c = (await apel()).corp;
    egal(c.tari.find((t) => t.tara_cod === 'MD').prag_minim_comanda, null);
  });

  await test('o sursă care nu se poate citi → câmpul gol, răspuns fără cache', async () => {
    dateComplete(); handler._golesteCache();
    delete DB.tabele.tax_configurations; // relation does not exist
    const res = await apel();
    egal(res.statusCode, 200);
    egal(res.corp.tari, []);
    egal(res.corp.termen_plata_partener_zile, 6, 'celelalte surse rămân');
    egal(res.headere['Cache-Control'], 'no-store');
    dateComplete();
    interogari = 0;
    const din_nou = await apel();
    adevarat(interogari > 0, 'răspunsul incomplet a fost păstrat în cache');
    egal(din_nou.corp.tari.length, 2);
  });

  await test('cache: max. 5 minute, a doua cerere nu mai citește baza de date', async () => {
    dateComplete(); handler._golesteCache();
    interogari = 0;
    const r1 = await apel();
    const dupa1 = interogari;
    const r2 = await apel();
    adevarat(dupa1 === 4, `prima cerere: 4 interogări, nu ${dupa1}`);
    egal(interogari, dupa1, 'a doua cerere a citit din nou baza');
    egal(r2.corp, r1.corp);
    adevarat(handler.CACHE_SECUNDE <= 300, 'cache mai lung de 5 minute');
    adevarat(/max-age=(\d+)/.test(r1.headere['Cache-Control']) && Number(RegExp.$1) <= 300, r1.headere['Cache-Control']);
  });

  await test('cache: după expirare se citește din nou', async () => {
    dateComplete(); handler._golesteCache();
    const acum = Date.now;
    try {
      await apel();
      interogari = 0;
      Date.now = () => acum() + (handler.CACHE_SECUNDE + 1) * 1000;
      await apel();
      egal(interogari, 4);
    } finally { Date.now = acum; }
  });

  await test('doar GET', async () => {
    const res = raspuns();
    await handler(cerere({ metoda: 'POST' }), res);
    egal(res.statusCode, 405);
  });

  // ── reguli-platforma.js (browser), într-un DOM minimal ─────────────────
  console.log('\nreguli-platforma.js (browser)');

  function element(atribute, copii) {
    const el = {
      atr: Object.assign({}, atribute), textContent: '', innerHTML: '', copii: copii || [],
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.atr, k) ? this.atr[k] : null; },
      setAttribute(k, v) { this.atr[k] = String(v); },
      removeAttribute(k) { delete this.atr[k]; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.atr, k); },
      querySelectorAll(sel) { return toate(this.copii).filter((x) => potriveste(x, sel)); },
    };
    return el;
  }
  function toate(lista) { return lista.reduce((acc, x) => acc.concat([x], toate(x.copii)), []); }
  function potriveste(el, sel) { const m = /^\[([\w-]+)\]$/.exec(sel); return !!m && el.hasAttribute(m[1]); }

  async function ruleazaInPagina(raspunsApi, limba) {
    const ore = element({ 'data-regula': 'confirmare-tacita' });
    const zile = element({ 'data-regula': 'termen-plata-partener' });
    const metode = element({ 'data-regula': 'metode-plata' });
    const prag = element({ 'data-regula': 'prag-minim', 'data-tara': 'RO' });
    const tari = element({ 'data-regula': 'tari-coduri' });
    const copy = element({ 'data-myd-copyright': '' });
    const bloc = element({ 'data-regula-bloc': '', hidden: '' }, [zile]);
    const corp = [ore, metode, prag, tari, copy, bloc];
    const doc = { readyState: 'complete', documentElement: { lang: limba }, querySelectorAll: (s) => toate(corp).filter((x) => potriveste(x, s)), addEventListener() {} };
    const fereastra = {
      document: doc,
      MYD_I18N: { lang: limba },
      addEventListener() {},
      fetch: async () => (raspunsApi instanceof Error ? Promise.reject(raspunsApi) : { ok: raspunsApi != null, json: async () => raspunsApi }),
    };
    fereastra.window = fereastra;
    vm.runInNewContext(fs.readFileSync(path.join(RADACINA, 'reguli-platforma.js'), 'utf8'), Object.assign(fereastra, { Intl, Number, String, Array, Object, isFinite }));
    await fereastra.MYD_REGULI.incarca();
    await new Promise((r) => setTimeout(r, 0));
    return { ore, zile, metode, prag, tari, copy, bloc };
  }

  await test('valorile din API, în română', async () => {
    dateComplete(); handler._golesteCache();
    const api = (await apel()).corp;
    const p = await ruleazaInPagina(api, 'ro');
    egal(p.ore.textContent, '24 de ore');
    egal(p.zile.textContent, '6 zile');
    egal(p.metode.textContent, 'card, prin procesatorul de plăți');
    egal(p.prag.textContent, '100 RON');
    egal(p.tari.textContent, 'MD · RO');
    egal(p.bloc.hasAttribute('hidden'), false, 'blocul complet trebuie afișat');
    egal(p.copy.textContent, '© 2026 Home Best Pal SRL (România) · Home Best Pal LTD (Marea Britanie)');
  });

  await test('API-ul nu răspunde → elementele rămân goale, blocul ascuns', async () => {
    const p = await ruleazaInPagina(new Error('offline'), 'ro');
    egal([p.ore.textContent, p.zile.textContent, p.metode.textContent, p.prag.textContent, p.tari.textContent], ['', '', '', '', '']);
    egal(p.bloc.hasAttribute('hidden'), true);
  });

  await test('API-ul răspunde cu eroare (500) → gol, fără valori de rezervă', async () => {
    const p = await ruleazaInPagina(null, 'ro');
    egal([p.ore.textContent, p.zile.textContent, p.metode.textContent], ['', '', '']);
  });

  await test('valori lipsă din baza de date → elementele lor rămân goale', async () => {
    dateComplete(); handler._golesteCache();
    DB.tabele.backoffice_config = [];
    DB.tabele.metode_plata_config = [];
    DB.tabele.tax_configurations[0].prag_minim_comanda = null;
    const api = (await apel()).corp;
    const p = await ruleazaInPagina(api, 'ro');
    egal(p.zile.textContent, '');
    egal(p.metode.textContent, '');
    egal(p.prag.textContent, '');
    egal(p.bloc.hasAttribute('hidden'), true, 'blocul fără termen trebuie să rămână ascuns');
    egal(p.ore.textContent, '24 de ore', 'regula din cod rămâne');
  });

  console.log(`\n${trecute} trecute, ${picate} picate`);
  process.exit(picate ? 1 : 0);
})();
