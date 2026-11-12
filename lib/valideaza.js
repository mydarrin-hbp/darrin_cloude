// lib/valideaza.js
// Validarea datelor primite de API (pasul 11-S1, 13 nov. 2026). Fără
// dependențe: reguli mici, compuse într-o schemă { câmp: regulă }.
//
// Erorile ies în forma comună din lib/raspuns-eroare.js:
//   400 { ok:false, cod:'DATE_INVALIDE', mesaj:{ro,en}, campuri:[{camp, mesaj:{ro,en}}] }
// Mesajul principal e primul câmp greșit; `campuri` le conține pe toate, ca
// MDFeedback.aplicaErori să le marcheze în formular.
//
// Utilizare:
//   const v = require('../../lib/valideaza');
//   const SCHEMA = {
//     email:   v.email({ obligatoriu: true, eticheta: ['Email', 'Email'] }),
//     nume:    v.text({ max: 200 }),
//     suma:    v.numar({ min: 0, max: 1e7 }),
//     tip:     v.dinLista(['a', 'b']),
//     id:      v.uuid({ obligatoriu: true }),
//     accept:  v.boolean({ obligatoriu: true, adevarat: true }),
//     linii:   v.lista(v.obiect({ id: v.uuid() }), { max: 50 }),
//   };
//   const r = v.valideaza(req.body, SCHEMA);        // necunoscute: 'refuza' (implicit)
//   if (!r.ok) return v.trimite(res, r);
//   const { email, nume } = r.date;                  // valori curățate; doar câmpurile din schemă
//
// Opțiuni comune ale regulilor:
//   obligatoriu  — lipsa (undefined, null, '' după trim) e eroare;
//   eticheta     — [ro, en], numele câmpului în mesaj (implicit: numele cheii);
//   implicit     — valoarea pusă în `date` când câmpul lipsește.
// valideaza(corp, schema, { necunoscute, limite }):
//   'refuza' (implicit) — un câmp care nu e în schemă dă eroare;
//   'ignora'            — câmpurile necunoscute nu intră în `date`, fără eroare;
//                         corpul trece și prin limiteCorp() (mărime 100 KB, text
//                         5000 de caractere, liste de 500, 6 niveluri), pentru
//                         câmpurile citite direct de logica endpoint-ului.
//   limite: { maxOcteti, maxText, maxLista, maxAdancime, exceptii } — le schimbă.
//
// Unde se aplică (pasul 11-S1):
//   - endpoint-urile publice (api/public, darrin-ai): schema completă,
//     necunoscute: 'refuza' — apelanții din pagini au fost verificați;
//   - endpoint-urile cu cont (api/cont, api/client, api/partener,
//     api/investitori): tipuri și lungimi pe câmpurile citite, necunoscute:
//     'ignora' + limitele generale; validarea de conținut existentă rămâne.
// id() acceptă uuid-uri și id-uri scurte (litere, cifre, - _ : .); uuid() cere uuid.

const { trimiteEroare, camp: campEroare } = require('./raspuns-eroare');

const LIPSA = Symbol('lipsa');

function eticheta(reg, nume) {
  const e = reg.eticheta;
  if (Array.isArray(e)) return { ro: e[0], en: e[1] || e[0] };
  if (e && typeof e === 'object') return { ro: e.ro, en: e.en || e.ro };
  return { ro: nume, en: nume };
}

function eroare(ro, en) { return { eroare: { ro, en } }; }

function eGol(x) { return x === undefined || x === null || (typeof x === 'string' && x.trim() === ''); }

// Învelișul comun: lipsă / obligatoriu / implicit, apoi verificarea proprie.
function regula(verifica, opt) {
  const o = opt || {};
  const fn = function (valoare, nume) {
    const et = eticheta(o, nume);
    if (eGol(valoare)) {
      if (o.obligatoriu) return eroare(`Completați «${et.ro}».`, `Please fill in «${et.en}».`);
      return { valoare: o.implicit !== undefined ? o.implicit : LIPSA };
    }
    return verifica(valoare, et, nume);
  };
  fn.optiuni = o;
  return fn;
}

function text(opt) {
  const o = Object.assign({ max: 500 }, opt);
  return regula(function (x, et) {
    if (typeof x !== 'string' && typeof x !== 'number') {
      return eroare(`«${et.ro}» trebuie să fie text.`, `«${et.en}» must be text.`);
    }
    const s = o.faraTrim ? String(x) : String(x).trim();
    if (o.min && s.length < o.min) {
      return eroare(`«${et.ro}» trebuie să aibă cel puțin ${o.min} caractere.`, `«${et.en}» must have at least ${o.min} characters.`);
    }
    if (s.length > o.max) {
      return eroare(`«${et.ro}» poate avea cel mult ${o.max} caractere (acum: ${s.length}). Scurtați textul.`,
        `«${et.en}» can have at most ${o.max} characters (now: ${s.length}). Please shorten it.`);
    }
    if (o.model && !o.model.test(s)) {
      return eroare(o.mesajModel ? o.mesajModel[0] : `«${et.ro}» nu are formatul corect.`,
        o.mesajModel ? o.mesajModel[1] : `«${et.en}» does not have the right format.`);
    }
    return { valoare: s };
  }, o);
}

const MODEL_EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

function email(opt) {
  const o = Object.assign({ max: 254 }, opt);
  return regula(function (x, et) {
    if (typeof x !== 'string') return eroare(`«${et.ro}» trebuie să fie o adresă de email.`, `«${et.en}» must be an email address.`);
    const s = x.trim().toLowerCase();
    if (s.length > o.max || !MODEL_EMAIL.test(s)) {
      return eroare(`«${et.ro}» nu este o adresă de email validă. Exemplu: nume@domeniu.ro.`,
        `«${et.en}» is not a valid email address. Example: name@domain.com.`);
    }
    return { valoare: s };
  }, o);
}

const MODEL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(opt) {
  return regula(function (x, et) {
    if (typeof x !== 'string' || !MODEL_UUID.test(x.trim())) {
      return eroare(`«${et.ro}» nu este un identificator valid.`, `«${et.en}» is not a valid identifier.`);
    }
    return { valoare: x.trim().toLowerCase() };
  }, opt);
}

// Identificator de rând: uuid în producție; acceptă și id-uri scurte
// (litere, cifre, - _ : .), fără spații sau alte caractere, cel mult 64.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,63}$/;
function id(opt) {
  return regula(function (x, et) {
    const s = typeof x === 'number' && Number.isInteger(x) ? String(x) : x;
    if (typeof s !== 'string' || !MODEL_ID.test(s.trim())) {
      return eroare(`«${et.ro}» nu este un identificator valid.`, `«${et.en}» is not a valid identifier.`);
    }
    return { valoare: typeof x === 'number' ? x : s.trim() };
  }, opt);
}

function numar(opt) {
  const o = Object.assign({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }, opt);
  return regula(function (x, et) {
    const n = typeof x === 'number' ? x : (typeof x === 'string' && x.trim() !== '' ? Number(x.trim().replace(',', '.')) : NaN);
    if (!Number.isFinite(n) || (o.intreg && !Number.isInteger(n)) || n < o.min || n > o.max) {
      const tip = o.intreg ? 'un număr întreg' : 'un număr';
      const tipEn = o.intreg ? 'a whole number' : 'a number';
      return eroare(`«${et.ro}» trebuie să fie ${tip} între ${o.min} și ${o.max}.`,
        `«${et.en}» must be ${tipEn} between ${o.min} and ${o.max}.`);
    }
    return { valoare: n };
  }, o);
}

function dinLista(valori, opt) {
  const lista = Array.from(valori);
  return regula(function (x, et) {
    const s = typeof x === 'string' ? x.trim() : x;
    if (!lista.includes(s)) {
      const arata = lista.length <= 12 ? lista.join(', ') : lista.slice(0, 12).join(', ') + ', …';
      return eroare(`«${et.ro}» trebuie să fie una dintre valorile: ${arata}.`,
        `«${et.en}» must be one of: ${arata}.`);
    }
    return { valoare: s };
  }, opt);
}

function boolean(opt) {
  const o = opt || {};
  return regula(function (x, et) {
    let b = x;
    if (x === 'true') b = true; else if (x === 'false') b = false;
    if (typeof b !== 'boolean') return eroare(`«${et.ro}» trebuie să fie da sau nu (true / false).`, `«${et.en}» must be yes or no (true / false).`);
    if (o.adevarat && b !== true) return eroare(`Bifați «${et.ro}» ca să continuați.`, `Please tick «${et.en}» to continue.`);
    return { valoare: b };
  }, o);
}

// Dată calendaristică AAAA-LL-ZZ sau dată și oră ISO.
function data(opt) {
  return regula(function (x, et) {
    if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(x.trim()) || isNaN(Date.parse(x.trim()))) {
      return eroare(`«${et.ro}» trebuie să fie o dată validă (AAAA-LL-ZZ).`, `«${et.en}» must be a valid date (YYYY-MM-DD).`);
    }
    return { valoare: x.trim() };
  }, opt);
}

// Listă de elemente, fiecare verificat cu `element` (o regulă).
function lista(element, opt) {
  const o = Object.assign({ max: 100 }, opt);
  return regula(function (x, et, nume) {
    if (!Array.isArray(x)) return eroare(`«${et.ro}» trebuie să fie o listă.`, `«${et.en}» must be a list.`);
    if (x.length > o.max) {
      return eroare(`«${et.ro}» poate avea cel mult ${o.max} elemente (acum: ${x.length}).`,
        `«${et.en}» can have at most ${o.max} items (now: ${x.length}).`);
    }
    if (o.min && x.length < o.min) {
      return eroare(`«${et.ro}» trebuie să aibă cel puțin ${o.min} ${o.min === 1 ? 'element' : 'elemente'}.`,
        `«${et.en}» must have at least ${o.min} ${o.min === 1 ? 'item' : 'items'}.`);
    }
    const out = [];
    for (let i = 0; i < x.length; i++) {
      const r = element ? element(x[i], `${nume}[${i}]`) : { valoare: x[i] };
      if (r.eroare) return { eroare: { ro: `${et.ro}, elementul ${i + 1}: ${r.eroare.ro}`, en: `${et.en}, item ${i + 1}: ${r.eroare.en}` } };
      out.push(r.valoare === LIPSA ? null : r.valoare);
    }
    return { valoare: out };
  }, o);
}

// Obiect imbricat, cu propria schemă (câmpurile necunoscute: ca la valideaza).
function obiect(schema, opt) {
  const o = Object.assign({ necunoscute: 'refuza' }, opt);
  return regula(function (x, et, nume) {
    const r = valideaza(x, schema, { necunoscute: o.necunoscute, prefix: nume + '.' });
    if (!r.ok) {
      const p = r.campuri[0];
      return { eroare: { ro: `${et.ro}: ${p.mesaj.ro}`, en: `${et.en}: ${p.mesaj.en}` } };
    }
    return { valoare: r.date };
  }, o);
}

// Valoare liberă (JSON), cu o limită de mărime la serializare.
function oricare(opt) {
  const o = Object.assign({ maxOcteti: 20000 }, opt);
  return regula(function (x, et) {
    let n = 0;
    try { n = Buffer.byteLength(JSON.stringify(x)); } catch (e) { n = Infinity; }
    if (n > o.maxOcteti) {
      return eroare(`«${et.ro}» este prea mare (cel mult ${o.maxOcteti} octeți).`, `«${et.en}» is too large (at most ${o.maxOcteti} bytes).`);
    }
    return { valoare: x };
  }, o);
}

// Limite generale pentru corpurile cu structură bogată (adrese, configurări de
// coș, pașii asistenților), validate în detaliu de logica endpoint-ului:
// mărimea totală, lungimea fiecărui text, numărul de elemente dintr-o listă,
// adâncimea. `exceptii`: câmpurile de nivel întâi cu conținut mare (base64),
// care au propria limită.
function limiteCorp(corp, optiuni) {
  const o = Object.assign({ maxOcteti: 100000, maxText: 5000, maxLista: 500, maxAdancime: 6, exceptii: [] }, optiuni);
  let gresit = null;
  function parcurge(x, cale, adancime) {
    if (gresit) return;
    if (adancime > o.maxAdancime) { gresit = { cale, tip: 'adancime' }; return; }
    if (typeof x === 'string') { if (x.length > o.maxText) gresit = { cale, tip: 'text', n: x.length }; return; }
    if (Array.isArray(x)) {
      if (x.length > o.maxLista) { gresit = { cale, tip: 'lista', n: x.length }; return; }
      x.forEach((e, i) => parcurge(e, `${cale}[${i}]`, adancime + 1));
      return;
    }
    if (x && typeof x === 'object') {
      for (const k of Object.keys(x)) {
        if (adancime === 0 && o.exceptii.includes(k)) continue;
        parcurge(x[k], cale ? `${cale}.${k}` : k, adancime + 1);
      }
    }
  }
  let marime = 0;
  try {
    const copie = Object.assign({}, corp);
    o.exceptii.forEach((k) => { delete copie[k]; });
    marime = Buffer.byteLength(JSON.stringify(copie));
  } catch (e) { marime = Infinity; }
  if (marime > o.maxOcteti) {
    const ro = `Cererea e prea mare (cel mult ${Math.round(o.maxOcteti / 1000)} KB). Trimiteți mai puține date.`;
    const en = `The request is too large (at most ${Math.round(o.maxOcteti / 1000)} KB). Please send less data.`;
    return { ok: false, mesaj: { ro, en }, campuri: [campEroare('_corp', ro, en)] };
  }
  parcurge(corp, '', 0);
  if (!gresit) return { ok: true };
  let ro, en;
  if (gresit.tip === 'text') {
    ro = `«${gresit.cale}» poate avea cel mult ${o.maxText} caractere (acum: ${gresit.n}). Scurtați textul.`;
    en = `«${gresit.cale}» can have at most ${o.maxText} characters (now: ${gresit.n}). Please shorten it.`;
  } else if (gresit.tip === 'lista') {
    ro = `«${gresit.cale}» poate avea cel mult ${o.maxLista} elemente (acum: ${gresit.n}).`;
    en = `«${gresit.cale}» can have at most ${o.maxLista} items (now: ${gresit.n}).`;
  } else {
    ro = `«${gresit.cale}» are prea multe niveluri imbricate.`;
    en = `«${gresit.cale}» has too many nested levels.`;
  }
  return { ok: false, mesaj: { ro, en }, campuri: [campEroare(gresit.cale || '_corp', ro, en)] };
}

function valideaza(corp, schema, optiuni) {
  const o = Object.assign({ necunoscute: 'refuza', prefix: '' }, optiuni);
  const campuri = [];
  const date = {};
  if (corp === undefined || corp === null) corp = {};
  if (typeof corp !== 'object' || Array.isArray(corp)) {
    const ro = 'Corpul cererii trebuie să fie un obiect JSON.';
    const en = 'The request body must be a JSON object.';
    return { ok: false, mesaj: { ro, en }, campuri: [campEroare(o.prefix.replace(/\.$/, '') || '_corp', ro, en)] };
  }
  // Cu necunoscute: 'ignora', câmpurile din afara schemei trec mai departe la
  // logica endpoint-ului, deci li se aplică limitele generale.
  if (o.limite || (o.necunoscute === 'ignora' && o.limite !== false)) {
    const l = limiteCorp(corp, o.limite || {});
    if (!l.ok) return l;
  }
  if (o.necunoscute === 'refuza') {
    for (const k of Object.keys(corp)) {
      if (!Object.prototype.hasOwnProperty.call(schema, k)) {
        campuri.push(campEroare(o.prefix + k,
          `Câmp necunoscut: «${k}». Trimiteți doar câmpurile formularului.`,
          `Unknown field: «${k}». Send only the form fields.`));
      }
    }
  }
  for (const k of Object.keys(schema)) {
    const r = schema[k](corp[k], k);
    if (r.eroare) campuri.push(campEroare(o.prefix + k, r.eroare.ro, r.eroare.en));
    else if (r.valoare !== LIPSA) date[k] = r.valoare;
  }
  if (campuri.length) return { ok: false, mesaj: campuri[0].mesaj, campuri };
  return { ok: true, date };
}

function trimite(res, rezultat, status) {
  return trimiteEroare(res, status || 400, 'DATE_INVALIDE', rezultat.mesaj.ro, rezultat.mesaj.en, rezultat.campuri);
}

// Scurtătură: validează și, la eroare, trimite 400. Întoarce datele sau null.
function valideazaSauTrimite(req, res, schema, optiuni) {
  const r = valideaza(req.body, schema, optiuni);
  if (!r.ok) { trimite(res, r); return null; }
  return r.date;
}

// Un produs adăugat la o comandă (materiale, închirieri, coș): id-ul din
// catalog (uuid) sau din marketplace („mp:<tip>:<id>”), cantitatea, nivelul.
const ITEM_PRODUS = obiect({
  id: text({ obligatoriu: true, max: 120, eticheta: ['Produs', 'Product'] }),
  qty: numar({ min: 0, max: 100000, eticheta: ['Cantitate', 'Quantity'] }),
  nivel: text({ max: 50, eticheta: ['Nivel', 'Level'] }),
}, { eticheta: ['Produs', 'Product'] });

module.exports = {
  text, email, uuid, id, numar, dinLista, boolean, data, lista, obiect, oricare, ITEM_PRODUS,
  valideaza, limiteCorp, trimite, valideazaSauTrimite, MODEL_UUID, MODEL_EMAIL,
};
