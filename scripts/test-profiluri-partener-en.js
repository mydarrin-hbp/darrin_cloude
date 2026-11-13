// scripts/test-profiluri-partener-en.js
// Pasul 11-T2: dashboard-urile curierului de cartier, ale furnizorului de
// materiale și ale asigurătorului / brokerului, în modul EN, cu date simulate
// (scripts/detector-ro.js --cu-cont --profil ...). Pentru fiecare profil:
// paginile lui, la 390 și 1366 px, meniul, panourile din meniu (carduri,
// formulare) și aceleași panouri cu API-urile în eroare (mesajul EN din forma
// comună trebuie să apară, fără text în română în jurul lui).
// Pornește singur serverul local (scripts/server-test.js); fără rețea externă.
// Rulare: node scripts/test-profiluri-partener-en.js [profil ...]

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { porneste } = require('./server-test');

const PROFILURI = process.argv.slice(2).length ? process.argv.slice(2) : ['curier', 'materiale', 'asigurari'];

function ruleaza(args) {
  return new Promise((rezolva) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'detector-ro.js'), ...args], { env: Object.assign({}, process.env, { LIMBA: 'en' }) });
    let iesire = '';
    p.stdout.on('data', (d) => { iesire += d; });
    p.stderr.on('data', (d) => { iesire += d; });
    p.on('close', (cod) => rezolva({ cod, iesire }));
  });
}

(async () => {
  const srv = await porneste(0);
  const port = srv.address().port;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'profiluri-en-'));
  let esec = 0;
  for (const profil of PROFILURI) {
    const r = await ruleaza(['--base', 'http://localhost:' + port, '--cu-cont', '--profil', profil, '--out', out]);
    const total = /TOTAL texte românești \(en\): (\d+) · pagini × lățimi: (\d+)/.exec(r.iesire);
    const ok = r.cod === 0 && total && total[1] === '0';
    console.log(`${ok ? '✓' : '✕'} profil ${profil}: ${total ? total[1] + ' texte în română, ' + total[2] + ' pagini × lățimi' : 'fără rezultat'}`);
    if (!ok) {
      esec++;
      r.iesire.split('\n').filter((l) => /română:|NERANDATĂ|eroare JS|MESAJUL EN|PANOUL NU/.test(l)).slice(0, 30).forEach((l) => console.log('   ' + l.trim()));
      if (!total) console.log(r.iesire.slice(-1500));
    }
  }
  srv.close();
  fs.rmSync(out, { recursive: true, force: true });
  console.log(`\n${PROFILURI.length - esec} profiluri trec, ${esec} cad.`);
  process.exit(esec ? 1 : 0);
})();
