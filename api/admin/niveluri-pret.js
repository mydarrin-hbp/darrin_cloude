// /api/admin/niveluri-pret.js
// Secțiune nouă, dedicată — „Niveluri de Preț" (cerință explicită 31 Iulie
// 2026): niveluri de preț generale (distincte de catalog_niveluri, care e
// complexitate de SERVICIU, legat de catalog), pe matricea nivel × țară,
// cu monedă. Minimum 5 niveluri, extensibile dinamic — vezi migrarea
// niveluri_pret_generale_si_tarife_transport.
//
// GET                                          → { niveluri, preturi, tari_reale }
// POST { action:'creeaza_nivel', cheie, nume, descriere?, ordine? }
// POST { action:'editeaza_nivel', id, nume?, descriere?, ordine?, activ? }
// POST { action:'sterge_nivel', id }                       → șterge nivelul + toate prețurile lui (cascade)
// POST { action:'salveaza_pret', nivel_id, tara_cod, moneda, pret, activ? }  → upsert pe matrice
// POST { action:'sterge_pret', id }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

async function handleGet(req, res) {
  const [{ data: niveluri, error: e1 }, { data: preturi, error: e2 }, { data: tariReale, error: e3 }] = await Promise.all([
    supabaseAdmin.from('niveluri_pret').select('*').order('ordine', { ascending: true }),
    supabaseAdmin.from('preturi_niveluri').select('*'),
    supabaseAdmin.from('tax_configurations').select('tara_cod, tara_nume, moneda').order('tara_cod', { ascending: true }),
  ]);
  if (e1 || e2 || e3) return res.status(500).json({ error: (e1 || e2 || e3).message });
  return res.status(200).json({ ok: true, niveluri, preturi, tari_reale: tariReale });
}

async function handler(req, res, admin) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};

  if (action === 'creeaza_nivel') {
    const { cheie, nume, descriere, ordine } = req.body;
    if (!cheie || !nume) return res.status(400).json({ error: 'cheie și nume sunt obligatorii' });
    const { data, error } = await supabaseAdmin
      .from('niveluri_pret')
      .insert({ cheie: String(cheie).trim(), nume: nume.trim(), descriere: descriere || null, ordine: Number(ordine) || 0 })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: `Există deja un nivel cu cheia "${cheie}"` });
      return res.status(500).json({ error: error.message });
    }
    await inregistreazaAudit({ admin, req, actiune: 'creare_nivel_pret', entitate: 'niveluri_pret', entitate_id: data.id, detalii: { cheie, nume } });
    return res.status(200).json({ ok: true, nivel: data });
  }

  if (action === 'editeaza_nivel') {
    const { id, nume, descriere, ordine, activ } = req.body;
    if (!id) return res.status(400).json({ error: 'id este obligatoriu' });
    const update = {};
    if (nume !== undefined) update.nume = nume;
    if (descriere !== undefined) update.descriere = descriere;
    if (ordine !== undefined) update.ordine = Number(ordine) || 0;
    if (activ !== undefined) update.activ = !!activ;
    const { data, error } = await supabaseAdmin.from('niveluri_pret').update(update).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    await inregistreazaAudit({ admin, req, actiune: 'editare_nivel_pret', entitate: 'niveluri_pret', entitate_id: id, detalii: update });
    return res.status(200).json({ ok: true, nivel: data });
  }

  if (action === 'sterge_nivel') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id este obligatoriu' });
    const { error } = await supabaseAdmin.from('niveluri_pret').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    await inregistreazaAudit({ admin, req, actiune: 'stergere_nivel_pret', entitate: 'niveluri_pret', entitate_id: id });
    return res.status(200).json({ ok: true });
  }

  if (action === 'salveaza_pret') {
    const { nivel_id, tara_cod, moneda, pret, activ } = req.body;
    if (!nivel_id || !tara_cod || !moneda) return res.status(400).json({ error: 'nivel_id, tara_cod și moneda sunt obligatorii' });
    if (pret !== null && pret !== undefined && (typeof pret !== 'number' || pret < 0)) {
      return res.status(400).json({ error: 'pret trebuie să fie un număr pozitiv sau null (neconfigurat)' });
    }
    const { data, error } = await supabaseAdmin
      .from('preturi_niveluri')
      .upsert({
        nivel_id, tara_cod: String(tara_cod).toUpperCase(), moneda: String(moneda).toUpperCase(),
        pret: pret ?? null, activ: activ !== false, actualizat_la: new Date().toISOString(),
      }, { onConflict: 'nivel_id,tara_cod' })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    await inregistreazaAudit({ admin, req, actiune: 'salvare_pret_nivel', entitate: 'preturi_niveluri', entitate_id: data.id, detalii: { nivel_id, tara_cod, pret } });
    return res.status(200).json({ ok: true, pret: data });
  }

  if (action === 'sterge_pret') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id este obligatoriu' });
    const { error } = await supabaseAdmin.from('preturi_niveluri').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    await inregistreazaAudit({ admin, req, actiune: 'stergere_pret_nivel', entitate: 'preturi_niveluri', entitate_id: id });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: `action necunoscută: ${action}` });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
