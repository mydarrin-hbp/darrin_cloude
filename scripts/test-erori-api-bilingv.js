// scripts/test-erori-api-bilingv.js
// Pasul 11-T2: fiecare răspuns de eroare din api/ (și din lib/, unde se
// trimit răspunsuri) trece prin trimiteEroare / trimiteEroareInterna, cu
// mesaj RO + EN. Scanare statică, fără rețea.
//
// Cade dacă găsește:
//   - res.status(4xx|5xx) scris direct, res.status(<expresie>).json(...) sau res.sendStatus(4xx|5xx);
//   - trimiteEroare(...) fără mesajul RO sau fără mesajul EN;
//   - un mesaj EN identic cu cel RO sau scris în română;
//   - un `cod` literal care nu e cu litere mari, fără diacritice.
//
// Excepțiile: doar lista EXCEPTII de mai jos, fiecare cu motivul ei.
// Rulare: node scripts/test-erori-api-bilingv.js

const fs = require('fs');
const path = require('path');
const { hartaCod, inchide, argumente, scaneazaText, fisiereApi, linie } = require('./scaneaza-erori-api');
const { eRo } = require('./recunoaste-ro');

const R = path.join(__dirname, '..');

// Excepții explicite: { fisier, tip, motiv }. Azi nu e nevoie de niciuna:
// webhook-urile (api/email/webhook-primire.js) răspund doar cu un status
// citit de furnizor, iar forma JSON comună nu îl încurcă.
const EXCEPTII = [];

let esec = 0, ok = 0;
function verifica(cond, msg) {
  if (cond) { ok++; } else { esec++; console.log('  ✕ ' + msg); }
}

const SIR = /^(['"`])([\s\S]*)\1$/;
function textLiteral(a) {
  const m = SIR.exec(a || '');
  if (!m) return null;
  if (m[1] === '`' && /\$\{/.test(m[2])) return m[2].replace(/\$\{[^}]*\}/g, 'X');
  return m[2];
}

function abateriLiterale(s) {
  const cod = hartaCod(s);
  const rez = [];
  const re = /\btrimiteEroare(?:Interna)?\s*\(/g;
  let m;
  while ((m = re.exec(s))) {
    if (!cod[m.index]) continue;
    if (/function\s+$/.test(s.slice(Math.max(0, m.index - 12), m.index))) continue;
    const d = m.index + m[0].length - 1;
    const i = inchide(s, cod, d);
    if (i < 0) continue;
    const a = argumente(s, cod, d + 1, i);
    const ln = linie(s, m.index);
    const interna = m[0].startsWith('trimiteEroareInterna');
    if (interna && a.length < 6) rez.push({ linie: ln, tip: 'interna-fara-detaliu', text: s.slice(m.index, i + 1) });
    const c = textLiteral(a[2]);
    if (c !== null && !/^[A-Z0-9_]+$/.test(c)) rez.push({ linie: ln, tip: 'cod-invalid', text: a[2] });
    const ro = textLiteral(a[3]), en = textLiteral(a[4]);
    if (ro !== null && en !== null && ro.trim() === en.trim()) rez.push({ linie: ln, tip: 'ro-egal-en', text: a[3] });
    // Numele de câmpuri și de parametri (id_serviciu, mod=servicii, ?path=/x) nu sunt text în română.
    const enText = en === null ? null : en.replace(/[\w.]*[_=/?:][\w.=/?:|-]*/g, ' ').replace(/\b[a-z]+_[a-z_]+\b/g, ' ');
    if (enText !== null && eRo(enText)) rez.push({ linie: ln, tip: 'en-in-romana', text: a[4] });
    if (interna && a[3] === 'null' && a[4] !== 'null') rez.push({ linie: ln, tip: 'interna-en-fara-ro', text: a[4] });
  }
  return rez;
}

// 1. Detectorul prinde abaterile (probă pe exemple scrise aici).
console.log('Detectorul pe exemple:');
const EXEMPLE_RELE = [
  ["return res.status(400).json({ error: 'id lipsă' });", 'status-direct'],
  ["res.status(cod).json({ error: x });", 'status-variabil'],
  ["res.sendStatus(404);", 'sendStatus'],
  ["return trimiteEroare(res, 400, 'X', 'Câmp lipsă');", 'fara-en'],
  ["return trimiteEroare(res, 400, 'X', 'Câmp lipsă', null);", 'fara-en'],
];
for (const [cod, tip] of EXEMPLE_RELE) {
  const a = scaneazaText(cod);
  verifica(a.length === 1 && a[0].tip === tip, `prinde „${cod}” ca ${tip} (a găsit ${JSON.stringify(a.map((x) => x.tip))})`);
}
verifica(abateriLiterale("trimiteEroare(res, 400, 'X', 'Câmp lipsă', 'Câmp lipsă')").some((x) => x.tip === 'ro-egal-en'), 'prinde EN identic cu RO');
verifica(abateriLiterale("trimiteEroare(res, 400, 'X', 'Câmp lipsă', 'Câmpul lipsește din formular')").some((x) => x.tip === 'en-in-romana'), 'prinde EN scris în română');
verifica(abateriLiterale("trimiteEroare(res, 400, 'cod_mic', 'Câmp lipsă', 'Missing field')").some((x) => x.tip === 'cod-invalid'), 'prinde codul cu litere mici');
const EXEMPLE_BUNE = [
  "return res.status(200).json({ ok: true });",
  "return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'id este obligatoriu', 'id is required.', ['id']);",
  "const s = 'res.status(500).json({ error: x })'; // res.status(400)",
  "return trimiteEroare(res, 404, 'NU_EXISTA', `Comanda ${id} nu există`, `Order ${id} does not exist`);",
];
for (const cod of EXEMPLE_BUNE) {
  verifica(scaneazaText(cod).length === 0 && abateriLiterale(cod).length === 0, `acceptă „${cod.slice(0, 70)}”`);
}

// 2. Toate fișierele din api/ și lib/.
console.log('\nScanarea api/ și lib/:');
const fisiere = fisiereApi(R);
for (const f of fs.readdirSync(path.join(R, 'lib')).sort()) {
  if (f.endsWith('.js') && f !== 'raspuns-eroare.js') fisiere.push(path.join(R, 'lib', f));
}
const abateri = [];
let raspunsuri = 0;
for (const f of fisiere) {
  const rel = path.relative(R, f).replace(/\\/g, '/');
  const s = fs.readFileSync(f, 'utf8');
  raspunsuri += (s.match(/\btrimiteEroare(?:Interna)?\s*\(/g) || []).length;
  for (const a of scaneazaText(s).concat(abateriLiterale(s))) {
    const exc = EXCEPTII.find((e) => e.fisier === rel && e.tip === a.tip);
    if (exc) continue;
    abateri.push(rel + ':' + a.linie + '  ' + a.tip + '  ' + String(a.text).replace(/\s+/g, ' ').slice(0, 120));
  }
}
for (const a of abateri) console.log('  ✕ ' + a);
verifica(abateri.length === 0, `0 abateri în ${fisiere.length} fișiere (găsite: ${abateri.length})`);
verifica(raspunsuri > 700, `răspunsurile de eroare trec prin forma comună (${raspunsuri} apeluri)`);
for (const e of EXCEPTII) verifica(e.motiv && e.motiv.length > 20 && fs.existsSync(path.join(R, e.fisier)), 'excepția are motiv și fișierul există: ' + e.fisier);

// 3. Forma comună: mesaj { ro, en } și câmpurile date doar ca nume.
console.log('\nForma comună:');
const { corpEroare, trimiteEroareInterna, MESAJ_SERVER } = require('../lib/raspuns-eroare');
const c = corpEroare('CAMP_OBLIGATORIU', 'id este obligatoriu', 'id is required.', ['id']);
verifica(c.ok === false && c.mesaj.ro === 'id este obligatoriu' && c.mesaj.en === 'id is required.', 'mesaj { ro, en }');
verifica(c.campuri.length === 1 && c.campuri[0].camp === 'id' && c.campuri[0].mesaj.en === 'id is required.', 'câmpul dat ca nume primește mesajul RO + EN');
verifica(c.error === 'id este obligatoriu' && c.error_en === 'id is required.', 'păstrează error / error_en pentru paginile vechi');
const jurnal = [];
const errOrig = console.error;
console.error = (...x) => jurnal.push(x.join(' '));
let trimis = null;
const resFals = { status(s) { this.s = s; return this; }, json(b) { trimis = { s: this.s, b }; return this; } };
trimiteEroareInterna(resFals, 500, 'EROARE_SERVER', null, null, new Error('relation "partners" does not exist'));
console.error = errOrig;
verifica(trimis.s === 500 && trimis.b.mesaj.ro === MESAJ_SERVER.ro && trimis.b.mesaj.en === MESAJ_SERVER.en, 'eroarea internă primește mesajul generic RO + EN');
verifica(!JSON.stringify(trimis.b).includes('partners'), 'detaliul tehnic nu ajunge în răspuns');
verifica(jurnal.some((x) => x.includes('partners')), 'detaliul tehnic ajunge în log');

console.log(`\n${ok} verificări trec, ${esec} cad.`);
process.exit(esec ? 1 : 0);
