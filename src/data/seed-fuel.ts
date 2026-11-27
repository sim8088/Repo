import type { Books } from '../core/books';
import type { BooksState, ID, User } from '../core/types';
import type { FuelGrade, FuelInvoiceLine, FuelNotice, NoticeLine, Tank } from '../core/fuelTypes';
import {
  commitComdataImport, fuelOf, liveInvoices, nextBusinessDay, noticeNet, payDashInvoicesDue, postDashSettlement, postNotice, recordCompetitorPrice,
  recordFuelSales, recordMudflap, recordReading, saveInvoice, saveNotice, saveTank, setPostedPrice, storeBalance, FUEL_ACCT,
} from '../core/fuel';
import { addDays, dayOfWeek, periodOf } from '../core/dates';

/**
 * Demo fuel: tanks, posted prices, deliveries (BOL + invoice) when a tank needs a load, structured daily
 * sales, weekly Craddock EFT notices posted through postNotice, Dash invoices paid from clearing on their due
 * dates, Dash weekly settlements, the Comdata summary and Mudflap discounts for the HM15 truck lane, daily
 * tank readings and competitor prices. Every ledger entry goes through the fuel core functions.
 * Figures are illustrative.
 */

const BATCH = 'demo-2026Q4';
type TG = Exclude<FuelGrade, 'plus'>;

const TANKS: [store: ID, label: string, grade: TG, capacity: number][] = [
  ['st_hm11', 'T1', 'regular', 12_000], ['st_hm11', 'T2', 'premium', 6_000], ['st_hm11', 'T3', 'diesel', 6_000],
  ['st_hm13', 'T1', 'regular', 10_000], ['st_hm13', 'T2', 'premium', 6_000], ['st_hm13', 'T3', 'diesel', 4_000],
  ['st_hm15', 'T1', 'regular', 12_000], ['st_hm15', 'T2', 'premium', 8_000], ['st_hm15', 'T3', 'diesel', 20_000],
  ['st_hm17', 'T1', 'regular', 10_000], ['st_hm17', 'T2', 'premium', 6_000], ['st_hm17', 'T3', 'diesel', 4_000],
];

/** Regular street price steps (cents/gal); Plus +40¢, Premium +70¢. Diesel separately. Store offsets below. */
const PRICE_STEPS: [string, number][] = [['2026-09-01', 289.9], ['2026-09-22', 285.9], ['2026-10-13', 279.9], ['2026-11-03', 274.9], ['2026-11-17', 271.9]];
const DIESEL_STEPS: [string, number][] = [['2026-09-01', 349.9], ['2026-10-13', 342.9], ['2026-11-03', 336.9]];
/** HM17 is priced low to build traffic after opening, so its margin sits under target. */
const OFFSET: Record<string, number> = { st_hm11: 0, st_hm13: 4, st_hm15: 6, st_hm17: -12 };
/** Delivered cost targets per gallon (cents) including freight and taxes, by month. */
const DELIVERED: Record<string, Record<TG, number>> = {
  '2026-09': { regular: 262, premium: 324, diesel: 319 },
  '2026-10': { regular: 255, premium: 317, diesel: 312 },
  '2026-11': { regular: 247, premium: 309, diesel: 306 },
};
const FREIGHT_CPG = 4.5;
const TAX_CPG: Record<TG, number> = { regular: 36.4, premium: 36.4, diesel: 42.4 };
const COMPETITORS: Record<string, [string, number][]> = {
  st_hm11: [['Station A – north frontage road', -2], ['Station B – interstate exit', 5]],
  st_hm13: [['Station C – town square', 1], ['Station D – state highway', -3]],
  st_hm15: [['Truck stop E – interstate', 3], ['Station F – business route', -1]],
  st_hm17: [['Station G – county road', 10], ['Station H – main street', 13]],
};

export interface FuelDayInput {
  txnId: ID;
  card: number;
  sales: { grade: FuelGrade; gallons: number; retail: number }[];
  /** HM15 truck lane (Comdata), diesel. */
  truck?: { gallons: number; sales: number };
}

export class FuelDemo {
  private level = new Map<ID, number>();
  private tanks: Tank[] = [];
  private card = new Map<string, number>();
  private gallons = new Map<string, number>();
  private draw = new Map<ID, number[]>();
  private comdataQueue: { date: string; storeCode: string; gallons: number; sales: number; transactions: number }[] = [];
  private invoiceNo = 5800;
  private bolNo = 70400;
  private noticeNo = 41200;
  private netted = new Set<ID>();
  private monthsWithNotice = new Set<string>();
  private loadsByStoreMonth = new Map<string, number>();
  private missingLogged = false;
  private unpostedKey = 'st_hm13|2026-11-23';

  constructor(private state: BooksState, private books: Books, private cfo: User, private rand: () => number, private setClock: (d: string) => void, private opened: Record<ID, string>) {}

  private code(id: ID) { return this.state.stores.find((s) => s.id === id)!.code; }
  private jit(p: number) { return 1 + (this.rand() * 2 - 1) * p; }

  init(): void {
    this.setClock('2026-08-31');
    for (const [storeId, label, grade, capacity] of TANKS) {
      const t = saveTank(this.books, this.cfo, { storeId, label, grade, capacity, active: true });
      this.tanks.push(t);
      const startsFull = this.opened[storeId] <= '2026-09-01';
      this.level.set(t.id, startsFull ? Math.round(capacity * (0.45 + this.rand() * 0.35)) : 0);
    }
    for (const storeId of Object.keys(OFFSET)) {
      for (const [d, reg] of PRICE_STEPS) {
        const r = reg + OFFSET[storeId];
        setPostedPrice(this.books, this.cfo, { storeId, grade: 'regular', effective: d, cpg: r });
        setPostedPrice(this.books, this.cfo, { storeId, grade: 'plus', effective: d, cpg: r + 40 });
        setPostedPrice(this.books, this.cfo, { storeId, grade: 'premium', effective: d, cpg: r + 70 });
      }
      for (const [d, dsl] of DIESEL_STEPS) setPostedPrice(this.books, this.cfo, { storeId, grade: 'diesel', effective: d, cpg: dsl + OFFSET[storeId] });
    }
  }

  /** Posted price in cents per gallon. */
  price(storeId: ID, grade: FuelGrade, date: string): number {
    const p = fuelOf(this.state).prices.filter((x) => x.storeId === storeId && x.grade === grade && x.effective <= date).sort((a, b) => a.effective.localeCompare(b.effective)).at(-1);
    return p!.cpg;
  }

  private expectedDraw(t: Tank, fallback: number): number {
    const xs = this.draw.get(t.id) ?? [];
    return xs.length ? xs.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, xs.length) : fallback;
  }

  /** Morning delivery when any tank is under 30% or 2.5 days of supply: fill to 90%, one transport (8,800 gal) at most. */
  morning(storeId: ID, d: string, fallbackDraw: Record<TG, number>): void {
    const mine = this.tanks.filter((t) => t.storeId === storeId);
    const needs = mine.some((t) => { const lv = this.level.get(t.id)!; return lv < t.capacity * 0.3 || lv < this.expectedDraw(t, fallbackDraw[t.grade]) * 2.5; });
    if (!needs) return;
    const room = mine.map((t) => Math.max(0, t.capacity * 0.9 - this.level.get(t.id)!));
    const total = room.reduce((a, b) => a + b, 0);
    const scale = total > 8_800 ? 8_800 / total : 1;
    const load = room.map((r) => Math.floor((r * scale) / 100) * 100);
    if (load.reduce((a, b) => a + b, 0) < 1_500) return;
    this.setClock(d);
    const vendor = this.state.stores.find((s) => s.id === storeId)!.fuelSupplier as 'craddock' | 'dash';
    const month = periodOf(d);
    const mk = `${storeId}|${month}`;
    this.loadsByStoreMonth.set(mk, (this.loadsByStoreMonth.get(mk) ?? 0) + 1);
    const outlier = storeId === 'st_hm11' && month === '2026-10' && this.loadsByStoreMonth.get(mk) === 2;
    const bolOnly = vendor === 'craddock' && d >= '2026-11-21' && !this.missingLogged;
    const lines: FuelInvoiceLine[] = [];
    let freight = 0;
    let taxes = 0;
    mine.forEach((t, i) => {
      const net = load[i];
      if (!net) return;
      const target = DELIVERED[month][t.grade];
      const rack = (target - FREIGHT_CPG - TAX_CPG[t.grade]) * this.jit(0.008) * (outlier && t.grade === 'premium' ? 1.09 : 1);
      lines.push({ grade: t.grade, netGallons: net, grossGallons: Math.round(net * (1.002 + this.rand() * 0.006)), cost: bolOnly ? 0 : Math.round(net * rack) });
      taxes += bolOnly ? 0 : Math.round(net * TAX_CPG[t.grade]);
      freight += bolOnly ? 0 : net * FREIGHT_CPG;
      this.level.set(t.id, this.level.get(t.id)! + net);
    });
    this.invoiceNo += 1;
    this.bolNo += 7;
    saveInvoice(this.books, this.cfo, {
      supplier: vendor, storeId, invoiceNo: bolOnly ? undefined : `${vendor === 'craddock' ? 'C' : 'D'}-${this.invoiceNo}`, bolNo: String(this.bolNo),
      deliveredOn: d, dueOn: addDays(d, vendor === 'craddock' ? 3 : 10), lines, freight: Math.round(freight), taxes,
    }, { source: 'demo', batchId: BATCH });
    if (bolOnly) this.missingLogged = true;
  }

  /** After the POS close: structured sales, tank draws, card into clearing. */
  recordDay(storeId: ID, d: string, x: FuelDayInput): void {
    this.setClock(d);
    recordFuelSales(this.books, this.cfo, x.sales.map((s) => ({ storeId, date: d, grade: s.grade, gallons: s.gallons, retail: s.retail, txnId: x.txnId })), BATCH);
    const g = (grade: FuelGrade) => x.sales.find((s) => s.grade === grade)?.gallons ?? 0;
    const draws: Record<TG, number> = { regular: g('regular') + g('plus') / 2, premium: g('premium') + g('plus') / 2, diesel: g('diesel') + (x.truck?.gallons ?? 0) };
    for (const t of this.tanks.filter((t) => t.storeId === storeId)) {
      const loss = storeId === 'st_hm13' && t.grade === 'premium' && d >= '2026-11-08' ? 22 : 0; // a slow loss the variance test should catch
      this.level.set(t.id, Math.max(0, this.level.get(t.id)! - draws[t.grade] - loss));
      this.draw.set(t.id, [...(this.draw.get(t.id) ?? []), draws[t.grade]]);
      const water = storeId === 'st_hm11' && t.grade === 'regular' && d >= '2026-11-24' ? 1.4 : Math.round((0.1 + this.rand() * 0.3) * 100) / 100;
      const reading = Math.min(t.capacity, Math.max(0, Math.round(this.level.get(t.id)! + (this.rand() * 2 - 1) * 6)));
      recordReading(this.books, this.cfo, { tankId: t.id, date: d, gallons: reading, waterInches: water, method: storeId === 'st_hm17' ? 'stick' : 'atg' });
    }
    this.card.set(`${storeId}|${d}`, x.card);
    this.gallons.set(`${storeId}|${d}`, g('regular') + g('plus') + g('premium') + g('diesel'));
    if (x.truck) this.comdataQueue.push({ date: d, storeCode: this.code(storeId), gallons: x.truck.gallons, sales: x.truck.sales, transactions: Math.max(1, Math.round(x.truck.gallons / 85)) });
  }

  /** Supplier settlement: Craddock notices on Mondays, Dash invoices on their due dates, Dash statements on Tuesdays. */
  settle(d: string, craddockStores: ID[], dashStores: ID[]): void {
    this.setClock(d);
    const dow = dayOfWeek(d);
    if (dow === 1 && d >= '2026-09-07') for (const s of craddockStores) this.craddockNotice(s, d);
    for (const s of dashStores) if (d >= this.opened[s]) payDashInvoicesDue(this.books, this.cfo, { through: d, storeId: s });
    if (dow === 2) for (const s of dashStores) if (d > this.opened[s]) this.dashStatement(s, d);
    if (dow === 1 && this.comdataQueue.some((c) => c.date < d)) this.importComdata(`Comdata summary week ending ${addDays(d, -1)} (demo).csv`, d);
  }

  private craddockNotice(storeId: ID, m: string): void {
    const lines: Omit<NoticeLine, 'id' | 'batchId'>[] = [];
    for (let k = 7; k >= 1; k--) {
      const sales = addDays(m, -k);
      const processingDate = addDays(sales, 1);
      if (sales === '2026-08-31') {
        const opening = storeBalance(this.state, FUEL_ACCT.craddock, storeId, '2026-08-31');
        if (opening) lines.push({ type: 'CC_PROCEEDS', amount: opening, processingDate, description: 'Batches through Aug 31 (net of fees)' });
        continue;
      }
      const card = this.card.get(`${storeId}|${sales}`) ?? 0;
      if (!card) continue;
      lines.push({ type: 'CC_PROCEEDS', amount: card, processingDate, description: `Card batch ${sales}` });
      lines.push({ type: 'CC_FEE', amount: -Math.round(card * 0.0215), processingDate, description: 'Card fees 2.15%' });
      const gal = this.gallons.get(`${storeId}|${sales}`) ?? 0;
      lines.push({ type: 'HOST_DISCOUNT', amount: -Math.round(gal * 0.72 * 3), processingDate, description: 'Rewards / host discount 3¢ on card gallons' });
    }
    for (const i of liveInvoices(this.state)) {
      if (i.supplier !== 'craddock' || i.storeId !== storeId || !i.invoiceNo || this.netted.has(i.id) || i.dueOn > m) continue;
      lines.push({ type: 'FUEL_INVOICE', amount: -i.total, invoiceNo: i.invoiceNo, description: `Fuel invoice ${i.invoiceNo} · BOL ${i.bolNo}` });
      this.netted.add(i.id);
    }
    lines.push({ type: 'OTHER', amount: -8_650, description: 'Cybera network fee' });
    const mk = `${storeId}|${periodOf(m)}`;
    if (!this.monthsWithNotice.has(mk)) { lines.push({ type: 'OTHER', amount: -4_500, description: 'POS network fee (monthly)' }); this.monthsWithNotice.add(mk); }
    const net = noticeNet({ lines });
    if (net > 0) lines.push({ type: 'DEPOSIT', amount: -net, description: 'ACH deposit to Trustmark' });
    if (net < 0) lines.push({ type: 'BANK_DRAFT', amount: -net, description: 'ACH draft from Trustmark' });
    this.noticeNo += 1;
    const n = saveNotice(this.books, this.cfo, { storeId, noticeNo: String(this.noticeNo), noticeDate: m, lines }, { source: 'demo', batchId: BATCH });
    if (`${storeId}|${m}` !== this.unpostedKey) postNotice(this.books, this.cfo, n.id);
  }

  private dashStatement(storeId: ID, d: string): void {
    let card = 0;
    for (let k = 1; k <= 7; k++) card += this.card.get(`${storeId}|${addDays(d, -k)}`) ?? 0;
    const cardFees = Math.round(card * 0.0198);
    const networkFees = 4_200;
    const bal = storeBalance(this.state, FUEL_ACCT.dash, storeId, d) - cardFees - networkFees;
    const upcoming = liveInvoices(this.state).filter((i) => i.supplier === 'dash' && i.storeId === storeId && !i.settlement && i.dueOn > d && i.dueOn <= addDays(d, 7)).reduce((a, i) => a + i.total, 0);
    const remit = bal - 600_000 - upcoming; // Dash keeps a working balance and enough for the week's invoices
    postDashSettlement(this.books, this.cfo, { storeId, date: d, cardFees, networkFees, remit });
  }

  private importComdata(name: string, before = '9999-12-31'): void {
    commitComdataImport(this.books, this.cfo, { name, rows: this.comdataQueue.filter((c) => c.date < before) });
    this.comdataQueue = this.comdataQueue.filter((c) => c.date >= before);
  }

  /** Mudflap for HM15: fuel-code discounts every Monday, a card true-up on the 5th. Returns what came off the merchant clearing. */
  mudflap(d: string): number {
    const store = 'st_hm15';
    let total = 0;
    if (dayOfWeek(d) === 1 && d >= '2026-09-07') {
      let gal = 0;
      for (let k = 1; k <= 7; k++) gal += this.comdataQueue.find((c) => c.date === addDays(d, -k))?.gallons ?? fuelOf(this.state).comdata.find((c) => c.storeId === store && c.date === addDays(d, -k))?.gallons ?? 0;
      const mfGal = Math.round(gal * 0.12);
      if (mfGal) { this.setClock(d); total += recordMudflap(this.books, this.cfo, { storeId: store, date: d, kind: 'discount', amount: Math.round(mfGal * 14), gallons: mfGal, note: 'Fuel-code redemptions, prior week' }).amount; }
    }
    if (d.endsWith('-05') && d >= '2026-10-01') {
      this.setClock(d);
      const amt = Math.round((this.rand() * 2 - 1) * 3_500) || 500;
      total += recordMudflap(this.books, this.cfo, { storeId: store, date: d, kind: 'true_up', amount: amt, note: `Card true-up for ${periodOf(addDays(d, -10))}` }).amount;
    }
    return total;
  }

  /** After the main loop: the last partial Comdata week, competitor prices and a duplicate invoice. */
  finish(end: string): void {
    this.setClock(end);
    if (this.comdataQueue.length) this.importComdata(`Comdata summary ${this.comdataQueue[0].date} to ${end} (demo).csv`);
    for (const [storeId, comps] of Object.entries(COMPETITORS)) {
      for (let d = this.opened[storeId] > '2026-09-01' ? this.opened[storeId] : '2026-09-01'; d <= end; d = addDays(d, 1)) {
        if (dayOfWeek(d) !== 1 && dayOfWeek(d) !== 4) continue;
        for (const [competitor, off] of comps) {
          for (const grade of ['regular', 'premium', 'diesel'] as const) {
            const raw = this.price(storeId, grade, d) + off + Math.round((this.rand() * 2 - 1) * 2);
            recordCompetitorPrice(this.books, this.cfo, { storeId, competitor, grade, date: d, cpg: Math.floor(raw) + 0.9 });
          }
        }
      }
    }
    // The same Dash invoice keyed in twice (once from the driver's copy, once from the emailed PDF).
    const dup = liveInvoices(this.state).filter((i) => i.supplier === 'dash' && i.storeId === 'st_hm15' && i.settlement && i.deliveredOn >= '2026-11-01').at(-1);
    if (dup) {
      this.setClock(addDays(dup.deliveredOn, 2));
      saveInvoice(this.books, this.cfo, { supplier: dup.supplier, storeId: dup.storeId, invoiceNo: dup.invoiceNo, bolNo: dup.bolNo, deliveredOn: dup.deliveredOn, dueOn: dup.dueOn, lines: dup.lines.map((l) => ({ ...l })), freight: dup.freight, taxes: dup.taxes }, { source: 'manual' });
    }
  }
}

/**
 * The bank already shows the draft or deposit for a demo notice that hasn't been posted yet: add that bank
 * line so posting the notice later has something to match. Call after the bank feed is built.
 */
export function addUnpostedNoticeBankLines(state: BooksState, books: Books, feedEnd: string): void {
  const f = fuelOf(state);
  for (const n of f.notices.filter((x: FuelNotice) => x.status === 'unposted')) {
    const bank = n.lines.find((l) => l.type === 'BANK_DRAFT' || l.type === 'DEPOSIT');
    const date = nextBusinessDay(n.noticeDate);
    if (!bank || date > feedEnd) continue;
    const batch = state.bank.batches.find((b) => b.accountId === FUEL_ACCT.bank && b.from <= date && b.to >= date) ?? state.bank.batches.at(-1);
    if (!batch) continue;
    const id = books.nextId('bl');
    const amount = -bank.amount;
    state.bank.lines.push({ id, accountId: FUEL_ACCT.bank, date, description: `CRADDOCK EFT NOTICE #${n.noticeNo} ${state.stores.find((s) => s.id === n.storeId)?.code}`, amount, hash: `demo:${batch.id}:${id}`, batchId: batch.id, source: amount > 0 ? 'card_settlement' : undefined, matchedLineIds: [] });
    batch.added += 1;
    if (amount > 0) batch.totalIn += amount;
    else batch.totalOut -= amount;
  }
  state.bank.lines.sort((a, b) => a.date.localeCompare(b.date));
}
