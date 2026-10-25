// lib/identitate-pf.js
// Datele de identificare ale investitorilor persoane fizice (pasul 11-P2a,
// 25 oct. 2026), cerute de verificarea AML (Legea 129/2019): CNP-ul sau, pentru
// străini, numărul de identificare fiscală (NIF), data nașterii și vârsta.
// Le folosesc api/investitori/kyc.js și lib/investitori-kyc.js.
//
// Amprenta CNP / NIF (investitori_kyc.cnp_hash) e un HMAC-SHA256 calculat pe
// server cu KYC_HMAC_SECRET (variabilă de mediu Vercel, 64 de caractere hex,
// nu se rotește niciodată). Fără secret (sau cu unul mai scurt de 32 de
// caractere) nu se calculează nicio amprentă și nu există cheie de rezervă.

const crypto = require('crypto');

const CHEIE_CNP = '279146358279';
const VARSTA_MINIMA = 18;
const LUNGIME_MINIMA_SECRET = 32;

// „AAAA-LL-ZZ” → Date (UTC) doar pentru o dată calendaristică reală; altfel null.
function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [a, l, z] = s.split('-').map(Number);
  const d = new Date(Date.UTC(a, l - 1, z));
  return d.getUTCFullYear() === a && d.getUTCMonth() === l - 1 && d.getUTCDate() === z ? d : null;
}
function formateaza(a, l, z) {
  return String(a).padStart(4, '0') + '-' + String(l).padStart(2, '0') + '-' + String(z).padStart(2, '0');
}
// Ziua de azi, „AAAA-LL-ZZ” (UTC).
function aziIso(azi = new Date()) {
  return azi.toISOString().slice(0, 10);
}

// CNP: S AA LL ZZ JJ NNN C. Cifra de control: suma produselor cu cheia
// 279146358279, mod 11 (10 → 1). Secolul: 1/2 → 1900, 3/4 → 1800, 5/6 → 2000;
// 7/8 (rezidenți străini) nu au secolul în CNP: îl luăm din anul complet al
// datei declarate (fără ea, anul cel mai recent care nu e în viitor).
function valideazaCnp(cnp, dataDeclarata) {
  const s = String(cnp == null ? '' : cnp).replace(/\s+/g, '');
  if (!/^\d{13}$/.test(s)) return { ok: false };
  const sex = Number(s[0]);
  if (sex < 1 || sex > 8) return { ok: false };
  let suma = 0;
  for (let i = 0; i < 12; i++) suma += Number(s[i]) * Number(CHEIE_CNP[i]);
  const control = suma % 11 === 10 ? 1 : suma % 11;
  if (control !== Number(s[12])) return { ok: false };

  const aa = Number(s.slice(1, 3));
  let secol;
  if (sex <= 2) secol = 1900;
  else if (sex <= 4) secol = 1800;
  else if (sex <= 6) secol = 2000;
  else {
    const declarata = dataValida(dataDeclarata);
    if (declarata) secol = Math.floor(declarata.getUTCFullYear() / 100) * 100;
    else secol = 2000 + aa > new Date().getUTCFullYear() ? 1900 : 2000;
  }
  const data = formateaza(secol + aa, Number(s.slice(3, 5)), Number(s.slice(5, 7)));
  if (!dataValida(data)) return { ok: false };
  return { ok: true, data_nasterii: data };
}

// NIF străin: 4–30 caractere — litere, cifre, spațiu, „-” și „/”.
function valideazaNif(nif) {
  const s = String(nif == null ? '' : nif).trim();
  return s.length >= 4 && s.length <= 30 && /^[A-Za-z0-9 \-/]+$/.test(s);
}

// Forma salvată și amprentată: fără spații, cu majuscule.
function normalizeaza(valoare) {
  return String(valoare == null ? '' : valoare).replace(/\s+/g, '').toUpperCase();
}

// Vârsta împlinită, în ani, la data `azi` (Date). null pentru o dată invalidă.
function varsta(dataNasterii, azi = new Date()) {
  const d = dataValida(dataNasterii);
  if (!d) return null;
  let ani = azi.getUTCFullYear() - d.getUTCFullYear();
  const lunaAzi = azi.getUTCMonth(), ziAzi = azi.getUTCDate();
  if (lunaAzi < d.getUTCMonth() || (lunaAzi === d.getUTCMonth() && ziAzi < d.getUTCDate())) ani--;
  return ani;
}

function secretDisponibil() {
  const s = process.env.KYC_HMAC_SECRET;
  return typeof s === 'string' && s.length >= LUNGIME_MINIMA_SECRET;
}

// HMAC-SHA256(KYC_HMAC_SECRET, tip + ':' + valoarea normalizată), în hex.
function hashIdFiscal(tip, valoare) {
  if (!secretDisponibil()) {
    const e = new Error('KYC_HMAC_SECRET lipsește');
    e.cod = 'KYC_HMAC_SECRET_LIPSA';
    throw e;
  }
  return crypto.createHmac('sha256', process.env.KYC_HMAC_SECRET).update(tip + ':' + normalizeaza(valoare)).digest('hex');
}

// Afișarea mascată: „•••••••••” + ultimele n caractere. Numărul de puncte e
// fix, ca să nu dezvăluie lungimea; merge și pe ultimele cifre deja salvate.
function mascheaza(valoare, n = 3) {
  const s = String(valoare == null ? '' : valoare);
  if (!s) return null;
  return '•••••••••' + s.slice(-n);
}

module.exports = {
  VARSTA_MINIMA,
  dataValida, aziIso, valideazaCnp, valideazaNif, normalizeaza, varsta,
  secretDisponibil, hashIdFiscal, mascheaza,
};
