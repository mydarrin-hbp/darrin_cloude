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

// Instrumentele pe care LM le poate configura într-o rundă.
const INSTRUMENTE = ['actiuni', 'safe', 'nota_convertibila'];
const CAMPURI_CALCULATE = ['post_money', 'pret_actiune', 'equity_oferit_pct', 'actiuni_noi'];

function text(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function data(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }

// Validează și curăță câmpurile introduse. Întoarce { rand } sau { eroare }.
function curata(r) {
  const e = (m) => ({ eroare: m });
  const cod = text(r.cod, 40).toLowerCase();
  if (!/^[a-z0-9_]{2,40}$/.test(cod)) return e('Codul rundei: litere mici, cifre și „_” (ex. seed, series_a).');
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
  if (!rand.denumire_ro || !rand.denumire_en) return e('Denumirea rundei, în română și în engleză.');
  if (!/^[A-Z]{3}$/.test(rand.moneda)) return e('Moneda: cod de 3 litere (ex. EUR).');
  if (!(rand.evaluare_pre_money > 0)) return e('Evaluarea pre-money trebuie să fie mai mare decât 0.');
  if (!(rand.suma_tinta > 0)) return e('Suma țintă trebuie să fie mai mare decât 0.');
  if (!(rand.actiuni_existente > 0) || !Number.isInteger(rand.actiuni_existente)) return e('Acțiunile existente: un număr întreg mai mare decât 0.');
  if (rand.investitie_minima != null && !(rand.investitie_minima > 0 && rand.investitie_minima <= rand.suma_tinta)) return e('Investiția minimă: mai mare decât 0 și cel mult suma țintă.');
  if (rand.tickete.some((t) => !(t > 0) || t > rand.suma_tinta || (rand.investitie_minima != null && t < rand.investitie_minima))) return e('Ticketele: între investiția minimă și suma țintă.');
  if (rand.data_start && rand.data_sfarsit && rand.data_sfarsit < rand.data_start) return e('Data de sfârșit nu poate fi înaintea celei de început.');
  if (!rand.instrumente.length) return e('Alege cel puțin un instrument.');
  if (rand.lock_up_luni != null && !(Number.isInteger(rand.lock_up_luni) && rand.lock_up_luni >= 0)) return e('Lock-up: număr întreg de luni (0 sau mai mult), sau gol.');
  if (rand.discount_buyback_pct != null && !(rand.discount_buyback_pct >= 0 && rand.discount_buyback_pct < 100)) return e('Discountul de buy-back: între 0 și 100%, sau gol.');
  if (!R.calculeaza(rand)) return e('Datele rundei nu permit calculul prețului pe acțiune.');
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
    if (!(await arePermisiuneInvestitori(user))) return res.status(403).json({ error: 'Nu ai drept pe secțiunea Investitori.' });
    if (req.method === 'GET') return lista(res);
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { actiune, runda, id } = req.body || {};

    if (actiune === 'calcul') {
      const c = R.calculeaza(runda || {});
      return res.status(200).json({ ok: true, calcul: c });
    }

    if (actiune === 'salveaza') {
      const { rand, eroare } = curata(runda || {});
      if (eroare) return res.status(400).json({ error: eroare });
      const acum = new Date().toISOString();
      let salvata;
      if (runda.id) {
        const veche = await citeste(runda.id);
        if (!veche) return res.status(404).json({ error: 'Runda nu există.' });
        const { data, error } = await supabaseAdmin.from('runde_finantare')
          .update({ ...rand, actualizat_de: user.id, updated_at: acum }).eq('id', runda.id).select('*').single();
        if (error) throw error;
        salvata = data;
        await inregistreazaAudit({ admin: user, actiune: 'runda_modificata', entitate: 'runde_finantare', entitate_id: runda.id,
          detalii: { inainte: Object.fromEntries(Object.keys(rand).map((k) => [k, veche[k]])), dupa: rand }, req });
      } else {
        const { data: exista } = await supabaseAdmin.from('runde_finantare').select('id').eq('cod', rand.cod).maybeSingle();
        if (exista) return res.status(409).json({ error: 'Există deja o rundă cu acest cod.' });
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
      if (!id) return res.status(400).json({ error: 'id obligatoriu.' });
      const r = await citeste(id);
      if (!r) return res.status(404).json({ error: 'Runda nu există.' });
      if (actiune === 'deschide') {
        const { data: deschise, error } = await supabaseAdmin.from('runde_finantare').select('id, denumire_ro').eq('stare', 'deschisa');
        if (error) throw error;
        const alta = (deschise || []).find((x) => x.id !== id);
        if (alta) {
          return res.status(409).json({ error: `Runda „${alta.denumire_ro}” e deja deschisă. Închide-o înainte să deschizi alta.`, cod: 'ALTA_DESCHISA', deschisa: alta });
        }
        if (!R.calculeaza(r)) return res.status(400).json({ error: 'Runda nu are datele complete; completează-le înainte să o deschizi.' });
      }
      const stare = actiune === 'deschide' ? 'deschisa' : 'inchisa';
      const { data, error } = await supabaseAdmin.from('runde_finantare')
        .update({ stare, actualizat_de: user.id, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
      if (error) throw error;
      await inregistreazaAudit({ admin: user, actiune: actiune === 'deschide' ? 'runda_deschisa' : 'runda_inchisa', entitate: 'runde_finantare', entitate_id: id, detalii: { stare_veche: r.stare, stare_noua: stare }, req });
      return res.status(200).json({ ok: true, runda: cuCalcul(data) });
    }

    return res.status(400).json({ error: 'actiune: calcul | salveaza | deschide | inchide' });
  } catch (err) {
    console.error('[admin/runde-finantare]', err);
    if (R.tabelaLipsa(err)) return res.status(503).json({ error: 'Tabela runde_finantare lipsește: aplică migrarea 2026-10-21_runde_finantare.sql.' });
    return res.status(500).json({ error: err.message || 'Eroare internă.' });
  }
}

module.exports = requireAuth(['admin', 'superadmin'], handler);
module.exports.INSTRUMENTE = INSTRUMENTE;
