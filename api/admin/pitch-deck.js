// /api/admin/pitch-deck.js
// Pitch deck-ul din back-office (pasul 11-K, 22 oct. 2026; decizia LM C3):
// versiuni pe limbă (RO / EN), ciorne, aprobare, note de verificare, media.
//
// Acces (lib/permisiuni-investitori.js, pasul 11-N2): citirea (lista,
// versiunea, previzualizarea) — superadmin sau admin cu rând pe secțiunea
// `investitori`; scrierea — superadmin sau admin cu poate_scrie = true.
// Vizibilitatea publică (backoffice_config.pitch_deck_vizibilitate) o schimbă
// doar superadminul. Fiecare acțiune se auditează. Erorile au forma comună
// (lib/raspuns-eroare.js), RO + EN, cu câmpul greșit.
//
// GET                                        → { ok, versiuni, poate_scrie, este_superadmin, vizibilitate }
//                                              fiecare versiune neaprobată are `lipsuri` (pasul 11-K4):
//                                              [{ slide, tip: 'continut' | 'nota' | 'sursa' | 'eticheta', text, camp, nota? }]
//                                              — aceeași funcție (lib/pitch-deck.js, lipsuriAprobare) ca `aproba`
// GET ?id=                                   → { ok, versiune, blocaje, lipsuri }   (cu slide_uri și note_verificare)
// POST { actiune: 'importa', fisier }        → ciornă nouă din pitch-deck-v1-<limba>.json (aprobat = false)
// POST { actiune: 'salveaza', id, titlu, sursa, disclaimer, slide_uri, note_verificare }   doar ciornele
// POST { actiune: 'duplica', id }            → ciornă nouă, copie a versiunii
// POST { actiune: 'aproba', id }             → 409 NOTE_NEREZOLVATE dacă mai sunt note / surse lipsă
//                                              (cu `lipsuri`, ca la GET);
//                                              retrage aprobarea versiunii anterioare DIN ACEEAȘI LIMBĂ
// POST { actiune: 'retrage', id }            → retrage aprobarea
// POST { actiune: 'sterge', id }             → șterge o CIORNĂ (pasul 11-K4); versiunea aprobată
//                                              → 409 VERSIUNE_APROBATA (întâi „Retrage aprobarea”)
// POST { actiune: 'previzualizare', id }     → același conținut ca pagina publică (deck complet),
//                                              plus notele prezentatorului (pasul 11-K3)
// POST { actiune: 'prezentare', limba }      → versiunea APROBATĂ a limbii (ro → RO, altfel EN),
//                                              cu notele prezentatorului: vederea prezentatorului
//                                              de pe pagina publică (pasul 11-K3). 404 fără versiune aprobată.
// Previzualizarea și prezentarea cer doar dreptul de citire pe Investitori.
// POST { actiune: 'url_incarcare', tip, marime } → adresă semnată în bucket-ul pitch-deck-media
// POST { actiune: 'vizibilitate', valoare }  → doar superadmin: public / investitori_aprobati

const crypto = require('crypto');
const { requireAuth, hasRole } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { nivelInvestitori, refuzaFaraDrept, refuzaFaraScriere } = require('../../lib/permisiuni-investitori');
const { trimiteEroare, camp, formaComuna } = require('../../lib/raspuns-eroare');
const P = require('../../lib/pitch-deck');

function text(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }

function refuzMigrare(res) {
  return trimiteEroare(res, 409, 'MIGRARE_LIPSA',
    'Tabela pitch deck-ului nu are încă limbile: aplicați migrarea docs/migrations-propuse/2026-10-22_pitch_deck_limbi.sql.',
    'The pitch deck table does not have languages yet: apply the migration docs/migrations-propuse/2026-10-22_pitch_deck_limbi.sql.');
}
function refuzValidare(res, erori, extra) {
  return trimiteEroare(res, 400, 'CONTINUT_INVALID',
    `Conținutul are ${erori.length} ${erori.length === 1 ? 'problemă' : 'probleme'}; corectați câmpurile marcate.`,
    `The content has ${erori.length} ${erori.length === 1 ? 'problem' : 'problems'}; correct the marked fields.`,
    erori.slice(0, 50).map((e) => camp(e.camp, e.ro, e.en)), extra);
}
function refuzLipsa(res) {
  return trimiteEroare(res, 404, 'VERSIUNE_LIPSA', 'Versiunea nu există.', 'The version does not exist.');
}

async function citeste(id) {
  if (typeof id !== 'string' || !id) return { v: null };
  const { data, error } = await supabaseAdmin.from('pitch_deck_versiuni').select(P.COLOANE).eq('id', id).maybeSingle();
  if (error) return { error };
  return { v: data || null };
}

// Emailurile autorilor, pentru listă.
async function emailuri(ids) {
  const unice = [...new Set(ids.filter(Boolean))];
  if (!unice.length) return {};
  const { data } = await supabaseAdmin.from('profiles').select('id, email').in('id', unice);
  return Object.fromEntries((data || []).map((p) => [p.id, p.email]));
}

function rezumatVersiune(v, mail) {
  const note = Array.isArray(v.note_verificare) ? v.note_verificare : [];
  return {
    id: v.id, limba: v.limba, titlu: v.titlu, sursa: v.sursa, aprobat: v.aprobat === true, aprobat_la: v.aprobat_la,
    aprobat_de: mail[v.aprobat_de] || null, creat_de: mail[v.creat_de] || null, creat_la: v.creat_la,
    actualizat_de: mail[v.actualizat_de] || null, actualizat_la: v.actualizat_la,
    slideuri: Array.isArray(v.slide_uri) ? v.slide_uri.length : 0,
    note_total: note.length, note_nerezolvate: note.filter((n) => n && n.rezolvat !== true).length,
    blocaje: P.blocajeAprobare(v).length,
    // Pasul 11-K4: ce mai lipsește pentru aprobare (aceeași funcție ca `aproba`).
    lipsuri: v.aprobat === true ? [] : P.lipsuriAprobare(v),
  };
}

async function lista(res, poateScrie, esteSuper) {
  const { data, error } = await supabaseAdmin.from('pitch_deck_versiuni').select(P.COLOANE).order('creat_la', { ascending: false }).limit(100);
  const vizibilitate = await P.citesteVizibilitate();
  if (error) {
    if (P.migrareLipsa(error)) return res.status(200).json({ ok: true, versiuni: [], migrare_lipsa: true, poate_scrie: poateScrie, este_superadmin: esteSuper, vizibilitate });
    throw error;
  }
  const mail = await emailuri((data || []).flatMap((v) => [v.creat_de, v.aprobat_de, v.actualizat_de]));
  return res.status(200).json({ ok: true, versiuni: (data || []).map((v) => rezumatVersiune(v, mail)), poate_scrie: poateScrie, este_superadmin: esteSuper, vizibilitate });
}

// Importul unui fișier pitch-deck-<versiune>-<limba>.json (meta + slide_uri);
// titlul ciornei vine din meta.versiune („Pitch deck v1.1 · RO”).
async function importa(req, res, admin) {
  const f = req.body && req.body.fisier;
  const meta = f && typeof f === 'object' && f.meta && typeof f.meta === 'object' ? f.meta : null;
  if (!meta || !Array.isArray(f.slide_uri)) {
    return trimiteEroare(res, 400, 'FISIER_INVALID', 'Fișierul nu are structura pitch deck-ului (meta și slide_uri).', 'The file does not have the pitch deck structure (meta and slide_uri).', [camp('fisier', 'Alegeți un fișier pitch-deck-<versiune>-ro.json sau -en.json (ex. pitch-deck-v1.1-ro.json).', 'Choose a pitch-deck-<version>-ro.json or -en.json file (e.g. pitch-deck-v1.1-en.json).')]);
  }
  if (!P.LIMBI_DECK.includes(meta.limba)) {
    return trimiteEroare(res, 400, 'LIMBA_INVALIDA', 'Fișierul nu spune limba (meta.limba trebuie să fie „ro” sau „en”).', 'The file does not state its language (meta.limba must be “ro” or “en”).', [camp('fisier', 'meta.limba: „ro” sau „en”.', 'meta.limba: “ro” or “en”.')]);
  }
  const { slide_uri, note } = P.extrageNote(f.slide_uri);
  const erori = P.valideaza(slide_uri);
  if (erori.length) return refuzValidare(res, erori);
  const rand = {
    limba: meta.limba,
    titlu: text(`Pitch deck ${text(meta.versiune, 20)} · ${meta.limba.toUpperCase()}`.replace(/\s+/g, ' '), 120),
    sursa: text(meta.sursa, 300) || null,
    disclaimer: text(meta.disclaimer, 300) || null,
    slide_uri, note_verificare: note, aprobat: false,
    creat_de: admin.id, actualizat_de: admin.id, actualizat_la: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin.from('pitch_deck_versiuni').insert(rand).select(P.COLOANE).single();
  if (error) { if (P.migrareLipsa(error)) return refuzMigrare(res); throw error; }
  await inregistreazaAudit({ admin, req, actiune: 'pitch_deck_importat', entitate: 'pitch_deck_versiuni', entitate_id: data.id, detalii: { limba: data.limba, slideuri: slide_uri.length, note: note.length, sursa: rand.sursa } });
  return res.status(200).json({ ok: true, versiune: data });
}

async function salveaza(req, res, admin) {
  const b = req.body || {};
  const { v, error } = await citeste(b.id);
  if (error) { if (P.migrareLipsa(error)) return refuzMigrare(res); throw error; }
  if (!v) return refuzLipsa(res);
  if (v.aprobat) {
    return trimiteEroare(res, 409, 'VERSIUNE_APROBATA', 'Versiunea aprobată nu se modifică: duplicați-o ca ciornă nouă și editați ciorna.', 'The approved version cannot be changed: duplicate it as a new draft and edit the draft.');
  }
  const slide_uri = Array.isArray(b.slide_uri) ? b.slide_uri.map((s) => { if (!s || typeof s !== 'object') return s; const { de_verificat: _x, ...rest } = s; return rest; }) : b.slide_uri;
  const erori = P.valideaza(slide_uri);
  const titlu = text(b.titlu, 120);
  if (!titlu) erori.unshift({ camp: 'titlu', ro: 'Completați titlul versiunii.', en: 'Fill in the version title.' });
  if (erori.length) return refuzValidare(res, erori);
  const modificari = {
    titlu, sursa: text(b.sursa, 300) || null, disclaimer: text(b.disclaimer, 300) || null,
    slide_uri, note_verificare: P.combinaNote(v.note_verificare, b.note_verificare),
    actualizat_de: admin.id, actualizat_la: new Date().toISOString(),
  };
  const { data, error: e2 } = await supabaseAdmin.from('pitch_deck_versiuni').update(modificari).eq('id', v.id).eq('aprobat', false).select(P.COLOANE).single();
  if (e2 || !data) { if (e2 && P.migrareLipsa(e2)) return refuzMigrare(res); if (e2) throw e2; return refuzLipsa(res); }
  await inregistreazaAudit({ admin, req, actiune: 'pitch_deck_ciorna_salvata', entitate: 'pitch_deck_versiuni', entitate_id: v.id, detalii: { limba: v.limba, note_nerezolvate: modificari.note_verificare.filter((n) => !n.rezolvat).length } });
  return res.status(200).json({ ok: true, versiune: data });
}

async function duplica(req, res, admin) {
  const { v, error } = await citeste(req.body && req.body.id);
  if (error) { if (P.migrareLipsa(error)) return refuzMigrare(res); throw error; }
  if (!v) return refuzLipsa(res);
  const rand = {
    limba: v.limba, titlu: text(`${v.titlu || 'Pitch deck'} (copie)`, 120), sursa: v.sursa, disclaimer: v.disclaimer,
    slide_uri: v.slide_uri, note_verificare: v.note_verificare || [], aprobat: false,
    creat_de: admin.id, actualizat_de: admin.id, actualizat_la: new Date().toISOString(),
  };
  const { data, error: e2 } = await supabaseAdmin.from('pitch_deck_versiuni').insert(rand).select(P.COLOANE).single();
  if (e2) throw e2;
  await inregistreazaAudit({ admin, req, actiune: 'pitch_deck_duplicat', entitate: 'pitch_deck_versiuni', entitate_id: data.id, detalii: { din: v.id, limba: v.limba } });
  return res.status(200).json({ ok: true, versiune: data });
}

async function aproba(req, res, admin) {
  const { v, error } = await citeste(req.body && req.body.id);
  if (error) { if (P.migrareLipsa(error)) return refuzMigrare(res); throw error; }
  if (!v) return refuzLipsa(res);
  if (v.aprobat) return res.status(200).json({ ok: true, versiune: v, retrase: [] });
  // Pasul 11-K4: refuzurile trimit și `lipsuri` (aceeași listă ca răspunsul GET),
  // ca back-office-ul să arate lista „Ce mai lipsește”, nu un bloc de text.
  const lipsuri = P.lipsuriAprobare(v);
  const erori = P.valideaza(v.slide_uri);
  if (erori.length) return refuzValidare(res, erori, { lipsuri });
  const blocaje = P.blocajeAprobare(v);
  if (blocaje.length) {
    return trimiteEroare(res, 409, 'NOTE_NEREZOLVATE', 'Rezolvați notele de verificare înainte de aprobare.', 'Resolve the verification notes before approval.',
      blocaje.map((x) => camp(x.camp, x.ro, x.en)), { lipsuri });
  }
  // Doar versiunea aprobată din ACEEAȘI limbă își pierde aprobarea (indexul unic
  // parțial din migrare: cel mult una aprobată pe limbă).
  const { data: retrase, error: e1 } = await supabaseAdmin.from('pitch_deck_versiuni').update({ aprobat: false })
    .eq('limba', v.limba).eq('aprobat', true).select('id');
  if (e1) throw e1;
  const acum = new Date().toISOString();
  const { data, error: e2 } = await supabaseAdmin.from('pitch_deck_versiuni')
    .update({ aprobat: true, aprobat_de: admin.id, aprobat_la: acum }).eq('id', v.id).select(P.COLOANE).single();
  if (e2 || !data) { if (e2) throw e2; return refuzLipsa(res); }
  const ids = (retrase || []).map((x) => x.id).filter((id) => id !== v.id);
  await inregistreazaAudit({ admin, req, actiune: 'pitch_deck_aprobat', entitate: 'pitch_deck_versiuni', entitate_id: v.id, detalii: { limba: v.limba, retrase: ids } });
  return res.status(200).json({ ok: true, versiune: data, retrase: ids });
}

async function retrage(req, res, admin) {
  const { v, error } = await citeste(req.body && req.body.id);
  if (error) { if (P.migrareLipsa(error)) return refuzMigrare(res); throw error; }
  if (!v) return refuzLipsa(res);
  const { data, error: e2 } = await supabaseAdmin.from('pitch_deck_versiuni').update({ aprobat: false }).eq('id', v.id).select(P.COLOANE).single();
  if (e2) throw e2;
  await inregistreazaAudit({ admin, req, actiune: 'pitch_deck_aprobare_retrasa', entitate: 'pitch_deck_versiuni', entitate_id: v.id, detalii: { limba: v.limba } });
  return res.status(200).json({ ok: true, versiune: data });
}

// Pasul 11-K4: ștergerea unei ciorne (ex. importul făcut de două ori). Versiunea
// aprobată nu se șterge; condiția `aprobat = false` e și în cererea de ștergere,
// iar recitirea de după prinde o aprobare făcută între timp.
function refuzAprobata(res) {
  return trimiteEroare(res, 409, 'VERSIUNE_APROBATA', 'Versiunea aprobată nu se șterge: retrageți întâi aprobarea („Retrage aprobarea”).', 'The approved version cannot be deleted: first withdraw the approval (“Withdraw approval”).');
}
async function sterge(req, res, admin) {
  const { v, error } = await citeste(req.body && req.body.id);
  if (error) { if (P.migrareLipsa(error)) return refuzMigrare(res); throw error; }
  if (!v) return refuzLipsa(res);
  if (v.aprobat) return refuzAprobata(res);
  const { error: e2 } = await supabaseAdmin.from('pitch_deck_versiuni').delete().eq('id', v.id).eq('aprobat', false);
  if (e2) throw e2;
  const { v: ramas, error: e3 } = await citeste(v.id);
  if (e3) throw e3;
  if (ramas) return refuzAprobata(res);
  await inregistreazaAudit({ admin, req, actiune: 'pitch_deck_ciorna_stearsa', entitate: 'pitch_deck_versiuni', entitate_id: v.id, detalii: { titlu: v.titlu, limba: v.limba, slideuri: Array.isArray(v.slide_uri) ? v.slide_uri.length : 0 } });
  return res.status(200).json({ ok: true, sters: v.id });
}

async function urlIncarcare(req, res, admin) {
  const tip = req.body && req.body.tip;
  const marime = Number(req.body && req.body.marime);
  const ext = P.TIPURI_IMAGINE[tip];
  if (!ext) return trimiteEroare(res, 400, 'TIP_FISIER', 'Imaginea trebuie să fie WebP, PNG sau JPG.', 'The image must be WebP, PNG or JPG.', [camp('imagine', 'Alegeți un fișier WebP, PNG sau JPG.', 'Choose a WebP, PNG or JPG file.')]);
  if (!(marime > 0) || marime > P.MARIME_MAXIMA) return trimiteEroare(res, 400, 'FISIER_PREA_MARE', 'Imaginea are cel mult 5 MB.', 'The image is at most 5 MB.', [camp('imagine', 'Alegeți o imagine de cel mult 5 MB.', 'Choose an image of at most 5 MB.')]);
  const cale = `v/${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const { data, error } = await supabaseAdmin.storage.from(P.BUCKET_MEDIA).createSignedUploadUrl(cale);
  if (error || !data) {
    console.error('[admin/pitch-deck url_incarcare]', error);
    return trimiteEroare(res, 503, 'BUCKET_INDISPONIBIL', 'Nu am putut pregăti încărcarea. Verificați că bucket-ul pitch-deck-media există (migrarea 2026-10-22).', 'We could not prepare the upload. Check that the pitch-deck-media bucket exists (the 2026-10-22 migration).');
  }
  const baza = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  await inregistreazaAudit({ admin, req, actiune: 'pitch_deck_imagine_incarcare', entitate: 'storage', entitate_id: `${P.BUCKET_MEDIA}/${cale}`, detalii: { tip, marime } });
  return res.status(200).json({ ok: true, bucket: P.BUCKET_MEDIA, cale: data.path || cale, token: data.token, url_semnat: data.signedUrl, url_public: `${baza}/storage/v1/object/public/${P.BUCKET_MEDIA}/${cale}` });
}

async function vizibilitate(req, res, admin) {
  if (!(await hasRole(admin, ['superadmin']))) {
    return trimiteEroare(res, 403, 'DOAR_SUPERADMIN', 'Vizibilitatea pitch deck-ului o schimbă doar superadminul.', 'Only the superadmin can change the pitch deck visibility.');
  }
  const valoare = req.body && req.body.valoare;
  if (!P.VIZIBILITATI.includes(valoare)) return trimiteEroare(res, 400, 'VALOARE_INVALIDA', 'Alegeți „public” sau „investitori_aprobati”.', 'Choose “public” or “investitori_aprobati”.', [camp('vizibilitate', 'Alegeți una dintre cele două variante.', 'Choose one of the two options.')]);
  const { data, error } = await supabaseAdmin.from('backoffice_config').update({ valoare, updated_by: admin.id, updated_at: new Date().toISOString() })
    .eq('cheie', 'pitch_deck_vizibilitate').eq('tara_cod', 'ALL').select('valoare');
  if (error) throw error;
  if (!data || !data.length) return refuzMigrare(res);
  await inregistreazaAudit({ admin, req, actiune: 'pitch_deck_vizibilitate', entitate: 'backoffice_config', entitate_id: 'pitch_deck_vizibilitate', detalii: { valoare } });
  return res.status(200).json({ ok: true, vizibilitate: valoare });
}

async function handler(req, res, admin) {
  res.setHeader('Cache-Control', 'private, no-store');
  const nivel = await nivelInvestitori(admin);
  if (!nivel) return refuzaFaraDrept(res);
  const poateScrie = nivel === 'scriere';

  try {
    if (req.method === 'GET') {
      const id = req.query && req.query.id;
      if (id) {
        const { v, error } = await citeste(id);
        if (error) { if (P.migrareLipsa(error)) return refuzMigrare(res); throw error; }
        if (!v) return refuzLipsa(res);
        return res.status(200).json({ ok: true, versiune: v, blocaje: P.blocajeAprobare(v), lipsuri: v.aprobat === true ? [] : P.lipsuriAprobare(v), poate_scrie: poateScrie });
      }
      return lista(res, poateScrie, await hasRole(admin, ['superadmin']));
    }
    if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA', 'Metodă nepermisă.', 'Method not allowed.');

    const actiune = req.body && req.body.actiune;
    if (actiune === 'previzualizare') {
      const { v, error } = await citeste(req.body.id);
      if (error) { if (P.migrareLipsa(error)) return refuzMigrare(res); throw error; }
      if (!v) return refuzLipsa(res);
      return res.status(200).json({ ok: true, ...(await P.construiestePayload(v, { note: true })) });
    }
    if (actiune === 'prezentare') {
      const v = await P.versiuneAprobata(P.limbaDeck(req.body.limba));
      if (!v) return refuzLipsa(res);
      return res.status(200).json({ ok: true, ...(await P.construiestePayload(v, { note: true })) });
    }

    const scrieri = { importa, salveaza, duplica, aproba, retrage, sterge, url_incarcare: urlIncarcare, vizibilitate };
    if (!scrieri[actiune]) {
      return trimiteEroare(res, 400, 'ACTIUNE_INVALIDA', 'Acțiune necunoscută.', 'Unknown action.');
    }
    if (!poateScrie) return refuzaFaraScriere(res);
    return await scrieri[actiune](req, res, admin);
  } catch (err) {
    console.error('[admin/pitch-deck]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut finaliza operația. Încercați din nou.', 'We could not complete the operation. Please try again.');
  }
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
