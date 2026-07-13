// lib/audit-log.js
// Etapa 4 (audit 2026-07-12) — jurnal de audit pentru acțiunile de
// editare/aprobare din backoffice. Best-effort intenționat: dacă
// înregistrarea eșuează, NU blocăm acțiunea reală a adminului (mult mai rău
// să respingem o aprobare validă din cauza unei erori de logging decât să
// pierdem o singură linie din jurnal) — dar eroarea tot ajunge în Vercel
// Function Logs, ca să fie vizibilă.

const { supabaseAdmin } = require('./supabaseAdmin');

function getClientIp(req) {
  const fwd = req?.headers?.['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req?.socket?.remoteAddress || null;
}

async function inregistreazaAudit({ admin, actiune, entitate, entitate_id, detalii, req }) {
  try {
    await supabaseAdmin.from('audit_log').insert({
      admin_id: admin?.id || null,
      admin_email: admin?.email || null,
      actiune,
      entitate: entitate || null,
      entitate_id: entitate_id != null ? String(entitate_id) : null,
      detalii: detalii || null,
      ip: getClientIp(req),
    });
  } catch (err) {
    console.error('[audit-log] eroare la înregistrare (best-effort, acțiunea nu e blocată):', err);
  }
}

module.exports = { inregistreazaAudit };
