// lib/forme-juridice.js
// Pasul 11-P1 (25 oct. 2026): partener poate fi doar o entitate cu statut
// juridic. Persoana fizică nu poate deveni partener, pe nicio rută (rămâne
// client sau investitor). Sursa unică pentru formele juridice acceptate în
// partners.tip_entitate_legala; constrângerea din baza de date e în
// docs/migrations-propuse/2026-10-25_parteneri_doar_persoane_juridice.sql.
//
// Paginile publice folosesc copia din forme-juridice-public.js (aceleași
// coduri și etichete; scripts/test-forme-juridice.js verifică că sunt identice).
//
//   esteFormaValida('srl')                 -> true
//   valideazaCuiRo('RO46577229')           -> true
//   valideazaDateFirma({ tip_entitate_legala, cui, nume_firma, tara, forma_juridica_locala })
//     -> { ok:true, date } | { ok:false, camp, error, error_en }

const FORME_JURIDICE = [
  { cod: 'pfa', ro: 'Persoană fizică autorizată (PFA)', en: 'Authorised self-employed person (PFA)' },
  { cod: 'ii', ro: 'Întreprindere individuală (II)', en: 'Sole proprietorship (II)' },
  { cod: 'if', ro: 'Întreprindere familială (IF)', en: 'Family business (IF)' },
  { cod: 'srl', ro: 'Societate cu răspundere limitată (SRL)', en: 'Limited liability company (SRL)' },
  { cod: 'srl_d', ro: 'SRL debutant (SRL-D)', en: 'Start-up limited liability company (SRL-D)' },
  { cod: 'sa', ro: 'Societate pe acțiuni (SA)', en: 'Joint-stock company (SA)' },
  { cod: 'snc', ro: 'Societate în nume colectiv (SNC)', en: 'General partnership (SNC)' },
  { cod: 'scs', ro: 'Societate în comandită simplă (SCS)', en: 'Limited partnership (SCS)' },
  { cod: 'sca', ro: 'Societate în comandită pe acțiuni (SCA)', en: 'Partnership limited by shares (SCA)' },
  { cod: 'cooperativa', ro: 'Cooperativă', en: 'Cooperative' },
  { cod: 'institutie_publica', ro: 'Instituție publică', en: 'Public institution' },
  { cod: 'firma_straina', ro: 'Firmă înregistrată în altă țară', en: 'Company registered in another country' },
];

const CODURI = FORME_JURIDICE.map((f) => f.cod);
const CHEIE_CUI = '753217532';

const MESAJE = {
  lipsa_forma: {
    ro: 'Alege forma juridică a firmei.',
    en: "Choose the company's legal form.",
  },
  persoana_fizica: {
    ro: 'Contul de partener e doar pentru firme, PFA sau II. Ca persoană fizică poți fi client sau investitor.',
    en: 'Partner accounts are for registered businesses only (company, PFA or II). As a private individual you can be a client or an investor.',
  },
  forma_invalida: {
    ro: 'Forma juridică aleasă nu este în listă. Alege una dintre opțiunile din formular.',
    en: 'The selected legal form is not on the list. Choose one of the options in the form.',
  },
  firma_cui: {
    ro: 'Denumirea firmei și CUI-ul sunt obligatorii.',
    en: 'The company name and the tax ID (CUI) are required.',
  },
  cui_invalid: {
    ro: 'CUI-ul nu este valid: cifra de control nu se potrivește. Verifică-l în certificatul de înregistrare.',
    en: 'The tax ID (CUI) is not valid: the check digit does not match. Check it on the registration certificate.',
  },
  straina_in_ro: {
    ro: 'Pentru o firmă înregistrată în România alege forma ei juridică din listă (SRL, PFA, II etc.).',
    en: 'For a company registered in Romania, choose its legal form from the list (SRL, PFA, II etc.).',
  },
  lipsa_forma_locala: {
    ro: 'Scrie forma juridică din țara firmei (de exemplu GmbH, Ltd, EOOD).',
    en: "Enter the legal form used in the company's country (for example GmbH, Ltd, EOOD).",
  },
};

function esteFormaValida(cod) {
  return typeof cod === 'string' && CODURI.includes(cod);
}

function eticheta(cod, limba) {
  const f = FORME_JURIDICE.find((x) => x.cod === cod);
  if (!f) return null;
  return limba === 'en' ? f.en : f.ro;
}

// Cifra de control a CUI-ului românesc: cifrele fără ultima, completate cu
// zerouri în față până la 9, înmulțite cu cheia 753217532; suma × 10 mod 11
// (10 devine 0) trebuie să fie egală cu ultima cifră. Acceptă „RO” și spații.
function valideazaCuiRo(cui) {
  const curat = String(cui == null ? '' : cui).replace(/\s+/g, '').toUpperCase().replace(/^RO/, '');
  if (!/^\d{2,10}$/.test(curat)) return false;
  const control = Number(curat.slice(-1));
  const corp = curat.slice(0, -1).padStart(9, '0');
  let suma = 0;
  for (let i = 0; i < 9; i++) suma += Number(corp[i]) * Number(CHEIE_CUI[i]);
  let rest = (suma * 10) % 11;
  if (rest === 10) rest = 0;
  return rest === control;
}

function eroare(camp, cheie) {
  return { ok: false, camp, error: MESAJE[cheie].ro, error_en: MESAJE[cheie].en };
}

function text(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function valideazaDateFirma({ tip_entitate_legala, cui, nume_firma, tara, forma_juridica_locala } = {}) {
  const forma = text(tip_entitate_legala);
  if (!forma) return eroare('tip_entitate_legala', 'lipsa_forma');
  if (forma === 'persoana_fizica') return eroare('tip_entitate_legala', 'persoana_fizica');
  if (!esteFormaValida(forma)) return eroare('tip_entitate_legala', 'forma_invalida');

  const firma = text(nume_firma);
  const id = text(cui);
  if (!firma) return eroare('nume_firma', 'firma_cui');
  if (!id) return eroare('cui', 'firma_cui');

  const codTara = text(tara).toUpperCase() || 'RO';
  if (codTara === 'RO') {
    if (forma === 'firma_straina') return eroare('tip_entitate_legala', 'straina_in_ro');
    if (!valideazaCuiRo(id)) return eroare('cui', 'cui_invalid');
  }

  const formaLocala = text(forma_juridica_locala).slice(0, 60);
  if (forma === 'firma_straina' && !formaLocala) return eroare('forma_juridica_locala', 'lipsa_forma_locala');

  return {
    ok: true,
    date: {
      tip_entitate_legala: forma,
      nume_firma: firma,
      cui: id,
      tara: codTara,
      forma_juridica_locala: forma === 'firma_straina' ? formaLocala : null,
    },
  };
}

module.exports = { FORME_JURIDICE, CODURI, MESAJE, esteFormaValida, eticheta, valideazaCuiRo, valideazaDateFirma };
