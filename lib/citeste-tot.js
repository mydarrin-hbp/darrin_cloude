// lib/citeste-tot.js
// Citirea completă a unui tabel mare din Supabase (15 oct. 2026): un
// `select` fără `.range()` întoarce cel mult 1.000 de rânduri (limita
// implicită PostgREST). Funcția citește pagină cu pagină, câte 1.000, până
// la prima pagină incompletă.
//
// `construiesteInterogarea` trebuie să întoarcă la fiecare apel o interogare
// NOUĂ (select + filtre + order), cu o ordonare stabilă și unică (ultima
// coloană din order trebuie să fie o cheie), ca paginile să nu sară și să nu
// repete rânduri:
//   await citesteTot(() => supabaseAdmin.from('competente_esco')
//     .select('cod_esco, denumire').order('denumire').order('cod_esco'));
//
// Întoarce { data, error }, ca o interogare Supabase obișnuită: la prima
// eroare, citirea se oprește și eroarea e întoarsă așa cum a venit.

const MARIME_PAGINA = 1000;
const MAXIM_PAGINI = 20; // 20.000 de rânduri: limita de siguranță

async function citesteTot(construiesteInterogarea, { marimePagina = MARIME_PAGINA, maximPagini = MAXIM_PAGINI } = {}) {
  const randuri = [];
  for (let pagina = 0; pagina < maximPagini; pagina++) {
    const deLa = pagina * marimePagina;
    const { data, error } = await construiesteInterogarea().range(deLa, deLa + marimePagina - 1);
    if (error) return { data: null, error };
    const lot = data || [];
    randuri.push(...lot);
    if (lot.length < marimePagina) return { data: randuri, error: null };
  }
  throw new Error(`citesteTot: s-a atins limita de siguranță de ${maximPagini} pagini × ${marimePagina} rânduri; tabelul are mai multe rânduri decât se așteaptă.`);
}

module.exports = { citesteTot, MARIME_PAGINA, MAXIM_PAGINI };
