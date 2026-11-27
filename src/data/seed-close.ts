import type { SeedCtx } from './seed';
import { addVarianceComment, varianceCells, type VarianceCell } from '../core/budgets';
import { acknowledgeBalance, COMPANY, intercompanyAgreement, setCloseStep } from '../core/close';
import { basisEntries } from '../core/statements';

/** A plain-English reason for a demo variance (illustrative). */
function why(c: VarianceCell): string {
  const up = c.variance > 0;
  const a = c.account;
  if (a.id === 'acct_repairs') return 'Dispenser board replaced after the storm; the budget only allowed for routine work.';
  if (a.id === 'acct_utilities') return 'New electric rate from October; budget was set on the old rate.';
  if (a.id === 'acct_professional') return 'Year-end tax planning with the CPA started early; timing, not extra cost.';
  if (a.id === 'acct_sales_kitchen') return up ? 'Football weekends lifted plate sales.' : 'The catering push in the plan hasn\'t started; plate sales are steady.';
  if (a.id === 'acct_cogs_fuel') return up ? 'More gallons and a higher delivered cost than planned.' : 'Fewer loads in the month; cost follows gallons sold.';
  if (a.lob === 'fuel' && a.type === 'revenue') return up ? 'Street price and gallons both above plan.' : 'Truck lane volume growth planned from October hasn\'t arrived yet.';
  if (a.type === 'revenue') return up ? 'Busier than plan; promotions ran well.' : 'Traffic below plan for the month.';
  if (a.type === 'cogs') return up ? 'Purchases timed ahead of a promotion.' : 'Fewer deliveries in the month; timing.';
  return up ? 'One-off cost in the month; reviewed with the store manager.' : 'Spend came in under plan; timing.';
}

/**
 * Phase 8 demo close: September closed (every step done, then locked by the core demo); October in progress with
 * some steps done and one blocked; November not started.
 */
export function seedClose(ctx: SeedCtx): void {
  const { books, cfo, setClock, state } = ctx;
  const bk = state.users.find((u) => u.role === 'bookkeeper') ?? cfo;
  const entries = basisEntries(state);
  const ops = state.stores.filter((s) => s.kind === 'operating' && (!s.openedOn || s.openedOn <= '2026-09-30')).map((s) => s.id);

  // ── September: everything done.
  setClock('2026-10-06');
  for (const c of varianceCells(state, { from: '2026-09', to: '2026-09', storeIds: state.stores.map((s) => s.id), entries }).filter((x) => x.over)) {
    addVarianceComment(books, cfo, { period: c.period, storeId: c.storeId, accountId: c.account.id, text: why(c) });
  }
  for (const r of intercompanyAgreement(state, '2026-09').rows) acknowledgeBalance(books, cfo, { period: '2026-09', counterpartyId: r.id, note: 'Statement sent; balance confirmed by email.' });
  setClock('2026-10-07');
  setCloseStep(books, bk, { period: '2026-09', storeId: COMPANY, step: 'accruals', status: 'done', note: 'Utilities and payroll accrued for the last week of September (JE in the binder).' });
  for (const s of ops) setCloseStep(books, bk, { period: '2026-09', storeId: s, step: 'inventory', status: 'done', note: 'Month-end inside and kitchen count sheets signed by the store manager.' });

  // ── October: in progress.
  setClock('2026-11-06');
  const oct = varianceCells(state, { from: '2026-10', to: '2026-10', storeIds: state.stores.map((s) => s.id), entries }).filter((x) => x.over);
  oct.forEach((c, i) => { if (i % 2 === 0) addVarianceComment(books, cfo, { period: c.period, storeId: c.storeId, accountId: c.account.id, text: why(c) }); });
  intercompanyAgreement(state, '2026-10').rows.slice(0, 2).forEach((r) => acknowledgeBalance(books, cfo, { period: '2026-10', counterpartyId: r.id, note: 'Confirmed on the monthly call.' }));
  setCloseStep(books, bk, { period: '2026-10', storeId: COMPANY, step: 'accruals', status: 'in_progress', note: 'Payroll accrual drafted; waiting on the Entergy bills for HM13.' });
  const octOps = state.stores.filter((s) => s.kind === 'operating' && (!s.openedOn || s.openedOn <= '2026-10-31')).map((s) => s.id);
  for (const s of octOps) {
    if (s === 'st_hm15') setCloseStep(books, bk, { period: '2026-10', storeId: s, step: 'inventory', status: 'blocked', note: 'Kitchen count sheet missing; asked the HM15 manager to recount.' });
    else setCloseStep(books, bk, { period: '2026-10', storeId: s, step: 'inventory', status: 'done', note: 'Count sheets received and checked.' });
  }
}
