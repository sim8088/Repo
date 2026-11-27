import { describe, expect, it } from 'vitest';
import { buildDemo } from '../data/seed';
import { answerCsv, answerText, ask, findAccount, findParty, looksLikeQuestion, parseDate, parseRange, weekOf, type AskAnswer, type AskResult } from './ask';
import { balanceAsOf } from './reports';
import { salesRows } from './fuel';
import { apState, billTotal } from './payables';
import { icSummary } from './intercompany';

const s = buildDemo();
const today = '2026-11-27';
const all = new Set(s.stores.map((x) => x.id));
const q = (text: string, visible: Set<string> = all): AskResult => ask(s, text, { today, visible });
const ok = (r: AskResult): AskAnswer => {
  if (!r.ok) throw new Error(`Not answered: ${r.reason}`);
  return r;
};
/** The figure is always the sum of the proof rows, and every money row points at something real. */
const proven = (a: AskAnswer) => {
  expect(a.proof.reduce((x, p) => x + p.amount, 0)).toBe(a.figure);
  expect(a.ties).toBe(true);
  for (const p of a.proof) if (p.txnId) expect(s.transactions.some((t) => t.id === p.txnId && !t.deleted)).toBe(true);
};

describe('reading dates, parties and accounts', () => {
  it('parses ranges and dates relative to today', () => {
    expect(weekOf('2026-11-27')).toMatchObject({ from: '2026-11-23', to: '2026-11-29' });
    expect(parseRange('sales last week', today)).toMatchObject({ from: '2026-11-16', to: '2026-11-22' });
    expect(parseRange('in October', today)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(parseRange('this month', today)).toMatchObject({ from: '2026-11-01', to: '2026-11-27' });
    expect(parseRange('last month', today)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(parseRange('in December', today)).toMatchObject({ from: '2025-12-01' });
    expect(parseDate('as of yesterday', today)!.date).toBe('2026-11-26');
    expect(parseDate('as of Oct 31', today)!.date).toBe('2026-10-31');
    expect(parseDate('as of 10/31/2026', today)!.date).toBe('2026-10-31');
    expect(parseDate('as of end of October', today)!.date).toBe('2026-10-31');
    expect(parseDate('as of 2026-09-30', today)!.date).toBe('2026-09-30');
  });
  it('finds parties and accounts by partial names, numbers and aliases', () => {
    expect(findParty(s, 'Entergy')!.id).toBe('pt_entergy');
    expect(findParty(s, 'Dhunna')!.id).toBe('pt_dhunna');
    expect(findParty(s, 'Acme Widgets')).toBeNull();
    expect(findAccount(s, 'Trustmark')!.id).toBe('acct_trustmark');
    expect(findAccount(s, '1400')!.id).toBe('acct_prepaid');
    expect(findAccount(s, 'accounts payable')!.id).toBe('acct_ap');
    expect(findAccount(s, 'line of credit')!.id).toBe('acct_loc');
  });
});

describe('each pattern answers from the books with proof', () => {
  it('what did we pay <vendor> for <store> in <month>', () => {
    const a = ok(q('What did we pay Entergy for HM11 in October?'));
    proven(a);
    expect(a.intent).toBe('paid');
    const expected = s.transactions.filter((t) => !t.deleted && t.partyId === 'pt_entergy' && t.date.startsWith('2026-10'))
      .flatMap((t) => t.lines.filter((l) => l.accountId === 'acct_utilities' && l.storeId === 'st_hm11')).reduce((x, l) => x + l.debit, 0);
    expect(expected).toBeGreaterThan(0);
    expect(a.figure).toBe(expected);
    expect(a.proof).toHaveLength(1);
    expect(a.proof[0].description).toBe('ACH DEBIT ENTERGY MS HM11');
    // Paying a party whose payments sit at another store says so rather than inventing an amount.
    const d = ok(q('what did we pay Dhunna for HM11 in October'));
    expect(d.figure).toBe(0);
    expect(d.notes.join(' ')).toMatch(/charged to CORP \$41,000\.00/);
  });
  it('outstanding <supplier> invoices as of <date>', () => {
    const a = ok(q('Outstanding Craddock invoices as of yesterday'));
    proven(a);
    const open = (s.fuel.invoices).filter((i) => !i.deleted && i.supplier === 'craddock' && i.invoiceNo && i.deliveredOn <= '2026-11-26' && (!i.settlement || i.settlement.on > '2026-11-26'));
    expect(a.proof.map((p) => p.ref).sort()).toEqual(open.map((i) => i.invoiceNo).sort());
    expect(a.notes.join(' ')).toMatch(/BOL but no invoice/);
    const v = ok(q('outstanding Ice supplier (demo) bills as of today'));
    proven(v);
  });
  it('gallons sold this/last month at <store> including Comdata', () => {
    const a = ok(q('Gallons sold this month at HM15 including Comdata'));
    proven(a);
    const rows = salesRows(s, { storeIds: ['st_hm15'], from: '2026-11-01', to: today });
    expect(a.figure).toBe(rows.reduce((x, r) => x + r.gallons, 0));
    expect(a.unit).toBe('gallons');
    expect(a.proof.some((p) => p.description.includes('Comdata'))).toBe(true);
    const ex = ok(q('gallons sold last month at HM15 excluding Comdata'));
    expect(ex.figure).toBe(salesRows(s, { storeIds: ['st_hm15'], from: '2026-10-01', to: '2026-10-31' }).filter((r) => r.lane === 'store').reduce((x, r) => x + r.gallons, 0));
  });
  it('<account> balance as of <date>', () => {
    const a = ok(q('Trustmark balance as of Oct 31'));
    proven(a);
    expect(a.figure).toBe(balanceAsOf(s, 'acct_trustmark', '2026-10-31'));
    const p = ok(q('1400 balance as of end of October'));
    expect(p.figure).toBe(balanceAsOf(s, 'acct_prepaid', '2026-10-31'));
  });
  it('sales at <store> last week/month', () => {
    const a = ok(q('Sales at HM13 last week'));
    proven(a);
    expect(a.proof.every((p) => p.store === 'HM13' && p.date >= '2026-11-16' && p.date <= '2026-11-22')).toBe(true);
    expect(a.proof.length).toBeGreaterThanOrEqual(7); // a POS close every day
    ok(q('sales at HM11 last month'));
  });
  it('who owes us / intercompany balances', () => {
    const a = ok(q('Who owes us?'));
    proven(a);
    const sum = icSummary(s, today);
    expect(a.figure).toBe(sum.parties.filter((p) => p.balance > 0).reduce((x, p) => x + p.balance, 0));
    const ic = ok(q('intercompany balances'));
    proven(ic);
    expect(ic.figure).toBe([...sum.parties, ...sum.entities].reduce((x, p) => x + p.balance, 0));
  });
  it('bills due this week', () => {
    const a = ok(q('Bills due this week'));
    proven(a);
    const due = apState(s).bills.filter((b) => b.status !== 'paid' && b.status !== 'void' && b.dueDate >= '2026-11-23' && b.dueDate <= '2026-11-29');
    expect(a.figure).toBe(due.reduce((x, b) => x + billTotal(b), 0));
    ok(q('bills past due'));
  });
});

describe('never invents a number', () => {
  it('says what is missing and suggests a phrasing', () => {
    for (const text of ['what is the weather', 'What did we pay Acme Widgets in October', 'what did we pay Entergy', 'gallons sold in December at HM15', 'sales at HM17 in September', 'balance of the moon as of today']) {
      const r = q(text);
      expect(r.ok, text).toBe(false);
      if (!r.ok) {
        expect(r.reason.length).toBeGreaterThan(10);
        expect(r.missing.length).toBeGreaterThan(0);
        expect(r.suggestions.length).toBeGreaterThan(0);
        expect(answerText(r)).not.toMatch(/\$\d/);
      }
    }
    expect((q('sales at HM17 in September') as { reason: string }).reason).toMatch(/opened/);
  });
  it('refuses stores the person cannot see', () => {
    const r = q('Sales at HM13 last week', new Set(['st_hm11']));
    expect(r.ok).toBe(false);
    const w = q('Who owes us?', new Set(['st_hm11']));
    expect(w.ok).toBe(false);
  });
  it('copies as text and exports CSV with a total equal to the answer', () => {
    const a = ok(q('Bills due this week'));
    const csv = answerCsv(a);
    expect(csv.rows.at(-1)!.at(-1)).toBe((a.figure / 100).toFixed(2));
    expect(answerText(a)).toContain(a.headline);
    expect(looksLikeQuestion('What did we pay Entergy?')).toBe(true);
    expect(looksLikeQuestion('HM11')).toBe(false);
  });
});
