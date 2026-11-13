// /api/admin/palnie-parteneri.js
// Pasul 11-A1 (13 nov. 2026): raportul intern al pâlniei „Devino partener”.
// Doar endpoint-ul; afișarea în superadmin vine după o machetă aprobată.
//
// GET /api/admin/palnie-parteneri?zile=30   (admin / superadmin; 1–365, implicit 30)
// → { ok, zile, de_la, pana_la, migrare_aplicata,
//     total:    { conturi, conturi_partener, email_confirmed, pasi:{<pas>:n}, activari },
//     pe_sursa: [{ utm_source, utm_campaign, ...aceleași contoare }],
//     pe_zi:    [{ zi:'YYYY-MM-DD', utm_source, utm_campaign, ...aceleași contoare }] }
//
// Surse:
//   conturi          — profiles.created_at (conturi_partener: rol_solicitat sau rol de partener);
//   sursa            — profiles.sursa_utm (salvată doar cu acordul vizitatorului);
//                      fără sursă: utm_source = '(fara_sursa)';
//   email / pași     — palnie_evenimente (lib/palnie.js), ziua primei finalizări.
// Fără migrarea 2026-11-13_masurare_palnie.sql: conturile se numără tot, fără sursă,
// pașii rămân 0 și migrare_aplicata = false (nicio cifră inventată).
// Nicio dată personală în răspuns: doar numere, zile și numele campaniilor.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare, trimiteEroareInterna } = require('../../lib/raspuns-eroare');
const { esteRolPartener } = require('../../lib/activare-partener');
const { PAS_EVENIMENT } = require('../../lib/palnie');

const PASI = Object.values(PAS_EVENIMENT);
const FARA_SURSA = '(fara_sursa)';
const PAGINA = 1000;
const MAX_RANDURI = 50000;

function lipsaColoana(err) {
  return !!err && (err.code === '42703' || /sursa_utm/.test(String(err.message || '')));
}
function lipsaTabel(err) {
  return !!err && (err.code === '42P01' || err.code === 'PGRST205' || /palnie_evenimente/.test(String(err.message || '')));
}

// Citește toate rândurile, pe pagini (PostgREST întoarce cel mult 1000 o dată).
async function toate(construieste) {
  const rez = [];
  for (let de = 0; de < MAX_RANDURI; de += PAGINA) {
    const { data, error } = await construieste().range(de, de + PAGINA - 1);
    if (error) return { data: null, error };
    rez.push(...(data || []));
    if (!data || data.length < PAGINA) break;
  }
  return { data: rez, error: null };
}

function contoareGoale() {
  const pasi = {};
  PASI.forEach((p) => { pasi[p] = 0; });
  return { conturi: 0, conturi_partener: 0, email_confirmed: 0, pasi, activari: 0 };
}

function sursaDin(profil) {
  const s = profil && profil.sursa_utm;
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);
  return {
    utm_source: (s && text(s.utm_source)) || FARA_SURSA,
    utm_campaign: (s && text(s.utm_campaign)) || null,
  };
}

/**
 * Agregarea, separată de citire (testată în scripts/test-masurare-11a1.js).
 * @param {Array<{id, created_at, rol_solicitat?, roles?, sursa_utm?}>} profiluri  conturile create în interval
 * @param {Array<{user_id, eveniment, pas, creat_la}>} evenimente  momentele din interval
 * @param {Map<string, object>} profilPeId  profilurile (cu sursa) pentru toate conturile din evenimente
 */
function agrega(profiluri, evenimente, profilPeId) {
  const total = contoareGoale();
  const peZi = new Map();
  const peSursa = new Map();
  const cel = (harta, cheie, baza) => {
    if (!harta.has(cheie)) harta.set(cheie, Object.assign({}, baza, contoareGoale()));
    return harta.get(cheie);
  };
  const adauga = (zi, sursa, fn) => {
    fn(total);
    fn(cel(peSursa, sursa.utm_source + '\u0000' + (sursa.utm_campaign || ''), sursa));
    fn(cel(peZi, zi + '\u0000' + sursa.utm_source + '\u0000' + (sursa.utm_campaign || ''), Object.assign({ zi }, sursa)));
  };

  for (const p of profiluri || []) {
    if (!p || !p.created_at) continue;
    const partener = esteRolPartener(p.rol_solicitat) || (Array.isArray(p.roles) && p.roles.some(esteRolPartener));
    adauga(String(p.created_at).slice(0, 10), sursaDin(p), (c) => { c.conturi++; if (partener) c.conturi_partener++; });
  }
  for (const e of evenimente || []) {
    if (!e || !e.creat_la) continue;
    const sursa = sursaDin(profilPeId.get(e.user_id));
    const zi = String(e.creat_la).slice(0, 10);
    if (e.eveniment === 'email_confirmed') adauga(zi, sursa, (c) => { c.email_confirmed++; });
    else if (e.eveniment === 'partner_activation_completed') adauga(zi, sursa, (c) => { c.activari++; });
    else if (e.eveniment === 'partner_step_completed' && PASI.includes(e.pas)) adauga(zi, sursa, (c) => { c.pasi[e.pas]++; });
  }

  const dupaSursa = (a, b) => String(a.utm_source).localeCompare(String(b.utm_source)) || String(a.utm_campaign || '').localeCompare(String(b.utm_campaign || ''));
  return {
    total,
    pe_sursa: [...peSursa.values()].sort((a, b) => b.conturi - a.conturi || dupaSursa(a, b)),
    pe_zi: [...peZi.values()].sort((a, b) => a.zi.localeCompare(b.zi) || dupaSursa(a, b)),
  };
}

async function handler(req, res) {
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  res.setHeader('Cache-Control', 'private, no-store');

  const brut = req.query && req.query.zile;
  const zile = brut === undefined || brut === '' ? 30 : Number(brut);
  if (!Number.isInteger(zile) || zile < 1 || zile > 365) {
    return trimiteEroare(res, 400, 'ZILE_INVALIDE',
      'Parametrul „zile” trebuie să fie un număr întreg între 1 și 365.',
      'The number of days must be a whole number between 1 and 365.', ['zile']);
  }

  const panaLa = new Date();
  const deLa = new Date(panaLa.getTime() - zile * 86400000);
  deLa.setUTCHours(0, 0, 0, 0);
  const deLaIso = deLa.toISOString();

  try {
    let migrareAplicata = true;
    const coloane = 'id, created_at, rol_solicitat, roles, sursa_utm';
    let r = await toate(() => supabaseAdmin.from('profiles').select(coloane).gte('created_at', deLaIso).order('created_at'));
    if (r.error && lipsaColoana(r.error)) {
      migrareAplicata = false;
      r = await toate(() => supabaseAdmin.from('profiles').select('id, created_at, rol_solicitat, roles').gte('created_at', deLaIso).order('created_at'));
    }
    if (r.error) throw r.error;
    const profiluri = r.data;

    let evenimente = [];
    if (migrareAplicata) {
      const e = await toate(() => supabaseAdmin.from('palnie_evenimente').select('user_id, eveniment, pas, creat_la').gte('creat_la', deLaIso).order('creat_la'));
      if (e.error) {
        if (!lipsaTabel(e.error)) throw e.error;
        migrareAplicata = false;
      } else {
        evenimente = e.data;
      }
    }

    // Sursa conturilor create înainte de interval, dar cu pași în interval.
    const profilPeId = new Map(profiluri.map((p) => [p.id, p]));
    const lipsa = [...new Set(evenimente.map((e) => e.user_id))].filter((id) => !profilPeId.has(id));
    for (let i = 0; i < lipsa.length; i += 200) {
      const { data, error } = await supabaseAdmin.from('profiles').select('id, sursa_utm').in('id', lipsa.slice(i, i + 200));
      if (error) throw error;
      (data || []).forEach((p) => profilPeId.set(p.id, p));
    }

    const rez = agrega(profiluri, evenimente, profilPeId);
    return res.status(200).json({
      ok: true,
      zile,
      de_la: deLaIso,
      pana_la: panaLa.toISOString(),
      migrare_aplicata: migrareAplicata,
      ...rez,
    });
  } catch (err) {
    return trimiteEroareInterna(res, 500, 'EROARE_SERVER',
      'Nu am putut calcula pâlnia partenerilor.',
      'We could not calculate the partner funnel.', err);
  }
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
module.exports.agrega = agrega;
