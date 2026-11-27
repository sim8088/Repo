#!/usr/bin/env node
// Build a StationBooks export file from a database dump folder (one JSON file per document, laid out as
// <dir>/<collection>/<doc_id>.json — the layout an artifact-database dump produces).
//
//   node scripts/stationbooks-snapshot.mjs <dump-dir> <out.json>
//
// The output holds real company data: keep it out of the repository (*.stationbooks.json is ignored).
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error('Usage: node scripts/stationbooks-snapshot.mjs <dump-dir> <out.json>');
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
writeFileSync(out, JSON.stringify(snap));
const n = ledger.reduce((a, d) => a + (d.txns?.length ?? 0), 0);
console.log(`Wrote ${out}: ${ledger.length} ledger documents, ${n} transactions.`);
