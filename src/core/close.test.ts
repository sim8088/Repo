import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, CFO_ID } from '../data/seed';
import {
  acknowledgeBalance, addCloseEvidence, applies, businessDaysAfter, closeChecklist, closeInbox, closeOf, COMPANY, dueDate, intercompanyAgreement, lockMonth,
  proveStep, registerCloseEvidence, setCloseStep, setStepConfig, STEPS, unlockMonth,
} from './close';
import { addVarianceComment, uncommentedVariances } from './budgets';
import { binderCsvs, binderHtml, binderZip, closeBinder } from './binder';
import { unzip } from './xlsx';
import { PermissionError } from './permissions';
import { generateRent } from './intercompany';
import type { BooksState, User } from './types';

const TODAY = '2026-11-27';
const user = (s: BooksState, role: User['role']) => s.users.find((u) => u.role === role)!;
function setup() {
  const s = buildDemo();
  const b = new Books(s, () => `${TODAY}T12:00:00.000Z`);
  return { s, b, cfo: s.users.find((u) => u.id === CFO_ID)! };
}
let shared: BooksState | null = null;
const demo = () => (shared ??= buildDemo());

/** Finish every open October step the way the CFO would on the checklist. */
function finishOctober(s: BooksState, b: Books, cfo: User) {
  for (const r of intercompanyAgreement(s, '2026-10').rows) if (!r.agreed) acknowledgeBalance(b, cfo, { period: '2026-10', counterpartyId: r.id });
  for (const c of uncommentedVariances(s, { storeIds: s.stores.map((x) => x.id), today: TODAY })) addVarianceComment(b, cfo, { period: c.period, storeId: c.storeId, accountId: c.account.id, text: 'Reviewed.' });
  setCloseStep(b, cfo, { period: '2026-10', storeId: COMPANY, step: 'accruals', status: 'done' });
  setCloseStep(b, cfo, { period: '2026-10', storeId: 'st_hm15', step: 'inventory', status: 'done', note: 'Recounted.' });
}

describe('checklist and auto-evidence on the demo', () => {
  it('has the twelve SPEC steps in order; company steps sit in the Company column', () => {
    expect(STEPS.map((x) => x.label)).toEqual(['Sales posted', 'Fuel invoices tied to settlement', 'Card fees posted', 'Bank reconciled', 'Cash chain balanced', 'Payroll posted', 'Intercompany agreed', 'Accruals booked', 'Inventory counted', 'Rent pass-throughs', 'Review P&L variances', 'Lock']);
    const s = demo();
    expect(applies(s, 'bank', COMPANY, '2026-10')).toBe(true);
    expect(applies(s, 'bank', 'st_hm11', '2026-10')).toBe(false);
    expect(applies(s, 'sales', 'st_hm17', '2026-10')).toBe(false); // opened in November
    expect(applies(s, 'sales', 'st_hm17', '2026-11')).toBe(true);
    expect(applies(s, 'fuel_invoices', 'st_hm14', '2026-10')).toBe(false);
    expect(applies(s, 'payroll', 'st_corp', '2026-10')).toBe(true);
    expect(applies(s, 'rent', 'st_hm11', '2026-10')).toBe(true);
    expect(applies(s, 'rent', 'st_hm17', '2026-11')).toBe(false);
  });

  it('September: closed, every step done (proved or recorded) and locked', () => {
    const s = demo();
    const cl = closeChecklist(s, '2026-09', { today: TODAY });
    expect(cl.locked).toBe(true);
    expect(cl.ready).toBe(true);
    expect(cl.counts.done).toBe(cl.rows.flatMap((r) => r.cells).filter((c) => c.status !== 'na').length);
    const bank = cl.rows.find((r) => r.def.key === 'bank')!.cells[0];
    expect(bank.auto).toBe(true);
    expect(bank.proof!.evidence.join()).toMatch(/reconciled through Oct 31, 2026/);
    const sales = cl.rows.find((r) => r.def.key === 'sales')!.cells.find((c) => c.storeId === 'st_hm11')!;
    expect(sales.proof!.evidence[0]).toBe('30 of 30 days have a POS daily close.');
    const pay = proveStep(s, 'payroll', 'st_hm13', '2026-09')!;
    expect(pay.ok && pay.evidence[0]).toMatch(/4 of 4 Gusto runs posted/);
    expect(proveStep(s, 'payroll', 'st_hm11', '2026-09')!.evidence[0]).toMatch(/cash payroll posted to 6100/);
    expect(proveStep(s, 'card_fees', 'st_hm11', '2026-09')!.evidence[0]).toMatch(/4 of 4 notices posted/);
    expect(proveStep(s, 'card_fees', 'st_hm15', '2026-09')!.evidence[0]).toMatch(/Dash statement/);
    expect(proveStep(s, 'rent', 'st_hm13', '2026-09')!.ok).toBe(true);
    expect(proveStep(s, 'intercompany', COMPANY, '2026-09')!.ok).toBe(true);
    expect(proveStep(s, 'variances', 'st_hm11', '2026-09')!.ok).toBe(true);
    expect(proveStep(s, 'accruals', COMPANY, '2026-09')).toBeNull(); // manual
  });

  it('October: in progress, with steps done, one blocked, and the gaps the data shows', () => {
    const s = demo();
    const cl = closeChecklist(s, '2026-10', { today: TODAY });
    expect(cl.locked).toBe(false);
    expect(cl.ready).toBe(false);
    expect(cl.counts.blocked).toBe(1);
    expect(cl.counts.done).toBeGreaterThan(15);
    const keys = new Set(cl.open.map((c) => c.step));
    expect([...keys].sort()).toEqual(['accruals', 'intercompany', 'inventory', 'variances']);
    expect(cl.open.every((c) => c.overdue)).toBe(true); // due early November
    const ic = cl.open.find((c) => c.step === 'intercompany')!;
    expect(ic.proof!.missing.join()).toMatch(/not agreed yet/);
    expect(cl.rows.find((r) => r.def.key === 'bank')!.cells[0].status).toBe('done');
  });

  it('November: not started, and the data shows what is missing (unposted notice, imported run, no reconciliation)', () => {
    const s = demo();
    const cl = closeChecklist(s, '2026-11', { today: TODAY });
    expect(Object.values(closeOf(s).items).some((i) => i.period === '2026-11')).toBe(false);
    expect(proveStep(s, 'card_fees', 'st_hm13', '2026-11')!.missing.join()).toMatch(/not posted/);
    expect(proveStep(s, 'payroll', 'st_hm15', '2026-11')!.missing.join()).toMatch(/imported but not posted/);
    expect(proveStep(s, 'bank', COMPANY, '2026-11')!.ok).toBe(false);
    expect(proveStep(s, 'fuel_invoices', 'st_hm11', '2026-11')!.missing.join()).toMatch(/no invoice/);
    expect(cl.ready).toBe(false);
  });

  it('a proof follows the data: generating rent turns the step done', () => {
    const { s, b, cfo } = setup();
    expect(proveStep(s, 'rent', 'st_hm11', '2026-12', undefined)!.ok).toBe(false);
    s.periods['2026-12'] = { id: '2026-12', status: 'open' };
    generateRent(b, cfo, '2026-12');
    expect(proveStep(s, 'rent', 'st_hm11', '2026-12')!.ok).toBe(true);
  });

  it('owners and due dates: business days after month end, configurable', () => {
    const { s, b, cfo } = setup();
    expect(businessDaysAfter('2026-10-31', 5)).toBe('2026-11-06');
    expect(businessDaysAfter('2026-11-30', 1)).toBe('2026-12-01');
    expect(dueDate(s, '2026-10', 'bank')).toBe('2026-11-06');
    setStepConfig(b, cfo, 'bank', { ownerId: CFO_ID, dueDays: 2 });
    expect(dueDate(s, '2026-10', 'bank')).toBe('2026-11-03');
    expect(() => setStepConfig(b, cfo, 'bank', { dueDays: 45 })).toThrow(ValidationError);
    expect(() => setStepConfig(b, user(s, 'owner'), 'bank', { dueDays: 2 })).toThrow(PermissionError);
  });

  it('the inventory hook lets phase 7 prove the step', () => {
    const s = demo();
    registerCloseEvidence('inventory', (_st, storeId) => ({ ok: storeId === 'st_hm11', evidence: ['Count entered.'], missing: [], to: '/inside/counts' }));
    try {
      expect(proveStep(s, 'inventory', 'st_hm11', '2026-11')!.ok).toBe(true);
      expect(closeChecklist(s, '2026-11', { today: TODAY }).rows.find((r) => r.def.key === 'inventory')!.cells.find((c) => c.storeId === 'st_hm11')!.status).toBe('done');
    } finally { registerCloseEvidence('inventory', null); }
    expect(proveStep(s, 'inventory', 'st_hm11', '2026-11')).toBeNull();
  });
});

describe('working steps', () => {
  it('manual steps take any status; proved steps can\'t be marked done by hand; blocked needs a note; evidence attaches', () => {
    const { s, b, cfo } = setup();
    setCloseStep(b, cfo, { period: '2026-10', storeId: COMPANY, step: 'accruals', status: 'done', note: 'JE posted.' });
    expect(closeChecklist(s, '2026-10', { today: TODAY }).rows.find((r) => r.def.key === 'accruals')!.cells[0].status).toBe('done');
    expect(() => setCloseStep(b, cfo, { period: '2026-10', storeId: COMPANY, step: 'intercompany', status: 'done' })).toThrow(/doesn't show this yet/);
    expect(() => setCloseStep(b, cfo, { period: '2026-11', storeId: 'st_hm11', step: 'inventory', status: 'blocked' })).toThrow(/Say what the step is waiting on/);
    setCloseStep(b, cfo, { period: '2026-10', storeId: COMPANY, step: 'intercompany', status: 'blocked', note: 'Waiting on Cheers.' });
    expect(closeChecklist(s, '2026-10', { today: TODAY }).rows.find((r) => r.def.key === 'intercompany')!.cells[0].status).toBe('blocked');
    expect(() => setCloseStep(b, cfo, { period: '2026-10', storeId: 'st_hm11', step: 'bank', status: 'in_progress' })).toThrow(/doesn't apply/);
    expect(() => setCloseStep(b, cfo, { period: '2026-10', storeId: COMPANY, step: 'lock', status: 'done' })).toThrow(/Lock button/);
    addCloseEvidence(b, cfo, { period: '2026-10', storeId: COMPANY, step: 'accruals', attachment: { id: 'att_x', name: 'accruals.pdf', mime: 'application/pdf', size: 10, addedAt: `${TODAY}T12:00:00.000Z`, addedBy: CFO_ID } });
    expect(closeOf(s).items['2026-10|*|accruals'].attachments).toHaveLength(1);
    expect(s.audit.some((a) => a.objectType === 'close' && a.action === 'attach')).toBe(true);
  });

  it('permissions: bookkeeper works steps; owner and outside accountant read only; a locked month refuses changes', () => {
    const { s, b } = setup();
    setCloseStep(b, user(s, 'bookkeeper'), { period: '2026-10', storeId: 'st_hm13', step: 'inventory', status: 'in_progress' });
    for (const r of ['owner', 'reviewer', 'store_manager'] as const) {
      expect(() => setCloseStep(b, user(s, r), { period: '2026-10', storeId: 'st_hm13', step: 'inventory', status: 'done' })).toThrow(PermissionError);
    }
    expect(() => acknowledgeBalance(b, user(s, 'owner'), { period: '2026-10', counterpartyId: 'pt_cheers' })).toThrow(PermissionError);
    expect(() => setCloseStep(b, user(s, 'bookkeeper'), { period: '2026-09', storeId: COMPANY, step: 'accruals', status: 'in_progress' })).toThrow(/locked/);
  });

  it('intercompany agreement records the balance; a later change un-agrees it', () => {
    const { s, b, cfo } = setup();
    acknowledgeBalance(b, cfo, { period: '2026-10', counterpartyId: 'pt_cheers', note: 'Confirmed.' });
    const row = intercompanyAgreement(s, '2026-10').rows.find((r) => r.id === 'pt_cheers')!;
    expect(row.agreed).toBe(true);
    closeOf(s).acks.at(-1)!.balance += 100;
    expect(intercompanyAgreement(s, '2026-10').rows.find((r) => r.id === 'pt_cheers')!.agreed).toBe(false);
    expect(() => acknowledgeBalance(b, cfo, { period: '2026-10', counterpartyId: 'pt_owner_a' })).toThrow(/no balance/);
  });
});

describe('the lock gate', () => {
  it('refuses while steps are open; opens when every step is done; locks through the period lock; unlock needs a reason', () => {
    const { s, b, cfo } = setup();
    expect(() => lockMonth(b, cfo, '2026-10', { today: TODAY })).toThrow(/still open/);
    expect(() => lockMonth(b, user(s, 'bookkeeper'), '2026-10', { today: TODAY })).toThrow(PermissionError);
    finishOctober(s, b, cfo);
    const cl = closeChecklist(s, '2026-10', { today: TODAY });
    expect(cl.open).toEqual([]);
    expect(cl.ready).toBe(true);
    expect(cl.rows.find((r) => r.def.key === 'lock')!.cells[0].status).toBe('in_progress');
    lockMonth(b, cfo, '2026-10', { today: TODAY });
    expect(s.periods['2026-10'].status).toBe('locked');
    expect(closeOf(s).overrides['2026-10']).toBeUndefined();
    expect(closeChecklist(s, '2026-10', { today: TODAY }).rows.find((r) => r.def.key === 'lock')!.cells[0].status).toBe('done');
    expect(() => unlockMonth(b, cfo, '2026-10', ' ')).toThrow(/reason/);
    unlockMonth(b, cfo, '2026-10', 'Late utility bill');
    expect(s.periods['2026-10'].status).toBe('open');
    expect(s.audit.at(-1)!.reason).toBe('Late utility bill');
  });

  it('the CFO can override with a reason, which is kept with the open steps; a month that is not over cannot lock', () => {
    const { s, b, cfo } = setup();
    expect(() => lockMonth(b, cfo, '2026-10', { today: TODAY, override: '  ' })).toThrow(/override with a reason/);
    lockMonth(b, cfo, '2026-10', { today: TODAY, override: 'Board pack due' });
    expect(s.periods['2026-10'].status).toBe('locked');
    const o = closeOf(s).overrides['2026-10'];
    expect(o.reason).toBe('Board pack due');
    expect(o.open.length).toBeGreaterThan(3);
    expect(s.audit.some((a) => a.objectType === 'close' && a.action === 'override' && a.reason === 'Board pack due')).toBe(true);
    expect(() => lockMonth(b, cfo, '2026-11', { today: TODAY, override: 'x' })).toThrow(/isn't over yet/);
  });

  it('inbox: overdue steps and months past their lock date; both clear once October is locked', () => {
    const { s, b, cfo } = setup();
    const ib = closeInbox(s, { today: TODAY });
    expect(ib.pastDue).toEqual(['2026-10']);
    expect(ib.overdue.length).toBeGreaterThan(3);
    finishOctober(s, b, cfo);
    lockMonth(b, cfo, '2026-10', { today: TODAY });
    const after = closeInbox(s, { today: TODAY });
    expect(after.pastDue).toEqual([]);
    expect(after.overdue).toEqual([]);
  });
});

describe('close binder', () => {
  it('holds the statements on both bases, the bank reconciliation, the checklist, schedules and a document index; every tie-out holds for September', () => {
    const s = demo();
    const bd = closeBinder(s, '2026-09', { today: TODAY });
    expect(bd.sections.map((x) => x.key)).toEqual(['checklist', 'pnl', 'bs', 'cf', 'bank', 'bva', 'schedules', 'docs']);
    expect(bd.locked).toBe(true);
    const failing = bd.sections.flatMap((x) => x.ties.filter((t) => !t.ok).map((t) => `${x.key}: ${t.label}`));
    expect(failing).toEqual([]);
    const files = binderCsvs(bd).map((f) => f.name);
    for (const f of ['checklist.csv', 'pnl-accrual.csv', 'pnl-cash.csv', 'bridge.csv', 'balance-sheet.csv', 'cash-flow.csv', 'budget-vs-actual.csv', 'ap-aging.csv', 'intercompany.csv', 'fuel.csv', 'fixed-assets.csv', 'documents.csv']) expect(files).toContain(f);
    expect(bd.documents).toBeGreaterThan(0);
    const html = binderHtml(s, bd);
    expect(html).toMatch(/^<!doctype html><html lang="en">/);
    expect(html).toContain('Close binder — September 2026');
    expect(html).toContain('Bank reconciliation');
    expect(html).toContain('Accrual basis by store');
    expect(html).toContain('Cash basis by store');
    const z = unzip(binderZip(bd));
    expect([...z.keys()].sort()).toEqual([...files].sort());
    const pnl = new TextDecoder().decode(z.get('pnl-accrual.csv')!);
    expect(pnl.split('\n')[0]).toMatch(/^Line,HM11,HM13,HM15/);
    expect(pnl).toMatch(/\nNet profit,/);
  });
});
