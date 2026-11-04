// lib/disponibilitate-adresa.js
// Pasul 11-C1 (3 nov. 2026, regula LM): un serviciu (și o închiriere) intră în
// coș doar prin pagina de configurare, cu adresa de prestare completă (strada,
// localitatea, județul, țara) și doar dacă există parteneri activi pentru el în
// zona adresei. Verificarea se face aici, pe server, o singură dată:
//   - api/public/disponibilitate-adresa.js — pagina de configurare, live;
//   - api/client/cos-multi.js — la adăugarea în coș (nu se acceptă un rând fără
//     verificare, chiar dacă cineva trimite cererea direct).
//
// „Parteneri activi în zonă” = aceeași regulă ca la alocare
// (lib/aloca-partener.js): partener_servicii_active.activ pentru serviciu și
// parteneri_disponibilitate.status_live = 'disponibil', în țara adresei, cu
// județul în `judete` (codul din geo_regiuni, regula București-Ilfov din
// lib/regiune.js). Competențele ESCO și echipa rămân verificate la alocare.
//
// Prețul și transportul: pentru nivelul ales (nivel_id), același calcul ca la
// comandă (lib/pret-serviciu.js, pasul 11-C2), cu județul adresei. Fără nivel
// trimis: preț și transport null (nu 0). Nivel fără preț real → indisponibil,
// motiv 'fara_pret' („Cere un deviz”).
//
//   verificaDisponibilitate({ serviciu: { id | slug }, adresa: { strada, localitate, judet, tara_cod }, nivel_id?, cantitate? })
//     -> { ok:false, status, cod, camp, mesaj:{ro,en} }      (date lipsă / greșite)
//     -> { ok:true, disponibil, motiv?, mesaj?, serviciu, zona, pret_final, transport }

const { supabaseAdmin } = require('./supabaseAdmin');
const { rezolvaRegiune, varianteRegiune, MESAJ_REGIUNE } = require('./regiune');
const { calculeazaPretServiciu } = require('./pret-serviciu');

const CATEGORII_CU_ADRESA = ['servicii', 'inchirieri'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESAJE = {
  strada: {
    ro: 'Completează strada și numărul adresei de prestare.',
    en: 'Fill in the street and number of the service address.',
  },
  localitate: {
    ro: 'Completează localitatea adresei de prestare.',
    en: 'Fill in the town or city of the service address.',
  },
  judet: {
    ro: 'Alege județul adresei de prestare.',
    en: 'Choose the county of the service address.',
  },
  serviciu_lipsa: {
    ro: 'Serviciul nu se poate comanda încă: nu este în catalogul cu prețuri al platformei. Alege un serviciu din catalog.',
    en: "This service cannot be ordered yet: it is not in the platform's priced catalogue. Choose a service from the catalogue.",
  },
  tara_inactiva: {
    ro: 'My Darrin nu primește încă comenzi în țara acestei adrese.',
    en: "My Darrin does not take orders in this address's country yet.",
  },
  fara_parteneri: {
    ro: 'Momentan nu avem parteneri activi pentru acest serviciu în județul ales, deci nu îl putem adăuga în coș pentru această adresă. Alege altă adresă sau revino mai târziu.',
    en: 'We do not have active partners for this service in the selected county yet, so we cannot add it to the basket for this address. Choose another address or come back later.',
  },
  fara_pret: {
    ro: 'Acest serviciu nu are încă un preț fix. Cere un deviz.',
    en: 'This service does not have a fixed price yet. Ask for a quote.',
  },
};

function text(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max || 200) : '';
}

function refuz(status, cod, camp, cheie, mesaj) {
  const m = mesaj || MESAJE[cheie];
  return { ok: false, status, cod, camp, mesaj: { ro: m.ro, en: m.en } };
}

function indisponibil(motiv, extra) {
  const m = MESAJE[motiv];
  return Object.assign({ ok: true, disponibil: false, motiv, mesaj: { ro: m.ro, en: m.en } }, extra);
}

// Serviciul din catalog, după id (uuid) sau după slug (catalog_servicii.id_serviciu).
async function gasesteServiciu({ id, slug } = {}) {
  let q = supabaseAdmin.from('catalog_servicii').select('id, id_serviciu, titlu, categorie, status_public');
  if (typeof id === 'string' && UUID.test(id)) q = q.eq('id', id);
  else if (typeof slug === 'string' && slug.trim()) q = q.eq('id_serviciu', slug.trim().slice(0, 120));
  else return null;
  const { data } = await q.maybeSingle();
  if (!data || data.status_public === false || !CATEGORII_CU_ADRESA.includes(data.categorie)) return null;
  return data;
}

/**
 * Adresa de prestare, adusă la o formă: județul cu codul din geo_regiuni.
 * @returns {Promise<{ok:true, zona}|{ok:false, ...}>}
 */
async function valideazaAdresa(adresa) {
  const a = adresa && typeof adresa === 'object' ? adresa : {};
  const strada = text(a.strada);
  const localitate = text(a.localitate, 120);
  const judet = text(a.judet, 80);
  const tara = (text(a.tara_cod || a.tara, 2) || 'RO').toUpperCase();
  if (strada.length < 3) return refuz(400, 'ADRESA_INCOMPLETA', 'strada', 'strada');
  if (localitate.length < 2) return refuz(400, 'ADRESA_INCOMPLETA', 'localitate', 'localitate');
  if (!judet) return refuz(400, 'ADRESA_INCOMPLETA', 'judet', 'judet');
  const r = await rezolvaRegiune(tara, judet);
  if (r.areRegiuni && !r.regiune) return refuz(400, 'REGIUNE_NECUNOSCUTA', 'judet', null, MESAJ_REGIUNE);
  return {
    ok: true,
    zona: {
      strada, localitate, tara_cod: tara,
      regiune: r.regiune ? r.regiune.cod : judet,
      judet: r.regiune ? r.regiune.denumire : judet,
      text: [strada, localitate, r.regiune ? r.regiune.denumire : judet].join(', '),
    },
  };
}

async function areParteneriInZona(serviciuId, zona) {
  const { data: activi } = await supabaseAdmin
    .from('partener_servicii_active')
    .select('partener_id')
    .eq('catalog_serviciu_id', serviciuId)
    .eq('activ', true);
  const ids = [...new Set((activi || []).map((r) => r.partener_id))];
  if (!ids.length) return false;
  const { data: disponibili } = await supabaseAdmin
    .from('parteneri_disponibilitate')
    .select('partener_id')
    .in('partener_id', ids)
    .eq('status_live', 'disponibil')
    .eq('tara_cod', zona.tara_cod)
    .overlaps('judete', varianteRegiune(zona.regiune));
  return !!(disponibili && disponibili.length);
}

async function tariActiva(taraCod) {
  const { data } = await supabaseAdmin
    .from('tax_configurations').select('checkout_activ').eq('tara_cod', taraCod).maybeSingle();
  return !!(data && data.checkout_activ);
}

// Prețul și transportul pentru nivelul ales al serviciului, cu județul adresei
// (pasul 11-C2: același calcul ca la comandă, lib/pret-serviciu.js).
async function pretNivel(nivelId, serviciuId, zona, cantitate, addonMateriale) {
  const r = await calculeazaPretServiciu({ nivelId, cantitate, taraCod: zona.tara_cod, regiune: zona.regiune, addonMateriale });
  if (!r.ok) return r.motiv === 'nivel_necunoscut' ? null : { fara_pret: true, motiv: r.motiv, mesaj: r.mesaj };
  if (r.nivel.serviciu_id !== serviciuId) return null;
  return { pret_final: r.calc.pret_final, transport: r.defalcare.transport };
}

async function verificaDisponibilitate({ serviciu, adresa, nivel_id = null, cantitate = 1, addon_materiale = [] } = {}) {
  const adr = await valideazaAdresa(adresa);
  if (!adr.ok) return adr;
  const zona = adr.zona;

  const serv = await gasesteServiciu(serviciu || {});
  if (!serv) return refuz(404, 'SERVICIU_NECUNOSCUT', 'serviciu', 'serviciu_lipsa');
  const descriere = { id: serv.id, slug: serv.id_serviciu, titlu: serv.titlu, categorie: serv.categorie };

  if (!(await tariActiva(zona.tara_cod))) return indisponibil('tara_inactiva', { serviciu: descriere, zona });
  if (!(await areParteneriInZona(serv.id, zona))) return indisponibil('fara_parteneri', { serviciu: descriere, zona });

  let pret = null;
  if (typeof nivel_id === 'string' && UUID.test(nivel_id)) {
    const cant = Number(cantitate);
    pret = await pretNivel(nivel_id, serv.id, zona, Number.isFinite(cant) && cant > 0 ? cant : 1, addon_materiale);
    if (pret && pret.fara_pret) {
      const m = pret.motiv === 'fara_pret' ? MESAJE.fara_pret : pret.mesaj;
      return { ok: true, disponibil: false, motiv: pret.motiv, mesaj: { ro: m.ro, en: m.en }, serviciu: descriere, zona };
    }
  }

  return {
    ok: true, disponibil: true, serviciu: descriere, zona,
    pret_final: pret ? pret.pret_final : null,
    transport: pret ? pret.transport : null,
  };
}

module.exports = { verificaDisponibilitate, valideazaAdresa, gasesteServiciu, CATEGORII_CU_ADRESA, MESAJE };
