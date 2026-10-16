// lib/furnizor-propriu.js
// Furnizorul propriu al platformei (decizie LM, 16 oct. 2026): Home Best Pal
// SRL (CUI RO46577229) vinde materiale și închirieri direct clientului, cu
// contul bricolage@homebestpal.com. E aceeași firmă cu entitatea platformei
// (cea căreia îi facturează partenerii), deci pentru produsele lui:
//   - nu se emite factură de partener (nu își facturează sieși);
//   - nu se aplică discountul de 5–15% (parteneri_discounturi);
//   - costul materialului / închirierii intră în prețul final al clientului,
//     facturat de entitatea platformei din țara comenzii.
// Un partener e furnizor propriu când partners.entitate_platforma_id e setat
// (docs/migrations-propuse/2026-10-16_furnizor_propriu.sql). Până la aplicarea
// migrării coloana lipsește: niciun partener nu e furnizor propriu și totul
// merge ca azi.

const { supabaseAdmin } = require('./supabaseAdmin');

// Textele române sunt sursa; traducerea EN e în i18n/en.json (_texte).
const EROARE_FACTURA_FURNIZOR_PROPRIU = 'Contul acesta este furnizorul propriu al platformei: vânzările lui nu se facturează către platformă.';
const EROARE_DISCOUNT_FURNIZOR_PROPRIU = 'Furnizorul propriu al platformei nu are discount: vinde direct clientului, la prețul public.';

// Coloana lipsește (migrare neaplicată) → 42703 (Postgres) sau PGRST204 / mesaj PostgREST.
function coloanaLipseste(error) {
  return !!error && (error.code === '42703' || /entitate_platforma_id/.test(error.message || ''));
}

/**
 * Partenerii furnizori proprii dintre cei dați.
 * @param {string[]} partenerIds
 * @returns {Promise<Map<string, string>>} partener_id → entitate_platforma_id
 */
async function furnizoriProprii(partenerIds) {
  const ids = [...new Set((partenerIds || []).filter(Boolean))];
  const rezultat = new Map();
  if (!ids.length) return rezultat;
  const { data, error } = await supabaseAdmin
    .from('partners')
    .select('id, entitate_platforma_id')
    .in('id', ids)
    .not('entitate_platforma_id', 'is', null);
  if (error) {
    if (!coloanaLipseste(error)) console.error('[furnizor-propriu]', error);
    return rezultat;
  }
  (data || []).forEach((p) => rezultat.set(p.id, p.entitate_platforma_id));
  return rezultat;
}

async function esteFurnizorPropriu(partenerId) {
  if (!partenerId) return false;
  return (await furnizoriProprii([partenerId])).has(partenerId);
}

module.exports = {
  furnizoriProprii,
  esteFurnizorPropriu,
  coloanaLipseste,
  EROARE_FACTURA_FURNIZOR_PROPRIU,
  EROARE_DISCOUNT_FURNIZOR_PROPRIU,
};
