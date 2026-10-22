// lib/runda-finantare.js
// Rundele de finanțare (pasul 11-J, 21 oct. 2026; decizia LM C2): un singur
// loc pentru citirea rundei deschise și pentru toate calculele — post-money,
// prețul pe acțiune, procentul oferit, acțiunile pentru o sumă și procentul
// investitorului. Le folosesc api/public/runda-curenta.js,
// api/investitori/subscrie.js, api/investitori/portofoliu.js,
// api/admin/runde-finantare.js și api/admin/investitori-dashboard.js.
//
// Nicio valoare a rundei nu e scrisă în cod (decizia C1: doar cifre reale):
// suma, evaluarea, acțiunile existente, investiția minimă, ticketele,
// instrumentele, lock-up-ul și discountul de buy-back le introduce LM în
// back-office (tabela runde_finantare). Fără rundă deschisă → RUNDA_INCHISA.
// Nicio conversie valutară: totul e în moneda rundei.
//
// Formulele (aceleași ca în coloanele generate din migrare):
//   post_money          = evaluare_pre_money + suma_tinta
//   pret_actiune        = evaluare_pre_money / actiuni_existente
//   equity_oferit_pct   = suma_tinta / post_money × 100
//   actiuni_noi         = suma_tinta / pret_actiune
//   actiuni pentru sumă = floor(suma / pret_actiune)
//   procentul unui investitor = actiuni / (actiuni_existente + actiunile noi
//                               emise în rundă, adică cele aprobate)

const { supabaseAdmin } = require('./supabaseAdmin');

const MESAJE = {
  RUNDA_INCHISA: ['Nu există o rundă de finanțare deschisă acum.', 'There is no open funding round at the moment.'],
  SUMA_SUB_MINIM: ['Suma e sub investiția minimă a rundei ({minim} {moneda}).', 'The amount is below the round minimum investment ({minim} {moneda}).'],
  SUMA_PESTE_RAMAS: ['Suma depășește ce a rămas din ținta rundei ({ramas} {moneda}).', 'The amount exceeds what remains of the round target ({ramas} {moneda}).'],
  SUMA_INVALIDA: ['Alege suma investiției.', 'Choose the investment amount.'],
  SUB_O_ACTIUNE: ['Suma nu acoperă nicio acțiune la prețul rundei ({pret} {moneda}).', 'The amount does not cover one share at the round price ({pret} {moneda}).'],
  INSTRUMENT_INVALID: ['Instrumentul ales nu e configurat în rundă.', 'The chosen instrument is not configured in the round.'],
  CONFIGURARE_INVALIDA: ['Datele rundei nu sunt complete sau nu sunt valide.', 'The round data is incomplete or not valid.'],
};

class EroareRunda extends Error {
  constructor(cod, param) {
    const [ro, en] = MESAJE[cod] || MESAJE.CONFIGURARE_INVALIDA;
    const fill = (s) => s.replace(/\{(\w+)\}/g, (m, k) => (param && param[k] != null ? param[k] : m));
    super(fill(ro));
    this.cod = cod;
    this.mesaj_en = fill(en);
  }
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function rotunjit(n, z = 2) { return n == null ? null : Math.round(n * 10 ** z) / 10 ** z; }

// Valorile calculate ale unei runde (din câmpurile introduse). null dacă lipsesc date.
function calculeaza(r) {
  const pre = num(r && r.evaluare_pre_money);
  const tinta = num(r && r.suma_tinta);
  const existente = num(r && r.actiuni_existente);
  if (!(pre > 0) || !(tinta > 0) || !(existente > 0)) return null;
  const postMoney = pre + tinta;
  const pret = pre / existente;
  return {
    post_money: rotunjit(postMoney),
    pret_actiune: rotunjit(pret, 6),
    equity_oferit_pct: rotunjit((tinta / postMoney) * 100, 4),
    actiuni_noi: Math.floor(tinta / pret),
  };
}

// Câte acțiuni cumpără o sumă la prețul rundei.
function actiuniPentruSuma(r, suma) {
  const c = calculeaza(r);
  if (!c || !(suma > 0)) return 0;
  return Math.floor(suma / (num(r.evaluare_pre_money) / num(r.actiuni_existente)));
}

// Procentul unui investitor din companie, după runda dată: acțiunile lui
// raportate la acțiunile existente plus cele noi emise (aprobate) în rundă.
function procentInvestitor(r, actiuni, actiuniNoiEmise) {
  const existente = num(r && r.actiuni_existente);
  if (!(existente > 0) || !(actiuni > 0)) return 0;
  const total = existente + Math.max(0, Number(actiuniNoiEmise) || 0);
  return rotunjit((actiuni / total) * 100, 4);
}

// Validează o sumă pentru subscriere. `stranse` = suma subscrierilor aprobate
// (și, la nevoie, a celor în așteptare) din rundă. Întoarce { actiuni }.
function valideazaSuma(r, suma, stranse = 0) {
  const c = calculeaza(r);
  if (!c) throw new EroareRunda('CONFIGURARE_INVALIDA');
  const s = num(suma);
  if (!(s > 0)) throw new EroareRunda('SUMA_INVALIDA');
  const moneda = r.moneda || '';
  const minim = num(r.investitie_minima);
  if (minim != null && s < minim) throw new EroareRunda('SUMA_SUB_MINIM', { minim: minim, moneda });
  const ramas = num(r.suma_tinta) - (Number(stranse) || 0);
  if (s > ramas) throw new EroareRunda('SUMA_PESTE_RAMAS', { ramas: rotunjit(Math.max(0, ramas)), moneda });
  const actiuni = actiuniPentruSuma(r, s);
  if (actiuni < 1) throw new EroareRunda('SUB_O_ACTIUNE', { pret: c.pret_actiune, moneda });
  return { actiuni };
}

// Tabela lipsă (migrarea neaplicată) → ca și cum n-ar exista nicio rundă.
function tabelaLipsa(error) {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message || ''));
}

async function rundaDeschisa() {
  const { data, error } = await supabaseAdmin.from('runde_finantare').select('*').eq('stare', 'deschisa').limit(2);
  if (error) {
    if (tabelaLipsa(error)) return null;
    throw error;
  }
  if (!data || !data.length) return null;
  if (data.length > 1) throw new Error('Mai multe runde deschise în același timp');
  return data[0];
}

async function rundaDeschisaSauEroare() {
  const r = await rundaDeschisa();
  if (!r) throw new EroareRunda('RUNDA_INCHISA');
  return r;
}

// Suma și acțiunile subscrierilor dintr-o rundă (după stări).
async function totaluriRunda(rundaId, stari = ['aprobat']) {
  const { data, error } = await supabaseAdmin.from('investitori_portofoliu')
    .select('valoare_investita, actiuni, status').eq('runda_id', rundaId).in('status', stari);
  if (error) {
    if (tabelaLipsa(error) || /runda_id/.test(error.message || '')) return { suma: 0, actiuni: 0 };
    throw error;
  }
  return (data || []).reduce((t, x) => ({ suma: t.suma + (Number(x.valoare_investita) || 0), actiuni: t.actiuni + (Number(x.actiuni) || 0) }), { suma: 0, actiuni: 0 });
}

// Răspunsul de eroare standard (RO + EN) pentru o EroareRunda.
function raspunsEroare(res, e) {
  const cod = e.cod === 'RUNDA_INCHISA' ? 409 : 400;
  return res.status(cod).json({ error: e.message, error_en: e.mesaj_en, cod: e.cod });
}

module.exports = {
  EroareRunda, MESAJE, calculeaza, actiuniPentruSuma, procentInvestitor, valideazaSuma,
  rundaDeschisa, rundaDeschisaSauEroare, totaluriRunda, tabelaLipsa, raspunsEroare, num,
};
