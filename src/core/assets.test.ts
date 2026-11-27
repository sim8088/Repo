import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import {
  assetStatus, assetTie, assetsOf, depreciationSchedule, disposeAsset, logMaintenance, maintenanceDue, maintenanceTie, monthlyDepreciation, postDepreciation,
  saveAsset, scheduledAccum, unpostedDepreciation, type AssetDraft,
} from './assets';
import { balanceAsOf, trialBalance } from './reports';
import { storeBalance } from './fuel';
import { PermissionError } from './permissions';
import type { User } from './types';

const setup = () => {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  const cfo = s.users.find((x) => x.id === CFO_ID)!;
  const u = (role: User['role']) => s.users.find((x) => x.role === role)!;
  b.createTransaction(cfo, { date: '2026-08-31', kind: 'opening', description: 'Opening', lines: [
    { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 10_000_000, credit: 0 }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: 0, credit: 10_000_000 }] });
  return { s, b, cfo, u };
};
const cooler = (over: Partial<AssetDraft> = {}): AssetDraft => ({
  name: 'Walk-in cooler', class: 'coolers', storeId: 'st_hm11', costAccountId: 'acct_equipment', cost: 1_000_000, salvage: 100_000, inService: '2026-09-15', lifeMonths: 7, method: 'straight_line', ...over,
});

describe('book depreciation', () => {
  it('is straight line from the in-service month, cents exact, and stops at cost less salvage', () => {
    const { b, cfo } = setup();
    const a = saveAsset(b, cfo, cooler());
    const sched = depreciationSchedule(a);
    expect(sched).toHaveLength(7);
    expect(sched[0].period).toBe('2026-09');
    expect(sched.map((r) => r.depreciation)).toEqual([128_571, 128_572, 128_571, 128_572, 128_571, 128_572, 128_571]);
    expect(sched.reduce((x, r) => x + r.depreciation, 0)).toBe(900_000);
    expect(sched.at(-1)!.bookValue).toBe(100_000);
    expect(monthlyDepreciation(a, '2026-08')).toBe(0);
    expect(monthlyDepreciation(a, '2027-04')).toBe(0);
    expect(scheduledAccum(a, '2030-01')).toBe(900_000);
  });
  it('posts a month once per asset (idempotent), ties to 1500 and 1590, and refuses roles without the permission', () => {
    const { s, b, cfo, u } = setup();
    const a = saveAsset(b, cfo, cooler(), { date: '2026-09-15' });
    const a2 = saveAsset(b, cfo, cooler({ name: 'POS', class: 'pos', storeId: 'st_hm13', cost: 360_000, salvage: 0, lifeMonths: 36, inService: '2026-10-01' }), { date: '2026-10-01' });
    expect(storeBalance(s, 'acct_equipment', 'st_hm11', '2026-11-30')).toBe(1_000_000);
    expect(unpostedDepreciation(s, '2026-11-27')).toEqual(['2026-09', '2026-10']);
    expect(assetTie(s, '2026-11-27').ok).toBe(false);
    expect(() => postDepreciation(b, u('owner'), '2026-09')).toThrow(PermissionError);
    const t9 = postDepreciation(b, cfo, '2026-09')!;
    expect(t9.date).toBe('2026-09-30');
    expect(t9.lines).toHaveLength(2);
    expect(postDepreciation(b, cfo, '2026-09')).toBeNull();
    const t10 = postDepreciation(b, cfo, '2026-10')!;
    expect(t10.lines.filter((l) => l.accountId === 'acct_depreciation').map((l) => l.debit)).toEqual([128_572, 10_000]);
    expect(a.posted['2026-10']).toBe(t10.id);
    expect(a2.posted['2026-10']).toBe(t10.id);
    const tie = assetTie(s, '2026-11-27');
    expect(tie.ok).toBe(true);
    expect(tie.accum.ledger).toBe(128_571 + 128_572 + 10_000);
    // A deleted entry is due again; reposting restores the tie.
    b.deleteTransaction(cfo, t10.id, 'test');
    expect(unpostedDepreciation(s, '2026-11-27')).toEqual(['2026-10']);
    postDepreciation(b, cfo, '2026-10');
    expect(assetTie(s, '2026-11-27').ok).toBe(true);
  });
  it('disposal needs prior months posted, removes cost and accumulated, and books the gain or loss', () => {
    const { s, b, cfo } = setup();
    const a = saveAsset(b, cfo, cooler(), { date: '2026-09-15' });
    expect(() => disposeAsset(b, cfo, a.id, { date: '2026-11-10', proceeds: 500_000, reason: 'Sold' })).toThrow(/Post depreciation through October 2026/);
    postDepreciation(b, cfo, '2026-09');
    postDepreciation(b, cfo, '2026-10');
    expect(() => disposeAsset(b, cfo, a.id, { date: '2026-11-10', proceeds: 500_000, reason: '' })).toThrow(ValidationError);
    const t = disposeAsset(b, cfo, a.id, { date: '2026-11-10', proceeds: 500_000, reason: 'Sold to the tenant' });
    const bookValue = 1_000_000 - 257_143;
    expect(a.disposal!.gainLoss).toBe(bookValue - 500_000);
    expect(t.lines.find((l) => l.accountId === 'acct_disposal')!.debit).toBe(bookValue - 500_000);
    expect(storeBalance(s, 'acct_equipment', 'st_hm11', '2026-11-30')).toBe(0);
    expect(storeBalance(s, 'acct_accum_dep', 'st_hm11', '2026-11-30')).toBe(0);
    expect(assetTie(s, '2026-11-30').ok).toBe(true);
    expect(postDepreciation(b, cfo, '2026-11')).toBeNull(); // no depreciation in the month of disposal
    expect(assetStatus(s, a, '2026-11-30')).toMatchObject({ disposed: true, bookValue: 0 });
    expect(trialBalance(s, { asOf: '2026-11-30' }).difference).toBe(0);
  });
  it('maintenance links to payments and flags what is due; warranties ending show too', () => {
    const { s, b, cfo } = setup();
    const a = saveAsset(b, cfo, cooler({ warrantyEnds: '2026-12-10' }), { date: '2026-09-15' });
    const t = b.createTransaction(cfo, { date: '2026-11-02', kind: 'money_out', description: 'COOLER SERVICE', lines: [
      { accountId: 'acct_repairs', storeId: 'st_hm11', debit: 25_000, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 25_000 }] });
    expect(() => logMaintenance(b, cfo, { assetId: a.id, storeId: 'st_hm13', date: '2026-11-02', kind: 'service', description: 'x' })).toThrow(/is at HM11/);
    logMaintenance(b, cfo, { assetId: a.id, storeId: 'st_hm11', date: '2026-11-02', kind: 'service', description: 'Compressor service', cost: 25_000, txnId: t.id, nextDue: '2026-12-02' });
    expect(maintenanceTie(s)).toMatchObject({ linked: 1, agree: 1 });
    const due = maintenanceDue(s, '2026-11-27');
    expect(due.map((d) => d.kind).sort()).toEqual(['maintenance', 'warranty']);
    expect(maintenanceDue(s, '2026-10-01')).toHaveLength(0);
  });
});

describe('demo register', () => {
  const s = buildDemo();
  it('reproduces the depreciation the demo always booked and ties to 1500/1510/1590 by store', () => {
    const st = assetsOf(s);
    const byStore = (p: string, store: string) => st.assets.filter((a) => a.storeId === store).reduce((x, a) => x + monthlyDepreciation(a, p), 0);
    for (const p of ['2026-09', '2026-10']) {
      expect(byStore(p, 'st_hm11')).toBe(260_000);
      expect(byStore(p, 'st_hm13')).toBe(210_000);
      expect(byStore(p, 'st_hm15')).toBe(295_000);
      const t = s.transactions.find((x) => !x.deleted && x.description === `Depreciation ${p}`)!;
      expect(t.lines.filter((l) => l.accountId === 'acct_depreciation').reduce((x, l) => x + l.debit, 0)).toBe(765_000);
    }
    // Opening accumulated depreciation ($96,000 a store) is the schedule through August.
    for (const store of ['st_hm11', 'st_hm13', 'st_hm15']) expect(st.assets.filter((a) => a.storeId === store).reduce((x, a) => x + scheduledAccum(a, '2026-08'), 0)).toBe(9_600_000);
    const tie = assetTie(s, '2026-11-27');
    expect(tie.ok).toBe(true);
    expect(tie.cost.ledger).toBe(balanceAsOf(s, 'acct_equipment', '2026-11-27') + balanceAsOf(s, 'acct_buildings', '2026-11-27'));
    expect(tie.accum.ledger).toBe(-balanceAsOf(s, 'acct_accum_dep', '2026-11-27'));
    expect(unpostedDepreciation(s, '2026-11-27')).toEqual([]);
    // HM17's first month posts at the end of November.
    expect(unpostedDepreciation(s, '2026-11-30')).toEqual(['2026-11']);
  });
});
