// /api/public/lead-zona.js
// Endpoint PUBLIC — captează lead-uri din zone unde checkout-ul nu e încă
// activ (Etapa 4, audit 2026-07-12), pentru strategia de scalare/înființare
// entități juridice. Strict listă de așteptare — nicio trimitere automată
// de email nu pleacă de aici (aceeași regulă ca la parteneri_prospecti).

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { limiteazaCererea } = require('../../lib/rate-limit');
const v = require('../../lib/valideaza');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: câmpurile acceptate, cu lungimi maxime; orice alt câmp e refuzat.
const SCHEMA = {
  email: v.email({ obligatoriu: true, eticheta: ['Email', 'Email'] }),
  nume: v.text({ max: 200, eticheta: ['Nume', 'Name'] }),
  tara_cod: v.text({ max: 8, eticheta: ['Codul țării', 'Country code'] }),
  tara_nume: v.text({ max: 100, eticheta: ['Țara', 'Country'] }),
  mesaj: v.text({ max: 1000, eticheta: ['Mesaj', 'Message'] }),
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const date = v.valideazaSauTrimite(req, res, SCHEMA);
  if (!date) return;
  const { email, nume, tara_cod, tara_nume, mesaj } = date;

  // Cel mult 5 cereri în 10 minute, pe IP și pe email (pasul 11-S1: și pe email).
  if (!(await limiteazaCererea(req, res, { key: 'lead-zona', limit: 5, windowSeconds: 600, email }))) return;

  try {
    const { error } = await supabaseAdmin.from('tari_lead_asteptare').insert({
      email,
      nume: nume || null,
      tara_cod: tara_cod ? tara_cod.toUpperCase() : null,
      tara_nume: tara_nume || null,
      // Etapa LANSARE, Faza C (27 august 2026): "menționează nevoia sau
      // problema sa" — câmp liber opțional, coloană nouă tari_lead_asteptare.mesaj.
      mesaj: mesaj || null,
    });
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[lead-zona]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut înregistra cererea. Încercați din nou.', 'We could not register your request. Please try again.');
  }
};
