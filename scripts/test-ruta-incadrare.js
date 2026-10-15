// scripts/test-ruta-incadrare.js
// Teste pentru regula de încadrare (pasul 8, 15 oct. 2026): motorul
// (lib/ruta-incadrare.js), rețeta propusă (lib/propune-reteta.js) și API-ul
// (api/admin/ruta-incadrare.js, api/admin/catalog.js) peste un Supabase
// simulat în memorie. Fără rețea, fără dependențe.
//
// Rulare: node scripts/test-ruta-incadrare.js
// Datele simulate urmează datele reale din 15 oct. 2026 (clase NACE, ESCO,
// Uniclass, servicii, articole); nodurile de meniu sunt cele propuse pentru
// pasul 10 (azi nu există în categorii).

const path = require('path');
const RADACINA = path.join(__dirname, '..');

// ── Supabase simulat ──────────────────────────────────────────────────────
const DB = { tabele: {}, coloane: {}, lipsa: new Set(), seq: 1000 };
function eroare(code, message) { return { code, message }; }
function interogare(tabel) {
  const st = { tabel, op: 'select', filtre: [], ordine: [], interval: null, limita: null, coloane: '*', date: null, single: false, maybe: false, intoarce: false };
  const lipsaTabel = () => DB.lipsa.has(tabel) || !DB.tabele[tabel];
  const coloaneNecunoscute = (lista) => {
    const sch = DB.coloane[tabel];
    if (!sch) return [];
    return lista.filter((c) => c !== '*' && !sch.includes(c));
  };
  const b = {
    select(c = '*') { if (st.op === 'select') st.coloane = c; else st.intoarce = true; return b; },
    insert(d) { st.op = 'insert'; st.date = Array.isArray(d) ? d : [d]; return b; },
    update(d) { st.op = 'update'; st.date = d; return b; },
    delete() { st.op = 'delete'; return b; },
    eq(k, v) { st.filtre.push((r) => r[k] === v); return b; },
    neq(k, v) { st.filtre.push((r) => r[k] !== v); return b; },
    in(k, v) { st.filtre.push((r) => v.includes(r[k])); return b; },
    like(k, v) { const re = new RegExp('^' + v.replace(/[.]/g, '\\.').replace(/%/g, '.*') + '$'); st.filtre.push((r) => re.test(String(r[k] ?? ''))); return b; },
    is(k, v) { st.filtre.push((r) => (r[k] ?? null) === v); return b; },
    not(k, op, v) { st.filtre.push((r) => !(op === 'is' ? (r[k] ?? null) === v : r[k] === v)); return b; },
    order(k, o = {}) { st.ordine.push([k, o.ascending !== false]); return b; },
    limit(n) { st.limita = n; return b; },
    range(a, z) { st.interval = [a, z]; return b; },
    maybeSingle() { st.single = true; st.maybe = true; return b; },
    single() { st.single = true; return b; },
    then(ok, ko) { return Promise.resolve(executa()).then(ok, ko); },
  };
  function executa() {
    if (lipsaTabel()) return { data: null, error: eroare('42P01', `relation "public.${tabel}" does not exist`) };
    const rows = DB.tabele[tabel];
    if (st.op === 'insert') {
      const necunoscute = coloaneNecunoscute([...new Set(st.date.flatMap((d) => Object.keys(d)))]);
      if (necunoscute.length) return { data: null, error: eroare('PGRST204', `Could not find the '${necunoscute[0]}' column of '${tabel}' in the schema cache`) };
      const noi = st.date.map((d) => ({ id: d.id || `id-${++DB.seq}`, ...d }));
      rows.push(...noi);
      return { data: st.single ? noi[0] : noi, error: null };
    }
    let rez = rows.filter((r) => st.filtre.every((f) => f(r)));
    if (st.op === 'update') {
      const necunoscute = coloaneNecunoscute(Object.keys(st.date));
      if (necunoscute.length) return { data: null, error: eroare('PGRST204', `Could not find the '${necunoscute[0]}' column of '${tabel}' in the schema cache`) };
      rez.forEach((r) => Object.assign(r, st.date));
      return { data: st.single ? rez[0] || null : rez, error: null };
    }
    if (st.op === 'delete') {
      DB.tabele[tabel] = rows.filter((r) => !rez.includes(r));
      return { data: null, error: null };
    }
    const cerute = st.coloane === '*' ? [] : st.coloane.split(',').map((c) => c.trim()).filter((c) => !c.includes('('));
    const necunoscute = coloaneNecunoscute(cerute);
    if (necunoscute.length) return { data: null, error: eroare('42703', `column ${tabel}.${necunoscute[0]} does not exist`) };
    for (const [k, asc] of st.ordine.slice().reverse()) rez = rez.slice().sort((x, y) => String(x[k] ?? '').localeCompare(String(y[k] ?? '')) * (asc ? 1 : -1));
    if (st.interval) rez = rez.slice(st.interval[0], st.interval[1] + 1);
    if (st.limita != null) rez = rez.slice(0, st.limita);
    if (st.single) {
      if (!rez.length && !st.maybe) return { data: null, error: eroare('PGRST116', 'no rows') };
      return { data: rez[0] || null, error: null };
    }
    return { data: rez, error: null };
  }
  return b;
}
const UTILIZATORI = { 'token-superadmin': { id: 'u-super', email: 's@example.com' }, 'token-admin': { id: 'u-admin', email: 'a@example.com' }, 'token-admin-f': { id: 'u-admin-f', email: 'f@example.com' } };
const supabaseAdmin = {
  from: interogare,
  auth: { getUser: async (t) => (UTILIZATORI[t] ? { data: { user: UTILIZATORI[t] }, error: null } : { data: null, error: eroare('401', 'invalid') }) },
};
const p = require.resolve(path.join(RADACINA, 'lib/supabaseAdmin.js'));
require.cache[p] = { id: p, filename: p, loaded: true, exports: { supabaseAdmin } };

const R = require(path.join(RADACINA, 'lib/ruta-incadrare.js'));
const { propuneReteta, verificaAprobare, planAprobare } = require(path.join(RADACINA, 'lib/propune-reteta.js'));

// ── Date de referință (după datele reale din 15 oct. 2026) ────────────────
const CAPITOLE = [
  { cod: 'F', titlu_ro: 'Construcții și renovări', titlu_en: 'Construction and renovation', sectiuni_nace: ['F'], diviziuni_nace: ['41', '42', '43'], clase_nace: [], tip_partener: 'servicii', discount_permis: false, ordine: 1, activ: true },
  { cod: 'N', titlu_ro: 'Proiectare și servicii tehnice', titlu_en: 'Design and technical services', sectiuni_nace: [], diviziuni_nace: ['71'], clase_nace: ['74.13'], tip_partener: 'servicii', discount_permis: false, ordine: 2, activ: true },
  { cod: 'O81', titlu_ro: 'Curățenie și spații verzi', titlu_en: 'Cleaning and green spaces', sectiuni_nace: [], diviziuni_nace: ['81'], clase_nace: [], tip_partener: 'servicii', discount_permis: false, ordine: 3, activ: true },
  { cod: 'T', titlu_ro: 'Reparații pentru casă, auto și moto', titlu_en: 'Home, car and motorcycle repairs', sectiuni_nace: [], diviziuni_nace: ['95'], clase_nace: [], tip_partener: 'servicii', discount_permis: false, ordine: 4, activ: true },
  { cod: 'AGR', titlu_ro: 'Servicii agricole', titlu_en: 'Agricultural services', sectiuni_nace: [], diviziuni_nace: [], clase_nace: ['01.61', '33.12', '77.31'], tip_partener: 'servicii', discount_permis: false, ordine: 5, activ: true },
  { cod: 'H', titlu_ro: 'Transport, mutări și curierat', titlu_en: 'Transport, removals and courier', sectiuni_nace: [], diviziuni_nace: ['49', '53'], clase_nace: [], tip_partener: 'curier', discount_permis: false, ordine: 6, activ: true },
  { cod: 'E', titlu_ro: 'Moloz și deșeuri', titlu_en: 'Rubble and waste', sectiuni_nace: [], diviziuni_nace: ['38'], clase_nace: [], tip_partener: 'servicii', discount_permis: false, ordine: 7, activ: true },
  { cod: 'O77', titlu_ro: 'Închirieri', titlu_en: 'Rentals', sectiuni_nace: [], diviziuni_nace: ['77'], clase_nace: [], tip_partener: 'inchirieri', discount_permis: true, ordine: 8, activ: true },
  { cod: 'G', titlu_ro: 'Aprovizionare materiale', titlu_en: 'Material supplies', sectiuni_nace: [], diviziuni_nace: ['46', '47'], clase_nace: ['23.63'], tip_partener: 'materiale', discount_permis: true, ordine: 9, activ: true },
  { cod: 'L', titlu_ro: 'Asigurări', titlu_en: 'Insurance', sectiuni_nace: [], diviziuni_nace: ['65', '66'], clase_nace: [], tip_partener: 'asigurari', discount_permis: true, ordine: 10, activ: true },
  { cod: 'O78', titlu_ro: 'Personal calificat', titlu_en: 'Skilled staff', sectiuni_nace: [], diviziuni_nace: ['78'], clase_nace: [], tip_partener: 'personal', discount_permis: false, ordine: 11, activ: true },
];
const NACE_CLASE = ['01.61', '23.63', '33.12', '42.22', '43.21', '43.22', '43.24', '53.20', '71.12', '74.13', '77.11', '77.31', '81.21', '95.21'];
const NODURI = {
  n4322: { id: 'n4322', title: 'Instalații sanitare, termice și climatizare', title_en: 'Plumbing, heating and air conditioning', nace_clasa: '43.22', capitol_cod: 'F', autorizare_necesara: null, activ: true },
  n4321: { id: 'n4321', title: 'Instalații electrice', title_en: 'Electrical installations', nace_clasa: '43.21', capitol_cod: 'F', autorizare_necesara: 'ANRE', activ: true },
  n4222: { id: 'n4222', title: 'Proiecte utilitare pentru energie electrică', title_en: 'Utility projects for electricity', nace_clasa: '42.22', capitol_cod: 'F', autorizare_necesara: 'ANRE', activ: true },
  n4324: { id: 'n4324', title: 'Paratrăsnete și alte instalații', title_en: 'Lightning protection and other installations', nace_clasa: '43.24', capitol_cod: 'F', autorizare_necesara: null, activ: true },
  n3312: { id: 'n3312', title: 'Reparații utilaje agricole', title_en: 'Agricultural machinery repair', nace_clasa: '33.12', capitol_cod: 'AGR', autorizare_necesara: null, activ: true },
  n5320: { id: 'n5320', title: 'Curierat', title_en: 'Courier', nace_clasa: '53.20', capitol_cod: 'H', autorizare_necesara: null, activ: true },
};
const ESCO = {
  '7127.1': { cod_esco: '7127.1', nace_code: '4322' },
  '7411.1.4': { cod_esco: '7411.1.4', nace_code: '4321' },
  '7411.1': { cod_esco: '7411.1', nace_code: '3314' },
  '7411': { cod_esco: '7411', nace_code: 'F 43.22' },
  '7233.1': { cod_esco: '7233.1', nace_code: '3312' },
  '2142.1': { cod_esco: '2142.1', nace_code: '71.12' },
  '9621.1': { cod_esco: '9621.1', nace_code: '53.20' },
};
// uniclass_codes: doar codurile reale (27 azi); Ac_70_65, Ac_45_10_14 și codurile Pr_ ale fotovoltaicelor lipsesc.
const UNICLASS = new Map(['Ac_10_40_11', 'Ac_10_40_27', 'Ac_10_40_60', 'Ac_10_40_63', 'Ac_10_40_67', 'Ac_32_10_38', 'Pr_70_60_10_14', 'Pr_70_60_36_73'].map((c) => [c, { code: c, is_active: true }]));

const CATALOG = [
  { id: 'cal-reparatie', titlu: 'Reparație / Recondiționare calorifer', nace: 'F 43.22', cod_esco: '7127.1', cod_uniclass: 'Ac_45_50_14', nod_id: null, niveluri: [{ nivel: 'Bronze' }], articole: [{ articol_id: 15539, simbol: 'RPIB03A', indicator_id: 'RPIB' }] },
  { id: 'cal-inlocuire', titlu: 'Înlocuire calorifer defect', nace: 'F 43.22', cod_esco: '7127.1', cod_uniclass: 'Ac_45_10_14', niveluri: [], articole: [] },
  { id: 'cal-montaj', titlu: 'Montaj calorifer pe instalație nouă', nace: 'F 43.22', cod_esco: '7127.1', niveluri: [], articole: [] },
  { id: 'cal-mentenanta', titlu: 'Mentenanță / Verificare calorifer', nace: 'F 43.22', cod_esco: '7127.1', niveluri: [], articole: [] },
  { id: 'cal-garnituri', titlu: 'Reparație garnituri & probă presiune calorifer', nace: 'F 43.22', niveluri: [], articole: [] },
  { id: 'inlocuire-calorifer', titlu: 'Înlocuire calorifer', nace: 'F 43.22', niveluri: [], articole: [] },
  { id: 'tel-montaj-nou', titlu: 'Montaj tablou electric pe instalație nouă', nace: 'F 43.21', cod_esco: '7131', cod_uniclass: 'Ac_70_30_14', niveluri: [{ nivel: 'Bronze' }], articole: [{ articol_id: 4212, simbol: 'EF04A1', indicator_id: 'EF', denumire_articol: 'Tablou electric, capsulat, compus din cutii', unitate_masura: 'buc' }] },
  { id: 'testare-instalatie-electrica', titlu: 'Testare & verificare instalație electrică', nace: 'F 43.21', niveluri: [{ nivel: 'Bronze' }], articole: [{ articol_id: 4350, simbol: 'EH05B1', indicator_id: 'EH', denumire_articol: 'Încercarea tablourilor de distribuție', unitate_masura: 'buc' }] },
  { id: 'tel-inlocuire', titlu: 'Înlocuire tablou electric complet', nace: 'F 43.21', cod_esco: '7131', niveluri: [], articole: [] },
  { id: 'tel-mentenanta', titlu: 'Mentenanță tablou electric — verificare anuală', nace: 'F 43.21', cod_esco: '7131', niveluri: [], articole: [] },
  { id: 'montaj-tablou-electric', titlu: 'Montaj tablou electric nou', nace: 'F 43.21', niveluri: [], articole: [] },
];
const INDICATORI = [
  { indicator_id: 'EE', denumire_indicator: 'Corpuri de iluminat și accesorii', nace_cod: 'F 43.21', uniclass_ac_code: 'Ac_10_40_27' },
  { indicator_id: 'EF', denumire_indicator: 'Tablouri electrice și accesorii', nace_cod: 'F 43.21', uniclass_ac_code: 'Ac_10_40_27' },
  { indicator_id: 'EA', denumire_indicator: 'E — Tuburi, țevi de protecție și accesorii', nace_cod: null },
  { indicator_id: 'EC', denumire_indicator: 'E — Cabluri electrice și accesorii', nace_cod: null },
  { indicator_id: 'EH', denumire_indicator: 'E — Probe și verificări', nace_cod: null },
  { indicator_id: 'EG', denumire_indicator: 'E — Instalații de paratrăsnete', nace_cod: null },
  { indicator_id: 'RPIB', denumire_indicator: 'RPI — Corpuri de incalzire si accesorii', nace_cod: null },
];
const ARTICOLE_PE_INDICATOR = {
  EF: [{ articol_id: 4212, simbol: 'EF04A1', varianta: 1, denumire_articol: 'Tablou electric, capsulat, compus din cutii', unitate_masura: 'buc' }],
  EC: [{ articol_id: 4700, simbol: 'EC01A1', varianta: 1, denumire_articol: 'Cablu cu conductoare de cupru, montat îngropat', unitate_masura: 'm' }, { articol_id: 4701, simbol: 'EC02A1', varianta: 1, denumire_articol: 'Cablu montat pe stelaje', unitate_masura: 'm' }],
  EA: [{ articol_id: 4100, simbol: 'EA01A1', varianta: 1, denumire_articol: 'Tub de protecție din PVC montat aparent', unitate_masura: 'm' }],
  EH: [{ articol_id: 4350, simbol: 'EH05B1', varianta: 1, denumire_articol: 'Încercarea tablourilor de distribuție', unitate_masura: 'buc' }],
  EE: [{ articol_id: 4500, simbol: 'EE01A1', varianta: 1, denumire_articol: 'Corp de iluminat fluorescent', unitate_masura: 'buc' }],
};
const MANOPERA = [
  { resursa_id: 5, cod_resursa: '11511', denumire_resursa: 'Instalator electrician cat. I', unitate_masura: 'ora', esco_cod: '7411.1' },
  { resursa_id: 1645, cod_resursa: '20000140', denumire_resursa: 'Instalator electrician', unitate_masura: 'ora', esco_cod: '7411.1' },
  { resursa_id: 1550, cod_resursa: '20000150', denumire_resursa: 'Instalator electrician', unitate_masura: 'ora', esco_cod: '7411.1' },
  { resursa_id: 836, cod_resursa: '11541', denumire_resursa: 'Instalator electrician categoria a IV-a', unitate_masura: 'ora', esco_cod: '7411.1' },
];
const ref = (extra = {}) => ({ capitole: CAPITOLE, naceClase: NACE_CLASE, catalog: CATALOG, ...extra });
const capitolNod = (n) => CAPITOLE.find((c) => c.cod === n.capitol_cod);

// ── Raportare ─────────────────────────────────────────────────────────────
let trecute = 0;
const picate = [];
function verifica(nume, conditie, detaliu) {
  if (conditie) { trecute++; console.log(`  ✓ ${nume}`); } else { picate.push(nume); console.log(`  ✗ ${nume}${detaliu ? ' — ' + detaliu : ''}`); }
}
const coduri = (lista) => lista.map((x) => x.cod);
function afiseaza(r) {
  console.log(`    ruta: ${[r.ruta.sectiune, r.ruta.diviziune, r.ruta.grupa, r.ruta.clasa, r.ruta.capitol, r.ruta.nod, r.ruta.esco, r.ruta.uniclass].map((x) => x || '—').join(' → ')}`);
  console.log(`    erori: ${coduri(r.erori).join(', ') || '—'} · avertismente: ${coduri(r.avertismente).join(', ') || '—'}`);
}

async function main() {
  // ── 0. normalizeazaNace / capitolPentruNace ─────────────────────────────
  console.log('\n0. normalizeazaNace și capitolPentruNace');
  verifica('„F 43.22”, „4322”, „43.22” → 43.22', ['F 43.22', '4322', '43.22'].every((x) => R.normalizeazaNace(x) === '43.22'));
  verifica('„43.2”, „43”, „NACE 2.1”, null → null', ['43.2', '43', 'NACE 2.1', null].every((x) => R.normalizeazaNace(x) === null));
  verifica('77.31 → AGR (clasa explicită bate diviziunea 77)', R.capitolPentruNace('77.31', CAPITOLE) === 'AGR');
  verifica('77.11 → O77', R.capitolPentruNace('77.11', CAPITOLE) === 'O77');
  verifica('74.13 → N, 71.12 → N, 23.63 → G, 53.20 → H', R.capitolPentruNace('74.13', CAPITOLE) === 'N' && R.capitolPentruNace('71.12', CAPITOLE) === 'N' && R.capitolPentruNace('23.63', CAPITOLE) === 'G' && R.capitolPentruNace('53.20', CAPITOLE) === 'H');
  verifica('tipCodEsco: 7126.8 esco, 7411 isco, 723101 cor, COR-712902 cor', R.tipCodEsco('7126.8') === 'esco' && R.tipCodEsco('7411') === 'isco' && R.tipCodEsco('723101') === 'cor' && R.tipCodEsco('COR-712902') === 'cor');

  // ── 1. Reparat calorifer ────────────────────────────────────────────────
  console.log('\n1. „Reparat calorifer” (există „Reparație / Recondiționare calorifer”, 43.22, RPIB03A)');
  const nou1 = { titlu: 'Reparat calorifer', nace: 'F 43.22', cod_esco: '7127.1' };
  const asem1 = R.serviciiAsemanatoare(nou1, CATALOG);
  console.log(`    asemănătoare: ${asem1.slice(0, 3).map((a) => `${a.serviciu.titlu} [${a.motiv}, ${a.asemanare_titlu}]`).join(' | ')}`);
  verifica('cauta_asemanatoare: primul e „Reparație / Recondiționare calorifer”', asem1[0]?.serviciu.id === 'cal-reparatie');
  verifica('se poate copia rețeta RPIB03A', asem1[0]?.de_copiat.articole.some((a) => a.simbol === 'RPIB03A'));
  const r1 = R.valideazaRuta({
    serviciu: { id: 'nou-1', ...nou1, cod_uniclass: 'Ac_10_40_63', categorie: 'servicii' },
    nod: NODURI.n4322, capitol: capitolNod(NODURI.n4322), esco: ESCO['7127.1'], uniclass: UNICLASS.get('Ac_10_40_63'),
    articole: [{ articol_id: 99001, simbol: 'RPIB03A', indicator_id: 'RPIB', indicator_nace: null }],
    preturi: [{ nivel: 'Bronze', are_pret_activ: false, reteta_calculabila: true }],
    traduceri: { titlu_ro: 'Reparat calorifer', titlu_en: 'Radiator repair' },
    ref: ref({ sectiune: 'F' }),
  });
  afiseaza(r1);
  verifica('ruta F → 43 → 43.2 → 43.22 → F → nod sanitar/termic → 7127.1 → Ac_10_40_63', r1.ruta.diviziune === '43' && r1.ruta.grupa === '43.2' && r1.ruta.clasa === '43.22' && r1.ruta.capitol === 'F');
  verifica('validă: 0 erori', r1.ok && r1.erori.length === 0, coduri(r1.erori).join(','));
  verifica('A4: titlu asemănător cu serviciul existent (posibil duplicat)', coduri(r1.avertismente).includes('A4'));

  // ── 2. Fotovoltaice ─────────────────────────────────────────────────────
  console.log('\n2. „Montaj panouri fotovoltaice cu instalație și punere în funcțiune” (fără rețetă)');
  const nou2 = { id: 'nou-2', titlu: 'Montaj panouri fotovoltaice cu instalație și punere în funcțiune', nace: '43.21', cod_esco: '7411.1.4', cod_uniclass: 'Ac_10_40_27', categorie: 'servicii' };
  const asem2 = R.serviciiAsemanatoare(nou2, CATALOG);
  console.log(`    asemănătoare: ${asem2.slice(0, 4).map((a) => `${a.serviciu.titlu} [${a.motiv}, ${a.asemanare_titlu}]`).join(' | ')}`);
  const top3 = asem2.slice(0, 3).map((a) => a.serviciu.id);
  verifica('sugerează „Montaj tablou electric pe instalație nouă” (EF04A1) primul', asem2[0]?.serviciu.id === 'tel-montaj-nou');
  verifica('sugerează „Testare & verificare instalație electrică” (EH05B1) în primele 3', top3.includes('testare-instalatie-electrica'));
  const r2 = R.valideazaRuta({
    serviciu: nou2, nod: NODURI.n4321, capitol: capitolNod(NODURI.n4321), esco: ESCO['7411.1.4'], uniclass: UNICLASS.get('Ac_10_40_27'),
    articole: [], preturi: [{ nivel: 'Bronze', are_pret_activ: false, reteta_calculabila: false, reteta_propusa: true }],
    traduceri: { titlu_ro: nou2.titlu, titlu_en: 'Installation of photovoltaic panels with wiring and commissioning' },
    ref: ref({ sectiune: 'F' }),
  });
  afiseaza(r2);
  verifica('ruta: 43.21 → F → Instalații electrice → 7411.1.4 → Ac_10_40_27', r2.ruta.clasa === '43.21' && r2.ruta.capitol === 'F' && r2.ruta.nod === 'n4321');
  verifica('A3: autorizare ANRE', coduri(r2.avertismente).includes('A3'));
  verifica('E7: fără preț cât timp rețeta e doar propusă', coduri(r2.erori).includes('E7') && /propusă/.test(r2.erori.find((e) => e.cod === 'E7').mesaj_ro));
  verifica('fără E1–E6, E8, E9', coduri(r2.erori).every((c) => c === 'E7'));
  const r2b = R.valideazaRuta({
    serviciu: { ...nou2, titlu: 'Parc fotovoltaic la sol', nace: '42.22' }, nod: NODURI.n4321, capitol: capitolNod(NODURI.n4321),
    esco: ESCO['7411.1.4'], uniclass: UNICLASS.get('Ac_10_40_27'), preturi: [{ are_pret_activ: true }],
    traduceri: { titlu_ro: 'Parc fotovoltaic la sol', titlu_en: 'Ground-mounted solar farm' }, ref: ref(),
  });
  afiseaza(r2b);
  verifica('parc fotovoltaic la sol (42.22) sub nodul 43.21 → E2', coduri(r2b.erori).includes('E2'));
  const r2c = R.valideazaRuta({
    serviciu: { ...nou2, titlu: 'Parc fotovoltaic la sol', nace: '42.22' }, nod: NODURI.n4222, capitol: capitolNod(NODURI.n4222),
    esco: ESCO['7411.1.4'], uniclass: UNICLASS.get('Ac_10_40_27'), preturi: [{ are_pret_activ: true }],
    traduceri: { titlu_ro: 'Parc fotovoltaic la sol', titlu_en: 'Ground-mounted solar farm' }, ref: ref(),
  });
  verifica('parc fotovoltaic la sol sub nodul 42.22 → fără E2 / E3', !coduri(r2c.erori).includes('E2') && !coduri(r2c.erori).includes('E3'));

  // ── 3. Reparații utilaje agricole ───────────────────────────────────────
  console.log('\n3. Reparații utilaje agricole (33.12)');
  verifica('33.12 → AGR, nu O81', R.capitolPentruNace('33.12', CAPITOLE) === 'AGR');
  const r3 = R.valideazaRuta({
    serviciu: { titlu: 'Reparație tractor la domiciliu', nace: '33.12', cod_esco: '7233.1', cod_uniclass: 'Ac_10_40_27', categorie: 'servicii' },
    nod: NODURI.n3312, capitol: capitolNod(NODURI.n3312), esco: ESCO['7233.1'], uniclass: UNICLASS.get('Ac_10_40_27'),
    preturi: [{ are_pret_activ: true }], traduceri: { titlu_ro: 'Reparație tractor la domiciliu', titlu_en: 'On-site tractor repair' }, ref: ref(),
  });
  afiseaza(r3);
  verifica('nodul AGR: fără E2 / E3', !coduri(r3.erori).includes('E2') && !coduri(r3.erori).includes('E3'));

  // ── 4. Erori ────────────────────────────────────────────────────────────
  console.log('\n4. Erori');
  const baza4 = { serviciu: { titlu: 'Montaj calorifer', nace: '43.22', cod_esco: '7127.1', cod_uniclass: 'Ac_10_40_63', categorie: 'servicii' }, nod: NODURI.n4322, capitol: capitolNod(NODURI.n4322), esco: ESCO['7127.1'], uniclass: UNICLASS.get('Ac_10_40_63'), preturi: [{ are_pret_activ: true }], traduceri: { titlu_ro: 'Montaj calorifer', titlu_en: 'Radiator installation' }, ref: ref() };
  const r4a = R.valideazaRuta({ ...baza4, serviciu: { ...baza4.serviciu, cod_esco: '7411' }, esco: ESCO['7411'] });
  verifica('ESCO 7411 (grupă ISCO) → E4', coduri(r4a.erori).includes('E4'), coduri(r4a.erori).join(','));
  const r4b = R.valideazaRuta({ ...baza4, serviciu: { ...baza4.serviciu, cod_uniclass: 'Ac_45_10_14' }, uniclass: UNICLASS.get('Ac_45_10_14') || null });
  verifica('Uniclass Ac_45_10_14 (nu există) → E5', coduri(r4b.erori).includes('E5'));
  const r4c = R.valideazaRuta({ ...baza4, serviciu: { ...baza4.serviciu, cod_uniclass: 'Pr_70_60_36_73' }, uniclass: UNICLASS.get('Pr_70_60_36_73') });
  verifica('serviciu cu Uniclass Pr_ → E5 (tabelul greșit)', coduri(r4c.erori).includes('E5'));
  const r4d = R.valideazaRuta({ ...baza4, serviciu: { ...baza4.serviciu, titlu: 'Proiect instalație termică', nace: '71.12', cod_esco: '2142.1' }, esco: ESCO['2142.1'], traduceri: { titlu_ro: 'Proiect instalație termică', titlu_en: 'Heating system design' } });
  afiseaza(r4d);
  verifica('proiectare 71.12 sub nodul 43.22 → E2 și E3', coduri(r4d.erori).includes('E2') && coduri(r4d.erori).includes('E3'));
  const r4e = R.valideazaRuta({ serviciu: { titlu: 'Livrare colet în oraș', nace: '53.20', cod_esco: '9621.1', cod_uniclass: 'Ac_10_40_27', categorie: 'servicii' }, nod: NODURI.n5320, capitol: capitolNod(NODURI.n5320), esco: ESCO['9621.1'], uniclass: UNICLASS.get('Ac_10_40_27'), preturi: [{ are_pret_activ: true }], traduceri: { titlu_ro: 'Livrare colet în oraș', titlu_en: 'City parcel delivery' }, ref: ref({ discountPct: 10 }) });
  afiseaza(r4e);
  verifica('curier cu discount → E9', coduri(r4e.erori).includes('E9'));
  const r4f = R.valideazaRuta({ ...baza4, traduceri: { titlu_ro: 'Montaj calorifer', titlu_en: '' } });
  verifica('fără titlu EN → E8', coduri(r4f.erori).includes('E8'));
  const r4g = R.valideazaRuta({ ...baza4, tipInregistrare: 'produs', serviciu: { ...baza4.serviciu, cod_uniclass: 'Pr_70_60_36_73' }, uniclass: UNICLASS.get('Pr_70_60_36_73') });
  verifica('produs publicat drept serviciu → E6', coduri(r4g.erori).includes('E6'));
  const r4h = R.valideazaRuta({ ...baza4, serviciu: { ...baza4.serviciu, nace: '43.99' } });
  verifica('clasă NACE inexistentă (43.99 nu e în lista simulată) → E1', coduri(r4h.erori).includes('E1'));

  // ── 5. Paratrăsnete ─────────────────────────────────────────────────────
  console.log('\n5. Paratrăsnete: 43.24, nu 43.21');
  const paratrasnet = { titlu: 'Montaj instalație de paratrăsnet', nace: '43.24', cod_esco: '7411.1', cod_uniclass: 'Ac_10_40_27', categorie: 'servicii' };
  const baza5 = { esco: ESCO['7411.1'], uniclass: UNICLASS.get('Ac_10_40_27'), preturi: [{ are_pret_activ: true }], traduceri: { titlu_ro: paratrasnet.titlu, titlu_en: 'Lightning protection installation' }, ref: ref() };
  const r5a = R.valideazaRuta({ ...baza5, serviciu: paratrasnet, nod: NODURI.n4321, capitol: capitolNod(NODURI.n4321) });
  verifica('paratrăsnet (43.24) sub „Instalații electrice” (43.21) → E2', coduri(r5a.erori).includes('E2'));
  const r5b = R.valideazaRuta({ ...baza5, serviciu: paratrasnet, nod: NODURI.n4324, capitol: capitolNod(NODURI.n4324) });
  afiseaza(r5b);
  verifica('paratrăsnet sub nodul 43.24 → fără E2', !coduri(r5b.erori).includes('E2'));
  verifica('ESCO 7411.1 (nace 3314) → A1, altă diviziune', coduri(r5b.avertismente).includes('A1'));

  // ── 6. Rețeta propusă pentru fotovoltaice ───────────────────────────────
  console.log('\n6. Rețeta propusă pentru fotovoltaice');
  const articoleAsemanatoare = asem2.filter((a) => a.are_reteta)
    .flatMap((a) => CATALOG.find((c) => c.id === a.serviciu.id).articole.map((x) => ({ ...x, serviciu_titlu: a.serviciu.titlu, nivel_potrivire: a.nivel_potrivire })));
  const { linii, rezumat } = propuneReteta({
    serviciu: nou2, ruta: { clasa: '43.21', esco: { cod_esco: '7411.1.4', isco_group: '7411' } }, asemanatoare: asem2,
    ref: { indicatori: INDICATORI, articolePeIndicator: ARTICOLE_PE_INDICATOR, articoleAsemanatoare, resurseManopera: MANOPERA, uniclassCoduri: [...UNICLASS.keys()] },
  });
  linii.forEach((l) => console.log(`    ${l.tip.padEnd(17)} ${String(l.articol_id || l.resursa_id || '').padEnd(6)} ${String(l.denumire_propusa).slice(0, 52).padEnd(52)} ${l.cod_uniclass || ''}`));
  console.log(`    rezumat: ${JSON.stringify(rezumat)}`);
  const simboluri = linii.filter((l) => l.tip === 'articol_existent').map((l) => Object.values(ARTICOLE_PE_INDICATOR).flat().find((a) => a.articol_id === l.articol_id)?.simbol);
  verifica('articole existente EF*, EC*, EA*, EH*', ['EF', 'EC', 'EA', 'EH'].every((p) => simboluri.some((s) => s && s.startsWith(p))), simboluri.join(','));
  verifica('fără EE (corpuri de iluminat: nu se potrivește cu lucrarea)', !simboluri.some((s) => s && s.startsWith('EE')));
  verifica('EF04A1 și EH05B1 vin de la serviciile asemănătoare', simboluri.includes('EF04A1') && simboluri.includes('EH05B1'));
  const manopera = linii.find((l) => l.tip === 'resursa_existenta');
  verifica('manoperă „Instalator electrician” 7411.1 (aceeași grupă ESCO)', manopera && manopera.denumire_propusa === 'Instalator electrician' && manopera.cod_esco === '7411.1');
  const noi = linii.filter((l) => l.tip === 'resursa_noua');
  verifica('resurse noi: module, structură, ancore, protecție c.c., invertor, punere în funcțiune', noi.length === 6
    && ['Pr_60_70_65_63', 'Pr_20_85_32_80', 'Pr_20_29_03_78', 'Pr_65_72_27_62', 'Ac_70_65'].every((c) => noi.some((l) => l.cod_uniclass === c)));
  verifica('nicio linie cu cantitate sau preț (fără date inventate)', linii.every((l) => l.consum_propus === null && !('pret' in l)));
  verifica('fiecare linie are motiv', linii.every((l) => String(l.motiv || '').length > 10));
  verifica('codurile Pr_ lipsă din uniclass_codes sunt semnalate în motiv', noi.filter((l) => l.cod_uniclass && !UNICLASS.has(l.cod_uniclass)).every((l) => /nu e încă în uniclass_codes/.test(l.motiv)));

  const v1 = verificaAprobare(linii);
  verifica('aprobare refuzată cât timp există linii în așteptare', !v1.ok && coduri(v1.erori).includes('LINII_IN_ASTEPTARE'));
  const fara = linii.map((l) => ({ ...l, decizie: 'acceptata' }));
  const v2 = verificaAprobare(fara);
  verifica('aprobare refuzată pentru linii acceptate fără cantitate', !v2.ok && coduri(v2.erori).includes('FARA_CANTITATE'));
  const cantitati = { EF04A1: 1, EC01A1: 20, EA01A1: 20, EH05B1: 1 };
  const complete = linii.map((l) => {
    if (l.tip === 'articol_existent') {
      const s = Object.values(ARTICOLE_PE_INDICATOR).flat().find((a) => a.articol_id === l.articol_id)?.simbol;
      return cantitati[s] ? { ...l, decizie: 'acceptata', consum_propus: cantitati[s] } : { ...l, decizie: 'respinsa' };
    }
    if (l.tip === 'resursa_existenta') return { ...l, decizie: 'acceptata', consum_propus: 8 };
    return l.denumire_propusa === 'Invertor fotovoltaic' ? { ...l, decizie: 'respinsa' } : { ...l, decizie: 'acceptata', consum_propus: 1 };
  });
  const v3 = verificaAprobare(complete);
  verifica('după decizii complete, aprobarea trece', v3.ok, JSON.stringify(v3.erori));
  const plan = planAprobare(complete, { 4212: [{ resursa_id: 5, consum_specific: 2 }, { resursa_id: 900, consum_specific: 1 }], 4350: [{ resursa_id: 5, consum_specific: 0.5 }] });
  console.log(`    plan: existente ${JSON.stringify(plan.existente)} · noi ${plan.noi.length}`);
  verifica('planul adună aceeași resursă din articole și manoperă (5: 2×1 + 0,5×1)', plan.existente.find((r) => r.resursa_id === 5)?.consum_specific === 2.5);
  verifica('planul are 5 resurse noi (invertorul respins nu intră)', plan.noi.length === 5);

  // ── 7. API ──────────────────────────────────────────────────────────────
  console.log('\n7. API: acces, migrare lipsă, ciorna din catalog.js');
  const apel = async (fisier, token, body) => {
    const handler = require(path.join(RADACINA, fisier));
    let status = 200; let out = null;
    const res = { status(s) { status = s; return res; }, json(o) { out = o; return res; }, setHeader() {}, end() { return res; } };
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body, query: {} }, res);
    return { status, out };
  };
  // Baza „azi”: fără migrare (fără meniu_capitole, fără coloanele noi).
  DB.tabele = {
    profiles: [{ id: 'u-super', roles: ['superadmin'] }, { id: 'u-admin', roles: ['admin'] }, { id: 'u-admin-f', roles: ['admin'] }],
    admin_permissions: [{ admin_id: 'u-admin-f', sectiune: 'catalog_servicii', poate_scrie: true, sectiune_specializata: 'F', tara_cod: null }],
    catalog_servicii: [{ id: 's1', id_serviciu: 'cal-reparatie', titlu: 'Reparație / Recondiționare calorifer', categorie: 'servicii', nace: 'F 43.22', status_public: true }],
    nace_sectiuni: [{ litera: 'F', denumire_ro: 'F CONSTRUCȚII', denumire_en: 'F CONSTRUCTION' }],
    nace_reference: NACE_CLASE.map((c) => ({ cod: c, nivel: 'clasa' })),
    audit_log: [],
  };
  DB.coloane = { catalog_servicii: ['id', 'id_serviciu', 'titlu', 'categorie', 'domeniu', 'descriere', 'nace', 'cod_esco', 'cod_uniclass', 'unitate_masura', 'icon', 'sectoare_client', 'categorie_id', 'subcategorie_id', 'status_public', 'creat_de_tip', 'creat_de'] };
  let r = await apel('api/admin/ruta-incadrare.js', 'token-admin', { action: 'pasi' });
  verifica('admin fără rând în admin_permissions → 403', r.status === 403, `${r.status} ${JSON.stringify(r.out)}`);
  r = await apel('api/admin/ruta-incadrare.js', 'token-invalid', { action: 'pasi' });
  verifica('fără sesiune → 401', r.status === 401);
  r = await apel('api/admin/ruta-incadrare.js', 'token-superadmin', { action: 'pasi', clasa: '43.22' });
  verifica('pasi fără migrare → 409 „Migrarea ruta_incadrare nu e aplicată”', r.status === 409 && r.out.error === 'Migrarea ruta_incadrare nu e aplicată.' && r.out.error_en === 'The ruta_incadrare migration is not applied.', `${r.status} ${JSON.stringify(r.out)}`);
  r = await apel('api/admin/ruta-incadrare.js', 'token-admin-f', { action: 'valideaza', serviciu_id: 's1' });
  verifica('valideaza fără migrare → 409, nu 500', r.status === 409 && r.out.cod === 'MIGRARE_NEAPLICATA', `${r.status} ${JSON.stringify(r.out)}`);
  r = await apel('api/admin/catalog.js', 'token-superadmin', { action: 'creeaza_serviciu', id_serviciu: 'test-azi', categorie: 'servicii', domeniu: 'Test', titlu: 'Serviciu test' });
  const creatAzi = DB.tabele.catalog_servicii.find((s) => s.id_serviciu === 'test-azi');
  verifica('catalog.js fără coloana stare: serviciul e public, ca azi', r.status === 200 && creatAzi?.status_public === true && !r.out.stare, `${r.status} ${JSON.stringify(r.out)}`);

  // După migrare: tabelele și coloanele noi există.
  DB.coloane.catalog_servicii.push('nod_id', 'stare', 'creat_din_serviciu_id', 'ruta_validata_la', 'ruta_rezultat');
  DB.tabele.meniu_capitole = CAPITOLE;
  DB.tabele.categorii = Object.values(NODURI);
  DB.tabele.competente_esco = Object.values(ESCO).map((e) => ({ ...e, tip_cod: R.tipCodEsco(e.cod_esco), denumire: e.cod_esco, denumire_en: e.cod_esco }));
  DB.tabele.uniclass_codes = [...UNICLASS.values()].map((u) => ({ ...u, title_ro: u.code, title_en: u.code, nace_asociat: null }));
  DB.tabele.devize_indicatoare = INDICATORI;
  DB.tabele.nace_reference.push({ cod: '43', nivel: 'diviziune', cod_parinte: 'F' }, { cod: '43.2', nivel: 'clasa', cod_parinte: '43' });
  r = await apel('api/admin/catalog.js', 'token-superadmin', { action: 'creeaza_serviciu', id_serviciu: 'test-dupa', categorie: 'servicii', domeniu: 'Test', titlu: 'Serviciu test 2' });
  const creatDupa = DB.tabele.catalog_servicii.find((s) => s.id_serviciu === 'test-dupa');
  verifica('catalog.js după migrare: ciornă (stare = ciorna, status_public = false), fără notificări', r.status === 200 && creatDupa?.stare === 'ciorna' && creatDupa?.status_public === false && r.out.stare === 'ciorna' && r.out.parteneri_notificati === 0, `${r.status} ${JSON.stringify(r.out)}`);
  r = await apel('api/admin/catalog.js', 'token-superadmin', { action: 'actualizeaza_serviciu', id: creatDupa.id, status_public: true });
  verifica('catalog.js după migrare: o ciornă nu se publică prin actualizeaza_serviciu (409)', r.status === 409 && creatDupa.status_public === false, `${r.status} ${JSON.stringify(r.out)}`);
  r = await apel('api/admin/ruta-incadrare.js', 'token-superadmin', { action: 'pasi', sectiune: 'F', diviziune: '43', grupa: '43.2', clasa: '43.22' });
  verifica('pasi după migrare: capitol F, nodul sanitar/termic compatibil, 7127.1 primul la ESCO', r.status === 200 && r.out.capitol?.cod === 'F' && r.out.noduri?.some((n) => n.id === 'n4322' && n.compatibil) && r.out.esco?.[0]?.cod_esco === '7127.1', `${r.status} ${JSON.stringify(r.out).slice(0, 300)}`);
  r = await apel('api/admin/ruta-incadrare.js', 'token-admin-f', { action: 'pasi', clasa: '33.12' });
  verifica('admin limitat la capitolul F: capitolul AGR apare ca nepermis', r.status === 200 && r.out.capitol?.cod === 'AGR' && r.out.capitol_permis === false, `${r.status} ${JSON.stringify(r.out).slice(0, 200)}`);

  console.log(`\n${trecute} trecute, ${picate.length} picate${picate.length ? ': ' + picate.join(' | ') : ''}`);
  process.exitCode = picate.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
