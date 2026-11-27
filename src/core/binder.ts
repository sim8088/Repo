/**
 * Phase 8 — the close binder: one printable HTML document for a month (statements on both bases, the bank
 * reconciliation, the checklist with its evidence, schedules and an index of supporting documents), plus the same
 * schedules as a ZIP of CSV files. Pure: builds data from the books; the page only downloads it.
 */
import type { BooksState, ID } from './types';
import { lastDayOfPeriod, periodLabel, shortDate, todayInChicago } from './dates';
import { formatMoney } from './money';
import { BASIS_LABEL, balanceSheet, basisEntries, bridge, cashFlow, statement, type Statement } from './statements';
import { flatLines } from './reports';
import { reconcileStatus } from './bank';
import { apAging, AP_AGING_LABELS, apState } from './payables';
import { AGING_LABELS, icSummary } from './intercompany';
import { fuelMargin, fuelOf } from './fuel';
import { bva, budgetsOf } from './budgets';
import { closeChecklist, intercompanyAgreement, STATUS_LABEL, COMPANY } from './close';
import { zip } from './xlsx';

export interface BinderTable { caption: string; file: string; header: string[]; rows: (string | number)[][]; /** Column indexes that hold cents. */ money: number[] }
export interface BinderSection { key: string; title: string; note?: string; tables: BinderTable[]; ties: { label: string; ok: boolean }[] }
export interface Binder { period: string; title: string; generatedAt: string; locked: boolean; sections: BinderSection[]; documents: number }

const $ = (c: number) => formatMoney(c, { dollarSign: true });

function pnlTable(state: BooksState, st: Statement, file: string, caption: string): BinderTable {
  const code = (id: string) => state.stores.find((s) => s.id === id)?.code ?? id;
  const cols = st.cols.filter((c) => st.rows.some((r) => r.by[c]) || st.netSales[c]);
  const row = (label: string, by: Record<string, number>, total: number) => [label, ...cols.map((c) => by[c] ?? 0), total];
  return {
    caption, file, header: ['Line', ...cols.map(code), 'Total'], money: [...cols.map((_, i) => i + 1), cols.length + 1],
    rows: [
      ...st.rows.map((r) => row(`${r.account.number} ${r.account.name}`, r.by, r.total)),
      row('Net sales', st.netSales, st.netSales.total), row('Gross profit', st.grossProfit, st.grossProfit.total),
      row('Operating expenses', st.expenses, st.expenses.total), row('Net profit', st.netIncome, st.netIncome.total),
    ],
  };
}

export function closeBinder(state: BooksState, period: string, opts: { today?: string; visible?: ID[] } = {}): Binder {
  const today = opts.today ?? todayInChicago();
  const d1 = lastDayOfPeriod(period), d0 = `${period}-01`;
  const storeIds = opts.visible ?? state.stores.map((s) => s.id);
  const entries = basisEntries(state);
  const lines = flatLines(state);
  const code = (id: string) => (id === COMPANY ? 'Company' : state.stores.find((s) => s.id === id)?.code ?? id);
  const user = (id?: string) => state.users.find((u) => u.id === id)?.name ?? '';
  const sections: BinderSection[] = [];

  // Checklist
  const cl = closeChecklist(state, period, { today, entries });
  sections.push({
    key: 'checklist', title: 'Month-end checklist', note: cl.override ? `Locked with an override by ${user(cl.override.by)}: ${cl.override.reason} (open then: ${cl.override.open.join('; ')}).` : undefined,
    tables: [{
      caption: 'Every step, store by store, with its evidence', file: 'checklist.csv', money: [],
      header: ['Step', 'Store', 'Status', 'Owner', 'Due', 'Evidence', 'Note', 'Attachments'],
      rows: cl.rows.flatMap((r) => r.cells.filter((c) => c.status !== 'na').map((c) => [`${r.def.n}. ${r.def.label}`, code(c.storeId), STATUS_LABEL[c.status] + (c.auto ? ' (from the data)' : ''), user(c.ownerId), c.due, [...(c.proof?.evidence ?? []), ...(c.proof?.missing ?? [])].join(' '), c.item?.note ?? '', (c.item?.attachments ?? []).map((a) => a.name).join('; ')])),
    }],
    ties: [{ label: cl.ready ? 'Every step done' : `${cl.open.length} step(s) open`, ok: cl.ready }, { label: cl.locked ? 'Month locked' : 'Month not locked', ok: cl.locked }],
  });

  // Statements
  const acc = statement(state, { basis: 'accrual', from: period, to: period, storeIds, entries });
  const cash = statement(state, { basis: 'cash', from: period, to: period, storeIds, entries });
  const br = bridge(state, { from: period, to: period, storeIds, entries });
  sections.push({
    key: 'pnl', title: 'Profit & loss, accrual and cash', tables: [
      pnlTable(state, acc, 'pnl-accrual.csv', `${BASIS_LABEL.accrual} basis by store`),
      pnlTable(state, cash, 'pnl-cash.csv', `${BASIS_LABEL.cash} basis by store`),
      { caption: 'Bridge: cash basis to accrual basis', file: 'bridge.csv', header: ['Line', 'Items', 'Amount'], money: [2], rows: [['Net profit, cash basis', '', br.cash], ...br.lines.map((l) => [l.label, l.count, l.amount]), ['Net profit, accrual basis', '', br.accrual]] },
    ],
    ties: [{ label: 'Accrual P&L ties to its entries', ok: acc.difference === 0 }, { label: 'Cash P&L ties to its entries', ok: cash.difference === 0 }, { label: 'Cash + bridge = accrual', ok: br.ties }],
  });
  const bs = balanceSheet(state, { asOf: d1, lines });
  sections.push({
    key: 'bs', title: `Balance sheet at ${shortDate(d1)}`, tables: [{
      caption: 'Consolidated', file: 'balance-sheet.csv', header: ['Section', 'Group', 'Account', 'Amount'], money: [3],
      rows: [...bs.sections.flatMap((s) => [...s.groups.flatMap((g) => [...g.lines.filter((l) => l.amount).map((l) => [s.label, g.label, `${l.account.number} ${l.account.name}`, l.amount]), ...(g.extra ? [[s.label, g.label, g.extra.label, g.extra.amount]] : [])]), [s.label, '', `Total ${s.label.toLowerCase()}`, s.total]])],
    }],
    ties: [{ label: 'Assets = liabilities + equity', ok: bs.difference === 0 }, { label: 'Agrees to the trial balance', ok: bs.agreesToTb }],
  });
  const cf = cashFlow(state, { from: d0, to: d1, lines });
  sections.push({
    key: 'cf', title: 'Cash flow (indirect)', tables: [{
      caption: `${shortDate(d0)} – ${shortDate(d1)}`, file: 'cash-flow.csv', header: ['Section', 'Line', 'Amount'], money: [2],
      rows: [['', 'Cash and equivalents, opening', cf.openingCash], ...cf.sections.flatMap((s) => [...s.lines.map((l) => [s.label, l.label, l.amount]), [s.label, `Net ${s.label.toLowerCase()}`, s.total]]), ['', 'Net change', cf.netChange], ['', 'Cash and equivalents, closing', cf.closingCash]],
    }],
    ties: [{ label: 'Opening + change = closing', ok: cf.ties }],
  });

  // Bank reconciliation
  const bankAccts = state.accounts.filter((a) => a.subtype === 'bank' && a.active && (a.id === 'acct_trustmark' || state.bank.lines.some((b) => b.accountId === a.id)));
  const recTables = bankAccts.flatMap((a) => {
    const st = reconcileStatus(state, a.id, d1);
    const rec = state.bank.reconciliations.filter((r) => r.accountId === a.id && r.statementDate === d1).at(-1);
    return [
      { caption: `${a.name}: reconciliation at ${shortDate(d1)}${rec ? ` (saved by ${user(rec.by)})` : ' (not saved yet)'}`, file: `bank-rec-${a.id}.csv`, header: ['Line', 'Amount'], money: [1], rows: [['Balance per books', st.bookBalance], ['Less items in the books, not on the statement', -st.bookOnly.reduce((x, i) => x + i.amount, 0)], ['Plus items on the statement, not in the books', st.bankOnly.reduce((x, i) => x + i.amount, 0)], ['Statement balance it explains', st.expectedStatement], ['Statement balance recorded', rec?.statementBalance ?? st.feedBalance ?? 0], ['Difference', rec ? rec.difference : (st.feedBalance ?? 0) - st.expectedStatement]] },
      { caption: `${a.name}: outstanding and bank-only items`, file: `bank-items-${a.id}.csv`, header: ['Date', 'Kind', 'Reference', 'Description', 'Amount'], money: [4], rows: [...st.bookOnly.map((i) => [i.date, 'In books, not on statement', i.ref ?? '', i.description, i.amount]), ...st.bankOnly.map((i) => [i.date, 'On statement, not in books', '', i.description, i.amount])] },
    ];
  });
  const recs = bankAccts.map((a) => state.bank.reconciliations.filter((r) => r.accountId === a.id && r.statementDate === d1).at(-1));
  sections.push({ key: 'bank', title: 'Bank reconciliation', tables: recTables, ties: [{ label: recs.every((r) => r && r.difference === 0) ? 'Reconciled at a $0.00 difference' : 'Not reconciled through month end', ok: recs.every((r) => !!r && r.difference === 0) }] });

  // Budget vs actual
  const b = bva(state, { from: period, to: period, storeIds, entries });
  if (b.available) {
    const commented = b.cells.filter((c) => c.over);
    sections.push({
      key: 'bva', title: 'Budget vs actual', tables: [
        { caption: 'Accrual basis, all stores', file: 'budget-vs-actual.csv', header: ['Line', 'Actual', 'Budget', 'Variance', 'Variance %'], money: [1, 2, 3], rows: b.rows.map((r) => [`${r.account.number} ${r.account.name}`, r.actual, r.budget, r.variance, r.pct === null ? '' : `${(r.pct * 100).toFixed(1)}%`]) },
        { caption: `Variances over the threshold (${budgetsOf(state).threshold.pct}% and ${$(budgetsOf(state).threshold.minCents)})`, file: 'variance-comments.csv', header: ['Store', 'Line', 'Actual', 'Budget', 'Variance', 'Comment'], money: [2, 3, 4], rows: commented.map((c) => [code(c.storeId), c.account.name, c.actual, c.budget, c.variance, c.comments.map((x) => `${x.text} (${user(x.by)})`).join(' / ') || 'No comment']) },
      ],
      ties: [{ label: 'Actuals tie to the P&L', ok: b.actualTiesToPnl }, { label: 'Budget ties to the budget grid', ok: b.budgetTiesToCells }, { label: commented.every((c) => c.comments.length) ? 'Every variance over the threshold explained' : 'Variances without a comment', ok: commented.every((c) => c.comments.length) }],
    });
  }

  // Schedules
  const ap = apAging(state, d1);
  const ic = icSummary(state, d1);
  const agree = intercompanyAgreement(state, period);
  const fm = fuelMargin(state, { storeIds, from: d0, to: d1, by: 'month' });
  const fixed = bs.sections.find((s) => s.key === 'assets')?.groups.find((g) => g.key === 'fixed_asset');
  sections.push({
    key: 'schedules', title: 'Schedules', tables: [
      { caption: `AP aging at ${shortDate(d1)}`, file: 'ap-aging.csv', header: ['Vendor', ...AP_AGING_LABELS, 'Total'], money: [1, 2, 3, 4, 5, 6], rows: [...ap.rows.map((r) => [r.name, ...r.buckets, r.total]), ['Total', ...ap.buckets, ap.total]] },
      { caption: 'Intercompany and related-party balances (+ they owe us)', file: 'intercompany.csv', header: ['Party', ...AGING_LABELS, 'Balance', 'Agreed'], money: [1, 2, 3, 4, 5, 6], rows: [...ic.parties.filter((p) => p.balance).map((p) => [p.name, ...p.aging, p.balance, agree.rows.find((r) => r.id === p.id)?.agreed ? 'Yes' : 'No']), ...ic.entities.filter((p) => p.balance).map((p) => [p.name, ...p.aging, p.balance, 'Group'])] },
      { caption: 'Fuel: gallons and margin', file: 'fuel.csv', header: ['Store', 'Gallons', 'Fuel sales', 'Fuel cost', 'Margin', '¢/gal'], money: [2, 3, 4], rows: fm.stores.map((s) => [code(s.storeId), Math.round(s.gallons), s.retail, s.cogs, s.margin, s.marginCpg.toFixed(1)]) },
      { caption: 'Fixed assets (balance sheet; the asset register arrives with phase 9)', file: 'fixed-assets.csv', header: ['Account', 'Balance'], money: [1], rows: [...(fixed?.lines ?? []).map((l) => [`${l.account.number} ${l.account.name}`, l.amount]), ['Net fixed assets', fixed?.total ?? 0]] },
    ],
    ties: [{ label: 'AP aging ties to 2000', ok: ap.ties }, { label: agree.eliminates ? 'Group due-to / due-from eliminate' : 'Group balances do not eliminate', ok: agree.eliminates }],
  });

  // Supporting documents
  const docs: (string | number)[][] = [];
  for (const t of state.transactions) if (!t.deleted && t.date >= d0 && t.date <= d1) for (const a of t.attachments) docs.push([a.name, `Transaction ${t.ref}`, t.date, t.description]);
  for (const bl of apState(state).bills) if (bl.billDate >= d0 && bl.billDate <= d1) for (const a of bl.attachments) docs.push([a.name, `Bill ${bl.ref}`, bl.billDate, bl.invoiceNo ?? '']);
  for (const i of fuelOf(state).invoices) if (!i.deleted && i.deliveredOn >= d0 && i.deliveredOn <= d1) for (const a of i.attachments) docs.push([a.name, `Fuel invoice ${i.invoiceNo ?? i.bolNo}`, i.deliveredOn, code(i.storeId)]);
  for (const n of fuelOf(state).notices) if (n.noticeDate >= d0 && n.noticeDate <= d1) for (const a of n.attachments) docs.push([a.name, `Craddock notice ${n.noticeNo}`, n.noticeDate, code(n.storeId)]);
  for (const r of cl.rows) for (const c of r.cells) for (const a of c.item?.attachments ?? []) docs.push([a.name, `Close evidence: ${r.def.label} (${code(c.storeId)})`, a.addedAt.slice(0, 10), '']);
  for (const bt of state.bank.batches) if (bt.to >= d0 && bt.from <= d1) docs.push([bt.fileName, 'Bank statement import', bt.importedAt.slice(0, 10), `${bt.added} lines`]);
  docs.sort((x, y) => String(x[2]).localeCompare(String(y[2])));
  sections.push({ key: 'docs', title: 'Index of supporting documents', note: 'Files are kept with the record they support; this index says where each one is.', tables: [{ caption: `${docs.length} documents`, file: 'documents.csv', header: ['Document', 'Where it is filed', 'Date', 'About'], money: [], rows: docs }], ties: [] });

  return { period, title: `Close binder — ${periodLabel(period)}`, generatedAt: today, locked: state.periods[period]?.status === 'locked', sections, documents: docs.length };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The binder as one self-contained, printable HTML document. */
export function binderHtml(state: BooksState, b: Binder): string {
  const cell = (t: BinderTable, v: string | number, i: number) => (t.money.includes(i) && typeof v === 'number' ? `<td class="num">${esc(formatMoney(v))}</td>` : `<td${typeof v === 'number' ? ' class="num"' : ''}>${esc(String(v))}</td>`);
  const table = (t: BinderTable) => `<table><caption>${esc(t.caption)}</caption><thead><tr>${t.header.map((h, i) => `<th scope="col"${t.money.includes(i) ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.length ? t.rows.map((r) => `<tr>${r.map((v, i) => cell(t, v, i)).join('')}</tr>`).join('') : `<tr><td colspan="${t.header.length}">None.</td></tr>`}</tbody></table>`;
  const sec = (s: BinderSection, i: number) => `<section id="${s.key}"><h2>${i + 1}. ${esc(s.title)}</h2>${s.note ? `<p>${esc(s.note)}</p>` : ''}${s.tables.map(table).join('')}${s.ties.length ? `<p class="ties">${s.ties.map((t) => `<span class="${t.ok ? 'ok' : 'bad'}">${t.ok ? '✓' : '✗'} ${esc(t.label)}</span>`).join(' · ')}</p>` : ''}</section>`;
  const css = 'body{font:13px/1.45 Georgia,serif;color:#1b1915;background:#fff;margin:32px;}h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:28px 0 8px;border-bottom:1px solid #1b1915;padding-bottom:4px}table{border-collapse:collapse;width:100%;margin:8px 0 14px;font:12px/1.4 system-ui,sans-serif}caption{text-align:left;font-weight:600;padding:4px 0}th,td{border-bottom:1px solid #ddd5c6;padding:3px 6px;text-align:left;vertical-align:top}th{font-weight:600}.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.ties{font:12px system-ui,sans-serif}.ok{color:#1e6b43}.bad{color:#b3261e}ol{columns:2}section{break-before:page}section:first-of-type{break-before:auto}';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(b.title)}</title><style>${css}</style></head><body>`
    + `<header><p>${esc(state.settings.companyName)}</p><h1>${esc(b.title)}</h1><p>Generated ${esc(shortDate(b.generatedAt))}. ${b.locked ? 'The month is locked.' : 'The month is not locked yet: figures can still change.'} Amounts in dollars; negatives in parentheses.</p>`
    + `<nav aria-label="Contents"><h2>Contents</h2><ol>${b.sections.map((s) => `<li><a href="#${s.key}">${esc(s.title)}</a></li>`).join('')}</ol></nav></header>`
    + `<main>${b.sections.map(sec).join('')}</main></body></html>`;
}

/** Every binder table as a CSV file. */
export function binderCsvs(b: Binder): { name: string; text: string }[] {
  const escCsv = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return b.sections.flatMap((s) => s.tables.map((t) => ({
    name: t.file,
    text: [t.header, ...t.rows.map((r) => r.map((v, i) => (t.money.includes(i) && typeof v === 'number' ? (v / 100).toFixed(2) : v)))].map((r) => r.map(escCsv).join(',')).join('\n'),
  })));
}

/** The schedules as one ZIP of CSV files. */
export function binderZip(b: Binder): Uint8Array {
  const enc = new TextEncoder();
  return zip(binderCsvs(b).map((f) => ({ name: f.name, data: enc.encode(f.text) })));
}
