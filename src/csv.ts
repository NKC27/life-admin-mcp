// Minimal RFC 4180 CSV reading and writing. Money files are meant to open cleanly in Excel or
// Numbers, so writing also guards against spreadsheet formula injection: bank descriptions come from
// outside, and a cell starting with = + - @ would otherwise run as a formula when the file is opened.

/**
 * The field separator a file uses: comma, semicolon (common in Europe, where the comma is the decimal
 * mark) or tab. Counted outside quotes over the first lines.
 */
export function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 30; i++) {
    const c = text[i]!;
    if (c === '"') inQuotes = !inQuotes;
    else if (inQuotes) continue;
    else if (c === "\n") lines++;
    else if (c in counts) counts[c]!++;
  }
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]!;
  return count > 0 ? best : ",";
}

/** Parse CSV text into rows of fields. Handles quotes, escaped quotes, CRLF and a UTF-8 BOM. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** A plain number such as "-32.47" is data, not a formula, and must stay readable as a number. */
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/** One CSV cell: text that could run as a formula gets a leading apostrophe; quoted when needed. */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (typeof value === "string" && FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Undo the formula guard added by `csvCell`. */
export function unguardCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

export function toCsv(rows: Array<Array<string | number>>): string {
  return `${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
