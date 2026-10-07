// lib/elibereaza-escrow.js
// REScris (2026-07-22) — arhitectura veche (single-partner: comision_platforma
// + suma_partener = restul, plus split separat pentru asigurare) a fost
// semnalată explicit ca incorectă: presupunea UN singur beneficiar pentru
// toată "valoarea serviciului", când de fapt o comandă poate implica până
// la 5 actori diferiți, plătiți separat din ACEEAȘI comandă — profesionist
// (manoperă), furnizor materiale, furnizor închiriere echipamente, curier
// de cartier, asigurător. Tabela `comanda_subcontractori` exista deja în
// schemă, cu exact aceste 5 valori pentru `rol_tip` — orfană până acum
// (nicio linie de cod nu o folosea).
//
// IMPORTANT: acest fișier NU procesează bani reali — calculează și
// înregistrează sumele (status 'alocat' în comanda_subcontractori: sumă
// determinată, transfer efectiv încă neexecutat). Transferul efectiv
// necesită integrarea cu un procesator real, un proiect separat de
// configurare cont comerciant.
//
// REZOLVAT (G11, 25 Iulie 2026): pentru rolurile materiale/rental_echipament/
// curier/asigurare, actor_id era mereu null — sumele erau corecte, dar cui-i
// revine efectiv nu era determinat de sistem. lib/aloca-subcontractori.js
// (nou) completează acum actor_id pentru aceste 4 roluri, reutilizând
// motorul de bifare portofoliu de la G10 (partener_servicii_active) +
// tiparul geo/disponibilitate deja folosit pentru manoperă. Rămâne posibil
// ca actor_id să rămână null dacă nu există niciun partener eligibil în
// zonă — sumele tot se înregistrează corect, doar fără atribuire de plată.
//
// Cele DOUĂ căi de calcul de mai jos:
//  - itemizată (rețetă multi-partener): comanda are componentele de cost
//    înghețate la creare (api/comenzi/creeaza.js, cu lib/calculeaza-pret.js)
//    — sumele NU se recalculează aici, doar se citesc și se împart.
//  - legacy (fallback): comenzi vechi/apeluri care au trimis doar
//    `valoare_totala` — nicio componentă itemizată. Comportamentul e cel
//    dinainte de acest audit, DAR cu o corecție reală: modelul vechi calcula
//    `suma_asigurator = suma_asigurare × (1 − pct_intermediere/100)` și
//    PIERDEA restul (comisionul de intermediere reținut nu ajungea niciodată
//    în `comisioane.comision_platforma` sau oriunde altundeva) — o comandă
//    de 980 Lei cu 100 Lei asigurare la 15% intermediere "rătăcea" efectiv
//    15 Lei, niciunde înregistrați. Acum comisionul de intermediere reținut
//    e adăugat explicit la `comision_platforma`, ca identitatea sumelor să
//    țină și pentru comenzile vechi.

const { supabaseAdmin } = require('./supabaseAdmin');
const { completeazaActorii } = require('./aloca-subcontractori');
const { citesteConfigSectiune } = require('./calculeaza-pret');

const COMISION_INTERMEDIERE_ASIGURARE_FALLBACK_PCT = 15;

// Procentele se citesc pe țara comenzii, cu `ALL` ca valoare implicită
// (aceeași regulă ca în lib/calculeaza-pret.js).
async function citesteConfigPricing(tara) {
  return citesteConfigSectiune('pricing', tara);
}

async function comisionIntermediereAsigurarePct(tara) {
  const cfg = await citesteConfigSectiune('asigurari', tara);
  const pct = cfg.comision_intermediere_pct;
  return Number.isFinite(pct) ? pct : COMISION_INTERMEDIERE_ASIGURARE_FALLBACK_PCT;
}

function rotund(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Calea itemizată — comanda are componentele de cost înghețate la creare.
 * Returnează rândurile de inserat în comanda_subcontractori + totalul reținut
 * de platformă (pentru rândul din `comisioane`).
 */
async function planificaSplitItemizat(comanda) {
  const manopera = Number(comanda.suma_manopera) || 0;
  const materiale = Number(comanda.suma_materiale) || 0;
  const chirieScule = Number(comanda.suma_chirie_scule) || 0;
  const curier = Number(comanda.suma_transport) || 0;
  const asigurare = Number(comanda.suma_asigurare) || 0;
  // D2b (25 august 2026, aprobat) — până acum, aceste două sume erau
  // calculate (lib/calculeaza-pret.js) dar NICIODATĂ citite aici: banii
  // rămâneau incluși în suma_totala_platita, dar nu ajungeau la niciun
  // actor — gaură de integritate, aceeași categorie ca la comisionul de
  // intermediere al asigurării, reparat anterior. Azi 0 comenzi reale au
  // aceste sume >0 (tarife_transport gol) — comportament neschimbat pentru
  // orice comandă existentă, doar reparat pentru viitor.
  const transportator = Number(comanda.suma_transport_greutate) || 0;
  const ajutor = Number(comanda.suma_ajutor) || 0;

  const randuri = [];
  // Varianta 2 "Echipă" (24 august 2026) — dacă rețeta comenzii a cerut mai
  // mult de un cod ESCO (comenzi.manopera_esco_breakdown, înghețat la
  // creare), manopera se împarte: esco-ul principal rămâne un rând
  // 'manopera' către partenerul deja alocat la acceptare; restul devin
  // rânduri noi 'specialist', alocate separat mai jos, fiecare pe cod_esco
  // propriu. Azi 0 servicii live au rețetă multi-ESCO — breakdown are mereu
  // ≤1 intrare, deci ramura de jos (identică cu comportamentul dinainte de
  // această extensie) e cea care rulează mereu în producție.
  const breakdown = Array.isArray(comanda.manopera_esco_breakdown) ? comanda.manopera_esco_breakdown : [];
  if (manopera > 0) {
    if (breakdown.length > 1) {
      const principalEntry = breakdown.find((b) => b.principal) || breakdown[0];
      randuri.push({ rol_tip: 'manopera', actor_id: comanda.partener_id || null, suma_neta_alocata: rotund(principalEntry.suma) });
      for (const r of breakdown) {
        if (r === principalEntry || !(Number(r.suma) > 0)) continue;
        randuri.push({ rol_tip: 'specialist', actor_id: null, cod_esco_necesar: r.cod_esco, suma_neta_alocata: rotund(r.suma) });
      }
    } else {
      randuri.push({ rol_tip: 'manopera', actor_id: comanda.partener_id || null, suma_neta_alocata: manopera });
    }
  }
  // Materiale și închirieri: suma brută (prețul public). Reținerea depinde
  // de furnizor, deci se aplică abia după alocare (aplicaDiscounturiParteneri).
  if (materiale > 0) {
    randuri.push({ rol_tip: 'materiale', actor_id: null, suma_neta_alocata: rotund(materiale), _brut: true, _categorie: 'materiale' });
  }
  if (chirieScule > 0) {
    randuri.push({ rol_tip: 'rental_echipament', actor_id: null, suma_neta_alocata: rotund(chirieScule), _brut: true, _categorie: 'inchirieri' });
  }
  if (curier > 0) {
    randuri.push({ rol_tip: 'curier', actor_id: null, suma_neta_alocata: curier });
  }
  // Asigurarea: suma brută; după alocare merge la asigurătorul partener
  // (minus discountul lui sau comisionul de intermediere) sau, fără
  // asigurător, devine rezerva de daune a Home Best Pal.
  if (asigurare > 0) {
    randuri.push({ rol_tip: 'asigurare', actor_id: null, suma_neta_alocata: rotund(asigurare), _brut: true, _categorie: 'asigurari' });
  }
  if (transportator > 0) {
    randuri.push({ rol_tip: 'transportator', actor_id: null, suma_neta_alocata: transportator });
  }
  if (ajutor > 0) {
    randuri.push({ rol_tip: 'ajutor', actor_id: null, suma_neta_alocata: ajutor });
  }

  const comisionPlatforma = Number(comanda.suma_comision_platforma) || 0;
  const costMarketing = Number(comanda.suma_marketing) || 0;
  const costMentenanta = Number(comanda.suma_mentenanta) || 0;
  const tvaPlatforma = Number(comanda.tva_suma) || 0;

  // comision_retinut_bricolaj / _inchirieri se completează în
  // aplicaDiscounturiParteneri, după alocarea furnizorilor; până atunci
  // totalRetinut conține doar ce reține platforma indiferent de furnizor.
  const platformaRetine = {
    comision_platforma: comisionPlatforma,
    suma_marketing: costMarketing,
    suma_mentenanta: costMentenanta,
    comision_retinut_bricolaj: 0,
    comision_retinut_inchirieri: 0,
    tva_platforma: tvaPlatforma,
  };
  const totalRetinut = rotund(comisionPlatforma + costMarketing + costMentenanta + tvaPlatforma);

  // sumaAsiguratorCompat se completează în elibereazaEscrow, după alocare.
  return { randuri, platformaRetine, totalRetinut, sumaPartenerCompat: randuri.find(r => r.rol_tip === 'manopera')?.suma_neta_alocata || 0, sumaAsiguratorCompat: 0 };
}

/**
 * Calea legacy — comandă fără componente itemizate, doar suma_totala_platita
 * (+ eventual suma_asigurare). Corectează scurgerea din modelul vechi
 * (comisionul de intermediere asigurare reținut era pierdut, niciodată
 * înregistrat).
 */
async function planificaSplitLegacy(comanda) {
  const sumaAsigurare = Number(comanda.suma_asigurare) || 0;
  const valoareServiciu = (Number(comanda.suma_totala_platita) || 0) - sumaAsigurare;
  const procentComision = Number(comanda.comision_pct) || 12.0;
  const comisionServiciu = rotund(valoareServiciu * (procentComision / 100));
  const sumaPartener = rotund(valoareServiciu - comisionServiciu);

  let sumaAsigurator = 0;
  let comisionRetinutAsigurare = 0;
  if (sumaAsigurare > 0) {
    const pctIntermediere = await comisionIntermediereAsigurarePct(comanda.tara_cod);
    comisionRetinutAsigurare = rotund(sumaAsigurare * (pctIntermediere / 100));
    sumaAsigurator = rotund(sumaAsigurare - comisionRetinutAsigurare);
  }

  const randuri = [];
  if (sumaPartener > 0) {
    randuri.push({ rol_tip: 'manopera', actor_id: comanda.partener_id || null, suma_neta_alocata: sumaPartener });
  }
  if (sumaAsigurator > 0) {
    randuri.push({ rol_tip: 'asigurare', actor_id: null, suma_neta_alocata: sumaAsigurator });
  }

  const comisionPlatformaTotal = rotund(comisionServiciu + comisionRetinutAsigurare);
  const platformaRetine = {
    comision_platforma: comisionPlatformaTotal,
    suma_marketing: 0,
    suma_mentenanta: 0,
    comision_retinut_bricolaj: 0,
    comision_retinut_inchirieri: 0,
    tva_platforma: 0,
  };

  return { randuri, platformaRetine, totalRetinut: comisionPlatformaTotal, sumaPartenerCompat: sumaPartener, sumaAsiguratorCompat: sumaAsigurator };
}

// ── Discountul partenerului în locul reținerii fixe (decizie LM, 7.10.2026) ──
// Furnizorii de materiale/închirieri acordă Home Best Pal un discount
// negociat (parteneri_discounturi). Furnizorul primește suma de pe factura
// lui către HBP = preț public × (1 − discount%); restul e venitul HBP.
// Discountul ÎNLOCUIEȘTE procentul fix din panou, nu se adaugă la el.

const PCT_PANOU_FALLBACK = 15;

// Procentul din panou, folosit când partenerul nu are discount activ.
// Asigurări: comisionul de intermediere (secțiunea `asigurari`).
async function citestePctPanou(tara) {
  const [pricing, asigurari] = await Promise.all([
    citesteConfigPricing(tara),
    comisionIntermediereAsigurarePct(tara),
  ]);
  const sau15 = (v) => (Number.isFinite(v) ? v : PCT_PANOU_FALLBACK);
  return {
    materiale: sau15(pricing.comision_bricolaj_contractat_pct),
    inchirieri: sau15(pricing.comision_inchiriere_contractat_pct),
    asigurari,
  };
}

// comanda_subcontractori.rol_tip → parteneri_discounturi.tip_partener
const ROL_LA_TIP_DISCOUNT = {
  materiale: 'materiale',
  rental_echipament: 'inchirieri',
  asigurare: 'asigurari',
};

// Facturile partenerului cu discountul salvat la emitere (suma_bruta setată),
// pentru rolurile acestei comenzi. Coloanele de discount vin cu migrarea
// docs/migrations-propuse/2026-10-06_parteneri_discounturi.sql — până la
// aplicarea ei interogarea eșuează și se trece la pasul următor.
async function citesteFacturiCuDiscount(comandaId) {
  const { data, error } = await supabaseAdmin
    .from('facturi_parteneri')
    .select('partener_id, discount_pct, suma_bruta, comanda_subcontractori!inner(comanda_id, rol_tip)')
    .eq('comanda_subcontractori.comanda_id', comandaId)
    .not('suma_bruta', 'is', null);
  if (error) {
    console.error('[elibereaza-escrow] facturi_parteneri cu discount', error);
    return [];
  }
  return data || [];
}

// Discountul activ și aprobat al partenerului pe tipul dat, valabil la data
// comenzii. Rândul de escrow nu are categorie de produs: dacă partenerul are
// discounturi active pe mai multe categorii, se ia cel mai mic (furnizorul
// nu e plătit niciodată sub ce a negociat pe vreo categorie).
async function citesteDiscountActiv(partenerId, tipPartener, data) {
  const { data: rows, error } = await supabaseAdmin
    .from('parteneri_discounturi')
    .select('discount_pct, categorie')
    .eq('partener_id', partenerId)
    .eq('tip_partener', tipPartener)
    .eq('activ', true)
    .not('aprobat_de', 'is', null)
    .lte('valabil_de', data)
    .or(`valabil_pana.is.null,valabil_pana.gte.${data}`);
  if (error) {
    console.error('[elibereaza-escrow] parteneri_discounturi', error);
    return null;
  }
  const procente = (rows || []).map((r) => Number(r.discount_pct)).filter(Number.isFinite);
  if (!procente.length) return null;
  if (new Set(procente).size > 1) {
    console.warn(`[elibereaza-escrow] partenerul ${partenerId} are discounturi diferite pe ${tipPartener}; se aplică ${Math.min(...procente)}%`);
  }
  return Math.min(...procente);
}

/**
 * Rulează după completeazaActorii, înainte de inserarea în
 * comanda_subcontractori. Pentru fiecare rând marcat `_brut`, alege
 * procentul reținut și transformă suma brută în suma netă de plată:
 *   1. factura partenerului emisă cu discount salvat → `factura`
 *   2. discountul activ din profilul partenerului    → `profil_partener`
 *   3. procentul din panou (pe țară, cu ALL implicit) → `implicit_panou`
 * Setează discount_pct_aplicat / discount_sursa pe rând.
 *
 * Asigurarea fără asigurător partener (nici alocat, nici pe factură) nu are
 * reținere: rândul devine `rezerva_daune`, cu toată suma, la Home Best Pal
 * (actor_id null). Rezerva nu e venit și nu intră în comision_platforma;
 * din ea se plătesc dosarele de daună (dosare_dauna).
 * @returns {Promise<{materiale:number, inchirieri:number, asigurari:number}>} reținut pe categorie
 */
async function aplicaDiscounturiParteneri(comanda, randuri) {
  const retinut = { materiale: 0, inchirieri: 0, asigurari: 0 };
  const marcate = randuri.filter((r) => r._brut);
  if (!marcate.length) return retinut;

  const pctPanou = await citestePctPanou(comanda.tara_cod);
  const facturi = await citesteFacturiCuDiscount(comanda.id);
  const dataComenzii = String(comanda.creat_la || new Date().toISOString()).slice(0, 10);

  for (const rand of marcate) {
    const brut = rand.suma_neta_alocata;
    let pct = null;
    let sursa = null;

    const factura = facturi.find((f) =>
      f.comanda_subcontractori?.rol_tip === rand.rol_tip && (!rand.actor_id || f.partener_id === rand.actor_id)
    );
    if (factura && Number.isFinite(Number(factura.discount_pct))) {
      pct = Number(factura.discount_pct);
      sursa = 'factura';
      if (!rand.actor_id) rand.actor_id = factura.partener_id;
    }

    if (sursa === null && !rand.actor_id && rand._categorie === 'asigurari') {
      rand.rol_tip = 'rezerva_daune';
      continue;
    }

    if (sursa === null && rand.actor_id) {
      const discount = await citesteDiscountActiv(rand.actor_id, ROL_LA_TIP_DISCOUNT[rand.rol_tip], dataComenzii);
      if (discount !== null) {
        pct = discount;
        sursa = 'profil_partener';
      }
    }

    if (sursa === null) {
      pct = pctPanou[rand._categorie];
      sursa = 'implicit_panou';
    }

    const sumaRetinuta = rotund(brut * (pct / 100));
    rand.suma_neta_alocata = rotund(brut - sumaRetinuta);
    rand.discount_pct_aplicat = pct;
    rand.discount_sursa = sursa;
    retinut[rand._categorie] = rotund(retinut[rand._categorie] + sumaRetinuta);
  }
  return retinut;
}

/**
 * @param {string} comandaId
 * @param {string|null} eliberatDe - comisioane.eliberat_de e UUID (FK către un admin real) —
 *   NULL înseamnă eliberare automată de sistem (cron tacit / confirmare client), un UUID real
 *   înseamnă eliberare manuală declanșată de acel admin din backoffice.
 * @returns {Promise<{ok: true, comision: object, subcontractori: object[]} | {ok: false, error: string, status: number}>}
 */
async function elibereazaEscrow(comandaId, eliberatDe = null) {
  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('*')
    .eq('id', comandaId)
    .single();
  if (comErr || !comanda) return { ok: false, error: 'Comanda nu există', status: 404 };

  if (comanda.status !== 'finalizata') {
    return { ok: false, error: 'Comisionul se calculează doar pentru comenzi finalizate', status: 400 };
  }
  if (comanda.escrow_eliberat) {
    return { ok: false, error: 'Escrow deja eliberat pentru această comandă', status: 400 };
  }

  // D2b (25 august 2026) — suma_transport_greutate/suma_ajutor adăugate la
  // acest gate: înainte de această extensie, o comandă cu DOAR aceste două
  // componente (fără manopera/materiale/chirie/curier) ar fi căzut greșit
  // pe calea legacy, pierzând ambele sume din nou (aceeași gaură pe care
  // planificaSplitItemizat o închide mai jos).
  const areComponenteItemizate = [comanda.suma_manopera, comanda.suma_materiale, comanda.suma_chirie_scule, comanda.suma_transport, comanda.suma_transport_greutate, comanda.suma_ajutor]
    .some((v) => (Number(v) || 0) > 0);

  const plan = areComponenteItemizate ? await planificaSplitItemizat(comanda) : await planificaSplitLegacy(comanda);

  if (!plan.randuri.length) {
    return { ok: false, error: 'Comanda nu are nicio componentă de cost pozitivă de alocat', status: 400 };
  }

  // G11: completează actor_id pentru materiale/rental_echipament/curier/
  // asigurare (manopera e deja alocată la nivel de comandă) — best-effort,
  // nu blochează eliberarea escrow dacă nu găsește partener eligibil.
  await completeazaActorii(comanda, plan.randuri);

  // Reținerea pe materiale/închirieri, acum că furnizorii sunt cunoscuți.
  // Pe calea legacy nu există rânduri `_brut`, deci nu se schimbă nimic.
  const retinut = await aplicaDiscounturiParteneri(comanda, plan.randuri);
  plan.platformaRetine.comision_retinut_bricolaj = retinut.materiale;
  plan.platformaRetine.comision_retinut_inchirieri = retinut.inchirieri;
  plan.platformaRetine.comision_retinut_asigurari = retinut.asigurari;
  plan.totalRetinut = rotund(plan.totalRetinut + retinut.materiale + retinut.inchirieri + retinut.asigurari);
  if (areComponenteItemizate) {
    const asigurator = plan.randuri.find((r) => r.rol_tip === 'asigurare');
    plan.sumaAsiguratorCompat = asigurator?.suma_neta_alocata || 0;
    plan.asiguratorPartenerId = asigurator?.actor_id || null;
  }

  const acum = new Date().toISOString();

  const { data: subcontractori, error: subErr } = await supabaseAdmin
    .from('comanda_subcontractori')
    .insert(plan.randuri.map((r) => ({
      comanda_id: comanda.id,
      actor_id: r.actor_id,
      rol_tip: r.rol_tip,
      cod_esco_necesar: r.cod_esco_necesar || null,
      suma_neta_alocata: r.suma_neta_alocata,
      discount_pct_aplicat: r.discount_pct_aplicat ?? null,
      discount_sursa: r.discount_sursa || null,
      status: 'alocat',
      creat_la: acum,
    })))
    .select();
  if (subErr) {
    console.error('[elibereaza-escrow] comanda_subcontractori', subErr);
    return { ok: false, error: 'Nu am putut înregistra alocarea pe subcontractori', status: 500 };
  }

  const { data: comisionRow, error: comisionErr } = await supabaseAdmin
    .from('comisioane')
    .insert({
      comanda_id: comanda.id,
      valoare_totala: comanda.suma_totala_platita,
      comision_platforma: plan.platformaRetine.comision_platforma,
      suma_partener: plan.sumaPartenerCompat,
      suma_asigurator: plan.sumaAsiguratorCompat,
      suma_marketing: plan.platformaRetine.suma_marketing,
      suma_mentenanta: plan.platformaRetine.suma_mentenanta,
      comision_retinut_bricolaj: plan.platformaRetine.comision_retinut_bricolaj,
      comision_retinut_inchirieri: plan.platformaRetine.comision_retinut_inchirieri,
      comision_retinut_asigurari: plan.platformaRetine.comision_retinut_asigurari || 0,
      asigurator_partener_id: plan.asiguratorPartenerId || null,
      tva_platforma: plan.platformaRetine.tva_platforma,
      tara_cod: comanda.tara_cod,
      moneda: comanda.moneda,
      // FIX (audit 2026-07-22): în versiunea veche aceste două coloane nu
      // erau setate NICIODATĂ, deși existau în schemă — rupea calculul de
      // dividende pentru investitori (nicio comisioane row nu avea vreodată
      // escrow_eliberat_la, deci orice raportare filtrată pe interval de timp
      // nu găsea nimic).
      escrow_eliberat_la: acum,
      eliberat_de: eliberatDe,
    })
    .select()
    .single();
  if (comisionErr) {
    console.error('[elibereaza-escrow] comisioane', comisionErr);
    return { ok: false, error: 'Nu am putut înregistra comisionul', status: 500 };
  }

  await supabaseAdmin.from('comenzi').update({ escrow_eliberat: true }).eq('id', comanda.id);

  return { ok: true, comision: comisionRow, subcontractori };
}

module.exports = { elibereazaEscrow, planificaSplitItemizat, planificaSplitLegacy, aplicaDiscounturiParteneri };
