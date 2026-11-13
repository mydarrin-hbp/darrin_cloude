// /api/admin/integrari/importa-csv.js
// Import CSV generic pentru orice categorie de integrare. Fișierul e deja
// urcat client-side în bucket-ul privat `integrari-csv` (același tipar ca
// partner-certificari: upload direct din browser, doar path-ul ajunge aici).
//
// IMPORTANT: rândurile parsate ajung DOAR în `date_stagate` (zonă de
// verificare, vizibilă în backoffice) — acest endpoint NU scrie în nicio
// tabelă de business (catalog, prețuri, tarife etc.). Maparea exactă
// categorie→tabelă reală e un pas separat, per categorie, când se cunosc
// coloanele exacte ale unui CSV real.
//
// Parser minimal (fără dependență nouă): separator virgulă, primul rând =
// header, fără suport pentru câmpuri cu virgulă/newline în ghilimele —
// suficient pentru CSV-uri simple de tarife/prețuri; CSV-uri complexe
// necesită un parser dedicat, adăugat când apare un caz real.
//
// Body: { integrare_id, storage_path, mapare_coloane? }

const { requireAuth } = require('../../../lib/auth-middleware');
const { formaComuna, trimiteEroare } = require('../../../lib/raspuns-eroare');
const { supabaseAdmin } = require('../../../lib/supabaseAdmin');

const MAX_RANDURI_STAGATE = 5000;

function parseCSV(text) {
  const linii = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (linii.length === 0) return { header: [], randuri: [] };
  const header = linii[0].split(',').map((h) => h.trim());
  const randuri = linii.slice(1).map((linie) => {
    const valori = linie.split(',').map((v) => v.trim());
    const obj = {};
    header.forEach((h, i) => { obj[h] = valori[i] ?? null; });
    return obj;
  });
  return { header, randuri };
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const { integrare_id, storage_path, mapare_coloane = {} } = req.body || {};
  if (!integrare_id || !storage_path) {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'integrare_id și storage_path sunt obligatorii', 'integrare_id and storage_path are required.');
  }

  const { data: integrare, error: getErr } = await supabaseAdmin
    .from('integrari_furnizori')
    .select('id, tip_configurare')
    .eq('id', integrare_id)
    .maybeSingle();
  if (getErr || !integrare) return trimiteEroare(res, 404, 'NU_EXISTA', 'Integrarea nu există', 'The integration does not exist.');
  if (!['csv', 'ambele'].includes(integrare.tip_configurare)) {
    return trimiteEroare(res, 400, 'NU_SE_APLICA', 'Această integrare nu este configurată pentru import CSV', 'This integration is not set up for CSV import.');
  }

  const { data: fisier, error: dlErr } = await supabaseAdmin.storage.from('integrari-csv').download(storage_path);
  if (dlErr || !fisier) {
    return trimiteEroare(res, 400, 'FISIER_NECITIT', 'Nu am putut citi fișierul din storage — verifică storage_path', 'We could not read the file from storage. Check storage_path.', ['storage_path']);
  }

  let text;
  try {
    text = await fisier.text();
  } catch (e) {
    return trimiteEroare(res, 400, 'FISIER_NECITIT', 'Fișierul nu a putut fi citit ca text (CSV valid?)', 'The file could not be read as text. Is it a valid CSV?');
  }

  const { randuri } = parseCSV(text);
  const trunchiat = randuri.length > MAX_RANDURI_STAGATE;
  const dateStagate = trunchiat ? randuri.slice(0, MAX_RANDURI_STAGATE) : randuri;

  const { data: importRow, error: insErr } = await supabaseAdmin
    .from('integrari_importuri_csv')
    .insert({
      integrare_id,
      nume_fisier: storage_path.split('/').pop(),
      storage_path,
      mapare_coloane,
      randuri_totale: randuri.length,
      randuri_procesate: dateStagate.length,
      randuri_erori: 0,
      status: 'finalizat',
      date_stagate: dateStagate,
      erori_detalii: trunchiat ? [{ mesaj: `Trunchiat la primele ${MAX_RANDURI_STAGATE} rânduri din ${randuri.length} totale` }] : [],
      creat_de: user.id,
      procesat_la: new Date().toISOString(),
    })
    .select('id, randuri_totale, randuri_procesate, status')
    .single();
  if (insErr) {
    console.error('[admin/integrari/importa-csv]', insErr);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut înregistra importul', 'We could not record the import.');
  }

  return res.status(200).json({ ok: true, import: importRow });
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
