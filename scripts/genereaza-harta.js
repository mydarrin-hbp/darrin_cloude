#!/usr/bin/env node
// Generează cuprinsul fișierelor mari din proiect (peste 150 KB): secțiunile și intervalele lor de rânduri.
// Rezultatul: .claude/skills/harta-proiectului/cuprins-fisiere-mari.md
// Se poate rula din nou oricând (după modificări mari): node scripts/genereaza-harta.js
// Opțional: --prag 100 (în KB), --stdout (afișează în loc să scrie fișierul).
'use strict';

const fs = require('fs');
const path = require('path');

const RADACINA = path.join(__dirname, '..');
const IESIRE = path.join(RADACINA, '.claude', 'skills', 'harta-proiectului', 'cuprins-fisiere-mari.md');
const IGNORATE = new Set(['node_modules', '.git', '.claude', 'continut', 'detector-out', '.tmp.driveupload', '.vercel']);
const EXTENSII_COD = new Set(['.html', '.js', '.css', '.mjs']);
const EXTENSII_DATE = new Set(['.json', '.sql', '.csv', '.md']);
const MIN_RANDURI = 15; // secțiunile mai scurte se lipesc de cea dinainte

const arg = process.argv.slice(2);
const iPrag = arg.indexOf('--prag');
const PRAG = (iPrag >= 0 ? parseInt(arg[iPrag + 1], 10) || 150 : 150) * 1024;
const LA_STDOUT = arg.includes('--stdout');

function cauta(dir, gasite) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORATE.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) cauta(p, gasite);
    else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (!EXTENSII_COD.has(ext) && !EXTENSII_DATE.has(ext)) continue;
      const m = fs.statSync(p).size;
      if (m > PRAG) gasite.push({ p, rel: path.relative(RADACINA, p).replace(/\\/g, '/'), ext, marime: m });
    }
  }
  return gasite;
}

const DECOR = /[═─━=*#\-–—<>!\/|]+/g;
function curata(t) {
  return t.replace(/<!--|-->|\/\*|\*\/|^\s*\/\//g, '').replace(DECOR, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
}
const eDecor = (l) => /^\s*(\/\/|<!--|\/\*)?\s*[═─━=*\-]{8,}\s*(-->|\*\/)?\s*$/.test(l);

// Întoarce lista de repere { rand, titlu, tare } pentru un fișier HTML / JS / CSS.
function repere(randuri, ext) {
  const r = [];
  const adauga = (i, titlu, tare) => { titlu = (titlu || '').trim(); if (titlu) r.push({ rand: i + 1, titlu, tare: !!tare }); };
  for (let i = 0; i < randuri.length; i++) {
    const l = randuri[i];
    // Blocurile mari ale paginii
    if (ext === '.html') {
      if (/^\s*<style[\s>]/i.test(l)) { adauga(i, '<style>', true); continue; }
      if (/^\s*<script(?![^>]*\bsrc=)[^>]*>\s*$/i.test(l)) {
        // cauta primul comentariu-titlu din script, dacă e chiar dedesubt
        adauga(i, '<script>' + (/type="module"/.test(l) ? ' (module)' : ''), true); continue;
      }
      if (/^\s*<body[\s>]/i.test(l)) { adauga(i, '<body>', true); continue; }
      const id = l.match(/<(section|div|main|aside|nav|form|dialog)\b[^>]*\bid="((?:panel|section|sectiune|tab|pagina|modal|pas|view|ecran)[-_][\w-]+)"/i);
      if (id) { adauga(i, `#${id[2]}`); continue; }
      const sec = l.match(/<section\b[^>]*\bid="([\w-]+)"/i);
      if (sec) { adauga(i, `<section #${sec[1]}>`); continue; }
    }
    // Comentarii-titlu HTML: <!-- ══ PANEL: X ══ -->, <!-- ── X -->, banner pe mai multe rânduri
    if (/<!--/.test(l) && /[═]{2,}|──|PANEL|SECȚIUNE|SECTIUNE|SECTION|MODAL/.test(l)) {
      let t = curata(l);
      if (!t && i + 1 < randuri.length) t = curata(randuri[i + 1]);
      adauga(i, t); continue;
    }
    // Comentarii-titlu JS / CSS
    const js = l.match(/^\s{0,6}(?:\/\/|\/\*)\s*(?:[═─━]{2,}|={3,})\s*(.*)$/);
    if (js) {
      let t = curata(js[1]);
      if (!t) {
        // banner: titlul e pe rândul următor (care nu e și el decor)
        const urm = randuri[i + 1] || '';
        if (!eDecor(urm) && /^\s*(\/\/|\/\*|\*)/.test(urm)) { t = curata(urm.replace(/^\s*\*/, '')); i++; }
      }
      adauga(i, t); continue;
    }
    // Titlu JS în majuscule după un rând de decor: // ───── / // 9. INIT
    if (i > 0 && eDecor(randuri[i - 1]) && /^\s{0,6}\/\/\s*[0-9A-ZĂÎÂȘȚ][0-9A-ZĂÎÂȘȚ .()\/&:+-]{4,}$/.test(l)) {
      adauga(i, curata(l)); continue;
    }
    if (ext === '.css' || ext === '.html') {
      const css = l.match(/^\s*\/\*\s*[=─═-]{0,}\s*([A-ZĂÎÂȘȚ0-9][^*]{3,}?)\s*[=─═-]{0,}\s*\*\/\s*$/);
      if (css && /[=─═]{2,}|^[^a-z]*$/.test(l)) { adauga(i, curata(css[1])); continue; }
    }
  }
  // Repere duplicate pe rânduri apropiate (bannere pe 2–3 rânduri)
  const unice = [];
  for (const x of r) {
    const ult = unice[unice.length - 1];
    if (ult && x.rand - ult.rand <= 2 && !x.tare && !ult.tare) continue;
    unice.push(x);
  }
  return unice;
}

function sectiuni(randuri, ext) {
  const rep = repere(randuri, ext);
  const total = randuri.length;
  const s = rep.map((x, k) => ({ ...x, sfarsit: (k + 1 < rep.length ? rep[k + 1].rand - 1 : total) }));
  // Lipește secțiunile scurte de cea dinainte (păstrează blocurile mari)
  const finale = [];
  for (const x of s) {
    const lung = x.sfarsit - x.rand + 1;
    const ult = finale[finale.length - 1];
    if (ult && lung < MIN_RANDURI && !x.tare) { ult.sfarsit = x.sfarsit; continue; }
    finale.push({ ...x });
  }
  if (finale.length && finale[0].rand > 1) finale.unshift({ rand: 1, sfarsit: finale[0].rand - 1, titlu: 'început (head, meta)' });
  return finale;
}

const fisiere = cauta(RADACINA, []).sort((a, b) => b.marime - a.marime);
const azi = new Date().toISOString().slice(0, 10);
const out = [];
out.push('# Cuprinsul fișierelor mari (peste ' + Math.round(PRAG / 1024) + ' KB)');
out.push('');
out.push(`Generat de \`node scripts/genereaza-harta.js\` la ${azi}. Nu se editează de mână — se rulează din nou scriptul după modificări mari.`);
out.push('Regula: aceste fișiere se citesc pe intervale de rânduri (Read cu offset / limit) sau se caută în ele cu Grep, niciodată întregi. Intervalele sunt orientative: se verifică cu Grep înainte de editare.');
out.push('');
out.push('| Fișier | KB | Rânduri |');
out.push('|---|---:|---:|');
const continut = fisiere.map((f) => ({ ...f, randuri: fs.readFileSync(f.p, 'utf8').split(/\r?\n/) }));
for (const f of continut) out.push(`| ${f.rel} | ${Math.round(f.marime / 1024)} | ${f.randuri.length} |`);
for (const f of continut) {
  out.push('');
  out.push(`## ${f.rel} — ${Math.round(f.marime / 1024)} KB, ${f.randuri.length} rânduri`);
  if (EXTENSII_DATE.has(f.ext)) {
    out.push('Fișier de date: nu are secțiuni; se caută cheia sau textul cu Grep și se citește doar intervalul găsit.');
    continue;
  }
  const s = sectiuni(f.randuri, f.ext);
  if (!s.length) { out.push('Fără repere găsite: se folosește Grep.'); continue; }
  for (const x of s) out.push(`- ${x.rand}–${x.sfarsit}: ${x.titlu}`);
}
const text = out.join('\n') + '\n';
if (LA_STDOUT) process.stdout.write(text);
else {
  fs.mkdirSync(path.dirname(IESIRE), { recursive: true });
  fs.writeFileSync(IESIRE, text);
  console.log(`Scris ${path.relative(RADACINA, IESIRE)}: ${continut.length} fișiere, ${text.split('\n').length} rânduri, ${Math.round(Buffer.byteLength(text) / 1024)} KB.`);
}
