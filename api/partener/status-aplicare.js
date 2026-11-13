// /api/partener/status-aplicare.js
// Tab "Status aplicare partener" (Etapa 2/2i, 26 august 2026) — reflectă
// starea REALĂ, verificată live: partners.status_verificare
// ('pending_review'|'approved'|'rejected', 3 valori, fără migrare — verificat
// direct în DB, niciun al 4-lea status nu există) + documente_partener
// pentru scenariul "documente suplimentare necesare" (derivat, nu un status
// separat: pending_review + cel puțin un document cu status='respins').
//
// Rolul "Darrin AI" (audit/pre-filtrare) rămâne poartă dezactivată implicit
// (backoffice_config, sectiune 'darrin_ai', cheie 'audit_aplicare_activ') —
// conform deciziei de secvențiere confirmate 25 august 2026 (modulul Darrin
// AI se implementează ultimul). Fără flag activ, endpoint-ul nu întoarce
// niciun raport — front-end-ul nu afișează secțiunea deloc (regula "fără
// teatru UI").
//
// GET → { status, documente_respinse, darrin_ai_activ, darrin_ai_raport }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare, trimiteEroareInterna } = require('../../lib/raspuns-eroare');

async function handler(req, res, user) {
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  try {
    const { data: partener, error: perr } = await supabaseAdmin
      .from('partners')
      .select('status_verificare, partner_type')
      .eq('id', user.id)
      .maybeSingle();
    if (perr) throw perr;
    if (!partener) return trimiteEroare(res, 404, 'PARTENER_NU_EXISTA', 'Contul de partener nu a fost găsit', 'The partner account was not found.');

    let status = partener.status_verificare || 'pending_review';
    let documente_respinse = [];

    if (status === 'pending_review') {
      const { data: docRespinse, error: derr } = await supabaseAdmin
        .from('documente_partener')
        .select('tip_document, observatii')
        .eq('partener_id', user.id)
        .eq('status', 'respins');
      if (derr) throw derr;
      if (docRespinse && docRespinse.length) {
        status = 'documente_necesare';
        documente_respinse = docRespinse.map((d) => ({ tip_certificare: d.tip_document, observatii: d.observatii }));
      }
    }

    const { data: flagRand } = await supabaseAdmin
      .from('backoffice_config')
      .select('valoare')
      .eq('sectiune', 'darrin_ai')
      .eq('cheie', 'audit_aplicare_activ')
      .eq('tara_cod', 'ALL') // cheia e unică pe (cheie, tara_cod); fără filtru, maybeSingle eșuează la un rând pe țară
      .maybeSingle();
    const darrin_ai_activ = flagRand?.valoare === 'true';

    return res.status(200).json({
      ok: true,
      status,
      partner_type: partener.partner_type || null,
      documente_respinse,
      darrin_ai_activ,
      darrin_ai_raport: null, // pregătit pentru integrarea ulterioară, neconstruit încă
    });
  } catch (err) {
    console.error('[status-aplicare]', err);
    return trimiteEroareInterna(res, 500, 'EROARE_SERVER', 'Nu am putut încărca statusul aplicării', 'We could not load the application status.', err);
  }
}

module.exports = requireAuth([], handler);
