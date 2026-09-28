// /api/partener/cont.js
// Datele reale ale contului de partener pentru dashboard (Faza I, 28 sept. 2026):
// antet, KPI, profil, documente, facturi, garanții și, pentru asigurători, polițe.
// Înlocuiește datele hardcodate din mydarrin-dashboard-partener.html.
//
// GET   -> { ok, partner, profil, are_cont_bancar, kpi, documente, facturi, garantii, polite }
// PATCH -> { telefon?, nr_reg_com?, adresa_sediu_social? } -> { ok }
//
// Câștigul vine din alocările reale (comanda_subcontractori) eliberate din escrow;
// pentru asigurători, din comisioane.suma_asigurator. Zilele și lunile sunt în UTC.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];
const STATUSURI_ACTIVE = ['acceptata', 'in_executie', 'finalizata'];

const rotunjit = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function construiesteKpi(user, partner) {
  const acum = new Date();
  const inceputLuna = Date.UTC(acum.getUTCFullYear(), acum.getUTCMonth(), 1);
  const inceputZi = Date.UTC(acum.getUTCFullYear(), acum.getUTCMonth(), acum.getUTCDate());
  const kpi = {
    moneda: 'RON', comenzi_active: 0, comenzi_luna: 0,
    total_activ: 0, total_eliberat: 0, castig_luna: 0, castig_azi: 0,
  };

  if (partner.partner_type === 'asigurari') {
    const { data: rows } = await supabaseAdmin
      .from('comisioane')
      .select('comanda_id, suma_asigurator, moneda, escrow_eliberat_la, created_at')
      .eq('asigurator_partener_id', user.id);
    for (const r of rows || []) {
      const suma = Number(r.suma_asigurator) || 0;
      if (r.moneda) kpi.moneda = r.moneda;
      if (r.escrow_eliberat_la) {
        kpi.total_eliberat += suma;
        const t = new Date(r.escrow_eliberat_la).getTime();
        if (t >= inceputLuna) kpi.castig_luna += suma;
        if (t >= inceputZi) kpi.castig_azi += suma;
      } else {
        kpi.total_activ += suma;
      }
      if (r.created_at && new Date(r.created_at).getTime() >= inceputLuna) kpi.comenzi_luna += 1;
    }
  } else {
    const { data: alocari } = await supabaseAdmin
      .from('comanda_subcontractori')
      .select('comanda_id, suma_neta_alocata, creat_la')
      .eq('actor_id', user.id);
    const ids = [...new Set((alocari || []).map((a) => a.comanda_id))];
    const comenziIdx = {};
    const eliberatIdx = {};
    if (ids.length) {
      const { data: comenzi } = await supabaseAdmin
        .from('comenzi').select('id, status, moneda, escrow_eliberat').in('id', ids);
      (comenzi || []).forEach((c) => { comenziIdx[c.id] = c; });
      const { data: comisioane } = await supabaseAdmin
        .from('comisioane').select('comanda_id, escrow_eliberat_la').in('comanda_id', ids);
      (comisioane || []).forEach((c) => { eliberatIdx[c.comanda_id] = c.escrow_eliberat_la; });
    }
    const activeVazute = new Set();
    for (const a of alocari || []) {
      const c = comenziIdx[a.comanda_id] || {};
      const suma = Number(a.suma_neta_alocata) || 0;
      if (c.moneda) kpi.moneda = c.moneda;
      const eliberatLa = eliberatIdx[a.comanda_id] || null;
      if (c.escrow_eliberat || eliberatLa) {
        kpi.total_eliberat += suma;
        if (eliberatLa) {
          const t = new Date(eliberatLa).getTime();
          if (t >= inceputLuna) kpi.castig_luna += suma;
          if (t >= inceputZi) kpi.castig_azi += suma;
        }
      } else {
        kpi.total_activ += suma;
      }
      if (a.creat_la && new Date(a.creat_la).getTime() >= inceputLuna) kpi.comenzi_luna += 1;
      if (STATUSURI_ACTIVE.includes(c.status)) activeVazute.add(a.comanda_id);
    }
    kpi.comenzi_active = activeVazute.size;
  }

  for (const k of ['total_activ', 'total_eliberat', 'castig_luna', 'castig_azi']) kpi[k] = rotunjit(kpi[k]);
  return kpi;
}

async function numarePeComanda(ids) {
  const idx = {};
  if (!ids.length) return idx;
  const { data } = await supabaseAdmin.from('comenzi').select('id, nr_comanda').in('id', ids);
  (data || []).forEach((c) => { idx[c.id] = c.nr_comanda; });
  return idx;
}

async function handleGet(req, res, user) {
  const { data: partner, error: perr } = await supabaseAdmin
    .from('partners')
    .select('id, partner_type, nume_firma, cui, nr_reg_com, adresa_sediu_social, tip_entitate_legala, regiune_cod, status_verificare, contract_semnat, contract_semnat_la, contract_versiune, creata_la')
    .eq('id', user.id)
    .maybeSingle();
  if (perr) {
    console.error('[partener/cont] partner', perr);
    return res.status(500).json({ error: 'Nu am putut încărca contul de partener.' });
  }
  if (!partner) return res.status(404).json({ error: 'Contul de partener nu a fost găsit.' });

  const [{ data: profil }, { data: cont }, kpi, { data: documente }, { data: facturi }, { data: garantii }] = await Promise.all([
    supabaseAdmin.from('profiles').select('email, phone, phone_verificat, tara, limba').eq('id', user.id).maybeSingle(),
    supabaseAdmin.from('partner_conturi_bancare').select('id').eq('partner_id', user.id).eq('activ', true).maybeSingle(),
    construiesteKpi(user, partner),
    supabaseAdmin.from('documente_partener')
      .select('id, tip_document, status, observatii, uploaded_at, verificat_la')
      .eq('partener_id', user.id).order('uploaded_at', { ascending: false }),
    supabaseAdmin.from('facturi_parteneri')
      .select('id, numar_factura_partener, suma, moneda, status, creat_la, platita_la')
      .eq('partener_id', user.id).order('creat_la', { ascending: false }).limit(100),
    supabaseAdmin.from('garantii_lucrari')
      .select('id, comanda_id, data_finalizare, durata_luni, data_expirare, status, reclamatie_deschisa')
      .eq('partener_id', user.id).order('data_finalizare', { ascending: false }).limit(100),
  ]);

  const nrIdx = await numarePeComanda([...new Set((garantii || []).map((g) => g.comanda_id))]);
  const garantiiOut = (garantii || []).map((g) => ({ ...g, nr_comanda: nrIdx[g.comanda_id] || null }));

  let polite = [];
  if (partner.partner_type === 'asigurari') {
    const { data: com } = await supabaseAdmin
      .from('comisioane')
      .select('comanda_id, suma_asigurator, moneda, escrow_eliberat_la, created_at')
      .eq('asigurator_partener_id', user.id).order('created_at', { ascending: false }).limit(200);
    const ids = [...new Set((com || []).map((c) => c.comanda_id))];
    let comenziIdx = {};
    if (ids.length) {
      const { data: comenzi } = await supabaseAdmin
        .from('comenzi').select('id, nr_comanda, numar_polita, polita_url, suma_asigurare, moneda').in('id', ids);
      (comenzi || []).forEach((c) => { comenziIdx[c.id] = c; });
    }
    polite = (com || []).map((c) => {
      const cmd = comenziIdx[c.comanda_id] || {};
      return {
        nr_comanda: cmd.nr_comanda || null,
        numar_polita: cmd.numar_polita || null,
        polita_url: cmd.polita_url || null,
        prima: Number(cmd.suma_asigurare) || 0,
        comision: Number(c.suma_asigurator) || 0,
        moneda: c.moneda || cmd.moneda || null,
        escrow_eliberat_la: c.escrow_eliberat_la,
        creat_la: c.created_at,
      };
    });
  }

  return res.status(200).json({
    ok: true,
    partner,
    profil: { ...(profil || {}), email: profil?.email || user.email || null },
    are_cont_bancar: !!cont,
    kpi,
    documente: documente || [],
    facturi: facturi || [],
    garantii: garantiiOut,
    polite,
  });
}

async function handlePatch(req, res, user) {
  const { telefon, nr_reg_com, adresa_sediu_social } = req.body || {};
  const partnerUpdate = {};
  const profileUpdate = {};

  if (nr_reg_com !== undefined) {
    if (typeof nr_reg_com !== 'string' || nr_reg_com.trim().length > 40) return res.status(400).json({ error: 'nr_reg_com: maximum 40 de caractere.' });
    partnerUpdate.nr_reg_com = nr_reg_com.trim() || null;
  }
  if (adresa_sediu_social !== undefined) {
    if (typeof adresa_sediu_social !== 'string' || adresa_sediu_social.trim().length > 300) return res.status(400).json({ error: 'adresa_sediu_social: maximum 300 de caractere.' });
    partnerUpdate.adresa_sediu_social = adresa_sediu_social.trim() || null;
  }
  if (telefon !== undefined) {
    const t = typeof telefon === 'string' ? telefon.trim() : '';
    if (t && !/^\+?[0-9 ()\-]{6,20}$/.test(t)) return res.status(400).json({ error: 'Telefon invalid (6-20 de cifre, poate începe cu +).' });
    const { data: existent } = await supabaseAdmin.from('profiles').select('phone').eq('id', user.id).maybeSingle();
    if ((existent?.phone || '') !== t) {
      profileUpdate.phone = t || null;
      profileUpdate.phone_verificat = false;
    }
  }
  if (telefon === undefined && nr_reg_com === undefined && adresa_sediu_social === undefined) {
    return res.status(400).json({ error: 'Nu ai trimis niciun câmp de actualizat.' });
  }

  if (Object.keys(partnerUpdate).length) {
    const { error } = await supabaseAdmin.from('partners').update(partnerUpdate).eq('id', user.id);
    if (error) {
      console.error('[partener/cont] update partners', error);
      return res.status(500).json({ error: 'Nu am putut salva datele firmei.' });
    }
  }
  if (Object.keys(profileUpdate).length) {
    const { error } = await supabaseAdmin.from('profiles').update(profileUpdate).eq('id', user.id);
    if (error) {
      console.error('[partener/cont] update profiles', error);
      return res.status(500).json({ error: 'Nu am putut salva telefonul.' });
    }
  }
  return res.status(200).json({ ok: true });
}

async function handler(req, res, user) {
  if (req.method === 'GET') return handleGet(req, res, user);
  if (req.method === 'PATCH') return handlePatch(req, res, user);
  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);
