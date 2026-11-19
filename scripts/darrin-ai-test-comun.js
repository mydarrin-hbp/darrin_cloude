// scripts/darrin-ai-test-comun.js
// Pasul 12-D2: pregătirea comună pentru testele Darrin AI (poze și rute) —
// Supabase simulat, Anthropic simulat (fetch interceptat, niciun apel real),
// KV în memorie pentru limita de cereri, contexte Chromium cu /api/* servit
// din handler-ele reale. Se încarcă înaintea oricărui modul din api/.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

// KV în memorie (lib/rate-limit.js), cu TTL.
const KV = { date: new Map() };
const kvMemorie = {
  incr: async (k) => { const v = (KV.date.get(k) || { n: 0, exp: Date.now() + 600000 }); v.n++; KV.date.set(k, v); return v.n; },
  expire: async (k, sec) => { const v = KV.date.get(k); if (v) v.exp = Date.now() + sec * 1000; return 1; },
  ttl: async (k) => { const v = KV.date.get(k); return v ? Math.max(1, Math.round((v.exp - Date.now()) / 1000)) : -2; },
};
const RL = require(path.join(RADACINA, 'lib/rate-limit.js'));
RL._seteazaKv(kvMemorie);

const modulReteta = require(path.join(RADACINA, 'lib/calculeaza-cost-recipe.js'));
modulReteta.calculeazaCostNivel = async ({ nivelId }) => ({ nivel_id: nivelId, cost_baza_servicii: 0, cost_materiale: 0, cost_utilaj: 0, articole: [], resurse_fara_pret: [{ motiv: 'niciun_articol_legat_de_nivel' }] });

// O valoare de test, nu o cheie reală (endpoint-ul cere doar să existe).
process.env.ANTHROPIC_API_KEY = 'valoare-de-test-fara-acces';

// Storage simulat care păstrează și conținutul încărcat (pentru verificarea EXIF).
const STORAGE = [];
const { supabaseAdmin } = require(path.join(RADACINA, 'lib/supabaseAdmin.js'));
supabaseAdmin.storage.from = (bucket) => ({
  upload: async (cale, buf, opt) => { STORAGE.push({ bucket, cale, buf: Buffer.from(buf), mime: opt && opt.contentType }); return { error: null }; },
});

const apiDeviz = require(path.join(RADACINA, 'api/darrin-ai/deviz.js'));

const ID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NV = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const S = [
  { id: ID(1), id_serviciu: 'inlocuire-calorifer', titlu: 'Înlocuire calorifer', en: 'Radiator replacement', pret: 280 },
  { id: ID(2), id_serviciu: 'reparatie-garnituri-calorifer', titlu: 'Reparație garnituri calorifer', en: 'Radiator gasket repair', pret: 150 },
  { id: ID(3), id_serviciu: 'montaj-tablou-electric', titlu: 'Montaj tablou electric', en: 'Electrical panel installation', pret: null },
  { id: ID(4), id_serviciu: 'consultanta-darrin', titlu: 'Consultanță Darrin', en: 'Darrin Consultancy', pret: 100 },
];

function reset() {
  DB.tabele = {
    categorii: [
      { slug: 'instalatii-termice', title: 'Instalații termice', category_type: 'servicii', display_order: 1 },
      { slug: 'instalatii-electrice', title: 'Instalații electrice', category_type: 'servicii', display_order: 2 },
    ],
    catalog_servicii: S.map((s) => ({
      id: s.id, id_serviciu: s.id_serviciu, titlu: s.titlu, categorie: 'servicii', stare: 'publicat', status_public: true,
      unitate_masura: 'buc', domeniu: 'Instalații', descriere: 'Descriere', imagini: [], categorie_id: null, subcategorie_id: null,
      traduceri: { en: { titlu: s.en } },
    })),
    catalog_niveluri: S.map((s, i) => ({ id: NV(i + 1), serviciu_id: s.id, nivel: 'Bronze', catalog_preturi: s.pret == null ? [] : [{ pret: s.pret, tara_cod: 'RO' }] })),
    catalog_preturi: S.map((s, i) => (s.pret == null ? null : { nivel_id: NV(i + 1), pret: s.pret, tara_cod: 'RO' })).filter(Boolean),
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
    profiles: [],
  };
  DB.coloane = {};
  DB.implicite = {};
  KV.date.clear();
  STORAGE.length = 0;
}

// ── Anthropic simulat ─────────────────────────────────────────────────
// ANTHROPIC.mod: 'ok' | 'eroare' (500); ANTHROPIC.raspuns = inputul tool-ului.
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

// ── Mici utilitare de test ───────────────────────────────────────────
const stare = { ok: 0, esec: 0 };
async function test(nume, fn) {
  try { await fn(); stare.ok++; console.log('  ✓ ' + nume); }
  catch (e) { stare.esec++; console.log('  ✗ ' + nume + ' — ' + e.message); }
}
function egal(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} așteptat ${JSON.stringify(b)}, primit ${JSON.stringify(a)}`); }
function adevarat(c, m) { if (!c) throw new Error(m || 'condiție falsă'); }
async function cheama(body, opt = {}) {
  const res = raspuns();
  const req = cerere({ metoda: 'POST', body, token: opt.token || null });
  if (opt.ip) req.headers['x-forwarded-for'] = opt.ip;
  await apiDeviz(req, res);
  return res;
}

// ── Fișiere de test construite în Node ───────────────────────────────
const MARCAJ = 'MYDGPSTEST-46.1234N-27.5678E';
function segment(marker, corp) {
  const b = Buffer.alloc(4);
  b[0] = 0xff; b[1] = marker; b.writeUInt16BE(corp.length + 2, 2);
  return Buffer.concat([b, corp]);
}
// Un APP1 EXIF cu ImageDescription (marcajul) și un IFD GPS (latitudine).
function app1Exif() {
  const desc = Buffer.from(MARCAJ + '\0', 'latin1');
  // TIFF big-endian: antet (8) + IFD0 (2 + 2×12 + 4) + IFD GPS (2 + 2×12 + 4) + valori.
  const ifd0 = 8, gps = ifd0 + 2 + 2 * 12 + 4, valori = gps + 2 + 2 * 12 + 4;
  const t = Buffer.alloc(valori + desc.length + 24);
  t.write('MM', 0, 'latin1'); t.writeUInt16BE(42, 2); t.writeUInt32BE(ifd0, 4);
  t.writeUInt16BE(2, ifd0);
  let o = ifd0 + 2;
  t.writeUInt16BE(0x010e, o); t.writeUInt16BE(2, o + 2); t.writeUInt32BE(desc.length, o + 4); t.writeUInt32BE(valori, o + 8); o += 12;
  t.writeUInt16BE(0x8825, o); t.writeUInt16BE(4, o + 2); t.writeUInt32BE(1, o + 4); t.writeUInt32BE(gps, o + 8); o += 12;
  t.writeUInt32BE(0, o);
  t.writeUInt16BE(2, gps);
  o = gps + 2;
  t.writeUInt16BE(1, o); t.writeUInt16BE(2, o + 2); t.writeUInt32BE(2, o + 4); t.write('N\0', o + 8, 'latin1'); o += 12;
  const rat = valori + desc.length;
  t.writeUInt16BE(2, o); t.writeUInt16BE(5, o + 2); t.writeUInt32BE(3, o + 4); t.writeUInt32BE(rat, o + 8); o += 12;
  t.writeUInt32BE(0, o);
  desc.copy(t, valori);
  [46, 1, 7, 1, 2400, 100].forEach((x, i) => t.writeUInt32BE(x, rat + i * 4));
  return segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t]));
}
// Introduce EXIF (APP1) și APP13 după SOI-ul unui JPEG.
function cuExif(jpeg) {
  const app13 = segment(0xed, Buffer.from('Photoshop 3.0\0' + MARCAJ, 'latin1'));
  return Buffer.concat([jpeg.subarray(0, 2), app1Exif(), app13, jpeg.subarray(2)]);
}
// Un JPEG sintetic (structură de segmente, fără pixeli reali) — pentru testele pe server.
function jpegSintetic(octeti = 2000) {
  const app0 = segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'));
  const dqt = segment(0xdb, Buffer.alloc(65, 1));
  const sof = segment(0xc0, Buffer.from([8, 0, 10, 0, 12, 1, 1, 0x11, 0]));
  const sos = segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0]));
  return cuExif(Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dqt, sof, sos, Buffer.alloc(octeti, 0x55), Buffer.from([0xff, 0xd9])]));
}
function blocPng(tip, date) {
  const len = Buffer.alloc(4); len.writeUInt32BE(date.length);
  const td = Buffer.concat([Buffer.from(tip, 'latin1'), date]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function pngCuMetadate() {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blocPng('IHDR', ihdr),
    blocPng('tEXt', Buffer.from('Comment\0' + MARCAJ, 'latin1')),
    blocPng('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0' + MARCAJ, 'latin1')),
    blocPng('zTXt', Buffer.concat([Buffer.from('Author\0\0', 'latin1'), zlib.deflateSync(Buffer.from(MARCAJ))])),
    blocPng('eXIf', app1Exif().subarray(10)),
    blocPng('IDAT', zlib.deflateSync(Buffer.from([0, 200, 100, 50]))),
    blocPng('IEND', Buffer.alloc(0)),
  ]);
}
function blocWebp(tip, date) {
  const h = Buffer.alloc(8); h.write(tip, 0, 'latin1'); h.writeUInt32LE(date.length, 4);
  return Buffer.concat([h, date, date.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
function webpCuMetadate() {
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x08 | 0x04; // EXIF + XMP
  const corp = Buffer.concat([
    blocWebp('VP8X', vp8x),
    blocWebp('VP8L', Buffer.from([0x2f, 0, 0, 0, 0, 0x07, 0x10, 0x11, 0x08, 0x00, 0x01])),
    blocWebp('EXIF', app1Exif().subarray(10)),
    blocWebp('XMP ', Buffer.from('<x:xmpmeta>' + MARCAJ + '</x:xmpmeta>', 'latin1')),
  ]);
  const h = Buffer.alloc(12); h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(corp.length + 4, 4); h.write('WEBP', 8, 'latin1');
  return Buffer.concat([h, corp]);
}
function pdf(octeti) {
  const cap = Buffer.from('%PDF-1.4\n% test My Darrin\n', 'latin1');
  return Buffer.concat([cap, Buffer.alloc(Math.max(0, octeti - cap.length - 6), 0x20), Buffer.from('\n%%EOF', 'latin1')]);
}
// Dimensiunile unui JPEG (SOFn).
function dimensiuniJpeg(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { inaltime: buf.readUInt16BE(i + 5), latime: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
const areMetadate = (buf) => buf.includes(Buffer.from(MARCAJ, 'latin1')) || buf.includes(Buffer.from('Exif\0\0', 'latin1'));

// ── Chromium ─────────────────────────────────────────────────────────
// Contextul: limba, /api/darrin-ai/deviz servit de handler-ul real (sau de
// `suprascrie` pentru erori simulate), restul rețelei externe oprit.
const NR_CERERE = { n: 0 };
async function context(browser, latime, lang, opt = {}) {
  const inaltime = opt.inaltime || (latime < 720 ? 844 : 900);
  const ctx = await browser.newContext({ viewport: { width: latime, height: inaltime }, hasTouch: latime < 720, isMobile: latime < 720 });
  await ctx.addInitScript((l) => { try { localStorage.setItem('myd_lang_v1', l); localStorage.setItem('myd_cookie_consent_v1', JSON.stringify({ analitice: false, data: new Date().toISOString(), marketing: false, versiune: 2 })); } catch (e) {} }, lang);
  await ctx.route(/supabase\.co\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await ctx.route(/ipapi\.co|nominatim|homebestpal\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  ctx.cereriDeviz = [];
  ctx.suprascrie = null;
  await ctx.route(/\/api\//, async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    if (u.pathname !== '/api/darrin-ai/deviz') return r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' });
    let corp = null; try { corp = JSON.parse(req.postData() || 'null'); } catch (e) { corp = null; }
    ctx.cereriDeviz.push(corp);
    if (ctx.suprascrie) return ctx.suprascrie(r, corp);
    const res = raspuns();
    const c = cerere({ metoda: 'POST', body: corp });
    NR_CERERE.n++;
    c.headers['x-forwarded-for'] = opt.ip || ('10.1.' + ((NR_CERERE.n >> 8) & 255) + '.' + (NR_CERERE.n & 255));
    await apiDeviz(c, res);
    return r.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.corp || {}) });
  });
  return ctx;
}
async function pagina(ctx, baza, adresa) {
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(15000);
  pg.erori = [];
  pg.dialoguri = [];
  pg.on('pageerror', (e) => pg.erori.push(e.message.slice(0, 200)));
  // Orice alert / confirm / prompt pică testul.
  pg.on('dialog', (d) => { pg.dialoguri.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });
  await pg.goto(baza + adresa, { waitUntil: 'load' });
  await pg.waitForTimeout(500);
  return pg;
}
async function captura(dir, pg, nume, el) {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const fisier = path.join(dir, nume + '.png');
  const tinta = el ? await pg.$(el) : null;
  const gata = tinta ? await tinta.screenshot({ path: fisier }).then(() => true, () => false) : false;
  if (!gata) await pg.screenshot({ path: fisier }).catch(() => {});
}
const depasire = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

module.exports = {
  DB, RADACINA, KV, STORAGE, ANTHROPIC, apiDeviz, S, NV, reset, stare, test, egal, adevarat, cheama,
  MARCAJ, cuExif, jpegSintetic, pngCuMetadate, webpCuMetadate, pdf, dimensiuniJpeg, areMetadate,
  context, pagina, captura, depasire,
};
