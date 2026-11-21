#!/usr/bin/env node
// Rulează suita de teste (scripts/test-*.js) și afișează doar rezumatul:
// testele picate, cu primele rânduri de eroare, plus totalul.
//
// Folosire:
//   node scripts/ruleaza-teste.js                  toată suita
//   node scripts/ruleaza-teste.js pret alocare     doar testele care conțin „pret” sau „alocare” în nume
//   node scripts/ruleaza-teste.js --complet        ieșirea completă a testelor picate (doar la cerere)
//   node scripts/ruleaza-teste.js --paralel 2      câte teste rulează deodată (implicit 4)
//   node scripts/ruleaza-teste.js --randuri 15     câte rânduri de eroare se arată (implicit 8)
//   node scripts/ruleaza-teste.js --timeout 300    secunde maxime pe test (implicit 240)
// Variabilele de mediu (de exemplu FARA_BROWSER=1) trec mai departe la teste.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const RADACINA = path.join(DIR, '..');

const arg = process.argv.slice(2);
const opt = { complet: false, paralel: 4, randuri: 8, timeout: 240, filtre: [] };
for (let i = 0; i < arg.length; i++) {
  const a = arg[i];
  if (a === '--complet') opt.complet = true;
  else if (a === '--paralel') opt.paralel = Math.max(1, parseInt(arg[++i], 10) || 1);
  else if (a === '--randuri') opt.randuri = Math.max(1, parseInt(arg[++i], 10) || 8);
  else if (a === '--timeout') opt.timeout = Math.max(10, parseInt(arg[++i], 10) || 240);
  else opt.filtre.push(a.replace(/^scripts[\\/]/, '').replace(/\.js$/, '').toLowerCase());
}

const toate = fs.readdirSync(DIR).filter((f) => /^test-.*\.js$/.test(f)).sort();
const teste = opt.filtre.length ? toate.filter((f) => opt.filtre.some((x) => f.toLowerCase().includes(x))) : toate;
if (!teste.length) {
  console.log('Niciun test nu se potrivește cu: ' + opt.filtre.join(', '));
  process.exit(1);
}

// Rândurile care arată o eroare, în convențiile testelor din proiect.
const SEMN_EROARE = /✗|✕|\bFAIL|\bpicat|Error|Eroare|AssertionError|at .+:\d+:\d+|Timeout/i;
const FARA_CULORI = /\x1b\[[0-9;]*m/g;

function ruleaza(fisier) {
  return new Promise((gata) => {
    const start = Date.now();
    const p = spawn(process.execPath, [path.join(DIR, fisier)], { cwd: RADACINA, env: process.env });
    let iesire = '';
    p.stdout.on('data', (d) => { iesire += d; });
    p.stderr.on('data', (d) => { iesire += d; });
    let expirat = false;
    const t = setTimeout(() => { expirat = true; p.kill('SIGKILL'); }, opt.timeout * 1000);
    p.on('close', (cod) => {
      clearTimeout(t);
      gata({ fisier, cod: expirat ? 'timeout' : cod, iesire: iesire.replace(FARA_CULORI, ''), sec: (Date.now() - start) / 1000 });
    });
  });
}

function totaluri(iesire) {
  // Ultimul rând de forma „N trecute, M picate” (sau „N ok, M eșuate”), dacă există.
  const m = [...iesire.matchAll(/(\d+)\s*(?:trecute|ok|passed)\D{1,12}(\d+)\s*(?:picate|e[șs]uate|failed)/gi)].pop();
  return m ? { trecute: +m[1], picate: +m[2] } : null;
}

(async () => {
  const start = Date.now();
  const rezultate = [];
  let urmator = 0;
  async function lucrator() {
    while (urmator < teste.length) {
      const f = teste[urmator++];
      rezultate.push(await ruleaza(f));
      process.stdout.write('.');
    }
  }
  await Promise.all(Array.from({ length: Math.min(opt.paralel, teste.length) }, lucrator));
  process.stdout.write('\n');

  const picate = rezultate.filter((r) => r.cod !== 0).sort((a, b) => a.fisier.localeCompare(b.fisier));
  let verificariOk = 0, verificariPicate = 0;
  for (const r of rezultate) {
    const t = totaluri(r.iesire);
    if (t) { verificariOk += t.trecute; verificariPicate += t.picate; }
  }

  for (const r of picate) {
    const t = totaluri(r.iesire);
    const cauza = r.cod === 'timeout' ? `depășit ${opt.timeout} s` : `cod ${r.cod}`;
    console.log(`\n✗ ${r.fisier} (${cauza}${t ? `, ${t.picate} picate din ${t.trecute + t.picate}` : ''})`);
    const randuri = r.iesire.split(/\r?\n/).filter((l) => l.trim());
    if (opt.complet) {
      console.log(randuri.map((l) => '    ' + l).join('\n'));
    } else {
      let erori = randuri.filter((l) => SEMN_EROARE.test(l) && !/\b0 picate\b/.test(l));
      if (!erori.length) erori = randuri.slice(-opt.randuri);
      for (const l of erori.slice(0, opt.randuri)) console.log('    ' + l.trim().slice(0, 240));
      if (erori.length > opt.randuri) console.log(`    … încă ${erori.length - opt.randuri} rânduri (--complet pentru tot)`);
    }
  }

  const durata = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\nTotal: ${rezultate.length} teste, ${rezultate.length - picate.length} trecute, ${picate.length} picate` +
    ` (verificări: ${verificariOk} trecute, ${verificariPicate} picate) — ${durata} s`);
  process.exit(picate.length ? 1 : 0);
})();
