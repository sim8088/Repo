import type { SeedCtx } from './seed';
import type { Party, PayMethod, UtilityAccount } from '../core/types';
import { approveBill, payBill, saveBill, saveVendorStatement, scheduleBill, type BillDraft } from '../core/payables';

const c = (dollars: number) => Math.round(dollars * 100);

const VENDORS: Party[] = [
  { id: 'pt_water', name: 'Municipal water & sewer (demo)', type: 'vendor', defaultAccountId: 'acct_utilities' },
  { id: 'pt_gas', name: 'Natural gas utility (demo)', type: 'vendor', defaultAccountId: 'acct_utilities' },
  { id: 'pt_telecom', name: 'Phone & internet provider (demo)', type: 'vendor', defaultAccountId: 'acct_utilities' },
  { id: 'pt_waste', name: 'Waste hauler (demo)', type: 'vendor', defaultAccountId: 'acct_utilities' },
  { id: 'pt_pest', name: 'Pest control contractor (demo)', type: 'vendor', defaultAccountId: 'acct_repairs', is1099: true },
  { id: 'pt_security', name: 'Security monitoring (demo)', type: 'vendor', defaultAccountId: 'acct_repairs' },
  { id: 'pt_ice', name: 'Ice supplier (demo)', type: 'vendor', defaultAccountId: 'acct_cogs_grocery' },
  { id: 'pt_signs', name: 'Sign & lighting contractor (demo)', type: 'vendor', defaultAccountId: 'acct_repairs', is1099: true },
  { id: 'pt_office', name: 'Office supply vendor (demo)', type: 'vendor', defaultAccountId: 'acct_supplies' },
  { id: 'pt_kitchen_svc', name: 'Kitchen equipment service (demo)', type: 'vendor', defaultAccountId: 'acct_repairs', is1099: true },
];

const UTILITIES: UtilityAccount[] = [
  ...(['hm11', 'hm13', 'hm15', 'hm17', 'corp'] as const).map((s, i): UtilityAccount => ({
    id: `ua_ent_${s}`, vendorId: 'pt_entergy', storeId: `st_${s}`, service: 'electric', serviceAddress: `${s.toUpperCase()} site (demo address)`, accountNo: `DEMO-E-${1101 + i * 11}`, autopay: true, active: true,
  })),
  { id: 'ua_wat_hm11', vendorId: 'pt_water', storeId: 'st_hm11', service: 'water', serviceAddress: 'HM11 site (demo address)', accountNo: 'DEMO-W-2011', autopay: false, active: true },
  { id: 'ua_wat_hm13', vendorId: 'pt_water', storeId: 'st_hm13', service: 'water', serviceAddress: 'HM13 site (demo address)', accountNo: 'DEMO-W-2013', autopay: false, active: true },
  { id: 'ua_wat_hm15', vendorId: 'pt_water', storeId: 'st_hm15', service: 'water', serviceAddress: 'HM15 site (demo address)', accountNo: 'DEMO-W-2015', autopay: false, active: true },
  { id: 'ua_gas_hm15', vendorId: 'pt_gas', storeId: 'st_hm15', service: 'gas', serviceAddress: 'HM15 kitchen (demo address)', accountNo: 'DEMO-G-3015', autopay: true, active: true },
  { id: 'ua_tel_corp', vendorId: 'pt_telecom', storeId: 'st_corp', service: 'telecom', serviceAddress: 'Corporate office (demo address)', accountNo: 'DEMO-T-4000', autopay: true, active: true },
  { id: 'ua_waste_corp', vendorId: 'pt_waste', storeId: 'st_corp', service: 'waste', serviceAddress: 'All store sites (demo)', accountNo: 'DEMO-X-5000', autopay: false, active: true },
];

interface Pay { date: string; method: PayMethod; checkNo?: string; confirmation?: string }
interface DemoBill extends BillDraft {
  approve?: boolean;
  schedule?: { date: string; method: PayMethod };
  pay?: Pay;
  by?: string;
}

const one = (accountId: string, storeId: string, dollars: number, memo?: string) => [{ accountId, storeId, amount: c(dollars), memo }];

function bills(): DemoBill[] {
  const out: DemoBill[] = [];
  const add = (b: DemoBill) => out.push({ approve: true, source: 'demo', ...b });
  let chk = 4201;
  const check = (date: string): Pay => { chk += 1; if (chk === 4207) chk += 1; return { date, method: 'check', checkNo: String(chk) }; };
  const ach = (date: string, ref: string): Pay => ({ date, method: 'ach', confirmation: ref });
  const auto = (date: string): Pay => ({ date, method: 'autopay', confirmation: 'Autopay draft' });

  // Water & sewer: HM11 and HM15 pay on time; HM13's October bill is past due and November's carries a disconnect notice. HM15 jumps in November.
  add({ vendorId: 'pt_water', storeId: 'st_hm11', utilityAccountId: 'ua_wat_hm11', invoiceNo: 'W2011-0926', billDate: '2026-09-05', dueDate: '2026-09-25', lines: one('acct_utilities', 'st_hm11', 412.3), pay: check('2026-09-23') });
  add({ vendorId: 'pt_water', storeId: 'st_hm11', utilityAccountId: 'ua_wat_hm11', invoiceNo: 'W2011-1026', billDate: '2026-10-05', dueDate: '2026-10-25', lines: one('acct_utilities', 'st_hm11', 398.75), pay: ach('2026-10-23', 'WTR-88412') });
  add({ vendorId: 'pt_water', storeId: 'st_hm11', utilityAccountId: 'ua_wat_hm11', invoiceNo: 'W2011-1126', billDate: '2026-11-12', dueDate: '2026-12-02', lines: one('acct_utilities', 'st_hm11', 421.4), schedule: { date: '2026-12-01', method: 'check' } });
  add({ vendorId: 'pt_water', storeId: 'st_hm13', utilityAccountId: 'ua_wat_hm13', invoiceNo: 'W2013-0926', billDate: '2026-09-06', dueDate: '2026-09-26', lines: one('acct_utilities', 'st_hm13', 356.2), pay: ach('2026-09-25', 'WTR-87120') });
  add({ vendorId: 'pt_water', storeId: 'st_hm13', utilityAccountId: 'ua_wat_hm13', invoiceNo: 'W2013-1026', billDate: '2026-10-06', dueDate: '2026-10-26', lines: one('acct_utilities', 'st_hm13', 371.85) });
  add({ vendorId: 'pt_water', storeId: 'st_hm13', utilityAccountId: 'ua_wat_hm13', invoiceNo: 'W2013-1126', billDate: '2026-11-06', dueDate: '2026-11-26', lines: one('acct_utilities', 'st_hm13', 402.1), disconnectNotice: true, memo: 'Disconnect notice: October balance past due.' });
  add({ vendorId: 'pt_water', storeId: 'st_hm15', utilityAccountId: 'ua_wat_hm15', invoiceNo: 'W2015-0926', billDate: '2026-09-08', dueDate: '2026-09-28', lines: one('acct_utilities', 'st_hm15', 524.6), pay: ach('2026-09-28', 'WTR-87355') });
  add({ vendorId: 'pt_water', storeId: 'st_hm15', utilityAccountId: 'ua_wat_hm15', invoiceNo: 'W2015-1026', billDate: '2026-10-08', dueDate: '2026-10-28', lines: one('acct_utilities', 'st_hm15', 541.9), pay: ach('2026-10-27', 'WTR-88790') });
  add({ vendorId: 'pt_water', storeId: 'st_hm15', utilityAccountId: 'ua_wat_hm15', invoiceNo: 'W2015-1126', billDate: '2026-11-10', dueDate: '2026-12-04', lines: one('acct_utilities', 'st_hm15', 758.35) });
  // Natural gas (HM15 kitchen) and phone/internet are on autopay.
  for (const [inv, bd, due, amt, paid] of [['G3015-09', '2026-09-10', '2026-09-30', 212.4, true], ['G3015-10', '2026-10-10', '2026-10-30', 246.8, true], ['G3015-11', '2026-11-10', '2026-11-30', 289.55, false]] as const) {
    add({ vendorId: 'pt_gas', storeId: 'st_hm15', utilityAccountId: 'ua_gas_hm15', invoiceNo: inv, billDate: bd, dueDate: due, autopay: true, lines: one('acct_utilities', 'st_hm15', amt), pay: paid ? auto(due) : undefined });
  }
  for (const [inv, bd, due, amt] of [['T4000-09', '2026-09-01', '2026-09-18', 420], ['T4000-10', '2026-10-01', '2026-10-18', 420], ['T4000-11', '2026-11-01', '2026-11-18', 438.2]] as const) {
    add({ vendorId: 'pt_telecom', storeId: 'st_corp', utilityAccountId: 'ua_tel_corp', invoiceNo: inv, billDate: bd, dueDate: due, autopay: true, lines: one('acct_utilities', 'st_corp', amt), pay: auto(due) });
  }
  // Waste hauling: one bill to Corporate, allocated to the stores it serves.
  const waste = (hm17: boolean) => [
    { accountId: 'acct_utilities', storeId: 'st_hm11', amount: c(500) }, { accountId: 'acct_utilities', storeId: 'st_hm13', amount: c(400) },
    { accountId: 'acct_utilities', storeId: 'st_hm15', amount: c(450) }, ...(hm17 ? [{ accountId: 'acct_utilities', storeId: 'st_hm17', amount: c(250) }] : []),
  ];
  add({ vendorId: 'pt_waste', storeId: 'st_corp', utilityAccountId: 'ua_waste_corp', invoiceNo: 'WH-50091', billDate: '2026-09-02', dueDate: '2026-10-02', lines: waste(false), pay: check('2026-09-25') });
  add({ vendorId: 'pt_waste', storeId: 'st_corp', utilityAccountId: 'ua_waste_corp', invoiceNo: 'WH-50187', billDate: '2026-10-02', dueDate: '2026-11-01', lines: waste(false), pay: check('2026-10-30') });
  add({ vendorId: 'pt_waste', storeId: 'st_corp', utilityAccountId: 'ua_waste_corp', invoiceNo: 'WH-50266', billDate: '2026-11-02', dueDate: '2026-12-02', lines: waste(true), schedule: { date: '2026-12-01', method: 'ach' } });
  // Pest control (1099, stays under $600) split three ways.
  const pest = [{ accountId: 'acct_repairs', storeId: 'st_hm11', amount: c(50) }, { accountId: 'acct_repairs', storeId: 'st_hm13', amount: c(50) }, { accountId: 'acct_repairs', storeId: 'st_hm15', amount: c(50) }];
  add({ vendorId: 'pt_pest', storeId: 'st_corp', invoiceNo: 'PC-1409', billDate: '2026-09-12', dueDate: '2026-09-27', lines: pest, pay: check('2026-09-25') });
  add({ vendorId: 'pt_pest', storeId: 'st_corp', invoiceNo: 'PC-1477', billDate: '2026-10-12', dueDate: '2026-10-27', lines: pest, pay: check('2026-10-26') });
  add({ vendorId: 'pt_pest', storeId: 'st_corp', invoiceNo: 'PC-1532', billDate: '2026-11-12', dueDate: '2026-11-27', lines: pest, schedule: { date: '2026-11-27', method: 'check' } });
  // Security monitoring, allocated to four stores. November's is due in three days and nobody has scheduled it.
  const sec = (n: number) => ['st_hm11', 'st_hm13', 'st_hm15', 'st_hm17'].slice(0, n).map((s) => ({ accountId: 'acct_repairs', storeId: s, amount: c(160), memo: 'Alarm monitoring' }));
  add({ vendorId: 'pt_security', storeId: 'st_corp', invoiceNo: 'SM-7731', billDate: '2026-09-03', dueDate: '2026-09-30', lines: sec(3), pay: ach('2026-09-29', 'SEC-30117') });
  add({ vendorId: 'pt_security', storeId: 'st_corp', invoiceNo: 'SM-7802', billDate: '2026-10-03', dueDate: '2026-10-30', lines: sec(3), pay: ach('2026-10-29', 'SEC-30544') });
  add({ vendorId: 'pt_security', storeId: 'st_corp', invoiceNo: 'SM-7874', billDate: '2026-11-03', dueDate: '2026-11-30', lines: sec(4) });
  // Ice supplier HM15: September paid late, October past due; November's invoice hasn't been entered (it shows on their statement).
  add({ vendorId: 'pt_ice', storeId: 'st_hm15', invoiceNo: 'IC-2291', billDate: '2026-09-15', dueDate: '2026-10-15', lines: one('acct_cogs_grocery', 'st_hm15', 455), pay: check('2026-11-18') });
  add({ vendorId: 'pt_ice', storeId: 'st_hm15', invoiceNo: 'IC-2364', billDate: '2026-10-15', dueDate: '2026-11-14', lines: one('acct_cogs_grocery', 'st_hm15', 482.5) });
  // One-offs.
  add({ vendorId: 'pt_signs', storeId: 'st_hm17', invoiceNo: 'SL-0412', billDate: '2026-10-20', dueDate: '2026-11-04', lines: one('acct_repairs', 'st_hm17', 1_850, 'Canopy lighting and pylon sign for opening'), pay: check('2026-11-03') });
  add({ vendorId: 'pt_office', storeId: 'st_corp', invoiceNo: 'OS-55821', billDate: '2026-10-08', dueDate: '2026-11-07', lines: one('acct_supplies', 'st_corp', 286.4), pay: { date: '2026-10-12', method: 'card', confirmation: 'Card ending 0000 (demo)' } });
  // Waiting for approval: entered from the bills inbox by the bookkeeper.
  add({ vendorId: 'pt_kitchen_svc', storeId: 'st_hm15', invoiceNo: 'KS-3318', billDate: '2026-11-20', dueDate: '2026-12-05', lines: one('acct_repairs', 'st_hm15', 1_240, 'Fryer thermostat and hood fan repair'), approve: false, source: 'inbox', by: 'usr_bk' });
  return out;
}

/** Bills across vendors (a few unpaid: one past due, one due in 3 days and unscheduled, one awaiting approval), utility accounts with history, and a vendor statement. */
export function seedPayables({ state, books, cfo, setClock }: SeedCtx): void {
  state.parties.push(...structuredClone(VENDORS));
  state.payables.utilities.push(...structuredClone(UTILITIES));
  const all = bills().sort((a, b) => a.billDate.localeCompare(b.billDate));
  // Enter and approve on the bill date, schedule and pay on their own dates, in date order across bills.
  type Step = { date: string; run: () => void };
  const steps: Step[] = [];
  for (const b of all) {
    let id = '';
    const by = state.users.find((u) => u.id === (b.by ?? cfo.id))!;
    steps.push({ date: b.billDate, run: () => { id = saveBill(books, by, b).id; if (b.approve) approveBill(books, cfo, id); } });
    if (b.schedule) steps.push({ date: b.billDate, run: () => scheduleBill(books, cfo, id, b.schedule!) });
    if (b.pay) steps.push({ date: b.pay.date, run: () => payBill(books, cfo, id, b.pay!) });
  }
  steps.sort((a, b) => a.date.localeCompare(b.date));
  for (const s of steps) { setClock(s.date); s.run(); }
  setClock('2026-11-21');
  saveVendorStatement(books, cfo, {
    vendorId: 'pt_ice', date: '2026-11-20', balance: c(1_359.25), note: 'Monthly statement (demo).',
    lines: [{ invoiceNo: 'IC-2291', date: '2026-09-15', amount: c(455) }, { invoiceNo: 'IC-2364', date: '2026-10-15', amount: c(482.5) }, { invoiceNo: 'IC-2433', date: '2026-11-15', amount: c(415) }],
  });
}
