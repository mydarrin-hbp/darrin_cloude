// lib/competente-parteneri.js
// Filtrul pe competențe la alocarea comenzilor (Etapa 1, reguli flexibile,
// 9 oct. 2026): partenerul primește doar comenzi pentru codurile ESCO bifate
// în partener_competente.
//
// Tranziție, ca să nu blocheze alocarea până își completează partenerii
// profilurile: dacă NICIUNUL dintre candidați nu are competențe bifate,
// lista rămâne neschimbată (comportamentul de dinainte) și se scrie un
// avertisment în log. Dacă măcar unul are, rămân doar cei cu codul cerut.

const { supabaseAdmin } = require('./supabaseAdmin');

/**
 * @param {string[]} candidati - id-uri de parteneri
 * @param {string|null} codEsco - codul ESCO cerut de serviciu
 * @param {string} eticheta - pentru log
 * @returns {Promise<string[]>}
 */
async function filtreazaDupaCompetente(candidati, codEsco, eticheta = 'competente') {
  if (!codEsco || !candidati?.length) return candidati || [];
  const { data, error } = await supabaseAdmin
    .from('partener_competente')
    .select('partener_id, cod_esco')
    .in('partener_id', candidati);
  if (error) {
    console.warn(`[${eticheta}] partener_competente indisponibil, alocare fără filtrul pe competențe:`, error.message);
    return candidati;
  }
  if (!data?.length) {
    console.warn(`[${eticheta}] niciun candidat nu are competențe bifate (cod ESCO ${codEsco}); alocare fără filtrul pe competențe`);
    return candidati;
  }
  const potriviti = new Set(data.filter((r) => r.cod_esco === codEsco).map((r) => r.partener_id));
  return candidati.filter((id) => potriviti.has(id));
}

module.exports = { filtreazaDupaCompetente };
