// lib/contact-platforma.js
// Datele de contact ale platformei, din backoffice_config, secțiunea
// `contact` (9 oct. 2026). Sursă unică pentru:
//  - /api/public/contact (paginile publice, prin contact-public.js);
//  - emailurile trimise de server (footerul de dezabonare din lib/i18n.js).
// Cache în memorie 5 minute, pe instanța serverless.
//
// Folosire în emailuri: `await incarcaContactPlatforma()` înainte de
// randare; șabloanele citesc apoi sincron `contactPlatformaDinCache()`.

const TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // tara ('ALL' sau cod) → { ts, contact }

/**
 * @param {string|null} tara - cod de țară; valorile pe țară suprascriu ALL
 * @returns {Promise<Object<string,string>>} { contact_email, suport_email, ... }
 */
async function incarcaContactPlatforma(tara = null) {
  const cheie = tara || 'ALL';
  const c = cache.get(cheie);
  if (c && Date.now() - c.ts < TTL_MS) return c.contact;
  // Încărcat aici, nu sus: lib/i18n.js (care folosește cache-ul) rămâne
  // utilizabil și fără clientul Supabase.
  const { supabaseAdmin } = require('./supabaseAdmin');
  const { data, error } = await supabaseAdmin
    .from('backoffice_config')
    .select('cheie, valoare, tara_cod')
    .eq('sectiune', 'contact')
    .in('tara_cod', tara ? ['ALL', tara] : ['ALL']);
  if (error) throw error;
  const contact = {};
  for (const r of (data || []).sort((a, b) => (a.tara_cod === 'ALL' ? -1 : 1) - (b.tara_cod === 'ALL' ? -1 : 1))) {
    const v = r.valoare == null ? '' : String(r.valoare).trim();
    if (v) contact[r.cheie] = v;
  }
  cache.set(cheie, { ts: Date.now(), contact });
  return contact;
}

/** Varianta sincronă, pentru șabloane: ce s-a încărcat deja (sau {}). */
function contactPlatformaDinCache(tara = null) {
  const c = cache.get(tara || 'ALL');
  return (c && c.contact) || {};
}

/** Încarcă fără să arunce — pentru emailuri: o eroare înseamnă doar footer fără adresă. */
async function incarcaContactPlatformaSigur(tara = null) {
  try { return await incarcaContactPlatforma(tara); } catch (e) {
    console.warn('[contact-platforma] nu am putut citi datele de contact:', e.message);
    return contactPlatformaDinCache(tara);
  }
}

module.exports = { incarcaContactPlatforma, incarcaContactPlatformaSigur, contactPlatformaDinCache };
