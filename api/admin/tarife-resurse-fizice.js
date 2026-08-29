// /api/admin/tarife-resurse-fizice.js
// CAT-3a, 29 august 2026 — structura reală, admin-only, pentru tarife pe
// materiale (tarife_materiale) și utilaje (tarife_resurse) — 4.938 + 242
// resurse fără NICIUN tarif RO azi (audit CAT-3a), gol total, dincolo de
// manoperă (deja rezolvată separat, api/admin/tarife-manopera.js).
// Ambele tabele au schemă identică (resursa_id, tara_cod, moneda,
// pret_unitar, unitate_masura, activ) — un singur endpoint, parametrul
// `tip` ('M' sau 'U') selectează tabela, whitelist strict, niciodată
// interpolat direct în interogare.
//
// GET  ?tip=M|U&tara=RO           → tarife existente pentru acea țară
// GET  ?tip=M|U&cauta=text        → caută resurse din devize_resurse
//      (cod_resursa/denumire) NEEXPUSE încă la tarif pentru țara implicită,
//      pentru selectarea rapidă a uneia noi de prețuit
// POST { action:'salveaza', tip, id?, resursa_id, tara_cod, moneda,
//        pret_unitar, unitate_masura? }
//      — dacă id lipsește, caută rând existent pe (resursa_id, tara_cod)
// POST { action:'sterge', tip, id }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

const TABELE = { M: 'tarife_materiale', U: 'tarife_resurse' };

function tabelaPentru(tip) {
  return TABELE[String(tip || '').toUpperCase()] || null;
}

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    const tabela = tabelaPentru(req.query.tip);
    if (!tabela) return res.status(400).json({ error: 'tip trebuie să fie M sau U' });
    const tipResursa = req.query.tip.toUpperCase();

    if (req.query.cauta) {
      const q = String(req.query.cauta).trim().slice(0, 80);
      if (!q) return res.status(200).json({ ok: true, resurse: [] });
      const { data, error } = await supabaseAdmin
        .from('devize_resurse')
        .select('resursa_id, cod_resursa, denumire_resursa, unitate_masura')
        .eq('tip_resursa', tipResursa)
        .or(`denumire_resursa.ilike.%${q}%,cod_resursa.ilike.%${q}%`)
        .limit(30);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, resurse: data || [] });
    }

    const tara = req.query.tara ? String(req.query.tara).toUpperCase() : 'RO';
    const { data: tarife, error } = await supabaseAdmin
      .from(tabela)
      .select('*')
      .eq('tara_cod', tara)
      .order('updated_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const ids = [...new Set((tarife || []).map(t => t.resursa_id).filter(Boolean))];
    let denumiri = {};
    if (ids.length) {
      const { data: resurse, error: resErr } = await supabaseAdmin
        .from('devize_resurse')
        .select('resursa_id, denumire_resursa, cod_resursa')
        .in('resursa_id', ids);
      if (!resErr && resurse) denumiri = Object.fromEntries(resurse.map(r => [r.resursa_id, r]));
    }
    const cuDenumire = (tarife || []).map(t => ({ ...t, denumire_resursa: denumiri[t.resursa_id]?.denumire_resursa || null, cod_resursa: denumiri[t.resursa_id]?.cod_resursa || null }));
    return res.status(200).json({ ok: true, tarife: cuDenumire });
  }

  if (req.method === 'POST') {
    const { action } = req.body || {};
    const tabela = tabelaPentru(req.body?.tip);
    if (!tabela) return res.status(400).json({ error: 'tip trebuie să fie M sau U' });

    if (action === 'sterge') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id este obligatoriu' });
      const { error } = await supabaseAdmin.from(tabela).delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      await inregistreazaAudit({ admin, req, actiune: 'stergere_tarif_resursa_fizica', entitate: tabela, entitate_id: id });
      return res.status(200).json({ ok: true });
    }

    if (action === 'salveaza') {
      const { id, resursa_id, tara_cod, moneda, pret_unitar, unitate_masura } = req.body;

      if (!resursa_id || typeof resursa_id !== 'number') {
        return res.status(400).json({ error: 'resursa_id este obligatoriu (numeric)' });
      }
      if (!tara_cod || typeof tara_cod !== 'string' || tara_cod.trim().length !== 2) {
        return res.status(400).json({ error: 'tara_cod trebuie să fie un cod de 2 litere' });
      }
      if (typeof pret_unitar !== 'number' || pret_unitar <= 0) {
        return res.status(400).json({ error: 'pret_unitar trebuie să fie un număr pozitiv' });
      }

      const taraNormalizata = tara_cod.trim().toUpperCase();
      const rand = {
        resursa_id,
        tara_cod: taraNormalizata,
        moneda: moneda ? String(moneda).trim().toUpperCase() : 'RON',
        pret_unitar,
        unitate_masura: unitate_masura || null,
        activ: true,
        updated_at: new Date().toISOString(),
        updated_by: admin.id,
      };

      let targetId = id || null;
      if (!targetId) {
        const { data: existent, error: cautaErr } = await supabaseAdmin
          .from(tabela)
          .select('id')
          .eq('resursa_id', resursa_id)
          .eq('tara_cod', taraNormalizata)
          .maybeSingle();
        if (cautaErr) return res.status(500).json({ error: cautaErr.message });
        if (existent) targetId = existent.id;
      }

      const query = targetId
        ? supabaseAdmin.from(tabela).update(rand).eq('id', targetId)
        : supabaseAdmin.from(tabela).insert(rand);
      const { data, error } = await query.select().single();
      if (error) return res.status(500).json({ error: error.message });

      await inregistreazaAudit({ admin, req, actiune: 'salvare_tarif_resursa_fizica', entitate: tabela, entitate_id: data.id, detalii: rand });
      return res.status(200).json({ ok: true, tarif: data });
    }

    return res.status(400).json({ error: `action necunoscută: ${action}` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
