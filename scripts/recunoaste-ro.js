// scripts/recunoaste-ro.js
// Pasul 11-T1 (13 nov. 2026): recunoașterea textului în română, pentru testele care nu
// rulează în browser (emailuri, răspunsuri API, conținutul din baza de date).
// Aceleași reguli ca în scripts/detector-ro.js și scripts/test-i18n-fara-romana.js:
// diacritice românești sau cuvinte frecvente, după ce se scot excepțiile.
//
// EXCEPTII — lista explicită a textelor care nu se traduc (regulile proiectului):
//   nume proprii (platforma, firme, mărci, autorizări), orașe, adrese, numele limbilor
//   din selector. O excepție nouă se adaugă aici, cu motivul.

const EXCEPTII = [
  // platforma și firmele
  'My Darrin', 'Darrin AI', 'Darrin', 'Home Best Pal', 'HBP', 'ACA BUSINESS GROUP', 'ACA BG', 'ACA', 'SRL', 'LTD',
  // mărci din descrierile de produs
  'Vogel&Noot', 'Leroy Merlin', 'Dedeman', 'Baumit', 'Caparol', 'Kober', 'Purmo', 'Radox', 'Caleffi', 'Herz', 'Watts',
  'Legrand', 'Schneider', 'Cabelte', 'Elcoline',
  // autorizări românești (nume proprii ale autorităților)
  'ANRE', 'ISCIR', 'ANAF',
  // orașe
  'București', 'Bucureşti', 'Iași', 'Chișinău', 'Cluj-Napoca', 'Timișoara', 'Constanța', 'Brașov', 'Bacău', 'Galați', 'Ploiești',
  'Pitești', 'Târgu Mureș', 'Târgu Neamț', 'Târgu Jiu', 'Târgu', 'Brăila', 'Botoșani', 'Buzău', 'Focșani', 'Târgoviște', 'Reșița',
  'Bistrița', 'Călărași', 'Zalău', 'Sfântu Gheorghe', 'Bârlad', 'Mediaș', 'Onești', 'Piatra Neamț', 'Râmnicu Vâlcea', 'Neamț', 'Mureș',
  // țara și limbile din selector
  'România', 'Română', 'Ελληνικά', 'Български', 'Türkçe', 'Français', 'Deutsch', 'Magyar', 'Polski',
  // adrese
  'Calea Moinești', 'Moinești', 'Păcurari', 'Str.', 'Strada', 'Bd.', 'Calea', 'nr.', 'jud.',
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RE_EXCEPTII = new RegExp('(?<!\\p{L})(' + EXCEPTII.slice().sort((a, b) => b.length - a.length).map(esc).join('|') + '|Sector \\d|Județul \\p{L}+)(?!\\p{L})', 'gu');
const RO_CUV = /(?<!\p{L})(?:(?:[Pp]entru|[Ss]erviciu|[Ss]ervicii|[Cc]omandă|[Cc]omenzi|[Pp]reț|[Pp]rețuri|[Aa]lege|[Vv]ezi|[Dd]espre|[Cc]ont|[Cc]oș|[Cc]ătre|[Uu]rmător|[Îî]napoi|[Aa]casă|[Ll]ucrare|[Ll]ucrări|[Nn]ivel|[Gg]aranție|[Pp]lată|[Nn]ostru|[Nn]oastră|[Ee]ste|[Ss]unt|[Gg]ratuit|[Gg]ratuită|[Ll]ivrare|[Cc]erere|[Ss]olicită|[Ss]olicitare|[Zz]onă|[Pp]arteneri|[Cc]lienți|[Ii]nclus|[Aa]daugă|[Oo]rice|[Mm]inim|[Tt]arif|[Ll]ună|[Zz]ile|[Oo]ră|[Oo]re|[Mm]anoperă|[Ee]chipă|[Ii]ntervenție)|(?:și|sau|ți|tău|noi|din|cu|la|de|pe|în|un|al|ale))(?!\p{L})/u;
const DIAC = /[ăâîșțşţĂÂÎȘȚŞŢ]/;

function eRo(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  const c = text.replace(RE_EXCEPTII, ' ');
  return DIAC.test(c) || RO_CUV.test(c);
}

module.exports = { eRo, EXCEPTII };
