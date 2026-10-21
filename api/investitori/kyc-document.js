// /api/investitori/kyc-document.js
// Documentele de identitate ale investitorului (pasul 11-L, 17 oct. 2026):
// se încarcă cu adevărat, privat, în bucket-ul `investitori-kyc` (fără acces
// public; migrarea docs/migrations-propuse/2026-10-17_investitori_kyc.sql).
// Fișierul nu trece prin acest endpoint (limita de corp a funcțiilor e sub
// 5 MB): serverul validează tipul și mărimea declarate și dă o adresă
// semnată de încărcare, pe calea „<user_id>/…”. Bucket-ul impune și el
// tipurile acceptate și limita de 5 MB, la încărcarea efectivă.
//
// POST   { latura: 'fata'|'verso', mime, marime } → { ok, path, token, signed_url }
// GET    ?path=<cale>                             → { ok, url }  (adresă semnată, 2 minute)
// DELETE ?path=<cale>                             → { ok }       (șterge fișierul și legătura din dosar)
//
// Doar proprietarul își vede sau șterge fișierele (calea începe cu user_id-ul
// lui); adminii le văd prin api/admin/investitori-kyc.js. Un dosar trimis
// (în verificare sau aprobat) nu își mai schimbă documentele.

const crypto = require('crypto');
const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const K = require('../../lib/investitori-kyc');

const DURATA_URL_SECUNDE = 120;

const E = {
  tip: ['Tip de fișier neacceptat. Folosește JPEG, PNG, WEBP sau PDF.', 'File type not accepted. Use JPEG, PNG, WEBP or PDF.'],
  marime: ['Fișierul e prea mare: cel mult 5 MB.', 'The file is too large: 5 MB at most.'],
  gol: ['Fișierul e gol.', 'The file is empty.'],
  latura: ['Latura documentului lipsește (față / verso).', 'The document side is missing (front / back).'],
  strain: ['Fișierul nu aparține contului tău.', 'The file does not belong to your account.'],
  blocat: ['Dosarul tău e trimis; documentele nu se mai pot schimba.', 'Your file has been submitted; the documents can no longer be changed.'],
  intern: ['Încărcarea nu a putut fi pregătită. Încearcă din nou.', 'The upload could not be prepared. Please try again.'],
};
function eroare(res, cod, cheie) {
  return res.status(cod).json({ error: E[cheie][0], error_en: E[cheie][1], cod: cheie });
}

async function handler(req, res, user) {
  res.setHeader('Cache-Control', 'private, no-store');
  const stocare = supabaseAdmin.storage.from(K.BUCKET);
  try {
    if (req.method === 'POST') {
      const { latura, mime, marime } = req.body || {};
      if (latura !== 'fata' && latura !== 'verso') return eroare(res, 400, 'latura');
      const ext = K.TIPURI_FISIER[mime];
      if (!ext) return eroare(res, 400, 'tip');
      const m = Number(marime);
      if (!(m > 0)) return eroare(res, 400, 'gol');
      if (m > K.MARIME_MAXIMA) return eroare(res, 400, 'marime');
      const kyc = await K.citesteKyc(user.id);
      if (kyc && kyc.status && !K.STARI_EDITABILE.includes(kyc.status)) return eroare(res, 409, 'blocat');

      const cale = `${user.id}/${latura}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
      const { data, error } = await stocare.createSignedUploadUrl(cale);
      if (error || !data) throw error || new Error('createSignedUploadUrl fără date');
      return res.status(200).json({ ok: true, path: data.path || cale, token: data.token, signed_url: data.signedUrl || null });
    }

    const cale = String((req.query && req.query.path) || '');
    if (!K.caleaApartine(cale, user.id)) return eroare(res, 403, 'strain');

    if (req.method === 'GET') {
      const { data, error } = await stocare.createSignedUrl(cale, DURATA_URL_SECUNDE);
      if (error || !data) throw error || new Error('createSignedUrl fără date');
      return res.status(200).json({ ok: true, url: data.signedUrl });
    }

    if (req.method === 'DELETE') {
      const kyc = await K.citesteKyc(user.id);
      if (kyc && kyc.status && !K.STARI_EDITABILE.includes(kyc.status)) return eroare(res, 409, 'blocat');
      const { error } = await stocare.remove([cale]);
      if (error) throw error;
      if (kyc) {
        const schimbari = {};
        if (kyc.document_fata_path === cale) schimbari.document_fata_path = null;
        if (kyc.document_verso_path === cale) schimbari.document_verso_path = null;
        if (Object.keys(schimbari).length) {
          const { error: updErr } = await supabaseAdmin.from('investitori_kyc').update(schimbari).eq('user_id', user.id);
          if (updErr) throw updErr;
        }
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[investitori/kyc-document]', err);
    return eroare(res, 500, 'intern');
  }
}

module.exports = requireAuth([], handler);
