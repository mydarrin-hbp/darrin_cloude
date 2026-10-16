// scripts/genereaza-destinatie-rol.js
// Copiază harta unică rol → dashboard din lib/destinatie-rol.js în
// ui-comun.js (pasul 10b, 16 oct. 2026), între marcajele
// „<destinatie-rol:inceput>” și „<destinatie-rol:sfarsit>”. Așa, serverul și
// browserul folosesc aceeași listă și nu mai pot diverge.
//
// Rulare: node scripts/genereaza-destinatie-rol.js          (scrie ui-comun.js)
//         node scripts/genereaza-destinatie-rol.js --verifica  (doar verifică; cod 1 dacă diferă)

const fs = require('fs');
const path = require('path');

const RADACINA = path.join(__dirname, '..');
const SURSA = path.join(RADACINA, 'lib', 'destinatie-rol.js');
const TINTA = path.join(RADACINA, 'ui-comun.js');
const INCEPUT = '// <destinatie-rol:inceput>';
const SFARSIT = '// <destinatie-rol:sfarsit>';

function bloc(text, fisier) {
  const a = text.indexOf(INCEPUT);
  const z = text.indexOf(SFARSIT);
  if (a === -1 || z === -1 || z < a) throw new Error(`Marcajele ${INCEPUT} / ${SFARSIT} lipsesc din ${fisier}`);
  return { a, z: z + SFARSIT.length, continut: text.slice(a, z + SFARSIT.length) };
}

function blocGenerat() {
  const b = bloc(fs.readFileSync(SURSA, 'utf8').replace(/\r\n/g, '\n'), 'lib/destinatie-rol.js');
  return b.continut.replace(INCEPUT, `${INCEPUT}\n// Generat din lib/destinatie-rol.js de scripts/genereaza-destinatie-rol.js — nu edita aici.`);
}

function laZi() {
  const ui = fs.readFileSync(TINTA, 'utf8').replace(/\r\n/g, '\n');
  return bloc(ui, 'ui-comun.js').continut === blocGenerat();
}

if (require.main === module) {
  if (process.argv.includes('--verifica')) {
    const ok = laZi();
    console.log(ok ? 'ui-comun.js e la zi cu lib/destinatie-rol.js' : 'ui-comun.js NU e la zi: rulează node scripts/genereaza-destinatie-rol.js');
    process.exit(ok ? 0 : 1);
  }
  const brut = fs.readFileSync(TINTA, 'utf8');
  const crlf = brut.includes('\r\n');
  const ui = brut.replace(/\r\n/g, '\n');
  const b = bloc(ui, 'ui-comun.js');
  let nou = ui.slice(0, b.a) + blocGenerat() + ui.slice(b.z);
  if (crlf) nou = nou.replace(/\n/g, '\r\n');
  fs.writeFileSync(TINTA, nou);
  console.log('ui-comun.js actualizat din lib/destinatie-rol.js');
}

module.exports = { laZi, blocGenerat };
