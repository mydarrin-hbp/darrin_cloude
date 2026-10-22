// lib/raspuns-eroare.js
// Forma comună a erorilor din api/admin/* (pasul 11-N1, 22 oct. 2026; spec.
// LM „Modul Superadmin”, AC-03 / AC-04):
//
//   { ok:false, cod, mesaj:{ ro, en }, campuri:[{ camp, mesaj:{ ro, en } }] }
//
// Mesajul spune ce câmp e greșit și ce trebuie făcut; `campuri` leagă
// eroarea de câmpul din formular (MDFeedback.aplicaErori îl marchează).
// Pentru paginile care citesc încă `error` / `error_en` (catalog-niveluri.js,
// mydarrin-admin-catalog.html, account-system.js) răspunsul le păstrează și
// pe acestea, cu același text.
//
// Utilizare:
//   const { trimiteEroare, camp } = require('../../lib/raspuns-eroare');
//   return trimiteEroare(res, 400, 'DATE_INVALIDE',
//     'Completați «Denumire (RO)».', 'Please fill in «Name (RO)».',
//     [camp('denumire_ro', 'Completați «Denumire (RO)».', 'Please fill in «Name (RO)».')]);
//
//   module.exports = formaComuna(requireAuth([...], handler));
//   → răspunsurile vechi { error } cu status ≥ 400 ies în forma comună.

// Traducerile existente ale mesajelor de eroare (i18n/en.json → _texte).
let TEXTE_EN = {};
try { TEXTE_EN = require('../i18n/en.json')._texte || {}; } catch (e) { TEXTE_EN = {}; }

const COD_DIN_STATUS = {
  400: 'DATE_INVALIDE', 401: 'NEAUTENTIFICAT', 403: 'FARA_DREPT', 404: 'NU_EXISTA',
  405: 'METODA_NEPERMISA', 409: 'CONFLICT', 413: 'PREA_MARE', 429: 'PREA_MULTE_CERERI',
  500: 'EROARE_SERVER', 502: 'EROARE_SERVER', 503: 'INDISPONIBIL',
};

// Câteva mesaje vechi frecvente, fără traducere în dicționar.
const EN_FRECVENTE = {
  'Neautentificat': 'Not authenticated',
  'Nu ai permisiunea necesară pentru acest rol': 'You do not have the required permission for this role',
  'Eroare internă de autentificare': 'Internal authentication error',
  'Eroare internă.': 'Internal error.',
  'Method not allowed': 'Method not allowed',
  'id este obligatoriu': 'id is required',
  'id obligatoriu.': 'id is required.',
};

function camp(nume, ro, en) {
  return { camp: nume, mesaj: { ro, en: en || ro } };
}

function traduceEn(ro, en) {
  if (en) return en;
  if (ro == null) return '';
  return EN_FRECVENTE[ro] || TEXTE_EN[ro] || ro;
}

function corpEroare(cod, mesaj_ro, mesaj_en, campuri, extra) {
  const en = traduceEn(mesaj_ro, mesaj_en);
  return Object.assign({}, extra || {}, {
    ok: false,
    cod: cod || 'EROARE',
    mesaj: { ro: mesaj_ro, en },
    campuri: Array.isArray(campuri) ? campuri : [],
    error: mesaj_ro,
    error_en: en,
  });
}

function trimiteEroare(res, status, cod, mesaj_ro, mesaj_en, campuri, extra) {
  return res.status(status).json(corpEroare(cod, mesaj_ro, mesaj_en, campuri, extra));
}

// Un corp de eroare vechi ({ error }, { mesaj }, { motiv }) → forma comună.
function normalizeaza(corp, status) {
  if (corp && typeof corp === 'object' && corp.mesaj && typeof corp.mesaj === 'object' && corp.mesaj.ro) {
    return Object.assign({ ok: false, campuri: [] }, corp);
  }
  const vechi = corp && typeof corp === 'object' ? corp : { error: corp == null ? '' : String(corp) };
  const ro = vechi.error || (typeof vechi.mesaj === 'string' ? vechi.mesaj : '') || vechi.motiv || vechi.message
    || 'Eroare (HTTP ' + status + ').';
  const extra = Object.assign({}, vechi);
  delete extra.error; delete extra.error_en; delete extra.mesaj; delete extra.cod;
  return corpEroare(vechi.cod || COD_DIN_STATUS[status] || (status >= 500 ? 'EROARE_SERVER' : 'EROARE'),
    ro, vechi.error_en, vechi.campuri, extra);
}

// Învelește un handler: orice răspuns JSON cu status ≥ 400 iese în forma comună.
// Răspunsurile de succes și datele întoarse nu se schimbă.
function formaComuna(handler) {
  const invelit = function (req, res) {
    const jsonOriginal = res.json;
    if (typeof jsonOriginal === 'function' && !res.__formaComuna) {
      res.__formaComuna = true;
      res.json = function (corp) {
        const status = res.statusCode || 200;
        return jsonOriginal.call(this, status >= 400 ? normalizeaza(corp, status) : corp);
      };
    }
    return handler.apply(this, arguments);
  };
  return Object.assign(invelit, handler);
}

module.exports = { trimiteEroare, camp, corpEroare, normalizeaza, formaComuna };
