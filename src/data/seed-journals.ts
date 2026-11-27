import type { SeedCtx } from './seed';
import type { Attachment, ID, User } from '../core/types';
import { approveJournal, createJournal, fromTemplate, generateRecurring, postReversals, saveRecurring, template } from '../core/journals';
import { payrollAccrual, prepareRecon, reconRow, reviewRecon, setManualSupport } from '../core/recons';

const c = (dollars: number) => Math.round(dollars * 100);

/**
 * Phase 10 demo: a recurring interest accrual (September and October generated, November due),
 * an intercompany management fee, reversing accruals at 31 October (utilities from a template,
 * payroll as a multi-store manual entry, fuel received not invoiced approved over the limit),
 * one entry waiting for approval, and October account reconciliations:
 * most signed off, sales tax waiting for review, prepaid expenses with an explained difference.
 */
export function seedJournals({ state, books, cfo, setClock }: SeedCtx): void {
  const bk = state.users.find((u) => u.role === 'bookkeeper') as User;
  const owner = state.users.find((u) => u.role === 'owner') as User;
  const corp = 'st_corp';

  // Recurring: interest on the related-party mortgage reimbursement, accrued monthly on the 25th.
  setClock('2026-09-02');
  const interest = template('accr_interest')!;
  const rec = saveRecurring(books, cfo, {
    name: 'Monthly interest accrual', description: 'Accrued interest – related-party mortgages', memo: 'Interest on the store mortgages Dhunna / SKD pay, per their monthly statements; settled when reimbursed.',
    templateKey: interest.key, adjusting: true, autoReverse: false, frequency: 'monthly', day: 25, start: '2026-09', end: '2027-08',
    lines: fromTemplate(state, interest.key, { date: '2026-09-25', stores: [corp], amounts: [c(850)] }).lines,
  });
  setClock('2026-09-25');
  generateRecurring(books, cfo, '2026-09-30', [rec.id]);
  setClock('2026-10-25');
  generateRecurring(books, cfo, '2026-10-31', [rec.id]);

  // Intercompany management fee: Corporate charges three stores for shared services.
  setClock('2026-10-15');
  for (const s of ['st_hm11', 'st_hm13', 'st_hm15']) createJournal(books, cfo, fromTemplate(state, 'ic_mgmt_fee', { date: '2026-10-15', stores: [s], amounts: [c(1_500)] }));

  // Month-end accruals, prepared by the bookkeeper on 3 Nov, dated 31 Oct.
  setClock('2026-11-03');
  createJournal(books, bk, fromTemplate(state, 'accr_utilities', { date: '2026-10-31', stores: ['st_hm11'], amounts: [c(1_380)], memo: 'October power at HM11: meter read 29 Oct, bill arrives mid-November. Estimated from September. Reverses 1 Nov.' }));
  const acc = payrollAccrual(state, '2026-10-31');
  if (acc.length) {
    createJournal(books, bk, {
      date: '2026-10-31', description: 'Accrued payroll – all stores · 2026-10', adjusting: true, reverseOn: '2026-11-01', templateKey: 'accr_payroll',
      memo: `Saturday 31 Oct is day ${acc[0].days} of the pay week paid ${acc[0].week}: ${acc[0].days}/7 of that week's net pay and taxes, by store. Reverses 1 Nov.`,
      lines: acc.flatMap((r) => [
        { accountId: 'acct_wages', storeId: r.storeId, debit: r.wages, credit: 0 },
        { accountId: 'acct_accrued_payroll', storeId: r.storeId, debit: 0, credit: r.wages },
        ...(r.taxes ? [{ accountId: 'acct_payroll_taxes', storeId: r.storeId, debit: r.taxes, credit: 0 }, { accountId: 'acct_payroll_tax', storeId: r.storeId, debit: 0, credit: r.taxes }] : []),
      ]),
    });
  }
  const rni = createJournal(books, bk, fromTemplate(state, 'accr_fuel_rni', { date: '2026-10-31', stores: ['st_hm15'], amounts: [c(18_600)], memo: 'Dash transport delivered 30 Oct (BOL on file); invoice not received by month end. Reverses 1 Nov.' }));
  setClock('2026-11-04');
  approveJournal(books, owner, rni.id, 'BOL checked against the tank readings.');

  // The reversals post on 1 November.
  setClock('2026-11-04');
  postReversals(books, cfo, '2026-11-01');

  // Waiting for approval: over the limit, prepared by the bookkeeper.
  setClock('2026-11-25');
  createJournal(books, bk, fromTemplate(state, 'accr_fuel_rni', { date: '2026-11-24', stores: ['st_hm17'], amounts: [c(21_500)], memo: 'Dash transport delivered 24 Nov to HM17 (BOL on file); invoice not received yet. Reverses 1 Dec.' }));

  // October account reconciliations.
  setClock('2026-11-06');
  const att = (name: string, by: ID): Attachment[] => [{ id: books.nextId('att'), name, mime: 'application/pdf', size: 52_000, addedAt: '2026-11-06T15:00:00.000Z', addedBy: by }];
  const gl = (id: ID) => reconRow(state, id, '2026-10')!.gl;
  setManualSupport(books, bk, 'acct_accrued_exp', '2026-10', { amount: gl('acct_accrued_exp'), note: 'Interest statements (Sep, Oct) + HM11 utility estimate', attachments: att('Accrued expenses support Oct 2026 (demo).pdf', bk.id) });
  setManualSupport(books, bk, 'acct_fuel_rni', '2026-10', { amount: gl('acct_fuel_rni'), note: 'HM15 BOL 30 Oct, invoice not received', attachments: att('HM15 BOL 30 Oct (demo).pdf', bk.id) });
  setManualSupport(books, bk, 'acct_sales_tax', '2026-10', { amount: gl('acct_sales_tax'), note: 'October sales tax worksheet (state return)', attachments: att('Sales tax worksheet Oct 2026 (demo).pdf', bk.id) });
  setManualSupport(books, bk, 'acct_prepaid', '2026-10', { amount: gl('acct_prepaid') - c(1_450), note: 'Prepaid schedule: insurance and licenses after October amortization', attachments: att('Prepaid schedule Oct 2026 (demo).pdf', bk.id) });
  const signed = ['acct_craddock', 'acct_dash', 'acct_due_from', 'acct_due_to', 'acct_loans_related', 'acct_paid_for_related', 'acct_due_related', 'acct_ap', 'acct_accrued_payroll', 'acct_payroll_tax', 'acct_accrued_exp', 'acct_fuel_rni'];
  for (const id of signed) {
    const r = reconRow(state, id, '2026-10')!;
    if (r.support.amount === null) continue;
    prepareRecon(books, bk, id, '2026-10', r.difference ? 'Difference carried to November; see the notes.' : undefined);
  }
  prepareRecon(books, bk, 'acct_sales_tax', '2026-10');
  prepareRecon(books, bk, 'acct_prepaid', '2026-10', 'October insurance and license amortization ($1,450) not booked yet: the Phase 9 prepaid schedules will post it. Book by hand if close comes first.');
  setClock('2026-11-09');
  for (const id of signed) if (reconRow(state, id, '2026-10')?.status === 'prepared') reviewRecon(books, cfo, id, '2026-10');
}
