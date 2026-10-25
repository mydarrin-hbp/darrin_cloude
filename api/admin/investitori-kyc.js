// /api/admin/investitori-kyc.js
// Verificarea manuală a identității investitorilor (pasul 11-L, 17 oct. 2026),
// pentru panoul „Investitori Admin” din superadmin.
//
// Acces: superadmin, sau admin cu rând în admin_permissions pe secțiunea
// `investitori` (documentele de identitate sunt date sensibile). Fail-closed.
// Decizia (POST) cere și poate_scrie = true (pasul 11-N2); lista și
// documentele rămân la citire.
//
// GET                 → { ok, cereri: [...], subscrieri: [...], poate_scrie }
//                       cererile trimise (în verificare / aprobate / respinse) și
//                       subscrierile, fiecare cu starea KYC a contului;
// GET ?document=<cale> → { ok, url }  adresă semnată de 2 minute (auditată);
// GET ?identitate=<user_id> → { ok, id_fiscal_tip, id_fiscal, act_serie_numar }
//                       acțiunea `date_identitate` (pasul 11-P2a): CNP-ul / NIF-ul
//                       și seria-numărul actului, decriptate, pentru cine are
//                       drept de citire pe Investitori. Fiecare acces se scrie
//                       în audit_log (investitor_identitate_vazuta); fără rândul
//                       de audit, datele nu se trimit. În listă, doar mascate;
// POST { user_id, actiune: 'aproba'|'respinge', motiv_ro?, motiv_en? }
//                     → { ok, kyc, email_trimis }
//   Respingerea cere motivul în română și în engleză. Decizia se auditează
//   (audit_log), iar utilizatorul primește email în limba contului
//   (lib/i18n.js, renderEmailKycDecizie) și vede starea nouă în dashboard.

const { requireAuth } = require('../../lib/auth-middleware');
const { trimiteEroare, camp, formaComuna } = require('../../lib/raspuns-eroare');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { renderEmailKycDecizie, limbaProfilEmailComportamental } = require('../../lib/i18n');
const { incarcaContactPlatformaSigur } = require('../../lib/contact-platforma');
const K = require('../../lib/investitori-kyc');
const { mascheaza } = require('../../lib/identitate-pf');
const { nivelInvestitori, refuzaFaraDrept, refuzaFaraScriere } = require('../../lib/permisiuni-investitori');

const STARI_TRIMISE = ['in_verificare', 'aprobat', 'respins'];
const DURATA_URL_SECUNDE = 120;

async function emailuriProfile(ids) {
  if (!ids.length) return {};
  const { data } = await supabaseAdmin.from('profiles').select('id, email, tara, limba').in('id', ids);
  const harta = {};
  (data || []).forEach((p) => { harta[p.id] = p; });
  return harta;
}

function cerere(kyc, profil) {
  const d = kyc.date_personale || {};
  return {
    user_id: kyc.user_id,
    email: (profil && profil.email) || null,
    nume: [d.prenume, d.nume].filter(Boolean).join(' ') || null,
    telefon: d.telefon || null,
    tara: d.tara || null,
    iban_mascat: kyc.iban_ultimele4 ? '•••• ' + kyc.iban_ultimele4 : null,
    tip_document: kyc.tip_document || null,
    document_fata_path: kyc.document_fata_path || null,
    document_verso_path: kyc.document_verso_path || null,
    rezidenta_fiscala_tara: kyc.rezidenta_fiscala_tara || null,
    data_nasterii: kyc.data_nasterii || null,
    cetatenie: kyc.cetatenie || null,
    adresa_domiciliu: kyc.adresa_domiciliu || null,
    id_fiscal_tip: kyc.id_fiscal_tip || null,
    id_fiscal_mascat: mascheaza(kyc.id_fiscal_ultimele3),
    act_serie_numar_mascat: mascheaza(kyc.act_ultimele3),
    act_valabil_pana: kyc.act_valabil_pana || null,
    mifid_raspunsuri: kyc.mifid_raspunsuri || null,
    pep: K.estePep(kyc),
    pep_functie: (kyc.pep_declaratie && kyc.pep_declaratie.functie) || null,
    sanctiuni_declarat: kyc.sanctiuni_declarat === true,
    status: kyc.status,
    trimis_la: kyc.submitted_at || null,
    verificat_la: kyc.reviewed_at || null,
    motiv_respingere_ro: kyc.motiv_respingere_ro || null,
    motiv_respingere_en: kyc.motiv_respingere_en || null,
  };
}

async function lista(res, poateScrie) {
  const { data: kycuri, error } = await supabaseAdmin.from('investitori_kyc').select('*').in('status', STARI_TRIMISE);
  if (error) throw error;
  const { data: subs, error: subErr } = await supabaseAdmin
    .from('investitori_portofoliu').select('*').order('created_at', { ascending: false }).limit(300);
  if (subErr) throw subErr;
  const ids = [...new Set((kycuri || []).map((k) => k.user_id).concat((subs || []).map((s) => s.user_id)).filter(Boolean))];
  const profile = await emailuriProfile(ids);
  // Starea KYC a oricărui cont cu subscriere, inclusiv ciorna (nu e în lista de mai sus).
  const { data: toateKyc } = ids.length ? await supabaseAdmin.from('investitori_kyc').select('user_id, status').in('user_id', ids) : { data: [] };
  const stareKyc = {};
  (toateKyc || []).forEach((k) => { stareKyc[k.user_id] = k.status; });

  const cereri = (kycuri || [])
    .map((k) => cerere(k, profile[k.user_id]))
    .sort((a, b) => String(b.trimis_la || '').localeCompare(String(a.trimis_la || '')));
  const subscrieri = (subs || []).map((s) => ({
    id: s.id, user_id: s.user_id || null, email: s.email || (profile[s.user_id] && profile[s.user_id].email) || null,
    actiuni: s.actiuni, valoare_investita: s.valoare_investita, instrument: s.instrument || null,
    status: s.status || null, creat_la: s.created_at || null,
    kyc_status: s.user_id ? (stareKyc[s.user_id] || null) : null,
  }));
  return res.status(200).json({ ok: true, cereri, subscrieri, poate_scrie: poateScrie });
}

async function document(req, res, user, cale) {
  if (typeof cale !== 'string' || !cale || cale.includes('..')) return res.status(400).json({ error: 'Cale invalidă.' });
  const userId = cale.split('/')[0];
  const kyc = await K.citesteKyc(userId);
  if (!kyc || (kyc.document_fata_path !== cale && kyc.document_verso_path !== cale)) {
    return res.status(404).json({ error: 'Documentul nu aparține niciunui dosar KYC.' });
  }
  const { data, error } = await supabaseAdmin.storage.from(K.BUCKET).createSignedUrl(cale, DURATA_URL_SECUNDE);
  if (error || !data) throw error || new Error('createSignedUrl fără date');
  await inregistreazaAudit({ admin: user, actiune: 'investitori_kyc_document_vazut', entitate: 'investitori_kyc', entitate_id: userId, detalii: { cale }, req });
  return res.status(200).json({ ok: true, url: data.signedUrl });
}

async function decripteaza(valoare) {
  if (!valoare) return null;
  const { data, error } = await supabaseAdmin.rpc('decripteaza_camp', { valoare_criptata: valoare });
  if (error) throw error;
  return data || null;
}

// Acțiunea date_identitate: auditul se scrie înainte ca datele să plece.
async function dateIdentitate(req, res, user, userId) {
  const kyc = await K.citesteKyc(userId);
  if (!kyc || (!kyc.id_fiscal_criptat && !kyc.act_serie_numar_criptat)) {
    return trimiteEroare(res, 404, 'NEGASIT', 'Dosarul nu are date de identitate salvate.', 'The file has no saved identity data.');
  }
  const idFiscal = await decripteaza(kyc.id_fiscal_criptat);
  const act = await decripteaza(kyc.act_serie_numar_criptat);
  await inregistreazaAudit({
    admin: user, actiune: 'investitor_identitate_vazuta', entitate: 'investitori_kyc', entitate_id: userId,
    detalii: { campuri: ['id_fiscal', 'act_serie_numar'] }, req, obligatoriu: true,
  });
  return res.status(200).json({ ok: true, id_fiscal_tip: kyc.id_fiscal_tip || null, id_fiscal: idFiscal, act_serie_numar: act });
}

async function trimiteEmail(userId, aprobat, motivRo, motivEn) {
  try {
    if (!process.env.RESEND_API_KEY) return false;
    const { data: profil } = await supabaseAdmin.from('profiles').select('email, tara, limba').eq('id', userId).maybeSingle();
    if (!profil || !profil.email) return false;
    const kyc = await K.citesteKyc(userId);
    const nume = (kyc && kyc.date_personale && kyc.date_personale.prenume) || null;
    await incarcaContactPlatformaSigur();
    const { subiect, html } = renderEmailKycDecizie(limbaProfilEmailComportamental(profil), { nume, aprobat, motiv_ro: motivRo, motiv_en: motivEn });
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'noreply@homebestpal.com', to: profil.email, subject: subiect, html }),
    });
    return r.ok;
  } catch (e) {
    console.error('[admin/investitori-kyc] email:', e);
    return false;
  }
}

async function decizie(req, res, user) {
  const { user_id, actiune, motiv_ro, motiv_en } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id obligatoriu.' });
  if (actiune !== 'aproba' && actiune !== 'respinge') return res.status(400).json({ error: 'actiune: aproba | respinge.' });
  const mRo = K.text(motiv_ro, 500);
  const mEn = K.text(motiv_en, 500);
  if (actiune === 'respinge' && (!mRo || !mEn)) {
    const campuri = [];
    if (!mRo) campuri.push(camp('motiv_ro', 'Completați «Motiv (română)».', 'Please fill in «Reason (Romanian)».'));
    if (!mEn) campuri.push(camp('motiv_en', 'Completați «Motiv (engleză)».', 'Please fill in «Reason (English)».'));
    return trimiteEroare(res, 400, 'DATE_INVALIDE', 'Scrie motivul respingerii în română și în engleză.', 'Write the rejection reason in Romanian and in English.', campuri);
  }

  const kyc = await K.citesteKyc(user_id);
  if (!kyc) return res.status(404).json({ error: 'Dosar KYC inexistent.' });
  if (kyc.status !== 'in_verificare') return res.status(409).json({ error: 'Doar un dosar în verificare primește o decizie.', status: kyc.status });

  const aprobat = actiune === 'aproba';
  const { data, error } = await supabaseAdmin.from('investitori_kyc').update({
    status: aprobat ? 'aprobat' : 'respins',
    reviewed_at: new Date().toISOString(),
    reviewed_by: user.id,
    motiv_respingere_ro: aprobat ? null : mRo,
    motiv_respingere_en: aprobat ? null : mEn,
    updated_at: new Date().toISOString(),
  }).eq('user_id', user_id).select('*').single();
  if (error) throw error;

  await inregistreazaAudit({
    admin: user, actiune: aprobat ? 'investitori_kyc_aprobat' : 'investitori_kyc_respins',
    entitate: 'investitori_kyc', entitate_id: user_id,
    detalii: aprobat ? null : { motiv_ro: mRo, motiv_en: mEn }, req,
  });
  const emailTrimis = await trimiteEmail(user_id, aprobat, mRo, mEn);
  return res.status(200).json({ ok: true, kyc: cerere(data, null), email_trimis: emailTrimis });
}

async function handler(req, res, user) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    // Dreptul pe secțiunea Investitori: lib/permisiuni-investitori.js (comun cu rundele).
    const nivel = await nivelInvestitori(user);
    if (!nivel) return refuzaFaraDrept(res);
    if (req.method === 'GET') {
      const cale = req.query && req.query.document;
      const identitate = req.query && req.query.identitate;
      // await: o eroare (decriptare, audit) ajunge în catch-ul de mai jos → 500
      if (identitate) return await dateIdentitate(req, res, user, String(identitate));
      return cale ? document(req, res, user, String(cale)) : lista(res, nivel === 'scriere');
    }
    if (req.method === 'POST') {
      if (nivel !== 'scriere') return refuzaFaraScriere(res);
      return decizie(req, res, user);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[admin/investitori-kyc]', err);
    return res.status(500).json({ error: err.message || 'Eroare internă.' });
  }
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
