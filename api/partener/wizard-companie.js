// /api/partener/wizard-companie.js
// Wizard partener în 8 pași (Etapa 4, audit 2026-07-13) — Pasul 2: date
// companie + cont bancar. IBAN e criptat înainte de scriere (nu ajunge
// niciodată în clar în DB) — vezi migrația partner_wizard_8_pasi_schema_si_criptare.
//
// GET  → starea curentă (fără IBAN în clar — doar ultimele 4 cifre, pentru UI)
// POST { nume_firma, cui, partner_type, cont_bancar:{ nume_titular, iban, swift?, banca, moneda } }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const TYPE_TO_ENUM = {
  servicii: 'servicii_tehnice',
  materiale: 'furnizor_materiale',
  inchirieri: 'inchirieri_utilaje',
  curier: 'curier_utilitara',
  asigurari: 'asigurari',
};

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data: partner } = await supabaseAdmin.from('partners').select('nume_firma, cui, partner_type, status_verificare').eq('id', user.id).maybeSingle();
    const { data: conturi } = await supabaseAdmin
      .from('partner_conturi_bancare')
      .select('id, nume_titular, banca, moneda, activ, iban_criptat')
      .eq('partner_id', user.id)
      .eq('activ', true);

    const conturiSigure = await Promise.all((conturi || []).map(async (c) => {
      const { data: iban } = await supabaseAdmin.rpc('decripteaza_camp', { valoare_criptata: c.iban_criptat });
      return {
        id: c.id, nume_titular: c.nume_titular, banca: c.banca, moneda: c.moneda,
        iban_mascat: iban ? `${iban.slice(0, 4)}••••••••${iban.slice(-4)}` : null,
      };
    }));

    return res.status(200).json({ ok: true, partner: partner || null, conturi: conturiSigure });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { nume_firma, cui, partner_type, cont_bancar } = req.body || {};
  if (!nume_firma || !cui) return res.status(400).json({ error: 'nume_firma și cui sunt obligatorii' });

  try {
    const { data: existent } = await supabaseAdmin.from('partners').select('id').eq('id', user.id).maybeSingle();

    if (existent) {
      const { error } = await supabaseAdmin.from('partners').update({ nume_firma, cui }).eq('id', user.id);
      if (error) throw error;
    } else {
      const enumType = TYPE_TO_ENUM[partner_type];
      if (!enumType) return res.status(400).json({ error: 'partner_type invalid pentru un cont nou de partener' });
      const { error } = await supabaseAdmin.from('partners').insert({
        id: user.id, partner_type: enumType, nume_firma, cui, status_verificare: 'pending_review',
      });
      if (error) throw error;
    }

    if (cont_bancar) {
      const { nume_titular, iban, swift, banca, moneda } = cont_bancar;
      if (!nume_titular || !iban || !banca || !moneda) {
        return res.status(400).json({ error: 'cont_bancar: nume_titular, iban, banca și moneda sunt obligatorii' });
      }
      const { data: cripted, error: cryptErr } = await supabaseAdmin.rpc('cripteaza_camp', { valoare: iban });
      if (cryptErr) throw cryptErr;
      const { error: insErr } = await supabaseAdmin.from('partner_conturi_bancare').insert({
        partner_id: user.id, nume_titular, iban_criptat: cripted, swift: swift || null, banca, moneda,
      });
      if (insErr) throw insErr;
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[wizard-companie]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut salva datele companiei' });
  }
}

module.exports = requireAuth([], handler);
