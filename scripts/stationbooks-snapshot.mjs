#!/usr/bin/env node
// Build a StationBooks export file from a database dump folder (one JSON file per document, laid out as
// <dir>/<collection>/<doc_id>.json — the layout an artifact-database dump produces).
//
//   node scripts/stationbooks-snapshot.mjs <dump-dir> <out.json> [--bank <name> <values.json>...]
//
// --bank adds the operating account's statement lines from a bank-ledger spreadsheet, given as one or more
// Sheets "values" exports ({ values: [[...]] }) in row order. The first file's first row names the columns:
// Date (MM/DD/YYYY), Description, Check #, Money out, Money in, Bank balance, and optionally Bucket, Store,
// Counterparty.
//
// The output holds real company data: keep it out of the repository (*.stationbooks.json is ignored).
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out, ...rest] = process.argv.slice(2);
if (!dir || !out || (rest.length && (rest[0] !== '--bank' || rest.length < 3))) {
  console.error('Usage: node scripts/stationbooks-snapshot.mjs <dump-dir> <out.json> [--bank <name> <values.json>...]');
  process.exit(1);
}
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const doc = (col, id) => (existsSync(join(dir, col, `${id}.json`)) ? read(join(dir, col, `${id}.json`)) : undefined);
const strip = (d) => {
  if (!d || typeof d !== 'object') return d;
  const { data, ...rest } = d; // tolerate dumps that wrap fields in { data }
  return data && typeof data === 'object' && !Array.isArray(data) ? data : rest;
};
const ledgerDir = join(dir, 'ledger');
const ledger = existsSync(ledgerDir) ? readdirSync(ledgerDir).filter((f) => f.endsWith('.json')).map((f) => strip(read(join(ledgerDir, f)))) : [];
const snap = {
  format: 'stationbooks-export',
  exportedAt: new Date().toISOString(),
  meta: {
    stores: strip(doc('meta', 'stores')),
    categories: strip(doc('meta', 'categories')),
    vendors: strip(doc('meta', 'vendors')),
    settings: strip(doc('meta', 'settings')),
    periods: strip(doc('meta', 'periods')),
  },
  ledger,
  accounts: strip(doc('accounts', 'all')),
  balances: strip(doc('balances', 'all')),
  parties: strip(doc('parties', 'all')),
};
const cents = (v) => {
  const t = String(v ?? '').replace(/[$,\s]/g, '');
  if (!t) return undefined;
  const neg = /^\(.*\)$|^-/.test(t);
  const n = Math.round(Number(t.replace(/[()-]/g, '')) * 100);
  if (!Number.isFinite(n)) throw new Error(`Not an amount: ${v}`);
  return neg ? -n : n;
};
if (rest.length) {
  const [, name, ...files] = rest;
  const rows = files.flatMap((f) => read(f).values ?? []);
  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = (n) => header.indexOf(n);
  const c = { date: col('date'), desc: col('description'), check: col('check #'), out: col('money out'), in: col('money in'), bal: col('bank balance'), bucket: col('bucket'), store: col('store'), cp: col('counterparty') };
  if ([c.date, c.desc, c.out, c.in].some((i) => i < 0)) throw new Error('The bank sheet needs Date, Description, Money out and Money in columns.');
  const lines = [];
  for (const r of rows.slice(1)) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(r[c.date] ?? '').trim());
    if (!m) continue;
    const amountCents = (cents(r[c.in]) ?? 0) - (cents(r[c.out]) ?? 0);
    const opt = (i) => (i >= 0 && String(r[i] ?? '').trim()) || undefined;
    lines.push({ date: `${m[3]}-${m[1]}-${m[2]}`, description: String(r[c.desc] ?? '').trim(), amountCents, checkNo: opt(c.check), balanceCents: c.bal >= 0 ? cents(r[c.bal]) : undefined, bucket: opt(c.bucket), store: opt(c.store), counterparty: opt(c.cp) });
  }
  snap.bank = { name, lines };
  console.log(`Bank: ${lines.length} lines ${lines[0]?.date} – ${lines.at(-1)?.date}.`);
}
writeFileSync(out, JSON.stringify(snap));
const n = ledger.reduce((a, d) => a + (d.txns?.length ?? 0), 0);
console.log(`Wrote ${out}: ${ledger.length} ledger documents, ${n} transactions.`);
