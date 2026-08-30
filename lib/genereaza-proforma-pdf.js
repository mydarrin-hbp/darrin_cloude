// lib/genereaza-proforma-pdf.js
// Generare PDF reală pentru factura proformă (30 august 2026, cerere
// fondator: "Factura proformă + cu plata, trebuie atașată la email" —
// email-ul de „prima comandă" doar MENȚIONA numărul de proformă, nu o
// atașa efectiv ca document). lib/email-sender.js confirmă: nicio trimitere
// din tot proiectul nu suportă azi atașamente — asta e primul caz.
//
// Font: Noto Sans (assets/fonts/), NU fonturile standard PDF (Helvetica
// etc.) — verificat live, standardul nu acoperă corect diacriticele
// românești (ă/â/î/ș/ț) în PDFKit; Noto Sans confirmat corect pe toate.
//
// Onestitate (regulă permanentă a proiectului): CUI/nr.reg.com/adresă ale
// entității emitente sunt azi NULL în entitati_juridice_platforma — omise
// din PDF dacă lipsesc, nu inventate. La fel, dacă niciun cont bancar real
// nu e configurat (bank_accounts, azi 0 rânduri), secțiunea de plată arată
// un mesaj onest, nu un IBAN fals.

const PDFDocument = require('pdfkit');
const path = require('path');

const FONT_REGULAR = path.join(__dirname, '../assets/fonts/NotoSans-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '../assets/fonts/NotoSans-Bold.ttf');

const NAVY = '#003366';
const GRI = '#6B7A8D';
const TEXT = '#2D2D2D';
const TEAL = '#0E9E99';

function fmt(n, moneda) {
  const num = Number(n) || 0;
  return num.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (moneda || 'RON');
}

/**
 * @param {object} p
 * @param {object} p.invoice - rând din `invoices` (numar_document, emisa_la, tva, suma_totala, moneda, tara_cod, entitate_emitenta)
 * @param {object} p.comanda - rând din `comenzi` (nr_comanda, suma_manopera, suma_materiale, suma_chirie_scule, suma_transport, suma_transport_greutate, suma_ajutor, suma_asigurare, suma_marketing, suma_mentenanta, suma_comision_platforma, tva_pct, tva_suma, suma_totala_platita, localitate, regiune, tara_cod)
 * @param {string} p.clientEmail
 * @param {object|null} p.entitateJuridica - rând din `entitati_juridice_platforma` (denumire, cui, nr_reg_com, adresa) — câmpuri NULL omise
 * @param {object|null} p.contBancar - rând din `bank_accounts` (nume_afisat, banca, iban, swift) — null → mesaj onest
 * @returns {Promise<Buffer>}
 */
function genereazaProformaPDF({ invoice, comanda, clientEmail, entitateJuridica, contBancar }) {
  return new Promise((resolve, reject) => {
    try {
      // FIX (30 august 2026, verificat live pe Vercel): PDFKit încarcă
      // implicit un font standard (Helvetica) la construcție dacă `font` nu
      // e dat explicit în opțiuni — pe serverless (file-tracing Vercel),
      // fișierele interne de date ale fonturilor standard nu sunt incluse în
      // bundle, cauzând `MODULE_NOT_FOUND` la fiecare generare. Specificând
      // direct un font real (Noto Sans) în constructor, PDFKit nu mai atinge
      // deloc acel cod intern — testat live, eroarea dispare complet.
      const doc = new PDFDocument({ margin: 50, size: 'A4', font: FONT_REGULAR });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const moneda = invoice.moneda || comanda.moneda || 'RON';

      // ── Titlu ──
      doc.font(FONT_BOLD).fontSize(20).fillColor(NAVY).text('FACTURĂ PROFORMĂ', { align: 'center' });
      doc.font(FONT_REGULAR).fontSize(10).fillColor(GRI)
        .text(`Nr. ${invoice.numar_document}  ·  Data: ${new Date(invoice.emisa_la || Date.now()).toLocaleDateString('ro-RO')}  ·  Comandă ${comanda.nr_comanda}`, { align: 'center' });
      doc.moveDown(1.5);

      // ── Emitent ──
      doc.font(FONT_BOLD).fontSize(10).fillColor(NAVY).text('FURNIZOR');
      doc.font(FONT_REGULAR).fontSize(10).fillColor(TEXT);
      doc.text(entitateJuridica?.denumire || invoice.entitate_emitenta || 'My Darrin (Home Best Pal)');
      if (entitateJuridica?.cui) doc.text(`CUI: ${entitateJuridica.cui}`);
      if (entitateJuridica?.nr_reg_com) doc.text(`Nr. reg. com.: ${entitateJuridica.nr_reg_com}`);
      if (entitateJuridica?.adresa) doc.text(entitateJuridica.adresa);
      doc.moveDown(1);

      // ── Client ──
      doc.font(FONT_BOLD).fontSize(10).fillColor(NAVY).text('CLIENT');
      doc.font(FONT_REGULAR).fontSize(10).fillColor(TEXT);
      doc.text(clientEmail || '—');
      const locText = [comanda.localitate, comanda.regiune, comanda.tara_cod].filter(Boolean).join(', ');
      if (locText) doc.text(locText);
      doc.moveDown(1.5);

      // ── Tabel linii (aceleași componente reale afișate deja în
      // dashboard-ul clientului — vezi api/client/comenzi-tracker.js,
      // aceeași decizie de onestitate: clientul a plătit deja totalul, nu e
      // o relație comercială terță de protejat, deci nu ascundem marja) ──
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
      const colLabel = 50, colVal = 470, tableWidth = 495;
      doc.text('DETALIERE', colLabel);
      doc.moveTo(colLabel, doc.y + 2).lineTo(colLabel + tableWidth, doc.y + 2).strokeColor('#E8ECF0').stroke();
      doc.moveDown(0.5);

      doc.font(FONT_REGULAR).fontSize(10).fillColor(TEXT);
      linii.forEach(([label, val]) => {
        const y = doc.y;
        doc.text(label, colLabel, y, { width: 350 });
        doc.text(fmt(val, moneda), colVal - 100, y, { width: 150, align: 'right' });
      });
      doc.moveDown(0.5);
      doc.moveTo(colLabel, doc.y).lineTo(colLabel + tableWidth, doc.y).strokeColor('#E8ECF0').stroke();
      doc.moveDown(0.5);

      const subtotal = linii.reduce((s, [, v]) => s + (Number(v) || 0), 0);
      const rand = (label, val, boldVal) => {
        const y = doc.y;
        doc.font(FONT_REGULAR).fontSize(10).fillColor(GRI).text(label, colLabel, y, { width: 350 });
        doc.font(boldVal ? FONT_BOLD : FONT_REGULAR).fontSize(boldVal ? 13 : 10).fillColor(boldVal ? TEAL : TEXT)
          .text(fmt(val, moneda), colVal - 100, y, { width: 150, align: 'right' });
        doc.moveDown(boldVal ? 0.3 : 0.2);
      };
      rand('Subtotal', subtotal, false);
      rand(`TVA (${comanda.tva_pct || 0}%)`, comanda.tva_suma, false);
      doc.moveDown(0.2);
      rand('TOTAL DE PLATĂ', invoice.suma_totala ?? comanda.suma_totala_platita, true);
      doc.moveDown(1.5);

      // ── Plată — onest: fără IBAN fals dacă niciun cont real nu e configurat ──
      doc.font(FONT_BOLD).fontSize(10).fillColor(NAVY).text('MODALITATE DE PLATĂ');
      doc.font(FONT_REGULAR).fontSize(10).fillColor(TEXT);
      if (contBancar?.iban) {
        doc.text(`Ordin de plată în contul: ${contBancar.nume_afisat || ''} — ${contBancar.banca || ''}`);
        doc.font(FONT_BOLD).text(`IBAN: ${contBancar.iban}`);
        if (contBancar.swift) doc.font(FONT_REGULAR).text(`SWIFT/BIC: ${contBancar.swift}`);
        doc.font(FONT_REGULAR).text(`Menționează numărul comenzii (${comanda.nr_comanda}) la detaliile plății.`);
      } else {
        doc.text('Plată prin ordin de plată. Detaliile contului bancar îți vor fi comunicate separat, prin email, în cel mai scurt timp.');
      }
      doc.moveDown(1.5);

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
