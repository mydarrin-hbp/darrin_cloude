// lib/agenda-cont.js
// Pasul 11-P3a (26 oct. 2026): agenda contului — adresele (de prestare /
// livrare, de facturare sau ambele) și profilurile de facturare (persoană
// fizică sau firmă), gestionate din dashboard-ul oricărui cont și direct din
// checkout / coș (componenta agenda-cont.js, API-ul api/cont/agenda.js).
// Tabelele: docs/migrations-propuse/2026-10-26_agenda_adrese_facturare.sql.
//
// Validarea reutilizează lib/date-facturare.js (aceleași reguli și mesaje
// RO + EN ca la checkout), deci și valideazaCuiRo / valideazaCnp de acolo.
// CNP-ul (opțional, doar PF cu adresă din RO) se salvează criptat (rpc
// cripteaza_camp) + cnp_ultimele3 și nu se întoarce niciodată în clar.
// Firma din RO se verifică la ANAF (verificaFirmaRoLaAnaf): inactivă /
// radiată → refuz; ANAF indisponibil → sursa 'manual'.
//
// Comanda păstrează o copie (comenzi.date_facturare): dateFacturareDinAgenda
// construiește aceeași formă ca în 11-P2b; modificarea ulterioară a agendei
// nu schimbă comenzile plasate.
//
// Funcțiile întorc { ok:true, ... } sau
// { ok:false, status, cod, camp, error, error_en } (pentru trimiteEroare).

const { supabaseAdmin } = require('./supabaseAdmin');
const { valideazaDateFacturare, valideazaAdresa } = require('./date-facturare');
const { verificaFirmaRoLaAnaf, MESAJE_ANAF } = require('./cauta-firma');

const LIMITA_ADRESE = 10;
const LIMITA_PROFILURI = 5;
const FOLOSIRI = ['prestare', 'facturare', 'ambele'];
const T_ADRESE = 'adrese_cont';
const T_PROFILURI = 'profiluri_facturare';

const MESAJE = {
  limita_adrese: {
    ro: 'Ai deja 10 adrese salvate, cât permite un cont. Șterge una ca să adaugi alta.',
    en: 'You already have 10 saved addresses, the most an account can hold. Delete one to add another.',
  },
  limita_profiluri: {
    ro: 'Ai deja 5 profiluri de facturare, cât permite un cont. Șterge unul ca să adaugi altul.',
    en: 'You already have 5 billing profiles, the most an account can hold. Delete one to add another.',
  },
  adresa_negasita: {
    ro: 'Adresa nu există în contul tău.',
    en: 'This address does not exist in your account.',
  },
  profil_negasit: {
    ro: 'Profilul de facturare nu există în contul tău.',
    en: 'This billing profile does not exist in your account.',
  },
  folosire: {
    ro: 'Alege la ce folosești adresa: prestare, facturare sau ambele.',
    en: 'Choose what the address is for: service, billing or both.',
  },
  adresa_profil: {
    ro: 'Alege adresa sediului firmei sau adaugă una nouă.',
    en: "Choose the company's registered office address or add a new one.",
  },
  implicit_nepotrivit: {
    ro: 'Adresa nu poate fi implicită pentru această folosire. Schimbă-i întâi folosirea.',
    en: 'This address cannot be the default for this use. Change what it is used for first.',
  },
  tip_implicit: {
    ro: 'Alege ce setezi ca implicit: adresa de prestare, adresa de facturare sau profilul.',
    en: 'Choose what to set as default: the service address, the billing address or the profile.',
  },
  adresa_alta_tara: {
    ro: 'Adresa aleasă e în altă țară decât cea pentru care ai configurat serviciul. Reconfigurează serviciul pentru noua adresă.',
    en: 'The selected address is in a different country from the one the service was configured for. Reconfigure the service for the new address.',
  },
  adresa_schimbata_pret: {
    ro: 'Prețul a fost calculat pentru altă localitate sau alt județ decât adresa aleasă. Recalculează prețul pentru noua adresă (reconfigurează serviciul), apoi plasează comanda.',
    en: 'The price was calculated for a different city or county from the selected address. Recalculate the price for the new address (reconfigure the service), then place the order.',
  },
};

function eroare(status, cod, camp, m) {
  return { ok: false, status, cod, camp, error: m.ro, error_en: m.en };
}
// O eroare din lib/date-facturare.js ({ ok:false, camp, error, error_en }), cu câmpul redenumit.
function eroareValidare(r, camp) {
  return { ok: false, status: 400, cod: 'DATE_INVALIDE', camp: camp || r.camp, error: r.error, error_en: r.error_en };
}
function text(v, max = 200) {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}
const acum = () => new Date().toISOString();
const doarAdresa = (a) => (a ? { strada: a.strada, localitate: a.localitate, judet: a.judet || null, cod_postal: a.cod_postal || null, tara: a.tara } : null);
const poatePrestare = (folosire) => folosire === 'prestare' || folosire === 'ambele';
const poateFacturare = (folosire) => folosire === 'facturare' || folosire === 'ambele';

async function citeste(q) {
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

async function adresaProprie(userId, id) {
  if (!id || typeof id !== 'string') return null;
  return citeste(supabaseAdmin.from(T_ADRESE).select('*').eq('id', id).eq('user_id', userId).maybeSingle());
}
async function profilPropriu(userId, id) {
  if (!id || typeof id !== 'string') return null;
  return citeste(supabaseAdmin.from(T_PROFILURI).select('*').eq('id', id).eq('user_id', userId).maybeSingle());
}

// ── Forma publică: fără user_id și fără CNP (doar cnp_furnizat + cnp_ultimele3) ──
function adresaPublica(a) {
  const { user_id: _u, ...rest } = a;
  return rest;
}
function profilPublic(p) {
  const { user_id: _u, cnp_criptat: cnp, ...rest } = p;
  return { ...rest, cnp_furnizat: !!cnp, cnp_ultimele3: cnp ? rest.cnp_ultimele3 : null };
}

async function agendaPublica(userId) {
  const [adrese, profiluri] = await Promise.all([
    citeste(supabaseAdmin.from(T_ADRESE).select('*').eq('user_id', userId).order('creat_la', { ascending: true })),
    citeste(supabaseAdmin.from(T_PROFILURI).select('*').eq('user_id', userId).order('creat_la', { ascending: true })),
  ]);
  return { adrese: (adrese || []).map(adresaPublica), profiluri: (profiluri || []).map(profilPublic) };
}

// Un singur rând implicit pe cont și pe coloană (indexurile unice parțiale din
// migrare): marcajul se scoate întâi de pe celelalte rânduri.
async function marcheazaImplicit(userId, tabel, coloana, id) {
  await citeste(supabaseAdmin.from(tabel).update({ [coloana]: false }).eq('user_id', userId).eq(coloana, true).neq('id', id));
  await citeste(supabaseAdmin.from(tabel).update({ [coloana]: true, actualizat_la: acum() }).eq('id', id).eq('user_id', userId));
}

// ── Adrese ─────────────────────────────────────────────────────────────
function valideazaAdresaCont(corp) {
  const c = corp && typeof corp === 'object' ? corp : {};
  const folosire = c.folosire == null || c.folosire === '' ? 'ambele' : c.folosire;
  if (!FOLOSIRI.includes(folosire)) return eroare(400, 'DATE_INVALIDE', 'folosire', MESAJE.folosire);
  const r = valideazaAdresa(c, '');
  if (!r.ok) return eroareValidare(r, r.camp.replace(/^adresa\./, ''));
  return {
    ok: true,
    adresa: {
      eticheta: text(c.eticheta, 60) || null,
      folosire,
      ...r.adresa,
      instructiuni_acces: folosire === 'facturare' ? null : (text(c.instructiuni_acces, 300) || null),
    },
  };
}

async function salveazaAdresa(userId, corp) {
  const c = corp && typeof corp === 'object' ? corp : {};
  const v = valideazaAdresaCont(c);
  if (!v.ok) return v;
  const toate = await citeste(supabaseAdmin.from(T_ADRESE).select('id, implicita_prestare, implicita_facturare').eq('user_id', userId));
  let id = c.id || null;
  if (id) {
    const existenta = await adresaProprie(userId, id);
    if (!existenta) return eroare(404, 'NU_EXISTA', 'id', MESAJE.adresa_negasita);
    const modificari = { ...v.adresa, actualizat_la: acum() };
    // O adresă care nu mai e pentru prestare / facturare nu mai poate fi implicită acolo.
    if (!poatePrestare(v.adresa.folosire)) modificari.implicita_prestare = false;
    if (!poateFacturare(v.adresa.folosire)) modificari.implicita_facturare = false;
    await citeste(supabaseAdmin.from(T_ADRESE).update(modificari).eq('id', id).eq('user_id', userId));
  } else {
    if ((toate || []).length >= LIMITA_ADRESE) return eroare(409, 'LIMITA_ATINSA', 'id', MESAJE.limita_adrese);
    const nou = await citeste(supabaseAdmin.from(T_ADRESE)
      .insert({ user_id: userId, ...v.adresa, implicita_prestare: false, implicita_facturare: false })
      .select().single());
    id = nou.id;
  }
  // Implicită la cerere; prima adresă pentru o folosire devine implicită de la sine.
  const altele = (toate || []).filter((a) => a.id !== id);
  const fara = (col) => !altele.some((a) => a[col]);
  if (poatePrestare(v.adresa.folosire) && (c.implicita_prestare === true || (!c.id && fara('implicita_prestare')))) {
    await marcheazaImplicit(userId, T_ADRESE, 'implicita_prestare', id);
  }
  if (poateFacturare(v.adresa.folosire) && (c.implicita_facturare === true || (!c.id && fara('implicita_facturare')))) {
    await marcheazaImplicit(userId, T_ADRESE, 'implicita_facturare', id);
  }
  return { ok: true, id };
}

// Profilurile care foloseau adresa rămân, fără adresă (adresa_facturare_id = null);
// pagina cere alegerea alteia.
async function stergeAdresa(userId, id) {
  const a = await adresaProprie(userId, id);
  if (!a) return eroare(404, 'NU_EXISTA', 'id', MESAJE.adresa_negasita);
  const folosita = await citeste(supabaseAdmin.from(T_PROFILURI).select('id').eq('user_id', userId).eq('adresa_facturare_id', id));
  if ((folosita || []).length) {
    await citeste(supabaseAdmin.from(T_PROFILURI).update({ adresa_facturare_id: null, actualizat_la: acum() }).eq('user_id', userId).eq('adresa_facturare_id', id));
  }
  await citeste(supabaseAdmin.from(T_ADRESE).delete().eq('id', id).eq('user_id', userId));
  return { ok: true, id, profiluri_fara_adresa: (folosita || []).map((p) => p.id) };
}

// ── Profiluri de facturare ─────────────────────────────────────────────
// optiuni (salvarea din comandă): { cnpCriptat, cnpUltimele3, anaf: { sursa, tva_activ } }
async function salveazaProfil(userId, corp, optiuni = {}) {
  const c = corp && typeof corp === 'object' ? corp : {};
  let existent = null;
  if (c.id) {
    existent = await profilPropriu(userId, c.id);
    if (!existent) return eroare(404, 'NU_EXISTA', 'id', MESAJE.profil_negasit);
  }
  const toate = await citeste(supabaseAdmin.from(T_PROFILURI).select('id, implicit').eq('user_id', userId));
  if (!existent && (toate || []).length >= LIMITA_PROFILURI) return eroare(409, 'LIMITA_ATINSA', 'id', MESAJE.limita_profiluri);

  // Adresa: una nouă (salvată odată cu profilul) sau una din agendă.
  const areAdresaNoua = c.adresa_noua && typeof c.adresa_noua === 'object';
  let adresaNoua = null;
  let adresaExistenta = null;
  if (areAdresaNoua) {
    const v = valideazaAdresaCont({ ...c.adresa_noua, folosire: 'facturare' });
    if (!v.ok) return { ...v, camp: 'adresa_noua.' + v.camp };
    adresaNoua = v.adresa;
  } else if (c.adresa_facturare_id) {
    adresaExistenta = await adresaProprie(userId, c.adresa_facturare_id);
    if (!adresaExistenta) return eroare(404, 'NU_EXISTA', 'adresa_facturare_id', MESAJE.adresa_negasita);
  }
  const adresa = doarAdresa(adresaNoua || adresaExistenta);
  const campAdresa = (camp) => (areAdresaNoua ? camp.replace(/^adresa\./, 'adresa_noua.') : 'adresa_facturare_id');

  if (c.tip === 'pj' && !adresa) return eroare(400, 'DATE_INVALIDE', 'adresa_facturare_id', MESAJE.adresa_profil);
  const pentruValidare = c.tip === 'pj'
    ? { tip: 'pj', cui: c.cui, denumire: c.denumire, nr_reg_com: c.nr_reg_com, adresa }
    : { tip: c.tip, prenume: c.prenume, nume: c.nume, cnp: c.cnp, adresa_alta: !!adresa, adresa };
  // Fără adresă, PF folosește la comandă adresa lucrării (din RO, unde e checkout-ul activ).
  const v = valideazaDateFacturare(pentruValidare, { taraComanda: 'RO', adresaLucrare: { tara: 'RO' } });
  if (!v.ok) {
    const camp = v.camp === 'date_facturare' ? 'tip' : (/^adresa\./.test(v.camp) ? campAdresa(v.camp) : v.camp);
    return eroareValidare(v, camp);
  }
  const df = v.date_facturare;

  const rand = {
    eticheta: text(c.eticheta, 60) || null,
    tip: df.tip,
    prenume: df.tip === 'pf' ? df.prenume : null,
    nume: df.tip === 'pf' ? df.nume : null,
    denumire: df.tip === 'pj' ? df.denumire : null,
    cui: df.tip === 'pj' ? df.cui : null,
    nr_reg_com: df.tip === 'pj' ? df.nr_reg_com : null,
    tva_activ: null,
    sursa: null,
  };

  // CNP: nou → criptat; gol la editare → se păstrează cel salvat (sau se șterge la cerere);
  // adresă din altă țară sau firmă → fără CNP.
  const cnpPermis = df.tip === 'pf' && (!adresa || adresa.tara === 'RO');
  if (!cnpPermis || c.sterge_cnp === true) {
    rand.cnp_criptat = null; rand.cnp_ultimele3 = null;
  } else if (optiuni.cnpCriptat) {
    rand.cnp_criptat = optiuni.cnpCriptat; rand.cnp_ultimele3 = optiuni.cnpUltimele3 || null;
  } else if (v.cnp) {
    const { data: criptat, error } = await supabaseAdmin.rpc('cripteaza_camp', { valoare: v.cnp });
    if (error || !criptat) throw error || new Error('cripteaza_camp nu a întors valoarea');
    rand.cnp_criptat = criptat; rand.cnp_ultimele3 = v.cnp.slice(-3);
  } else if (!existent) {
    rand.cnp_criptat = null; rand.cnp_ultimele3 = null;
  }

  // Firma din RO: ANAF (inactivă → refuz; indisponibilă → manual).
  if (df.tip === 'pj') {
    rand.sursa = 'manual';
    if (optiuni.anaf) {
      rand.sursa = optiuni.anaf.sursa || 'manual';
      rand.tva_activ = optiuni.anaf.tva_activ ?? null;
    } else if (adresa.tara === 'RO') {
      const r = await verificaFirmaRoLaAnaf(df.cui);
      if (r.stare === 'inactiva') return eroare(400, 'FIRMA_INACTIVA', 'cui', MESAJE_ANAF.firma_inactiva);
      if (r.stare === 'activa') { rand.sursa = 'anaf'; rand.tva_activ = !!r.anaf.tva_activ; }
    }
  }

  // Adresa nouă se salvează abia acum, după toate verificările.
  let adresaId = adresaExistenta ? adresaExistenta.id : null;
  if (adresaNoua) {
    const r = await salveazaAdresa(userId, { ...adresaNoua, folosire: 'facturare' });
    if (!r.ok) return { ...r, camp: 'adresa_noua' };
    adresaId = r.id;
  }
  rand.adresa_facturare_id = adresaId;

  let id = existent ? existent.id : null;
  if (id) {
    await citeste(supabaseAdmin.from(T_PROFILURI).update({ ...rand, actualizat_la: acum() }).eq('id', id).eq('user_id', userId));
  } else {
    const nou = await citeste(supabaseAdmin.from(T_PROFILURI).insert({ user_id: userId, ...rand, implicit: false }).select().single());
    id = nou.id;
  }
  const faraImplicit = !(toate || []).some((p) => p.implicit && p.id !== id);
  if (c.implicit === true || (!existent && faraImplicit)) await marcheazaImplicit(userId, T_PROFILURI, 'implicit', id);
  return { ok: true, id, adresa_id: adresaId };
}

async function stergeProfil(userId, id) {
  const p = await profilPropriu(userId, id);
  if (!p) return eroare(404, 'NU_EXISTA', 'id', MESAJE.profil_negasit);
  await citeste(supabaseAdmin.from(T_PROFILURI).delete().eq('id', id).eq('user_id', userId));
  return { ok: true, id };
}

// tip: 'adresa_prestare' | 'adresa_facturare' | 'profil'
async function seteazaImplicit(userId, { tip, id } = {}) {
  if (tip === 'profil') {
    if (!(await profilPropriu(userId, id))) return eroare(404, 'NU_EXISTA', 'id', MESAJE.profil_negasit);
    await marcheazaImplicit(userId, T_PROFILURI, 'implicit', id);
    return { ok: true, id };
  }
  if (tip !== 'adresa_prestare' && tip !== 'adresa_facturare') return eroare(400, 'DATE_INVALIDE', 'tip', MESAJE.tip_implicit);
  const a = await adresaProprie(userId, id);
  if (!a) return eroare(404, 'NU_EXISTA', 'id', MESAJE.adresa_negasita);
  const prestare = tip === 'adresa_prestare';
  if (prestare ? !poatePrestare(a.folosire) : !poateFacturare(a.folosire)) return eroare(400, 'DATE_INVALIDE', 'tip', MESAJE.implicit_nepotrivit);
  await marcheazaImplicit(userId, T_ADRESE, prestare ? 'implicita_prestare' : 'implicita_facturare', id);
  return { ok: true, id };
}

// ── Comanda (api/comenzi/creeaza.js) ───────────────────────────────────
// Adresa de prestare din agendă → textul `adresa` (ca în checkout: stradă,
// localitate, județ) și adresa pe câmpuri.
async function adresaPrestareDinAgenda(userId, id) {
  const a = await adresaProprie(userId, id);
  if (!a) return eroare(404, 'NU_EXISTA', 'adresa_prestare_id', MESAJE.adresa_negasita);
  return { ok: true, adresa: [a.strada, a.localitate, a.judet].filter(Boolean).join(', '), adresa_lucrare: doarAdresa(a), rand: a, zona: zonaAdresa(a) };
}

// Câmpurile geografice ale comenzii din adresa salvată (corecția PR #36):
// `regiune` e județul ca text, în același format pe care îl trimit checkout-ul
// (co-judet, MYD_CFG.regiune) și calculul de preț — numele județului, nu codul
// din geo_regiuni (nicio conversie nu există azi în pagini sau în server).
function zonaAdresa(a) {
  return {
    tara_cod: String(a.tara || '').trim().toUpperCase() || null,
    regiune: text(a.judet, 80) || null,
    localitate: text(a.localitate, 120) || null,
  };
}

// Comparația județ / localitate fără diacritice, majuscule și prefixe
// („Județul Cluj” = „Cluj” = „Cluj County”), ca o diferență doar de scriere
// să nu ceară recalcularea prețului. Aceeași regulă în agenda-cont.js (pagină).
const PREFIXE_LOC = /\b(judetul|judet|county|municipiul|municipiu|orasul|oras|comuna|sectorul)\b/g;
function normalizeazaLoc(v) {
  return String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(PREFIXE_LOC, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function aceeasiZona(zonaAdresaSalvata, regiune, localitate) {
  return normalizeazaLoc(zonaAdresaSalvata.regiune) === normalizeazaLoc(regiune)
    && normalizeazaLoc(zonaAdresaSalvata.localitate) === normalizeazaLoc(localitate);
}

// Profilul (și, opțional, altă adresă de facturare sau 'lucrare') → aceeași copie
// date_facturare ca în 11-P2b; CNP-ul profilului rămâne criptat (cnp_criptat).
async function dateFacturareDinAgenda(userId, { profilId, adresaFacturareId, taraComanda, adresaLucrare } = {}) {
  const p = await profilPropriu(userId, profilId);
  if (!p) return eroare(404, 'NU_EXISTA', 'profil_facturare_id', MESAJE.profil_negasit);
  let a = null;
  // 'lucrare': persoana fizică e facturată la adresa lucrării (fără adresa din profil).
  if (adresaFacturareId === 'lucrare') {
    a = null;
  } else if (adresaFacturareId) {
    a = await adresaProprie(userId, adresaFacturareId);
    if (!a) return eroare(404, 'NU_EXISTA', 'adresa_facturare_id', MESAJE.adresa_negasita);
  } else if (p.adresa_facturare_id) {
    a = await adresaProprie(userId, p.adresa_facturare_id);
  }
  const adresa = doarAdresa(a);
  if (p.tip === 'pj' && !adresa) return eroare(400, 'DATE_INVALIDE', 'profil_facturare_id', MESAJE.adresa_profil);
  const corp = p.tip === 'pj'
    ? { tip: 'pj', cui: p.cui, denumire: p.denumire, nr_reg_com: p.nr_reg_com, adresa }
    : { tip: 'pf', prenume: p.prenume, nume: p.nume, adresa_alta: !!adresa, adresa };
  const v = valideazaDateFacturare(corp, { taraComanda, adresaLucrare });
  if (!v.ok) return eroareValidare(v, 'profil_facturare_id');
  const cnpCriptat = p.tip === 'pf' && p.cnp_criptat && v.date_facturare.adresa.tara === 'RO' ? p.cnp_criptat : null;
  if (cnpCriptat) {
    v.date_facturare.cnp_furnizat = true;
    v.date_facturare.cnp_ultimele3 = p.cnp_ultimele3 || null;
  }
  return { ok: true, tip_client: v.tip_client, date_facturare: v.date_facturare, cnp_criptat: cnpCriptat };
}

// „Salvează în contul meu” la plasarea comenzii: adresa de prestare și / sau
// profilul introduse în formular. Fără dubluri: o adresă cu aceeași stradă,
// localitate și țară (sau un profil cu același CUI / același nume) se refolosește.
const cheieAdresa = (a) => [a.strada, a.localitate, a.tara].map((x) => String(x || '').trim().toLowerCase()).join('|');
async function adresaCaInAgenda(userId, adresa, folosire) {
  const toate = await citeste(supabaseAdmin.from(T_ADRESE).select('*').eq('user_id', userId));
  const gasita = (toate || []).find((a) => cheieAdresa(a) === cheieAdresa(adresa));
  if (gasita) {
    // Aceeași adresă, folosită acum și pentru celălalt scop → „ambele”.
    if (gasita.folosire !== 'ambele' && gasita.folosire !== folosire) {
      await citeste(supabaseAdmin.from(T_ADRESE).update({ folosire: 'ambele', actualizat_la: acum() }).eq('id', gasita.id).eq('user_id', userId));
    }
    return { ok: true, id: gasita.id };
  }
  return salveazaAdresa(userId, { ...adresa, folosire });
}

// adresaFacturareSeparata: PF cu „Adresa de facturare e alta” (firma are mereu sediul).
async function salveazaDinComanda(userId, { adresaPrestare = null, dateFacturare = null, adresaFacturareSeparata = false, cnpCriptat = null } = {}) {
  if (adresaPrestare) {
    const r = await adresaCaInAgenda(userId, adresaPrestare, 'prestare');
    if (!r.ok) return r;
  }
  if (dateFacturare) {
    const df = dateFacturare;
    const profiluri = await citeste(supabaseAdmin.from(T_PROFILURI).select('id, tip, cui, prenume, nume').eq('user_id', userId));
    const la = (x) => String(x || '').trim().toLowerCase();
    const existent = (profiluri || []).find((p) => (df.tip === 'pj'
      ? p.tip === 'pj' && la(p.cui) === la(df.cui)
      : p.tip === 'pf' && la(p.prenume) === la(df.prenume) && la(p.nume) === la(df.nume)));
    if (existent) return { ok: true, id: existent.id };
    // PF fără adresă separată: profilul rămâne fără adresă (la comandă = adresa lucrării).
    let adresaId = null;
    if ((df.tip === 'pj' || adresaFacturareSeparata) && df.adresa && df.adresa.strada) {
      const r = await adresaCaInAgenda(userId, df.adresa, 'facturare');
      if (!r.ok) return r;
      adresaId = r.id;
    }
    const corp = df.tip === 'pj'
      ? { tip: 'pj', cui: df.cui, denumire: df.denumire, nr_reg_com: df.nr_reg_com, adresa_facturare_id: adresaId }
      : { tip: 'pf', prenume: df.prenume, nume: df.nume, adresa_facturare_id: adresaId };
    return salveazaProfil(userId, corp, {
      cnpCriptat: df.tip === 'pf' ? cnpCriptat : null,
      cnpUltimele3: df.cnp_ultimele3 || null,
      anaf: df.tip === 'pj' ? { sursa: df.sursa, tva_activ: df.tva_activ } : null,
    });
  }
  return { ok: true };
}

module.exports = {
  LIMITA_ADRESE, LIMITA_PROFILURI, MESAJE,
  valideazaAdresaCont, agendaPublica, adresaPublica, profilPublic,
  salveazaAdresa, stergeAdresa, salveazaProfil, stergeProfil, seteazaImplicit,
  adresaPrestareDinAgenda, dateFacturareDinAgenda, salveazaDinComanda,
  zonaAdresa, normalizeazaLoc, aceeasiZona,
};
