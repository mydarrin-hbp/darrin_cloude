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
// GET  → { ok, kyc: null | {...}, lipsa: [...], cont: { prenume, nume, email, telefon, tara } }
// POST { pas: 1..5, date: {...} } → { ok, kyc, lipsa, roles? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { validateIBAN } = require('../../lib/iban');
const { asiguraRolInvestitor } = require('../../lib/roluri-cont');
const K = require('../../lib/investitori-kyc');

// Mesajele de eroare, RO + EN.
const E = {
  blocat: ['Dosarul tău e trimis și nu mai poate fi modificat. Te anunțăm prin email după verificare.', 'Your file has been submitted and can no longer be changed. We will email you after the review.'],
  pas: ['Pas necunoscut.', 'Unknown step.'],
  date_personale: ['Completează prenumele, numele, telefonul și țara.', 'Fill in your first name, last name, phone and country.'],
  iban: ['IBAN invalid: verifică cifrele.', 'Invalid IBAN: check the digits.'],
  iban_lipsa: ['Contul bancar (IBAN) e obligatoriu.', 'The bank account (IBAN) is required.'],
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
  };
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
    const schimbari = { date_personale: d };
    const iban = String(date.iban || '').replace(/\s+/g, '').toUpperCase();
    if (iban) {
      if (!validateIBAN(iban)) return { eroare: 'iban' };
      const { data: criptat, error } = await supabaseAdmin.rpc('cripteaza_camp', { valoare: iban });
      if (error || !criptat) throw error || new Error('cripteaza_camp nu a întors valoarea');
      schimbari.iban_criptat = criptat;
      schimbari.iban_ultimele4 = iban.slice(-4);
    } else if (!kyc || !kyc.iban_criptat) {
      return { eroare: 'iban_lipsa' };
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
    return { schimbari: { tip_document: tip, document_fata_path: fata, document_verso_path: verso } };
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

    const r = await campuriPas(nrPas, date, kyc, user.id);
    if (r.eroare) return eroare(res, 400, r.eroare);
    const pasUrmator = Math.min(K.PASI, Math.max(nrPas + 1, (kyc && kyc.pas_curent) || 1));
    // Orice modificare a unui dosar respins îl readuce la ciornă, până la retrimitere.
    const randNou = { ...r.schimbari, pas_curent: pasUrmator, status: 'ciorna', updated_at: new Date().toISOString() };

    let salvat;
    if (kyc) {
      const { data, error } = await supabaseAdmin.from('investitori_kyc').update(randNou).eq('user_id', user.id).select('*').single();
      if (error) throw error;
      salvat = data;
    } else {
      const { data, error } = await supabaseAdmin.from('investitori_kyc').insert({ user_id: user.id, submitted_at: null, ...randNou }).select('*').single();
      if (error) throw error;
      salvat = data;
    }
    return res.status(200).json({ ok: true, kyc: pentruProprietar(salvat), lipsa: K.cerinteLipsa(salvat) });
  } catch (err) {
    console.error('[investitori/kyc]', err);
    return eroare(res, 500, 'intern');
  }
}

module.exports = requireAuth([], handler);
