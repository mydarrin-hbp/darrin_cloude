// /api/admin/metode-plata-config.js
// Configurare metode de plată acceptate — per țară/regiune/categorie de
// serviciu (audit Secțiunea 43/44, 31 Iulie 2026, cerință explicită: "pe o
// anumită zonă sau categorie de servicii sau țară... card, ordin de plată,
// avans"). Fiecare dimensiune e opțională (NULL = valabil pentru toate).
//
// GET                          → listă completă
// POST { action:'salveaza', id?, tara_cod?, regiune?, categorie_serviciu_slug?, metode_acceptate[], permite_avans, activ }
// POST { action:'sterge', id } → șterge o configurare

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

const METODE_VALIDE = ['card', 'ordin_plata'];

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('metode_plata_config')
      .select('*')
      .order('creat_la', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, configurari: data });
  }

  if (req.method === 'POST') {
    const { action } = req.body || {};

    if (action === 'sterge') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id este obligatoriu' });
      const { error } = await supabaseAdmin.from('metode_plata_config').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      await inregistreazaAudit({ admin, req, actiune: 'stergere_metoda_plata_config', entitate: 'metode_plata_config', entitate_id: id });
      return res.status(200).json({ ok: true });
    }

    if (action === 'salveaza') {
      const { id, tara_cod, regiune, categorie_serviciu_slug, metode_acceptate, permite_avans, activ } = req.body;
      if (!Array.isArray(metode_acceptate) || !metode_acceptate.length || metode_acceptate.some((m) => !METODE_VALIDE.includes(m))) {
        return res.status(400).json({ error: `metode_acceptate trebuie să fie un array nevid cu valori din: ${METODE_VALIDE.join(', ')}` });
      }

      const rand = {
        tara_cod: tara_cod ? String(tara_cod).toUpperCase() : null,
        regiune: regiune || null,
        categorie_serviciu_slug: categorie_serviciu_slug || null,
        metode_acceptate,
        permite_avans: !!permite_avans,
        activ: activ !== false,
        actualizat_la: new Date().toISOString(),
      };

      const query = id
        ? supabaseAdmin.from('metode_plata_config').update(rand).eq('id', id)
        : supabaseAdmin.from('metode_plata_config').insert(rand);
      const { data, error } = await query.select().single();
      if (error) return res.status(500).json({ error: error.message });

      await inregistreazaAudit({ admin, req, actiune: 'salvare_metoda_plata_config', entitate: 'metode_plata_config', entitate_id: data.id, detalii: rand });
      return res.status(200).json({ ok: true, configurare: data });
    }

    return res.status(400).json({ error: `action necunoscută: ${action}` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
