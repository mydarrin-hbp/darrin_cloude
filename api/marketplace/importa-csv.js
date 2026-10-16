// /api/marketplace/importa-csv.js
// Import CSV real (înlocuiește handleCSVUpload()/importCSV() 100%
// decorative). Fără Redis/BullMQ (nu există în stack) — procesare pe
// loturi de 300 rânduri/apel, cu status persistat în
// marketplace_importuri_csv; clientul reapelează cu același job_id + cu
// ACELEAȘI rânduri parsate (serverless nu ține stare între apeluri) cât
// timp continua=true.
//
// Rânduri deja parsate client-side (window._mydCSV.parse) — endpoint-ul
// primește JSON, nu fișierul brut. Acceptă și rândurile exact cum vin din
// șabloanele docs/sabloane/import-hbp-*.csv (denumire_produs, imagine_url_1…6,
// nod_menu), normalizate aici (16 oct. 2026).
//
// Admin poate importa pentru MAI MULȚI furnizori într-un singur CSV —
// fiecare rând se rezolvă după `cui_furnizor` (coloană deja documentată
// în UI). Furnizorul își importă mereu doar propriile rânduri (furnizor_id
// fix pe job, ignoră orice cui_furnizor din CSV).
//
// Pasul 10a (16 oct. 2026): fiecare rând trece și prin ruta de încadrare
// (lib/ruta-incadrare.js, valideazaRutaProdus): materiale în capitolul G cu
// Uniclass Pr_ activ, închirieri în O77, nodul de meniu din nod_menu (slug).
// Produsele importate pornesc mereu cu status 'in_asteptare' — devin 'live'
// doar după aprobare (api/admin/marketplace-aprobari.js), și pentru admin.
// Rândurile cu erori nu se importă; erorile vin cu rândul, câmpul și
// mesajul în RO (mesaj) și EN (mesaj_en).
//
// POST { tip:'materiale'|'echipamente', randuri:[...], job_id? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { valideazaMaterial, valideazaEchipament, incarcaContextValidare } = require('../../lib/valideaza-produs-marketplace');
const { valideazaRutaProdus, normalizeazaNace } = require('../../lib/ruta-incadrare');

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
  if (!cui) return { furnizorId: null, eroare: 'cui_furnizor lipsă — obligatoriu când importul acoperă mai mulți furnizori', eroare_en: 'cui_furnizor is missing — required when the import covers several suppliers' };
  const { data } = await supabaseAdmin.from('partners').select('id').eq('cui', cui).maybeSingle();
  if (!data) return { furnizorId: null, eroare: `Niciun furnizor găsit cu CUI „${cui}"`, eroare_en: `No supplier found with CUI "${cui}"` };
  return { furnizorId: data.id, eroare: null };
}

// Rândul din șablon (coloanele din CSV) → câmpurile validatorului. Un rând
// deja mapat de pagină (denumire, imagini) rămâne cum e.
function normalizeazaRandCsv(rand) {
  const r = { ...(rand || {}) };
  if (r.denumire == null && r.denumire_produs != null) r.denumire = r.denumire_produs;
  if (!Array.isArray(r.imagini)) {
    const imagini = [];
    for (let i = 1; i <= 6; i++) {
      const url = String(r[`imagine_url_${i}`] || '').trim();
      if (url) imagini.push({ url, ordine: imagini.length });
    }
    r.imagini = imagini;
  }
  if (typeof r.moneda === 'string') r.moneda = r.moneda.trim().toUpperCase();
  if (typeof r.nod_menu === 'string') r.nod_menu = r.nod_menu.trim();
  return r;
}

// Datele rutei, o dată pe apel: capitolele, clasele NACE și nodurile de meniu.
async function incarcaContextRuta() {
  const [{ data: capitole }, { data: nace }, { data: noduri }] = await Promise.all([
    supabaseAdmin.from('meniu_capitole').select('cod, sectiuni_nace, diviziuni_nace, clase_nace, tip_partener, activ'),
    supabaseAdmin.from('nace_reference').select('cod').eq('nivel', 'clasa'),
    supabaseAdmin.from('categorii').select('id, slug, title, title_en, capitol_cod, nace_clasa, category_type, activ'),
  ]);
  return {
    capitole: capitole || [],
    naceClase: new Set((nace || []).map((r) => normalizeazaNace(r.cod)).filter(Boolean)),
    noduriPeSlug: new Map((noduri || []).map((n) => [n.slug, n])),
  };
}

const faraDenumire = (rand) => rand.denumire || rand.denumire_produs || '(fără denumire)';

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
  const ctxRuta = await incarcaContextRuta();

  const eroriLot = [];
  const avertismenteLot = [];
  let salvateLot = 0;
  let randuriEsuateLot = 0; // FIX (testat live): randuri_erori trebuie să numere RÂNDURI eșuate,
                            // nu mesaje de eroare — un rând cu 2 câmpuri invalide simultan
                            // umfla eronat randuri_erori la 2 pentru un singur rând respins.

  for (let i = 0; i < lot.length; i++) {
    const rand = normalizeazaRandCsv(lot[i]);
    const numarRand = start + i + 1;
    const produs = faraDenumire(rand);
    const { furnizorId, eroare: eroareFurnizor, eroare_en: eroareFurnizorEn } = await rezolvaFurnizorPentruRand(rand, job);
    if (eroareFurnizor) {
      eroriLot.push({ rand: numarRand, produs, camp: 'cui_furnizor', mesaj: eroareFurnizor, mesaj_en: eroareFurnizorEn });
      randuriEsuateLot++;
      continue;
    }

    const { data: furnizor } = await supabaseAdmin.from('partners').select('id').eq('id', furnizorId).maybeSingle();
    if (!furnizor) {
      eroriLot.push({ rand: numarRand, produs, camp: 'furnizor_id', mesaj: 'Furnizorul nu există.', mesaj_en: 'The supplier does not exist.' });
      randuriEsuateLot++;
      continue;
    }

    const ctx = await ctxPentru(furnizorId);
    const nod = rand.nod_menu ? ctxRuta.noduriPeSlug.get(rand.nod_menu) || null : null;
    if (nod) rand.categorie_id = nod.id;
    const cod = String(rand.cod_uniclass || '').trim();
    const ruta = valideazaRutaProdus({
      tip,
      produs: { nace_cod: rand.nace_cod, cod_uniclass: cod, operator_inclus: rand.operator_inclus, nod_menu: rand.nod_menu },
      nod,
      uniclass: cod ? ctx.uniclassCoduri?.get(cod) || null : null,
      ref: { capitole: ctxRuta.capitole, naceClase: ctxRuta.naceClase },
    });
    const rezultat = tip === 'materiale' ? valideazaMaterial(rand, ctx) : valideazaEchipament(rand, ctx);

    // Erorile rutei pe câmpurile nace_cod / cod_uniclass le înlocuiesc pe cele
    // generale ale validatorului (același câmp, mesaj mai precis).
    const campuriRuta = new Set(ruta.erori.map((e) => e.camp));
    const erori = [
      ...rezultat.erori.filter((e) => !campuriRuta.has(e.camp)).map((e) => ({ camp: e.camp, mesaj: e.mesaj, mesaj_en: e.mesaj_en || e.mesaj })),
      ...ruta.erori.map((e) => ({ camp: e.camp, mesaj: e.mesaj_ro, mesaj_en: e.mesaj_en, cod: e.cod })),
    ];
    if (erori.length) {
      erori.forEach((e) => eroriLot.push({ rand: numarRand, produs, ...e }));
      randuriEsuateLot++;
      continue;
    }

    const traducereEn = {};
    for (const camp of ['denumire', 'descriere', 'descriere_pret']) {
      const v = String(rand[`${camp}_en`] || '').trim();
      if (v) traducereEn[camp] = v;
    }
    const payload = {
      ...rezultat.normalizat,
      ...(Object.keys(traducereEn).length ? { traduceri: { en: traducereEn } } : {}),
      categorie_id: nod.id,
      furnizor_id: furnizorId,
      creat_de: user.id,
      status: 'in_asteptare',
      motiv_respingere: null,
      actualizat_la: new Date().toISOString(),
    };
    let { error: upsertErr } = await supabaseAdmin
      .from(TABEL[tip])
      .upsert(payload, { onConflict: 'furnizor_id,cod_produs_furnizor' });
    // Coloana traduceri vine cu migrarea 2026-10-16_furnizor_propriu.sql; până
    // atunci produsul se salvează fără traducere (pagina îl arată în română).
    if (upsertErr && payload.traduceri && /traduceri/.test(upsertErr.message || '')) {
      delete payload.traduceri;
      ({ error: upsertErr } = await supabaseAdmin.from(TABEL[tip]).upsert(payload, { onConflict: 'furnizor_id,cod_produs_furnizor' }));
    }
    if (upsertErr) {
      eroriLot.push({ rand: numarRand, produs, camp: '-', mesaj: upsertErr.message, mesaj_en: upsertErr.message });
      randuriEsuateLot++;
      continue;
    }
    salvateLot++;
    // Avertismentele contează doar pentru rândurile importate.
    ruta.avertismente.forEach((a) => avertismenteLot.push({ rand: numarRand, produs, camp: a.camp, mesaj: a.mesaj_ro, mesaj_en: a.mesaj_en, cod: a.cod }));
  }

  const randuriProcesate = job.randuri_procesate + lot.length;
  const randuriErori = job.randuri_erori + randuriEsuateLot;
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
    avertismente: avertismenteLot,
    continua: !gata,
  });
}

module.exports = requireAuth(ROLURI, handler);
module.exports.normalizeazaRandCsv = normalizeazaRandCsv;
