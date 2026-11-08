/**
 * A small CSV reader for imported files: RFC 4180 quoting (quoted fields may hold the delimiter,
 * doubled quotes and line breaks), CRLF or LF line ends, a leading byte-order mark, and a
 * delimiter guessed from the first line (comma, semicolon or tab). Cells are trimmed; blank
 * lines are dropped. Pure: no DOM, no host.
 */

export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => first.split(c).length - 1;
  const tabs = count('\t');
  const semicolons = count(';');
  const commas = count(',');
  if (tabs > commas && tabs >= semicolons) return '\t';
  if (semicolons > commas) return ';';
  return ',';
}

export function parseCsv(text: string, delimiter: string = detectDelimiter(text.replace(/^﻿/, ''))): string[][] {
  const source = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };
  while (i < source.length) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += c;
      }
      i++;
      continue;
    }
    if (c === '"' && cell.trim() === '') {
      cell = '';
      quoted = true;
    } else if (c === delimiter) {
      endCell();
    } else if (c === '\n' || c === '\r') {
      endRow();
      if (c === '\r' && source[i + 1] === '\n') i++;
    } else {
      cell += c;
    }
    i++;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

/** A number from a cell, accepting thousands separators; `null` for blank or non-numeric. */
export function cellNumber(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const cleaned = cell.replace(/[\s,]/g, '');
  if (cleaned === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  return Number(cleaned);
}
