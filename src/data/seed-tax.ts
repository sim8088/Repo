import type { SeedCtx } from './seed';
import type { TaxDepreciation } from '../core/types';
import { emptyTax, recordEstimatePayment, saveAdjustment, saveEstimatePlan, saveMethodChange, saveTaxProfile, setLever, setOwnerStart, setPriorIncome, setReceipts, reviewAdjustment } from '../core/tax';
import { saveComplianceItem, updateOccurrence, uploadToVault } from '../core/compliance';

const c = (dollars: number) => Math.round(dollars * 100);

/**
 * Tax demo (phase 11): owners and % per entity, the tax kinds on the calendar (one return due within 30 days), sales
 * tax with one month collected ≠ remitted, tax elections on the assets (bonus on HM17's equipment, §179 on some),
 * prior-year safe harbors, estimates (Q3 PTE paid by the entity through the ledger, Q4 due within 14 days), and the
 * meals and penalty adjustments. Generic owners (Owner A / Owner B), fake EINs, illustrative numbers.
 */
export function seedTax({ state, books, cfo, setClock }: SeedCtx): void {
  state.tax = emptyTax();
  setClock('2026-09-02');
  // ── Entities: fake EINs; HM14 (the Gulfport property) files its own partnership return.
  state.entities.forEach((e, i) => { e.ein = `00-000000${i + 1}`; });
  state.entities.find((e) => e.id === 'ent_hm14')!.taxClass = 'partnership_1065';
  uploadToVault(books, cfo, { id: 'doc_1120s_2025', name: '2025 Form 1120-S (CPA copy).pdf', mime: 'application/pdf', size: 412_000, addedAt: '2026-09-02T15:00:00.000Z', addedBy: cfo.id }, { docType: 'Tax return', tags: ['tax return', '2025'], storeId: 'st_corp' });
  const states = (kinds: string[], code: string) => kinds.map((kind, i) => ({ state: 'MS', kind, accountNo: `DEMO-${code}-${i + 1}` }));
  saveTaxProfile(books, cfo, {
    entityId: 'ent_corp', owners: [{ partyId: 'pt_owner_a', pctBps: 6000 }, { partyId: 'pt_owner_b', pctBps: 4000 }], states: states(['Income & franchise', 'Withholding', 'Unemployment', 'Sales & use'], 'CORP'),
    fiscalYearEndMonth: 12, preparer: 'Outside CPA firm (demo)', method: 'accrual', inventoryMethod: 'fifo',
    priorReturns: [{ year: 2025, docId: 'doc_1120s_2025', location: 'Document vault' }, { year: 2024, location: 'CPA portal (paper copy in the office safe)' }],
    notes: 'The store entities are single-member LLCs owned by the S corporation, so their income is on its return.',
  });
  for (const id of ['ent_hm11', 'ent_hm13', 'ent_hm15', 'ent_hm17']) {
    const code = id.slice(4).toUpperCase();
    saveTaxProfile(books, cfo, { entityId: id, owners: [], parentEntityId: 'ent_corp', states: states(['Sales & use', 'Tobacco retailer'], code), fiscalYearEndMonth: 12, priorReturns: [], method: 'accrual', inventoryMethod: 'fifo' });
  }
  saveTaxProfile(books, cfo, {
    entityId: 'ent_hm14', owners: [{ partyId: 'pt_owner_a', pctBps: 5000 }, { partyId: 'pt_owner_b', pctBps: 5000 }], states: states(['Income & franchise'], 'HM14'), fiscalYearEndMonth: 12,
    preparer: 'Outside CPA firm (demo)', method: 'cash', inventoryMethod: 'books_471c', priorReturns: [{ year: 2025, location: 'CPA portal' }], notes: 'Rental property; no inventory.',
  });

  // ── Calendar: the tax kinds. The tobacco report due 15 Dec is the return due within 30 days.
  const item = (id: string, d: Parameters<typeof saveComplianceItem>[2]) => { const it = saveComplianceItem(books, cfo, d); it.id = id; return it; };
  const otp = item('cmp_tobacco', { kind: 'tobacco_excise', title: 'Tobacco products (OTP) report', agency: 'State revenue department', form: 'Monthly OTP report', recurrence: { every: 'monthly', firstDue: '2026-10-15', coversMonthsBefore: 1 }, needsPayment: false, active: true, owner: 'Bookkeeper', notes: 'The excise is paid by the licensed wholesaler; we report purchases.' });
  item('cmp_1065_hm14', { kind: 'income_tax', title: 'Partnership return – HM14', agency: 'IRS', form: 'Form 1065 + K-1s', entityId: 'ent_hm14', recurrence: { every: 'annual', firstDue: '2027-03-15', coversMonthsBefore: 3 }, needsPayment: false, active: true, owner: 'Outside CPA firm' });
  item('cmp_state_income', { kind: 'state_income', title: 'State income & franchise return (CORP group)', agency: 'State revenue department', entityId: 'ent_corp', recurrence: { every: 'annual', firstDue: '2027-03-15', coversMonthsBefore: 3 }, needsPayment: true, active: true, owner: 'Outside CPA firm' });
  item('cmp_1099', { kind: 'info_1099', title: '1099-NEC to vendors and the IRS', agency: 'IRS', form: '1099-NEC, 1096', recurrence: { every: 'annual', firstDue: '2027-01-31', coversMonthsBefore: 1 }, needsPayment: false, active: true, owner: 'CFO' });
  setClock('2026-10-14');
  updateOccurrence(books, cfo, otp.id, '2026-10-15', { status: 'accepted', filedOn: '2026-10-14', confirmation: 'OTP-DEMO-2609' });
  setClock('2026-11-13');
  updateOccurrence(books, cfo, otp.id, '2026-11-15', { status: 'filed', filedOn: '2026-11-13', confirmation: 'OTP-DEMO-2610' });

  // ── Transactions the workpapers read: business meals (50%), a late-filing penalty, and an HM15 catering order
  //    invoiced outside the POS whose sales tax didn't make the October return (collected ≠ remitted).
  const post = (date: string, description: string, accountId: string, storeId: string, amount: number, tags: string[]) => {
    setClock(date);
    return books.createTransaction(cfo, { date, kind: 'money_out', description, tags, lines: [{ accountId, storeId, debit: c(amount), credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: c(amount) }] }, { source: 'demo', batchId: 'demo-2026Q4' });
  };
  post('2026-09-18', 'BUSINESS MEAL SUPPLIER REVIEW (DEMO)', 'acct_meals', 'st_corp', 420, ['meals']);
  post('2026-10-22', 'BUSINESS MEAL LENDER MEETING (DEMO)', 'acct_meals', 'st_corp', 560, ['meals']);
  post('2026-11-12', 'BUSINESS MEAL STORE MANAGERS (DEMO)', 'acct_meals', 'st_corp', 380, ['meals']);
  const pen = post('2026-10-14', 'STATE REVENUE LATE-FILING PENALTY', 'acct_penalties', 'st_hm13', 150, ['tax', 'penalty']);
  setClock('2026-10-28');
  books.createTransaction(cfo, { date: '2026-10-28', kind: 'money_in', description: 'DEPOSIT CATERING ORDER HM15 (INVOICED)', tags: ['catering'], memo: 'Invoiced outside the POS; 7% sales tax collected on the invoice.', lines: [
    { accountId: 'acct_trustmark', storeId: 'st_corp', debit: c(1_605), credit: 0 }, { accountId: 'acct_other_income', storeId: 'st_hm15', debit: 0, credit: c(1_500) }, { accountId: 'acct_sales_tax', storeId: 'st_hm15', debit: 0, credit: c(105) },
  ] }, { source: 'demo', batchId: 'demo-2026Q4' });

  // ── Tax elections on the Phase 9 assets (per the prior returns, illustrative).
  const assets = state.assets!.assets;
  const elect = (id: string, t: Omit<TaxDepreciation, 'method'>) => { const a = assets.find((x) => x.id === id); if (a) a.tax = { method: 'macrs', ...t }; };
  const prior = 'Per the prior-year depreciation schedule (demo).';
  for (const a of assets) {
    if (a.storeId === 'st_hm17' || a.storeId === 'st_hm14') continue;
    const y = Number(a.inService.slice(0, 4));
    const bonus = y <= 2022 ? 100 : y === 2023 ? 80 : y === 2024 ? 60 : a.inService < '2025-01-20' ? 40 : 100;
    elect(a.id, { bonusPct: bonus, notes: prior });
  }
  elect('fa_hm11_kitchen', { section179: c(20_800), bonusPct: 0, notes: '§179 elected on the 2025 return (demo).' });
  elect('fa_hm15_truck', { section179: c(40_000), bonusPct: 0, notes: '§179 on part of the cost, bonus elected out for 5-year property in 2025 (demo).' });
  for (const k of ['disp', 'cooler', 'pos', 'fixtures']) elect(`fa_hm17_${k}`, { bonusPct: 100, notes: '100% bonus on the new store\'s equipment (2026).' });
  elect('fa_hm17_canopy', { recoveryYears: 15, bonusPct: 0, costSegFlag: true, notes: '15-year; bonus elected out for the 15-year class in 2026 (demo).' });
  elect('fa_hm17_ust', { recoveryYears: 15, bonusPct: 0, costSegFlag: true, notes: '15-year; bonus elected out for the 15-year class in 2026 (demo).' });
  const bldg = assets.find((x) => x.id === 'fa_hm14_bldg');
  if (bldg) bldg.tax = { method: 'none', costSegFlag: true, notes: 'Pending a cost segregation study: land (not depreciable) vs building, with canopies, USTs and site work at 15 years.' };

  // ── Book income before these books (Jan–Aug, from the prior system), owner basis, prior-year receipts.
  setClock('2026-09-03');
  setPriorIncome(books, cfo, { entityId: 'ent_corp', year: 2026, priorIncome: c(186_000), note: 'January–August 2026 from the prior bookkeeping system (demo).' });
  setPriorIncome(books, cfo, { entityId: 'ent_hm14', year: 2026, priorIncome: c(68_000), note: 'January–August 2026 rent less expenses (demo).' });
  for (const [eid, a, b] of [['ent_corp', [210_000, 150_000], [140_000, 100_000]], ['ent_hm14', [300_000, 290_000], [300_000, 290_000]]] as const) {
    setOwnerStart(books, cfo, { entityId: eid, partyId: 'pt_owner_a', year: 2026, basis: c(a[0]), capital: c(a[1]), contributions: 0 });
    setOwnerStart(books, cfo, { entityId: eid, partyId: 'pt_owner_b', year: 2026, basis: c(b[0]), capital: c(b[1]), contributions: 0 });
  }
  for (const [y, corp, hm14] of [[2023, 10_800_000, 96_000], [2024, 11_600_000, 99_000], [2025, 12_400_000, 102_000]] as const) {
    setReceipts(books, cfo, { entityId: 'ent_corp', year: y, receipts: c(corp) });
    setReceipts(books, cfo, { entityId: 'ent_hm14', year: y, receipts: c(hm14) });
  }
  saveMethodChange(books, cfo, { entityId: 'ent_hm14', year: 2025, description: 'HM14: overall method from accrual to cash (small business taxpayer, automatic change)', dcn: '233', status: 'accepted', filedOn: '2026-03-12', adj481: -c(4_200), notes: 'Negative §481(a) adjustment taken in full in 2025 (demo).' });
  saveMethodChange(books, cfo, { entityId: 'ent_corp', year: 2026, description: 'CORP group: inventory to the §471(c) books method', status: 'considering', notes: 'Discuss with the CPA before year end.' });

  // ── Estimates: prior-year safe harbors; the owners pay theirs personally; Corporate's PTE estimate is paid by the
  //    entity through the ledger (6250), and its Q4 is due within 14 days.
  const fed = ['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15'];
  const a = saveEstimatePlan(books, cfo, { id: 'est_owner_a', payer: 'owner', partyId: 'pt_owner_a', jurisdiction: 'federal', year: 2026, dueDates: fed, priorYearTax: c(36_000), highIncome: true, entityIds: ['ent_corp', 'ent_hm14'], note: 'Prior-year AGI over $150,000: 110% safe harbor.' });
  const b = saveEstimatePlan(books, cfo, { id: 'est_owner_b', payer: 'owner', partyId: 'pt_owner_b', jurisdiction: 'federal', year: 2026, dueDates: fed, priorYearTax: c(24_000), highIncome: false, entityIds: ['ent_corp', 'ent_hm14'] });
  const pte = saveEstimatePlan(books, cfo, { id: 'est_corp_pte', payer: 'entity', entityId: 'ent_corp', jurisdiction: 'state', year: 2026, dueDates: ['2026-04-15', '2026-06-15', '2026-09-15', '2026-12-10'], priorYearTax: c(4_000), highIncome: false, entityIds: ['ent_corp'], note: 'Elective pass-through entity tax; the demo state\'s Q4 date.' });
  setClock('2026-09-04');
  for (const [q, date] of [[1, '2026-04-14'], [2, '2026-06-12']] as const) {
    recordEstimatePayment(books, cfo, { planId: a.id, quarter: q, date, amount: c(9_900), paidBy: 'owner', confirmation: `EFTPS-DEMO-A${q}` });
    recordEstimatePayment(books, cfo, { planId: b.id, quarter: q, date, amount: c(6_000), paidBy: 'owner', confirmation: `EFTPS-DEMO-B${q}` });
    recordEstimatePayment(books, cfo, { planId: pte.id, quarter: q, date, amount: c(1_000), paidBy: 'entity', post: false, confirmation: `PTE-DEMO-${q}` });
  }
  setClock('2026-09-14');
  recordEstimatePayment(books, cfo, { planId: a.id, quarter: 3, date: '2026-09-14', amount: c(9_900), paidBy: 'owner', confirmation: 'EFTPS-DEMO-A3' });
  recordEstimatePayment(books, cfo, { planId: b.id, quarter: 3, date: '2026-09-14', amount: c(6_000), paidBy: 'owner', confirmation: 'EFTPS-DEMO-B3' });
  recordEstimatePayment(books, cfo, { planId: pte.id, quarter: 3, date: '2026-09-14', amount: c(1_000), paidBy: 'entity', entityId: 'ent_corp', confirmation: 'PTE-DEMO-3' });

  // ── Workpapers for the meals and penalty adjustments; planning levers.
  setClock('2026-11-20');
  saveAdjustment(books, cfo, { entityId: 'ent_corp', year: 2026, kind: 'meals', mode: 'auto', workpaper: 'Business meals with suppliers, the lender and store managers; receipts and attendees are on each transaction. 50% is not deductible (§274(n)).' });
  saveAdjustment(books, cfo, { entityId: 'ent_corp', year: 2026, kind: 'penalties', mode: 'auto', workpaper: `HM13 late-filing penalty (${pen.ref}). Fines and penalties paid to a government are not deductible (§162(f)).` });
  saveAdjustment(books, cfo, { entityId: 'ent_corp', year: 2026, kind: 'owner', mode: 'auto', workpaper: 'Owner withdrawals post to 6900 Miscellaneous under the current policy (SPEC §6.6). They are distributions, so they come back out of the deduction.' });
  const bk = state.users.find((u) => u.role === 'bookkeeper')!;
  reviewAdjustment(books, bk, 'ent_corp', 2026, 'penalties');
  setLever(books, cfo, 'ent_corp', 2026, 'equipment', c(50_000));
  setLever(books, cfo, 'ent_corp', 2026, 'retirement', c(20_000));
}
