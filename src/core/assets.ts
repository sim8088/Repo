import type { Books } from './books';
import { ValidationError } from './books';
import type { AssetClass, AssetsState, Attachment, BooksState, FixedAsset, ID, MaintenanceEntry, Transaction, User } from './types';
import { formatMoney, type Cents } from './money';
import { addDays, daysBetween, isValidDate, lastDayOfPeriod, periodLabel, periodOf, periodsBetween } from './dates';
import { storeBalance } from './fuel';
import { bankStoreId } from './bank';

export const ACCUM_DEP = 'acct_accum_dep';
export const DEP_EXPENSE = 'acct_depreciation';
export const DISPOSAL_ACCOUNT = 'acct_disposal';
export const CLASS_LABEL: Record<AssetClass, string> = {
  dispensers: 'Dispensers', canopy: 'Canopy & lighting', tanks: 'Tanks & piping (UST)', coolers: 'Coolers & refrigeration', kitchen: 'Kitchen equipment', pos: 'POS & security',
  equipment: 'Other equipment', fixtures: 'Store fixtures', building_improvements: 'Building improvements', building: 'Building', land: 'Land',
};
/** Typical book lives in months, used as defaults on the form. */
export const DEFAULT_LIFE: Record<AssetClass, number> = {
  dispensers: 120, canopy: 180, tanks: 240, coolers: 84, kitchen: 60, pos: 36, equipment: 84, fixtures: 96, building_improvements: 180, building: 468, land: 0,
};
export const MAINT_LABEL: Record<MaintenanceEntry['kind'], string> = { repair: 'Repair', service: 'Service', inspection: 'Inspection', calibration: 'Calibration' };

export function emptyAssets(): AssetsState {
  return { assets: [], maintenance: [], prepaids: [], loans: [] };
}

/** Books saved before phase 9 have no assets slice: read it as empty. */
export function assetsOf(state: BooksState): AssetsState {
  return { ...emptyAssets(), ...(state.assets ?? {}) };
}

export function ensureAssets(books: Books): AssetsState {
  if (!books.state.assets) books.state.assets = emptyAssets();
  const a = books.state.assets;
  for (const k of ['assets', 'maintenance', 'prepaids', 'loans'] as const) if (!a[k]) (a as unknown as Record<string, unknown[]>)[k] = [];
  return a;
}

function addMonths(period: string, n: number): string {
  let [y, m] = period.split('-').map(Number);
  m += n;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function monthIndex(a: Pick<FixedAsset, 'inService'>, period: string): number {
  const [y0, m0] = a.inService.slice(0, 7).split('-').map(Number);
  const [y, m] = period.split('-').map(Number);
  return (y - y0) * 12 + (m - m0);
}

// ── Book depreciation (straight line, full-month convention) ─────────────
/**
 * Accumulated book depreciation through the end of a period by the schedule: cost less salvage, spread evenly over
 * the life, starting in the month placed in service. Cumulative amounts are rounded, so the months always add to the
 * depreciable base exactly. Stops at the disposal (no depreciation in the month of disposal).
 */
export function scheduledAccum(a: FixedAsset, period: string): Cents {
  if (a.method !== 'straight_line' || a.lifeMonths <= 0) return 0;
  let last = period;
  if (a.disposal) {
    const before = addMonths(periodOf(a.disposal.date), -1);
    if (before < last) last = before;
  }
  const k = monthIndex(a, last) + 1; // months elapsed through `last`
  if (k <= 0) return 0;
  const base = a.cost - a.salvage;
  return Math.round((base * Math.min(k, a.lifeMonths)) / a.lifeMonths);
}

/** Depreciation for one month. */
export function monthlyDepreciation(a: FixedAsset, period: string): Cents {
  return scheduledAccum(a, period) - scheduledAccum(a, addMonths(period, -1));
}

export interface ScheduleRow { period: string; depreciation: Cents; accumulated: Cents; bookValue: Cents; txnId?: ID; before: boolean }

/** The full schedule month by month from in service to fully depreciated (or disposal). */
export function depreciationSchedule(a: FixedAsset, depreciationFrom?: string): ScheduleRow[] {
  if (a.method !== 'straight_line' || a.lifeMonths <= 0) return [];
  const start = a.inService.slice(0, 7);
  const end = a.disposal ? addMonths(periodOf(a.disposal.date), -1) : addMonths(start, a.lifeMonths - 1);
  const rows: ScheduleRow[] = [];
  for (const p of end >= start ? periodsBetween(start, end) : []) {
    const acc = scheduledAccum(a, p);
    rows.push({ period: p, depreciation: monthlyDepreciation(a, p), accumulated: acc, bookValue: a.cost - acc, txnId: a.posted[p], before: !!depreciationFrom && p < depreciationFrom });
  }
  return rows;
}

/** The last month whose last day is on or before the date. */
export function lastClosedPeriod(asOf: string): string {
  const p = periodOf(asOf);
  return lastDayOfPeriod(p) <= asOf ? p : addMonths(p, -1);
}

function live(state: BooksState, id?: ID): boolean {
  return !!id && state.transactions.some((t) => t.id === id && !t.deleted);
}

export interface AssetStatus {
  a: FixedAsset;
  /** By the schedule through the last completed month. */
  accumulated: Cents;
  bookValue: Cents;
  monthly: Cents;
  /** Months that should be posted and aren't. */
  unposted: string[];
  fullyDepreciated: boolean;
  disposed: boolean;
}

export function assetStatus(state: BooksState, a: FixedAsset, asOf: string): AssetStatus {
  const from = assetsOf(state).depreciationFrom;
  const last = lastClosedPeriod(asOf);
  const accumulated = a.disposal && a.disposal.date <= asOf ? 0 : scheduledAccum(a, last);
  const sched = depreciationSchedule(a, from).filter((r) => r.period <= last && !r.before && r.depreciation !== 0);
  return {
    a, accumulated, bookValue: a.disposal && a.disposal.date <= asOf ? 0 : a.cost - accumulated,
    monthly: monthlyDepreciation(a, addMonths(last, 1)),
    unposted: sched.filter((r) => !live(state, r.txnId)).map((r) => r.period),
    fullyDepreciated: a.method === 'straight_line' && scheduledAccum(a, last) >= a.cost - a.salvage,
    disposed: !!a.disposal && a.disposal.date <= asOf,
  };
}

/** Assets on the books at a date: in service by then and not yet disposed. */
export function assetsInService(state: BooksState, asOf: string): FixedAsset[] {
  return assetsOf(state).assets.filter((a) => a.inService <= asOf && !(a.disposal && a.disposal.date <= asOf));
}

export type AssetDraft = Omit<FixedAsset, 'id' | 'tag' | 'posted' | 'attachments' | 'disposal' | 'purchaseTxnId'> & { id?: ID; attachments?: Attachment[] };

export function validateAsset(state: BooksState, d: AssetDraft): string[] {
  const errs: string[] = [];
  if (!d.name.trim()) errs.push('Name the asset, e.g. "Dispensers 1–4".');
  if (!state.stores.some((s) => s.id === d.storeId && !s.deleted)) errs.push('Choose the store the asset is at.');
  const acct = state.accounts.find((a) => a.id === d.costAccountId);
  if (!acct || acct.subtype !== 'fixed_asset' || acct.id === ACCUM_DEP) errs.push('Choose the fixed-asset account for the cost (1500 equipment or 1510 buildings).');
  if (!Number.isSafeInteger(d.cost) || d.cost <= 0) errs.push('Enter the cost, above zero.');
  if (!Number.isSafeInteger(d.salvage) || d.salvage < 0) errs.push('Enter the salvage value (0 if none).');
  else if (d.salvage >= d.cost) errs.push('Salvage must be less than the cost.');
  if (!isValidDate(d.inService)) errs.push('Enter the in-service date as YYYY-MM-DD.');
  if (d.method === 'straight_line' && (!Number.isInteger(d.lifeMonths) || d.lifeMonths < 1 || d.lifeMonths > 600)) errs.push('Enter the useful life in months (1 to 600).');
  if (d.warrantyEnds && !isValidDate(d.warrantyEnds)) errs.push('Enter the warranty end as YYYY-MM-DD, or leave it blank.');
  return errs;
}

/**
 * Add an asset to the register or edit one. With `purchase`, also posts the purchase: Dr the cost account / Cr the bank.
 * Without it, the cost is assumed to be on the books already (opening balance or an earlier entry).
 */
export function saveAsset(books: Books, actor: User, d: AssetDraft, purchase?: { date: string; bankAccountId?: ID; partyId?: ID; checkNo?: string }): FixedAsset {
  books.require(actor, 'assets.edit', 'change the asset register');
  const errs = validateAsset(books.state, d);
  if (purchase && !isValidDate(purchase.date)) errs.push('Enter the purchase date as YYYY-MM-DD.');
  if (errs.length) throw new ValidationError(errs);
  const st = ensureAssets(books);
  const existing = d.id ? st.assets.find((x) => x.id === d.id) : undefined;
  if (existing && Object.keys(existing.posted).length && (existing.cost !== d.cost || existing.salvage !== d.salvage || existing.lifeMonths !== d.lifeMonths || existing.inService !== d.inService || existing.storeId !== d.storeId)) {
    throw new ValidationError(['Depreciation is already posted for this asset, so cost, salvage, life, in-service date and store are fixed. Dispose of it and add it again, or ask the CFO for an adjusting entry.']);
  }
  if (existing) {
    const before = structuredClone(existing);
    Object.assign(existing, { ...d, name: d.name.trim(), id: existing.id, attachments: d.attachments ?? existing.attachments });
    books.audit(actor, { action: 'update', objectType: 'asset', objectId: existing.id, summary: `Edited ${existing.tag} ${existing.name}`, before, after: structuredClone(existing) });
    books.changed();
    return existing;
  }
  const a: FixedAsset = { ...d, name: d.name.trim(), id: books.nextId('fa'), tag: 'FA-' + String(st.assets.length + 1).padStart(4, '0'), posted: {}, attachments: d.attachments ?? [] };
  if (purchase) {
    const t = books.createTransaction(actor, {
      date: purchase.date, kind: 'money_out', description: `Asset purchase: ${a.name}`, partyId: purchase.partyId, checkNo: purchase.checkNo, tags: ['fixed asset'],
      lines: [
        { accountId: a.costAccountId, storeId: a.storeId, debit: a.cost, credit: 0, memo: a.tag },
        { accountId: purchase.bankAccountId ?? 'acct_trustmark', storeId: bankStoreId(books.state), debit: 0, credit: a.cost },
      ],
    });
    a.purchaseTxnId = t.id;
  }
  st.assets.push(a);
  books.audit(actor, { action: 'create', objectType: 'asset', objectId: a.id, summary: `Added ${a.tag} ${a.name} (${formatMoney(a.cost, { dollarSign: true })})`, after: structuredClone(a) });
  books.changed();
  return a;
}

/** Every month with depreciation to post (completed, inside these books, not yet posted), oldest first. */
export function unpostedDepreciation(state: BooksState, asOf: string): string[] {
  const set = new Set<string>();
  for (const a of assetsOf(state).assets) for (const p of assetStatus(state, a, asOf).unposted) set.add(p);
  return [...set].sort();
}

/**
 * Post one month's book depreciation from the register: one entry on the month's last day with a line per asset
 * (Dr 6400 Depreciation / Cr 1590 Accumulated depreciation, at the asset's store). Idempotent per asset and month:
 * assets already posted for the month are skipped, and nothing is posted when nothing is due.
 */
export function postDepreciation(books: Books, actor: User, period: string): Transaction | null {
  books.require(actor, 'assets.edit', 'post depreciation');
  books.require(actor, 'journal.create', 'post depreciation');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ValidationError(['Pick the month as YYYY-MM.']);
  const st = ensureAssets(books);
  if (st.depreciationFrom && period < st.depreciationFrom) throw new ValidationError([`Depreciation before ${periodLabel(st.depreciationFrom)} is in the opening balance. Pick ${st.depreciationFrom} or later.`]);
  const due = st.assets
    .filter((a) => !live(books.state, a.posted[period]))
    .map((a) => ({ a, amount: monthlyDepreciation(a, period) }))
    .filter((x) => x.amount !== 0);
  if (!due.length) return null;
  const total = due.reduce((s, x) => s + x.amount, 0);
  const t = books.createTransaction(actor, {
    date: lastDayOfPeriod(period), kind: 'journal', description: `Depreciation ${period}`, tags: ['depreciation'],
    memo: `Book depreciation from the asset register: ${due.length} asset${due.length === 1 ? '' : 's'}, ${formatMoney(total, { dollarSign: true })}`,
    lines: due.flatMap(({ a, amount }) => [
      { accountId: DEP_EXPENSE, storeId: a.storeId, debit: amount, credit: 0, memo: `${a.tag} ${a.name}` },
      { accountId: ACCUM_DEP, storeId: a.storeId, debit: 0, credit: amount, memo: `${a.tag} ${a.name}` },
    ]),
  });
  for (const { a } of due) a.posted[period] = t.id;
  books.audit(actor, { action: 'depreciate', objectType: 'asset', objectId: period, summary: `Posted depreciation for ${period}: ${formatMoney(total, { dollarSign: true })} (${t.ref})` });
  books.changed();
  return t;
}

/**
 * Dispose of an asset (sold, scrapped, traded). Depreciation runs through the month before; those months must be
 * posted first. Posts: Dr 1590 accumulated, Dr the bank for any proceeds, Cr the cost account, and the difference
 * to 6410 Loss (gain) on asset disposals.
 */
export function disposeAsset(books: Books, actor: User, id: ID, x: { date: string; proceeds: Cents; reason: string; bankAccountId?: ID }): Transaction {
  books.require(actor, 'assets.edit', 'dispose of assets');
  books.require(actor, 'journal.create', 'dispose of assets');
  const st = ensureAssets(books);
  const a = st.assets.find((v) => v.id === id || v.tag === id);
  if (!a) throw new ValidationError(['That asset is not in the register.']);
  const errs: string[] = [];
  if (a.disposal) errs.push(`${a.tag} was already disposed of on ${a.disposal.date}.`);
  if (!isValidDate(x.date)) errs.push('Enter the disposal date as YYYY-MM-DD.');
  else if (x.date < a.inService) errs.push('The disposal date is before the asset went into service.');
  if (!Number.isSafeInteger(x.proceeds) || x.proceeds < 0) errs.push('Enter the proceeds (0 if scrapped).');
  if (!x.reason.trim()) errs.push('Say what happened (sold, scrapped, traded in). It goes in the audit log.');
  if (errs.length) throw new ValidationError(errs);
  const through = addMonths(periodOf(x.date), -1);
  const missing = depreciationSchedule(a, st.depreciationFrom).filter((r) => r.period <= through && !r.before && r.depreciation !== 0 && !live(books.state, r.txnId)).map((r) => r.period);
  if (missing.length) throw new ValidationError([`Post depreciation through ${periodLabel(through)} first (missing ${missing.join(', ')}), so the asset's accumulated depreciation is all on the books.`]);
  const accum = scheduledAccum(a, through);
  const bookValue = a.cost - accum;
  const gainLoss = bookValue - x.proceeds; // + loss, − gain
  const lines = [
    { accountId: ACCUM_DEP, storeId: a.storeId, debit: accum, credit: 0, memo: `${a.tag} accumulated depreciation` },
    { accountId: a.costAccountId, storeId: a.storeId, debit: 0, credit: a.cost, memo: `${a.tag} cost` },
    ...(x.proceeds ? [{ accountId: x.bankAccountId ?? 'acct_trustmark', storeId: bankStoreId(books.state), debit: x.proceeds, credit: 0, memo: 'Proceeds' }] : []),
    ...(gainLoss ? [{ accountId: DISPOSAL_ACCOUNT, storeId: a.storeId, debit: gainLoss > 0 ? gainLoss : 0, credit: gainLoss < 0 ? -gainLoss : 0, memo: gainLoss > 0 ? 'Loss on disposal' : 'Gain on disposal' }] : []),
  ].filter((l) => l.debit || l.credit);
  const t = books.createTransaction(actor, { date: x.date, kind: 'journal', description: `Disposal ${a.tag} ${a.name}`, memo: x.reason.trim(), tags: ['fixed asset', 'disposal'], lines });
  const before = structuredClone(a);
  a.disposal = { date: x.date, proceeds: x.proceeds, reason: x.reason.trim(), txnId: t.id, gainLoss, by: actor.id, at: books.clock() };
  books.audit(actor, { action: 'dispose', objectType: 'asset', objectId: a.id, summary: `Disposed of ${a.tag} ${a.name}: book value ${formatMoney(bookValue, { dollarSign: true })}, proceeds ${formatMoney(x.proceeds, { dollarSign: true })}`, before, after: structuredClone(a), reason: x.reason });
  books.changed();
  return t;
}

export interface AssetTie {
  storeId: ID;
  costRegister: Cents;
  costLedger: Cents;
  accumRegister: Cents;
  /** 1590 is a credit balance: shown positive. */
  accumLedger: Cents;
  ok: boolean;
}

/**
 * The register vs the ledger by store: cost of assets on hand = 1500 + 1510, and accumulated depreciation by the
 * schedule through the last completed month = 1590. A month left unposted shows up here as a difference.
 */
export function assetTie(state: BooksState, asOf: string): { rows: AssetTie[]; ok: boolean; cost: { register: Cents; ledger: Cents }; accum: { register: Cents; ledger: Cents } } {
  const last = lastClosedPeriod(asOf);
  const costAccts = new Set(state.accounts.filter((a) => a.subtype === 'fixed_asset' && a.id !== ACCUM_DEP).map((a) => a.id));
  const storeIds = new Set<ID>();
  for (const a of assetsOf(state).assets) storeIds.add(a.storeId);
  for (const t of state.transactions) if (!t.deleted) for (const l of t.lines) if (costAccts.has(l.accountId) || l.accountId === ACCUM_DEP) storeIds.add(l.storeId);
  const on = assetsInService(state, asOf);
  const rows = [...storeIds].map((storeId): AssetTie => {
    const mine = on.filter((a) => a.storeId === storeId);
    const costRegister = mine.reduce((s, a) => s + a.cost, 0);
    const accumRegister = mine.reduce((s, a) => s + scheduledAccum(a, last), 0);
    const costLedger = [...costAccts].reduce((s, id) => s + storeBalance(state, id, storeId, asOf), 0);
    const accumLedger = -storeBalance(state, ACCUM_DEP, storeId, asOf);
    return { storeId, costRegister, costLedger, accumRegister, accumLedger, ok: costRegister === costLedger && accumRegister === accumLedger };
  }).sort((a, b) => (state.stores.find((s) => s.id === a.storeId)?.code ?? '').localeCompare(state.stores.find((s) => s.id === b.storeId)?.code ?? ''));
  const sum = (k: keyof AssetTie) => rows.reduce((s, r) => s + (r[k] as number), 0);
  return { rows, ok: rows.every((r) => r.ok), cost: { register: sum('costRegister'), ledger: sum('costLedger') }, accum: { register: sum('accumRegister'), ledger: sum('accumLedger') } };
}

// ── Maintenance & warranties ─────────────────────────────────────────────
export type MaintenanceDraft = Omit<MaintenanceEntry, 'id' | 'by' | 'attachments'> & { id?: ID; attachments?: Attachment[] };

export function logMaintenance(books: Books, actor: User, d: MaintenanceDraft): MaintenanceEntry {
  books.require(actor, 'assets.edit', 'log maintenance');
  const s = books.state;
  const errs: string[] = [];
  const asset = d.assetId ? assetsOf(s).assets.find((a) => a.id === d.assetId) : undefined;
  if (d.assetId && !asset) errs.push('Pick an asset from the register, or leave it blank.');
  if (asset && asset.storeId !== d.storeId) errs.push(`${asset.tag} is at ${s.stores.find((x) => x.id === asset.storeId)?.code}. Pick that store, or another asset.`);
  if (!s.stores.some((x) => x.id === d.storeId)) errs.push('Choose the store.');
  if (!isValidDate(d.date)) errs.push('Enter the date of the work as YYYY-MM-DD.');
  if (!d.description.trim()) errs.push('Describe the work done.');
  if (d.cost !== undefined && (!Number.isSafeInteger(d.cost) || d.cost < 0)) errs.push('Enter the cost, or leave it blank.');
  if (d.nextDue && !isValidDate(d.nextDue)) errs.push('Enter the next due date as YYYY-MM-DD, or leave it blank.');
  if (d.nextDue && isValidDate(d.date) && d.nextDue <= d.date) errs.push('The next due date must be after the date of this work.');
  if (d.txnId && !s.transactions.some((t) => t.id === d.txnId && !t.deleted)) errs.push('That transaction no longer exists. Pick another, or leave it blank.');
  if (errs.length) throw new ValidationError(errs);
  const st = ensureAssets(books);
  const existing = d.id ? st.maintenance.find((m) => m.id === d.id) : undefined;
  const e: MaintenanceEntry = { ...d, description: d.description.trim(), vendor: d.vendor?.trim() || undefined, id: existing?.id ?? d.id ?? books.nextId('mnt'), by: actor.id, attachments: d.attachments ?? existing?.attachments ?? [] };
  if (existing) Object.assign(existing, e); else st.maintenance.push(e);
  books.audit(actor, { action: existing ? 'update' : 'create', objectType: 'asset', objectId: e.id, summary: `${existing ? 'Edited' : 'Logged'} maintenance: ${e.description}`, after: structuredClone(e) });
  books.changed();
  return existing ?? e;
}

/** Next service due per asset (the latest entry's next-due date), and warranties ending. */
export function maintenanceDue(state: BooksState, today: string, days = 30): { assetId?: ID; storeId: ID; label: string; due: string; kind: 'maintenance' | 'warranty'; overdue: boolean }[] {
  const st = assetsOf(state);
  const out: ReturnType<typeof maintenanceDue> = [];
  const latest = new Map<string, MaintenanceEntry>();
  for (const m of st.maintenance) {
    const k = (m.assetId ?? m.storeId) + '|' + m.kind;
    const cur = latest.get(k);
    if (!cur || m.date > cur.date) latest.set(k, m);
  }
  for (const m of latest.values()) {
    if (!m.nextDue || daysBetween(today, m.nextDue) > days) continue;
    const a = st.assets.find((x) => x.id === m.assetId);
    if (a?.disposal) continue;
    out.push({ assetId: m.assetId, storeId: m.storeId, label: `${MAINT_LABEL[m.kind]}: ${a ? `${a.tag} ${a.name}` : m.description}`, due: m.nextDue, kind: 'maintenance', overdue: m.nextDue < today });
  }
  for (const a of st.assets) {
    if (!a.warrantyEnds || a.disposal || a.warrantyEnds < addDays(today, -30) || daysBetween(today, a.warrantyEnds) > days) continue;
    out.push({ assetId: a.id, storeId: a.storeId, label: `Warranty ends: ${a.tag} ${a.name}`, due: a.warrantyEnds, kind: 'warranty', overdue: a.warrantyEnds < today });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

/** Each logged cost with a transaction should agree with that transaction's repair lines at the store. */
export function maintenanceTie(state: BooksState): { linked: number; agree: number; mismatched: MaintenanceEntry[] } {
  const repairs = new Set(state.accounts.filter((a) => a.type === 'expense' || a.subtype === 'fixed_asset').map((a) => a.id));
  const mism: MaintenanceEntry[] = [];
  let linked = 0;
  for (const m of assetsOf(state).maintenance) {
    if (!m.txnId || m.cost === undefined) continue;
    linked += 1;
    const t = state.transactions.find((x) => x.id === m.txnId && !x.deleted);
    const amt = t ? t.lines.filter((l) => !l.system && l.storeId === m.storeId && repairs.has(l.accountId)).reduce((s, l) => s + l.debit - l.credit, 0) : NaN;
    if (amt !== m.cost) mism.push(m);
  }
  return { linked, agree: linked - mism.length, mismatched: mism };
}

export function attachToAsset(books: Books, actor: User, target: { kind: 'asset' | 'maintenance' | 'loan'; id: ID }, att: Attachment): void {
  books.require(actor, 'assets.edit', 'attach documents');
  const st = ensureAssets(books);
  const rec = (target.kind === 'asset' ? st.assets : target.kind === 'maintenance' ? st.maintenance : st.loans).find((x) => x.id === target.id);
  if (!rec) throw new ValidationError(['That record no longer exists.']);
  rec.attachments.push(att);
  books.audit(actor, { action: 'attach', objectType: target.kind === 'loan' ? 'loan' : 'asset', objectId: target.id, summary: `Attached ${att.name}` });
  books.changed();
}
