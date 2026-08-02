// /api/marketplace/importa-csv.js
// Import CSV real (înlocuiește handleCSVUpload()/importCSV() 100%
// decorative). Fără Redis/BullMQ (nu există în stack) — procesare pe
// loturi de 300 rânduri/apel, cu status persistat în
// marketplace_importuri_csv; clientul reapelează cu același job_id + cu
// ACELEAȘI rânduri parsate (serverless nu ține stare între apeluri) cât
// timp continua=true.
//
// Rânduri deja parsate client-side (window._mydCSV.parse) — endpoint-ul
// primește JSON, nu fișierul brut.
//
// Admin poate importa pentru MAI MULȚI furnizori într-un singur CSV —
// fiecare rând se rezolvă după `cui_furnizor` (coloană deja documentată
// în UI). Furnizorul își importă mereu doar propriile rânduri (furnizor_id
// fix pe job, ignoră orice cui_furnizor din CSV).
//
// POST { tip:'materiale'|'echipamente', randuri:[...], job_id? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { valideazaMaterial, valideazaEchipament, incarcaContextValidare } = require('../../lib/valideaza-produs-marketplace');

const ROLURI = ['partener_materiale', 'partener_inchirieri', 'admin', 'superadmin'];
const TABEL = { materiale: 'marketplace_materiale', echipamente: 'marketplace_echipamente' };
const MARIME_LOT = 300;

async function esteAdmin(userId) {
  const { data } = await supabaseAdmin.from('profiles').select('roles').eq('id', userId).maybeSingle();
  const roles = data?.roles || [];
  return roles.includes('admin') || roles.includes('superadmin');
}

async function rezolvaFurnizorPentruRand(rand, job) {
  if (job.furnizor_id) return { furnizorId: job.furnizor_id, eroare: null };
  const cui = String(rand.cui_furnizor || '').trim();
  if (!cui) return { furnizorId: null, eroare: 'cui_furnizor lipsă — obligatoriu când importul acoperă mai mulți furnizori' };
  const { data } = await supabaseAdmin.from('partners').select('id').eq('cui', cui).maybeSingle();
  if (!data) return { furnizorId: null, eroare: `Niciun furnizor găsit cu CUI „${cui}"` };
  return { furnizorId: data.id, eroare: null };
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await esteAdmin(user.id);

  const { tip, randuri, job_id } = req.body || {};
  if (!TABEL[tip]) return res.status(400).json({ error: "tip trebuie să fie 'materiale' sau 'echipamente'" });
  if (!Array.isArray(randuri) || !randuri.length) return res.status(400).json({ error: 'randuri (array, ne-gol) este obligatoriu' });

  let job;
  if (job_id) {
    const { data } = await supabaseAdmin.from('marketplace_importuri_csv').select('*').eq('id', job_id).maybeSingle();
    if (!data) return res.status(404).json({ error: 'Job de import inexistent.' });
    if (!admin && data.creat_de !== user.id) return res.status(403).json({ error: 'Acest job nu îți aparține.' });
    job = data;
  } else {
    const { data, error } = await supabaseAdmin.from('marketplace_importuri_csv').insert({
      furnizor_id: admin ? null : user.id,
      tip, creat_de: user.id, randuri_totale: randuri.length,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    job = data;
  }

  const start = job.cursor_pozitie;
  const end = Math.min(start + MARIME_LOT, randuri.length);
  const lot = randuri.slice(start, end);

  const ctxPerFurnizor = new Map();
  async function ctxPentru(furnizorId) {
    if (ctxPerFurnizor.has(furnizorId)) return ctxPerFurnizor.get(furnizorId);
    const { data: profil } = await supabaseAdmin.from('profiles').select('tara').eq('id', furnizorId).maybeSingle();
    const ctx = await incarcaContextValidare(profil?.tara || 'RO');
    ctxPerFurnizor.set(furnizorId, ctx);
    return ctx;
  }

  const eroriLot = [];
  let salvateLot = 0;

  for (let i = 0; i < lot.length; i++) {
    const rand = lot[i];
    const numarRand = start + i + 1;
    const { furnizorId, eroare: eroareFurnizor } = await rezolvaFurnizorPentruRand(rand, job);
    if (eroareFurnizor) {
      eroriLot.push({ rand: numarRand, produs: rand.denumire || '(fără denumire)', camp: 'cui_furnizor', mesaj: eroareFurnizor });
      continue;
    }

    const { data: furnizor } = await supabaseAdmin.from('partners').select('id').eq('id', furnizorId).maybeSingle();
    if (!furnizor) {
      eroriLot.push({ rand: numarRand, produs: rand.denumire || '(fără denumire)', camp: 'furnizor_id', mesaj: 'Furnizorul nu există.' });
      continue;
    }

    const ctx = await ctxPentru(furnizorId);
    const rezultat = tip === 'materiale' ? valideazaMaterial(rand, ctx) : valideazaEchipament(rand, ctx);
    if (!rezultat.valid) {
      for (const e of rezultat.erori) {
        eroriLot.push({ rand: numarRand, produs: rand.denumire || '(fără denumire)', camp: e.camp, mesaj: e.mesaj });
      }
      continue;
    }

    const payload = {
      ...rezultat.normalizat,
      furnizor_id: furnizorId,
      creat_de: user.id,
      status: admin ? 'live' : 'in_asteptare',
      actualizat_la: new Date().toISOString(),
    };
    const { error: upsertErr } = await supabaseAdmin
      .from(TABEL[tip])
      .upsert(payload, { onConflict: 'furnizor_id,cod_produs_furnizor' });
    if (upsertErr) {
      eroriLot.push({ rand: numarRand, produs: rand.denumire || '(fără denumire)', camp: '-', mesaj: upsertErr.message });
      continue;
    }
    salvateLot++;
  }

  const randuriProcesate = job.randuri_procesate + lot.length;
  const randuriErori = job.randuri_erori + eroriLot.length;
  const eroriDetaliiComplet = [...(job.erori_detalii || []), ...eroriLot];
  const gata = end >= randuri.length;
  const statusNou = gata ? (randuriErori > 0 ? 'completat_cu_erori' : 'completat') : 'procesare';

  const { data: jobActualizat, error: updateErr } = await supabaseAdmin
    .from('marketplace_importuri_csv')
    .update({
      cursor_pozitie: end,
      randuri_procesate: randuriProcesate,
      randuri_erori: randuriErori,
      erori_detalii: eroriDetaliiComplet,
      status: statusNou,
      procesat_la: gata ? new Date().toISOString() : null,
    })
    .eq('id', job.id)
    .select()
    .single();
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  return res.status(200).json({
    ok: true,
    job_id: job.id,
    status: jobActualizat.status,
    randuri_totale: jobActualizat.randuri_totale,
    randuri_procesate: jobActualizat.randuri_procesate,
    randuri_erori: jobActualizat.randuri_erori,
    salvate_in_acest_lot: salvateLot,
    erori: eroriLot,
    continua: !gata,
  });
}

module.exports = requireAuth(ROLURI, handler);
