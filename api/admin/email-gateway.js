// /api/admin/email-gateway.js
// „Noreply & Transactional Gateway Manager" (audit Secțiunea 39, 30 Iulie
// 2026) — monitorizare livrare email-uri noreply@ + configurare nume
// expeditor per limbă. Alimentat de email_events_log, populată de
// api/email/webhook-primire.js (evenimentele Resend de status livrare).
//
// GET  ?tip=email.bounced          → listă evenimente (opțional filtrate), + sumar pe tip
// POST { limba, nume_expeditor }   → salvează numele expeditorului pentru acea limbă (backoffice_config)

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { LIMBI_DISPONIBILE } = require('../../lib/i18n');

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    let query = supabaseAdmin.from('email_events_log').select('*').order('creat_la', { ascending: false }).limit(300);
    if (req.query.tip) query = query.eq('tip', req.query.tip);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const pragSumar = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: pentruSumar } = await supabaseAdmin
      .from('email_events_log')
      .select('tip')
      .gte('creat_la', pragSumar);
    const sumar = {};
    (pentruSumar || []).forEach((r) => { sumar[r.tip] = (sumar[r.tip] || 0) + 1; });

    const { data: numeExpeditor } = await supabaseAdmin
      .from('backoffice_config')
      .select('cheie, valoare')
      .eq('sectiune', 'email')
      .like('cheie', 'nume_expeditor_%');
    const numeExpeditorPerLimba = {};
    (numeExpeditor || []).forEach((r) => { numeExpeditorPerLimba[r.cheie.replace('nume_expeditor_', '')] = r.valoare; });

    return res.status(200).json({ ok: true, evenimente: data, sumar_30_zile: sumar, nume_expeditor: numeExpeditorPerLimba, limbi_disponibile: LIMBI_DISPONIBILE });
  }

  if (req.method === 'POST') {
    const { limba, nume_expeditor } = req.body || {};
    if (!limba || !LIMBI_DISPONIBILE.includes(limba) || !nume_expeditor) {
      return res.status(400).json({ error: `limba (${LIMBI_DISPONIBILE.join('|')}) și nume_expeditor sunt obligatorii` });
    }
    const { error } = await supabaseAdmin
      .from('backoffice_config')
      .upsert({ cheie: `nume_expeditor_${limba}`, valoare: nume_expeditor, sectiune: 'email', tara_cod: 'ALL', tip: 'text', eticheta: `Nume expeditor (${limba})` }, { onConflict: 'cheie' });
    if (error) return res.status(500).json({ error: error.message });
    await inregistreazaAudit({ admin, req, actiune: 'actualizare_nume_expeditor_email', entitate: 'backoffice_config', entitate_id: `nume_expeditor_${limba}`, detalii: { limba, nume_expeditor } });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
