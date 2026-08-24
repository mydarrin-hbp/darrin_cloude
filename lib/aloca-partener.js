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
const QRCode = require('qrcode');
const { renderEmailCodPartenerServicii, limbaProfilEmailComportamental, textQrCaptionCod } = require('./i18n');
const { fromHeader } = require('./email-sender');

function genereazaCodVerificare() {
  return String(crypto.randomInt(100000, 1000000)); // 6 cifre
}

// FIX (G34, audit Secțiunea 36, 30 Iulie 2026) — metodă secundară de
// identificare partener: codul de verificare rămâne sursa reală (neschimbat,
// nicio migrare de schemă), dar clientul primește acum și un QR care îl
// codifică, pe care partenerul îl poate scana în loc să-l tasteze manual
// (vezi confirmaCodReal() din mydarrin-dashboard-partener.html). Generat
// server-side, ca imagine PNG inline (data URI) — niciun serviciu extern nu
// vede vreodată codul.
async function genereazaCodVerificareQR(cod) {
  try {
    return await QRCode.toDataURL(cod, { width: 220, margin: 1, color: { dark: '#1A2332', light: '#FFFFFF' } });
  } catch (err) {
    console.error('[aloca-partener] generare QR eșuată:', err);
    return null;
  }
}

// Text ajustat 24 august 2026, cerință explicită a utilizatorului — numele
// real al partenerului (din metadata Auth, populată la înregistrare de
// api/public/partner-register.js, fix Bug 2b din 21 august) înlocuiește
// mesajul generic „Am găsit un partener", iar emailul se trimite azi în
// limba clientului (nu mai e mereu română) — tiparul deja folosit de
// PRIMA_COMANDA/limbaProfilEmailComportamental.
async function trimiteEmailCod(email, comanda, { numePartener = null, limba = 'ro' } = {}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[aloca-partener] RESEND_API_KEY lipsă — codul nu a fost trimis pe email:', comanda.cod_verificare);
    return;
  }
  try {
    const qrDataUrl = await genereazaCodVerificareQR(comanda.cod_verificare);
    const qrHtml = qrDataUrl
      ? `<p><img src="${qrDataUrl}" width="180" height="180" alt="Cod QR verificare" style="display:block"/></p><p style="font-size:12px;color:#666">${textQrCaptionCod(limba)}</p>`
      : '';
    const { subiect, html } = renderEmailCodPartenerServicii(limba, {
      nume: numePartener,
      numarComanda: comanda.nr_comanda,
      cod: comanda.cod_verificare,
    });
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: await fromHeader(limba),
        to: email,
        subject: subiect,
        html: `${html}${qrHtml}`,
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

  // Matching fin pe cod_esco (Varianta 2 "Echipă", 24 august 2026) — codul
  // ESCO declarat al serviciului (catalog_servicii.cod_esco, populat pe
  // 266/355 servicii publice azi), folosit mai jos doar dacă echipa
  // partenerului a completat și ea cod_esco pe măcar un membru.
  const { data: servRow } = await supabaseAdmin
    .from('catalog_servicii')
    .select('cod_esco')
    .eq('id', comanda.catalog_serviciu_id)
    .maybeSingle();
  const escoPrincipal = servRow?.cod_esco || null;

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

  const { data: disponibili, error: dispErr } = await query;
  if (dispErr || !disponibili?.length) return { alocat: false, motiv: 'niciun_partener_disponibil_in_zona' };

  // Status echipă (24 august 2026, aprobat) — un partener cu echipă declarată
  // (partner_angajati) trebuie să aibă măcar un membru cu disponibil=true ca
  // să rămână eligibil la alocare ("nu ești disponibil → nu ți se alocă").
  // Parteneri fără echipă declarată (marea majoritate azi, solo) trec
  // neschimbat.
  //
  // Matching fin pe cod_esco (extindere, 24 august 2026): dacă serviciul are
  // un `escoPrincipal` declarat ȘI echipa partenerului a completat cod_esco
  // pe măcar un membru, nu mai e destul "cineva disponibil, indiferent de
  // meserie" — trebuie un membru disponibil cu exact acel cod_esco. Dacă
  // echipa n-are niciun cod_esco completat (cazul de azi, 0/0 populat live),
  // rămâne verificarea veche, non-blocantă.
  const idCandidatiZona = disponibili.map((r) => r.partener_id);
  const { data: angajatiEchipe } = await supabaseAdmin
    .from('partner_angajati')
    .select('partner_id, disponibil, cod_esco')
    .in('partner_id', idCandidatiZona)
    .eq('activ', true);

  const echipaIdx = {};
  (angajatiEchipe || []).forEach((a) => {
    if (!echipaIdx[a.partner_id]) echipaIdx[a.partner_id] = { membri: [] };
    echipaIdx[a.partner_id].membri.push({ disponibil: a.disponibil, cod_esco: a.cod_esco || null });
  });

  const partenerId = idCandidatiZona.find((id) => {
    const echipa = echipaIdx[id];
    if (!echipa) return true;
    const areEscoDeclaratInEchipa = echipa.membri.some((m) => m.cod_esco);
    if (escoPrincipal && areEscoDeclaratInEchipa) {
      return echipa.membri.some((m) => m.disponibil && m.cod_esco === escoPrincipal);
    }
    return echipa.membri.some((m) => m.disponibil);
  });
  if (!partenerId) return { alocat: false, motiv: 'echipa_indisponibila' };
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
    const { data: profilClient } = await supabaseAdmin
      .from('profiles')
      .select('limba, tara')
      .eq('id', comanda.client_id)
      .maybeSingle();
    const { data: partenerAuth } = await supabaseAdmin.auth.admin.getUserById(partenerId);
    const numePartener = partenerAuth?.user?.user_metadata?.nume || null;
    await trimiteEmailCod(clientAuth.user.email, { ...comanda, cod_verificare: codVerificare }, {
      numePartener,
      limba: limbaProfilEmailComportamental(profilClient),
    });
  }

  return { alocat: true, partener_id: partenerId };
}

module.exports = { incearcaAlocarePartener, genereazaCodVerificare };
