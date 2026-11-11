// lib/catalog-preturi.js
// Pasul 11-C10: calculul prețului „de la”, într-un singur loc, folosit de
// /api/public/catalog-categorie și de /api/public/catalog (înainte era scris
// direct în catalog-categorie).
//
// Prețul „de la” vine doar din catalog_preturi: cel mai mic preț al unui nivel
// fără rețetă, pentru țară, trecut prin formula publică (lib/calculeaza-pret.js),
// pe unitate — fără pragul minim de comandă, care se aplică totalului comenzii.
// Fără preț: null (pagina nu afișează nicio cifră). `are_pret` = produsul are un
// preț real (rețetă sau catalog_preturi); fără el, „Cere un deviz”.

const { supabaseAdmin } = require('./supabaseAdmin');
const { incarcaConfigPret, aplicaFormulaPret } = require('./calculeaza-pret');
const { citesteTot } = require('./citeste-tot');

// Câte id-uri intră într-o adresă: o listă prea lungă ar depăși limita URL-ului.
const IDURI_PE_CERERE = 200;

function loturi(lista, marime) {
  const rezultat = [];
  for (let i = 0; i < lista.length; i += marime) rezultat.push(lista.slice(i, i + marime));
  return rezultat;
}

// produse: [{ id, categorie }] → { [id]: { pret_de_la, are_pret } }, câte o
// intrare pentru fiecare produs. La o eroare de citire aruncă: un preț lipsă nu
// trebuie să ajungă în cache ca „fără preț”.
async function preturiDeLa(produse, tara) {
  const pretMinim = {};
  const cuPretReal = new Set();

  if (produse.length) {
    const [rezNiveluri, rezArticole] = await Promise.all([
      Promise.all(loturi(produse.map((p) => p.id), IDURI_PE_CERERE).map((iduri) => citesteTot(() => supabaseAdmin
        .from('catalog_niveluri').select('id, serviciu_id, catalog_preturi(pret, tara_cod)').in('serviciu_id', iduri).order('id')))),
      citesteTot(() => supabaseAdmin
        .from('devize_articole').select('catalog_nivel_id').not('catalog_nivel_id', 'is', null).order('articol_id')),
    ]);
    const eroare = rezArticole.error || (rezNiveluri.find((r) => r.error) || {}).error;
    if (eroare) throw new Error('preturiDeLa: ' + eroare.message);

    const cuReteta = new Set((rezArticole.data || []).map((x) => x.catalog_nivel_id));
    rezNiveluri.flatMap((r) => r.data || []).forEach((n) => {
      if (cuReteta.has(n.id)) { cuPretReal.add(n.serviciu_id); return; }
      (n.catalog_preturi || []).forEach((p) => {
        const v = Number(p.pret);
        if (p.tara_cod !== tara || !(v > 0)) return;
        cuPretReal.add(n.serviciu_id);
        if (pretMinim[n.serviciu_id] == null || v < pretMinim[n.serviciu_id]) pretMinim[n.serviciu_id] = v;
      });
    });
  }

  const cfg = Object.keys(pretMinim).length ? await incarcaConfigPret(tara) : null;
  const pretPublic = (baza, categ) => {
    const input = categ === 'inchirieri' ? { cost_chirie_scule: baza } : categ === 'materiale' ? { cost_materiale: baza } : { cost_baza_servicii: baza };
    return aplicaFormulaPret(input, cfg, undefined, { cuPragMinim: false }).pret_final;
  };

  const rezultat = {};
  produse.forEach((p) => {
    rezultat[p.id] = {
      pret_de_la: pretMinim[p.id] != null ? pretPublic(pretMinim[p.id], p.categorie) : null,
      are_pret: cuPretReal.has(p.id),
    };
  });
  return rezultat;
}

module.exports = { preturiDeLa };
