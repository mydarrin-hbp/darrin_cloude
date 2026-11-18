// scripts/test-deviz-engine-exemplu.js
// Pasul 12-D1 (18 nov. 2026): testul anti-derivă al exemplelor din
// mydarrin-deviz-engine.html. Recalculează cu aplicaFormulaPret (lib/calculeaza-pret.js,
// aceeași funcție ca la comenzi) și compară cu cifrele scrise în pagină:
//   A. exemplul „înlocuire calorifer · România” (#exemplu-calorifer): fiecare
//      sumă marcată cu data-ex, procentele (data-ex-pct) și structura prețului
//      final (data-ex-struct + lățimea barelor);
//   B. exemplul pragului minim (#exemplu-prag): 2 m² × 45 Lei, sub pragul RO;
//   C. textele formulei: comisionul pe costul de bază, asigurarea inclusă,
//      fără vechiul „subtotal × comision” și fără „Formula în 5 pași”;
//   D. simulatorul din pagină (simCalc), rulat într-un context izolat, dă
//      același preț ca aplicaFormulaPret.
// Configurarea e simulată cu procentele RO din backoffice_config citite la
// 18 nov. 2026: asigurare 1%, comision 12%, marketing 3%, mentenanță 2%,
// TVA 21%, prag minim 150. Orice schimbare a formulei care nu actualizează
// pagina pică testul.
// Rulare: node scripts/test-deviz-engine-exemplu.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { RADACINA } = sim;
const { aplicaFormulaPret } = require(path.join(RADACINA, 'lib/calculeaza-pret.js'));

const CFG = {
  tara: 'RO',
  cost_asigurare_pct: 1,
  pricing: { comision_platforma_default_pct: 12, cost_marketing_pct: 3, cost_mentenanta_pct: 2 },
  tva_decimal: 0.21,
  prag_minim_comanda: 150,
};

const html = fs.readFileSync(path.join(RADACINA, 'mydarrin-deviz-engine.html'), 'utf8');
let esecuri = 0;
let total = 0;
function verifica(conditie, mesaj) {
  total++;
  if (conditie) console.log('  ✓ ' + mesaj);
  else { esecuri++; console.log('  ✕ ' + mesaj); }
}
const numar = (t) => Number(String(t).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;

// Blocul unui element după id: de la deschidere până la închiderea lui (div/span).
function bloc(id) {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) throw new Error(`lipsește #${id} din pagină`);
  const deschidere = html.lastIndexOf('<', start);
  const tag = html.slice(deschidere + 1).match(/^\w+/)[0];
  let adancime = 0;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  re.lastIndex = deschidere;
  let m;
  while ((m = re.exec(html))) {
    adancime += m[1] ? -1 : 1;
    if (adancime === 0) return html.slice(deschidere, re.lastIndex);
  }
  throw new Error(`#${id} nu se închide`);
}
function valori(fragment, atribut) {
  const rez = {};
  const re = new RegExp(`${atribut}="([a-z_]+)"[^>]*>([^<]+)<`, 'g');
  let m;
  while ((m = re.exec(fragment))) rez[m[1]] = m[2].trim();
  return rez;
}
function compara(asteptat, scris, eticheta) {
  verifica(scris !== undefined && Math.abs(numar(scris) - asteptat) < 0.005,
    `${eticheta}: pagina „${scris}” = ${asteptat.toFixed(2)} (aplicaFormulaPret)`);
}

// ── A. Exemplul calorifer ────────────────────────────────────────────
console.log('A. Exemplul „înlocuire calorifer · România”');
const calorifer = bloc('exemplu-calorifer');
const ex = valori(calorifer, 'data-ex');
const pct = valori(calorifer, 'data-ex-pct');
const manopera = numar(ex.manopera);
const materiale = numar(ex.material_calorifer) + numar(ex.material_fitinguri);
const curier = numar(ex.cost_curier);
verifica(manopera === 520 && materiale === 395 && curier === 88, 'intrările exemplului: manoperă 520, materiale 310 + 85, curier 88');
const c = aplicaFormulaPret({ cost_baza_servicii: manopera, cost_materiale: materiale, cost_curier: curier }, CFG);
const totalFaraTva = r2(c.subtotal + c.cost_marketing + c.cost_mentenanta + c.comision_platforma);
compara(c.cost_baza, ex.cost_baza, 'cost de bază');
compara(c.cost_asigurare, ex.cost_asigurare, 'asigurare 1% din costul de bază');
compara(c.subtotal, ex.subtotal, 'subtotal');
compara(c.cost_marketing, ex.cost_marketing, 'marketing 3% din subtotal');
compara(c.cost_mentenanta, ex.cost_mentenanta, 'mentenanță 2% din subtotal');
compara(c.comision_platforma, ex.comision_platforma, 'comision 12% din costul de bază');
compara(totalFaraTva, ex.total_fara_tva, 'total fără TVA');
compara(c.tva_suma, ex.tva_suma, 'TVA 21%');
compara(c.prag_minim_comanda, ex.prag_minim_comanda, 'prag minim RO');
compara(c.pret_final, ex.pret_final, 'preț final');
verifica(c.pret_final === 1418.79, `prețul final cerut de LM: 1.418,79 Lei (calculat ${c.pret_final})`);
verifica(Number(pct.asigurare) === CFG.cost_asigurare_pct && Number(pct.comision) === CFG.pricing.comision_platforma_default_pct
  && Number(pct.marketing) === CFG.pricing.cost_marketing_pct && Number(pct.mentenanta) === CFG.pricing.cost_mentenanta_pct
  && Number(pct.tva) === Math.round(CFG.tva_decimal * 100), 'procentele scrise în exemplu = configurarea (1 / 12 / 3 / 2 / 21)');

const structura = bloc('exemplu-structura');
const st = valori(structura, 'data-ex-struct');
const parti = {
  resurse: c.cost_baza + c.cost_curier,
  asigurare: c.cost_asigurare,
  marketing_mentenanta: c.cost_marketing + c.cost_mentenanta,
  comision: c.comision_platforma,
  tva: c.tva_suma,
};
let suma = 0;
for (const [cheie, val] of Object.entries(parti)) {
  const p = r1((val / c.pret_final) * 100);
  suma += p;
  verifica(st[cheie] !== undefined && Math.abs(numar(st[cheie]) - p) < 0.05, `structură ${cheie}: „${st[cheie]}” = ${p.toFixed(1)}%`);
}
verifica(Math.abs(suma - 100) < 0.15, `structura însumează 100% (${suma.toFixed(1)}%)`);
const latimi = [...structura.matchAll(/style="width:([\d.]+)%"/g)].map((m) => Number(m[1]));
const asteptate = Object.values(parti).map((val) => r1((val / c.pret_final) * 100));
verifica(JSON.stringify(latimi) === JSON.stringify(asteptate), `lățimea barelor = procentele (${latimi.join(' / ')})`);

// ── B. Exemplul pragului minim ───────────────────────────────────────
console.log('B. Exemplul pragului minim (2 m² × 45 Lei)');
const prag = valori(bloc('exemplu-prag'), 'data-ex');
const p = aplicaFormulaPret({ cost_baza_servicii: 90 }, CFG);
const pFara = aplicaFormulaPret({ cost_baza_servicii: 90 }, CFG, undefined, { cuPragMinim: false });
compara(p.cost_baza, prag.cost_baza, 'cost de bază');
compara(p.cost_asigurare, prag.cost_asigurare, 'asigurare');
compara(p.subtotal, prag.subtotal, 'subtotal');
compara(p.cost_marketing, prag.cost_marketing, 'marketing');
compara(p.cost_mentenanta, prag.cost_mentenanta, 'mentenanță');
compara(p.comision_platforma, prag.comision_platforma, 'comision');
compara(r2(p.subtotal + p.cost_marketing + p.cost_mentenanta + p.comision_platforma), prag.total_fara_tva, 'total fără TVA');
compara(p.tva_suma, prag.tva_suma, 'TVA');
compara(pFara.pret_final, prag.pret_fara_prag, 'total cu TVA, înainte de prag');
compara(p.pret_final, prag.pret_final, 'preț final (pragul RO)');

// ── C. Textele formulei ──────────────────────────────────────────────
console.log('C. Textul formulei');
verifica(!html.includes('subtotal × comision_platforma_default_pct'), 'nu mai scrie „subtotal × comision_platforma_default_pct”');
verifica(html.includes('cost de bază × comision_platforma_default_pct'), 'comisionul: „cost de bază × comision_platforma_default_pct”');
verifica(!html.includes('Formula în 5 pași: subtotal → marketing → mentenanță → comision platformă → TVA'), 'fără vechiul text „Formula în 5 pași …”');
verifica(/subtotal = cost de bază \+ transport \+ asigurare/.test(html), 'formula: subtotal = cost de bază + transport + asigurare');
verifica(/comision platformă 12% pe costul de bază → TVA pe total, apoi prag minim/.test(html), 'formula: comision pe costul de bază, TVA pe total, prag minim');
verifica(!html.includes('SUBTOTAL × (marketing% + mentenanță% + comision%)'), 'fără „SUBTOTAL × (marketing% + mentenanță% + comision%)”');
verifica(!html.includes('Procentele de mai sus se aplică fiecare pe subtotal'), 'fără „procentele se aplică fiecare pe subtotal”');

// ── D. Simulatorul din pagină ────────────────────────────────────────
console.log('D. Simulatorul (simCalc) = aplicaFormulaPret');
const inceput = html.indexOf('// VMC SIMULATOR');
const sfarsit = html.indexOf('// Run on load', inceput);
const cod = html.slice(inceput, sfarsit);
const elemente = {
  'sim-service': { value: '280|buc|Înlocuire calorifer' },
  'sim-qty': { value: '1' },
  'sim-country': { value: 'RO' },
  'sim-result': { innerHTML: '' },
};
const context = { document: { getElementById: (id) => elemente[id] || null }, console };
vm.createContext(context);
vm.runInContext(cod + '\nthis.simCalc = simCalc; this.VMC_PCT = VMC_PCT;', context);
for (const [pretUnitar, cant] of [[280, 1], [280, 3], [45, 2]]) {
  elemente['sim-service'].value = `${pretUnitar}|buc|Test`;
  elemente['sim-qty'].value = String(cant);
  context.simCalc();
  const afisat = elemente['sim-result'].innerHTML.match(/font-size:36px[^>]*>([^<]+)</);
  const asteptat = aplicaFormulaPret({ cost_baza_servicii: pretUnitar * cant }, CFG).pret_final;
  verifica(afisat && Math.abs(numar(afisat[1]) - asteptat) < 0.005, `${cant} × ${pretUnitar} Lei: simulator ${afisat && afisat[1]} = ${asteptat.toFixed(2)}`);
}
verifica(context.VMC_PCT.asigurare === 1, 'simulatorul are asigurarea implicită 1% (citită apoi live din asigurari)');

console.log(`\n${total - esecuri}/${total} verificări trecute.`);
if (esecuri) { console.log(`${esecuri} verificări au eșuat.`); process.exit(1); }
