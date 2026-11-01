// lib/regiune.js
// Județul / regiunea, într-un singur format (pasul 11-P3b, 28 oct. 2026).
//
// Problema: checkout-ul, coșul și agenda trimit județul ca nume („Cluj”, „Cluj
// County”, „Județul Cluj”, din Nominatim sau din liste), iar alocarea
// partenerilor și sloturile îl compară cu `geo_regiuni.cod` („CJ”) din
// `parteneri_disponibilitate.judete`. Decizia LM (28 oct. 2026):
//   - formatul canonic e `geo_regiuni.cod`; conversia se face o singură dată, pe
//     server, cu normalizeazaRegiune (comenzi, agendă, sloturi);
//   - pe comandă (`comenzi.regiune`) se salvează codul; comenzile vechi (nume
//     sau cod) se citesc tolerant, tot prin normalizeazaRegiune;
//   - un județ nerecunoscut, pentru o țară care are regiuni în geo_regiuni →
//     400 cu `camp: 'regiune'` (MESAJ_REGIUNE, RO + EN).
//
// Zona metropolitană București-Ilfov (`B-ILFOV`, decizia LM, 28 oct. 2026):
//   - o comandă din `B` sau `IF` găsește partenerii ale căror `judete` conțin
//     codul propriu SAU `B-ILFOV`;
//   - o comandă veche cu `B-ILFOV` găsește partenerii cu `B`, `IF` sau `B-ILFOV`.
// Regula stă doar aici (varianteRegiune), folosită de lib/aloca-partener.js,
// lib/aloca-subcontractori.js și lib/calculeaza-sloturi-disponibile.js.
//
// Regiunile se citesc din geo_regiuni (pe țară) și se țin în memorie cât trăiește
// instanța funcției (cel mult CACHE_MS). Dacă tabelul nu se poate citi, nimic nu
// se refuză: valoarea rămâne cum a venit (citire tolerantă, ca înainte).

const { supabaseAdmin } = require('./supabaseAdmin');

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // tara → { la, randuri: [{ cod, denumire, cheie }] }

const MESAJ_REGIUNE = {
  ro: 'Județul nu e recunoscut. Alege-l din listă.',
  en: 'The county is not recognised. Choose it from the list.',
};

// Zona metropolitană București-Ilfov: codul compus și județele pe care le acoperă.
const ZONA_BUCURESTI_ILFOV = 'B-ILFOV';
const IN_ZONA_BUCURESTI_ILFOV = ['B', 'IF'];

// Numele scrise altfel decât în geo_regiuni (exonimul englezesc din Nominatim).
const ALIASURI = { RO: { bucharest: 'B' } };

// Cheia de comparație: fără diacritice, litere mici, fără prefixe („Județul ”,
// „Jud. ”, „Municipiul ”, „ County”) și fără precizări în paranteză
// („Chișinău (municipiu)”).
const PREFIXE = /\b(judetul|judet|jud|county|municipiul|municipiu|mun)\b/g;
function cheie(v) {
  return String(v == null ? '' : v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(PREFIXE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function regiuniTara(taraCod) {
  const tara = String(taraCod || '').trim().toUpperCase();
  if (!tara) return null;
  const c = cache.get(tara);
  if (c && Date.now() - c.la < CACHE_MS) return c.randuri;
  const { data, error } = await supabaseAdmin.from('geo_regiuni').select('cod, denumire').eq('tara_cod', tara);
  if (error) {
    console.warn('[regiune] geo_regiuni indisponibil:', error.message);
    return null; // nu se ține în cache: la următoarea cerere se reîncearcă
  }
  const randuri = (data || []).map((r) => ({ cod: r.cod, denumire: r.denumire, cheie: cheie(r.denumire) }));
  cache.set(tara, { la: Date.now(), randuri });
  return randuri;
}

/**
 * Codul și denumirea din geo_regiuni pentru o valoare scrisă oricum
 * („CJ”, „Cluj”, „Judetul Cluj”, „Cluj County”, „București”, „Bucuresti”…).
 * @returns {Promise<{cod:string, denumire:string}|null>} null = nerecunoscut
 *   (sau geo_regiuni indisponibil — vezi rezolvaRegiune pentru diferență).
 */
async function normalizeazaRegiune(taraCod, valoare) {
  const r = await rezolvaRegiune(taraCod, valoare);
  return r.regiune;
}

/**
 * Ca normalizeazaRegiune, dar spune și dacă țara are regiuni cunoscute:
 * { regiune: {cod, denumire}|null, areRegiuni: boolean }.
 * areRegiuni = false → țara nu are rânduri în geo_regiuni sau tabelul nu se
 * poate citi: valoarea nu se refuză.
 */
async function rezolvaRegiune(taraCod, valoare) {
  const text = typeof valoare === 'string' ? valoare.trim() : '';
  const randuri = await regiuniTara(taraCod);
  if (!randuri || !randuri.length) return { regiune: null, areRegiuni: false };
  if (!text) return { regiune: null, areRegiuni: true };
  const pe = (r) => (r ? { cod: r.cod, denumire: r.denumire } : null);
  // 1. codul, exact (fără diferență de majuscule)
  const dupaCod = randuri.find((r) => r.cod.toUpperCase() === text.toUpperCase());
  if (dupaCod) return { regiune: pe(dupaCod), areRegiuni: true };
  // 2. denumirea (sau un alias), cu cheia de comparație
  const k = cheie(text);
  if (!k) return { regiune: null, areRegiuni: true };
  // Sectoarele (Nominatim pune uneori „Sector 3” în loc de județ) sunt doar în București.
  const alias = (ALIASURI[String(taraCod).toUpperCase()] || {})[k]
    || (String(taraCod).toUpperCase() === 'RO' && /^sector(ul)? [1-6]$/.test(k) ? 'B' : null);
  const dupaNume = randuri.find((r) => r.cheie === k) || (alias && randuri.find((r) => r.cod === alias));
  return { regiune: pe(dupaNume), areRegiuni: true };
}

/**
 * Codurile cu care se caută în `judete` (regula București-Ilfov).
 * Primește un cod canonic; o valoare veche nerecunoscută se caută ca atare.
 */
function varianteRegiune(cod) {
  if (!cod) return [];
  if (cod === ZONA_BUCURESTI_ILFOV) return [...IN_ZONA_BUCURESTI_ILFOV, ZONA_BUCURESTI_ILFOV];
  if (IN_ZONA_BUCURESTI_ILFOV.includes(cod)) return [cod, ZONA_BUCURESTI_ILFOV];
  return [cod];
}

/**
 * Pentru citire (alocare, sloturi, comenzi vechi): codul canonic, dacă valoarea
 * se recunoaște; altfel valoarea însăși (formatul vechi rămâne comparabil).
 */
async function codPentruCitire(taraCod, valoare) {
  if (!valoare) return null;
  const r = await normalizeazaRegiune(taraCod || 'RO', valoare);
  return r ? r.cod : String(valoare).trim();
}

module.exports = {
  normalizeazaRegiune, rezolvaRegiune, varianteRegiune, codPentruCitire, cheie,
  MESAJ_REGIUNE, ZONA_BUCURESTI_ILFOV,
  _golesteCache: () => cache.clear(), // doar pentru teste
};
