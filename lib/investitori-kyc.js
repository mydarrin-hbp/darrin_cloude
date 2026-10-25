// lib/investitori-kyc.js
// Regulile rutei de investitor și ale verificării identității (pasul 11-L,
// 17 oct. 2026), într-un singur loc: le folosesc api/investitori/kyc.js,
// api/investitori/kyc-document.js, api/admin/investitori-kyc.js și
// api/cont/profil.js.
//
// Verificarea identității e obligatorie pentru orice investitor (regula AML
// implicită) și e manuală: documentele se păstrează privat, în bucket-ul
// `investitori-kyc` (migrarea docs/migrations-propuse/2026-10-17_investitori_kyc.sql),
// și le verifică echipa My Darrin. Nu există OCR și nici prag de sumă.
//
// Stările dosarului (investitori_kyc.status):
//   ciorna        — ruta e începută, nu e trimisă (progresul se păstrează pe server);
//   in_verificare — trimis; rolul `investor` e adăugat în profiles.roles;
//   aprobat / respins — decizia adminului, cu motiv (RO + EN) la respingere.
// Un dosar respins se poate corecta și retrimite.
//
// Pasul 11-P2a (25 oct. 2026): dosarul conține și datele de identificare ale
// investitorului persoană fizică (lib/identitate-pf.js): data nașterii,
// cetățenia, adresa de domiciliu, CNP-ul (cetățeni români) sau NIF-ul
// (străini), seria și numărul actului de identitate și valabilitatea lui.

const { supabaseAdmin } = require('./supabaseAdmin');
const { aziIso } = require('./identitate-pf');

const BUCKET = 'investitori-kyc';
const MARIME_MAXIMA = 5 * 1024 * 1024; // 5 MB pe fișier
const TIPURI_FISIER = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
});
// Tipul documentului de identitate. Pașaportul are doar pagina cu fotografia.
const TIPURI_DOCUMENT = Object.freeze(['ci', 'pasaport', 'permis_sedere']);
const ARE_VERSO = Object.freeze({ ci: true, pasaport: false, permis_sedere: true });

const PASI = 5;
const STARI_EDITABILE = Object.freeze(['ciorna', 'respins']);

// Chestionarul de profil de risc (MiFID II): trei întrebări, câte trei variante.
const MIFID_INTREBARI = Object.freeze(['experienta', 'toleranta', 'scop']);
const MIFID_VARIANTE = 3;

// Valorile date de client sunt scurtate și curățate înainte de salvare.
function text(v, max = 120) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function codTara(v) {
  const c = text(v, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : '';
}

// Calea unui fișier e mereu „<user_id>/<latura>-<timp>-<aleator>.<ext>”.
function caleaApartine(cale, userId) {
  return typeof cale === 'string' && !!userId && cale.startsWith(userId + '/') && !cale.includes('..') && cale.length < 300;
}

function estePep(kyc) {
  return !!(kyc && (kyc.pep_check === true || (kyc.pep_declaratie && kyc.pep_declaratie.este_pep === true)));
}

// Adresa de domiciliu: strada, localitatea și țara; județul doar pentru RO.
function adresaCompleta(a) {
  if (!a || !a.strada || !a.localitate || !codTara(a.tara)) return false;
  return a.tara !== 'RO' || !!a.judet;
}

// Cetățenii români au CNP; străinii au NIF sau CNP de rezident străin.
function idFiscalPotrivit(kyc) {
  if (!kyc || !kyc.id_fiscal_criptat || !kyc.cnp_hash) return false;
  if (kyc.id_fiscal_tip !== 'cnp' && kyc.id_fiscal_tip !== 'nif') return false;
  return kyc.cetatenie !== 'RO' || kyc.id_fiscal_tip === 'cnp';
}

// Ce lipsește din dosar ca să poată fi trimis (pasul 5). Listă goală = complet.
function cerinteLipsa(kyc) {
  const lipsa = [];
  const d = (kyc && kyc.date_personale) || {};
  if (!d.prenume || !d.nume || !d.telefon || !d.tara) lipsa.push('date_personale');
  if (!kyc || !kyc.data_nasterii) lipsa.push('data_nasterii');
  if (!kyc || !codTara(kyc.cetatenie)) lipsa.push('cetatenie');
  if (!kyc || !adresaCompleta(kyc.adresa_domiciliu)) lipsa.push('adresa_domiciliu');
  if (!idFiscalPotrivit(kyc)) lipsa.push('id_fiscal');
  if (!kyc || !kyc.iban_criptat) lipsa.push('cont_bancar');
  if (!kyc || !TIPURI_DOCUMENT.includes(kyc.tip_document)) lipsa.push('tip_document');
  if (!kyc || !kyc.document_fata_path) lipsa.push('document_fata');
  if (kyc && ARE_VERSO[kyc.tip_document] && !kyc.document_verso_path) lipsa.push('document_verso');
  if (!kyc || !kyc.act_serie_numar_criptat) lipsa.push('act_serie_numar');
  // un act expirat între timp nu mai e valabil la trimitere
  if (!kyc || !kyc.act_valabil_pana || String(kyc.act_valabil_pana).slice(0, 10) < aziIso()) lipsa.push('act_valabil_pana');
  const m = (kyc && kyc.mifid_raspunsuri) || {};
  if (!MIFID_INTREBARI.every((q) => Number.isInteger(m[q]) && m[q] >= 0 && m[q] < MIFID_VARIANTE)) lipsa.push('mifid');
  if (!kyc || !kyc.pep_declaratie || typeof kyc.pep_declaratie.este_pep !== 'boolean') lipsa.push('pep');
  if (!kyc || kyc.sanctiuni_declarat !== true) lipsa.push('sanctiuni');
  if (!kyc || !codTara(kyc.rezidenta_fiscala_tara)) lipsa.push('rezidenta_fiscala');
  return lipsa;
}

// Dosarul KYC al contului (null dacă nu există). select('*'): înainte de
// migrare, coloanele noi lipsesc, iar codul nu trebuie să cadă din cauza asta.
async function citesteKyc(userId) {
  const { data, error } = await supabaseAdmin.from('investitori_kyc').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Starea arătată utilizatorului (profil, „Rolurile mele”, dashboard). Fără
// IBAN în clar, fără căi de fișiere, fără răspunsuri de chestionar.
function starePublica(kyc) {
  if (!kyc) return null;
  return {
    status: kyc.status || 'ciorna',
    pas_curent: Number.isInteger(kyc.pas_curent) ? kyc.pas_curent : 1,
    trimis_la: kyc.status && kyc.status !== 'ciorna' ? kyc.submitted_at || null : null,
    motiv_respingere: kyc.status === 'respins' ? (kyc.motiv_respingere_ro || null) : null,
    motiv_respingere_en: kyc.status === 'respins' ? (kyc.motiv_respingere_en || null) : null,
  };
}

module.exports = {
  BUCKET, MARIME_MAXIMA, TIPURI_FISIER, TIPURI_DOCUMENT, ARE_VERSO, PASI, STARI_EDITABILE,
  MIFID_INTREBARI, MIFID_VARIANTE,
  text, codTara, caleaApartine, estePep, adresaCompleta, cerinteLipsa, citesteKyc, starePublica,
};
