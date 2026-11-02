// lib/activare-partener.js
// Lista „Activează contul” din dashboard-ul partenerului (pasul 11-R3,
// decizia LM din 2 nov. 2026). După codul de 6 cifre, partenerul ajunge în
// dashboard-ul rolului ales (profiles.rol_solicitat) și completează acolo tot
// ce era în fereastra publică „Devino partener”, în ordine:
//   1. firma           — pasul 2 din „Completare profil partener” (wizard-companie);
//                        la salvare serverul creează partenerul și adaugă rolul;
//   2. cont_bancar     — IBAN, banca, contul de trezorerie (conturi-bancare);
//   3. profesii        — profesii, servicii și zone, după tipul de partener;
//   4. dotari          — dotări, utilaje, angajați, certificări / polițe / catalog;
//   5. documente       — „Documentele mele” (documente_partener);
//   6. contract        — semnarea cu OTP (contract-*).
// Apoi: verificarea echipei (cel mult 48 de ore); contul devine „Partener
// activ” după regula unică din lib/eligibilitate-partener.js.
//
// Starea fiecărui punct vine din tabelele reale (aceleași pe care le scriu
// endpoint-urile pașilor), niciodată din user_metadata:
//   'de_completat' | 'completat' | 'in_verificare' | 'blocat' (până la firmă).
// La o eroare de citire, punctul rămâne „de completat” — fără stări inventate.
//
// Doar pentru afișare: accesul îl decide serverul din profiles.roles.

const { supabaseAdmin } = require('./supabaseAdmin');
const { eligibilitatePartener } = require('./eligibilitate-partener');
const { ROL_DUPA_TIP_PARTENER } = require('./roluri-partener');

// Rolul de partener → tipul scurt (?type= din dashboard și „Devino partener”).
const TIP_DUPA_ROL = Object.freeze({
  partener_servicii: 'servicii',
  partener_materiale: 'materiale',
  partener_inchirieri: 'inchirieri',
  partener_curier: 'curier',
  partener_asigurari: 'asigurari',
});
const ROLURI_PARTENER = Object.freeze(Object.keys(TIP_DUPA_ROL));
const PASI = Object.freeze(['firma', 'cont_bancar', 'profesii', 'dotari', 'documente', 'contract']);

function esteRolPartener(rol) { return ROLURI_PARTENER.includes(rol); }

async function numara(tabel, coloana, id, filtre) {
  let q = supabaseAdmin.from(tabel).select('id', { count: 'exact', head: true }).eq(coloana, id);
  Object.entries(filtre || {}).forEach(([k, v]) => { q = q.eq(k, v); });
  const { count, error } = await q;
  if (error) { console.warn(`[activare-partener] ${tabel}:`, error.message || error); return 0; }
  return count || 0;
}

async function stareDocumente(id) {
  const { data, error } = await supabaseAdmin.from('documente_partener').select('status').eq('partener_id', id);
  if (error || !data || !data.length) return 'de_completat';
  if (data.some((d) => d.status === 'pending')) return 'in_verificare';
  if (data.some((d) => d.status === 'approved' || d.status === 'aprobat')) return 'completat';
  return 'de_completat';
}

// Unde se deschide fiecare pas, după tipul de partener. wizard = pasul din
// mydarrin-devino-partener-wizard.html; panou = secțiunea din dashboard;
// actiune = fereastra comună din cont-dashboard.js (cont bancar, contract).
function deschide(cheie, tip, stari) {
  switch (cheie) {
    case 'firma': return { tip: 'wizard', pas: 2 };
    case 'cont_bancar': return { tip: 'actiune', cheie: 'cont_bancar' };
    case 'profesii':
      if (tip === 'curier') return { tip: 'panou', id: 'zona-acoperire' };
      if (tip === 'servicii') return { tip: 'wizard', pas: stari.nace ? 7 : 3 };
      return { tip: 'wizard', pas: 7 };
    case 'dotari':
      if (tip === 'asigurari') return { tip: 'panou', id: 'tipuri-polita' };
      if (tip === 'materiale') return { tip: 'panou', id: 'produse' };
      if (tip === 'inchirieri') return { tip: 'panou', id: 'echipamente' };
      return { tip: 'wizard', pas: 4 };
    case 'documente': return { tip: 'panou', id: 'documente' };
    case 'contract': return { tip: 'actiune', cheie: 'contract' };
    default: return null;
  }
}

/**
 * Starea listei „Activează contul” pentru un cont.
 * @param {string} userId
 * @param {{ roles?: string[], rolSolicitat?: string|null }} ctx
 * @returns {Promise<null|{ rol, tip, mod_activare, verificare, activ, complet, pasi: Array<{cheie, stare, deschide}> }>}
 *   null = contul nu are nici rol de partener, nici rol de partener ales.
 */
async function stareActivare(userId, ctx) {
  const roles = (ctx && ctx.roles) || [];
  const p = await eligibilitatePartener(userId);
  const rolActiv = p ? ROL_DUPA_TIP_PARTENER[p.partner_type] : roles.find(esteRolPartener);
  const rol = rolActiv || (esteRolPartener(ctx && ctx.rolSolicitat) ? ctx.rolSolicitat : null);
  if (!rol) return null;
  const tip = TIP_DUPA_ROL[rol];
  const areRol = roles.includes(rol);

  // Înainte de firmă (fără rând în partners): doar primul pas e deschis.
  if (!p) {
    return {
      rol, tip, mod_activare: !areRol, verificare: null, activ: false, complet: false,
      pasi: PASI.map((cheie) => ({ cheie, stare: cheie === 'firma' ? 'de_completat' : 'blocat', deschide: deschide(cheie, tip, {}) })),
    };
  }

  const id = userId;
  const [nace, clauza, zonaCurier, utilaje, angajati, polite, produse, documente] = await Promise.all([
    tip === 'servicii' ? numara('partner_coduri_nace', 'partner_id', id) : 0,
    tip !== 'curier' ? numara('partner_alocari_sarcini', 'partner_id', id, { zona_livrare_acceptata: true }) : 0,
    tip === 'curier' ? numara('partner_zona_curier', 'partner_id', id, { activ: true }) : 0,
    tip === 'servicii' || tip === 'curier' ? numara('partner_utilaje', 'partner_id', id) : 0,
    tip === 'servicii' ? numara('partner_angajati', 'partner_id', id) : 0,
    tip === 'asigurari' ? numara('partner_tipuri_polita', 'partner_id', id, { activ: true }) : 0,
    tip === 'materiale' ? numara('marketplace_materiale', 'furnizor_id', id) : tip === 'inchirieri' ? numara('marketplace_echipamente', 'furnizor_id', id) : 0,
    stareDocumente(id),
  ]);
  const propriu = !!p.furnizor_propriu || !!p.entitate_platforma_id;

  const stari = { nace: nace > 0 };
  const verificare = p.status_verificare || 'pending_review';
  const firma = verificare === 'approved' ? 'completat' : verificare === 'rejected' ? 'de_completat' : 'in_verificare';
  const contBancar = propriu || p.cont_bancar ? 'completat' : 'de_completat';
  let profesii;
  if (tip === 'curier') profesii = zonaCurier > 0;
  else if (tip === 'servicii') profesii = nace > 0 && (propriu || clauza > 0);
  else profesii = propriu || clauza > 0;
  let dotari;
  if (tip === 'asigurari') dotari = polite > 0;
  else if (tip === 'materiale' || tip === 'inchirieri') dotari = produse > 0;
  else if (tip === 'servicii') dotari = utilaje > 0 || angajati > 0;
  else dotari = utilaje > 0;
  const contract = propriu || p.contract_semnat ? 'completat' : 'de_completat';

  const valori = {
    firma, cont_bancar: contBancar,
    profesii: profesii ? 'completat' : 'de_completat',
    dotari: dotari ? 'completat' : 'de_completat',
    documente, contract,
  };
  const pasi = PASI.map((cheie) => ({ cheie, stare: valori[cheie], deschide: deschide(cheie, tip, stari) }));
  return {
    rol, tip, mod_activare: !areRol, verificare,
    activ: !!p.poate_vinde,
    complet: pasi.every((x) => x.stare === 'completat' || (x.cheie === 'firma' && x.stare === 'in_verificare') || (x.cheie === 'documente' && x.stare === 'in_verificare')),
    pasi,
  };
}

module.exports = { TIP_DUPA_ROL, ROLURI_PARTENER, PASI, esteRolPartener, stareActivare };
