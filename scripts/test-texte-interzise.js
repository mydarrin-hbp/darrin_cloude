// scripts/test-texte-interzise.js
// Textele interzise pe paginile publice după deciziile LM din 17 oct. 2026
// (pasul 11-A; docs/decizii/2026-10-17_decizii_LM_RO.md): caută în toate
// fișierele HTML ale site-ului (fără paginile interne, care rămân în română
// și nu sunt publice) și în dicționarele i18n/en/*.json.
//
// Pasul 11-J (21 oct. 2026): valorile rundei scrise de mână (EVAL_PARAMS,
// cursul „5 Lei/EUR”, „0.05 EUR”, „10M emise”, „min. 25.000 EUR”) — căutate și
// în paginile interne (back-office), în i18n/*.json și în fișierele .js de
// pagină, din api/ și din lib/ (REGULI_RUNDA).
//
// Pasul 11-N1 (22 oct. 2026): ferestrele native alert( și confirm( în
// mydarrin-superadmin.html — feedbackul trece prin MDFeedback (ui-feedback.js).
//
// Rezultat așteptat: 0 potriviri. Fiecare potrivire se afișează cu fișierul,
// linia și fragmentul găsit.
//
// Rulare: node scripts/test-texte-interzise.js

const fs = require('fs');
const path = require('path');

const RADACINA = path.join(__dirname, '..');

// Paginile interne (superadmin, back-office, documentație tehnică) — aceeași
// listă ca în i18n-loader.js (INTERNE); nu sunt pagini publice.
const INTERNE = /^mydarrin-(superadmin|backoffice-serviciu|deviz-engine|auth-schema|sync-architecture|business-model|design-system)\.html$/;

// [eticheta, expresie]. „lângă” = în aceeași frază (fără punct între ele).
const REGULI = [
  ['pre-autorizat', /pre-?autoriz/i],
  ['pre-authori', /pre-?authori/i],
  ['card blocat', /card(ul)? blocat/i],
  ['RO · MD · DE · FR · BG', /RO\s*·\s*MD\s*·\s*DE\s*·\s*FR\s*·\s*BG/],
  ['ACA BG', /ACA\s+BG|ACA BUSINESS/i],
  ['32667674', /32667674/],
  ['SMS', /\bSMS\b/],
  ['WooCommerce', /WooCommerce/i],
  ['Shopify', /Shopify/i],
  ['„verificat” lângă integrări', /(integr|plugin|PrestaShop|Magento)[^.<]{0,60}verifica?t|verifica?t[^.<]{0,60}(integr|plugin|PrestaShop|Magento)/i],
  ['5 zile lucrătoare', /5 zile lucr[ăa]toare|5 (working|business) days/i],
  ['48h / 48 de ore lângă confirmare', /(48\s?h\b|48 de ore|48 hours)[^.<]{0,80}confirm|confirm[^.<]{0,80}(48\s?h\b|48 de ore|48 hours)/i],
  ['KPIs Live', /KPIs?\s+Live/i],
  ['284.000', /284[.,]000/],
  ['ANRGN', /ANRGN/],
  ['Home Best Pal – UK', /Home Best Pal(<\/strong>)?\s*(&nbsp;)?\s*(–|&ndash;|-)\s*(&nbsp;)?\s*UK/i],
];

// Pasul 11-J: cifrele rundei vin doar din runde_finantare (back-office).
const REGULI_RUNDA = [
  ['EVAL_PARAMS', /EVAL_PARAMS/],
  ['5 Lei/EUR', /5\s*Lei\s*\/\s*EUR/i],
  ['0.05 EUR', /0[.,]05\s*(EUR|€)|€\s*0[.,]05\b/],
  ['10M emise / 10M issued', /10\s?M\s+(emise|issued)/i],
  ['min. €25,000 / min. 25.000 EUR', /min\.?\s*(€\s*25[.,]000|25[.,]000\s*(EUR|€))/i],
];

// Excepții explicite (afișate separat, nu se numără):
//  - comentariile de cod (`// …`) nu sunt text afișat;
//  - verificarea numărului de telefon din contul clientului trimite un cod
//    prin Supabase Auth (account-system.js: updateUser({ phone }) +
//    verifyOtp) — flux real de cont, nu notificări SMS promise.
const EXCEPTII = [
  { fisier: /^mydarrin-dashboard-client\.html$|mydarrin-dashboard-client\.json$/, eticheta: 'SMS',
    motiv: 'codul de verificare a telefonului (Supabase Auth)' },
];
function esteExceptie(rel, linie, eticheta) {
  if (/^\s*\/\//.test(linie)) return 'comentariu de cod';
  const e = EXCEPTII.find((x) => x.eticheta === eticheta && x.fisier.test(path.basename(rel)));
  return e ? e.motiv : null;
}

function fisiere() {
  const html = fs.readdirSync(RADACINA).filter((f) => f.endsWith('.html') && !INTERNE.test(f));
  const en = fs.readdirSync(path.join(RADACINA, 'i18n', 'en')).filter((f) => f.endsWith('.json')).map((f) => path.join('i18n', 'en', f));
  return html.concat(en);
}

function fisiereRunda() {
  const html = fs.readdirSync(RADACINA).filter((f) => f.endsWith('.html'));
  const js = fs.readdirSync(RADACINA).filter((f) => f.endsWith('.js'));
  const i18n = fs.readdirSync(path.join(RADACINA, 'i18n')).filter((f) => f.endsWith('.json')).map((f) => path.join('i18n', f))
    .concat(fs.readdirSync(path.join(RADACINA, 'i18n', 'en')).filter((f) => f.endsWith('.json')).map((f) => path.join('i18n', 'en', f)));
  const dinDosar = (d) => {
    const iesire = [];
    for (const e of fs.readdirSync(path.join(RADACINA, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) iesire.push(...dinDosar(rel));
      else if (e.name.endsWith('.js')) iesire.push(rel);
    }
    return iesire;
  };
  return html.concat(js, i18n, dinDosar('api'), dinDosar('lib'));
}

// Pasul 11-N1: în superadmin, fără ferestre native (inclusiv window.alert / window.confirm).
const REGULI_FEEDBACK = [
  ['alert(', /\balert\s*\(/],
  ['confirm(', /\bconfirm\s*\(/],
];
const FISIERE_FEEDBACK = ['mydarrin-superadmin.html'];

let total = 0;
let exceptii = 0;
const peRegula = {};
for (const rel of fisiere()) {
  const linii = fs.readFileSync(path.join(RADACINA, rel), 'utf8').split(/\r?\n/);
  linii.forEach((linie, i) => {
    for (const [eticheta, re] of REGULI) {
      const m = re.exec(linie);
      if (!m) continue;
      const exceptie = esteExceptie(rel, linie, eticheta);
      if (exceptie) { exceptii++; console.log(`  · excepție ${rel}:${i + 1} [${eticheta}] — ${exceptie}`); continue; }
      total++;
      peRegula[eticheta] = (peRegula[eticheta] || 0) + 1;
      const start = Math.max(0, m.index - 40);
      console.log(`  ✗ ${rel}:${i + 1} [${eticheta}] …${linie.slice(start, m.index + m[0].length + 40).trim()}…`);
    }
  });
}

for (const rel of fisiereRunda()) {
  const linii = fs.readFileSync(path.join(RADACINA, rel), 'utf8').split(/\r?\n/);
  linii.forEach((linie, i) => {
    for (const [eticheta, re] of REGULI_RUNDA) {
      const m = re.exec(linie);
      if (!m) continue;
      total++;
      peRegula[eticheta] = (peRegula[eticheta] || 0) + 1;
      const start = Math.max(0, m.index - 40);
      console.log(`  ✗ ${rel}:${i + 1} [${eticheta}] …${linie.slice(start, m.index + m[0].length + 40).trim()}…`);
    }
  });
}

for (const rel of FISIERE_FEEDBACK) {
  const linii = fs.readFileSync(path.join(RADACINA, rel), 'utf8').split(/\r?\n/);
  linii.forEach((linie, i) => {
    for (const [eticheta, re] of REGULI_FEEDBACK) {
      const m = re.exec(linie);
      if (!m) continue;
      total++;
      peRegula[eticheta] = (peRegula[eticheta] || 0) + 1;
      const start = Math.max(0, m.index - 40);
      console.log(`  ✗ ${rel}:${i + 1} [${eticheta}] …${linie.slice(start, m.index + m[0].length + 40).trim()}…`);
    }
  });
}

console.log('\nFișiere verificate: ' + fisiere().length + ' (HTML publice + i18n/en/*.json)');
for (const [eticheta] of REGULI) console.log(`  ${eticheta}: ${peRegula[eticheta] || 0}`);
console.log('Valorile rundei (11-J): ' + fisiereRunda().length + ' fișiere (toate HTML, i18n, .js de pagină, api/, lib/), inclusiv comentariile');
for (const [eticheta] of REGULI_RUNDA) console.log(`  ${eticheta}: ${peRegula[eticheta] || 0}`);
console.log('Ferestre native (11-N1): ' + FISIERE_FEEDBACK.join(', '));
for (const [eticheta] of REGULI_FEEDBACK) console.log(`  ${eticheta}: ${peRegula[eticheta] || 0}`);
console.log(`\nTOTAL potriviri: ${total}`);
process.exit(total ? 1 : 0);
