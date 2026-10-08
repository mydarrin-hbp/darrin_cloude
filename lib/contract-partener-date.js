// lib/contract-partener-date.js
// Adună din baza de date datele reale ale partenerului și produce contractul-cadru
// (lib/contract-partener.js). Folosit de api/partener/contract.js (afișare) și de
// api/partener/contract-confirma-otp.js (instantaneul păstrat la acceptare).

const crypto = require('crypto');
const { supabaseAdmin } = require('./supabaseAdmin');
const { genereazaContract, CONTRACT_VERSIUNE } = require('./contract-partener');

const NUMAR = (v, d) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d);

async function citesteProcente() {
  const { data } = await supabaseAdmin
    .from('backoffice_config')
    .select('cheie, valoare')
    .eq('tara_cod', 'ALL') // procentele generale; rândurile pe țară nu intră în contractul-cadru
    .in('cheie', ['comision_platforma_default_pct', 'comision_bricolaj_contractat_pct', 'comision_inchiriere_contractat_pct', 'comision_intermediere_pct']);
  const c = {};
  (data || []).forEach((r) => { c[r.cheie] = r.valoare; });
  return {
    comision_platforma: NUMAR(c.comision_platforma_default_pct, null),
    materiale: NUMAR(c.comision_bricolaj_contractat_pct, null),
    inchirieri: NUMAR(c.comision_inchiriere_contractat_pct, null),
    asigurari: NUMAR(c.comision_intermediere_pct, null),
  };
}

async function incarcaDateContract(partnerId) {
  const { data: partner } = await supabaseAdmin
    .from('partners')
    .select('id, partner_type, nume_firma, cui, nr_reg_com, adresa_sediu_social, tip_entitate_legala, regiune_cod, contract_semnat, contract_semnat_la, contract_versiune')
    .eq('id', partnerId)
    .maybeSingle();
  if (!partner) return null;

  const [profilR, authR, activeR, naceR, angR, certR, utilR, zonaR, politeR, procente] = await Promise.all([
    supabaseAdmin.from('profiles').select('email, phone, tara').eq('id', partnerId).maybeSingle(),
    supabaseAdmin.auth.admin.getUserById(partnerId),
    supabaseAdmin.from('partener_servicii_active').select('catalog_serviciu_id').eq('partener_id', partnerId).eq('activ', true),
    supabaseAdmin.from('partner_coduri_nace').select('cod_nace, principal').eq('partner_id', partnerId),
    supabaseAdmin.from('partner_angajati').select('cod_esco').eq('partner_id', partnerId).eq('activ', true),
    supabaseAdmin.from('partner_certificari').select('tip_certificare, data_expirare').eq('partner_id', partnerId),
    supabaseAdmin.from('partner_utilaje').select('denumire, marca, model, capacitate_kg').eq('partner_id', partnerId),
    supabaseAdmin.from('partner_zona_curier').select('tara_cod, regiune_cod, localitate, raza_livrare_km').eq('partner_id', partnerId).eq('activ', true),
    supabaseAdmin.from('partner_tipuri_polita').select('tip_polita, limita_acoperire_eur, comision_pct').eq('partner_id', partnerId).eq('activ', true),
    citesteProcente(),
  ]);

  const profil = profilR.data || {};
  const meta = (authR.data && authR.data.user && authR.data.user.user_metadata) || {};
  const reprezentant = [meta.prenume, meta.nume].filter(Boolean).join(' ') || null;
  const tara = profil.tara || 'RO';

  const idsCatalog = (activeR.data || []).map((r) => r.catalog_serviciu_id);
  let catalog = [];
  if (idsCatalog.length) {
    const { data } = await supabaseAdmin
      .from('catalog_servicii')
      .select('id, titlu, domeniu, categorie, nace, cod_esco')
      .in('id', idsCatalog);
    catalog = data || [];
  }

  const codesco = new Set();
  catalog.forEach((s) => s.cod_esco && codesco.add(s.cod_esco));
  const persoane = {};
  (angR.data || []).forEach((a) => {
    if (a.cod_esco) { codesco.add(a.cod_esco); persoane[a.cod_esco] = (persoane[a.cod_esco] || 0) + 1; }
  });
  const denumiri = {};
  if (codesco.size) {
    const { data } = await supabaseAdmin.from('competente_esco').select('cod_esco, denumire').in('cod_esco', [...codesco]);
    (data || []).forEach((c) => { denumiri[c.cod_esco] = c.denumire; });
  }

  const servicii = catalog
    .map((s) => ({ ...s, competenta: s.cod_esco ? denumiri[s.cod_esco] || null : null }))
    .sort((a, b) => String(a.titlu).localeCompare(String(b.titlu), 'ro'));

  const caenMap = new Map();
  (naceR.data || []).forEach((n) => { if (n.cod_nace) caenMap.set(n.cod_nace, { cod: n.cod_nace, principal: !!n.principal }); });
  catalog.forEach((s) => { if (s.nace && !caenMap.has(s.nace)) caenMap.set(s.nace, { cod: s.nace, principal: false }); });

  const competente = [...codesco].sort().map((cod) => ({ cod, denumire: denumiri[cod] || null, nr_persoane: persoane[cod] || null }));

  const { data: entitate } = await supabaseAdmin
    .from('entitati_juridice_platforma')
    .select('denumire, cui, nr_reg_com, adresa, iban')
    .eq('tara_cod', tara)
    .maybeSingle();

  return {
    partner,
    entitate: entitate || null,
    reprezentant,
    contact: { email: profil.email || (authR.data && authR.data.user && authR.data.user.email) || null, telefon: profil.phone || null },
    tara,
    procente,
    portofoliu: {
      servicii,
      caen: [...caenMap.values()].sort((a, b) => Number(b.principal) - Number(a.principal) || a.cod.localeCompare(b.cod)),
      competente,
      certificari: (certR.data || []).map((c) => (c.data_expirare ? `${c.tip_certificare} (valabil până la ${c.data_expirare})` : c.tip_certificare)),
      vehicule: utilR.data || [],
      zone: zonaR.data || [],
      polite: politeR.data || [],
    },
    semnat: partner.contract_semnat ? { la: partner.contract_semnat_la, versiune: partner.contract_versiune } : null,
  };
}

async function genereazaContractPartener(partnerId, { semnatLa } = {}) {
  const date = await incarcaDateContract(partnerId);
  if (!date) return null;
  if (semnatLa) date.semnat = { la: semnatLa, versiune: CONTRACT_VERSIUNE };
  return genereazaContract(date);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

module.exports = { incarcaDateContract, genereazaContractPartener, sha256 };
