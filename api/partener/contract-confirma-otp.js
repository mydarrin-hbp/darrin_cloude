// /api/partener/contract-confirma-otp.js
// G9 — verifică codul trimis prin contract-trimite-otp.js și, dacă e
// valid, marchează contractul ca semnat electronic (partners.contract_semnat).
// Body: { cod }

const crypto = require('crypto');
const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');

const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];
const MAX_INCERCARI = 5;
const CONTRACT_VERSIUNE = 'v1-2026-07-25';

function hashCod(cod) {
  return crypto.createHash('sha256').update(cod).digest('hex');
}
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cod } = req.body || {};
  if (!cod || !/^\d{6}$/.test(String(cod))) {
    return res.status(400).json({ error: 'Cod invalid — introdu cele 6 cifre primite pe email.' });
  }

  const { data: otpRow } = await supabaseAdmin
    .from('partner_contract_otp')
    .select('id, cod_hash, expira_la, incercari, folosit')
    .eq('partner_id', user.id)
    .eq('folosit', false)
    .order('creat_la', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!otpRow) {
    return res.status(404).json({ error: 'Nu există niciun cod activ — cere unul nou.' });
  }
  if (new Date(otpRow.expira_la) < new Date()) {
    return res.status(410).json({ error: 'Codul a expirat — cere unul nou.' });
  }
  if (otpRow.incercari >= MAX_INCERCARI) {
    return res.status(429).json({ error: 'Prea multe încercări greșite — cere un cod nou.' });
  }

  if (hashCod(String(cod)) !== otpRow.cod_hash) {
    await supabaseAdmin.from('partner_contract_otp').update({ incercari: otpRow.incercari + 1 }).eq('id', otpRow.id);
    return res.status(400).json({ error: 'Cod incorect.' });
  }

  await supabaseAdmin.from('partner_contract_otp').update({ folosit: true }).eq('id', otpRow.id);

  const { error: updErr } = await supabaseAdmin
    .from('partners')
    .update({
      contract_semnat: true,
      contract_semnat_la: new Date().toISOString(),
      contract_versiune: CONTRACT_VERSIUNE,
      contract_ip: getClientIp(req),
    })
    .eq('id', user.id);
  if (updErr) {
    console.error('[contract-confirma-otp] update partners', updErr);
    return res.status(500).json({ error: 'Codul a fost validat, dar nu am putut înregistra semnătura. Încearcă din nou.' });
  }

  await inregistreazaAudit({
    admin: user, req, actiune: 'partener_semneaza_contract', entitate: 'partners', entitate_id: user.id,
    detalii: { versiune: CONTRACT_VERSIUNE },
  });

  return res.status(200).json({ ok: true, contract_semnat_la: new Date().toISOString() });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);
