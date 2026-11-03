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
//
// Pasul 11-R3 (2 nov. 2026): e pasul „Firma” din lista „Activează contul”.
// Un cont fără rând în partners îl poate folosi doar dacă a ales un rol de
// partener (profiles.rol_solicitat, prin /api/cont/rol-solicitat) sau are deja
// un rol de partener în profiles.roles; tipul vine din alegerea lui (un alt
// tip în cerere → 409). Restul endpoint-urilor de partener cer rolul.
//
// Pasul 11-R3e (3 nov. 2026): CUI-ul se salvează în forma unică
// (lib/forme-juridice.js → normalizeazaCui). Un CUI deja folosit de alt cont
// → 409 CUI_FOLOSIT pe câmpul `cui`, fără niciun detaliu despre celălalt cont
// (o firmă = un singur cont de partener, partners_cui_key). Același cont care
// își salvează din nou firma actualizează rândul. Orice altă eroare a bazei de
// date: mesaj general RO + EN; textul tehnic merge doar în jurnalul serverului.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { validateIBAN } = require('../../lib/iban');
const { TIP_PARTENER_DUPA_FORMULAR, ROL_DUPA_TIP_PARTENER, asiguraRolInProfil } = require('../../lib/roluri-partener');
const { trimiteEroare, camp, formaComuna } = require('../../lib/raspuns-eroare');
const { verificaFirmaPartener, marcheazaVerificareManuala } = require('../../lib/verifica-firma-partener');
const { TIP_DUPA_ROL, esteRolPartener } = require('../../lib/activare-partener');
const { normalizeazaCui } = require('../../lib/forme-juridice');

const FARA_ROL_ALES = {
  ro: 'Alege întâi tipul de partener („Devino partener” sau „Rolurile mele”), apoi completează datele firmei.',
  en: 'First choose the partner type (“Become a partner” or “My roles”), then fill in the company details.',
};
const CUI_FOLOSIT = {
  ro: 'Această firmă are deja un cont de partener pe My Darrin. Dacă e firma ta și nu ai acces la cont, scrie-ne din pagina Contact.',
  en: 'This company already has a partner account on My Darrin. If it is your company and you cannot access that account, write to us from the Contact page.',
};
const EROARE_GENERALA = {
  ro: 'Nu am putut salva datele firmei. Încearcă din nou peste câteva momente; dacă se repetă, scrie-ne din pagina Contact.',
  en: 'We could not save the company details. Please try again in a few moments; if it happens again, write to us from the Contact page.',
};
const CONT_BANCAR_INCOMPLET = {
  ro: 'Contul bancar: completează titularul, IBAN-ul, banca și moneda.',
  en: 'Bank account: fill in the holder, the IBAN, the bank and the currency.',
};
const IBAN_INVALID = {
  ro: 'IBAN-ul nu e valid. Verifică cifrele și literele (de exemplu RO49 AAAA 1B31 0075 9384 0000).',
  en: 'The IBAN is not valid. Check the digits and letters (for example RO49 AAAA 1B31 0075 9384 0000).',
};
const TIP_INVALID = {
  ro: 'Tipul de partener nu e valid. Alege tipul din „Rolurile mele”.',
  en: 'The partner type is not valid. Choose the type from “My roles”.',
};

// Alt cont cu același CUI, în forma unică sau într-o formă veche („RO46577229”,
// „RO 46577229”…)? Pentru România se caută după cifrele de la final, apoi se
// compară în forma unică. Răspunsul e doar da / nu.
async function cuiFolositDeAltCont(cui, tara, userId) {
  let q = supabaseAdmin.from('partners').select('id, cui').neq('id', userId);
  q = String(tara || 'RO').toUpperCase() === 'RO' ? q.ilike('cui', '%' + cui) : q.ilike('cui', cui.replace(/[\\%_]/g, '\\$&'));
  const { data, error } = await q.limit(50);
  if (error) throw error;
  return (data || []).some((p) => normalizeazaCui(p.cui, tara) === cui);
}
const esteDuplicatCui = (e) => !!e && e.code === '23505' && /cui/i.test(String(e.message || '') + String(e.details || ''));
const raspundeCuiFolosit = (res) => trimiteEroare(res, 409, 'CUI_FOLOSIT', CUI_FOLOSIT.ro, CUI_FOLOSIT.en, [camp('cui', CUI_FOLOSIT.ro, CUI_FOLOSIT.en)]);

const ALT_TIP = {
  ro: 'Ai ales alt tip de partener. Datele firmei se completează pentru tipul ales; pentru alt tip, alege-l din „Rolurile mele”.',
  en: 'You chose a different partner type. The company details are filled in for the chosen type; for another type, choose it from “My roles”.',
};

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data: partner } = await supabaseAdmin
      .from('partners')
      .select('nume_firma, cui, partner_type, status_verificare, tip_entitate_legala, forma_juridica_locala, is_treasury_account, regiune_cod, nr_reg_com, adresa_sediu_social')
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

  const { is_treasury_account, regiune_cod, cont_bancar, nr_reg_com, adresa_sediu_social } = req.body || {};
  let { partner_type } = req.body || {};

  try {
    let { data: profil, error: profilErr } = await supabaseAdmin.from('profiles').select('tara, roles, rol_solicitat').eq('id', user.id).maybeSingle();
    // Înainte de migrarea 2026-11-01 coloana rol_solicitat lipsește.
    if (profilErr) ({ data: profil } = await supabaseAdmin.from('profiles').select('tara, roles').eq('id', user.id).maybeSingle());

    // Cine poate crea un partener nou: rol de partener ales sau deja acordat.
    const { data: dejaPartener } = await supabaseAdmin.from('partners').select('id').eq('id', user.id).maybeSingle();
    if (!dejaPartener) {
      const roluri = Array.isArray(profil?.roles) ? profil.roles : [];
      const ales = esteRolPartener(profil?.rol_solicitat) ? profil.rol_solicitat : roluri.find(esteRolPartener);
      if (!ales) return trimiteEroare(res, 403, 'FARA_ROL_ALES', FARA_ROL_ALES.ro, FARA_ROL_ALES.en);
      const tipAles = TIP_DUPA_ROL[ales];
      if (partner_type && partner_type !== tipAles) return trimiteEroare(res, 409, 'ALT_TIP_PARTENER', ALT_TIP.ro, ALT_TIP.en, [camp('partner_type', ALT_TIP.ro, ALT_TIP.en)]);
      partner_type = tipAles;
    }

    const firma = await verificaFirmaPartener(req.body, (profil && profil.tara) || req.body?.tara || 'RO');
    if (!firma.ok) {
      return trimiteEroare(res, firma.status, firma.cod, firma.error, firma.error_en, [camp(firma.camp, firma.error, firma.error_en)]);
    }
    const { nume_firma, cui, tip_entitate_legala, forma_juridica_locala, tara } = firma.date;
    if (await cuiFolositDeAltCont(cui, tara, user.id)) return raspundeCuiFolosit(res);

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
      if (esteDuplicatCui(error)) return raspundeCuiFolosit(res);
      if (error) throw error;
      if (normalizeazaCui(existent.cui, tara) !== cui) await marcheazaVerificareManuala({ partenerId: user.id, motiv: firma.verificare_manuala, cui, req });
    } else {
      const enumType = TIP_PARTENER_DUPA_FORMULAR[partner_type];
      if (!enumType) return trimiteEroare(res, 400, 'TIP_INVALID', TIP_INVALID.ro, TIP_INVALID.en, [camp('partner_type', TIP_INVALID.ro, TIP_INVALID.en)]);
      const { error } = await supabaseAdmin.from('partners').insert({
        id: user.id, partner_type: enumType, nume_firma, cui, status_verificare: 'pending_review', ...campuriEntitate,
      });
      if (esteDuplicatCui(error)) return raspundeCuiFolosit(res);
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
        return trimiteEroare(res, 400, 'CONT_BANCAR_INCOMPLET', CONT_BANCAR_INCOMPLET.ro, CONT_BANCAR_INCOMPLET.en);
      }
      if (!validateIBAN(iban)) {
        return trimiteEroare(res, 400, 'IBAN_INVALID', IBAN_INVALID.ro, IBAN_INVALID.en, [camp('iban', IBAN_INVALID.ro, IBAN_INVALID.en)]);
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
    // Textul tehnic doar în jurnal; utilizatorul primește mesajul general.
    console.error('[wizard-companie]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', EROARE_GENERALA.ro, EROARE_GENERALA.en);
  }
}

// Erorile ies în forma comună (lib/raspuns-eroare.js), cu `error` / `error_en` păstrate.
module.exports = formaComuna(requireAuth([], handler));
