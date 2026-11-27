import { describe, expect, it } from 'vitest';
import { Books } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import { amortization, levelPayment, loanAccountTie, loanStatus, loansOf, passThroughCover, postLoanOpening, postLoanPayment, recordDraw, saveLoan, type LoanDraft } from './loans';
import { trialBalance } from './reports';
import { partyLedger } from './intercompany';

const setup = () => {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  const cfo = s.users.find((x) => x.id === CFO_ID)!;
  b.createTransaction(cfo, { date: '2026-08-31', kind: 'opening', description: 'Opening', lines: [
    { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 10_000_000, credit: 0 }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: 0, credit: 10_000_000 }] });
  return { s, b, cfo };
};
const note = (over: Partial<LoanDraft> = {}): LoanDraft => ({
  name: 'Equipment note', kind: 'equipment_note', lender: 'Lender', lenderPartyId: 'pt_trustmark', heldBy: 'company', storeId: 'st_hm15', liabilityAccountId: 'acct_notes_equipment',
  interestAccountId: 'acct_interest', payFromAccountId: 'acct_trustmark', original: 1_200_000, rateBps: 600, rateType: 'fixed', termMonths: 12, amortizationMonths: 12,
  payment: levelPayment(1_200_000, 600, 12), start: '2026-08-01', firstPayment: '2026-09-01', maturity: '2027-08-01', collateral: 'Equipment', guarantor: 'Owners', prepaymentPenalty: 'None', covenants: [], ...over,
});

describe('amortization table', () => {
  it('splits each payment into interest (balance × rate ÷ 12) and principal; principal sums to the original; payoff at maturity', () => {
    const l = { ...note(), id: 'x', payments: {}, draws: [], attachments: [] };
    const rows = amortization(l);
    expect(l.payment).toBe(103_280);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ opening: 1_200_000, interest: 6_000, principal: 103_280 - 6_000 });
    expect(rows.reduce((a, r) => a + r.principal, 0)).toBe(1_200_000);
    expect(rows.reduce((a, r) => a + r.payment, 0)).toBe(rows.reduce((a, r) => a + r.principal + r.interest, 0));
    expect(rows.at(-1)!.closing).toBe(0);
    expect(rows.at(-1)!.date).toBe('2027-08-01');
    for (const r of rows) expect(r.opening - r.principal).toBe(r.closing);
  });
  it('a term shorter than the amortization ends in a balloon', () => {
    const l = { ...note({ termMonths: 6, amortizationMonths: 12, maturity: '2027-02-01' }), id: 'x', payments: {}, draws: [], attachments: [] };
    const rows = amortization(l);
    expect(rows).toHaveLength(6);
    expect(rows.at(-1)!.balloon).toBe(true);
    expect(rows.at(-1)!.closing).toBe(0);
    expect(rows.reduce((a, r) => a + r.principal, 0)).toBe(1_200_000);
  });
});

describe('posting payments', () => {
  it('posts principal to the loan account and interest to 6500 from Trustmark, once per due date, and ties to the ledger', () => {
    const { s, b, cfo } = setup();
    const loan = saveLoan(b, cfo, note());
    const op = postLoanOpening(b, cfo, loan.id, { date: '2026-08-31' });
    expect(op.lines.find((l) => l.accountId === 'acct_notes_equipment')!.credit).toBe(1_200_000);
    const t = postLoanPayment(b, cfo, loan.id, '2026-09-01');
    const row = amortization(loan)[0];
    expect(t.lines.find((l) => l.accountId === 'acct_notes_equipment')!.debit).toBe(row.principal);
    expect(t.lines.find((l) => l.accountId === 'acct_interest')!.debit).toBe(row.interest);
    expect(t.lines.find((l) => l.accountId === 'acct_trustmark')!.credit).toBe(row.payment);
    expect(() => postLoanPayment(b, cfo, loan.id, '2026-09-01')).toThrow(/already posted/);
    expect(() => postLoanPayment(b, cfo, loan.id, '2026-09-02')).toThrow(/No payment is due/);
    let st = loanStatus(s, loan, '2026-10-15');
    expect(st.unposted.map((r) => r.date)).toEqual(['2026-10-01']);
    expect(st.ties).toBe(false);
    postLoanPayment(b, cfo, loan.id, '2026-10-01');
    st = loanStatus(s, loan, '2026-10-15');
    expect(st.ties).toBe(true);
    expect(st.ledgerBalance).toBe(amortization(loan)[1].closing);
    expect(trialBalance(s, { asOf: '2026-11-30' }).difference).toBe(0);
    expect(partyLedger(s, 'pt_trustmark', { to: '2026-11-30' }).balance).toBe(-st.ledgerBalance!);
  });
  it('a line of credit charges interest on the daily balance and ties after draws and paydowns', () => {
    const { s, b, cfo } = setup();
    const loc = saveLoan(b, cfo, note({ name: 'LOC', kind: 'line_of_credit', liabilityAccountId: 'acct_loc', storeId: 'st_corp', interestOnly: true, payment: 0, original: 5_000_000, creditLimit: 5_000_000, rateBps: 730, rateType: 'variable', index: 'Prime', firstPayment: '2026-09-25', start: '2026-08-31', maturity: '2027-06-30', booksFrom: '2026-09-01' }));
    recordDraw(b, cfo, loc.id, { date: '2026-09-05', amount: 3_650_000 });
    expect(() => recordDraw(b, cfo, loc.id, { date: '2026-09-06', amount: 2_000_000 })).toThrow(/limit/);
    const r = amortization(loc)[0];
    expect(r.interest).toBe(Math.round(3_650_000 * 0.073 / 365 * 21)); // 5 Sep – 25 Sep: interest from the day of the draw
    postLoanPayment(b, cfo, loc.id, '2026-09-25');
    recordDraw(b, cfo, loc.id, { date: '2026-10-10', amount: -1_650_000 });
    expect(loanStatus(s, loc, '2026-10-20')).toMatchObject({ scheduleBalance: 2_000_000, ledgerBalance: 2_000_000, ties: true });
    expect(amortization(loc).at(-1)!.principal).toBe(2_000_000);
  });
});

describe('demo loans', () => {
  const s = buildDemo();
  it('company loans tie to their liability accounts; related-party mortgages stay off the books and are covered by the rent', () => {
    const today = '2026-11-27';
    for (const t of loanAccountTie(s, today)) expect(t.ledger).toBe(t.loans);
    expect(loanAccountTie(s, today).find((t) => t.accountId === 'acct_mortgages')!.ledger).toBe(0);
    const loans = loansOf(s);
    expect(loans.filter((l) => l.heldBy === 'company').map((l) => l.name).sort()).toEqual(['Corporate line of credit', 'HM15 truck-lane equipment note']);
    for (const l of loans) {
      const st = loanStatus(s, l, today);
      expect(st.unposted).toEqual([]);
      if (l.heldBy === 'company') expect(st.ties).toBe(true);
      else {
        expect(st.ledgerBalance).toBeNull();
        expect(passThroughCover(s, l, today)!.covered).toBe(true);
        expect(() => postLoanPayment(new Books(s), s.users[0], l.id, st.next!.date)).toThrow(/nothing posts/);
      }
    }
    const note = loans.find((l) => l.kind === 'equipment_note')!;
    expect(Object.keys(note.payments).sort()).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
  });
});
