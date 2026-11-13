// scripts/test-bilingv-date-reale.js
// Pasul 11-T1 (13 nov. 2026): engleza pe datele reale, nu pe datele de test.
// Rulează în modul EN pe răspunsurile reale ale endpoint-urilor publice (implicit
// producția, doar citire — aceleași cereri ca un vizitator):
//   A. /api/public/catalog?lang=en: fiecare produs public are traduceri.en.titlu și
//      traducerea fiecărui câmp afișat (domeniu, descriere, unitate_masura unde diferă);
//   B. nivelurile produselor publice și categoriile (citite ca paginile publice, cu cheia
//      anon din HTML): label și descriere au engleză în dicționarul public
//      /api/public/traduceri-catalog?lang=en; categoriile au title_en;
//   C. textele traduse nu sunt tot în română (aceeași recunoaștere ca detectorul);
//   D. cu --pagini: detectorul de română (scripts/detector-ro.js) în modul EN pe paginile
//      publice, cu produse reale; orice text în română afișat face testul să cadă.
// Excepțiile (nume proprii, orașe, adrese): lista explicită din scripts/recunoaste-ro.js.
//
// Rulare: node scripts/test-bilingv-date-reale.js [--base https://mydarrin.homebestpal.com] [--pagini]
// Până la aplicarea migrării docs/migrations-propuse/2026-11-12_traduceri_en_catalog.sql
// testul cade (126 de produse, 275 de niveluri, 81 de categorii fără engleză).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { eRo, EXCEPTII } = require('./recunoaste-ro');

const arg = process.argv.slice(2);
const opt = (n, d) => { const i = arg.indexOf('--' + n); return i === -1 ? d : arg[i + 1]; };
const BASE = String(opt('base', 'https://mydarrin.homebestpal.com')).replace(/\/$/, '');
const PAGINI = arg.includes('--pagini');
const RADACINA = path.join(__dirname, '..');

let ok = 0, esec = 0;
const lipsuri = { produse: [], niveluri: [], categorii: [], netraduse: [] };
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }
const gol = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const UNITATI_LA_FEL = new Set(['m', 'm²', 'km', 'set', '']);

async function json(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

(async () => {
  console.log(`Sursa: ${BASE} (doar citire)`);
  // Cheia anon publică, din HTML-ul paginii de produs (aceeași pe care o folosesc paginile).
  const html = fs.readFileSync(path.join(RADACINA, 'mydarrin-produs.html'), 'utf8');
  const cheie = (html.match(/SUPABASE_ANON_KEY\s*:\s*['"]([^'"]+)/) || [])[1];
  const url = (html.match(/SUPABASE_URL\s*:\s*['"]([^'"]+)/) || [])[1] || 'https://aacojyvujhywanaulvuu.supabase.co';
  const H = { apikey: cheie, Authorization: 'Bearer ' + cheie };

  console.log('A. Produsele publice (/api/public/catalog?lang=en)');
  const cat = await json(`${BASE}/api/public/catalog?lang=en`);
  const produse = [...(cat.servicii || []), ...(cat.materiale || []), ...(cat.inchirieri || [])];
  verifica(produse.length > 0, 'catalogul public e gol');
  for (const p of produse) {
    const en = (p.traduceri && p.traduceri.en) || {};
    const lipsa = [];
    if (gol(en.titlu)) lipsa.push('titlu');
    if (!gol(p.domeniu) && gol(en.domeniu)) lipsa.push('domeniu');
    if (!gol(p.descriere) && gol(en.descriere)) lipsa.push('descriere');
    if (!UNITATI_LA_FEL.has(p.unitate_masura || '') && gol(en.unitate_masura)) lipsa.push('unitate_masura');
    if (lipsa.length) lipsuri.produse.push(`${p.id_serviciu} (${lipsa.join(', ')}): ${p.titlu}`);
    for (const c of ['titlu', 'domeniu', 'descriere']) if (!gol(en[c]) && eRo(en[c])) lipsuri.netraduse.push(`produs ${p.id_serviciu}.${c}: ${en[c]}`);
  }
  verifica(!lipsuri.produse.length, `${lipsuri.produse.length} din ${produse.length} produse publice fără engleză (ex.: ${lipsuri.produse.slice(0, 3).join(' | ')})`);

  console.log('B. Nivelurile și categoriile (dicționarul public)');
  const dict = (await json(`${BASE}/api/public/traduceri-catalog?lang=en`))._texte || {};
  const niveluri = await json(`${url}/rest/v1/catalog_niveluri?select=id,label,descriere,traduceri,catalog_servicii!inner(status_public)&catalog_servicii.status_public=eq.true`, H);
  for (const n of niveluri) {
    const lipsa = [];
    // Dicționarul public omite textele identice în cele două limbi (ex. „Standard”):
    // acestea sunt acoperite de traduceri.en, completat cu același text (pasul 11-T2).
    const enN = (n.traduceri && n.traduceri.en) || {};
    for (const c of ['label', 'descriere']) if (!gol(n[c]) && !dict[norm(n[c])] && gol(enN[c])) lipsa.push(c);
    if (lipsa.length) lipsuri.niveluri.push(`${n.id} (${lipsa.join(', ')}): ${String(n.descriere || n.label).slice(0, 60)}`);
  }
  verifica(!lipsuri.niveluri.length, `${lipsuri.niveluri.length} din ${niveluri.length} niveluri fără engleză (ex.: ${lipsuri.niveluri.slice(0, 2).join(' | ')})`);
  const categorii = await json(`${url}/rest/v1/categorii?select=id,slug,title,title_en,description`, H);
  for (const c of categorii) {
    const lipsa = [];
    if (gol(c.title_en)) lipsa.push('title_en');
    if (!dict[norm(c.title)]) lipsa.push('title');
    if (!gol(c.description) && !dict[norm(c.description)]) lipsa.push('description');
    if (lipsa.length) lipsuri.categorii.push(`${c.slug} (${lipsa.join(', ')})`);
  }
  verifica(!lipsuri.categorii.length, `${lipsuri.categorii.length} din ${categorii.length} categorii fără engleză (ex.: ${lipsuri.categorii.slice(0, 3).join(' | ')})`);

  console.log('C. Traducerile nu sunt în română');
  for (const [ro, en] of Object.entries(dict)) if (eRo(en)) lipsuri.netraduse.push(`«${ro.slice(0, 40)}» → «${en.slice(0, 60)}»`);
  verifica(!lipsuri.netraduse.length, `${lipsuri.netraduse.length} traduceri încă în română (ex.: ${lipsuri.netraduse.slice(0, 3).join(' | ')})`);

  if (PAGINI) {
    console.log('D. Paginile publice, modul EN, cu date reale (detector-ro.js)');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bilingv-'));
    const pagini = ['mydarrin-catalog', 'mydarrin-catalog.html?categorie=materiale', 'mydarrin-catalog.html?categorie=inchirieri',
      'mydarrin-produs.html?slug=acoperis-sarpanta&type=servicii', 'mydarrin-produs.html?slug=montaj-parchet-laminat&type=servicii',
      'mydarrin-produs.html?slug=mat-acoperis&type=materiale', 'mydarrin-marketplace', 'mydarrin-cos', 'mydarrin-checkout', 'index'];
    try { execFileSync(process.execPath, [path.join(__dirname, 'detector-ro.js'), '--base', BASE, '--out', out, ...pagini], { stdio: 'pipe', timeout: 900000 }); } catch (e) { /* codul 1 = texte găsite; rezultatul e în JSON */ }
    const rez = JSON.parse(fs.readFileSync(path.join(out, 'detector-en.json'), 'utf8'));
    for (const r of rez) {
      const unice = [...new Set((r.gasite || []).map((g) => g.text))];
      verifica(r.randata && !unice.length, `${r.pg} ${r.w}px: ${r.randata ? unice.length + ' texte în română (ex.: ' + unice.slice(0, 3).join(' | ') + ')' : 'nerandată'}`);
    }
  }

  console.log(`\nExcepții (nu se traduc): ${EXCEPTII.length} intrări în scripts/recunoaste-ro.js`);
  console.log(`${ok} verificări trecute, ${esec} eșuate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
