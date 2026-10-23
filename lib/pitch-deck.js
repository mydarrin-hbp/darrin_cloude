// lib/pitch-deck.js
// Pitch deck-ul RO + EN (pasul 11-K, 22 oct. 2026; decizia LM C3 și cerința
// LM din 22 oct.): regulile comune pentru api/admin/pitch-deck.js și
// api/public/pitch-deck.js.
//
//   - două deck-uri: RO pentru limba română, EN pentru toate celelalte limbi
//     din selector (en, bg, de, el, fr, tr) — limbaDeck();
//   - validarea fiecărui tip de slide: pitch-deck-schema.js (aceeași schemă
//     în editorul din back-office);
//   - notele de verificare: câmpurile `de_verificat` din fișierul importat
//     devin note_verificare; aprobarea e refuzată cât timp rămâne o notă
//     nerezolvată sau un slide de prognoză fără sursă (blocajeAprobare);
//   - cifrele rundei nu stau în deck: slide-ul `runda` și punctul
//     `din_runda: "post_money"` al slide-ului `exit` le iau la afișare din
//     runda deschisă și publică (lib/runda-finantare.js, pasul 11-J);
//   - emailul de pe slide-ul `contact` vine din backoffice_config
//     (investitori_email, secțiunea contact); QR-ul se generează pe server
//     din url_investitori (biblioteca qrcode, fără rețea);
//   - vizibilitatea: backoffice_config.pitch_deck_vizibilitate; lipsă sau
//     valoare necunoscută → varianta prudentă, investitori_aprobati.

const QRCode = require('qrcode');
const S = require('../pitch-deck-schema');
const R = require('./runda-finantare');
const { supabaseAdmin } = require('./supabaseAdmin');
const { incarcaContactPlatformaSigur } = require('./contact-platforma');

const LIMBI_DECK = ['ro', 'en'];
const VIZIBILITATI = ['public', 'investitori_aprobati'];
const VIZIBILITATE_PRUDENTA = 'investitori_aprobati';
const SLIDEURI_REZUMAT = 3;
const BUCKET_MEDIA = 'pitch-deck-media';
const MARIME_MAXIMA = 5 * 1024 * 1024;
const TIPURI_IMAGINE = Object.freeze({ 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' });
const COLOANE = 'id, limba, titlu, sursa, disclaimer, slide_uri, note_verificare, aprobat, aprobat_de, aprobat_la, creat_de, creat_la, actualizat_de, actualizat_la';

// ro → deck-ul RO; orice altă limbă (en, bg, de, el, fr, tr, necunoscută) → EN.
function limbaDeck(l) {
  return String(l || '').trim().toLowerCase().slice(0, 2) === 'ro' ? 'ro' : 'en';
}

// Coloanele noi lipsesc (migrarea 2026-10-22 neaplicată) sau tabela lipsește.
function migrareLipsa(error) {
  return !!error && (R.tabelaLipsa(error) || error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|Could not find the/i.test(error.message || ''));
}

// Notele `de_verificat` din fișier → note_verificare; slide-urile rămân fără ele.
function extrageNote(slideuri) {
  const note = [];
  const curate = (Array.isArray(slideuri) ? slideuri : []).map((s) => {
    if (!s || typeof s !== 'object') return s;
    const { de_verificat: dv, ...rest } = s;
    (Array.isArray(dv) ? dv : []).forEach((text, i) => {
      if (typeof text === 'string' && text.trim()) note.push({ id: `s${s.nr}-${i + 1}`, slide: s.nr, text: text.trim(), rezolvat: false });
    });
    return rest;
  });
  return { slide_uri: curate, note };
}

// Notele trimise din editor: doar bifa `rezolvat` se schimbă; textul rămâne cel salvat.
function combinaNote(salvate, trimise) {
  const bife = new Map((Array.isArray(trimise) ? trimise : []).filter((n) => n && typeof n.id === 'string').map((n) => [n.id, n.rezolvat === true]));
  return (Array.isArray(salvate) ? salvate : []).map((n) => ({ ...n, rezolvat: bife.has(n.id) ? bife.get(n.id) : n.rezolvat === true }));
}

// Ce împiedică aprobarea: note nerezolvate, slide-uri de prognoză fără sursă,
// eticheta de prognoză lipsă. Listă goală = se poate aproba.
function blocajeAprobare(v) {
  const blocaje = [];
  (Array.isArray(v && v.note_verificare) ? v.note_verificare : []).filter((n) => n && n.rezolvat !== true).forEach((n) => {
    blocaje.push({ camp: `note_verificare.${n.id}`, ro: `Slide ${n.slide}: nota „${n.text}” nu e rezolvată.`, en: `Slide ${n.slide}: the note “${n.text}” is not resolved.` });
  });
  S.faraSursa(v && v.slide_uri).forEach((nr) => {
    blocaje.push({ camp: `slide_uri.${nr - 1}.sursa`, ro: `Slide ${nr}: completați sursa cifrelor (slide de prognoză).`, en: `Slide ${nr}: fill in the source of the figures (forecast slide).` });
  });
  const arePrognoza = (Array.isArray(v && v.slide_uri) ? v.slide_uri : []).some((s) => s && s.prognoza === true);
  if (arePrognoza && !(typeof (v && v.disclaimer) === 'string' && v.disclaimer.trim())) {
    blocaje.push({ camp: 'disclaimer', ro: 'Completați eticheta de prognoză (afișată pe slide-urile cu cifre estimate).', en: 'Fill in the forecast label (shown on the slides with estimated figures).' });
  }
  return blocaje;
}

async function citesteVizibilitate() {
  try {
    const { data, error } = await supabaseAdmin.from('backoffice_config').select('valoare')
      .eq('cheie', 'pitch_deck_vizibilitate').eq('tara_cod', 'ALL').maybeSingle();
    if (error || !data) return VIZIBILITATE_PRUDENTA;
    const v = String(data.valoare || '').trim();
    return VIZIBILITATI.includes(v) ? v : VIZIBILITATE_PRUDENTA;
  } catch (e) {
    return VIZIBILITATE_PRUDENTA;
  }
}

// Versiunea aprobată a unei limbi (null: niciuna sau migrarea neaplicată).
async function versiuneAprobata(limba) {
  const { data, error } = await supabaseAdmin.from('pitch_deck_versiuni').select(COLOANE)
    .eq('limba', limbaDeck(limba)).eq('aprobat', true).order('aprobat_la', { ascending: false }).limit(1);
  if (error) {
    if (migrareLipsa(error)) return null;
    throw error;
  }
  return (data && data[0]) || null;
}

// Runda deschisă și publică, cu valorile calculate (fără date despre investitori).
async function rundaPentruDeck() {
  try {
    const r = await R.rundaDeschisa();
    if (!r || r.vizibila_public !== true) return null;
    const c = R.calculeaza(r);
    if (!c) return null;
    return {
      cod: r.cod, denumire_ro: r.denumire_ro, denumire_en: r.denumire_en, stare: r.stare,
      data_start: r.data_start || null, data_sfarsit: r.data_sfarsit || null, moneda: r.moneda,
      evaluare_pre_money: R.num(r.evaluare_pre_money), suma_tinta: R.num(r.suma_tinta),
      post_money: c.post_money, equity_oferit_pct: c.equity_oferit_pct, pret_actiune: c.pret_actiune,
      investitie_minima: R.num(r.investitie_minima),
      tickete: Array.isArray(r.tickete) && r.tickete.length ? r.tickete.map(Number) : null,
    };
  } catch (e) {
    console.error('[pitch-deck] runda:', e.message);
    return null;
  }
}

// QR-ul (SVG) pentru o adresă https; null dacă adresa nu e validă.
async function qrSvg(url) {
  if (typeof url !== 'string' || !/^https:\/\/[^\s"'<>]+$/.test(url)) return null;
  return QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1E2E4D', light: '#FFFFFF' } });
}

// Ce primește renderul (pagina publică și previzualizarea din back-office).
// rezumat = titlul și primele 3 slide-uri, fără rundă, contact sau QR.
async function construiestePayload(v, { rezumat = false } = {}) {
  const toate = Array.isArray(v.slide_uri) ? v.slide_uri : [];
  const slide_uri = rezumat ? toate.slice(0, SLIDEURI_REZUMAT) : toate;
  const contact = slide_uri.find((s) => s && s.tip === 'contact');
  const areRunda = slide_uri.some((s) => s && (s.tip === 'runda' || (s.tip === 'exit' && (s.puncte || []).some((p) => p && p.din_runda))));
  const [runda, date, qr] = await Promise.all([
    areRunda ? rundaPentruDeck() : null,
    contact ? incarcaContactPlatformaSigur() : null,
    contact ? qrSvg(contact.url_investitori).catch(() => null) : null,
  ]);
  return {
    stare: rezumat ? 'rezumat' : 'complet',
    limba: v.limba,
    deck: {
      titlu: v.titlu || null, disclaimer: v.disclaimer || null, aprobat_la: v.aprobat_la || null,
      total_slideuri: toate.length, slide_uri,
    },
    runda,
    contact: contact ? { investitori_email: (date && date.investitori_email) || null } : null,
    qr_svg: qr,
  };
}

// Investitor cu verificarea identității aprobată (sesiunea din Authorization).
async function esteInvestitorAprobat(user) {
  if (!user || !user.id) return false;
  const { data, error } = await supabaseAdmin.from('investitori_kyc').select('status').eq('user_id', user.id).maybeSingle();
  return !error && !!data && data.status === 'aprobat';
}

module.exports = {
  LIMBI_DECK, VIZIBILITATI, VIZIBILITATE_PRUDENTA, SLIDEURI_REZUMAT, BUCKET_MEDIA, MARIME_MAXIMA, TIPURI_IMAGINE, COLOANE,
  limbaDeck, migrareLipsa, extrageNote, combinaNote, blocajeAprobare, citesteVizibilitate, versiuneAprobata,
  rundaPentruDeck, qrSvg, construiestePayload, esteInvestitorAprobat, valideaza: S.valideaza,
};
