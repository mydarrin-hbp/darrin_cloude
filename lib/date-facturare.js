// lib/date-facturare.js
// Pasul 11-P2b (25 oct. 2026): datele de facturare cerute la checkout.
// Clientul alege cum vrea factura:
//   - persoană fizică (tip 'pf' → comenzi.tip_client = 'b2c'): prenume, nume,
//     adresa de facturare (implicit copia adresei lucrării) și, opțional, CNP-ul;
//   - factură pe firmă (tip 'pj' → 'b2b'): CUI (validat pentru RO), denumire,
//     Nr. Reg. Com. și sediul. Verificarea la ANAF o face api/comenzi/creeaza.js
//     (lib/cauta-firma.js → verificaFirmaRoLaAnaf).
// Pentru alte țări decât RO: la firmă, numărul de înregistrare / TVA e text
// liber (4–30 caractere, ca NIF-ul din lib/identitate-pf.js); la persoana
// fizică nu se cere CNP.
//
// CNP-ul nu intră niciodată în date_facturare: aici se întoarce separat
// (`cnp`), ca apelantul să-l cripteze (rpc cripteaza_camp) în
// comenzi.client_cnp_criptat; pe comandă rămân doar cnp_furnizat și
// cnp_ultimele3. Coloanele: docs/migrations-propuse/2026-10-25_checkout_date_facturare.sql.
//
//   valideazaDateFacturare(corp, { taraComanda, adresaLucrare })
//     -> { ok:true, tip_client, date_facturare, cnp } | { ok:false, camp, error, error_en }

const { valideazaCnp, valideazaNif, normalizeaza } = require('./identitate-pf');
const { valideazaCuiRo } = require('./forme-juridice');

const MESAJE = {
  lipsa: {
    ro: 'Alege cum vrei factura: pe persoană fizică sau pe firmă.',
    en: 'Choose how you want the invoice: as a private individual or on a company.',
  },
  prenume: {
    ro: 'Completează prenumele pentru factură.',
    en: 'Fill in the first name for the invoice.',
  },
  nume: {
    ro: 'Completează numele pentru factură.',
    en: 'Fill in the last name for the invoice.',
  },
  cnp_invalid: {
    ro: 'CNP-ul nu este valid: verifică cele 13 cifre sau lasă câmpul gol.',
    en: 'The personal numeric code (CNP) is not valid: check the 13 digits or leave the field empty.',
  },
  cui_lipsa: {
    ro: 'Completează CUI-ul firmei.',
    en: "Fill in the company's tax ID (CUI).",
  },
  cui_invalid: {
    ro: 'CUI-ul nu este valid: cifra de control nu se potrivește. Verifică-l în certificatul de înregistrare.',
    en: 'The tax ID (CUI) is not valid: the check digit does not match. Check it on the registration certificate.',
  },
  id_strain: {
    ro: 'Completează numărul de înregistrare sau de TVA al firmei (4–30 caractere: litere, cifre, spațiu, „-” sau „/”).',
    en: "Fill in the company's registration or VAT number (4–30 characters: letters, digits, space, '-' or '/').",
  },
  denumire: {
    ro: 'Completează denumirea firmei.',
    en: 'Fill in the company name.',
  },
  strada: {
    ro: 'Completează adresa de facturare: strada și numărul.',
    en: 'Fill in the billing address: street and number.',
  },
  localitate: {
    ro: 'Completează localitatea din adresa de facturare.',
    en: 'Fill in the town or city of the billing address.',
  },
  judet: {
    ro: 'Completează județul din adresa de facturare.',
    en: 'Fill in the county of the billing address.',
  },
  tara: {
    ro: 'Alege țara din adresa de facturare.',
    en: 'Choose the country of the billing address.',
  },
};

function eroare(camp, cheie) {
  return { ok: false, camp, error: MESAJE[cheie].ro, error_en: MESAJE[cheie].en };
}

function text(v, max = 200) {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function codTara(v) {
  const t = text(v, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? t : '';
}

// Adresa de facturare cerută: strada, localitatea și țara; județul doar pentru RO.
function valideazaAdresa(a, taraImplicita) {
  const sursa = a && typeof a === 'object' ? a : {};
  const adresa = {
    strada: text(sursa.strada),
    localitate: text(sursa.localitate, 100),
    judet: text(sursa.judet, 100) || null,
    cod_postal: text(sursa.cod_postal, 12) || null,
    tara: codTara(sursa.tara) || taraImplicita,
  };
  if (adresa.strada.length < 3) return eroare('adresa.strada', 'strada');
  if (adresa.localitate.length < 2) return eroare('adresa.localitate', 'localitate');
  if (!adresa.tara) return eroare('adresa.tara', 'tara');
  if (adresa.tara === 'RO' && !adresa.judet) return eroare('adresa.judet', 'judet');
  return { ok: true, adresa };
}

// Copia adresei lucrării, cu aceleași chei ca adresa de facturare.
function copieAdresaLucrare(a, taraImplicita) {
  const sursa = a && typeof a === 'object' ? a : {};
  return {
    strada: text(sursa.strada),
    localitate: text(sursa.localitate, 100) || null,
    judet: text(sursa.judet, 100) || null,
    cod_postal: text(sursa.cod_postal, 12) || null,
    tara: codTara(sursa.tara) || taraImplicita,
  };
}

function valideazaDateFacturare(corp, { taraComanda, adresaLucrare } = {}) {
  if (!corp || typeof corp !== 'object' || (corp.tip !== 'pf' && corp.tip !== 'pj')) {
    return eroare('date_facturare', 'lipsa');
  }
  const taraImplicita = codTara(taraComanda) || 'RO';

  if (corp.tip === 'pf') {
    const prenume = text(corp.prenume, 100);
    const nume = text(corp.nume, 100);
    if (prenume.length < 2) return eroare('prenume', 'prenume');
    if (nume.length < 2) return eroare('nume', 'nume');

    let adresa;
    if (corp.adresa_alta === true) {
      const r = valideazaAdresa(corp.adresa, taraImplicita);
      if (!r.ok) return r;
      adresa = r.adresa;
    } else {
      adresa = copieAdresaLucrare(adresaLucrare, taraImplicita);
    }

    // CNP: opțional și doar pentru o adresă de facturare din România; fără
    // regula de 18 ani (aceea e doar pentru investitori).
    let cnp = null;
    const cnpBrut = normalizeaza(corp.cnp);
    if (cnpBrut && adresa.tara === 'RO') {
      if (!valideazaCnp(cnpBrut).ok) return eroare('cnp', 'cnp_invalid');
      cnp = cnpBrut;
    }

    return {
      ok: true,
      tip_client: 'b2c',
      date_facturare: {
        tip: 'pf', prenume, nume, adresa,
        cnp_furnizat: !!cnp,
        cnp_ultimele3: cnp ? cnp.slice(-3) : null,
      },
      cnp,
    };
  }

  // Firmă: țara sediului decide cum se validează identificatorul.
  const r = valideazaAdresa(corp.adresa, taraImplicita);
  const taraFirma = r.ok ? r.adresa.tara : (codTara(corp.adresa && corp.adresa.tara) || taraImplicita);
  const id = text(corp.cui, 40);
  if (taraFirma === 'RO') {
    if (!id) return eroare('cui', 'cui_lipsa');
    if (!valideazaCuiRo(id)) return eroare('cui', 'cui_invalid');
  } else if (!valideazaNif(id)) {
    return eroare('cui', 'id_strain');
  }
  const denumire = text(corp.denumire);
  if (denumire.length < 2) return eroare('denumire', 'denumire');
  if (!r.ok) return r;

  return {
    ok: true,
    tip_client: 'b2b',
    date_facturare: {
      tip: 'pj',
      denumire,
      cui: taraFirma === 'RO' ? id.replace(/\s+/g, '').toUpperCase() : id,
      nr_reg_com: text(corp.nr_reg_com, 40) || null,
      adresa: r.adresa,
      // Completate de apelant după verificarea la ANAF.
      tva_activ: null,
      sursa: 'manual',
    },
    cnp: null,
  };
}

// valideazaAdresa: folosită și de agenda contului (lib/agenda-cont.js, pasul 11-P3a).
module.exports = { MESAJE, valideazaDateFacturare, valideazaAdresa };
