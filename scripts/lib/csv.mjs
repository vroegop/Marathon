// RFC 4180-style CSV parser (quotes, escaped quotes, embedded newlines).
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.replace(/^﻿/, '').trim());
  const records = rows.slice(1).map((r) => {
    const rec = {};
    headers.forEach((h, i) => {
      // Strava's activities.csv repeats some headers (display value first, raw value later);
      // keep the first occurrence and expose later ones with a numeric suffix.
      const key = h in rec ? `${h}#${headers.slice(0, i).filter((x) => x === h).length + 1}` : h;
      rec[key] = r[i] ?? '';
    });
    return rec;
  });
  return { headers, records };
}
