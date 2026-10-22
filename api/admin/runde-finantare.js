// /api/admin/runde-finantare.js
// Rundele de finanțare din back-office (pasul 11-J, 21 oct. 2026; decizia LM
// C2): superadminul și adminii cu drept pe secțiunea Investitori
// (lib/permisiuni-investitori.js) creează, modifică, deschid și închid
// rundele. Cifrele le introduce LM; valorile calculate vin din
// lib/runda-finantare.js (aceleași formule ca în coloanele generate).
// Fiecare schimbare se auditează (audit_log).
//
// GET                                   → { ok, runde: [...], deschisa_id }
// POST { actiune: 'calcul', runda }     → { ok, calcul }   previzualizare, fără scriere
// POST { actiune: 'salveaza', runda }   → { ok, runda }    creare (fără id) sau modificare
// POST { actiune: 'deschide', id }      → { ok, runda }    409 dacă e deja altă rundă deschisă
// POST { actiune: 'inchide', id }       → { ok, runda }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { arePermisiuneInvestitori } = require('../../lib/permisiuni-investitori');
const R = require('../../lib/runda-finantare');
const { trimiteEroare, camp, formaComuna } = require('../../lib/raspuns-eroare');

// Instrumentele pe care LM le poate configura într-o rundă.
const INSTRUMENTE = ['actiuni', 'safe', 'nota_convertibila'];
const CAMPURI_CALCULATE = ['post_money', 'pret_actiune', 'equity_oferit_pct', 'actiuni_noi'];

function text(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function data(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }

// Validează și curăță câmpurile introduse. Întoarce { rand } sau
// { campuri } (toate câmpurile greșite, cu ce trebuie făcut — pasul 11-N1).
function curata(r) {
  const campuri = [];
  const e = (nume, ro, en) => campuri.push(camp(nume, ro, en));
  const cod = text(r.cod, 40).toLowerCase();
  if (!/^[a-z0-9_]{2,40}$/.test(cod)) e('cod', 'Completați «Cod»: litere mici, cifre și „_” (ex. seed, series_a).', 'Fill in «Code»: lowercase letters, digits and “_” (e.g. seed, series_a).');
  const rand = {
    cod,
    denumire_ro: text(r.denumire_ro, 80), denumire_en: text(r.denumire_en, 80),
    descriere_ro: text(r.descriere_ro, 400) || null, descriere_en: text(r.descriere_en, 400) || null,
    moneda: text(r.moneda, 3).toUpperCase() || 'EUR',
    evaluare_pre_money: R.num(r.evaluare_pre_money), suma_tinta: R.num(r.suma_tinta), actiuni_existente: R.num(r.actiuni_existente),
    investitie_minima: R.num(r.investitie_minima),
    tickete: Array.isArray(r.tickete) ? r.tickete.map(R.num).filter((x) => x != null) : [],
    data_start: data(r.data_start), data_sfarsit: data(r.data_sfarsit),
    instrumente: Array.isArray(r.instrumente) ? r.instrumente.filter((x) => INSTRUMENTE.includes(x)) : [],
    lock_up_luni: R.num(r.lock_up_luni), discount_buyback_pct: R.num(r.discount_buyback_pct),
    afiseaza_progres: r.afiseaza_progres === true, vizibila_public: r.vizibila_public === true,
  };
  if (!rand.denumire_ro) e('denumire_ro', 'Completați «Denumire (RO)».', 'Please fill in «Name (RO)».');
  if (!rand.denumire_en) e('denumire_en', 'Completați «Denumire (EN)».', 'Please fill in «Name (EN)».');
  if (!/^[A-Z]{3}$/.test(rand.moneda)) e('moneda', 'Moneda: cod de 3 litere (ex. EUR).', 'Currency: a 3-letter code (e.g. EUR).');
  if (!(rand.evaluare_pre_money > 0)) e('evaluare_pre_money', 'Evaluarea pre-money trebuie să fie mai mare decât 0.', 'The pre-money valuation must be greater than 0.');
  if (!(rand.suma_tinta > 0)) e('suma_tinta', 'Suma țintă trebuie să fie mai mare decât 0.', 'The target amount must be greater than 0.');
  if (!(rand.actiuni_existente > 0) || !Number.isInteger(rand.actiuni_existente)) e('actiuni_existente', 'Acțiunile existente: un număr întreg mai mare decât 0.', 'Existing shares: a whole number greater than 0.');
  if (rand.investitie_minima != null && !(rand.investitie_minima > 0 && rand.investitie_minima <= rand.suma_tinta)) e('investitie_minima', 'Investiția minimă: mai mare decât 0 și cel mult suma țintă.', 'Minimum investment: greater than 0 and at most the target amount.');
  if (rand.tickete.some((t) => !(t > 0) || t > rand.suma_tinta || (rand.investitie_minima != null && t < rand.investitie_minima))) e('tickete', 'Ticketele: între investiția minimă și suma țintă.', 'Tickets: between the minimum investment and the target amount.');
  if (rand.data_start && rand.data_sfarsit && rand.data_sfarsit < rand.data_start) e('data_sfarsit', 'Data de sfârșit nu poate fi înaintea celei de început.', 'The end date cannot be before the start date.');
  if (!rand.instrumente.length) e('instrumente', 'Alege cel puțin un instrument.', 'Choose at least one instrument.');
  if (rand.lock_up_luni != null && !(Number.isInteger(rand.lock_up_luni) && rand.lock_up_luni >= 0)) e('lock_up_luni', 'Lock-up: număr întreg de luni (0 sau mai mult), sau gol.', 'Lock-up: a whole number of months (0 or more), or empty.');
  if (rand.discount_buyback_pct != null && !(rand.discount_buyback_pct >= 0 && rand.discount_buyback_pct < 100)) e('discount_buyback_pct', 'Discountul de buy-back: între 0 și 100%, sau gol.', 'Buy-back discount: between 0 and 100%, or empty.');
  if (campuri.length) return { campuri };
  if (!R.calculeaza(rand)) return { general: ['Datele rundei nu permit calculul prețului pe acțiune.', 'The round data do not allow the share price to be calculated.'] };
  if (!rand.tickete.length) rand.tickete = null;
  return { rand };
}

function cuCalcul(r, totaluri) {
  return { ...r, calcul: R.calculeaza(r), stranse: totaluri || null };
}

async function lista(res) {
  const { data: runde, error } = await supabaseAdmin.from('runde_finantare').select('*').order('created_at', { ascending: false });
  if (error) {
    if (R.tabelaLipsa(error)) return res.status(200).json({ ok: true, runde: [], deschisa_id: null, migrare_lipsa: true });
    throw error;
  }
  const rezultat = [];
  for (const r of runde || []) {
    const aprobate = await R.totaluriRunda(r.id, ['aprobat']);
    const asteptare = await R.totaluriRunda(r.id, ['in_asteptare']);
    rezultat.push(cuCalcul(r, { aprobate, in_asteptare: asteptare }));
  }
  const deschisa = rezultat.find((r) => r.stare === 'deschisa');
  return res.status(200).json({ ok: true, runde: rezultat, deschisa_id: deschisa ? deschisa.id : null });
}

async function citeste(id) {
  const { data, error } = await supabaseAdmin.from('runde_finantare').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function handler(req, res, user) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (!(await arePermisiuneInvestitori(user))) return trimiteEroare(res, 403, 'FARA_DREPT', 'Nu ai drept pe secțiunea Investitori.', 'You do not have rights on the Investors section.');
    if (req.method === 'GET') return lista(res);
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { actiune, runda, id } = req.body || {};

    if (actiune === 'calcul') {
      const c = R.calculeaza(runda || {});
      return res.status(200).json({ ok: true, calcul: c });
    }

    if (actiune === 'salveaza') {
      const { rand, campuri, general } = curata(runda || {});
      if (general) return trimiteEroare(res, 400, 'DATE_INVALIDE', general[0], general[1]);
      if (campuri) {
        return trimiteEroare(res, 400, 'DATE_INVALIDE', campuri.map((c) => c.mesaj.ro).join(' '), campuri.map((c) => c.mesaj.en).join(' '), campuri);
      }
      const acum = new Date().toISOString();
      let salvata;
      if (runda.id) {
        const veche = await citeste(runda.id);
        if (!veche) return trimiteEroare(res, 404, 'NU_EXISTA', 'Runda nu există.', 'The round does not exist.');
        const { data, error } = await supabaseAdmin.from('runde_finantare')
          .update({ ...rand, actualizat_de: user.id, updated_at: acum }).eq('id', runda.id).select('*').single();
        if (error) throw error;
        salvata = data;
        await inregistreazaAudit({ admin: user, actiune: 'runda_modificata', entitate: 'runde_finantare', entitate_id: runda.id,
          detalii: { inainte: Object.fromEntries(Object.keys(rand).map((k) => [k, veche[k]])), dupa: rand }, req });
      } else {
        const { data: exista } = await supabaseAdmin.from('runde_finantare').select('id').eq('cod', rand.cod).maybeSingle();
        if (exista) return trimiteEroare(res, 409, 'COD_EXISTENT', 'Există deja o rundă cu acest cod. Alegeți alt «Cod».', 'A round with this code already exists. Choose another «Code».', [camp('cod', 'Există deja o rundă cu acest cod.', 'A round with this code already exists.')]);
        const { data, error } = await supabaseAdmin.from('runde_finantare')
          .insert({ ...rand, stare: 'planificata', creat_de: user.id, actualizat_de: user.id, created_at: acum, updated_at: acum }).select('*').single();
        if (error) throw error;
        salvata = data;
        await inregistreazaAudit({ admin: user, actiune: 'runda_creata', entitate: 'runde_finantare', entitate_id: salvata.id, detalii: rand, req });
      }
      CAMPURI_CALCULATE.forEach((k) => { if (salvata[k] == null) delete salvata[k]; });
      return res.status(200).json({ ok: true, runda: cuCalcul(salvata) });
    }

    if (actiune === 'deschide' || actiune === 'inchide') {
      if (!id) return trimiteEroare(res, 400, 'DATE_INVALIDE', 'id obligatoriu.', 'id is required.');
      const r = await citeste(id);
      if (!r) return trimiteEroare(res, 404, 'NU_EXISTA', 'Runda nu există.', 'The round does not exist.');
      if (actiune === 'deschide') {
        const { data: deschise, error } = await supabaseAdmin.from('runde_finantare').select('id, denumire_ro').eq('stare', 'deschisa');
        if (error) throw error;
        const alta = (deschise || []).find((x) => x.id !== id);
        if (alta) {
          return trimiteEroare(res, 409, 'ALTA_DESCHISA', `Runda „${alta.denumire_ro}” e deja deschisă. Închide-o înainte să deschizi alta.`, `The round “${alta.denumire_en || alta.denumire_ro}” is already open. Close it before opening another one.`, [], { deschisa: alta });
        }
        if (!R.calculeaza(r)) return trimiteEroare(res, 400, 'DATE_INCOMPLETE', 'Runda nu are datele complete; completează-le înainte să o deschizi.', 'The round data are incomplete; complete them before opening it.');
      }
      const stare = actiune === 'deschide' ? 'deschisa' : 'inchisa';
      const { data, error } = await supabaseAdmin.from('runde_finantare')
        .update({ stare, actualizat_de: user.id, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
      if (error) throw error;
      await inregistreazaAudit({ admin: user, actiune: actiune === 'deschide' ? 'runda_deschisa' : 'runda_inchisa', entitate: 'runde_finantare', entitate_id: id, detalii: { stare_veche: r.stare, stare_noua: stare }, req });
      return res.status(200).json({ ok: true, runda: cuCalcul(data) });
    }

    return trimiteEroare(res, 400, 'DATE_INVALIDE', 'actiune: calcul | salveaza | deschide | inchide', 'actiune: calcul | salveaza | deschide | inchide');
  } catch (err) {
    console.error('[admin/runde-finantare]', err);
    if (R.tabelaLipsa(err)) return trimiteEroare(res, 503, 'MIGRARE_LIPSA', 'Tabela runde_finantare lipsește: aplică migrarea 2026-10-21_runde_finantare.sql.', 'The runde_finantare table is missing: apply the 2026-10-21_runde_finantare.sql migration.');
    return trimiteEroare(res, 500, 'EROARE_SERVER', err.message || 'Eroare internă.', err.message || 'Internal error.');
  }
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
module.exports.INSTRUMENTE = INSTRUMENTE;
