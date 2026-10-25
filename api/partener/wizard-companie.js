// /api/partener/wizard-companie.js
// Wizard partener în 8 pași (Etapa 4, audit 2026-07-13) — Pasul 2: date
// companie + cont bancar. IBAN e criptat înainte de scriere (nu ajunge
// niciodată în clar în DB) — vezi migrația partner_wizard_8_pasi_schema_si_criptare.
//
// GET  → starea curentă (fără IBAN în clar — doar ultimele 4 cifre, pentru UI)
// POST { nume_firma, cui, partner_type, tip_entitate_legala, forma_juridica_locala?,
//        is_treasury_account?, regiune_cod?, cont_bancar:{ nume_titular, iban, swift?, banca, moneda } }
//
// FIX (T7, 2026-07-20): tip_entitate_legala/is_treasury_account/regiune_cod
// lipseau complet — nicio distincție PFA/SRL/SA/Instituție Publică, niciun
// flag de trezorerie, nicio regiune. IBAN-ul nu era validat deloc înainte
// de criptare — orice string trecea. Adăugat checksum MOD-97 real
// (lib/iban.js), fără API extern.
//
// Pasul 11-L (17 oct. 2026, „un cont, mai multe roluri”): e și ruta prin care
// un cont existent (client, investitor) își adaugă un rol de partener din
// „Devino partener”: nu se creează alt cont, iar la crearea rândului din
// partners rolul de partener se adaugă în profiles.roles, lângă cele
// existente (asiguraRolInProfil). Tabela partners are un singur rând pe cont
// (id = user.id), deci un cont are un singur tip de partener: cererea pentru
// alt tip primește 409, cu explicația.
// POST acceptă și nr_reg_com și adresa_sediu_social (ca formularul public).
//
// Pasul 11-P1 (25 oct. 2026): forma juridică e obligatorie și doar din
// lib/forme-juridice.js (fără persoană fizică); țara firmei e profiles.tara.
// Firma inactivă sau radiată la ANAF e refuzată (lib/verifica-firma-partener.js).

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { validateIBAN } = require('../../lib/iban');
const { TIP_PARTENER_DUPA_FORMULAR, ROL_DUPA_TIP_PARTENER, asiguraRolInProfil } = require('../../lib/roluri-partener');
const { trimiteEroare, camp, formaComuna } = require('../../lib/raspuns-eroare');
const { verificaFirmaPartener, marcheazaVerificareManuala } = require('../../lib/verifica-firma-partener');

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data: partner } = await supabaseAdmin
      .from('partners')
      .select('nume_firma, cui, partner_type, status_verificare, tip_entitate_legala, forma_juridica_locala, is_treasury_account, regiune_cod')
      .eq('id', user.id).maybeSingle();
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

  const { partner_type, is_treasury_account, regiune_cod, cont_bancar, nr_reg_com, adresa_sediu_social } = req.body || {};

  try {
    const { data: profil } = await supabaseAdmin.from('profiles').select('tara').eq('id', user.id).maybeSingle();
    const firma = await verificaFirmaPartener(req.body, (profil && profil.tara) || req.body?.tara || 'RO');
    if (!firma.ok) {
      return trimiteEroare(res, firma.status, firma.cod, firma.error, firma.error_en, [camp(firma.camp, firma.error, firma.error_en)]);
    }
    const { nume_firma, cui, tip_entitate_legala, forma_juridica_locala } = firma.date;

    const { data: existent } = await supabaseAdmin.from('partners').select('id, partner_type, cui').eq('id', user.id).maybeSingle();
    const tipCerut = partner_type ? TIP_PARTENER_DUPA_FORMULAR[partner_type] : null;
    if (existent && tipCerut && existent.partner_type && tipCerut !== existent.partner_type) {
      return res.status(409).json({
        error: 'Contul tău are deja un rol de partener. Un cont poate avea un singur tip de partener; pentru alt tip, scrie-ne din pagina Contact.',
        error_en: 'Your account already has a partner role. An account can have only one partner type; for another type, write to us from the Contact page.',
        cod: 'alt_tip_partener',
      });
    }

    const campuriEntitate = {
      tip_entitate_legala,
      // Coloana vine din migrarea 11-P1: se completează pentru firma_straina,
      // iar pe un rând existent se golește când forma juridică se schimbă.
      ...(forma_juridica_locala ? { forma_juridica_locala } : (existent ? { forma_juridica_locala: null } : {})),
      ...(is_treasury_account !== undefined ? { is_treasury_account: Boolean(is_treasury_account) } : {}),
      ...(regiune_cod !== undefined ? { regiune_cod } : {}),
      ...(typeof nr_reg_com === 'string' && nr_reg_com.trim() ? { nr_reg_com: nr_reg_com.trim().slice(0, 40) } : {}),
      ...(typeof adresa_sediu_social === 'string' && adresa_sediu_social.trim() ? { adresa_sediu_social: adresa_sediu_social.trim().slice(0, 300) } : {}),
    };

    if (existent) {
      const { error } = await supabaseAdmin.from('partners').update({ nume_firma, cui, ...campuriEntitate }).eq('id', user.id);
      if (error) throw error;
      if (existent.cui !== cui) await marcheazaVerificareManuala({ partenerId: user.id, motiv: firma.verificare_manuala, cui, req });
    } else {
      const enumType = TIP_PARTENER_DUPA_FORMULAR[partner_type];
      if (!enumType) return res.status(400).json({ error: 'partner_type invalid pentru un cont nou de partener' });
      const { error } = await supabaseAdmin.from('partners').insert({
        id: user.id, partner_type: enumType, nume_firma, cui, status_verificare: 'pending_review', ...campuriEntitate,
      });
      if (error) throw error;
      await marcheazaVerificareManuala({ partenerId: user.id, motiv: firma.verificare_manuala, cui, req });
      // Rolul de partener lângă rolurile existente ale contului (pasul 11-L).
      // Comenzile și vânzarea rămân condiționate de aprobare, contract și cont
      // bancar (lib/eligibilitate-partener.js), ca la orice partener nou.
      await asiguraRolInProfil(user.id, ROL_DUPA_TIP_PARTENER[enumType], { email: user.email || null });
    }

    if (cont_bancar) {
      const { nume_titular, iban, swift, banca, moneda } = cont_bancar;
      if (!nume_titular || !iban || !banca || !moneda) {
        return res.status(400).json({ error: 'cont_bancar: nume_titular, iban, banca și moneda sunt obligatorii' });
      }
      if (!validateIBAN(iban)) {
        return res.status(400).json({ error: 'IBAN invalid (checksum incorect)' });
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

// Erorile ies în forma comună (lib/raspuns-eroare.js), cu `error` / `error_en` păstrate.
module.exports = formaComuna(requireAuth([], handler));
