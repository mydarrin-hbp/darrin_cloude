// lib/discount-partener.js
// Discounturile negociate de partenerii furnizori (materiale, închirieri,
// asigurări, curierat) cu Home Best Pal (decizie LM, 7 octombrie 2026).
// Tabela: parteneri_discounturi (docs/migrations-propuse/2026-10-06_parteneri_discounturi.sql).
//
// Limitele se citesc din backoffice_config, secțiunea `pricing`, rândurile
// `ALL` — aceleași pe care le verifică trigger-ul trg_parteneri_discounturi_limite.
// Validarea de aici dă un mesaj clar înainte de insert; trigger-ul rămâne
// plasa de siguranță pentru orice altă cale de scriere.
//
// Discountul nu e niciodată expus clientului sau API-urilor publice.

const { citesteConfigSectiune } = require('./calculeaza-pret');

const LIMITE_FALLBACK = { min: 5, max: 15 };

const TIPURI_PARTENER_DISCOUNT = ['materiale', 'inchirieri', 'asigurari', 'curier'];

// partners.partner_type → parteneri_discounturi.tip_partener
const PARTNER_TYPE_LA_TIP_DISCOUNT = {
  furnizor_materiale: 'materiale',
  inchirieri_utilaje: 'inchirieri',
  asigurari: 'asigurari',
  curier_utilitara: 'curier',
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
  const pct = Number(discountPct);
  if (discountPct === null || discountPct === undefined || discountPct === '' || !Number.isFinite(pct)) {
    return 'discount_pct trebuie să fie un număr';
  }
  const { min, max } = await limiteDiscountPartener();
  if (pct < min || pct > max) return `Discountul trebuie să fie între ${min}% și ${max}%`;
  return null;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validează câmpurile comune unui discount nou (partener sau admin).
 * @returns {Promise<{eroare: string}|{rand: object}>}
 */
async function valideazaDiscountNou(body) {
  const { tip_partener, categorie, discount_pct, valabil_de, valabil_pana } = body || {};
  if (!TIPURI_PARTENER_DISCOUNT.includes(tip_partener)) {
    return { eroare: `tip_partener acceptat: ${TIPURI_PARTENER_DISCOUNT.join(', ')}` };
  }
  if (!categorie || typeof categorie !== 'string' || !categorie.trim()) {
    return { eroare: 'categorie este obligatorie' };
  }
  const eroarePct = await valideazaDiscountPct(discount_pct);
  if (eroarePct) return { eroare: eroarePct };
  if (valabil_de != null && !DATA_ISO.test(valabil_de)) return { eroare: 'valabil_de trebuie să fie o dată YYYY-MM-DD' };
  if (valabil_pana != null && !DATA_ISO.test(valabil_pana)) return { eroare: 'valabil_pana trebuie să fie o dată YYYY-MM-DD' };
  if (valabil_de && valabil_pana && valabil_pana < valabil_de) return { eroare: 'valabil_pana nu poate fi înainte de valabil_de' };

  const rand = { tip_partener, categorie: categorie.trim(), discount_pct: Number(discount_pct) };
  if (valabil_de) rand.valabil_de = valabil_de;
  if (valabil_pana) rand.valabil_pana = valabil_pana;
  return { rand };
}

/**
 * Traduce erorile Postgres de la insert/update în răspunsuri HTTP.
 */
function raspunsEroareDiscount(res, error, eticheta) {
  if (error.code === '23P01') return res.status(409).json({ error: 'Există deja un discount activ pe această categorie în intervalul ales' });
  if (error.code === '23503') return res.status(400).json({ error: 'Categoria nu există pentru acest tip de partener' });
  if (error.code === '23514') return res.status(400).json({ error: error.message });
  console.error(`[${eticheta}]`, error);
  return res.status(500).json({ error: 'Nu am putut salva discountul' });
}

module.exports = {
  TIPURI_PARTENER_DISCOUNT,
  PARTNER_TYPE_LA_TIP_DISCOUNT,
  limiteDiscountPartener,
  valideazaDiscountPct,
  valideazaDiscountNou,
  raspunsEroareDiscount,
};
