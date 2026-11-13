// lib/palnie.js
// Pasul 11-A1 (13 nov. 2026): momentele pâlniei „Devino partener”, păstrate pe
// server în palnie_evenimente (migrarea 2026-11-13_masurare_palnie.sql), pentru
// raportul intern api/admin/palnie-parteneri.
//
// Un singur rând pe cont, eveniment și pas (indexul unic): prima dată când
// serverul vede pasul făcut. Starea pașilor vine din tabelele reale
// (lib/activare-partener.js → stareActivare), nu din browser.
//
// Nicio dată personală: id-ul contului, numele pasului și data.
// Totul e „cel mai bun efort”: fără tabel (migrarea neaplicată) sau la o
// eroare, nu se oprește nimic din cererea care l-a apelat.

const { supabaseAdmin } = require('./supabaseAdmin');

// Pașii din lib/activare-partener.js → numele stabile, în engleză.
const PAS_EVENIMENT = Object.freeze({
  firma: 'company_details',
  cont_bancar: 'bank_account',
  profesii: 'trades',
  dotari: 'equipment',
  documente: 'documents',
  contract: 'contract',
});
const EVENIMENTE = Object.freeze(['email_confirmed', 'partner_step_completed', 'partner_activation_completed']);

let tabelLipsa = false;
// Ce a fost deja scris de această instanță: /api/cont/profil se cere des, iar
// un moment se scrie o singură dată (fără cereri inutile la fiecare încărcare).
const scrise = new Set();
const MAX_SCRISE = 5000;

function esteTabelLipsa(err) {
  const cod = err && err.code;
  const m = String((err && err.message) || '');
  return cod === '42P01' || cod === 'PGRST205' || (/palnie_evenimente/.test(m) && /not (exist|find)/i.test(m));
}

/**
 * Rândurile de scris pentru starea activării unui cont.
 * Un pas contează când e „completat” sau „în verificare” (trimis de partener).
 * @param {null|{complet:boolean, pasi:Array<{cheie:string, stare:string}>}} activare
 * @returns {Array<{eveniment:string, pas:string}>}
 */
function randuriDinActivare(activare) {
  if (!activare || !Array.isArray(activare.pasi)) return [];
  const r = activare.pasi
    .filter((p) => PAS_EVENIMENT[p.cheie] && (p.stare === 'completat' || p.stare === 'in_verificare'))
    .map((p) => ({ eveniment: 'partner_step_completed', pas: PAS_EVENIMENT[p.cheie] }));
  if (activare.complet) r.push({ eveniment: 'partner_activation_completed', pas: '' });
  return r;
}

/**
 * Scrie momentele încă nescrise (cele existente rămân cu data lor).
 * @param {string} userId
 * @param {Array<{eveniment:string, pas?:string, la?:string}>} randuri
 * @param {{ client?: object }} [opt] client Supabase (pentru teste)
 * @returns {Promise<number>} câte rânduri au fost trimise
 */
async function inregistreaza(userId, randuri, opt) {
  const sb = (opt && opt.client) || supabaseAdmin;
  if (tabelLipsa || !userId || !Array.isArray(randuri) || !randuri.length) return 0;
  const rows = randuri
    .filter((x) => x && EVENIMENTE.includes(x.eveniment) && !scrise.has(userId + '|' + x.eveniment + '|' + (x.pas || '')))
    .map((x) => {
      const rand = { user_id: userId, eveniment: x.eveniment, pas: x.pas || '' };
      if (x.la) rand.creat_la = x.la;
      return rand;
    });
  if (!rows.length) return 0;
  try {
    const { error } = await sb.from('palnie_evenimente')
      .upsert(rows, { onConflict: 'user_id,eveniment,pas', ignoreDuplicates: true });
    if (error) {
      if (esteTabelLipsa(error)) { tabelLipsa = true; return 0; }
      console.warn('[palnie] scriere:', error.message || error);
      return 0;
    }
    if (scrise.size > MAX_SCRISE) scrise.clear();
    rows.forEach((r) => scrise.add(userId + '|' + r.eveniment + '|' + r.pas));
    return rows.length;
  } catch (e) {
    console.warn('[palnie] scriere:', e.message || e);
    return 0;
  }
}

/** Pașii activării, din starea calculată de stareActivare(). */
function inregistreazaActivare(userId, activare, opt) {
  return inregistreaza(userId, randuriDinActivare(activare), opt);
}

/** Emailul confirmat, cu data reală a confirmării. */
function inregistreazaEmailConfirmat(user, opt) {
  if (!user || !user.email_confirmed_at) return Promise.resolve(0);
  return inregistreaza(user.id, [{ eveniment: 'email_confirmed', pas: '', la: user.email_confirmed_at }], opt);
}

module.exports = {
  PAS_EVENIMENT, EVENIMENTE, randuriDinActivare,
  inregistreaza, inregistreazaActivare, inregistreazaEmailConfirmat,
  _reseteaza() { tabelLipsa = false; scrise.clear(); },
};
