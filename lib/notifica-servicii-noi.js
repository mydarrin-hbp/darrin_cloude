// lib/notifica-servicii-noi.js
// G12 (25 Iulie 2026) — la adăugarea unui serviciu nou în catalog (Backoffice,
// api/admin/catalog.js), notifică automat partenerii eligibili pe baza
// profilului CAEN/NACE declarat, ca să-l poată bifa în portofoliul lor
// (G10) fără să aștepte să fie contactați manual.
//
// NU folosește `servicii_sugerate` — acel tabel e pentru sensul opus
// (partener propune serviciu → admin răspunde). Notificările trimise aici
// se înregistrează în `notificari_servicii_noi` (log + idempotență).
//
// Matching: pe codul NUMERIC de NACE, nu pe stringul brut — FORMATE
// DIFERITE confirmate live: catalog_servicii.nace e text liber, scris ca
// "F 43.91" (literă de secțiune + spațiu + cod); partner_coduri_nace.cod_nace
// are FK către nace_reference.cod, care e strict numeric, "43.91" (fără
// literă). O potrivire exactă pe string n-ar fi găsit NICIODATĂ un partener,
// indiferent câte coduri ar fi declarat. Normalizăm ambele părți la partea
// numerică înainte de a compara.

const { supabaseAdmin } = require('./supabaseAdmin');

function normalizeazaCodNace(cod) {
  if (!cod) return null;
  // Păstrează doar cifre și punct (ex. "F 43.91" -> "43.91", "43.91" -> "43.91").
  const m = String(cod).match(/[\d.]+/);
  return m ? m[0] : null;
}

async function notificaParteneriEligibili({ catalogServiciuId, nace, titlu, categorie }) {
  const naceNormalizat = normalizeazaCodNace(nace);
  if (!naceNormalizat) return { notificati: 0, motiv: 'serviciu_fara_cod_nace' };

  const { data: coduriPotrivite } = await supabaseAdmin
    .from('partner_coduri_nace')
    .select('partner_id')
    .eq('cod_nace', naceNormalizat);
  if (!coduriPotrivite?.length) return { notificati: 0, motiv: 'niciun_partener_cu_acest_nace' };

  const idPartenerCandidati = [...new Set(coduriPotrivite.map((c) => c.partner_id))];

  const { data: partneriEligibili } = await supabaseAdmin
    .from('partners')
    .select('id')
    .in('id', idPartenerCandidati)
    .eq('status_verificare', 'approved');
  if (!partneriEligibili?.length) return { notificati: 0, motiv: 'niciun_partener_aprobat_cu_acest_nace' };

  // Idempotență: nu retrimite dacă acest partener a mai fost notificat
  // pentru exact acest serviciu.
  const { data: dejaNotificati } = await supabaseAdmin
    .from('notificari_servicii_noi')
    .select('partener_id')
    .eq('catalog_serviciu_id', catalogServiciuId)
    .in('partener_id', partneriEligibili.map((p) => p.id));
  const dejaNotificatiSet = new Set((dejaNotificati || []).map((d) => d.partener_id));
  const deNotificat = partneriEligibili.filter((p) => !dejaNotificatiSet.has(p.id));
  if (!deNotificat.length) return { notificati: 0, motiv: 'toti_deja_notificati' };

  let notificati = 0;
  for (const partner of deNotificat) {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(partner.id);
    const email = authUser?.user?.email;

    if (email && process.env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'noreply@homebestpal.com',
            to: email,
            subject: `Serviciu nou în catalogul My Darrin, compatibil cu profilul tău: ${titlu}`,
            html: `<p>Am adăugat un serviciu nou în catalogul My Darrin, în categoria <strong>${categorie}</strong>, care se potrivește cu codul NACE (${nace}) declarat de tine:</p>
                   <p style="font-size:18px;font-weight:800">${titlu}</p>
                   <p>Dacă îl poți presta, bifează-l din <strong>Portofoliu servicii</strong>, în contul tău de partener, ca să începi să primești comenzi pentru el.</p>`,
          }),
        });
      } catch (emailErr) {
        console.error('[notifica-servicii-noi] email eșuat pentru', partner.id, emailErr);
        // Best-effort — continuăm cu restul partenerilor chiar dacă un email eșuează.
      }
    }

    const { error: logErr } = await supabaseAdmin.from('notificari_servicii_noi').insert({
      catalog_serviciu_id: catalogServiciuId,
      partener_id: partner.id,
      cod_nace_potrivit: nace,
    });
    if (!logErr) notificati += 1;
  }

  return { notificati, motiv: null };
}

module.exports = { notificaParteneriEligibili };
