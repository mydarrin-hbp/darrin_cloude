// scripts/test-darrin-ai-date-proprii.js
// Pasul 12-D1 (18 nov. 2026, regula LM din 17 nov.): Darrin AI lucrează doar cu
// datele My Darrin. Peste un Supabase simulat și cu Anthropic simulat (fetch
// interceptat) — niciun apel real la Anthropic sau la producție.
//   A. validarea răspunsului modelului (funcții pure): ID-uri inexistente sau
//      nepublicate respinse; explicație cu sume → text fix RO / EN; fără niciun
//      serviciu valid → încredere 0 și Consultanța Darrin;
//   B. api/darrin-ai/deviz.js cap-coadă: tool-ul nu mai cere
//      cost_brut_estimat_lei, enum-ul are doar serviciile publicate, promptul
//      interzice prețurile; răspunsul și rândul salvat nu conțin nicio sumă de
//      la model; prețul „de la” = lib/pret-serviciu.js (primul nivel, țara
//      clientului) sau null; încredere mică → consultanță; RO și EN;
//   C. paginile: niciun widget cu răspunsuri scrise în cod (daiRespond inline,
//      „avem 6 servicii”), fără cost_brut în pagini;
//   D. în Chromium: catalog (modalul Darrin AI) și „Creează deviz” — 1–3 carduri
//      de servicii, nicio cifră de preț care nu vine din server (verificare în
//      DOM), butonul Consultanță Darrin la încredere mică; widget-ul flotant
//      caută prin /api/public/catalog (interceptat), nu într-o listă din cod;
//      RO și EN, 390 și 1366 px, fără erori JS și fără derulare orizontală.
// Capturi înainte / după (opțional): CAPTURI=docs/capturi-12d1 node scripts/test-darrin-ai-date-proprii.js
//   („înainte” = paginile din main, servite din git, cu răspunsul vechi al API-ului).
// Rulare: node scripts/test-darrin-ai-date-proprii.js   (FARA_BROWSER=1: doar A–C)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

function stub(fisier, exp) {
  const p = require.resolve(path.join(RADACINA, fisier));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };
}
stub('lib/rate-limit.js', { checkRateLimit: async () => true, limiteazaCererea: async () => true });
stub('lib/auth-middleware.js', { getAuthenticatedUser: async () => null, requireAuth: async () => null });
const modulReteta = require(path.join(RADACINA, 'lib/calculeaza-cost-recipe.js'));
modulReteta.calculeazaCostNivel = async ({ nivelId }) => ({ nivel_id: nivelId, cost_baza_servicii: 0, cost_materiale: 0, cost_utilaj: 0, articole: [], resurse_fara_pret: [{ motiv: 'niciun_articol_legat_de_nivel' }] });

// O valoare de test, nu o cheie reală (endpoint-ul cere doar să existe).
process.env.ANTHROPIC_API_KEY = 'valoare-de-test-fara-acces';

const apiDeviz = require(path.join(RADACINA, 'api/darrin-ai/deviz.js'));
const apiCatalog = require(path.join(RADACINA, 'api/public/catalog.js'));
const { calculeazaPretServiciu } = require(path.join(RADACINA, 'lib/pret-serviciu.js'));
const { valideazaRezultatAI, continutSume, EXPLICATIE_FIXA, EXPLICATIE_LIPSA } = apiDeviz;

const ID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NV = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Serviciile simulate: 4 publicate, 2 nepublicate (ciornă, retras) și un material publicat.
const S = [
  { id: ID(1), id_serviciu: 'inlocuire-calorifer', titlu: 'Înlocuire calorifer', en: 'Radiator replacement', categorie: 'servicii', stare: 'publicat', status_public: true, niveluri: [[NV(12), 'Gold', 600], [NV(11), 'Bronze', 280]] },
  { id: ID(2), id_serviciu: 'reparatie-garnituri-calorifer', titlu: 'Reparație garnituri calorifer', en: 'Radiator gasket repair', categorie: 'servicii', stare: 'publicat', status_public: true, niveluri: [[NV(21), 'Silver', 150]] },
  { id: ID(3), id_serviciu: 'montaj-tablou-electric', titlu: 'Montaj tablou electric', en: 'Electrical panel installation', categorie: 'servicii', stare: 'publicat', status_public: true, niveluri: [[NV(31), 'Bronze', null]] },
  { id: ID(4), id_serviciu: 'consultanta-darrin', titlu: 'Consultanță Darrin', en: 'Darrin Consultancy', categorie: 'servicii', stare: 'publicat', status_public: true, niveluri: [[NV(41), 'Bronze', 100]] },
  { id: ID(5), id_serviciu: 'serviciu-ciorna', titlu: 'Serviciu în lucru', en: 'Draft service', categorie: 'servicii', stare: 'ciorna', status_public: false, niveluri: [[NV(51), 'Bronze', 90]] },
  { id: ID(6), id_serviciu: 'serviciu-retras', titlu: 'Serviciu retras', en: 'Withdrawn service', categorie: 'servicii', stare: 'retras', status_public: true, niveluri: [[NV(61), 'Bronze', 90]] },
  { id: ID(7), id_serviciu: 'mat-calorifer-otel', titlu: 'Calorifer din oțel', en: 'Steel radiator', categorie: 'materiale', stare: 'publicat', status_public: true, niveluri: [[NV(71), 'Bronze', 310]] },
];

function reset() {
  DB.tabele = {
    categorii: [
      { slug: 'instalatii-termice', title: 'Instalații termice', category_type: 'servicii', display_order: 1 },
      { slug: 'instalatii-electrice', title: 'Instalații electrice', category_type: 'servicii', display_order: 2 },
      { slug: 'consultanta', title: 'Consultanță', category_type: 'servicii', display_order: 3 },
    ],
    catalog_servicii: S.map((s) => ({
      id: s.id, id_serviciu: s.id_serviciu, titlu: s.titlu, categorie: s.categorie, stare: s.stare, status_public: s.status_public,
      unitate_masura: 'buc', domeniu: s.categorie === 'servicii' ? 'Instalații' : 'Materiale', descriere: 'Descriere din catalog', imagini: [],
      categorie_id: null, subcategorie_id: null, traduceri: { en: { titlu: s.en, domeniu: 'Installations' } },
    })),
    catalog_niveluri: S.flatMap((s) => s.niveluri.map(([id, nivel, pret]) => ({ id, serviciu_id: s.id, nivel, catalog_preturi: pret == null ? [] : [{ pret, tara_cod: 'RO' }] }))),
    catalog_preturi: S.flatMap((s) => s.niveluri.filter(([, , pret]) => pret != null).map(([id, , pret]) => ({ nivel_id: id, pret, tara_cod: 'RO' }))),
    catalog_relatii: [],
    devize_articole: [],
    tax_configurations: [{ tara_cod: 'RO', moneda: 'RON', cota_tva: 21, prag_minim_comanda: 150, checkout_activ: true }],
    backoffice_config: [
      { sectiune: 'pricing', cheie: 'cost_marketing_pct', valoare: '3', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'cost_mentenanta_pct', valoare: '2', tara_cod: 'ALL' },
      { sectiune: 'pricing', cheie: 'comision_platforma_default_pct', valoare: '12', tara_cod: 'ALL' },
      { sectiune: 'asigurari', cheie: 'cost_asigurare_pct', valoare: '1', tara_cod: 'ALL' },
    ],
    tarife_transport: [],
    devize_ai_requests: [],
  };
  DB.coloane = {};
  DB.implicite = {};
}

// ── Anthropic simulat ─────────────────────────────────────────────────
const ANTHROPIC = { raspuns: null, cereri: [], status: 200 };
const fetchReal = global.fetch;
global.fetch = async (url, opt = {}) => {
  if (String(url).startsWith('https://api.anthropic.com/')) {
    ANTHROPIC.cereri.push(JSON.parse(opt.body));
    const corp = ANTHROPIC.status === 200
      ? { id: 'msg_test', type: 'message', content: [{ type: 'tool_use', id: 'tu_1', name: 'identifica_serviciu', input: ANTHROPIC.raspuns }] }
      : { error: { message: 'simulat' } };
    return { ok: ANTHROPIC.status === 200, status: ANTHROPIC.status, json: async () => corp };
  }
  if (/api\.anthropic\.com/.test(String(url))) throw new Error('apel neașteptat la Anthropic');
  return fetchReal(url, opt);
};

let ok = 0, esec = 0;
async function test(nume, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + nume); }
  catch (e) { esec++; console.log('  ✗ ' + nume + ' — ' + e.message); }
}
function egal(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(c, m) { if (!c) throw new Error(m || 'condiție falsă'); }
async function cheama(body) {
  const res = raspuns();
  await apiDeviz(cerere({ metoda: 'POST', body }), res);
  return res;
}
async function intreaba(raspunsModel, body) {
  ANTHROPIC.raspuns = raspunsModel;
  ANTHROPIC.cereri.length = 0;
  return cheama(body);
}
async function pretAsteptat(nivelId) {
  const r = await calculeazaPretServiciu({ nivelId, cantitate: 1, taraCod: 'RO' });
  return r.ok ? r.calc.pret_final : null;
}

// ── A. Validarea (funcții pure) ──────────────────────────────────────
async function testeValidare() {
  console.log('A. Validarea răspunsului modelului');
  const servicii = S.filter((s) => s.stare === 'publicat' && s.status_public && s.categorie === 'servicii')
    .map((s) => ({ id: s.id, id_serviciu: s.id_serviciu, titlu: s.titlu, traduceri: { en: { titlu: s.en } } }));
  const sluguri = [{ slug: 'instalatii-termice', title: 'Instalații termice' }];
  await test('ID-urile inexistente, nepublicate sau dublate se resping; rămân cel mult 3', async () => {
    const r = valideazaRezultatAI({ categorie_slug: 'instalatii-termice', servicii_ids: ['inexistent', 'serviciu-ciorna', 'inlocuire-calorifer', 'inlocuire-calorifer', 'reparatie-garnituri-calorifer', 'montaj-tablou-electric', 'consultanta-darrin'], incredere: 0.9, explicatie: 'Caloriferul curge.' }, { sluguri, servicii, lang: 'ro' });
    egal(r.alese.map((s) => s.id_serviciu), ['inlocuire-calorifer', 'reparatie-garnituri-calorifer', 'montaj-tablou-electric']);
    egal(r.respinse, ['inexistent', 'serviciu-ciorna']);
  });
  for (const [text, are] of [['Costă cam 250 lei.', true], ['Între 1.200 de RON și 1.500 RON', true], ['about €90', true], ['around 100 euros', true], ['RON 300', true], ['$40 per hour', true],
    ['Înlocuirea a 2 calorifere, 10 m² de gresie', false], ['Durează 3 zile', false], ['Radiator gasket repair', false]]) {
    await test(`sume în explicație: „${text}” → ${are ? 'detectată' : 'fără sumă'}`, async () => egal(continutSume(text), are));
  }
  for (const lang of ['ro', 'en']) {
    await test(`${lang}: explicația cu sume se înlocuiește cu textul fix`, async () => {
      const r = valideazaRezultatAI({ categorie_slug: 'instalatii-termice', servicii_ids: ['inlocuire-calorifer'], incredere: 0.8, explicatie: 'Prețul tipic e 450 lei pe piață.' }, { sluguri, servicii, lang });
      egal(r.explicatie, EXPLICATIE_FIXA[lang]);
      egal(r.explicatieInlocuita, true);
    });
    await test(`${lang}: niciun serviciu valid → încredere 0, explicație fixă, Consultanța Darrin`, async () => {
      const r = valideazaRezultatAI({ categorie_slug: 'nu-exista', servicii_ids: ['inventat-de-model'], incredere: 0.95, explicatie: 'Ceva' }, { sluguri, servicii, lang });
      egal(r.alese.length, 0); egal(r.incredere, 0); egal(r.recomandaConsultanta, true);
      egal(r.explicatie, EXPLICATIE_LIPSA[lang]); egal(r.consultanta && r.consultanta.id_serviciu, 'consultanta-darrin'); egal(r.categorie, null);
    });
  }
  await test('încredere mică (0,3) → recomandare de consultanță; încredere 0,8 → fără', async () => {
    egal(valideazaRezultatAI({ servicii_ids: ['inlocuire-calorifer'], incredere: 0.3, explicatie: 'x' }, { sluguri, servicii, lang: 'ro' }).recomandaConsultanta, true);
    egal(valideazaRezultatAI({ servicii_ids: ['inlocuire-calorifer'], incredere: 0.8, explicatie: 'x' }, { sluguri, servicii, lang: 'ro' }).recomandaConsultanta, false);
  });
}

// ── B. Endpoint-ul cap-coadă ─────────────────────────────────────────
async function testeEndpoint() {
  console.log('B. api/darrin-ai/deviz.js (Anthropic simulat)');
  reset();
  const PUBLICATE = ['consultanta-darrin', 'inlocuire-calorifer', 'montaj-tablou-electric', 'reparatie-garnituri-calorifer'];
  let res;
  await test('cererea către model: fără cost_brut_estimat_lei; enum = doar serviciile publicate; promptul interzice prețurile', async () => {
    res = await intreaba({ categorie_slug: 'instalatii-termice', servicii_ids: ['inlocuire-calorifer', 'reparatie-garnituri-calorifer'], incredere: 0.85, explicatie: 'Caloriferul pierde apă la racord.' }, { mod: 'servicii', text: 'Curge un calorifer', lang: 'ro', tara: 'RO' });
    egal(res.statusCode, 200);
    const c = ANTHROPIC.cereri[0];
    const schema = c.tools[0].input_schema;
    adevarat(!JSON.stringify(c.tools).includes('cost_brut'), 'tool-ul încă pomenește cost_brut');
    egal(schema.required, ['categorie_slug', 'servicii_ids', 'incredere', 'explicatie']);
    egal(schema.properties.servicii_ids.items.enum.slice().sort(), PUBLICATE, 'enum servicii');
    egal(schema.properties.servicii_ids.maxItems, 3);
    egal(schema.properties.categorie_slug.enum, ['instalatii-termice', 'instalatii-electrice', 'consultanta']);
    adevarat(/Nu scrii prețuri, sume de bani/.test(c.system), 'promptul nu interzice sumele');
    adevarat(/Alegi numai ID-uri din listele primite/.test(c.system), 'promptul nu limitează la liste');
    adevarat(/consultanta-darrin/.test(c.system), 'promptul nu pomenește consultanța');
    adevarat(!/piață|market/i.test(c.system), 'promptul pomenește prețuri de piață');
    adevarat(!/serviciu-ciorna|serviciu-retras|mat-calorifer-otel/.test(c.system), 'promptul conține servicii nepublicate / materiale');
  });
  await test('răspunsul: serviciile propuse cu titlu RO / EN, link și prețul „de la” calculat de server', async () => {
    const r = res.corp;
    egal(r.servicii.map((s) => s.id_serviciu), ['inlocuire-calorifer', 'reparatie-garnituri-calorifer']);
    egal(r.servicii[0].titlu, { ro: 'Înlocuire calorifer', en: 'Radiator replacement' });
    egal(r.servicii[0].url, '/mydarrin-produs.html?slug=inlocuire-calorifer&type=serviciu');
    egal(r.servicii[0].nivel, 'Bronze', 'primul nivel (Bronze înaintea Gold)');
    egal(r.servicii[0].pret_de_la, await pretAsteptat(NV(11)), 'preț = lib/pret-serviciu.js');
    egal(r.servicii[0].pret_de_la, 399.95, '280 Lei → 399,95 Lei cu formula publică');
    egal(r.servicii[1].pret_de_la, await pretAsteptat(NV(21)));
    egal(r.servicii[0].moneda, 'RON');
    egal(r.explicatie, 'Caloriferul pierde apă la racord.');
    egal(r.recomanda_consultanta, false); egal(r.consultanta, null);
  });
  await test('nicio sumă de la model: răspunsul și rândul salvat nu au cost_brut_estimat', async () => {
    res = await intreaba({ categorie_slug: 'instalatii-termice', servicii_ids: ['inlocuire-calorifer'], incredere: 0.9, explicatie: 'Ok.', cost_brut_estimat_lei: 450 }, { mod: 'servicii', text: 'calorifer', lang: 'ro' });
    const txt = JSON.stringify(res.corp);
    adevarat(!/cost_brut/.test(txt), 'răspunsul conține cost_brut');
    adevarat(!txt.includes('450'), 'suma modelului a ajuns în răspuns');
    const rand = DB.tabele.devize_ai_requests[DB.tabele.devize_ai_requests.length - 1];
    adevarat(rand && !('ai_cost_brut_estimat' in rand), 'rândul salvat are ai_cost_brut_estimat');
    egal(rand.ai_categorie_slug, 'instalatii-termice');
  });
  await test('serviciu fără preț calculabil → pret_de_la = null (pagina: „Vezi prețul pe pagina serviciului”)', async () => {
    res = await intreaba({ categorie_slug: 'instalatii-electrice', servicii_ids: ['montaj-tablou-electric'], incredere: 0.7, explicatie: 'Tablou nou.' }, { mod: 'servicii', text: 'tablou electric', lang: 'ro' });
    egal(res.corp.servicii[0].pret_de_la, null); egal(res.corp.servicii[0].moneda, null);
  });
  await test('ID-uri inexistente / nepublicate de la model → respinse; rămâne doar cel publicat', async () => {
    res = await intreaba({ categorie_slug: 'instalatii-termice', servicii_ids: ['serviciu-ciorna', 'serviciu-retras', 'mat-calorifer-otel', 'inventat', 'reparatie-garnituri-calorifer'], incredere: 0.7, explicatie: 'Garnituri.' }, { mod: 'servicii', text: 'garnitura', lang: 'ro' });
    egal(res.corp.servicii.map((s) => s.id_serviciu), ['reparatie-garnituri-calorifer']);
  });
  for (const lang of ['ro', 'en']) {
    await test(`${lang}: doar ID-uri respinse → fără servicii, încredere 0, Consultanța Darrin cu prețul serverului`, async () => {
      res = await intreaba({ categorie_slug: 'instalatii-termice', servicii_ids: ['inventat'], incredere: 0.9, explicatie: 'x' }, { mod: 'servicii', text: 'ceva neclar', lang });
      egal(res.corp.servicii, []); egal(res.corp.incredere, 0); egal(res.corp.recomanda_consultanta, true);
      egal(res.corp.explicatie, EXPLICATIE_LIPSA[lang]);
      egal(res.corp.consultanta.id_serviciu, 'consultanta-darrin');
      egal(res.corp.consultanta.titlu[lang], lang === 'ro' ? 'Consultanță Darrin' : 'Darrin Consultancy');
      egal(res.corp.consultanta.pret_de_la, await pretAsteptat(NV(41)));
    });
    await test(`${lang}: explicația cu sume se înlocuiește (cu promptul în limba ${lang})`, async () => {
      res = await intreaba({ categorie_slug: 'instalatii-termice', servicii_ids: ['inlocuire-calorifer'], incredere: 0.8, explicatie: lang === 'ro' ? 'Pe piață costă în jur de 600 de lei.' : 'It usually costs about 120 EUR.' }, { mod: 'servicii', text: 'calorifer', lang });
      egal(res.corp.explicatie, EXPLICATIE_FIXA[lang]); egal(res.corp.explicatie_inlocuita, true);
      adevarat(new RegExp(`în limba ${lang === 'ro' ? 'română' : 'engleză'}`).test(ANTHROPIC.cereri[0].system), 'limba explicației în prompt');
    });
    await test(`${lang}: încredere mică → recomandare de consultanță, serviciile rămân`, async () => {
      res = await intreaba({ categorie_slug: 'instalatii-termice', servicii_ids: ['inlocuire-calorifer'], incredere: 0.3, explicatie: 'Nu e clar.' }, { mod: 'servicii', text: 'ceva', lang });
      egal(res.corp.recomanda_consultanta, true); egal(res.corp.servicii.length, 1);
      egal(res.corp.consultanta.url, '/mydarrin-produs.html?slug=consultanta-darrin&type=serviciu');
    });
  }
  await test('consultanța nepublicată → fără buton de consultanță (consultanta: null)', async () => {
    const c = DB.tabele.catalog_servicii.find((s) => s.id_serviciu === 'consultanta-darrin');
    c.stare = 'retras'; c.status_public = false;
    res = await intreaba({ categorie_slug: 'instalatii-termice', servicii_ids: ['inventat'], incredere: 0.2, explicatie: 'x' }, { mod: 'servicii', text: 'x', lang: 'ro' });
    egal(res.corp.consultanta, null); egal(res.corp.recomanda_consultanta, true);
    adevarat(!/consultanta-darrin/.test(ANTHROPIC.cereri[0].system), 'promptul propune o consultanță nepublicată');
    reset();
  });
  await test('modul „proiect” folosește aceleași liste și aceleași reguli', async () => {
    res = await intreaba({ categorie_slug: 'instalatii-termice', servicii_ids: ['inlocuire-calorifer'], incredere: 0.6, explicatie: 'Renovare.' }, { mod: 'proiect', tip_constructie: 'renovare apartament', suprafata_mp: 65, lang: 'en' });
    egal(res.statusCode, 200);
    adevarat(/Nu scrii prețuri/.test(ANTHROPIC.cereri[0].system) && /renovare apartament/.test(ANTHROPIC.cereri[0].system));
  });
  await test('câmpul vechi cost_brut în cerere → refuzat (400, forma comună)', async () => {
    res = await cheama({ mod: 'servicii', text: 'x', cost_brut: 100 });
    egal(res.statusCode, 400); egal(res.corp.ok, false);
  });
  await test('Anthropic indisponibil → 502 în forma comună, RO + EN', async () => {
    ANTHROPIC.status = 500;
    res = await cheama({ mod: 'servicii', text: 'calorifer' });
    ANTHROPIC.status = 200;
    egal(res.statusCode, 502); adevarat(res.corp.mesaj && res.corp.mesaj.ro && res.corp.mesaj.en);
  });
}

// ── C. Paginile (static) ──────────────────────────────────────────────
function testeStatice() {
  console.log('C. Paginile, fără răspunsuri scrise în cod');
  const html = execSync('git ls-files "*.html"', { cwd: RADACINA }).toString().trim().split(/\r?\n/);
  return (async () => {
    await test('nicio pagină nu mai are daiRespond() scris în pagină sau „avem 6 servicii”', async () => {
      const cu = html.filter((f) => /function daiRespond\s*\(|avem 6 servicii/.test(fs.readFileSync(path.join(RADACINA, f), 'utf8')));
      egal(cu, []);
    });
    await test('paginile cu widget încarcă /darrin-ai-cautare.js', async () => {
      const fara = html.filter((f) => { const t = fs.readFileSync(path.join(RADACINA, f), 'utf8'); return t.includes('id="dai-chat-panel"') && !t.includes('src="/darrin-ai-cautare.js"'); });
      egal(fara, []);
    });
    await test('darrin-ai-cautare.js: catalogul din /api/public/catalog, fără PRODUCTS_DB sau liste de servicii', async () => {
      // Doar codul, fără comentarii (comentariile explică ce s-a scos).
      const js = fs.readFileSync(path.join(RADACINA, 'darrin-ai-cautare.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      adevarat(js.includes("fetch('/api/public/catalog?tara="));
      adevarat(!/PRODUCTS_DB|TIER_DB|instalatii-electrice|calorifer/.test(js));
    });
    await test('catalog și „Creează deviz”: fără cost_brut și fără /api/deviz/calculate cu sumă de la AI', async () => {
      for (const f of ['mydarrin-catalog.html', 'mydarrin-creeaza-deviz.html']) {
        const t = fs.readFileSync(path.join(RADACINA, f), 'utf8');
        adevarat(!/cost_brut/.test(t), f + ': cost_brut');
        adevarat(!/confirmaEstimareAI/.test(t), f + ': confirmaEstimareAI');
      }
    });
  })();
}

// ── D. Chromium ──────────────────────────────────────────────────────
async function testeBrowser() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { esec++; console.log('  ✗ Playwright lipsește'); return; }
  const { porneste } = require('./server-test');
  const CAPTURI = process.env.CAPTURI ? path.resolve(process.env.CAPTURI) : null;
  if (CAPTURI) fs.mkdirSync(CAPTURI, { recursive: true });
  const APELURI = { catalog: 0, deviz: 0 };
  // Versiunea „înainte” a paginilor (din main) și răspunsul vechi al API-ului, doar pentru capturi.
  const VECHI = { activ: false };
  const dinMain = (f) => { try { return execSync(`git show main:${f}`, { cwd: RADACINA, maxBuffer: 64 * 1024 * 1024 }).toString(); } catch (e) { return null; } };
  const RASPUNS_VECHI = { ok: true, request_id: null, categorie_slug: 'instalatii-termice', titlu_categorie: 'Instalații termice', cost_brut_estimat: 450, incredere: 0.82, explicatie: 'Caloriferul pierde apă la racord; estimarea are la bază prețurile tipice de piață.' };

  async function context(browser, latime, lang) {
    const ctx = await browser.newContext({ viewport: { width: latime, height: latime < 720 ? 844 : 900 }, hasTouch: latime < 720 });
    await ctx.addInitScript((l) => { try { localStorage.setItem('myd_lang_v1', l); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), marketing: false, versiune: 2 })); } catch (e) {} }, lang);
    await ctx.route(/supabase\.co\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await ctx.route(/ipapi\.co|nominatim|homebestpal\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await ctx.route(/\/api\//, async (r) => {
      const req = r.request();
      const u = new URL(req.url());
      let corp = null; try { corp = JSON.parse(req.postData() || 'null'); } catch (e) { corp = null; }
      let api = null;
      if (u.pathname === '/api/public/catalog') { APELURI.catalog++; api = apiCatalog; }
      if (u.pathname === '/api/darrin-ai/deviz') {
        APELURI.deviz++;
        if (VECHI.activ) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RASPUNS_VECHI) });
        api = apiDeviz;
      }
      if (!api) return r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' });
      const res = raspuns();
      await api(cerere({ metoda: req.method(), body: corp, query: Object.fromEntries(u.searchParams) }), res);
      return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp || {}) });
    });
    return ctx;
  }
  async function pagina(ctx, adresa) {
    const pg = await ctx.newPage();
    pg.setDefaultTimeout(10000);
    pg.erori = [];
    pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 200)));
    await pg.goto(baza + adresa, { waitUntil: 'load' });
    await pg.waitForTimeout(500);
    return pg;
  }
  // La 390 px, câmpul modalului are lățimea 0 (defect existent și în main, raportat separat):
  // textul se pune direct în câmp, ca la tastare.
  const completeazaModal = (pg, text) => pg.evaluate((t) => { document.getElementById('chat-input').value = t; }, text);
  const depasire = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  // Verificarea din DOM: orice sumă de bani din zona rezultatului trebuie să stea
  // într-un element [data-pret-server] și să fie unul din prețurile trimise de server.
  async function verificaPreturi(pg, selector, preturiServer) {
    const r = await pg.evaluate((sel) => {
      const rad = document.querySelector(sel);
      if (!rad) return { lipsa: true };
      const RE = /\d[\d.,\s]*\s*(lei|ron|€|eur|\$|£)|(lei|ron|€|eur|\$|£)\s*\d/i;
      const copie = rad.cloneNode(true);
      const din = [...copie.querySelectorAll('[data-pret-server]')].map((e) => { const t = e.textContent; e.remove(); return t; });
      return { suma: RE.test(copie.textContent) ? copie.textContent.replace(/\s+/g, ' ').slice(0, 200) : null, din };
    }, selector);
    adevarat(!r.lipsa, 'lipsește ' + selector);
    adevarat(!r.suma, 'sumă care nu vine din server: ' + r.suma);
    const cifre = (x) => String(Math.round(Number(x) * 100));
    const asteptate = preturiServer.filter((p) => p != null).map(cifre).sort();
    egal(r.din.map((t) => t.replace(/\D/g, '')).sort(), asteptate, 'prețurile afișate = prețurile serverului');
  }

  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  const captura = async (pg, nume, el) => {
    if (!CAPTURI) return;
    const tinta = el ? await pg.$(el) : null;
    const fisier = path.join(CAPTURI, nume + '.png');
    let gata = false;
    if (tinta) gata = await tinta.screenshot({ path: fisier }).then(() => true, () => false);
    if (!gata) await pg.screenshot({ path: fisier }).catch(() => {});
  };
  try {
    for (const lang of ['ro', 'en']) {
      for (const latime of [390, 1366]) {
        console.log(`D. Chromium · ${lang.toUpperCase()} · ${latime}px`);
        reset();
        const ctx = await context(browser, latime, lang);

        await test(`${lang} ${latime}: catalog — modalul Darrin AI arată 1–3 servicii, prețuri doar de la server`, async () => {
          ANTHROPIC.raspuns = { categorie_slug: 'instalatii-termice', servicii_ids: ['inlocuire-calorifer', 'montaj-tablou-electric'], incredere: 0.86, explicatie: lang === 'ro' ? 'Caloriferul pierde apă la racord.' : 'The radiator is leaking at the joint.' };
          const pg = await pagina(ctx, '/mydarrin-catalog.html');
          await pg.evaluate(() => openConsultanta());
          await completeazaModal(pg, 'Curge un calorifer');
          const inainte = APELURI.deviz;
          await pg.evaluate(() => sendToAI());
          await pg.waitForSelector('#rec-services [data-ai-serviciu]');
          egal(APELURI.deviz, inainte + 1, 'un apel la /api/darrin-ai/deviz');
          const carduri = await pg.$$eval('#rec-services [data-ai-serviciu]', (els) => els.map((e) => ({ id: e.getAttribute('data-ai-serviciu'), text: e.textContent.replace(/\s+/g, ' ').trim(), href: e.querySelector('a').getAttribute('href') })));
          egal(carduri.map((c) => c.id), ['inlocuire-calorifer', 'montaj-tablou-electric']);
          adevarat(carduri[0].text.includes(lang === 'ro' ? 'Înlocuire calorifer' : 'Radiator replacement'), 'titlul în limba paginii');
          adevarat(carduri[1].text.includes(lang === 'ro' ? 'Vezi prețul pe pagina serviciului' : 'See the price on the service page'), 'fără preț → trimitere la pagina serviciului');
          egal(carduri[0].href, '/mydarrin-produs.html?slug=inlocuire-calorifer&type=serviciu');
          await verificaPreturi(pg, '#ai-result', [399.95]);
          egal(await pg.$eval('#escalate-to-argint', (e) => getComputedStyle(e).display), 'none', 'fără consultanță la încredere mare');
          egal(pg.erori, [], 'erori JS');
          adevarat((await depasire(pg)) <= 0, 'derulare orizontală');
          await captura(pg, `catalog-ai-${lang}-${latime}-dupa`, '#ai-result');
          await pg.close();
        });

        await test(`${lang} ${latime}: catalog — încredere mică → butonul Consultanță Darrin`, async () => {
          ANTHROPIC.raspuns = { categorie_slug: 'instalatii-termice', servicii_ids: ['inventat'], incredere: 0.9, explicatie: 'x' };
          const pg = await pagina(ctx, '/mydarrin-catalog.html');
          await pg.evaluate(() => openConsultanta());
          await completeazaModal(pg, 'ceva neclar');
          await pg.evaluate(() => sendToAI());
          await pg.waitForSelector('#ai-buton-consultanta', { state: 'visible' });
          egal(await pg.$eval('#ai-buton-consultanta', (e) => e.getAttribute('href')), '/mydarrin-produs.html?slug=consultanta-darrin&type=serviciu');
          egal(await pg.$$eval('#rec-services [data-ai-serviciu]', (e) => e.length), 0);
          await verificaPreturi(pg, '#ai-result', []);
          egal(pg.erori, [], 'erori JS');
          await pg.close();
        });

        await test(`${lang} ${latime}: „Creează deviz” — carduri .svc-card, fără cost estimat, prețuri doar de la server`, async () => {
          ANTHROPIC.raspuns = { categorie_slug: 'instalatii-termice', servicii_ids: ['inlocuire-calorifer', 'reparatie-garnituri-calorifer', 'montaj-tablou-electric'], incredere: 0.3, explicatie: lang === 'ro' ? 'Costă în jur de 500 lei.' : 'Roughly 100 EUR.' };
          const pg = await pagina(ctx, '/mydarrin-creeaza-deviz.html');
          await pg.fill('#dv-text', 'Curge un calorifer');
          await pg.click('#dv-submit-btn');
          await pg.waitForSelector('#dv-rez-servicii .svc-card');
          const n = await pg.$$eval('#dv-rez-servicii .svc-card', (e) => e.map((x) => x.getAttribute('data-ai-serviciu')));
          egal(n, ['inlocuire-calorifer', 'reparatie-garnituri-calorifer', 'montaj-tablou-electric']);
          const expl = await pg.$eval('#dv-rez-explicatie', (e) => e.textContent);
          egal(expl, EXPLICATIE_FIXA[lang], 'explicația cu sume înlocuită');
          await verificaPreturi(pg, '#dv-rezultat', [399.95, await pretAsteptat(NV(21))]);
          egal(await pg.$eval('#dv-rez-consultanta', (e) => getComputedStyle(e).display), 'block', 'consultanța la încredere mică');
          egal(await pg.$eval('#dv-rez-consultanta-btn', (e) => e.getAttribute('href')), '/mydarrin-produs.html?slug=consultanta-darrin&type=serviciu');
          adevarat(!(await pg.$('#dv-rez-cost')), 'rândul „Cost brut estimat” a rămas');
          egal(pg.erori, [], 'erori JS');
          adevarat((await depasire(pg)) <= 0, 'derulare orizontală');
          await captura(pg, `creeaza-deviz-${lang}-${latime}-dupa`, '#dv-rezultat');
          await pg.close();
        });

        // Butoanele rapide ale widget-ului, după scoaterea daiRespond() din pagini:
        // cele două de navigare duc la paginile lor (și pagina se deschide), cele
        // două de căutare dau rezultate din catalog.
        for (const pag of ['/index.html', '/mydarrin-cum-functioneaza.html']) {
          await test(`${lang} ${latime}: butoanele rapide ale widget-ului pe ${pag}`, async () => {
            const RAPIDE = [
              ['Cum funcționează platforma?', /^\/mydarrin-cum-functioneaza\.html$/, '/mydarrin-cum-functioneaza.html'],
              ['Vreau să devin partener', /^\/parteneri\/inscriere$/, '/parteneri/inscriere'],
              ['Curge un calorifer, ce fac?', /^\/mydarrin-produs\.html\?slug=[a-z-]+&type=(serviciu|material)$/, null],
              ['Vreau o instalație electrică', /(^\/mydarrin-produs\.html\?slug=[a-z-]+&type=serviciu$)|openAI=true/, null],
            ];
            for (const [intrebare, asteptat, destinatie] of RAPIDE) {
              const pg = await pagina(ctx, pag);
              await pg.evaluate(() => toggleDaiChat());
              const buton = await pg.$(`#dai-chat-quickq button[onclick="daiQuickQuestion('${intrebare}')"]`);
              adevarat(buton, 'lipsește butonul ' + intrebare);
              await buton.click();
              await pg.waitForSelector('[data-dai-rezultate] a');
              const href = await pg.$eval('[data-dai-rezultate] a', (a) => a.getAttribute('href'));
              adevarat(asteptat.test(href), `${intrebare} → ${href}`);
              if (destinatie) {
                await Promise.all([pg.waitForNavigation({ waitUntil: 'load' }), pg.click('[data-dai-rezultate] a')]);
                egal(new URL(pg.url()).pathname, destinatie, 'adresa după clic');
                const titlu = await pg.title();
                adevarat(titlu && !/404|not found/i.test(titlu), 'pagina destinație nu s-a deschis: ' + titlu);
              }
              egal(pg.erori, [], 'erori JS');
              await pg.close();
            }
          });
        }

        await test(`${lang} ${latime}: widget-ul Darrin AI caută prin /api/public/catalog (interceptat)`, async () => {
          const pg = await pagina(ctx, '/mydarrin-cum-functioneaza.html');
          egal(await pg.evaluate(() => typeof PRODUCTS_DB), 'undefined', 'PRODUCTS_DB pe pagină');
          const inainte = APELURI.catalog;
          await pg.evaluate(() => toggleDaiChat());
          await pg.fill('#dai-chat-input', lang === 'ro' ? 'Curge un calorifer' : 'Leaking radiator');
          await pg.evaluate(() => daiSendMessage());
          await pg.waitForSelector('[data-dai-rezultate] a');
          adevarat(APELURI.catalog > inainte, 'nu s-a cerut /api/public/catalog');
          const linkuri = await pg.$$eval('[data-dai-rezultate] a', (e) => e.map((a) => a.getAttribute('href')));
          adevarat(linkuri.length >= 1 && linkuri.length <= 3, 'între 1 și 3 rezultate');
          adevarat(linkuri.every((h) => /^\/mydarrin-produs\.html\?slug=(inlocuire-calorifer|reparatie-garnituri-calorifer|mat-calorifer-otel)&type=(serviciu|material)$/.test(h)), 'rezultate din catalogul simulat: ' + linkuri.join(', '));
          adevarat(!linkuri.some((h) => /ciorna|retras/.test(h)), 'rezultat nepublicat');
          await captura(pg, `widget-${lang}-${latime}-dupa`, '#dai-chat-panel');
          // Fără rezultat: trimitere spre Darrin AI din catalog, fără cifre inventate.
          await pg.fill('#dai-chat-input', 'xyzqwerty');
          await pg.evaluate(() => daiSendMessage());
          await pg.waitForFunction(() => [...document.querySelectorAll('[data-dai-rezultate] a')].some((a) => a.href.includes('openAI=true')));
          const text = await pg.$eval('#dai-chat-messages', (e) => e.textContent);
          adevarat(!/avem \d+ servicii|we have \d+ services/i.test(text), 'cifră inventată în widget');
          // Prețurile așteptate: cele din răspunsul /api/public/catalog pentru rezultatele afișate.
          const rc = raspuns();
          await apiCatalog(cerere({ metoda: 'GET', query: { tara: 'RO', lang } }), rc);
          const peSlug = Object.fromEntries([...rc.corp.servicii, ...rc.corp.materiale, ...rc.corp.inchirieri].map((p) => [p.id_serviciu, p.pret_de_la]));
          const afisate = linkuri.map((h) => peSlug[decodeURIComponent(h.match(/slug=([^&]+)/)[1])]);
          await verificaPreturi(pg, '#dai-chat-messages', afisate);
          egal(pg.erori, [], 'erori JS');
          await pg.close();
        });

        // Capturile „înainte”: paginile din main, cu răspunsul vechi al API-ului.
        if (CAPTURI) {
          VECHI.activ = true;
          for (const [f, nume, pas, el] of [
            ['mydarrin-catalog.html', 'catalog-ai', async (pg) => { await pg.evaluate(() => openConsultanta()); await completeazaModal(pg, 'Curge un calorifer'); await pg.evaluate(() => sendToAI()); await pg.waitForSelector('#rec-services div'); }, '#ai-result'],
            ['mydarrin-creeaza-deviz.html', 'creeaza-deviz', async (pg) => { await pg.fill('#dv-text', 'Curge un calorifer'); await pg.click('#dv-submit-btn'); await pg.waitForSelector('#dv-rezultat', { state: 'visible' }); }, '#dv-rezultat'],
            ['mydarrin-cum-functioneaza.html', 'widget', async (pg) => { await pg.evaluate(() => toggleDaiChat()); await pg.fill('#dai-chat-input', 'Curge un calorifer'); await pg.evaluate(() => daiSendMessage()); await pg.waitForTimeout(1200); }, '#dai-chat-panel'],
          ]) {
            const vechi = dinMain(f);
            if (!vechi) continue;
            await ctx.route(new RegExp('/' + f.replace('.', '\\.') + '(\\?|$)'), (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: vechi }));
            const pg = await pagina(ctx, '/' + f);
            try { await pas(pg); await captura(pg, `${nume}-${lang}-${latime}-inainte`, el); } catch (e) { console.log(`    (captura „înainte” ${nume}: ${e.message.slice(0, 80)})`); }
            await pg.close();
            await ctx.unroute(new RegExp('/' + f.replace('.', '\\.') + '(\\?|$)'));
          }
          VECHI.activ = false;
        }
        await ctx.close();
      }
    }

    // Deviz Engine (intern, doar română): capturi înainte / după ale exemplului.
    if (CAPTURI) {
      const ctx = await context(browser, 1366, 'ro');
      for (const [nume, continut] of [['inainte', dinMain('mydarrin-deviz-engine.html')], ['dupa', fs.readFileSync(path.join(RADACINA, 'mydarrin-deviz-engine.html'), 'utf8')]]) {
        if (!continut) continue;
        await ctx.route(/\/mydarrin-deviz-engine\.html/, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: continut }));
        // Pagina internă cere cont de admin: fără sesiune ar pleca spre site-ul public.
        // Pentru captură, plecarea se blochează și ecranul „Se verifică accesul…” se scoate.
        const pg = await ctx.newPage();
        await pg.addInitScript(() => {
          const poarta = { enforceAdminBarrier: async () => true };
          Object.defineProperty(window, 'MyDarrinAuth', { get: () => poarta, set: () => {}, configurable: false });
        });
        await pg.goto(baza + '/mydarrin-deviz-engine.html', { waitUntil: 'load' }).catch(() => {});
        await pg.waitForTimeout(1500);
        await pg.evaluate(() => document.getElementById('auth-gate-overlay')?.remove());
        const grila = await pg.evaluateHandle(() => {
          const t = [...document.querySelectorAll('div')].find((d) => d.textContent.trim().startsWith('📊 Exemplu: înlocuire calorifer'));
          return t && t.closest('.grid');
        });
        const el = grila.asElement();
        if (el) await el.screenshot({ path: path.join(CAPTURI, `deviz-engine-exemplu-${nume}.png`) }).catch(() => {});
        const formula = await pg.evaluateHandle(() => [...document.querySelectorAll('.formula-line')][0]?.parentElement);
        if (formula.asElement()) await formula.asElement().screenshot({ path: path.join(CAPTURI, `deviz-engine-formula-${nume}.png`) }).catch(() => {});
        await pg.close();
        await ctx.unroute(/\/mydarrin-deviz-engine\.html/);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

(async () => {
  await testeValidare();
  await testeEndpoint();
  await testeStatice();
  if (!process.env.FARA_BROWSER) await testeBrowser();
  console.log(`\n${ok} trecute, ${esec} eșuate.`);
  process.exit(esec ? 1 : 0);
})();
