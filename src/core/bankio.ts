import { parseMoney } from './money';
import { isValidDate } from './dates';

/** A bank line as read from a file, before it is stored. Amount: + money in, − money out. */
export interface ParsedLine {
  date: string;
  description: string;
  amount: number;
  checkNo?: string;
  fitId?: string;
  /** Running balance after this line, when the file has one. */
  balance?: number;
}

export interface ParsedFile {
  format: 'csv' | 'ofx';
  lines: ParsedLine[];
  /** Closing balance printed in the file (OFX LEDGERBAL, or the last running balance in a CSV). */
  statementBalance?: number;
  statementDate?: string;
  /** Lines that couldn't be read, with the reason. */
  problems: string[];
}

// ── CSV ──────────────────────────────────────────────────────────────────
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** Accepts YYYY-MM-DD, MM/DD/YYYY, M/D/YY and YYYYMMDD. */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return norm(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (m) return norm(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  m = /^(\d{4})(\d{2})(\d{2})/.exec(t);
  if (m) return norm(+m[1], +m[2], +m[3]);
  return null;
}
function norm(y: number, mo: number, d: number): string | null {
  const s = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidDate(s) ? s : null;
}

const COL: Record<string, RegExp> = {
  date: /^(posted |post |transaction |trans\.? )?date$|^posted$/i,
  description: /^(description|memo|payee|name|details|transaction description)$/i,
  amount: /^amount$/i,
  debit: /^(debit|debits|withdrawal|withdrawals|amount debit)$/i,
  credit: /^(credit|credits|deposit|deposits|amount credit)$/i,
  check: /^(check|check ?#|check number|check no\.?|chk|serial number)$/i,
  balance: /^(balance|running balance|ledger balance)$/i,
};

export function parseCsv(text: string): ParsedFile {
  const rows = splitCsv(text);
  const problems: string[] = [];
  const headerIdx = rows.findIndex((r) => r.some((c) => COL.date.test(c.trim())) && r.some((c) => COL.amount.test(c.trim()) || COL.debit.test(c.trim())));
  if (headerIdx < 0) return { format: 'csv', lines: [], problems: ['No header row found. The file needs a Date column and either Amount or Debit/Credit columns.'] };
  const header = rows[headerIdx].map((c) => c.trim());
  const idx = (k: string) => header.findIndex((h) => COL[k].test(h));
  const ci = { date: idx('date'), description: idx('description'), amount: idx('amount'), debit: idx('debit'), credit: idx('credit'), check: idx('check'), balance: idx('balance') };
  const lines: ParsedLine[] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const date = parseDate(row[ci.date] ?? '');
    if (!date) { problems.push(`Row ${r + 1}: "${row[ci.date] ?? ''}" isn't a date; skipped.`); continue; }
    let amount: number | null = null;
    if (ci.amount >= 0) amount = parseMoney(row[ci.amount] ?? '');
    else {
      const d = (row[ci.debit] ?? '').trim();
      const c = (row[ci.credit] ?? '').trim();
      const dv = d ? parseMoney(d) : 0;
      const cv = c ? parseMoney(c) : 0;
      amount = dv === null || cv === null ? null : Math.abs(cv) - Math.abs(dv);
    }
    if (amount === null) { problems.push(`Row ${r + 1}: the amount isn't a number; skipped.`); continue; }
    const desc = (row[ci.description] ?? '').trim().replace(/\s+/g, ' ');
    const checkRaw = ci.check >= 0 ? (row[ci.check] ?? '').trim() : '';
    const checkNo = checkRaw || /\bCHECK\s*#?\s*(\d{3,})/i.exec(desc)?.[1];
    const balRaw = ci.balance >= 0 ? (row[ci.balance] ?? '').trim() : '';
    const balance = balRaw ? parseMoney(balRaw) ?? undefined : undefined;
    lines.push({ date, description: desc || '(no description)', amount, checkNo: checkNo || undefined, balance });
  }
  const out: ParsedFile = { format: 'csv', lines, problems };
  if (lines.length && lines.every((l) => l.balance !== undefined)) {
    // Files come newest-first or oldest-first; the closing balance belongs to the latest date.
    const chrono = lines[0].date <= lines[lines.length - 1].date ? lines : [...lines].reverse();
    out.statementBalance = chrono[chrono.length - 1].balance;
    out.statementDate = chrono[chrono.length - 1].date;
  }
  return out;
}

// ── OFX / QFX ────────────────────────────────────────────────────────────
function tag(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block);
  return m ? m[1].trim() : undefined;
}

export function parseOfx(text: string): ParsedFile {
  const problems: string[] = [];
  const lines: ParsedLine[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);
  blocks.forEach((b, i) => {
    const date = parseDate(tag(b, 'DTPOSTED') ?? '');
    const amount = parseMoney(tag(b, 'TRNAMT') ?? '');
    if (!date || amount === null) { problems.push(`Transaction ${i + 1}: missing date or amount; skipped.`); return; }
    const name = tag(b, 'NAME') ?? '';
    const memo = tag(b, 'MEMO') ?? '';
    const description = [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' ').replace(/\s+/g, ' ') || '(no description)';
    lines.push({ date, amount, description, fitId: tag(b, 'FITID'), checkNo: tag(b, 'CHECKNUM') || undefined });
  });
  const ledger = /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|$)/i.exec(text)?.[1];
  const out: ParsedFile = { format: 'ofx', lines, problems };
  if (ledger) {
    const bal = parseMoney(tag(ledger, 'BALAMT') ?? '');
    if (bal !== null) out.statementBalance = bal;
    out.statementDate = parseDate(tag(ledger, 'DTASOF') ?? '') ?? undefined;
  }
  if (!blocks.length) problems.push('No transactions found. Is this an OFX/QFX bank download?');
  return out;
}

export function parseBankFile(name: string, text: string): ParsedFile {
  return /\.(ofx|qfx)$/i.test(name) || /<OFX>/i.test(text) ? parseOfx(text) : parseCsv(text);
}

/** Stable key so re-importing the same line is a no-op. Identical lines within one file are numbered. */
export function lineHashes(accountId: string, lines: ParsedLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    if (l.fitId) return `fit:${accountId}:${l.fitId}`;
    const base = `${accountId}|${l.date}|${l.amount}|${l.description.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}
