import type { BooksState, ID, User } from './types';
import type { Cents } from './money';
import { zip } from './xlsx';
import { trialBalance } from './reports';
import { CLASS_LABEL } from './assets';
import { amortization, loansOf } from './loans';
import { peopleOf, taxTracker } from './payroll';
import { ten99 } from './payables';
import { icSummary, ownerDraws } from './intercompany';
import { storeBalance } from './fuel';
import { postedCounts } from './inside';
import { can, PermissionError } from './permissions';
import {
  DISCLAIMER, M1_LABEL, bookToTax, bookVsTax, estimates, k1Allocation, m2, maskEin, profileOf, returnUnits, salesTaxPeriod, salesTaxPeriods, salesTaxWorksheet, CLASS_FORM,
} from './tax';

/**
 * The year-end CPA package (SPEC §12): one ZIP with every schedule the outside accountant asks for, as CSV files
 * (they open in Excel), plus a printable index. Built from the same functions the screens use, so it ties to them.
 */
export interface PackageFile { name: string; title: string; rows: number; csv: string }
export interface CpaPackage { year: number; asOf: string; files: PackageFile[]; indexHtml: string }

const d = (c: Cents) => (c / 100).toFixed(2);
const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
const html = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function cpaPackage(state: BooksState, opts: { year: number; asOf: string }): CpaPackage {
  const { year, asOf } = opts;
  const to = asOf < `${year}-12-31` ? asOf : `${year}-12-31`;
  const files: PackageFile[] = [];
  const add = (name: string, title: string, rows: (string | number)[][]) => files.push({ name, title, rows: Math.max(0, rows.length - 1), csv: csv(rows) });
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  const party = (id?: ID) => state.parties.find((p) => p.id === id)?.name ?? '';

  // 01 Trial balance per entity.
  for (const e of state.entities.filter((x) => !x.deleted)) {
    const tb = trialBalance(state, { asOf: to, entityId: e.id });
    add(`01-trial-balance-${e.code}.csv`, `Trial balance – ${e.code} ${e.name} (${CLASS_FORM[e.taxClass]}, EIN ${maskEin(e.ein)})`, [
      ['Account', 'Name', 'Debit', 'Credit'], ...tb.rows.map((r) => [r.account.number, r.account.name, d(r.debit), d(r.credit)]), ['', 'Total', d(tb.totalDebit), d(tb.totalCredit)], ['', 'Net income (year to date)', d(tb.netIncome), ''],
    ]);
  }
  // 02 Fixed assets, book and tax.
  const bt = bookVsTax(state, { year, asOf });
  add('02-fixed-assets-book-and-tax.csv', 'Fixed asset schedule – book and tax side by side', [
    ['Tag', 'Asset', 'Class', 'Store', 'In service', 'Cost', 'Book life (months)', 'Book depreciation (year)', 'Book accumulated', 'Tax method', 'Recovery years', 'Convention', '§179', 'Bonus %', 'Tax depreciation (year)', 'Tax accumulated', 'Book − tax', 'Flags'],
    ...bt.map((r) => [r.a.tag, r.a.name, CLASS_LABEL[r.a.class], code(r.a.storeId), r.a.inService, d(r.a.cost), r.a.lifeMonths, d(r.book), d(r.bookAccum), r.setup.method, r.setup.years, r.convention ?? '', d(r.setup.section179), r.setup.bonusPct, d(r.tax.total), d(r.taxAccum), d(r.difference), r.flags.join(' | ')]),
  ]);
  // 03 Loans.
  const loanRows: (string | number)[][] = [['Loan', 'Lender', 'Held by', '#', 'Due', 'Opening', 'Payment', 'Interest', 'Principal', 'Closing', 'Posted']];
  for (const l of loansOf(state)) for (const r of amortization(l)) if (r.date.startsWith(String(year))) loanRows.push([l.name, l.lender, l.heldBy, r.n, r.date, d(r.opening), d(r.payment), d(r.interest), d(r.principal), d(r.closing), r.txnId ? 'yes' : r.before ? 'before books' : '']);
  add('03-loan-schedules.csv', `Loan amortization – payments due in ${year}`, loanRows);
  // 04 Payroll summaries.
  const runs = peopleOf(state).runs.filter((r) => r.payDate.startsWith(String(year)));
  add('04-payroll-summary.csv', `Payroll – Gusto runs and quarterly taxes, ${year}`, [
    ['Kind', 'Pay date / quarter', 'Gross', 'Employee taxes', 'Employer taxes', 'Net', 'Federal liability', 'State liability', 'Federal deposits', 'State deposits'],
    ...runs.map((r) => ['Run', r.payDate, d(r.reported.gross), d(r.reported.employeeTaxes), d(r.reported.employerTaxes), d(r.reported.net), '', '', '', '']),
    ...taxTracker(state).filter((q) => q.quarter.startsWith(String(year))).map((q) => ['Quarter', q.quarter, '', '', '', '', d(q.fedLiability), d(q.stateLiability), d(q.fedDeposits), d(q.stateDeposits)]),
  ]);
  // 05 1099s.
  add('05-1099-vendors.csv', `1099 vendors – ${year}`, [['Vendor', 'Paid', 'Payments', 'At or over $600'], ...ten99(state, year, asOf).map((v) => [v.name, d(v.paid), v.count, v.flagged ? 'yes' : 'no'])]);
  // 06 Owner draws.
  const draws = ownerDraws(state, { from: `${year}-01-01`, to });
  add('06-owner-draws.csv', `Owner draws and distributions – ${year}`, [['Date', 'TX', 'Owner', 'Store', 'Booked as', 'Amount', 'Description'], ...draws.rows.map((r) => [r.t.date, r.t.ref, party(r.ownerId), code(r.l.storeId), r.via, d(r.amount), r.t.description])]);
  // 07 Intercompany balances.
  const ic = icSummary(state, to);
  add('07-intercompany-balances.csv', `Intercompany and related-party balances at ${to}`, [['Party / entity', 'Kind', 'Type', 'Balance (+ owed to us)'], ...ic.parties.map((p) => [p.name, 'party', p.typeLabel, d(p.balance)]), ...ic.entities.map((p) => [p.name, 'entity', p.typeLabel, d(p.balance)])]);
  // 08 Inventory.
  const invRows: (string | number)[][] = [['Store', 'Fuel inventory (1300)', 'Merchandise inventory (1310)', 'Last posted count', 'Counted at cost']];
  for (const s of state.stores.filter((x) => !x.deleted && x.kind === 'operating')) {
    const last = postedCounts(state, s.id).filter((c) => c.date <= to).sort((a, b) => b.date.localeCompare(a.date))[0];
    invRows.push([s.code, d(storeBalance(state, 'acct_inv_fuel', s.id, to)), d(storeBalance(state, 'acct_inv_merch', s.id, to)), last?.date ?? '', last ? d(last.lines.reduce((a, l) => a + l.counted, 0)) : '']);
  }
  add('08-inventory.csv', `Inventory at ${to}`, invRows);
  // 09 Tax workpapers: book-to-tax, M-1, M-2 per return.
  const wp: (string | number)[][] = [['Return', 'Form', 'Line', 'Item', 'Amount', 'Basis', 'Source', 'Workpaper', 'Reviewed']];
  for (const u of returnUnits(state)) {
    const b = bookToTax(state, u.entity.id, year, asOf);
    const m = m2(state, u.entity.id, year, asOf);
    wp.push([u.entity.code, u.form, 'Book income', 'Net income per books (these books + before them)', d(b.bookIncome), `Ledger ${d(b.ytdBook)} + prior system ${d(b.priorIncome)}`, '/reports/trial-balance', '', '']);
    for (const r of b.adjustments) wp.push([u.entity.code, u.form, M1_LABEL[r.m1Line], r.label, d(r.amount), r.basis, r.source ?? '', r.workpaper, r.reviewed ? 'yes' : 'no']);
    wp.push([u.entity.code, u.form, 'M-1 line 8', 'Taxable income', d(b.m1.line8), '', '', '', '']);
    wp.push([u.entity.code, u.form, 'M-2', m.kind === 'aaa' ? 'AAA ending' : 'Capital ending', d(m.ending), `Begin ${d(m.beginning)} + income ${d(m.income)} − non-deductible ${d(m.nondeductible)} − distributions ${d(m.distributions)}`, '', '', '']);
  }
  add('09-tax-workpapers.csv', `Book-to-tax workpapers, Schedule M-1 and M-2 – ${year}`, wp);
  // 10 Sales tax.
  const st: (string | number)[][] = [['Period', ...salesTaxWorksheet(state, salesTaxPeriod(state, salesTaxPeriods(state)[0] ?? `${year}-01`, { today: asOf }))[0]]];
  for (const p of salesTaxPeriods(state).filter((x) => x.startsWith(String(year))).sort()) for (const row of salesTaxWorksheet(state, salesTaxPeriod(state, p, { today: asOf })).slice(1)) st.push([p, ...row]);
  add('10-sales-tax.csv', `Sales tax by month – taxable sales, collected, remitted (${year})`, st);
  // 11 Estimates.
  const est: (string | number)[][] = [['Payer', 'Jurisdiction', 'Quarter', 'Due', 'Required', 'Paid', 'Short', 'Method', 'Prior-year tax']];
  for (const s of estimates(state, asOf, year)) for (const i of s.installments) est.push([s.payerName, s.plan.jurisdiction, i.quarter, i.dueDate, d(i.required), d(i.paid), d(i.short), s.method === 'safe_harbor' ? `${s.safeHarborPct}% of prior year` : '90% of current year', d(s.plan.priorYearTax)]);
  add('11-estimated-taxes.csv', `Estimated tax payments – ${year}`, est);
  // 12 K-1 support.
  const k1: (string | number)[][] = [['Return', 'Owner', '%', 'Share of income', 'Distributions', 'Basis start', 'Basis end', 'Suspended loss', 'Capital start', 'Capital end']];
  for (const u of returnUnits(state)) for (const r of k1Allocation(state, u.entity.id, year, asOf).rows) k1.push([u.entity.code, r.name, (r.pctBps / 100).toFixed(2), d(r.income), d(r.distributions), d(r.basisStart), d(r.basisEnd), d(r.suspendedLoss), d(r.capitalStart), d(r.capitalEnd)]);
  add('12-k1-owner-support.csv', `K-1 support – owner shares, basis and capital (${year})`, k1);
  // 00 Entity map.
  const em: (string | number)[][] = [['Entity', 'Name', 'Classification', 'EIN', 'Owners', 'Files on', 'Method', 'Preparer']];
  for (const e of state.entities.filter((x) => !x.deleted)) {
    const p = profileOf(state, e.id);
    em.push([e.code, e.name, CLASS_FORM[e.taxClass], maskEin(e.ein), p.owners.map((o) => `${party(o.partyId)} ${(o.pctBps / 100).toFixed(2)}%`).join('; '), state.entities.find((x) => x.id === p.parentEntityId)?.code ?? e.code, p.method, p.preparer ?? '']);
  }
  add('00-entity-map.csv', 'Entity map – classification, owners, method', em);
  files.sort((a, b) => a.name.localeCompare(b.name));
  const indexHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CPA package ${year}</title><style>body{font-family:sans-serif;margin:32px;color:#222}table{border-collapse:collapse}td,th{border-bottom:1px solid #ccc;padding:4px 10px;text-align:left}td.n{text-align:right}</style></head><body>`
    + `<h1>${html(state.settings.companyName)} — CPA package ${year}</h1><p>Prepared from the portal on ${html(asOf)}, figures through ${html(to)}. ${html(DISCLAIMER)}</p>`
    + `<table><thead><tr><th>#</th><th>File</th><th>Contents</th><th>Rows</th></tr></thead><tbody>${files.map((f, i) => `<tr><td>${i + 1}</td><td>${html(f.name)}</td><td>${html(f.title)}</td><td class="n">${f.rows}</td></tr>`).join('')}</tbody></table></body></html>`;
  return { year, asOf, files, indexHtml };
}

/** The package as a ZIP: every CSV, the printable index (HTML) and the index as CSV. Needs the export permission. */
export function cpaPackageZip(state: BooksState, actor: User, opts: { year: number; asOf: string }): Uint8Array {
  if (!can(actor, 'export')) throw new PermissionError("Your role can't export the CPA package. Ask the CFO to do it or to change your role.");
  const p = cpaPackage(state, opts);
  const enc = new TextEncoder();
  const index = csv([['#', 'File', 'Contents', 'Rows'], ...p.files.map((f, i) => [i + 1, f.name, f.title, f.rows])]);
  return zip([
    { name: 'index.html', data: enc.encode(p.indexHtml) },
    { name: 'index.csv', data: enc.encode(index) },
    ...p.files.map((f) => ({ name: f.name, data: enc.encode(f.csv) })),
  ]);
}
