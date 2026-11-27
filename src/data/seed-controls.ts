import type { SeedCtx } from './seed';
import type { ApprovalLimit, Party, UstTestKind } from '../core/types';
import { approveBill, payBill, saveBill } from '../core/payables';
import { decideRateChange, requestRateChange } from '../core/payroll';
import { fuelOf } from '../core/fuel';
import {
  acknowledgeSod, dualCountRows, recordSecondCount, saveApprovalLimits, saveCashControls, saveClaim, saveCoverageNeed, saveDriveOff, saveRisk, saveUstRecord,
  setVendorBankAccount, DEFAULT_CASH_CONTROLS,
} from '../core/controls';

const c = (dollars: number) => Math.round(dollars * 100);

/**
 * Controls & risk demo (phase 14). Generic names and illustrative figures only.
 * - Approval limits: the bookkeeper approves bills up to $2,500 and journal entries up to $25,000; CFO and owner have no limit.
 * - A lookalike of the ice supplier (same address, bank account changed in November) whose $2,450 bill sits just under
 *   the bookkeeper's limit, and was entered and approved by the bookkeeper (the one open activity conflict).
 * - Round-dollar payments to a maintenance contractor, a +25% rate change at HM17, a drive-off at HM15.
 * - Second counts on recent counts over $2,500 (two missing), a risk register, the coverage checklist (cyber is the gap),
 *   claims history and UST test dates per tank (HM11's diesel line leak detector test is overdue).
 * The existing demo already shows a repeated small-shortage pattern (HM13 manager) and a check gap and repeat.
 */
export function seedControls({ state, books, cfo, setClock }: SeedCtx): void {
  const bk = state.users.find((u) => u.id === 'usr_bk')!;
  setClock('2026-09-02');
  const limits: ApprovalLimit[] = [
    { role: 'cfo', kind: 'bill', maxCents: null }, { role: 'cfo', kind: 'journal', maxCents: null }, { role: 'cfo', kind: 'writeoff', maxCents: null }, { role: 'cfo', kind: 'rate_change', maxCents: null },
    { role: 'owner', kind: 'bill', maxCents: null }, { role: 'owner', kind: 'journal', maxCents: null }, { role: 'owner', kind: 'writeoff', maxCents: null }, { role: 'owner', kind: 'rate_change', maxCents: null },
    { role: 'bookkeeper', kind: 'bill', maxCents: c(2_500) }, { role: 'bookkeeper', kind: 'journal', maxCents: c(25_000) }, { role: 'bookkeeper', kind: 'writeoff', maxCents: 0 }, { role: 'bookkeeper', kind: 'rate_change', maxCents: 0 },
  ];
  saveApprovalLimits(books, cfo, limits);

  // ── Vendors: the ice supplier gets an address and bank account; a lookalike shares the address.
  const ice = state.parties.find((p) => p.id === 'pt_ice')!;
  Object.assign(ice, { address: '100 Demo Industrial Rd, Unit 4', bankAccount: 'DEMO-BANK-0417' });
  setClock('2026-11-02');
  const lookalike: Party = { id: 'pt_ice_co', name: 'Ice Supplier Co. (demo)', type: 'vendor', defaultAccountId: 'acct_cogs_grocery', address: '100 Demo Industrial Rd Unit 4', bankAccount: 'DEMO-BANK-0999' };
  books.saveParty(bk, lookalike);
  const maint: Party = { id: 'pt_maint', name: 'Facility maintenance contractor (demo)', type: 'vendor', defaultAccountId: 'acct_repairs' };
  books.saveParty(cfo, maint);
  setClock('2026-11-09');
  setVendorBankAccount(books, bk, 'pt_ice_co', 'DEMO-BANK-7731', 'Vendor emailed new remittance details');

  // ── Its bill: $2,450, just under the bookkeeper's $2,500 limit, entered and approved by the bookkeeper, paid by the CFO.
  setClock('2026-11-10');
  const bill = saveBill(books, bk, { vendorId: 'pt_ice_co', storeId: 'st_hm15', invoiceNo: 'ISC-1108', billDate: '2026-11-10', dueDate: '2026-11-25', lines: [{ accountId: 'acct_cogs_grocery', storeId: 'st_hm15', amount: c(2_450), memo: 'Bagged ice, November' }], source: 'demo' } as Parameters<typeof saveBill>[2]);
  approveBill(books, bk, bill.id);
  setClock('2026-11-19');
  payBill(books, cfo, bill.id, { date: '2026-11-19', method: 'ach', confirmation: 'ACH-DEMO-55120' });

  // ── Round-dollar payments to the maintenance contractor.
  for (const [date, amt, memo] of [['2026-11-05', 1_500, 'Forecourt lighting repair'], ['2026-11-18', 2_000, 'Walk-in cooler door rehang and gaskets']] as const) {
    setClock(date);
    books.createTransaction(cfo, { date, kind: 'money_out', description: 'ACH FACILITY MAINTENANCE', partyId: 'pt_maint', memo, tags: ['repairs'], lines: [
      { accountId: 'acct_repairs', storeId: 'st_corp', debit: c(amt), credit: 0, memo }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: c(amt) }] }, { source: 'demo' });
  }

  // ── A rate change spike: +25% at HM17, effective after the last run (so the runs on file are unchanged).
  setClock('2026-11-24');
  const dallas = state.people.employees.find((e) => e.name === 'Dallas N.')!;
  const rc = requestRateChange(books, bk, { employeeId: dallas.id, toCents: 1500, effective: '2026-12-07', reason: 'Promoted to shift lead; covers the opening manager role' });
  setClock('2026-11-25');
  decideRateChange(books, cfo, rc.id, 'approved', 'Matches the shift-lead rate at the other stores.');

  // ── An optional drive-off log entry at HM15.
  setClock('2026-11-19');
  saveDriveOff(books, cfo, { storeId: 'st_hm15', date: '2026-11-19', grade: 'regular', gallons: 18.4, amount: c(51.13), pump: '4', note: 'Silver pickup, no plate seen; reported to the sheriff\'s office (demo).' });

  // ── Cash controls: second counts over $2,500 from 16 Nov. Two recent store counts were never second-counted.
  setClock('2026-11-16');
  saveCashControls(books, cfo, { ...DEFAULT_CASH_CONTROLS });
  const rows = dualCountRows(state);
  const skip = new Set(rows.filter((r) => r.stage === 'count').slice(0, 2).map((r) => `${r.bagId}|${r.stage}`));
  for (const r of rows) {
    if (skip.has(`${r.bagId}|${r.stage}`)) continue;
    setClock(r.businessDate);
    const code = state.stores.find((s) => s.id === r.storeId)!.code;
    recordSecondCount(books, cfo, { bagId: r.bagId, stage: r.stage, person: r.stage === 'count' ? `${code} assistant manager` : 'HQ supervisor', amount: r.amount });
  }

  // ── Segregation of duties: the CFO's own activity is covered by the owner's monthly review; the bookkeeper's bills are not.
  setClock('2026-09-03');
  for (const area of ['bill', 'journal', 'writeoff', 'rate_change', 'cash']) {
    acknowledgeSod(books, cfo, `cfg:cfo:${area}`, 'Small team: the owner reviews the CFO\'s approvals, payments and cash log every month and signs the review (compensating control).', { coversActivity: true });
  }
  acknowledgeSod(books, cfo, 'cfg:bookkeeper:journal', 'Entries over $10,000 need someone other than the preparer; the portal enforces it.');
  acknowledgeSod(books, cfo, 'cfg:bookkeeper:cash', 'The bookkeeper only covers the HQ clerk on days off; counts at the store are by store staff.');

  // ── Risk register.
  setClock('2026-10-01');
  const risk = (title: string, category: Parameters<typeof saveRisk>[2]['category'], likelihood: number, impact: number, owner: string, mitigation: string, reviewDate: string, policyIds?: string[], storeId?: string) =>
    saveRisk(books, cfo, { title, category, likelihood, impact, owner, mitigation, reviewDate, policyIds, storeId, status: 'open' });
  risk('Cash theft or loss between the register and the bank', 'operational', 3, 3, 'CFO', 'Count at close, second count over $2,500, blind HQ counts, deposits within 2 days, weekly variance review.', '2026-12-15');
  risk('Fuel release from a tank or line', 'environmental', 2, 5, 'Operations lead (demo)', 'Monthly release detection from the tank gauges, annual line leak detector tests, pollution / UST policy ($1M).', '2026-11-30', ['pol_pollution']);
  risk('Card data breach at the POS', 'technology', 3, 4, 'CFO', 'POS vendor patches monthly and the card network is kept apart from store Wi-Fi. No cyber policy yet: quote requested.', '2026-12-01');
  risk('Sale of alcohol or tobacco to a minor', 'compliance', 2, 4, 'Store managers', 'Age-check audits each month, ID scanner at every register, training at hire.', '2027-01-15', ['pol_liquor']);
  risk('Customer slip and fall on the forecourt', 'safety', 3, 3, 'Store managers', 'Spill kits at the pumps, winter salting log, incident reports the same day.', '2027-02-01', ['pol_package']);
  risk('Key-person dependence on the bookkeeper', 'people', 3, 3, 'CFO', 'Month-end checklist documented in the portal; the CFO can do every step.', '2027-03-01');
  risk('Fuel supplier tightens credit terms', 'financial', 2, 4, 'CFO', 'Keep the $30,000 floor and the line of credit undrawn headroom; pay notices on time.', '2026-11-20');

  // ── Coverage checklist: what we should carry. Cyber is the gap.
  const need = (kind: Parameters<typeof saveCoverageNeed>[2]['kind'], x: Partial<Parameters<typeof saveCoverageNeed>[2]> = {}) => saveCoverageNeed(books, cfo, { kind, required: true, ...x });
  need('property', { minLimitCents: c(2_000_000) });
  need('general_liability', { policyIds: ['pol_package'], note: 'Included in the property & liability package.' });
  need('liquor', { minLimitCents: c(1_000_000) });
  need('pollution', { minLimitCents: c(1_000_000), note: 'Also the UST financial-responsibility proof.' });
  need('workers_comp');
  need('umbrella', { minLimitCents: c(5_000_000) });
  need('cyber', { note: 'Card data and the POS network. Quote requested from Carrier B (demo).' });
  need('auto', { policyIds: ['pol_package'], note: 'Hired & non-owned auto endorsement on the package; no company-owned vehicles.' });

  // ── Claims history.
  setClock('2026-10-30');
  saveClaim(books, cfo, { storeId: 'st_hm15', policyId: 'pol_package', date: '2026-10-28', description: 'Walk-in cooler compressor failure', amount: c(2_400), paid: 0, status: 'open', receivableId: 'ar_ins_hm15', note: 'Adjuster visit booked.' });
  saveClaim(books, cfo, { storeId: 'st_hm11', policyId: 'pol_package', date: '2026-04-12', description: 'Canopy fascia storm damage', amount: c(8_600), paid: c(3_600), status: 'paid', note: '$5,000 deductible; paid before these books start.' });

  // ── UST tests per tank and site. HM11's diesel line leak detector test is overdue.
  const tanks = fuelOf(state).tanks;
  const plan: Record<string, Partial<Record<UstTestKind, string>>> = {
    st_hm11: { tank_tightness: '2024-05-14', line_tightness: '2026-05-14', line_leak_detector: '2026-05-14', cathodic_protection: '2024-05-14', spill_overfill: '2024-05-14', inspection: '2026-02-10', financial_responsibility: '2026-07-01' },
    st_hm13: { tank_tightness: '2026-09-10', line_tightness: '2026-09-10', line_leak_detector: '2026-09-10', cathodic_protection: '2025-03-18', spill_overfill: '2025-03-18', inspection: '2026-03-18', financial_responsibility: '2026-07-01' },
    st_hm15: { tank_tightness: '2023-08-22', line_tightness: '2026-08-22', line_leak_detector: '2026-08-22', cathodic_protection: '2024-08-22', spill_overfill: '2024-08-22', inspection: '2026-08-22', financial_responsibility: '2026-07-01' },
    st_hm17: { tank_tightness: '2026-10-20', line_tightness: '2026-10-20', line_leak_detector: '2026-10-20', cathodic_protection: '2026-10-20', spill_overfill: '2026-10-20', inspection: '2026-10-28', financial_responsibility: '2026-07-01' },
  };
  const hm13Maint = state.assets?.maintenance.find((m) => m.assetId === 'fa_hm13_ust')?.id;
  setClock('2026-10-31');
  for (const [storeId, kinds] of Object.entries(plan)) {
    for (const [kind, date] of Object.entries(kinds) as [UstTestKind, string][]) {
      const site = kind === 'inspection' || kind === 'financial_responsibility';
      const vendor = kind === 'financial_responsibility' ? 'Carrier C (demo)' : 'UST testing contractor (demo)';
      const note = kind === 'financial_responsibility' ? 'Pollution / UST liability certificate on file.' : undefined;
      if (site) { saveUstRecord(books, cfo, { storeId, kind, date, result: 'pass', vendor, note }); continue; }
      for (const t of tanks.filter((x) => x.storeId === storeId)) {
        const overdue = storeId === 'st_hm11' && t.grade === 'diesel' && kind === 'line_leak_detector';
        const hm13 = storeId === 'st_hm13' && (kind === 'line_leak_detector' || kind === 'tank_tightness');
        saveUstRecord(books, cfo, {
          storeId, tankId: t.id, kind, date: overdue ? '2025-10-14' : date, result: 'pass', vendor,
          nextDue: hm13 && kind === 'line_leak_detector' ? '2026-12-10' : undefined, maintenanceId: hm13 ? hm13Maint : undefined,
          note: overdue ? 'Detector replaced in May; the retest was never booked.' : undefined,
        });
      }
    }
  }
}
