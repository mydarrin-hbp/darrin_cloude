// lib/genereaza-proforma-pdf.js
// Generare PDF reală pentru factura proformă (30 august 2026, cerere
// fondator: "Factura proformă + cu plata, trebuie atașată la email").
//
// EXTINDERE (31 august 2026, cerere fondator, testare live): proforma
// trebuie să fie ca un DEVIZ complet — etapele lucrării, descrierile
// materialelor/accesoriilor, instrucțiuni de întreținere, descrierea
// valorilor, TVA, monedă, LOCAȚIA reală de prestare. Descoperire la
// implementare: `comenzi.adresa` era validată la creare dar niciodată
// persistată (bug real, reparat separat, api/comenzi/creeaza.js) — fără
// acel fix, "locația" cerută aici n-ar fi avut de unde să vină.
//
// Font: Noto Sans (assets/fonts/), NU fonturile standard PDF (Helvetica
// etc.) — verificat live, standardul nu acoperă corect diacriticele
// românești (ă/â/î/ș/ț) în PDFKit; Noto Sans confirmat corect pe toate.
//
// Onestitate (regulă permanentă a proiectului): CUI/nr.reg.com/adresă ale
// entității emitente sunt azi NULL în entitati_juridice_platforma — omise
// din PDF dacă lipsesc, nu inventate. Dacă niciun cont bancar real nu e
// configurat, secțiunea de plată arată un mesaj onest, nu un IBAN fals.
// Etapele/întreținerea apar DOAR dacă serviciul are conținut real populat
// (catalog_servicii.etape_lucrare/instructiuni_intretinere) — omise, nu
// generate generic, pentru orice serviciu nepopulat încă.

const PDFDocument = require('pdfkit');
const path = require('path');

const FONT_REGULAR = path.join(__dirname, '../assets/fonts/NotoSans-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '../assets/fonts/NotoSans-Bold.ttf');

const NAVY = '#003366';
const GRI = '#6B7A8D';
const TEXT = '#2D2D2D';
const TEAL = '#0E9E99';
const COL_LABEL = 50, TABLE_WIDTH = 495;

function fmt(n, moneda) {
  const num = Number(n) || 0;
  return num.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (moneda || 'RON');
}

function sectiuneTitlu(doc, text) {
  doc.font(FONT_BOLD).fontSize(10).fillColor(NAVY).text(text);
  doc.moveDown(0.3);
}

/**
 * @param {object} p
 * @param {object} p.invoice - rând din `invoices` (numar_document, emisa_la, suma_totala, moneda, entitate_emitenta)
 * @param {object} p.comanda - rând din `comenzi`, inclusiv adresa (reparată 31 aug), addon_materiale_selectate
 * @param {object|null} p.serviciu - rând din `catalog_servicii` (titlu, descriere, etape_lucrare, instructiuni_intretinere) — null dacă nu s-a putut determina
 * @param {string} p.clientEmail
 * @param {object|null} p.entitateJuridica
 * @param {object|null} p.contBancar
 * @returns {Promise<Buffer>}
 */
function genereazaProformaPDF({ invoice, comanda, serviciu, clientEmail, entitateJuridica, contBancar }) {
  return new Promise((resolve, reject) => {
    try {
      // FIX (30 august 2026, verificat live pe Vercel): PDFKit încarcă
      // implicit un font standard (Helvetica) la construcție dacă `font` nu
      // e dat explicit în opțiuni — pe serverless, fișierele interne ale
      // acelui font standard nu sunt incluse în bundle. Fontul real dat
      // direct în constructor evită complet acel cod intern.
      const doc = new PDFDocument({ margin: 50, size: 'A4', font: FONT_REGULAR });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const moneda = invoice.moneda || comanda.moneda || 'RON';

      // ── Titlu ──
      doc.font(FONT_BOLD).fontSize(20).fillColor(NAVY).text('FACTURĂ PROFORMĂ — DEVIZ', { align: 'center' });
      doc.font(FONT_REGULAR).fontSize(10).fillColor(GRI)
        .text(`Nr. ${invoice.numar_document}  ·  Data: ${new Date(invoice.emisa_la || Date.now()).toLocaleDateString('ro-RO')}  ·  Comandă ${comanda.nr_comanda}`, { align: 'center' });
      doc.moveDown(1.5);

      // ── Emitent ──
      sectiuneTitlu(doc, 'FURNIZOR');
      doc.font(FONT_REGULAR).fontSize(10).fillColor(TEXT);
      doc.text(entitateJuridica?.denumire || invoice.entitate_emitenta || 'My Darrin (Home Best Pal)');
      if (entitateJuridica?.cui) doc.text(`CUI: ${entitateJuridica.cui}`);
      if (entitateJuridica?.nr_reg_com) doc.text(`Nr. reg. com.: ${entitateJuridica.nr_reg_com}`);
      if (entitateJuridica?.adresa) doc.text(entitateJuridica.adresa);
      doc.moveDown(1);

      // ── Client ──
      sectiuneTitlu(doc, 'CLIENT');
      doc.font(FONT_REGULAR).fontSize(10).fillColor(TEXT);
      doc.text(clientEmail || '—');
      doc.moveDown(1);

      // ── Locația prestării (31 august 2026) — adresa reală, reparată să se
      // salveze la creare comandă; regiune/localitate/țară ca reper geo,
      // separat de adresa exactă. ──
      sectiuneTitlu(doc, 'LOCAȚIA PRESTĂRII / LIVRĂRII');
      doc.font(FONT_REGULAR).fontSize(10).fillColor(TEXT);
      if (comanda.adresa) {
        doc.text(comanda.adresa);
      } else {
        doc.fillColor(GRI).text('Adresă exactă nedisponibilă pentru această comandă.');
        doc.fillColor(TEXT);
      }
      const locText = [comanda.localitate, comanda.regiune, comanda.tara_cod].filter(Boolean).join(', ');
      if (locText) doc.fontSize(9).fillColor(GRI).text(locText);
      doc.moveDown(1);

      // ── Serviciul comandat — descriere + etape (31 august 2026) ──
      if (serviciu?.titlu || serviciu?.descriere) {
        sectiuneTitlu(doc, 'SERVICIUL COMANDAT');
        doc.font(FONT_BOLD).fontSize(10.5).fillColor(TEXT).text(serviciu.titlu || '—');
        if (serviciu.descriere) {
          doc.font(FONT_REGULAR).fontSize(10).fillColor(TEXT).text(serviciu.descriere);
        }
        doc.moveDown(0.6);
        if (Array.isArray(serviciu.etape_lucrare) && serviciu.etape_lucrare.length) {
          doc.font(FONT_BOLD).fontSize(9.5).fillColor(NAVY).text('Etapele lucrării:');
          doc.font(FONT_REGULAR).fontSize(9.5).fillColor(TEXT);
          serviciu.etape_lucrare.forEach((etapa, i) => doc.text(`${i + 1}. ${etapa}`));
        }
        doc.moveDown(1);
      }

      // ── Materiale/accesorii selectate, cu descriere reală (31 august 2026)
      // — snapshot îngheț la comandă (comenzi.addon_materiale_selectate),
      // aceleași date pe care clientul le-a văzut în configurator. ──
      const addonuri = Array.isArray(comanda.addon_materiale_selectate) ? comanda.addon_materiale_selectate : [];
      if (addonuri.length) {
        sectiuneTitlu(doc, 'MATERIALE ȘI ACCESORII SELECTATE');
        doc.font(FONT_REGULAR).fontSize(10);
        addonuri.forEach((a) => {
          doc.font(FONT_BOLD).fillColor(TEXT).text(`${a.titlu}  —  ${a.qty} ${a.unitate_masura || ''} × ${fmt(a.pret_unitar, moneda)} = ${fmt(a.subtotal, moneda)}`);
          if (a.descriere) doc.font(FONT_REGULAR).fontSize(9.5).fillColor(GRI).text(a.descriere);
          doc.moveDown(0.4);
        });
        doc.moveDown(0.6);
      }

      // ── Tabel valori (aceleași componente reale afișate deja în
      // dashboard-ul clientului — decizie de onestitate: clientul a plătit
      // deja totalul, nu e o relație comercială terță de protejat) ──
      const DESCRIERE_LINIE = {
        'Manoperă': 'cost real al orelor de lucru calificat, conform normei tehnice a serviciului',
        'Materiale': 'costul materialelor/accesoriilor alese explicit (detaliate mai sus)',
        'Utilaje / închiriere': 'cost real de utilizare a echipamentelor necesare',
        'Transport': 'cost real de deplasare/transport, unde e cazul',
        'Asigurare': 'poliță de asigurare extinsă, dacă a fost aleasă',
        'Marketing': 'cotă platformă pentru promovare și achiziție de clienți',
        'Mentenanță platformă': 'cotă platformă pentru mentenanță tehnică și suport',
        'Comision platformă': 'comisionul platformei pentru intermediere/garanție escrow',
      };
      const linii = [
        ['Manoperă', comanda.suma_manopera],
        ['Materiale', comanda.suma_materiale],
        ['Utilaje / închiriere', comanda.suma_chirie_scule],
        ['Transport', (Number(comanda.suma_transport) || 0) + (Number(comanda.suma_transport_greutate) || 0) + (Number(comanda.suma_ajutor) || 0)],
        ['Asigurare', comanda.suma_asigurare],
        ['Marketing', comanda.suma_marketing],
        ['Mentenanță platformă', comanda.suma_mentenanta],
        ['Comision platformă', comanda.suma_comision_platforma],
      ].filter(([, val]) => Number(val) > 0);

      doc.font(FONT_BOLD).fontSize(10).fillColor(NAVY);
      doc.text('DETALIERE VALORI', COL_LABEL);
      doc.font(FONT_REGULAR).fontSize(8.5).fillColor(GRI).text(`Moneda comenzii: ${moneda}. Fiecare linie reprezintă un cost real, calculat din rețeta tehnică a serviciului.`, COL_LABEL);
      doc.moveTo(COL_LABEL, doc.y + 4).lineTo(COL_LABEL + TABLE_WIDTH, doc.y + 4).strokeColor('#E8ECF0').stroke();
      doc.moveDown(0.6);

      linii.forEach(([label, val]) => {
        const y = doc.y;
        doc.font(FONT_REGULAR).fontSize(10).fillColor(TEXT).text(label, COL_LABEL, y, { width: 300 });
        doc.text(fmt(val, moneda), COL_LABEL + 345, y, { width: 150, align: 'right' });
        if (DESCRIERE_LINIE[label]) doc.fontSize(8.5).fillColor(GRI).text(DESCRIERE_LINIE[label], COL_LABEL, doc.y, { width: 300 });
        doc.moveDown(0.35);
      });
      doc.moveDown(0.3);
      doc.moveTo(COL_LABEL, doc.y).lineTo(COL_LABEL + TABLE_WIDTH, doc.y).strokeColor('#E8ECF0').stroke();
      doc.moveDown(0.5);

      const subtotal = linii.reduce((s, [, v]) => s + (Number(v) || 0), 0);
      const rand = (label, val, boldVal) => {
        const y = doc.y;
        doc.font(FONT_REGULAR).fontSize(10).fillColor(GRI).text(label, COL_LABEL, y, { width: 350 });
        doc.font(boldVal ? FONT_BOLD : FONT_REGULAR).fontSize(boldVal ? 13 : 10).fillColor(boldVal ? TEAL : TEXT)
          .text(fmt(val, moneda), COL_LABEL + 345, y, { width: 150, align: 'right' });
        doc.moveDown(boldVal ? 0.3 : 0.2);
      };
      rand('Subtotal', subtotal, false);
      rand(`TVA (cota legală aplicabilă: ${comanda.tva_pct || 0}%)`, comanda.tva_suma, false);
      doc.moveDown(0.2);
      rand('TOTAL DE PLATĂ', invoice.suma_totala ?? comanda.suma_totala_platita, true);
      doc.moveDown(1.3);

      // ── Plată — onest: fără IBAN fals dacă niciun cont real nu e configurat ──
      sectiuneTitlu(doc, 'MODALITATE DE PLATĂ');
      doc.font(FONT_REGULAR).fontSize(10).fillColor(TEXT);
      if (contBancar?.iban) {
        doc.text(`Ordin de plată în contul: ${contBancar.nume_afisat || ''} — ${contBancar.banca || ''}`);
        doc.font(FONT_BOLD).text(`IBAN: ${contBancar.iban}`);
        if (contBancar.swift) doc.font(FONT_REGULAR).text(`SWIFT/BIC: ${contBancar.swift}`);
        doc.font(FONT_REGULAR).text(`Menționează numărul comenzii (${comanda.nr_comanda}) la detaliile plății.`);
      } else {
        doc.text('Plată prin ordin de plată. Detaliile contului bancar îți vor fi comunicate separat, prin email, în cel mai scurt timp.');
      }
      doc.moveDown(1.3);

      // ── Întreținere/folosire (31 august 2026) — doar dacă e conținut real ──
      if (serviciu?.instructiuni_intretinere) {
        sectiuneTitlu(doc, 'ÎNTREȚINERE ȘI FOLOSIRE');
        doc.font(FONT_REGULAR).fontSize(10).fillColor(TEXT).text(serviciu.instructiuni_intretinere);
        doc.moveDown(1.3);
      }

      doc.fontSize(9).fillColor(GRI).text(
        'Document informativ (proformă) — nu are valoare fiscală de factură. Factura fiscală se emite după confirmarea încasării și a livrării, conform legislației în vigoare.',
        { align: 'center' }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { genereazaProformaPDF };
