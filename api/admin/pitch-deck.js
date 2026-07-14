// /api/admin/pitch-deck.js
// Administrare Pitch Deck din backoffice — doar admin/superadmin.
// GET                          → toate versiunile (drafturi + aprobate), recente primele
// POST { action:'salveaza', slides }         → salvează un draft nou (aprobat=false)
// POST { action:'publica', id }              → marchează versiunea `id` ca aprobată/live,
//                                               retrage aprobarea oricărei versiuni anterioare

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('pitch_deck_versiuni')
      .select('id, aprobat, aprobat_la, creat_la')
      .order('creat_la', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, versiuni: data || [] });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};

  if (action === 'salveaza') {
    const { slides } = req.body || {};
    if (!slides) return res.status(400).json({ error: 'slides este obligatoriu' });
    try {
      const { data, error } = await supabaseAdmin
        .from('pitch_deck_versiuni')
        .insert({ slide_uri: slides, creat_de: admin.id })
        .select()
        .single();
      if (error) throw error;
      await inregistreazaAudit({ admin, req, actiune: 'pitch_deck_draft_salvat', entitate: 'pitch_deck_versiuni', entitate_id: data.id });
      return res.status(200).json({ ok: true, versiune: data });
    } catch (err) {
      console.error('[admin/pitch-deck salveaza]', err);
      return res.status(500).json({ error: err.message || 'Nu am putut salva draft-ul' });
    }
  }

  if (action === 'publica') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id este obligatoriu' });
    try {
      await supabaseAdmin.from('pitch_deck_versiuni').update({ aprobat: false }).eq('aprobat', true);
      const { data, error } = await supabaseAdmin
        .from('pitch_deck_versiuni')
        .update({ aprobat: true, aprobat_de: admin.id, aprobat_la: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error || !data) return res.status(404).json({ error: 'Versiunea nu există' });
      await inregistreazaAudit({ admin, req, actiune: 'pitch_deck_publicat', entitate: 'pitch_deck_versiuni', entitate_id: id });
      return res.status(200).json({ ok: true, versiune: data });
    } catch (err) {
      console.error('[admin/pitch-deck publica]', err);
      return res.status(500).json({ error: err.message || 'Nu am putut publica versiunea' });
    }
  }

  return res.status(400).json({ error: "action trebuie să fie 'salveaza' sau 'publica'" });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
