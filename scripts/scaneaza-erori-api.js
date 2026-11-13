// scripts/scaneaza-erori-api.js
// Scanare statică a răspunsurilor de eroare din api/ (pasul 11-T2).
// Folosit de scripts/test-erori-api-bilingv.js.
//
// Găsește:
//   - res.status(4xx|5xx) scris direct (fără trimiteEroare);
//   - res.status(<expresie>) urmat de .json / .send / .end (status variabil);
//   - res.sendStatus(4xx|5xx);
//   - apeluri trimiteEroare(...) fără mesajul în engleză (al 5-lea argument).
// Lexer simplu de JavaScript: sare peste șiruri, template-uri, comentarii și
// expresii regulate, ca parantezele din ele să nu încurce potrivirea.

const fs = require('fs');
const path = require('path');

const INAINTE_DE_REGEX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

// Întoarce un tablou cu aceeași lungime: true unde caracterul e cod (nu șir/comentariu).
function hartaCod(s) {
  const cod = new Uint8Array(s.length);
  let i = 0;
  const stiva = []; // pentru `${` în template-uri
  let ultim = ''; // ultimul caracter semnificativ de cod
  function sir(q) {
    i++;
    while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++; }
    i++;
  }
  function template() {
    i++; // după `
    while (i < s.length) {
      if (s[i] === '\\') { i += 2; continue; }
      if (s[i] === '`') { i++; return; }
      if (s[i] === '$' && s[i + 1] === '{') {
        cod[i] = 1; cod[i + 1] = 1; i += 2;
        stiva.push(0);
        cod_(true);
        continue;
      }
      i++;
    }
  }
  // parcurge cod; dacă inTemplate, se oprește la `}` de închidere a ${
  function cod_(inTemplate) {
    let adancime = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (c === '/' && s[i + 1] === '*') { const j = s.indexOf('*/', i + 2); i = j < 0 ? s.length : j + 2; continue; }
      if (c === '\'' || c === '"') { sir(c); ultim = 'a'; continue; }
      if (c === '`') { template(); ultim = 'a'; continue; }
      if (c === '/') {
        const cuvant = /(?:return|typeof|case|in|of|void)\s*$/.test(s.slice(Math.max(0, i - 8), i));
        if (ultim === '' || INAINTE_DE_REGEX.has(ultim) || cuvant) {
          // regex literal
          i++;
          let clasa = false;
          while (i < s.length && s[i] !== '\n') {
            if (s[i] === '\\') { i += 2; continue; }
            if (s[i] === '[') clasa = true; else if (s[i] === ']') clasa = false;
            else if (s[i] === '/' && !clasa) break;
            i++;
          }
          i++;
          while (/[a-z]/i.test(s[i] || '')) i++;
          ultim = 'a';
          continue;
        }
      }
      if (inTemplate) {
        if (c === '{') adancime++;
        else if (c === '}') {
          if (adancime === 0) { cod[i] = 1; i++; stiva.pop(); return; }
          adancime--;
        }
      }
      cod[i] = 1;
      if (!/\s/.test(c)) ultim = c;
      i++;
    }
  }
  cod_(false);
  return cod;
}

// Indexul parantezei care o închide pe cea de la `deschis` (numai în cod).
function inchide(s, cod, deschis) {
  const per = { '(': ')', '[': ']', '{': '}' };
  const stiva = [];
  for (let i = deschis; i < s.length; i++) {
    if (!cod[i]) continue;
    const c = s[i];
    if (per[c]) stiva.push(per[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (stiva.pop() !== c) return -1;
      if (!stiva.length) return i;
    }
  }
  return -1;
}

// Împarte textul argumentelor (fără paranteze) la virgulele de pe primul nivel.
function argumente(s, cod, start, end) {
  const rez = [];
  let ad = 0, ult = start;
  for (let i = start; i < end; i++) {
    if (!cod[i]) continue;
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') ad++;
    else if (c === ')' || c === ']' || c === '}') ad--;
    else if (c === ',' && ad === 0) { rez.push(s.slice(ult, i).trim()); ult = i + 1; }
  }
  const ultim = s.slice(ult, end).trim();
  if (ultim || rez.length) rez.push(ultim);
  return rez;
}

function linie(s, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

const GOL = /^(?:''|""|``|null|undefined|void 0)$/;

function scaneazaText(s) {
  const cod = hartaCod(s);
  const abateri = [];
  const re = /\.(status|sendStatus)\s*\(|\btrimiteEroare\s*\(/g;
  let m;
  while ((m = re.exec(s))) {
    if (!cod[m.index]) continue;
    const deschis = m.index + m[0].length - 1;
    const inchis = inchide(s, cod, deschis);
    if (inchis < 0) continue;
    const args = argumente(s, cod, deschis + 1, inchis);
    const ln = linie(s, m.index);
    if (m[1] === 'sendStatus') {
      const n = Number(args[0]);
      if (!(n >= 200 && n < 400)) abateri.push({ linie: ln, tip: 'sendStatus', text: s.slice(m.index, inchis + 1) });
      continue;
    }
    if (m[1] === 'status') {
      const a = args[0] || '';
      const urm = s.slice(inchis + 1, inchis + 12);
      if (/^\d+$/.test(a)) {
        const n = Number(a);
        if (n >= 400) abateri.push({ linie: ln, tip: 'status-direct', status: n, text: s.slice(m.index, Math.min(s.length, inchis + 80)).split('\n')[0] });
      } else if (/^\s*\.\s*(json|send|end)\s*\(/.test(urm)) {
        abateri.push({ linie: ln, tip: 'status-variabil', text: s.slice(m.index, Math.min(s.length, inchis + 80)).split('\n')[0] });
      }
      continue;
    }
    // trimiteEroare(res, status, cod, ro, en, ...)
    if (/function\s+trimiteEroare\s*$/.test(s.slice(Math.max(0, m.index - 20), m.index + 13))) continue;
    if (args.length < 5 || GOL.test(args[4])) {
      abateri.push({ linie: ln, tip: 'fara-en', text: s.slice(m.index, Math.min(s.length, inchis + 1)).split('\n')[0] });
    } else if (args.length >= 4 && GOL.test(args[3])) {
      abateri.push({ linie: ln, tip: 'fara-ro', text: s.slice(m.index, Math.min(s.length, inchis + 1)).split('\n')[0] });
    }
  }
  return abateri;
}

function fisiereApi(radacina) {
  const rez = [];
  (function w(d) {
    for (const f of fs.readdirSync(d).sort()) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) w(p);
      else if (f.endsWith('.js')) rez.push(p);
    }
  })(path.join(radacina, 'api'));
  return rez;
}

module.exports = { hartaCod, inchide, argumente, scaneazaText, fisiereApi, linie };
