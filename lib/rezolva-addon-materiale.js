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
const { parteneriCarePotVinde } = require('./eligibilitate-partener');

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

// ── Produse din marketplace (16 oct. 2026) ─────────────────────────────────
// Id-ul unui produs din marketplace_materiale / marketplace_echipamente are
// forma „mp:materiale:<uuid>” sau „mp:echipamente:<uuid>”, ca să nu se
// confunde cu un catalog_servicii.id. Doar produsele live și active, în
// moneda țării comenzii. Costul (fără TVA) intră în costul de bază: pentru
// materiale pret_fara_tva × cantitate, pentru echipamente tarif_zi × zile
// (qty = numărul de zile). Formula prețului public (lib/calculeaza-pret.js)
// adaugă apoi asigurarea, comisionul, marketingul, mentenanța și TVA-ul.
// furnizor_id rămâne pe item: escrow-ul înregistrează suma pe furnizor.
// Pasul 10c (16 oct. 2026): produsul se acceptă doar dacă furnizorul lui
// poate vinde (lib/eligibilitate-partener.js) — aceeași regulă ca în
// marketplace-ul public, deci și la checkout (api/comenzi/creeaza.js).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABEL_MARKETPLACE = {
  materiale: { tabel: 'marketplace_materiale', categorie: 'materiale', coloane: 'id, furnizor_id, denumire, descriere, unitate_masura, pret_fara_tva, moneda, status, activ' },
  echipamente: { tabel: 'marketplace_echipamente', categorie: 'inchirieri', coloane: 'id, furnizor_id, denumire, descriere, operator_inclus, tarif_zi, moneda, status, activ' },
};

function parseazaIdMarketplace(id) {
  const m = String(id || '').match(/^mp:(materiale|echipamente):(.+)$/);
  if (!m || !UUID.test(m[2])) return null;
  return { tip: m[1], id: m[2] };
}

async function monedaTarii(taraCod) {
  const { data } = await supabaseAdmin.from('tax_configurations').select('moneda').eq('tara_cod', taraCod).maybeSingle();
  return data?.moneda || null;
}

async function rezolvaProdusMarketplace({ tip, id }, qty, taraCod) {
  const cfg = TABEL_MARKETPLACE[tip];
  const { data: produs } = await supabaseAdmin
    .from(cfg.tabel)
    .select(cfg.coloane)
    .eq('id', id)
    .eq('status', 'live')
    .eq('activ', true)
    .maybeSingle();
  const pretUnitar = Number(tip === 'materiale' ? produs?.pret_fara_tva : produs?.tarif_zi);
  if (!produs || !(pretUnitar > 0) || !(await parteneriCarePotVinde([produs.furnizor_id])).has(produs.furnizor_id)) {
    throw new AddonFaraPretError('Produsul ales din marketplace nu mai este disponibil.');
  }
  const moneda = await monedaTarii(taraCod);
  if (moneda && produs.moneda && String(produs.moneda).toUpperCase() !== String(moneda).toUpperCase()) {
    throw new AddonFaraPretError('Produsul ales din marketplace nu are preț în moneda țării comenzii.');
  }
  const subtotal = Math.round(pretUnitar * qty * 100) / 100;
  return {
    produs_marketplace_id: produs.id, tip_marketplace: tip, furnizor_id: produs.furnizor_id,
    titlu: produs.denumire, descriere: produs.descriere || null, categorie: cfg.categorie,
    unitate_masura: tip === 'materiale' ? produs.unitate_masura : 'zi', qty, pret_unitar: pretUnitar, subtotal,
  };
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
    const produsMp = parseazaIdMarketplace(addonId);
    if (produsMp) {
      const it = await rezolvaProdusMarketplace(produsMp, qty, taraCod);
      if (it.categorie === 'materiale') cost_materiale += it.subtotal;
      else cost_utilaj += it.subtotal;
      itemi.push(it);
      continue;
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

module.exports = { rezolvaAddonMateriale, parseazaIdMarketplace, AddonFaraPretError, AddonInvalidError };
