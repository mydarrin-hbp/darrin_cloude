// /api/admin/investitori-aprobare.js
// Etapa LANSARE, Faza F (27 august 2026) — "Fluxul de subscrieri este
// preluat automat, dar este supus aprobării finale din partea superadminului
// sau a unui admin cu permisiuni dedicate." Rândurile scrise de
// api/investitori/subscrie.js (înainte api/public/investitori-subscrie.js) pornesc mereu cu status='in_asteptare'
// — acest endpoint e singurul care le poate aproba/respinge.
//
// POST { id, actiune: 'aproba'|'respinge' } → { ok, portofoliu }
//
// Pasul 11-L (17 oct. 2026): subscrierile vin acum doar din conturi cu rolul
// investor (api/investitori/subscrie.js, cu user_id). Aprobarea cere un cont
// legat și verificarea identității aprobată (investitori_kyc.status =
// 'aprobat'); altfel 409, cu motivul. Respingerea rămâne posibilă oricând.
//
// Pasul 11-I1 (8 nov. 2026): decizia completează aprobat_la și aprobat_de (lock-up-ul
// pornește de la aprobare; la o respingere, e data afișată în istoric). O subscriere
// deja aprobată își păstrează data, ca un al doilea clic să nu prelungească lock-up-ul.
//
// Pasul 11-N2 (22 oct. 2026): acces doar cu drept de scriere pe secțiunea
// Investitori (lib/permisiuni-investitori.js): superadmin, sau admin cu rând
// pe `investitori` și poate_scrie = true. Înainte, orice admin putea aproba.

const { requireAuth } = require('../../lib/auth-middleware');
const { formaComuna, trimiteEroare, trimiteEroareInterna } = require('../../lib/raspuns-eroare');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { nivelInvestitori, refuzaFaraDrept, refuzaFaraScriere } = require('../../lib/permisiuni-investitori');

const STATUS_VALID = { aproba: 'aprobat', respinge: 'respins' };

async function handler(req, res, user) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  const nivel = await nivelInvestitori(user);
  if (!nivel) return refuzaFaraDrept(res);
  if (nivel !== 'scriere') return refuzaFaraScriere(res);

  const { id, actiune } = req.body || {};
  if (!id) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'id obligatoriu.', 'id is required.', ['id']);
  const statusNou = STATUS_VALID[actiune];
  if (!statusNou) return trimiteEroare(res, 400, 'ACTIUNE_NECUNOSCUTA', `actiune trebuie să fie una din: ${Object.keys(STATUS_VALID).join(', ')}`, `actiune must be one of: ${Object.keys(STATUS_VALID).join(', ')}`, ['actiune']);

  try {
    const decizie = { status: statusNou, aprobat_la: new Date().toISOString(), aprobat_de: user.id };
    if (statusNou === 'aprobat') {
      const { data: sub, error: subErr } = await supabaseAdmin
        .from('investitori_portofoliu').select('id, user_id, status, aprobat_la, aprobat_de').eq('id', id).maybeSingle();
      if (subErr) throw subErr;
      if (!sub) return trimiteEroare(res, 404, 'NU_EXISTA', 'Subscriere inexistentă.', 'The subscription does not exist.');
      if (!sub.user_id) {
        return trimiteEroare(res, 409, 'FARA_CONT', 'Subscrierea nu e legată de un cont de investitor; nu se poate aproba.', 'The subscription is not linked to an investor account, so it cannot be approved.');
      }
      const { data: kyc, error: kycErr } = await supabaseAdmin
        .from('investitori_kyc').select('status').eq('user_id', sub.user_id).maybeSingle();
      if (kycErr) throw kycErr;
      if (!kyc || kyc.status !== 'aprobat') {
        return trimiteEroare(res, 409, 'KYC_NEAPROBAT', 'Verificarea identității investitorului nu e aprobată; subscrierea nu se poate aproba încă.', 'The investor identity check is not approved; the subscription cannot be approved yet.', null, { kyc_status: (kyc && kyc.status) || null });
      }
      if (sub.status === 'aprobat' && sub.aprobat_la) {
        decizie.aprobat_la = sub.aprobat_la;
        decizie.aprobat_de = sub.aprobat_de;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('investitori_portofoliu')
      .update(decizie)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return trimiteEroare(res, 404, 'NU_EXISTA', 'Subscriere inexistentă.', 'The subscription does not exist.');

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
    return trimiteEroareInterna(res, 500, 'EROARE_SERVER', 'Nu am putut actualiza subscrierea.', 'We could not update the subscription.', err);
  }
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
