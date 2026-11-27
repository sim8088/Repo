import type { SeedCtx } from './seed';
import type { Attachment, ComplianceItem, LicenseKind } from '../core/types';
import { saveComplianceItem, updateOccurrence, saveLicense, savePolicy, saveLease, saveNotice, uploadToVault, updateDocMeta, attachToCompliance, type ItemDraft } from '../core/compliance';
import { attachToAsset } from '../core/assets';

const c = (dollars: number) => Math.round(dollars * 100);

/** Metadata for a demo document. The files themselves aren't in the demo, only their records. */
function doc(id: string, name: string, addedAt: string): Attachment {
  return { id, name, mime: 'application/pdf', size: 180_000 + (name.length * 3_517) % 90_000, addedAt: addedAt + 'T15:00:00.000Z', addedBy: 'usr_cfo' };
}

/**
 * Compliance demo: the filing calendar (one overdue report, a few items due within 30 days), licenses and permits per
 * store (one expiring within 30 days), insurance policies, leases, one IRS notice open and one closed, and a few
 * documents in the vault. Generic names and numbers only.
 */
export function seedCompliance({ state, books, cfo, setClock }: SeedCtx): void {
  setClock('2026-09-01');
  const item = (id: string, d: Omit<ItemDraft, 'active' | 'needsPayment'> & { needsPayment?: boolean }): ComplianceItem => {
    const it = saveComplianceItem(books, cfo, { needsPayment: false, active: true, ...d });
    it.id = id;
    return it;
  };
  const salesTax = item('cmp_sales_tax', { kind: 'sales_tax', title: 'Sales tax return (all stores)', agency: 'State revenue department', form: 'Monthly sales & use tax return', recurrence: { every: 'monthly', firstDue: '2026-10-20', coversMonthsBefore: 1 }, needsPayment: true, owner: 'Bookkeeper', notes: 'One consolidated return; remitted by ACH debit when filed.' });
  const ust = item('cmp_ust_fee', { kind: 'fuel_excise', title: 'UST environmental fee report', agency: 'State environmental quality office', form: 'Quarterly gallons report', recurrence: { every: 'quarterly', firstDue: '2026-10-31', coversMonthsBefore: 1 }, needsPayment: true, notes: 'Fuel excise is remitted by our suppliers; we report gallons received for the tank fee.' });
  const f941 = item('cmp_941', { kind: 'payroll', title: 'Federal payroll return', agency: 'IRS', form: 'Form 941', recurrence: { every: 'quarterly', firstDue: '2026-10-31', coversMonthsBefore: 1 }, owner: 'Gusto files; CFO checks', notes: 'Deposits are made by Gusto on each pay date.' });
  const stw = item('cmp_state_wh', { kind: 'payroll', title: 'State withholding & unemployment return', agency: 'State revenue & employment departments', recurrence: { every: 'quarterly', firstDue: '2026-10-31', coversMonthsBefore: 1 }, owner: 'Gusto files; CFO checks' });
  item('cmp_w2', { kind: 'payroll', title: 'W-2s and 1099-NECs to employees, vendors and agencies', agency: 'IRS / SSA', form: 'W-2, W-3, 1099-NEC', recurrence: { every: 'annual', firstDue: '2027-01-31', coversMonthsBefore: 1 }, owner: 'CFO' });
  item('cmp_franchise_est', { kind: 'income_tax', title: 'State income & franchise tax estimate (Q4)', agency: 'State revenue department', recurrence: { every: 'once', firstDue: '2026-12-15' }, needsPayment: true, entityId: 'ent_corp' });
  item('cmp_1120s', { kind: 'income_tax', title: 'Corporate income tax return', agency: 'IRS', form: 'Form 1120-S', entityId: 'ent_corp', recurrence: { every: 'annual', firstDue: '2027-03-15', coversMonthsBefore: 3 }, owner: 'Outside CPA firm', notes: 'Extension (Form 7004) if the CPA package is late.' });
  item('cmp_prop_tax', { kind: 'property_tax', title: 'County property tax (all stores)', agency: 'County tax collectors', recurrence: { every: 'annual', firstDue: '2027-01-31', coversMonthsBefore: 1 }, needsPayment: true, notes: 'Paid in arrears for the prior year; booked to prepaid and amortized (SPEC §6.10).' });
  item('cmp_annual_report', { kind: 'annual_report', title: 'Annual reports (every entity)', agency: 'Secretary of State', recurrence: { every: 'annual', firstDue: '2027-04-15' }, needsPayment: true, notes: 'Fee is in the annual-fees prepaid.' });

  // Filed history: September and October sales tax are filed and remitted (the month's 2200 balance by store, by ACH),
  // and the Q3 payroll returns are filed. The Q3 UST report is overdue.
  const remit = (period: string, date: string, conf: string) => {
    setClock(date);
    const byStore = new Map<string, number>();
    for (const t of state.transactions) {
      if (t.deleted || !t.date.startsWith(period) || t.tags.includes('sales tax')) continue; // the month's collections, not last month's remittance
      for (const l of t.lines) if (l.accountId === 'acct_sales_tax') byStore.set(l.storeId, (byStore.get(l.storeId) ?? 0) + l.credit - l.debit);
    }
    const total = [...byStore.values()].reduce((a, b) => a + b, 0);
    const tx = books.createTransaction(cfo, {
      date, kind: 'money_out', description: 'ACH DEBIT STATE REVENUE SALES TAX', tags: ['sales tax'], docNo: conf, memo: `Sales tax for ${period}`,
      lines: [...[...byStore].filter(([, v]) => v).map(([storeId, v]) => ({ accountId: 'acct_sales_tax', storeId, debit: v, credit: 0 })), { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: total }],
    }, { source: 'demo', batchId: 'demo-2026Q4' });
    return { tx, total };
  };
  const sep = remit('2026-09', '2026-10-19', 'ST-DEMO-20261019');
  updateOccurrence(books, cfo, salesTax.id, '2026-10-20', { status: 'paid', filedOn: '2026-10-19', paidOn: '2026-10-19', paidAmount: sep.total, txnId: sep.tx.id, confirmation: 'ST-DEMO-20261019', note: 'September return.' });
  setClock('2026-10-28');
  updateOccurrence(books, cfo, f941.id, '2026-10-31', { status: 'accepted', filedOn: '2026-10-28', confirmation: '941-DEMO-Q3' });
  updateOccurrence(books, cfo, stw.id, '2026-10-31', { status: 'filed', filedOn: '2026-10-28', confirmation: 'SW-DEMO-Q3' });
  const oct = remit('2026-10', '2026-11-19', 'ST-DEMO-20261119');
  updateOccurrence(books, cfo, salesTax.id, '2026-11-20', { status: 'paid', filedOn: '2026-11-19', paidOn: '2026-11-19', paidAmount: oct.total, txnId: oct.tx.id, confirmation: 'ST-DEMO-20261119', note: 'October return.' });
  setClock('2026-11-24');
  updateOccurrence(books, cfo, salesTax.id, '2026-12-20', { status: 'in_prep', note: 'November sales still closing.' });
  void ust;

  // ── Licenses and permits per store. HM13's beer permit expires within 30 days.
  const stores: [string, string, boolean, boolean][] = [['st_hm11', 'HM11', true, true], ['st_hm13', 'HM13', true, true], ['st_hm15', 'HM15', false, true], ['st_hm17', 'HM17', true, false]];
  setClock('2026-09-02');
  let n = 0;
  const lic = (storeId: string, code: string, kind: LicenseKind, name: string, issuer: string, expiresOn: string, fee: number, issuedOn?: string) => {
    n += 1;
    return saveLicense(books, cfo, { kind, storeId, name: `${code} ${name}`, issuer, number: `DEMO-${code}-${kind.slice(0, 3).toUpperCase()}-${String(100 + n)}`, expiresOn, issuedOn, renewalFee: c(fee) });
  };
  for (const [id, code, alcohol, kitchen] of stores) {
    const opened = id === 'st_hm17';
    if (alcohol) lic(id, code, 'beer', 'beer & light wine permit', 'State alcohol control division', id === 'st_hm13' ? '2026-12-15' : opened ? '2027-10-31' : '2027-06-30', 500, opened ? '2026-11-01' : undefined);
    lic(id, code, 'tobacco', 'tobacco retail permit', 'State revenue department', opened ? '2027-10-31' : '2027-06-30', 300);
    if (kitchen) lic(id, code, 'food_service', 'food service permit', 'State health department', '2027-03-31', 250);
    lic(id, code, 'ust', 'UST operating permit', 'State environmental quality office', '2027-08-31', 400);
    lic(id, code, 'business', 'city business license', 'City clerk', '2027-01-31', 150);
    lic(id, code, 'lottery', 'lottery retailer license', 'State lottery corporation', '2027-09-30', 0);
  }

  // ── Insurance policies.
  setClock('2026-09-03');
  const all = ['st_hm11', 'st_hm13', 'st_hm15', 'st_hm17', 'st_hm14', 'st_corp'];
  const p1 = savePolicy(books, cfo, { kind: 'property', carrier: 'Carrier A (demo)', policyNo: 'PKG-DEMO-2026', storeIds: all, effective: '2026-05-01', expires: '2027-05-01', premium: c(82_080), deductible: c(5_000), limit: c(2_000_000), notes: 'Property & general liability package, paid in monthly installments of $6,840 (expensed as paid).' });
  const p2 = savePolicy(books, cfo, { kind: 'umbrella', carrier: 'Carrier B (demo)', policyNo: 'UMB-DEMO-2026', storeIds: ['st_corp'], effective: '2026-05-01', expires: '2027-05-01', premium: c(14_400), limit: c(5_000_000), prepaidId: 'ppd_umbrella' });
  const p3 = savePolicy(books, cfo, { kind: 'pollution', carrier: 'Carrier C (demo)', policyNo: 'UST-DEMO-2026', storeIds: ['st_hm11', 'st_hm13', 'st_hm15', 'st_hm17'], effective: '2026-07-01', expires: '2027-07-01', premium: c(6_720), deductible: c(10_000), limit: c(1_000_000), prepaidId: 'ppd_pollution', notes: 'Meets the UST financial-responsibility requirement.' });
  const p4 = savePolicy(books, cfo, { kind: 'workers_comp', carrier: 'Carrier A (demo)', policyNo: 'WC-DEMO-2026', storeIds: all, effective: '2026-01-01', expires: '2027-01-01', premium: c(9_600), notes: 'Pay-as-you-go through payroll; audit after year end.' });
  const p5 = savePolicy(books, cfo, { kind: 'liquor', carrier: 'Carrier B (demo)', policyNo: 'LIQ-DEMO-2026', storeIds: ['st_hm11', 'st_hm13', 'st_hm17'], effective: '2026-03-01', expires: '2027-03-01', premium: c(2_250), limit: c(1_000_000) });
  for (const [p, id] of [[p1, 'pol_package'], [p2, 'pol_umbrella'], [p3, 'pol_pollution'], [p4, 'pol_wc'], [p5, 'pol_liquor']] as const) p.id = id;

  // ── Leases: the stores rent from Dhunna / SKD (the rent pass-throughs); we let space to tenants.
  setClock('2026-09-04');
  const rent = (storeId: string) => state.intercompany.rentTemplates.find((t) => t.storeId === storeId)?.amount ?? 0;
  saveLease(books, cfo, { side: 'we_rent', counterparty: 'Dhunna Development', partyId: 'pt_dhunna', storeId: 'st_hm11', premises: 'HM11 land & building', start: '2019-06-01', end: '2034-05-31', monthlyRent: rent('st_hm11'), escalation: 'Rent follows the mortgage payment', renewalOptions: 'Two 5-year options', noticeDays: 180 });
  saveLease(books, cfo, { side: 'we_rent', counterparty: 'Dhunna Development', partyId: 'pt_dhunna', storeId: 'st_hm13', premises: 'HM13 land & building', start: '2021-03-01', end: '2031-02-28', monthlyRent: rent('st_hm13'), escalation: 'Rent follows the mortgage payment', noticeDays: 180 });
  saveLease(books, cfo, { side: 'we_rent', counterparty: 'SKD Properties', partyId: 'pt_skd', storeId: 'st_hm15', premises: 'HM15 land, building & truck lane', start: '2022-01-01', end: '2036-12-31', monthlyRent: rent('st_hm15'), escalation: 'Rent follows the mortgage payment', noticeDays: 180 });
  saveLease(books, cfo, { side: 'we_let', counterparty: 'Taco Feliz', partyId: 'pt_taco_feliz', storeId: 'st_hm11', premises: 'HM11 restaurant unit', start: '2024-03-01', end: '2027-02-28', monthlyRent: c(2_800), escalation: '3% a year on renewal', renewalOptions: 'One 3-year option', noticeDays: 90 });
  saveLease(books, cfo, { side: 'we_let', counterparty: 'Mavs Booster Club', partyId: 'pt_mavs', storeId: 'st_hm11', premises: 'HM11 storage room', start: '2025-08-01', end: '2027-07-31', monthlyRent: c(650) });
  saveLease(books, cfo, { side: 'we_let', counterparty: 'Laundromat', partyId: 'pt_laundry', storeId: 'st_hm13', premises: 'HM13 side unit', start: '2025-01-01', end: '2027-12-31', monthlyRent: c(1_100), noticeDays: 60 });
  saveLease(books, cfo, { side: 'we_let', counterparty: 'Gulfport operator', partyId: 'pt_gulfport_op', storeId: 'st_hm14', premises: 'Gulfport store (whole site)', start: '2023-01-01', end: '2028-12-31', monthlyRent: c(8_500), escalation: 'CPI each January', renewalOptions: 'Two 5-year options', noticeDays: 180 });

  // ── Notices: one IRS letter open, one state letter closed.
  setClock('2026-09-16');
  const closed = saveNotice(books, cfo, { agency: 'State revenue department', noticeType: 'Sales tax balance due notice', entityId: 'ent_hm13', storeId: 'st_hm13', taxPeriod: '2026-07', received: '2026-09-14', deadline: '2026-10-14', amount: c(186.4), summary: 'Says the July return was short $186.40.', status: 'open' });
  setClock('2026-10-08');
  saveNotice(books, cfo, { ...closed, status: 'closed', response: 'Sent the July return worksheet and ACH confirmation showing the full payment.', respondedOn: '2026-09-22', outcome: 'Abated: the department applied the payment to the wrong period. No balance due.' });
  setClock('2026-11-13');
  saveNotice(books, cfo, { agency: 'IRS', noticeType: 'CP-DEMO-210 (Form 941 deposit discrepancy)', entityId: 'ent_corp', storeId: 'st_corp', taxPeriod: '2026Q2', received: '2026-11-12', deadline: '2026-12-14', amount: c(412.37), summary: 'Q2 2026 Form 941 deposits do not match the return; proposes a $412.37 failure-to-deposit penalty.', status: 'in_progress', response: undefined });

  // ── Documents: the signed records sit on their compliance and asset records, tagged in the vault; two standalone uploads.
  const c9 = state.compliance!;
  const onRecord: [string, string, string, string, string[], () => void][] = [
    ['doc_lease_hm11', 'HM11 lease – Dhunna Development.pdf', 'Lease', '2026-09-04', ['lease', 'related party'], () => attachToCompliance(books, cfo, { kind: 'lease', id: c9.leases.find((l) => l.storeId === 'st_hm11' && l.side === 'we_rent')!.id }, doc('doc_lease_hm11', 'HM11 lease – Dhunna Development.pdf', '2026-09-04'))],
    ['doc_pkg_policy', 'Package policy declarations 2026-27.pdf', 'Insurance policy', '2026-09-03', ['insurance', 'renewal'], () => attachToCompliance(books, cfo, { kind: 'policy', id: 'pol_package' }, doc('doc_pkg_policy', 'Package policy declarations 2026-27.pdf', '2026-09-03'))],
    ['doc_cp_notice', 'IRS letter 941 Q2.pdf', 'Tax notice', '2026-11-13', ['irs', 'payroll', 'open'], () => attachToCompliance(books, cfo, { kind: 'notice', id: c9.notices.find((n) => n.agency === 'IRS')!.id }, doc('doc_cp_notice', 'IRS letter 941 Q2.pdf', '2026-11-13'))],
    ['doc_hm13_beer', 'HM13 beer permit 2025-26.pdf', 'License / permit', '2026-09-02', ['permit', 'renewal due'], () => attachToCompliance(books, cfo, { kind: 'license', id: c9.licenses.find((l) => l.storeId === 'st_hm13' && l.kind === 'beer')!.id }, doc('doc_hm13_beer', 'HM13 beer permit 2025-26.pdf', '2026-09-02'))],
    ['doc_ust_test', 'HM13 tank tightness test Sep 2026.pdf', 'Inspection report', '2026-09-10', ['ust', 'environmental'], () => attachToAsset(books, cfo, { kind: 'maintenance', id: state.assets!.maintenance.find((m) => m.assetId === 'fa_hm13_ust')!.id }, doc('doc_ust_test', 'HM13 tank tightness test Sep 2026.pdf', '2026-09-10'))],
  ];
  for (const [id, , docType, at, tags, put] of onRecord) {
    setClock(at);
    put();
    updateDocMeta(books, cfo, id, { docType, tags });
  }
  setClock('2026-10-02');
  uploadToVault(books, cfo, doc('doc_cpa_engagement', 'CPA engagement letter 2026.pdf', '2026-10-02'), { docType: 'Engagement letter', tags: ['cpa', 'tax'], partyId: 'pt_cpa' });
  // A Craddock statement uploaded but not linked to anything yet.
  setClock('2026-11-24');
  uploadToVault(books, cfo, doc('doc_unlinked', 'Craddock statement Nov 2026.pdf', '2026-11-24'), { docType: 'Statement', tags: ['fuel'] });
  updateDocMeta(books, cfo, 'doc_unlinked', { note: 'Check against the November notices, then link it.' });
}
