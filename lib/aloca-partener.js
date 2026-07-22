// lib/aloca-partener.js
// Motor minim de alocare automată partener <-> comandă (Faza 3, Address-First
// Gate / ecosistem comandă, 2026-07-21).
//
// Criterii aplicate, în ordine: competență (partener_servicii_active pentru
// serviciul cerut) + disponibilitate (parteneri_disponibilitate.status_live)
// + zonă (regiune ∈ judete[]). NU calculează distanță reală (gps_lat/lng
// există pe parteneri_disponibilitate, dar clasarea după distanță e un
// rafinament ulterior, nu blocant pentru primul test live) — ia primul
// partener eligibil găsit, nu neapărat cel mai apropiat.
//
// LIMITĂ CUNOSCUTĂ: `regiune` pe `comenzi` e text liber (introdus de UI/geo
// detection), iar `judete` pe `parteneri_disponibilitate` e populat cu coduri
// din `geo_regiuni.cod` (ex. 'B-ILFOV', 'IF'). Matching-ul de mai jos face
// o comparație directă de text — funcționează doar dacă `regiune` trimisă
// e deja un cod valid din geo_regiuni. Normalizarea completă (adresă liberă
// -> cod județ) e parte din Address-First Gate, nu construită aici.

const { supabaseAdmin } = require('./supabaseAdmin');
const crypto = require('crypto');

function genereazaCodVerificare() {
  return String(crypto.randomInt(100000, 1000000)); // 6 cifre
}

async function trimiteEmailCod(email, comanda) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[aloca-partener] RESEND_API_KEY lipsă — codul nu a fost trimis pe email:', comanda.cod_verificare);
    return;
  }
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'noreply@homebestpal.com',
        to: email,
        subject: `Cod de verificare partener — comanda ${comanda.nr_comanda}`,
        html: `
          <p>Am găsit un partener pentru comanda ta <strong>${comanda.nr_comanda}</strong>.</p>
          <p>Când partenerul ajunge la adresă, dă-i acest cod ca să confirme identitatea și să înceapă lucrarea:</p>
          <p style="font-size:28px;font-weight:800;letter-spacing:4px">${comanda.cod_verificare}</p>
          <p>Dacă nu recunoști această comandă, ignoră acest email.</p>
        `,
      }),
    });
  } catch (err) {
    console.error('[aloca-partener] trimitere email eșuată:', err);
  }
}

/**
 * Încearcă alocarea automată a unui partener pentru o comandă deja creată.
 * @returns {Promise<{alocat: boolean, motiv?: string, partener_id?: string}>}
 */
async function incearcaAlocarePartener(comandaId) {
  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('id, nr_comanda, client_id, catalog_serviciu_id, tara_cod, regiune, status')
    .eq('id', comandaId)
    .single();
  if (comErr || !comanda) return { alocat: false, motiv: 'comanda_negasita' };

  if (!comanda.catalog_serviciu_id) return { alocat: false, motiv: 'fara_serviciu_specificat' };
  if (comanda.status !== 'in_cautare_partener') return { alocat: false, motiv: 'status_neeligibil' };

  const { data: servActive, error: servErr } = await supabaseAdmin
    .from('partener_servicii_active')
    .select('partener_id')
    .eq('catalog_serviciu_id', comanda.catalog_serviciu_id)
    .eq('activ', true);
  if (servErr || !servActive?.length) return { alocat: false, motiv: 'niciun_partener_cu_acest_serviciu' };

  const idPartenerCandidati = servActive.map((r) => r.partener_id);

  let query = supabaseAdmin
    .from('parteneri_disponibilitate')
    .select('partener_id')
    .in('partener_id', idPartenerCandidati)
    .eq('status_live', 'disponibil');
  if (comanda.tara_cod) query = query.eq('tara_cod', comanda.tara_cod);
  if (comanda.regiune) query = query.contains('judete', [comanda.regiune]);

  const { data: disponibili, error: dispErr } = await query.limit(1);
  if (dispErr || !disponibili?.length) return { alocat: false, motiv: 'niciun_partener_disponibil_in_zona' };

  const partenerId = disponibili[0].partener_id;
  const codVerificare = genereazaCodVerificare();

  const { error: updErr } = await supabaseAdmin
    .from('comenzi')
    .update({ partener_id: partenerId, cod_verificare: codVerificare, status: 'acceptata' })
    .eq('id', comandaId);
  if (updErr) {
    console.error('[aloca-partener] update comandă eșuat:', updErr);
    return { alocat: false, motiv: 'eroare_actualizare' };
  }

  const { data: clientAuth } = await supabaseAdmin.auth.admin.getUserById(comanda.client_id);
  if (clientAuth?.user?.email) {
    await trimiteEmailCod(clientAuth.user.email, { ...comanda, cod_verificare: codVerificare });
  }

  return { alocat: true, partener_id: partenerId };
}

module.exports = { incearcaAlocarePartener, genereazaCodVerificare };
