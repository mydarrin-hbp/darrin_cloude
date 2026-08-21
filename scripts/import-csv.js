// scripts/import-csv.js
// Import generic CSV -> Supabase, rulat din linia de comanda (nu e un
// endpoint /api). Citeste orice fisier CSV (delimitator , sau ; -
// autodetectat din antet), mapeaza fiecare rand pe coloanele tabelului
// tinta dupa numele din antet, si insereaza in loturi de 200 randuri,
// afisand progresul in terminal.
//
// Variabile de mediu necesare (aceleasi ca lib/supabaseAdmin.js):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Utilizare:
//   node scripts/import-csv.js <cale_fisier.csv> <nume_tabel> [delimitator]
//
// Exemple:
//   node scripts/import-csv.js ./date/produse.csv catalog_produse
//   node scripts/import-csv.js ./date/tarife.csv tarife_transport ";"
//
// Note:
//   - Primul rand din CSV trebuie sa fie antetul (header) cu numele
//     exacte ale coloanelor din tabelul Supabase tinta.
//   - Campurile goale devin NULL. Nu se face nicio conversie de format
//     (numere, date, virgula zecimala etc.) - CSV-ul trebuie sa contina
//     deja valorile in formatul asteptat de coloana.
//   - Suporta campuri intre ghilimele ("...") cu delimitator sau
//     ghilimele escapate ("") in interior.

'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const BATCH_SIZE = 200;

function parseCsvLine(line, delimiter) {
  const result = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function detectDelimiter(headerLine) {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semicolonCount = (headerLine.match(/;/g) || []).length;
  return semicolonCount > commaCount ? ';' : ',';
}

function parseCsvFile(filePath, delimiterOverride) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    throw new Error('Fisierul CSV este gol.');
  }

  const delimiter = delimiterOverride || detectDelimiter(lines[0]);
  const header = parseCsvLine(lines[0], delimiter).map((h) => h.trim());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], delimiter);
    const row = {};
    header.forEach((col, idx) => {
      const val = values[idx];
      row[col] = val === undefined || val === '' ? null : val;
    });
    rows.push(row);
  }

  return rows;
}

async function main() {
  const csvArg = process.argv[2];
  const tableArg = process.argv[3];
  const delimiterArg = process.argv[4];

  if (!csvArg || !tableArg) {
    console.error('Utilizare: node scripts/import-csv.js <cale_fisier.csv> <nume_tabel> [delimitator]');
    process.exit(1);
  }

  const csvPath = path.resolve(csvArg);
  if (!fs.existsSync(csvPath)) {
    console.error(`Fisierul nu exista: ${csvPath}`);
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Lipsesc variabilele de mediu SUPABASE_URL si/sau SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Citire fisier: ${csvPath}`);
  const rows = parseCsvFile(csvPath, delimiterArg);
  console.log(`Tabel tinta: ${tableArg}`);
  console.log(`Total randuri gasite in CSV: ${rows.length}\n`);

  if (rows.length === 0) {
    console.log('Nu exista randuri de inserat.');
    return;
  }

  let totalInserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const start = i + 1;
    const end = Math.min(i + BATCH_SIZE, rows.length);

    const { error } = await supabase.from(tableArg).insert(batch);

    if (error) {
      console.error(`\nEroare la lotul ${start}-${end}: ${error.message}`);
      console.error(`Randuri inserate cu succes inainte de eroare: ${totalInserted}`);
      process.exit(1);
    }

    totalInserted += batch.length;
    console.log(`Lot ${start}-${end} inserat`);
  }

  console.log(`\nTotal randuri inserate: ${totalInserted}`);
}

main().catch((err) => {
  console.error('Eroare neasteptata:', err);
  process.exit(1);
});
