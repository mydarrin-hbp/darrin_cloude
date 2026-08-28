// /api/admin/investitori-aprobare.js
// Etapa LANSARE, Faza F (27 august 2026) — "Fluxul de subscrieri este
// preluat automat, dar este supus aprobării finale din partea superadminului
// sau a unui admin cu permisiuni dedicate." Rândurile scrise de
// api/public/investitori-subscrie.js pornesc mereu cu status='in_asteptare'
// — acest endpoint e singurul care le poate aproba/respinge.
//
// POST { id, actiune: 'aproba'|'respinge' } → { ok, portofoliu }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

const STATUS_VALID = { aproba: 'aprobat', respinge: 'respins' };

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id, actiune } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu.' });
  const statusNou = STATUS_VALID[actiune];
  if (!statusNou) return res.status(400).json({ error: `actiune trebuie să fie una din: ${Object.keys(STATUS_VALID).join(', ')}` });

  try {
    const { data, error } = await supabaseAdmin
      .from('investitori_portofoliu')
      .update({ status: statusNou })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Subscriere inexistentă.' });

    await inregistreazaAudit({
      admin: user,
      actiune: `investitori_${actiune}`,
      entitate: 'investitori_portofoliu',
      entitate_id: id,
      detalii: { status_nou: statusNou, email: data.email },
      req,
    });

    return res.status(200).json({ ok: true, portofoliu: data });
  } catch (err) {
    console.error('[investitori-aprobare]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut actualiza subscrierea.' });
  }
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
