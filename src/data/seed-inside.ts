import type { SeedCtx } from './seed';
import type { ID } from '../core/types';
import { addDays, dayOfWeek, lastDayOfPeriod, periodOf } from '../core/dates';
import { allocate } from '../core/money';
import {
  D, claimScanPeriod, commitPosImport, departments, insideOf, ledgerDeptSales, logAgeCheck, postCount, posCloseByDept, purchaseLines, purchasesByDept, resolveAgeCheck,
  reviewCount, saveCount, saveLotteryWeek, saveScanProgram, saveVendorMapping, scanPeriods, setBudget, type ParsedPos,
} from '../core/inside';

const c = (dollars: number) => Math.round(dollars * 100);

/** The last POS day the demo imports; 26 Nov is left for the import workflow. */
export const POS_IMPORTED_THROUGH = '2026-11-25';

/** POS sub-departments as the register prints them, with a typical unit price (dollars) for units sold. */
const POS_SPLIT: Record<string, [string, number, number][]> = {
  [D.beer]: [['Beer & wine', 1, 9.8]],
  [D.tobacco]: [['Cigarettes', 78, 8.4], ['Other tobacco', 22, 4.1]],
  [D.grocery]: [['Snacks & candy', 60, 2.1], ['Grocery', 40, 3.8]],
  [D.bev]: [['Packaged beverage', 72, 2.35], ['Fountain & coffee', 28, 1.65]],
  [D.other]: [['General merchandise', 1, 4.5]],
  [D.kitchen]: [['Hot food', 1, 7.9]],
};

const OPS = ['st_hm11', 'st_hm13', 'st_hm15', 'st_hm17'];
const CODE: Record<string, string> = { st_hm11: 'HM11', st_hm13: 'HM13', st_hm15: 'HM15', st_hm17: 'HM17' };

/**
 * Inside-store demo: POS department detail that ties to every POS daily close, vendor mappings, monthly counts with
 * one department's shrink high, purchasing budgets with one store over, two scan-data programs (one short-paid),
 * lottery weeks with one shortage, and age-check audits. Nothing here touches the bank.
 */
export function seedInside({ state, books, cfo, rand, setClock }: SeedCtx): void {
  const ins = insideOf(state);
  const jitter = (pct: number) => 1 + (rand() * 2 - 1) * pct;
  setClock('2026-08-31');
  saveVendorMapping(books, cfo, { partyId: 'pt_grocery', accountId: 'acct_cogs_grocery', departmentIds: [D.grocery, D.bev, D.other], note: 'The wholesaler ships grocery, packaged drinks and sundries on one invoice: split by sales.' });
  saveVendorMapping(books, cfo, { partyId: 'pt_ice', departmentIds: [D.other], note: 'Bagged ice sells under general merchandise.' });

  // ── POS department detail, one file per store and month, built from each day's POS close.
  const closeDays = new Map<string, Set<string>>();
  for (const t of state.transactions) {
    if (t.deleted || !t.tags.includes('pos') || t.date > POS_IMPORTED_THROUGH) continue;
    const s = t.lines.find((l) => OPS.includes(l.storeId))?.storeId;
    if (!s) continue;
    const k = `${s}|${periodOf(t.date)}`;
    if (!closeDays.has(k)) closeDays.set(k, new Set());
    closeDays.get(k)!.add(t.date);
  }
  for (const [k, days] of [...closeDays].sort((a, b) => a[0].split('|')[1].localeCompare(b[0].split('|')[1]) || a[0].localeCompare(b[0]))) {
    const [storeId, period] = k.split('|');
    const parsed: ParsedPos = { rows: [], totals: [], problems: [] };
    let row = 1;
    for (const date of [...days].sort()) {
      const close = posCloseByDept(state, storeId, date);
      let total = 0;
      for (const [deptId, amount] of close.byDept) {
        const split = POS_SPLIT[deptId];
        if (!split || amount <= 0) continue;
        const parts = allocate(amount, split.map((x) => x[1]));
        split.forEach(([name, , price], i) => {
          if (!parts[i]) return;
          parsed.rows.push({ row: ++row, date, storeCode: CODE[storeId], posDept: name, sales: parts[i], units: Math.max(1, Math.round((parts[i] / 100 / price) * jitter(0.06))) });
        });
        total += amount;
      }
      parsed.totals.push({ storeCode: CODE[storeId], date, sales: total, transactions: Math.round(total / 100 / (9.4 * jitter(0.07))) });
    }
    setClock(addDays(lastDayOfPeriod(period) < POS_IMPORTED_THROUGH ? lastDayOfPeriod(period) : POS_IMPORTED_THROUGH, 1));
    commitPosImport(books, cfo, { name: `PDI dept sales ${CODE[storeId]} ${period} (demo).csv`, parsed }, { source: 'demo' });
  }

  // ── Inventory counts: an opening count that agrees with the books, then month-end counts.
  const opening: Record<string, Record<string, number>> = {
    st_hm11: { [D.beer]: 9_000, [D.tobacco]: 17_000, [D.grocery]: 11_000, [D.bev]: 7_000, [D.other]: 3_000, [D.kitchen]: 5_000 },
    st_hm13: { [D.beer]: 8_500, [D.tobacco]: 17_500, [D.grocery]: 11_000, [D.bev]: 7_000, [D.other]: 3_000, [D.kitchen]: 5_000 },
    st_hm15: { [D.tobacco]: 20_000, [D.grocery]: 14_000, [D.bev]: 8_500, [D.other]: 3_500, [D.kitchen]: 6_000 },
    st_hm17: { [D.beer]: 7_000, [D.tobacco]: 13_000, [D.grocery]: 9_000, [D.bev]: 6_000, [D.other]: 3_000 },
  };
  for (const [storeId, lines] of Object.entries(opening)) {
    const date = storeId === 'st_hm17' ? '2026-11-01' : '2026-08-31';
    setClock(date);
    const cnt = saveCount(books, cfo, { storeId, date, lines: Object.entries(lines).map(([departmentId, d]) => ({ departmentId, counted: c(d) })), note: storeId === 'st_hm17' ? 'Opening count when the store opened.' : 'Opening count, agrees to the opening balance.' });
    postCount(books, cfo, cnt.id);
  }
  /** Shrink as a share of the department's sales since the last count. */
  const shrinkRate = (storeId: ID, dept: ID, date: string) => {
    if (storeId === 'st_hm13' && dept === D.tobacco && date === '2026-10-31') return 0.034;
    if (dept === D.kitchen) return storeId === 'st_hm15' && date === '2026-10-31' ? 0.05 : 0.008 + rand() * 0.006;
    return 0.003 + rand() * 0.006;
  };
  for (const date of ['2026-09-30', '2026-10-31']) {
    for (const storeId of ['st_hm11', 'st_hm13', 'st_hm15']) {
      const depts = Object.keys(opening[storeId]);
      const probe = reviewCount(state, { storeId, date, lines: depts.map((departmentId) => ({ departmentId, counted: 0 })) });
      const lines = probe.lines.map((l) => ({ departmentId: l.departmentId, counted: Math.max(0, Math.round(((l.book ?? 0) - l.sales * shrinkRate(storeId, l.departmentId, date)) / 100) * 100) }));
      setClock(addDays(date, 1));
      const cnt = saveCount(books, cfo, { storeId, date, lines, note: 'Month-end count by the store manager and the route supervisor.' });
      postCount(books, cfo, cnt.id);
    }
  }

  // ── Purchasing budgets: October with headroom; November at about October's spend, with HM15 tobacco set too low.
  const spend = (period: string) => purchasesByDept(purchaseLines(state, { storeIds: OPS, from: `${period}-01`, to: lastDayOfPeriod(period) }));
  const oct = spend('2026-10');
  const nov = spend('2026-11');
  const up = (cents: number) => Math.ceil(cents / 10_000) * 10_000;
  setClock('2026-09-28');
  const buyDepts = departments(state).filter((d) => d.cogsAccountId);
  for (const storeId of OPS) {
    for (const d of buyDepts) {
      const k = `${storeId}|${d.id}`;
      if (oct.get(k)) setBudget(books, cfo, { storeId, period: '2026-10', departmentId: d.id, amount: up((oct.get(k) ?? 0) * 1.04) });
    }
  }
  setClock('2026-10-29');
  for (const storeId of OPS) {
    for (const d of buyDepts) {
      const k = `${storeId}|${d.id}`;
      const n = nov.get(k) ?? 0;
      if (!n && !oct.get(k)) continue;
      const amount = storeId === 'st_hm15' && d.id === D.tobacco ? Math.floor((n * 0.93) / 10_000) * 10_000
        : storeId === 'st_hm17' ? up(n * 1.3) : up(Math.max(oct.get(k) ?? 0, n * 1.08));
      setBudget(books, cfo, { storeId, period: '2026-11', departmentId: d.id, amount });
    }
  }

  // ── Scan-data programs on tobacco, linked to the Phase 5 rebate items (no second copy of the money).
  const calibrate = (programId: ID, target: number) => {
    const p = ins.scanPrograms.find((x) => x.id === programId)!;
    const q3 = scanPeriods(state, programId, '2026-11-26').find((x) => x.key === '2026Q3')!;
    p.rateCentsPerUnit = Math.round((target / q3.qualifying) * 100) / 100;
  };
  setClock('2026-10-01');
  saveScanProgram(books, cfo, { id: 'scan_reynolds', manufacturer: 'Reynolds', departmentId: D.tobacco, rateCentsPerUnit: 1, shareBps: 5_200, cadence: 'quarterly', storeIds: OPS, payDays: 30, receivables: { '2026Q3': 'ar_reynolds_q3' }, active: true });
  saveScanProgram(books, cfo, { id: 'scan_itg', manufacturer: 'ITG', departmentId: D.tobacco, rateCentsPerUnit: 1, shareBps: 1_600, cadence: 'quarterly', storeIds: OPS, payDays: 45, receivables: { '2026Q3': 'ar_itg_q3' }, active: true });
  calibrate('scan_reynolds', c(3_520));
  calibrate('scan_itg', c(1_180));
  setClock('2026-10-05');
  // Claiming puts the scan-data figure on the receivable: Reynolds paid $3,240.60 against it, so it is short.
  claimScanPeriod(books, cfo, 'scan_reynolds', '2026Q3', '2026-10-05');
  claimScanPeriod(books, cfo, 'scan_itg', '2026Q3', '2026-10-05');

  // ── Lottery weeks (ending Saturdays). Commissions add up to each month's 4140 commission deposit.
  const weeks: string[] = [];
  for (let d = '2026-09-05'; d <= '2026-11-21'; d = addDays(d, 7)) weeks.push(d);
  if (dayOfWeek(weeks[0]) !== 6) throw new Error('Lottery weeks must end on Saturdays.');
  for (const storeId of OPS) {
    const opened = storeId === 'st_hm17' ? '2026-11-01' : '2026-09-01';
    const mine = weeks.filter((w) => addDays(w, -6) >= opened);
    const scale = storeId === 'st_hm17' ? 0.6 : storeId === 'st_hm11' ? 1.15 : 1;
    const rows = mine.map((w) => {
      const instantSales = c(Math.round(3_400 * scale * jitter(0.18)));
      const onlineSales = c(Math.round(1_550 * scale * jitter(0.2)));
      return { w, instantSales, onlineSales, instantCashes: Math.round(instantSales * (0.58 + rand() * 0.08)), onlinePayouts: Math.round(onlineSales * (0.45 + rand() * 0.1)) };
    });
    for (const period of [...new Set(rows.map((r) => periodOf(r.w)))]) {
      const commission = ledgerDeptSales(state, { storeIds: [storeId], from: `${period}-01`, to: lastDayOfPeriod(period) }).get(`${storeId}|${D.lottery}`) ?? 0;
      const inMonth = rows.filter((r) => periodOf(r.w) === period);
      const parts = allocate(commission, inMonth.map((r) => r.instantSales + r.onlineSales));
      inMonth.forEach((r, i) => {
        const due = r.instantSales + r.onlineSales - r.instantCashes - r.onlinePayouts - parts[i];
        const expectedCash = r.instantSales + r.onlineSales - r.instantCashes - r.onlinePayouts;
        const shortage = storeId === 'st_hm13' && r.w === '2026-11-14' ? c(145) : rand() < 0.2 ? Math.round(rand() * 300) : 0;
        setClock(addDays(r.w, 2));
        saveLotteryWeek(books, cfo, {
          storeId, weekEnding: r.w, instantSales: r.instantSales, onlineSales: r.onlineSales, instantCashes: r.instantCashes, onlinePayouts: r.onlinePayouts, commission: parts[i], settlement: due, posNet: expectedCash - shortage,
          note: shortage > 1_000 ? 'Register lottery net short of the lottery report: two packs activated but not rung in.' : undefined,
        });
      });
    }
  }

  // ── Age-check audits.
  const checks: [string, string, 'tobacco' | 'alcohol' | 'both', 'pass' | 'fail', string, string?, string?, string?, string?][] = [
    ['2026-09-12', 'st_hm11', 'tobacco', 'pass', 'Mystery shopper (demo vendor)'],
    ['2026-09-24', 'st_hm13', 'alcohol', 'pass', 'State compliance check'],
    ['2026-10-03', 'st_hm15', 'tobacco', 'pass', 'Internal check'],
    ['2026-10-15', 'st_hm13', 'tobacco', 'fail', 'State compliance check', 'Cashier C (demo)', 'Retrain the clerk; manager signs off the ID policy with every cashier.', '2026-10-22', 'Retrained 10/19; policy signed by all cashiers.'],
    ['2026-10-28', 'st_hm11', 'alcohol', 'pass', 'Mystery shopper (demo vendor)'],
    ['2026-11-09', 'st_hm17', 'both', 'pass', 'Internal check'],
    ['2026-11-18', 'st_hm15', 'tobacco', 'fail', 'Mystery shopper (demo vendor)', 'Cashier F (demo)', 'Written warning and retraining; re-test within 30 days.', '2026-11-30'],
    ['2026-11-21', 'st_hm13', 'alcohol', 'pass', 'Internal check'],
  ];
  for (const [date, storeId, product, result, checkedBy, clerk, followUp, followUpDue, resolved] of checks) {
    setClock(date);
    const a = logAgeCheck(books, cfo, { date, storeId, product, result, checkedBy, clerk, followUp, followUpDue });
    if (resolved) { setClock(addDays(date, 4)); resolveAgeCheck(books, cfo, a.id, resolved); }
  }
}
