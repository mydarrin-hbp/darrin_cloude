// myd-csv.js
// Utilitar CSV partajat, static, servit direct (tipar identic myd-geo.js).
// Extras din mydarrin-superadmin.html (unde a fost scris prima dată, 2
// August 2026, pentru panoul Comisioane) — cerință explicită: „Importă
// CSV" trebuie să existe, cu aceeași regulă, în orice secțiune care
// necesită încărcare de date, nu doar în Comisioane. Parser-ul +
// generatorul (RFC4180 minimal: câmpuri între ghilimele, virgule/ghilimele
// escapate „""", CRLF/LF, BOM eliminat) trăiesc AICI, o singură dată —
// mydarrin-superadmin.html, mydarrin-marketplace.html și
// mydarrin-dashboard-furnizor.html îl încarcă toate cu
// <script src="/myd-csv.js"></script>.
window._mydCSV = {
  parse(text) {
    const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < clean.length; i++) {
      const c = clean[i];
      if (inQuotes) {
        if (c === '"') {
          if (clean[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else { field += c; }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else {
        field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return { header: [], records: [] };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const records = rows.slice(1)
      .filter((r) => r.some((v) => v !== ''))
      .map((r) => { const o = {}; header.forEach((h, idx) => { o[h] = (r[idx] ?? '').trim(); }); return o; });
    return { header, records };
  },
  toCSV(headers, records) {
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.join(',')];
    for (const r of records) lines.push(headers.map((h) => esc(r[h])).join(','));
    return lines.join('\n');
  },
  download(filename, headers, records) {
    const blob = new Blob(['﻿' + window._mydCSV.toCSV(headers, records)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
};
