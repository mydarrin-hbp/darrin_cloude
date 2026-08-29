// /api/public/calculeaza-pret-nivel.js
// "Preț per cantitate reală comandată" (22 August 2026, aprobat, pașii 1-3
// din propunere) — endpoint public, fără autentificare (browsing/preț sunt
// publice), care calculează prețul REAL, server-side, pentru un nivel de
// catalog legat de o rețetă tehnică (azi doar cele 5 servicii pilot —
// devize_articole.catalog_nivel_id populat), la o cantitate dată.
//
// Menit să alimenteze live afișarea prețului în mydarrin-produs.html la
// schimbarea cantității — înlocuiește treptat calculul actual, pur
// client-side, neverificat de server (gaura de integritate reparată azi
// mai devreme era doar despre pragul minim; asta e verificarea prețului
// propriu-zis).
//
// Body: { nivel_id (uuid, obligatoriu), cantitate (număr pozitiv, implicit 1),
//         tara_cod (implicit 'RO'), addon_materiale? ([{id,qty}], Faza 2/3 CAT
//         29 aug 2026 — materiale/accesorii opționale, preț rezolvat identic
//         ca în api/comenzi/creeaza.js, vezi lib/rezolva-addon-materiale.js) }
// -> { ok:true, disponibil:true, pret_final, prag_minim_comanda, subtotal_variabil,
//      cantitate, tara_cod, moneda }
// -> { ok:true, disponibil:false, motiv:'resurse_fara_pret', resurse_fara_pret:[...] }
// -> { ok:true, disponibil:false, motiv:'addon_fara_pret', mesaj:'...' }

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');
const { calculeazaCostNivel } = require('../../lib/calculeaza-cost-recipe');
const { calculeazaPret } = require('../../lib/calculeaza-pret');
const { rezolvaAddonMateriale } = require('../../lib/rezolva-addon-materiale');

const CANTITATE_MAX = 100000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const allowed = await checkRateLimit(req, { key: 'calculeaza-pret-nivel', limit: 60, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.' });

  const { nivel_id, cantitate = 1, tara_cod = 'RO', addon_materiale = [] } = req.body || {};

  if (!nivel_id || typeof nivel_id !== 'string') {
    return res.status(400).json({ error: 'nivel_id (uuid) este obligatoriu.' });
  }
  const cantitateNum = Number(cantitate);
  if (!Number.isFinite(cantitateNum) || cantitateNum <= 0 || cantitateNum > CANTITATE_MAX) {
    return res.status(400).json({ error: `cantitate trebuie să fie un număr pozitiv, sub ${CANTITATE_MAX}.` });
  }
  const taraCod = String(tara_cod || 'RO').toUpperCase();

  try {
    const cost = await calculeazaCostNivel({ nivelId: nivel_id, taraCod, cantitate: cantitateNum });

    if (cost.resurse_fara_pret.length) {
      return res.status(200).json({
        ok: true, disponibil: false, motiv: 'resurse_fara_pret',
        resurse_fara_pret: cost.resurse_fara_pret.map((r) => ({ denumire: r.denumire, tip: r.tip, unitate: r.unitate })),
      });
    }

    const { data: taraCfg } = await supabaseAdmin
      .from('tax_configurations').select('moneda').eq('tara_cod', taraCod).maybeSingle();
    const moneda = taraCfg?.moneda || 'RON';

    let addonRezultat;
    try {
      const { data: nivelRow } = await supabaseAdmin
        .from('catalog_niveluri').select('nivel').eq('id', nivel_id).maybeSingle();
      addonRezultat = await rezolvaAddonMateriale(addon_materiale, nivelRow?.nivel || null, taraCod);
    } catch (e) {
      if (e.code === 'ADDON_FARA_PRET' || e.code === 'ADDON_INVALID') {
        return res.status(200).json({ ok: true, disponibil: false, motiv: 'addon_fara_pret', mesaj: e.message });
      }
      throw e;
    }

    const calc = await calculeazaPret({
      cost_baza_servicii: cost.cost_baza_servicii,
      cost_materiale: cost.cost_materiale + addonRezultat.cost_materiale,
      cost_chirie_scule: cost.cost_utilaj + addonRezultat.cost_utilaj,
      tara: taraCod,
    });

    return res.status(200).json({
      ok: true, disponibil: true,
      pret_final: calc.pret_final,
      prag_minim_comanda: calc.prag_minim_comanda,
      subtotal_variabil: calc.subtotal,
      addon_materiale: addonRezultat.itemi,
      cantitate: cantitateNum, tara_cod: taraCod, moneda,
    });
  } catch (err) {
    console.error('[public/calculeaza-pret-nivel]', err);
    return res.status(500).json({ error: 'Nu am putut calcula prețul.' });
  }
};
