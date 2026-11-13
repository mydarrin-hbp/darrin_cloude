// /api/partener/contract-confirma-otp.js
// G9 — verifică codul trimis prin contract-trimite-otp.js și, dacă e
// valid, marchează contractul ca semnat electronic (partners.contract_semnat).
// Body: { cod }

const crypto = require('crypto');
const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { genereazaContractPartener, sha256 } = require('../../lib/contract-partener-date');
const { CONTRACT_VERSIUNE } = require('../../lib/contract-partener');
const v = require('../../lib/valideaza');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  cod: v.text({ max: 10, eticheta: ['Cod', 'Code'] }),
};

const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];
const MAX_INCERCARI = 5;

function hashCod(cod) {
  return crypto.createHash('sha256').update(cod).digest('hex');
}
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora' })) return;
  const { cod } = req.body || {};
  if (!cod || !/^\d{6}$/.test(String(cod))) {
    return trimiteEroare(res, 400, 'COD_INVALID', 'Cod invalid — introdu cele 6 cifre primite pe email.', 'Invalid code: enter the 6 digits you received by email.', ['cod']);
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
    return trimiteEroare(res, 404, 'FARA_COD_ACTIV', 'Nu există niciun cod activ — cere unul nou.', 'There is no active code. Ask for a new one.');
  }
  if (new Date(otpRow.expira_la) < new Date()) {
    return trimiteEroare(res, 410, 'COD_EXPIRAT', 'Codul a expirat — cere unul nou.', 'The code has expired. Ask for a new one.');
  }
  if (otpRow.incercari >= MAX_INCERCARI) {
    return trimiteEroare(res, 429, 'PREA_MULTE_INCERCARI', 'Prea multe încercări greșite — cere un cod nou.', 'Too many wrong attempts. Ask for a new code.');
  }

  if (hashCod(String(cod)) !== otpRow.cod_hash) {
    await supabaseAdmin.from('partner_contract_otp').update({ incercari: otpRow.incercari + 1 }).eq('id', otpRow.id);
    return trimiteEroare(res, 400, 'COD_INCORECT', 'Cod incorect.', 'Incorrect code.', ['cod']);
  }

  // Instantaneul contractului exact cum l-a văzut și acceptat partenerul (portofoliu, CAEN, procente).
  const semnatLa = new Date().toISOString();
  const contract = await genereazaContractPartener(user.id, { semnatLa });
  if (!contract) return trimiteEroare(res, 500, 'EROARE_SERVER', 'Codul a fost validat, dar nu am putut genera contractul. Încearcă din nou.', 'The code was validated, but we could not generate the contract. Please try again.');
  const { error: snapErr } = await supabaseAdmin.from('partner_contracte_semnate').upsert({
    partner_id: user.id, versiune: contract.versiune, numar: contract.numar, html: contract.html,
    sha256: sha256(contract.html), semnat_la: semnatLa, ip: getClientIp(req),
  }, { onConflict: 'partner_id,versiune' });
  if (snapErr) {
    console.error('[contract-confirma-otp] snapshot', snapErr);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Codul a fost validat, dar nu am putut păstra contractul. Încearcă din nou.', 'The code was validated, but we could not store the contract. Please try again.');
  }

  const { error: updErr } = await supabaseAdmin
    .from('partners')
    .update({
      contract_semnat: true,
      contract_semnat_la: semnatLa,
      contract_versiune: CONTRACT_VERSIUNE,
      contract_ip: getClientIp(req),
    })
    .eq('id', user.id);
  if (updErr) {
    console.error('[contract-confirma-otp] update partners', updErr);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Codul a fost validat, dar nu am putut înregistra semnătura. Încearcă din nou.', 'The code was validated, but we could not record the signature. Please try again.');
  }

  // Codul se consumă doar după ce instantaneul și semnătura sunt salvate, ca un eșec să poată fi reîncercat cu același cod.
  await supabaseAdmin.from('partner_contract_otp').update({ folosit: true }).eq('id', otpRow.id);

  await inregistreazaAudit({
    admin: user, req, actiune: 'partener_semneaza_contract', entitate: 'partners', entitate_id: user.id,
    detalii: { versiune: CONTRACT_VERSIUNE, numar: contract.numar },
  });

  // Pasul 11-R3: activarea s-a încheiat — ciorna ei nu mai e necesară (fără tabel: nimic de șters).
  try { await supabaseAdmin.from('partener_activare_ciorna').delete().eq('user_id', user.id); } catch (e) { /* fără ciornă */ }

  return res.status(200).json({ ok: true, contract_semnat_la: semnatLa });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);
