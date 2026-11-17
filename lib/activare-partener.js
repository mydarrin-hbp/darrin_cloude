// lib/activare-partener.js
// Lista „Activează contul” din dashboard-ul partenerului (pasul 11-R3,
// decizia LM din 2 nov. 2026). După codul de 6 cifre, partenerul ajunge în
// dashboard-ul rolului ales (profiles.rol_solicitat) și completează acolo tot
// ce era în fereastra publică „Devino partener”, în ordine:
//   1. firma           — pasul 2 din „Completare profil partener” (wizard-companie);
//                        la salvare serverul creează partenerul și adaugă rolul;
//   2. cont_bancar     — IBAN, banca, contul de trezorerie (conturi-bancare);
//   3. profesii        — profesiile (codurile NACE, wizard-nace); la curier, zonele
//                        de livrare (zona-curier);
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
// Corecția 11-R3 (2 nov. 2026): activarea e un flux pe pași (activare-pasi.js).
// complet = pașii 1–5 făcuți (firma și documentele pot fi „în verificare”) și
// contractul semnat sau încă de neconceput (firma nu e aprobată: contractul se
// semnează după verificarea echipei). Cât timp nu e complet, dashboard-ul
// deschide fluxul la primul pas nefăcut.
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

// Pasul 12-P1: în plus, documentele respinse (status 'respins', cu observațiile
// verificării, dacă există), pentru starea „Necesită completări”.
async function stareDocumente(id) {
  const { data, error } = await supabaseAdmin.from('documente_partener').select('status, observatii').eq('partener_id', id);
  if (error || !data || !data.length) return { stare: 'de_completat', respins: false, motiv: null };
  const respinse = data.filter((d) => d.status === 'respins' || d.status === 'rejected');
  const motiv = (respinse.find((d) => d.observatii) || {}).observatii || null;
  let stare = 'de_completat';
  if (data.some((d) => d.status === 'pending')) stare = 'in_verificare';
  else if (data.some((d) => d.status === 'approved' || d.status === 'aprobat')) stare = 'completat';
  // Respins = niciun document încă în verificare sau aprobat după respingere.
  return { stare, respins: respinse.length > 0 && stare === 'de_completat', motiv: motiv ? String(motiv).slice(0, 500) : null };
}

// ── Pasul 12-P1 (17 nov. 2026): starea contului de partener ─────────────
// Sursa unică pentru panoul „cont nou” (mydarrin-dashboard-partener.html) și
// pentru /api/cont/profil. Doar afișare: regulile de acces și de comenzi
// (accept-comanda, eligibilitatea, publicarea produselor) nu se schimbă.
//   Cont creat → Profil incomplet → În verificare → Activ, plus
//   „Necesită completări” când firma sau un document au fost respinse.
// Rândurile listei „Ce mai ai de făcut” (6, cu „Cont creat”, mereu făcut):
//   cont_creat · firma · cont_bancar · profesii_dotari (profesii + dotări) ·
//   documente · contract.
const RANDURI_CONT = Object.freeze(['cont_creat', 'firma', 'cont_bancar', 'profesii_dotari', 'documente', 'contract']);

/**
 * @param {object|null} act  rezultatul stareActivare (pasi, activ, verificare)
 * @param {{ motivFirma?: string|null, motivDocumente?: string|null, documenteRespinse?: boolean }} [extra]
 * @returns {null|{ stare: 'cont_creat'|'profil_incomplet'|'in_verificare'|'necesita_completari'|'activ',
 *   pasi_facuti: number, total: 6, motiv: string|null,
 *   randuri: Array<{ cheie, stare: 'facut'|'in_verificare'|'de_completat'|'respins'|'blocat'|'dupa_verificare', pas: number|null }>,
 *   urmatorul: string|null }}
 */
function stareContPartener(act, extra) {
  if (!act || !Array.isArray(act.pasi)) return null;
  const e = extra || {};
  const dupa = {};
  act.pasi.forEach((x) => { dupa[x.cheie] = x.stare; });
  const randFirma = act.verificare === 'rejected' ? 'respins' : (dupa.firma === 'completat' ? 'facut' : dupa.firma === 'in_verificare' ? 'in_verificare' : 'de_completat');
  const unul = (st) => (st === 'completat' ? 'facut' : st === 'in_verificare' ? 'in_verificare' : st === 'blocat' ? 'blocat' : st === 'dupa_verificare' ? 'dupa_verificare' : 'de_completat');
  const prof = unul(dupa.profesii), dot = unul(dupa.dotari);
  let profDot;
  if (prof === 'facut' && dot === 'facut') profDot = 'facut';
  else if (prof === 'blocat' && dot === 'blocat') profDot = 'blocat';
  else profDot = 'de_completat';
  const randDoc = e.documenteRespinse ? 'respins' : unul(dupa.documente);
  const randuri = [
    { cheie: 'cont_creat', stare: 'facut', pas: null },
    { cheie: 'firma', stare: randFirma, pas: 1 },
    { cheie: 'cont_bancar', stare: unul(dupa.cont_bancar), pas: 2 },
    // Profesii și dotări: deschide primul dintre cei doi pași încă nefăcut.
    { cheie: 'profesii_dotari', stare: profDot, pas: prof !== 'facut' ? 3 : 4 },
    { cheie: 'documente', stare: randDoc, pas: 5 },
    { cheie: 'contract', stare: unul(dupa.contract), pas: 6 },
  ];
  const gata = (r) => r.stare === 'facut' || r.stare === 'in_verificare';
  const pasiFacuti = randuri.filter(gata).length;
  let stare;
  let motiv = null;
  if (act.activ) stare = 'activ';
  else if (randFirma === 'respins' || randDoc === 'respins') {
    stare = 'necesita_completari';
    motiv = randFirma === 'respins' ? (e.motivFirma || null) : (e.motivDocumente || null);
  } else if (randuri.slice(1, 5).every(gata) && (randuri[5].stare === 'facut' || randuri[5].stare === 'dupa_verificare')) stare = 'in_verificare';
  else stare = 'profil_incomplet';
  // Primul rând care se poate face acum (nu blocat, nu în verificare, nu după verificare).
  const urm = randuri.find((r) => r.stare === 'de_completat' || r.stare === 'respins');
  return { stare, pasi_facuti: pasiFacuti, total: 6, motiv, randuri, urmatorul: urm ? urm.cheie : null };
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
// Pasul 11-I3: opt.partener = eligibilitatea deja citită de apelant
// (eligibilitatePartener(userId), poate fi null) — fără a doua citire.
async function stareActivare(userId, ctx, opt) {
  const roles = (ctx && ctx.roles) || [];
  const p = opt && Object.prototype.hasOwnProperty.call(opt, 'partener') ? opt.partener : await eligibilitatePartener(userId);
  const rolActiv = p ? ROL_DUPA_TIP_PARTENER[p.partner_type] : roles.find(esteRolPartener);
  const rol = rolActiv || (esteRolPartener(ctx && ctx.rolSolicitat) ? ctx.rolSolicitat : null);
  if (!rol) return null;
  const tip = TIP_DUPA_ROL[rol];
  const areRol = roles.includes(rol);

  // Înainte de firmă (fără rând în partners): doar primul pas e deschis.
  if (!p) {
    const inainte = {
      rol, tip, mod_activare: !areRol, verificare: null, activ: false, complet: false,
      pasi: PASI.map((cheie) => ({ cheie, stare: cheie === 'firma' ? 'de_completat' : 'blocat', deschide: deschide(cheie, tip, {}) })),
    };
    inainte.stare_cont = stareContPartener(inainte);
    return inainte;
  }

  const id = userId;
  const [nace, clauza, zonaCurier, utilaje, angajati, polite, produse, doc] = await Promise.all([
    tip !== 'curier' ? numara('partner_coduri_nace', 'partner_id', id) : 0,
    tip !== 'curier' ? numara('partner_alocari_sarcini', 'partner_id', id, { zona_livrare_acceptata: true }) : 0,
    tip === 'curier' ? numara('partner_zona_curier', 'partner_id', id, { activ: true }) : 0,
    tip === 'servicii' || tip === 'curier' ? numara('partner_utilaje', 'partner_id', id) : 0,
    tip === 'servicii' ? numara('partner_angajati', 'partner_id', id) : 0,
    tip === 'asigurari' ? numara('partner_tipuri_polita', 'partner_id', id, { activ: true }) : 0,
    tip === 'materiale' ? numara('marketplace_materiale', 'furnizor_id', id) : tip === 'inchirieri' ? numara('marketplace_echipamente', 'furnizor_id', id) : 0,
    stareDocumente(id),
  ]);
  const documente = doc.stare;
  const propriu = !!p.furnizor_propriu || !!p.entitate_platforma_id;

  const stari = { nace: nace > 0 };
  const verificare = p.status_verificare || 'pending_review';
  const firma = verificare === 'approved' ? 'completat' : verificare === 'rejected' ? 'de_completat' : 'in_verificare';
  const contBancar = propriu || p.cont_bancar ? 'completat' : 'de_completat';
  const profesii = tip === 'curier' ? zonaCurier > 0 : nace > 0;
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
  const facut = (x) => x.stare === 'completat' || x.stare === 'in_verificare';
  // Contractul se poate semna doar după aprobare (contract-trimite-otp.js).
  if (verificare !== 'approved' && contract !== 'completat') pasi[5].stare = 'dupa_verificare';
  const rez = {
    rol, tip, mod_activare: !areRol, verificare,
    activ: !!p.poate_vinde,
    complet: pasi.slice(0, 5).every(facut) && (pasi[5].stare === 'completat' || pasi[5].stare === 'dupa_verificare'),
    pasi,
  };
  // Pasul 12-P1: starea contului (motivul respingerii firmei îl adaugă /api/cont/profil).
  rez.stare_cont = stareContPartener(rez, { documenteRespinse: doc.respins, motivDocumente: doc.motiv });
  return rez;
}

module.exports = { TIP_DUPA_ROL, ROLURI_PARTENER, PASI, RANDURI_CONT, esteRolPartener, stareActivare, stareContPartener };
