// lib/eligibilitate-partener.js
// Regula unică „furnizor activ” (pasul 10c, 16 oct. 2026): ce poate face un
// partener în fiecare stare a contului. Toate verificările de eligibilitate
// trec pe aici, nu prin condiții scrise de mână în fiecare endpoint:
//   - poatePregatiCatalog: are rol de furnizor (materiale / închirieri) și
//     contul nu e suspendat — își poate pregăti produsele (rămân în așteptare);
//   - poateVinde: aprobat ȘI (contract semnat ȘI cont bancar activ), sau
//     furnizorul propriu al platformei (partners.entitate_platforma_id), aprobat;
//   - poatePrimiComenzi: aceeași regulă ca poateVinde.
// Furnizorul propriu (Home Best Pal SRL, contul contact@homebestpal.ro) e
// chiar entitatea platformei: nu semnează contract cu sine, iar banii intră
// în contul entității (lib/furnizor-propriu.js, lib/elibereaza-escrow.js).
// Un cont suspendat (profiles.status = 'suspended') nu poate nimic din cele de
// mai sus. Folosită de: api/partener/accept-comanda.js,
// api/partener/contract-trimite-otp.js, lib/aloca-subcontractori.js,
// api/admin/marketplace-aprobari.js, api/public/marketplace-produse.js,
// lib/rezolva-addon-materiale.js (checkout) și api/cont/profil.js.

const { supabaseAdmin } = require('./supabaseAdmin');
const { coloanaLipseste } = require('./furnizor-propriu');

const TIPURI_FURNIZOR = Object.freeze(['furnizor_materiale', 'inchirieri_utilaje']);
const ROLURI_FURNIZOR = Object.freeze(['partener_materiale', 'partener_inchirieri']);

// Motivul pentru care un partener nu poate vinde / primi comenzi.
const MOTIV = Object.freeze({
  INEXISTENT: 'inexistent',
  SUSPENDAT: 'suspendat',
  RESPINS: 'respins',
  IN_VERIFICARE: 'in_verificare',
  FARA_CONT_BANCAR: 'fara_cont_bancar',
  FARA_CONTRACT: 'fara_contract',
});

// Mesajele pentru admin (aprobarea produselor), RO + EN.
const MESAJ_FURNIZOR = Object.freeze({
  inexistent: { ro: 'Furnizorul produsului nu există.', en: "The product's supplier does not exist." },
  suspendat: { ro: 'Contul furnizorului este suspendat.', en: "The supplier's account is suspended." },
  respins: { ro: 'Furnizorul a fost respins.', en: 'The supplier has been rejected.' },
  in_verificare: { ro: 'Furnizorul nu este încă aprobat.', en: 'The supplier is not approved yet.' },
  fara_cont_bancar: { ro: 'Furnizorul nu are un cont bancar activ.', en: 'The supplier has no active bank account.' },
  fara_contract: { ro: 'Furnizorul nu are contractul semnat.', en: 'The supplier has no signed contract.' },
});

function esteFurnizorPropriu(p) {
  return !!(p && p.entitate_platforma_id);
}

function esteSuspendat(p) {
  return !!(p && p.profil_status === 'suspended');
}

/**
 * Motivul pentru care partenerul nu poate vinde, sau null dacă poate.
 * @param {{status_verificare?:string, contract_semnat?:boolean, cont_bancar?:boolean,
 *          entitate_platforma_id?:string|null, profil_status?:string}|null} p
 */
function motivNuPoateVinde(p) {
  if (!p) return MOTIV.INEXISTENT;
  if (esteSuspendat(p)) return MOTIV.SUSPENDAT;
  if (p.status_verificare === 'rejected') return MOTIV.RESPINS;
  if (p.status_verificare !== 'approved') return MOTIV.IN_VERIFICARE;
  if (esteFurnizorPropriu(p)) return null;
  if (!p.cont_bancar) return MOTIV.FARA_CONT_BANCAR;
  if (!p.contract_semnat) return MOTIV.FARA_CONTRACT;
  return null;
}

function poateVinde(p) {
  return motivNuPoateVinde(p) === null;
}

function poatePrimiComenzi(p) {
  return poateVinde(p);
}

function poatePregatiCatalog(p) {
  if (!p || esteSuspendat(p)) return false;
  const roles = Array.isArray(p.roles) ? p.roles : [];
  return TIPURI_FURNIZOR.includes(p.partner_type) || roles.some((r) => ROLURI_FURNIZOR.includes(r));
}

// ── Citirea din baza de date ─────────────────────────────────────────────
// entitate_platforma_id vine cu migrarea 2026-10-16_furnizor_propriu.sql; fără
// ea, niciun partener nu e furnizor propriu (aceeași toleranță ca în
// lib/furnizor-propriu.js).
const COLOANE = 'id, nume_firma, partner_type, status_verificare, contract_semnat';

async function citesteParteneri(ids) {
  const r = await supabaseAdmin.from('partners').select(`${COLOANE}, entitate_platforma_id`).in('id', ids);
  if (!r.error) return r.data || [];
  if (!coloanaLipseste(r.error)) throw r.error;
  const r2 = await supabaseAdmin.from('partners').select(COLOANE).in('id', ids);
  if (r2.error) throw r2.error;
  return (r2.data || []).map((p) => ({ ...p, entitate_platforma_id: null }));
}

/**
 * Starea de eligibilitate a partenerilor dați, dintr-o singură serie de citiri.
 * @param {string[]} partenerIds
 * @returns {Promise<Map<string, object>>} id → { ...partener, cont_bancar, profil_status,
 *          furnizor_propriu, poate_vinde, motiv }; partenerii inexistenți lipsesc din hartă
 */
async function incarcaEligibilitate(partenerIds) {
  const ids = [...new Set((partenerIds || []).filter(Boolean))];
  const rezultat = new Map();
  if (!ids.length) return rezultat;
  const [parteneri, conturi, profile] = await Promise.all([
    citesteParteneri(ids),
    supabaseAdmin.from('partner_conturi_bancare').select('partner_id').in('partner_id', ids).eq('activ', true),
    supabaseAdmin.from('profiles').select('id, status').in('id', ids),
  ]);
  if (conturi.error) throw conturi.error;
  if (profile.error) throw profile.error;
  const cuCont = new Set((conturi.data || []).map((c) => c.partner_id));
  const status = new Map((profile.data || []).map((p) => [p.id, p.status]));
  parteneri.forEach((p) => {
    const e = { ...p, contract_semnat: !!p.contract_semnat, cont_bancar: cuCont.has(p.id), profil_status: status.get(p.id) || null };
    e.furnizor_propriu = esteFurnizorPropriu(e);
    e.motiv = motivNuPoateVinde(e);
    e.poate_vinde = e.motiv === null;
    rezultat.set(p.id, e);
  });
  return rezultat;
}

async function eligibilitatePartener(partenerId) {
  if (!partenerId) return null;
  return (await incarcaEligibilitate([partenerId])).get(partenerId) || null;
}

/**
 * Dintre partenerii dați, cei care pot vinde / primi comenzi.
 * @returns {Promise<Set<string>>}
 */
async function parteneriCarePotVinde(partenerIds) {
  const harta = await incarcaEligibilitate(partenerIds);
  return new Set([...harta.values()].filter((p) => p.poate_vinde).map((p) => p.id));
}

module.exports = {
  TIPURI_FURNIZOR,
  ROLURI_FURNIZOR,
  MOTIV,
  MESAJ_FURNIZOR,
  esteFurnizorPropriu,
  motivNuPoateVinde,
  poateVinde,
  poatePrimiComenzi,
  poatePregatiCatalog,
  incarcaEligibilitate,
  eligibilitatePartener,
  parteneriCarePotVinde,
};
