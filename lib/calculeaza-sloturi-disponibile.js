// lib/calculeaza-sloturi-disponibile.js
// G28 — calculează sloturile de 2 ore real disponibile pentru o zonă +
// dată, ca să elimine programările imposibile din calendarul de pe
// mydarrin-produs.html (înainte, orice zi/oră era mereu selectabilă,
// fără nicio verificare, iar alegerea nici măcar nu ajungea la comandă —
// vezi api/comenzi/creeaza.js, care nu accepta data_programata).
//
// Criteriu de eligibilitate partener — IDENTIC cu lib/aloca-partener.js
// (status_live='disponibil' + zonă via judete[]), ca să nu existe 2 surse
// de adevăr pentru „partener eligibil în zonă". Deliberat NU filtrează
// după competența exactă a serviciului (partener_servicii_active) —
// mydarrin-produs.html folosește PRODUCTS_DB static, nu catalog_servicii
// real, deci comenzile de azi nu au un catalog_serviciu_id real de
// verificat (același gap ca în aloca-partener.js — vezi G14/G15).

const { supabaseAdmin } = require('./supabaseAdmin');

const DURATA_SLOT_ORE = 2;
const FALLBACK_ORA_INCEPUT = '08:00:00';
const FALLBACK_ORA_SFARSIT = '20:00:00';

function oraLaMinute(ora) {
  const [h, m] = ora.split(':').map(Number);
  return h * 60 + (m || 0);
}
function minuteLaOra(min) {
  const h = Math.floor(min / 60).toString().padStart(2, '0');
  const m = (min % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function genereazaSloturi(oraInceput, oraSfarsit) {
  const inceput = oraLaMinute(oraInceput);
  const sfarsit = oraLaMinute(oraSfarsit);
  const sloturi = [];
  for (let t = inceput; t + DURATA_SLOT_ORE * 60 <= sfarsit; t += DURATA_SLOT_ORE * 60) {
    sloturi.push({ inceput: minuteLaOra(t), sfarsit: minuteLaOra(t + DURATA_SLOT_ORE * 60) });
  }
  return sloturi;
}

function seSuprapun(aInceput, aSfarsit, bInceput, bSfarsit) {
  return oraLaMinute(aInceput) < oraLaMinute(bSfarsit) && oraLaMinute(bInceput) < oraLaMinute(aSfarsit);
}

/**
 * @param {{taraCod:string|null, regiune:string|null, data:string}} params - data: 'YYYY-MM-DD'
 * @returns {Promise<{sloturi: Array<{inceput:string, sfarsit:string, disponibil:boolean}>, parteneriEligibili: number}>}
 */
async function calculeazaSloturiDisponibile({ taraCod, regiune, data }) {
  let queryDisp = supabaseAdmin
    .from('parteneri_disponibilitate')
    .select('partener_id')
    .eq('status_live', 'disponibil');
  if (taraCod) queryDisp = queryDisp.eq('tara_cod', taraCod);
  if (regiune) queryDisp = queryDisp.contains('judete', [regiune]);

  const { data: disponibili, error: dispErr } = await queryDisp;
  if (dispErr) throw dispErr;
  const idParteneri = (disponibili || []).map((r) => r.partener_id);
  if (!idParteneri.length) {
    return { sloturi: genereazaSloturi(FALLBACK_ORA_INCEPUT, FALLBACK_ORA_SFARSIT).map((s) => ({ ...s, disponibil: false })), parteneriEligibili: 0 };
  }

  const ziSaptamana = new Date(data + 'T00:00:00Z').getUTCDay();

  const { data: programe, error: progErr } = await supabaseAdmin
    .from('parteneri_program_lucru')
    .select('partener_id, ora_inceput, ora_sfarsit, activ')
    .in('partener_id', idParteneri)
    .eq('zi_saptamana', ziSaptamana);
  if (progErr) throw progErr;
  const programePerPartener = new Map((programe || []).map((p) => [p.partener_id, p]));

  const { data: comenziZi, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('partener_id, ora_inceput_programata, ora_sfarsit_programata')
    .in('partener_id', idParteneri)
    .eq('data_programata', data)
    .not('status', 'eq', 'anulata')
    .not('ora_inceput_programata', 'is', null);
  if (comErr) throw comErr;

  // Sloturile posibile ale zilei — reperul e fallback-ul (acoperă orice
  // program declarat, care oricum e o subîmpărțire a aceleiași ferestre
  // 08-20 sau mai restrânsă).
  const sloturiZi = genereazaSloturi(FALLBACK_ORA_INCEPUT, FALLBACK_ORA_SFARSIT);

  const rezultat = sloturiZi.map((slot) => {
    const cinevaLiber = idParteneri.some((partenerId) => {
      const program = programePerPartener.get(partenerId);
      const oraInceputProgram = program && program.activ ? program.ora_inceput : FALLBACK_ORA_INCEPUT;
      const oraSfarsitProgram = program && program.activ ? program.ora_sfarsit : FALLBACK_ORA_SFARSIT;
      if (program && !program.activ) return false; // partener declarat explicit ca nelucrător în ziua asta

      const slotInProgram = oraLaMinute(slot.inceput) >= oraLaMinute(oraInceputProgram)
        && oraLaMinute(slot.sfarsit) <= oraLaMinute(oraSfarsitProgram);
      if (!slotInProgram) return false;

      const ocupat = (comenziZi || []).some((c) => c.partener_id === partenerId
        && seSuprapun(slot.inceput, slot.sfarsit, c.ora_inceput_programata, c.ora_sfarsit_programata));
      return !ocupat;
    });
    return { ...slot, disponibil: cinevaLiber };
  });

  return { sloturi: rezultat, parteneriEligibili: idParteneri.length };
}

module.exports = { calculeazaSloturiDisponibile, genereazaSloturi, DURATA_SLOT_ORE };
