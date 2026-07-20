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
// GET  → certificările înregistrate + cerințele reale pentru țara partenerului
// POST { tip_certificare, document_path, angajat_id?, data_expirare? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

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
    if (error) return res.status(500).json({ error: error.message });

    const cerinte = await incarcaCerinteTara(tara);
    return res.status(200).json({ ok: true, certificari: data || [], cerinte, tara });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tip_certificare, document_path, angajat_id = null, data_expirare = null } = req.body || {};
  const cerinte = await incarcaCerinteTara(tara);
  const numeValide = cerinte.map((c) => c.nume_certificare);
  if (!numeValide.includes(tip_certificare)) {
    return res.status(400).json({ error: `tip_certificare trebuie să fie una din cerințele configurate pentru ${tara}: ${numeValide.join(', ') || '(nicio cerință configurată)'}` });
  }
  if (!document_path || typeof document_path !== 'string') {
    return res.status(400).json({ error: 'document_path (calea fișierului încărcat în Storage) este obligatoriu' });
  }
  // Fișierul trebuie să fie chiar în folderul acestui partener — altfel
  // oricine ar putea înregistra calea către fișierul altcuiva.
  if (!document_path.startsWith(`${user.id}/`)) {
    return res.status(403).json({ error: 'Calea fișierului nu aparține contului tău' });
  }

  if (angajat_id) {
    const { data: angajat } = await supabaseAdmin.from('partner_angajati').select('id').eq('id', angajat_id).eq('partner_id', user.id).maybeSingle();
    if (!angajat) return res.status(400).json({ error: 'Angajatul indicat nu există pentru acest partener' });
  }

  try {
    const { data, error } = await supabaseAdmin.from('partner_certificari').insert({
      partner_id: user.id, angajat_id, tip_certificare, document_url: document_path, data_expirare,
    }).select().single();
    if (error) throw error;
    return res.status(200).json({ ok: true, certificare: data });
  } catch (err) {
    console.error('[wizard-certificari]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut salva certificarea' });
  }
}

module.exports = requireAuth([], handler);
