// /api/partener/wizard-certificari.js
// Wizard partener în 8 pași (Etapa 4, audit 2026-07-13) — Pasul 6:
// certificări speciale. Fișierul propriu-zis se încarcă direct din browser
// în bucket-ul privat Storage `partner-certificari` (RLS: partenerul
// scrie/citește doar în propriul folder, vezi migrația
// partner_certificari_storage_bucket) — acest endpoint doar înregistrează
// referința (calea din Storage), nu primește bytea fișierului.
//
// FIX (T9, 2026-07-20): lista de certificări acceptate era hardcodată
// (7 tipuri fixe, gândite doar pentru România) — imposibil de folosit
// corect pentru un partener din DE/FR/BG/MD, unde cerințele diferă complet.
// Acum se citește din `certificari_necesare`, filtrată pe țara partenerului
// (profiles.tara). `tip_certificare` e chiar textul `nume_certificare` din
// acel tabel — validat live, nu contra unei liste fixe în cod.
//
// GET    → certificările înregistrate + cerințele reale pentru țara partenerului
// POST   { tip_certificare, document_path, angajat_id?, data_expirare? }
// DELETE { id }  (26 august 2026 — șterge o singură certificare din dashboard)

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const v = require('../../lib/valideaza');
const { trimiteEroare, trimiteEroareInterna } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  tip_certificare: v.text({ max: 200, eticheta: ['Certificarea', 'Certification'] }),
  document_path: v.text({ max: 300, eticheta: ['Fișierul', 'File'] }),
  angajat_id: v.id({ eticheta: ['Angajat', 'Employee'] }),
  data_expirare: v.data({ eticheta: ['Data expirării', 'Expiry date'] }),
};

async function incarcaCerinteTara(tara) {
  const { data, error } = await supabaseAdmin
    .from('certificari_necesare')
    .select('id, nume_certificare, obligatorie')
    .eq('tara_cod', tara);
  if (error) throw error;
  return data || [];
}

async function handler(req, res, user) {
  const { data: profil } = await supabaseAdmin.from('profiles').select('tara').eq('id', user.id).maybeSingle();
  const tara = profil?.tara || 'RO';

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('partner_certificari')
      .select('id, angajat_id, tip_certificare, document_url, data_expirare, creat_la')
      .eq('partner_id', user.id)
      .order('creat_la', { ascending: false });
    if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);

    const cerinte = await incarcaCerinteTara(tara);
    return res.status(200).json({ ok: true, certificari: data || [], cerinte, tara });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'id este obligatoriu', 'id is required.', ['id']);
    const { data, error } = await supabaseAdmin
      .from('partner_certificari')
      .delete()
      .eq('id', id)
      .eq('partner_id', user.id)
      .select('id')
      .maybeSingle();
    if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
    if (!data) return trimiteEroare(res, 404, 'NU_EXISTA', 'Certificarea nu există sau nu-ți aparține', 'The certification does not exist or does not belong to you.');
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora' })) return;
  const { tip_certificare, document_path, angajat_id = null, data_expirare = null } = req.body || {};
  const cerinte = await incarcaCerinteTara(tara);
  const numeValide = cerinte.map((c) => c.nume_certificare);
  if (!numeValide.includes(tip_certificare)) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', `tip_certificare trebuie să fie una din cerințele configurate pentru ${tara}: ${numeValide.join(', ') || '(nicio cerință configurată)'}`, `tip_certificare must be one of the requirements set for ${tara}: ${numeValide.join(', ') || '(no requirement set)'}`, ['tip_certificare']);
  }
  if (!document_path || typeof document_path !== 'string') {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'document_path (calea fișierului încărcat în Storage) este obligatoriu', 'document_path (the path of the file uploaded to storage) is required.', ['document_path']);
  }
  // Fișierul trebuie să fie chiar în folderul acestui partener — altfel
  // oricine ar putea înregistra calea către fișierul altcuiva.
  if (!document_path.startsWith(`${user.id}/`)) {
    return trimiteEroare(res, 403, 'FARA_DREPT', 'Calea fișierului nu aparține contului tău', 'The file path does not belong to your account.');
  }

  if (angajat_id) {
    const { data: angajat } = await supabaseAdmin.from('partner_angajati').select('id').eq('id', angajat_id).eq('partner_id', user.id).maybeSingle();
    if (!angajat) return trimiteEroare(res, 400, 'DATE_INVALIDE', 'Angajatul indicat nu există pentru acest partener', 'The selected employee does not exist for this partner.', ['angajat_id']);
  }

  try {
    const { data, error } = await supabaseAdmin.from('partner_certificari').insert({
      partner_id: user.id, angajat_id, tip_certificare, document_url: document_path, data_expirare,
    }).select().single();
    if (error) throw error;
    return res.status(200).json({ ok: true, certificare: data });
  } catch (err) {
    console.error('[wizard-certificari]', err);
    return trimiteEroareInterna(res, 500, 'EROARE_SERVER', 'Nu am putut salva certificarea', 'We could not save the certification. Please try again.', err);
  }
}

module.exports = requireAuth([], handler);
