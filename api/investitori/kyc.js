// /api/investitori/kyc.js
// Ruta de investitor, legată de cont (pasul 11-L, 17 oct. 2026). Înlocuiește
// endpoint-ul vechi (profil_risc + URL de document), care nu avea niciun apelant.
//
// Progresul se păstrează pe server, pe cont (investitori_kyc, un rând pe
// utilizator): cine revine continuă de unde a rămas. Pașii:
//   1. date personale și cont bancar (IBAN validat MOD-97, salvat criptat,
//      ca la parteneri: rpc cripteaza_camp);
//   2. verificarea identității: tipul documentului și fișierele, încărcate
//      privat prin api/investitori/kyc-document.js;
//   3. chestionarul de profil de risc (MiFID II) și declarațiile PEP / sancțiuni;
//   4. rezidența fiscală (țara);
//   5. confirmarea: dacă dosarul e complet, status → in_verificare și rolul
//      `investor` se adaugă în profiles.roles (lib/roluri-cont.js). Rolul se
//      adaugă doar aici, pe server, după validarea cerințelor.
// Verificarea identității e manuală (api/admin/investitori-kyc.js); un dosar
// respins se poate corecta și retrimite. Un dosar în verificare sau aprobat nu
// se mai modifică de aici.
//
// Pasul 11-P2a (25 oct. 2026): datele de identificare cerute de verificarea
// AML (Legea 129/2019), validate cu lib/identitate-pf.js:
//   pasul 1 — data nașterii (cel puțin 18 ani), cetățenia, adresa de domiciliu
//     și CNP-ul (cetățeni români) sau NIF-ul (străini; CNP-ul de rezident
//     străin, cifra 7/8, e acceptat ca CNP). CNP-ul trebuie să aibă aceeași
//     dată a nașterii ca cea declarată. Se salvează criptat (rpc
//     cripteaza_camp), cu ultimele 3 caractere și amprenta HMAC (cnp_hash):
//     același CNP / NIF pe alt cont → 409 ID_FISCAL_FOLOSIT, fără să spunem
//     care cont. Fără KYC_HMAC_SECRET, pasul 1 nu se salvează (500).
//   pasul 2 — seria și numărul actului (criptate, cu ultimele 3 caractere) și
//     data până la care e valabil (un act expirat e refuzat).
// Un câmp CNP / NIF sau serie gol la retrimitere păstrează valoarea salvată
// (ca la IBAN). Proprietarul vede doar valorile mascate.
//
// GET  → { ok, kyc: null | {...}, lipsa: [...], cont: { prenume, nume, email, telefon, tara } }
// POST { pas: 1..5, date: {...} } → { ok, kyc, lipsa, roles? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { validateIBAN } = require('../../lib/iban');
const { asiguraRolInvestitor } = require('../../lib/roluri-cont');
const K = require('../../lib/investitori-kyc');
const I = require('../../lib/identitate-pf');

// Mesajele de eroare, RO + EN.
const E = {
  blocat: ['Dosarul tău e trimis și nu mai poate fi modificat. Te anunțăm prin email după verificare.', 'Your file has been submitted and can no longer be changed. We will email you after the review.'],
  pas: ['Pas necunoscut.', 'Unknown step.'],
  date_personale: ['Completează prenumele, numele, telefonul și țara.', 'Fill in your first name, last name, phone and country.'],
  iban: ['IBAN invalid: verifică cifrele.', 'Invalid IBAN: check the digits.'],
  iban_lipsa: ['Contul bancar (IBAN) e obligatoriu.', 'The bank account (IBAN) is required.'],
  data_nasterii: ['Completează data nașterii.', 'Fill in your date of birth.'],
  minor: ['Trebuie să ai cel puțin 18 ani ca să devii investitor.', 'You must be at least 18 years old to become an investor.'],
  cetatenie: ['Alege cetățenia.', 'Choose your citizenship.'],
  adresa_strada: ['Completează strada și numărul adresei de domiciliu.', 'Fill in the street and number of your home address.'],
  adresa_localitate: ['Completează localitatea adresei de domiciliu.', 'Fill in the town or city of your home address.'],
  adresa_judet: ['Completează județul: e obligatoriu pentru o adresă din România.', 'Fill in the county: it is required for an address in Romania.'],
  adresa_tara: ['Alege țara adresei de domiciliu.', 'Choose the country of your home address.'],
  id_fiscal_lipsa: ['Completează CNP-ul (cetățeni români) sau numărul de identificare fiscală (NIF).', 'Fill in your personal numeric code (CNP, Romanian citizens) or your tax identification number (TIN).'],
  cnp_invalid: ['CNP invalid: verifică cele 13 cifre.', 'Invalid personal numeric code (CNP): check the 13 digits.'],
  cnp_data: ['Data nașterii din CNP nu se potrivește cu data nașterii completată.', 'The date of birth in the CNP does not match the date of birth you entered.'],
  nif_invalid: ['Număr de identificare fiscală invalid: 4–30 caractere (litere, cifre, spațiu, „-” sau „/”).', 'Invalid tax identification number: 4–30 characters (letters, digits, space, "-" or "/").'],
  ID_FISCAL_FOLOSIT: ['Acest CNP / număr fiscal e deja folosit de alt cont. Scrie-ne la investor@homebestpal.com.', 'This personal / tax ID number is already used by another account. Write to us at investor@homebestpal.com.'],
  act_serie_numar: ['Completează seria și numărul actului de identitate (3–20 caractere: litere, cifre, spațiu sau „-”).', 'Fill in the series and number of your identity document (3–20 characters: letters, digits, space or "-").'],
  act_valabil_pana: ['Completează data până la care e valabil actul de identitate.', 'Fill in the date until which your identity document is valid.'],
  act_expirat: ['Actul de identitate e expirat. Folosește un act valabil.', 'Your identity document has expired. Use a valid document.'],
  tip_document: ['Alege tipul documentului: carte de identitate, pașaport sau permis de ședere.', 'Choose the document type: ID card, passport or residence permit.'],
  fisier_strain: ['Fișierul nu aparține contului tău.', 'The file does not belong to your account.'],
  document_fata: ['Încarcă fața documentului (sau pagina cu fotografia, la pașaport).', 'Upload the front of the document (or the photo page, for a passport).'],
  document_verso: ['Încarcă și verso-ul documentului.', 'Also upload the back of the document.'],
  mifid: ['Răspunde la toate cele trei întrebări ale chestionarului.', 'Answer all three questions of the questionnaire.'],
  pep: ['Spune dacă ești sau nu o persoană expusă politic (PEP).', 'Say whether or not you are a politically exposed person (PEP).'],
  sanctiuni: ['Bifează declarația privind sancțiunile.', 'Tick the sanctions declaration.'],
  rezidenta_fiscala: ['Alege țara rezidenței fiscale.', 'Choose your country of tax residence.'],
  incomplet: ['Dosarul nu e complet. Completează pașii marcați.', 'Your file is not complete. Complete the marked steps.'],
  confirma: ['Bifează confirmarea datelor.', 'Tick the confirmation of your details.'],
  intern: ['Nu am putut salva. Încearcă din nou.', 'We could not save. Please try again.'],
};
function eroare(res, cod, cheie, extra = {}) {
  return res.status(cod).json({ error: E[cheie][0], error_en: E[cheie][1], cod: cheie, ...extra });
}
// Câmpul vizat de fiecare eroare a datelor de identificare (pagina îl marchează).
const CAMP = {
  data_nasterii: 'data_nasterii', minor: 'data_nasterii', cetatenie: 'cetatenie',
  adresa_strada: 'adresa_strada', adresa_localitate: 'adresa_localitate', adresa_judet: 'adresa_judet', adresa_tara: 'adresa_tara',
  id_fiscal_lipsa: 'id_fiscal', cnp_invalid: 'id_fiscal', cnp_data: 'id_fiscal', nif_invalid: 'id_fiscal', ID_FISCAL_FOLOSIT: 'id_fiscal',
  act_serie_numar: 'act_serie_numar', act_valabil_pana: 'act_valabil_pana', act_expirat: 'act_valabil_pana',
};

// Ce vede proprietarul: datele lui, fără IBAN în clar. Căile fișierelor (din
// dosarul lui) îi trebuie ca să le vadă, să le șteargă sau să le înlocuiască.
function pentruProprietar(kyc) {
  if (!kyc) return null;
  return {
    ...K.starePublica(kyc),
    date_personale: kyc.date_personale || null,
    iban_mascat: kyc.iban_ultimele4 ? '•••• ' + kyc.iban_ultimele4 : null,
    tip_document: kyc.tip_document || null,
    document_fata: !!kyc.document_fata_path,
    document_verso: !!kyc.document_verso_path,
    document_fata_path: kyc.document_fata_path || null,
    document_verso_path: kyc.document_verso_path || null,
    mifid_raspunsuri: kyc.mifid_raspunsuri || null,
    pep_declaratie: kyc.pep_declaratie || null,
    sanctiuni_declarat: kyc.sanctiuni_declarat === true,
    rezidenta_fiscala_tara: kyc.rezidenta_fiscala_tara || null,
    // 11-P2a: niciodată CNP-ul / NIF-ul sau numărul actului în clar
    data_nasterii: kyc.data_nasterii || null,
    cetatenie: kyc.cetatenie || null,
    adresa_domiciliu: kyc.adresa_domiciliu || null,
    id_fiscal_tip: kyc.id_fiscal_tip || null,
    id_fiscal_mascat: I.mascheaza(kyc.id_fiscal_ultimele3),
    act_serie_numar_mascat: I.mascheaza(kyc.act_ultimele3),
    act_valabil_pana: kyc.act_valabil_pana || null,
  };
}

async function cripteaza(valoare) {
  const { data: criptat, error } = await supabaseAdmin.rpc('cripteaza_camp', { valoare });
  if (error || !criptat) throw error || new Error('cripteaza_camp nu a întors valoarea');
  return criptat;
}

// Pasul 1, datele de identificare. Întoarce { schimbari } sau { eroare, cod? }.
async function campuriIdentitate(date, kyc, userId) {
  const dataNasterii = K.text(date.data_nasterii, 10);
  if (!I.dataValida(dataNasterii) || dataNasterii > I.aziIso()) return { eroare: 'data_nasterii' };
  if (I.varsta(dataNasterii, new Date()) < I.VARSTA_MINIMA) return { eroare: 'minor' };
  const cetatenie = K.codTara(date.cetatenie);
  if (!cetatenie) return { eroare: 'cetatenie' };

  const a = date.adresa_domiciliu || {};
  const adresa = {
    strada: K.text(a.strada, 200), localitate: K.text(a.localitate, 100), judet: K.text(a.judet, 60),
    cod_postal: K.text(a.cod_postal, 12), tara: K.codTara(a.tara),
  };
  if (!adresa.strada) return { eroare: 'adresa_strada' };
  if (!adresa.localitate) return { eroare: 'adresa_localitate' };
  if (!adresa.tara) return { eroare: 'adresa_tara' };
  if (adresa.tara === 'RO' && !adresa.judet) return { eroare: 'adresa_judet' };

  const schimbari = { data_nasterii: dataNasterii, cetatenie, adresa_domiciliu: adresa };
  const valoare = I.normalizeaza(date.id_fiscal);
  if (!valoare) {
    // Gol = păstrăm valoarea salvată, doar dacă se potrivește în continuare
    // cu cetățenia și (la CNP) cu data nașterii; altfel trebuie reintrodusă.
    const pastrat = kyc && kyc.id_fiscal_criptat && kyc.cnp_hash && kyc.cetatenie === cetatenie
      && (kyc.id_fiscal_tip !== 'cnp' || String(kyc.data_nasterii || '').slice(0, 10) === dataNasterii);
    return pastrat ? { schimbari } : { eroare: 'id_fiscal_lipsa' };
  }

  // Cetățenii români: CNP. Străinii: NIF, sau CNP de rezident străin (7/8).
  let tip = null;
  if (cetatenie === 'RO' || /^[78]\d{12}$/.test(valoare)) {
    const cnp = I.valideazaCnp(valoare, dataNasterii);
    if (cetatenie === 'RO' && !cnp.ok) return { eroare: 'cnp_invalid' };
    if (cnp.ok) {
      if (cnp.data_nasterii !== dataNasterii) return { eroare: 'cnp_data' };
      tip = 'cnp';
    }
  }
  if (!tip) {
    if (!I.valideazaNif(date.id_fiscal)) return { eroare: 'nif_invalid' };
    tip = 'nif';
  }

  const cnpHash = I.hashIdFiscal(tip, valoare);
  const { data: altul, error } = await supabaseAdmin.from('investitori_kyc')
    .select('user_id').eq('cnp_hash', cnpHash).neq('user_id', userId).limit(1);
  if (error) throw error;
  if (altul && altul.length) return { eroare: 'ID_FISCAL_FOLOSIT', cod: 409 };

  Object.assign(schimbari, {
    id_fiscal_tip: tip,
    id_fiscal_criptat: await cripteaza(valoare),
    id_fiscal_ultimele3: valoare.slice(-3),
    cnp_hash: cnpHash,
  });
  return { schimbari };
}

// Pasul 2, actul de identitate: seria și numărul, valabilitatea.
async function campuriAct(date, kyc) {
  const valabil = K.text(date.act_valabil_pana, 10);
  if (!I.dataValida(valabil)) return { eroare: 'act_valabil_pana' };
  if (valabil < I.aziIso()) return { eroare: 'act_expirat' };
  const schimbari = { act_valabil_pana: valabil };
  const serie = String(date.act_serie_numar == null ? '' : date.act_serie_numar).trim().replace(/\s+/g, ' ').toUpperCase();
  if (!serie) {
    if (!kyc || !kyc.act_serie_numar_criptat) return { eroare: 'act_serie_numar' };
    return { schimbari };
  }
  if (serie.length < 3 || serie.length > 20 || !/^[A-Z0-9 -]+$/.test(serie)) return { eroare: 'act_serie_numar' };
  schimbari.act_serie_numar_criptat = await cripteaza(serie);
  schimbari.act_ultimele3 = serie.replace(/[ -]/g, '').slice(-3);
  return { schimbari };
}

async function datePrecompletare(user) {
  const { data: profil } = await supabaseAdmin.from('profiles').select('*').eq('id', user.id).maybeSingle();
  const m = user.user_metadata || {};
  return {
    prenume: String(m.prenume || '').trim() || null,
    nume: String(m.nume || '').trim() || null,
    email: user.email || null,
    telefon: (profil && (profil.phone || profil.telefon)) || null,
    tara: (profil && profil.tara) || null,
  };
}

// Câmpurile scrise de fiecare pas, după validare. Întoarce { schimbari } sau { eroare }.
async function campuriPas(pas, date, kyc, userId) {
  if (pas === 1) {
    const d = {
      prenume: K.text(date.prenume, 80), nume: K.text(date.nume, 80),
      telefon: K.text(date.telefon, 30), tara: K.codTara(date.tara),
    };
    if (!d.prenume || !d.nume || !d.telefon || !d.tara) return { eroare: 'date_personale' };
    const iban = String(date.iban || '').replace(/\s+/g, '').toUpperCase();
    if (iban && !validateIBAN(iban)) return { eroare: 'iban' };
    if (!iban && (!kyc || !kyc.iban_criptat)) return { eroare: 'iban_lipsa' };
    const id = await campuriIdentitate(date, kyc, userId);
    if (id.eroare) return id;
    const schimbari = { date_personale: d, ...id.schimbari };
    if (iban) {
      schimbari.iban_criptat = await cripteaza(iban);
      schimbari.iban_ultimele4 = iban.slice(-4);
    }
    return { schimbari };
  }
  if (pas === 2) {
    const tip = date.tip_document;
    if (!K.TIPURI_DOCUMENT.includes(tip)) return { eroare: 'tip_document' };
    const fata = date.document_fata_path || (kyc && kyc.document_fata_path) || null;
    const verso = K.ARE_VERSO[tip] ? (date.document_verso_path || (kyc && kyc.document_verso_path) || null) : null;
    for (const cale of [fata, verso]) if (cale && !K.caleaApartine(cale, userId)) return { eroare: 'fisier_strain' };
    if (!fata) return { eroare: 'document_fata' };
    if (K.ARE_VERSO[tip] && !verso) return { eroare: 'document_verso' };
    const act = await campuriAct(date, kyc);
    if (act.eroare) return act;
    return { schimbari: { tip_document: tip, document_fata_path: fata, document_verso_path: verso, ...act.schimbari } };
  }
  if (pas === 3) {
    const m = date.mifid || {};
    const mifid = {};
    for (const q of K.MIFID_INTREBARI) {
      const v = Number(m[q]);
      if (!Number.isInteger(v) || v < 0 || v >= K.MIFID_VARIANTE) return { eroare: 'mifid' };
      mifid[q] = v;
    }
    if (typeof date.este_pep !== 'boolean') return { eroare: 'pep' };
    if (date.sanctiuni_declarat !== true) return { eroare: 'sanctiuni' };
    return { schimbari: {
      mifid_raspunsuri: mifid,
      pep_declaratie: { este_pep: date.este_pep, functie: date.este_pep ? K.text(date.pep_functie, 200) || null : null },
      pep_check: date.este_pep,
      sanctiuni_declarat: true,
    } };
  }
  if (pas === 4) {
    const tara = K.codTara(date.rezidenta_fiscala_tara);
    if (!tara) return { eroare: 'rezidenta_fiscala' };
    return { schimbari: { rezidenta_fiscala_tara: tara } };
  }
  return { eroare: 'pas' };
}

async function handler(req, res, user) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method === 'GET') {
      const kyc = await K.citesteKyc(user.id);
      return res.status(200).json({ ok: true, kyc: pentruProprietar(kyc), lipsa: K.cerinteLipsa(kyc), cont: await datePrecompletare(user) });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { pas, date = {} } = req.body || {};
    const nrPas = Number(pas);
    if (!Number.isInteger(nrPas) || nrPas < 1 || nrPas > K.PASI) return eroare(res, 400, 'pas');

    const kyc = await K.citesteKyc(user.id);
    if (kyc && kyc.status && !K.STARI_EDITABILE.includes(kyc.status)) return eroare(res, 409, 'blocat');

    // Pasul 5: trimiterea dosarului complet.
    if (nrPas === K.PASI) {
      if (date.confirma !== true) return eroare(res, 400, 'confirma');
      const lipsa = K.cerinteLipsa(kyc);
      if (lipsa.length) return eroare(res, 400, 'incomplet', { lipsa });
      const { data: trimis, error } = await supabaseAdmin.from('investitori_kyc').update({
        status: 'in_verificare', submitted_at: new Date().toISOString(), pas_curent: K.PASI,
        motiv_respingere_ro: null, motiv_respingere_en: null, reviewed_at: null, reviewed_by: null,
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id).select('*').single();
      if (error) throw error;
      const { roles } = await asiguraRolInvestitor(user.id);
      return res.status(200).json({ ok: true, kyc: pentruProprietar(trimis), lipsa: [], roles });
    }

    // Fără secretul amprentei CNP / NIF, pasul 1 nu se salvează (fără cheie de rezervă).
    if (nrPas === 1 && !I.secretDisponibil()) {
      console.error('[investitori/kyc] KYC_HMAC_SECRET lipsește');
      return eroare(res, 500, 'intern');
    }
    const r = await campuriPas(nrPas, date, kyc, user.id);
    if (r.eroare) return eroare(res, r.cod || 400, r.eroare, CAMP[r.eroare] ? { camp: CAMP[r.eroare] } : {});
    const pasUrmator = Math.min(K.PASI, Math.max(nrPas + 1, (kyc && kyc.pas_curent) || 1));
    // Orice modificare a unui dosar respins îl readuce la ciornă, până la retrimitere.
    const randNou = { ...r.schimbari, pas_curent: pasUrmator, status: 'ciorna', updated_at: new Date().toISOString() };

    const scriere = kyc
      ? supabaseAdmin.from('investitori_kyc').update(randNou).eq('user_id', user.id).select('*').single()
      : supabaseAdmin.from('investitori_kyc').insert({ user_id: user.id, submitted_at: null, ...randNou }).select('*').single();
    const { data: salvat, error: errSalvare } = await scriere;
    if (errSalvare) {
      // indexul unic pe cnp_hash: alt cont a salvat același CNP / NIF între timp
      if (errSalvare.code === '23505' && String(errSalvare.message || '').includes('cnp_hash')) return eroare(res, 409, 'ID_FISCAL_FOLOSIT', { camp: 'id_fiscal' });
      throw errSalvare;
    }
    return res.status(200).json({ ok: true, kyc: pentruProprietar(salvat), lipsa: K.cerinteLipsa(salvat) });
  } catch (err) {
    console.error('[investitori/kyc]', err);
    return eroare(res, 500, 'intern');
  }
}

module.exports = requireAuth([], handler);
