// scripts/raport-imagini-catalog.js
// Pasul 11-C7 (5 nov. 2026): raportul de acoperire al imaginilor de prezentare din
// catalog. Listează toate produsele publice (catalog_servicii, status_public) cu
// imaginea aleasă și motivul: real / subiect: X / domeniu / implicit — cu exact
// logica din mydarrin-catalog.html (harta DOM, VARIANTE, SUBIECTE, imaginiPrezentare).
// Doar citire (cheia publică din pagină). Nu modifică nimic.
//
// Rulare: node scripts/raport-imagini-catalog.js            (tabel + rezumat)
//         node scripts/raport-imagini-catalog.js --json     (JSON)

const fs = require('fs');
const path = require('path');
const https = require('https');

const CATALOG = fs.readFileSync(path.join(__dirname, '..', 'mydarrin-catalog.html'), 'utf8');

// Logica de alegere a imaginii, așa cum e în pagină (de la harta DOM până la
// distribuieImagini, care lucrează pe DOM-ul paginii și nu e necesară aici).
function incarcaLogica(sursa = CATALOG) {
  const a = sursa.indexOf('const DOM = {');
  const b = sursa.indexOf('function distribuieImagini(');
  if (a < 0 || b < 0) throw new Error('nu găsesc logica imaginilor în mydarrin-catalog.html');
  return new Function(sursa.slice(a, b) + '\nreturn { DOM, IMG_DEF, VARIANTE, SUBIECTE, normTitlu, subiectDin, imaginiPrezentare, imgDomeniu };')();
}

function cere(url, optiuni = {}) {
  return new Promise((rez, resp) => {
    const r = https.request(url, Object.assign({ timeout: 15000 }, optiuni), (res) => {
      let corp = ''; res.on('data', (d) => { corp += d; }); res.on('end', () => rez({ status: res.statusCode, corp }));
    });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', resp); r.end();
  });
}

async function produsePublice() {
  const url = (CATALOG.match(/SUPABASE_URL\s*=[^\n]*\|\|\s*'([^']+)'/) || [])[1];
  const cheie = (CATALOG.match(/SUPABASE_ANON_KEY\s*=[^\n]*\|\|\s*'([^']+)'/) || [])[1];
  if (!url || !cheie) throw new Error('lipsește cheia publică în pagină');
  const r = await cere(`${url}/rest/v1/catalog_servicii?status_public=eq.true&select=id,id_serviciu,titlu,categorie,domeniu,imagini&order=categorie.asc,titlu.asc`,
    { headers: { apikey: cheie, Authorization: 'Bearer ' + cheie, Range: '0-4999' } });
  if (r.status !== 200 && r.status !== 206) throw new Error('baza de date: ' + r.status);
  return JSON.parse(r.corp);
}

// Imaginea și motivul pentru fiecare produs (fără vecini: prima variantă, stabilă).
function alege(L, produse) {
  return produse.map((p) => {
    const real = Array.isArray(p.imagini) && p.imagini.length ? p.imagini[0] : null;
    const d = L.DOM[p.domeniu] || { cat: 'Instalații', sub: 'General', img: L.IMG_DEF };
    const prez = L.imaginiPrezentare(p, d);
    return {
      categorie: p.categorie, domeniu: p.domeniu, id_serviciu: p.id_serviciu, titlu: p.titlu,
      motiv: real ? 'real' : prez.sursa, imagine: real || prez.ids[0], variante: real ? [] : prez.ids,
    };
  });
}

function rezumat(randuri) {
  const pe = {};
  randuri.forEach((r) => { const k = r.motiv === 'domeniu' ? 'domeniu: ' + r.domeniu : r.motiv; (pe[k] = pe[k] || []).push(r); });
  return pe;
}

module.exports = { incarcaLogica, produsePublice, alege, rezumat };

if (require.main === module) {
  (async () => {
    const L = incarcaLogica();
    const randuri = alege(L, await produsePublice());
    if (process.argv.includes('--json')) { console.log(JSON.stringify(randuri, null, 1)); return; }
    for (const r of randuri) console.log(`${r.categorie.padEnd(10)} ${r.titlu.slice(0, 60).padEnd(61)} ${r.motiv.padEnd(28)} ${r.imagine.slice(0, 60)}`);
    const pe = rezumat(randuri);
    const n = (f) => randuri.filter(f).length;
    console.log(`\nTotal: ${randuri.length} · real: ${n((r) => r.motiv === 'real')} · subiect: ${n((r) => r.motiv.startsWith('subiect:'))} · domeniu: ${n((r) => r.motiv === 'domeniu')} · implicit: ${n((r) => r.motiv === 'implicit')}`);
    console.log('\nPe motiv (produse · fotografii):');
    Object.keys(pe).sort().forEach((k) => console.log(`  ${k.padEnd(52)} ${String(pe[k].length).padStart(3)} · ${new Set(pe[k].flatMap((r) => r.variante.length ? r.variante : [r.imagine])).size}`));
    console.log('\nRămase pe domeniu sau pe implicit:');
    randuri.filter((r) => r.motiv === 'domeniu' || r.motiv === 'implicit').forEach((r) => console.log(`  ${r.categorie.padEnd(10)} ${r.titlu}  (${r.domeniu})`));
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
