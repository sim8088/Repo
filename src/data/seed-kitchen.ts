import type { SeedCtx } from './seed';
import type { WasteReason } from '../core/insideTypes';
import { addDays, lastDayOfPeriod, periodOf } from '../core/dates';
import { allocate } from '../core/money';
import { commitInvoiceLines, commitMenuImport, kitchenOf, ledgerFoodSales, logWaste, type ParsedInvoiceLine, type ParsedMenuRow } from '../core/kitchen';

const c = (dollars: number) => Math.round(dollars * 100);
const CODE: Record<string, string> = { st_hm11: 'HM11', st_hm13: 'HM13', st_hm15: 'HM15' };
const KITCHENS = ['st_hm11', 'st_hm13', 'st_hm15'];
const DEMO_LAST = '2026-11-26';

/** Menu items: name, price (dollars), weight of sales. HM11 runs the BBQ & fried menu. */
const MENU: Record<string, [string, number, number][]> = {
  st_hm11: [['Brisket plate', 13.99, 18], ['Pulled pork sandwich', 8.99, 16], ['Rib basket', 12.49, 10], ['Fried chicken 2 pc', 6.99, 16], ['Chicken tenders', 7.49, 10], ['Catfish basket', 10.99, 8], ['Fries', 2.99, 8], ['Breakfast biscuit', 3.49, 10], ['Sides', 2.49, 4]],
  st_hm13: [['Fried chicken 2 pc', 6.99, 20], ['Chicken tenders', 7.49, 14], ['Wings 6 pc', 7.99, 14], ['Pizza slice', 2.99, 10], ['Breakfast biscuit', 3.49, 14], ['Burger combo', 8.49, 12], ['Fries', 2.99, 8], ['Corn dog', 2.49, 8]],
  st_hm15: [['Fried chicken 2 pc', 6.99, 18], ['Chicken tenders', 7.49, 12], ['Wings 6 pc', 7.99, 16], ['Burger combo', 8.49, 14], ['Breakfast biscuit', 3.49, 16], ['Pizza slice', 2.99, 8], ['Fries', 2.99, 8], ['Corn dog', 2.49, 8]],
};

/** Sysco items: code, description, pack, price (cents), weight per store [HM11, HM13, HM15]. */
const ITEMS: [string, string, string, number, [number, number, number]][] = [
  ['1004417', 'Chicken wings jumbo', '40 lb case', 11_800, [10, 16, 18]],
  ['5121880', 'Chicken breast tenders', '10 lb', 3_290, [12, 14, 14]],
  ['2418775', 'Pork butt bone-in', '2/9 lb', 4_860, [14, 2, 2]],
  ['3307341', 'Beef brisket choice', '2/14 lb', 9_840, [16, 0, 0]],
  ['4461230', 'Fryer oil', '35 lb', 4_125, [10, 10, 10]],
  ['7781014', 'Fries 3/8" crinkle', '6/5 lb', 3_460, [9, 10, 10]],
  ['6620518', 'Breading mix', '25 lb', 2_275, [5, 5, 5]],
  ['1185543', 'Sandwich buns 4"', '8/12 ct', 1_890, [6, 6, 6]],
  ['8820461', 'Biscuit dough frozen', '120 ct', 3_940, [6, 7, 8]],
  ['9012277', 'American cheese sliced', '4/5 lb', 5_480, [4, 6, 6]],
  ['5540093', 'Catfish fillet', '15 lb', 7_425, [5, 0, 0]],
  ['7340015', 'Nitrile gloves L', '10/100', 3_150, [3, 3, 3]],
];
/** Price on a date: wings jump 13% from the 12 Nov invoices; fryer oil drifts up 3% in mid-October (under the alert). */
function priceOn(code: string, base: number, date: string): number {
  if (code === '1004417' && date >= '2026-11-12') return 13_350;
  if (code === '4461230' && date >= '2026-10-15') return 4_250;
  return base;
}

/**
 * Kitchen demo: food cost targets (HM15's October runs over), monthly menu mix that adds to each month's 4200 food
 * sales, Sysco invoice detail that adds to every Sysco purchase in the books (with the wings price jump), and a waste log.
 */
export function seedKitchen({ state, books, cfo, rand, setClock }: SeedCtx): void {
  const k = kitchenOf(state);
  k.targets = { st_hm11: 3_700, st_hm13: 3_700, st_hm15: 3_600 };

  // ── Menu mix, one item report per store and month, adding to the month's food sales in the ledger.
  for (const period of ['2026-09', '2026-10', '2026-11']) {
    for (const storeId of KITCHENS) {
      const from = `${period}-01`;
      const to = lastDayOfPeriod(period) < DEMO_LAST ? lastDayOfPeriod(period) : DEMO_LAST;
      const total = ledgerFoodSales(state, [storeId], from, to);
      if (!total) continue;
      const items = MENU[storeId];
      const parts = allocate(total, items.map((x) => x[2] * (0.85 + rand() * 0.3)));
      const rows: ParsedMenuRow[] = items.map(([item, price], i) => ({ row: i + 2, storeCode: CODE[storeId], from, to, item, qty: Math.max(1, Math.round(parts[i] / 100 / price)), sales: parts[i] }));
      setClock(addDays(to, 1));
      commitMenuImport(books, cfo, { name: `Item sales ${CODE[storeId]} ${period} (demo).csv`, rows }, { source: 'demo' });
    }
  }

  // ── Sysco invoice detail for every Sysco purchase in the books (the duplicate payment has no second invoice).
  const sysco = state.transactions.filter((t) => !t.deleted && t.partyId === 'pt_sysco' && t.description !== 'SYSCO INV 77120419')
    .flatMap((t) => t.lines.filter((l) => l.accountId === 'acct_cogs_food' && l.debit > 0 && KITCHENS.includes(l.storeId)).map((l) => ({ t, l })));
  const byMonth = new Map<string, ParsedInvoiceLine[]>();
  for (const { t, l } of sysco) {
    const si = KITCHENS.indexOf(l.storeId);
    const invoiceNo = t.description.match(/\d{6,}/)?.[0] ?? `SY${t.date.replace(/-/g, '').slice(2)}${CODE[l.storeId].slice(2)}`;
    const amount = l.debit;
    const items = ITEMS.filter((x) => x[4][si] > 0).map(([code, desc, pack, base, w]) => ({ code, desc, pack, price: priceOn(code, base, t.date), w: w[si] * (0.8 + rand() * 0.4) }));
    const wsum = items.reduce((a, x) => a + x.w, 0);
    const budget = amount - c(25);
    const qty = items.map((x) => Math.floor((budget * x.w) / wsum / x.price));
    let used = qty.reduce((a, q, i) => a + q * items[i].price, 0);
    for (let guard = 0; guard < 200; guard++) {
      const order = items.map((x, i) => ({ i, need: (budget * x.w) / wsum - qty[i] * x.price })).sort((a, b) => b.need - a.need);
      const pick = order.find((o) => used + items[o.i].price <= budget);
      if (!pick) break;
      qty[pick.i] += 1;
      used += items[pick.i].price;
    }
    const rows: ParsedInvoiceLine[] = items.flatMap((x, i) => (qty[i] ? [{ row: 0, vendor: 'Sysco', storeCode: CODE[l.storeId], invoiceNo, date: t.date, itemCode: x.code, description: x.desc, unit: x.pack, qty: qty[i], unitPrice: x.price, extended: qty[i] * x.price }] : []));
    rows.push({ row: 0, vendor: 'Sysco', storeCode: CODE[l.storeId], invoiceNo, date: t.date, description: 'Delivery & fuel surcharge', qty: 1, unitPrice: amount - used, extended: amount - used });
    const m = periodOf(t.date);
    byMonth.set(m, [...(byMonth.get(m) ?? []), ...rows]);
  }
  for (const [m, rows] of [...byMonth].sort()) {
    setClock(addDays(lastDayOfPeriod(m) < DEMO_LAST ? lastDayOfPeriod(m) : DEMO_LAST, 0));
    commitInvoiceLines(books, cfo, { name: `Sysco invoice detail ${m} (demo).csv`, rows: rows.map((r, i) => ({ ...r, row: i + 2 })) }, { source: 'demo' });
  }

  // ── Waste log: a few entries a week per kitchen; HM15 had a bad October.
  const WASTE: [string, string, number, WasteReason][] = [
    ['Fried chicken pieces', 'pc', 1.1, 'overproduction'], ['Biscuits', 'each', 0.45, 'expired'], ['Fries', 'lb', 1.2, 'dropped'], ['Chicken tenders', 'lb', 3.3, 'overcooked'],
    ['Wings', 'lb', 2.95, 'quality'], ['Brisket', 'lb', 4.6, 'overcooked'], ['Buns', 'each', 0.2, 'expired'], ['Pizza', 'slice', 0.6, 'overproduction'],
  ];
  for (let d = '2026-09-02'; d <= DEMO_LAST; d = addDays(d, 2)) {
    for (const storeId of KITCHENS) {
      const bad = storeId === 'st_hm15' && d >= '2026-10-01' && d <= '2026-10-31';
      if (rand() > (bad ? 0.9 : 0.45)) continue;
      const pool = WASTE.filter(([item]) => storeId === 'st_hm11' || item !== 'Brisket');
      const [item, unit, unitCost, reason] = pool[Math.floor(rand() * pool.length)];
      const qty = Math.round((bad ? 14 : 6) + rand() * (bad ? 24 : 12));
      setClock(d);
      logWaste(books, cfo, { storeId, date: d, item, qty, unit, cost: Math.round(qty * unitCost * 100), reason, note: bad && reason === 'overproduction' ? 'Cooked to the old Friday plan; traffic was down.' : undefined });
    }
  }
}
