// scripts/supabase-simulat.js
// Supabase simulat în memorie, pentru testele pasului 10a
// (scripts/test-furnizor-propriu.js, scripts/test-import-hbp.js,
// scripts/test-marketplace-public.js). Același tipar ca în
// scripts/test-ruta-incadrare.js: tabelele sunt array-uri, coloanele
// declarate în DB.coloane dau eroarea Postgres reală (42703 / PGRST204)
// când codul cere o coloană care lipsește (migrare neaplicată).
//
// Utilizare:
//   const sim = require('./supabase-simulat');
//   sim.instaleaza();               // înlocuiește lib/supabaseAdmin.js în require.cache
//   sim.DB.tabele.partners = [...];
//   sim.DB.coloane.partners = ['id', ...];   // opțional

const path = require('path');
const RADACINA = path.join(__dirname, '..');

// DB.implicite[tabel]: valorile implicite ale coloanelor la insert (ca DEFAULT din Postgres).
const DB = { tabele: {}, coloane: {}, implicite: {}, seq: 1000, utilizatori: {} };

function eroare(code, message) { return { code, message }; }

function valoareFiltru(v) {
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

// Condiție PostgREST simplă: „col.op.valoare” (eq, neq, gt, gte, lt, lte, is, ilike).
function conditie(expr) {
  const [k, op, ...rest] = expr.split('.');
  const v = valoareFiltru(rest.join('.'));
  return (r) => {
    const x = r[k] ?? null;
    switch (op) {
      case 'eq': return x === v || String(x) === String(v);
      case 'neq': return x !== v;
      case 'is': return x === v;
      case 'gt': return x != null && x > v;
      case 'gte': return x != null && x >= v;
      case 'lt': return x != null && x < v;
      case 'lte': return x != null && x <= v;
      case 'ilike': return new RegExp('^' + String(v).replace(/[*%]/g, '.*') + '$', 'i').test(String(x ?? ''));
      default: return false;
    }
  };
}

function interogare(tabel) {
  const st = { op: 'select', filtre: [], ordine: [], interval: null, limita: null, coloane: '*', date: null, single: false, maybe: false, count: null, head: false, onConflict: null };
  const coloaneNecunoscute = (lista) => {
    const sch = DB.coloane[tabel];
    if (!sch) return [];
    return lista.filter((c) => c !== '*' && !sch.includes(c));
  };
  const b = {
    select(c = '*', opt = {}) { if (st.op === 'select') { st.coloane = c; st.count = opt.count || null; st.head = !!opt.head; } return b; },
    insert(d) { st.op = 'insert'; st.date = Array.isArray(d) ? d : [d]; return b; },
    upsert(d, opt = {}) { st.op = 'upsert'; st.date = Array.isArray(d) ? d : [d]; st.onConflict = opt.onConflict || 'id'; return b; },
    update(d) { st.op = 'update'; st.date = d; return b; },
    delete() { st.op = 'delete'; return b; },
    eq(k, v) { st.filtre.push((r) => (r[k] ?? null) === v); return b; },
    neq(k, v) { st.filtre.push((r) => r[k] !== v); return b; },
    in(k, v) { st.filtre.push((r) => v.includes(r[k])); return b; },
    is(k, v) { st.filtre.push((r) => (r[k] ?? null) === v); return b; },
    gte(k, v) { st.filtre.push((r) => r[k] != null && r[k] >= v); return b; },
    lte(k, v) { st.filtre.push((r) => r[k] != null && r[k] <= v); return b; },
    ilike(k, v) { st.filtre.push(conditie(`${k}.ilike.${v}`)); return b; },
    contains(k, v) { st.filtre.push((r) => Array.isArray(r[k]) && v.every((x) => r[k].includes(x))); return b; },
    not(k, op, v) { const f = conditie(`${k}.${op}.${v}`); st.filtre.push((r) => !f(r)); return b; },
    or(expr) { const c = expr.split(',').map(conditie); st.filtre.push((r) => c.some((f) => f(r))); return b; },
    order(k, o = {}) { st.ordine.push([k, o.ascending !== false]); return b; },
    limit(n) { st.limita = n; return b; },
    range(a, z) { st.interval = [a, z]; return b; },
    maybeSingle() { st.single = true; st.maybe = true; return b; },
    single() { st.single = true; return b; },
    then(ok, ko) { return Promise.resolve(executa()).then(ok, ko); },
  };
  function executa() {
    if (!DB.tabele[tabel]) return { data: null, error: eroare('42P01', `relation "public.${tabel}" does not exist`) };
    const rows = DB.tabele[tabel];
    if (st.op === 'insert' || st.op === 'upsert') {
      const necunoscute = coloaneNecunoscute([...new Set(st.date.flatMap((d) => Object.keys(d)))]);
      if (necunoscute.length) return { data: null, error: eroare('PGRST204', `Could not find the '${necunoscute[0]}' column of '${tabel}' in the schema cache`) };
      const rezultat = [];
      for (const d of st.date) {
        const chei = st.op === 'upsert' ? st.onConflict.split(',').map((c) => c.trim()) : null;
        const existent = chei ? rows.find((r) => chei.every((c) => r[c] != null && r[c] === d[c])) : null;
        if (existent) { Object.assign(existent, d); rezultat.push(existent); continue; }
        const nou = { id: d.id || `id-${++DB.seq}`, ...JSON.parse(JSON.stringify(DB.implicite[tabel] || {})), ...d };
        rows.push(nou);
        rezultat.push(nou);
      }
      return { data: st.single ? rezultat[0] : rezultat, error: null };
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
    const cerute = st.coloane === '*' ? [] : st.coloane.split(',').map((c) => c.trim()).filter((c) => c && !c.includes('(') && !c.includes('!'));
    const necunoscute = coloaneNecunoscute(cerute);
    if (necunoscute.length) return { data: null, error: eroare('42703', `column ${tabel}.${necunoscute[0]} does not exist`) };
    for (const [k, asc] of st.ordine.slice().reverse()) {
      rez = rez.slice().sort((x, y) => {
        const a = x[k] ?? ''; const c = y[k] ?? '';
        const cmp = typeof a === 'number' && typeof c === 'number' ? a - c : String(a).localeCompare(String(c));
        return cmp * (asc ? 1 : -1);
      });
    }
    const total = rez.length;
    if (st.interval) rez = rez.slice(st.interval[0], st.interval[1] + 1);
    if (st.limita != null) rez = rez.slice(0, st.limita);
    if (st.head) return { data: null, count: total, error: null };
    // Ca PostgREST: copii, doar cu coloanele cerute (fără relații în select).
    const simple = st.coloane !== '*' && !st.coloane.includes('(');
    rez = rez.map((r) => {
      const copie = JSON.parse(JSON.stringify(r));
      if (!simple) return copie;
      const proiectat = {};
      cerute.forEach((c) => { if (c in copie) proiectat[c] = copie[c]; });
      return proiectat;
    });
    if (st.single) {
      if (!rez.length && !st.maybe) return { data: null, error: eroare('PGRST116', 'no rows') };
      return { data: rez[0] || null, error: null };
    }
    return { data: rez, count: st.count ? total : null, error: null };
  }
  return b;
}

const supabaseAdmin = {
  from: interogare,
  auth: {
    getUser: async (t) => (DB.utilizatori[t] ? { data: { user: DB.utilizatori[t] }, error: null } : { data: null, error: eroare('401', 'invalid') }),
  },
  storage: { from: () => ({ upload: async () => ({ error: null }) }) },
};

function instaleaza() {
  const p = require.resolve(path.join(RADACINA, 'lib/supabaseAdmin.js'));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { supabaseAdmin } };
  return supabaseAdmin;
}

// Cerere / răspuns minimale pentru handler-ele din api/.
function cerere({ metoda = 'GET', token = null, query = {}, body = null } = {}) {
  return { method: metoda, query, body, headers: token ? { authorization: `Bearer ${token}` } : {}, socket: { remoteAddress: '127.0.0.1' } };
}
function raspuns() {
  const r = { statusCode: 200, corp: null, headere: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.corp = o; return r; };
  r.setHeader = (k, v) => { r.headere[k] = v; return r; };
  r.end = () => r;
  return r;
}

module.exports = { DB, supabaseAdmin, instaleaza, cerere, raspuns, RADACINA };
