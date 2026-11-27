import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import {
  WASTE_REASON_LABEL, ackPriceAlert, commitInvoiceLines, commitMenuImport, foodCost, foodMonths, foodSalesByDay, foodTarget, invoiceSummaries, kitchenLabor, kitchenOf, kitchenStoreIds,
  logWaste, menuMix, parseInvoiceLines, parseMenuFile, previewInvoiceLines, previewMenuImport, priceItems, removeWaste, setFoodTarget, wasteEntries, type ParsedInvoiceLine, type ParsedMenuRow,
} from '../../core/kitchen';
import type { WasteReason } from '../../core/insideTypes';
import { storeWeeks, weekIndex } from '../../core/payroll';
import { lastDayOfPeriod, periodLabel, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import type { ID } from '../../core/types';
import { BatchList, FileOrPaste, MonthSelect, ReportGuard, StorePick, code, errList, errText, pct, useMonths, useParam } from './Inside';

function useKitchens(): ID[] {
  const { state, visible } = useBooks();
  return kitchenStoreIds(state, visible);
}

// ── Food sales and menu mix ──────────────────────────────────────────────
export function FoodSalesPage() {
  const { state, user, version } = useBooks();
  const exportCsv = useExport();
  const ks = useKitchens();
  const { months, latest } = useMonths();
  const [month, setMonth] = useParam('month', latest);
  const [store, setStore] = useParam('store', '');
  const [tab, setTab] = useParam('tab', 'sales');
  const ids = store ? [store] : ks;
  const from = `${month}-01`;
  const to = lastDayOfPeriod(month);
  const days = useMemo(() => foodSalesByDay(state, ids, from, to), [state, version, ids.join(), from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const mix = useMemo(() => menuMix(state, ids, from, to), [state, version, ids.join(), from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = days.reduce((a, d) => a + d.sales, 0);
  const nDays = new Set(days.filter((d) => d.sales).map((d) => d.date)).size;
  const posDays = days.filter((d) => d.pos !== null);
  const posOff = posDays.filter((d) => d.pos !== d.sales);
  const mixTies = mix.periods.map((p) => ({ p, ledger: days.filter((d) => d.storeId === p.storeId && d.date >= p.from && d.date <= p.to).reduce((a, d) => a + d.sales, 0) }));
  const mixOff = mixTies.filter((x) => x.ledger !== x.p.sales);
  const byStore = ids.map((s) => ({ s, sales: days.filter((d) => d.storeId === s).reduce((a, d) => a + d.sales, 0) }));
  return (
    <ReportGuard eyebrow="Kitchen" title="Food sales & menu mix">
      <PageHead eyebrow="Kitchen" title="Food sales & menu mix" lede="Food sales by store and day from the POS daily close (4200 Kitchen), and what sold from the POS item report.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`menu-mix-${month}`, ['Item', 'Qty', 'Sales', 'Share of sales', 'Average price'], mix.rows.map((r) => [r.item, r.qty, csvMoney(r.sales), (r.salesShare * 100).toFixed(1), r.avgPrice === null ? '' : csvMoney(r.avgPrice)]))}>Export menu mix</button>}
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`food-sales-${month}`, ['Date', 'Store', 'Food sales (POS close)', 'POS department import'], days.map((d) => [d.date, code(state, d.storeId), csvMoney(d.sales), d.pos === null ? '' : csvMoney(d.pos)]))}>Export days</button>}
      </PageHead>
      <section className="figures" aria-label="Food sales" style={{ marginBottom: 20 }}>
        <Figure label={`Food sales · ${periodLabel(month)}`} value={<Money c={total} whole dollar />} note={byStore.map((x) => `${code(state, x.s)} ${formatMoney(x.sales, { dollarSign: true, whole: true })}`).join(' · ')} />
        <Figure label="A day" value={nDays ? <Money c={Math.round(total / nDays)} whole dollar /> : '—'} note={`${nDays} days of sales`} />
        <Figure label="Top seller" value={mix.rows[0] ? pct(mix.rows[0].salesShare, 0) : '—'} note={mix.rows[0]?.item ?? 'No item report yet'} />
        <Figure label="Items sold" value={mix.qty.toLocaleString('en-US')} note={mix.qty ? <>average <Money c={Math.round(mix.sales / mix.qty)} dollar /> an item</> : 'From the item report'} />
      </section>
      <div className="seg" role="group" aria-label="View" style={{ marginBottom: 16 }}>
        {[['sales', 'Sales & menu mix'], ['import', 'Import item sales']].map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'import' ? <MenuImport /> : (
        <div className="stack">
          <section className="panel">
            <div className="filters">
              <MonthSelect id="fs-month" value={month} onChange={setMonth} months={months} />
              <StorePick id="fs-store" value={store} onChange={setStore} storeIds={ks} all="All kitchens" />
            </div>
            <div className="table-wrap"><table className="t">
              <caption className="sr-only">Menu mix</caption>
              <thead><tr><th scope="col">Item</th><th scope="col" className="num">Qty</th><th scope="col" className="num">Sales</th><th scope="col" className="num">Share of sales</th><th scope="col" className="num">Share of items</th><th scope="col" className="num">Average price</th></tr></thead>
              <tbody>
                {mix.rows.length === 0 && <tr><td colSpan={6} className="muted">No item report for {periodLabel(month)}.</td></tr>}
                {mix.rows.map((r) => <tr key={r.item}><td>{r.item}</td><td className="num">{r.qty.toLocaleString('en-US')}</td><td className="num"><Money c={r.sales} /></td><td className="num">{pct(r.salesShare)}</td><td className="num">{pct(r.qtyShare)}</td><td className="num">{r.avgPrice === null ? '—' : <Money c={r.avgPrice} />}</td></tr>)}
                {mix.rows.length > 0 && <tr className="total"><td>Total</td><td className="num">{mix.qty.toLocaleString('en-US')}</td><td className="num"><Money c={mix.sales} /></td><td /><td /><td /></tr>}
              </tbody>
            </table></div>
            <TieOut items={[
              { label: mixOff.length ? 'The item report does not add to food sales' : 'Menu mix ties to 4200 food sales in the ledger', ok: mixOff.length === 0, detail: mixOff.length ? mixOff.map((x) => `${code(state, x.p.storeId)} off ${formatMoney(x.p.sales - x.ledger, { dollarSign: true })}`).join('; ') : `${mix.periods.length} item report(s)` },
              { label: posOff.length ? `${posOff.length} day(s) where the POS import differs from the close` : 'POS kitchen department ties to the POS close', ok: posOff.length === 0, detail: `${posDays.length} store-days imported` },
            ]} />
          </section>
          <section className="panel" aria-labelledby="fd-h">
            <div className="panel-head"><h2 id="fd-h">By day</h2></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th scope="col">Date</th>{ids.map((s) => <th scope="col" key={s} className="num">{code(state, s)}</th>)}<th scope="col" className="num">Total</th></tr></thead>
              <tbody>{[...new Set(days.map((d) => d.date))].map((date) => (
                <tr key={date}><td>{shortDate(date)}</td>{ids.map((s) => { const d = days.find((x) => x.date === date && x.storeId === s); return <td key={s} className="num">{d ? <Money c={d.sales} /> : '—'}</td>; })}<td className="num"><Money c={days.filter((d) => d.date === date).reduce((a, d) => a + d.sales, 0)} /></td></tr>
              ))}</tbody>
            </table></div>
          </section>
        </div>
      )}
      <Help k="kitchenSales" />
    </ReportGuard>
  );
}

function MenuImport() {
  const { state, books, user } = useBooks();
  const [toast, say] = useToast();
  const ks = useKitchens();
  const [storeId, setStoreId] = useState(ks[0] ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [file, setFile] = useState<{ name: string; rows: ParsedMenuRow[]; problems: string[] } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const pv = useMemo(() => (file ? previewMenuImport(state, file.rows) : null), [file, state]);
  return (
    <div className="stack">
      <section className="panel panel-pad" aria-labelledby="mi-h">
        <h2 id="mi-h" style={{ marginBottom: 8 }}>Import item sales</h2>
        <p className="muted">The POS item (PLU) sales report for the kitchen: Item, Qty and Sales, for one store and period. Re-importing the same period adds nothing.</p>
        {can(user, 'inside.edit') ? (
          <>
            <div className="form-grid" style={{ margin: '12px 0' }}>
              <StorePick id="mi-store" value={storeId} onChange={setStoreId} storeIds={ks} all={null} />
              <div className="field"><label htmlFor="mi-from">From</label><input id="mi-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="field"><label htmlFor="mi-to">To</label><input id="mi-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
            <FileOrPaste id="mi-paste" label="Paste the item report" button="Read item report" placeholder={'Item,Qty,Sales\nFried chicken 2 pc,412,2879.88\nBreakfast biscuit,380,1326.20'}
              onText={(name, text) => { const p = parseMenuFile(text, { storeCode: code(state, storeId), from, to: to || from }); setErrors(p.rows.length ? [] : p.problems.length ? p.problems : ['No item rows found.']); setFile(p.rows.length ? { name, ...p } : null); }} />
          </>
        ) : <p className="muted">Your role can't import item sales.</p>}
        <Errors errors={errors} />
      </section>
      {file && pv && (
        <section className="panel" aria-labelledby="mp-h">
          <div className="panel-head"><h2 id="mp-h">Preview: {file.name}</h2><span className="muted small">{pv.added} new, {pv.skipped} skipped</span></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Item</th><th scope="col" className="num">Qty</th><th scope="col" className="num">Sales</th><th scope="col">Status</th></tr></thead>
            <tbody>{pv.rows.map((r) => <tr key={r.row}><td>{r.item}</td><td className="num">{r.qty}</td><td className="num"><Money c={r.sales} /></td><td>{r.status === 'new' ? <span className="pill ok">New</span> : r.status === 'duplicate' ? <span className="pill">Already imported</span> : <span className="pill bad">{r.problem}</span>}</td></tr>)}</tbody>
          </table></div>
          <TieOut items={pv.periods.map((p) => ({ label: p.ties ? `Ties to ${code(state, p.storeId)} food sales in the books` : `Off from ${code(state, p.storeId)} food sales`, ok: p.ties, detail: `file ${formatMoney(p.file, { dollarSign: true })} vs 4200 ${formatMoney(p.ledger, { dollarSign: true })}, ${shortDate(p.from)} – ${shortDate(p.to)}` }))} />
          <div className="panel-pad actions">
            <button className="btn primary" disabled={!pv.added} onClick={() => { try { const r = commitMenuImport(books, user, file); say(`Imported ${r.rows.length} items.`); setFile(null); } catch (e) { say(errText(e)); } }}>Import {pv.added} item{pv.added === 1 ? '' : 's'}</button>
            <button className="btn ghost" onClick={() => setFile(null)}>Cancel</button>
          </div>
        </section>
      )}
      <BatchList batches={kitchenOf(state).batches.filter((b) => b.kind === 'menu')} />
      {toast}
    </div>
  );
}

// ── Food cost ────────────────────────────────────────────────────────────
export function FoodCostPage() {
  const { state, books, user, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ks = useKitchens();
  const rows = useMemo(() => { const idx = weekIndex(state); return ks.flatMap((s) => foodMonths(state, [s]).map((p) => foodCost(state, s, p, idx))); }, [state, version, ks.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const latestCounted = ks.map((s) => rows.filter((r) => r.storeId === s && r.counted).at(-1)).filter((r): r is NonNullable<typeof r> => !!r);
  const sales = latestCounted.reduce((a, r) => a + r.sales, 0);
  const cost = latestCounted.reduce((a, r) => a + r.cost, 0);
  const waste = latestCounted.reduce((a, r) => a + r.waste, 0);
  const outside = latestCounted.filter((r) => r.outside);
  const off = rows.filter((r) => r.cost !== r.ledger);
  const [targets, setTargets] = useState<Record<ID, string>>({});
  const months = [...new Set(rows.map((r) => r.period))].sort();
  const tol = kitchenOf(state).toleranceBps;
  return (
    <ReportGuard eyebrow="Kitchen" title="Food cost">
      <PageHead eyebrow="Kitchen" title="Food cost" lede={`Food cost % = (purchases ± the change in counted kitchen inventory) ÷ food sales, by store and month, against each store's target (±${(tol / 100).toFixed(0)} points). A month is measured once it has a kitchen count near its end; until then it shows purchases only.`}>
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('food-cost', ['Store', 'Month', 'Food sales', 'Purchases', 'Inventory change', 'Food cost', 'Food cost %', 'Target %', 'Waste', 'Waste %', 'Cost % without waste', 'Counted', 'Ledger 5200'],
          rows.map((r) => [code(state, r.storeId), r.period, csvMoney(r.sales), csvMoney(r.purchases), csvMoney(r.invChange), csvMoney(r.cost), r.pct === null ? '' : (r.pct * 100).toFixed(2), (r.targetBps / 100).toFixed(1), csvMoney(r.waste), r.wastePct === null ? '' : (r.wastePct * 100).toFixed(2), r.pctExWaste === null ? '' : (r.pctExWaste * 100).toFixed(2), r.counted ? r.countDate ?? '' : '', csvMoney(r.ledger)]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Food cost" style={{ marginBottom: 20 }}>
        <Figure label="Food cost, latest counted month" value={pct(sales ? cost / sales : null)} note={latestCounted.map((r) => `${code(state, r.storeId)} ${periodLabel(r.period).split(' ')[0]}`).join(', ') || 'No counts yet'} />
        <Figure label="Outside target" value={outside.length} note={outside.map((r) => `${code(state, r.storeId)} ${pct(r.pct)} vs ${(r.targetBps / 100).toFixed(1)}%`).join(', ') || 'Every kitchen is inside target'} />
        <Figure label="Waste" value={pct(sales ? waste / sales : null)} note={<>of food sales · <Money c={waste} whole dollar /></>} />
        <Figure label="Food cost" value={<Money c={cost} whole dollar />} note={<>on <Money c={sales} whole dollar /> of food sales</>} />
      </section>
      <div className="stack">
        <section className="panel" aria-labelledby="ft-h">
          <div className="panel-head"><h2 id="ft-h">Trend</h2><span className="muted small">* not counted yet: purchases only</span></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Store</th><th scope="col" className="num">Target</th>{months.map((m) => <th scope="col" key={m} className="num">{periodLabel(m)}</th>)}</tr></thead>
            <tbody>{ks.map((s) => (
              <tr key={s}><td><b>{code(state, s)}</b></td><td className="num">{(foodTarget(state, s) / 100).toFixed(1)}%</td>
                {months.map((m) => { const r = rows.find((x) => x.storeId === s && x.period === m); return <td key={m} className="num">{!r || r.pct === null ? '—' : r.counted ? <span className={'pill ' + (r.outside ? 'bad' : 'ok')}>{pct(r.pct)}</span> : <span className="muted">{pct(r.pct)}*</span>}</td>; })}</tr>
            ))}</tbody>
          </table></div>
        </section>
        <section className="panel" aria-labelledby="fdet-h">
          <div className="panel-head"><h2 id="fdet-h">Detail</h2></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Store</th><th scope="col">Month</th><th scope="col" className="num">Food sales</th><th scope="col" className="num">Purchases</th><th scope="col" className="num">Inventory change</th><th scope="col" className="num">Food cost</th><th scope="col" className="num">Cost %</th><th scope="col" className="num">Waste %</th><th scope="col" className="num">Without waste</th><th scope="col">Count</th></tr></thead>
            <tbody>{[...rows].reverse().map((r) => (
              <tr key={r.storeId + r.period}><td>{code(state, r.storeId)}</td><td>{periodLabel(r.period)}</td><td className="num"><Money c={r.sales} /></td><td className="num"><Link to={`/inside/purchases?month=${r.period}&store=${r.storeId}&dept=dept_kitchen`}><Money c={r.purchases} /></Link></td>
                <td className="num"><Money c={r.invChange} /></td><td className="num"><Money c={r.cost} /></td><td className="num">{pct(r.pct)}</td><td className="num">{pct(r.wastePct)}</td><td className="num">{pct(r.pctExWaste)}</td>
                <td>{r.counted ? <Link to={`/inside/inventory?store=${r.storeId}`}>{shortDate(r.countDate!)}</Link> : <span className="pill warn">Not counted</span>}</td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[
            { label: off.length ? `${off.length} month(s) do not tie to 5200` : 'Food cost ties to 5200 Kitchen food in the ledger', ok: off.length === 0, detail: off.length ? off.slice(0, 3).map((r) => `${code(state, r.storeId)} ${r.period} ${formatMoney(r.cost - r.ledger, { dollarSign: true })}`).join('; ') : `${rows.length} store-months: purchases plus the posted kitchen count adjustments` },
          ]} />
        </section>
        {can(user, 'inside.edit') && (
          <section className="panel panel-pad" aria-labelledby="fct-h">
            <h2 id="fct-h" style={{ marginBottom: 12 }}>Targets</h2>
            <div className="form-grid">{ks.map((s) => (
              <div className="field" key={s}><label htmlFor={'fct-' + s}>{code(state, s)} target (% of food sales)</label>
                <div className="actions"><input id={'fct-' + s} className="num" inputMode="decimal" style={{ width: 90 }} value={targets[s] ?? (foodTarget(state, s) / 100).toFixed(1)} onChange={(e) => setTargets({ ...targets, [s]: e.target.value })} />
                  <button className="btn sm" onClick={() => { try { setFoodTarget(books, user, s, Math.round(Number(targets[s] ?? foodTarget(state, s) / 100) * 100)); say(`${code(state, s)} target saved.`); } catch (e) { say(errText(e)); } }}>Save</button></div></div>
            ))}</div>
          </section>
        )}
      </div>
      {toast}
      <Help k="kitchenFoodCost" />
    </ReportGuard>
  );
}

// ── Waste log ────────────────────────────────────────────────────────────
export function WastePage() {
  const { state, books, user, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ks = useKitchens();
  const { months, latest } = useMonths();
  const [month, setMonth] = useParam('month', latest);
  const [store, setStore] = useParam('store', '');
  const ids = store ? [store] : ks;
  const from = `${month}-01`;
  const to = lastDayOfPeriod(month);
  const list = useMemo(() => wasteEntries(state, ids, from, to), [state, version, ids.join(), from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const fc = useMemo(() => { const idx = weekIndex(state); return ids.map((s) => foodCost(state, s, month, idx)); }, [state, version, ids.join(), month]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = list.reduce((a, w) => a + w.cost, 0);
  const sales = fc.reduce((a, r) => a + r.sales, 0);
  const cost = fc.reduce((a, r) => a + r.cost, 0);
  const byReason = new Map<WasteReason, number>();
  for (const w of list) byReason.set(w.reason, (byReason.get(w.reason) ?? 0) + w.cost);
  const top = [...byReason].sort((a, b) => b[1] - a[1])[0];
  const [f, setF] = useState<{ storeId: string; date: string; item: string; qty: string; unit: string; cost: string; reason: WasteReason; note: string }>({ storeId: ks[0] ?? '', date: todayInChicago(), item: '', qty: '', unit: 'each', cost: '', reason: 'overproduction', note: '' });
  const [errs, setErrs] = useState<string[]>([]);
  const reasonSum = [...byReason.values()].reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHead eyebrow="Kitchen" title="Waste log" lede="What the kitchen threw away, what it cost and why. Waste is already inside food cost (it was bought); the log shows how many points of the cost % it is.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`waste-${month}`, ['Date', 'Store', 'Item', 'Qty', 'Unit', 'Cost', 'Reason', 'Note'], list.map((w) => [w.date, code(state, w.storeId), w.item, w.qty, w.unit, csvMoney(w.cost), WASTE_REASON_LABEL[w.reason], w.note ?? '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Waste" style={{ marginBottom: 20 }}>
        <Figure label={`Waste · ${periodLabel(month)}`} value={<Money c={total} whole dollar />} note={`${list.length} entries`} />
        <Figure label="Points of food cost" value={pct(sales ? total / sales : null)} note={sales ? <>food cost {pct(cost / sales)}, {pct((cost - total) / sales)} without waste</> : 'No food sales'} />
        <Figure label="Top reason" value={top ? <Money c={top[1]} whole dollar /> : '—'} note={top ? WASTE_REASON_LABEL[top[0]] : 'Nothing logged'} />
      </section>
      <div className="stack">
        <section className="panel">
          <div className="filters">
            <MonthSelect id="wl-month" value={month} onChange={setMonth} months={months} />
            <StorePick id="wl-store" value={store} onChange={setStore} storeIds={ks} all="All kitchens" />
          </div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Date</th><th scope="col">Store</th><th scope="col">Item</th><th scope="col" className="num">Qty</th><th scope="col" className="num">Cost</th><th scope="col">Reason</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={7} className="muted">Nothing logged for {periodLabel(month)}.</td></tr>}
              {list.slice(0, 150).map((w) => (
                <tr key={w.id}><td>{shortDate(w.date)}</td><td>{code(state, w.storeId)}</td><td>{w.item}{w.note && <div className="muted small">{w.note}</div>}</td><td className="num">{w.qty} {w.unit}</td><td className="num"><Money c={w.cost} /></td><td>{WASTE_REASON_LABEL[w.reason]}</td>
                  <td>{can(user, 'inside.log') && <button className="btn sm ghost" aria-label={`Remove ${w.item} ${w.date}`} onClick={() => { try { removeWaste(books, user, w.id, 'Entered in error'); say('Removed.'); } catch (e) { say(errText(e)); } }}>Remove</button>}</td></tr>
              ))}
            </tbody>
          </table></div>
          <div className="table-wrap"><table className="t">
            <caption className="sr-only">By reason</caption>
            <thead><tr><th scope="col">Reason</th><th scope="col" className="num">Cost</th><th scope="col" className="num">Points of food cost</th></tr></thead>
            <tbody>{[...byReason].sort((a, b) => b[1] - a[1]).map(([r, v]) => <tr key={r}><td>{WASTE_REASON_LABEL[r]}</td><td className="num"><Money c={v} /></td><td className="num">{pct(sales ? v / sales : null, 2)}</td></tr>)}</tbody>
          </table></div>
          <TieOut items={[
            { label: reasonSum === total ? 'Reasons add to the waste total' : 'Reasons do not add up', ok: reasonSum === total, detail: formatMoney(total, { dollarSign: true }) },
            { label: 'Food cost % = cost without waste + waste points', ok: !sales || Math.abs((cost - total) / sales + total / sales - cost / sales) < 1e-9, detail: sales ? `${pct((cost - total) / sales)} + ${pct(total / sales)} = ${pct(cost / sales)}` : undefined },
          ]} />
        </section>
        {can(user, 'inside.log') && (
          <section className="panel panel-pad" aria-labelledby="wn-h">
            <h2 id="wn-h" style={{ marginBottom: 12 }}>Log waste</h2>
            <div className="form-grid">
              <StorePick id="wn-store" value={f.storeId} onChange={(v) => setF({ ...f, storeId: v })} storeIds={ks} all={null} />
              <div className="field"><label htmlFor="wn-date">Date</label><input id="wn-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
              <div className="field"><label htmlFor="wn-item">Item</label><input id="wn-item" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} /></div>
              <div className="field"><label htmlFor="wn-qty">Qty</label><input id="wn-qty" className="num" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></div>
              <div className="field"><label htmlFor="wn-unit">Unit</label><input id="wn-unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
              <div className="field"><label htmlFor="wn-cost">Cost</label><input id="wn-cost" className="num" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></div>
              <div className="field"><label htmlFor="wn-reason">Reason</label><select id="wn-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value as WasteReason })}>{Object.entries(WASTE_REASON_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div className="field"><label htmlFor="wn-note">Note</label><input id="wn-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
            </div>
            <Errors errors={errs} />
            <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => { try { logWaste(books, user, { storeId: f.storeId, date: f.date, item: f.item, qty: Number(f.qty), unit: f.unit, cost: parseMoney(f.cost) ?? 0, reason: f.reason, note: f.note }); setErrs([]); setF({ ...f, item: '', qty: '', cost: '', note: '' }); say('Logged.'); } catch (e) { setErrs(errList(e)); } }}>Log waste</button></div>
          </section>
        )}
      </div>
      {toast}
      <Help k="kitchenWaste" />
    </>
  );
}

// ── Kitchen labor and prime cost ─────────────────────────────────────────
export function PrimeCostPage() {
  const { state, user, version } = useBooks();
  const exportCsv = useExport();
  const ks = useKitchens();
  const { months, latest } = useMonths();
  const [month, setMonth] = useParam('month', latest);
  const data = useMemo(() => {
    const idx = weekIndex(state);
    const from = `${month}-01`;
    const to = lastDayOfPeriod(month);
    const weeks = [...idx.keys()].filter((w) => w >= from && w <= to);
    return ks.map((s) => {
      const fc = foodCost(state, s, month, idx);
      const lab = kitchenLabor(state, [s], from, to, idx);
      const storeLabor = weeks.reduce((a, w) => a + (storeWeeks(state, w, idx).get(s)?.cost ?? 0), 0);
      return { s, fc, lab, storeLabor };
    });
  }, [state, version, ks.join(), month]); // eslint-disable-line react-hooks/exhaustive-deps
  const sales = data.reduce((a, d) => a + d.fc.sales, 0);
  const food = data.reduce((a, d) => a + d.fc.cost, 0);
  const labor = data.reduce((a, d) => a + d.lab.cost, 0);
  const hours = data.reduce((a, d) => a + d.lab.hours, 0);
  const laborOk = data.every((d) => d.lab.cost <= d.storeLabor);
  const foodOk = data.every((d) => d.fc.cost === d.fc.ledger);
  return (
    <ReportGuard eyebrow="Kitchen" title="Labor & prime cost">
      <PageHead eyebrow="Kitchen" title="Labor & prime cost" lede="Kitchen labor from payroll's Kitchen department (gross + employer taxes + cash and check pay, for pay weeks paid in the month) and prime cost: food cost plus kitchen labor, as a share of food sales.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv(`prime-cost-${month}`, ['Store', 'Food sales', 'Food cost', 'Kitchen labor', 'Kitchen hours', 'Prime cost', 'Prime cost %', 'Labor %'],
          data.map((d) => [code(state, d.s), csvMoney(d.fc.sales), csvMoney(d.fc.cost), csvMoney(d.lab.cost), d.lab.hours, csvMoney(d.fc.cost + d.lab.cost), d.fc.sales ? (((d.fc.cost + d.lab.cost) / d.fc.sales) * 100).toFixed(2) : '', d.fc.sales ? ((d.lab.cost / d.fc.sales) * 100).toFixed(2) : '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Prime cost" style={{ marginBottom: 20 }}>
        <Figure label={`Prime cost · ${periodLabel(month)}`} value={pct(sales ? (food + labor) / sales : null)} note={<Money c={food + labor} whole dollar />} />
        <Figure label="Kitchen labor" value={pct(sales ? labor / sales : null)} note={<><Money c={labor} whole dollar /> · {Math.round(hours).toLocaleString('en-US')} hours</>} />
        <Figure label="Food cost" value={pct(sales ? food / sales : null)} note={data.some((d) => !d.fc.counted) ? 'Purchases only where not counted' : 'Counted'} />
        <Figure label="Food sales per kitchen hour" value={hours ? <Money c={Math.round(sales / hours)} dollar /> : '—'} note={<Money c={sales} whole dollar />} />
      </section>
      <section className="panel">
        <div className="filters"><MonthSelect id="pc-month" value={month} onChange={setMonth} months={months} /></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Store</th><th scope="col" className="num">Food sales</th><th scope="col" className="num">Food cost</th><th scope="col" className="num">Kitchen labor</th><th scope="col" className="num">People</th><th scope="col" className="num">Hours</th><th scope="col" className="num">Prime cost</th><th scope="col" className="num">Prime %</th><th scope="col" className="num">Store payroll</th></tr></thead>
          <tbody>{data.map((d) => (
            <tr key={d.s}><td><b>{code(state, d.s)}</b></td><td className="num"><Money c={d.fc.sales} /></td><td className="num"><Money c={d.fc.cost} />{!d.fc.counted && <span className="muted">*</span>}</td><td className="num"><Link to="/people/labor"><Money c={d.lab.cost} /></Link></td><td className="num">{d.lab.people}</td><td className="num">{Math.round(d.lab.hours)}</td>
              <td className="num"><Money c={d.fc.cost + d.lab.cost} /></td><td className="num">{pct(d.fc.primePct)}</td><td className="num"><Money c={d.storeLabor} /></td></tr>
          ))}
            <tr className="total"><td>Kitchens</td><td className="num"><Money c={sales} /></td><td className="num"><Money c={food} /></td><td className="num"><Money c={labor} /></td><td /><td className="num">{Math.round(hours)}</td><td className="num"><Money c={food + labor} /></td><td className="num">{pct(sales ? (food + labor) / sales : null)}</td><td className="num"><Money c={data.reduce((a, d) => a + d.storeLabor, 0)} /></td></tr></tbody>
        </table></div>
        <p className="panel-pad muted small" style={{ paddingTop: 8, paddingBottom: 8 }}>* Not counted yet: purchases only. Pay weeks belong to the month of their Friday pay date.</p>
        <TieOut items={[
          { label: laborOk ? 'Kitchen labor is part of each store\'s payroll for the same weeks' : 'Kitchen labor exceeds store payroll', ok: laborOk, detail: 'same pay weeks as People › Labor %' },
          { label: foodOk ? 'Food cost ties to 5200 in the ledger' : 'Food cost does not tie to 5200', ok: foodOk },
        ]} />
      </section>
      <Help k="kitchenPrime" />
    </ReportGuard>
  );
}

// ── Supplier prices ──────────────────────────────────────────────────────
export function SupplierPricesPage() {
  const { state, books, user, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ks = useKitchens();
  const [show, setShow] = useParam('show', '');
  const [tab, setTab] = useParam('tab', 'prices');
  const items = useMemo(() => priceItems(state, new Set(ks)), [state, version, ks.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const invoices = useMemo(() => invoiceSummaries(state, new Set(ks)), [state, version, ks.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const k = kitchenOf(state);
  const alerts = items.filter((i) => i.alert && !i.acked);
  const shown = show === 'alerts' ? items.filter((i) => i.alert) : items;
  const matched = invoices.filter((i) => i.txnId);
  const spend = items.reduce((a, i) => a + i.spend, 0);
  const lineTotal = k.invoiceLines.filter((l) => ks.includes(l.storeId)).reduce((a, l) => a + l.extended, 0);
  const vendor = (id: ID) => state.parties.find((p) => p.id === id)?.name ?? id;
  return (
    <ReportGuard eyebrow="Kitchen" title="Supplier prices">
      <PageHead eyebrow="Kitchen" title="Supplier prices" lede={`Item-level invoice detail from Sysco and other food suppliers. The top ${k.topItems} items by spend alert when the latest price moves more than ${(k.priceAlertBps / 100).toFixed(0)}% from the price before.`}>
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('supplier-prices', ['Vendor', 'Item code', 'Item', 'Pack', 'Latest price', 'Since', 'Price before', 'Change %', 'Spend', 'Top item', 'Alert'],
          shown.map((i) => [vendor(i.vendorId), i.itemCode, i.description, i.unit ?? '', csvMoney(i.latest.unitPrice), i.changedOn, i.prior ? csvMoney(i.prior.unitPrice) : '', i.change === null ? '' : (i.change * 100).toFixed(1), csvMoney(i.spend), i.top ? 'yes' : '', i.alert ? 'yes' : '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Supplier prices" style={{ marginBottom: 20 }}>
        <Figure label="Price alerts" value={alerts.length} note={alerts.map((i) => `${i.description} ${i.change! > 0 ? '+' : ''}${pct(i.change)}`).join(', ') || 'No top item moved'} />
        <Figure label="Items tracked" value={items.length} note={`${invoices.length} invoices imported`} />
        <Figure label="Spend on tracked items" value={<Money c={spend} whole dollar />} note="Lines with an item code" />
        <Figure label="Invoices matched to the books" value={`${matched.length} of ${invoices.length}`} note="Same vendor, store and total" />
      </section>
      <div className="seg" role="group" aria-label="View" style={{ marginBottom: 16 }}>
        {[['prices', 'Prices'], ['invoices', 'Invoices'], ['import', 'Import invoice detail']].map(([kk, l]) => <button key={kk} aria-pressed={tab === kk} onClick={() => setTab(kk)}>{l}</button>)}
      </div>
      {tab === 'import' ? <InvoiceLineImport /> : tab === 'invoices' ? (
        <section className="panel">
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Invoice</th><th scope="col">Vendor</th><th scope="col">Store</th><th scope="col">Date</th><th scope="col" className="num">Lines</th><th scope="col" className="num">Total</th><th scope="col">In the books</th></tr></thead>
            <tbody>{invoices.slice(0, 120).map((i) => (
              <tr key={i.vendorId + i.storeId + i.invoiceNo}><td>{i.invoiceNo}</td><td>{vendor(i.vendorId)}</td><td>{code(state, i.storeId)}</td><td>{shortDate(i.date)}</td><td className="num">{i.lines}</td><td className="num"><Money c={i.total} /></td>
                <td>{i.txnId ? <Link to={`/books/transactions/${i.txnId}`}>{state.transactions.find((t) => t.id === i.txnId)?.ref}</Link> : <span className="pill warn">No matching purchase</span>}</td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[
            { label: matched.length === invoices.length ? 'Every invoice matches a purchase in the books' : `${invoices.length - matched.length} invoice(s) have no matching purchase`, ok: matched.length === invoices.length, detail: `${formatMoney(invoices.reduce((a, i) => a + i.total, 0), { dollarSign: true })} of invoices` },
            { label: lineTotal === invoices.reduce((a, i) => a + i.total, 0) ? 'Invoice lines add to the invoice totals' : 'Invoice lines do not add up', ok: lineTotal === invoices.reduce((a, i) => a + i.total, 0) },
          ]} />
        </section>
      ) : (
        <section className="panel">
          <div className="filters"><div className="seg" role="group" aria-label="Show">{[['', 'All items'], ['alerts', 'Alerts']].map(([kk, l]) => <button key={kk} aria-pressed={show === kk} onClick={() => setShow(kk)}>{l}</button>)}</div></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Item</th><th scope="col">Vendor</th><th scope="col" className="num">Latest price</th><th scope="col" className="num">Price before</th><th scope="col" className="num">Change</th><th scope="col" className="num">Spend</th><th scope="col"><span className="sr-only">Alert</span></th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={7} className="muted">No price alerts.</td></tr>}
              {shown.map((i) => (
                <tr key={i.key}><td><b>{i.description}</b><div className="muted small">{i.itemCode}{i.unit ? ` · ${i.unit}` : ''}{i.top ? ' · top item' : ''}</div></td><td>{vendor(i.vendorId)}</td>
                  <td className="num"><Money c={i.latest.unitPrice} /><div className="muted small">since {shortDate(i.changedOn)}</div></td><td className="num">{i.prior ? <><Money c={i.prior.unitPrice} /><div className="muted small">{shortDate(i.prior.date)}</div></> : '—'}</td>
                  <td className="num">{i.change === null ? '—' : <span className={'pill ' + (i.alert ? 'bad' : '')}>{i.change > 0 ? '+' : ''}{pct(i.change)}</span>}</td><td className="num"><Money c={i.spend} /></td>
                  <td>{i.alert && (i.acked ? <span className="small muted">Reviewed</span> : can(user, 'inside.edit') && <button className="btn sm" onClick={() => { try { ackPriceAlert(books, user, i.key, i.changedOn); say('Marked reviewed.'); } catch (e) { say(errText(e)); } }}>Mark reviewed</button>)}</td></tr>
              ))}
            </tbody>
          </table></div>
          <TieOut items={[{ label: 'Tracked spend is part of the imported invoice lines', ok: spend <= lineTotal, detail: `${formatMoney(spend, { dollarSign: true })} of ${formatMoney(lineTotal, { dollarSign: true })}; freight and surcharges are not price-tracked` }]} />
        </section>
      )}
      {toast}
      <Help k="kitchenPrices" />
    </ReportGuard>
  );
}

function InvoiceLineImport() {
  const { state, books, user } = useBooks();
  const [toast, say] = useToast();
  const [file, setFile] = useState<{ name: string; rows: ParsedInvoiceLine[]; problems: string[] } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const pv = useMemo(() => (file ? previewInvoiceLines(state, file.rows) : null), [file, state]);
  return (
    <div className="stack">
      <section className="panel panel-pad" aria-labelledby="il-h">
        <h2 id="il-h" style={{ marginBottom: 8 }}>Import supplier invoice detail</h2>
        <p className="muted">The supplier's invoice detail export (Sysco "Invoice Detail", or any CSV): Vendor, Store, Invoice, Date, Item code, Description, Pack, Qty, Price and Extended. Lines without an item code (freight, surcharges) are kept but not price-tracked. Re-importing adds nothing.</p>
        {can(user, 'inside.edit') ? <FileOrPaste id="il-paste" label="Paste invoice detail" button="Read invoice detail" placeholder={'Vendor,Store,Invoice,Date,Item code,Description,Pack,Qty,Price,Extended\nSysco,HM13,SY-90001,2026-11-26,1004417,Chicken wings jumbo,40 lb case,2,133.50,267.00'}
          onText={(name, text) => { const p = parseInvoiceLines(text); setErrors(p.rows.length ? [] : p.problems.length ? p.problems : ['No invoice lines found.']); setFile(p.rows.length ? { name, ...p } : null); }} /> : <p className="muted">Your role can't import invoices.</p>}
        <Errors errors={errors} />
      </section>
      {file && pv && (
        <section className="panel" aria-labelledby="ilp-h">
          <div className="panel-head"><h2 id="ilp-h">Preview: {file.name}</h2><span className="muted small">{pv.added} new, {pv.skipped} skipped</span></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Invoice</th><th scope="col">Item</th><th scope="col" className="num">Qty</th><th scope="col" className="num">Price</th><th scope="col" className="num">Extended</th><th scope="col">Status</th></tr></thead>
            <tbody>{pv.rows.map((r) => <tr key={r.row}><td>{r.invoiceNo}</td><td>{r.description}</td><td className="num">{r.qty}</td><td className="num"><Money c={r.unitPrice} /></td><td className="num"><Money c={r.extended} /></td><td>{r.status === 'new' ? <span className="pill ok">New</span> : r.status === 'duplicate' ? <span className="pill">Already imported</span> : <span className="pill bad">{r.problem}</span>}</td></tr>)}</tbody>
          </table></div>
          <TieOut items={pv.invoices.map((i) => ({ label: i.txnId ? `Invoice ${i.invoiceNo} matches a purchase in the books` : `Invoice ${i.invoiceNo} has no matching purchase yet`, ok: !!i.txnId, detail: `${formatMoney(i.total, { dollarSign: true })}, ${i.lines} lines` }))} />
          <div className="panel-pad actions">
            <button className="btn primary" disabled={!pv.added} onClick={() => { try { const r = commitInvoiceLines(books, user, file); say(`Imported ${r.lines.length} lines.`); setFile(null); } catch (e) { say(errText(e)); } }}>Import {pv.added} line{pv.added === 1 ? '' : 's'}</button>
            <button className="btn ghost" onClick={() => setFile(null)}>Cancel</button>
          </div>
        </section>
      )}
      <BatchList batches={kitchenOf(state).batches.filter((b) => b.kind === 'invoice_lines')} />
      {toast}
    </div>
  );
}
