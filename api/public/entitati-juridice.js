// /api/public/entitati-juridice.js
// Datele publice ale entităților juridice ale platformei (16 oct. 2026):
// denumire, CUI, nr. reg. com., adresă, țară — doar entitățile active.
// IBAN-ul nu se expune: tabela nu mai are citire publică (migrarea
// docs/migrations-propuse/2026-10-16_furnizor_propriu.sql), iar IBAN-ul se
// citește doar prin service role, din API-urile de admin.
//
// GET ?tara_cod=RO (opțional) → { ok, entitati: [...] }

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  let query = supabaseAdmin
    .from('entitati_juridice_platforma')
    .select('tara_cod, denumire, cui, nr_reg_com, adresa')
    .eq('activa', true)
    .order('tara_cod', { ascending: true });
  const tara = String(req.query?.tara_cod || '').trim().toUpperCase();
  if (tara) query = query.eq('tara_cod', tara);
  const { data, error } = await query;
  if (error) return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca entitățile juridice', 'We could not load the legal entities.');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({ ok: true, entitati: data || [] });
};
