// /api/admin/tarife-manopera.js
// CAT-3a — audit 29 august 2026: 0 din 5.180 resurse de material/utilaj au
// tarif RO, dar cel puțin manopera (cost_ora pe cod ESCO+țară) e populabilă
// azi fără dependențe externe — tabela manopera_costuri exista deja,
// citită de lib/calculeaza-cost-recipe.js, dar fără NICIUN endpoint de
// scriere (doar api/admin/deviz-recipe.js, read-only). Urmează exact
// tiparul deja stabilit în api/admin/tarife-transport.js.
//
// GET  ?tara=RO         → listă completă pentru o țară (implicit RO),
//                          cu denumire_esco atașată din competente_esco
// POST { action:'salveaza', id?, cod_esco, tara_cod, moneda?, cost_ora,
//        cost_deplasare?, cost_uzura_scule?, cost_consumabile_mici?,
//        cost_echipament_testare? }
//        — dacă id lipsește, caută rând existent pe (cod_esco, tara_cod)
//        și îl actualizează în loc să dubleze
// POST { action:'sterge', id }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    const tara = req.query.tara ? String(req.query.tara).toUpperCase() : 'RO';
    const { data: tarife, error } = await supabaseAdmin
      .from('manopera_costuri')
      .select('*')
      .eq('tara_cod', tara)
      .order('cod_esco');
    if (error) return res.status(500).json({ error: error.message });

    const coduri = [...new Set((tarife || []).map(t => t.cod_esco).filter(Boolean))];
    let denumiri = {};
    if (coduri.length) {
      const { data: esco, error: escoErr } = await supabaseAdmin
        .from('competente_esco')
        .select('cod_esco, denumire')
        .in('cod_esco', coduri);
      if (!escoErr && esco) denumiri = Object.fromEntries(esco.map(e => [e.cod_esco, e.denumire]));
    }
    const cuDenumire = (tarife || []).map(t => ({ ...t, denumire_esco: denumiri[t.cod_esco] || null }));
    return res.status(200).json({ ok: true, tarife: cuDenumire });
  }

  if (req.method === 'POST') {
    const { action } = req.body || {};

    if (action === 'sterge') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id este obligatoriu' });
      const { error } = await supabaseAdmin.from('manopera_costuri').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      await inregistreazaAudit({ admin, req, actiune: 'stergere_tarif_manopera', entitate: 'manopera_costuri', entitate_id: id });
      return res.status(200).json({ ok: true });
    }

    if (action === 'salveaza') {
      const {
        id, cod_esco, tara_cod, moneda,
        cost_ora, cost_deplasare, cost_uzura_scule, cost_consumabile_mici, cost_echipament_testare,
      } = req.body;

      if (!cod_esco || typeof cod_esco !== 'string' || !cod_esco.trim()) {
        return res.status(400).json({ error: 'cod_esco este obligatoriu' });
      }
      if (!tara_cod || typeof tara_cod !== 'string' || tara_cod.trim().length !== 2) {
        return res.status(400).json({ error: 'tara_cod trebuie să fie un cod de 2 litere' });
      }
      if (typeof cost_ora !== 'number' || cost_ora <= 0) {
        return res.status(400).json({ error: 'cost_ora trebuie să fie un număr pozitiv' });
      }

      const codNormalizat = cod_esco.trim();
      const taraNormalizata = tara_cod.trim().toUpperCase();

      const rand = {
        cod_esco: codNormalizat,
        tara_cod: taraNormalizata,
        moneda: moneda ? String(moneda).trim().toUpperCase() : 'RON',
        cost_ora,
        cost_deplasare: cost_deplasare ?? 0,
        cost_uzura_scule: cost_uzura_scule ?? 0,
        cost_consumabile_mici: cost_consumabile_mici ?? 0,
        cost_echipament_testare: cost_echipament_testare ?? 0,
        updated_at: new Date().toISOString(),
        updated_by: admin.id,
      };

      let targetId = id || null;
      if (!targetId) {
        const { data: existent, error: cautaErr } = await supabaseAdmin
          .from('manopera_costuri')
          .select('id')
          .eq('cod_esco', codNormalizat)
          .eq('tara_cod', taraNormalizata)
          .maybeSingle();
        if (cautaErr) return res.status(500).json({ error: cautaErr.message });
        if (existent) targetId = existent.id;
      }

      const query = targetId
        ? supabaseAdmin.from('manopera_costuri').update(rand).eq('id', targetId)
        : supabaseAdmin.from('manopera_costuri').insert(rand);
      const { data, error } = await query.select().single();
      if (error) return res.status(500).json({ error: error.message });

      await inregistreazaAudit({ admin, req, actiune: 'salvare_tarif_manopera', entitate: 'manopera_costuri', entitate_id: data.id, detalii: rand });
      return res.status(200).json({ ok: true, tarif: data });
    }

    return res.status(400).json({ error: `action necunoscută: ${action}` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
