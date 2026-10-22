// scripts/test-asistent-backoffice.js
// Teste Playwright pentru pasul 9: asistentul „Serviciu nou” din
// mydarrin-admin-catalog.html și numirea adminilor de catalog din superadmin.
//
// Pagina reală, servită local (server static, fără Vercel), cu sesiune
// simulată și un API simulat construit pe motorul real al rutei
// (lib/ruta-incadrare.js, lib/propune-reteta.js): erorile E* și avertismentele
// A* sunt cele calculate de motor. Nimic nu ajunge la Supabase sau la producție.
//
// Scenarii (în RO și EN, la 1366 și 390 px):
//   1. „Reparat calorifer”: modelul „Reparație / Recondiționare calorifer”,
//      ciornă din model, ruta precompletată (43.22, 7127.1, Ac_10_40_63),
//      „Verifică” → doar A4;
//   2. fotovoltaice: 43.21 → „Instalații electrice” → 7411.1.4 → Ac_10_40_27,
//      „Propune rețetă”, linii fără consum și fără preț, „Aprobă” dezactivat
//      până la decizii complete, A3 (ANRE) la verificare;
//   3. un admin limitat la capitolul F nu poate alege o clasă din AGR;
//   4. un admin fără drept de catalog vede mesajul de acces;
//   5. superadminul numește un admin pe F,N, apoi îi revocă dreptul.
// Plus: 0 erori JS, 0 depășiri pe orizontală, fără text românesc vizibil în EN.
//
// Cerințe (nu e dependență a proiectului):
//   npm i --no-save playwright && npx playwright install chromium
// Rulare: node scripts/test-asistent-backoffice.js [--capturi <dosar>]

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const R = require('../lib/ruta-incadrare');
const { propuneReteta, verificaAprobare } = require('../lib/propune-reteta');

const RADACINA = path.join(__dirname, '..');
const arg = process.argv.slice(2);
const CAPTURI = arg.includes('--capturi') ? arg[arg.indexOf('--capturi') + 1] : null;
if (CAPTURI) fs.mkdirSync(CAPTURI, { recursive: true });

// ── Server static ─────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function server() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = path.join(RADACINA, p === '/' ? 'index.html' : p);
      if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, () => ok(s));
  });
}

// ── Date simulate (după datele reale din 15 oct. 2026) ────────────────────
const CAPITOLE = [
  { cod: 'F', titlu_ro: 'Construcții și renovări', titlu_en: 'Construction and renovation', sectiuni_nace: ['F'], diviziuni_nace: ['41', '42', '43'], clase_nace: [], tip_partener: 'servicii', discount_permis: false, ordine: 1, activ: true },
  { cod: 'N', titlu_ro: 'Proiectare și servicii tehnice', titlu_en: 'Design and technical services', sectiuni_nace: [], diviziuni_nace: ['71'], clase_nace: ['74.13'], tip_partener: 'servicii', discount_permis: false, ordine: 2, activ: true },
  { cod: 'AGR', titlu_ro: 'Servicii agricole', titlu_en: 'Agricultural services', sectiuni_nace: [], diviziuni_nace: [], clase_nace: ['01.61', '33.12', '77.31'], tip_partener: 'servicii', discount_permis: false, ordine: 5, activ: true },
  { cod: 'O81', titlu_ro: 'Curățenie și spații verzi', titlu_en: 'Cleaning and green spaces', sectiuni_nace: [], diviziuni_nace: ['81'], clase_nace: [], tip_partener: 'servicii', discount_permis: false, ordine: 3, activ: true },
];
const NACE = [
  { cod: 'C', nivel: 'sectiune', ro: 'C INDUSTRIA PRELUCRĂTOARE', en: 'C MANUFACTURING' },
  { cod: 'F', nivel: 'sectiune', ro: 'F CONSTRUCȚII', en: 'F CONSTRUCTION' },
  { cod: '33', nivel: 'diviziune', parinte: 'C', ro: '33 Repararea, întreținerea și instalarea mașinilor', en: '33 Repair, maintenance and installation of machinery' },
  { cod: '43', nivel: 'diviziune', parinte: 'F', ro: '43 Lucrări de construcții specializate', en: '43 Specialised construction activities' },
  { cod: '33.1', nivel: 'grupa', parinte: '33', ro: '33.1 Repararea produselor metalice, a mașinilor și echipamentelor', en: '33.1 Repair of fabricated metal products, machinery and equipment' },
  { cod: '43.2', nivel: 'grupa', parinte: '43', ro: '43.2 Lucrări de instalații electrice, sanitare și alte lucrări de instalații', en: '43.2 Electrical, plumbing and other construction installation activities' },
  { cod: '33.12', nivel: 'clasa', parinte: '33.1', ro: '33.12 Repararea și întreținerea mașinilor', en: '33.12 Repair and maintenance of machinery' },
  { cod: '43.21', nivel: 'clasa', parinte: '43.2', ro: '43.21 Lucrări de instalații electrice', en: '43.21 Electrical installation' },
  { cod: '43.22', nivel: 'clasa', parinte: '43.2', ro: '43.22 Lucrări de instalații sanitare, de încălzire și de aer condiționat', en: '43.22 Plumbing, heat and air-conditioning installation' },
  { cod: '43.24', nivel: 'clasa', parinte: '43.2', ro: '43.24 Alte lucrări de instalații pentru construcții', en: '43.24 Other construction installation' },
];
const NODURI = [
  { id: 'n4322', title: 'Instalații sanitare, termice și climatizare', title_en: 'Plumbing, heating and air conditioning', nace_clasa: '43.22', capitol_cod: 'F', autorizare_necesara: null, activ: true },
  { id: 'n4321', title: 'Instalații electrice', title_en: 'Electrical installations', nace_clasa: '43.21', capitol_cod: 'F', autorizare_necesara: 'ANRE', activ: true },
  { id: 'n3312', title: 'Reparații utilaje agricole', title_en: 'Agricultural machinery repair', nace_clasa: '33.12', capitol_cod: 'AGR', autorizare_necesara: null, activ: true },
];
const ESCO = [
  { cod_esco: '7127.1', denumire: 'instalator de service pentru sisteme de încălzire și ventilație', denumire_en: 'heating and ventilation service installer', nace_code: '4322' },
  { cod_esco: '7126.8', denumire: 'instalator', denumire_en: 'plumber', nace_code: '4322' },
  { cod_esco: '7411.1.4', denumire: 'lucrător calificat energie solară', denumire_en: 'solar energy technician', nace_code: '4321' },
  { cod_esco: '7411.1', denumire: 'electrician', denumire_en: 'electrician', nace_code: '3314' },
  { cod_esco: '7233.1', denumire: 'lucrător calificat echipamente de construcții', denumire_en: 'construction equipment technician', nace_code: '3312' },
];
const UNICLASS = [
  { code: 'Ac_10_40_27', title_ro: 'Instalații electrice (montaj)', title_en: 'Electrical system installing' },
  { code: 'Ac_10_40_63', title_ro: 'Montaj rețele și conducte', title_en: 'Pipe fitting (Pipework installing)' },
  { code: 'Ac_10_40_67', title_ro: 'Instalații sanitare (montaj/reparații)', title_en: 'Plumbing' },
  { code: 'Ac_70_65', title_ro: null, title_en: 'Commissioning' },
  { code: 'Pr_60_70_65_63', title_ro: null, title_en: 'Photovoltaic modules' },
];
const RESURSE_F = [{ resursa_id: 1645, cod_resursa: '20000140', denumire_resursa: 'Instalator electrician', unitate_masura: 'ora', esco_cod: '7411.1' }];
const INDICATORI = [
  { indicator_id: 'EF', denumire_indicator: 'Tablouri electrice și accesorii', nace_cod: 'F 43.21' },
  { indicator_id: 'EC', denumire_indicator: 'E — Cabluri electrice și accesorii', nace_cod: null },
  { indicator_id: 'EA', denumire_indicator: 'E — Tuburi, țevi de protecție și accesorii', nace_cod: null },
  { indicator_id: 'EH', denumire_indicator: 'E — Probe și verificări', nace_cod: null },
];
const ARTICOLE_IND = {
  EF: [{ articol_id: 4212, simbol: 'EF04A1', varianta: 1, denumire_articol: 'Tablou electric, capsulat', unitate_masura: 'buc' }],
  EC: [{ articol_id: 4700, simbol: 'EC01A1', varianta: 1, denumire_articol: 'Cablu cu conductoare de cupru', unitate_masura: 'm' }],
  EA: [{ articol_id: 4100, simbol: 'EA01A1', varianta: 1, denumire_articol: 'Tub de protecție din PVC', unitate_masura: 'm' }],
  EH: [{ articol_id: 4350, simbol: 'EH05B1', varianta: 1, denumire_articol: 'Încercarea tablourilor de distribuție', unitate_masura: 'buc' }],
};

function stareNoua() {
  return {
    seq: 1,
    servicii: new Map([
      ['cal-reparatie', { id: 'cal-reparatie', id_serviciu: 'cal-reparatie', titlu: 'Reparație / Recondiționare calorifer', titlu_en: 'Radiator repair / reconditioning', categorie: 'servicii', nace: '43.22', cod_esco: '7127.1', cod_uniclass: 'Ac_10_40_63', nod_id: 'n4322', stare: 'publicat', status_public: true, articole: [{ articol_id: 15539, simbol: 'RPIB03A', indicator_id: 'RPIB' }], niveluri: [{ id: 'niv-cal', nivel: 'Bronze', nivel_complexitate: 1, norma_timp: 1, label: 'Bronz', preturi: [{ id: 'p1', tara_cod: 'RO', moneda: 'RON', pret: 226.65 }] }] }],
      ['tel-montaj-nou', { id: 'tel-montaj-nou', id_serviciu: 'tel-montaj-nou', titlu: 'Montaj tablou electric pe instalație nouă', titlu_en: 'New distribution board installation', categorie: 'servicii', nace: '43.21', cod_esco: '7411.1', cod_uniclass: 'Ac_10_40_27', nod_id: 'n4321', stare: 'publicat', status_public: true, articole: [{ articol_id: 4212, simbol: 'EF04A1', indicator_id: 'EF', denumire_articol: 'Tablou electric, capsulat', unitate_masura: 'buc' }], niveluri: [] }],
      ['testare', { id: 'testare', id_serviciu: 'testare', titlu: 'Testare & verificare instalație electrică', titlu_en: 'Electrical installation testing', categorie: 'servicii', nace: '43.21', cod_esco: null, cod_uniclass: null, nod_id: 'n4321', stare: 'publicat', status_public: true, articole: [{ articol_id: 4350, simbol: 'EH05B1', indicator_id: 'EH', denumire_articol: 'Încercarea tablourilor de distribuție', unitate_masura: 'buc' }], niveluri: [] }],
    ]),
    retete: new Map(),
    perm: new Map([['u-admin-f', { capitole: 'F', tara_cod: null }]]),
  };
}
const UTILIZATORI = {
  'u-super': { id: 'u-super', email: 'super@example.com', roles: ['superadmin'] },
  'u-admin-f': { id: 'u-admin-f', email: 'catalog.f@example.com', roles: ['admin'] },
  'u-fara': { id: 'u-fara', email: 'fara.drept@example.com', roles: ['admin'] },
};

// ── API simulat ───────────────────────────────────────────────────────────
function apiSimulat(S) {
  const capitol = (s) => (NODURI.find((n) => n.id === s.nod_id) || {}).capitol_cod || R.capitolPentruNace(s.nace, CAPITOLE);
  const permisiune = (uid) => {
    const u = UTILIZATORI[uid];
    if (!u) return null;
    if (u.roles.includes('superadmin')) return { superadmin: true, capitole: '*', tara: null };
    const p = S.perm.get(uid);
    return p ? { superadmin: false, capitole: p.capitole === '*' ? '*' : p.capitole.split(','), tara: p.tara_cod } : null;
  };
  const permis = (perm, cod) => perm.capitole === '*' || (cod && perm.capitole.includes(cod));
  const eroare = (status, error, error_en, extra) => ({ status, body: { ok: false, error, error_en, ...(extra || {}) } });
  const lbl = (lang, ro, en) => (lang === 'en' ? en || ro : ro || en);
  const validare = (s) => R.valideazaRuta({
    serviciu: { ...s, nace: s.nace },
    nod: NODURI.find((n) => n.id === s.nod_id) || null,
    capitol: CAPITOLE.find((c) => c.cod === (NODURI.find((n) => n.id === s.nod_id) || {}).capitol_cod) || null,
    esco: ESCO.find((e) => e.cod_esco === s.cod_esco) ? { ...ESCO.find((e) => e.cod_esco === s.cod_esco), tip_cod: R.tipCodEsco(s.cod_esco) } : null,
    uniclass: UNICLASS.find((u) => u.code === s.cod_uniclass) ? { code: s.cod_uniclass, is_active: true } : null,
    articole: (s.articole || []).map((a) => ({ ...a, indicator_nace: null })),
    preturi: [{ nivel: 'Bronze', are_pret_activ: false, reteta_calculabila: (s.articole || []).length > 0, reteta_propusa: [...S.retete.values()].some((r) => r.serviciu_id === s.id && r.stare === 'propusa') }],
    traduceri: { titlu_ro: s.titlu, titlu_en: s.titlu_en },
    tipInregistrare: s.categorie === 'materiale' ? 'produs' : 'serviciu',
    ref: { capitole: CAPITOLE, naceClase: NACE.filter((n) => n.nivel === 'clasa').map((n) => n.cod), catalog: [...S.servicii.values()].map((x) => ({ id: x.id, titlu: x.titlu })) },
  });

  return function (url, uid, b) {
    if (url.endsWith('/api/admin/permisiuni-catalog')) {
      if (!UTILIZATORI[uid]?.roles.includes('superadmin')) return eroare(403, 'Nu ai permisiunea necesară pentru acest rol', 'Forbidden');
      if (b.action === 'lista') {
        return { status: 200, body: { ok: true, migrare_aplicata: true, capitole: CAPITOLE.map((c) => ({ cod: c.cod, titlu_ro: c.titlu_ro, titlu_en: c.titlu_en })), admini: Object.values(UTILIZATORI).filter((u) => u.roles.includes('admin')).map((u) => ({ id: u.id, email: u.email, roles: u.roles, catalog: S.perm.get(u.id) || null })) } };
      }
      if (b.action === 'acorda') { const v = b.capitole === '*' ? '*' : [].concat(b.capitole).join(','); S.perm.set(b.admin_id, { capitole: v, tara_cod: b.tara_cod || null }); return { status: 200, body: { ok: true, capitole: v, tara_cod: b.tara_cod || null } }; }
      if (b.action === 'revoca') { S.perm.delete(b.admin_id); return { status: 200, body: { ok: true } }; }
    }
    const perm = permisiune(uid);
    if (!perm) return eroare(403, 'Nu ai drept pe catalogul de servicii (admin_permissions: catalog_servicii, poate_scrie).', 'You have no rights on the service catalogue (admin_permissions: catalog_servicii, poate_scrie).');
    const lang = b.lang === 'ro' ? 'ro' : 'en';
    const serv = (id) => S.servicii.get(id);

    if (url.endsWith('/api/admin/catalog')) {
      if (b.action === 'serviciu_cu_niveluri') { const s = serv(b.id); return s ? { status: 200, body: { ok: true, serviciu: { id: s.id, titlu: s.titlu, niveluri: s.niveluri || [] } } } : eroare(404, 'Serviciul nu există.', 'The service does not exist.'); }
      return { status: 200, body: { ok: true, articole: [] } };
    }

    switch (b.action) {
      case 'profil': {
        const caps = perm.capitole === '*' ? CAPITOLE : CAPITOLE.filter((c) => perm.capitole.includes(c.cod));
        return { status: 200, body: { ok: true, superadmin: perm.superadmin, toate_capitolele: perm.capitole === '*', capitole: caps.map((c) => ({ cod: c.cod, titlu_ro: c.titlu_ro, titlu_en: c.titlu_en, tip_partener: c.tip_partener })), tara: perm.tara } };
      }
      case 'cauta_asemanatoare': {
        const catalog = [...S.servicii.values()].map((s) => ({ ...s }));
        return { status: 200, body: { ok: true, rezultate: R.serviciiAsemanatoare(b.serviciu || {}, catalog).slice(0, 20) } };
      }
      case 'serviciu': {
        const s = serv(b.serviciu_id);
        if (!s) return eroare(404, 'Serviciul nu există.', 'The service does not exist.');
        if (!permis(perm, capitol(s)) && !(!capitol(s) && s.creat_de === uid)) return eroare(403, `Nu ai drept pe capitolul ${capitol(s)}.`, `You have no rights on chapter ${capitol(s)}.`);
        const nod = NODURI.find((n) => n.id === s.nod_id);
        return { status: 200, body: { ok: true, serviciu: { ...s, clasa: R.normalizeazaNace(s.nace), capitol: capitol(s), nod: nod ? { id: nod.id, title: nod.title, title_en: nod.title_en } : null, articole_reteta: (s.articole || []).length } } };
      }
      case 'copiaza_din': {
        const src = serv(b.serviciu_sursa_id);
        const id = 'ciorna-' + S.seq++;
        S.servicii.set(id, { ...src, id, id_serviciu: id, titlu: b.titlu, titlu_en: b.titlu_en || null, stare: 'ciorna', status_public: false, creat_din_serviciu_id: src.id, niveluri: (src.niveluri || []).map((n) => ({ ...n, id: n.id + '-' + id, preturi: [] })) });
        return { status: 200, body: { ok: true, id, stare: 'ciorna' } };
      }
      case 'salveaza_ciorna': {
        let s = b.serviciu_id ? serv(b.serviciu_id) : null;
        const nace = b.nace ? R.normalizeazaNace(b.nace) : s?.nace;
        const nod = NODURI.find((n) => n.id === (b.nod_id || s?.nod_id));
        const cap = nod?.capitol_cod || R.capitolPentruNace(nace, CAPITOLE);
        if (cap && !permis(perm, cap)) return eroare(403, `Nu ai drept pe capitolul ${cap}.`, `You have no rights on chapter ${cap}.`);
        if (!s) { const id = 'ciorna-' + S.seq++; s = { id, id_serviciu: id, stare: 'ciorna', status_public: false, articole: [], niveluri: [], creat_de: uid }; S.servicii.set(id, s); }
        ['titlu', 'titlu_en', 'categorie', 'nod_id', 'cod_esco', 'cod_uniclass'].forEach((k) => { if (b[k] !== undefined) s[k] = b[k]; });
        if (b.nace) s.nace = nace;
        return { status: 200, body: { ok: true, id: s.id, stare: s.stare } };
      }
      case 'pasi': {
        const sectiune = b.sectiune || (b.diviziune ? (NACE.find((n) => n.cod === b.diviziune) || {}).parinte : null);
        const lista = (nivel, parinte) => NACE.filter((n) => n.nivel === nivel && (!parinte || n.parinte === parinte)).map((n) => ({ cod: n.cod, denumire: lbl(lang, n.ro, n.en) }));
        const r = { ok: true, lang, alese: { sectiune, diviziune: b.diviziune || null, grupa: b.grupa || null, clasa: b.clasa || null }, sectiuni: lista('sectiune') };
        if (sectiune) r.diviziuni = lista('diviziune', sectiune);
        if (b.diviziune) r.grupe = lista('grupa', b.diviziune);
        if (b.grupa) r.clase = lista('clasa', b.grupa);
        if (b.clasa) {
          const cod = R.capitolPentruNace(b.clasa, CAPITOLE);
          const cap = CAPITOLE.find((c) => c.cod === cod);
          r.capitol = cap && { cod: cap.cod, titlu: lbl(lang, cap.titlu_ro, cap.titlu_en), tip_partener: cap.tip_partener, discount_permis: cap.discount_permis };
          r.capitol_permis = permis(perm, cod);
          r.noduri = NODURI.filter((n) => n.nace_clasa === b.clasa).map((n) => ({ id: n.id, titlu: lbl(lang, n.title, n.title_en), capitol_cod: n.capitol_cod, compatibil: n.capitol_cod === cod, autorizare_necesara: n.autorizare_necesara }));
          const pot = (e) => (R.normalizeazaNace(e.nace_code) === b.clasa ? 'clasa' : R.diviziuneDinText(e.nace_code) === b.clasa.slice(0, 2) ? 'diviziune' : null);
          r.esco = ESCO.map((e) => ({ cod_esco: e.cod_esco, denumire: lbl(lang, e.denumire, e.denumire_en), potrivire: pot(e) })).sort((x, y) => (x.potrivire ? (x.potrivire === 'clasa' ? 0 : 1) : 2) - (y.potrivire ? (y.potrivire === 'clasa' ? 0 : 1) : 2));
        }
        return { status: 200, body: r };
      }
      case 'cauta_uniclass': {
        const prefix = b.tip === 'produs' ? 'Pr_' : 'Ac_';
        const t = String(b.text || '').toLowerCase();
        return { status: 200, body: { ok: true, coduri: UNICLASS.filter((u) => u.code.startsWith(prefix) && (!t || u.code.toLowerCase().includes(t) || String(u.title_ro || u.title_en).toLowerCase().includes(t))).map((u) => ({ cod: u.code, denumire: lbl(lang, u.title_ro, u.title_en) })) } };
      }
      case 'valideaza': { const s = serv(b.serviciu_id); const rez = validare(s); s.ruta_rezultat = rez; return { status: 200, body: { ok: true, rezultat: rez } }; }
      case 'publica': {
        const s = serv(b.serviciu_id); const rez = validare(s);
        if (!rez.ok) return eroare(422, 'Ruta are erori: serviciul nu se poate publica.', 'The route has errors: the service cannot be published.', { cod: 'RUTA_INVALIDA', rezultat: rez });
        if (rez.avertismente.length && b.confirm_avertismente !== true) return eroare(409, 'Ruta are avertismente: confirmă-le (confirm_avertismente: true) ca să publici.', 'The route has warnings: confirm them (confirm_avertismente: true) to publish.', { cod: 'CONFIRMARE_NECESARA', rezultat: rez });
        Object.assign(s, { stare: 'publicat', status_public: true }); return { status: 200, body: { ok: true, stare: 'publicat', rezultat: rez } };
      }
      case 'retrage': { Object.assign(serv(b.serviciu_id), { stare: 'retras', status_public: false }); return { status: 200, body: { ok: true, stare: 'retras' } }; }
      case 'lista_servicii': {
        const lista = [...S.servicii.values()].map((s) => ({ ...s, capitol: capitol(s) })).filter((s) => permis(perm, s.capitol))
          .filter((s) => !b.stare || s.stare === b.stare).filter((s) => !b.cu_erori || (s.ruta_rezultat && !s.ruta_rezultat.ok))
          .map((s) => ({ id: s.id, titlu: s.titlu, stare: s.stare, capitol: s.capitol, nace: s.nace, cod_esco: s.cod_esco, cod_uniclass: s.cod_uniclass, nod: NODURI.find((n) => n.id === s.nod_id) || null, ruta: s.ruta_rezultat ? { ok: s.ruta_rezultat.ok, erori: s.ruta_rezultat.erori.map((e) => e.cod), avertismente: s.ruta_rezultat.avertismente.map((a) => a.cod) } : null }));
        return { status: 200, body: { ok: true, servicii: lista } };
      }
      case 'propune_reteta': {
        const s = serv(b.serviciu_id);
        const catalog = [...S.servicii.values()];
        const asem = R.serviciiAsemanatoare(s, catalog);
        const articoleAsemanatoare = asem.filter((a) => a.are_reteta).flatMap((a) => S.servicii.get(a.serviciu.id).articole.map((x) => ({ ...x, serviciu_titlu: a.serviciu.titlu, nivel_potrivire: a.nivel_potrivire })));
        const { linii } = propuneReteta({ serviciu: s, ruta: { clasa: R.normalizeazaNace(s.nace), esco: { cod_esco: s.cod_esco, isco_group: String(s.cod_esco || '').slice(0, 4) } }, asemanatoare: asem,
          ref: { indicatori: INDICATORI, articolePeIndicator: ARTICOLE_IND, articoleAsemanatoare, resurseManopera: RESURSE_F, uniclassCoduri: UNICLASS.map((u) => u.code) } });
        const id = 'reteta-' + S.seq++;
        S.retete.set(id, { id, serviciu_id: s.id, stare: 'propusa', sursa: 'automat', catalog_nivel_id: null, linii: linii.map((l, i) => ({ ...l, id: id + '-l' + i, reteta_id: id })) });
        return { status: 200, body: { ok: true, reteta_id: id, stare: 'propusa', linii } };
      }
      case 'retete_propuse_lista': {
        const lista = [...S.retete.values()].filter((r) => r.stare === 'propusa').map((r) => { const s = serv(r.serviciu_id); return { id: r.id, catalog_serviciu_id: s.id, catalog_nivel_id: r.catalog_nivel_id, stare: r.stare, sursa: r.sursa, serviciu: { id: s.id, titlu: s.titlu, capitol: capitol(s) }, nivel: null, linii: r.linii.map((l) => ({ ...l, fara_tarif: l.tip === 'resursa_noua' })) }; }).filter((r) => permis(perm, r.serviciu.capitol));
        return { status: 200, body: { ok: true, retete: lista } };
      }
      case 'decide_linie': {
        for (const r of S.retete.values()) {
          const l = r.linii.find((x) => x.id === b.linie_id);
          if (l) { l.decizie = b.decizie; if (b.consum_propus !== undefined) l.consum_propus = b.consum_propus; return { status: 200, body: { ok: true, linie: l } }; }
        }
        return eroare(404, 'Linia nu există.', 'The line does not exist.');
      }
      case 'aproba_reteta': {
        const r = S.retete.get(b.reteta_id);
        const v = verificaAprobare(r.linii);
        if (!v.ok) return eroare(422, v.erori.map((e) => e.mesaj_ro).join(' '), v.erori.map((e) => e.mesaj_en).join(' '), { cod: 'APROBARE_REFUZATA' });
        r.stare = 'aprobata';
        return { status: 200, body: { ok: true, stare: 'aprobata', articol: { simbol: 'MDR0001A1' }, nota: 'Resursele noi n-au tarif: prețul rămâne „la cerere” până se completează tarifele.', nota_en: 'The new resources have no rate: the price stays "on request" until the rates are filled in.' } };
      }
      case 'respinge_reteta': { S.retete.get(b.reteta_id).stare = 'respinsa'; return { status: 200, body: { ok: true } }; }
      default: return eroare(400, 'action invalidă', 'invalid action');
    }
  };
}

// ── Sesiune simulată (ca în scripts/detector-ro.js) ───────────────────────
function sesiuneSimulata(user) {
  const lant = (rez) => { const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (ok) => ok(rez) : () => p), apply: () => p }); return p; };
  const ses = { access_token: 'tok-' + user.id, user };
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: ses }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) },
    from: () => lant({ data: [], error: null, count: 0 }), rpc: () => lant({ data: null, error: null }), storage: { from: () => lant({ data: null, error: null }) }, channel: () => lant({}), removeChannel: () => {},
  };
  const auth = new Proxy({ getCurrentUser: async () => user, getUserRoles: async () => user.roles, hasRole: async () => true, enforceSuperadminBarrier: async () => user.roles.includes('superadmin'), performLogout: () => {} }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (n, v) => Object.defineProperty(window, n, { configurable: true, get: () => v, set: () => {} });
  fix('supabaseClient', client); fix('MyDarrinAuth', auth);
}

// ── Raportare ─────────────────────────────────────────────────────────────
let trecute = 0;
const picate = [];
function verifica(nume, cond, detaliu) {
  if (cond) { trecute++; console.log(`  ✓ ${nume}`); } else { picate.push(nume); console.log(`  ✗ ${nume}${detaliu ? ' — ' + detaliu : ''}`); }
}
const RO_DIACRITICE = /[ăâîșțşţĂÂÎȘȚ]/;

async function deschide(browser, baza, { uid, limba, latime, pagina = 'mydarrin-admin-catalog.html', S }) {
  const ctx = await browser.newContext({ viewport: { width: latime, height: 900 }, locale: 'en-GB' });
  await ctx.addInitScript((l) => { try { if (!sessionStorage.getItem('__i')) { localStorage.clear(); if (l === 'ro') localStorage.setItem('myd_lang_v1', 'ro'); sessionStorage.setItem('__i', '1'); } } catch (e) { /* fără stocare */ } }, limba);
  await ctx.addInitScript(sesiuneSimulata, { ...UTILIZATORI[uid], user_metadata: {} });
  await ctx.route(/\.supabase\.co\//, (r) => r.abort());
  const api = apiSimulat(S);
  await ctx.route(/\/api\//, async (r) => {
    const req = r.request();
    const url = new URL(req.url()).pathname;
    let corp = {}; try { corp = JSON.parse(req.postData() || '{}'); } catch (e) { corp = {}; }
    const tok = (req.headers().authorization || '').replace('Bearer tok-', '');
    if (/\/api\/admin\/(ruta-incadrare|catalog|permisiuni-catalog)$/.test(url)) {
      const { status, body } = api(url, tok, corp);
      return r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  const p = await ctx.newPage();
  p.erori = [];
  p.on('pageerror', (e) => p.erori.push(e.message.slice(0, 160)));
  p.on('dialog', (d) => d.accept());
  await p.goto(baza + '/' + pagina, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  return { ctx, p };
}
const textVizibil = (p, sel = 'body') => p.evaluate((s) => document.querySelector(s).innerText, sel);
const depasire = (p) => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
async function capturaDe(p, nume) { if (CAPTURI) await p.screenshot({ path: path.join(CAPTURI, nume + '.png'), fullPage: true }); }
async function verificaEN(p, eticheta, limba) {
  if (limba !== 'en') return;
  // Fără diacritice românești în textul vizibil (datele simulate în română — titlurile de servicii — sunt excluse).
  const t = await p.evaluate(() => {
    const sari = /Reparat calorifer|Reparație|Recondiționare|calorifer|Montaj|fotovoltaice|instalație|punere în funcțiune|tablou|Testare|Instalator|Cablu|Tub de protecție|Încercarea|Ancore|Module|Structură|Protecție|Invertor|Punere|acoperiș|E — |motiv|Lipsește|indicatorul|Articolul|Manoperă|varianta|lucrării|normele|cod Uniclass|Codul|uniclass_codes/;
    return [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && e.offsetParent !== null).map((e) => e.innerText.trim()).filter((x) => x && !sari.test(x));
  });
  const ro = t.filter((x) => RO_DIACRITICE.test(x));
  verifica(`${eticheta}: niciun text românesc vizibil în EN`, ro.length === 0, ro.slice(0, 5).join(' | '));
}

async function main() {
  const srv = await server();
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  try {
    for (const latime of [1366, 390]) for (const limba of ['ro', 'en']) {
      const et = `${limba.toUpperCase()} ${latime}px`;
      console.log(`\n═══ ${et} ═══`);

      // 1. Reparat calorifer
      console.log('1. „Reparat calorifer”');
      let S = stareNoua();
      let { ctx, p } = await deschide(browser, baza, { uid: 'u-super', limba, latime, S });
      await p.fill('#w-titlu', 'Reparat calorifer');
      await p.fill('#w-titlu-en', 'Radiator repair');
      await p.click('#w-cauta');
      await p.waitForSelector('[data-asemanator]');
      const primul = await p.$eval('[data-asemanator]', (e) => e.innerText);
      verifica('pasul 1: modelul „Reparație / Recondiționare calorifer” apare primul', /Reparație \/ Recondiționare calorifer/.test(primul), primul.slice(0, 80));
      await capturaDe(p, `1-${limba}-${latime}-asemanatoare`);
      await p.click('[data-asemanator] >> nth=0 >> text=/Folosește ca model|Use as a model/');
      await p.waitForSelector('#w-pasi:not(.ascuns)');
      await p.waitForTimeout(500);
      const alese = await p.evaluate(() => ({ clasa: document.querySelector('#l-clase .opt.ales code')?.textContent, esco: document.querySelector('#l-esco .opt.ales code')?.textContent, uc: document.querySelector('#l-uniclass .opt.ales code')?.textContent, nod: document.querySelector('#l-noduri .opt.ales')?.innerText, ciorna: document.getElementById('w-ciorna').innerText }));
      verifica('„Folosește ca model” creează o ciornă', /Ciornă|Draft/.test(alese.ciorna), alese.ciorna);
      verifica('ruta precompletată: 43.22, 7127.1, Ac_10_40_63, nodul sanitar/termic', alese.clasa === '43.22' && alese.esco === '7127.1' && alese.uc === 'Ac_10_40_63' && /Instalații sanitare|Plumbing/.test(alese.nod || ''), JSON.stringify(alese));
      await p.click('#w-verifica');
      await p.waitForSelector('#w-rezultat .alerta');
      const rez1 = await p.$$eval('#w-rezultat .alerta b', (b) => b.map((x) => x.textContent));
      verifica('„Verifică” dă doar A4', JSON.stringify(rez1) === '["A4"]', JSON.stringify(rez1));
      verifica('„Publică” e dezactivat până la bifa de confirmare', await p.$eval('#w-publica', (b) => b.disabled));
      await p.check('#w-confirm');
      verifica('după bifă, „Publică” se activează', !(await p.$eval('#w-publica', (b) => b.disabled)));
      await capturaDe(p, `1-${limba}-${latime}-verificare`);
      await verificaEN(p, 'scenariul 1', limba);
      verifica('scenariul 1: fără depășire pe orizontală', !(await depasire(p)));
      verifica('scenariul 1: 0 erori JS', p.erori.length === 0, p.erori.join(' | '));
      await ctx.close();

      // 2. Fotovoltaice
      console.log('2. Fotovoltaice');
      S = stareNoua();
      ({ ctx, p } = await deschide(browser, baza, { uid: 'u-super', limba, latime, S }));
      await p.fill('#w-titlu', 'Montaj panouri fotovoltaice cu instalație și punere în funcțiune');
      await p.fill('#w-titlu-en', 'Installation of photovoltaic panels with wiring and commissioning');
      await p.click('#w-fara-model');
      await p.waitForSelector('#w-pasi:not(.ascuns)');
      const alege = async (lista, cod) => { await p.click(`#l-${lista} .opt:has(code:text-is("${cod}"))`); await p.waitForTimeout(300); };
      await alege('sectiuni', 'F'); await alege('diviziuni', '43'); await alege('grupe', '43.2'); await alege('clase', '43.21');
      await p.click('#l-noduri .opt:has-text("Instalații electrice"), #l-noduri .opt:has-text("Electrical installations")');
      await p.waitForTimeout(300);
      await p.fill('#f-esco', '7411.1.4');
      await p.click('#l-esco .opt:has(code:text-is("7411.1.4"))');
      await p.fill('#f-uniclass', 'Ac_10_40_27');
      await p.waitForSelector('#l-uniclass .opt:has(code:text-is("Ac_10_40_27"))');
      await p.click('#l-uniclass .opt:has(code:text-is("Ac_10_40_27"))');
      await p.waitForTimeout(300);
      const ruta2 = await p.evaluate(() => ({ capitol: document.getElementById('w-capitol').innerText, clasa: document.querySelector('#l-clase .opt.ales code')?.textContent, esco: document.querySelector('#l-esco .opt.ales code')?.textContent, uc: document.querySelector('#l-uniclass .opt.ales code')?.textContent }));
      verifica('ruta 43.21 → F → „Instalații electrice” → 7411.1.4 → Ac_10_40_27', ruta2.clasa === '43.21' && /F ·/.test(ruta2.capitol) && ruta2.esco === '7411.1.4' && ruta2.uc === 'Ac_10_40_27', JSON.stringify(ruta2));
      await capturaDe(p, `2-${limba}-${latime}-ruta`);
      await p.click('#w-verifica');
      await p.waitForSelector('#w-rezultat .alerta');
      const rez2 = await p.$$eval('#w-rezultat .alerta b', (b) => b.map((x) => x.textContent));
      verifica('verificarea arată A3 (ANRE)', rez2.includes('A3'), JSON.stringify(rez2));
      const textA3 = await p.$eval('#w-rezultat', (e) => e.innerText);
      verifica('mesajul A3 numește ANRE', /ANRE/.test(textA3));
      await p.click('#w-propune');
      await p.waitForSelector('#tab-retete:not(.ascuns) [data-reteta]', { timeout: 5000 });
      const linii = await p.$$eval('[data-reteta] tr[data-linie]', (tr) => tr.map((r) => ({ text: r.innerText, consum: r.querySelector('.consum').value })));
      const noi = linii.filter((l) => /resursă nouă|new resource/.test(l.text));
      verifica('rețeta propusă are liniile noi (module, ancore, invertor, punere în funcțiune…)', noi.length === 6, String(noi.length));
      verifica('liniile noi apar fără consum și marcate fără tarif (fără preț)', noi.every((l) => l.consum === '' && /fără tarif|no rate/.test(l.text)));
      verifica('„Aprobă rețeta” e dezactivat cât timp sunt linii în așteptare', await p.$eval('[data-reteta] .btn.ok[onclick^="aprobaReteta"]', (b) => b.disabled));
      await capturaDe(p, `2-${limba}-${latime}-reteta-propusa`);
      // Decizii complete: toate liniile acceptate, cu consum.
      const n = await p.$$eval('[data-reteta] tr[data-linie]', (x) => x.length);
      for (let i = 0; i < n; i++) {
        const rand = p.locator('[data-reteta] tr[data-linie]').nth(i);
        await rand.locator('.consum').fill('1');
        await rand.locator('button[onclick*="acceptata"]').click();
        await p.waitForTimeout(900);
      }
      await p.waitForTimeout(600);
      verifica('după decizii complete, „Aprobă rețeta” se activează', !(await p.$eval('[data-reteta] .btn.ok[onclick^="aprobaReteta"]', (b) => b.disabled)));
      await capturaDe(p, `2-${limba}-${latime}-decizii`);
      await verificaEN(p, 'scenariul 2', limba);
      verifica('scenariul 2: fără depășire pe orizontală', !(await depasire(p)));
      verifica('scenariul 2: 0 erori JS', p.erori.length === 0, p.erori.join(' | '));
      await ctx.close();

      // 3. Admin limitat la F nu poate alege o clasă din AGR
      console.log('3. Admin limitat la capitolul F');
      S = stareNoua();
      ({ ctx, p } = await deschide(browser, baza, { uid: 'u-admin-f', limba, latime, S }));
      const antet3 = await textVizibil(p, '#antet-drepturi');
      verifica('antetul arată capitolul F', /Construcții și renovări|Construction and renovation/.test(antet3), antet3);
      await p.fill('#w-titlu', 'Reparație tractor la domiciliu');
      await p.click('#w-fara-model');
      await p.waitForSelector('#w-pasi:not(.ascuns)');
      await alege('sectiuni', 'C'); await alege('diviziuni', '33'); await alege('grupe', '33.1'); await alege('clase', '33.12');
      const cap3 = await textVizibil(p, '#w-capitol');
      verifica('clasa 33.12 (AGR) e oprită: în afara drepturilor', /AGR/.test(cap3) && /(în afara drepturilor|outside your rights)/.test(cap3), cap3);
      verifica('pașii nod / ESCO / Uniclass rămân ascunși', await p.evaluate(() => ['c-nod', 'c-esco', 'c-uniclass'].every((x) => document.getElementById(x).classList.contains('ascuns'))));
      await capturaDe(p, `3-${limba}-${latime}-agr`);
      verifica('scenariul 3: 0 erori JS', p.erori.length === 0, p.erori.join(' | '));
      await ctx.close();

      // 4. Admin fără drept de catalog
      console.log('4. Admin fără drept de catalog');
      S = stareNoua();
      ({ ctx, p } = await deschide(browser, baza, { uid: 'u-fara', limba, latime, S }));
      const acces = await p.evaluate(() => ({ refuz: !document.getElementById('acces-refuzat').classList.contains('ascuns'), continut: !document.getElementById('continut').classList.contains('ascuns'), text: document.getElementById('acces-refuzat').innerText }));
      verifica('vede mesajul de acces, nu pagina', acces.refuz && !acces.continut, JSON.stringify(acces));
      verifica('mesajul e în limba activă', limba === 'ro' ? /Nu ai acces la catalog\. Cere-l superadminului\./.test(acces.text) : /You do not have catalogue access\. Ask the superadmin\./.test(acces.text), acces.text);
      await capturaDe(p, `4-${limba}-${latime}-acces`);
      verifica('scenariul 4: 0 erori JS', p.erori.length === 0, p.erori.join(' | '));
      await ctx.close();
    }

    // 5. Superadmin: numește un admin pe F,N, apoi revocă (pagină internă, în română)
    console.log('\n5. Superadmin: numire F,N, apoi revocare');
    const S = stareNoua();
    const { ctx, p } = await deschide(browser, baza, { uid: 'u-super', limba: 'ro', latime: 1366, S, pagina: 'mydarrin-superadmin.html' });
    await p.evaluate(() => window.showPanel('rbac'));
    await p.waitForSelector('.cat-admin[data-admin="u-fara"]');
    const card = p.locator('.cat-admin[data-admin="u-fara"]');
    await card.locator('.ca-cap[value="F"]').check();
    await card.locator('.ca-cap[value="N"]').check();
    await card.locator('button:has-text("Salvează dreptul")').click();
    await p.waitForTimeout(400);
    verifica('dreptul F,N e scris (sectiune_specializata = "F,N")', S.perm.get('u-fara')?.capitole === 'F,N', JSON.stringify(S.perm.get('u-fara')));
    const mesaj5 = await card.locator('.ca-msg').innerText();
    verifica('mesaj verde de confirmare', /Drept de catalog salvat: F,N/.test(mesaj5), mesaj5);
    await p.waitForTimeout(1700);
    await capturaDe(p, '5-superadmin-numire');
    await p.locator('.cat-admin[data-admin="u-fara"] button:has-text("Revocă dreptul")').click();
    // Pasul 11-N1: confirmarea e fereastra proprie MDFeedback.confirma, nu confirm().
    await p.locator('.md-confirma-ok').click();
    await p.waitForTimeout(400);
    verifica('revocarea șterge dreptul, nu contul', !S.perm.has('u-fara') && !!UTILIZATORI['u-fara']);
    verifica('legătura „Deschide pagina de catalog” există', await p.$eval('#cat-admini-card a[href="mydarrin-admin-catalog.html"]', (a) => !!a));
    await capturaDe(p, '5-superadmin-revocare');
    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${trecute} trecute, ${picate.length} picate${picate.length ? ': ' + picate.join(' | ') : ''}`);
  process.exitCode = picate.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
