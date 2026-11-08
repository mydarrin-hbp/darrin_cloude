// lib/investitori-panou.js
// Calculele panoului investitorului (pasul 11-I1, 8 nov. 2026), doar pe server.
//
// Lock-up-ul pornește de la data aprobării subscrierii (aprobat_la) și ține
// lock_up_luni din runda ei. Acțiunile se pot vinde doar din subscrieri
// aprobate, în runde cu buy-back configurat (discount_buyback_pct), după
// lock-up. Fără data aprobării, sfârșitul lock-up-ului nu se poate calcula,
// deci acțiunile nu apar ca vandabile.

const R = require('./runda-finantare');

// Regula LM (8 nov. 2026): orice cerere de exit ține acțiunile ocupate, în afară de
// cele anulate sau respinse. Rămâne așa până când back-office-ul va scădea acțiunile
// vândute din participații; altfel, aceleași acțiuni s-ar putea cere din nou.
const STARI_EXIT_ELIBERATE = Object.freeze(['anulat', 'respins']);

// Luni calendaristice, în UTC; 31 ian. + 1 lună = ultima zi din februarie.
function adunaLuni(data, luni) {
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return null;
  const zi = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + luni);
  const ultimaZi = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(zi, ultimaZi));
  return d;
}

// { sfarsit_lock_up: ISO | null, actiuni_vandabile_acum } pentru o subscriere.
function situatieSubscriere(sub, runda, acum) {
  const rezultat = { sfarsit_lock_up: null, actiuni_vandabile_acum: 0 };
  if (!sub || sub.status !== 'aprobat') return rezultat;
  const lock = runda ? R.num(runda.lock_up_luni) : null;
  const sfarsit = lock != null && sub.aprobat_la ? adunaLuni(sub.aprobat_la, lock) : null;
  if (sfarsit) rezultat.sfarsit_lock_up = sfarsit.toISOString();
  if (!runda || R.num(runda.discount_buyback_pct) == null) return rezultat;
  if (lock != null && (!sfarsit || sfarsit > (acum || new Date()))) return rezultat;
  rezultat.actiuni_vandabile_acum = Number(sub.actiuni) || 0;
  return rezultat;
}

// „Acțiuni disponibile acum”, singurul loc de calcul (POST exit, portofoliul și, prin
// el, panoul). subscrieri: rândurile utilizatorului; runde: { id → rundă }; cereri:
// cererile lui de exit.
function actiuniDisponibile(subscrieri, runde, cereri, acum) {
  const vandabile = (subscrieri || []).reduce((s, x) => {
    const runda = x.runda_id && runde ? runde[x.runda_id] : null;
    return s + situatieSubscriere(x, runda, acum).actiuni_vandabile_acum;
  }, 0);
  const ocupate = (cereri || [])
    .filter((c) => !STARI_EXIT_ELIBERATE.includes(c.status))
    .reduce((s, c) => s + (Number(c.numar_actiuni) || 0), 0);
  return Math.max(0, vandabile - ocupate);
}

module.exports = { STARI_EXIT_ELIBERATE, adunaLuni, situatieSubscriere, actiuniDisponibile };
