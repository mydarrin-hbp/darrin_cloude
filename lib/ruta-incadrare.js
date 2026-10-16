// lib/ruta-incadrare.js
// Regula universală de încadrare (pasul 8, 15 oct. 2026, decizie LM):
//   secțiune NACE → diviziune → grupă → clasă NACE (= cod CAEN Rev. 3)
//   → capitol de meniu → nod de meniu → ocupație ESCO → Uniclass
//   → rețetă → prețuri → publicare.
// Documentul de referință: docs/regula-incadrare.md.
//
// Funcții pure, fără acces la baza de date: api/admin/ruta-incadrare.js
// citește datele și le dă aici; scripts/test-ruta-incadrare.js le testează
// cu date simulate. Fiecare eroare / avertisment are cod, mesaj_ro, mesaj_en.

// ── NACE ──────────────────────────────────────────────────────────────────
// Clasa NACE Rev. 2.1 (4 cifre, „NN.NN”) dintr-un text: „F 43.22”, „4322”,
// „43.22”. O grupă („43.2”), o diviziune („43”) sau altceva → null.
function normalizeazaNace(text) {
  if (text == null) return null;
  const s = String(text).trim().replace(/^[A-Za-z]\s*/, '').trim();
  let m = s.match(/^(\d{2})\.(\d{2})$/);
  if (m) return `${m[1]}.${m[2]}`;
  m = s.match(/^(\d{2})(\d{2})$/);
  if (m) return `${m[1]}.${m[2]}`;
  return null;
}
// Grupa („43.2”) și diviziunea („43”) unei clase.
const grupaNace = (clasa) => (clasa ? clasa.slice(0, 4) : null);
const diviziuneNace = (clasa) => (clasa ? clasa.slice(0, 2) : null);
// Diviziunea din orice format: „F 43.22”, „4322”, „43.22”, „43.2”, „43”.
function diviziuneDinText(text) {
  if (text == null) return null;
  const m = String(text).trim().replace(/^[A-Za-z]\s*/, '').match(/^(\d{2})/);
  return m ? m[1] : null;
}

// ── Capitole ──────────────────────────────────────────────────────────────
// Capitolul pentru o clasă NACE (regula 1 și tabelul din meniu_capitole):
// clasele explicite au prioritate față de diviziuni, diviziunile față de
// secțiuni. `sectiune` (litera) e opțională, pentru capitolele pe secțiune.
function capitolPentruNace(nace, capitole, { sectiune = null } = {}) {
  const clasa = normalizeazaNace(nace);
  if (!clasa || !Array.isArray(capitole)) return null;
  const active = capitole.filter((c) => c && c.activ !== false);
  const cuClasa = active.find((c) => (c.clase_nace || []).includes(clasa));
  if (cuClasa) return cuClasa.cod;
  const div = diviziuneNace(clasa);
  const cuDiviziune = active.find((c) => (c.diviziuni_nace || []).includes(div));
  if (cuDiviziune) return cuDiviziune.cod;
  if (sectiune) {
    const cuSectiune = active.find((c) => (c.sectiuni_nace || []).includes(sectiune));
    if (cuSectiune) return cuSectiune.cod;
  }
  return null;
}

// ── ESCO ──────────────────────────────────────────────────────────────────
// Tipul codului (aceeași regulă ca coloana generată competente_esco.tip_cod).
function tipCodEsco(cod) {
  const s = String(cod || '').trim();
  if (/^\d{4}(\.\d+)+$/.test(s)) return 'esco';
  if (/^\d{4}$/.test(s)) return 'isco';
  if (/^\d{6}$/.test(s) || /^COR-/i.test(s)) return 'cor';
  return null;
}

// ── Titluri ───────────────────────────────────────────────────────────────
const FARA_DIACRITICE = { ă: 'a', â: 'a', î: 'i', ș: 's', ş: 's', ț: 't', ţ: 't' };
const CUVINTE_GOALE = new Set(['pentru', 'din', 'cu', 'si', 'la', 'de', 'pe', 'in', 'sau', 'the', 'and', 'for', 'with', 'nou', 'noua']);
// Rădăcinile cuvintelor (primele 6 litere), fără diacritice și cuvinte de
// legătură: „Reparat” și „Reparație” dau aceeași rădăcină, „repara”.
function radaciniTitlu(titlu) {
  const s = String(titlu || '').toLowerCase().replace(/[ăâîșşțţ]/g, (c) => FARA_DIACRITICE[c]);
  return new Set(s.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !CUVINTE_GOALE.has(w)).map((w) => w.slice(0, 6)));
}
function asemanareTitlu(a, b) {
  const ra = radaciniTitlu(a);
  const rb = radaciniTitlu(b);
  if (!ra.size || !rb.size) return 0;
  let comune = 0;
  ra.forEach((r) => { if (rb.has(r)) comune++; });
  return comune / (ra.size + rb.size - comune);
}
const PRAG_DUPLICAT = 0.6;

// ── Mesaje ────────────────────────────────────────────────────────────────
function mesaj(cod, mesaj_ro, mesaj_en, detalii) {
  return detalii ? { cod, mesaj_ro, mesaj_en, detalii } : { cod, mesaj_ro, mesaj_en };
}

/**
 * Validează ruta unui serviciu înainte de publicare.
 * @param {object} p
 * @param {object} p.serviciu - { id, titlu, nace, cod_esco, cod_uniclass, categorie, descriere }
 * @param {object|null} p.nod - nodul de meniu (categorii): { id, title, nace_clasa, capitol_cod, autorizare_necesara, activ }
 * @param {object|null} p.capitol - capitolul nodului (meniu_capitole)
 * @param {object|null} p.esco - { cod_esco, tip_cod?, nace_code }
 * @param {object|null} p.uniclass - rândul din uniclass_codes pentru serviciu.cod_uniclass (null = nu există):
 *                                   { code, is_active, inlocuit_de?, retras_in? }
 * @param {Array} p.articole - articolele legate de niveluri: [{ articol_id, simbol, indicator_id, indicator_nace }]
 * @param {Array} p.preturi - pe niveluri: [{ nivel_id, nivel, are_pret_activ, reteta_calculabila, reteta_propusa }]
 * @param {object} p.traduceri - { titlu_ro, titlu_en }
 * @param {string} p.tipInregistrare - 'serviciu' | 'produs'
 * @param {object} p.ref - { capitole: [...], naceClase: Set|Array (clasele „NN.NN” din nace_reference),
 *                           discountPct?: number, catalog?: [{ id, titlu }] (pentru A4) }
 * @returns {{ ok: boolean, erori: Array, avertismente: Array, ruta: object }}
 */
function valideazaRuta({ serviciu = {}, nod = null, capitol = null, esco = null, uniclass = null, articole = [], preturi = [], traduceri = {}, tipInregistrare = 'serviciu', ref = {} } = {}) {
  const erori = [];
  const avertismente = [];
  const capitole = ref.capitole || [];
  const naceClase = ref.naceClase instanceof Set ? ref.naceClase : new Set(ref.naceClase || []);

  // E1 — clasa NACE există în nace_reference (Rev. 2.1, 4 cifre)
  const clasa = normalizeazaNace(serviciu.nace);
  if (!clasa || !naceClase.has(clasa)) {
    erori.push(mesaj('E1',
      `Clasa NACE „${serviciu.nace || '—'}” nu există în nomenclatorul NACE Rev. 2.1 (4 cifre).`,
      `NACE class "${serviciu.nace || '—'}" does not exist in the NACE Rev. 2.1 list (4 digits).`));
  }

  // E2 — clasa serviciului = clasa nodului
  const clasaNod = normalizeazaNace(nod?.nace_clasa);
  if (!nod) {
    erori.push(mesaj('E2', 'Serviciul nu e încadrat într-un nod de meniu.', 'The service is not placed under a menu node.'));
  } else if (!clasa || clasaNod !== clasa) {
    erori.push(mesaj('E2',
      `Clasa NACE a serviciului (${clasa || '—'}) diferă de clasa nodului „${nod.title || nod.id}” (${clasaNod || '—'}).`,
      `The service's NACE class (${clasa || '—'}) differs from the class of node "${nod.title_en || nod.title || nod.id}" (${clasaNod || '—'}).`));
  }

  // E3 — capitolul nodului = capitolul calculat din NACE
  const capitolCalculat = clasa ? capitolPentruNace(clasa, capitole) : null;
  const capitolNod = capitol?.cod || nod?.capitol_cod || null;
  if (nod && capitolCalculat !== capitolNod) {
    erori.push(mesaj('E3',
      `Nodul e în capitolul ${capitolNod || '—'}, dar clasa NACE ${clasa || '—'} cere capitolul ${capitolCalculat || '—'}.`,
      `The node is in chapter ${capitolNod || '—'}, but NACE class ${clasa || '—'} requires chapter ${capitolCalculat || '—'}.`));
  }

  // E4 — ocupație ESCO (cod cu punct), nu grupă ISCO și nu cod COR
  const tipEsco = esco ? (esco.tip_cod || tipCodEsco(esco.cod_esco)) : null;
  if (!esco || tipEsco !== 'esco') {
    erori.push(mesaj('E4',
      esco ? `Codul ${esco.cod_esco} e ${tipEsco ? tipEsco.toUpperCase() : 'necunoscut'}, nu o ocupație ESCO (de exemplu 7126.8).`
        : 'Lipsește ocupația ESCO care face lucrarea.',
      esco ? `Code ${esco.cod_esco} is ${tipEsco ? tipEsco.toUpperCase() : 'unknown'}, not an ESCO occupation (e.g. 7126.8).`
        : 'The ESCO occupation doing the work is missing.'));
  }

  // E5 — Uniclass: codul există, e activ (is_active = true) și e din tabelul
  // potrivit (Ac_ servicii, Pr_ materiale). Un cod retras de NBS arată și
  // înlocuitorul (inlocuit_de), după importul Uniclass 2026; înainte de
  // import coloana lipsește și se verifică doar existența.
  const prefixAsteptat = tipInregistrare === 'produs' ? 'Pr_' : 'Ac_';
  const codUniclass = serviciu.cod_uniclass || null;
  if (!codUniclass || !uniclass) {
    erori.push(mesaj('E5',
      `Codul Uniclass „${codUniclass || '—'}” nu există în uniclass_codes.`,
      `Uniclass code "${codUniclass || '—'}" does not exist in uniclass_codes.`));
  } else if (uniclass.is_active === false) {
    const nou = uniclass.inlocuit_de || null;
    erori.push(mesaj('E5',
      `Codul Uniclass ${codUniclass} e retras${uniclass.retras_in ? ` (${uniclass.retras_in})` : ''}${nou ? `; folosește ${nou}` : ''}.`,
      `Uniclass code ${codUniclass} is withdrawn${uniclass.retras_in ? ` (${uniclass.retras_in})` : ''}${nou ? `; use ${nou}` : ''}.`,
      nou ? { inlocuit_de: nou } : undefined));
  } else if (!codUniclass.startsWith(prefixAsteptat)) {
    erori.push(mesaj('E5',
      `Codul Uniclass ${codUniclass} e din tabelul greșit: ${tipInregistrare === 'produs' ? 'un material' : 'un serviciu'} cere ${prefixAsteptat}.`,
      `Uniclass code ${codUniclass} is from the wrong table: ${tipInregistrare === 'produs' ? 'a material' : 'a service'} needs ${prefixAsteptat}.`));
  }

  // E6 — un produs nu se publică drept serviciu (regula 6)
  if (tipInregistrare === 'produs' && (serviciu.categorie === 'servicii' || capitol?.tip_partener === 'servicii')) {
    erori.push(mesaj('E6',
      'Un produs nu se publică drept serviciu: produsele merg la Aprovizionare materiale (capitolul G).',
      'A product cannot be published as a service: products belong under Material supplies (chapter G).'));
  }

  // E7 — măcar un nivel cu preț activ sau cu rețetă calculabilă; o rețetă
  // propusă, neaprobată, nu dă preț.
  const pretValid = (preturi || []).some((p) => p.are_pret_activ || p.reteta_calculabila);
  if (!pretValid) {
    const propuse = (preturi || []).filter((p) => p.reteta_propusa);
    erori.push(mesaj('E7',
      propuse.length
        ? 'Niciun nivel nu are preț activ: rețeta propusă automat nu e încă aprobată și nu se folosește la preț.'
        : 'Niciun nivel nu are preț activ într-o țară și nici o rețetă calculabilă.',
      propuse.length
        ? 'No level has an active price: the automatically proposed recipe is not approved yet and is not used for pricing.'
        : 'No level has an active price in any country, nor a computable recipe.'));
  }

  // E8 — titlul în RO și în EN
  const lipsa = [!String(traduceri.titlu_ro || '').trim() && 'RO', !String(traduceri.titlu_en || '').trim() && 'EN'].filter(Boolean);
  if (lipsa.length) {
    erori.push(mesaj('E8', `Lipsește titlul în: ${lipsa.join(', ')}.`, `The title is missing in: ${lipsa.join(', ')}.`));
  }

  // E9 — discount pe un capitol fără discount (regula 9)
  if (Number(ref.discountPct) > 0 && capitol && capitol.discount_permis === false) {
    erori.push(mesaj('E9',
      `Capitolul ${capitol.cod} nu permite discount (${capitol.tip_partener}): partenerul primește 100% din tarif.`,
      `Chapter ${capitol.cod} does not allow a discount (${capitol.tip_partener}): the partner receives 100% of the rate.`));
  }

  // A1 — ESCO cu altă diviziune NACE decât serviciul
  const divEsco = diviziuneDinText(esco?.nace_code);
  if (esco && divEsco && clasa && divEsco !== diviziuneNace(clasa)) {
    avertismente.push(mesaj('A1',
      `Ocupația ESCO ${esco.cod_esco} e asociată diviziunii NACE ${divEsco}, serviciul e în ${diviziuneNace(clasa)}.`,
      `ESCO occupation ${esco.cod_esco} is linked to NACE division ${divEsco}; the service is in ${diviziuneNace(clasa)}.`));
  }

  // A2 — articol de rețetă cu indicator din altă clasă NACE
  const altaClasa = (articole || []).filter((a) => {
    const c = normalizeazaNace(a.indicator_nace);
    return c && clasa && c !== clasa;
  });
  if (altaClasa.length) {
    avertismente.push(mesaj('A2',
      `Articole de rețetă cu indicator din altă clasă NACE: ${altaClasa.map((a) => `${a.simbol} (${normalizeazaNace(a.indicator_nace)})`).join(', ')}.`,
      `Recipe items with an indicator from another NACE class: ${altaClasa.map((a) => `${a.simbol} (${normalizeazaNace(a.indicator_nace)})`).join(', ')}.`,
      { articole: altaClasa.map((a) => a.articol_id) }));
  }

  // A3 — nodul cere o autorizare pe care serviciul n-o menționează
  const autorizare = String(nod?.autorizare_necesara || '').trim();
  if (autorizare) {
    const text = `${serviciu.titlu || ''} ${serviciu.descriere || ''}`.toLowerCase();
    if (!text.includes(autorizare.toLowerCase())) {
      avertismente.push(mesaj('A3',
        `Nodul cere autorizarea „${autorizare}”, iar serviciul nu o menționează.`,
        `The node requires the "${autorizare}" authorisation and the service does not mention it.`));
    }
  }

  // A4 — titlu asemănător cu un serviciu existent (posibil duplicat)
  const duplicate = (ref.catalog || [])
    .filter((s) => s.id !== serviciu.id && asemanareTitlu(s.titlu, serviciu.titlu) >= PRAG_DUPLICAT)
    .map((s) => ({ id: s.id, titlu: s.titlu }));
  if (duplicate.length) {
    avertismente.push(mesaj('A4',
      `Titlu asemănător cu: ${duplicate.map((d) => `„${d.titlu}”`).join(', ')} (posibil duplicat).`,
      `Title similar to: ${duplicate.map((d) => `"${d.titlu}"`).join(', ')} (possible duplicate).`,
      { servicii: duplicate }));
  }

  return {
    ok: erori.length === 0,
    erori,
    avertismente,
    ruta: {
      sectiune: ref.sectiune || null,
      diviziune: diviziuneNace(clasa),
      grupa: grupaNace(clasa),
      clasa,
      capitol: capitolCalculat,
      nod: nod?.id || null,
      esco: esco?.cod_esco || null,
      uniclass: codUniclass,
    },
  };
}

/**
 * Servicii asemănătoare, în ordinea: aceeași clasă NACE, aceeași grupă,
 * aceeași ocupație ESCO, aceiași indicatori de deviz, cuvinte comune în titlu.
 * În același nivel de potrivire: întâi titlul mai apropiat, apoi cele cu rețetă.
 * @param {object} serviciuNou - { titlu, nace, cod_esco, indicatori?: [] }
 * @param {Array} catalog - [{ id, titlu, nace, cod_esco, cod_uniclass, nod_id, niveluri?: [], articole?: [{ articol_id, simbol, indicator_id }] }]
 */
function serviciiAsemanatoare(serviciuNou = {}, catalog = []) {
  const clasa = normalizeazaNace(serviciuNou.nace);
  const indicatoriNoi = new Set(serviciuNou.indicatori || []);
  const MOTIVE = ['aceeasi_clasa', 'aceeasi_grupa', 'acelasi_esco', 'aceiasi_indicatori', 'cuvinte_comune'];
  const rezultat = [];
  for (const s of catalog || []) {
    if (serviciuNou.id && s.id === serviciuNou.id) continue;
    const c = normalizeazaNace(s.nace);
    const articole = s.articole || [];
    const titlu = asemanareTitlu(serviciuNou.titlu, s.titlu);
    let nivel = -1;
    if (clasa && c === clasa) nivel = 0;
    else if (clasa && c && grupaNace(c) === grupaNace(clasa)) nivel = 1;
    else if (serviciuNou.cod_esco && s.cod_esco === serviciuNou.cod_esco) nivel = 2;
    else if (indicatoriNoi.size && articole.some((a) => indicatoriNoi.has(a.indicator_id))) nivel = 3;
    else if (titlu > 0) nivel = 4;
    if (nivel < 0) continue;
    rezultat.push({
      serviciu: { id: s.id, titlu: s.titlu, nace: s.nace, cod_esco: s.cod_esco, cod_uniclass: s.cod_uniclass },
      motiv: MOTIVE[nivel],
      nivel_potrivire: nivel,
      asemanare_titlu: Math.round(titlu * 100) / 100,
      are_reteta: articole.length > 0,
      de_copiat: {
        nod_id: s.nod_id || null,
        cod_esco: s.cod_esco || null,
        cod_uniclass: s.cod_uniclass || null,
        niveluri: (s.niveluri || []).map((n) => n.nivel),
        articole: articole.map((a) => ({ articol_id: a.articol_id, simbol: a.simbol })),
      },
    });
  }
  return rezultat.sort((a, b) => a.nivel_potrivire - b.nivel_potrivire
    || b.asemanare_titlu - a.asemanare_titlu
    || Number(b.are_reteta) - Number(a.are_reteta)
    || String(a.serviciu.titlu).localeCompare(String(b.serviciu.titlu), 'ro'));
}

// ── Produse din marketplace (pasul 10a, 16 oct. 2026) ─────────────────────
// Aceeași rută ca la servicii, pentru produsele importate din lista de
// prețuri a unui furnizor (api/marketplace/importa-csv.js):
//   materiale  → clasă NACE din capitolul G, nod de meniu din G, Uniclass Pr_ activ;
//   închirieri → clasă NACE din capitolul O77, nod din O77, Uniclass Pr_ opțional
//                (dacă e dat: activ și Pr_); un utilaj cu operator obligatoriu e
//                un serviciu (43.99, capitolul F), nu o închiriere.
// Tranziție (până la pasul 10): un nod de tip „materiale” / „inchirieri” fără
// capitol_cod e acceptat ca nod din capitolul cerut, cu avertisment.
// Fiecare mesaj are și `camp` (coloana din fișier), pentru raportul de import.
const RUTA_PRODUS = {
  materiale: { capitol: 'G', tipNod: 'materiale', uniclassObligatoriu: true, ro: 'materialele', en: 'materials', exempluNace: '47.52, 47.54, 46.73, 46.83, 46.84' },
  echipamente: { capitol: 'O77', tipNod: 'inchirieri', uniclassObligatoriu: false, ro: 'închirierile', en: 'rentals', exempluNace: '77.11, 77.12, 77.21, 77.22, 77.32, 77.39' },
};

function mesajCamp(cod, camp, mesaj_ro, mesaj_en) {
  return { cod, camp, mesaj_ro, mesaj_en };
}

/**
 * @param {object} p
 * @param {'materiale'|'echipamente'} p.tip
 * @param {object} p.produs - { nace_cod, cod_uniclass, operator_inclus, nod_menu }
 * @param {object|null} p.nod - nodul găsit după slug (categorii): { id, slug, title, title_en, capitol_cod, nace_clasa, category_type, activ }
 * @param {object|null} p.uniclass - rândul din uniclass_codes pentru cod_uniclass (null = nu există): { code, is_active, inlocuit_de? }
 * @param {object} p.ref - { capitole, naceClase }
 * @returns {{ ok: boolean, erori: Array, avertismente: Array }}
 */
function valideazaRutaProdus({ tip, produs = {}, nod = null, uniclass = null, ref = {} } = {}) {
  const cfg = RUTA_PRODUS[tip];
  const erori = [];
  const avertismente = [];
  if (!cfg) {
    erori.push(mesajCamp('R0', 'tip', `Tip de produs necunoscut: ${tip}.`, `Unknown product type: ${tip}.`));
    return { ok: false, erori, avertismente };
  }
  const naceClase = ref.naceClase instanceof Set ? ref.naceClase : new Set(ref.naceClase || []);
  const clasa = normalizeazaNace(produs.nace_cod);
  const clasaExista = !!clasa && naceClase.has(clasa);
  const primulExemplu = cfg.exempluNace.split(',')[0];

  // R1 — clasa NACE există
  if (!clasaExista) {
    erori.push(mesajCamp('R1', 'nace_cod',
      `Clasa NACE „${produs.nace_cod || '—'}” nu există în nomenclatorul NACE (4 cifre, de exemplu ${primulExemplu}).`,
      `NACE class "${produs.nace_cod || '—'}" does not exist in the NACE list (4 digits, e.g. ${primulExemplu}).`));
  }

  // R2 — un utilaj cu operator obligatoriu e serviciu (43.99), nu închiriere
  if (tip === 'echipamente' && produs.operator_inclus === 'operator_obligatoriu') {
    erori.push(mesajCamp('R2', 'operator_inclus',
      'Un utilaj cu operator obligatoriu e un serviciu (NACE 43.99, capitolul F), nu o închiriere: se adaugă din asistentul „Serviciu nou”.',
      'Machinery with a mandatory operator is a service (NACE 43.99, chapter F), not a rental: add it from the "New service" assistant.'));
  }

  // R3 — capitolul clasei NACE
  const capitolCalculat = clasaExista ? capitolPentruNace(clasa, ref.capitole || []) : null;
  if (clasaExista && capitolCalculat !== cfg.capitol) {
    erori.push(mesajCamp('R3', 'nace_cod',
      `Clasa NACE ${clasa} e în capitolul ${capitolCalculat || '—'}; ${cfg.ro} cer o clasă din capitolul ${cfg.capitol} (de exemplu ${cfg.exempluNace}).`,
      `NACE class ${clasa} is in chapter ${capitolCalculat || '—'}; ${cfg.en} need a class from chapter ${cfg.capitol} (e.g. ${cfg.exempluNace}).`));
  }

  // R4 — nodul de meniu; R5 — clasa nodului
  const slug = String(produs.nod_menu || '').trim();
  if (!slug) {
    erori.push(mesajCamp('R4', 'nod_menu', 'Lipsește nodul de meniu (nod_menu: slug-ul din categorii).', 'The menu node is missing (nod_menu: the slug from categorii).'));
  } else if (!nod || nod.activ === false) {
    erori.push(mesajCamp('R4', 'nod_menu', `Nodul de meniu „${slug}” nu există sau e inactiv.`, `Menu node "${slug}" does not exist or is inactive.`));
  } else {
    const titluRo = nod.title || nod.slug;
    const titluEn = nod.title_en || nod.slug;
    if (nod.capitol_cod && nod.capitol_cod !== cfg.capitol) {
      erori.push(mesajCamp('R4', 'nod_menu',
        `Nodul „${titluRo}” e în capitolul ${nod.capitol_cod}; ${cfg.ro} cer un nod din capitolul ${cfg.capitol}.`,
        `Node "${titluEn}" is in chapter ${nod.capitol_cod}; ${cfg.en} need a node from chapter ${cfg.capitol}.`));
    } else if (!nod.capitol_cod && nod.category_type !== cfg.tipNod) {
      erori.push(mesajCamp('R4', 'nod_menu',
        `Nodul „${titluRo}” nu e un nod de ${cfg.tipNod === 'materiale' ? 'materiale' : 'închirieri'}.`,
        `Node "${titluEn}" is not a ${cfg.tipNod === 'materiale' ? 'materials' : 'rentals'} node.`));
    } else if (!nod.capitol_cod) {
      avertismente.push(mesajCamp('A5', 'nod_menu',
        `Nodul „${titluRo}” nu are încă capitol și clasă NACE (se completează la pasul 10); e acceptat ca nod din capitolul ${cfg.capitol}.`,
        `Node "${titluEn}" has no chapter and NACE class yet (filled in at step 10); it is accepted as a chapter ${cfg.capitol} node.`));
    }
    const clasaNod = normalizeazaNace(nod.nace_clasa);
    if (clasaNod && clasa && clasaNod !== clasa) {
      erori.push(mesajCamp('R5', 'nace_cod',
        `Clasa NACE a produsului (${clasa}) diferă de clasa nodului „${titluRo}” (${clasaNod}).`,
        `The product's NACE class (${clasa}) differs from the class of node "${titluEn}" (${clasaNod}).`));
    }
  }

  // R6 — Uniclass: Pr_, activ (obligatoriu la materiale)
  const cod = String(produs.cod_uniclass || '').trim();
  if (!cod) {
    if (cfg.uniclassObligatoriu) {
      erori.push(mesajCamp('R6', 'cod_uniclass', 'Lipsește codul Uniclass: materialele cer un cod Pr_ activ.', 'The Uniclass code is missing: materials need an active Pr_ code.'));
    }
  } else if (!uniclass) {
    erori.push(mesajCamp('R6', 'cod_uniclass', `Codul Uniclass „${cod}” nu există în uniclass_codes.`, `Uniclass code "${cod}" does not exist in uniclass_codes.`));
  } else if (uniclass.is_active === false) {
    const nou = uniclass.inlocuit_de || null;
    erori.push(mesajCamp('R6', 'cod_uniclass', `Codul Uniclass ${cod} e retras${nou ? `; folosește ${nou}` : ''}.`, `Uniclass code ${cod} is withdrawn${nou ? `; use ${nou}` : ''}.`));
  } else if (!cod.startsWith('Pr_')) {
    erori.push(mesajCamp('R6', 'cod_uniclass', `Codul Uniclass ${cod} e din tabelul greșit: un produs cere Pr_.`, `Uniclass code ${cod} is from the wrong table: a product needs Pr_.`));
  }

  return { ok: erori.length === 0, erori, avertismente };
}

module.exports = {
  normalizeazaNace, grupaNace, diviziuneNace, diviziuneDinText,
  capitolPentruNace, tipCodEsco, radaciniTitlu, asemanareTitlu, PRAG_DUPLICAT,
  valideazaRuta, serviciiAsemanatoare, valideazaRutaProdus, RUTA_PRODUS,
};
