// lib/discount-partener.js
// Discounturile negociate de partenerii furnizori (materiale, închirieri,
// asigurări) cu Home Best Pal (decizie LM, 7 octombrie 2026). Curierii nu
// acordă discount (regula LM, 14 oct. 2026): curier = transport, 0% comision,
// curierul primește 100% din tarif.
// Tabela: parteneri_discounturi (docs/migrations-propuse/2026-10-06_parteneri_discounturi.sql).
//
// Limitele se citesc din backoffice_config, secțiunea `pricing`, rândurile
// `ALL` — aceleași pe care le verifică trigger-ul trg_parteneri_discounturi_limite.
// Validarea de aici dă un mesaj clar înainte de insert; trigger-ul rămâne
// plasa de siguranță pentru orice altă cale de scriere.
//
// Discountul nu e niciodată expus clientului sau API-urilor publice.

const { citesteConfigSectiune } = require('./calculeaza-pret');
const { trimiteEroare } = require('./raspuns-eroare');

const LIMITE_FALLBACK = { min: 5, max: 15 };

const TIPURI_PARTENER_DISCOUNT = ['materiale', 'inchirieri', 'asigurari'];

// Tipuri care nu acordă discount: tip_partener din cerere și partners.partner_type.
const TIPURI_FARA_DISCOUNT = ['curier', 'curier_utilitara'];
// Textul român e sursa; traducerea EN e și în i18n/en.json (_texte).
const EROARE_CURIER_FARA_DISCOUNT = 'Curierii nu acordă discount: curieratul este transport, cu 0% comision, iar curierul primește 100% din tarif.';
const EROARE_CURIER_FARA_DISCOUNT_EN = 'Couriers do not give discounts: courier work is transport, with 0% commission, and the courier receives 100% of the fee.';

// partners.partner_type → parteneri_discounturi.tip_partener
const PARTNER_TYPE_LA_TIP_DISCOUNT = {
  furnizor_materiale: 'materiale',
  inchirieri_utilaje: 'inchirieri',
  asigurari: 'asigurari',
};

async function limiteDiscountPartener() {
  const cfg = await citesteConfigSectiune('pricing');
  const min = Number.isFinite(cfg.discount_partener_min_pct) ? cfg.discount_partener_min_pct : LIMITE_FALLBACK.min;
  const max = Number.isFinite(cfg.discount_partener_max_pct) ? cfg.discount_partener_max_pct : LIMITE_FALLBACK.max;
  return { min, max };
}

/**
 * @returns {Promise<string|null>} mesajul de eroare sau null dacă e valid
 */
async function valideazaDiscountPct(discountPct) {
  const e = await valideazaDiscountPctBilingv(discountPct);
  return e ? e.ro : null;
}

// Aceeași validare, cu mesajul în RO + EN (pasul 11-T2).
async function valideazaDiscountPctBilingv(discountPct) {
  const pct = Number(discountPct);
  if (discountPct === null || discountPct === undefined || discountPct === '' || !Number.isFinite(pct)) {
    return { ro: 'discount_pct trebuie să fie un număr', en: 'discount_pct must be a number.' };
  }
  const { min, max } = await limiteDiscountPartener();
  if (pct < min || pct > max) return { ro: `Discountul trebuie să fie între ${min}% și ${max}%`, en: `The discount must be between ${min}% and ${max}%.` };
  return null;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validează câmpurile comune unui discount nou (partener sau admin).
 * @returns {Promise<{eroare: string, eroare_en: string, camp: string}|{rand: object}>}
 */
async function valideazaDiscountNou(body) {
  const { tip_partener, categorie, discount_pct, valabil_de, valabil_pana } = body || {};
  const eroare = (ro, en, camp) => ({ eroare: ro, eroare_en: en, camp });
  if (TIPURI_FARA_DISCOUNT.includes(tip_partener)) return eroare(EROARE_CURIER_FARA_DISCOUNT, EROARE_CURIER_FARA_DISCOUNT_EN, 'tip_partener');
  if (!TIPURI_PARTENER_DISCOUNT.includes(tip_partener)) {
    return eroare(`tip_partener acceptat: ${TIPURI_PARTENER_DISCOUNT.join(', ')}`, `Accepted tip_partener: ${TIPURI_PARTENER_DISCOUNT.join(', ')}`, 'tip_partener');
  }
  if (!categorie || typeof categorie !== 'string' || !categorie.trim()) {
    return eroare('categorie este obligatorie', 'categorie is required.', 'categorie');
  }
  const eroarePct = await valideazaDiscountPctBilingv(discount_pct);
  if (eroarePct) return eroare(eroarePct.ro, eroarePct.en, 'discount_pct');
  if (valabil_de != null && !DATA_ISO.test(valabil_de)) return eroare('valabil_de trebuie să fie o dată YYYY-MM-DD', 'valabil_de must be a YYYY-MM-DD date.', 'valabil_de');
  if (valabil_pana != null && !DATA_ISO.test(valabil_pana)) return eroare('valabil_pana trebuie să fie o dată YYYY-MM-DD', 'valabil_pana must be a YYYY-MM-DD date.', 'valabil_pana');
  if (valabil_de && valabil_pana && valabil_pana < valabil_de) return eroare('valabil_pana nu poate fi înainte de valabil_de', 'valabil_pana cannot be before valabil_de.', 'valabil_pana');

  const rand = { tip_partener, categorie: categorie.trim(), discount_pct: Number(discount_pct) };
  if (valabil_de) rand.valabil_de = valabil_de;
  if (valabil_pana) rand.valabil_pana = valabil_pana;
  return { rand };
}

/**
 * Traduce erorile Postgres de la insert/update în răspunsuri HTTP.
 */
function raspunsEroareDiscount(res, error, eticheta) {
  if (error.code === '23P01') return trimiteEroare(res, 409, 'EXISTA_DEJA', 'Există deja un discount activ pe această categorie în intervalul ales', 'There is already an active discount on this category in the chosen period.');
  if (error.code === '23503') return trimiteEroare(res, 400, 'DATE_INVALIDE', 'Categoria nu există pentru acest tip de partener', 'The category does not exist for this partner type.', ['categorie']);
  if (error.code === '23514') {
    // Plasa de siguranță din baza de date (trigger-ul limitelor): detaliul doar în log.
    console.error(`[${eticheta}] limite discount`, error.message);
    return trimiteEroare(res, 400, 'DISCOUNT_IN_AFARA_LIMITELOR', 'Discountul nu respectă limitele permise (procentul minim și maxim).', 'The discount is outside the allowed limits (minimum and maximum percentage).', ['discount_pct']);
  }
  console.error(`[${eticheta}]`, error);
  return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut salva discountul', 'We could not save the discount.');
}

module.exports = {
  TIPURI_PARTENER_DISCOUNT,
  TIPURI_FARA_DISCOUNT,
  EROARE_CURIER_FARA_DISCOUNT,
  EROARE_CURIER_FARA_DISCOUNT_EN,
  PARTNER_TYPE_LA_TIP_DISCOUNT,
  limiteDiscountPartener,
  valideazaDiscountPct,
  valideazaDiscountPctBilingv,
  valideazaDiscountNou,
  raspunsEroareDiscount,
};
