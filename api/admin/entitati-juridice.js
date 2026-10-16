// /api/admin/entitati-juridice.js
// Configurare identitate juridică/fiscală a platformei, per țară (audit
// Secțiunea 41/42, 31 Iulie 2026, cerință explicită: "fiecare țară va avea
// o identitate juridică și fiscală înființată"). Folosit ca destinatar al
// facturilor emise de parteneri (api/partener/facturi.js).
//
// GET              → listă completă (toate țările configurate) + contul de
//                    furnizor legat de fiecare entitate + conturile care pot fi legate
// POST { tara_cod, denumire, cui, nr_reg_com, adresa, iban, activa } → upsert
// POST { actiune: 'din_anaf', tara_cod: 'RO', cui } → denumirea, CUI-ul,
//      nr. reg. com. și adresa exact cum le întoarce ANAF (IBAN-ul nu se atinge)
// POST { actiune: 'leaga_furnizor', tara_cod, partener_id | null } → furnizorul
//      propriu al platformei (partners.entitate_platforma_id; 16 oct. 2026)

const { requireAuth, hasRole } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { curataCUI, cautaANAF, MESAJE_ANAF } = require('../../lib/cauta-firma');
const { coloanaLipseste } = require('../../lib/furnizor-propriu');

const MESAJ_MIGRARE = 'Migrarea 2026-10-16_furnizor_propriu.sql nu e aplicată: legătura cu contul de furnizor nu se poate salva încă.';
const TIPURI_FURNIZOR = ['furnizor_materiale', 'inchirieri_utilaje'];

// Conturile legate și conturile care pot fi legate (furnizori aprobați).
// Fără migrare: legate = {}, migrare_aplicata = false.
async function furnizoriPentruEntitati() {
  const { data: legati, error } = await supabaseAdmin
    .from('partners')
    .select('id, nume_firma, cui, partner_type, entitate_platforma_id')
    .not('entitate_platforma_id', 'is', null);
  const migrareAplicata = !coloanaLipseste(error);
  if (error && migrareAplicata) console.error('[admin/entitati-juridice] parteneri legați', error);

  const { data: candidati } = await supabaseAdmin
    .from('partners')
    .select('id, nume_firma, cui, partner_type, status_verificare')
    .in('partner_type', TIPURI_FURNIZOR)
    .eq('status_verificare', 'approved')
    .order('nume_firma', { ascending: true });

  const ids = [...new Set([...(legati || []), ...(candidati || [])].map((p) => p.id))];
  const emailuri = {};
  if (ids.length) {
    const { data: profile } = await supabaseAdmin.from('profiles').select('id, email').in('id', ids);
    (profile || []).forEach((p) => { emailuri[p.id] = p.email || null; });
  }
  const cuEmail = (p) => ({ id: p.id, nume_firma: p.nume_firma, cui: p.cui, partner_type: p.partner_type, email: emailuri[p.id] || null });
  const legatePeEntitate = {};
  (legati || []).forEach((p) => { legatePeEntitate[p.entitate_platforma_id] = cuEmail(p); });
  return { migrareAplicata, legatePeEntitate, candidati: (candidati || []).map(cuEmail) };
}

async function citesteEntitate(taraCod) {
  const { data } = await supabaseAdmin
    .from('entitati_juridice_platforma')
    .select('*')
    .eq('tara_cod', taraCod)
    .maybeSingle();
  return data || null;
}

async function dinAnaf(req, res, admin) {
  const taraCod = String(req.body?.tara_cod || '').toUpperCase();
  if (taraCod !== 'RO') return res.status(400).json({ error: 'Completarea din ANAF e doar pentru entitatea din România (RO).' });
  const cuiNumeric = curataCUI(req.body?.cui);
  if (!cuiNumeric) return res.status(400).json({ error: 'CUI invalid' });

  let anaf;
  try {
    anaf = await cautaANAF(cuiNumeric);
  } catch (e) {
    console.error('[admin/entitati-juridice] ANAF', e.message);
    const mesaj = MESAJE_ANAF[e.cod] || MESAJE_ANAF.anaf_indisponibil;
    return res.status(502).json({ error: mesaj.ro, error_en: mesaj.en, cod: e.cod || 'anaf_indisponibil' });
  }
  if (!anaf || !anaf.denumire) return res.status(404).json({ error: 'CUI-ul nu e în registrul ANAF; nimic nu s-a modificat.' });

  const inainte = await citesteEntitate('RO');
  const campuri = { denumire: anaf.denumire, cui: anaf.cui || cuiNumeric, nr_reg_com: anaf.nr_reg_com, adresa: anaf.adresa, actualizat_la: new Date().toISOString() };
  const { data, error } = inainte
    ? await supabaseAdmin.from('entitati_juridice_platforma').update(campuri).eq('id', inainte.id).select().single()
    : await supabaseAdmin.from('entitati_juridice_platforma').insert({ tara_cod: 'RO', activa: false, ...campuri }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await inregistreazaAudit({
    admin, req, actiune: 'entitate_juridica_din_anaf', entitate: 'entitati_juridice_platforma', entitate_id: 'RO',
    detalii: {
      sursa: 'ANAF PlatitorTvaRest',
      inainte: inainte ? { denumire: inainte.denumire, cui: inainte.cui, nr_reg_com: inainte.nr_reg_com, adresa: inainte.adresa } : null,
      dupa: { denumire: data.denumire, cui: data.cui, nr_reg_com: data.nr_reg_com, adresa: data.adresa },
      tva_activ: anaf.tva_activ,
    },
  });
  return res.status(200).json({ ok: true, entitate: data, anaf: { tva_activ: anaf.tva_activ } });
}

async function leagaFurnizor(req, res, admin) {
  const taraCod = String(req.body?.tara_cod || '').toUpperCase();
  const partenerId = req.body?.partener_id || null;
  const entitate = await citesteEntitate(taraCod);
  if (!entitate) return res.status(404).json({ error: 'Entitatea juridică nu există pentru această țară.' });
  if (!entitate.activa) return res.status(409).json({ error: 'Entitatea juridică e inactivă: activeaz-o înainte de a o lega de un cont de furnizor.' });

  if (partenerId) {
    const { data: partener } = await supabaseAdmin
      .from('partners')
      .select('id, partner_type, status_verificare')
      .eq('id', partenerId)
      .maybeSingle();
    if (!partener) return res.status(404).json({ error: 'Contul de partener nu există.' });
    if (partener.status_verificare !== 'approved' || !TIPURI_FURNIZOR.includes(partener.partner_type)) {
      return res.status(409).json({ error: 'Doar un furnizor de materiale sau de închirieri aprobat poate fi furnizorul propriu.' });
    }
  }

  // O entitate — cel mult un cont: legătura veche se scoate întâi.
  const { error: eroareVeche } = await supabaseAdmin
    .from('partners')
    .update({ entitate_platforma_id: null })
    .eq('entitate_platforma_id', entitate.id);
  if (eroareVeche) {
    if (coloanaLipseste(eroareVeche)) return res.status(409).json({ error: MESAJ_MIGRARE, code: 'MIGRARE_NEAPLICATA' });
    return res.status(500).json({ error: eroareVeche.message });
  }
  if (partenerId) {
    const { error } = await supabaseAdmin.from('partners').update({ entitate_platforma_id: entitate.id }).eq('id', partenerId);
    if (error) {
      if (coloanaLipseste(error)) return res.status(409).json({ error: MESAJ_MIGRARE, code: 'MIGRARE_NEAPLICATA' });
      if (error.code === '23505') return res.status(409).json({ error: 'Contul ales e deja furnizorul propriu al altei entități.' });
      return res.status(500).json({ error: error.message });
    }
  }

  await inregistreazaAudit({
    admin, req, actiune: partenerId ? 'leaga_furnizor_propriu' : 'dezleaga_furnizor_propriu',
    entitate: 'entitati_juridice_platforma', entitate_id: taraCod, detalii: { entitate_id: entitate.id, partener_id: partenerId },
  });
  return res.status(200).json({ ok: true, entitate_id: entitate.id, partener_id: partenerId });
}

async function handler(req, res, admin) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('entitati_juridice_platforma')
      .select('*')
      .order('tara_cod', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    const furnizori = await furnizoriPentruEntitati();
    const entitati = (data || []).map((e) => ({ ...e, furnizor_propriu: furnizori.legatePeEntitate[e.id] || null }));
    return res.status(200).json({ ok: true, entitati, furnizori_disponibili: furnizori.candidati, migrare_furnizor_propriu: furnizori.migrareAplicata });
  }

  if (req.method === 'POST') {
    const actiune = req.body?.actiune;
    if (actiune === 'din_anaf' || actiune === 'leaga_furnizor') {
      if (!(await hasRole(admin, ['superadmin']))) return res.status(403).json({ error: 'Doar superadminul completează entitatea din ANAF și leagă furnizorul propriu.' });
      return actiune === 'din_anaf' ? dinAnaf(req, res, admin) : leagaFurnizor(req, res, admin);
    }

    const { tara_cod, denumire, cui, nr_reg_com, adresa, iban, activa } = req.body || {};
    if (!tara_cod) return res.status(400).json({ error: 'tara_cod este obligatoriu' });

    const { data, error } = await supabaseAdmin
      .from('entitati_juridice_platforma')
      .upsert({
        tara_cod,
        denumire: denumire || null,
        cui: cui || null,
        nr_reg_com: nr_reg_com || null,
        adresa: adresa || null,
        iban: iban || null,
        activa: !!activa,
        actualizat_la: new Date().toISOString(),
      }, { onConflict: 'tara_cod' })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await inregistreazaAudit({ admin, req, actiune: 'actualizare_entitate_juridica', entitate: 'entitati_juridice_platforma', entitate_id: tara_cod, detalii: { tara_cod, denumire, activa: !!activa } });
    return res.status(200).json({ ok: true, entitate: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
