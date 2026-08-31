// /lib/rezolva-addon-materiale.js
// Faza 2/3 CAT (29 august 2026, cerere fondator — corecție "te-ai abătut de
// la conceptul paginii de configurare a serviciului"): materiale/accesorii
// OPȚIONALE (ex. plintă PVC, profil de trecere), selectate de client din
// selectorul de addon-uri (catalog_servicii, filtrat NACE — CAT-2a), pe
// calea nivel_id (5 servicii pilot). Integritate, exact ca restul acestei
// căi: clientul trimite DOAR {id, qty} — niciun preț trimis de client nu e
// folosit vreodată; se rezolvă exclusiv din catalog_niveluri/catalog_preturi
// ale nivelului cu ACELAȘI nume de tier ca nivel_id-ul comenzii/previzualizării
// (Bronze/Silver/Gold...), pentru țara cerută.
//
// Extras într-un singur loc (nu duplicat) pentru că e folosit atât de
// api/public/calculeaza-pret-nivel.js (previzualizare live, fără autentificare)
// cât și de api/comenzi/creeaza.js (creare reală de comandă) — trebuie să
// calculeze IDENTIC în ambele locuri, altfel prețul afișat înainte de comandă
// n-ar mai coincide cu cel efectiv încasat.
//
// Aruncă o eroare cu { code, message } dacă un item cerut nu are preț real
// disponibil — apelantul decide formatul răspunsului (400 cu cod clar,
// niciodată un cost calculat parțial/tăcut).

const { supabaseAdmin } = require('./supabaseAdmin');

class AddonFaraPretError extends Error {
  constructor(message) {
    super(message);
    this.code = 'ADDON_FARA_PRET';
  }
}

class AddonInvalidError extends Error {
  constructor(message) {
    super(message);
    this.code = 'ADDON_INVALID';
  }
}

/**
 * @param {Array<{id:string, qty:number}>} addonMateriale
 * @param {string} tierComanda - numele nivelului (ex. 'Bronze') al comenzii/previzualizării curente
 * @param {string} taraCod
 * @returns {Promise<{cost_materiale:number, cost_utilaj:number, itemi: Array}>}
 */
async function rezolvaAddonMateriale(addonMateriale, tierComanda, taraCod) {
  let cost_materiale = 0;
  let cost_utilaj = 0;
  const itemi = [];

  if (!Array.isArray(addonMateriale) || !addonMateriale.length) {
    return { cost_materiale, cost_utilaj, itemi };
  }

  for (const cerere of addonMateriale) {
    const addonId = cerere && cerere.id;
    const qty = Number(cerere && cerere.qty);
    if (typeof addonId !== 'string' || !addonId || !Number.isFinite(qty) || qty <= 0) {
      throw new AddonInvalidError('addon_materiale trebuie să conțină {id, qty} valide.');
    }
    const { data: addonServ } = await supabaseAdmin
      .from('catalog_servicii')
      .select('id, titlu, descriere, categorie, unitate_masura, status_public, catalog_niveluri(id, nivel, catalog_preturi(pret, tara_cod))')
      .eq('id', addonId)
      .in('categorie', ['materiale', 'inchirieri'])
      .eq('status_public', true)
      .maybeSingle();
    const nivelPotrivit = (addonServ?.catalog_niveluri || []).find((n) => n.nivel === tierComanda);
    const pretRand = nivelPotrivit?.catalog_preturi?.find((p) => p.tara_cod === taraCod);
    if (!addonServ || !nivelPotrivit || !pretRand) {
      throw new AddonFaraPretError(`Materialul/echipamentul opțional selectat (${addonId}) nu are preț real configurat pentru acest nivel/țară.`);
    }
    const pretUnitar = Number(pretRand.pret);
    const subtotal = pretUnitar * qty;
    if (addonServ.categorie === 'materiale') cost_materiale += subtotal;
    else cost_utilaj += subtotal;
    itemi.push({
      catalog_serviciu_id: addonId, titlu: addonServ.titlu, descriere: addonServ.descriere || null, categorie: addonServ.categorie,
      unitate_masura: addonServ.unitate_masura, qty, pret_unitar: pretUnitar, subtotal,
    });
  }

  return { cost_materiale, cost_utilaj, itemi };
}

module.exports = { rezolvaAddonMateriale, AddonFaraPretError, AddonInvalidError };
